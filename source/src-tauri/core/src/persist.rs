//! Tiny JSON persistence for settings and scan history.

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::errors::{CoreError, Result};

/// Missing or corrupt files fall back to the default value instead of failing start-up.
pub fn load_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Write via a temporary file and rename so a crash cannot leave half a file behind.
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| CoreError::Invalid(e.to_string()))?;
    fs::write(&tmp, bytes).map_err(|e| CoreError::io(&tmp, e))?;
    fs::rename(&tmp, path).map_err(|e| CoreError::io(path, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Settings;

    #[test]
    fn settings_round_trip_and_corrupt_files_fall_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/settings.json");
        let s = Settings { threads: 12, ..Settings::default() };
        save_json(&path, &s).unwrap();
        assert_eq!(load_json_or_default::<Settings>(&path).threads, 12);
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(load_json_or_default::<Settings>(&path).threads, 0);
        assert_eq!(load_json_or_default::<Settings>(&dir.path().join("missing.json")).threads, 0);
    }

    #[test]
    fn out_of_range_settings_are_clamped() {
        let s = Settings {
            threads: 999,
            treemap_depth: 9,
            units: "nonsense".into(),
            treemap_metric: "x".into(),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!((s.threads, s.treemap_depth), (64, 3));
        assert_eq!((s.units.as_str(), s.treemap_metric.as_str()), ("windows", "logical"));
    }
}
