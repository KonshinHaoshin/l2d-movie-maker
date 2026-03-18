import React from 'react';
import { Live2DModel } from "pixi-live2d-display";
import { createModelFrameRecorder, createVp9AlphaRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { exportModelParts } from "../utils/partScreenshot";

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
  enableModelBoundsRecording?: boolean;
  setRecState: (state: "idle" | "rec" | "done") => void;
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
  enableModelBoundsRecording = false,
  setRecState,
  setRecordingTime,
  setRecordingProgress,
  setBlob,
  startPlayback,
  stopPlayback,
}: RecordingManagerProps) {
  const recRef = React.useRef<ReturnType<typeof createVp9AlphaRecorder> | ReturnType<typeof createModelFrameRecorder> | null>(null);

  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("此环境不支持 VP9 透明直录");
      return;
    }

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

    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    } as const;
    const settings = qualitySettings[recordingQuality];

    const useModelBoundsRecording = enableModelBoundsRecording
      && !!customRecordingBounds
      && customRecordingBounds.width > 0
      && customRecordingBounds.height > 0;

    if (useModelBoundsRecording) {
      console.log("[RecordingManager] 使用模型区域录制:", customRecordingBounds);
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
          transparent: true,
          showFrame: true,
          audioClips: audioClips.map((clip) => ({
            id: clip.id,
            start: clip.start,
            duration: clip.duration,
            audioUrl: clip.audioUrl!
          })),
          timelineLength: totalDuration
        }
      );
    } else {
      console.log("[RecordingManager] 使用全屏录制");
      recRef.current = createVp9AlphaRecorder(canvasRef.current, settings.fps, settings.kbps, {
        onProgress: (time: number) => {
          setRecordingTime(time);
          setRecordingProgress((time / totalDuration) * 100);
        },
        audioClips: audioClips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          duration: clip.duration,
          audioUrl: clip.audioUrl!
        })),
        timelineLength: totalDuration
      });
    }

    recRef.current.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    setTimeout(() => {
      if (recRef.current) {
        void stop();
      }
    }, totalDuration * 1000);
  };

  const stop = async () => {
    if (!recRef.current) return;
    const blob = await recRef.current.stop();
    setBlob(blob);
    setRecState("done");
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();
  };

  const takeScreenshot = async () => {
    if (!canvasRef.current) return;

    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvasRef.current!.toBlob((value) => resolve(value), 'image/png', 1.0);
      });

      if (!blob) {
        alert('截图失败');
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('✅ 截图已保存');
    } catch (error) {
      console.error('截图失败:', error);
      alert('截图失败: ' + error);
    }
  };

  const takePartsScreenshots = async () => {
    if (!canvasRef.current || !modelRef.current) {
      alert('请先加载模型');
      return;
    }

    try {
      await exportModelParts(
        modelRef.current,
        canvasRef.current,
        (current, total, name) => {
          console.log(`[parts-screenshot] ${current}/${total}: ${name}`);
        }
      );
    } catch (error) {
      console.error('部件截图失败:', error);
      alert('部件截图失败: ' + error);
    }
  };

  const saveWebM = async () => {
    console.log('保存WebM功能由 Live2DView 处理');
  };

  const toMov = async () => {
    console.log('转换MOV功能由 Live2DView 处理');
  };

  return {
    recRef,
    start,
    stop,
    saveWebM,
    toMov,
    takeScreenshot,
    takePartsScreenshots,
  };
}
