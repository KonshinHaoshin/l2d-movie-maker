// src-tauri/src/commands.rs
use std::process::Command;

#[tauri::command]
pub async fn encode_alpha_video(
    temp_dir_abs: String,
    fps: u32,
    out_webm: Option<String>,
    out_mov: Option<String>,
) -> Result<(), String> {
    // WebM (VP9 + alpha)
    if let Some(path) = out_webm {
        let st = Command::new("ffmpeg")
            .args([
                "-y",
                "-framerate", &fps.to_string(),
                "-i", &format!("{}/frame-%06d.png", temp_dir_abs),
                "-c:v", "libvpx-vp9",
                "-pix_fmt", "yuva420p",
                "-b:v", "0", "-crf", "20",
                "-deadline", "good",
                &path,
            ])
            .status().map_err(|e| e.to_string())?;
        if !st.success() { return Err("ffmpeg vp9 encode failed".into()); }
    }

    // MOV (ProRes 4444)
    if let Some(path) = out_mov {
        let st = Command::new("ffmpeg")
            .args([
                "-y",
                "-framerate", &fps.to_string(),
                "-i", &format!("{}/frame-%06d.png", temp_dir_abs),
                "-c:v", "prores_ks",
                "-profile:v", "4444",
                "-pix_fmt", "yuva444p10le",
                &path,
            ])
            .status().map_err(|e| e.to_string())?;
        if !st.success() { return Err("ffmpeg prores encode failed".into()); }
    }

    Ok(())
}

#[tauri::command]
pub fn get_model_path(model_name: String) -> Result<String, String> {
    Ok(format!("/model/{}/model.json", model_name))
}