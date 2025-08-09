// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须：你前端用了这些插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())

        // 可选：仅 debug 开日志
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })

        // 你的命令
        .invoke_handler(tauri::generate_handler![
      commands::encode_alpha_video,
      commands::get_model_path
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
