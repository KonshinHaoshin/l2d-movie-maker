// src/components/Live2DView.tsx
import { startTransition, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, SubtitleClip, TrackKind } from "./timeline/clipTypes";
import { parseMotionDurationSeconds } from "../utils/motionDuration";
import "./Live2DView.css";
import ControlPanel, { type InspectorTab } from "./panel/ControlPanel";
import ModelManager from "./ModelManager";
import type { JsonlLive2DModel } from "./ModelManager";
import AudioManager from "./AudioManager";
import RecordingManager from "./RecordingManager";
import WebGALMode from "./WebGALMode";
// import { convertFileSrc } from "@tauri-apps/api/core";
// import { normalizePath } from "../utils/fs";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { appCacheDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { isVp9AlphaSupported } from "../utils/recorder";
import { runOfflineWebMExport } from "../utils/offlineExporter";
import {
  buildWebGALExternalAssetUrl,
  loadWebGALMotionDurations,
  resolveFigureAbsolutePath,
  type WebGALImportPlan,
} from "../utils/webgalProject";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type MotionLenMap = Record<string, number>;
type CharacterOption = { id: string; label: string };
type CharacterTransform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
type CharacterTransformMode = "single-relative" | "composite-container";
type TransformTarget = Pick<PIXI.Container, "position" | "scale" | "rotation" | "getBounds">;
type BoundsTarget = Pick<Live2DModel, "width" | "height" | "position" | "scale" | "getBounds" | "getLocalBounds">;
type RendererWithBackground = PIXI.Renderer & {
  backgroundColor: number;
  backgroundAlpha: number;
  clearBeforeRender: boolean;
  gl?: WebGLRenderingContext | WebGL2RenderingContext | null;
};
type ExportVisualMode = "all" | "subtitle-only" | "live2d-only";
type SubtitleSpeakerAlign = "left" | "center" | "right";
const PLAYHEAD_UI_INTERVAL_MS = 1000 / 30;
const EXPORT_PROGRESS_UI_INTERVAL_MS = 100;
const DEFAULT_SUBTITLE_FONT_FAMILY = "Microsoft YaHei";
const DEFAULT_SUBTITLE_FONT_SIZE = 34;
const DEFAULT_SUBTITLE_TEXT_COLOR = "#ffffff";
const AUDIO_WAVEFORM_PEAK_COUNT = 56;
const AUDIO_END_GUARD_SEC = 0.03;

declare global {
  interface Window {
    PIXI?: typeof PIXI;
  }
}


