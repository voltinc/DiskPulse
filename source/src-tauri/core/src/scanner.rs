//! Parallel filesystem scanner.
//!
//! Work distribution: every directory is one task on a bounded rayon pool. A task lists its
//! directory, stats each entry, ships the resulting nodes to a collector channel in one batch and
//! spawns a task per sub-directory. Rayon's per-thread deques run local work depth-first, so the
//! number of queued directories stays small even for very wide trees, and the pool size bounds
//! concurrency. Counters are atomics; a reporter thread samples them every 100 ms.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::errors::{CoreError, Result};
use crate::filesystem;
use crate::models::*;
use crate::tree::ScanTree;

const MAX_ISSUES: usize = 500;
const FLUSH_EVERY: u64 = 256;

type Batch = Vec<(u32, Node)>;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn system_time_secs(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    }
}

pub fn now_secs() -> i64 {
    system_time_secs(SystemTime::now())
}

struct Shared {
    cancel: Arc<AtomicBool>,
    next_id: AtomicU32,
    scanned: AtomicU64,
    dirs: AtomicU64,
    files: AtomicU64,
    bytes: AtomicU64,
    errors: AtomicU64,
    current: Mutex<String>,
    issues: Mutex<Vec<ScanIssue>>,
    inaccessible: Mutex<Vec<u32>>,
    tx: Sender<Batch>,
    cross_fs: bool,
    root_dev: Option<u64>,
    cluster: u64,
}

impl Shared {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn record_issue(&self, path: &Path, err: &io::Error, inaccessible_dir: Option<u32>) {
        self.errors.fetch_add(1, Ordering::Relaxed);
        if let Some(id) = inaccessible_dir {
            lock(&self.inaccessible).push(id);
        }
        let mut issues = lock(&self.issues);
        if issues.len() < MAX_ISSUES {
            issues.push(ScanIssue { path: path.display().to_string(), message: err.to_string() });
        }
    }

    fn snapshot(&self, started: &Instant) -> ProgressSnapshot {
        ProgressSnapshot {
            scanned_count: self.scanned.load(Ordering::Relaxed),
            directories_scanned: self.dirs.load(Ordering::Relaxed),
            files_scanned: self.files.load(Ordering::Relaxed),
            bytes_processed: self.bytes.load(Ordering::Relaxed),
            current_path: lock(&self.current).clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            errors_count: self.errors.load(Ordering::Relaxed),
        }
    }
}

#[derive(Default)]
struct Local {
    scanned: u64,
    dirs: u64,
    files: u64,
    bytes: u64,
}

impl Local {
    fn flush(&mut self, sh: &Shared) {
        sh.scanned.fetch_add(self.scanned, Ordering::Relaxed);
        sh.dirs.fetch_add(self.dirs, Ordering::Relaxed);
        sh.files.fetch_add(self.files, Ordering::Relaxed);
        sh.bytes.fetch_add(self.bytes, Ordering::Relaxed);
        *self = Local::default();
    }
}

fn walk<'s>(scope: &rayon::Scope<'s>, sh: &'s Shared, dir_id: u32, dir: PathBuf) {
    if sh.cancelled() {
        return;
    }
    if let Ok(mut cur) = sh.current.try_lock() {
        cur.clear();
        cur.push_str(&dir.to_string_lossy());
    }
    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => {
            sh.record_issue(&dir, &e, Some(dir_id));
            return;
        }
    };
    let mut batch: Batch = Vec::new();
    let mut subdirs: Vec<(u32, PathBuf)> = Vec::new();
    let mut local = Local::default();

    for entry in read {
        if sh.cancelled() {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                sh.record_issue(&dir, &e, None);
                continue;
            }
        };
        let md = match entry.metadata() {
            Ok(m) => m,
            // The entry vanished between listing and stat: not an error.
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => {
                sh.record_issue(&entry.path(), &e, None);
                continue;
            }
        };
        let name: Box<str> = entry.file_name().to_string_lossy().into_owned().into_boxed_str();
        let file_type = md.file_type();
        let is_symlink = file_type.is_symlink();
        let flags = if is_symlink { FLAG_SYMLINK } else { 0 };
        let modified = md.modified().map(system_time_secs).unwrap_or(0);
        let id = sh.next_id.fetch_add(1, Ordering::Relaxed);
        local.scanned += 1;

        if file_type.is_dir() && !is_symlink {
            local.dirs += 1;
            let child = entry.path();
            let same_fs = match (sh.root_dev, filesystem::device_of(&md)) {
                (Some(root), Some(dev)) => root == dev,
                _ => true,
            };
            let descend = (sh.cross_fs || same_fs) && !filesystem::is_virtual_path(&child);
            batch.push((id, Node::new_dir(dir_id, name, modified, flags)));
            if descend {
                subdirs.push((id, child));
            }
        } else {
            // Symlinks are recorded as leaf entries and never followed.
            let size = md.len();
            let allocated = filesystem::allocated_size(&md, || entry.path(), sh.cluster);
            local.files += 1;
            local.bytes += size;
            batch.push((id, Node::new_file(dir_id, name, size, allocated, modified, flags)));
        }
        if local.scanned >= FLUSH_EVERY {
            local.flush(sh);
        }
    }
    local.flush(sh);
    let _ = sh.tx.send(batch);
    for (id, path) in subdirs {
        scope.spawn(move |s| walk(s, sh, id, path));
    }
}

