import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, SubtitleClip, TrackKind } from "./clipTypes";

type Props = {
  motionClips: Clip[];
  exprClips: Clip[];
  audioClips: Clip[];
  subtitleClips: SubtitleClip[];
  playheadSec: number;
  playheadSourceRef?: { current: number };
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
const TRACK_H = 62;
const CLIP_H = 42;
const HANDLE_W = 8;
const RULER_H = 34;

type DragKind =
  | { mode: "move"; track: TrackKind; id: string; start0: number; mouseX0: number }
  | { mode: "resize-l" | "resize-r"; track: TrackKind; id: string; start0: number; duration0: number; mouseX0: number }
  | { mode: "playhead"; mouseX0: number; playhead0: number }
  | null;

const trackConfig: Record<TrackKind, { label: string; sublabel: string; color: string }> = {
  motion: { label: "动作轨", sublabel: "Motion", color: "#6b7aff" },
  expr: { label: "表情轨", sublabel: "Expression", color: "#2fa38d" },
  audio: { label: "音频轨", sublabel: "Audio", color: "#d7863f" },
  subtitle: { label: "字幕轨", sublabel: "Subtitle", color: "#c96a6a" },
};

function getAudioAudibleRatio(clip: Clip) {
  const duration = Math.max(0, Number(clip.duration) || 0);
  if (duration <= 0) return 1;
  const sourceDuration = Math.max(0, Number(clip.audioSourceDuration ?? clip.duration) || 0);
  return Math.max(0, Math.min(1, sourceDuration / duration));
}

export default function Timeline({
  motionClips,
  exprClips,
  audioClips,
  subtitleClips,
  playheadSec,
  playheadSourceRef,
  pixelsPerSec,
  onChangePixelsPerSec,
  onChangeClip,
  onRemoveClip,
  onSetPlayhead,
  onStartPlayback,
  onStopPlayback,
  isPlaying,
}: Props) {
  const [internalPps, setInternalPps] = useState(pixelsPerSec ?? DEFAULT_PPS);
  useEffect(() => {
    if (typeof pixelsPerSec === "number") setInternalPps(pixelsPerSec);
  }, [pixelsPerSec]);

  const pps = typeof pixelsPerSec === "number" ? pixelsPerSec : internalPps;
  const setPps = (value: number) => {
    const next = Math.max(10, Math.min(800, Math.round(value)));
    onChangePixelsPerSec ? onChangePixelsPerSec(next) : setInternalPps(next);
  };

  const lengthSec = useMemo(
    () =>
      Math.max(
        motionClips.reduce((time, clip) => Math.max(time, clip.start + clip.duration), 0),
        exprClips.reduce((time, clip) => Math.max(time, clip.start + clip.duration), 0),
        audioClips.reduce((time, clip) => Math.max(time, clip.start + clip.duration), 0),
        subtitleClips.reduce((time, clip) => Math.max(time, clip.start + clip.duration), 0),
        0,
      ),
    [motionClips, exprClips, audioClips, subtitleClips],
  );

  const hasClips = motionClips.length > 0 || exprClips.length > 0 || audioClips.length > 0 || subtitleClips.length > 0;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const timeAreaRef = useRef<HTMLDivElement | null>(null);
  const playheadLineRef = useRef<HTMLDivElement | null>(null);
  const playheadValueRef = useRef<HTMLSpanElement | null>(null);
  const visualPlayheadSecRef = useRef(playheadSec);
  const [drag, setDrag] = useState<DragKind>(null);

  const getTimelineX = (clientX: number) => {
    const timeArea = timeAreaRef.current;
    if (!timeArea) return 0;
    const rect = timeArea.getBoundingClientRect();
    return clientX - rect.left + timeArea.scrollLeft;
  };

  useEffect(() => {
    const timeArea = timeAreaRef.current;
    if (!timeArea) return;
    const wheelListenerOptions: AddEventListenerOptions = { passive: false };

    const onWheel = (event: WheelEvent) => {
      if (event.altKey) {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 0.9 : 1.1;
        setPps(pps * factor);
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
        timeArea.scrollLeft += delta;
      }
    };
    timeArea.addEventListener("wheel", onWheel, wheelListenerOptions);
    return () => timeArea.removeEventListener("wheel", onWheel, wheelListenerOptions);
  }, [pps]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!drag) return;
      const x = getTimelineX(event.clientX);

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
        onSetPlayhead?.(Math.max(0, snap(drag.playhead0 + dx)));
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

  const totalPx = Math.max(pps * Math.max(1, lengthSec), 960);

  const syncPlayheadVisual = (sec: number) => {
    const nextSec = Math.max(0, sec);
    visualPlayheadSecRef.current = nextSec;

    if (playheadLineRef.current) {
      playheadLineRef.current.style.transform = `translateX(${nextSec * pps}px)`;
    }

    if (playheadValueRef.current) {
      playheadValueRef.current.textContent = formatPrecise(nextSec);
    }
  };

  useEffect(() => {
    syncPlayheadVisual(playheadSec);
  }, [playheadSec, pps]);

  useEffect(() => {
    if (!isPlaying) {
      syncPlayheadVisual(playheadSourceRef?.current ?? playheadSec);
      return;
    }

    let rafId = 0;
    const tickVisual = () => {
      syncPlayheadVisual(playheadSourceRef?.current ?? playheadSec);
      rafId = requestAnimationFrame(tickVisual);
    };

    rafId = requestAnimationFrame(tickVisual);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playheadSec, playheadSourceRef, pps]);

  const Ruler = () => {
    const secCount = Math.ceil(totalPx / pps);
    const majorEvery = niceMajorStep(pps);
    return (
      <div
        className="tl-ruler"
        title="拖动设置播放头，双击开始播放"
        onMouseDown={(event) => {
          const x = getTimelineX(event.clientX);
          setDrag({ mode: "playhead", mouseX0: x, playhead0: playheadSourceRef?.current ?? playheadSec });
          onSetPlayhead?.(snap(Math.max(0, x / pps)));
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (onStartPlayback && !isPlaying) onStartPlayback();
        }}
      >
        <div className="tl-ruler-inner" style={{ width: totalPx, height: RULER_H }}>
          {Array.from({ length: secCount + 1 }).map((_, index) => (
            <div key={index} className="tl-tick" style={{ left: index * pps }}>
              <div className="tl-tick-major" />
              {index % majorEvery === 0 ? <div className="tl-tick-label">{formatSec(index)}</div> : null}
              <div className="tl-tick-sub" style={{ left: pps * 0.5 }} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const Track = ({ clips, track }: { clips: Clip[]; track: TrackKind }) => {
    const config = trackConfig[track];

    return (
      <div className="tl-track-row">
        <div className="tl-lane" style={{ height: TRACK_H }}>
          <div className="tl-grid" style={{ width: totalPx }}>
            {Array.from({ length: Math.ceil(totalPx / pps) + 1 }).map((_, index) => (
              <div key={index} className="tl-grid-line" style={{ left: index * pps }} />
            ))}
          </div>

          <div className="tl-clips" style={{ width: totalPx, height: TRACK_H }}>
            {clips.map((clip) => {
              const left = clip.start * pps;
              const width = Math.max(pps * clip.duration, 28);
              const audioAudibleRatio = track === "audio" ? getAudioAudibleRatio(clip) : 1;
              const waveformPeaks = track === "audio" ? (clip.waveformPeaks ?? []) : [];
              return (
                <div
                  key={clip.id}
                  className={`tl-clip ${track === "audio" ? "tl-clip--audio" : ""}`}
                  title={`${clip.name} ${clip.duration.toFixed(2)}s`}
                  style={{
                    left,
                    width,
                    height: CLIP_H,
                    top: (TRACK_H - CLIP_H) / 2,
                    background: config.color,
                  }}
                  onMouseDown={(event) => {
                    const element = event.target as HTMLElement;
                    if (element.classList.contains("tl-handle")) return;
                    const x = getTimelineX(event.clientX);
                    setDrag({ mode: "move", track, id: clip.id, start0: clip.start, mouseX0: x });
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onStartPlayback && !isPlaying) onStartPlayback();
                  }}
                >
                  {track === "audio" ? (
                    <div className="tl-audio-visual" aria-hidden="true">
                      <div className="tl-audio-waveform" style={{ width: `${audioAudibleRatio * 100}%` }}>
                        {waveformPeaks.map((peak, index) => (
                          <span
                            key={`${clip.id}-peak-${index}`}
                            className="tl-audio-peak"
                            style={{ height: `${Math.max(16, peak * 100)}%` }}
                          />
                        ))}
                      </div>
                      {audioAudibleRatio < 1 ? (
                        <div className="tl-audio-tail" style={{ left: `${audioAudibleRatio * 100}%` }}>
                          <span>延长静音</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className="tl-handle tl-handle--l"
                    style={{ width: HANDLE_W }}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      const x = getTimelineX(event.clientX);
                      setDrag({
                        mode: "resize-l",
                        track,
                        id: clip.id,
                        start0: clip.start,
                        duration0: clip.duration,
                        mouseX0: x,
                      });
                    }}
                  />

                  <div className="tl-clip-copy">
                    <div className="tl-clip-name">{clip.name}</div>
                    <div className="tl-clip-dur">{clip.duration.toFixed(2)} 秒</div>
                  </div>

                  <button
                    className="tl-clip-remove"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveClip(track, clip.id);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    aria-label={`删除${config.label}片段`}
                  >
                    ×
                  </button>

                  <div
                    className="tl-handle tl-handle--r"
                    style={{ width: HANDLE_W }}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      const x = getTimelineX(event.clientX);
                      setDrag({
                        mode: "resize-r",
                        track,
                        id: clip.id,
                        start0: clip.start,
                        duration0: clip.duration,
                        mouseX0: x,
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tl-root" ref={wrapRef}>
      <div className="tl-header">
        <div className="tl-header-copy">
          <div className="tl-kicker">时间线</div>
          <h3 className="tl-title">剪辑编排</h3>
        </div>
        <div className="tl-toolbar">
          <button
            className={`btn ${isPlaying ? "btn--accent" : "btn--primary"}`}
            onClick={() => (isPlaying ? onStopPlayback?.() : onStartPlayback?.())}
            disabled={!hasClips && !isPlaying}
          >
            {isPlaying ? "停止播放" : "开始播放"}
          </button>
          <button className="btn btn--quiet" onClick={() => onSetPlayhead?.(0)}>
            回到开头
          </button>
          <div className="tl-toolbar-meta">
            <span>
              播放头 <span ref={playheadValueRef}>{formatPrecise(playheadSec)}</span>
            </span>
            <span>总长 {formatPrecise(lengthSec)}</span>
          </div>
          <div className="tl-zoom-group">
            <button className="btn btn--quiet" onClick={() => setPps(pps * 0.8)}>
              缩小
            </button>
            <div className="tl-zoom">{Math.round(pps)} px/s</div>
            <button className="btn btn--quiet" onClick={() => setPps(pps * 1.25)}>
              放大
            </button>
            <button
              className="btn btn--quiet"
              onClick={() => {
                const targetPx = 1400;
                const sec = Math.max(1, lengthSec || 1);
                setPps(Math.max(10, Math.min(800, targetPx / sec)));
              }}
              disabled={!hasClips}
            >
              适配全长
            </button>
          </div>
        </div>
      </div>

      <div className="tl-layout">
        <div className="tl-side">
          <div className="tl-side-cell tl-side-cell--ruler">
            <strong>时间尺</strong>
            <span>Time</span>
          </div>
          <div className="tl-side-cell">
            <strong>{trackConfig.motion.label}</strong>
            <span>{trackConfig.motion.sublabel}</span>
          </div>
          <div className="tl-side-cell">
            <strong>{trackConfig.expr.label}</strong>
            <span>{trackConfig.expr.sublabel}</span>
          </div>
          <div className="tl-side-cell">
            <strong>{trackConfig.audio.label}</strong>
            <span>{trackConfig.audio.sublabel}</span>
          </div>
          <div className="tl-side-cell">
            <strong>{trackConfig.subtitle.label}</strong>
            <span>{trackConfig.subtitle.sublabel}</span>
          </div>
        </div>

        <div className="tl-timearea" ref={timeAreaRef}>
          <div className="tl-timecontent">
            <Ruler />
            {hasClips ? (
              <>
                <Track clips={motionClips} track="motion" />
                <Track clips={exprClips} track="expr" />
                <Track clips={audioClips} track="audio" />
                <Track clips={subtitleClips} track="subtitle" />
                <div ref={playheadLineRef} className="tl-playhead-global" style={{ left: 0, transform: `translateX(${playheadSec * pps}px)` }} />
              </>
            ) : (
              <div className="tl-empty">
                <strong>时间线还是空的</strong>
                <span>从左侧资源区把动作、表情或音频加入轨道，开始搭建镜头节奏。</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function snap(sec: number) {
  return Math.max(0, Math.round(sec / GRID_STEP_SEC) * GRID_STEP_SEC);
}

function formatSec(sec: number) {
  return `${sec.toFixed(0)}s`;
}

function formatPrecise(sec: number) {
  return `${sec.toFixed(2)} 秒`;
}

function niceMajorStep(pps: number) {
  const minPx = 80;
  const candidates = [1, 2, 5, 10, 20, 30, 60];
  for (const sec of candidates) {
    if (sec * pps >= minPx) return sec;
  }
  return 60;
}
