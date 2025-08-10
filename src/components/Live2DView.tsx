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
import {invoke} from "@tauri-apps/api/core";
import {save} from "@tauri-apps/plugin-dialog";
import {appCacheDir, BaseDirectory, join} from "@tauri-apps/api/path";
import {writeFile} from "@tauri-apps/plugin-fs";
interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
    motions: { [key: string]: Motion[] };
    expressions: Expression[];
}

const JSON_URL = "/model/anon/model.json";
type MotionLenMap = Record<string, number>;

export default function Live2DView() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);

    const [modelData, setModelData] = useState<ModelData | null>(null);
    const [currentMotion, setCurrentMotion] = useState<string>("");
    const [currentExpression, setCurrentExpression] = useState<string>("default");
    const [showControls, setShowControls] = useState<boolean>(true);
    const [enableDragging, setEnableDragging] = useState<boolean>(true);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    // —— 时间线 ——
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

    // 解析得到的每组 motion 的真实时长
    const [motionLen, setMotionLen] = useState<MotionLenMap>({});

    const clearTimeline = () => { setMotionClips([]); setExprClips([]); setPlayhead(0); };

    const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
        if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
        else setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    };

    const setPlayheadSec = (sec: number) => setPlayhead(sec);

    // —— VP9 直录 & 导出 —— //
    // const TARGET_FPS = 60;
    const recRef = useRef<ReturnType<typeof createVp9AlphaRecorder> | null>(null);
    const [recState, setRecState] = useState<"idle" | "rec" | "done">("idle");
    // const [isExporting, setIsExporting] = useState(false);
    // const [lastMovPath, setLastMovPath] = useState<string | null>(null); // 录完后得到的 MOV 绝对路径
    // const [bgHex, setBgHex] = useState("#000000");

    const [blob, setBlob] = useState<Blob|null>(null);

    // 环境支持检测（按钮可用态/提示）

    // 开始：先选 MOV 保存路径，再开始录制
    const start = () => {
        if (!canvasRef.current) return;
        if (!isVp9AlphaSupported()) { alert("此环境不支持 VP9 透明直录"); return; }
        recRef.current = createVp9AlphaRecorder(canvasRef.current, 60, 16000);
        recRef.current.start();
        setRecState("rec");
        // 如果你有时间线，记得播放并在末尾 stop()
    };

// 停止
    const stop = async () => {
        if (!recRef.current) return;
        const b = await recRef.current.stop();
        setBlob(b);
        setRecState("done");
    };

// 直接保存 WebM（像 html 一样）
    const saveWebM = async () => {
        if (!recRef.current || !blob) return;
        await recRef.current.saveWebM(blob);
    };