fn default_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (cores * 2).clamp(4, 32)
}

/// Scan `opts.root`. Blocks the calling thread; call it from a worker thread.
/// `on_progress` is invoked from a reporter thread roughly every 100 ms and once more at the end.
pub fn scan(
    opts: &ScanOptions,
    cancel: Arc<AtomicBool>,
    on_progress: &(dyn Fn(ProgressSnapshot) + Sync),
) -> Result<ScanTree> {
    let root = filesystem::validate_dir_path(&opts.root)?;
    fs::read_dir(&root).map_err(|e| CoreError::io(&root, e))?;
    let root_md = fs::metadata(&root).map_err(|e| CoreError::io(&root, e))?;

    let threads = if opts.threads == 0 { default_threads() } else { opts.threads.clamp(1, 64) };
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|i| format!("diskpulse-scan-{i}"))
        .build()
        .map_err(|e| CoreError::Invalid(format!("could not start worker threads: {e}")))?;

    let started = Instant::now();
    let started_at = now_secs();
    let (tx, rx) = channel::<Batch>();
    let shared = Shared {
        cancel: cancel.clone(),
        next_id: AtomicU32::new(1),
        scanned: AtomicU64::new(0),
        dirs: AtomicU64::new(0),
        files: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        errors: AtomicU64::new(0),
        current: Mutex::new(root.to_string_lossy().into_owned()),
        issues: Mutex::new(Vec::new()),
        inaccessible: Mutex::new(Vec::new()),
        tx,
        cross_fs: opts.cross_filesystems,
        root_dev: filesystem::device_of(&root_md),
        cluster: filesystem::cluster_size(&root),
    };

    let done = AtomicBool::new(false);
    std::thread::scope(|ts| {
        let reporter = ts.spawn(|| {
            while !done.load(Ordering::Acquire) {
                std::thread::park_timeout(Duration::from_millis(100));
                if done.load(Ordering::Acquire) {
                    break;
                }
                on_progress(shared.snapshot(&started));
            }
        });
        pool.scope(|s| walk(s, &shared, 0, root.clone()));
        done.store(true, Ordering::Release);
        reporter.thread().unpark();
    });

    if cancel.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    on_progress(shared.snapshot(&started));

    let n = shared.next_id.load(Ordering::Relaxed) as usize;
    let mut nodes: Vec<Node> = Vec::with_capacity(n);
    nodes.resize_with(n, Node::placeholder);
    let root_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    nodes[0] =
        Node::new_dir(NO_PARENT, root_name.into_boxed_str(), root_md.modified().map(system_time_secs).unwrap_or(0), 0);
    for batch in rx.try_iter() {
        for (id, node) in batch {
            if let Some(slot) = nodes.get_mut(id as usize) {
                *slot = node;
            }
        }
    }
    for id in lock(&shared.inaccessible).iter() {
        if let Some(n) = nodes.get_mut(*id as usize) {
            n.flags |= FLAG_INACCESSIBLE;
        }
    }

    let mut tree = ScanTree::from_nodes(root, nodes);
    tree.started_at = started_at;
    tree.duration_ms = started.elapsed().as_millis() as u64;
    tree.errors_count = shared.errors.load(Ordering::Relaxed);
    tree.issues = std::mem::take(&mut *lock(&shared.issues));
    tree.stayed_on_filesystem = !opts.cross_filesystems;
    Ok(tree)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex as StdMutex;

    fn write(path: &Path, bytes: usize) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::File::create(path).unwrap().write_all(&vec![7u8; bytes]).unwrap();
    }

    fn options(root: &Path) -> ScanOptions {
        ScanOptions { root: root.to_path_buf(), threads: 4, cross_filesystems: true }
    }

    fn run(root: &Path) -> Result<ScanTree> {
        scan(&options(root), Arc::new(AtomicBool::new(false)), &|_| {})
    }

    fn find(tree: &ScanTree, name: &str) -> u32 {
        (0..tree.len() as u32).find(|&i| &*tree.node(i).name == name).unwrap()
    }

    #[test]
    fn sums_logical_sizes_and_counts_files_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("a.bin"), 1000);
        write(&dir.path().join("sub/b.bin"), 2000);
        write(&dir.path().join("sub/deep/c.bin"), 4000);
        fs::create_dir_all(dir.path().join("empty")).unwrap();
        let tree = run(dir.path()).unwrap();
        let root = tree.node(0);
        assert_eq!(root.size, 7000);
        assert_eq!(root.file_count, 3);
        assert_eq!(root.dir_count, 3);
        let sub = tree.node(find(&tree, "sub"));
        assert_eq!((sub.size, sub.file_count, sub.dir_count), (6000, 2, 1));
        assert_eq!(tree.node(find(&tree, "empty")).size, 0);
        #[cfg(unix)]
        assert!(tree.node(find(&tree, "c.bin")).allocated >= 4000 || tree.node(find(&tree, "c.bin")).allocated > 0);
    }

    #[test]
    fn children_are_sorted_largest_first_and_paths_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("small.txt"), 10);
        write(&dir.path().join("big.txt"), 5000);
        let tree = run(dir.path()).unwrap();
        let kids: Vec<&str> = tree.live_children(0).map(|c| &*tree.node(c).name).collect();
        assert_eq!(kids, vec!["big.txt", "small.txt"]);
        assert_eq!(tree.path_of(find(&tree, "big.txt")), dir.path().join("big.txt"));
    }

    #[test]
    fn rejects_missing_and_relative_roots() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(run(&dir.path().join("nope")), Err(CoreError::InvalidPath(_))));
        assert!(matches!(run(Path::new("relative")), Err(CoreError::InvalidPath(_))));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_never_followed_and_loops_terminate() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("real/data.bin"), 500);
        symlink(dir.path().join("real"), dir.path().join("real/loop")).unwrap();
        symlink(dir.path().join("real"), dir.path().join("link-to-real")).unwrap();
        let tree = run(dir.path()).unwrap();
        assert_eq!(tree.node(0).file_count, 3, "data.bin plus two links");
        let link = tree.node(find(&tree, "link-to-real"));
        assert!(link.is_symlink());
        assert_eq!(link.kind, NodeKind::File);
        assert!(tree.node(0).size < 1000, "the linked folder must not be counted twice");
    }

    #[test]
    fn a_cancelled_scan_returns_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            write(&dir.path().join(format!("d{i}/f.bin")), 10);
        }
        let result = scan(&options(dir.path()), Arc::new(AtomicBool::new(true)), &|_| {});
        assert!(matches!(result, Err(CoreError::Cancelled)));
    }

    #[test]
    fn cancelling_while_running_stops_new_work() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..200 {
            write(&dir.path().join(format!("d{i}/e{}/f.bin", i % 7)), 10);
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let flipper = cancel.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1));
            flipper.store(true, Ordering::Relaxed);
        });
        let result = scan(&options(dir.path()), cancel, &|_| {});
        handle.join().unwrap();
        // Either the scan finished before the flag flipped or it reported cancellation; it must never hang or panic.
        assert!(result.is_ok() || matches!(result, Err(CoreError::Cancelled)));
    }

    #[test]
    fn progress_callback_receives_final_totals() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..30 {
            write(&dir.path().join(format!("f{i}.bin")), 100);
        }
        let last = StdMutex::new(ProgressSnapshot::default());
        scan(&options(dir.path()), Arc::new(AtomicBool::new(false)), &|p| *last.lock().unwrap() = p).unwrap();
        let p = last.lock().unwrap().clone();
        assert_eq!(p.files_scanned, 30);
        assert_eq!(p.bytes_processed, 3000);
        assert_eq!(p.errors_count, 0);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folders_are_reported_without_failing_the_scan() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("ok.bin"), 10);
        let locked = dir.path().join("locked");
        write(&locked.join("secret.bin"), 10);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let still_readable = fs::read_dir(&locked).is_ok(); // running as root
        let tree = run(dir.path()).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if !still_readable {
            assert_eq!(tree.errors_count, 1);
            assert!(!tree.node(find(&tree, "locked")).is_accessible());
            assert_eq!(tree.issues.len(), 1);
        }
        assert_eq!(tree.node(find(&tree, "ok.bin")).size, 10);
    }

    #[test]
    fn removing_a_node_updates_every_ancestor() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("a/b/one.bin"), 100);
        write(&dir.path().join("a/two.bin"), 50);
        let mut tree = run(dir.path()).unwrap();
        let b = find(&tree, "b");
        let (freed, _) = tree.remove_node(b).unwrap();
        assert_eq!(freed, 100);
        let a = tree.node(find(&tree, "a"));
        assert_eq!((a.size, a.file_count, a.dir_count), (50, 1, 0));
        assert_eq!(tree.node(0).size, 50);
        assert!(tree.get(b).is_none());
        assert!(tree.remove_node(b).is_err());
        assert!(tree.remove_node(0).is_err());
        assert_eq!(tree.file_ids(None).len(), 1);
    }

    #[test]
    fn largest_files_uses_a_bounded_top_k() {
        let dir = tempfile::tempdir().unwrap();
        for i in 1..=10usize {
            write(&dir.path().join(format!("f{i}.bin")), i * 100);
        }
        let tree = run(dir.path()).unwrap();
        let top: Vec<u64> = tree.largest_files(None, 3).into_iter().map(|id| tree.node(id).size).collect();
        assert_eq!(top, vec![1000, 900, 800]);
    }

    #[test]
    fn search_and_paging_filter_by_name() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("Report-2024.pdf"), 30);
        write(&dir.path().join("notes/report-draft.txt"), 20);
        write(&dir.path().join("photo.jpg"), 10);
        let tree = run(dir.path()).unwrap();
        assert_eq!(tree.search("REPORT", None, 10).len(), 2);
        let page = tree.children_page(0, 0, 10, SortKey::Name, SortDir::Asc, Some("photo")).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].name, "photo.jpg");
    }
}
