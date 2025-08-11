// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("正在启动 Live2D 录制器...");
    
    // 设置全局 panic hook，防止程序崩溃
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("程序发生严重错误: {:?}", panic_info);
        // 在 Windows 上，我们可以选择继续运行而不是崩溃
        #[cfg(windows)]
        {
            eprintln!("在 Windows 上继续运行...");
        }
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            crate::commands::media::vp9_to_prores4444,
            crate::commands::media::mov_to_webm_alpha,
            crate::commands::media::alpha_to_mp4_flatten,
            crate::commands::models::find_live2d_models,
            crate::commands::server::get_model_server_info,
            crate::commands::server::refresh_model_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}