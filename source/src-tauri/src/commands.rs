//! Tauri commands: a thin, validated layer between the React UI and the core engine.
//! Heavy work always runs on blocking worker threads, never on the UI or async runtime threads.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use diskpulse_core::duplicates::{self, DuplicateGroup, DuplicateOptions, DuplicateSummary};
use diskpulse_core::exporter::{self, ReportFormat};
use diskpulse_core::filesystem::{self, DriveInfo, LocationInfo};
use diskpulse_core::models::*;
use diskpulse_core::persist;
use diskpulse_core::scanner;
use diskpulse_core::storage::{self, Breakdown};
use diskpulse_core::tree::ScanTree;
use diskpulse_core::treemap::{self, Metric, TreemapRect};
use diskpulse_core::CoreError;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::errors::{CmdResult, CommandError};
use crate::state::{lock, read, write, AppState, ScanSession};

const MAX_PAGE: usize = 1000;
const HISTORY_LIMIT: usize = 100;
const EXECUTABLE_CATEGORY: u8 = 4;

// ---------------------------------------------------------------- helpers

async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CmdResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| CommandError(format!("A background task failed: {e}")))?
}

/// Run `f` against the scan tree on a blocking thread while holding a read lock.
async fn with_tree<T, F>(state: &State<'_, AppState>, scan_id: &str, f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&ScanTree) -> Result<T, CoreError> + Send + 'static,
{
    let session = state.session(scan_id)?;
    blocking(move || {
        let tree = read(&session.tree);
        f(&tree).map_err(CommandError::from)
    })
    .await
}

fn data_file(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(name))
        .map_err(|e| CommandError(format!("Could not locate the app data folder: {e}")))
}

fn load_settings(app: &AppHandle) -> CmdResult<Settings> {
    Ok(persist::load_json_or_default::<Settings>(&data_file(app, "settings.json")?).sanitized())
}

fn clamp_limit(limit: Option<usize>, default: usize) -> usize {
    limit.unwrap_or(default).clamp(1, MAX_PAGE)
}

// ---------------------------------------------------------------- app, drives, settings

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    host_name: String,
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> CmdResult<AppInfo> {
    let host_name = blocking(|| Ok(filesystem::host_name())).await?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        host_name,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    })
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn list_drives() -> CmdResult<Vec<DriveInfo>> {
    blocking(|| Ok(filesystem::list_drives())).await
}

#[tauri::command]
pub async fn get_cleanup_locations() -> CmdResult<Vec<LocationInfo>> {
    blocking(|| Ok(filesystem::cleanup_locations())).await
}

#[tauri::command]
pub async fn get_cloud_locations() -> CmdResult<Vec<LocationInfo>> {
    blocking(|| Ok(filesystem::cloud_locations())).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> CmdResult<Settings> {
    load_settings(&app)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    let clean = settings.sanitized();
    let path = data_file(&app, "settings.json")?;
    let _guard = lock(&state.files);
    persist::save_json(&path, &clean)?;
    Ok(clean)
}

// ---------------------------------------------------------------- scanning

#[derive(Serialize, Clone)]
struct ScanProgressEvent {
    scan_id: String,
    #[serde(flatten)]
    snapshot: ProgressSnapshot,
}

#[derive(Serialize, Clone)]
struct ScanCompletedEvent {
    scan_id: String,
    summary: ScanSummary,
}

fn build_summary(scan_id: &str, tree: &ScanTree) -> ScanSummary {
    let root = tree.node(0);
    ScanSummary {
        scan_id: scan_id.to_string(),
        root: tree.summary(0),
        started_at: tree.started_at,
        finished_at: scanner::now_secs(),
        duration_ms: tree.duration_ms,
        total_size: root.size,
        total_allocated: root.allocated,
        file_count: root.file_count,
        dir_count: root.dir_count,
        errors_count: tree.errors_count,
        issues: tree.issues.iter().take(50).cloned().collect(),
        stayed_on_filesystem: tree.stayed_on_filesystem,
    }
}

fn record_history(app: &AppHandle, summary: &ScanSummary) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Ok(path) = data_file(app, "history.json") else { return };
    let _guard = lock(&state.files);
    let mut history: Vec<HistoryRecord> = persist::load_json_or_default(&path);
    history.insert(
        0,
        HistoryRecord {
            id: format!("{}-{}", summary.started_at, summary.scan_id),
            root_path: summary.root.path.clone(),
            started_at: summary.started_at,
            duration_ms: summary.duration_ms,
            total_size: summary.total_size,
            total_allocated: summary.total_allocated,
            file_count: summary.file_count,
            dir_count: summary.dir_count,
            errors_count: summary.errors_count,
        },
    );
    history.truncate(HISTORY_LIMIT);
    // History is a convenience; failing to persist it must not fail the scan.
    let _ = persist::save_json(&path, &history);
}

