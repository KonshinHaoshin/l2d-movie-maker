// src/components/Live2DView.tsx
import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";
import { parseMtn } from "../utils/parseMtn";
import "./Live2DView.css";
import ControlPanel from "./panel/ControlPanel";
import { createVp9AlphaRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { appCacheDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type MotionLenMap = Record<string, number>;

export default function Live2DView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);

  // 获取模型服务器信息
  const [assetBase, setAssetBase] = useState<string | null>(null);

  // —— 模型选择 —— //
  const [modelList, setModelList] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // 例如 "anon/model.json"
  const modelUrl = selectedModel && assetBase ? `${assetBase}/${selectedModel}` : null; // 最终 URL

  // —— 当前模型数据 —— //
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<string>("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [showControls, setShowControls] = useState<boolean>(true);
  const [enableDragging, setEnableDragging] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // —— 时间线 —— //
  const [motionClips, setMotionClips] = useState<Clip[]>([]);
  const [exprClips, setExprClips] = useState<Clip[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);
  const firedRef = useRef<Set<string>>(new Set());

  // 默认时长（兜底）
  const [motionDur, setMotionDur] = useState(2);
  const [exprDur, setExprDur] = useState(0.8);

  // 每组 motion 的真实时长
  const [motionLen, setMotionLen] = useState<MotionLenMap>({});

  const clearTimeline = () => { setMotionClips([]); setExprClips([]); setPlayhead(0); };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const setPlayheadSec = (sec: number) => setPlayhead(sec);

  // —— 录制 —— //
  const recRef = useRef<ReturnType<typeof createVp9AlphaRecorder> | null>(null);
  const [recState, setRecState] = useState<"idle" | "rec" | "done">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [transparentBg, setTransparentBg] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // 调 Rust，拿到 http://127.0.0.1:PORT/model
        const { base_url } = await invoke<{base_url: string, models_dir: string}>("get_model_server_info");
        setAssetBase(base_url);
      } catch (e) {
        console.error("获取模型服务器信息失败:", e);
        setAssetBase(null);
      }
    })();
  }, []);

  // 读取模型列表
  const loadModelList = async () => {
    if (!assetBase) return;
    try {
      const res = await fetch(`${assetBase}/models.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = (await res.json()) as string[];
      setModelList(arr);
      // 默认选择第一项（或保持已选）
      setSelectedModel(prev => prev ?? arr[0] ?? null);
    } catch (e) {
      console.warn("读取外部 models.json 失败，请确认 exe 同级的 model/models.json 存在", e);
      setModelList([]);
      setSelectedModel(null);
    }
  };

  useEffect(() => {
    loadModelList();
  }, [assetBase]);

  // 刷新模型列表
  const refreshModels = async () => {
    try {
      const newModelList = await invoke<string[]>("refresh_model_index");
      setModelList(newModelList);
      // 如果当前选中的模型不在新列表中，重置选择
      if (selectedModel && !newModelList.includes(selectedModel)) {
        setSelectedModel(newModelList[0] ?? null);
      }
    } catch (e) {
      console.error("刷新模型列表失败:", e);
    }
  };

  // 初始化 PIXI（仅一次）
  useEffect(() => {
    let disposed = false;
    let resizeHandler: (() => void) | null = null;

    const run = async () => {
      if (!canvasRef.current) return;

      (window as any).PIXI = PIXI;
      const app = new PIXI.Application({
        view: canvasRef.current,
        backgroundAlpha: 0,
        resizeTo: window,
        preserveDrawingBuffer: true,
        antialias: true,
      });
      appRef.current = app;

      if (transparentBg) {
        (app.renderer as any).backgroundColor = 0x00000000;
        (app.renderer as any).backgroundAlpha = 0;
        (app.renderer as any).clearBeforeRender = true;
      } else {
        (app.renderer as any).backgroundColor = 0xf0f0f0;
        (app.renderer as any).backgroundAlpha = 1;
        (app.renderer as any).clearBeforeRender = false;
      }

      // 如果已有选择，载入模型
      if (modelUrl) {
        await loadModel(app, modelUrl);
        if (disposed) return;
      }

      // 透明清屏
      if (transparentBg) {
        const gl = (app.renderer as any).gl;
        if (gl) gl.clearColor(0, 0, 0, 0);
      }

      resizeHandler = () => {
        const m = modelRef.current;
        if (m) m.position.set(app.screen.width / 2, app.screen.height / 2);
      };
      window.addEventListener("resize", resizeHandler);
    };

    run();

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
      // 清理 PIXI
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        appRef.current = null;
      }
      modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只初始化一次

  // 切换透明背景时同步 renderer
  useEffect(() => {
    if (appRef.current) {
      if (transparentBg) {
        (appRef.current.renderer as any).backgroundColor = 0x00000000;
        (appRef.current.renderer as any).backgroundAlpha = 0;
        (appRef.current.renderer as any).clearBeforeRender = true;
      } else {
        (appRef.current.renderer as any).backgroundColor = 0xf0f0f0;
        (appRef.current.renderer as any).backgroundAlpha = 1;
        (appRef.current.renderer as any).clearBeforeRender = false;
      }
    }
  }, [transparentBg]);

  // 当选择的模型发生变化时，重新加载
  useEffect(() => {
    (async () => {
      if (!appRef.current) return;
      if (!modelUrl) return;

      // 停止播放，清时间线
      stopPlayback();
      clearTimeline();

      // 移除旧模型
      if (modelRef.current) {
        try {
          appRef.current.stage.removeChild(modelRef.current);
          (modelRef.current as any).destroy({ children: true, texture: true, baseTexture: true });
        } catch {}
        modelRef.current = null;
      }

      await loadModel(appRef.current, modelUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // 解析 .mtn：预取真实时长（依赖当前模型数据 & 模型 URL）
  useEffect(() => {
    if (!modelData || !modelUrl) return;
    let aborted = false;

    const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
    const resolveUrl = (rel: string) => {
      if (/^https?:\/\//i.test(rel)) return rel;
      if (rel.startsWith("/")) return rel;
      if (rel.startsWith("./")) rel = rel.slice(2);
      return base + rel;
    };

    (async () => {
      const entries = Object.entries(modelData.motions || {});
      const results = await Promise.all(
        entries.map(async ([group, arr]) => {
          const first = arr?.[0]?.file;
          if (!first || !/\.mtn$/i.test(first)) return [group, undefined] as const;
          try {
            const txt = await (await fetch(resolveUrl(first))).text();
            const info = parseMtn(txt);
            return [group, info.durationMs / 1000] as const;
          } catch {
            return [group, undefined] as const;
          }
        })
      );
      if (aborted) return;
      setMotionLen(Object.fromEntries(results.filter(([, s]) => s != null) as [string, number][]));
    })();

    return () => { aborted = true; };
  }, [modelData, modelUrl]);

  // ——— 播放 —— //
  const playMotion = (group: string) => {
    const m = modelRef.current;
    if (!m || !modelData?.motions[group]) return;
    m.motion(group, 0, 3);
    setCurrentMotion(group);
  };

  const applyExpression = (name: string) => {
    const m = modelRef.current;
    if (!m || !modelData?.expressions?.length) return;
    m.expression(name);
    setCurrentExpression(name);
  };

  // ——— 时间线 —— //
  const nextEnd = (clips: Clip[]) => clips.reduce((t, c) => Math.max(t, c.start + c.duration), 0);

  const addMotionClip = async (name: string) => {
    if (!name) return;
    const dur = motionLen[name] ?? motionDur;
    setMotionClips((prev) => [...prev, { id: crypto.randomUUID(), name, start: nextEnd(prev), duration: dur }]);
  };

  const addExprClip = (name: string) => {
    if (!name) return;
    setExprClips((prev) => [...prev, { id: crypto.randomUUID(), name, start: nextEnd(prev), duration: exprDur }]);
  };

  const timelineLength = Math.max(nextEnd(motionClips), nextEnd(exprClips));

  const tick = (ts: number) => {
    if (startTsRef.current == null) startTsRef.current = ts;
    const t = (ts - startTsRef.current) / 1000;
    setPlayhead(t);

    for (const c of motionClips) {
      if (t >= c.start && !firedRef.current.has(c.id)) {
        playMotion(c.name);
        firedRef.current.add(c.id);
      }
    }
    for (const c of exprClips) {
      if (t >= c.start && !firedRef.current.has(c.id)) {
        applyExpression(c.name);
        firedRef.current.add(c.id);
      }
    }

    if (t >= timelineLength) {
      stopPlayback();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startPlayback = () => {
    if (isPlaying || timelineLength <= 0) return;
    firedRef.current.clear();
    setPlayhead(0);
    setIsPlaying(true);
    startTsRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopPlayback = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startTsRef.current = null;
    setIsPlaying(false);
  };

  // —— 录制 —— //
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("此环境不支持 VP9 透明直录");
      return;
    }

    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0)
    );
    if (totalDuration <= 0) {
      alert("请先在时间线中添加动作或表情片段");
      return;
    }

    recRef.current = createVp9AlphaRecorder(canvasRef.current, 60, 16000, {
      onProgress: (time) => {
        setRecordingTime(time);
        setRecordingProgress((time / totalDuration) * 100);
      }
    });

    recRef.current.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    setTimeout(() => {
      if (recState === "rec") stop();
    }, totalDuration * 1000);
  };

  const stop = async () => {
    if (!recRef.current) return;
    const b = await recRef.current.stop();
    setBlob(b);
    setRecState("done");
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();
  };

  const saveWebM = async () => {
    if (!recRef.current || !blob) return;
    await recRef.current.saveWebM(blob);
  };

  const toMov = async () => {
    if (!blob) return;
    const name = `alpha-${Date.now()}.webm`;
    await writeFile(name, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.AppCache });
    const abs = await join(await appCacheDir(), name);
    const out = await save({ defaultPath: "export-4444.mov", filters: [{ name: "MOV", extensions: ["mov"] }] });
    if (!out) return;
    await invoke("vp9_to_prores4444", { inWebm: abs, outMov: out });
  };

  // —— 使模型可拖动 —— //
  const makeDraggable = (model: any) => {
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
      }
    });

    const up = () => { setIsDragging(false); (model as any).dragging = false; };
    model.on("pointerup", up);
    model.on("pointerupoutside", up);
  };

  // 实际加载模型
  const loadModel = async (app: PIXI.Application, url: string) => {
    try {
      const model = await Live2DModel.from(url);
      modelRef.current = model;

      // 读取 json
      const res = await fetch(url, { cache: "no-cache" });
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
      }

      app.stage.addChild(model);
      if (enableDragging) makeDraggable(model);
    } catch (err) {
      console.error("❌ 模型加载失败:", err);
      setModelData(null);
    }
  };

  return (
    <div className="live2d-container">
      <canvas
        ref={canvasRef}
        style={{ background: "transparent", display: "block" }}
        data-transparent="true"
      />

      {/* 控制面板 */}
      {showControls && (
        <ControlPanel
          onClose={() => setShowControls(false)}

          // 新增：模型选择（ControlPanel 需增加这3个 props）
          modelList={modelList}
          selectedModel={selectedModel}
          onSelectModel={(rel) => setSelectedModel(rel || null)}
          onRefreshModels={refreshModels}

          modelData={modelData}
          motionLen={motionLen}
          currentMotion={currentMotion}
          currentExpression={currentExpression}
          motionDur={motionDur}
          exprDur={exprDur}
          setMotionDur={setMotionDur}
          setExprDur={setExprDur}
          chooseMotion={(name) => { playMotion(name); setCurrentMotion(name); }}
          chooseExpression={(name) => { applyExpression(name); setCurrentExpression(name); }}
          addMotionClip={addMotionClip}
          addExprClip={addExprClip}
          enableDragging={enableDragging}
          setEnableDragging={setEnableDragging}
          isDragging={isDragging}
          timelineLength={Math.max(
            motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
            exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0)
          )}
          playhead={playhead}
          isPlaying={isPlaying}
          startPlayback={startPlayback}
          stopPlayback={stopPlayback}
          clearTimeline={clearTimeline}
          onChangeClip={changeClip}
          onSetPlayhead={setPlayheadSec}
        />
      )}

      {/* 时间线 */}
      <Timeline
        motionClips={motionClips}
        exprClips={exprClips}
        playheadSec={playhead}
        onChangeClip={changeClip}
        onRemoveClip={(track, id) => {
          if (track === "motion") setMotionClips(prev => prev.filter(c => c.id !== id));
          else setExprClips(prev => prev.filter(c => c.id !== id));
        }}
        onSetPlayhead={setPlayheadSec}
      />

      {/* 导出工具条（右下角） */}
      <div
        className="export-toolbar"
        style={{
          position: "absolute",
          right: 16,
          bottom: 160,
          zIndex: 1000,
          background: "rgba(0,0,0,.85)",
          color: "#fff",
          padding: 12,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "stretch",
          minWidth: "200px",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="transparentBg"
            checked={transparentBg}
            onChange={(e) => setTransparentBg(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <label htmlFor="transparentBg" style={{ fontSize: "12px" }}>
            透明背景
          </label>
        </div>

        {recState !== "rec" ? (
          <button
            onClick={start}
            disabled={!isVp9AlphaSupported()}
            style={{
              background: "#28a745",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            ⬤ 开始录制（VP9 透明）
          </button>
        ) : (
          <button
            onClick={stop}
            style={{
              background: "#ff6b6b",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            ■ 停止录制
          </button>
        )}

        {recState === "rec" && (
          <div style={{ fontSize: "12px", textAlign: "center" }}>
            <div>录制中... {recordingTime.toFixed(1)}s</div>
            <div style={{
              width: "100%",
              height: "4px",
              background: "#444",
              borderRadius: "2px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${recordingProgress}%`,
                height: "100%",
                background: "#28a745",
                transition: "width 0.1s"
              }} />
            </div>
          </div>
        )}

        <button
          onClick={saveWebM}
          disabled={!blob}
          style={{
            background: blob ? "#007bff" : "#6c757d",
            color: "#fff",
            border: "none",
            padding: "6px 12px",
            borderRadius: "4px",
            cursor: blob ? "pointer" : "not-allowed",
            fontSize: "12px"
          }}
        >
          下载 WebM（透明）
        </button>

        <button
          onClick={toMov}
          disabled={!blob}
          style={{
            background: blob ? "#6f42c1" : "#6c757d",
            color: "#fff",
            border: "none",
            padding: "6px 12px",
            borderRadius: "4px",
            cursor: blob ? "pointer" : "not-allowed",
            fontSize: "12px"
          }}
        >
          转 MOV（ProRes 4444）
        </button>
      </div>

      {!showControls && (
        <button className="l2d-toggle" onClick={() => setShowControls(true)}>
          🎛️ 显示控制面板
        </button>
      )}
    </div>
  );
}

