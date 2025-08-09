// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn get_model_path(model_name: String) -> Result<String, String> {
    Ok(format!("/model/{}/model.json", model_name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 注册 dialog 插件（关键）
        .plugin(tauri_plugin_dialog::init())
        // 你的日志插件（仅 debug）
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        // 你的 invoke
        .invoke_handler(tauri::generate_handler![get_model_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run(); // 👈 不要再 new 一个 Builder 了，直接调用 run()
}
