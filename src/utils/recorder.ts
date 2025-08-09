// src/utils/recorder.ts  —— Tauri v2
// 功能：抓取 PNG 帧（含 alpha）到 AppCache / 选择保存位置 / 调用后端 ffmpeg 编码

import { writeFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

export type PngFrameRecorder = {
    start: (subdir?: string) => Promise<{ tempSubdir: string }>;
    stop: () => Promise<{ tempSubdir: string; frames: number }>;
    readonly tempSubdir: string;
};

export function createPngFrameRecorder(canvas: HTMLCanvasElement, fps = 30): PngFrameRecorder {
    let running = false;
    let timer: number | null = null;
    let idx = 0;
    let subdir = "";

    async function grab() {
        if (!running) return;
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
        const buf = new Uint8Array(await blob.arrayBuffer());
        const name = `frame-${String(idx).padStart(6, "0")}.png`;
        await writeFile(`${subdir}/${name}`, buf, { baseDir: BaseDirectory.AppCache });
        idx++;
        const delay = Math.max(0, 1000 / fps);
        timer = window.setTimeout(grab, delay);
    }

    return {
        async start(prefix = "alpha_record") {
            subdir = `${prefix}-${Date.now()}`;
            await mkdir(subdir, { baseDir: BaseDirectory.AppCache, recursive: true });
            running = true; idx = 0; grab();
            return { tempSubdir: subdir };
        },
        async stop() {
            running = false;
            if (timer) { clearTimeout(timer); timer = null; }
            return { tempSubdir: subdir, frames: idx };
        },
        get tempSubdir() { return subdir; }
    };
}

// 取得绝对路径（传给 Rust 端）
export async function getTempAbsDir(tempSubdir: string) {
    const base = await appCacheDir();
    return join(base, tempSubdir);
}

// 选择导出：WebM（VP9+Alpha）
export async function pickAndEncodeWebMAlpha(tempSubdir: string, fps = 30) {
    const out = await save({
        defaultPath: "export-alpha.webm",
        filters: [{ name: "WebM", extensions: ["webm"] }],
    });
    if (!out) return;
    const abs = await getTempAbsDir(tempSubdir);
    await invoke("encode_alpha_video", {
        tempDirAbs: abs,
        fps,
        outWebm: out,
        outMov: null,
    });
}

// 选择导出：MOV（ProRes 4444）
export async function pickAndEncodeProRes4444(tempSubdir: string, fps = 30) {
    const out = await save({
        defaultPath: "export-4444.mov",
        filters: [{ name: "MOV", extensions: ["mov"] }],
    });
    if (!out) return;
    const abs = await getTempAbsDir(tempSubdir);
    await invoke("encode_alpha_video", {
        tempDirAbs: abs,
        fps,
        outWebm: null,
        outMov: out,
    });
}
