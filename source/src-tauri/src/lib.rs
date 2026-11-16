mod commands;
mod errors;
mod state;

use commands::*;

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            exit_app,
            list_drives,
            get_cleanup_locations,
            get_cloud_locations,
            get_settings,
            save_settings,
            start_scan,
            cancel_scan,
            get_scan_summary,
            get_children,
            get_nodes,
            get_ancestors,
            search_nodes,
            get_treemap,
            get_breakdown,
            get_category_files,
            get_largest_files,
            start_duplicate_scan,
            cancel_duplicate_scan,
            get_duplicate_groups,
            trash_nodes,
            reveal_node,
            open_node,
            export_report,
            get_history,
            delete_history_entry,
            clear_history,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("DiskPulse Pro could not start: {error}");
        std::process::exit(1);
    }
}
