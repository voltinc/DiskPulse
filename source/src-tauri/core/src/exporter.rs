//! CSV and JSON report export. Output is streamed straight into a buffered file writer.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::duplicates::{DuplicateGroup, DuplicateReport, DuplicateSummary};
use crate::errors::{CoreError, Result};
use crate::storage::{self, CategoryStat, ExtensionStat, CATEGORIES};
use crate::tree::ScanTree;

const LARGEST_FILES: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportFormat {
    Csv,
    Json,
}

/// `YYYY-MM-DDTHH:MM:SSZ` for a Unix timestamp (civil-from-days, no time-zone database needed).
pub fn iso8601_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn validate_destination(dest: &Path, format: ReportFormat) -> Result<()> {
    if !dest.is_absolute() {
        return Err(CoreError::Export("the destination must be an absolute path".into()));
    }
    if dest.is_dir() {
        return Err(CoreError::Export("the destination is a folder, not a file".into()));
    }
    let wanted = if format == ReportFormat::Csv { "csv" } else { "json" };
    let ok = dest.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(wanted));
    if !ok {
        return Err(CoreError::Export(format!("the file name must end in .{wanted}")));
    }
    match dest.parent() {
        Some(p) if p.is_dir() => Ok(()),
        _ => Err(CoreError::Export("the destination folder does not exist".into())),
    }
}

#[derive(Serialize)]
struct ScanMeta {
    location: String,
    scanned_at: String,
    duration_ms: u64,
    total_logical_size_bytes: u64,
    total_allocated_size_bytes: u64,
    file_count: u32,
    directory_count: u32,
    errors: u64,
    stayed_on_filesystem: bool,
}

#[derive(Serialize)]
struct FileRow {
    name: String,
    path: String,
    size_bytes: u64,
    allocated_bytes: u64,
    category: &'static str,
    modified: Option<String>,
}

#[derive(Serialize)]
struct Duplicates<'a> {
    summary: &'a DuplicateSummary,
    groups: &'a [DuplicateGroup],
}

#[derive(Serialize)]
struct JsonReport<'a> {
    generator: &'static str,
    format_version: u32,
    scan: ScanMeta,
    largest_files: Vec<FileRow>,
    categories: Vec<CategoryStat>,
    extensions: Vec<ExtensionStat>,
    duplicates: Option<Duplicates<'a>>,
}

fn file_rows(tree: &ScanTree) -> Vec<FileRow> {
    tree.largest_files(None, LARGEST_FILES)
        .into_iter()
        .map(|id| {
            let n = tree.node(id);
            FileRow {
                name: n.name.to_string(),
                path: tree.path_of(id).display().to_string(),
                size_bytes: n.size,
                allocated_bytes: n.allocated,
                category: CATEGORIES[storage::category_of(storage::extension_of(&n.name)) as usize],
                modified: (n.modified != 0).then(|| iso8601_utc(n.modified)),
            }
        })
        .collect()
}

fn meta(tree: &ScanTree, location: String) -> ScanMeta {
    let root = tree.node(0);
    ScanMeta {
        location,
        scanned_at: iso8601_utc(tree.started_at),
        duration_ms: tree.duration_ms,
        total_logical_size_bytes: root.size,
        total_allocated_size_bytes: root.allocated,
        file_count: root.file_count,
        directory_count: root.dir_count,
        errors: tree.errors_count,
        stayed_on_filesystem: tree.stayed_on_filesystem,
    }
}

/// Write a report for `tree` (and optionally a finished duplicate scan) to `dest`.
pub fn export_report(
    tree: &ScanTree,
    duplicates: Option<&DuplicateReport>,
    format: ReportFormat,
    dest: &Path,
) -> Result<()> {
    validate_destination(dest, format)?;
    let file = File::create(dest).map_err(|e| CoreError::Export(format!("{}: {e}", dest.display())))?;
    let mut out = BufWriter::new(file);
    match format {
        ReportFormat::Json => write_json(tree, duplicates, &mut out)?,
        ReportFormat::Csv => write_csv(tree, duplicates, &mut out)?,
    }
    out.flush().map_err(|e| CoreError::Export(e.to_string()))
}

fn write_json(tree: &ScanTree, duplicates: Option<&DuplicateReport>, out: &mut impl Write) -> Result<()> {
    let location = tree.root_path.display().to_string();
    let breakdown = storage::breakdown(tree, None);
    let report = JsonReport {
        generator: "DiskPulse Pro",
        format_version: 1,
        scan: meta(tree, location),
        largest_files: file_rows(tree),
        categories: breakdown.categories,
        extensions: breakdown.extensions,
        duplicates: duplicates.map(|d| Duplicates { summary: &d.summary, groups: &d.groups }),
    };
    serde_json::to_writer_pretty(out, &report).map_err(|e| CoreError::Export(e.to_string()))
}

