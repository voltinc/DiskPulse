/// Every command the UI may call. Tauri turns each entry into an `allow-<name>` permission,
/// and `capabilities/default.json` grants exactly these: nothing is callable by default.
const COMMANDS: &[&str] = &[
    "app_info",
    "exit_app",
    "list_drives",
    "get_cleanup_locations",
    "get_cloud_locations",
    "get_settings",
    "save_settings",
    "start_scan",
    "cancel_scan",
    "get_scan_summary",
    "get_children",
    "get_nodes",
    "get_ancestors",
    "search_nodes",
    "get_treemap",
    "get_breakdown",
    "get_category_files",
    "get_largest_files",
    "start_duplicate_scan",
    "cancel_duplicate_scan",
    "get_duplicate_groups",
    "trash_nodes",
    "reveal_node",
    "open_node",
    "export_report",
    "get_history",
    "delete_history_entry",
    "clear_history",
];

fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        eprintln!("tauri build script failed: {error:#}");
        std::process::exit(1);
    }
}
