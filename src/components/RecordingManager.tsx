import React from 'react';
import { createVp9AlphaRecorder, isVp9AlphaSupported } from "../utils/recorder";
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
      let partCount = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const coreModel = internalModel.coreModel as any;
      
      // 尝试从模型的 JSON 配置中获取部件信息
      let modelSettings = null;
      if ((model as any)._modelSettings) {
        modelSettings = (model as any)._modelSettings;
      } else if ((model as any).modelSettings) {
        modelSettings = (model as any).modelSettings;
      }


      //  Cubism 2 模型 - 从 modelSettings 获取
      if (modelSettings && modelSettings.parts) {
        // Cubism 2 模型配置中的 parts 数组
        partIds = modelSettings.parts.map((part: any) => part.id || part);
        partCount = partIds.length;
        console.log('✅ 检测到 Cubism 2 模型，从配置读取部件:', partIds);
      }
      //  Cubism 4 模型
      // else if (coreModel.parts && coreModel.parts.ids && coreModel.parts.count) {
      //   partIds = coreModel.parts.ids;
      //   partCount = coreModel.parts.count;
      //   console.log('✅ 检测到 Cubism 4 模型');
      // } 
      // 尝试从 coreModel 的内部结构获取（Cubism 2）
      else if (coreModel && typeof coreModel.getPartsOpacity === 'function') {
        // Cubism 2 的 Live2DModelWebGL
        // 尝试从 modelImpl 获取部件数据
        const modelImpl = coreModel.modelImpl || coreModel;
        
        // 尝试获取部件数组
        if (modelImpl._$aS && Array.isArray(modelImpl._$aS)) {
          partCount = modelImpl._$aS.length;
          for (let i = 0; i < partCount; i++) {
            const partData = modelImpl._$aS[i];
            if (partData && partData.getPartsDataID) {
              const partId = partData.getPartsDataID();
              partIds.push(partId.id || `Part_${i}`);
            } else {
              partIds.push(`Part_${i}`);
            }
          }
          console.log('✅ 检测到 Cubism 2 模型，从 modelImpl 读取部件');
        }
        // 如果还是找不到，尝试通过测试获取部件数量
        else {
          console.log('⚠️ 尝试通过测试方式检测部件数量...');
          // 尝试最多 100 个索引
          for (let i = 0; i < 100; i++) {
            try {
              const opacity = coreModel.getPartsOpacity(i);
              if (opacity !== undefined && opacity !== null && !isNaN(opacity)) {
                partIds.push(`Part_${i}`);
                partCount++;
              } else {
                break;
              }
            } catch (e) {
              break;
            }
          }
          if (partCount > 0) {
            console.log(`✅ 通过测试检测到 ${partCount} 个部件`);
          }
        }
      }
      // 方法4: 其他尝试
      else if (coreModel.getPartCount && typeof coreModel.getPartCount === 'function') {
        partCount = coreModel.getPartCount();
        for (let i = 0; i < partCount; i++) {
          partIds.push(`Part_${i}`);
        }
        console.log('✅ 通过 getPartCount 获取部件数量');
      }
      
      // 如果所有方法都失败
      if (partCount === 0) {
        console.error('❌ 无法获取模型部件信息');
        console.log('模型信息:', {
          hasParts: !!coreModel.parts,
          hasGetPartsOpacity: typeof coreModel.getPartsOpacity === 'function',
          hasModelSettings: !!modelSettings,
          coreModelKeys: Object.keys(coreModel).slice(0, 20)
        });
        alert('该模型不支持部件截图功能\n\n可能原因：\n1. 模型没有定义部件\n2. 模型格式不支持\n\n请查看控制台了解详细信息。');
        return;
      }

      if (partCount === 0) {
        alert('模型没有部件信息');
        return;
      }

      console.log(`📸 开始截取 ${partCount} 个部件...`);
      
      // 保存所有部件的原始透明度
      const originalOpacities: number[] = [];
      for (let i = 0; i < partCount; i++) {
        if (coreModel.parts && coreModel.parts.opacities) {
          originalOpacities.push(coreModel.parts.opacities[i]);
        } else if (coreModel.getPartsOpacity) {
          originalOpacities.push(coreModel.getPartsOpacity(i));
        } else {
          originalOpacities.push(1.0);
        }
      }

      // 创建 ZIP 文件
      const zip = new JSZip();
      const screenshotsFolder = zip.folder('parts_screenshots');
      
      if (!screenshotsFolder) {
        alert('创建文件夹失败');
        return;
      }

      // 对每个部件进行截图
      for (let i = 0; i < partCount; i++) {
        const partId = partIds[i];
        
        // 将所有部件设为透明
        for (let j = 0; j < partCount; j++) {
          if (coreModel.setPartsOpacity) {
            coreModel.setPartsOpacity(j, 0);
          } else if (coreModel.parts && coreModel.parts.opacities) {
            coreModel.parts.opacities[j] = 0;
          }
        }

        // 只显示当前部件
        if (coreModel.setPartsOpacity) {
          coreModel.setPartsOpacity(i, 1);
        } else if (coreModel.parts && coreModel.parts.opacities) {
          coreModel.parts.opacities[i] = 1;
        }

        // 更新模型
        if (coreModel.update) {
          coreModel.update();
        }
        
        // 等待一帧以确保渲染完成
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 截图
        const blob = await new Promise<Blob | null>((resolve) => {
          canvasRef.current!.toBlob((blob) => {
            resolve(blob);
          }, 'image/png', 1.0);
        });

        if (blob) {
          // 添加到 ZIP
          const arrayBuffer = await blob.arrayBuffer();
          screenshotsFolder.file(`${partId}.png`, arrayBuffer);
          console.log(`✅ 部件 ${partId} 截图完成`);
        }
      }

      // 恢复所有部件的原始透明度
      for (let i = 0; i < partCount; i++) {
        if (coreModel.setPartsOpacity) {
          coreModel.setPartsOpacity(i, originalOpacities[i]);
        } else if (coreModel.parts && coreModel.parts.opacities) {
          coreModel.parts.opacities[i] = originalOpacities[i];
        }
      }

      // 更新模型以恢复显示
      if (coreModel.update) {
        coreModel.update();
      }

      // 生成并下载 ZIP 文件
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parts_screenshots_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('✅ 所有部件截图已保存到压缩包');
      alert(`成功截取 ${partCount} 个部件并导出为压缩包`);
    } catch (error) {
      console.error('部件截图失败:', error);
      alert('部件截图失败: ' + error);
    }
  };

  return {
    recRef,
    start,
    stop,
    saveWebM,
    toMov,
    takeScreenshot,
    takePartsScreenshots
  };
} 