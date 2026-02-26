import React, { useEffect, useMemo, useState } from "react";
import type { Clip, TrackKind } from "../timeline/types";

interface Motion {
  name: string;
  file: string;
}

interface Expression {
  name: string;
  file: string;
}

export interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type CharacterOption = {
  id: string;
  label: string;
};

type CharacterTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

type Props = {
  onClose: () => void;
  onToggleWebGALMode: () => void;

  modelList: string[];
  selectedModel: string | null;
  onSelectModel: (relPath: string | null) => void;
  onRefreshModels?: () => void;

  modelData: ModelData | null;
  motionLen: Record<string, number>;

  currentMotion: string;
  currentExpression: string;

  motionDur: number;
  exprDur: number;
  setMotionDur: (n: number) => void;
  setExprDur: (n: number) => void;

  chooseMotion: (name: string) => void;
  chooseExpression: (name: string) => void;
  addMotionClip: (name: string) => void;
  addExprClip: (name: string) => void;
  addAudioClip: () => void;
  debugModelParameters?: () => void;
  currentAudioLevel?: number;
  currentFps?: number;

  characterOptions: CharacterOption[];
  selectedCharacterId: string;
  onSelectCharacter: (id: string) => void;
  characterTransform: CharacterTransform;
  onUpdateCharacterTransform: (patch: Partial<CharacterTransform>) => void;

  enableDragging: boolean;
  setEnableDragging: (v: boolean) => void;
  isDragging: boolean;

  timelineLength: number;
  playhead: number;
  isPlaying: boolean;
  startPlayback: () => void;
  stopPlayback: () => void;

  clearTimeline: () => void;

  onChangeClip?: (
    track: TrackKind,
    id: string,
    patch: Partial<Pick<Clip, "start" | "duration">>
  ) => void;
  onSetPlayhead?: (sec: number) => void;
};

