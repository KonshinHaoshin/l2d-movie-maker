// src/components/Live2DView.tsx
import { startTransition, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";
import { parseMtn } from "../utils/parseMtn";
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
type TransformTarget = Pick<PIXI.Container, "position" | "scale" | "rotation" | "getBounds">;
type BoundsTarget = Pick<Live2DModel, "width" | "height" | "position" | "scale" | "getBounds" | "getLocalBounds">;
type RendererWithBackground = PIXI.Renderer & {
  backgroundColor: number;
  backgroundAlpha: number;
  clearBeforeRender: boolean;
  gl?: WebGLRenderingContext | WebGL2RenderingContext | null;
};
const PLAYHEAD_UI_INTERVAL_MS = 1000 / 30;
const EXPORT_PROGRESS_UI_INTERVAL_MS = 100;

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

  // ????jsonl?????????MTN ??????
  const groupContainerRef = useRef<PIXI.Container | null>(null);
  const isCompositeRef = useRef<boolean>(false);
  const motionBaseRef = useRef<string | null>(null); // ???? mtn ????

  // ??????????
  const [assetBase, setAssetBase] = useState<string | null>(null);

  // ??????? ???//
  const [modelList, setModelList] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // ?? "anon/model.json" ??"xxx/model.jsonl"
  const [externalModelDisplayName, setExternalModelDisplayName] = useState<string | null>(null);
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
  
  // ????????????????//
  const [customRecordingBounds, setCustomRecordingBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
   
  // ????????? ???//
  const [recordingQuality, setRecordingQuality] = useState<"low" | "medium" | "high">("medium");
  
  // ????????????????? ???//
  const useModelFrame = false;
  const [characterOptions, setCharacterOptions] = useState<CharacterOption[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("main");
  const [characterTransform, setCharacterTransform] = useState<CharacterTransform>({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  const characterTransformRef = useRef<CharacterTransform>({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  const isDraggingRef = useRef(false);

  const handleDraggingChange = (dragging: boolean) => {
    isDraggingRef.current = dragging;
    setIsDragging(dragging);
  };

  const syncCharacterTransformState = (transform: CharacterTransform) => {
    characterTransformRef.current = transform;
    setCharacterTransform(transform);
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
    onTransformChange: syncCharacterTransformState,
  });

  const audioManager = AudioManager({
    modelRef,
    audioClips,
    setCurrentAudioLevel
  });

  const readTransformFromTarget = (target: TransformTarget): CharacterTransform => ({
    x: Number(target.position.x),
    y: Number(target.position.y),
    scaleX: Number(target.scale.x),
    scaleY: Number(target.scale.y),
    rotation: Number(target.rotation * 180 / Math.PI),
  });

  const getTransformTarget = (): TransformTarget | null => {
    const cur = modelRef.current;
    if (!cur) return null;
    if (Array.isArray(cur)) return groupContainerRef.current ?? null;
    return cur;
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

  const refreshCharacterEditor = () => {
    const cur = modelRef.current;
    if (!cur) {
      setCharacterOptions([]);
      setSelectedCharacterId("main");
      setCharacterTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
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
      const target = groupContainerRef.current;
      if (!target) return;
      setCharacterTransform(readTransformFromTarget(target));
      return;
    }

    setCharacterOptions([{ id: "main", label: "主角色" }]);
    if (selectedCharacterId !== "main") setSelectedCharacterId("main");
    setCharacterTransform(readTransformFromTarget(cur));
  };

  const updateSelectedCharacterTransform = (patch: Partial<CharacterTransform>) => {
    const target = getTransformTarget();
    if (!target) return;
    const next: CharacterTransform = { ...characterTransformRef.current, ...patch };
    target.position.set(next.x, next.y);
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

  const resetTimelineTriggerState = () => {
    activeMotionClipIdRef.current = null;
    activeExprClipIdRef.current = null;
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

  const clearTimeline = () => { 
    setMotionClips([]); 
    setExprClips([]); 
    setAudioClips([]); 
    playheadRef.current = 0;
    playheadUiLastTsRef.current = null;
    setPlayhead(0); 
    resetTimelineTriggerState();
    
    // ??????
    audioManager.cleanupAudio();
  };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "expr") setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "audio") setAudioClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
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
        audioUrl,
        audioPath
      };

      const audioElement = new Audio(audioUrl);
      audioElement.crossOrigin = "anonymous";
      audioElement.preload = 'auto';
      audioElement.volume = 0.8;
      audioManager.audioRefs.current.set(audioClip.id, audioElement);

      if (audioManager.audioContextRef.current) {
        try {
          const source = audioManager.audioContextRef.current.createMediaElementSource(audioElement);
          const analyzer = audioManager.audioContextRef.current.createAnalyser();
          analyzer.fftSize = 256;
          analyzer.smoothingTimeConstant = 0.8;

          source.connect(analyzer);
          analyzer.connect(audioManager.audioContextRef.current.destination);

          audioManager.audioAnalyzersRef.current.set(audioClip.id, { source, analyzer });
        } catch (error) {
          console.warn('??????????', error);
        }
      }

      setAudioClips(prev => [...prev, audioClip]);
    } catch (error) {
      console.error('??????:', error);
      alert('??????: ' + error);
    }
  };

  const timelineLength = Math.max(nextEnd(motionClips), nextEnd(exprClips), nextEnd(audioClips));

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

    if (!offline) {
      // ??????????
      audioManager.playAudioAtTime(t);
      audioManager.processAudioAnimation(t);
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
    recordingManager.start();
  };

  const stopRecording = () => {
    recordingManager.stop();
  };

  const startOfflineExport = async () => {
    if (!canvasRef.current || !appRef.current) return;
    if (recState === "rec" || recState === "offline") return;

    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
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
      if (prepInterval) { clearInterval(prepInterval); prepInterval = null; }
      if (wasTickerStarted) app.ticker.start();
    }
  };

  const recordingManager = RecordingManager({
    canvasRef,
    modelRef,
    motionClips,
    exprClips,
    audioClips,
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
    if (!recordingManager.recRef.current || !blob) return;
    await recordingManager.recRef.current.saveWebM(blob);
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

  const createImportedAudioElement = (clipId: string, audioUrl: string) => {
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
        console.warn("WebGAL 音频分析器初始化失败", error);
      }
    }

    return audioElement;
  };

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
      let timelineCursor = 0;

      for (const group of plan.groups) {
        const duration =
          group.audioDurationSec ??
          (group.motion ? importedMotionDurations[group.motion] : undefined) ??
          (group.motion ? motionLen[group.motion] : undefined) ??
          motionDur ??
          exprDur;

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

        if (group.audioAbsolutePath) {
          const clipId = crypto.randomUUID();
          const audioUrl = await buildWebGALExternalAssetUrl(plan.projectRoot, group.audioAbsolutePath);
          createImportedAudioElement(clipId, audioUrl);
          nextAudioClips.push({
            id: clipId,
            name: buildImportedAudioName(group.speaker, group.text),
            start: timelineCursor,
            duration,
            audioUrl,
            audioPath: group.audioAbsolutePath,
          });
        }

        timelineCursor += duration;
      }

      setMotionClips(nextMotionClips);
      setExprClips(nextExprClips);
      setAudioClips(nextAudioClips);
      setExternalModelDisplayName(`${plan.selectedRoleLabel} · ${plan.selectedFigurePath}`);
      playheadRef.current = 0;
      playheadUiLastTsRef.current = null;
      setPlayhead(0);
      resetTimelineTriggerState();
      requestAnimationFrame(() => refreshCharacterEditor());
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
    let resizeHandler: (() => void) | null = null;

    const run = async () => {
      if (!containerRef.current) return;

      window.PIXI = PIXI;
      // ??? view?? PixiJS ?????? canvas??????? canvas ?? WebGL ???
      // ?? 0?? MAX_TEXTURE_IMAGE_UNITS????? checkMaxIfStatementsInShader ??
      const app = new PIXI.Application({
        backgroundAlpha: 0,
        resizeTo: window,
        preserveDrawingBuffer: true,
        antialias: true,
      });
      containerRef.current.appendChild(app.view);
      (app.view as HTMLCanvasElement).className = "live2d-canvas";
      canvasRef.current = app.view as HTMLCanvasElement;
      appRef.current = app;

      setRendererBackgroundMode(app.renderer as RendererWithBackground, transparentBg);

      // ????????????
      if (modelUrl) {
        await modelManager.loadAnyModel(app, modelUrl);
        if (disposed) return;
      }

      resizeHandler = () => {
        if (!appRef.current) return;
        if (isCompositeRef.current && groupContainerRef.current) {
          groupContainerRef.current.position.set(appRef.current.screen.width / 2, appRef.current.screen.height / 2);
        } else if (modelRef.current && !Array.isArray(modelRef.current)) {
          modelRef.current.position.set(appRef.current.screen.width / 2, appRef.current.screen.height / 2);
        }
      };
      window.addEventListener("resize", resizeHandler);
    };

    run();

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      canvasRef.current = null;
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        appRef.current = null;
      }
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
        setCharacterTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
        return;
      }

      // ??????????
      stopPlayback();
      clearTimeline();

      // ????????
      modelManager.cleanupCurrentModel();

      await modelManager.loadAnyModel(appRef.current, modelUrl);
      requestAnimationFrame(() => refreshCharacterEditor());
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

  const selectedModelParts = selectedModel ? selectedModel.split("/") : [];
  const selectedModelDisplayName = externalModelDisplayName ?? (
    selectedModel
      ? (selectedModelParts[selectedModelParts.length - 2] ?? selectedModel)
      : "未加载模型"
  );
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
    characterOptions,
    selectedCharacterId,
    onSelectCharacter: setSelectedCharacterId,
    characterTransform,
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
    onStartOfflineExport: startOfflineExport,
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
            <div className="monitor-header">
              <div className="monitor-heading">
                <div className="monitor-kicker">Program Monitor</div>
                <h2>{selectedModelDisplayName}</h2>
              </div>
              <div className="monitor-meta">
                <span>{transparentBg ? "透明背景" : "实色背景"}</span>
                <span>时间线 {timelineLength.toFixed(2)} 秒</span>
              </div>
            </div>

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
          playheadSec={playhead}
          playheadSourceRef={playheadRef}
          onChangeClip={changeClip}
          onRemoveClip={(track, id) => {
            if (track === "motion") setMotionClips(prev => prev.filter(c => c.id !== id));
            else if (track === "expr") setExprClips(prev => prev.filter(c => c.id !== id));
            else if (track === "audio") {
              setAudioClips(prev => prev.filter(c => c.id !== id));
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
