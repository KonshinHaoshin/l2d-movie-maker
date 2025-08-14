import React from 'react';
import { createVp9AlphaRecorder, isVp9AlphaSupported } from "../utils/recorder";

interface Clip {
  id: string;
  name: string;
  start: number;
  duration: number;
  audioUrl?: string;
}

interface RecordingManagerProps {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  audioClips: Clip[];
  recordingQuality: "low" | "medium" | "high";
  setRecState: (state: "idle" | "rec" | "done") => void;
  setRecordingTime: (time: number) => void;
  setRecordingProgress: (progress: number) => void;
  setBlob: (blob: Blob | null) => void;
  startPlayback: () => void;
  stopPlayback: () => void;
}

export default function RecordingManager({
  canvasRef,
  audioClips,
  recordingQuality,
  setRecState,
  setRecordingTime,
  setRecordingProgress,
  setBlob,
  startPlayback,
  stopPlayback
}: RecordingManagerProps) {
  
  const recRef = React.useRef<ReturnType<typeof createVp9AlphaRecorder> | null>(null);

  // 开始录制
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("此环境不支持 VP9 透明直录");
      return;
    }

    const totalDuration = Math.max(
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      0
    );
    if (totalDuration <= 0) {
      alert("请先在时间线中添加音频片段");
      return;
    }

    // 根据质量设置选择录制参数
    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    };
    
    const settings = qualitySettings[recordingQuality];
    
    // 使用全屏录制器，包含音频轨道
    recRef.current = createVp9AlphaRecorder(canvasRef.current, settings.fps, settings.kbps, {
      onProgress: (time: number) => {
        setRecordingTime(time);
        setRecordingProgress((time / totalDuration) * 100);
      },
      audioClips: audioClips.map(clip => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        audioUrl: clip.audioUrl!
      })),
      timelineLength: totalDuration
    });

    recRef.current.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    setTimeout(() => {
      // 这里需要检查录制状态
      if (recRef.current) {
        stop();
      }
    }, totalDuration * 1000);
  };

  // 停止录制
  const stop = async () => {
    if (!recRef.current) return;
    const b = await recRef.current.stop();
    setBlob(b);
    setRecState("done");
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();
  };

  // 保存WebM
  const saveWebM = async () => {
    if (!recRef.current) return;
    // 这里需要从外部获取blob
    console.log('保存WebM功能需要从外部传入blob');
  };

  // 转换为MOV
  const toMov = async () => {
    // 这里需要从外部获取blob
    console.log('转换为MOV功能需要从外部传入blob');
  };

  return {
    recRef,
    start,
    stop,
    saveWebM,
    toMov
  };
} 