const ControlPanel: React.FC<Props> = (props) => {
  const {
    onClose,
    onToggleWebGALMode,
    modelList,
    selectedModel,
    onSelectModel,
    onRefreshModels,
    modelData,
    motionLen,
    currentMotion,
    currentExpression,
    motionDur,
    exprDur,
    setMotionDur,
    setExprDur,
    chooseMotion,
    chooseExpression,
    addMotionClip,
    addExprClip,
    addAudioClip,
    characterOptions,
    selectedCharacterId,
    onSelectCharacter,
    characterTransform,
    onUpdateCharacterTransform,
    enableDragging,
    setEnableDragging,
    isDragging,
    timelineLength,
    playhead,
    isPlaying,
    startPlayback,
    stopPlayback,
    clearTimeline,
    currentAudioLevel,
    currentFps,
  } = props;

  const [motionQuery, setMotionQuery] = useState("");
  const [motionPage, setMotionPage] = useState(1);
  const [motionPageSize, setMotionPageSize] = useState(24);
  useEffect(() => {
    setMotionPage(1);
  }, [motionQuery, motionPageSize, modelData]);

  const allMotionNames = useMemo(
    () => (modelData ? Object.keys(modelData.motions || {}) : []),
    [modelData]
  );
  const filteredMotions = useMemo(
    () =>
      allMotionNames.filter((n) =>
        n.toLowerCase().includes(motionQuery.trim().toLowerCase())
      ),
    [allMotionNames, motionQuery]
  );
  const motionPageCount = Math.max(1, Math.ceil(filteredMotions.length / motionPageSize));
  const motionPageSafe = Math.min(motionPage, motionPageCount);
  const motionSlice = filteredMotions.slice(
    (motionPageSafe - 1) * motionPageSize,
    motionPageSafe * motionPageSize
  );

  const [exprQuery, setExprQuery] = useState("");
  const [exprPage, setExprPage] = useState(1);
  const [exprPageSize, setExprPageSize] = useState(24);
  useEffect(() => {
    setExprPage(1);
  }, [exprQuery, exprPageSize, modelData]);

  const allExprNames = useMemo(
    () => (modelData ? (modelData.expressions || []).map((e) => e.name) : []),
    [modelData]
  );
  const filteredExprs = useMemo(
    () =>
      allExprNames.filter((n) =>
        n.toLowerCase().includes(exprQuery.trim().toLowerCase())
      ),
    [allExprNames, exprQuery]
  );
  const exprPageCount = Math.max(1, Math.ceil(filteredExprs.length / exprPageSize));
  const exprPageSafe = Math.min(exprPage, exprPageCount);
  const exprSlice = filteredExprs.slice(
    (exprPageSafe - 1) * exprPageSize,
    exprPageSafe * exprPageSize
  );

  const formatTransformValue = (n: number, digits: number, fallback: string) =>
    Number.isFinite(n) ? n.toFixed(digits) : fallback;

  const [transformDraft, setTransformDraft] = useState({
    x: formatTransformValue(characterTransform.x, 1, "0"),
    y: formatTransformValue(characterTransform.y, 1, "0"),
    scaleX: formatTransformValue(characterTransform.scaleX, 2, "1"),
    scaleY: formatTransformValue(characterTransform.scaleY, 2, "1"),
    rotation: formatTransformValue(characterTransform.rotation, 1, "0"),
  });

  useEffect(() => {
    setTransformDraft({
      x: formatTransformValue(characterTransform.x, 1, "0"),
      y: formatTransformValue(characterTransform.y, 1, "0"),
      scaleX: formatTransformValue(characterTransform.scaleX, 2, "1"),
      scaleY: formatTransformValue(characterTransform.scaleY, 2, "1"),
      rotation: formatTransformValue(characterTransform.rotation, 1, "0"),
    });
  }, [
    characterTransform.x,
    characterTransform.y,
    characterTransform.scaleX,
    characterTransform.scaleY,
    characterTransform.rotation,
    selectedCharacterId,
  ]);

  const applyTransformDraft = (key: keyof CharacterTransform) => {
    const raw = transformDraft[key];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setTransformDraft((prev) => ({
        ...prev,
        [key]:
          key === "scaleX" || key === "scaleY"
            ? formatTransformValue(characterTransform[key], 2, "1")
            : formatTransformValue(characterTransform[key], 1, "0"),
      }));
      return;
    }

    const normalized = key === "scaleX" || key === "scaleY" ? Math.max(0.01, parsed) : parsed;
    onUpdateCharacterTransform({ [key]: normalized });
    setTransformDraft((prev) => ({
      ...prev,
      [key]:
        key === "scaleX" || key === "scaleY"
          ? normalized.toFixed(2)
          : normalized.toFixed(1),
    }));
  };

  const handleTransformKeyDown = (key: keyof CharacterTransform) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== " ") return;
    e.preventDefault();
    applyTransformDraft(key);
  };

  return (
    <div className="l2d-panel">
      <div className="l2d-panel-header">
        <h3 className="l2d-panel-title">Live2D Control</h3>
        <button className="l2d-close" onClick={onClose}>
          x
        </button>
      </div>

      <div className="l2d-section">
        <h4 className="l2d-section-title">Model</h4>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="input"
            value={selectedModel ?? ""}
            onChange={(e) => onSelectModel(e.target.value || null)}
            style={{ width: "100%" }}
          >
            {modelList.length === 0 && (
              <option value="">No model found in model/</option>
            )}
            {modelList.map((rel) => (
              <option key={rel} value={rel}>
                {rel}
              </option>
            ))}
          </select>
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            {modelList.length}
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          {onRefreshModels && (
            <button className="btn" onClick={onRefreshModels} style={{ fontSize: 12 }}>
              Refresh
            </button>
          )}
          <button className="btn" onClick={onToggleWebGALMode} style={{ fontSize: 12 }}>
            WebGAL
          </button>
        </div>
      </div>

      <div className="l2d-section">
        <h4 className="l2d-section-title">Motions</h4>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Search motions"
            value={motionQuery}
            onChange={(e) => setMotionQuery(e.target.value)}
          />
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            {filteredMotions.length}
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">Page</span>
          <select
            className="input"
            value={motionPageSize}
            onChange={(e) => setMotionPageSize(Number(e.target.value))}
            style={{ width: 80 }}
          >
            {[12, 24, 36, 48, 60].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setMotionPage(1)} disabled={motionPageSafe <= 1}>
            {'<<'}
          </button>
          <button
            className="btn"
            onClick={() => setMotionPage((p) => Math.max(1, p - 1))}
            disabled={motionPageSafe <= 1}
          >
            {'<'}
          </button>
          <span className="muted">
            {motionPageSafe} / {motionPageCount}
          </span>
          <button
            className="btn"
            onClick={() => setMotionPage((p) => Math.min(motionPageCount, p + 1))}
            disabled={motionPageSafe >= motionPageCount}
          >
            {'>'}
          </button>
          <button
            className="btn"
            onClick={() => setMotionPage(motionPageCount)}
            disabled={motionPageSafe >= motionPageCount}
          >
            {'>>'}
          </button>
        </div>

        <div className="chip-list" style={{ marginTop: 8 }}>
          {motionSlice.map((name) => {
            const sec = motionLen[name];
            return (
              <button
                key={name}
                className={`chip ${currentMotion === name ? "is-active" : ""}`}
                title="Click to play, double click to add clip"
                onClick={() => chooseMotion(name)}
                onDoubleClick={() => addMotionClip(name)}
              >
                {name}
                {sec ? ` (${sec.toFixed(2)}s)` : ""}
              </button>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <span>Clip(s)</span>
          <input
            className="input"
            type="number"
            value={motionDur}
            step={0.1}
            min={0.1}
            onChange={(e) => setMotionDur(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
          <button className="btn" onClick={() => currentMotion && addMotionClip(currentMotion)}>
            Add Current
          </button>
        </div>
      </div>

      <div className="l2d-section">
        <h4 className="l2d-section-title">Expressions</h4>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Search expressions"
            value={exprQuery}
            onChange={(e) => setExprQuery(e.target.value)}
          />
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            {filteredExprs.length}
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">Page</span>
          <select
            className="input"
            value={exprPageSize}
            onChange={(e) => setExprPageSize(Number(e.target.value))}
            style={{ width: 80 }}
          >
            {[12, 24, 36, 48, 60].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setExprPage(1)} disabled={exprPageSafe <= 1}>
            {'<<'}
          </button>
          <button
            className="btn"
            onClick={() => setExprPage((p) => Math.max(1, p - 1))}
            disabled={exprPageSafe <= 1}
          >
            {'<'}
          </button>
          <span className="muted">
            {exprPageSafe} / {exprPageCount}
          </span>
          <button
            className="btn"
            onClick={() => setExprPage((p) => Math.min(exprPageCount, p + 1))}
            disabled={exprPageSafe >= exprPageCount}
          >
            {'>'}
          </button>
          <button className="btn" onClick={() => setExprPage(exprPageCount)} disabled={exprPageSafe >= exprPageCount}>
            {'>>'}
          </button>
        </div>

        <div className="chip-list" style={{ marginTop: 8 }}>
          {exprSlice.map((name) => (
            <button
              key={name}
              className={`chip ${currentExpression === name ? "is-active" : ""}`}
              title="Click to apply, double click to add clip"
              onClick={() => chooseExpression(name)}
              onDoubleClick={() => addExprClip(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <span>Clip(s)</span>
          <input
            className="input"
            type="number"
            value={exprDur}
            step={0.1}
            min={0.1}
            onChange={(e) => setExprDur(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
          <button className="btn" onClick={() => currentExpression && addExprClip(currentExpression)}>
            Add Current
          </button>
        </div>
      </div>

      <div className="l2d-section">
        <h4 className="l2d-section-title">Character Transform</h4>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">Role</span>
          <select
            className="input"
            value={selectedCharacterId}
            onChange={(e) => onSelectCharacter(e.target.value)}
            style={{ width: "100%" }}
          >
            {characterOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">X</span>
          <input
            className="input"
            type="number"
            value={transformDraft.x}
            onChange={(e) => setTransformDraft((prev) => ({ ...prev, x: e.target.value }))}
            onBlur={() => applyTransformDraft("x")}
            onKeyDown={handleTransformKeyDown("x")}
          />
          <span className="muted">Y</span>
          <input
            className="input"
            type="number"
            value={transformDraft.y}
            onChange={(e) => setTransformDraft((prev) => ({ ...prev, y: e.target.value }))}
            onBlur={() => applyTransformDraft("y")}
            onKeyDown={handleTransformKeyDown("y")}
          />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">ScaleX</span>
          <input
            className="input"
            type="number"
            step={0.01}
            value={transformDraft.scaleX}
            onChange={(e) => setTransformDraft((prev) => ({ ...prev, scaleX: e.target.value }))}
            onBlur={() => applyTransformDraft("scaleX")}
            onKeyDown={handleTransformKeyDown("scaleX")}
          />
          <span className="muted">ScaleY</span>
          <input
            className="input"
            type="number"
            step={0.01}
            value={transformDraft.scaleY}
            onChange={(e) => setTransformDraft((prev) => ({ ...prev, scaleY: e.target.value }))}
            onBlur={() => applyTransformDraft("scaleY")}
            onKeyDown={handleTransformKeyDown("scaleY")}
          />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">Rotation</span>
          <input
            className="input"
            type="number"
            step={0.1}
            value={transformDraft.rotation}
            onChange={(e) => setTransformDraft((prev) => ({ ...prev, rotation: e.target.value }))}
            onBlur={() => applyTransformDraft("rotation")}
            onKeyDown={handleTransformKeyDown("rotation")}
          />
        </div>
      </div>

      <div className="l2d-section">
        <h4 className="l2d-section-title">Drag</h4>
        <label className="muted">
          <input
            type="checkbox"
            checked={enableDragging}
            onChange={(e) => setEnableDragging(e.target.checked)}
            style={{ width: 16, height: 16, marginRight: 8 }}
          />
          Enable drag {isDragging ? "(dragging)" : ""}
        </label>
      </div>

      <div className="l2d-section muted" style={{ fontSize: 12 }}>
        Total: {timelineLength.toFixed(2)}s
        <br />
        Playhead: {playhead.toFixed(2)}s
        <br />
        FPS: {typeof currentFps === "number" ? currentFps.toFixed(1) : "--"}
        <br />
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <button className="btn btn--primary" onClick={startPlayback} disabled={isPlaying || timelineLength <= 0}>
            Play
          </button>
          <button className="btn btn--danger" onClick={stopPlayback} disabled={!isPlaying}>
            Stop
          </button>
          <button className="btn" onClick={clearTimeline}>
            Clear
          </button>
          <button className="btn" onClick={addAudioClip} style={{ background: "#ff6b35", color: "white" }}>
            Import Audio
          </button>
        </div>

        {currentAudioLevel !== undefined && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: "rgba(107,53,255,0.1)",
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            Audio Level
            <br />
            <div
              style={{
                width: "100%",
                height: "20px",
                background: "#333",
                borderRadius: "10px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${currentAudioLevel}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #4CAF50, #FF9800, #F44336)",
                  transition: "width 0.1s ease",
                  borderRadius: "10px",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  color: "white",
                  fontSize: "10px",
                  fontWeight: "bold",
                  textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                {currentAudioLevel.toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;
