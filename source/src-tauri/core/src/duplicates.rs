//! Three-stage duplicate detection: size -> BLAKE3 of the first 4 KiB -> streamed full BLAKE3.
//! Two files are only reported as duplicates when their complete contents hash identically.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use serde::Serialize;

use crate::errors::{CoreError, Result};
use crate::tree::ScanTree;

pub const PARTIAL_BYTES: usize = 4096;
const READ_BUFFER: usize = 256 * 1024;
const STAGES: [&str; 4] = ["grouping", "partial_hash", "full_hash", "finalizing"];

#[derive(Debug, Clone)]
pub struct DuplicateOptions {
    pub min_size: u64,
    pub scope: Option<u32>,
    /// 0 = automatic (4 hashing threads: spinning disks dislike more).
    pub threads: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateFile {
    pub node_id: u32,
    pub path: String,
    pub modified: Option<i64>,
    pub allocated: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub id: u32,
    /// Hex BLAKE3 digest of the full contents.
    pub hash: String,
    pub size: u64,
    /// Bytes that would be reclaimed by keeping a single copy: `size * (copies - 1)`.
    pub wasted: u64,
    pub files: Vec<DuplicateFile>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DuplicateSummary {
    pub groups_count: u32,
    pub files_in_groups: u32,
    pub wasted_bytes: u64,
    pub candidate_files: u64,
    pub skipped_files: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Default)]
pub struct DuplicateReport {
    pub summary: DuplicateSummary,
    pub groups: Vec<DuplicateGroup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateProgress {
    pub stage: &'static str,
    pub processed: u64,
    pub total: u64,
    pub current_path: String,
}

struct Progress {
    stage: AtomicU8,
    processed: AtomicU64,
    total: AtomicU64,
    skipped: AtomicU64,
    current: Mutex<String>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Progress {
    fn begin(&self, stage: u8, total: u64) {
        self.stage.store(stage, Ordering::Relaxed);
        self.processed.store(0, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
    }
    fn touch(&self, path: &Path) {
        self.processed.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut cur) = self.current.try_lock() {
            cur.clear();
            cur.push_str(&path.to_string_lossy());
        }
    }
    fn snapshot(&self) -> DuplicateProgress {
        DuplicateProgress {
            stage: STAGES[(self.stage.load(Ordering::Relaxed) as usize).min(STAGES.len() - 1)],
            processed: self.processed.load(Ordering::Relaxed),
            total: self.total.load(Ordering::Relaxed),
            current_path: lock(&self.current).clone(),
        }
    }
}

/// BLAKE3 of at most the first [`PARTIAL_BYTES`] bytes. Fails if the file is shorter than expected.
pub fn hash_prefix(path: &Path, size: u64) -> io::Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let want = size.min(PARTIAL_BYTES as u64) as usize;
    let mut buf = vec![0u8; want];
    file.read_exact(&mut buf)?;
    Ok(*blake3::hash(&buf).as_bytes())
}

/// Streamed BLAKE3 of the whole file. Returns `Ok(None)` when the file changed while it was being read
/// or the operation was cancelled, so callers never compare half-read content.
pub fn hash_file(path: &Path, expected_len: u64, cancel: &AtomicBool) -> io::Result<Option<[u8; 32]>> {
    let mut file = File::open(path)?;
    let before = file.metadata()?;
    if before.len() != expected_len {
        return Ok(None);
    }
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; READ_BUFFER];
    let mut total = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                hasher.update(&buf[..n]);
                total += n as u64;
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    let after = file.metadata()?;
    if total != expected_len || after.len() != expected_len || after.modified().ok() != before.modified().ok() {
        return Ok(None);
    }
    Ok(Some(*hasher.finalize().as_bytes()))
}

fn to_hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hard links share storage, so they are not wasted space. Only detectable on Unix.
#[cfg(unix)]
fn identity(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).ok().map(|m| (m.dev(), m.ino()))
}

#[cfg(not(unix))]
fn identity(_path: &Path) -> Option<(u64, u64)> {
    None
}

