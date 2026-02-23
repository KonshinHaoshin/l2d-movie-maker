// src/utils/recorder.ts
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export function isVp9AlphaSupported() {
  return !!(window as any).MediaRecorder?.isTypeSupported?.("video/webm;codecs=vp9");
}

export function pickVp9Mime(): string | null {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8";
  if (MediaRecorder.isTypeSupported("video/webm")) return "video/webm";
  return null;
}

// 音频管理器
function createAudioManager(
  ac: AudioContext,
  audioDestination: MediaStreamAudioDestinationNode,
  audioClips?: Array<{ id: string; start: number; duration: number; audioUrl: string }>
) {
  const audioElements = new Map<string, HTMLAudioElement>();
  let cs: ConstantSourceNode | null = null;

  function setupAudioTracks(): boolean {
    if (audioClips && audioClips.length > 0) {
      audioClips.forEach(clip => {
        try {
          const audio = new Audio(clip.audioUrl);
          audio.preload = 'auto';
          audio.volume = 0.8;
          const source = ac.createMediaElementSource(audio);
          source.connect(audioDestination);
          audioElements.set(clip.id, audio);
        } catch (error) {
          console.warn(`[rec] audio track ${clip.id} failed:`, error);
        }
      });
      return true;
    } else {
      cs = ac.createConstantSource();
      const g = ac.createGain();
      g.gain.value = 0;
      cs.connect(g).connect(audioDestination);
      cs.start();
      return false;
    }
  }

  function startAudioPlayback(sortedClips: Array<{ id: string; start: number; duration: number }>) {
    sortedClips.forEach((clip) => {
      const audio = audioElements.get(clip.id);
      if (audio) {
        setTimeout(() => {
          try {
            audio.currentTime = 0;
            audio.play().catch(() => {});
            setTimeout(() => {
              try { audio.pause(); audio.currentTime = 0; } catch (e) {}
            }, clip.duration * 1000);
          } catch (e) {}
        }, clip.start * 1000);
      }
    });
  }

  function stopAllAudio() {
    audioElements.forEach(audio => {
      try { audio.pause(); audio.currentTime = 0; } catch (e) {}
    });
  }

  function cleanup() {
    try { cs?.stop(); } catch {}
    audioElements.forEach(audio => {
      try { audio.pause(); audio.src = ''; } catch (e) {}
    });
    audioElements.clear();
  }

  return { setupAudioTracks, startAudioPlayback, stopAllAudio, cleanup };
}

