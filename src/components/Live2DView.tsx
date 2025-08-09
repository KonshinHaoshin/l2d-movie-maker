import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";

import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";

import { parseMtn } from "../utils/parseMtn";
import "./Live2DView.css";
import ControlPanel from "./panel/ControlPanel";

// ✅ 新的录制/导出工具（Tauri v2）
import {
    createPngFrameRecorder,
    pickAndEncodeWebMAlpha,
    pickAndEncodeProRes4444,
} from "../utils/recorder";

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

    // —— 录帧 / 导出 —— //
    const FPS = 30;
    const frameRecRef = useRef<ReturnType<typeof createPngFrameRecorder> | null>(null);
    const [recStatus, setRecStatus] = useState<"idle" | "rec" | "done">("idle");
    const [tempSubdir, setTempSubdir] = useState<string | null>(null);
    const [frameCount, setFrameCount] = useState(0);
    const [isEncoding, setIsEncoding] = useState(false);

    const clearTimeline = () => { setMotionClips([]); setExprClips([]); setPlayhead(0); };

    const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
        if (track === "motion") {
            setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
        } else {
            setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
        }
    };

    const setPlayheadSec = (sec: number) => setPlayhead(sec);

    // ===== 录制为 PNG 帧（含透明） =====
    const startRecordTimeline = async () => {
        if (!canvasRef.current) return;
        if (!isPlaying) startPlayback(); // 播放从头开始
        const rec = createPngFrameRecorder(canvasRef.current, FPS);
        frameRecRef.current = rec;
        const { tempSubdir } = await rec.start("l2d_alpha");
        setTempSubdir(tempSubdir);
        setRecStatus("rec");

        // 自动在时间线末尾停止
        if (timelineLength > 0) {
            setTimeout(async () => {
                if (!frameRecRef.current) return;
                const { frames } = await frameRecRef.current.stop();
                setFrameCount(frames);
                setRecStatus("done");
                stopPlayback();
            }, Math.ceil(timelineLength * 1000) + 60);
        }
    };

    const stopRecord = async () => {
        if (!frameRecRef.current) return;
        const { frames } = await frameRecRef.current.stop();
        setFrameCount(frames);
        setRecStatus("done");
        stopPlayback();
    };

    const exportWebM = async () => {
        if (!tempSubdir) return;
        setIsEncoding(true);
        try { await pickAndEncodeWebMAlpha(tempSubdir, FPS); } finally { setIsEncoding(false); }
    };

    const exportProRes = async () => {
        if (!tempSubdir) return;
        setIsEncoding(true);
        try { await pickAndEncodeProRes4444(tempSubdir, FPS); } finally { setIsEncoding(false); }
    };

    // ————————————————————————————————————————————
    // 初始化 PIXI & Live2D
    // ————————————————————————————————————————————
    useEffect(() => {
        let disposed = false;
        let resizeHandler: (() => void) | null = null;

        const run = async () => {
            if (!canvasRef.current) return;

            (window as any).PIXI = PIXI;
            const app = new PIXI.Application({
                view: canvasRef.current,
                backgroundAlpha: 0,          // 透明底
                resizeTo: window,
                preserveDrawingBuffer: true, // 允许 toBlob 读取像素
            });

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

    // 解析 .mtn：预取真实时长（秒）
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

    // 播放
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

    // 添加片段
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

    // 时间线播放控制
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

    // 拖拽
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
            <div style={{
                position: "absolute", right: 16, bottom: 160, zIndex: 25,
                background: "rgba(0,0,0,.85)", color: "#fff", padding: 12,
                borderRadius: 10, display: "flex", gap: 8, alignItems: "center"
            }}>
                {recStatus !== "rec" ? (
                    <button onClick={startRecordTimeline}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer" }}>
                        ⬤ 录制时间线
                    </button>
                ) : (
                    <button onClick={stopRecord}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer", background: "#ff6b6b", color: "#fff" }}>
                        ■ 停止
                    </button>
                )}

                <span style={{ opacity: .8, fontSize: 12 }}>
          {recStatus === "idle" && "未录制"}
                    {recStatus === "rec" && "录制中...（PNG 帧）"}
                    {recStatus === "done" && (tempSubdir ? `已抓取 ${frameCount} 帧` : "已结束")}
        </span>

                <button onClick={exportWebM} disabled={recStatus !== "done" || isEncoding}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer" }}>
                    {isEncoding ? "导出中…" : "➡ WebM（VP9+Alpha）"}
                </button>

                <button onClick={exportProRes} disabled={recStatus !== "done" || isEncoding}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer" }}>
                    {isEncoding ? "导出中…" : "➡ MOV（ProRes 4444）"}
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
