use zhiweave_application::SystemStatus;

#[tauri::command]
fn system_status() -> SystemStatus {
    zhiweave_application::system_status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Starts the cross-platform application shell.
///
/// # Panics
///
/// Panics when the native runtime cannot initialize or exits unexpectedly.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_status])
        .run(tauri::generate_context!())
        .expect("ZhiWeave client failed to start");
}
