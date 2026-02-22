import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

interface ModelManagerProps {
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

export default function ModelManager({
  appRef,
  modelRef,
  groupContainerRef,
  isCompositeRef,
  motionBaseRef,
  setModelData,
  setCustomRecordingBounds,
  enableDragging,
  setIsDragging
}: ModelManagerProps) {
  
  // 工具函数
  const isJsonl = (u: string) => /\.jsonl(\?|#|$)/i.test(u);
  
  const resolveRelativeFrom = (baseUrl: string, rel: string) => {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (rel.startsWith("/")) return rel;
    if (rel.startsWith("./")) rel = rel.slice(2);
    const base = baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1);
    return base + rel;
  };

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
      console.log('🧹 开始清理当前模型...');
      
      if (Array.isArray(modelRef.current)) {
        // 移除并销毁复合容器
        if (groupContainerRef.current) {
          console.log('🗑️ 清理复合模型容器...');
          groupContainerRef.current.removeChildren().forEach((c: any) => {
            try { c.destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
          });
          app.stage.removeChild(groupContainerRef.current);
          try { groupContainerRef.current.destroy?.({ children: true }); } catch {}
        }
      } else if (modelRef.current) {
        console.log('🗑️ 清理单模型...');
        app.stage.removeChild(modelRef.current as any);
        try { (modelRef.current as any).destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
      }
      
      // 清理引用
      groupContainerRef.current = null;
      modelRef.current = null;
      isCompositeRef.current = false;
      motionBaseRef.current = null;
      
      console.log('✅ 模型清理完成');
    } catch (error) {
      console.warn('⚠️ 模型清理过程中出现警告:', error);
    }
  };

  // 使模型/容器可拖动
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

  // 单模型加载
  const loadSingleModel = async (app: PIXI.Application, url: string) => {
    try {
      const model = await Live2DModel.from(url);
      modelRef.current = model;
      isCompositeRef.current = false;
      motionBaseRef.current = url.slice(0, url.lastIndexOf("/") + 1);

      // 读取 json
      const res = await fetch(url, { cache: "no-cache" });
      
      // 检查响应状态
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      setModelData(data);

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
      
      console.log("📐 模型边框计算:", { modelWidth, modelHeight, modelX, modelY });
      
    } catch (err) {
      console.error("❌ 模型加载失败:", err);
      setModelData(null);
    }
  };

  // 复合（.jsonl）模型加载
  type JsonlPart = {
    path: string;
    id?: string;
    x?: number;
    y?: number;
    xscale?: number;
    yscale?: number;
  };

  const loadJsonlComposite = async (app: PIXI.Application, jsonlUrl: string) => {
    try {
      console.log('🔄 开始加载 JSONL 复合模型:', jsonlUrl);
      
      const response = await fetch(jsonlUrl, { cache: "no-cache" });
      
      // 检查响应状态和内容类型
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      console.log('📄 JSONL 文件内容长度:', text.length);
      
      // 检查是否是HTML内容（文件不存在时的回退页面）
      if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
        throw new Error(`文件不存在或路径错误: ${jsonlUrl} (返回HTML页面)`);
      }
      
      const lines = text.split("\n").filter(Boolean);
      console.log('📝 解析到 JSONL 行数:', lines.length);

      const parts: JsonlPart[] = [];
      let summary: { motions?: string[]; expressions?: string[]; import?: number } = {};

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          console.log('📋 解析 JSONL 行:', obj);
          
          // 汇总行（最后一行）：含 motions 或 expressions
          if (obj?.motions || obj?.expressions) {
            console.log('📊 发现汇总行:', { motions: obj.motions, expressions: obj.expressions, import: obj.import });
            if (Array.isArray(obj.motions)) summary.motions = obj.motions;
            if (Array.isArray(obj.expressions)) summary.expressions = obj.expressions;
            if (obj.import !== undefined) summary.import = Number(obj.import);
            continue;
          }
          if (obj?.path) {
            const fullPath = obj.path.startsWith("game/")
              ? obj.path
              : resolveRelativeFrom(jsonlUrl, obj.path.replace(/^\.\//, ""));
            console.log('🎯 发现模型路径:', { original: obj.path, resolved: fullPath });
            parts.push({
              path: fullPath,
              id: obj.id,
              x: obj.x,
              y: obj.y,
              xscale: obj.xscale,
              yscale: obj.yscale,
            });
          }
        } catch (parseError) {
          console.warn("❌ JSONL 行解析失败:", line, parseError);
        }
      }

      if (!parts.length) {
        console.warn("No valid parts in jsonl:", jsonlUrl);
        setModelData(null);
        return;
      }

      // 用第一只子模型的目录作为 MTN/表达文件的相对解析基准
      motionBaseRef.current = parts[0].path.slice(0, parts[0].path.lastIndexOf("/") + 1);

      // 创建容器
      const group = new PIXI.Container();
      group.sortableChildren = true;
      group.position.set(app.screen.width / 2, app.screen.height / 2);
      groupContainerRef.current = group;
      app.stage.addChild(group);

      // 加载子模型
      const children: Live2DModel[] = [];
      console.log('🚀 开始加载子模型，共', parts.length, '个');
      
      for (const p of parts) {
        try {
          console.log('📦 加载子模型:', p.path);
          const m = await Live2DModel.from(p.path, { autoInteract: false });
          console.log('✅ 子模型加载成功:', p.path);
          m.visible = false;
          m.anchor.set(0.5);

          // 基准缩放（尽量完整显示）
          const baseScaleX = app.screen.width / m.width;
          const baseScaleY = app.screen.height / m.height;
          const base = Math.min(baseScaleX, baseScaleY);
          const sx = base * (p.xscale ?? 1);
          const sy = base * (p.yscale ?? 1);
          m.scale.set(sx, sy);

          // 相对容器中心的位移
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
        } catch (e) {
          console.warn("子模型加载失败:", p.path, e);
        }
      }

      // 统一显示
      children.forEach((m) => (m.visible = true));

      // 拖拽容器
      if (enableDragging) makeDraggableContainer(group);

      // 计算联合包围盒（用于裁剪录制）
      requestAnimationFrame(() => {
        const b = group.getBounds();
        setCustomRecordingBounds({
          x: Math.max(0, b.x),
          y: Math.max(0, b.y),
          width: Math.min(b.width, app.screen.width),
          height: Math.min(b.height, app.screen.height),
        });
        console.log("📦 JSONL 复合包围盒:", b);
      });

      // 合成 modelData：从第一只子模型的 model.json 过滤
      let synth: ModelData | null = null;
      try {
        const firstModelJson = await (await fetch(parts[0].path, { cache: "no-cache" })).json();
        const fullMotions = firstModelJson?.motions ?? {};
        const motionGroups = summary.motions?.length ? summary.motions : Object.keys(fullMotions);

        const motionsFiltered: Record<string, Motion[]> = {};
        for (const g of motionGroups) {
          const arr = fullMotions[g] || [];
          motionsFiltered[g] = arr.map((it: any, i: number) => ({
            name: it?.name ?? `${g}-${i}`,
            file: it?.file,
          }));
        }

        const fullExpr = firstModelJson?.expressions ?? [];
        const expressions: Expression[] = summary.expressions?.length
          ? fullExpr.filter((e: any) => summary.expressions!.includes(e?.name)).map((e: any) => ({ name: e?.name, file: e?.file }))
          : fullExpr.map((e: any) => ({ name: e?.name, file: e?.file }));

        synth = { motions: motionsFiltered, expressions };
      } catch (e) {
        console.warn("综合 modelData 失败：", e);
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

  // 实际加载：根据后缀分流
  const loadAnyModel = async (app: PIXI.Application, url: string) => {
    if (isJsonl(url)) {
      await loadJsonlComposite(app, url);
    } else {
      await loadSingleModel(app, url);
    }
  };

  // 加载角色模型（用于多角色模式）
  const loadCharacterModel = async (
    app: PIXI.Application,
    characterId: string,
    modelUrl: string,
    options?: {
      x?: number;
      y?: number;
      scale?: number;
      opacity?: number;
    }
  ): Promise<Live2DModel | null> => {
    const baseUrl = modelUrl.startsWith("http") ? modelUrl : (modelUrl.includes("%") ? modelUrl : encodeURI(modelUrl));
    
    try {
      console.log(`[ModelManager] 加载角色模型: ${characterId}`, baseUrl);
      
      let model: Live2DModel;
      if (isJsonl(baseUrl)) {
        // JSONL 复合模型
        model = await Live2DModel.from(baseUrl) as Live2DModel;
      } else {
        // 单模型
        model = await Live2DModel.from(baseUrl) as Live2DModel;
      }
      
      // 设置位置和缩放
      if (options?.x !== undefined) model.position.x = options.x;
      if (options?.y !== undefined) model.position.y = options.y;
      if (options?.scale !== undefined) model.scale.set(options.scale);
      if (options?.opacity !== undefined) model.alpha = options.opacity;
      
      // 添加到舞台
      app.stage.addChild(model as any);
      
      console.log(`[ModelManager] 角色模型加载成功: ${characterId}`);
      return model;
    } catch (e) {
      console.error(`[ModelManager] 角色模型加载失败: ${characterId}`, e);
      return null;
    }
  };

  // 卸载角色模型
  const unloadCharacterModel = (app: PIXI.Application, characterId: string, model: Live2DModel) => {
    try {
      app.stage.removeChild(model as any);
      model.destroy?.({ children: true, texture: true, baseTexture: true });
      console.log(`[ModelManager] 角色模型已卸载: ${characterId}`);
    } catch (e) {
      console.warn(`[ModelManager] 卸载角色模型失败: ${characterId}`, e);
    }
  };

  // 更新角色模型属性
  const updateCharacterModel = (
    model: Live2DModel,
    updates: {
      x?: number;
      y?: number;
      scale?: number;
      opacity?: number;
    }
  ) => {
    if (updates.x !== undefined) model.position.x = updates.x;
    if (updates.y !== undefined) model.position.y = updates.y;
    if (updates.scale !== undefined) model.scale.set(updates.scale);
    if (updates.opacity !== undefined) model.alpha = updates.opacity;
  };

  return {
    loadAnyModel,
    loadCharacterModel,
    unloadCharacterModel,
    updateCharacterModel,
    cleanupCurrentModel,
    forEachModel,
    isJsonl,
    resolveRelativeFrom
  };
} 