#[tauri::command]
pub async fn start_scan(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let root = filesystem::validate_dir_path(Path::new(&path))?;
    let settings = load_settings(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let scan_id = format!("scan-{}", state.counter.fetch_add(1, Ordering::Relaxed) + 1);
    {
        let mut running = lock(&state.running);
        if !running.is_empty() {
            return Err("A scan is already running. Cancel it or wait for it to finish.".into());
        }
        running.insert(scan_id.clone(), cancel.clone());
    }
    let options = ScanOptions {
        root: root.clone(),
        threads: settings.threads as usize,
        cross_filesystems: !settings.stay_on_filesystem,
    };
    let _ = app.emit("scan-started", serde_json::json!({ "scan_id": scan_id, "root": root.display().to_string() }));

    let app_for_task = app.clone();
    let id_for_task = scan_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress_app = app_for_task.clone();
        let progress_id = id_for_task.clone();
        let result = scanner::scan(&options, cancel, &move |snapshot| {
            let _ = progress_app.emit("scan-progress", ScanProgressEvent { scan_id: progress_id.clone(), snapshot });
        });
        let state = app_for_task.state::<AppState>();
        match result {
            Ok(tree) => {
                let summary = build_summary(&id_for_task, &tree);
                // Only the newest result stays in memory; stop any duplicate scan that still reads an older one.
                let session = Arc::new(ScanSession {
                    tree: RwLock::new(tree),
                    duplicates: Mutex::new(None),
                    dup_cancel: Mutex::new(None),
                    dup_running: AtomicBool::new(false),
                });
                {
                    let mut sessions = write(&state.sessions);
                    for old in sessions.values() {
                        if let Some(flag) = lock(&old.dup_cancel).as_ref() {
                            flag.store(true, Ordering::Relaxed);
                        }
                    }
                    sessions.clear();
                    sessions.insert(id_for_task.clone(), session);
                }
                record_history(&app_for_task, &summary);
                lock(&state.running).remove(&id_for_task);
                let _ = app_for_task.emit("scan-completed", ScanCompletedEvent { scan_id: id_for_task, summary });
            }
            Err(CoreError::Cancelled) => {
                lock(&state.running).remove(&id_for_task);
                let _ = app_for_task.emit("scan-cancelled", serde_json::json!({ "scan_id": id_for_task }));
            }
            Err(error) => {
                lock(&state.running).remove(&id_for_task);
                let _ = app_for_task
                    .emit("scan-error", serde_json::json!({ "scan_id": id_for_task, "message": error.to_string() }));
            }
        }
    });
    Ok(scan_id)
}

#[tauri::command]
pub async fn cancel_scan(state: State<'_, AppState>, scan_id: String) -> CmdResult<bool> {
    Ok(lock(&state.running).get(&scan_id).map(|flag| flag.store(true, Ordering::Relaxed)).is_some())
}

#[tauri::command]
pub async fn get_scan_summary(state: State<'_, AppState>, scan_id: String) -> CmdResult<ScanSummary> {
    let id = scan_id.clone();
    with_tree(&state, &scan_id, move |tree| Ok(build_summary(&id, tree))).await
}

