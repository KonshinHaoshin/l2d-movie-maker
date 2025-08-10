import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, TrackKind } from "./types";

type Props = {
    motionClips: Clip[];
    exprClips: Clip[];
    playheadSec: number;

    // 可控/不可控 zoom：传入就受控，不传则内部自己管
    pixelsPerSec?: number;
    onChangePixelsPerSec?: (pps: number) => void;

    // 编辑行为
    onChangeClip: (
        track: TrackKind,
        id: string,
        patch: Partial<Pick<Clip, "start" | "duration">>
    ) => void;
    onRemoveClip: (track: TrackKind, id: string) => void;

    // 播放头
    onSetPlayhead?: (sec: number) => void;
};

// —— UI 常量 —— //
const MIN_CLIP_SEC = 0.1;
const GRID_STEP_SEC = 0.1; // 吸附粒度（0.1s）
const DEFAULT_PPS = 80; // 默认像素/秒（比120更“合理”，6-7s 也不会太长）
const TRACK_H = 56;
const CLIP_H = 40;
const HANDLE_W = 8;

type DragKind =
    | { mode: "move"; track: TrackKind; id: string; start0: number; mouseX0: number }
    | {
    mode: "resize-l" | "resize-r";
    track: TrackKind;
    id: string;
    start0: number;
    duration0: number;
    mouseX0: number;
}
    | { mode: "playhead"; mouseX0: number; playhead0: number }
    | null;