export default function Live2DView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // ????????????????
  const modelRef = useRef<Live2DModel | Live2DModel[] | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const subtitleContainerRef = useRef<PIXI.Container | null>(null);
  const subtitleSpeakerTextRef = useRef<PIXI.Text | null>(null);
  const subtitleSpeakerUnderlineRef = useRef<PIXI.Graphics | null>(null);
  const subtitleTextRef = useRef<PIXI.Text | null>(null);

  // ????jsonl?????????MTN ??????
  const groupContainerRef = useRef<PIXI.Container | null>(null);
  const isCompositeRef = useRef<boolean>(false);
  const motionBaseRef = useRef<string | null>(null); // ???? mtn ????

  // ??????????
  const [assetBase, setAssetBase] = useState<string | null>(null);

  // ??????? ???//
  const [modelList, setModelList] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // ?? "anon/model.json" ??"xxx/model.jsonl"
  const [, setExternalModelDisplayName] = useState<string | null>(null);
  const modelUrl = selectedModel && assetBase ? `${assetBase}/${selectedModel}` : null; // ???URL

  // ????????? ???//
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<string>("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [enableDragging, setEnableDragging] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // ??????????//
  const [motionClips, setMotionClips] = useState<Clip[]>([]);
  const [exprClips, setExprClips] = useState<Clip[]>([]);
  const [audioClips, setAudioClips] = useState<Clip[]>([]); // ??????
  const [subtitleClips, setSubtitleClips] = useState<SubtitleClip[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showSubtitleSpeaker, setShowSubtitleSpeaker] = useState(false);
  const [subtitleSpeakerAlign, setSubtitleSpeakerAlign] = useState<SubtitleSpeakerAlign>("center");
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioLevel, setCurrentAudioLevel] = useState(0); // ??????
  const [currentFps, setCurrentFps] = useState(0);

  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);
  const fpsRafRef = useRef<number | null>(null);
  const fpsFrameCountRef = useRef(0);
  const fpsLastTsRef = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const playheadUiLastTsRef = useRef<number | null>(null);
  const activeMotionClipIdRef = useRef<string | null>(null);
  const activeExprClipIdRef = useRef<string | null>(null);
  const activeSubtitleSignatureRef = useRef<string>("");
  const subtitleVisibilityOverrideRef = useRef<boolean | null>(null);

  // ????????
  const [motionDur, setMotionDur] = useState(2);
  const [exprDur, setExprDur] = useState(0.8);

  // ?? motion ??????
  const [motionLen, setMotionLen] = useState<MotionLenMap>({});

  // ????? ???//
  const [recState, setRecState] = useState<"idle" | "rec" | "done" | "offline">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [transparentBg, setTransparentBg] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobDefaultName, setBlobDefaultName] = useState("export.webm");
  
  // ????????????????//
  const [customRecordingBounds, setCustomRecordingBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
   
  // ????????? ???//
  const [recordingQuality, setRecordingQuality] = useState<"low" | "medium" | "high">("medium");
  
  // ????????????????? ???//
  const useModelFrame = false;
  const [characterOptions, setCharacterOptions] = useState<CharacterOption[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("main");
  const [isCharacterVisible, setIsCharacterVisible] = useState(true);
  const [characterTransformMode, setCharacterTransformMode] = useState<CharacterTransformMode>("single-relative");
  const [characterTransform, setCharacterTransform] = useState<CharacterTransform>({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  const characterTransformRef = useRef<CharacterTransform>({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  const characterTransformModeRef = useRef<CharacterTransformMode>("single-relative");
  const isDraggingRef = useRef(false);

  const handleDraggingChange = (dragging: boolean) => {
    isDraggingRef.current = dragging;
    setIsDragging(dragging);
  };

  const syncCharacterTransformState = (transform: CharacterTransform) => {
    characterTransformRef.current = transform;
    setCharacterTransform(transform);
  };

  const syncCharacterTransformModeState = (mode: CharacterTransformMode) => {
    characterTransformModeRef.current = mode;
    setCharacterTransformMode(mode);
  };

  const resetSingleCharacterTransformState = () => {
    syncCharacterTransformModeState("single-relative");
    syncCharacterTransformState({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  };

  const syncCharacterTransformFromScene = (transform: CharacterTransform) => {
    if (Array.isArray(modelRef.current)) {
      syncCharacterTransformModeState("composite-container");
      syncCharacterTransformState(transform);
      return;
    }

    syncCharacterTransformModeState("single-relative");
    const relative = toSingleModelRelativePosition({ x: transform.x, y: transform.y });
    syncCharacterTransformState({
      ...transform,
      x: relative.x,
      y: relative.y,
    });
  };

  
  // ???WebGAL?? ???//
  const [showWebGALMode, setShowWebGALMode] = useState(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>("character");

  // ??????
  const modelManager = ModelManager({
    appRef,
    modelRef,
    groupContainerRef,
    isCompositeRef,
    motionBaseRef,
    setModelData,
    setCustomRecordingBounds,
    enableDragging,
    setIsDragging: handleDraggingChange,
    onTransformChange: syncCharacterTransformFromScene,
  });

  const audioManager = AudioManager({
    modelRef,
    audioClips,
    setCurrentAudioLevel
  });

  const getPreviewDimensions = () => {
    const fallbackWidth = containerRef.current?.clientWidth ?? 1;
    const fallbackHeight = containerRef.current?.clientHeight ?? 1;
    return {
      width: Math.max(1, appRef.current?.screen.width ?? fallbackWidth),
      height: Math.max(1, appRef.current?.screen.height ?? fallbackHeight),
    };
  };

  const toSingleModelRelativePosition = (position: { x: number; y: number }) => {
    const { width, height } = getPreviewDimensions();
    return {
      x: ((position.x - (width / 2)) / (width / 2)) * 100,
      y: ((position.y - (height / 2)) / (height / 2)) * 100,
    };
  };

  const toSingleModelAbsolutePosition = (position: { x: number; y: number }) => {
    const { width, height } = getPreviewDimensions();
    return {
      x: (width / 2) + ((position.x / 100) * (width / 2)),
      y: (height / 2) + ((position.y / 100) * (height / 2)),
    };
  };

  const readTransformFromTarget = (target: TransformTarget, mode: CharacterTransformMode): CharacterTransform => {
    const position = mode === "single-relative"
      ? toSingleModelRelativePosition({ x: Number(target.position.x), y: Number(target.position.y) })
      : { x: Number(target.position.x), y: Number(target.position.y) };

    return {
      x: position.x,
      y: position.y,
      scaleX: Number(target.scale.x),
      scaleY: Number(target.scale.y),
      rotation: Number(target.rotation * 180 / Math.PI),
    };
  };

  const getTransformTarget = (): TransformTarget | null => {
    const cur = modelRef.current;
    if (!cur) return null;
    if (Array.isArray(cur)) return groupContainerRef.current ?? null;
    return cur;
  };

  const getSelectedCharacterDisplayObjects = (): PIXI.DisplayObject[] => {
    const currentModel = modelRef.current;
    if (!currentModel) return [];

    if (Array.isArray(currentModel)) {
      const matchingModels = currentModel.filter((model) => {
        const taggedModel = model as JsonlLive2DModel;
        return (taggedModel.__characterId ?? "") === selectedCharacterId;
      });

      if (matchingModels.length > 0) {
        return matchingModels as unknown as PIXI.DisplayObject[];
      }

      return groupContainerRef.current ? [groupContainerRef.current] : [];
    }

    return [currentModel as unknown as PIXI.DisplayObject];
  };

  const syncSelectedCharacterVisibilityState = () => {
    const targets = getSelectedCharacterDisplayObjects();
    setIsCharacterVisible(targets.length === 0 ? true : targets.every((target) => target.visible));
  };

  const setSelectedCharacterVisibility = (visible: boolean) => {
    const targets = getSelectedCharacterDisplayObjects();
    targets.forEach((target) => {
      target.visible = visible;
    });
    setIsCharacterVisible(visible);
  };

  const syncRecordingBoundsFromCurrentModel = () => {
    if (Array.isArray(modelRef.current)) {
      if (groupContainerRef.current) {
        const b = groupContainerRef.current.getBounds();
        setCustomRecordingBounds({ x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.max(100, b.width), height: Math.max(100, b.height) });
      }
      return;
    }
    if (modelRef.current) {
      const b = modelRef.current.getBounds();
      if (b && b.width > 0 && b.height > 0) {
        setCustomRecordingBounds({ x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.max(100, b.width), height: Math.max(100, b.height) });
      }
    }
  };

  const syncSingleModelAbsoluteTransform = (transform: CharacterTransform = characterTransformRef.current) => {
    const currentModel = modelRef.current;
    if (!currentModel || Array.isArray(currentModel)) return;
    const absolute = toSingleModelAbsolutePosition({ x: transform.x, y: transform.y });
    currentModel.position.set(absolute.x, absolute.y);
    currentModel.scale.set(Math.max(0.01, transform.scaleX), Math.max(0.01, transform.scaleY));
    currentModel.rotation = (transform.rotation * Math.PI) / 180;
  };

  const syncSingleModelTransformState = (positionMode: "center" | "read" | "preserve" = "preserve") => {
    const currentModel = modelRef.current;
    if (!currentModel || Array.isArray(currentModel)) return;

    let nextPosition: { x: number; y: number };
    if (positionMode === "center") {
      nextPosition = { x: 0, y: 0 };
    } else if (positionMode === "read") {
      nextPosition = toSingleModelRelativePosition({
        x: Number(currentModel.position.x),
        y: Number(currentModel.position.y),
      });
    } else {
      nextPosition = {
        x: characterTransformRef.current.x,
        y: characterTransformRef.current.y,
      };
    }

    syncCharacterTransformModeState("single-relative");
    syncCharacterTransformState({
      x: nextPosition.x,
      y: nextPosition.y,
      scaleX: Number(currentModel.scale.x),
      scaleY: Number(currentModel.scale.y),
      rotation: Number(currentModel.rotation * 180 / Math.PI),
    });
  };

  const refreshCharacterEditor = () => {
    const cur = modelRef.current;
    if (!cur) {
      setCharacterOptions([]);
      setSelectedCharacterId("main");
      setIsCharacterVisible(true);
      resetSingleCharacterTransformState();
      return;
    }

    if (Array.isArray(cur)) {
      const options = Array.from(
        new Map(
          cur.map((model, index) => {
            const taggedModel = model as JsonlLive2DModel;
            const id = taggedModel.__characterId || `part${index}`;
            const label = taggedModel.__characterLabel || id;
            return [id, { id, label }];
          })
        ).values()
      );

      setCharacterOptions(options);
      setSelectedCharacterId((prev) => (
        options.some((option) => option.id === prev) ? prev : (options[0]?.id ?? "main")
      ));
      syncCharacterTransformModeState("composite-container");
      const target = groupContainerRef.current;
      if (!target) return;
      syncCharacterTransformState(readTransformFromTarget(target, "composite-container"));
      syncSelectedCharacterVisibilityState();
      return;
    }

    setCharacterOptions([{ id: "main", label: "主角色" }]);
    if (selectedCharacterId !== "main") setSelectedCharacterId("main");
    syncSingleModelTransformState("preserve");
    syncSelectedCharacterVisibilityState();
  };

  const updateSelectedCharacterTransform = (patch: Partial<CharacterTransform>) => {
    const target = getTransformTarget();
    if (!target) return;
    const next: CharacterTransform = { ...characterTransformRef.current, ...patch };
    if (characterTransformModeRef.current === "single-relative") {
      const absolute = toSingleModelAbsolutePosition({ x: next.x, y: next.y });
      target.position.set(absolute.x, absolute.y);
    } else {
      target.position.set(next.x, next.y);
    }
    target.scale.set(Math.max(0.01, next.scaleX), Math.max(0.01, next.scaleY));
    target.rotation = (next.rotation * Math.PI) / 180;
    syncCharacterTransformState(next);
    syncRecordingBoundsFromCurrentModel();
  };

  const updateUniformScale = (multiplier: number) => {
    const current = characterTransformRef.current;
    const uniformScale = Math.max(0.01, (current.scaleX + current.scaleY) / 2);
    const nextScale = Math.max(0.01, Math.min(10, uniformScale * multiplier));
    updateSelectedCharacterTransform({ scaleX: nextScale, scaleY: nextScale });
  };


  // ????????
  const nextEnd = (clips: Clip[]) => clips.reduce((t, c) => Math.max(t, c.start + c.duration), 0);

  const buildSubtitleClipName = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return "新字幕";
    return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
  };

  const createSubtitleClip = (
    text: string,
    start: number,
    duration: number,
    options: { linkedAudioClipId?: string; speakerName?: string } = {},
  ): SubtitleClip => ({
    id: crypto.randomUUID(),
    name: buildSubtitleClipName(text),
    start,
    duration,
    subtitleText: text,
    speakerName: options.speakerName?.trim() || undefined,
    fontFamily: DEFAULT_SUBTITLE_FONT_FAMILY,
    fontSize: DEFAULT_SUBTITLE_FONT_SIZE,
    textColor: DEFAULT_SUBTITLE_TEXT_COLOR,
    linkedAudioClipId: options.linkedAudioClipId,
  });

  const getAudioAudibleDuration = (clip: Clip) =>
    Math.min(
      Math.max(0, Number(clip.duration) || 0),
      Math.max(0, Number(clip.audioSourceDuration ?? clip.duration) || 0),
    );

  const buildWaveformPeaks = (buffer: AudioBuffer, peakCount = AUDIO_WAVEFORM_PEAK_COUNT) => {
    const channelData = buffer.getChannelData(0);
    if (channelData.length === 0) return [];

    const blockSize = Math.max(1, Math.floor(channelData.length / peakCount));
    const peaks: number[] = [];
    let maxPeak = 0;

    for (let index = 0; index < peakCount; index += 1) {
      const start = index * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
      }

      peaks.push(peak);
      maxPeak = Math.max(maxPeak, peak);
    }

    if (maxPeak <= 0) {
      return peaks.map(() => 0.18);
    }

    return peaks.map((peak) => Math.max(0.12, peak / maxPeak));
  };

  const analyzeAudioSource = async (audioUrl: string, fallbackDuration: number) => {
    const context = audioManager.audioContextRef.current;
    if (!context) {
      return { audioSourceDuration: fallbackDuration, waveformPeaks: undefined as number[] | undefined };
    }

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
      return {
        audioSourceDuration: Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0
          ? audioBuffer.duration
          : fallbackDuration,
        waveformPeaks: buildWaveformPeaks(audioBuffer),
      };
    } catch (error) {
      console.warn("音频波形分析失败", error);
      return { audioSourceDuration: fallbackDuration, waveformPeaks: undefined as number[] | undefined };
    }
  };

  const resetTimelineTriggerState = () => {
    activeMotionClipIdRef.current = null;
    activeExprClipIdRef.current = null;
    activeSubtitleSignatureRef.current = "";
  };

  const findActiveClip = (clips: Clip[], timeSec: number): Clip | null => {
    for (let i = clips.length - 1; i >= 0; i -= 1) {
      const clip = clips[i];
      if (timeSec >= clip.start && timeSec < clip.start + clip.duration) {
        return clip;
      }
    }
    return null;
  };

  const syncSubtitleDisplayLayout = () => {
    const app = appRef.current;
    const subtitleContainer = subtitleContainerRef.current;
    const subtitleText = subtitleTextRef.current;
    if (!app || !subtitleContainer || !subtitleText) return;

    subtitleContainer.position.set(app.screen.width / 2, app.screen.height - 36);
    subtitleText.style.wordWrap = true;
    subtitleText.style.wordWrapWidth = Math.max(320, app.screen.width - 140);
  };

  const shouldRenderSubtitles = () => subtitleVisibilityOverrideRef.current ?? showSubtitles;

  const setModelVisibility = (visible: boolean) => {
    const currentModel = modelRef.current;
    if (!currentModel) return;

    if (Array.isArray(currentModel)) {
      if (groupContainerRef.current) {
        groupContainerRef.current.visible = visible;
        return;
      }

      currentModel.forEach((model) => {
        (model as unknown as PIXI.DisplayObject).visible = visible;
      });
      return;
    }

    (currentModel as unknown as PIXI.DisplayObject).visible = visible;
  };

  const getModelVisibilitySnapshot = (): boolean[] => {
    const currentModel = modelRef.current;
    if (!currentModel) return [];

    if (Array.isArray(currentModel)) {
      if (groupContainerRef.current) {
        return [groupContainerRef.current.visible];
      }
      return currentModel.map((model) => (model as unknown as PIXI.DisplayObject).visible);
    }

    return [(currentModel as unknown as PIXI.DisplayObject).visible];
  };

  const restoreModelVisibility = (snapshot: boolean[]) => {
    const currentModel = modelRef.current;
    if (!currentModel || snapshot.length === 0) return;

    if (Array.isArray(currentModel)) {
      if (groupContainerRef.current) {
        groupContainerRef.current.visible = snapshot[0];
        return;
      }

      currentModel.forEach((model, index) => {
        (model as unknown as PIXI.DisplayObject).visible = snapshot[index] ?? true;
      });
      return;
    }

    (currentModel as unknown as PIXI.DisplayObject).visible = snapshot[0];
  };

  const renderSubtitleClip = (clip: SubtitleClip | null) => {
    const subtitleContainer = subtitleContainerRef.current;
    const subtitleSpeakerText = subtitleSpeakerTextRef.current;
    const subtitleSpeakerUnderline = subtitleSpeakerUnderlineRef.current;
    const subtitleText = subtitleTextRef.current;
    if (!subtitleContainer || !subtitleSpeakerText || !subtitleSpeakerUnderline || !subtitleText) return;

    if (!shouldRenderSubtitles() || !clip || !clip.subtitleText.trim()) {
      subtitleContainer.visible = false;
      subtitleSpeakerText.text = "";
      subtitleText.text = "";
      subtitleSpeakerUnderline.clear();
      activeSubtitleSignatureRef.current = "";
      return;
    }

    const speakerName = clip.speakerName?.trim() || "";
    const shouldShowSpeaker = showSubtitleSpeaker && !!speakerName;

    const signature = [
      clip.id,
      shouldShowSpeaker ? speakerName : "",
      subtitleSpeakerAlign,
      clip.subtitleText,
      clip.fontFamily,
      clip.fontSize,
      clip.textColor,
    ].join("|");

    if (activeSubtitleSignatureRef.current === signature && subtitleContainer.visible) {
      return;
    }

    subtitleContainer.visible = true;
    subtitleText.text = clip.subtitleText;
    subtitleText.style = new PIXI.TextStyle({
      fontFamily: clip.fontFamily || DEFAULT_SUBTITLE_FONT_FAMILY,
      fontSize: Math.max(12, clip.fontSize || DEFAULT_SUBTITLE_FONT_SIZE),
      fontWeight: "700",
      fill: clip.textColor || DEFAULT_SUBTITLE_TEXT_COLOR,
      align: "center",
      stroke: "#081018",
      strokeThickness: 6,
      lineJoin: "round",
      dropShadow: true,
      dropShadowColor: "#000000",
      dropShadowBlur: 4,
      dropShadowDistance: 2,
      wordWrap: true,
      wordWrapWidth: Math.max(320, (appRef.current?.screen.width ?? 1280) - 140),
      breakWords: true,
    });

    subtitleText.position.set(0, 0);

    subtitleSpeakerText.text = shouldShowSpeaker ? speakerName : "";
    subtitleSpeakerText.style = new PIXI.TextStyle({
      fontFamily: clip.fontFamily || DEFAULT_SUBTITLE_FONT_FAMILY,
      fontSize: Math.max(14, Math.round((clip.fontSize || DEFAULT_SUBTITLE_FONT_SIZE) * 0.78)),
      fontWeight: "700",
      fill: clip.textColor || DEFAULT_SUBTITLE_TEXT_COLOR,
      align: "center",
      stroke: "#081018",
      strokeThickness: 4,
      lineJoin: "round",
      dropShadow: true,
      dropShadowColor: "#000000",
      dropShadowBlur: 3,
      dropShadowDistance: 1,
    });

    const subtitleBodyBounds = subtitleText.getLocalBounds();
    const subtitleBodyHeight = subtitleBodyBounds.height;
    subtitleSpeakerUnderline.clear();
    if (shouldShowSpeaker) {
      const speakerBounds = subtitleSpeakerText.getLocalBounds();
      const wrapWidth = Math.max(320, (appRef.current?.screen.width ?? 1280) - 140);
      const speakerOffset = Math.min(
        wrapWidth * 0.22,
        Math.max(96, (subtitleBodyBounds.width / 2) - 56),
      );
      const speakerX =
        subtitleSpeakerAlign === "left"
          ? -speakerOffset
          : subtitleSpeakerAlign === "right"
            ? speakerOffset
            : 0;
      subtitleSpeakerText.position.set(speakerX, -subtitleBodyHeight - 18);
      const underlineWidth = Math.max(56, speakerBounds.width + 8);
      const underlineY = subtitleSpeakerText.position.y + 8;
      subtitleSpeakerUnderline.lineStyle(2, 0x000000, 1);
      subtitleSpeakerUnderline.moveTo(speakerX - underlineWidth / 2, underlineY);
      subtitleSpeakerUnderline.lineTo(speakerX + underlineWidth / 2, underlineY);
    } else {
      subtitleSpeakerText.position.set(0, -subtitleBodyHeight);
    }

    activeSubtitleSignatureRef.current = signature;
    syncSubtitleDisplayLayout();
  };

  const clearTimeline = () => { 
    setMotionClips([]); 
    setExprClips([]); 
    setAudioClips([]); 
    setSubtitleClips([]);
    playheadRef.current = 0;
    playheadUiLastTsRef.current = null;
    setPlayhead(0); 
    resetTimelineTriggerState();
    renderSubtitleClip(null);
    
    // ??????
    audioManager.cleanupAudio();
  };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "expr") setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "audio") {
      setAudioClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
      setSubtitleClips(prev =>
        prev.map((clip) => (
          clip.linkedAudioClipId === id
            ? {
                ...clip,
                ...patch,
              }
            : clip
        )),
      );
    }
    else if (track === "subtitle") setSubtitleClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addSubtitleClip = () => {
    const start = Math.max(timelineLength, nextEnd(subtitleClips));
    const duration = Math.max(0.5, exprDur || motionDur || 2);
    setSubtitleClips((prev) => [...prev, createSubtitleClip("新字幕", start, duration)]);
  };

  const updateSubtitleClip = (
    id: string,
    patch: Partial<Pick<SubtitleClip, "subtitleText" | "speakerName" | "fontFamily" | "fontSize" | "textColor" | "start" | "duration">>,
  ) => {
    setSubtitleClips((prev) =>
      prev.map((clip) => {
        if (clip.id !== id) return clip;
        const nextText = typeof patch.subtitleText === "string" ? patch.subtitleText : clip.subtitleText;
        return {
          ...clip,
          ...patch,
          subtitleText: nextText,
          speakerName: typeof patch.speakerName === "string" ? patch.speakerName : clip.speakerName,
          name: buildSubtitleClipName(nextText),
          fontSize: Math.max(12, Number(patch.fontSize ?? clip.fontSize) || DEFAULT_SUBTITLE_FONT_SIZE),
          duration: Math.max(0.1, Number(patch.duration ?? clip.duration) || clip.duration),
          start: Math.max(0, Number(patch.start ?? clip.start) || 0),
        };
      }),
    );
  };

  const removeSubtitleClip = (id: string) => {
    setSubtitleClips((prev) => prev.filter((clip) => clip.id !== id));
  };

  const setPlayheadSec = (sec: number) => {
    playheadRef.current = sec;
    playheadUiLastTsRef.current = null;
    resetTimelineTriggerState();
    setPlayhead(sec);
  };

  // ????????????????????//
  const playMotion = (group: string) => {
    if (!modelData?.motions[group]) return;
    modelManager.forEachModel((m) => m.motion(group, 0, 3));
    setCurrentMotion(group);
  };

  const applyExpression = (name: string) => {
    if (!modelData?.expressions?.length) return;
    modelManager.forEachModel((m) => m.expression(name));
    setCurrentExpression(name);
  };

  const addMotionClip = async (name: string) => {
    if (!name) return;
    const dur = motionLen[name] ?? motionDur;
    setMotionClips((prev) => [...prev, { id: crypto.randomUUID(), name, start: nextEnd(prev), duration: dur }]);
  };

  const addExprClip = (name: string) => {
    if (!name) return;
    setExprClips((prev) => [...prev, { id: crypto.randomUUID(), name, start: nextEnd(prev), duration: exprDur }]);
  };

  const registerAudioElement = (clipId: string, audioUrl: string) => {
    const audioElement = new Audio(audioUrl);
    audioElement.crossOrigin = "anonymous";
    audioElement.preload = "auto";
    audioElement.volume = 0.8;
    audioManager.audioRefs.current.set(clipId, audioElement);

    if (audioManager.audioContextRef.current) {
      try {
        const source = audioManager.audioContextRef.current.createMediaElementSource(audioElement);
        const analyzer = audioManager.audioContextRef.current.createAnalyser();
        analyzer.fftSize = 256;
        analyzer.smoothingTimeConstant = 0.8;

        source.connect(analyzer);
        analyzer.connect(audioManager.audioContextRef.current.destination);

        audioManager.audioAnalyzersRef.current.set(clipId, { source, analyzer });
      } catch (error) {
        console.warn("音频分析器初始化失败", error);
      }
    }

    return audioElement;
  };

  const syncPreviewAudioAtTime = (timeSec: number) => {
    audioClips.forEach((clip) => {
      const audioElement = audioManager.audioRefs.current.get(clip.id);
      if (!audioElement) return;

      const audibleDuration = getAudioAudibleDuration(clip);
      const playbackCeiling = Math.max(0, audibleDuration - AUDIO_END_GUARD_SEC);
      if (audibleDuration <= 0) {
        if (!audioElement.paused) {
          audioElement.pause();
        }
        audioElement.currentTime = 0;
        return;
      }

      const clipOffset = timeSec - clip.start;
      if (clipOffset >= 0 && clipOffset < playbackCeiling) {
        const playbackTime = Math.max(0, Math.min(clipOffset, playbackCeiling));
        if (audioElement.paused) {
          audioElement.currentTime = playbackTime;
          audioElement.play().catch((error) => {
            console.warn("音频播放失败", error);
          });
        } else if (Math.abs(audioElement.currentTime - playbackTime) > 0.25) {
          audioElement.currentTime = playbackTime;
        }
        return;
      }

      if (!audioElement.paused) {
        audioElement.pause();
      }
      audioElement.currentTime = 0;
    });
  };

  // ????????
  const addAudioClip = async () => {
    try {
      audioManager.initAudioContext();

      const picked = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a"] }]
      });
      if (!picked) return;
      const audioPath = Array.isArray(picked) ? picked[0] : picked;
      if (!audioPath) return;

      const audioUrl = convertFileSrc(audioPath);
      const audio = new Audio(audioUrl);
      audio.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        audio.onloadedmetadata = resolve;
        audio.onerror = reject;
        audio.load();
      });

      const duration = audio.duration;
      if (duration <= 0) {
        alert('????????');
        return;
      }

      const fileName = audioPath.split(/[\\/]/).pop() ?? "audio";
      const clipName = fileName.replace(/\.[^/.]+$/, '');

      const audioClip: Clip = {
        id: crypto.randomUUID(),
        name: clipName,
        start: nextEnd(audioClips),
        duration,
        audioSourceDuration: duration,
        audioUrl,
        audioPath
      };

      const audioMeta = await analyzeAudioSource(audioUrl, duration);
      audioClip.audioSourceDuration = audioMeta.audioSourceDuration;
      audioClip.waveformPeaks = audioMeta.waveformPeaks;

      registerAudioElement(audioClip.id, audioUrl);

      setAudioClips(prev => [...prev, audioClip]);
    } catch (error) {
      console.error('??????:', error);
      alert('??????: ' + error);
    }
  };

  const timelineLength = Math.max(nextEnd(motionClips), nextEnd(exprClips), nextEnd(audioClips), nextEnd(subtitleClips));

  const applyTimelineAtTime = (t: number, offline: boolean = false) => {
    const activeMotionClip = findActiveClip(motionClips, t);
    if (activeMotionClip) {
      if (activeMotionClipIdRef.current !== activeMotionClip.id) {
        activeMotionClipIdRef.current = activeMotionClip.id;
        playMotion(activeMotionClip.name);
      }
    } else {
      activeMotionClipIdRef.current = null;
    }

    const activeExprClip = findActiveClip(exprClips, t);
    if (activeExprClip) {
      if (activeExprClipIdRef.current !== activeExprClip.id) {
        activeExprClipIdRef.current = activeExprClip.id;
        applyExpression(activeExprClip.name);
      }
    } else {
      activeExprClipIdRef.current = null;
    }

    renderSubtitleClip(findActiveClip(subtitleClips, t) as SubtitleClip | null);

    if (!offline) {
      const hasAudibleAudio = audioClips.some((clip) => {
        const audibleDuration = getAudioAudibleDuration(clip);
        const playbackCeiling = Math.max(0, audibleDuration - AUDIO_END_GUARD_SEC);
        const clipOffset = t - clip.start;
        return clipOffset >= 0 && clipOffset < playbackCeiling;
      });
      syncPreviewAudioAtTime(t);
      if (hasAudibleAudio) {
        audioManager.processAudioAnimation(t);
      } else {
        setCurrentAudioLevel(0);
      }
    }
  };

  const setRendererBackgroundMode = (renderer: RendererWithBackground, transparent: boolean) => {
    if (transparent) {
      renderer.backgroundColor = 0x00000000;
      renderer.backgroundAlpha = 0;
      renderer.clearBeforeRender = true;
      renderer.gl?.clearColor(0, 0, 0, 0);
      return;
    }

    renderer.backgroundColor = 0xf0f0f0;
    renderer.backgroundAlpha = 1;
    renderer.clearBeforeRender = false;
  };

  const applyBoundsFromModelMetrics = (model: BoundsTarget) => {
    const modelWidth = model.width * model.scale.x;
    const modelHeight = model.height * model.scale.y;
    const modelX = model.position.x - modelWidth / 2;
    const modelY = model.position.y - modelHeight / 2;
    setCustomRecordingBounds({
      x: Math.max(0, modelX),
      y: Math.max(0, modelY),
      width: Math.max(100, Math.min(modelWidth, window.innerWidth)),
      height: Math.max(100, Math.min(modelHeight, window.innerHeight)),
    });
  };

  const syncPlayheadUi = (nextPlayhead: number, ts: number, force: boolean = false) => {
    playheadRef.current = nextPlayhead;

    if (!force) {
      const lastUiTs = playheadUiLastTsRef.current;
      if (lastUiTs != null && ts - lastUiTs < PLAYHEAD_UI_INTERVAL_MS) {
        return;
      }
    }

    playheadUiLastTsRef.current = ts;
    startTransition(() => {
      setPlayhead(nextPlayhead);
    });
  };

  const tick = (ts: number) => {
    if (startTsRef.current == null) startTsRef.current = ts;
    const t = (ts - startTsRef.current) / 1000;
    syncPlayheadUi(t, ts);

    applyTimelineAtTime(t);

    if (t >= timelineLength) {
      syncPlayheadUi(timelineLength, ts, true);
      stopPlayback();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startPlayback = () => {
    if (isPlaying || timelineLength <= 0) return;
    playheadRef.current = 0;
    playheadUiLastTsRef.current = null;
    resetTimelineTriggerState();
    setPlayhead(0);
    setIsPlaying(true);
    startTsRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopPlayback = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startTsRef.current = null;
    playheadUiLastTsRef.current = null;
    resetTimelineTriggerState();
    setIsPlaying(false);
    setPlayhead(playheadRef.current);
    
    // ?????????
    audioManager.stopAllAudio();
  };

  // ???????? FPS????????????????????? Live2D Control
  useEffect(() => {
    let disposed = false;

    const fpsTick = (ts: number) => {
      if (disposed) return;
      if (fpsLastTsRef.current == null) fpsLastTsRef.current = ts;

      fpsFrameCountRef.current += 1;
      const elapsed = ts - fpsLastTsRef.current;

      if (elapsed >= 500) {
        const fps = (fpsFrameCountRef.current * 1000) / elapsed;
        setCurrentFps(Math.max(0, Math.min(240, fps)));
        fpsFrameCountRef.current = 0;
        fpsLastTsRef.current = ts;
      }

      fpsRafRef.current = requestAnimationFrame(fpsTick);
    };

    fpsRafRef.current = requestAnimationFrame(fpsTick);
    return () => {
      disposed = true;
      if (fpsRafRef.current) cancelAnimationFrame(fpsRafRef.current);
      fpsRafRef.current = null;
      fpsFrameCountRef.current = 0;
      fpsLastTsRef.current = null;
      setCurrentFps(0);
    };
  }, []);

  // ??????
  const startRecording = () => {
    setBlobDefaultName("export.webm");
    recordingManager.start();
  };

  const stopRecording = () => {
    recordingManager.stop();
  };

  const formatSrtTimestamp = (timeSec: number) => {
    const totalMs = Math.max(0, Math.round(timeSec * 1000));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMs % 60_000) / 1000);
    const millis = totalMs % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  };

  const exportSubtitlesSrt = async () => {
    const entries = [...subtitleClips]
      .filter((clip) => clip.subtitleText.trim())
      .sort((left, right) => left.start - right.start);

    if (entries.length === 0) {
      alert("当前没有可导出的字幕");
      return;
    }

    const out = await save({
      defaultPath: "subtitles.srt",
      filters: [{ name: "SRT", extensions: ["srt"] }],
    });
    if (!out) return;

    const content = entries
      .map((clip, index) => [
        String(index + 1),
        `${formatSrtTimestamp(clip.start)} --> ${formatSrtTimestamp(clip.start + clip.duration)}`,
        clip.subtitleText.trim(),
        "",
      ].join("\n"))
      .join("\n");

    await writeFile(out, new TextEncoder().encode(content));
  };

  const startOfflineExport = async (mode: ExportVisualMode = "all") => {
    if (!canvasRef.current || !appRef.current) return;
    if (recState === "rec" || recState === "offline") return;

    if (mode === "subtitle-only" && subtitleClips.length === 0) {
      alert("当前没有可导出的字幕轨内容");
      return;
    }

    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      subtitleClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      0
    );

    if (totalDuration <= 0) {
      alert("??????????????????????");
      return;
    }

    const qualitySettings = {
      low: { fps: 24 },
      medium: { fps: 30 },
      high: { fps: 60 }
    };
    const settings = qualitySettings[recordingQuality];
    const targetFrames = Math.max(1, Math.ceil(totalDuration * settings.fps));

    const blobOnlyAudio = audioClips.filter(c => c.audioUrl && !c.audioPath && /^blob:/i.test(c.audioUrl));
    if (blobOnlyAudio.length > 0) {
      alert('??: ?? blob ?????????????????????????????');
    }

    const hasValidBounds = customRecordingBounds && customRecordingBounds.width > 0 && customRecordingBounds.height > 0;
    const shouldUseModelFrame = hasValidBounds && useModelFrame;
    let exportCanvas: HTMLCanvasElement = canvasRef.current;
    let exportCtx: CanvasRenderingContext2D | null = null;
    if (shouldUseModelFrame) {
      exportCanvas = document.createElement('canvas');
      exportCanvas.width = customRecordingBounds.width;
      exportCanvas.height = customRecordingBounds.height;
      exportCtx = exportCanvas.getContext('2d');
    }

    setRecState('offline');
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();

    const app = appRef.current;
    const wasTickerStarted = app.ticker.started;
    app.ticker.stop();
    let prepInterval: number | null = null;
    let firstFrame = false;
    const prepStart = Date.now();
    let offlineTickerTimeMs = performance.now();
    let lastExportProgressUiTs = 0;
    const previousModelVisibility = getModelVisibilitySnapshot();
    const previousSubtitleOverride = subtitleVisibilityOverrideRef.current;

    if (mode === "subtitle-only") {
      setModelVisibility(false);
      subtitleVisibilityOverrideRef.current = true;
      setBlobDefaultName("subtitles-only.webm");
    } else if (mode === "live2d-only") {
      setModelVisibility(true);
      subtitleVisibilityOverrideRef.current = false;
      setBlobDefaultName("live2d-only.webm");
    } else {
      setModelVisibility(true);
      subtitleVisibilityOverrideRef.current = null;
      setBlobDefaultName("export.webm");
    }
    renderSubtitleClip(findActiveClip(subtitleClips, playheadRef.current) as SubtitleClip | null);

    const updateOfflineExportUi = (timeSec: number, progressPct: number, force: boolean = false) => {
      const now = performance.now();
      if (!force && now - lastExportProgressUiTs < EXPORT_PROGRESS_UI_INTERVAL_MS) {
        return;
      }
      lastExportProgressUiTs = now;
      startTransition(() => {
        setRecordingTime(timeSec);
        setRecordingProgress(progressPct);
      });
    };

    try {
      prepInterval = window.setInterval(() => {
        if (firstFrame) return;
        const elapsed = (Date.now() - prepStart) / 1000;
        const pct = Math.min(0.05, elapsed * 0.2);
        updateOfflineExportUi(elapsed, pct * 100);
      }, 100);
      const result = await runOfflineWebMExport({
        canvas: exportCanvas,
        fps: settings.fps,
        targetFrameCount: targetFrames,
        applyTimelineAtTime: (timeSec) => applyTimelineAtTime(timeSec, true),
        renderFrame: () => {
          offlineTickerTimeMs += 1000 / settings.fps;
          // Application already binds render() to ticker, so one ticker update is enough.
          app.ticker.update(offlineTickerTimeMs);
          if (exportCtx) {
            if (transparentBg) {
              exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
            }
            exportCtx.drawImage(
              canvasRef.current!,
              customRecordingBounds.x,
              customRecordingBounds.y,
              customRecordingBounds.width,
              customRecordingBounds.height,
              0,
              0,
              exportCanvas.width,
              exportCanvas.height
            );
          }
        },
        audioTracks: audioClips.map(c => ({
          id: c.id,
          start: c.start,
          duration: c.duration,
          sourceDuration: c.audioSourceDuration,
          audioUrl: c.audioUrl,
          audioPath: c.audioPath
        })),
        onProgress: ({ frameIndex, totalFrames, timeSec }) => {
          if (!firstFrame) {
            firstFrame = true;
            if (prepInterval) { clearInterval(prepInterval); prepInterval = null; }
          }
          updateOfflineExportUi(
            timeSec,
            (frameIndex / totalFrames) * 100,
            frameIndex >= totalFrames,
          );
        }
      });

      setBlob(result.blob);
      setRecState('done');
      setRecordingTime(0);
      setRecordingProgress(0);
    } catch (error) {
      console.error('??????:', error);
      alert('??????: ' + error);
      setRecState('idle');
      setRecordingTime(0);
      setRecordingProgress(0);
    } finally {
      restoreModelVisibility(previousModelVisibility);
      subtitleVisibilityOverrideRef.current = previousSubtitleOverride;
      renderSubtitleClip(findActiveClip(subtitleClips, playheadRef.current) as SubtitleClip | null);
      if (prepInterval) { clearInterval(prepInterval); prepInterval = null; }
      if (wasTickerStarted) app.ticker.start();
    }
  };
  void startOfflineExport;

  const recordingManager = RecordingManager({
    canvasRef,
    modelRef,
    motionClips,
    exprClips,
    audioClips,
    subtitleClips,
    recordingQuality,
    customRecordingBounds,
    useModelFrame,
    setRecState,
    setRecordingTime,
    setRecordingProgress,
    setBlob,
    startPlayback,
    stopPlayback
  });

  const saveWebM = async () => {
    if (!blob) return;
    const out = await save({
      defaultPath: blobDefaultName,
      filters: [{ name: "WebM", extensions: ["webm"] }],
    });
    if (!out) return;
    await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
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

  // ??WebGAL??????
  const exitWebGALMode = () => {
    try {
      
      // ??WebGAL??????
      if (modelManager) {
        modelManager.cleanupCurrentModel();
      }
      
      
      // ??????
      clearTimeline();
      setExternalModelDisplayName(null);
      
      
    } catch (error) {
      console.warn('?? ??WebGAL????????', error);
    }
  };

  const createImportedAudioElement = (clipId: string, audioUrl: string) => registerAudioElement(clipId, audioUrl);

  const buildImportedAudioName = (speaker?: string, text?: string) => {
    const trimmedText = (text ?? "").trim();
    if (!trimmedText) {
      return speaker ? `${speaker} 语音` : "WebGAL 语音";
    }
    const previewText = trimmedText.length > 18 ? `${trimmedText.slice(0, 18)}...` : trimmedText;
    return speaker ? `${speaker}: ${previewText}` : previewText;
  };

  // ??WebGAL????
  const importWebGALTimeline = async (plan: WebGALImportPlan) => {
    try {
      if (!appRef.current) {
        throw new Error("PIXI 预览器尚未初始化");
      }

      stopPlayback();
      clearTimeline();
      audioManager.initAudioContext();

      const absoluteFigurePath = await resolveFigureAbsolutePath(plan.projectRoot, plan.selectedFigurePath);
      const figureUrl = await buildWebGALExternalAssetUrl(plan.projectRoot, absoluteFigurePath);

      if (modelManager) {
        modelManager.cleanupCurrentModel();
      }

      setModelData(null);
      setMotionLen({});
      setCurrentMotion("");
      setCurrentExpression("default");
      setCustomRecordingBounds({ x: 0, y: 0, width: 0, height: 0 });

      await modelManager.loadAnyModel(appRef.current, figureUrl);

      const importedMotionDurations: MotionLenMap = await loadWebGALMotionDurations(absoluteFigurePath).catch(
        () => ({} as MotionLenMap),
      );
      setMotionLen(importedMotionDurations);

      const nextMotionClips: Clip[] = [];
      const nextExprClips: Clip[] = [];
      const nextAudioClips: Clip[] = [];
      const nextSubtitleClips: SubtitleClip[] = [];
      let timelineCursor = 0;

      for (const group of plan.groups) {
        const baseDuration =
          group.audioDurationSec ??
          (group.motion ? importedMotionDurations[group.motion] : undefined) ??
          (group.motion ? motionLen[group.motion] : undefined) ??
          motionDur ??
          exprDur;
        const duration = plan.extendClipToSpokenSpan
          ? (group.durationHintSec ?? baseDuration)
          : baseDuration;
        const subtitleDuration =
          group.audioDurationSec ??
          baseDuration;

        if (group.motion) {
          nextMotionClips.push({
            id: crypto.randomUUID(),
            name: group.motion,
            start: timelineCursor,
            duration,
          });
        }

        if (group.expression) {
          nextExprClips.push({
            id: crypto.randomUUID(),
            name: group.expression,
            start: timelineCursor,
            duration,
          });
        }

        let linkedAudioClipId: string | undefined;

        if (group.audioAbsolutePath) {
          const clipId = crypto.randomUUID();
          const audioUrl = await buildWebGALExternalAssetUrl(plan.projectRoot, group.audioAbsolutePath);
          createImportedAudioElement(clipId, audioUrl);
          const audioMeta = await analyzeAudioSource(audioUrl, group.audioDurationSec ?? duration);
          nextAudioClips.push({
            id: clipId,
            name: buildImportedAudioName(group.speaker, group.text),
            start: timelineCursor,
            duration,
            audioSourceDuration: audioMeta.audioSourceDuration,
            audioUrl,
            audioPath: group.audioAbsolutePath,
            waveformPeaks: audioMeta.waveformPeaks,
          });
          linkedAudioClipId = clipId;
        }

        if (plan.includeSubtitles && group.text?.trim()) {
          nextSubtitleClips.push(
            createSubtitleClip(group.text.trim(), timelineCursor, subtitleDuration, {
              linkedAudioClipId,
              speakerName: group.speaker,
            }),
          );
        }

        timelineCursor += duration;
      }

      setMotionClips(nextMotionClips);
      setExprClips(nextExprClips);
      setAudioClips(nextAudioClips);
      setSubtitleClips(nextSubtitleClips);
      setExternalModelDisplayName(`${plan.selectedRoleLabel} · ${plan.selectedFigurePath}`);
      playheadRef.current = 0;
      playheadUiLastTsRef.current = null;
      setPlayhead(0);
      resetTimelineTriggerState();
      requestAnimationFrame(() => {
        if (modelRef.current && !Array.isArray(modelRef.current)) {
          syncSingleModelTransformState("center");
        } else {
          refreshCharacterEditor();
        }
      });
    } catch (error) {
      console.error("WebGAL 导入失败", error);
      alert(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };


  // ????????- ?? getBounds() ??????????
  const resetToModelBounds = () => {
    void resetToModelBounds;
    if (!appRef.current) return;

    if (modelRef.current) {
      if (Array.isArray(modelRef.current)) {
        // ???? - ??????getBounds
        if (groupContainerRef.current) {
          const b = groupContainerRef.current.getBounds();
          setCustomRecordingBounds({
            x: Math.max(0, b.x),
            y: Math.max(0, b.y),
            width: Math.max(100, Math.min(b.width, window.innerWidth)),
            height: Math.max(100, Math.min(b.height, window.innerHeight)),
          });
        }
      } else {
        // ????- ?? getBounds() ????????
        const model = modelRef.current;
        try {
          // ???? getBounds ????????
          const b = model.getBounds() || model.getLocalBounds();
          if (b && b.width > 0 && b.height > 0) {
            setCustomRecordingBounds({
              x: Math.max(0, b.x),
              y: Math.max(0, b.y),
              width: Math.max(100, Math.min(b.width, window.innerWidth)),
              height: Math.max(100, Math.min(b.height, window.innerHeight)),
            });
          } else {
            applyBoundsFromModelMetrics(model);
          }
        } catch (e) {
          applyBoundsFromModelMetrics(model);
        }
      }
    }
  };

  useEffect(() => {
    (async () => {
      try {
        // ??Rust????http://127.0.0.1:PORT/model
        const { base_url } = await invoke<{base_url: string, models_dir: string}>("get_model_server_info");
        setAssetBase(base_url);
      } catch (e) {
        console.error("????????????", e);
        setAssetBase(null);
      }
    })();
  }, []);

  // ??????
  const loadModelList = async () => {
    if (!assetBase) return;
    try {
      const res = await fetch(`${assetBase}/models.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = (await res.json()) as string[];
      setModelList(arr);
      // ??????????????
      setSelectedModel(prev => prev ?? arr[0] ?? null);
    } catch (e) {
      console.warn("???? models.json ?????? exe ????model/models.json ??", e);
      setModelList([]);
      setSelectedModel(null);
    }
  };

  useEffect(() => {
    loadModelList();
  }, [assetBase]);

  // ??????
  const refreshModels = async () => {
    try {
      const newModelList = await invoke<string[]>("refresh_model_index");
      setModelList(newModelList);
      if (selectedModel && !newModelList.includes(selectedModel)) {
        setSelectedModel(newModelList[0] ?? null);
      }
    } catch (e) {
      console.error("????????:", e);
    }
  };

  // ????PIXI?????
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const run = async () => {
      if (!containerRef.current) return;
      const host = containerRef.current;
      const initialWidth = Math.max(1, host.clientWidth);
      const initialHeight = Math.max(1, host.clientHeight);

      window.PIXI = PIXI;
      // ??? view?? PixiJS ?????? canvas??????? canvas ?? WebGL ???
      // ?? 0?? MAX_TEXTURE_IMAGE_UNITS????? checkMaxIfStatementsInShader ??
      const app = new PIXI.Application({
        backgroundAlpha: 0,
        preserveDrawingBuffer: true,
        antialias: true,
        width: initialWidth,
        height: initialHeight,
      });
      host.appendChild(app.view);
      (app.view as HTMLCanvasElement).className = "live2d-canvas";
      canvasRef.current = app.view as HTMLCanvasElement;
      appRef.current = app;
      app.stage.sortableChildren = true;

      const subtitleContainer = new PIXI.Container();
      subtitleContainer.visible = false;
      subtitleContainer.zIndex = 10_000;

      const subtitleSpeakerText = new PIXI.Text("", {
        fontFamily: DEFAULT_SUBTITLE_FONT_FAMILY,
        fontSize: Math.round(DEFAULT_SUBTITLE_FONT_SIZE * 0.78),
        fontWeight: "700",
        fill: DEFAULT_SUBTITLE_TEXT_COLOR,
        align: "center",
        stroke: "#081018",
        strokeThickness: 4,
        lineJoin: "round",
      });
      subtitleSpeakerText.anchor.set(0.5, 1);

      const subtitleSpeakerUnderline = new PIXI.Graphics();

      const subtitleText = new PIXI.Text("", {
        fontFamily: DEFAULT_SUBTITLE_FONT_FAMILY,
        fontSize: DEFAULT_SUBTITLE_FONT_SIZE,
        fontWeight: "700",
        fill: DEFAULT_SUBTITLE_TEXT_COLOR,
        align: "center",
        stroke: "#081018",
        strokeThickness: 6,
        lineJoin: "round",
        wordWrap: true,
        wordWrapWidth: Math.max(320, app.screen.width - 140),
      });
      subtitleText.anchor.set(0.5, 1);
      subtitleContainer.addChild(subtitleSpeakerText);
      subtitleContainer.addChild(subtitleSpeakerUnderline);
      subtitleContainer.addChild(subtitleText);
      app.stage.addChild(subtitleContainer);
      subtitleContainerRef.current = subtitleContainer;
      subtitleSpeakerTextRef.current = subtitleSpeakerText;
      subtitleSpeakerUnderlineRef.current = subtitleSpeakerUnderline;
      subtitleTextRef.current = subtitleText;
      syncSubtitleDisplayLayout();

      setRendererBackgroundMode(app.renderer as RendererWithBackground, transparentBg);

      // ????????????
      if (modelUrl) {
        await modelManager.loadAnyModel(app, modelUrl);
        if (disposed) return;
        if (modelRef.current && !Array.isArray(modelRef.current)) {
          syncSingleModelTransformState("center");
        } else {
          refreshCharacterEditor();
        }
      }

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !appRef.current) return;
        const width = Math.max(1, Math.round(entry.contentRect.width));
        const height = Math.max(1, Math.round(entry.contentRect.height));
        appRef.current.renderer.resize(width, height);
        if (modelRef.current && !Array.isArray(modelRef.current)) {
          syncSingleModelAbsoluteTransform();
          syncSingleModelTransformState("preserve");
        } else {
          requestAnimationFrame(() => refreshCharacterEditor());
        }
        syncSubtitleDisplayLayout();
        syncRecordingBoundsFromCurrentModel();
      });
      resizeObserver.observe(host);

      requestAnimationFrame(() => {
        if (disposed) return;
        if (modelRef.current && !Array.isArray(modelRef.current)) {
          syncSingleModelTransformState("center");
        } else {
          refreshCharacterEditor();
        }
        syncSubtitleDisplayLayout();
        syncRecordingBoundsFromCurrentModel();
      });
    };

    run();

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver?.disconnect();
      canvasRef.current = null;
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        appRef.current = null;
      }
      subtitleContainerRef.current = null;
      subtitleSpeakerTextRef.current = null;
      subtitleSpeakerUnderlineRef.current = null;
      subtitleTextRef.current = null;
      modelRef.current = null;
      groupContainerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ???????

  // ??????????renderer
  useEffect(() => {
    if (appRef.current) {
      setRendererBackgroundMode(appRef.current.renderer as RendererWithBackground, transparentBg);
    }
  }, [transparentBg]);

  useEffect(() => {
    if (isPlaying) return;
    renderSubtitleClip(findActiveClip(subtitleClips, playhead) as SubtitleClip | null);
  }, [subtitleClips, playhead, isPlaying, showSubtitles, showSubtitleSpeaker, subtitleSpeakerAlign]);

  // ??????????
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ????????????????
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.code === 'Space') {
        e.preventDefault(); // ??????
        if (isPlaying) {
          stopPlayback();
        } else {
          startPlayback();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  useEffect(() => {
    characterTransformRef.current = characterTransform;
  }, [characterTransform]);

  useEffect(() => {
    refreshCharacterEditor();
  }, [selectedModel, selectedCharacterId, isDragging]);

  useEffect(() => {
    const handleWheelTransform = (event: WheelEvent) => {
      if (!enableDragging || !isDraggingRef.current) return;
      if (!event.ctrlKey && !event.altKey) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        updateUniformScale(event.deltaY > 0 ? 0.96 : 1.04);
        return;
      }

      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const current = characterTransformRef.current;
        updateSelectedCharacterTransform({ rotation: current.rotation + (event.deltaY > 0 ? 4 : -4) });
      }
    };

    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheelListenerOptions: AddEventListenerOptions = { passive: false, capture: true };

    canvas.addEventListener("wheel", handleWheelTransform, wheelListenerOptions);
    return () => {
      canvas.removeEventListener("wheel", handleWheelTransform, wheelListenerOptions);
    };
  }, [enableDragging, modelUrl]);


  // ?????????????????
  useEffect(() => {
    (async () => {
      if (!appRef.current) return;
      if (!modelUrl) {
        setCharacterOptions([]);
        setSelectedCharacterId("main");
        setIsCharacterVisible(true);
        resetSingleCharacterTransformState();
        return;
      }

      // ??????????
      stopPlayback();
      clearTimeline();

      // ????????
      modelManager.cleanupCurrentModel();

      await modelManager.loadAnyModel(appRef.current, modelUrl);
      requestAnimationFrame(() => {
        if (modelRef.current && !Array.isArray(modelRef.current)) {
          syncSingleModelTransformState("center");
        } else {
          refreshCharacterEditor();
        }
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // ?? .mtn???????????????? & ?? URL ????????
  useEffect(() => {
    if (!modelData || (!modelUrl && !motionBaseRef.current)) return;
    let aborted = false;

    const baseFromUrl = (u: string) => u.slice(0, u.lastIndexOf("/") + 1);
    const base = motionBaseRef.current ?? (modelUrl ? baseFromUrl(modelUrl) : "");

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
          if (!first || !/\.(?:mtn|motion3\.json)$/i.test(first)) return [group, undefined] as const;
          try {
            const txt = await (await fetch(resolveUrl(first))).text();
            return [group, parseMotionDurationSeconds(first, txt)] as const;
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

  const panelProps = {
    onToggleWebGALMode: () => setShowWebGALMode(true),
    modelList,
    selectedModel,
    onSelectModel: (rel: string | null) => {
      setExternalModelDisplayName(null);
      setSelectedModel(rel || null);
    },
    onRefreshModels: refreshModels,
    modelData,
    motionLen,
    currentMotion,
    currentExpression,
    motionDur,
    exprDur,
    setMotionDur,
    setExprDur,
    chooseMotion: (name: string) => {
      playMotion(name);
      setCurrentMotion(name);
    },
    chooseExpression: (name: string) => {
      applyExpression(name);
      setCurrentExpression(name);
    },
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
    onAddSubtitleClip: addSubtitleClip,
    onUpdateSubtitleClip: updateSubtitleClip,
    onRemoveSubtitleClip: removeSubtitleClip,
    characterOptions,
    selectedCharacterId,
    onSelectCharacter: setSelectedCharacterId,
    isCharacterVisible,
    onToggleCharacterVisibility: setSelectedCharacterVisibility,
    characterTransform,
    characterTransformMode,
    onUpdateCharacterTransform: updateSelectedCharacterTransform,
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
    onStartRecording: startRecording,
    onStopRecording: stopRecording,
    onSaveWebM: saveWebM,
    onConvertToMov: toMov,
    onExportSubtitlesSrt: exportSubtitlesSrt,
    onTakeScreenshot: () => recordingManager.takeScreenshot(),
    onTakePartsScreenshots: () => recordingManager.takePartsScreenshots(),
    isVp9AlphaSupported,
  };

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-topbar-brand">
          <div className="editor-topbar-kicker">Live2D Movie Maker</div>
          <h1>桌面工作区</h1>
        </div>

        <div className="editor-topbar-main">
          <div className="topbar-select-group">
            <label className="topbar-label" htmlFor="topbar-model-select">
              模型
            </label>
            <select
              id="topbar-model-select"
              className="input input--topbar"
              value={selectedModel ?? ""}
              onChange={(event) => setSelectedModel(event.target.value || null)}
            >
              {modelList.length === 0 ? <option value="">未发现模型</option> : null}
              {modelList.map((rel) => (
                <option key={rel} value={rel}>
                  {rel}
                </option>
              ))}
            </select>
          </div>

          <div className="topbar-button-group">
            <button className="btn btn--quiet" onClick={refreshModels}>
              刷新模型
            </button>
            <button className={`btn ${isPlaying ? "btn--accent" : "btn--primary"}`} onClick={isPlaying ? stopPlayback : startPlayback} disabled={!timelineLength && !isPlaying}>
              {isPlaying ? "停止播放" : "开始播放"}
            </button>
            <button
              className={`btn ${recState === "rec" ? "btn--danger" : "btn--accent"}`}
              onClick={recState === "rec" ? stopRecording : startRecording}
              disabled={recState === "offline"}
            >
              {recState === "rec" ? "停止录制" : "录制 WebM"}
            </button>
            <button className="btn btn--quiet" onClick={addAudioClip}>
              导入音频
            </button>
            <button className="btn btn--quiet" onClick={() => setShowWebGALMode(true)}>
              WebGAL 工具
            </button>
          </div>
        </div>

      </header>

      <div className="editor-workspace">
        <aside className="workspace-dock workspace-dock--left">
          <ControlPanel
            {...panelProps}
            mode="resources"
          />
        </aside>

        <main className="editor-main">
          <section className="monitor-shell">
            <div className="monitor-stage">
              <div
                ref={containerRef}
                className={`monitor-canvas-host ${transparentBg ? "is-transparent" : "is-solid"}`}
                data-transparent={transparentBg}
              />

              {!selectedModel ? (
                <div className="monitor-empty">
                  <strong>先加载一个 Live2D 模型</strong>
                  <span>在顶部或左侧资源区选择模型，然后开始预览、编排和导出。</span>
                </div>
              ) : null}

              <div className="monitor-overlay monitor-overlay--top">
                <span>预览器</span>
                <span>{currentMotion ? `动作 ${currentMotion}` : "等待动作"}</span>
                <span>{currentExpression ? `表情 ${currentExpression}` : "默认表情"}</span>
              </div>

              <div className="monitor-overlay monitor-overlay--bottom">
                <span>FPS {currentFps.toFixed(1)}</span>
                <span>播放头 {playhead.toFixed(2)} 秒</span>
                <span>{enableDragging ? "允许拖拽" : "拖拽关闭"}</span>
              </div>
            </div>
          </section>
        </main>

        <aside className="workspace-dock workspace-dock--right">
          <ControlPanel
            {...panelProps}
            mode="inspector"
            activeInspectorTab={activeInspectorTab}
            onChangeInspectorTab={setActiveInspectorTab}
          />
        </aside>
      </div>

      <section className="timeline-shell">
        <Timeline
          motionClips={motionClips}
          exprClips={exprClips}
          audioClips={audioClips}
          subtitleClips={subtitleClips}
          playheadSec={playhead}
          playheadSourceRef={playheadRef}
          onChangeClip={changeClip}
          onRemoveClip={(track, id) => {
            if (track === "motion") setMotionClips(prev => prev.filter(c => c.id !== id));
            else if (track === "expr") setExprClips(prev => prev.filter(c => c.id !== id));
            else if (track === "audio") {
              setAudioClips(prev => prev.filter(c => c.id !== id));
              setSubtitleClips(prev => prev.map((clip) => (
                clip.linkedAudioClipId === id
                  ? { ...clip, linkedAudioClipId: undefined }
                  : clip
              )));
              const audio = audioManager.audioRefs.current.get(id);
              if (audio) {
                audio.pause();
                audio.src = "";
                audioManager.audioRefs.current.delete(id);
              }
              const analyzerData = audioManager.audioAnalyzersRef.current.get(id);
              if (analyzerData) {
                try {
                  analyzerData.source.disconnect();
                  analyzerData.analyzer.disconnect();
                } catch {}
                audioManager.audioAnalyzersRef.current.delete(id);
              }
            } else if (track === "subtitle") {
              removeSubtitleClip(id);
            }
          }}
          onSetPlayhead={setPlayheadSec}
          onStartPlayback={startPlayback}
          onStopPlayback={stopPlayback}
          isPlaying={isPlaying}
        />
      </section>

      {showWebGALMode && (
        <div className="editor-overlay">
          <WebGALMode
            onClose={() => setShowWebGALMode(false)}
            onImportTimeline={importWebGALTimeline}
            onExitWebGALMode={exitWebGALMode}
            defaultMotionDuration={motionDur}
            defaultExpressionDuration={exprDur}
          />
        </div>
      )}
    </div>
  );
}
