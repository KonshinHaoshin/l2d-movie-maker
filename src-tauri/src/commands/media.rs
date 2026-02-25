use std::process::Command;
use std::path::PathBuf;
use serde::Deserialize;

/// 设置文件系统作用域
#[tauri::command]
pub async fn set_fs_scope(path: String, recursive: bool) -> Result<(), String> {
    // 这里我们只是记录路径，实际的权限控制由 Tauri 的 capabilities 系统处理
    println!("设置文件系统作用域: {} (递归: {})", path, recursive);
    
    // 验证路径是否存在
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    
    if !path_buf.is_dir() {
        return Err(format!("路径不是目录: {}", path));
    }
    
    Ok(())
}

/// VP9(WebM + alpha) → MOV(ProRes 4444, 真透明)
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

    let st = Command::new("ffmpeg")
        .args(args)
        .status()
        .map_err(|e| format!("调用 ffmpeg 失败：{e}"))?;

    if !st.success() {
        return Err("ffmpeg: 转 ProRes 4444 失败".into());
    }
    Ok(())
}

/// MOV(ProRes 4444) → WebM(VP9 + alpha)
#[tauri::command]
pub async fn mov_to_webm_alpha(in_mov: String, out_webm: String, crf: u8, pix_fmt: String) -> Result<(), String> {
    // 建议 pix_fmt 传 "yuva420p"（带 alpha）
    let args = vec![
        "-y".into(),
        "-i".into(), in_mov,
        "-c:v".into(), "libvpx-vp9".into(),
        "-pix_fmt".into(), pix_fmt,     // 例如 "yuva420p"
        "-b:v".into(), "0".into(),      // CRF 模式
        "-crf".into(), crf.to_string(), // 质量
        "-row-mt".into(), "1".into(),   // 多线程
        out_webm,
    ];

    let st = Command::new("ffmpeg")
        .args(args)
        .status()
        .map_err(|e| format!("调用 ffmpeg 失败：{e}"))?;

    if !st.success() {
        return Err("ffmpeg: 转 WebM 失败".into());
    }
    Ok(())
}

/// 任何带 alpha 的输入（mov/webm）→ MP4（铺底，无透明）
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
    // color 先生成最小画布，再用 scale2ref 匹配输入尺寸，最后 overlay
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

    let st = Command::new("ffmpeg")
        .args(args)
        .status()
        .map_err(|e| format!("调用 ffmpeg 失败：{e}"))?;

    if !st.success() {
        return Err("ffmpeg: 转 MP4 失败".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct AudioManifestItem {
    id: String,
    path: String,
    startSec: f64,
    endSec: f64,
    gain: f64,
}

/// PNG 序列 -> WebM(VP9 + alpha), 可选混音音轨
#[tauri::command]
pub async fn encode_png_sequence_to_webm_alpha(
    frame_dir: String,
    pattern: String,
    out_webm: String,
    fps: u32,
    audio_manifest_json: Option<String>,
) -> Result<(), String> {
    let fps = if fps == 0 { 1 } else { fps };
    let frame_path = PathBuf::from(&frame_dir).join(&pattern);

    let mut args: Vec<String> = Vec::new();
    args.push("-y".into());
    args.push("-framerate".into());
    args.push(fps.to_string());
    args.push("-start_number".into());
    args.push("1".into());
    args.push("-i".into());
    args.push(frame_path.to_string_lossy().to_string());

    let mut manifest: Vec<AudioManifestItem> = Vec::new();
    if let Some(json) = audio_manifest_json {
        if !json.trim().is_empty() {
            manifest = serde_json::from_str(&json)
                .map_err(|e| format!("解析音频清单失败: {e}"))?;
        }
    }

    for item in &manifest {
        args.push("-i".into());
        args.push(item.path.clone());
    }

    if !manifest.is_empty() {
        let mut filters: Vec<String> = Vec::new();
        let mut mix_inputs: Vec<String> = Vec::new();

        for (idx, item) in manifest.iter().enumerate() {
            let input_index = idx + 1; // 0 是视频输入
            let start = item.startSec.max(0.0);
            let end = item.endSec.max(start);
            let dur = (end - start).max(0.0);
            if dur <= 0.0 {
                continue;
            }
            let delay_ms = (start * 1000.0).round() as i64;
            let gain = item.gain;
            let tag = format!("a{}", idx);

            // [i:a]atrim=0:dur,asetpts,adelay=ms|ms,volume=gain[aN]
            filters.push(format!(
                "[{}:a]atrim=start=0:duration={:.6},asetpts=PTS-STARTPTS,adelay={}:{},volume={:.3}[{}]",
                input_index,
                dur,
                delay_ms,
                delay_ms,
                gain,
                tag
            ));
            mix_inputs.push(format!("[{}]", tag));
        }

        let mix_count = mix_inputs.len();
        if mix_count > 0 {
            filters.push(format!(
                "{}amix=inputs={}:normalize=0[aout]",
                mix_inputs.join(""),
                mix_count
            ));

            args.push("-filter_complex".into());
            args.push(filters.join(";"));
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[aout]".into());
            args.push("-c:a".into());
            args.push("libopus".into());
            args.push("-b:a".into());
            args.push("192k".into());
        }
    }

    args.push("-c:v".into());
    args.push("libvpx-vp9".into());
    args.push("-pix_fmt".into());
    args.push("yuva420p".into());
    args.push("-b:v".into());
    args.push("0".into());
    args.push("-crf".into());
    args.push("20".into());
    args.push("-row-mt".into());
    args.push("1".into());
    if manifest.is_empty() {
        args.push("-an".into());
    } else {
        args.push("-shortest".into());
    }
    args.push(out_webm);

    let st = Command::new("ffmpeg")
        .args(args)
        .status()
        .map_err(|e| format!("调用 ffmpeg 失败：{e}"))?;

    if !st.success() {
        return Err("ffmpeg: 编码 WebM 失败".into());
    }
    Ok(())
}