pub fn find_duplicates(
    tree: &ScanTree,
    opts: &DuplicateOptions,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(DuplicateProgress) + Sync),
) -> Result<DuplicateReport> {
    let started = Instant::now();
    let threads = if opts.threads == 0 { 4 } else { opts.threads.clamp(1, 16) };
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|i| format!("diskpulse-hash-{i}"))
        .build()
        .map_err(|e| CoreError::Invalid(format!("could not start hashing threads: {e}")))?;
    let progress = Progress {
        stage: AtomicU8::new(0),
        processed: AtomicU64::new(0),
        total: AtomicU64::new(0),
        skipped: AtomicU64::new(0),
        current: Mutex::new(String::new()),
    };
    let done = AtomicBool::new(false);

    let result = std::thread::scope(|ts| {
        let reporter = ts.spawn(|| {
            while !done.load(Ordering::Acquire) {
                std::thread::park_timeout(Duration::from_millis(100));
                if done.load(Ordering::Acquire) {
                    break;
                }
                on_progress(progress.snapshot());
            }
        });
        let result = run_pipeline(tree, opts, cancel, &pool, &progress);
        done.store(true, Ordering::Release);
        reporter.thread().unpark();
        result
    });
    let mut report = result?;
    report.summary.elapsed_ms = started.elapsed().as_millis() as u64;
    report.summary.skipped_files = progress.skipped.load(Ordering::Relaxed);
    on_progress(progress.snapshot());
    Ok(report)
}

