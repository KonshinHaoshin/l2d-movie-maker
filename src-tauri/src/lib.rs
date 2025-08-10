// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            crate::commands::media::vp9_to_prores4444,
            crate::commands::media::mov_to_webm_alpha,
            crate::commands::media::alpha_to_mp4_flatten,
            crate::commands::models::find_live2d_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}