// ---------------------------------------------------------------- tree queries

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_children(
    state: State<'_, AppState>,
    scan_id: String,
    node_id: u32,
    offset: Option<usize>,
    limit: Option<usize>,
    sort_key: Option<SortKey>,
    sort_dir: Option<SortDir>,
    filter: Option<String>,
) -> CmdResult<ChildrenPage> {
    let limit = clamp_limit(limit, 500);
    with_tree(&state, &scan_id, move |tree| {
        tree.children_page(
            node_id,
            offset.unwrap_or(0),
            limit,
            sort_key.unwrap_or(SortKey::Size),
            sort_dir.unwrap_or(SortDir::Desc),
            filter.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_nodes(state: State<'_, AppState>, scan_id: String, ids: Vec<u32>) -> CmdResult<Vec<NodeSummary>> {
    with_tree(&state, &scan_id, move |tree| {
        Ok(ids.into_iter().take(5000).filter(|&id| tree.get(id).is_some()).map(|id| tree.summary(id)).collect())
    })
    .await
}

#[tauri::command]
pub async fn get_ancestors(state: State<'_, AppState>, scan_id: String, node_id: u32) -> CmdResult<Vec<NodeSummary>> {
    with_tree(&state, &scan_id, move |tree| {
        tree.get(node_id).ok_or_else(|| CoreError::NotFound(format!("node {node_id}")))?;
        Ok(tree.ancestors(node_id).into_iter().map(|id| tree.summary(id)).collect())
    })
    .await
}

#[tauri::command]
pub async fn search_nodes(
    state: State<'_, AppState>,
    scan_id: String,
    query: String,
    scope: Option<u32>,
    limit: Option<usize>,
) -> CmdResult<Vec<NodeSummary>> {
    let limit = clamp_limit(limit, 300);
    with_tree(&state, &scan_id, move |tree| {
        Ok(tree.search(&query, scope, limit).into_iter().map(|id| tree.summary(id)).collect())
    })
    .await
}

#[tauri::command]
pub async fn get_treemap(
    state: State<'_, AppState>,
    scan_id: String,
    node_id: u32,
    width: f32,
    height: f32,
    depth: Option<u8>,
    metric: Option<Metric>,
) -> CmdResult<Vec<TreemapRect>> {
    with_tree(&state, &scan_id, move |tree| {
        treemap::layout(tree, node_id, width, height, depth.unwrap_or(2), metric.unwrap_or(Metric::Logical))
    })
    .await
}

#[tauri::command]
pub async fn get_breakdown(state: State<'_, AppState>, scan_id: String, scope: Option<u32>) -> CmdResult<Breakdown> {
    with_tree(&state, &scan_id, move |tree| Ok(storage::breakdown(tree, scope))).await
}

#[tauri::command]
pub async fn get_category_files(
    state: State<'_, AppState>,
    scan_id: String,
    category: u8,
    scope: Option<u32>,
    limit: Option<usize>,
) -> CmdResult<Vec<NodeSummary>> {
    let limit = clamp_limit(limit, 200);
    with_tree(&state, &scan_id, move |tree| {
        Ok(storage::category_files(tree, scope, category, limit).into_iter().map(|id| tree.summary(id)).collect())
    })
    .await
}

#[tauri::command]
pub async fn get_largest_files(
    state: State<'_, AppState>,
    scan_id: String,
    limit: Option<usize>,
    scope: Option<u32>,
) -> CmdResult<Vec<NodeSummary>> {
    let limit = clamp_limit(limit, 100);
    with_tree(&state, &scan_id, move |tree| {
        Ok(tree.largest_files(scope, limit).into_iter().map(|id| tree.summary(id)).collect())
    })
    .await
}

// ---------------------------------------------------------------- duplicates

#[derive(Serialize, Clone)]
struct DuplicateProgressEvent {
    scan_id: String,
    #[serde(flatten)]
    progress: duplicates::DuplicateProgress,
}

#[tauri::command]
pub async fn start_duplicate_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_id: String,
    min_size: Option<u64>,
    scope: Option<u32>,
) -> CmdResult<()> {
    let session = state.session(&scan_id)?;
    let settings = load_settings(&app)?;
    if session.dup_running.swap(true, Ordering::SeqCst) {
        return Err("A duplicate scan is already running.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *lock(&session.dup_cancel) = Some(cancel.clone());
    *lock(&session.duplicates) = None;

    tauri::async_runtime::spawn_blocking(move || {
        let options = DuplicateOptions { min_size: min_size.unwrap_or(settings.min_duplicate_size), scope, threads: 0 };
        let progress_app = app.clone();
        let progress_id = scan_id.clone();
        let result = {
            let tree = read(&session.tree);
            duplicates::find_duplicates(&tree, &options, &cancel, &move |progress| {
                let _ = progress_app
                    .emit("duplicates-progress", DuplicateProgressEvent { scan_id: progress_id.clone(), progress });
            })
        };
        match result {
            Ok(report) => {
                let summary: DuplicateSummary = report.summary.clone();
                *lock(&session.duplicates) = Some(Arc::new(report));
                session.dup_running.store(false, Ordering::SeqCst);
                let _ = app.emit("duplicates-completed", serde_json::json!({ "scan_id": scan_id, "summary": summary }));
            }
            Err(CoreError::Cancelled) => {
                session.dup_running.store(false, Ordering::SeqCst);
                let _ = app.emit("duplicates-cancelled", serde_json::json!({ "scan_id": scan_id }));
            }
            Err(error) => {
                session.dup_running.store(false, Ordering::SeqCst);
                let _ = app
                    .emit("duplicates-error", serde_json::json!({ "scan_id": scan_id, "message": error.to_string() }));
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_duplicate_scan(state: State<'_, AppState>, scan_id: String) -> CmdResult<()> {
    let session = state.session(&scan_id)?;
    if let Some(flag) = lock(&session.dup_cancel).as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct DuplicatePage {
    summary: Option<DuplicateSummary>,
    total: u32,
    groups: Vec<DuplicateGroup>,
}

#[tauri::command]
pub async fn get_duplicate_groups(
    state: State<'_, AppState>,
    scan_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> CmdResult<DuplicatePage> {
    let session = state.session(&scan_id)?;
    let report = lock(&session.duplicates).clone();
    let limit = clamp_limit(limit, 100);
    Ok(match report {
        None => DuplicatePage { summary: None, total: 0, groups: Vec::new() },
        Some(r) => DuplicatePage {
            summary: Some(r.summary.clone()),
            total: r.groups.len() as u32,
            groups: r.groups.iter().skip(offset.unwrap_or(0)).take(limit).cloned().collect(),
        },
    })
}

// ---------------------------------------------------------------- file operations

#[derive(Serialize)]
pub struct TrashFailure {
    id: u32,
    path: String,
    error: String,
}

#[derive(Serialize)]
pub struct TrashOutcome {
    trashed: Vec<u32>,
    failed: Vec<TrashFailure>,
    bytes_freed: u64,
    allocated_freed: u64,
}

/// Move the selected nodes to the Trash / Recycle Bin. Paths are rebuilt from node ids on the Rust side,
/// so the UI can never ask for a path that is not part of the scan.
#[tauri::command]
pub async fn trash_nodes(state: State<'_, AppState>, scan_id: String, ids: Vec<u32>) -> CmdResult<TrashOutcome> {
    let session = state.session(&scan_id)?;
    if session.dup_running.load(Ordering::SeqCst) {
        return Err("A duplicate scan is running. Cancel it or wait for it to finish before deleting files.".into());
    }
    blocking(move || {
        // Phase 1 (read lock): resolve ids to paths. A selected folder already covers selected descendants.
        let selected: HashSet<u32> = ids.iter().copied().collect();
        let mut jobs: Vec<(u32, PathBuf)> = Vec::new();
        let mut failed: Vec<TrashFailure> = Vec::new();
        let root_path;
        {
            let tree = read(&session.tree);
            root_path = tree.root_path.clone();
            let mut seen = HashSet::new();
            for id in ids {
                if !seen.insert(id) {
                    continue;
                }
                if id == 0 {
                    failed.push(TrashFailure {
                        id,
                        path: root_path.display().to_string(),
                        error: "The scanned folder itself cannot be deleted from here.".into(),
                    });
                    continue;
                }
                if tree.get(id).is_none() {
                    continue;
                }
                let chain = tree.ancestors(id);
                if chain[..chain.len() - 1].iter().any(|a| selected.contains(a)) {
                    continue;
                }
                jobs.push((id, tree.path_of(id)));
            }
        }
        // Phase 2 (no lock): talk to the OS.
        let mut trashed = Vec::new();
        for (id, path) in jobs {
            match filesystem::move_to_trash(&path, &root_path) {
                Ok(()) => trashed.push(id),
                Err(e) => failed.push(TrashFailure { id, path: path.display().to_string(), error: e.to_string() }),
            }
        }
        // Phase 3 (write lock): update the in-memory result and any duplicate report.
        let (mut bytes_freed, mut allocated_freed) = (0u64, 0u64);
        {
            let mut tree = write(&session.tree);
            for &id in &trashed {
                if let Ok((size, allocated)) = tree.remove_node(id) {
                    bytes_freed += size;
                    allocated_freed += allocated;
                }
            }
            let mut guard = lock(&session.duplicates);
            if let Some(report) = guard.as_ref() {
                let mut updated = (**report).clone();
                updated.prune(|id| tree.get(id).is_some());
                *guard = Some(Arc::new(updated));
            }
        }
        Ok(TrashOutcome { trashed, failed, bytes_freed, allocated_freed })
    })
    .await
}

fn resolve_node(state: &State<'_, AppState>, scan_id: &str, node_id: u32) -> CmdResult<(PathBuf, u8)> {
    let session = state.session(scan_id)?;
    let tree = read(&session.tree);
    let node = tree.get(node_id).ok_or_else(|| CommandError::from("That item is no longer part of the scan."))?;
    let category = match node.kind {
        NodeKind::File => storage::category_of(storage::extension_of(&node.name)),
        NodeKind::Directory => node.dominant,
    };
    let path = tree.path_of(node_id);
    if std::fs::symlink_metadata(&path).is_err() {
        return Err(CommandError(format!("{} no longer exists on disk.", path.display())));
    }
    Ok((path, category))
}

#[tauri::command]
pub async fn reveal_node(app: AppHandle, state: State<'_, AppState>, scan_id: String, node_id: u32) -> CmdResult<()> {
    let (path, _) = resolve_node(&state, &scan_id, node_id)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| CommandError(format!("Could not show the item in the file manager: {e}")))
}

#[tauri::command]
pub async fn open_node(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_id: String,
    node_id: u32,
    confirmed_executable: Option<bool>,
) -> CmdResult<()> {
    let (path, category) = resolve_node(&state, &scan_id, node_id)?;
    if path.is_file() && category == EXECUTABLE_CATEGORY && confirmed_executable != Some(true) {
        return Err("This is a program. Confirm that you want to run it before opening it.".into());
    }
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| CommandError(format!("Could not open the item: {e}")))
}

// ---------------------------------------------------------------- export

#[tauri::command]
pub async fn export_report(
    state: State<'_, AppState>,
    scan_id: String,
    format: ReportFormat,
    dest: String,
    include_duplicates: bool,
) -> CmdResult<()> {
    let session = state.session(&scan_id)?;
    blocking(move || {
        let tree = read(&session.tree);
        let dups = if include_duplicates { lock(&session.duplicates).clone() } else { None };
        exporter::export_report(&tree, dups.as_deref(), format, Path::new(&dest)).map_err(CommandError::from)
    })
    .await
}

// ---------------------------------------------------------------- history

#[tauri::command]
pub async fn get_history(app: AppHandle) -> CmdResult<Vec<HistoryRecord>> {
    Ok(persist::load_json_or_default(&data_file(&app, "history.json")?))
}

#[tauri::command]
pub async fn delete_history_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<Vec<HistoryRecord>> {
    let path = data_file(&app, "history.json")?;
    let _guard = lock(&state.files);
    let mut history: Vec<HistoryRecord> = persist::load_json_or_default(&path);
    history.retain(|h| h.id != id);
    persist::save_json(&path, &history)?;
    Ok(history)
}

#[tauri::command]
pub async fn clear_history(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let path = data_file(&app, "history.json")?;
    let _guard = lock(&state.files);
    persist::save_json(&path, &Vec::<HistoryRecord>::new())?;
    Ok(())
}
