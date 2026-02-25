import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, TrackKind } from "./types";

type Props = {
  motionClips: Clip[];
  exprClips: Clip[];
  audioClips: Clip[];
  playheadSec: number;
  pixelsPerSec?: number;
  onChangePixelsPerSec?: (pps: number) => void;
  onChangeClip: (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => void;
  onRemoveClip: (track: TrackKind, id: string) => void;
  onSetPlayhead?: (sec: number) => void;
  onStartPlayback?: () => void;
  onStopPlayback?: () => void;
  isPlaying?: boolean;
};

const MIN_CLIP_SEC = 0.1;
const GRID_STEP_SEC = 0.1;
const DEFAULT_PPS = 80;
const TRACK_H = 40;
const CLIP_H = 32;
const HANDLE_W = 8;

type DragKind =
  | { mode: "move"; track: TrackKind; id: string; start0: number; mouseX0: number }
  | { mode: "resize-l" | "resize-r"; track: TrackKind; id: string; start0: number; duration0: number; mouseX0: number }
  | { mode: "playhead"; mouseX0: number; playhead0: number }
  | null;

export default function Timeline({
  motionClips,
  exprClips,
  audioClips,
  playheadSec,
  pixelsPerSec,
  onChangePixelsPerSec,
  onChangeClip,
  onRemoveClip,
  onSetPlayhead,
  onStartPlayback,
  onStopPlayback,
  isPlaying,
}: Props) {
  void onStopPlayback;

  const [internalPps, setInternalPps] = useState(pixelsPerSec ?? DEFAULT_PPS);
  useEffect(() => {
    if (typeof pixelsPerSec === "number") setInternalPps(pixelsPerSec);
  }, [pixelsPerSec]);

  const pps = typeof pixelsPerSec === "number" ? pixelsPerSec : internalPps;
  const setPps = (v: number) => {
    const next = Math.max(10, Math.min(800, Math.round(v)));
    onChangePixelsPerSec ? onChangePixelsPerSec(next) : setInternalPps(next);
  };

  const lengthSec = useMemo(
    () =>
      Math.max(
        motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
        exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
        audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
        0,
      ),
    [motionClips, exprClips, audioClips],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragKind>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setPps(pps * factor);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [pps]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (drag.mode === "move") {
        const dx = (x - drag.mouseX0) / pps;
        onChangeClip(drag.track, drag.id, { start: snap(Math.max(0, drag.start0 + dx)) });
        return;
      }

      if (drag.mode === "resize-l" || drag.mode === "resize-r") {
        const dx = (x - drag.mouseX0) / pps;
        if (drag.mode === "resize-l") {
          let start = snap(Math.max(0, drag.start0 + dx));
          let duration = snap(Math.max(MIN_CLIP_SEC, drag.duration0 - (start - drag.start0)));
          if (start + duration > drag.start0 + drag.duration0 + 10) {
            start = drag.start0;
            duration = drag.duration0;
          }
          onChangeClip(drag.track, drag.id, { start, duration });
        } else {
          const duration = snap(Math.max(MIN_CLIP_SEC, drag.duration0 + dx));
          onChangeClip(drag.track, drag.id, { duration });
        }
        return;
      }

      if (drag.mode === "playhead") {
        const dx = (x - drag.mouseX0) / pps;
        onSetPlayhead?.(Math.max(0, drag.playhead0 + dx));
      }
    };

    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onChangeClip, onSetPlayhead, pps]);

  const totalPx = Math.max(pps * Math.max(1, lengthSec), 600);

  const Ruler = () => {
    const secCount = Math.ceil(totalPx / pps);
    const majorEvery = niceMajorStep(pps);
    return (
      <div
        className="tl-ruler"
        title="Double-click to start playback"
        onMouseDown={(e) => {
          if (!wrapRef.current) return;
          const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
          setDrag({ mode: "playhead", mouseX0: x, playhead0: playheadSec });
          onSetPlayhead?.(snap(Math.max(0, x / pps)));
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onStartPlayback && !isPlaying) onStartPlayback();
        }}
        style={{ cursor: "pointer" }}
      >
        <div className="tl-ruler-inner" style={{ width: totalPx }}>
          {Array.from({ length: secCount + 1 }).map((_, i) => (
            <div key={i} className="tl-tick" style={{ left: i * pps }}>
              <div className="tl-tick-major" />
              {i % majorEvery === 0 && <div className="tl-tick-label">{formatSec(i)}</div>}
              <div className="tl-tick-sub" style={{ left: pps * 0.5 }} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const Track = ({ title, clips, color, track }: { title: string; clips: Clip[]; color: string; track: TrackKind }) => (
    <div className="tl-track">
      <div className="tl-title" style={{ marginBottom: "2px" }}>{title}</div>
      <div className="tl-lane" style={{ height: TRACK_H }}>
        <div className="tl-grid" style={{ width: totalPx }}>
          {Array.from({ length: Math.ceil(totalPx / pps) + 1 }).map((_, i) => (
            <div key={i} className="tl-grid-line" style={{ left: i * pps }} />
          ))}
        </div>

        <div className="tl-clips" style={{ width: totalPx, height: TRACK_H }}>
          {clips.map((c) => {
            const left = c.start * pps;
            const width = Math.max(pps * c.duration, 28);
            return (
              <div
                key={c.id}
                className={`tl-clip ${track === "audio" ? "tl-clip--audio" : ""}`}
                title={`${c.name} ${c.duration.toFixed(2)}s`}
                style={{
                  left,
                  width,
                  height: CLIP_H,
                  top: (TRACK_H - CLIP_H) / 2,
                  background: color,
                  cursor: "pointer",
                  position: "absolute",
                  overflow: "hidden",
                  zIndex: 10,
                }}
                onMouseDown={(e) => {
                  const el = e.target as HTMLElement;
                  if (el.classList.contains("tl-handle")) return;
                  if (!wrapRef.current) return;
                  const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                  setDrag({ mode: "move", track, id: c.id, start0: c.start, mouseX0: x });
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onStartPlayback && !isPlaying) onStartPlayback();
                }}
              >
                <div
                  className="tl-handle tl-handle--l"
                  style={{ width: HANDLE_W }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (!wrapRef.current) return;
                    const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                    setDrag({ mode: "resize-l", track, id: c.id, start0: c.start, duration0: c.duration, mouseX0: x });
                  }}
                />

                <div className="tl-clip-name">{c.name}</div>
                <div className="tl-clip-dur">{c.duration.toFixed(2)}s</div>

                <div
                  className="tl-clip-remove"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemoveClip(track, c.id);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  x
                </div>

                <div
                  className="tl-handle tl-handle--r"
                  style={{ width: HANDLE_W }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (!wrapRef.current) return;
                    const x = e.clientX - wrapRef.current.getBoundingClientRect().left;
                    setDrag({ mode: "resize-r", track, id: c.id, start0: c.start, duration0: c.duration, mouseX0: x });
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="tl-playhead" style={{ left: playheadSec * pps }} />
      </div>
    </div>
  );

  const Toolbar = () => (
    <div className="tl-toolbar">
      <button className="btn" onClick={() => setPps(pps * 0.8)}>Zoom Out</button>
      <div className="tl-zoom">{Math.round(pps)} px/s</div>
      <button className="btn" onClick={() => setPps(pps * 1.25)}>Zoom In</button>
      <button
        className="btn"
        onClick={() => {
          const targetPx = 1200;
          const sec = Math.max(1, lengthSec || 1);
          setPps(Math.max(10, Math.min(800, targetPx / sec)));
        }}
        disabled={lengthSec <= 0}
      >
        Fit
      </button>
    </div>
  );

  return (
    <div className="tl-root" ref={wrapRef}>
      <Toolbar />
      <Ruler />
      <Track title="Motion" clips={motionClips} color="#7c4dff" track="motion" />
      <Track title="Expression" clips={exprClips} color="#26a69a" track="expr" />
      <Track title="Audio" clips={audioClips} color="#ff6b35" track="audio" />
    </div>
  );
}

function snap(sec: number) {
  return Math.max(0, Math.round(sec / GRID_STEP_SEC) * GRID_STEP_SEC);
}

function formatSec(s: number) {
  return `${s.toFixed(0)}s`;
}

function niceMajorStep(pps: number) {
  const minPx = 80;
  const candidates = [1, 2, 5, 10, 20, 30, 60];
  for (const sec of candidates) {
    if (sec * pps >= minPx) return sec;
  }
  return 60;
}
