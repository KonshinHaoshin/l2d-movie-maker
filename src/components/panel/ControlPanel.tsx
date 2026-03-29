import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ExportToolbar from "../ExportToolbar";
import type { SubtitleClip } from "../timeline/clipTypes";

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

export type ControlPanelMode = "resources" | "inspector";
export type InspectorTab = "character" | "subtitle" | "export" | "audio" | "project";

type Props = {
  mode: ControlPanelMode;
  activeInspectorTab?: InspectorTab;
  onChangeInspectorTab?: (tab: InspectorTab) => void;
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
  subtitleClips: SubtitleClip[];
  showSubtitles: boolean;
  setShowSubtitles: (visible: boolean) => void;
  showSubtitleSpeaker: boolean;
  setShowSubtitleSpeaker: (visible: boolean) => void;
  subtitleSpeakerAlign: "left" | "center" | "right";
  setSubtitleSpeakerAlign: (align: "left" | "center" | "right") => void;
  onAddSubtitleClip: () => void;
  onUpdateSubtitleClip: (
    id: string,
    patch: Partial<Pick<SubtitleClip, "subtitleText" | "speakerName" | "fontFamily" | "fontSize" | "textColor" | "start" | "duration">>,
  ) => void;
  onRemoveSubtitleClip: (id: string) => void;
  currentAudioLevel?: number;
  currentFps?: number;

  characterOptions: CharacterOption[];
  selectedCharacterId: string;
  onSelectCharacter: (id: string) => void;
  isCharacterVisible: boolean;
  onToggleCharacterVisibility: (visible: boolean) => void;
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

  recordingQuality: "low" | "medium" | "high";
  setRecordingQuality: (quality: "low" | "medium" | "high") => void;
  transparentBg: boolean;
  setTransparentBg: (transparent: boolean) => void;
  recState: "idle" | "rec" | "done" | "offline";
  recordingTime: number;
  recordingProgress: number;
  blob: Blob | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSaveWebM: () => void;
  onConvertToMov: () => void;
  onExportSubtitlesSrt: () => void;
  onTakeScreenshot: () => void;
  onTakePartsScreenshots: () => void;
  isVp9AlphaSupported: () => boolean;
};

const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "character", label: "角色" },
  { id: "subtitle", label: "字幕" },
  { id: "export", label: "导出" },
  { id: "audio", label: "音频" },
  { id: "project", label: "项目" },
];

const FALLBACK_SUBTITLE_FONTS = [
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "SimHei",
  "SimSun",
  "KaiTi",
  "FangSong",
  "Source Han Sans SC",
  "Noto Sans CJK SC",
  "Segoe UI",
  "Arial",
];

function PanelSection({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`workspace-section${className ? ` ${className}` : ""}`}>
      <div className="workspace-section-header">
        <h3 className="workspace-section-title">{title}</h3>
        {meta ? <span className="workspace-section-meta">{meta}</span> : null}
      </div>
      <div className="workspace-section-body">{children}</div>
    </section>
  );
}

function Pager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
}) {
  return (
    <div className="asset-pager">
      <button className="btn btn--quiet" onClick={() => onPageChange(1)} disabled={page <= 1}>
        首页
      </button>
      <button className="btn btn--quiet" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
        上一页
      </button>
      <span className="pane-note">
        {page} / {pageCount}
      </span>
      <button className="btn btn--quiet" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>
        下一页
      </button>
      <button className="btn btn--quiet" onClick={() => onPageChange(pageCount)} disabled={page >= pageCount}>
        末页
      </button>
    </div>
  );
}

