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
import type { JsonlLive2DModel } from "./ModelManager";

// import { convertFileSrc } from "@tauri-apps/api/core";
// import { normalizePath } from "../utils/fs";

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { appCacheDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { isVp9AlphaSupported } from "../utils/recorder";

interface Motion { name: string; file: string; }
interface Expression { name: string; file: string; }
interface ModelData {
  motions: { [key: string]: Motion[] };
  expressions: Expression[];
}

type CharacterOption = {
  id: string;
  label: string;
};

type MotionLenMap = Record<string, number>;

export default function Live2DView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 允许保存单模型或复合的子模型数组
  const modelRef = useRef<Live2DModel | Live2DModel[] | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);

  // 复合（.jsonl）时的容器与标记、MTN 解析基准目录
  const groupContainerRef = useRef<PIXI.Container | null>(null);
  const isCompositeRef = useRef<boolean>(false);
  const motionBaseRef = useRef<string | null>(null); // 用于解析 mtn 相对路径

  // 获取模型服务器信息
  const [assetBase, setAssetBase] = useState<string | null>(null);

  // —— 模型选择 —— //
  const [modelList, setModelList] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // 例如 "anon/model.json" 或 "xxx/model.jsonl"
  const modelUrl = selectedModel && assetBase ? `${assetBase}/${selectedModel}` : null; // 最终 URL

  // —— 当前模型数据 —— //
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<string>("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [characterOptions, setCharacterOptions] = useState<CharacterOption[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("main");
  const [showControls, setShowControls] = useState<boolean>(true);
  const [enableDragging, setEnableDragging] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // —— 时间线 —— //
  const [motionClips, setMotionClips] = useState<Clip[]>([]);
  const [exprClips, setExprClips] = useState<Clip[]>([]);
  const [audioClips, setAudioClips] = useState<Clip[]>([]); // 新增音频轨
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioLevel, setCurrentAudioLevel] = useState(0); // 当前音频电平

  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  // 默认时长（兜底）
  const [motionDur, setMotionDur] = useState(2);
  const [exprDur, setExprDur] = useState(0.8);

  // 每组 motion 的真实时长
  const [motionLen, setMotionLen] = useState<MotionLenMap>({});

  // —— 录制 —— //
  const [recState, setRecState] = useState<"idle" | "rec" | "done">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [transparentBg, setTransparentBg] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  
  // —— 用户自定义录制范围 —— //
  const [customRecordingBounds, setCustomRecordingBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [showRecordingBounds, setShowRecordingBounds] = useState(false);
  const [enableModelBoundsRecording, setEnableModelBoundsRecording] = useState(false);
   
  // —— 录制质量设置 —— //
  const [recordingQuality, setRecordingQuality] = useState<"low" | "medium" | "high">("medium");
  


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

  // 时间线相关函数
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

  // ——— 播放（广播到所有子模型） —— //
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
      // 初始化音频上下文
      audioManager.initAudioContext();
      
      // 创建文件输入元素
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.multiple = false;
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        // 创建音频URL
        const audioUrl = URL.createObjectURL(file);
        
        // 获取音频时长
        const audio = new Audio(audioUrl);
        await new Promise((resolve) => {
          audio.onloadedmetadata = resolve;
          audio.load();
        });
        
        const duration = audio.duration;
        if (duration <= 0) {
          alert('无法获取音频时长');
          return;
        }
        
        // 创建音频片段
        const audioClip: Clip = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''), // 移除文件扩展名
          start: nextEnd(audioClips),
          duration: duration,
          audioUrl: audioUrl,
        };
        
        // 创建音频元素并存储引用
        const audioElement = new Audio(audioUrl);
        audioElement.preload = 'auto';
        audioElement.volume = 0.8; // 设置默认音量
        audioManager.audioRefs.current.set(audioClip.id, audioElement);
        
        // 设置音频分析
        if (audioManager.audioContextRef.current) {
          try {
            const source = audioManager.audioContextRef.current.createMediaElementSource(audioElement);
            const analyzer = audioManager.audioContextRef.current.createAnalyser();
            analyzer.fftSize = 256;
            analyzer.smoothingTimeConstant = 0.8;
            
            source.connect(analyzer);
            analyzer.connect(audioManager.audioContextRef.current.destination);
            
            audioManager.audioAnalyzersRef.current.set(audioClip.id, { source, analyzer });
            console.log('🎵 音频分析器设置成功:', audioClip.name);
          } catch (error) {
            console.warn('音频分析器设置失败:', error);
          }
        }
        
        setAudioClips(prev => [...prev, audioClip]);
        
        // 清理
        input.remove();
      };
      
      input.click();
    } catch (error) {
      console.error('导入音频失败:', error);
      alert('导入音频失败: ' + error);
    }
  };

  const timelineLength = Math.max(nextEnd(motionClips), nextEnd(exprClips), nextEnd(audioClips));

  const tick = (ts: number) => {
    if (startTsRef.current == null) startTsRef.current = ts;
    const t = (ts - startTsRef.current) / 1000;
    setPlayhead(t);

    // 每次播放都重新执行动作/表情，不使用firedRef防止重复
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

    // 音频播放和动画处理
    audioManager.playAudioAtTime(t);
    audioManager.processAudioAnimation(t);

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
    
    // 停止所有音频播放
    audioManager.stopAllAudio();
  };

  // 录制相关函数
  const startRecording = () => {
    recordingManager.start();
  };

  const stopRecording = () => {
    recordingManager.stop();
  };

  const recordingManager = RecordingManager({
    canvasRef,
    modelRef,
    motionClips,
    exprClips,
    audioClips,
    recordingQuality,
    customRecordingBounds,
    enableModelBoundsRecording,
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






  // 重置为模型边框
  const resetToModelBounds = () => {
    if (modelRef.current) {
      if (Array.isArray(modelRef.current)) {
        // 复合模型
        if (groupContainerRef.current) {
          const b = groupContainerRef.current.getBounds();
          setCustomRecordingBounds({
            x: Math.max(0, b.x),
            y: Math.max(0, b.y),
            width: Math.min(b.width, window.innerWidth),
            height: Math.min(b.height, window.innerHeight),
          });
        }
      } else {
        // 单模型
        const model = modelRef.current;
        const modelWidth = model.width * model.scale.x;
        const modelHeight = model.height * model.scale.y;
        const modelX = model.position.x - modelWidth / 2;
        const modelY = model.position.y - modelHeight / 2;
        setCustomRecordingBounds({
          x: Math.max(0, modelX),
          y: Math.max(0, modelY),
          width: Math.min(modelWidth, window.innerWidth),
          height: Math.min(modelHeight, window.innerHeight),
        });
      }
    }
  };

  const refreshCharacterOptions = () => {
    const current = modelRef.current;
    if (!current) {
      setCharacterOptions([]);
      setSelectedCharacterId("main");
      return;
    }

    if (Array.isArray(current)) {
      const uniqueOptions = new Map<string, CharacterOption>();

      current.forEach((model, index) => {
        const meta = (model as JsonlLive2DModel).__jsonlRoleMeta;
        const rawId = meta?.id || `part${index}`;
        const roleId = rawId.replace(/\d+$/, "") || rawId;

        if (!uniqueOptions.has(roleId)) {
          uniqueOptions.set(roleId, {
            id: roleId,
            label: roleId,
          });
        }
      });
      const options = Array.from(uniqueOptions.values());

      setCharacterOptions(options);
      setSelectedCharacterId((prev) => options.some(option => option.id === prev) ? prev : (options[0]?.id ?? "main"));
      return;
    }

    setCharacterOptions([{ id: "main", label: "main" }]);
    setSelectedCharacterId("main");
  };

  useEffect(() => {
    (async () => {
      try {
        // 调 Rust，拿到 http://127.0.0.1:PORT/model
        const { base_url } = await invoke<{base_url: string, models_dir: string}>("get_model_server_info");
        setAssetBase(base_url);
      } catch (e) {
        console.error("获取模型服务器信息失败:", e);
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
      console.warn("读取外部 models.json 失败，请确认 exe 同级的 model/models.json 存在", e);
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

  // 初始化 PIXI（仅一次）
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

      // 如果已有选择，载入模型
      if (modelUrl) {
        await modelManager.loadAnyModel(app, modelUrl);
        refreshCharacterOptions();
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
  }, []); // 只初始化一次

  // 切换透明背景时同步 renderer
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

  // 添加空格键控制播放
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

  // 当选择的模型发生变化时，重新加载
  useEffect(() => {
    (async () => {
      if (!appRef.current) return;
      if (!modelUrl) {
        setCharacterOptions([]);
        setSelectedCharacterId("main");
        return;
      }

      // 停止播放，清时间线
      stopPlayback();
      clearTimeline();

      // 移除旧模型/容器
      modelManager.cleanupCurrentModel();

      await modelManager.loadAnyModel(appRef.current, modelUrl);
      refreshCharacterOptions();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // 解析 .mtn：预取真实时长（依赖当前模型数据 & 模型 URL 或自定义基准）
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



      {/* 控制面板 */}
      {showControls && (
                 <ControlPanel
           onClose={() => setShowControls(false)}


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
          characterOptions={characterOptions}
          selectedCharacterId={selectedCharacterId}
          onSelectCharacter={setSelectedCharacterId}

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

      {/* 时间线 */}
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
            // 清理音频分析器
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
        enableModelBoundsRecording={enableModelBoundsRecording}
        setEnableModelBoundsRecording={setEnableModelBoundsRecording}
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
        onTakeScreenshot={() => recordingManager.takeScreenshot()}
        onTakePartsScreenshots={() => recordingManager.takePartsScreenshots()}
        onResetToModelBounds={resetToModelBounds}
        isVp9AlphaSupported={isVp9AlphaSupported}
      />

      {!showControls && (
        <button className="l2d-toggle" onClick={() => setShowControls(true)}>
          🎛️ 显示控制面板
        </button>
      )}
    </div>
  );
}
