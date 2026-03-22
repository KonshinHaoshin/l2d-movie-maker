import * as PIXI from "pixi.js";
import {
  loadPixiCompositeModel,
  resolveCompositePath,
  type CompositePart,
  type ExtractCompositeSelectorsResult,
} from "composite-model";
import { Live2DModel } from "pixi-live2d-display";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}
type TransformSnapshot = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};
type DragMode = "move" | "rotate";
type PointerDataLike = {
  data: {
    global: { x: number; y: number };
    originalEvent?: MouseEvent | PointerEvent;
  };
};
type DraggableState = {
  dragging?: boolean;
  _pointerX?: number;
  _pointerY?: number;
  _dragMode?: DragMode;
  _startAngle?: number;
  _startRotation?: number;
};
type InternalEyeBlinkLike = {
  blinkInterval: number;
  nextBlinkTimeLeft: number;
};
type InternalModelLike = {
  angleXParamIndex?: number;
  angleYParamIndex?: number;
  angleZParamIndex?: number;
  eyeBlink?: InternalEyeBlinkLike;
  coreModel?: {
    setParamFloat?: (id: string, value: number) => void;
  };
};
type DraggableDisplayObject = PIXI.Container & DraggableState & {
  autoInteract?: boolean;
};
type DraggableCleanupTarget = PIXI.Container & {
  __dragCleanup?: () => void;
};

export interface JsonlRoleMeta {
  id: string;
  folder?: string;
  path: string;
  index: number;
}

export type JsonlLive2DModel = Live2DModel & {
  __characterId?: string;
  __characterLabel?: string;
  __jsonlRoleMeta?: JsonlRoleMeta;
  __compositeResolvedUrl?: string;
};