// 可选：转 MOV（ProRes 4444）
    const toMov = async () => {
        if (!blob) return;
        // 先缓存 webm 再转
        const name = `alpha-${Date.now()}.webm`;
        await writeFile(name, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.AppCache });
        const abs = await join(await appCacheDir(), name);

        const out = await save({ defaultPath: "export-4444.mov", filters: [{ name: "MOV", extensions: ["mov"] }] });
        if (!out) return;
        await invoke("vp9_to_prores4444", { inWebm: abs, outMov: out });
    };

    // ————————————————————————————————————————————
    // 初始化 PIXI & Live2D（单实例，透明画布）
    // ————————————————————————————————————————————
    useEffect(() => {
        let disposed = false;
        let resizeHandler: (() => void) | null = null;

        const run = async () => {
            if (!canvasRef.current) return;

            (window as any).PIXI = PIXI;
            const app = new PIXI.Application({
                view: canvasRef.current,
                backgroundAlpha: 0,          // 透明底（关键）
                resizeTo: window,
                preserveDrawingBuffer: true, // 对 toBlob 有用；对 captureStream 可无
                antialias: true,
            });
            // Pixi v6：可用 clearBeforeRender；不要用 v7 的 renderer.background.alpha
            (app.renderer as any).clearBeforeRender = true;

            try {
                const model = await Live2DModel.from(JSON_URL);
                if (disposed) return;
                modelRef.current = model;

                const res = await fetch(JSON_URL);
                const data = await res.json();
                if (disposed) return;
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

                resizeHandler = () => model.position.set(app.screen.width / 2, app.screen.height / 2);
                window.addEventListener("resize", resizeHandler);
            } catch (err) {
                console.error("❌ 模型加载失败:", err);
            }
        };

        run();

        return () => {
            disposed = true;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (resizeHandler) window.removeEventListener("resize", resizeHandler);
            if (canvasRef.current) {
                canvasRef.current.width = 0;
                canvasRef.current.height = 0;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enableDragging]);

    // ————————————————————————————————————————————
    // 解析 .mtn：预取真实时长（秒）
    // ————————————————————————————————————————————
    useEffect(() => {
        if (!modelData) return;
        let aborted = false;

        const base = JSON_URL.slice(0, JSON_URL.lastIndexOf("/") + 1);
        const resolveUrl = (rel: string) => {
            if (/^https?:\/\//i.test(rel)) return rel;
            if (rel.startsWith("/")) return rel;
            if (rel.startsWith("./")) rel = rel.slice(2);
            return base + rel;
        };

        (async () => {
            const entries = Object.entries(modelData.motions);
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
    }, [modelData]);

    // ————————————————————————————————————————————
    // 播放调用
    // ————————————————————————————————————————————
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

    // ————————————————————————————————————————————
    // 时间线：添加片段
    // ————————————————————————————————————————————
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

    // ————————————————————————————————————————————
    // 时间线：播放控制
    // ————————————————————————————————————————————
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

    // ————————————————————————————————————————————
    // 拖拽
    // ————————————————————————————————————————————
    const makeDraggable = (model: any) => {
        model.interactive = true;
        model.buttonMode = true;

        model.on("pointerdown", (e: any) => {
            setIsDragging(true);
            model.dragging = true;
            model._pointerX = e.data.global.x - model.x;
            model._pointerY = e.data.global.y - model.y;
        });

        model.on("pointermove", (e: any) => {
            if (model.dragging) {
                model.position.x = e.data.global.x - model._pointerX;
                model.position.y = e.data.global.y - model._pointerY;
            }
        });

        const up = () => { setIsDragging(false); model.dragging = false; };
        model.on("pointerup", up);
        model.on("pointerupoutside", up);
    };

    return (
        <div className="l2d-root">
            {/* 画布区域 */}
            <div className="l2d-stage">
                <canvas ref={canvasRef} className="l2d-stage-canvas" />
            </div>

            {/* 导出工具条（右下角） */}
            <div
                style={{
                    position: "absolute",
                    right: 16,
                    bottom: 160,
                    zIndex: 1000,            // ← 关键
                    background: "rgba(0,0,0,.85)",
                    color: "#fff",
                    padding: 12,
                    borderRadius: 10,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",        // 小窗口不挤出屏幕
                    pointerEvents: "auto",   // 防止父层禁用事件
                }}
            >
                {recState !== "rec" ? (
                    <button onClick={start} disabled={!isVp9AlphaSupported()}>
                        ⬤ 开始录制（VP9 透明）
                    </button>
                ) : (
                    <button onClick={stop} style={{ background:"#ff6b6b", color:"#fff" }}>
                        ■ 停止
                    </button>
                )}

                <button onClick={saveWebM} disabled={!blob}>
                    下载 WebM（透明）
                </button>

                <button onClick={toMov} disabled={!blob}>
                    转 MOV（ProRes 4444）
                </button>
            </div>



            {/* 控制面板 */}
            {showControls && (
                <ControlPanel
                    onClose={() => setShowControls(false)}
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
                    timelineLength={timelineLength}
                    playhead={playhead}
                    isPlaying={isPlaying}
                    startPlayback={startPlayback}
                    stopPlayback={stopPlayback}
                    clearTimeline={clearTimeline}
                />
            )}



            {/* 底部时间线 */}
            <div className="l2d-timeline">
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
            </div>




            {!showControls && (
                <button className="l2d-toggle" onClick={() => setShowControls(true)}>
                    🎛️ 显示控制面板
                </button>
            )}
        </div>
    );
}
