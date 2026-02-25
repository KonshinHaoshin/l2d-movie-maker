import JSZip from 'jszip';
import { Live2DModel } from 'pixi-live2d-display';

/**
 * 部件信息
 */
interface PartInfo {
  id: string;
  name: string;
  originalOpacity: number;
}

/**
 * 导出配置
 */
interface ExportConfig {
  canvas: HTMLCanvasElement;
  modelRef: Live2DModel | Live2DModel[] | null;
  isComposite: boolean;
  onProgress?: (current: number, total: number) => void;
}

/**
 * 获取单个模型的所有部�?
 */
function getModelParts(model: Live2DModel): PartInfo[] {
  const parts: PartInfo[] = [];
  
  try {
    const internalModel = (model as any).internalModel;
    if (!internalModel || !internalModel.coreModel) {
      console.warn('无法访问模型�?coreModel');
      return parts;
    }

    const coreModel = internalModel.coreModel;
    const drawableCount = coreModel.getDrawableCount?.() || 0;


    for (let i = 0; i < drawableCount; i++) {
      try {
        const drawableId = coreModel.getDrawableId?.(i);
        const opacity = coreModel.getDrawableOpacity?.(i) ?? 1.0;
        
        if (drawableId) {
          parts.push({
            id: drawableId,
            name: drawableId,
            originalOpacity: opacity
          });
        }
      } catch (error) {
        console.warn(`获取部件 ${i} 信息失败:`, error);
      }
    }
  } catch (error) {
    console.error('获取模型部件失败:', error);
  }

  return parts;
}

/**
 * 设置模型部件的透明�?
 */
function setPartOpacity(model: Live2DModel, partId: string, opacity: number): void {
  try {
    const internalModel = (model as any).internalModel;
    if (!internalModel || !internalModel.coreModel) return;

    const coreModel = internalModel.coreModel;
    const drawableCount = coreModel.getDrawableCount?.() || 0;

    for (let i = 0; i < drawableCount; i++) {
      const drawableId = coreModel.getDrawableId?.(i);
      if (drawableId === partId) {
        coreModel.setDrawableOpacity?.(i, opacity);
        break;
      }
    }
  } catch (error) {
    console.warn(`设置部件 ${partId} 透明度失�?`, error);
  }
}

/**
 * 恢复所有部件的原始透明�?
 */
function restorePartOpacities(model: Live2DModel, parts: PartInfo[]): void {
  try {
    const internalModel = (model as any).internalModel;
    if (!internalModel || !internalModel.coreModel) return;

    const coreModel = internalModel.coreModel;
    const drawableCount = coreModel.getDrawableCount?.() || 0;

    for (let i = 0; i < drawableCount; i++) {
      const drawableId = coreModel.getDrawableId?.(i);
      const partInfo = parts.find(p => p.id === drawableId);
      
      if (partInfo) {
        coreModel.setDrawableOpacity?.(i, partInfo.originalOpacity);
      }
    }
  } catch (error) {
    console.warn('恢复部件透明度失�?', error);
  }
}

/**
 * 截取canvas为PNG blob
 */
async function captureCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png', 1.0);
  });
}

/**
 * 等待一帧渲�?
 */
function waitFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * 导出普通模型的所有部件截�?
 */
async function exportSingleModelParts(
  canvas: HTMLCanvasElement,
  model: Live2DModel,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const parts = getModelParts(model);


  if (parts.length === 0) {
    throw new Error('��Ч��ģ������');
  }

  // 过滤掉原始透明度为0的部�?
  const visibleParts = parts.filter(p => p.originalOpacity > 0);

  for (let i = 0; i < visibleParts.length; i++) {
    const part = visibleParts[i];
    
    try {
      // 设置所有部件透明度为0
      for (const p of parts) {
        setPartOpacity(model, p.id, 0);
      }

      // 只显示当前部�?
      setPartOpacity(model, part.id, 1);

      // 等待渲染
      await waitFrame();
      await waitFrame(); // 等待两帧确保渲染完成

      // 截图
      const blob = await captureCanvas(canvas);
      if (blob) {
        const sanitizedName = part.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
        zip.file(`${sanitizedName}.png`, blob);
      }

      // 报告进度
      if (onProgress) {
        onProgress(i + 1, visibleParts.length);
      }
    } catch (error) {
      console.error(`导出部件 ${part.name} 失败:`, error);
    }
  }

  // 恢复所有部件的原始透明�?
  restorePartOpacities(model, parts);
  await waitFrame();

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * 导出复合模型（jsonl）的所有部件截�?
 */
async function exportCompositeModelParts(
  canvas: HTMLCanvasElement,
  models: Live2DModel[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  let totalExported = 0;


  // 收集所有子模型的部件信�?
  const modelsWithParts = models.map((model, index) => {
    const parts = getModelParts(model);
    const visibleParts = parts.filter(p => p.originalOpacity > 0);
    return { model, parts, visibleParts, index };
  });

  const totalParts = modelsWithParts.reduce((sum, m) => sum + m.visibleParts.length, 0);

  // 遍历每个子模�?
  for (const { model, parts, visibleParts, index } of modelsWithParts) {
    const modelFolder = zip.folder(`model_${index + 1}`);
    if (!modelFolder) continue;


    // 导出每个部件
    for (let i = 0; i < visibleParts.length; i++) {
      const part = visibleParts[i];

      try {
        // 设置所有部件透明度为0
        for (const p of parts) {
          setPartOpacity(model, p.id, 0);
        }

        // 只显示当前部�?
        setPartOpacity(model, part.id, 1);

        // 等待渲染
        await waitFrame();
        await waitFrame();

        // 截图
        const blob = await captureCanvas(canvas);
        if (blob) {
          const sanitizedName = part.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
          modelFolder.file(`${sanitizedName}.png`, blob);
        }

        totalExported++;
        
        // 报告进度
        if (onProgress) {
          onProgress(totalExported, totalParts);
        }
      } catch (error) {
        console.error(`导出部件 ${part.name} 失败:`, error);
      }
    }

    // 恢复当前模型的原始透明�?
    restorePartOpacities(model, parts);
  }

  await waitFrame();

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * 导出模型部件截图（主入口�?
 */
export async function exportModelPartsScreenshots(config: ExportConfig): Promise<void> {
  const { canvas, modelRef, isComposite, onProgress } = config;

  if (!canvas) {
    throw new Error('Canvas δ��ʼ��');
  }

  if (!modelRef) {
    throw new Error('û�м��ص�ģ��');
  }

  try {
    let zipBlob: Blob;

    if (isComposite && Array.isArray(modelRef)) {
      // 复合模型
      zipBlob = await exportCompositeModelParts(canvas, modelRef, onProgress);
    } else if (!Array.isArray(modelRef)) {
      // 单模�?
      zipBlob = await exportSingleModelParts(canvas, modelRef, onProgress);
    } else {
      throw new Error('��Ч��ģ������');
    }

    // 下载压缩�?
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-parts-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error('�?导出部件截图失败:', error);
    throw error;
  }
}


