use std::process::Command;

// VP9(WebM + alpha) → MOV(ProRes 4444, 真透明)
#[tauri::command]
pub async fn vp9_to_prores4444(in_webm: String, out_mov: String) -> Result<(), String> {
    let args = vec![
        "-y".into(),
        "-i".into(), in_webm,
        "-c:v".into(), "prores_ks".into(),
        "-profile:v".into(), "4444".into(),
        "-pix_fmt".into(), "yuva444p10le".into(),
        out_mov,
    ];
    let st = Command::new("ffmpeg").args(args).status().map_err(|e| e.to_string())?;
    if !st.success() { return Err("ffmpeg: 转 ProRes 4444 失败".into()); }
    Ok(())
}

// MOV(ProRes 4444) → WebM(VP9 + alpha)
#[tauri::command]
pub async fn mov_to_webm_alpha(in_mov: String, out_webm: String, crf: u8, pix_fmt: String) -> Result<(), String> {
    let args = vec![
        "-y".into(),
        "-i".into(), in_mov,
        "-c:v".into(), "libvpx-vp9".into(),
        "-pix_fmt".into(), pix_fmt,     // 建议 "yuva420p"
        "-b:v".into(), "0".into(),      // CRF 模式
        "-crf".into(), crf.to_string(), // 质量
        "-row-mt".into(), "1".into(),   // 多线程
        out_webm,
    ];
    let st = Command::new("ffmpeg").args(args).status().map_err(|e| e.to_string())?;
    if !st.success() { return Err("ffmpeg: 转 WebM 失败".into()); }
    Ok(())
}

// 任何带 alpha 的输入（mov/webm）→ MP4（铺底，无透明）
#[tauri::command]
pub async fn alpha_to_mp4_flatten(
    in_path: String,
    out_mp4: String,
    bg_hex: String,   // "#000000"
    crf: u8,          // 18~23
    preset: String,   // "ultrafast".."veryslow"
) -> Result<(), String> {
    // 纯色铺底，尺寸自适配
    let bg = if bg_hex.starts_with('#') { bg_hex } else { format!("#{}", bg_hex) };
    let vf = format!("color=c={}:s=16x16[bg];[bg][0:v]scale2ref[bg2][v2];[bg2][v2]overlay", bg);

    let args = vec![
        "-y".into(),
        "-i".into(), in_path,
        "-filter_complex".into(), vf,
        "-c:v".into(), "libx264".into(),
        "-crf".into(), crf.to_string(),
        "-preset".into(), preset,
        "-pix_fmt".into(), "yuv420p".into(),
        out_mp4,
    ];
    let st = Command::new("ffmpeg").args(args).status().map_err(|e| e.to_string())?;
    if !st.success() { return Err("ffmpeg: 转 MP4 失败".into()); }
    Ok(())
}
