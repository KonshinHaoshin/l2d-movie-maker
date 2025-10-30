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
 * 获取单个模型的所有部件
 */
function getModelParts(model: Live2DModel): PartInfo[] {
  const parts: PartInfo[] = [];
  
  try {
    const internalModel = (model as any).internalModel;
    if (!internalModel || !internalModel.coreModel) {
      console.warn('无法访问模型的 coreModel');
      return parts;
    }

    const coreModel = internalModel.coreModel;
    const drawableCount = coreModel.getDrawableCount?.() || 0;

    console.log(`📊 模型共有 ${drawableCount} 个部件`);

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
 * 设置模型部件的透明度
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
    console.warn(`设置部件 ${partId} 透明度失败:`, error);
  }
}

/**
 * 恢复所有部件的原始透明度
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
    console.warn('恢复部件透明度失败:', error);
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
 * 等待一帧渲染
 */
function waitFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * 导出普通模型的所有部件截图
 */
async function exportSingleModelParts(
  canvas: HTMLCanvasElement,
  model: Live2DModel,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const parts = getModelParts(model);

  console.log(`🎨 开始导出单模型的 ${parts.length} 个部件`);

  if (parts.length === 0) {
    throw new Error('模型没有可导出的部件');
  }

  // 过滤掉原始透明度为0的部件
  const visibleParts = parts.filter(p => p.originalOpacity > 0);
  console.log(`✅ 过滤后可见部件数量: ${visibleParts.length}`);

  for (let i = 0; i < visibleParts.length; i++) {
    const part = visibleParts[i];
    
    try {
      // 设置所有部件透明度为0
      for (const p of parts) {
        setPartOpacity(model, p.id, 0);
      }

      // 只显示当前部件
      setPartOpacity(model, part.id, 1);

      // 等待渲染
      await waitFrame();
      await waitFrame(); // 等待两帧确保渲染完成

      // 截图
      const blob = await captureCanvas(canvas);
      if (blob) {
        const sanitizedName = part.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
        zip.file(`${sanitizedName}.png`, blob);
        console.log(`✅ 已导出部件: ${part.name}`);
      }

      // 报告进度
      if (onProgress) {
        onProgress(i + 1, visibleParts.length);
      }
    } catch (error) {
      console.error(`导出部件 ${part.name} 失败:`, error);
    }
  }

  // 恢复所有部件的原始透明度
  restorePartOpacities(model, parts);
  await waitFrame();

  console.log('✅ 单模型部件导出完成，正在生成压缩包...');
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * 导出复合模型（jsonl）的所有部件截图
 */
async function exportCompositeModelParts(
  canvas: HTMLCanvasElement,
  models: Live2DModel[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  let totalExported = 0;

  console.log(`🎨 开始导出复合模型的 ${models.length} 个子模型`);

  // 收集所有子模型的部件信息
  const modelsWithParts = models.map((model, index) => {
    const parts = getModelParts(model);
    const visibleParts = parts.filter(p => p.originalOpacity > 0);
    return { model, parts, visibleParts, index };
  });

  const totalParts = modelsWithParts.reduce((sum, m) => sum + m.visibleParts.length, 0);
  console.log(`📊 总共需要导出 ${totalParts} 个部件`);

  // 遍历每个子模型
  for (const { model, parts, visibleParts, index } of modelsWithParts) {
    const modelFolder = zip.folder(`model_${index + 1}`);
    if (!modelFolder) continue;

    console.log(`📁 处理子模型 ${index + 1}, 可见部件数: ${visibleParts.length}`);

    // 导出每个部件
    for (let i = 0; i < visibleParts.length; i++) {
      const part = visibleParts[i];

      try {
        // 设置所有部件透明度为0
        for (const p of parts) {
          setPartOpacity(model, p.id, 0);
        }

        // 只显示当前部件
        setPartOpacity(model, part.id, 1);

        // 等待渲染
        await waitFrame();
        await waitFrame();

        // 截图
        const blob = await captureCanvas(canvas);
        if (blob) {
          const sanitizedName = part.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
          modelFolder.file(`${sanitizedName}.png`, blob);
          console.log(`✅ 已导出部件: model_${index + 1}/${part.name}`);
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

    // 恢复当前模型的原始透明度
    restorePartOpacities(model, parts);
  }

  await waitFrame();

  console.log('✅ 复合模型部件导出完成，正在生成压缩包...');
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * 导出模型部件截图（主入口）
 */
export async function exportModelPartsScreenshots(config: ExportConfig): Promise<void> {
  const { canvas, modelRef, isComposite, onProgress } = config;

  if (!canvas) {
    throw new Error('Canvas 未初始化');
  }

  if (!modelRef) {
    throw new Error('没有加载的模型');
  }

  try {
    let zipBlob: Blob;

    if (isComposite && Array.isArray(modelRef)) {
      // 复合模型
      console.log('🎭 检测到复合模型（jsonl），开始导出...');
      zipBlob = await exportCompositeModelParts(canvas, modelRef, onProgress);
    } else if (!Array.isArray(modelRef)) {
      // 单模型
      console.log('🎨 检测到单模型，开始导出...');
      zipBlob = await exportSingleModelParts(canvas, modelRef, onProgress);
    } else {
      throw new Error('无效的模型类型');
    }

    // 下载压缩包
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-parts-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('✅ 部件截图压缩包已下载');
  } catch (error) {
    console.error('❌ 导出部件截图失败:', error);
    throw error;
  }
}

