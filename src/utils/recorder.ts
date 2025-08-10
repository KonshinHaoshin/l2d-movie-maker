// src/utils/recorder.ts
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export function isVp9AlphaSupported() {
    return !!(window as any).MediaRecorder?.isTypeSupported?.("video/webm;codecs=vp9");
}

export function pickVp9Mime(): string | null {
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8"; // 先试 VP8
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
    return "video/webm";
}

export function createVp9AlphaRecorder(
    canvas: HTMLCanvasElement,
    fps = 60,
    kbps = 16000,
) {
    let mr: MediaRecorder | null = null;
    let chunks: BlobPart[] = [];
    let ac: AudioContext | null = null;
    let cs: ConstantSourceNode | null = null;

    function makeStream(): MediaStream {
        const s = canvas.captureStream(fps);
        console.log("[rec] captureStream fps=", fps, "tracks=", s.getTracks().map(t => t.kind));
        // 加一条静音音轨，避免部分实现不产块
        try {
            ac = new AudioContext();
            cs = ac.createConstantSource();
            const g = ac.createGain();
            g.gain.value = 0;
            const dest = ac.createMediaStreamDestination();
            cs.connect(g).connect(dest);
            cs.start();
            const at = dest.stream.getAudioTracks()[0];
            if (at) s.addTrack(at);
            console.log("[rec] added silent audio track");
        } catch (e) {
            console.warn("[rec] audio track add failed (ok to ignore):", e);
        }
        return s;
    }

    function start() {
        const mime = pickVp9Mime();
        if (!mime) throw new Error("VP9/VP8 WebM not supported");
        const stream = makeStream();
        chunks = [];
        mr = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: kbps * 1000,
        });
        mr.onerror = (e) => console.error("[rec] MediaRecorder error:", e);
        // mr.onwarning = (e) => console.warn("[rec] MediaRecorder warning:", e);
        mr.ondataavailable = (e) => {
            if (e.data && e.data.size) {
                chunks.push(e.data);
            }
        };
        mr.onstart = () => console.log("[rec] started", mime);
        mr.onstop = () => console.log("[rec] stopped, chunks:", chunks.length);
        // 用 timeslice 让实现周期性产块，更稳
        mr.start(250); // 每 250ms 产出一块
    }

    function stop(): Promise<Blob> {
        return new Promise((resolve) => {
            if (!mr) return resolve(new Blob());
            // 先请求一次数据，确保最后一块吐出来
            try { mr.requestData(); } catch {}
            mr.onstop = () => {
                const blob = new Blob(chunks, { type: mr!.mimeType });
                cleanup();
                console.log("[rec] blob size:", blob.size);
                resolve(blob);
            };
            mr.stop();
        });
    }

    function cleanup() {
        try { cs?.stop(); } catch {}
        try { ac?.close(); } catch {}
        mr = null; cs = null; ac = null;
    }

    async function saveWebM(blob: Blob, defaultName = "export-alpha.webm") {
        const out = await save({ defaultPath: defaultName, filters: [{ name: "WebM", extensions: ["webm"] }] });
        if (!out) return;
        await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    }

    return { start, stop, cleanup, saveWebM };
}