fn write_csv(tree: &ScanTree, duplicates: Option<&DuplicateReport>, out: &mut impl Write) -> Result<()> {
    let err = |e: csv::Error| CoreError::Export(e.to_string());
    let mut w = csv::WriterBuilder::new().flexible(true).from_writer(out);
    w.write_record(["section", "name", "path", "size_bytes", "allocated_bytes", "files", "modified_utc", "detail"])
        .map_err(err)?;
    let root = tree.node(0);
    let location = tree.root_path.display().to_string();
    let summary: [(&str, String); 8] = [
        ("scan_location", location.clone()),
        ("scanned_at", iso8601_utc(tree.started_at)),
        ("total_logical_size_bytes", root.size.to_string()),
        ("total_allocated_size_bytes", root.allocated.to_string()),
        ("file_count", root.file_count.to_string()),
        ("directory_count", root.dir_count.to_string()),
        ("errors", tree.errors_count.to_string()),
        ("duration_ms", tree.duration_ms.to_string()),
    ];
    for (key, value) in summary {
        w.write_record(["summary", key, "", "", "", "", "", &value]).map_err(err)?;
    }
    for row in file_rows(tree) {
        w.write_record([
            "largest_file",
            &row.name,
            &row.path,
            &row.size_bytes.to_string(),
            &row.allocated_bytes.to_string(),
            "1",
            row.modified.as_deref().unwrap_or(""),
            row.category,
        ])
        .map_err(err)?;
    }
    let breakdown = storage::breakdown(tree, None);
    for c in &breakdown.categories {
        w.write_record([
            "category",
            c.name,
            "",
            &c.size.to_string(),
            &c.allocated.to_string(),
            &c.files.to_string(),
            "",
            &format!("{:.2}%", c.percent),
        ])
        .map_err(err)?;
    }
    for e in &breakdown.extensions {
        w.write_record([
            "extension",
            &e.extension,
            "",
            &e.size.to_string(),
            "",
            &e.files.to_string(),
            "",
            CATEGORIES[e.category as usize],
        ])
        .map_err(err)?;
    }
    if let Some(report) = duplicates {
        for g in &report.groups {
            for f in &g.files {
                let name = Path::new(&f.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                w.write_record([
                    "duplicate",
                    &name,
                    &f.path,
                    &g.size.to_string(),
                    &f.allocated.to_string(),
                    "1",
                    &f.modified.map(iso8601_utc).unwrap_or_default(),
                    &format!("group {} blake3 {} wasted {}", g.id + 1, g.hash, g.wasted),
                ])
                .map_err(err)?;
            }
        }
    }
    w.flush().map_err(|e| CoreError::Export(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::duplicates::{find_duplicates, DuplicateOptions};
    use crate::models::ScanOptions;
    use crate::scanner::scan;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn fixture() -> (tempfile::TempDir, ScanTree, DuplicateReport) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/a.pdf"), vec![5u8; 6000]).unwrap();
        std::fs::write(dir.path().join("b.pdf"), vec![5u8; 6000]).unwrap();
        std::fs::write(dir.path().join("movie.mkv"), vec![1u8; 9000]).unwrap();
        let tree = scan(
            &ScanOptions { root: dir.path().to_path_buf(), threads: 2, cross_filesystems: true },
            Arc::new(AtomicBool::new(false)),
            &|_| {},
        )
        .unwrap();
        let dups = find_duplicates(
            &tree,
            &DuplicateOptions { min_size: 1, scope: None, threads: 2 },
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        (dir, tree, dups)
    }

    #[test]
    fn timestamps_format_as_iso_8601() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_utc(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn json_report_contains_every_required_section() {
        let (dir, tree, dups) = fixture();
        let dest = dir.path().join("report.json");
        export_report(&tree, Some(&dups), ReportFormat::Json, &dest).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&dest).unwrap()).unwrap();
        assert_eq!(v["generator"], "DiskPulse Pro");
        assert_eq!(v["scan"]["file_count"], 3);
        assert_eq!(v["scan"]["total_logical_size_bytes"], 21_000);
        assert_eq!(v["largest_files"][0]["name"], "movie.mkv");
        assert!(v["extensions"].as_array().unwrap().iter().any(|e| e["extension"] == "pdf"));
        assert_eq!(v["duplicates"]["summary"]["wasted_bytes"], 6000);
        assert_eq!(v["duplicates"]["groups"][0]["files"].as_array().unwrap().len(), 2);
        assert!(v["scan"]["location"].as_str().unwrap().starts_with('/') || cfg!(windows));
    }

    #[test]
    fn csv_report_is_sectioned_and_parseable() {
        let (dir, tree, dups) = fixture();
        let dest = dir.path().join("report.csv");
        export_report(&tree, Some(&dups), ReportFormat::Csv, &dest).unwrap();
        let mut reader = csv::ReaderBuilder::new().flexible(true).from_path(&dest).unwrap();
        let rows: Vec<csv::StringRecord> = reader.records().map(|r| r.unwrap()).collect();
        let count = |s: &str| rows.iter().filter(|r| &r[0] == s).count();
        assert_eq!(count("summary"), 8);
        assert_eq!(count("largest_file"), 3);
        assert_eq!(count("duplicate"), 2);
        assert!(count("category") >= 2 && count("extension") >= 2);
        let without = dir.path().join("plain.csv");
        export_report(&tree, None, ReportFormat::Csv, &without).unwrap();
        assert!(!std::fs::read_to_string(without).unwrap().contains("duplicate,"));
    }

    #[test]
    fn invalid_destinations_are_rejected() {
        let (dir, tree, _) = fixture();
        assert!(export_report(&tree, None, ReportFormat::Json, Path::new("report.json")).is_err());
        assert!(export_report(&tree, None, ReportFormat::Json, &dir.path().join("report.txt")).is_err());
        assert!(export_report(&tree, None, ReportFormat::Json, &dir.path().join("missing/report.json")).is_err());
        assert!(export_report(&tree, None, ReportFormat::Csv, dir.path()).is_err());
    }
}
