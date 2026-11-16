//! Storage analysis: file categories, extension statistics and category listings.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use serde::Serialize;

use crate::tree::ScanTree;

pub const CATEGORY_COUNT: usize = 9;
pub const CATEGORIES: [&str; CATEGORY_COUNT] =
    ["Videos", "Images", "Documents", "Archives", "Executables", "Audio", "Source code", "System files", "Other"];
pub const OTHER: u8 = 8;

/// Extension without the dot. Dotfiles (".gitignore") and trailing dots have no extension.
pub fn extension_of(name: &str) -> Option<&str> {
    let idx = name.rfind('.')?;
    if idx == 0 || idx + 1 == name.len() {
        return None;
    }
    Some(&name[idx + 1..])
}

/// Map an extension (any case) to an index into [`CATEGORIES`].
pub fn category_of(ext: Option<&str>) -> u8 {
    let Some(ext) = ext else { return OTHER };
    if ext.len() > 12 {
        return OTHER;
    }
    let mut buf = [0u8; 12];
    for (i, b) in ext.bytes().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    let Ok(lower) = std::str::from_utf8(&buf[..ext.len()]) else {
        return OTHER;
    };
    match lower {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpg" | "mpeg" | "3gp" | "vob" | "m2ts" => 0,
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "heic" | "heif" | "svg" | "ico" | "raw"
        | "cr2" | "nef" | "arw" | "dng" | "psd" | "avif" => 1,
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "rtf" | "odt" | "ods" | "odp" | "md"
        | "csv" | "epub" | "pages" | "numbers" | "key" => 2,
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" | "iso" | "img" | "dmg" | "cab" | "tgz" | "vhd"
        | "vhdx" | "vmdk" | "wim" | "esd" => 3,
        "exe" | "msi" | "bat" | "cmd" | "com" | "bin" | "appimage" | "apk" | "deb" | "rpm" | "pkg" | "jar" | "scr" => 4,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" | "mid" | "midi" => 5,
        "rs" | "c" | "h" | "cpp" | "hpp" | "cc" | "cs" | "java" | "py" | "js" | "jsx" | "ts" | "tsx" | "go" | "rb"
        | "php" | "swift" | "kt" | "html" | "css" | "scss" | "json" | "xml" | "yaml" | "yml" | "toml" | "sh"
        | "ps1" | "lua" | "sql" | "vue" | "svelte" | "dart" | "pyc" | "o" | "obj" | "rlib" | "class" => 6,
        "sys" | "dll" | "drv" | "ini" | "tmp" | "log" | "etl" | "mui" | "so" | "dylib" | "ko" | "pf" | "cat"
        | "mum" | "manifest" | "dat" | "db" | "lnk" => 7,
        _ => OTHER,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryStat {
    pub index: u8,
    pub name: &'static str,
    pub size: u64,
    pub allocated: u64,
    pub files: u64,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionStat {
    /// Lower-case extension, or "(none)" for files without one.
    pub extension: String,
    pub category: u8,
    pub size: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Breakdown {
    pub total_size: u64,
    pub total_files: u64,
    pub categories: Vec<CategoryStat>,
    pub extensions: Vec<ExtensionStat>,
}

/// Aggregate every live file below `scope` (whole scan when `None`).
pub fn breakdown(tree: &ScanTree, scope: Option<u32>) -> Breakdown {
    let mut cats = [(0u64, 0u64, 0u64); CATEGORY_COUNT];
    let mut exts: HashMap<String, (u64, u64, u8)> = HashMap::new();
    let mut total_size = 0u64;
    let mut total_files = 0u64;
    for id in tree.file_ids(scope) {
        let n = tree.node(id);
        let ext = extension_of(&n.name);
        let cat = category_of(ext);
        let c = &mut cats[cat as usize];
        c.0 += n.size;
        c.1 += n.allocated;
        c.2 += 1;
        total_size += n.size;
        total_files += 1;
        let key = ext.map(|e| e.to_ascii_lowercase()).unwrap_or_else(|| "(none)".to_string());
        let e = exts.entry(key).or_insert((0, 0, cat));
        e.0 += n.size;
        e.1 += 1;
    }
    let mut categories: Vec<CategoryStat> = cats
        .iter()
        .enumerate()
        .filter(|(_, c)| c.2 > 0)
        .map(|(i, c)| CategoryStat {
            index: i as u8,
            name: CATEGORIES[i],
            size: c.0,
            allocated: c.1,
            files: c.2,
            percent: if total_size == 0 { 0.0 } else { (c.0 as f64 / total_size as f64 * 100.0) as f32 },
        })
        .collect();
    categories.sort_by(|a, b| b.size.cmp(&a.size));
    let mut extensions: Vec<ExtensionStat> = exts
        .into_iter()
        .map(|(extension, (size, files, category))| ExtensionStat { extension, category, size, files })
        .collect();
    extensions.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.extension.cmp(&b.extension)));
    extensions.truncate(100);
    Breakdown { total_size, total_files, categories, extensions }
}

/// The `limit` largest files of one category (bounded heap, no full sort).
pub fn category_files(tree: &ScanTree, scope: Option<u32>, category: u8, limit: usize) -> Vec<u32> {
    let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(limit + 1);
    for id in tree.file_ids(scope) {
        let n = tree.node(id);
        if category_of(extension_of(&n.name)) != category {
            continue;
        }
        heap.push(Reverse((n.size, id)));
        if heap.len() > limit {
            heap.pop();
        }
    }
    let mut out: Vec<(u64, u32)> = heap.into_iter().map(|Reverse(x)| x).collect();
    out.sort_by(|a, b| b.cmp(a));
    out.into_iter().map(|(_, id)| id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_parsed_like_users_expect() {
        assert_eq!(extension_of("movie.MKV"), Some("MKV"));
        assert_eq!(extension_of("archive.tar.gz"), Some("gz"));
        assert_eq!(extension_of(".gitignore"), None);
        assert_eq!(extension_of("README"), None);
        assert_eq!(extension_of("trailing."), None);
    }

    #[test]
    fn categories_ignore_case_and_default_to_other() {
        assert_eq!(CATEGORIES[category_of(Some("MP4")) as usize], "Videos");
        assert_eq!(CATEGORIES[category_of(Some("rs")) as usize], "Source code");
        assert_eq!(CATEGORIES[category_of(Some("dll")) as usize], "System files");
        assert_eq!(category_of(None), OTHER);
        assert_eq!(category_of(Some("definitely-not-an-extension")), OTHER);
        assert_eq!(category_of(Some("zzz")), OTHER);
    }
}
