import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

interface WebGALModelInfo {
  path: string;
  name: string;
  type: 'json' | 'jsonl';
  fullPath: string;
}

interface WebGALModelManagerProps {
  appRef: React.MutableRefObject<PIXI.Application | null>;
  modelRef: React.MutableRefObject<Live2DModel | Live2DModel[] | null>;
  groupContainerRef: React.MutableRefObject<PIXI.Container | null>;
  isCompositeRef: React.MutableRefObject<boolean>;
  motionBaseRef: React.MutableRefObject<string | null>;
  setModelData: (data: ModelData | null) => void;
  setCustomRecordingBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  enableDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
}

export default function WebGALModelManager({
  appRef,
  modelRef,
  groupContainerRef,
  isCompositeRef,
  motionBaseRef,
  setModelData,
  setCustomRecordingBounds,
  enableDragging,
  setIsDragging
}: WebGALModelManagerProps) {
  
  // 工具函数

  
  const forEachModel = (fn: (m: Live2DModel) => void) => {
    const cur = modelRef.current;
    if (!cur) return;
    if (Array.isArray(cur)) cur.forEach(fn);
    else fn(cur as Live2DModel);
  };

  const cleanupCurrentModel = () => {
    const app = appRef.current;
    if (!app) return;
    try {
      if (Array.isArray(modelRef.current)) {
        // 移除并销毁复合容�?
        if (groupContainerRef.current) {
          groupContainerRef.current.removeChildren().forEach((c: any) => {
            try { c.destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
          });
          app.stage.removeChild(groupContainerRef.current);
          try { groupContainerRef.current.destroy?.({ children: true }); } catch {}
        }
      } else if (modelRef.current) {
        app.stage.removeChild(modelRef.current as any);
        try { (modelRef.current as any).destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
      }
    } catch {}
    groupContainerRef.current = null;
    modelRef.current = null;
    isCompositeRef.current = false;
    motionBaseRef.current = null;
  };

  // 使模�?容器可拖�?
  const makeDraggableModel = (model: any) => {
    model.interactive = true;
    model.buttonMode = true;

    model.on("pointerdown", (e: any) => {
      setIsDragging(true);
      (model as any).dragging = true;
      (model as any)._pointerX = e.data.global.x - model.x;
      (model as any)._pointerY = e.data.global.y - model.y;
    });

    model.on("pointermove", (e: any) => {
      if ((model as any).dragging) {
        model.position.x = e.data.global.x - (model as any)._pointerX;
        model.position.y = e.data.global.y - (model as any)._pointerY;
        // 更新单模型包围盒
        const mw = model.width * model.scale.x;
        const mh = model.height * model.scale.y;
        const mx = model.position.x - mw / 2;
        const my = model.position.y - mh / 2;
        setCustomRecordingBounds({
          x: Math.max(0, mx),
          y: Math.max(0, my),
          width: Math.min(mw, appRef.current!.screen.width),
          height: Math.min(mh, appRef.current!.screen.height),
        });
      }
    });

    const up = () => { setIsDragging(false); (model as any).dragging = false; };
    model.on("pointerup", up);
    model.on("pointerupoutside", up);
  };

  const makeDraggableContainer = (container: PIXI.Container) => {
    // 为容器添加一个几乎透明的命中区域，保证好拖
    const hit = new PIXI.Graphics();
    const redrawHit = () => {
      const b = container.getBounds();
      hit.clear();
      hit.beginFill(0x000000, 0.0001);
      hit.drawRect(b.x - container.x, b.y - container.y, b.width, b.height);
      hit.endFill();
    };
    redrawHit();
    container.addChild(hit);

    container.interactive = true;
    // @ts-ignore: pixi v7 可用 eventMode
    container.eventMode = "static";
    container.cursor = "grab";

    container.on("pointerdown", (e: any) => {
      setIsDragging(true);
      // @ts-ignore
      container.cursor = "grabbing";
      (container as any).dragging = true;
      (container as any)._pointerX = e.data.global.x - container.x;
      (container as any)._pointerY = e.data.global.y - container.y;
    });

    container.on("pointermove", (e: any) => {
      if ((container as any).dragging) {
        container.position.x = e.data.global.x - (container as any)._pointerX;
        container.position.y = e.data.global.y - (container as any)._pointerY;
        const b = container.getBounds();
        setCustomRecordingBounds({
          x: Math.max(0, b.x),
          y: Math.max(0, b.y),
          width: Math.min(b.width, appRef.current!.screen.width),
          height: Math.min(b.height, appRef.current!.screen.height),
        });
        redrawHit();
      }
    });

    const up = () => {
      setIsDragging(false);
      // @ts-ignore
      container.cursor = "grab";
      (container as any).dragging = false;
    };
    container.on("pointerup", up);
    container.on("pointerupoutside", up);
    window.addEventListener("resize", redrawHit);
  };

  // 遍历游戏目录，查找所有可用的模型文件
  const scanGameModels = async (gameDir: string): Promise<WebGALModelInfo[]> => {
    try {
      const models: WebGALModelInfo[] = [];
      
      // 扫描 game/figure 目录
      const figureDir = `${gameDir}/game/figure`;
      try {
        // 手动递归扫描目录，因为某些版本的 readDir 可能不支�?recursive 选项
        const scanDirectory = async (dirPath: string, relativePath: string = "") => {
          const entries = await readDir(dirPath);
          
          for (const entry of entries) {
            const entryName = entry.name || '';
            const entryPath = relativePath ? `${relativePath}/${entryName}` : entryName;
            const fullEntryPath = `${dirPath}/${entryName}`;
            
            // 检查是否为目录 - 使用更安全的方法
            // 如果 entryName 不包含扩展名，可能是目录
            const hasExtension = /\.\w+$/.test(entryName);
            
            if (!hasExtension) {
              // 可能是目录，尝试递归扫描
              try {
                await scanDirectory(fullEntryPath, entryPath);
              } catch (dirErr) {
                // 如果扫描失败，可能是文件或权限问题，跳过
                console.warn(`跳过目录扫描: ${fullEntryPath}`, dirErr);
              }
            } else {
              // 有扩展名，检查是否为模型文件
              if (entryName.endsWith('.json') || entryName.endsWith('.jsonl')) {
                models.push({
                  path: `game/figure/${entryPath}`,
                  name: entryName.replace(/\.(json|jsonl)$/, ''),
                  type: entryName.endsWith('.jsonl') ? 'jsonl' : 'json',
                  fullPath: fullEntryPath
                });
              }
            }
          }
        };
        
        await scanDirectory(figureDir);
        
      } catch (error) {
        console.warn('⚠️ 扫描 game/figure 目录失败:', error);
      }
      
      return models;
    } catch (error) {
      console.error('�?扫描游戏目录失败:', error);
      return [];
    }
  };

  // 加载单个模型
  const loadSingleModel = async (app: PIXI.Application, filePath: string) => {
    try {
      
      // 使用 Tauri 文件系统 API 读取文件内容
      const modelJson = await readTextFile(filePath);
      const data = JSON.parse(modelJson);
      setModelData(data);

      // 创建模型（将文件内容转换�?blob URL�?
      const blob = new Blob([modelJson], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      
      const model = await Live2DModel.from(blobUrl);
      modelRef.current = model;
      isCompositeRef.current = false;
      motionBaseRef.current = filePath.slice(0, filePath.lastIndexOf("/") + 1);

      model.anchor.set(0.5, 0.5);
      model.scale.set(0.3);
      model.position.set(app.screen.width / 2, app.screen.height / 2);

      (model as any).autoInteract = false;
      const im = (model as any).internalModel as any;
      if (im) {
        ["angleXParamIndex", "angleYParamIndex", "angleZParamIndex"].forEach((k) => {
          if (typeof im[k] === "number") im[k] = -1;
        });
        // 关闭眨眼
        if (im?.eyeBlink) {
          im.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
          im.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
        }
      }

      app.stage.addChild(model);
      if (enableDragging) makeDraggableModel(model);
      
      // 计算模型边框用于录制优化
      const modelWidth = model.width * model.scale.x;
      const modelHeight = model.height * model.scale.y;
      const modelX = model.position.x - modelWidth / 2;
      const modelY = model.position.y - modelHeight / 2;
      
      setCustomRecordingBounds({
        x: Math.max(0, modelX),
        y: Math.max(0, modelY),
        width: Math.min(modelWidth, app.screen.width),
        height: Math.min(modelHeight, app.screen.height)
      });
      
      
      // 清理 blob URL
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      
    } catch (err) {
      console.error("�?WebGAL 模型加载失败:", err);
      setModelData(null);
    }
  };

  // 加载复合模型
  const loadJsonlComposite = async (app: PIXI.Application, filePath: string) => {
    try {
      
      // 使用 Tauri 文件系统 API 读取文件内容
      const text = await readTextFile(filePath);
      const lines = text.split("\n").filter(Boolean);

      const parts: Array<{ path: string; id?: string; x?: number; y?: number; xscale?: number; yscale?: number }> = [];
      let summary: { motions?: string[]; expressions?: string[]; import?: number } = {};

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // 汇总行（最后一行）：含 motions �?expressions
          if (obj?.motions || obj?.expressions) {
            if (Array.isArray(obj.motions)) summary.motions = obj.motions;
            if (Array.isArray(obj.expressions)) summary.expressions = obj.expressions;
            if (obj.import !== undefined) summary.import = Number(obj.import);
            continue;
          }
          if (obj?.path) {
            // 构建完整路径
            const baseDir = filePath.slice(0, filePath.lastIndexOf("/") + 1);
            const fullPath = obj.path.startsWith("game/")
              ? `${baseDir.replace(/\/game\/figure\/.*$/, '')}/${obj.path}`
              : `${baseDir}${obj.path}`;
            
            parts.push({
              path: fullPath,
              id: obj.id,
              x: obj.x,
              y: obj.y,
              xscale: obj.xscale,
              yscale: obj.yscale,
            });
          }
        } catch {
          console.warn("JSONL parse error in line:", line);
        }
      }

      if (!parts.length) {
        console.warn("No valid parts in jsonl:", filePath);
        setModelData(null);
        return;
      }

      // 用第一只子模型的目录作�?MTN/表达文件的相对解析基�?
      motionBaseRef.current = parts[0].path.slice(0, parts[0].path.lastIndexOf("/") + 1);

      // 创建容器
      const group = new PIXI.Container();
      group.sortableChildren = true;
      group.position.set(app.screen.width / 2, app.screen.height / 2);
      groupContainerRef.current = group;
      app.stage.addChild(group);

      // 加载子模�?
      const children: Live2DModel[] = [];
      for (const p of parts) {
        try {
          // 对于本地文件，我们需要将路径转换�?blob URL
          const modelJson = await readTextFile(p.path);
          const blob = new Blob([modelJson], { type: 'application/json' });
          const blobUrl = URL.createObjectURL(blob);
          
          const m = await Live2DModel.from(blobUrl, { autoInteract: false });
          m.visible = false;
          m.anchor.set(0.5);

          // 基准缩放（尽量完整显示）
          const baseScaleX = app.screen.width / m.width;
          const baseScaleY = app.screen.height / m.height;
          const base = Math.min(baseScaleX, baseScaleY);
          const sx = base * (p.xscale ?? 1);
          const sy = base * (p.yscale ?? 1);
          m.scale.set(sx, sy);

          // 相对容器中心的位�?
          m.position.set(p.x ?? 0, p.y ?? 0);

          const im: any = (m as any).internalModel;
          if (im) {
            if (typeof im.angleXParamIndex === "number") im.angleXParamIndex = 999;
            if (typeof im.angleYParamIndex === "number") im.angleYParamIndex = 999;
            if (typeof im.angleZParamIndex === "number") im.angleZParamIndex = 999;
            if (im?.eyeBlink) {
              im.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
              im.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
            }
            if (summary.import != null) {
              try { im.coreModel?.setParamFloat?.("PARAM_IMPORT", Number(summary.import)); } catch {}
            }
          }

          group.addChild(m);
          children.push(m);
          
          // 清理 blob URL
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          
        } catch (e) {
          console.warn("WebGAL 子模型加载失�?", p.path, e);
        }
      }

      // 统一显示
      children.forEach((m) => (m.visible = true));

      // 拖拽容器
      if (enableDragging) makeDraggableContainer(group);

      // 计算联合包围盒（用于裁剪录制�?
      requestAnimationFrame(() => {
        const b = group.getBounds();
        setCustomRecordingBounds({
          x: Math.max(0, b.x),
          y: Math.max(0, b.y),
          width: Math.min(b.width, app.screen.width),
          height: Math.min(b.height, app.screen.height),
        });
      });

      // 合成 modelData：从第一只子模型�?model.json 过滤
      let synth: ModelData | null = null;
      try {
        const firstModelJson = await readTextFile(parts[0].path);
        const firstModelData = JSON.parse(firstModelJson);
        const fullMotions = firstModelData?.motions ?? {};
        const motionGroups = summary.motions?.length ? summary.motions : Object.keys(fullMotions);

        const motionsFiltered: Record<string, Motion[]> = {};
        for (const g of motionGroups) {
          const arr = fullMotions[g] || [];
          motionsFiltered[g] = arr.map((it: any, i: number) => ({
            name: it?.name ?? `${g}-${i}`,
            file: it?.file,
          }));
        }

        const fullExpr = firstModelData?.expressions ?? [];
        const expressions: Expression[] = summary.expressions?.length
          ? fullExpr.filter((e: any) => summary.expressions!.includes(e?.name)).map((e: any) => ({ name: e?.name, file: e?.file }))
          : fullExpr.map((e: any) => ({ name: e?.name, file: e?.file }));

        synth = { motions: motionsFiltered, expressions };
      } catch (e) {
        console.warn("Failed to synthesize modelData", e);
        synth = { motions: {}, expressions: [] };
      }

      setModelData(synth);
      modelRef.current = children;     // 存为数组
      isCompositeRef.current = true;
      
    } catch (err) {
      console.error("loadJsonlComposite error:", err);
      setModelData(null);
      // 清理容器
      if (groupContainerRef.current && appRef.current) {
        try {
          appRef.current.stage.removeChild(groupContainerRef.current);
          groupContainerRef.current.destroy({ children: true });
        } catch {}
      }
      groupContainerRef.current = null;
      modelRef.current = null;
      isCompositeRef.current = false;
      motionBaseRef.current = null;
    }
  };

  // 加载模型（根据类型选择加载方法�?
  const loadModel = async (app: PIXI.Application, modelInfo: WebGALModelInfo) => {
    try {
      
      if (modelInfo.type === 'jsonl') {
        await loadJsonlComposite(app, modelInfo.fullPath);
      } else {
        await loadSingleModel(app, modelInfo.fullPath);
      }
      
    } catch (error) {
      console.error('�?WebGAL 模型加载失败:', error);
    }
  };

  // 播放动作
  const playMotion = (motionName: string) => {
    if (!modelRef.current) return;
    
    try {
      if (Array.isArray(modelRef.current)) {
        // 复合模型
        modelRef.current.forEach(model => {
          try {
            (model as any).motion(motionName);
          } catch (e) {
            console.warn('播放动作失败:', motionName, e);
          }
        });
      } else {
        // 单模�?
        try {
          (modelRef.current as any).motion(motionName);
        } catch (e) {
          console.warn('播放动作失败:', motionName, e);
        }
      }
    } catch (error) {
      console.error('�?播放动作失败:', error);
    }
  };

  // 设置表情
  const setExpression = (expressionName: string) => {
    if (!modelRef.current) return;
    
    try {
      if (Array.isArray(modelRef.current)) {
        // 复合模型
        modelRef.current.forEach(model => {
          try {
            (model as any).expression(expressionName);
          } catch (e) {
            console.warn('设置表情失败:', expressionName, e);
          }
        });
      } else {
        // 单模�?
        try {
          (modelRef.current as any).expression(expressionName);
        } catch (e) {
          console.warn('设置表情失败:', expressionName, e);
        }
      }
    } catch (error) {
      console.error('�?设置表情失败:', error);
    }
  };

  return {
    scanGameModels,
    loadModel,
    playMotion,
    setExpression,
    forEachModel,
    cleanupCurrentModel
  };
} 
