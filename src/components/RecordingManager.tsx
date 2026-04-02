import React from 'react';
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { createVp9AlphaRecorder, createModelFrameRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { Live2DModel } from "pixi-live2d-display";
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
  subtitleClips: Clip[];
  recordingQuality: "low" | "medium" | "high";
  customRecordingBounds?: { x: number; y: number; width: number; height: number };
  useModelFrame?: boolean;
  setRecState: (state: "idle" | "rec" | "done" | "offline") => void;
  setRecordingTime: (time: number) => void;
  setRecordingProgress: (progress: number) => void;
  setBlob: (blob: Blob | null) => void;
  prepareAudioRecording?: () => Promise<MediaStream | null>;
  startPlayback: () => void;
  stopPlayback: () => void;
}

export default function RecordingManager({
  canvasRef,
  modelRef,
  motionClips,
  exprClips,
  audioClips,
  subtitleClips,
  recordingQuality,
  customRecordingBounds,
  useModelFrame = false,
  setRecState,
  setRecordingTime,
  setRecordingProgress,
  setBlob,
  prepareAudioRecording,
  startPlayback,
  stopPlayback
}: RecordingManagerProps) {
  const recRef = React.useRef<ReturnType<typeof createVp9AlphaRecorder> | ReturnType<typeof createModelFrameRecorder> | null>(null);
  const stopTimerRef = React.useRef<number | null>(null);

  const clearStopTimer = () => {
    if (stopTimerRef.current != null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  // 开始录�?
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("������ʱ�������������ݣ��������������Ƶ��");
      return;
    }

    // 计算总时�?
    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      subtitleClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      0
    );

    if (totalDuration <= 0) {
      alert("������ʱ�������������ݣ��������������Ƶ��");
      return;
    }

    // 质量设置
    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    };
    const settings = qualitySettings[recordingQuality];
    const recordingAudioStream = await prepareAudioRecording?.();
    const hasRecordingAudioTrack = (recordingAudioStream?.getAudioTracks().length ?? 0) > 0;

    // 判断是否使用模型区域录制
    const hasValidBounds = customRecordingBounds && customRecordingBounds.width > 0 && customRecordingBounds.height > 0;
    const shouldUseModelFrame = hasValidBounds && useModelFrame;

    // 准备音频数据
    const preparedAudioClips = audioClips
      .filter(clip => clip.audioUrl)
      .map(clip => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        audioUrl: clip.audioUrl!
      }));

    if (preparedAudioClips.length > 0 && !hasRecordingAudioTrack) {
      alert("当前录制未获取到音频轨，请先播放一次音频或检查浏览器音频权限。");
      return;
    }

    // 根据设置选择录制�?
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
          audioStream: recordingAudioStream,
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
          audioStream: recordingAudioStream,
          audioClips: preparedAudioClips
        }
      );
    }

    clearStopTimer();

    const recorder = recRef.current;
    recorder.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    stopTimerRef.current = window.setTimeout(() => {
      if (recRef.current === recorder) {
        void stop();
      }
    }, totalDuration * 1000);
  };

  // 停止录制
  const stop = async () => {
    clearStopTimer();
    const recorder = recRef.current;
    if (!recorder) return;
    recRef.current = null;
    const b = await recorder.stop();
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
      if (!blob) { alert("截图失败"); return; }
      const out = await save({
        defaultPath: `screenshot-${Date.now()}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!out) return;
      await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    } catch (error) {
      alert("截图失败");
    }
  };

  const takePartsScreenshots = async () => {
    if (!canvasRef.current || !modelRef.current) {
      alert("模型或Canvas未初始化");
      return;
    }
    try {
      await exportModelParts(modelRef.current, canvasRef.current);
    } catch (error) {
      alert("部件截图失败: " + String(error));
    }
  };

  return { recRef, start, stop, saveWebM, toMov, takeScreenshot, takePartsScreenshots };
}


