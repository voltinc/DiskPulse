//! Platform helpers: drives, allocation sizes, path validation and safe deletion.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::errors::{CoreError, Result};

#[derive(Debug, Clone, Serialize)]
pub struct DriveInfo {
    pub label: String,
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_space: u64,
    pub available_space: u64,
    pub used_space: u64,
    /// "ssd", "hdd" or "unknown".
    pub kind: String,
    pub removable: bool,
    pub network: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocationInfo {
    pub label: String,
    pub path: String,
    pub description: String,
}

/// Accepts only absolute, existing folders without `..` components.
pub fn validate_dir_path(path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(CoreError::InvalidPath("the path is empty".into()));
    }
    if !path.is_absolute() {
        return Err(CoreError::InvalidPath(format!("{} is not an absolute path", path.display())));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(CoreError::InvalidPath(format!("{} contains '..' segments", path.display())));
    }
    if !path.is_dir() {
        return Err(CoreError::InvalidPath(format!("{} is not an accessible folder", path.display())));
    }
    Ok(path.to_path_buf())
}

/// Kernel pseudo folders that report meaningless sizes (e.g. /proc/kcore is 128 TB).
pub fn is_virtual_path(path: &Path) -> bool {
    cfg!(target_os = "linux") && matches!(path.to_str(), Some("/proc") | Some("/sys") | Some("/dev"))
}

#[cfg(unix)]
pub fn device_of(md: &fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(md.dev())
}

#[cfg(not(unix))]
pub fn device_of(_md: &fs::Metadata) -> Option<u64> {
    None
}

#[cfg_attr(unix, allow(dead_code))]
fn round_up(value: u64, unit: u64) -> u64 {
    if unit == 0 || value == 0 {
        value
    } else {
        value.div_ceil(unit) * unit
    }
}

/// Space reserved on disk. Unix: `st_blocks * 512`.
#[cfg(unix)]
pub fn allocated_size(md: &fs::Metadata, _path: impl FnOnce() -> PathBuf, _cluster: u64) -> u64 {
    use std::os::unix::fs::MetadataExt;
    md.blocks().saturating_mul(512)
}

