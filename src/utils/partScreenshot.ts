import JSZip from 'jszip';
import type { Live2DModel } from 'pixi-live2d-display';

/**
 * 从canvas截图
 */
async function captureCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('截图失败'));
      }
    }, 'image/png', 1.0);
  });
}

/**
 * 等待渲染完成
 */
function waitForRender(delay: number = 150): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      setTimeout(() => resolve(), delay);
    });
  });
}

/**
 * 获取模型的内部模型实例
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getInternalModel(model: Live2DModel): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalModel = (model as any).internalModel;
    if (!internalModel) {
      throw new Error('无法访问内部模型');
    }
    return internalModel;
  } catch (error) {
    console.error('获取内部模型失败:', error);
    throw error;
  }
}

/**
 * 获取 Cubism 2 模型的 Parts（部件）信息
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCubism2Parts(internalModel: any): Array<{ id: string; defaultOpacity: number }> {
  try {
    const settings = internalModel.settings;
    const coreModel = internalModel.coreModel;
    const parts: Array<{ id: string; defaultOpacity: number }> = [];
    
    console.log('🔍 开始获取 Cubism 2 部件...');
    
    // 方法1: 从 settings.initOpacities 获取（这是类型定义中的标准属性）
    let partIds: Array<{ id: string; value: number }> = [];
    
    if (settings.initOpacities && Array.isArray(settings.initOpacities)) {
      partIds = settings.initOpacities;
      console.log(`  ✅ 从 settings.initOpacities 获取到 ${partIds.length} 个部件`);
    }
    // 方法2: 从原始 JSON 获取（如果 initOpacities 未解析）
    else if (settings.json && settings.json.init_opacities && Array.isArray(settings.json.init_opacities)) {
      partIds = settings.json.init_opacities;
      console.log(`  ✅ 从 settings.json.init_opacities 获取到 ${partIds.length} 个部件`);
    }
    // 方法3: 尝试访问私有属性 _partIds（如果存在）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else if ((coreModel as any)._partIds && Array.isArray((coreModel as any)._partIds)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (coreModel as any)._partIds;
      console.log(`  ✅ 从 coreModel._partIds 获取到 ${ids.length} 个部件ID`);
      // 为每个 ID 创建条目，默认不透明度从模型读取
      for (const id of ids) {
        try {
          const opacity = coreModel.getPartsOpacity(id);
          partIds.push({ id, value: opacity });
        } catch {
          // 如果无法获取不透明度，使用默认值 1
          partIds.push({ id, value: 1.0 });
        }
      }
    }
    
    if (partIds.length === 0) {
      console.warn('  ⚠️ 未找到部件定义，尝试从 pose 获取...');
      
      // 方法4: 从 pose 获取部件ID
      if (internalModel.pose && internalModel.pose.partsGroups) {
        const posePartIds = new Set<string>();
        for (const group of internalModel.pose.partsGroups) {
          if (Array.isArray(group)) {
            for (const part of group) {
              if (part && part.id) {
                posePartIds.add(part.id);
                // 包括链接的部件
                if (part.link && Array.isArray(part.link)) {
                  for (const linkedPart of part.link) {
                    if (linkedPart && linkedPart.id) {
                      posePartIds.add(linkedPart.id);
                    }
                  }
                }
              }
            }
          }
        }
        
        console.log(`  ✅ 从 pose 获取到 ${posePartIds.size} 个部件ID`);
        
        for (const id of posePartIds) {
          try {
            const opacity = coreModel.getPartsOpacity(id);
            partIds.push({ id, value: opacity });
          } catch {
            partIds.push({ id, value: 1.0 });
          }
        }
      }
    }
    
    if (partIds.length === 0) {
      console.error('  ❌ 无法从任何来源获取部件信息');
      console.log('  调试信息:');
      console.log('    settings.initOpacities:', settings.initOpacities);
      console.log('    settings.json:', settings.json ? Object.keys(settings.json) : 'undefined');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log('    coreModel._partIds:', (coreModel as any)._partIds);
      console.log('    pose:', internalModel.pose ? 'exists' : 'undefined');
      return [];
    }
    
    // 验证每个部件是否存在
    for (const item of partIds) {
      const id = item.id;
      const defaultOpacity = item.value;
      
      try {
        // 使用 getPartsDataIndex 验证部件存在
        const index = coreModel.getPartsDataIndex(id);
        if (index >= 0) {
          parts.push({ id, defaultOpacity });
        } else {
          console.warn(`  ⚠️ 部件 ${id} 索引无效，跳过`);
        }
      } catch {
        // 如果 getPartsDataIndex 失败，尝试直接使用
        try {
          coreModel.getPartsOpacity(id);
          parts.push({ id, defaultOpacity });
        } catch {
          console.warn(`  ⚠️ 部件 ${id} 不存在，跳过`);
        }
      }
    }
    
    console.log(`✅ Cubism 2 模型找到 ${parts.length} 个有效部件`);
    return parts;
  } catch (error) {
    console.error('❌ 获取 Cubism 2 部件失败:', error);
    return [];
  }
}

/**
 * 获取模型的所有 Parts（部件）信息
 */
function getModelParts(model: Live2DModel): Array<{ id: string; defaultOpacity: number }> {
  try {
    const internalModel = getInternalModel(model);
    console.log(`📌 使用 Cubism 2 API 获取部件`);
    return getCubism2Parts(internalModel);
  } catch (error) {
    console.error('❌ 获取模型部件失败:', error);
    return [];
  }
}

/**
 * 设置 Cubism 2 模型部件的不透明度
 */
