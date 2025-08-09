fn main() {
    // 在开发模式下，设置前端资源路径
    if std::env::var("TAURI_DEBUG").unwrap_or_default() == "true" {
        println!("cargo:rustc-env=TAURI_FRONTEND_URL=http://localhost:1420");
    }
    
    tauri_build::build()
}
