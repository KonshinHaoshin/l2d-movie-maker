use std::fs;
use std::path::{Path, PathBuf};
use std::collections::BTreeSet;

use serde::Serialize;

#[derive(Serialize)]
pub struct WebGALProjectValidation {
    pub project_root: String,
    pub figure_root: String,
    pub adjusted_from_game_dir: bool,
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn webgal_path_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

#[tauri::command]
pub fn webgal_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("读取文件失败 '{}': {}", path, error))
}

#[tauri::command]
pub fn validate_webgal_project_dir(path: String) -> Result<WebGALProjectValidation, String> {
    let selected = PathBuf::from(&path);
    if !selected.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if !selected.is_dir() {
        return Err(format!("路径不是目录: {}", path));
    }

    let direct_figure_root = selected.join("game").join("figure");
    if direct_figure_root.is_dir() {
        return Ok(WebGALProjectValidation {
            project_root: path_to_string(&selected),
            figure_root: path_to_string(&direct_figure_root),
            adjusted_from_game_dir: false,
        });
    }

    let selected_name = selected
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    if selected_name.as_deref() == Some("game") {
        let figure_root = selected.join("figure");
        if figure_root.is_dir() {
            let project_root = selected
                .parent()
                .ok_or_else(|| format!("无法从 '{}' 推导项目根目录", path))?
                .to_path_buf();

            return Ok(WebGALProjectValidation {
                project_root: path_to_string(&project_root),
                figure_root: path_to_string(&figure_root),
                adjusted_from_game_dir: true,
            });
        }
    }

    if selected_name.as_deref() == Some("figure") {
        let game_dir = selected
            .parent()
            .ok_or_else(|| format!("无法从 '{}' 推导 game 目录", path))?;
        let game_name = game_dir
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());

        if game_name.as_deref() == Some("game") {
            let project_root = game_dir
                .parent()
                .ok_or_else(|| format!("无法从 '{}' 推导项目根目录", path))?
                .to_path_buf();

            return Ok(WebGALProjectValidation {
                project_root: path_to_string(&project_root),
                figure_root: path_to_string(&selected),
                adjusted_from_game_dir: true,
            });
        }
    }

    Err("所选目录缺少 game/figure；请选择项目根目录，或直接选择 game 目录".to_string())
}

#[tauri::command]
pub fn list_system_font_families() -> Result<Vec<String>, String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();
    for face in database.faces() {
        for (family_name, _) in &face.families {
            let trimmed = family_name.trim();
            if !trimmed.is_empty() {
                families.insert(trimmed.to_string());
            }
        }
    }

    Ok(families.into_iter().collect())
}
