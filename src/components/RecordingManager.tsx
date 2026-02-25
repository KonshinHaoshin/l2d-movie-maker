import React from 'react';
import { createVp9AlphaRecorder, createModelFrameRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { Live2DModel } from "pixi-live2d-display";
// import JSZip from 'jszip';

interface Clip {
  id: string;
  name: string;
  start: number;
  duration: number;
  audioUrl?: string;
}

interface RecordingManagerProps {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  modelRef: React.MutableRefObject<Live2DModel | Live2DModel[] | null>;
  motionClips: Clip[];
  exprClips: Clip[];
  audioClips: Clip[];
  recordingQuality: "low" | "medium" | "high";
  customRecordingBounds?: { x: number; y: number; width: number; height: number };
  useModelFrame?: boolean;
  setRecState: (state: "idle" | "rec" | "done" | "offline") => void;
  setRecordingTime: (time: number) => void;
  setRecordingProgress: (progress: number) => void;
  setBlob: (blob: Blob | null) => void;
  startPlayback: () => void;
  stopPlayback: () => void;
}

export default function RecordingManager({
  canvasRef,
  modelRef,
  motionClips,
  exprClips,
  audioClips,
  recordingQuality,
  customRecordingBounds,
  useModelFrame = false,
  setRecState,
  setRecordingTime,
  setRecordingProgress,
  setBlob,
  startPlayback,
  stopPlayback
}: RecordingManagerProps) {
  const recRef = React.useRef<ReturnType<typeof createVp9AlphaRecorder> | ReturnType<typeof createModelFrameRecorder> | null>(null);

  // 寮�濮嬪綍鍒?
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("请先在时间线中添加内容（动作、表情或音频）");
      return;
    }

    // 璁＄畻鎬绘椂闀?
    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      0
    );

    if (totalDuration <= 0) {
      alert("请先在时间线中添加内容（动作、表情或音频）");
      return;
    }

    // 璐ㄩ噺璁剧疆
    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    };
    const settings = qualitySettings[recordingQuality];

    // 鍒ゆ柇鏄惁浣跨敤妯″瀷鍖哄煙褰曞埗
    const hasValidBounds = customRecordingBounds && customRecordingBounds.width > 0 && customRecordingBounds.height > 0;
    const shouldUseModelFrame = hasValidBounds && useModelFrame;

    // 鍑嗗闊抽鏁版嵁
    const preparedAudioClips = audioClips
      .filter(clip => clip.audioUrl)
      .map(clip => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        audioUrl: clip.audioUrl!
      }));

    // 鏍规嵁璁剧疆閫夋嫨褰曞埗鍣?
    if (shouldUseModelFrame && customRecordingBounds) {
      recRef.current = createModelFrameRecorder(
        canvasRef.current,
        customRecordingBounds,
        settings.fps,
        settings.kbps,
        {
          onProgress: (time: number) => {
            setRecordingTime(time);
            setRecordingProgress((time / totalDuration) * 100);
          },
          audioClips: preparedAudioClips,
          transparent: true
        }
      );
    } else {
      recRef.current = createVp9AlphaRecorder(
        canvasRef.current,
        settings.fps,
        settings.kbps,
        {
          onProgress: (time: number) => {
            setRecordingTime(time);
            setRecordingProgress((time / totalDuration) * 100);
          },
          audioClips: preparedAudioClips
        }
      );
    }

    recRef.current.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    setTimeout(() => {
      if (recRef.current) {
        stop();
      }
    }, totalDuration * 1000);
  };

  // 鍋滄褰曞埗
  const stop = async () => {
    if (!recRef.current) return;
    const b = await recRef.current.stop();
    setBlob(b);
    setRecState("done");
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();
  };

  const saveWebM = async () => {};
  const toMov = async () => {};

  const takeScreenshot = async () => {
    if (!canvasRef.current) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvasRef.current!.toBlob((blob) => resolve(blob), 'image/png', 1.0);
      });
      if (!blob) { alert("部件截图功能已在实现中"); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("部件截图功能已在实现中");
    }
  };

  const takePartsScreenshots = async () => {
    if (!canvasRef.current || !modelRef.current) {
      alert("部件截图功能已在实现中");
      return;
    }
    alert("部件截图功能已在实现中");
  };

  return { recRef, start, stop, saveWebM, toMov, takeScreenshot, takePartsScreenshots };
}


