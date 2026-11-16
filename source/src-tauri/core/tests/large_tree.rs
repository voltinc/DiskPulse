//! Scale check: scan and query a tree with more than half a million files.
//!
//! Ignored by default because it creates that many files on disk. Run it with:
//!   cargo test --release -p diskpulse-core --test large_tree -- --ignored --nocapture
//! Set DISKPULSE_BENCH_DIR to choose where the files are created and DISKPULSE_BENCH_DIRS to change the size
//! (the tree has DIRS x 10 x 100 files; the default of 520 gives 520,000 files).

use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use diskpulse_core::models::{ScanOptions, SortDir, SortKey};
use diskpulse_core::scanner::scan;
use diskpulse_core::storage;
use diskpulse_core::treemap::{layout, Metric};

fn peak_rss_mb() -> u64 {
    fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmHWM:")).map(str::to_owned))
        .and_then(|l| l.split_whitespace().nth(1).and_then(|v| v.parse::<u64>().ok()))
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

#[test]
#[ignore = "creates ~520,000 files"]
fn scans_and_queries_half_a_million_files() {
    let base = std::env::var("DISKPULSE_BENCH_DIR").unwrap_or_else(|_| "/tmp".into());
    let top: usize = std::env::var("DISKPULSE_BENCH_DIRS").ok().and_then(|v| v.parse().ok()).unwrap_or(520);
    let dir = tempfile::tempdir_in(base).unwrap();

    let t = Instant::now();
    for a in 0..top {
        for b in 0..10 {
            let sub = dir.path().join(format!("d{a}/s{b}"));
            fs::create_dir_all(&sub).unwrap();
            for c in 0..100usize {
                let size = if c == 0 { 4096 * (1 + (a + b) % 9) } else { 1 + c % 7 };
                fs::write(sub.join(format!("f{c}.dat")), vec![b'x'; size]).unwrap();
            }
        }
    }
    let files = top * 10 * 100;
    println!("created {files} files in {:.1?}", t.elapsed());

    let opts = ScanOptions { root: dir.path().to_path_buf(), threads: 0, cross_filesystems: true };
    let t = Instant::now();
    let tree = scan(&opts, Arc::new(AtomicBool::new(false)), &|_| {}).unwrap();
    println!("scan: {:.2?} ({} nodes), peak RSS {} MB", t.elapsed(), tree.len(), peak_rss_mb());
    assert_eq!(tree.node(0).file_count as usize, files);

    let t = Instant::now();
    let page = tree.children_page(0, 0, 400, SortKey::Size, SortDir::Desc, None).unwrap();
    println!("root children page (400 of {}): {:.2?}", page.total, t.elapsed());
    let t = Instant::now();
    let page = tree.children_page(0, 0, 400, SortKey::Name, SortDir::Asc, None).unwrap();
    println!("root children sorted by name: {:.2?} ({} items)", t.elapsed(), page.items.len());
    let t = Instant::now();
    let top100 = tree.largest_files(None, 100);
    println!("top 100 largest: {:.2?}", t.elapsed());
    assert_eq!(top100.len(), 100);
    let t = Instant::now();
    let rects = layout(&tree, 0, 1200.0, 700.0, 2, Metric::Logical).unwrap();
    println!("treemap layout: {:.2?} ({} rects)", t.elapsed(), rects.len());
    let t = Instant::now();
    let b = storage::breakdown(&tree, None);
    println!("breakdown: {:.2?} ({} files)", t.elapsed(), b.total_files);
    let t = Instant::now();
    let hits = tree.search("f99.dat", None, 300);
    println!("name search: {:.2?} ({} hits)", t.elapsed(), hits.len());
}
