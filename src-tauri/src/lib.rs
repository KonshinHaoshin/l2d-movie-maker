// src-tauri/src/lib.rs
mod commands;

use log::LevelFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("正在启动 Live2D 录制器...");

    // 捕获 panic，打印信息，便于调试
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("程序发生严重错误: {:?}", panic_info);
        #[cfg(windows)]
        eprintln!("在 Windows 上继续运行（如 .run 出错会在下方打印具体原因）...");
    }));

    // 构建 Tauri 应用（不要在末尾用 expect）
    let builder = tauri::Builder::default()
        // 日志插件：把日志输出到控制台和日志目录（%AppData%/.../logs）
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(LevelFilter::Debug)
                .build(),
        )
        // 对话框、FS 插件（v2 版本）
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 命令
        .invoke_handler(tauri::generate_handler![
            crate::commands::media::vp9_to_prores4444,
            crate::commands::media::mov_to_webm_alpha,
            crate::commands::media::alpha_to_mp4_flatten,
            crate::commands::media::encode_png_sequence_to_webm_alpha,
            crate::commands::models::find_live2d_models,
            crate::commands::server::get_model_server_info,
            crate::commands::server::refresh_model_index,
            crate::commands::media::set_fs_scope,
        ]);

    // 打出真实错误
    let ctx = tauri::generate_context!();
    if let Err(e) = builder.run(ctx) {
        eprintln!("启动失败: {e:?}");
    }
}
