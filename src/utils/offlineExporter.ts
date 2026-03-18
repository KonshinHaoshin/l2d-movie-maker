import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";

type AudioTrack = {
  id: string;
  start: number;
  duration: number;
  audioUrl?: string;
  audioPath?: string;
};

type ProgressPayload = {
  frameIndex: number;
  totalFrames: number;
  timeSec: number;
};

type OfflineExportParams = {
  canvas: HTMLCanvasElement;
  fps: number;
  targetFrameCount: number;
  applyTimelineAtTime: (timeSec: number, offline: boolean) => void | Promise<void>;
  renderFrame: () => void;
  audioTracks: AudioTrack[];
  onProgress?: (payload: ProgressPayload) => void;
};

type AudioManifestItem = {
  id: string;
  path: string;
  startSec: number;
  endSec: number;
  gain: number;
};

const blobFromCanvas = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas.toBlob failed"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });

const isBlobUrl = (url: string) => /^blob:/i.test(url);

function buildAudioManifest(audioTracks: AudioTrack[], fps: number): AudioManifestItem[] {
  const safeFps = Math.max(1, Math.round(fps));
  const manifest: AudioManifestItem[] = [];

  for (const track of audioTracks) {
    const start = Math.max(0, Number(track.start) || 0);
    const duration = Math.max(0, Number(track.duration) || 0);
    if (duration <= 0) continue;

    const source = (track.audioPath && track.audioPath.trim().length > 0)
      ? track.audioPath
      : (track.audioUrl && !isBlobUrl(track.audioUrl) ? track.audioUrl : "");
    if (!source) continue;

    // Frame-boundary alignment for stable timeline behavior.
    const alignedStart = Math.round(start * safeFps) / safeFps;
    const alignedEnd = Math.round((start + duration) * safeFps) / safeFps;
    if (alignedEnd <= alignedStart) continue;

    manifest.push({
      id: track.id,
      path: source,
      startSec: alignedStart,
      endSec: alignedEnd,
      gain: 1.0,
    });
  }

  return manifest;
}

export async function runOfflineWebMExport(params: OfflineExportParams): Promise<{
  blob: Blob;
  duration: number;
  frameCount: number;
}> {
  const safeFps = Math.max(1, Math.round(params.fps));
  const totalFrames = Math.max(1, Math.round(params.targetFrameCount));
  const cache = await appCacheDir();
  const stamp = Date.now();
  const frameDir = await join(cache, `offline-frames-${stamp}`);
  const outWebm = await join(cache, `offline-export-${stamp}.webm`);
  const pattern = "frame-%06d.png";

  await mkdir(frameDir, { recursive: true });

  try {
    for (let i = 0; i < totalFrames; i += 1) {
      const t = i / safeFps;
      await params.applyTimelineAtTime(t, true);
      params.renderFrame();

      const png = await blobFromCanvas(params.canvas);
      const frameName = `frame-${String(i + 1).padStart(6, "0")}.png`;
      const framePath = await join(frameDir, frameName);
      await writeFile(framePath, new Uint8Array(await png.arrayBuffer()));

      params.onProgress?.({
        frameIndex: i + 1,
        totalFrames,
        timeSec: t,
      });
    }

    const manifest = buildAudioManifest(params.audioTracks, safeFps);
    await invoke("encode_png_sequence_to_webm_alpha", {
      frameDir,
      pattern,
      outWebm,
      fps: safeFps,
      audioManifestJson: manifest.length > 0 ? JSON.stringify(manifest) : null,
    });

    const bytes = await readFile(outWebm);
    return {
      blob: new Blob([bytes], { type: "video/webm" }),
      duration: totalFrames / safeFps,
      frameCount: totalFrames,
    };
  } finally {
    try { await remove(frameDir, { recursive: true }); } catch {}
  }
}