fn run_pipeline(
    tree: &ScanTree,
    opts: &DuplicateOptions,
    cancel: &AtomicBool,
    pool: &rayon::ThreadPool,
    progress: &Progress,
) -> Result<DuplicateReport> {
    // Stage 1: group by size; a file with a unique size cannot have a duplicate.
    progress.begin(0, 0);
    let mut by_size: HashMap<u64, Vec<u32>> = HashMap::new();
    for id in tree.file_ids(opts.scope) {
        let n = tree.node(id);
        if n.is_symlink() || !n.is_accessible() || n.size == 0 || n.size < opts.min_size {
            continue;
        }
        by_size.entry(n.size).or_default().push(id);
    }
    by_size.retain(|_, ids| ids.len() > 1);
    let candidates: Vec<(u32, u64)> =
        by_size.iter().flat_map(|(&size, ids)| ids.iter().map(move |&id| (id, size))).collect();
    let candidate_files = candidates.len() as u64;

    // Stage 2: hash the first 4 KiB.
    progress.begin(1, candidates.len() as u64);
    let partial: Vec<(u64, [u8; 32], u32)> = pool.install(|| {
        candidates
            .par_iter()
            .filter_map(|&(id, size)| {
                if cancel.load(Ordering::Relaxed) {
                    return None;
                }
                let path = tree.path_of(id);
                progress.touch(&path);
                match hash_prefix(&path, size) {
                    Ok(h) => Some((size, h, id)),
                    Err(_) => {
                        progress.skipped.fetch_add(1, Ordering::Relaxed);
                        None
                    }
                }
            })
            .collect()
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    let mut by_partial: HashMap<(u64, [u8; 32]), Vec<u32>> = HashMap::new();
    for (size, hash, id) in partial {
        by_partial.entry((size, hash)).or_default().push(id);
    }
    by_partial.retain(|_, ids| ids.len() > 1);
    let survivors: Vec<(u32, u64)> =
        by_partial.iter().flat_map(|(&(size, _), ids)| ids.iter().map(move |&id| (id, size))).collect();

    // Stage 3: full streamed hash of everything that is still ambiguous.
    progress.begin(2, survivors.len() as u64);
    let full: Vec<(u64, [u8; 32], u32)> = pool.install(|| {
        survivors
            .par_iter()
            .filter_map(|&(id, size)| {
                if cancel.load(Ordering::Relaxed) {
                    return None;
                }
                let path = tree.path_of(id);
                progress.touch(&path);
                match hash_file(&path, size, cancel) {
                    Ok(Some(h)) => Some((size, h, id)),
                    Ok(None) => {
                        if !cancel.load(Ordering::Relaxed) {
                            progress.skipped.fetch_add(1, Ordering::Relaxed);
                        }
                        None
                    }
                    Err(_) => {
                        progress.skipped.fetch_add(1, Ordering::Relaxed);
                        None
                    }
                }
            })
            .collect()
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }

    progress.begin(3, 0);
    let mut by_full: HashMap<(u64, [u8; 32]), Vec<u32>> = HashMap::new();
    for (size, hash, id) in full {
        by_full.entry((size, hash)).or_default().push(id);
    }
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for ((size, hash), ids) in by_full {
        let mut seen = std::collections::HashSet::new();
        let mut files = Vec::new();
        for id in ids {
            let path = tree.path_of(id);
            if let Some(identity) = identity(&path) {
                if !seen.insert(identity) {
                    continue;
                }
            }
            let n = tree.node(id);
            files.push(DuplicateFile {
                node_id: id,
                path: path.display().to_string(),
                modified: (n.modified != 0).then_some(n.modified),
                allocated: n.allocated,
            });
        }
        if files.len() < 2 {
            continue;
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        groups.push(DuplicateGroup {
            id: 0,
            hash: to_hex(&hash),
            size,
            wasted: size * (files.len() as u64 - 1),
            files,
        });
    }
    groups.sort_by(|a, b| b.wasted.cmp(&a.wasted).then_with(|| a.hash.cmp(&b.hash)));
    for (i, g) in groups.iter_mut().enumerate() {
        g.id = i as u32;
    }
    let summary = DuplicateSummary {
        groups_count: groups.len() as u32,
        files_in_groups: groups.iter().map(|g| g.files.len() as u32).sum(),
        wasted_bytes: groups.iter().map(|g| g.wasted).sum(),
        candidate_files,
        skipped_files: 0,
        elapsed_ms: 0,
    };
    Ok(DuplicateReport { summary, groups })
}

impl DuplicateReport {
    /// Drop files that no longer exist (for example after being moved to the Trash) and recompute totals.
    pub fn prune(&mut self, is_live: impl Fn(u32) -> bool) {
        for g in &mut self.groups {
            g.files.retain(|f| is_live(f.node_id));
            g.wasted = g.size * (g.files.len() as u64).saturating_sub(1);
        }
        self.groups.retain(|g| g.files.len() > 1);
        self.groups.sort_by(|a, b| b.wasted.cmp(&a.wasted).then_with(|| a.hash.cmp(&b.hash)));
        for (i, g) in self.groups.iter_mut().enumerate() {
            g.id = i as u32;
        }
        self.summary.groups_count = self.groups.len() as u32;
        self.summary.files_in_groups = self.groups.iter().map(|g| g.files.len() as u32).sum();
        self.summary.wasted_bytes = self.groups.iter().map(|g| g.wasted).sum();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ScanOptions;
    use crate::scanner::scan;
    use std::sync::Arc;

    fn tree_of(dir: &Path) -> ScanTree {
        scan(
            &ScanOptions { root: dir.to_path_buf(), threads: 2, cross_filesystems: true },
            Arc::new(AtomicBool::new(false)),
            &|_| {},
        )
        .unwrap()
    }

    fn opts(min_size: u64) -> DuplicateOptions {
        DuplicateOptions { min_size, scope: None, threads: 2 }
    }

    fn find(tree: &ScanTree, o: &DuplicateOptions) -> DuplicateReport {
        find_duplicates(tree, o, &AtomicBool::new(false), &|_| {}).unwrap()
    }

    #[test]
    fn identical_contents_are_grouped_and_waste_is_counted() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a")).unwrap();
        fs::create_dir_all(dir.path().join("b")).unwrap();
        let data = vec![42u8; 10_000];
        fs::write(dir.path().join("a/one.bin"), &data).unwrap();
        fs::write(dir.path().join("b/two.bin"), &data).unwrap();
        fs::write(dir.path().join("b/three.bin"), &data).unwrap();
        fs::write(dir.path().join("unique.bin"), vec![1u8; 10_000]).unwrap();
        let report = find(&tree_of(dir.path()), &opts(1));
        assert_eq!(report.groups.len(), 1);
        assert_eq!(report.groups[0].files.len(), 3);
        assert_eq!(report.groups[0].wasted, 20_000);
        assert_eq!(report.summary.wasted_bytes, 20_000);
    }

    #[test]
    fn same_name_or_same_size_alone_is_not_enough() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("x")).unwrap();
        fs::write(dir.path().join("report.txt"), vec![1u8; 5000]).unwrap();
        fs::write(dir.path().join("x/report.txt"), vec![2u8; 5000]).unwrap();
        assert!(find(&tree_of(dir.path()), &opts(1)).groups.is_empty());
    }

    #[test]
    fn identical_first_4k_but_different_tail_is_rejected_by_the_full_hash() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = vec![9u8; 20_000];
        let mut b = a.clone();
        a[19_999] = 1;
        b[19_999] = 2;
        fs::write(dir.path().join("a.bin"), &a).unwrap();
        fs::write(dir.path().join("b.bin"), &b).unwrap();
        let tree = tree_of(dir.path());
        let report = find(&tree, &opts(1));
        assert!(report.groups.is_empty());
        assert_eq!(report.summary.candidate_files, 2, "both passed the size stage");
    }

    #[test]
    fn small_and_empty_files_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("e1"), b"").unwrap();
        fs::write(dir.path().join("e2"), b"").unwrap();
        fs::write(dir.path().join("s1"), b"tiny").unwrap();
        fs::write(dir.path().join("s2"), b"tiny").unwrap();
        let tree = tree_of(dir.path());
        assert!(find(&tree, &opts(1)).groups.len() == 1, "only the 4-byte pair qualifies");
        assert!(find(&tree, &opts(100)).groups.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_are_not_reported_as_wasted_space() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("orig.bin"), vec![3u8; 8000]).unwrap();
        fs::hard_link(dir.path().join("orig.bin"), dir.path().join("link.bin")).unwrap();
        assert!(find(&tree_of(dir.path()), &opts(1)).groups.is_empty());
    }

    #[test]
    fn hashing_matches_reference_and_detects_length_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.bin");
        let data: Vec<u8> = (0..600_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&path, &data).unwrap();
        let cancel = AtomicBool::new(false);
        let got = hash_file(&path, data.len() as u64, &cancel).unwrap().unwrap();
        assert_eq!(got, *blake3::hash(&data).as_bytes());
        assert!(hash_file(&path, data.len() as u64 + 1, &cancel).unwrap().is_none());
        assert_eq!(hash_prefix(&path, data.len() as u64).unwrap(), *blake3::hash(&data[..PARTIAL_BYTES]).as_bytes());
        assert!(hash_file(&dir.path().join("missing"), 1, &cancel).is_err());
        cancel.store(true, Ordering::Relaxed);
        assert!(hash_file(&path, data.len() as u64, &cancel).unwrap().is_none());
    }

    #[test]
    fn cancellation_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a"), vec![1u8; 100]).unwrap();
        fs::write(dir.path().join("b"), vec![1u8; 100]).unwrap();
        let tree = tree_of(dir.path());
        let r = find_duplicates(&tree, &opts(1), &AtomicBool::new(true), &|_| {});
        assert!(matches!(r, Err(CoreError::Cancelled)));
    }

    #[test]
    fn pruning_after_a_delete_recomputes_waste_and_drops_singletons() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.bin", "b.bin", "c.bin"] {
            fs::write(dir.path().join(name), vec![1u8; 10_000]).unwrap();
        }
        let mut report = find(&tree_of(dir.path()), &opts(1));
        assert_eq!(report.summary.wasted_bytes, 20_000);
        let ids: Vec<u32> = report.groups[0].files.iter().map(|f| f.node_id).collect();
        report.prune(|id| id != ids[0]);
        assert_eq!((report.summary.groups_count, report.summary.wasted_bytes), (1, 10_000));
        assert_eq!(report.summary.files_in_groups, 2);
        report.prune(|id| id == ids[2]);
        assert!(report.groups.is_empty());
        assert_eq!(report.summary.wasted_bytes, 0);
    }
}
