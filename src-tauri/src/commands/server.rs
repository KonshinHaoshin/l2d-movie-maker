// src-tauri/src/commands/server.rs
use std::{path::{PathBuf}, thread, sync::OnceLock};
use serde::Serialize;
use tiny_http::{Server, Response, Request};
use mime_guess;


#[derive(Serialize)]
pub struct ModelServerInfo {
    pub base_url: String,
    pub models_dir: String,
}

#[derive(Serialize)]
pub struct ModelEntry {
    pub label: String,
    pub path: String,
}

/// 获取可执行文件所在目录
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .unwrap_or(std::env::current_dir().unwrap())
}

/// 启动静态文件服务器
fn start_static_server(model_root: PathBuf) -> u16 {
    // 尝试多个端口，避免端口冲突
    let ports = vec![1430u16, 1431u16, 1432u16, 1433u16, 1434u16];
    
    for &port in &ports {
        match Server::http(format!("127.0.0.1:{}", port)) {
            Ok(server) => {
                // 成功绑定端口，启动服务器
                thread::spawn(move || {
                    for req in server.incoming_requests() {
                        handle_req(req, &model_root);
                    }
                });
                return port;
            }
            Err(_) => {
                // 端口被占用，尝试下一个
                continue;
            }
        }
    }
    
    // 所有端口都被占用，使用随机端口
    panic!("无法绑定任何可用端口，请检查网络配置");
}

/// 处理 HTTP 请求
fn handle_req(req: Request, model_root: &PathBuf) {
    // 只允许 /model/... 路由
    let url = req.url().to_string();
    if !url.starts_with("/model/") {
        let _ = req.respond(Response::from_string("Not Found").with_status_code(404));
        return;
    }

    // 去掉开头的 /，拼到 model_root 下
    let rel = &url[1..]; // "model/xxx"
    let path = model_root.join(rel.strip_prefix("model/").unwrap_or(""));

    // 禁止目录遍历
    if let Ok(canon) = path.canonicalize() {
        if !canon.starts_with(model_root.canonicalize().unwrap()) {
            let _ = req.respond(Response::from_string("Forbidden").with_status_code(403));
            return;
        }
    }

    // 读取文件
    match std::fs::read(&path) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let mut resp = Response::from_data(bytes);
            resp.add_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_ref()).unwrap());
            // 允许跨源（前端是 http://localhost）
            resp.add_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
            let _ = req.respond(resp);
        }
        Err(_) => {
            let _ = req.respond(Response::from_string("Not Found").with_status_code(404));
        }
    }
}

/// 扫描模型目录并生成 models.json
fn scan_models_dir(models_dir: &PathBuf) -> Result<Vec<ModelEntry>, String> {
    let mut models = Vec::new();
    
    // 遍历 model/ 下的所有子目录
    for entry in std::fs::read_dir(models_dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("遍历目录失败: {}", e))?;
        let path = entry.path();
        
        if path.is_dir() {
            // 在每个子目录中查找 model.json
            let model_json_path = path.join("model.json");
            if model_json_path.exists() {
                let label = path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                
                models.push(ModelEntry {
                    label: format!("{}/model.json", label),
                    path: format!("{}/model.json", label),
                });
            }
        }
    }
    
    // 按名称排序
    models.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(models)
}

/// 生成并保存 models.json
fn generate_models_json(models_dir: &PathBuf) -> Result<(), String> {
    let models = scan_models_dir(models_dir)?;
    let models_json_path = models_dir.join("models.json");
    
    // 转换为前端需要的格式（字符串数组）
    let model_paths: Vec<String> = models.into_iter().map(|m| m.path).collect();
    
    let json_content = serde_json::to_string_pretty(&model_paths)
        .map_err(|e| format!("序列化失败: {}", e))?;
    
    std::fs::write(&models_json_path, json_content)
        .map_err(|e| format!("写入 models.json 失败: {}", e))?;
    
    Ok(())
}

/// 获取模型服务器信息
#[tauri::command]
pub fn get_model_server_info() -> Result<ModelServerInfo, String> {
    let base_dir = exe_dir();
    let model_dir = base_dir.join("model");
    
    // 确保 model 目录存在
    if !model_dir.exists() {
        std::fs::create_dir_all(&model_dir)
            .map_err(|e| format!("创建 model 目录失败: {}", e))?;
    }
    
    // 使用静态变量缓存端口号
    static PORT: OnceLock<u16> = OnceLock::new();
    let port = *PORT.get_or_init(|| start_static_server(model_dir.clone()));
    
    Ok(ModelServerInfo {
        base_url: format!("http://127.0.0.1:{}/model", port),
        models_dir: model_dir.to_string_lossy().into(),
    })
}

/// 刷新模型索引
#[tauri::command]
pub fn refresh_model_index() -> Result<Vec<String>, String> {
    let base_dir = exe_dir();
    let model_dir = base_dir.join("model");
    
    // 生成新的 models.json
    generate_models_json(&model_dir)?;
    
    // 返回模型列表
    let models = scan_models_dir(&model_dir)?;
    Ok(models.into_iter().map(|m| m.path).collect())
} 