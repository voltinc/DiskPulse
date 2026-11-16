use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use diskpulse_core::duplicates::DuplicateReport;
use diskpulse_core::tree::ScanTree;

use crate::errors::{CmdResult, CommandError};

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn read<T>(l: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    l.read().unwrap_or_else(PoisonError::into_inner)
}

pub fn write<T>(l: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    l.write().unwrap_or_else(PoisonError::into_inner)
}

/// One finished scan. The canonical tree stays in Rust; the UI only ever sees small pages of it.
pub struct ScanSession {
    pub tree: RwLock<ScanTree>,
    pub duplicates: Mutex<Option<Arc<DuplicateReport>>>,
    pub dup_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub dup_running: AtomicBool,
}

#[derive(Default)]
pub struct AppState {
    pub counter: AtomicU64,
    /// Cancellation flags of scans that are currently running.
    pub running: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Finished scans. Only the newest is kept to bound memory.
    pub sessions: RwLock<HashMap<String, Arc<ScanSession>>>,
    /// Serialises read-modify-write cycles on settings.json / history.json.
    pub files: Mutex<()>,
}

impl AppState {
    pub fn session(&self, scan_id: &str) -> CmdResult<Arc<ScanSession>> {
        read(&self.sessions)
            .get(scan_id)
            .cloned()
            .ok_or_else(|| CommandError::from("This scan is no longer available. Run the scan again."))
    }
}