export default function ControlPanel(props: Props) {
  const {
    mode,
    activeInspectorTab = "character",
    onChangeInspectorTab,
    onToggleWebGALMode,
    selectedModel,
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
    subtitleClips,
    showSubtitles,
    setShowSubtitles,
    showSubtitleSpeaker,
    setShowSubtitleSpeaker,
    subtitleSpeakerAlign,
    setSubtitleSpeakerAlign,
    onAddSubtitleClip,
    onUpdateSubtitleClip,
    onRemoveSubtitleClip,
    characterOptions,
    selectedCharacterId,
    onSelectCharacter,
    isCharacterVisible,
    onToggleCharacterVisibility,
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
    recordingQuality,
    setRecordingQuality,
    transparentBg,
    setTransparentBg,
    recState,
    recordingTime,
    recordingProgress,
    blob,
    onStartRecording,
    onStopRecording,
    onSaveWebM,
    onConvertToMov,
    onExportSubtitlesSrt,
    onTakeScreenshot,
    onTakePartsScreenshots,
    isVp9AlphaSupported,
  } = props;

  const [motionQuery, setMotionQuery] = useState("");
  const [motionPage, setMotionPage] = useState(1);
  const [motionPageSize, setMotionPageSize] = useState(12);

  const [exprQuery, setExprQuery] = useState("");
  const [exprPage, setExprPage] = useState(1);
  const [exprPageSize, setExprPageSize] = useState(12);
  const [availableSubtitleFonts, setAvailableSubtitleFonts] = useState<string[]>(FALLBACK_SUBTITLE_FONTS);
  const paneScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = paneScrollRef.current;
    if (!container) return;
    const wheelListenerOptions: AddEventListenerOptions = { passive: false };

    const handleWheel = (event: WheelEvent) => {
      const canScroll = container.scrollHeight > container.clientHeight + 1;
      if (!canScroll) return;

      const maxScrollTop = container.scrollHeight - container.clientHeight;
      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop + event.deltaY));
      const shouldConsume =
        (event.deltaY < 0 && container.scrollTop > 0) ||
        (event.deltaY > 0 && container.scrollTop < maxScrollTop);

      if (!shouldConsume) return;

      container.scrollTop = nextScrollTop;
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener("wheel", handleWheel, wheelListenerOptions);
    return () => {
      container.removeEventListener("wheel", handleWheel, wheelListenerOptions);
    };
  }, [mode]);

  useEffect(() => {
    setMotionPage(1);
  }, [motionQuery, motionPageSize, modelData]);

  useEffect(() => {
    setExprPage(1);
  }, [exprQuery, exprPageSize, modelData]);

  useEffect(() => {
    let cancelled = false;

    void invoke<string[]>("list_system_font_families")
      .then((fonts) => {
        if (cancelled || !Array.isArray(fonts) || fonts.length === 0) return;
        const merged = Array.from(new Set([...fonts, ...FALLBACK_SUBTITLE_FONTS]));
        setAvailableSubtitleFonts(merged);
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableSubtitleFonts(FALLBACK_SUBTITLE_FONTS);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allMotionNames = useMemo(
    () => (modelData ? Object.keys(modelData.motions || {}) : []),
    [modelData],
  );

  const filteredMotions = useMemo(
    () => allMotionNames.filter((name) => name.toLowerCase().includes(motionQuery.trim().toLowerCase())),
    [allMotionNames, motionQuery],
  );

  const motionPageCount = Math.max(1, Math.ceil(filteredMotions.length / motionPageSize));
  const safeMotionPage = Math.min(motionPage, motionPageCount);
  const motionSlice = filteredMotions.slice((safeMotionPage - 1) * motionPageSize, safeMotionPage * motionPageSize);

  const allExpressionNames = useMemo(
    () => (modelData ? (modelData.expressions || []).map((expr) => expr.name) : []),
    [modelData],
  );

  const filteredExpressions = useMemo(
    () => allExpressionNames.filter((name) => name.toLowerCase().includes(exprQuery.trim().toLowerCase())),
    [allExpressionNames, exprQuery],
  );

  const expressionPageCount = Math.max(1, Math.ceil(filteredExpressions.length / exprPageSize));
  const safeExpressionPage = Math.min(exprPage, expressionPageCount);
  const expressionSlice = filteredExpressions.slice(
    (safeExpressionPage - 1) * exprPageSize,
    safeExpressionPage * exprPageSize,
  );

  const selectedModelParts = selectedModel ? selectedModel.split("/") : [];
  const selectedModelLabel = selectedModel
    ? selectedModelParts[selectedModelParts.length - 2] ?? selectedModel
    : "未选择模型";
  const hasMultipleCharacters = characterOptions.length > 1;

  const formatTransformValue = (value: number, digits: number, fallback: string) =>
    Number.isFinite(value) ? value.toFixed(digits) : fallback;

  const subtitleFontFamily = subtitleClips[0]?.fontFamily || FALLBACK_SUBTITLE_FONTS[0];
  const subtitleFontSize = subtitleClips[0]?.fontSize ?? 34;

  const applySubtitleFontFamilyToAll = (fontFamily: string) => {
    subtitleClips.forEach((clip) => onUpdateSubtitleClip(clip.id, { fontFamily }));
  };

  const applySubtitleFontSizeToAll = (fontSize: number) => {
    const nextFontSize = Math.max(12, fontSize || 12);
    subtitleClips.forEach((clip) => onUpdateSubtitleClip(clip.id, { fontSize: nextFontSize }));
  };

  const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => {
    event.currentTarget.blur();
  };

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
    const parsed = Number(transformDraft[key]);
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
      [key]: key === "scaleX" || key === "scaleY" ? normalized.toFixed(2) : normalized.toFixed(1),
    }));
  };

  const handleTransformKeyDown =
    (key: keyof CharacterTransform) => (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyTransformDraft(key);
    };

  const renderLevelMeter = () => (
    <div className="meter-card">
      <div className="meter-row">
        <span className="pane-note">实时电平</span>
        <span className="pane-note">{(currentAudioLevel ?? 0).toFixed(1)}%</span>
      </div>
      <div className="audio-meter">
        <div className="audio-meter-fill" style={{ width: `${currentAudioLevel ?? 0}%` }} />
      </div>
    </div>
  );

  const renderResourceList = (
    items: string[],
    activeValue: string,
    onPreview: (name: string) => void,
    onAdd: (name: string) => void,
    kind: "motion" | "expression",
  ) => {
    if (items.length === 0) {
      return (
        <div className="pane-empty">
          <strong>{kind === "motion" ? "还没有动作" : "还没有表情"}</strong>
          <span>先加载模型，再从这里预览并加入时间线。</span>
        </div>
      );
    }

    return (
      <div className="asset-list">
        {items.map((name) => (
          <div key={name} className={`asset-item ${activeValue === name ? "is-active" : ""}`}>
            <div className="asset-copy">
              <strong>{name}</strong>
              <span>
                {kind === "motion" && motionLen[name] ? `${motionLen[name].toFixed(2)} 秒` : kind === "motion" ? "动作" : ""}
              </span>
            </div>
            <div className="asset-actions">
              <button className="btn btn--quiet" onClick={() => onPreview(name)}>
                预览
              </button>
              <button className="btn btn--primary" onClick={() => onAdd(name)}>
                上轨
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const paneTitle = mode === "resources" ? "资源浏览器" : "检查器";

  return (
    <div className={`workspace-pane workspace-pane--${mode}`}>
      <div className="workspace-pane-header">
        <div>
          <div className="workspace-pane-kicker">{mode === "resources" ? "素材面板" : "参数面板"}</div>
          <h2 className="workspace-pane-title">{paneTitle}</h2>
        </div>
      </div>

      {mode === "inspector" ? (
        <div className="inspector-tabs" role="tablist" aria-label="检查器分页">
          {inspectorTabs.map((tab) => (
            <button
              key={tab.id}
              className={`inspector-tab ${activeInspectorTab === tab.id ? "is-active" : ""}`}
              onClick={() => onChangeInspectorTab?.(tab.id)}
              role="tab"
              aria-selected={activeInspectorTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={paneScrollRef} className="workspace-pane-scroll">
        {mode === "resources" ? (
          <>
            <PanelSection title="动作" meta={`${filteredMotions.length} 条`} className="workspace-section--library">
              <div className="toolbar-row">
                <input
                  className="input input--full"
                  placeholder="搜索动作名"
                  value={motionQuery}
                  onChange={(event) => setMotionQuery(event.target.value)}
                />
                <select
                  className="input input--compact"
                  value={motionPageSize}
                  onChange={(event) => setMotionPageSize(Number(event.target.value))}
                  aria-label="动作分页数量"
                >
                  {[8, 12, 16, 24].map((size) => (
                    <option key={size} value={size}>
                      {size}/页
                    </option>
                  ))}
                </select>
                <div className="library-duration-inline">
                  <label className="field-label" htmlFor="motion-duration">
                    时长
                  </label>
                  <input
                    id="motion-duration"
                    className="input"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={motionDur}
                    onChange={(event) => setMotionDur(Math.max(0.1, Number(event.target.value) || 0.1))}
                  />
                </div>
              </div>
              <Pager page={safeMotionPage} pageCount={motionPageCount} onPageChange={setMotionPage} />
              {renderResourceList(motionSlice, currentMotion, chooseMotion, addMotionClip, "motion")}
            </PanelSection>

            <PanelSection title="表情" meta={`${filteredExpressions.length} 条`} className="workspace-section--library">
              <div className="toolbar-row">
                <input
                  className="input input--full"
                  placeholder="搜索表情名"
                  value={exprQuery}
                  onChange={(event) => setExprQuery(event.target.value)}
                />
                <select
                  className="input input--compact"
                  value={exprPageSize}
                  onChange={(event) => setExprPageSize(Number(event.target.value))}
                  aria-label="表情分页数量"
                >
                  {[8, 12, 16, 24].map((size) => (
                    <option key={size} value={size}>
                      {size}/页
                    </option>
                  ))}
                </select>
                <div className="library-duration-inline">
                  <label className="field-label" htmlFor="expression-duration">
                    时长
                  </label>
                  <input
                    id="expression-duration"
                    className="input"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={exprDur}
                    onChange={(event) => setExprDur(Math.max(0.1, Number(event.target.value) || 0.1))}
                  />
                </div>
              </div>
              <Pager page={safeExpressionPage} pageCount={expressionPageCount} onPageChange={setExprPage} />
              {renderResourceList(expressionSlice, currentExpression, chooseExpression, addExprClip, "expression")}
            </PanelSection>

          </>
        ) : (
          <>
            {activeInspectorTab === "character" ? (
              <>
                <PanelSection title="角色">
                  {hasMultipleCharacters ? (
                    <div className="field-stack">
                      <label className="field-label" htmlFor="inspector-role-select">
                        当前编辑目标
                      </label>
                      <select
                        id="inspector-role-select"
                        className="input input--full"
                        value={selectedCharacterId}
                        onChange={(event) => onSelectCharacter(event.target.value)}
                      >
                        {characterOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={isCharacterVisible}
                      onChange={(event) => onToggleCharacterVisibility(event.target.checked)}
                    />
                    <span>{isCharacterVisible ? "显示当前角色" : "隐藏当前角色"}</span>
                  </label>
                </PanelSection>

                <PanelSection title="变换">
                  <div className="transform-grid">
                    {(
                      [
                        ["x", "X"],
                        ["y", "Y"],
                        ["scaleX", "缩放 X"],
                        ["scaleY", "缩放 Y"],
                        ["rotation", "旋转"],
                      ] as Array<[keyof CharacterTransform, string]>
                    ).map(([key, label]) => (
                      <label key={key} className="field-stack">
                        <span className="field-label">{label}</span>
                        <input
                          className="input"
                          type="number"
                          step={key === "scaleX" || key === "scaleY" ? 0.01 : 0.1}
                          value={transformDraft[key]}
                          onChange={(event) => setTransformDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                          onBlur={() => applyTransformDraft(key)}
                          onKeyDown={handleTransformKeyDown(key)}
                        />
                      </label>
                    ))}
                  </div>
                </PanelSection>

                <PanelSection title="交互">
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={enableDragging}
                      onChange={(event) => setEnableDragging(event.target.checked)}
                    />
                    <span>{isDragging ? "正在拖拽模型" : "允许在预览区直接拖拽模型"}</span>
                  </label>
                </PanelSection>
              </>
            ) : null}

            {activeInspectorTab === "subtitle" ? (
              <>
                <PanelSection title="统一样式">
                  <div className="subtitle-global-grid">
                    <label className="switch-row subtitle-switch-row">
                      <input
                        type="checkbox"
                        checked={showSubtitles}
                        onChange={(event) => setShowSubtitles(event.target.checked)}
                      />
                      <span>显示字幕</span>
                    </label>

                    <label className="switch-row subtitle-switch-row">
                      <input
                        type="checkbox"
                        checked={showSubtitleSpeaker}
                        onChange={(event) => setShowSubtitleSpeaker(event.target.checked)}
                      />
                      <span>显示角色名</span>
                    </label>

                    <label className="field-stack">
                      <span className="field-label">角色名位置</span>
                      <select
                        className="input input--full"
                        value={subtitleSpeakerAlign}
                        onChange={(event) => setSubtitleSpeakerAlign(event.target.value as "left" | "center" | "right")}
                        disabled={!showSubtitleSpeaker}
                      >
                        <option value="left">左</option>
                        <option value="center">中</option>
                        <option value="right">右</option>
                      </select>
                    </label>

                    <label className="field-stack">
                      <span className="field-label">字体</span>
                      <select
                        className="input input--full"
                        value={subtitleFontFamily}
                        onChange={(event) => applySubtitleFontFamilyToAll(event.target.value)}
                        disabled={subtitleClips.length === 0}
                      >
                        {availableSubtitleFonts.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-stack">
                      <span className="field-label">字号</span>
                      <input
                        className="input"
                        type="number"
                        min={12}
                        step={1}
                        value={subtitleFontSize}
                        onWheel={blurOnWheel}
                        onChange={(event) => applySubtitleFontSizeToAll(Number(event.target.value))}
                        disabled={subtitleClips.length === 0}
                      />
                    </label>

                    <div className="button-row">
                      <button className="btn btn--primary" onClick={onAddSubtitleClip}>
                        新增字幕
                      </button>
                    </div>
                  </div>
                </PanelSection>

                <PanelSection title="字幕编辑" meta={`${subtitleClips.length} 条`}>
                  {subtitleClips.length === 0 ? (
                    <div className="pane-empty">
                      <strong>还没有字幕片段</strong>
                      <span>可以手动新增，或在 WebGAL 导入时勾选字幕一起进入时间线。</span>
                    </div>
                  ) : (
                    <div className="subtitle-list">
                      {subtitleClips.map((clip, index) => (
                        <article key={clip.id} className="subtitle-card">
                          <div className="subtitle-card-header">
                            <strong>{clip.name || `字幕 ${index + 1}`}</strong>
                            <button className="btn btn--quiet subtitle-delete-btn" onClick={() => onRemoveSubtitleClip(clip.id)}>
                              删除
                            </button>
                          </div>

                          <label className="field-stack">
                            <span className="field-label">角色名</span>
                            <input
                              className="input input--full"
                              value={clip.speakerName ?? ""}
                              placeholder="可选，如：千早爱音"
                              onChange={(event) => onUpdateSubtitleClip(clip.id, { speakerName: event.target.value })}
                            />
                          </label>

                          <label className="field-stack">
                            <span className="field-label">字幕文本</span>
                            <textarea
                              className="input subtitle-textarea"
                              value={clip.subtitleText}
                              rows={3}
                              onChange={(event) => onUpdateSubtitleClip(clip.id, { subtitleText: event.target.value })}
                            />
                          </label>

                          <div className="subtitle-editor-grid">
                            <label className="field-stack subtitle-inline-field">
                              <span className="field-label">颜色</span>
                              <input
                                className="input input--color"
                                type="color"
                                value={clip.textColor}
                                onChange={(event) => onUpdateSubtitleClip(clip.id, { textColor: event.target.value })}
                              />
                            </label>
                            <label className="field-stack subtitle-inline-field">
                              <span className="field-label">开始</span>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                step={0.1}
                                value={clip.start}
                                disabled={Boolean(clip.linkedAudioClipId)}
                                onWheel={blurOnWheel}
                                onChange={(event) =>
                                  onUpdateSubtitleClip(clip.id, {
                                    start: Math.max(0, Number(event.target.value) || 0),
                                  })
                                }
                              />
                            </label>
                            <label className="field-stack subtitle-inline-field">
                              <span className="field-label">时长</span>
                              <input
                                className="input"
                                type="number"
                                min={0.1}
                                step={0.1}
                                value={clip.duration}
                                disabled={Boolean(clip.linkedAudioClipId)}
                                onWheel={blurOnWheel}
                                onChange={(event) =>
                                  onUpdateSubtitleClip(clip.id, {
                                    duration: Math.max(0.1, Number(event.target.value) || 0.1),
                                  })
                                }
                              />
                            </label>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </PanelSection>
              </>
            ) : null}

            {activeInspectorTab === "export" ? (
              <>
                <PanelSection title="录制与导出">
                  <ExportToolbar
                    recordingQuality={recordingQuality}
                    setRecordingQuality={setRecordingQuality}
                    transparentBg={transparentBg}
                    setTransparentBg={setTransparentBg}
                    recState={recState}
                    recordingTime={recordingTime}
                    recordingProgress={recordingProgress}
                    blob={blob}
                    onStartRecording={onStartRecording}
                    onStopRecording={onStopRecording}
                    onSaveWebM={onSaveWebM}
                    onConvertToMov={onConvertToMov}
                    onExportSubtitlesSrt={onExportSubtitlesSrt}
                    onTakeScreenshot={onTakeScreenshot}
                    onTakePartsScreenshots={onTakePartsScreenshots}
                    isVp9AlphaSupported={isVp9AlphaSupported}
                  />
                </PanelSection>
                <PanelSection title="会话状态">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>时间线总长</span>
                      <strong>{timelineLength.toFixed(2)} 秒</strong>
                    </div>
                    <div className="stat-card">
                      <span>播放头</span>
                      <strong>{playhead.toFixed(2)} 秒</strong>
                    </div>
                    <div className="stat-card">
                      <span>帧率</span>
                      <strong>{typeof currentFps === "number" ? currentFps.toFixed(1) : "--"}</strong>
                    </div>
                    <div className="stat-card">
                      <span>录制状态</span>
                      <strong>{recState === "rec" ? "录制中" : recState === "offline" ? "离线导出中" : recState === "done" ? "可下载" : "待机"}</strong>
                    </div>
                  </div>
                </PanelSection>
              </>
            ) : null}

            {activeInspectorTab === "audio" ? (
              <>
                <PanelSection title="播放控制">
                  <div className="button-row">
                    <button className="btn btn--primary" onClick={isPlaying ? stopPlayback : startPlayback} disabled={timelineLength <= 0 && !isPlaying}>
                      {isPlaying ? "停止播放" : "开始播放"}
                    </button>
                    <button className="btn btn--quiet" onClick={clearTimeline}>
                      清空时间线
                    </button>
                    <button className="btn btn--accent" onClick={addAudioClip}>
                      导入音频
                    </button>
                  </div>
                </PanelSection>
                <PanelSection title="音频电平">{renderLevelMeter()}</PanelSection>
                <PanelSection title="播放监看">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>当前播放</span>
                      <strong>{isPlaying ? "运行中" : "已停止"}</strong>
                    </div>
                    <div className="stat-card">
                      <span>播放头</span>
                      <strong>{playhead.toFixed(2)} 秒</strong>
                    </div>
                  </div>
                </PanelSection>
              </>
            ) : null}

            {activeInspectorTab === "project" ? (
              <>
                <PanelSection title="工程概览">
                  <div className="meta-grid">
                    <div>
                      <span>当前模型</span>
                      <strong>{selectedModelLabel}</strong>
                    </div>
                    <div>
                      <span>动作数量</span>
                      <strong>{allMotionNames.length}</strong>
                    </div>
                    <div>
                      <span>表情数量</span>
                      <strong>{allExpressionNames.length}</strong>
                    </div>
                    <div>
                      <span>角色数量</span>
                      <strong>{characterOptions.length || 1}</strong>
                    </div>
                  </div>
                </PanelSection>
                <PanelSection title="工程操作">
                  <div className="button-row">
                    {onRefreshModels ? (
                      <button className="btn btn--quiet" onClick={onRefreshModels}>
                        刷新模型索引
                      </button>
                    ) : null}
                    <button className="btn btn--quiet" onClick={clearTimeline}>
                      清空时间线
                    </button>
                    <button className="btn btn--quiet" onClick={onToggleWebGALMode}>
                      打开 WebGAL
                    </button>
                  </div>
                </PanelSection>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
