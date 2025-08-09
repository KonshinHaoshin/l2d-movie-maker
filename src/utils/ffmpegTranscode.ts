// src/utils/ffmpegTranscode.ts
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg() {
    if (!ffmpeg) {
        ffmpeg = new FFmpeg();
        // 可自定义核心文件地址：await ffmpeg.load({ coreURL, wasmURL, workerURL })
        await ffmpeg.load();
    }
    return ffmpeg;
}

export type OutFormat = "webm" | "mp4" | "mov";

type TranscodeOptions = {
    crf?: number;      // x264 质量 (0-51, 越小越清晰) 默认 23
    preset?: string;   // x264 速度/压缩比 ('ultrafast'...'veryslow') 默认 veryfast
};

export async function transcodeWebM(
    webm: Blob,
    fmt: OutFormat,
    opts: TranscodeOptions = {}
): Promise<Blob> {
    const ff = await getFFmpeg();
    const inputName = "in.webm";
    const data = await fetchFile(webm);
    await ff.writeFile(inputName, data);

    let out = "";
    if (fmt === "mp4") {
        out = "out.mp4";
        const crf = String(opts.crf ?? 23);
        const preset = String(opts.preset ?? "veryfast");
        await ff.exec([
            "-i", inputName,
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", crf,
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            out,
        ]);
        const bytes = await ff.readFile(out);
        return new Blob([bytes], { type: "video/mp4" });
    } else if (fmt === "mov") {
        out = "out.mov";
        // 方案A：ProRes（剪辑友好、体积大）
        // await ff.exec(["-i", inputName, "-c:v", "prores", "-profile:v", "3", out]);

        // 方案B：H.264（体积小、通用）
        await ff.exec([
            "-i", inputName,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            out,
        ]);
        const bytes = await ff.readFile(out);
        return new Blob([bytes], { type: "video/quicktime" });
    } else {
        // webm：基本不需要转码，直接 copy 或直接用原始 webm
        out = "out.webm";
        await ff.exec(["-i", inputName, "-c", "copy", out]);
        const bytes = await ff.readFile(out);
        return new Blob([bytes], { type: "video/webm" });
    }
}
