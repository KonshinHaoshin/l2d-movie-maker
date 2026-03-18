import JSZip from 'jszip';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { Live2DModel } from 'pixi-live2d-display';

type PartInfo = { id: string; defaultOpacity: number };
type SaveTarget =
  | { kind: 'picker'; handle: FileSystemFileHandle }
  | { kind: 'tauri'; path: string };
type InternalModelLike = {
  coreModel?: {
    setPartsOpacity?: (id: string, value: number) => void;
  };
  settings?: {
    url?: string;
  };
};

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
 * 获取模型的内部模型实�?
 */
function getInternalModel(model: Live2DModel): unknown | null {
  try {
    return (model as Live2DModel & { internalModel?: unknown }).internalModel ?? null;
  } catch {
    return null;
  }
}

function asInternalModelLike(value: unknown): InternalModelLike | null {
  return value && typeof value === 'object' ? value as InternalModelLike : null;
}

function toStringArray(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];

  const indexed = value as { length?: unknown; [index: number]: unknown };
  if (typeof indexed.length !== 'number') return [];

  const result: string[] = [];
  for (let i = 0; i < indexed.length; i++) {
    const item = indexed[i];
    if (typeof item === 'string' && item) {
      result.push(item);
    }
  }
  return result;
}

let hasLoggedPartDiscoveryDiagnostics = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRuntimePartIds(coreModel: any): string[] {
  const candidates: unknown[] = [
    coreModel?._partIds,
    coreModel?._model?.parts?.ids,
    coreModel?.getModel?.()?.parts?.ids,
    coreModel?.model?.parts?.ids,
  ];

  for (const candidate of candidates) {
    const ids = toStringArray(candidate);
    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRuntimeParameterIds(internalModel: any, coreModel: any): string[] {
  const candidates: unknown[] = [
    internalModel?.parameters?.ids,
    internalModel?.parameters?._parameterIds,
    coreModel?._parameterIds,
    coreModel?._model?.parameters?.ids,
    coreModel?.getModel?.()?.parameters?.ids,
    coreModel?.model?.parameters?.ids,
  ];

  for (const candidate of candidates) {
    const ids = toStringArray(candidate);
    if (ids.length > 0) {
      return ids;
    }
  }

  const parameters = internalModel?.parameters;
  if (parameters && typeof parameters.count === 'number' && typeof parameters.get === 'function') {
    const ids: string[] = [];
    for (let i = 0; i < parameters.count; i++) {
      try {
        const param = parameters.get(i);
        const id = typeof param?.id === 'string'
          ? param.id
          : typeof param === 'string'
            ? param
            : null;
        if (id) {
          ids.push(id);
        }
      } catch {
        // 忽略单个参数读取失败
      }
    }
    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

function getVisibleParameterPartIds(parameterIds: string[]): string[] {
  const visiblePrefix = 'VISIBLE:';
  const seen = new Set<string>();
  const partIds: string[] = [];

  for (const parameterId of parameterIds) {
    if (!parameterId.startsWith(visiblePrefix) || parameterId.length <= visiblePrefix.length) {
      continue;
    }

    const partId = parameterId.slice(visiblePrefix.length);
    if (!seen.has(partId)) {
      seen.add(partId);
      partIds.push(partId);
    }
  }

  return partIds;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logPartDiscoveryDiagnostics(modelUrl: string, internalModel: any, coreModel: any, parameterIds: string[]) {
  if (hasLoggedPartDiscoveryDiagnostics) {
    return;
  }

  hasLoggedPartDiscoveryDiagnostics = true;

  let modelContextKeys: string[] = [];
  try {
    const modelContext = coreModel?.getModelContext?.();
    if (modelContext && typeof modelContext === 'object') {
      modelContextKeys = Object.keys(modelContext);
    }
  } catch {
    // 忽略诊断读取失败
  }

  console.warn('[parts-screenshot] Cubism2 parts 发现失败诊断', {
    modelUrl: modelUrl || '(unknown model url)',
    internalModelKeys: internalModel && typeof internalModel === 'object' ? Object.keys(internalModel) : [],
    coreModelKeys: coreModel && typeof coreModel === 'object' ? Object.keys(coreModel) : [],
    modelContextKeys,
    hasParametersObject: Boolean(internalModel?.parameters),
    parameterCount: typeof internalModel?.parameters?.count === 'number' ? internalModel.parameters.count : null,
    parameterIdSample: parameterIds.slice(0, 20),
  });
}

/**
 * 获取 Cubism 2 模型�?Parts（部件）信息
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCubism2Parts(internalModel: any): PartInfo[] {
  try {
    const settings = internalModel.settings;
    const coreModel = internalModel.coreModel;
    const modelUrl: string = settings?.url ?? '';
    const parts: PartInfo[] = [];
    const seen = new Set<string>();

    // 方法1: �?settings.initOpacities 获取（这是类型定义中的标准属性）
    let partIds: Array<{ id: string; value: number }> = [];

    if (settings.initOpacities && Array.isArray(settings.initOpacities)) {
      partIds = settings.initOpacities;
    }
    // 方法2: 从原�?JSON 获取（如�?initOpacities 未解析）
    else if (settings.json && settings.json.init_opacities && Array.isArray(settings.json.init_opacities)) {
      partIds = settings.json.init_opacities;
    }
    // 方法3: 从运行时内部 parts.ids / _partIds 获取
    else {
      const ids = getRuntimePartIds(coreModel);
      // 为每�?ID 创建条目，默认不透明度从模型读取
      for (const id of ids) {
        try {
          const opacity = coreModel.getPartsOpacity(id);
          partIds.push({ id, value: opacity });
        } catch {
          // 如果无法获取不透明度，使用默认�?1
          partIds.push({ id, value: 1.0 });
        }
      }
    }

    // 方法4: 从参数里的 VISIBLE:<partId> 反推部件列表
    if (partIds.length === 0) {
      const parameterIds = getRuntimeParameterIds(internalModel, coreModel);
      const visiblePartIds = getVisibleParameterPartIds(parameterIds);

      for (const id of visiblePartIds) {
        try {
          const opacity = coreModel.getPartsOpacity(id);
          partIds.push({ id, value: opacity });
        } catch {
          partIds.push({ id, value: 1.0 });
        }
      }
    }
    
    if (partIds.length === 0) {
      // 方法5: �?pose 获取部件ID
      if (internalModel.pose && internalModel.pose.partsGroups) {
        const posePartIds = new Set<string>();
        for (const group of internalModel.pose.partsGroups) {
          if (Array.isArray(group)) {
            for (const part of group) {
              if (part && part.id) {
                posePartIds.add(part.id);
                // 包括链接的部�?
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
      logPartDiscoveryDiagnostics(modelUrl, internalModel, coreModel, getRuntimeParameterIds(internalModel, coreModel));
      return [];
    }

    // Cubism2 里 raw part id 通常可直接用于 get/setPartsOpacity，
    // 但 getPartsDataIndex(rawId) 不一定返回有效索引，所以这里以 raw id 可读为准。
    for (const item of partIds) {
      const id = item.id;
      const defaultOpacity = item.value;
      if (!id || seen.has(id)) continue;

      try {
        coreModel.getPartsOpacity(id);
        parts.push({ id, defaultOpacity });
        seen.add(id);
      } catch {
        // 某些 Cubism2 运行时只接受 PartsDataID 处理后的 id 做索引查询。
        try {
          const partsDataId = (globalThis as { PartsDataID?: { getID?: (value: string) => string } })
            .PartsDataID?.getID?.(id);
          if (partsDataId != null && coreModel.getPartsDataIndex(partsDataId) >= 0) {
            parts.push({ id, defaultOpacity });
            seen.add(id);
          }
        } catch {
          // 忽略不存在的部件
        }
      }
    }

    return parts;
  } catch {
    return [];
  }
}

/**
 * 获取模型的所�?Parts（部件）信息
 */
function getModelParts(model: Live2DModel): PartInfo[] {
  const internalModel = getInternalModel(model);
  if (!internalModel) return [];
  return getCubism2Parts(internalModel);
}

/**
 * 设置 Cubism 2 模型部件的不透明�?
 */
function setPartOpacity(model: Live2DModel, partId: string, opacity: number) {
  try {
    const internalModel = asInternalModelLike(getInternalModel(model));
    if (!internalModel) return;
    internalModel.coreModel?.setPartsOpacity?.(partId, opacity);
  } catch {
    // 静默跳过
  }
}

/**
 * 重置所有部件到初始不透明�?
 */
function resetAllParts(
  model: Live2DModel,
  parts: PartInfo[]
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
      
    } catch (error) {
      console.error(`�?部件 ${part.id} 截图失败:`, error);
    }
  }

  // 恢复所有部件到初始状�?
  resetAllParts(model, parts);
  await waitForRender(200);

  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  return zipBlob;
}

/**
 * 从 model.json URL 读取 init_opacities 预设（字段名 "init_opacities"）
 * 如果没有该字段则返回 null
 */
async function fetchCustomParts(modelUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(modelUrl, { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json.init_opacities) && json.init_opacities.length > 0) {
      return json.init_opacities
        .map((item: { id?: unknown }) => typeof item?.id === 'string' ? item.id : null)
        .filter((id: string | null): id is string => Boolean(id));
    }
  } catch {
    return null;
  }
  return null;
}

function extractPartIdsFromMocBuffer(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const chars = new Array<string>(bytes.length);

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    chars[i] = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ';
  }

  const asciiText = chars.join('');
  const matches = asciiText.match(/PARTS_[A-Z0-9_]+/g) ?? [];
  const seen = new Set<string>();
  const partIds: string[] = [];

  for (const match of matches) {
    if (!seen.has(match)) {
      seen.add(match);
      partIds.push(match);
    }
  }

  return partIds;
}

async function fetchMocParts(modelUrl: string): Promise<string[] | null> {
  try {
    const modelRes = await fetch(modelUrl, { cache: 'no-cache' });
    if (!modelRes.ok) return null;

    const modelJson = await modelRes.json() as { model?: unknown };
    if (typeof modelJson.model !== 'string' || !modelJson.model) {
      return null;
    }

    const mocUrl = new URL(modelJson.model, modelUrl).href;
    const mocRes = await fetch(mocUrl, { cache: 'no-cache' });
    if (!mocRes.ok) return null;

    const buffer = await mocRes.arrayBuffer();
    const partIds = extractPartIdsFromMocBuffer(buffer);
    return partIds.length > 0 ? partIds : null;
  } catch {
    return null;
  }
}

async function pickZipSaveTarget(defaultName: string): Promise<SaveTarget | null> {
  if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{
          description: 'ZIP',
          accept: { 'application/zip': ['.zip'] },
        }],
      });
      return { kind: 'picker', handle };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      throw error;
    }
  }

  const out = await save({
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (!out) {
    return null;
  }

  return { kind: 'tauri', path: out };
}

async function writeZipToTarget(blob: Blob, target: SaveTarget): Promise<void> {
  if (target.kind === 'picker') {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  await writeFile(target.path, new Uint8Array(await blob.arrayBuffer()));
}

/**
 * JSONL复合模型：所有子模型同时显示，对所有子模型的 parts 并集逐一截图。
 * 每张截图中，所有子模型同步将目标 part 设为 1、其余 parts 设为 0。
 * 若子模型的 model.json 有 init_opacities 字段，以该列表为准。
 */
export async function exportJsonlModelParts(
  models: Live2DModel[],
  canvas: HTMLCanvasElement,
  onProgress?: (current: number, total: number, name: string) => void
): Promise<Blob> {
  const zip = new JSZip();

  // 1. 读取每个子模型的 parts 列表（优先用 model.json 自定义，否则运行时读取）
  const perModelData: Array<{
    model: Live2DModel;
    modelUrl: string;
    parts: PartInfo[];
    partIds: Set<string>;
  }> = [];

  for (const model of models) {
    const internalModel = asInternalModelLike(getInternalModel(model));
    const modelUrl: string = internalModel?.settings?.url
      ?? (model as unknown as { _url?: string })._url
      ?? '';

    let partIds: string[] | null = null;
    if (modelUrl) {
      partIds = await fetchCustomParts(modelUrl);
      if (!partIds || partIds.length === 0) {
        partIds = await fetchMocParts(modelUrl);
      }
    }

    const runtimeParts = getModelParts(model);

    let resolvedParts: PartInfo[];
    if (partIds && partIds.length > 0) {
      // 用自定义列表，defaultOpacity 从运行时读取（找不到则默认 1）
      resolvedParts = partIds.map(id => {
        const found = runtimeParts.find(p => p.id === id);
        return { id, defaultOpacity: found?.defaultOpacity ?? 1 };
      });
    } else {
      resolvedParts = runtimeParts;
    }

    if (resolvedParts.length === 0) {
      console.warn(`[parts-screenshot] 跳过未定义部件的子模型: ${modelUrl || '(unknown model url)'}`);
      continue;
    }

    perModelData.push({
      model,
      modelUrl,
      parts: resolvedParts,
      partIds: new Set(resolvedParts.map(p => p.id)),
    });
  }

  // 2. 取所有子模型 partIds 的并集
  const allPartIds: string[] = [];
  const seen = new Set<string>();
  for (const { partIds } of perModelData) {
    for (const id of partIds) {
      if (!seen.has(id)) {
        seen.add(id);
        allPartIds.push(id);
      }
    }
  }

  if (allPartIds.length === 0) {
    throw new Error('无法获取任何子模型的部件信息');
  }

  // 3. 逐 part 截图：所有子模型同步操作
  for (let i = 0; i < allPartIds.length; i++) {
    const targetId = allPartIds[i];

    if (onProgress) {
      onProgress(i + 1, allPartIds.length, targetId);
    }

    // 对每个子模型：目标 part → 1，其余 parts → 0
    for (const { model, parts } of perModelData) {
      for (const p of parts) {
        setPartOpacity(model, p.id, p.id === targetId ? 1 : 0);
      }
    }

    await waitForRender(200);

    try {
      const blob = await captureCanvas(canvas);
      const arrayBuffer = await blob.arrayBuffer();
      const safeName = targetId.replace(/[^a-zA-Z0-9_-]/g, '_');
      zip.file(`${i.toString().padStart(3, '0')}_${safeName}.png`, arrayBuffer);
    } catch (error) {
      console.error(`部件 ${targetId} 截图失败:`, error);
    }
  }

  // 4. 恢复所有子模型的原始透明度
  for (const { model, parts } of perModelData) {
    resetAllParts(model, parts);
  }
  await waitForRender(200);

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
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

  const saveTarget = await pickZipSaveTarget(`live2d_parts_${Date.now()}.zip`);
  if (!saveTarget) {
    return;
  }

  let zipBlob: Blob;

  if (Array.isArray(modelRef)) {
    zipBlob = await exportJsonlModelParts(modelRef, canvas, onProgress);
  } else {
    zipBlob = await exportSingleModelParts(modelRef, canvas, onProgress);
  }

  await writeZipToTarget(zipBlob, saveTarget);
}