type ModelJsonLike = {
  motions?: Record<string, Array<{ name?: string; file?: string }>>;
  expressions?: Array<{ name?: string; file?: string }>;
};

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
  onTransformChange?: (transform: TransformSnapshot) => void;
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
  setIsDragging,
  onTransformChange
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
      
      if (Array.isArray(modelRef.current)) {
        // 移除并销毁复合容�?
        if (groupContainerRef.current) {
          (groupContainerRef.current as DraggableCleanupTarget).__dragCleanup?.();
          groupContainerRef.current.removeChildren().forEach((child) => {
            try { child.destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
          });
          app.stage.removeChild(groupContainerRef.current);
          try { groupContainerRef.current.destroy?.({ children: true }); } catch {}
        }
      } else if (modelRef.current) {
        app.stage.removeChild(modelRef.current);
        try { modelRef.current.destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
      }
      
      // 清理引用
      groupContainerRef.current = null;
      modelRef.current = null;
      isCompositeRef.current = false;
      motionBaseRef.current = null;
      
    } catch (error) {
      console.warn('⚠️ 模型清理过程中出现警�?', error);
    }
  };

  const emitTransformChange = (target: PIXI.Container) => {
    onTransformChange?.({
      x: Number(target.position.x),
      y: Number(target.position.y),
      scaleX: Number(target.scale.x),
      scaleY: Number(target.scale.y),
      rotation: Number(target.rotation * 180 / Math.PI),
    });
  };

  const updateBoundsFromDisplayObject = (target: PIXI.Container) => {
    const bounds = target.getBounds();
    setCustomRecordingBounds({
      x: Math.max(0, bounds.x),
      y: Math.max(0, bounds.y),
      width: Math.max(100, Math.min(bounds.width, appRef.current!.screen.width)),
      height: Math.max(100, Math.min(bounds.height, appRef.current!.screen.height)),
    });
  };

  const disableModelAutoBehaviors = (model: JsonlLive2DModel) => {
    model.autoInteract = false;
    const im = model.internalModel as unknown as InternalModelLike | undefined;
    if (!im) return;

    (["angleXParamIndex", "angleYParamIndex", "angleZParamIndex"] as const).forEach((k) => {
      if (typeof im[k] === "number") im[k] = -1;
    });

    if (im.eyeBlink) {
      im.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
      im.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
    }
  };

  const getCharacterIdFromPart = (part: CompositePart, fallbackIndex: number) => {
    const rawRoleId = (part.id && String(part.id).trim()) || (part.folder && String(part.folder).trim()) || `part${part.index ?? fallbackIndex}`;
    const mergedRoleId = rawRoleId.replace(/\d+$/, "") || rawRoleId;
    return { rawRoleId, mergedRoleId };
  };

  const synthesizeCompositeModelData = async (
    selectors: ExtractCompositeSelectorsResult,
    firstModelUrl: string,
  ): Promise<ModelData> => {
    const firstModelJson = await (await fetch(firstModelUrl, { cache: "no-cache" })).json() as ModelJsonLike;
    const fullMotions = firstModelJson.motions ?? {};
    const motionsFiltered: Record<string, Motion[]> = {};

    for (const group of selectors.motions) {
      const entries = fullMotions[group] ?? [];
      motionsFiltered[group] = entries.map((item, index) => ({
        name: item?.name ?? `${group}-${index}`,
        file: item?.file ?? "",
      }));
    }

    const fullExpressions = firstModelJson.expressions ?? [];
    const expressions = selectors.expressions.length > 0
      ? fullExpressions
        .filter((expression) => expression?.name && selectors.expressions.includes(expression.name))
        .map((expression) => ({ name: expression.name ?? "", file: expression.file ?? "" }))
      : fullExpressions.map((expression) => ({ name: expression?.name ?? "", file: expression?.file ?? "" }));

    return { motions: motionsFiltered, expressions };
  };

  // 使模�?容器可拖�?
  const makeDraggableModel = (model: DraggableDisplayObject) => {
    model.interactive = true;
    model.buttonMode = true;

    model.on("pointerdown", (e: PointerDataLike) => {
      setIsDragging(true);
      model.dragging = true;
      model._pointerX = e.data.global.x - model.x;
      model._pointerY = e.data.global.y - model.y;
      model._dragMode = "move";
      const originalEvent = e.data.originalEvent as MouseEvent | PointerEvent | undefined;
      if (originalEvent?.altKey) {
        model._dragMode = "rotate";
        model._startAngle = Math.atan2(e.data.global.y - model.y, e.data.global.x - model.x);
        model._startRotation = model.rotation ?? 0;
      }
    });

    model.on("pointermove", (e: PointerDataLike) => {
      if (model.dragging) {
        const originalEvent = e.data.originalEvent as MouseEvent | PointerEvent | undefined;
        const wantsRotate = !!originalEvent?.altKey;

        if (wantsRotate) {
          if (model._dragMode !== "rotate") {
            model._dragMode = "rotate";
            model._startAngle = Math.atan2(e.data.global.y - model.y, e.data.global.x - model.x);
            model._startRotation = model.rotation ?? 0;
          }
          const currentAngle = Math.atan2(e.data.global.y - model.y, e.data.global.x - model.x);
          model.rotation = (model._startRotation ?? model.rotation) + (currentAngle - (model._startAngle ?? currentAngle));
        } else {
          if (model._dragMode !== "move") {
            model._dragMode = "move";
            model._pointerX = e.data.global.x - model.x;
            model._pointerY = e.data.global.y - model.y;
          }
          model.position.x = e.data.global.x - (model._pointerX ?? 0);
          model.position.y = e.data.global.y - (model._pointerY ?? 0);
        }

        updateBoundsFromDisplayObject(model);
        emitTransformChange(model);
      }
    });

    const up = () => {
      setIsDragging(false);
      model.dragging = false;
      model._dragMode = undefined;
    };
    model.on("pointerup", up);
    model.on("pointerupoutside", up);
  };

  const makeDraggableContainer = (container: DraggableDisplayObject) => {
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

    container.on("pointerdown", (e: PointerDataLike) => {
      setIsDragging(true);
      // @ts-ignore
      container.cursor = "grabbing";
      container.dragging = true;
      container._pointerX = e.data.global.x - container.x;
      container._pointerY = e.data.global.y - container.y;
      container._dragMode = "move";
      const originalEvent = e.data.originalEvent as MouseEvent | PointerEvent | undefined;
      if (originalEvent?.altKey) {
        container._dragMode = "rotate";
        container._startAngle = Math.atan2(e.data.global.y - container.y, e.data.global.x - container.x);
        container._startRotation = container.rotation ?? 0;
      }
    });

    container.on("pointermove", (e: PointerDataLike) => {
      if (container.dragging) {
        const originalEvent = e.data.originalEvent as MouseEvent | PointerEvent | undefined;
        const wantsRotate = !!originalEvent?.altKey;

        if (wantsRotate) {
          if (container._dragMode !== "rotate") {
            container._dragMode = "rotate";
            container._startAngle = Math.atan2(e.data.global.y - container.y, e.data.global.x - container.x);
            container._startRotation = container.rotation ?? 0;
          }
          const currentAngle = Math.atan2(e.data.global.y - container.y, e.data.global.x - container.x);
          container.rotation = (container._startRotation ?? container.rotation) + (currentAngle - (container._startAngle ?? currentAngle));
        } else {
          if (container._dragMode !== "move") {
            container._dragMode = "move";
            container._pointerX = e.data.global.x - container.x;
            container._pointerY = e.data.global.y - container.y;
          }
          container.position.x = e.data.global.x - (container._pointerX ?? 0);
          container.position.y = e.data.global.y - (container._pointerY ?? 0);
        }

        updateBoundsFromDisplayObject(container);
        redrawHit();
        emitTransformChange(container);
      }
    });

    const up = () => {
      setIsDragging(false);
      // @ts-ignore
      container.cursor = "grab";
      container.dragging = false;
      container._dragMode = undefined;
    };
    container.on("pointerup", up);
    container.on("pointerupoutside", up);
    window.addEventListener("resize", redrawHit);
    (container as DraggableCleanupTarget).__dragCleanup = () => {
      window.removeEventListener("resize", redrawHit);
      container.off("pointerup", up);
      container.off("pointerupoutside", up);
    };
  };

  // 单模型加�?
  const loadSingleModel = async (app: PIXI.Application, url: string) => {
    try {
      const model = await Live2DModel.from(url) as JsonlLive2DModel;
      model.__characterId = "main";
      model.__characterLabel = "Main Model";
      modelRef.current = model;
      isCompositeRef.current = false;
      motionBaseRef.current = url.slice(0, url.lastIndexOf("/") + 1);

      // 读取 json
      const res = await fetch(url, { cache: "no-cache" });
      
      // 检查响应状�?
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      setModelData(data);

      model.anchor.set(0.5, 0.5);
      model.scale.set(0.3);
      model.position.set(app.screen.width / 2, app.screen.height / 2);

      disableModelAutoBehaviors(model);

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
      
      
    } catch (err) {
      console.error("�?模型加载失败:", err);
      setModelData(null);
    }
  };

  const loadJsonlComposite = async (app: PIXI.Application, jsonlUrl: string) => {
    try {
      const response = await fetch(jsonlUrl, { cache: "no-cache" });
      
      // 检查响应状态和内容类型
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      
      // 检查是否是HTML内容（文件不存在时的回退页面�?
      if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
        throw new Error(`文件不存在或路径错误: ${jsonlUrl} (返回HTML页面)`);
      }
      
      const loaded = await loadPixiCompositeModel({
        jsonlText: text,
        jsonlUrl,
        source: jsonlUrl,
        createContainer: () => {
          const container = new PIXI.Container();
          container.sortableChildren = true;
          container.position.set(app.screen.width / 2, app.screen.height / 2);
          return container;
        },
        resolveAssetUrl: async (part, manifest) => resolveCompositePath(part.path, manifest.source),
        configureModel: async ({ model, part, resolvedUrl, modelIndex }) => {
          const taggedModel = model as unknown as JsonlLive2DModel;
          const { rawRoleId, mergedRoleId } = getCharacterIdFromPart(part, modelIndex);
          taggedModel.__characterId = mergedRoleId;
          taggedModel.__characterLabel = mergedRoleId;
          taggedModel.__compositeResolvedUrl = resolvedUrl;
          taggedModel.__jsonlRoleMeta = {
            id: rawRoleId,
            folder: part.folder,
            path: resolvedUrl,
            index: part.index ?? modelIndex,
          };

          taggedModel.anchor?.set?.(0.5);

          const baseScaleX = app.screen.width / taggedModel.width;
          const baseScaleY = app.screen.height / taggedModel.height;
          const base = Math.min(baseScaleX, baseScaleY);
          taggedModel.scale.set(base * (part.xscale ?? 1), base * (part.yscale ?? 1));
          taggedModel.position.set(part.x ?? 0, part.y ?? 0);

          disableModelAutoBehaviors(taggedModel);
        },
      });

      groupContainerRef.current = loaded.container;
      app.stage.addChild(loaded.container);

      if (enableDragging) {
        makeDraggableContainer(loaded.container as DraggableDisplayObject);
      }

      requestAnimationFrame(() => {
        updateBoundsFromDisplayObject(loaded.container);
      });

      const children = loaded.models as unknown as Live2DModel[];
      const firstModel = children[0] as JsonlLive2DModel | undefined;
      const firstModelUrl = firstModel?.__compositeResolvedUrl;

      if (!firstModelUrl) {
        throw new Error(`无法解析首个子模型路径: ${jsonlUrl}`);
      }

      motionBaseRef.current = firstModelUrl.slice(0, firstModelUrl.lastIndexOf("/") + 1);

      try {
        const synthesized = await synthesizeCompositeModelData(loaded.selectors, firstModelUrl);
        setModelData(synthesized);
      } catch (error) {
        console.warn("Failed to synthesize composite modelData", error);
        setModelData({ motions: {}, expressions: [] });
      }

      modelRef.current = children;
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

  return {
    loadAnyModel,
    cleanupCurrentModel,
    forEachModel,
    isJsonl,
    resolveRelativeFrom
  };
} 
