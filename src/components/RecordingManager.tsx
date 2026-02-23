import React from 'react';
import { createVp9AlphaRecorder, createModelFrameRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { Live2DModel } from "pixi-live2d-display";
import JSZip from 'jszip';

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

  // 开始录制
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("此环境不支持 VP9 透明直录");
      return;
    }

    // 计算总时长：取三条轨的最大结束时间（与播放时间线总时长一致）
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

    // 根据质量设置选择录制参数
    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    };
    const settings = qualitySettings[recordingQuality];

    // 判断是否启用模型区域录制
    const useModelBoundsRecording = enableModelBoundsRecording && customRecordingBounds &&
      customRecordingBounds.width > 0 && customRecordingBounds.height > 0;

    if (useModelBoundsRecording) {
      // 使用模型区域录制（支持音频）
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
          audioClips: audioClips.map(clip => ({
            id: clip.id,
            start: clip.start,
            duration: clip.duration,
            audioUrl: clip.audioUrl!
          })),
          timelineLength: totalDuration
        }
      );
    } else {
      // 使用全屏录制器，包含音频轨道
      console.log("[RecordingManager] 使用全屏录制");
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
    }

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

  // 截图
  const takeScreenshot = async () => {
    if (!canvasRef.current) return;
    try {
      // 将canvas转换为blob（PNG格式，保留alpha通道）
      const blob = await new Promise<Blob | null>((resolve) => {
        canvasRef.current!.toBlob((blob) => {
          resolve(blob);
        }, 'image/png', 1.0); // PNG格式，最高质量
      });

      if (!blob) {
        alert('截图失败');
        return;
      }

      // 创建下载链接
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

  // 多部件截图功能
  const takePartsScreenshots = async () => {
    if (!canvasRef.current || !modelRef.current) {
      alert('请先加载模型');
      return;
    }

    try {
      // 获取模型实例（支持单模型或模型数组）
      const models = Array.isArray(modelRef.current) ? modelRef.current : [modelRef.current];
      if (models.length === 0) {
        alert('没有可用的模型');
        return;
      }

      // 使用第一个模型进行部件截图
      const model = models[0];
      const internalModel = model.internalModel;
      if (!internalModel || !internalModel.coreModel) {
        alert('无法访问模型的内部结构');
        return;
      }

      // 获取部件信息
      let partIds: string[] = [];
      let partNames: string[] = [];
      let partCount = 0;

      const coreModel = internalModel.coreModel as any;

      // 尝试从模型的 JSON 配置中获取部件信息
      let modelSettings: any = null;
      if ((model as any)._modelSettings) {
        modelSettings = (model as any)._modelSettings;
      } else if ((model as any).modelSettings) {
        modelSettings = (model as any).modelSettings;
      }

      // Cubism 2 模型 - 获取部件 ID 列表
      if (coreModel && typeof coreModel.getPartsOpacity === 'function') {
        console.log('🔍 检测到 Cubism 2 模型');

        let foundPartIds = false;

        if (coreModel._partIds && Array.isArray(coreModel._partIds)) {
          partIds = [...coreModel._partIds];
          partCount = partIds.length;
          partNames = [...partIds];
          foundPartIds = true;
          console.log('✅ 方法1: 从 coreModel._partIds 读取到部件:', partIds);
        }

        if (!foundPartIds && modelSettings && modelSettings.init_opacities && Array.isArray(modelSettings.init_opacities)) {
          partIds = modelSettings.init_opacities.map((item: any) => item.id);
          partCount = partIds.length;
          partNames = [...partIds];
          foundPartIds = true;
          console.log('✅ 方法2: 从 modelSettings.init_opacities 读取到部件:', partIds);
        }

        if (!foundPartIds) {
          console.log('⚠️ 方法3: 尝试通过遍历索引获取部件...');
          for (let i = 0; i < 100; i++) {
            try {
              const opacity = coreModel.getPartsOpacity(i);
              if (opacity !== undefined && opacity !== null && !isNaN(opacity)) {
                partCount++;
              } else {
                break;
              }
            } catch {
              break;
            }
          }

          if (modelSettings && modelSettings.init_opacities) {
            for (let i = 0; i < partCount; i++) {
              const opacityItem = modelSettings.init_opacities[i];
              if (opacityItem && opacityItem.id) {
                partIds.push(opacity