// 全屏录制器
export function createVp9AlphaRecorder(
  canvas: HTMLCanvasElement,
  fps = 60,
  kbps = 16000,
  options?: {
    onProgress?: (time: number) => void;
    audioClips?: Array<{ id: string; start: number; duration: number; audioUrl: string }>;
  }
) {
  let mr: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let ac: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let recordingStartTime = 0;
  let progressInterval: number | null = null;
  let audioManager: ReturnType<typeof createAudioManager> | null = null;

  function makeStream(): MediaStream {
    canvas.style.background = 'transparent';
    const s = canvas.captureStream(fps);
    try {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      audioManager = createAudioManager(ac, dest, options?.audioClips);
      audioManager.setupAudioTracks();
      const at = dest.stream.getAudioTracks()[0];
      if (at) s.addTrack(at);
    } catch (e) {
      console.warn("[rec] audio setup failed:", e);
    }
    stream = s;
    return s;
  }

  function start() {
    const mime = pickVp9Mime();
    if (!mime) throw new Error("VP9/VP8 WebM not supported");
    const s = makeStream();
    chunks = [];
    recordingStartTime = Date.now();
    mr = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: kbps * 1000 });
    mr.onerror = (e) => console.error("[rec] error:", e);
    mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    mr.onstart = () => {
      console.log("[rec] started", mime);
      if (options?.onProgress) {
        progressInterval = window.setInterval(() => {
          options.onProgress!((Date.now() - recordingStartTime) / 1000);
        }, 100);
      }
      if (options?.audioClips?.length && audioManager) {
        audioManager.startAudioPlayback([...options.audioClips].sort((a, b) => a.start - b.start));
      }
    };
    mr.onstop = () => {
      console.log("[rec] stopped, chunks:", chunks.length);
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      audioManager?.stopAllAudio();
    };
    mr.start(250);
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!mr) return resolve(new Blob());
      try { mr.requestData(); } catch {}
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr!.mimeType });
        cleanup();
        resolve(blob);
      };
      mr.stop();
    });
  }

  function cleanup() {
    audioManager?.cleanup();
    try { ac?.close(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    if (progressInterval) clearInterval(progressInterval);
    mr = null; ac = null; stream = null; audioManager = null;
  }

  async function saveWebM(blob: Blob, defaultName = "export.webm") {
    const out = await save({ defaultPath: defaultName, filters: [{ name: "WebM", extensions: ["webm"] }] });
    if (!out) return;
    await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
  }

  function getRecordingTime() { return recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0; }
  function isRecording() { return mr?.state === "recording"; }

  return { start, stop, cleanup, saveWebM, getRecordingTime, isRecording };
}

// 模型区域录制器 - 支持音频+透明背景
export function createModelFrameRecorder(
  canvas: HTMLCanvasElement,
  modelBounds: { x: number; y: number; width: number; height: number },
  fps = 60,
  kbps = 16000,
  options?: {
    onProgress?: (time: number) => void;
    transparent?: boolean;
    showFrame?: boolean;
    audioClips?: Array<{ id: string; start: number; duration: number; audioUrl: string }>;
  }
) {
  let mr: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let ac: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let recordingStartTime = 0;
  let progressInterval: number | null = null;
  let rafId: number | null = null;
  let audioManager: ReturnType<typeof createAudioManager> | null = null;

  const cropCanvas = document.createElement('canvas');
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) throw new Error("Failed to get 2d context");
  cropCanvas.width = modelBounds.width;
  cropCanvas.height = modelBounds.height;

  let frameEl: HTMLDivElement | null = null;
  if (options?.showFrame) {
    frameEl = document.createElement('div');
    frameEl.style.cssText = `position:fixed;border:2px solid #ff0000;pointer-events:none;z-index:9999;left:${modelBounds.x}px;top:${modelBounds.y}px;width:${modelBounds.width}px;height:${modelBounds.height}px;`;
    document.body.appendChild(frameEl);
  }

  function makeStream(): MediaStream {
    const s = cropCanvas.captureStream(fps);
    try {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      audioManager = createAudioManager(ac, dest, options?.audioClips);
      audioManager.setupAudioTracks();
      const at = dest.stream.getAudioTracks()[0];
      if (at) s.addTrack(at);
    } catch (e) {
      console.warn("[rec] audio setup failed:", e);
    }
    stream = s;
    return s;
  }

  function drawCrop() {
    if (mr?.state !== 'recording') return;
    if (!cropCtx) throw new Error("crop context not available");
    // 透明背景
    if (options?.transparent !== false) {
      cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    }
    // 从源 canvas 复制区域
    cropCtx.drawImage(
      canvas,
      modelBounds.x, modelBounds.y, modelBounds.width, modelBounds.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );
  }

  function start() {
    const mime = pickVp9Mime();
    if (!mime) throw new Error("VP9/VP8 WebM not supported");
    makeStream();
    chunks = [];
    recordingStartTime = Date.now();
    mr = new MediaRecorder(stream!, { mimeType: mime, videoBitsPerSecond: kbps * 1000 });
    mr.onerror = (e) => console.error("[rec] error:", e);
    mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    mr.onstart = () => {
      console.log("[rec] crop recording started", mime);
      if (options?.onProgress) {
        progressInterval = window.setInterval(() => {
          options.onProgress!((Date.now() - recordingStartTime) / 1000);
        }, 100);
      }
      if (options?.audioClips?.length && audioManager) {
        audioManager.startAudioPlayback([...options.audioClips].sort((a, b) => a.start - b.start));
      }
      // 启动绘制循环
      const loop = () => {
        if (mr?.state === 'recording') {
          drawCrop();
          rafId = requestAnimationFrame(loop);
        }
      };
      rafId = requestAnimationFrame(loop);
    };
    mr.onstop = () => {
      console.log("[rec] stopped, chunks:", chunks.length);
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      audioManager?.stopAllAudio();
    };
    mr.start(250);
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!mr) return resolve(new Blob());
      try { mr.requestData(); } catch {}
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr!.mimeType });
        cleanup();
        console.log("[rec] crop blob size:", blob.size);
        resolve(blob);
      };
      mr.stop();
    });
  }

  function cleanup() {
    audioManager?.cleanup();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try { ac?.close(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    if (progressInterval) clearInterval(progressInterval);
    if (frameEl) { document.body.removeChild(frameEl); frameEl = null; }
    mr = null; ac = null; stream = null; audioManager = null;
  }

  async function saveWebM(blob: Blob, defaultName = "export-crop.webm") {
    const out = await save({ defaultPath: defaultName, filters: [{ name: "WebM", extensions: ["webm"] }] });
    if (!out) return;
    await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
  }

  function getRecordingTime() { return recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0; }
  function isRecording() { return mr?.state === "recording"; }

  return { start, stop, cleanup, saveWebM, getRecordingTime, isRecording };
}
