use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Sentinel parent id used by the root node.
pub const NO_PARENT: u32 = u32::MAX;
pub const FLAG_SYMLINK: u8 = 1;
pub const FLAG_INACCESSIBLE: u8 = 2;
pub const FLAG_REMOVED: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Directory,
}

/// Compact in-memory node. Full paths are *not* stored; they are rebuilt from
/// the parent chain on demand, which keeps 500k+ node scans small.
#[derive(Debug, Clone)]
pub struct Node {
    pub parent: u32,
    pub name: Box<str>,
    pub kind: NodeKind,
    pub flags: u8,
    /// Dominant file category (see `storage::CATEGORIES`), computed for directories.
    pub dominant: u8,
    /// Logical size in bytes (what the file reports). For directories: sum of children.
    pub size: u64,
    /// Allocated size in bytes (space actually reserved on disk). For directories: sum of children.
    pub allocated: u64,
    pub file_count: u32,
    pub dir_count: u32,
    /// Unix seconds, 0 when unknown.
    pub modified: i64,
}

impl Node {
    pub fn new_file(parent: u32, name: Box<str>, size: u64, allocated: u64, modified: i64, flags: u8) -> Self {
        Node {
            parent,
            name,
            kind: NodeKind::File,
            flags,
            dominant: 0,
            size,
            allocated,
            file_count: 1,
            dir_count: 0,
            modified,
        }
    }
    pub fn new_dir(parent: u32, name: Box<str>, modified: i64, flags: u8) -> Self {
        Node {
            parent,
            name,
            kind: NodeKind::Directory,
            flags,
            dominant: 0,
            size: 0,
            allocated: 0,
            file_count: 0,
            dir_count: 0,
            modified,
        }
    }
    pub fn placeholder() -> Self {
        Node::new_file(NO_PARENT, Box::from(""), 0, 0, 0, FLAG_REMOVED)
    }
    pub fn is_symlink(&self) -> bool {
        self.flags & FLAG_SYMLINK != 0
    }
    pub fn is_accessible(&self) -> bool {
        self.flags & FLAG_INACCESSIBLE == 0
    }
    pub fn is_removed(&self) -> bool {
        self.flags & FLAG_REMOVED != 0
    }
}

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub root: PathBuf,
    /// 0 = choose automatically.
    pub threads: usize,
    /// When false (default) directories on other filesystems are listed but not entered.
    pub cross_filesystems: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProgressSnapshot {
    pub scanned_count: u64,
    pub directories_scanned: u64,
    pub files_scanned: u64,
    pub bytes_processed: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
    pub errors_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanIssue {
    pub path: String,
    pub message: String,
}

/// Compact summary of one node, sent to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct NodeSummary {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub kind: NodeKind,
    pub size: u64,
    pub allocated: u64,
    pub file_count: u32,
    pub dir_count: u32,
    pub modified: Option<i64>,
    pub extension: Option<String>,
    pub category: u8,
    pub is_symlink: bool,
    pub accessible: bool,
    pub child_count: u32,
    pub percent_of_parent: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChildrenPage {
    pub total: u32,
    pub items: Vec<NodeSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanSummary {
    pub scan_id: String,
    pub root: NodeSummary,
    pub started_at: i64,
    pub finished_at: i64,
    pub duration_ms: u64,
    pub total_size: u64,
    pub total_allocated: u64,
    pub file_count: u32,
    pub dir_count: u32,
    pub errors_count: u64,
    pub issues: Vec<ScanIssue>,
    pub stayed_on_filesystem: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    Name,
    Type,
    Size,
    Allocated,
    Files,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub id: String,
    pub root_path: String,
    pub started_at: i64,
    pub duration_ms: u64,
    pub total_size: u64,
    pub total_allocated: u64,
    pub file_count: u32,
    pub dir_count: u32,
    pub errors_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// 0 = automatic.
    pub threads: u32,
    pub stay_on_filesystem: bool,
    pub min_duplicate_size: u64,
    /// "windows" (1024-based, GB label), "decimal" (1000-based, GB) or "iec" (1024-based, GiB).
    pub units: String,
    pub treemap_depth: u8,
    /// "logical" or "allocated".
    pub treemap_metric: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            threads: 0,
            stay_on_filesystem: true,
            min_duplicate_size: 1024 * 1024,
            units: "windows".into(),
            treemap_depth: 2,
            treemap_metric: "logical".into(),
        }
    }
}

impl Settings {
    /// Clamp every field into its supported range so a hand-edited file cannot break the app.
    pub fn sanitized(mut self) -> Self {
        self.threads = self.threads.min(64);
        self.treemap_depth = self.treemap_depth.clamp(1, 3);
        if !["windows", "decimal", "iec"].contains(&self.units.as_str()) {
            self.units = "windows".into();
        }
        if !["logical", "allocated"].contains(&self.treemap_metric.as_str()) {
            self.treemap_metric = "logical".into();
        }
        self
    }
}