/// Windows: logical size rounded up to the cluster size; compressed, sparse and
/// cloud-placeholder files are asked for their real on-disk size instead.
#[cfg(windows)]
pub fn allocated_size(md: &fs::Metadata, path: impl FnOnce() -> PathBuf, cluster: u64) -> u64 {
    use std::os::windows::fs::MetadataExt;
    const COMPRESSED: u32 = 0x800;
    const SPARSE: u32 = 0x200;
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_OPEN: u32 = 0x40000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x400000;
    let attrs = md.file_attributes();
    if attrs & (COMPRESSED | SPARSE | OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0 {
        if let Some(size) = win::compressed_size(&path()) {
            return size;
        }
    }
    round_up(md.len(), cluster)
}

#[cfg(not(any(unix, windows)))]
pub fn allocated_size(md: &fs::Metadata, _path: impl FnOnce() -> PathBuf, cluster: u64) -> u64 {
    round_up(md.len(), cluster)
}

/// Cluster size of the volume that holds `root` (Windows only; 4 KiB elsewhere).
pub fn cluster_size(root: &Path) -> u64 {
    #[cfg(windows)]
    {
        let s = root.to_string_lossy();
        let volume = if s.len() >= 2 && s.as_bytes()[1] == b':' { format!("{}\\", &s[..2]) } else { s.to_string() };
        return win::cluster_size(&volume).unwrap_or(4096);
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        4096
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Storage::FileSystem::{GetCompressedFileSizeW, GetDiskFreeSpaceW, GetDriveTypeW};

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn compressed_size(path: &Path) -> Option<u64> {
        let w = wide(path.as_os_str());
        let mut high: u32 = 0;
        // SAFETY: `w` is NUL-terminated and outlives the call; `high` is a valid out pointer.
        let low = unsafe { GetCompressedFileSizeW(w.as_ptr(), &mut high) };
        if low == u32::MAX && unsafe { GetLastError() } != 0 {
            return None;
        }
        Some((u64::from(high) << 32) | u64::from(low))
    }

    pub fn cluster_size(root: &str) -> Option<u64> {
        let w = wide(OsStr::new(root));
        let (mut spc, mut bps, mut free, mut total) = (0u32, 0u32, 0u32, 0u32);
        // SAFETY: all pointers are valid for the duration of the call.
        let ok = unsafe { GetDiskFreeSpaceW(w.as_ptr(), &mut spc, &mut bps, &mut free, &mut total) };
        (ok != 0 && spc > 0 && bps > 0).then(|| u64::from(spc) * u64::from(bps))
    }

    pub fn is_remote_drive(root: &str) -> bool {
        let w = wide(OsStr::new(root));
        // SAFETY: `w` is NUL-terminated. DRIVE_REMOTE == 4.
        unsafe { GetDriveTypeW(w.as_ptr()) == 4 }
    }
}

fn is_pseudo_filesystem(mount: &str, fs_name: &str) -> bool {
    const FS: [&str; 11] = [
        "tmpfs", "devtmpfs", "squashfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts", "ramfs", "autofs", "efivarfs",
    ];
    FS.contains(&fs_name)
        || ["/snap", "/proc", "/sys", "/dev", "/run", "/boot/efi", "/private/var/vm"]
            .iter()
            .any(|p| mount.starts_with(p))
        || (mount.starts_with("/System/Volumes/") && !mount.ends_with("/Data"))
}

/// Windows asks the OS whether a drive letter is a mapped network drive.
#[cfg(windows)]
fn is_remote_volume(mount: &str) -> bool {
    win::is_remote_drive(mount)
}

#[cfg(not(windows))]
fn is_remote_volume(_mount: &str) -> bool {
    false
}

fn is_network_filesystem(mount: &str, fs_name: &str) -> bool {
    const NET: [&str; 12] =
        ["nfs", "nfs4", "cifs", "smb", "smb3", "smbfs", "afpfs", "sshfs", "fuse.sshfs", "9p", "davfs", "webdav"];
    is_remote_volume(mount) || NET.contains(&fs_name) || fs_name.starts_with("fuse.rclone")
}

pub fn host_name() -> String {
    sysinfo::System::host_name().unwrap_or_else(|| "This computer".to_string())
}

/// Mounted volumes with usage figures; pseudo filesystems are filtered out.
pub fn list_drives() -> Vec<DriveInfo> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for d in disks.list() {
        let mount = d.mount_point().to_string_lossy().into_owned();
        let fs_name = d.file_system().to_string_lossy().to_lowercase();
        if d.total_space() == 0 || is_pseudo_filesystem(&mount, &fs_name) || !seen.insert(mount.clone()) {
            continue;
        }
        let name = d.name().to_string_lossy().into_owned();
        let windows_letter = cfg!(windows) && mount.len() >= 2 && mount.as_bytes()[1] == b':';
        let label = if windows_letter {
            let letter = &mount[..2];
            if name.is_empty() {
                format!("{letter} [Local Disk]")
            } else {
                format!("{letter} [{name}]")
            }
        } else if name.is_empty() {
            mount.clone()
        } else {
            name.clone()
        };
        let kind = match d.kind() {
            sysinfo::DiskKind::SSD => "ssd",
            sysinfo::DiskKind::HDD => "hdd",
            _ => "unknown",
        };
        out.push(DriveInfo {
            label,
            name,
            network: is_network_filesystem(&mount, &fs_name),
            mount_point: mount,
            file_system: d.file_system().to_string_lossy().into_owned(),
            total_space: d.total_space(),
            available_space: d.available_space(),
            used_space: d.total_space().saturating_sub(d.available_space()),
            kind: kind.into(),
            removable: d.is_removable(),
        });
    }
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    out
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn home_dir() -> Option<PathBuf> {
    env_path("HOME").or_else(|| env_path("USERPROFILE"))
}

fn existing(label: &str, path: PathBuf, description: &str, seen: &mut HashSet<PathBuf>) -> Option<LocationInfo> {
    if !path.is_dir() || !seen.insert(path.clone()) {
        return None;
    }
    Some(LocationInfo { label: label.into(), path: path.display().to_string(), description: description.into() })
}

/// Well-known folders that usually hold disposable data on this machine.
pub fn cleanup_locations() -> Vec<LocationInfo> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |label: &str, path: Option<PathBuf>, desc: &str| {
        if let Some(loc) = path.and_then(|p| existing(label, p, desc, &mut seen)) {
            out.push(loc);
        }
    };
    let home = home_dir();
    if cfg!(windows) {
        let local = env_path("LOCALAPPDATA");
        let windir = env_path("SystemRoot").or_else(|| env_path("WINDIR"));
        add("User temporary files", env_path("TEMP"), "Files apps left behind while running");
        add("Local app temp", local.as_ref().map(|p| p.join("Temp")), "Per-user temporary folder");
        add(
            "Windows temp",
            windir.as_ref().map(|p| p.join("Temp")),
            "System-wide temporary files (may need administrator rights)",
        );
        add(
            "Internet cache",
            local.as_ref().map(|p| p.join("Microsoft").join("Windows").join("INetCache")),
            "Cached web content",
        );
        add("Crash dumps", local.as_ref().map(|p| p.join("CrashDumps")), "Memory dumps from crashed programs");
        add(
            "Windows Update downloads",
            windir.as_ref().map(|p| p.join("SoftwareDistribution").join("Download")),
            "Downloaded update packages",
        );
        add("Shader cache", local.as_ref().map(|p| p.join("D3DSCache")), "Graphics shader caches");
    } else if cfg!(target_os = "macos") {
        add("User caches", home.as_ref().map(|h| h.join("Library/Caches")), "Per-app caches");
        add("User logs", home.as_ref().map(|h| h.join("Library/Logs")), "Application log files");
        add("Trash", home.as_ref().map(|h| h.join(".Trash")), "Files already in the Trash");
        add(
            "Xcode derived data",
            home.as_ref().map(|h| h.join("Library/Developer/Xcode/DerivedData")),
            "Build products that Xcode regenerates",
        );
        add(
            "iOS device backups",
            home.as_ref().map(|h| h.join("Library/Application Support/MobileSync/Backup")),
            "Local iPhone and iPad backups",
        );
    } else {
        add(
            "User cache",
            env_path("XDG_CACHE_HOME").or_else(|| home.as_ref().map(|h| h.join(".cache"))),
            "Per-app caches",
        );
        add("Trash", home.as_ref().map(|h| h.join(".local/share/Trash")), "Files already in the Trash");
        add("Temporary files", Some(PathBuf::from("/var/tmp")), "Temporary files kept across reboots");
        add("Package cache", Some(PathBuf::from("/var/cache/apt/archives")), "Downloaded .deb packages");
        add("Journal logs", Some(PathBuf::from("/var/log/journal")), "systemd journal storage");
    }
    out
}

/// Cloud-sync folders found in the user's profile.
pub fn cloud_locations() -> Vec<LocationInfo> {
    let mut out = Vec::new();
    let Some(home) = home_dir() else { return out };
    const PREFIXES: [&str; 9] =
        ["OneDrive", "Dropbox", "Google Drive", "GoogleDrive", "iCloud", "Box", "Nextcloud", "MEGA", "pCloud"];
    if let Ok(read) = fs::read_dir(&home) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if PREFIXES.iter().any(|p| name.starts_with(p)) && entry.path().is_dir() {
                out.push(LocationInfo {
                    label: name,
                    path: entry.path().display().to_string(),
                    description: "Cloud sync folder; online-only files use little disk space".into(),
                });
            }
        }
    }
    if let Ok(read) = fs::read_dir(home.join("Library/CloudStorage")) {
        for entry in read.flatten() {
            if entry.path().is_dir() {
                out.push(LocationInfo {
                    label: entry.file_name().to_string_lossy().into_owned(),
                    path: entry.path().display().to_string(),
                    description: "Cloud storage provider folder".into(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// Move one file or folder to the OS Trash / Recycle Bin. A symlink is trashed itself, never its target.
/// `scan_root` must contain `path`, and the root itself can never be trashed.
pub fn move_to_trash(path: &Path, scan_root: &Path) -> Result<()> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(CoreError::InvalidPath("path traversal is not allowed".into()));
    }
    if path == scan_root || path.parent().is_none() || !path.starts_with(scan_root) {
        return Err(CoreError::InvalidPath(format!("{} is outside the selected targets", path.display())));
    }
    fs::symlink_metadata(path).map_err(|e| CoreError::io(path, e))?;
    trash::delete(path).map_err(|e| CoreError::Trash(format!("{}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_traversal_and_missing_paths() {
        assert!(validate_dir_path(Path::new("")).is_err());
        assert!(validate_dir_path(Path::new("relative/folder")).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_dir_path(dir.path()).is_ok());
        assert!(validate_dir_path(&dir.path().join("..").join("x")).is_err());
        assert!(validate_dir_path(&dir.path().join("does-not-exist")).is_err());
    }

    #[test]
    fn trash_refuses_roots_and_outside_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(move_to_trash(root, root).is_err());
        assert!(move_to_trash(Path::new("/"), root).is_err());
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("a.txt");
        fs::write(&victim, b"x").unwrap();
        assert!(move_to_trash(&victim, root).is_err());
        assert!(victim.exists());
        assert!(move_to_trash(&root.join("..").join("a"), root).is_err());
    }

    #[test]
    fn round_up_behaves() {
        assert_eq!(round_up(0, 4096), 0);
        assert_eq!(round_up(1, 4096), 4096);
        assert_eq!(round_up(4096, 4096), 4096);
        assert_eq!(round_up(4097, 4096), 8192);
    }
}
