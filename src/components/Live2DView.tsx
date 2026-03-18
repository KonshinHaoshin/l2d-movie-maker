// src/components/Live2DView.tsx
import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";
import { parseMtn } from "../utils/parseMtn";
import "./Live2DView.css";
import ControlPanel from "./panel/ControlPanel";
import ExportToolbar from "./ExportToolbar";
import ModelManager from "./ModelManager";
import type { JsonlLive2DModel } from "./ModelManager";
import AudioManager from "./AudioManager";
import RecordingManager from "./RecordingManager";
import WebGALMode from "./WebGALMode";
// import { convertFileSrc } from "@tauri-apps/api/core";
// import { normalizePath } from "../utils/fs";
import { WebGALParser } from "../utils/webgalParser";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { appCacheDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { isVp9AlphaSupported } from "../utils/recorder";
import { runOfflineWebMExport } from "../utils/offlineExporter";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type MotionLenMap = Record<string, number>;
type CharacterOption = { id: string; label: string };
type CharacterTransform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };


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
  const modelUrl = selectedModel && assetBase ? `${assetBase}/${selectedModel}` : null; // ???URL

  // ????????? ???//
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<string>("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [showControls, setShowControls] = useState<boolean>(true);
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

  
  // ???WebGAL?? ???//
  const [showWebGALMode, setShowWebGALMode] = useState(false);

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
    setIsDragging
  });

  const audioManager = AudioManager({
    modelRef,
    audioClips,
    setCurrentAudioLevel
  });

  const getTransformTarget = (): (PIXI.Container | Live2DModel) | null => {
    const cur = modelRef.current;
    if (!cur) return null;
    if (Array.isArray(cur)) return groupContainerRef.current ?? null;
    return cur as Live2DModel;
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
      const b = (modelRef.current as any).getBounds?.();
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
      setCharacterTransform({
        x: Number((target as any).position?.x ?? 0),
        y: Number((target as any).position?.y ?? 0),
        scaleX: Number((target as any).scale?.x ?? 1),
        scaleY: Number((target as any).scale?.y ?? 1),
        rotation: Number(((target as any).rotation ?? 0) * 180 / Math.PI),
      });
      return;
    }

    setCharacterOptions([{ id: "main", label: "Main Model" }]);
    if (selectedCharacterId !== "main") setSelectedCharacterId("main");
    setCharacterTransform({
      x: Number((cur as any).position?.x ?? 0),
      y: Number((cur as any).position?.y ?? 0),
      scaleX: Number((cur as any).scale?.x ?? 1),
      scaleY: Number((cur as any).scale?.y ?? 1),
      rotation: Number(((cur as any).rotation ?? 0) * 180 / Math.PI),
    });
  };

  const updateSelectedCharacterTransform = (patch: Partial<CharacterTransform>) => {
    const target = getTransformTarget();
    if (!target) return;
    const next: CharacterTransform = { ...characterTransform, ...patch };
    (target as any).position?.set?.(next.x, next.y);
    if ((target as any).scale?.set) (target as any).scale.set(Math.max(0.01, next.scaleX), Math.max(0.01, next.scaleY));
    (target as any).rotation = (next.rotation * Math.PI) / 180;
    setCharacterTransform(next);
    syncRecordingBoundsFromCurrentModel();
  };


  // ????????
  const nextEnd = (clips: Clip[]) => clips.reduce((t, c) => Math.max(t, c.start + c.duration), 0);

  const clearTimeline = () => { 
    setMotionClips([]); 
    setExprClips([]); 
    setAudioClips([]); 
    setPlayhead(0); 
    
    // ??????
    audioManager.cleanupAudio();
  };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "expr") setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "audio") setAudioClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const setPlayheadSec = (sec: number) => setPlayhead(sec);

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
    // ??????????????????firedRef????
    for (const c of motionClips) {
      if (t >= c.start && t < c.start + c.duration) {
        // ??????????????
        playMotion(c.name);
      }
    }
    for (const c of exprClips) {
      if (t >= c.start && t < c.start + c.duration) {
        // ??????????????
        applyExpression(c.name);
      }
    }

    if (!offline) {
      // ??????????
      audioManager.playAudioAtTime(t);
      audioManager.processAudioAnimation(t);
    }
  };

  const tick = (ts: number) => {
    if (startTsRef.current == null) startTsRef.current = ts;
    const t = (ts - startTsRef.current) / 1000;
    setPlayhead(t);

    applyTimelineAtTime(t);

    if (t >= timelineLength) {
      stopPlayback();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startPlayback = () => {
    if (isPlaying || timelineLength <= 0) return;
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

    try {
      prepInterval = window.setInterval(() => {
        if (firstFrame) return;
        const elapsed = (Date.now() - prepStart) / 1000;
        const pct = Math.min(0.05, elapsed * 0.2);
        setRecordingProgress(pct * 100);
        setRecordingTime(elapsed);
      }, 100);
      const result = await runOfflineWebMExport({
        canvas: exportCanvas,
        fps: settings.fps,
        targetFrameCount: targetFrames,
        applyTimelineAtTime: (timeSec) => applyTimelineAtTime(timeSec, true),
        renderFrame: () => {
          app.ticker.update(1000 / settings.fps);
          app.renderer.render(app.stage);
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
          setRecordingTime(timeSec);
          setRecordingProgress((frameIndex / totalFrames) * 100);
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



  // ?WebGAL????????????????
  const cleanupLocalModeModelsAfterWebGAL = () => {
    try {
      
      // ?????????????????????WebGAL??
      // ???????????????
      setModelData(null);
      setCustomRecordingBounds({ x: 0, y: 0, width: 0, height: 0 });
      
      
    } catch (error) {
      console.warn('?? ?????????????:', error);
    }
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
      
      
    } catch (error) {
      console.warn('?? ??WebGAL????????', error);
    }
  };

    // ??WebGAL????
  const importWebGALTimeline = async (commands: any[]) => {
    try {
      
      
      const parser = new WebGALParser();

    let currentTime = 0;

    for (const command of commands) {
      if (command.type === 'changeFigure') {
        const figure = command.data;

        if (figure.path) {
          try {
            // ??????figure??????????
            const resolved = parser.resolveFigurePath(figure.path);

            // ???????Live2D??
            try {
              // ?????loadAnyModel??????
              await modelManager.loadAnyModel(appRef.current!, resolved);
              
              // WebGAL????????????????????
              // ????????????????????WebGAL??
              cleanupLocalModeModelsAfterWebGAL();
              
            } catch (loadError) {
              console.error('????????:', {
                originalPath: figure.path,
                resolvedPath: resolved,
                error: loadError instanceof Error ? loadError.message : String(loadError)
              });
            }
          } catch (error) {
            console.error('??????????:', {
              originalPath: figure.path,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        // ???? motion/expression ????
        if (figure.motion || figure.expression) {
          const startTime = currentTime;
          const duration = 2.0;

          if (figure.motion) {
            setMotionClips(prev => [...prev, {
              id: crypto.randomUUID(),
              name: figure.motion,
              start: startTime,
              duration
            }]);
          }

          if (figure.expression) {
            setExprClips(prev => [...prev, {
              id: crypto.randomUUID(),
              name: figure.expression,
              start: startTime,
              duration
            }]);
          }

          currentTime += duration;
        }
      } else if (command.type === 'dialogue') {
        const dialogue = command.data;

        // ??????
        const audioAbs = parser.resolveAudioPath(dialogue.audioPath);

        if (audioAbs) {
          try {
            const audio = new Audio(audioAbs);
            await new Promise((resolve) => {
              audio.onloadedmetadata = resolve;
              audio.load();
            });

            const duration = audio.duration || 3.0;

            const audioClip = {
              id: crypto.randomUUID(),
              name: `${dialogue.speaker ?? ''}: ${dialogue.text.substring(0, 20)}...`,
              start: currentTime,
              duration,
              audioUrl: audioAbs,
              audioPath: audioAbs
            };

            setAudioClips(prev => [...prev, audioClip]);

            // ??????
            audioManager.audioRefs.current.set(audioClip.id, audio);
            if (audioManager.audioContextRef.current) {
              try {
                const source = audioManager.audioContextRef.current.createMediaElementSource(audio);
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

            currentTime += duration;
          } catch (error) {
            console.warn('??????:', error);
            currentTime += 3.0;
          }
        } else {
          currentTime += 2.0; // ??????????
        }
      }
    }

  } catch (error) {
    console.error('??WebGAL??????', error);
    alert('????: ' + error);
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
          const b = (model as any).getBounds?.() || model.getLocalBounds?.();
          if (b && b.width > 0 && b.height > 0) {
            setCustomRecordingBounds({
              x: Math.max(0, b.x),
              y: Math.max(0, b.y),
              width: Math.max(100, Math.min(b.width, window.innerWidth)),
              height: Math.max(100, Math.min(b.height, window.innerHeight)),
            });
          } else {
            // ??????scale ??position ??
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
          }
        } catch (e) {
          // ????
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

      (window as any).PIXI = PIXI;
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

      if (transparentBg) {
        (app.renderer as any).backgroundColor = 0x00000000;
        (app.renderer as any).backgroundAlpha = 0;
        (app.renderer as any).clearBeforeRender = true;
      } else {
        (app.renderer as any).backgroundColor = 0xf0f0f0;
        (app.renderer as any).backgroundAlpha = 1;
        (app.renderer as any).clearBeforeRender = false;
      }

      // ????????????
      if (modelUrl) {
        await modelManager.loadAnyModel(app, modelUrl);
        if (disposed) return;
      }

      // ????
      if (transparentBg) {
        const gl = (app.renderer as any).gl;
        if (gl) gl.clearColor(0, 0, 0, 0);
      }

      resizeHandler = () => {
        if (!appRef.current) return;
        if (isCompositeRef.current && groupContainerRef.current) {
          groupContainerRef.current.position.set(appRef.current.screen.width / 2, appRef.current.screen.height / 2);
        } else if (modelRef.current && !Array.isArray(modelRef.current)) {
          (modelRef.current as any).position.set(appRef.current.screen.width / 2, appRef.current.screen.height / 2);
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
      if (transparentBg) {
        (appRef.current.renderer as any).backgroundColor = 0x00000000;
        (appRef.current.renderer as any).backgroundAlpha = 0;
        (appRef.current.renderer as any).clearBeforeRender = true;
      } else {
        (appRef.current.renderer as any).backgroundColor = 0xf0f0f0;
        (appRef.current.renderer as any).backgroundAlpha = 1;
        (appRef.current.renderer as any).clearBeforeRender = false;
      }
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
    refreshCharacterEditor();
  }, [selectedModel, selectedCharacterId, isDragging]);


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

  return (
    <div className="live2d-container">
      <div ref={containerRef} data-transparent="true" />

      {/* WebGAL?? */}
               {showWebGALMode && (
          <WebGALMode
            onClose={() => setShowWebGALMode(false)}
            onImportTimeline={importWebGALTimeline}
            onExitWebGALMode={exitWebGALMode}
          />
        )}

      {/* ???? */}
      {showControls && (
                 <ControlPanel
           onClose={() => setShowControls(false)}
           onToggleWebGALMode={() => setShowWebGALMode(!showWebGALMode)}

          // ????
          modelList={modelList}
          selectedModel={selectedModel}
          onSelectModel={(rel) => setSelectedModel(rel || null)}
          onRefreshModels={refreshModels}

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
          addAudioClip={addAudioClip}
          characterOptions={characterOptions}
          selectedCharacterId={selectedCharacterId}
          onSelectCharacter={setSelectedCharacterId}
          characterTransform={characterTransform}
          onUpdateCharacterTransform={updateSelectedCharacterTransform}

          enableDragging={enableDragging}
          setEnableDragging={setEnableDragging}
          isDragging={isDragging}
          timelineLength={Math.max(
            motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
            exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
            audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0)
          )}
          playhead={playhead}
          isPlaying={isPlaying}
          startPlayback={startPlayback}
          stopPlayback={stopPlayback}
          clearTimeline={clearTimeline}
          onChangeClip={changeClip}
          onSetPlayhead={setPlayheadSec}
          currentAudioLevel={currentAudioLevel}
          currentFps={currentFps}
        />
      )}

      {/* ????*/}
      <Timeline
        motionClips={motionClips}
        exprClips={exprClips}
        audioClips={audioClips}
        playheadSec={playhead}
        onChangeClip={changeClip}
        onRemoveClip={(track, id) => {
          if (track === "motion") setMotionClips(prev => prev.filter(c => c.id !== id));
          else if (track === "expr") setExprClips(prev => prev.filter(c => c.id !== id));
          else if (track === "audio") {
            setAudioClips(prev => prev.filter(c => c.id !== id));
            // ??????
            const audio = audioManager.audioRefs.current.get(id);
            if (audio) {
              audio.pause();
              audio.src = '';
              audioManager.audioRefs.current.delete(id);
            }
            // ????????
            const analyzerData = audioManager.audioAnalyzersRef.current.get(id);
            if (analyzerData) {
              try {
                analyzerData.source.disconnect();
                analyzerData.analyzer.disconnect();
              } catch { /* empty */ }
              audioManager.audioAnalyzersRef.current.delete(id);
            }
          }
        }}
        onSetPlayhead={setPlayheadSec}
        onStartPlayback={startPlayback}
        onStopPlayback={stopPlayback}
        isPlaying={isPlaying}
      />

      {/* ?????????? */}
      <ExportToolbar
        recordingQuality={recordingQuality}
        setRecordingQuality={setRecordingQuality}
        transparentBg={transparentBg}
        setTransparentBg={setTransparentBg}
        recState={recState}
        recordingTime={recordingTime}
        recordingProgress={recordingProgress}
        blob={blob}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        onSaveWebM={saveWebM}
        onConvertToMov={toMov}
        onStartOfflineExport={startOfflineExport}
        onTakeScreenshot={() => recordingManager.takeScreenshot()}
        onTakePartsScreenshots={() => recordingManager.takePartsScreenshots()}
        isVp9AlphaSupported={isVp9AlphaSupported}
      />

      {!showControls && (
        <button className="l2d-toggle" onClick={() => setShowControls(true)}>
          ??????????
        </button>
      )}
    </div>
  );
}















