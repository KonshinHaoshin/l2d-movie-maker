// src-tauri/src/commands/models.rs
use std::fs;
use std::path::{Path, PathBuf};

use glob::glob;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ModelEntry {
    /// 相对 root 的展示路径，例如 "tomori/casual-2023/model.json"
    pub label: String,
    /// 绝对路径（前端用 convertFileSrc 转 URL）
    pub abs_path: String,
    /// "json" | "jsonl"
    pub kind: String,
}

#[tauri::command]
pub fn find_live2d_models(root: String) -> Result<Vec<ModelEntry>, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("路径 '{}' 不是目录", root.display()));
    }

    let files = get_json_and_jsonl(&root)?;
    let model_files = filter_model_like(&files)?;

    let mut out: Vec<ModelEntry> = model_files
        .into_iter()
        .map(|file| {
            let kind = file
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let label = file
                .strip_prefix(&root)
                .unwrap_or(&file)
                .to_string_lossy()
                .replace('\\', "/");

            ModelEntry {
                label,
                abs_path: file.to_string_lossy().into_owned(),
                kind,
            }
        })
        .collect();

    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(out)
}

/// 收集 .json / .jsonl（忽略 *.exp.json），递归遍历
fn get_json_and_jsonl(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let pat = format!("{}/**/*", dir.display());
    let mut out = Vec::new();

    for entry in glob(&pat).map_err(|e| format!("glob 失败: {e}"))? {
        let path = entry.map_err(|e| format!("遍历失败: {e}"))?;
        if path.is_dir() {
            continue;
        }
        let is_json = path.extension().map(|e| e == "json").unwrap_or(false);
        let is_jsonl = path.extension().map(|e| e == "jsonl").unwrap_or(false);
        if !is_json && !is_jsonl {
            continue;
        }

        // 忽略 *.exp.json
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.ends_with(".exp.json") {
            continue;
        }

        out.push(path);
    }

    Ok(out)
}

/// 过滤出“看起来像 Live2D 模型”的文件：
/// - .json：
///     - Cubism2 旧格式：含 "model" 且 "textures"（数组）
///     - Cubism3/4：FileReferences.Moc 存在 且 FileReferences.Textures 为非空数组
/// - .jsonl：任意一行 parse 成 JSON 且含 "model"；或者行中含 "motions"/"expressions"（拼好模汇总）
///   （我们只用于清单展示，前端仍只加载 .json）
fn filter_model_like(files: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();

    'each: for file in files {
        let is_jsonl = file.extension().map(|e| e == "jsonl").unwrap_or(false);
        let text = fs::read_to_string(file)
            .map_err(|e| format!("读取 '{}' 失败: {}", file.display(), e))?;

        if is_jsonl {
            for line in text.lines() {
                let l = line.trim();
                if l.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(l) {
                    if v.get("model").is_some()
                        || v.get("motions").is_some()
                        || v.get("expressions").is_some()
                    {
                        out.push(file.clone());
                        continue 'each;
                    }
                }
            }
            // 没匹配就丢弃
            continue;
        }

        // .json：尝试解析
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            // 旧格式（Cubism2）
            let old_ok = v.get("model").is_some()
                && v.get("textures")
                    .and_then(|t| t.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false);

            // Cubism3/4 (.model3.json)
            let fr = v.get("FileReferences");
            let c34_ok = fr
                .and_then(|fr| fr.get("Moc"))
                .is_some()
                && fr.and_then(|fr| fr.get("Textures"))
                    .and_then(|t| t.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false);

            if old_ok || c34_ok {
                out.push(file.clone());
            }
        }
    }

    Ok(out)
}
