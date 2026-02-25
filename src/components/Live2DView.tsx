// src/components/Live2DView.tsx
import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";
import { parseMtn } from "../utils/parseMtn";
import "./Live2DView.css";
import ControlPanel from "./panel/ControlPanel";
import RecordingBounds from "./RecordingBounds";
import ExportToolbar from "./ExportToolbar";
import ModelManager from "./ModelManager";
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

export default function Live2DView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 允许保存单模型或复合的子模型数组
  const modelRef = useRef<Live2DModel | Live2DModel[] | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);

  // 复合�?jsonl）时的容器与标记、MTN 解析基准目录
  const groupContainerRef = useRef<PIXI.Container | null>(null);
  const isCompositeRef = useRef<boolean>(false);
  const motionBaseRef = useRef<string | null>(null); // 用于解析 mtn 相对路径

  // 获取模型服务器信�?
  const [assetBase, setAssetBase] = useState<string | null>(null);

  // —�?模型选择 —�?//
  const [modelList, setModelList] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // 例如 "anon/model.json" �?"xxx/model.jsonl"
  const modelUrl = selectedModel && assetBase ? `${assetBase}/${selectedModel}` : null; // 最�?URL

  // —�?当前模型数据 —�?//
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<string>("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [showControls, setShowControls] = useState<boolean>(true);
  const [enableDragging, setEnableDragging] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // —�?时间�?—�?//
  const [motionClips, setMotionClips] = useState<Clip[]>([]);
  const [exprClips, setExprClips] = useState<Clip[]>([]);
  const [audioClips, setAudioClips] = useState<Clip[]>([]); // 新增音频�?
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioLevel, setCurrentAudioLevel] = useState(0); // 当前音频电平

  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  // 默认时长（兜底）
  const [motionDur, setMotionDur] = useState(2);
  const [exprDur, setExprDur] = useState(0.8);

  // 每组 motion 的真实时�?
  const [motionLen, setMotionLen] = useState<MotionLenMap>({});

  // —�?录制 —�?//
  const [recState, setRecState] = useState<"idle" | "rec" | "done" | "offline">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [transparentBg, setTransparentBg] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  
  // —�?用户自定义录制范�?—�?//
  const [customRecordingBounds, setCustomRecordingBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [showRecordingBounds, setShowRecordingBounds] = useState(false);
   
  // —�?录制质量设置 —�?//
  const [recordingQuality, setRecordingQuality] = useState<"low" | "medium" | "high">("medium");
  
  // —�?录制模式：是否只录制模型区域 —�?//
  const [useModelFrame, setUseModelFrame] = useState<boolean>(false);
  
  // —�?WebGAL模式 —�?//
  const [showWebGALMode, setShowWebGALMode] = useState(false);

  // 初始化管理器
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

  // 时间线相关函�?
  const nextEnd = (clips: Clip[]) => clips.reduce((t, c) => Math.max(t, c.start + c.duration), 0);

  const clearTimeline = () => { 
    setMotionClips([]); 
    setExprClips([]); 
    setAudioClips([]); 
    setPlayhead(0); 
    
    // 清理音频引用
    audioManager.cleanupAudio();
  };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "expr") setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "audio") setAudioClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const setPlayheadSec = (sec: number) => setPlayhead(sec);

  // ——�?播放（广播到所有子模型�?—�?//
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

  // 新增音频导入功能
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
        alert('无法获取音频时长');
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
          console.log('🎵 音频分析器设置成�?', audioClip.name);
        } catch (error) {
          console.warn('音频分析器设置失�?', error);
        }
      }

      setAudioClips(prev => [...prev, audioClip]);
    } catch (error) {
      console.error('导入音频失败:', error);
      alert('导入音频失败: ' + error);
    }
  };

  const timelineLength = Math.max(nextEnd(motionClips), nextEnd(exprClips), nextEnd(audioClips));

  const applyTimelineAtTime = (t: number, offline: boolean = false) => {
    // 每次播放都重新执行动�?表情，不使用firedRef防止重复
    for (const c of motionClips) {
      if (t >= c.start && t < c.start + c.duration) {
        // 在片段持续时间内持续播放动作
        playMotion(c.name);
      }
    }
    for (const c of exprClips) {
      if (t >= c.start && t < c.start + c.duration) {
        // 在片段持续时间内持续应用表情
        applyExpression(c.name);
      }
    }

    if (!offline) {
      // 音频播放和动画处�?
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
    
    // 停止所有音频播�?
    audioManager.stopAllAudio();
  };

  // 录制相关函数
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
      alert("请先在时间线中添加内容（动作、表情或音频�?");
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
      alert('提示: 带有 blob 音频的片段无法在离往出最空唤合制，请使用新方式导入音频�?');
    }

    const hasValidBounds = customRecordingBounds && customRecordingBounds.width > 0 && customRecordingBounds.height > 0;
    const shouldUseModelFrame = useModelFrame && hasValidBounds;
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
      console.error('离往导出失败:', error);
      alert('离往导出失败: ' + error);
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



  // 在WebGAL模型加载成功后清理本地模式模�?
  const cleanupLocalModeModelsAfterWebGAL = () => {
    try {
      console.log('🧹 WebGAL模型加载成功，开始清理本地模式模�?..');
      
      // 这里不需要清理当前模型，因为当前显示的就是WebGAL模型
      // 只需要重置本地模式相关的状�?
      setModelData(null);
      setCustomRecordingBounds({ x: 0, y: 0, width: 0, height: 0 });
      
      console.log('�?本地模式状态已清理，WebGAL模型保持显示');
      
    } catch (error) {
      console.warn('⚠️ 清理本地模式状态时出现警告:', error);
    }
  };



  // 退出WebGAL模式时的清理
  const exitWebGALMode = () => {
    try {
      console.log('🚪 退出WebGAL模式，开始清�?..');
      
      // 清理WebGAL模式的模�?
      if (modelManager) {
        modelManager.cleanupCurrentModel();
      }
      
      console.log('🏷�?WebGAL模式状态已重置');
      
      // 清理时间�?
      clearTimeline();
      
      console.log('�?WebGAL模式退出完�?);
      
    } catch (error) {
      console.warn('⚠️ 退出WebGAL模式时出现警�?', error);
    }
  };

    // 导入WebGAL时间�?
  const importWebGALTimeline = async (commands: any[]) => {
    try {
      console.log('🎭 进入WebGAL模式');
      
      console.log('📝 设置WebGAL命令状态，命令数量:', commands.length);
      
      const parser = new WebGALParser();

    let currentTime = 0;

    for (const command of commands) {
      if (command.type === 'changeFigure') {
        const figure = command.data;

        if (figure.path) {
          try {
            // 解析为完整的figure路径（包含正确端口）
            const resolved = parser.resolveFigurePath(figure.path);
            console.log('🧭 解析后的模型路径:', resolved);

            // 尝试加载模型到Live2D视图
            try {
              // 使用通用的loadAnyModel方法加载模型
              await modelManager.loadAnyModel(appRef.current!, resolved);
              console.log('�?模型加载成功:', resolved);
              
              // WebGAL模式成功加载模型后，清理本地模式的旧模型
              // 注意：这里清理的是本地模式，不是刚加载的WebGAL模型
              cleanupLocalModeModelsAfterWebGAL();
              
            } catch (loadError) {
              console.error('�?模型加载失败:', {
                originalPath: figure.path,
                resolvedPath: resolved,
                error: loadError instanceof Error ? loadError.message : String(loadError)
              });
            }
          } catch (error) {
            console.error('�?模型路径解析失败:', {
              originalPath: figure.path,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        // 同时添加 motion/expression 到时间线
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

        // 解析音频路径
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
              audioUrl: audioAbs
              audioPath: audioAbs
            };

            setAudioClips(prev => [...prev, audioClip]);

            // 音频分析管线
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
                console.warn('音频分析器设置失�?', error);
              }
            }

            currentTime += duration;
          } catch (error) {
            console.warn('音频加载失败:', error);
            currentTime += 3.0;
          }
        } else {
          currentTime += 2.0; // 没有音频，默认时�?
        }
      }
    }

    console.log(`�?成功导入 ${commands.length} �?WebGAL 命令，总时�? ${currentTime.toFixed(2)}s`);
  } catch (error) {
    console.error('导入WebGAL时间线失�?', error);
    alert('导入失败: ' + error);
  }
};


  // 重置为模型边�?- 使用 getBounds() 获取准确的屏幕坐�?
  const resetToModelBounds = () => {
    if (!appRef.current) return;

    if (modelRef.current) {
      if (Array.isArray(modelRef.current)) {
        // 复合模型 - 使用容器�?getBounds
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
        // 单模�?- 使用 getBounds() 获取实际渲染边界
        const model = modelRef.current;
        try {
          // 尝试使用 getBounds 获取实际显示区域
          const b = (model as any).getBounds?.() || model.getLocalBounds?.();
          if (b && b.width > 0 && b.height > 0) {
            setCustomRecordingBounds({
              x: Math.max(0, b.x),
              y: Math.max(0, b.y),
              width: Math.max(100, Math.min(b.width, window.innerWidth)),
              height: Math.max(100, Math.min(b.height, window.innerHeight)),
            });
          } else {
            // 回退：使�?scale �?position 计算
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
          // 回退方案
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
        // �?Rust，拿�?http://127.0.0.1:PORT/model
        const { base_url } = await invoke<{base_url: string, models_dir: string}>("get_model_server_info");
        setAssetBase(base_url);
      } catch (e) {
        console.error("获取模型服务器信息失�?", e);
        setAssetBase(null);
      }
    })();
  }, []);

  // 读取模型列表
  const loadModelList = async () => {
    if (!assetBase) return;
    try {
      const res = await fetch(`${assetBase}/models.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = (await res.json()) as string[];
      setModelList(arr);
      // 默认选择第一项（或保持已选）
      setSelectedModel(prev => prev ?? arr[0] ?? null);
    } catch (e) {
      console.warn("读取外部 models.json 失败，请确认 exe 同级�?model/models.json 存在", e);
      setModelList([]);
      setSelectedModel(null);
    }
  };

  useEffect(() => {
    loadModelList();
  }, [assetBase]);

  // 刷新模型列表
  const refreshModels = async () => {
    try {
      const newModelList = await invoke<string[]>("refresh_model_index");
      setModelList(newModelList);
      if (selectedModel && !newModelList.includes(selectedModel)) {
        setSelectedModel(newModelList[0] ?? null);
      }
    } catch (e) {
      console.error("刷新模型列表失败:", e);
    }
  };

  // 初始�?PIXI（仅一次）
  useEffect(() => {
    let disposed = false;
    let resizeHandler: (() => void) | null = null;

    const run = async () => {
      if (!canvasRef.current) return;

      (window as any).PIXI = PIXI;
      const app = new PIXI.Application({
        view: canvasRef.current,
        backgroundAlpha: 0,
        resizeTo: window,
        preserveDrawingBuffer: true,
        antialias: true,
      });
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

      // 如果已有选择，载入模�?
      if (modelUrl) {
        await modelManager.loadAnyModel(app, modelUrl);
        if (disposed) return;
      }

      // 透明清屏
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
      if (canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
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
  }, []); // 只初始化一�?

  // 切换透明背景时同�?renderer
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

  // 添加空格键控制播�?
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框中，不处理空格键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.code === 'Space') {
        e.preventDefault(); // 防止页面滚动
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

  // 当选择的模型发生变化时，重新加�?
  useEffect(() => {
    (async () => {
      if (!appRef.current) return;
      if (!modelUrl) return;

      // 停止播放，清时间�?
      stopPlayback();
      clearTimeline();

      // 移除旧模�?容器
      modelManager.cleanupCurrentModel();

      await modelManager.loadAnyModel(appRef.current, modelUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // 解析 .mtn：预取真实时长（依赖当前模型数据 & 模型 URL 或自定义基准�?
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
      <canvas
        ref={canvasRef}
        className="live2d-canvas"
        data-transparent="true"
      />

             {/* 录制区域边框 */}
       <RecordingBounds
         showRecordingBounds={showRecordingBounds}
         customRecordingBounds={customRecordingBounds}
         onBoundsChange={setCustomRecordingBounds}
       />

       {/* WebGAL模式 */}
               {showWebGALMode && (
          <WebGALMode
            onClose={() => setShowWebGALMode(false)}
            onImportTimeline={importWebGALTimeline}
            onExitWebGALMode={exitWebGALMode}
          />
        )}

      {/* 控制面板 */}
      {showControls && (
                 <ControlPanel
           onClose={() => setShowControls(false)}
           onToggleWebGALMode={() => setShowWebGALMode(!showWebGALMode)}

          // 模型选择
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
        />
      )}

      {/* 时间�?*/}
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
            // 清理音频引用
            const audio = audioManager.audioRefs.current.get(id);
            if (audio) {
              audio.pause();
              audio.src = '';
              audioManager.audioRefs.current.delete(id);
            }
            // 清理音频分析�?
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

      {/* 导出工具条（右下角） */}
      <ExportToolbar
        showRecordingBounds={showRecordingBounds}
        setShowRecordingBounds={setShowRecordingBounds}
        customRecordingBounds={customRecordingBounds}
        setCustomRecordingBounds={setCustomRecordingBounds}
        useModelFrame={useModelFrame}
        setUseModelFrame={setUseModelFrame}
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
        onResetToModelBounds={resetToModelBounds}
        isVp9AlphaSupported={isVp9AlphaSupported}
      />

      {!showControls && (
        <button className="l2d-toggle" onClick={() => setShowControls(true)}>
          🎛�?显示控制面板
        </button>
      )}
    </div>
  );
}














