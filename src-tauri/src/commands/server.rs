// src-tauri/src/commands/server.rs
use std::{path::{Path, PathBuf}, thread, sync::OnceLock, fs};
use serde::Serialize;
use serde_json::Value;
use tiny_http::{Server, Response, Request};
use mime_guess;
use urlencoding;


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

    // 去掉开头的 /model/，获取相对路径
    let rel = url.strip_prefix("/model/").unwrap_or("");
    
    // 对相对路径进行URL解码，处理中文字符等非ASCII字符
    let decoded_rel = match urlencoding::decode(rel) {
        Ok(decoded) => decoded,
        Err(_) => {
            let _ = req.respond(Response::from_string("Invalid URL encoding").with_status_code(400));
            return;
        }
    };
    
    let path = model_root.join(&*decoded_rel);

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
    
    // 递归扫描所有子目录
    scan_directory_recursive(models_dir, models_dir, &mut models, false)?;
    
    // 按名称排序
    models.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(models)
}

/// 递归扫描目录，查找Live2D模型文件和.jsonl文件
fn scan_directory_recursive(
    current_dir: &Path,
    base_dir: &Path,
    models: &mut Vec<ModelEntry>,
    mut skip_json_in_tree: bool,   // 新增：是否在这棵子树内忽略 .json
) -> Result<(), String> {
    // 先看当前目录是否有 jsonl，有则标记
    if !skip_json_in_tree {
        for e in fs::read_dir(current_dir).map_err(|e| format!("读取目录失败: {}", e))? {
            let p = e.map_err(|e| format!("遍历目录失败: {}", e))?.path();
            if p.is_file() && p.extension().and_then(|x| x.to_str()).map(|s| s.eq_ignore_ascii_case("jsonl")).unwrap_or(false) {
                skip_json_in_tree = true;
                break;
            }
        }
    }

    for entry in fs::read_dir(current_dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("遍历目录失败: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            // 子目录继承 skip_json_in_tree
            scan_directory_recursive(&path, base_dir, models, skip_json_in_tree)?;
            continue;
        }

        if !path.is_file() { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

        match ext.as_str() {
            "jsonl" => {
                if is_valid_jsonl_file(&path)? {
                    let relative = path.strip_prefix(base_dir).map_err(|e| format!("路径处理失败: {}", e))?
                        .to_string_lossy().replace('\\', "/");
                    let label = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
                    models.push(ModelEntry { label: format!("{} (JSONL)", label), path: relative });
                }
            }
            "json" => {
                if skip_json_in_tree { continue; } // 关键：该树已发现 jsonl，就忽略 .json

                if is_live2d_model_file(&path)? {
                    let relative = path.strip_prefix(base_dir).map_err(|e| format!("路径处理失败: {}", e))?
                        .to_string_lossy().replace('\\', "/");
                    let label = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
                    models.push(ModelEntry { label: format!("{} ({})", label, relative), path: relative });
                }
            }
            "moc" | "moc3" => {
                if skip_json_in_tree { continue; } // 同理：避免把它匹配到的 config.json 又加回来
                if let Some(cfg) = find_model_config_for_moc(&path)? {
                    let relative = cfg.strip_prefix(base_dir).map_err(|e| format!("路径处理失败: {}", e))?
                        .to_string_lossy().replace('\\', "/");
                    let label = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
                    models.push(ModelEntry { label: format!("{} (MOC)", label), path: relative });
                }
            }
            _ => {}
        }
    }
    Ok(())
}


/// 检查文件是否为Live2D模型文件
fn is_live2d_model_file(file_path: &Path) -> Result<bool, String> {
    // 文件大小限制（10MB）
    let metadata = fs::metadata(file_path)
        .map_err(|e| format!("获取文件元数据失败: {}", e))?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Ok(false);
    }
    
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    
    // 尝试解析JSON
    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("JSON解析失败: {}", e))?;
    
    // Cubism2格式：包含"model"和"textures"字段
    if json.get("model").is_some() && 
       json.get("textures").and_then(|t| t.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
        return Ok(true);
    }
    
    // Cubism3/4格式：包含"FileReferences.Moc"字段
    if let Some(file_refs) = json.get("FileReferences") {
        if file_refs.get("Moc").is_some() {
            return Ok(true);
        }
    }
    
    Ok(false)
}

/// 检查.jsonl文件是否有效
fn is_valid_jsonl_file(file_path: &Path) -> Result<bool, String> {
    // 文件大小限制（5MB）
    let metadata = fs::metadata(file_path)
        .map_err(|e| format!("获取文件元数据失败: {}", e))?;
    if metadata.len() > 5 * 1024 * 1024 {
        return Ok(false);
    }
    
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    
    let lines: Vec<&str> = content.lines().filter(|line| !line.trim().is_empty()).collect();
    if lines.is_empty() {
        return Ok(false);
    }
    
    // 检查是否包含有效的JSON行
    let mut has_valid_line = false;
    for line in lines {
        if let Ok(json) = serde_json::from_str::<Value>(line) {
            // 检查是否包含模型相关字段
            if json.get("path").is_some() || 
               json.get("motions").is_some() || 
               json.get("expressions").is_some() ||
               json.get("model").is_some() {
                has_valid_line = true;
                break;
            }
        }
    }
    
    Ok(has_valid_line)
}

/// 为.moc文件查找对应的配置文件
fn find_model_config_for_moc(moc_path: &Path) -> Result<Option<PathBuf>, String> {
    let parent_dir = moc_path.parent().ok_or("无法获取父目录")?;
    
    // 查找同目录下的配置文件
    for entry in fs::read_dir(parent_dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("遍历目录失败: {}", e))?;
        let path = entry.path();
        
        if path.is_file() {
            if let Some(extension) = path.extension() {
                let ext = extension.to_string_lossy().to_lowercase();
                if ext == "json" && is_live2d_model_file(&path)? {
                    return Ok(Some(path));
                }
            }
        }
    }
    
    Ok(None)
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