export default function Timeline({
                                     motionClips,
                                     exprClips,
                                     playheadSec,
                                     pixelsPerSec,
                                     onChangePixelsPerSec,
                                     onChangeClip,
                                     onRemoveClip,
                                     onSetPlayhead,
                                 }: Props) {
    // 缩放：支持受控/非受控
    const [internalPps, setInternalPps] = useState(pixelsPerSec ?? DEFAULT_PPS);
    useEffect(() => {
        if (typeof pixelsPerSec === "number") setInternalPps(pixelsPerSec);
    }, [pixelsPerSec]);
    const pps = typeof pixelsPerSec === "number" ? pixelsPerSec : internalPps;

    const setPps = (v: number) => {
        const next = Math.max(10, Math.min(800, Math.round(v)));
        onChangePixelsPerSec ? onChangePixelsPerSec(next) : setInternalPps(next);
    };

    // 时间线总时长：取两条轨的最大结束时间
    const lengthSec = useMemo(
        () =>
            Math.max(
                motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
                exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
                0
            ),
        [motionClips, exprClips]
    );

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [drag, setDrag] = useState<DragKind>(null);

    // 鼠标滚轮缩放（Alt+滚轮）
    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const onWheel = (e: WheelEvent) => {
            if (e.altKey) {
                e.preventDefault();
                const factor = e.deltaY > 0 ? 0.9 : 1.1;
                setPps(pps * factor);
            }
        };
        wrap.addEventListener("wheel", onWheel, { passive: false });
        return () => wrap.removeEventListener("wheel", onWheel);
    }, [pps]);

    // 拖动时全局事件
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!drag || !wrapRef.current) return;
            const rect = wrapRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;

            if (drag.mode === "move") {
                const dx = (x - drag.mouseX0) / pps;
                const start = snap(Math.max(0, drag.start0 + dx));
                onChangeClip(drag.track, drag.id, { start });
            } else if (drag.mode === "resize-l" || drag.mode === "resize-r") {
                const dx = (x - drag.mouseX0) / pps;
                if (drag.mode === "resize-l") {
                    let start = snap(Math.max(0, drag.start0 + dx));
                    let duration = snap(Math.max(MIN_CLIP_SEC, drag.duration0 - (start - drag.start0)));
                    // 若反向越界则回退
                    if (start + duration > drag.start0 + drag.duration0 + 10) {
                        start = drag.start0;
                        duration = drag.duration0;
                    }
                    onChangeClip(drag.track, drag.id, { start, duration });
                } else {
                    const duration = snap(Math.max(MIN_CLIP_SEC, drag.duration0 + dx));
                    onChangeClip(drag.track, drag.id, { duration });
                }
            } else if (drag.mode === "playhead") {
                const dx = (x - drag.mouseX0) / pps;
                const t = Math.max(0, drag.playhead0 + dx);
                onSetPlayhead?.(t);
            }
        };

        const onUp = () => setDrag(null);

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [drag, pps, onChangeClip, onSetPlayhead]);

    // UI：时间标尺
    const Ruler = () => {
        const totalPx = Math.max(pps * Math.max(1, lengthSec), 600);
        const secCount = Math.ceil(totalPx / pps);
        const majorEvery = niceMajorStep(pps); // 决定每多少秒显示文字
        return (
            <div
                className="tl-ruler"
                onMouseDown={(e) => {
                    if (!wrapRef.current) return;
                    const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                    setDrag({ mode: "playhead", mouseX0: x, playhead0: playheadSec });
                    onSetPlayhead?.(snap(Math.max(0, x / pps)));
                }}
            >
                <div className="tl-ruler-inner" style={{ width: totalPx }}>
                    {Array.from({ length: secCount + 1 }).map((_, i) => (
                        <div key={i} className="tl-tick" style={{ left: i * pps }}>
                            <div className="tl-tick-major" />
                            {i % majorEvery === 0 && <div className="tl-tick-label">{formatSec(i)}</div>}
                            {/* 0.5s 次级刻度 */}
                            <div className="tl-tick-sub" style={{ left: pps * 0.5 }} />
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // 单条轨道
    const Track = ({
                       title,
                       clips,
                       color,
                       track,
                   }: {
        title: string;
        clips: Clip[];
        color: string;
        track: TrackKind;
    }) => {
        const totalPx = Math.max(pps * Math.max(1, lengthSec), 600);
        return (
            <div className="tl-track">
                <div className="tl-title">{title}</div>
                <div className="tl-lane" style={{ height: TRACK_H }}>
                    {/* 网格：1s 间隔 */}
                    <div className="tl-grid" style={{ width: totalPx }}>
                        {Array.from({ length: Math.ceil(totalPx / pps) + 1 }).map((_, i) => (
                            <div key={i} className="tl-grid-line" style={{ left: i * pps }} />
                        ))}
                    </div>

                    {/* 片段 */}
                    <div className="tl-clips" style={{ width: totalPx, height: TRACK_H }}>
                        {clips.map((c) => {
                            const left = c.start * pps;
                            const width = Math.max(pps * c.duration, 28);
                            return (
                                <div
                                    key={c.id}
                                    className="tl-clip"
                                    title={`${c.name}  ${c.duration.toFixed(2)}s`}
                                    style={{
                                        left,
                                        width,
                                        height: CLIP_H,
                                        top: (TRACK_H - CLIP_H) / 2,
                                        background: color,
                                    }}
                                    onMouseDown={(e) => {
                                        // 排除点到把手
                                        const el = e.target as HTMLElement;
                                        if (el.classList.contains("tl-handle")) return;
                                        if (!wrapRef.current) return;
                                        const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                                        setDrag({ mode: "move", track, id: c.id, start0: c.start, mouseX0: x });
                                    }}
                                >
                                    {/* 左右裁剪把手 */}
                                    <div
                                        className="tl-handle tl-handle--l"
                                        style={{ width: HANDLE_W }}
                                        onMouseDown={(e) => {
                                            e.stopPropagation();
                                            if (!wrapRef.current) return;
                                            const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                                            setDrag({
                                                mode: "resize-l",
                                                track,
                                                id: c.id,
                                                start0: c.start,
                                                duration0: c.duration,
                                                mouseX0: x,
                                            });
                                        }}
                                    />
                                    <div className="tl-clip-name">{c.name}</div>
                                    <div className="tl-clip-dur">{c.duration.toFixed(2)}s</div>
                                    <div 
                                        className="tl-clip-remove" 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log("🗑️ 删除按钮被点击:", { track, id: c.id });
                                            console.log("🗑️ 事件对象:", e);
                                            console.log("🗑️ 目标元素:", e.target);
                                            console.log("🗑️ 当前目标:", e.currentTarget);
                                            onRemoveClip(track, c.id);
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log("🗑️ 删除按钮被按下:", { track, id: c.id });
                                        }}
                                        style={{
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            pointerEvents: 'auto',
                                            background: 'red !important',
                                            color: 'white !important',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            fontSize: '14px',
                                            fontWeight: 'bold',
                                            minWidth: '24px',
                                            minHeight: '24px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '2px solid white',
                                            zIndex: 9999
                                        }}
                                    >
                                        ✕
                                    </div>
                                    <div
                                        className="tl-handle tl-handle--r"
                                        style={{ width: HANDLE_W }}
                                        onMouseDown={(e) => {
                                            e.stopPropagation();
                                            if (!wrapRef.current) return;
                                            const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                                            setDrag({
                                                mode: "resize-r",
                                                track,
                                                id: c.id,
                                                start0: c.start,
                                                duration0: c.duration,
                                                mouseX0: x,
                                            });
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* 播放头 */}
                    <div className="tl-playhead" style={{ left: playheadSec * pps }} />
                </div>
            </div>
        );
    };

    // 适配/缩放工具条
    const Toolbar = () => (
        <div className="tl-toolbar">
            <button className="btn" onClick={() => setPps(pps * 0.8)}>− 缩小</button>
            <div className="tl-zoom">{Math.round(pps)} px/s</div>
            <button className="btn" onClick={() => setPps(pps * 1.25)}>＋ 放大</button>
            <button
                className="btn"
                onClick={() => {
                    // 尝试 fit：把总时长放进 ~1200px 宽
                    const targetPx = 1200;
                    const sec = Math.max(1, lengthSec || 1);
                    setPps(Math.max(10, Math.min(800, targetPx / sec)));
                }}
                disabled={lengthSec <= 0}
            >
                适配内容
            </button>
            {/* 测试删除按钮 */}
            <button 
                className="btn" 
                style={{ background: '#ff4444', color: '#fff' }}
                onClick={() => {
                    console.log("🧪 测试删除按钮被点击");
                    if (motionClips.length > 0) {
                        console.log("🧪 测试删除第一个动作片段");
                        onRemoveClip("motion", motionClips[0].id);
                    } else if (exprClips.length > 0) {
                        console.log("🧪 测试删除第一个表情片段");
                        onRemoveClip("expr", exprClips[0].id);
                    } else {
                        console.log("🧪 没有可删除的片段");
                    }
                }}
            >
                测试删除
            </button>
        </div>
    );

    return (
        <div className="tl-root" ref={wrapRef}>
            <Toolbar />
            <Ruler />
            <Track title="动作" clips={motionClips} color="#7c4dff" track="motion" />
            <Track title="表情" clips={exprClips} color="#26a69a" track="expr" />
        </div>
    );
}

// ———— 小工具 ———— //
function snap(sec: number) {
    // 吸附到 GRID_STEP_SEC
    return Math.max(0, Math.round(sec / GRID_STEP_SEC) * GRID_STEP_SEC);
}

function formatSec(s: number) {
    return `${s.toFixed(0)}s`;
}

/** 让大刻度更“好看”：根据缩放选择 1s/2s/5s 间隔显示文字 */
function niceMajorStep(pps: number) {
    // 每次标签至少 80px 间隔
    const minPx = 80;
    const candidates = [1, 2, 5, 10, 20, 30, 60]; // 秒
    for (const sec of candidates) {
        if (sec * pps >= minPx) return sec;
    }
    return 60;
}
