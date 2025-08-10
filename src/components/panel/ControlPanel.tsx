import React, { useMemo, useState, useEffect } from "react";
import type { Clip, TrackKind } from "../timeline/types";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
export interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type Props = {
  onClose: () => void;

  // 新增：模型清单
  modelList: string[];
  selectedModel: string | null;
  onSelectModel: (relPath: string) => void;

  // 数据
  modelData: ModelData | null;
  motionLen: Record<string, number>;

  // 当前选中
  currentMotion: string;
  currentExpression: string;

  // 时长与设置
  motionDur: number;
  exprDur: number;
  setMotionDur: (n: number) => void;
  setExprDur: (n: number) => void;

  // 行为（父组件实现）
  chooseMotion: (name: string) => void;
  chooseExpression: (name: string) => void;
  addMotionClip: (name: string) => void;
  addExprClip: (name: string) => void;

  // 拖拽
  enableDragging: boolean;
  setEnableDragging: (v: boolean) => void;
  isDragging: boolean;

  // 播放控制
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
    // 新增
    modelList, selectedModel, onSelectModel,

    modelData, motionLen,
    currentMotion, currentExpression,
    motionDur, exprDur, setMotionDur, setExprDur,
    chooseMotion, chooseExpression, addMotionClip, addExprClip,
    enableDragging, setEnableDragging, isDragging,
    timelineLength, playhead, isPlaying, startPlayback, stopPlayback,
    clearTimeline,
  } = props;

  // —— 搜索 & 分页（动作） ——
  const [motionQuery, setMotionQuery] = useState("");
  const [motionPage, setMotionPage] = useState(1);
  const [motionPageSize, setMotionPageSize] = useState(24);
  useEffect(() => { setMotionPage(1); }, [motionQuery, motionPageSize, modelData]);

  const allMotionNames = useMemo(
    () => (modelData ? Object.keys(modelData.motions) : []),
    [modelData]
  );
  const filteredMotions = useMemo(
    () => allMotionNames.filter(n => n.toLowerCase().includes(motionQuery.trim().toLowerCase())),
    [allMotionNames, motionQuery]
  );
  const motionPageCount = Math.max(1, Math.ceil(filteredMotions.length / motionPageSize));
  const motionPageSafe = Math.min(motionPage, motionPageCount);
  const motionSlice = filteredMotions.slice(
    (motionPageSafe - 1) * motionPageSize,
    motionPageSafe * motionPageSize
  );

  // —— 搜索 & 分页（表情） ——
  const [exprQuery, setExprQuery] = useState("");
  const [exprPage, setExprPage] = useState(1);
  const [exprPageSize, setExprPageSize] = useState(24);
  useEffect(() => { setExprPage(1); }, [exprQuery, exprPageSize, modelData]);

  const allExprNames = useMemo(
    () => (modelData ? modelData.expressions.map(e => e.name) : []),
    [modelData]
  );
  const filteredExprs = useMemo(
    () => allExprNames.filter(n => n.toLowerCase().includes(exprQuery.trim().toLowerCase())),
    [allExprNames, exprQuery]
  );
  const exprPageCount = Math.max(1, Math.ceil(filteredExprs.length / exprPageSize));
  const exprPageSafe = Math.min(exprPage, exprPageCount);
  const exprSlice = filteredExprs.slice(
    (exprPageSafe - 1) * exprPageSize,
    exprPageSafe * exprPageSize
  );

  return (
    <div className="l2d-panel">
      <div className="l2d-panel-header">
        <h3 className="l2d-panel-title">🎭 Live2D 控制面板</h3>
        <button className="l2d-close" onClick={onClose}>✕</button>
      </div>

      {/* 新增：模型选择（从 /dist/model/models.json 生成的列表） */}
      <div className="l2d-section">
        <h4 className="l2d-section-title">🧩 模型选择</h4>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="input"
            value={selectedModel ?? ""}
            onChange={(e) => onSelectModel(e.target.value)}
            style={{ width: "100%" }}
          >
            {modelList.length === 0 && <option value="">（未发现模型，先构建生成 models.json）</option>}
            {modelList.map((rel) => (
              <option key={rel} value={rel}>
                {rel}
              </option>
            ))}
          </select>
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            共 {modelList.length} 项
          </span>
        </div>
      </div>

      {/* 动作 */}
      <div className="l2d-section">
        <h4 className="l2d-section-title">🎬 动作</h4>

        {/* 搜索 + 分页控制 */}
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="搜索动作..."
            value={motionQuery}
            onChange={(e) => setMotionQuery(e.target.value)}
          />
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            共 {filteredMotions.length} 项
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">每页</span>
          <select
            className="input"
            value={motionPageSize}
            onChange={(e) => setMotionPageSize(Number(e.target.value))}
            style={{ width: 80 }}
          >
            {[12, 24, 36, 48, 60].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setMotionPage(1)} disabled={motionPageSafe <= 1}>«</button>
          <button className="btn" onClick={() => setMotionPage(p => Math.max(1, p - 1))} disabled={motionPageSafe <= 1}>‹</button>
          <span className="muted">第 {motionPageSafe} / {motionPageCount} 页</span>
          <button className="btn" onClick={() => setMotionPage(p => Math.min(motionPageCount, p + 1))} disabled={motionPageSafe >= motionPageCount}>›</button>
          <button className="btn" onClick={() => setMotionPage(motionPageCount)} disabled={motionPageSafe >= motionPageCount}>»</button>
        </div>

        <div className="chip-list" style={{ marginTop: 8 }}>
          {motionSlice.map((name) => {
            const sec = motionLen[name];
            return (
              <button
                key={name}
                className={`chip ${currentMotion === name ? "is-active" : ""}`}
                title="单击：立即播放；双击：添加到时间线"
                onClick={() => chooseMotion(name)}
                onDoubleClick={() => addMotionClip(name)}
              >
                {name}{sec ? ` (${sec.toFixed(2)}s)` : ""}
              </button>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <span>片段时长(兜底)：</span>
          <input
            className="input"
            type="number"
            value={motionDur}
            onChange={(e) => setMotionDur(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
          <button className="btn" onClick={() => currentMotion && addMotionClip(currentMotion)}>
            ➕ 添加当前动作
          </button>
        </div>
      </div>

      {/* 表情 */}
      <div className="l2d-section">
        <h4 className="l2d-section-title">😊 表情</h4>

        {/* 搜索 + 分页控制 */}
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="搜索表情..."
            value={exprQuery}
            onChange={(e) => setExprQuery(e.target.value)}
          />
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            共 {filteredExprs.length} 项
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="muted">每页</span>
          <select
            className="input"
            value={exprPageSize}
            onChange={(e) => setExprPageSize(Number(e.target.value))}
            style={{ width: 80 }}
          >
            {[12, 24, 36, 48, 60].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setExprPage(1)} disabled={exprPageSafe <= 1}>«</button>
          <button className="btn" onClick={() => setExprPage(p => Math.max(1, p - 1))} disabled={exprPageSafe <= 1}>‹</button>
          <span className="muted">第 {exprPageSafe} / {exprPageCount} 页</span>
          <button className="btn" onClick={() => setExprPage(p => Math.min(exprPageCount, p + 1))} disabled={exprPageSafe >= exprPageCount}>›</button>
          <button className="btn" onClick={() => setExprPage(exprPageCount)} disabled={exprPageSafe >= exprPageCount}>»</button>
        </div>

        <div className="chip-list" style={{ marginTop: 8 }}>
          {exprSlice.map((name) => (
            <button
              key={name}
              className={`chip ${currentExpression === name ? "is-active" : ""}`}
              title="单击：立即应用；双击：添加到时间线"
              onClick={() => chooseExpression(name)}
              onDoubleClick={() => addExprClip(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <span>片段时长(s)：</span>
          <input
            className="input"
            type="number"
            value={exprDur}
            onChange={(e) => setExprDur(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
          <button className="btn" onClick={() => currentExpression && addExprClip(currentExpression)}>
            ➕ 添加当前表情
          </button>
        </div>
      </div>

      {/* 拖拽 */}
      <div className="l2d-section">
        <h4 className="l2d-section-title">🖱️ 拖拽</h4>
        <label className="muted">
          <input
            type="checkbox"
            checked={enableDragging}
            onChange={(e) => setEnableDragging(e.target.checked)}
            style={{ width: 16, height: 16, marginRight: 8 }}
          />
          启用拖拽移动 {isDragging ? "（拖拽中）" : ""}
        </label>
      </div>

      {/* 播放控制 */}
      <div className="l2d-section muted" style={{ fontSize: 12 }}>
        总时长：{timelineLength.toFixed(2)}s<br />
        播放头：{playhead.toFixed(2)}s
        <div className="row">
          <button
            className="btn btn--primary"
            onClick={startPlayback}
            disabled={isPlaying || timelineLength <= 0}
          >
            ▶ 播放时间线
          </button>
          <button
            className="btn btn--danger"
            onClick={stopPlayback}
            disabled={!isPlaying}
          >
            ⏹ 停止
          </button>
          <button className="btn" onClick={clearTimeline}>🗑 清空</button>
        </div>
      </div>

      {/* 录制设置（占位，不动） */}
      <div className="l2d-section">
        <h4 className="l2d-section-title">🎥 录制设置</h4>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <span>FPS:</span>
          <select className="input" style={{ width: 80 }} defaultValue="60">
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="120">120</option>
          </select>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span>质量(kbps):</span>
          <select className="input" style={{ width: 80 }} defaultValue="16000">
            <option value="8000">8000</option>
            <option value="16000">16000</option>
            <option value="32000">32000</option>
          </select>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span>格式:</span>
          <select className="input" style={{ width: 120 }} defaultValue="vp9">
            <option value="vp9">VP9 (推荐)</option>
            <option value="vp8">VP8</option>
            <option value="webm">WebM</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;