function setPartOpacity(model: Live2DModel, partId: string, opacity: number) {
  try {
    const internalModel = getInternalModel(model);
    const coreModel = internalModel.coreModel;
    
    // Cubism 2: 使用 setPartsOpacity(id, value)
    coreModel.setPartsOpacity(partId, opacity);
  } catch (error) {
    console.error(`❌ 设置部件 ${partId} 不透明度失败:`, error);
  }
}

/**
 * 重置所有部件到初始不透明度
 */
function resetAllParts(
  model: Live2DModel,
  parts: Array<{ id: string; defaultOpacity: number }>
) {
  parts.forEach(part => {
    setPartOpacity(model, part.id, part.defaultOpacity);
  });
}

/**
 * 普通Live2D模型：导出每个部件单独显示的截图
 */
export async function exportSingleModelParts(
  model: Live2DModel,
  canvas: HTMLCanvasElement,
  onProgress?: (current: number, total: number, name: string) => void
): Promise<Blob> {
  const zip = new JSZip();
  const parts = getModelParts(model);
  
  if (parts.length === 0) {
    throw new Error('无法获取模型部件信息');
  }

  console.log(`📸 开始导出 ${parts.length} 个部件截图...`);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (onProgress) {
      onProgress(i + 1, parts.length, part.id);
    }

    // 设置：当前部件不透明度为1，其他为0
    parts.forEach(p => {
      setPartOpacity(model, p.id, p.id === part.id ? 1 : 0);
    });

    await waitForRender(200);

    try {
      const blob = await captureCanvas(canvas);
      const arrayBuffer = await blob.arrayBuffer();
      
      const safeName = part.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      zip.file(`${i.toString().padStart(3, '0')}_${safeName}.png`, arrayBuffer);
      
      console.log(`✅ 部件 ${i + 1}/${parts.length}: ${part.id}`);
    } catch (error) {
      console.error(`❌ 部件 ${part.id} 截图失败:`, error);
    }
  }

  // 恢复所有部件到初始状态
  resetAllParts(model, parts);
  await waitForRender(200);

  console.log('🗜️ 正在生成压缩包...');
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  console.log('✅ 压缩包生成完成！');
  
  return zipBlob;
}

/**
 * JSONL复合模型：导出每个子模型的部件组合截图
 */
export async function exportJsonlModelParts(
  models: Live2DModel[],
  canvas: HTMLCanvasElement,
  onProgress?: (current: number, total: number, name: string) => void
): Promise<Blob> {
  const zip = new JSZip();
  let currentScreenshot = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    const parts = getModelParts(model);
    
    if (parts.length === 0) {
      console.warn(`⚠️ 模型 ${modelIndex} 无部件信息，跳过`);
      continue;
    }

    // 筛选出默认不为0的部件（默认可见的）
    const visibleParts = parts.filter(p => p.defaultOpacity > 0);
    
    if (visibleParts.length === 0) {
      console.warn(`⚠️ 模型 ${modelIndex} 无默认可见部件，跳过`);
      continue;
    }

    console.log(`📸 模型 ${modelIndex}: 发现 ${visibleParts.length} 个默认可见部件`);

    const folderName = `model_${modelIndex.toString().padStart(2, '0')}`;
    
    for (let i = 0; i < visibleParts.length; i++) {
      const targetPart = visibleParts[i];
      currentScreenshot++;
      
      if (onProgress) {
        onProgress(currentScreenshot, visibleParts.length * models.length, 
                   `模型${modelIndex}/${targetPart.id}`);
      }

      // 设置所有部件：当前部件为1，其他默认可见的为0，默认不可见的保持0
      parts.forEach(p => {
        if (p.id === targetPart.id) {
          setPartOpacity(model, p.id, 1);
        } else if (visibleParts.some(vp => vp.id === p.id)) {
          setPartOpacity(model, p.id, 0);
        } else {
          setPartOpacity(model, p.id, 0);
        }
      });

      await waitForRender(200);

      try {
        const blob = await captureCanvas(canvas);
        const arrayBuffer = await blob.arrayBuffer();
        
        const safeName = targetPart.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        zip.file(`${folderName}/${i.toString().padStart(3, '0')}_${safeName}.png`, arrayBuffer);
        
        console.log(`✅ 模型${modelIndex} 部件 ${i + 1}/${visibleParts.length}: ${targetPart.id}`);
      } catch (error) {
        console.error(`❌ 模型${modelIndex} 部件 ${targetPart.id} 截图失败:`, error);
      }
    }

    resetAllParts(model, parts);
  }

  await waitForRender(200);

  console.log('🗜️ 正在生成压缩包...');
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  console.log('✅ 压缩包生成完成！');
  
  return zipBlob;
}

/**
 * 统一导出接口
 */
export async function exportModelParts(
  modelRef: Live2DModel | Live2DModel[] | null,
  canvas: HTMLCanvasElement | null,
  onProgress?: (current: number, total: number, name: string) => void
): Promise<void> {
  if (!modelRef || !canvas) {
    throw new Error('模型或Canvas未初始化');
  }

  let zipBlob: Blob;

  if (Array.isArray(modelRef)) {
    console.log('🎭 检测到JSONL复合模型，开始导出...');
    zipBlob = await exportJsonlModelParts(modelRef, canvas, onProgress);
  } else {
    console.log('🎨 检测到普通Live2D模型，开始导出...');
    zipBlob = await exportSingleModelParts(modelRef, canvas, onProgress);
  }

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live2d_parts_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('🎉 导出完成！');
}
