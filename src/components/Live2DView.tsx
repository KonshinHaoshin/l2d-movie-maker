// src/components/Live2DView.tsx
import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import Timeline from "./timeline/Timeline";
import type { Clip, TrackKind } from "./timeline/types";
import { parseMtn } from "../utils/parseMtn";
import "./Live2DView.css";
import ControlPanel from "./panel/ControlPanel";
import { createVp9AlphaRecorder, createModelFrameRecorder, isVp9AlphaSupported } from "../utils/recorder";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { appCacheDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";

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

  // 音频播放管理
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  
  // 音频分析相关
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyzersRef = useRef<Map<string, { source: MediaElementAudioSourceNode; analyzer: AnalyserNode }>>(new Map());
  const mouthAnimationRef = useRef<{ audioLevel: number; lastUpdate: number }>({ audioLevel: 0, lastUpdate: 0 });

  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  // 默认时长（兜底）
  const [motionDur, setMotionDur] = useState(2);
  const [exprDur, setExprDur] = useState(0.8);

  // 每组 motion 的真实时长
  const [motionLen, setMotionLen] = useState<MotionLenMap>({});

  // 初始化音频上下文
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('🎵 音频上下文初始化成功');
      } catch (error) {
        console.error('❌ 音频上下文初始化失败:', error);
      }
    }
  };



  // 应用嘴部动画
  const applyMouthAnimation = (audioLevel: number) => {
    if (!modelRef.current) {
      console.log('❌ 没有模型，跳过嘴部动画');
      return;
    }
    
    if (audioLevel < 5) {
      console.log('🔇 音频电平太低，跳过嘴部动画:', audioLevel);
      return;
    }
    
    console.log('🎵 应用嘴部动画，音频电平:', audioLevel);
    
    try {
      forEachModel((model) => {
        // 获取模型的内部模型
        const internalModel = (model as any).internalModel;
        if (!internalModel) {
          console.log('❌ 无法获取模型内部模型');
          return;
        }
        
        // 尝试不同的参数访问方式
        let paramFound = false;
        
        // 方式1: 通过 parameters.get()
        if (internalModel.parameters) {
          const mouthParams = [
            'ParamMouthOpenY', 'ParamMouthForm', 'ParamMouthOpen',
            'ParamMouthA', 'ParamMouthI', 'ParamMouthU', 'ParamMouthE', 'ParamMouthO',
            'PARAM_MOUTH_OPEN_Y', 'PARAM_MOUTH_FORM', 'PARAM_MOUTH_OPEN',
            'PARAM_MOUTH_A', 'PARAM_MOUTH_I', 'PARAM_MOUTH_U', 'PARAM_MOUTH_E', 'PARAM_MOUTH_O'
          ];
          
          mouthParams.forEach(paramName => {
            try {
              const param = internalModel.parameters.get(paramName);
              if (param && typeof param.value !== 'undefined') {
                const mouthValue = Math.min(1.0, Math.max(0.0, audioLevel / 100));
                param.value = mouthValue;
                console.log(`✅ 设置参数 ${paramName}:`, mouthValue);
                paramFound = true;
              }
            } catch (error) {
              // 忽略错误，继续尝试下一个参数
            }
          });
        }
        
        // 方式2: 通过 coreModel.setParamFloat()
        if (internalModel.coreModel && !paramFound) {
          const mouthParams = [
            'PARAM_MOUTH_OPEN_Y', 'PARAM_MOUTH_FORM', 'PARAM_MOUTH_OPEN',
            'PARAM_MOUTH_A', 'PARAM_MOUTH_I', 'PARAM_MOUTH_U', 'PARAM_MOUTH_E', 'PARAM_MOUTH_O'
          ];
          
          mouthParams.forEach(paramName => {
            try {
              const mouthValue = Math.min(1.0, Math.max(0.0, audioLevel / 100));
              internalModel.coreModel.setParamFloat(paramName, mouthValue);
              console.log(`✅ 通过coreModel设置参数 ${paramName}:`, mouthValue);
              paramFound = true;
            } catch (error) {
              // 忽略错误，继续尝试下一个参数
            }
          });
        }
        
        // 方式3: 直接访问参数对象
        if (!paramFound && internalModel.parameters) {
          try {
            // 遍历所有参数，查找包含mouth的
            for (let i = 0; i < internalModel.parameters.count; i++) {
              const param = internalModel.parameters.get(i);
              if (param && param.id && param.id.toLowerCase().includes('mouth')) {
                const mouthValue = Math.min(1.0, Math.max(0.0, audioLevel / 100));
                param.value = mouthValue;
                console.log(`✅ 通过索引设置参数 ${param.id}:`, mouthValue);
                paramFound = true;
              }
            }
          } catch (error) {
            console.warn('通过索引访问参数失败:', error);
          }
        }
        
        if (!paramFound) {
          console.log('⚠️ 未找到可用的嘴部参数');
        }
      });
    } catch (error) {
      console.error('❌ 嘴部动画应用失败:', error);
    }
  };

  // 重置嘴部动画
  const resetMouthAnimation = () => {
    try {
      forEachModel((model) => {
        const internalModel = (model as any).internalModel;
        if (!internalModel) return;
        
        // 重置所有嘴部参数
        const mouthParams = [
          'ParamMouthOpenY', 'ParamMouthForm', 'ParamMouthOpen',
          'ParamMouthA', 'ParamMouthI', 'ParamMouthU', 'ParamMouthE', 'ParamMouthO'
        ];
        
        mouthParams.forEach(paramName => {
          const param = internalModel.parameters?.get(paramName);
          if (param) {
            param.value = 0;
          }
        });
      });
      
      mouthAnimationRef.current.audioLevel = 0;
      mouthAnimationRef.current.lastUpdate = Date.now();
    } catch (error) {
      console.warn('重置嘴部动画失败:', error);
    }
  };



  const clearTimeline = () => { 
    setMotionClips([]); 
    setExprClips([]); 
    setAudioClips([]); 
    setPlayhead(0); 
    
    // 清理音频引用
    audioRefs.current.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    audioRefs.current.clear();
    
    // 清理音频分析器
    audioAnalyzersRef.current.forEach(({ source, analyzer }) => {
      try {
        source.disconnect();
        analyzer.disconnect();
      } catch {}
    });
    audioAnalyzersRef.current.clear();
    
    // 重置嘴部动画
    resetMouthAnimation();
  };

  const changeClip = (track: TrackKind, id: string, patch: Partial<Pick<Clip, "start" | "duration">>) => {
    if (track === "motion") setMotionClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "expr") setExprClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    else if (track === "audio") setAudioClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const setPlayheadSec = (sec: number) => setPlayhead(sec);

  // —— 录制 —— //
  const recRef = useRef<ReturnType<typeof createVp9AlphaRecorder> | ReturnType<typeof createModelFrameRecorder> | null>(null);
  const [recState, setRecState] = useState<"idle" | "rec" | "done">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [transparentBg, setTransparentBg] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  
     // —— 用户自定义录制范围 —— //
   const [customRecordingBounds, setCustomRecordingBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
   const [showRecordingBounds, setShowRecordingBounds] = useState(false);
   
   // —— 录制质量设置 —— //
   const [recordingQuality, setRecordingQuality] = useState<"low" | "medium" | "high">("medium");

  // —— 工具 —— //
  const isJsonl = (u: string) => /\.jsonl(\?|#|$)/i.test(u);
  const resolveRelativeFrom = (baseUrl: string, rel: string) => {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (rel.startsWith("/")) return rel;
    if (rel.startsWith("./")) rel = rel.slice(2);
    const base = baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1);
    return base + rel;
  };

  const forEachModel = (fn: (m: Live2DModel) => void) => {
    const cur = modelRef.current;
    if (!cur) return;
    if (Array.isArray(cur)) cur.forEach(fn);
    else fn(cur as Live2DModel);
  };

  const cleanupCurrentModel = () => {
    const app = appRef.current;
    if (!app) return;
    try {
      if (Array.isArray(modelRef.current)) {
        // 移除并销毁复合容器
        if (groupContainerRef.current) {
          groupContainerRef.current.removeChildren().forEach((c: any) => {
            try { c.destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
          });
          app.stage.removeChild(groupContainerRef.current);
          try { groupContainerRef.current.destroy?.({ children: true }); } catch {}
        }
      } else if (modelRef.current) {
        app.stage.removeChild(modelRef.current as any);
        try { (modelRef.current as any).destroy?.({ children: true, texture: true, baseTexture: true }); } catch {}
      }
    } catch {}
    groupContainerRef.current = null;
    modelRef.current = null;
    isCompositeRef.current = false;
    motionBaseRef.current = null;
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
        await loadAnyModel(app, modelUrl);
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
      if (!modelUrl) return;

      // 停止播放，清时间线
      stopPlayback();
      clearTimeline();

      // 移除旧模型/容器
      cleanupCurrentModel();

      await loadAnyModel(appRef.current, modelUrl);
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

  // ——— 播放（广播到所有子模型） —— //
  const playMotion = (group: string) => {
    if (!modelData?.motions[group]) return;
    forEachModel((m) => m.motion(group, 0, 3));
    setCurrentMotion(group);
  };

  const applyExpression = (name: string) => {
    if (!modelData?.expressions?.length) return;
    forEachModel((m) => m.expression(name));
    setCurrentExpression(name);
  };

  // ——— 时间线 —— //
  const nextEnd = (clips: Clip[]) => clips.reduce((t, c) => Math.max(t, c.start + c.duration), 0);

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
      initAudioContext();
      
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
        audioRefs.current.set(audioClip.id, audioElement);
        
        // 设置音频分析
        if (audioContextRef.current) {
          try {
            const source = audioContextRef.current.createMediaElementSource(audioElement);
            const analyzer = audioContextRef.current.createAnalyser();
            analyzer.fftSize = 256;
            analyzer.smoothingTimeConstant = 0.8;
            
            source.connect(analyzer);
            analyzer.connect(audioContextRef.current.destination);
            
            audioAnalyzersRef.current.set(audioClip.id, { source, analyzer });
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

    // 音频播放逻辑
    for (const c of audioClips) {
      const audioElement = audioRefs.current.get(c.id);
      if (!audioElement) continue;
      
      if (t >= c.start && t < c.start + c.duration) {
        // 如果音频还没开始播放，开始播放
        if (audioElement.paused) {
          audioElement.currentTime = t - c.start;
          audioElement.play().catch(err => {
            console.warn('音频播放失败:', err);
          });
        }
      } else {
        // 如果音频不在播放时间范围内，停止播放
        if (!audioElement.paused) {
          audioElement.pause();
          audioElement.currentTime = 0;
        }
      }
    }

    // 音频分析和嘴部动画
    let audioLevel = 0;
    let activeAudioCount = 0;
    
    audioClips.forEach(clip => {
      const audioElement = audioRefs.current.get(clip.id);
      const analyzerData = audioAnalyzersRef.current.get(clip.id);
      
      if (!audioElement || !analyzerData) {
        console.log(`⚠️ 音频 ${clip.name} 缺少元素或分析器`);
        return;
      }
      
      if (t >= clip.start && t < clip.start + clip.duration) {
        activeAudioCount++;
        // 分析当前播放音频的电平
        try {
          const { analyzer } = analyzerData;
          const bufferLength = analyzer.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          analyzer.getByteFrequencyData(dataArray);
          
          // 计算平均音量，重点关注人声频率范围 (85Hz - 255Hz)
          let sum = 0;
          let count = 0;
          for (let i = 0; i < bufferLength; i++) {
            // 人声主要频率范围
            if (i >= 3 && i <= 8) { // 大约对应85Hz-255Hz
              sum += dataArray[i];
              count++;
            }
          }
          
          if (count > 0) {
            const average = sum / count;
            const level = Math.min(100, Math.max(0, (average / 255) * 100));
            audioLevel = Math.max(audioLevel, level);
            
            // 每100ms输出一次音频电平信息
            if (Math.floor(t * 10) % 10 === 0) {
              console.log(`🎵 音频 ${clip.name} 电平: ${level.toFixed(1)}%`);
            }
          }
        } catch (error) {
          console.error('❌ 音频分析失败:', error);
        }
      }
    });
    
    // 每100ms输出一次总体音频信息
    if (Math.floor(t * 10) % 10 === 0) {
      console.log(`📊 总音频电平: ${audioLevel.toFixed(1)}%, 活跃音频数: ${activeAudioCount}`);
    }
    
    // 更新状态中的音频电平
    setCurrentAudioLevel(audioLevel);
    
    // 应用嘴部动画
    if (audioLevel > 5) {
      applyMouthAnimation(audioLevel);
      mouthAnimationRef.current.audioLevel = audioLevel;
      mouthAnimationRef.current.lastUpdate = Date.now();
    } else {
      // 如果没有音频，逐渐关闭嘴部
      const timeSinceLastAudio = Date.now() - mouthAnimationRef.current.lastUpdate;
      if (timeSinceLastAudio > 100) { // 100ms后开始关闭
        const decayFactor = Math.max(0, 1 - (timeSinceLastAudio - 100) / 500); // 500ms内完全关闭
        const decayedLevel = mouthAnimationRef.current.audioLevel * decayFactor;
        applyMouthAnimation(decayedLevel);
        mouthAnimationRef.current.audioLevel = decayedLevel;
      }
    }

    if (t >= timelineLength) {
      stopPlayback();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startPlayback = () => {
    if (isPlaying || timelineLength <= 0) return;
    // 不再需要清理firedRef，因为我们每次都重新播放
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
    audioRefs.current.forEach(audio => {
      if (!audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    
    // 重置嘴部动画
    resetMouthAnimation();
  };

  // —— 录制 —— //
  const start = async () => {
    if (!canvasRef.current) return;
    if (!isVp9AlphaSupported()) {
      alert("此环境不支持 VP9 透明直录");
      return;
    }

    const totalDuration = Math.max(
      motionClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      exprClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0),
      audioClips.reduce((t, c) => Math.max(t, c.start + c.duration), 0)
    );
    if (totalDuration <= 0) {
      alert("请先在时间线中添加动作或表情片段");
      return;
    }

    // 根据质量设置选择录制参数
    const qualitySettings = {
      low: { fps: 24, kbps: 4000 },
      medium: { fps: 30, kbps: 8000 },
      high: { fps: 60, kbps: 16000 }
    };
    
    const settings = qualitySettings[recordingQuality];
    
    // 使用全屏录制器，包含音频轨道
    recRef.current = createVp9AlphaRecorder(canvasRef.current, settings.fps, settings.kbps, {
      onProgress: (time: number) => {
        setRecordingTime(time);
        setRecordingProgress((time / totalDuration) * 100);
      },
      audioClips: audioClips.map(clip => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        audioUrl: clip.audioUrl!
      })),
      timelineLength: totalDuration
    });

    recRef.current.start();
    setRecState("rec");
    setRecordingTime(0);
    setRecordingProgress(0);
    startPlayback();

    setTimeout(() => {
      if (recState === "rec") stop();
    }, totalDuration * 1000);
  };

  const stop = async () => {
    if (!recRef.current) return;
    const b = await recRef.current.stop();
    setBlob(b);
    setRecState("done");
    setRecordingTime(0);
    setRecordingProgress(0);
    stopPlayback();
  };

  const saveWebM = async () => {
    if (!recRef.current || !blob) return;
    await recRef.current.saveWebM(blob);
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

  // —— 使模型/容器可拖动 —— //
  const makeDraggableModel = (model: any) => {
    model.interactive = true;
    model.buttonMode = true;

    model.on("pointerdown", (e: any) => {
      setIsDragging(true);
      (model as any).dragging = true;
      (model as any)._pointerX = e.data.global.x - model.x;
      (model as any)._pointerY = e.data.global.y - model.y;
    });

    model.on("pointermove", (e: any) => {
      if ((model as any).dragging) {
        model.position.x = e.data.global.x - (model as any)._pointerX;
        model.position.y = e.data.global.y - (model as any)._pointerY;
        // 更新单模型包围盒
        const mw = model.width * model.scale.x;
        const mh = model.height * model.scale.y;
        const mx = model.position.x - mw / 2;
        const my = model.position.y - mh / 2;
                 setCustomRecordingBounds({
           x: Math.max(0, mx),
           y: Math.max(0, my),
           width: Math.min(mw, appRef.current!.screen.width),
           height: Math.min(mh, appRef.current!.screen.height),
         });
      }
    });

    const up = () => { setIsDragging(false); (model as any).dragging = false; };
    model.on("pointerup", up);
    model.on("pointerupoutside", up);
  };

  const makeDraggableContainer = (container: PIXI.Container) => {
    // 为容器添加一个几乎透明的命中区域，保证好拖
    const hit = new PIXI.Graphics();
    const redrawHit = () => {
      const b = container.getBounds();
      hit.clear();
      hit.beginFill(0x000000, 0.0001);
      hit.drawRect(b.x - container.x, b.y - container.y, b.width, b.height);
      hit.endFill();
    };
    redrawHit();
    container.addChild(hit);

    container.interactive = true;
    // @ts-ignore: pixi v7 可用 eventMode
    container.eventMode = "static";
    container.cursor = "grab";

    container.on("pointerdown", (e: any) => {
      setIsDragging(true);
      // @ts-ignore
      container.cursor = "grabbing";
      (container as any).dragging = true;
      (container as any)._pointerX = e.data.global.x - container.x;
      (container as any)._pointerY = e.data.global.y - container.y;
    });

    container.on("pointermove", (e: any) => {
      if ((container as any).dragging) {
        container.position.x = e.data.global.x - (container as any)._pointerX;
        container.position.y = e.data.global.y - (container as any)._pointerY;
        const b = container.getBounds();
        setCustomRecordingBounds({
          x: Math.max(0, b.x),
          y: Math.max(0, b.y),
          width: Math.min(b.width, appRef.current!.screen.width),
          height: Math.min(b.height, appRef.current!.screen.height),
        });
        redrawHit();
      }
    });

    const up = () => {
      setIsDragging(false);
      // @ts-ignore
      container.cursor = "grab";
      (container as any).dragging = false;
    };
    container.on("pointerup", up);
    container.on("pointerupoutside", up);
    window.addEventListener("resize", redrawHit);
  };

  // 实际加载：根据后缀分流
  const loadAnyModel = async (app: PIXI.Application, url: string) => {
    if (isJsonl(url)) {
      await loadJsonlComposite(app, url);
    } else {
      await loadSingleModel(app, url);
    }
  };

  // 单模型
  const loadSingleModel = async (app: PIXI.Application, url: string) => {
    try {
      const model = await Live2DModel.from(url);
      modelRef.current = model;
      isCompositeRef.current = false;
      motionBaseRef.current = url.slice(0, url.lastIndexOf("/") + 1);

      // 读取 json
      const res = await fetch(url, { cache: "no-cache" });
      const data = await res.json();
      setModelData(data);

      model.anchor.set(0.5, 0.5);
      model.scale.set(0.3);
      model.position.set(app.screen.width / 2, app.screen.height / 2);

      (model as any).autoInteract = false;
      const im = (model as any).internalModel as any;
      if (im) {
        ["angleXParamIndex", "angleYParamIndex", "angleZParamIndex"].forEach((k) => {
          if (typeof im[k] === "number") im[k] = -1;
        });
        // 关闭眨眼
        if (im?.eyeBlink) {
          im.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
          im.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
        }
      }

      app.stage.addChild(model);
      if (enableDragging) makeDraggableModel(model);
      
      // 计算模型边框用于录制优化
      const modelWidth = model.width * model.scale.x;
      const modelHeight = model.height * model.scale.y;
      const modelX = model.position.x - modelWidth / 2;
      const modelY = model.position.y - modelHeight / 2;
      
             setCustomRecordingBounds({
         x: Math.max(0, modelX),
         y: Math.max(0, modelY),
         width: Math.min(modelWidth, app.screen.width),
         height: Math.min(modelHeight, app.screen.height)
       });
      
      console.log("📐 模型边框计算:", { modelWidth, modelHeight, modelX, modelY });
      
    } catch (err) {
      console.error("❌ 模型加载失败:", err);
      setModelData(null);
    }
  };

  // 复合（.jsonl）
  type JsonlPart = {
    path: string;
    id?: string;
    x?: number;
    y?: number;
    xscale?: number;
    yscale?: number;
  };

  const loadJsonlComposite = async (app: PIXI.Application, jsonlUrl: string) => {
    try {
      const text = await (await fetch(jsonlUrl, { cache: "no-cache" })).text();
      const lines = text.split("\n").filter(Boolean);

      const parts: JsonlPart[] = [];
      let summary: { motions?: string[]; expressions?: string[]; import?: number } = {};

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // 汇总行（最后一行）：含 motions 或 expressions
          if (obj?.motions || obj?.expressions) {
            if (Array.isArray(obj.motions)) summary.motions = obj.motions;
            if (Array.isArray(obj.expressions)) summary.expressions = obj.expressions;
            if (obj.import !== undefined) summary.import = Number(obj.import);
            continue;
          }
          if (obj?.path) {
            const fullPath = obj.path.startsWith("game/")
              ? obj.path
              : resolveRelativeFrom(jsonlUrl, obj.path.replace(/^\.\//, ""));
            parts.push({
              path: fullPath,
              id: obj.id,
              x: obj.x,
              y: obj.y,
              xscale: obj.xscale,
              yscale: obj.yscale,
            });
          }
        } catch {
          console.warn("JSONL parse error in line:", line);
        }
      }

      if (!parts.length) {
        console.warn("No valid parts in jsonl:", jsonlUrl);
        setModelData(null);
        return;
      }

      // 用第一只子模型的目录作为 MTN/表达文件的相对解析基准
      motionBaseRef.current = parts[0].path.slice(0, parts[0].path.lastIndexOf("/") + 1);

      // 创建容器
      const group = new PIXI.Container();
      group.sortableChildren = true;
      group.position.set(app.screen.width / 2, app.screen.height / 2);
      groupContainerRef.current = group;
      app.stage.addChild(group);

      // 加载子模型
      const children: Live2DModel[] = [];
      for (const p of parts) {
        try {
          const m = await Live2DModel.from(p.path, { autoInteract: false });
          m.visible = false;
          m.anchor.set(0.5);

          // 基准缩放（尽量完整显示）
          const baseScaleX = app.screen.width / m.width;
          const baseScaleY = app.screen.height / m.height;
          const base = Math.min(baseScaleX, baseScaleY);
          const sx = base * (p.xscale ?? 1);
          const sy = base * (p.yscale ?? 1);
          m.scale.set(sx, sy);

          // 相对容器中心的位移
          m.position.set(p.x ?? 0, p.y ?? 0);

          const im: any = (m as any).internalModel;
          if (im) {
            if (typeof im.angleXParamIndex === "number") im.angleXParamIndex = 999;
            if (typeof im.angleYParamIndex === "number") im.angleYParamIndex = 999;
            if (typeof im.angleZParamIndex === "number") im.angleZParamIndex = 999;
            if (im?.eyeBlink) {
              im.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
              im.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
            }
            if (summary.import != null) {
              try { im.coreModel?.setParamFloat?.("PARAM_IMPORT", Number(summary.import)); } catch {}
            }
          }

          group.addChild(m);
          children.push(m);
        } catch (e) {
          console.warn("子模型加载失败:", p.path, e);
        }
      }

      // 统一显示
      children.forEach((m) => (m.visible = true));

      // 拖拽容器
      if (enableDragging) makeDraggableContainer(group);

      // 计算联合包围盒（用于裁剪录制）
      requestAnimationFrame(() => {
        const b = group.getBounds();
                 setCustomRecordingBounds({
           x: Math.max(0, b.x),
           y: Math.max(0, b.y),
           width: Math.min(b.width, app.screen.width),
           height: Math.min(b.height, app.screen.height),
         });
        console.log("📦 JSONL 复合包围盒:", b);
      });

      // 合成 modelData：从第一只子模型的 model.json 过滤
      let synth: ModelData | null = null;
      try {
        const firstModelJson = await (await fetch(parts[0].path, { cache: "no-cache" })).json();
        const fullMotions = firstModelJson?.motions ?? {};
        const motionGroups = summary.motions?.length ? summary.motions : Object.keys(fullMotions);

        const motionsFiltered: Record<string, Motion[]> = {};
        for (const g of motionGroups) {
          const arr = fullMotions[g] || [];
          motionsFiltered[g] = arr.map((it: any, i: number) => ({
            name: it?.name ?? `${g}-${i}`,
            file: it?.file,
          }));
        }

        const fullExpr = firstModelJson?.expressions ?? [];
        const expressions: Expression[] = summary.expressions?.length
          ? fullExpr.filter((e: any) => summary.expressions!.includes(e?.name)).map((e: any) => ({ name: e?.name, file: e?.file }))
          : fullExpr.map((e: any) => ({ name: e?.name, file: e?.file }));

        synth = { motions: motionsFiltered, expressions };
      } catch (e) {
        console.warn("综合 modelData 失败：", e);
        synth = { motions: {}, expressions: [] };
      }

      setModelData(synth);
      modelRef.current = children;     // 存为数组
      isCompositeRef.current = true;
      
    } catch (err) {
      console.error("loadJsonlComposite error:", err);
      setModelData(null);
      // 清理容器
      if (groupContainerRef.current && appRef.current) {
        try {
          appRef.current.stage.removeChild(groupContainerRef.current);
          groupContainerRef.current.destroy({ children: true });
        } catch {}
      }
      groupContainerRef.current = null;
      modelRef.current = null;
      isCompositeRef.current = false;
      motionBaseRef.current = null;
    }
  };

 return (
    <div className="live2d-container">
      <canvas
          ref={canvasRef}
          className="live2d-canvas"
          data-transparent="true"
      />

      {/* 录制区域边框 */}
      {showRecordingBounds && (
          <div
              className="recording-bounds"
              style={{
                left: customRecordingBounds.x,
                top: customRecordingBounds.y,
                width: customRecordingBounds.width,
                height: customRecordingBounds.height
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startY = e.clientY;
                const startBounds = { ...customRecordingBounds };

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const deltaX = moveEvent.clientX - startX;
                  const deltaY = moveEvent.clientY - startY;

                  setCustomRecordingBounds({
                    x: Math.max(0, startBounds.x + deltaX),
                    y: Math.max(0, startBounds.y + deltaY),
                    width: startBounds.width,
                    height: startBounds.height
                  });
                };

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
          >
            {/* 调整大小的手柄 */}
            <div
                className="resize-handle resize-handle--corner"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startBounds = { ...customRecordingBounds };

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;

                    const newWidth = Math.max(100, startBounds.width + deltaX);
                    const newHeight = Math.max(100, startBounds.height + deltaY);

                    setCustomRecordingBounds({
                      x: startBounds.x,
                      y: startBounds.y,
                      width: newWidth,
                      height: newHeight
                    });
                  };

                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
            />

            {/* 调整宽度的右侧手柄 */}
            <div
                className="resize-handle resize-handle--right"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startBounds = { ...customRecordingBounds };

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const deltaX = moveEvent.clientX - startX;
                    const newWidth = Math.max(100, startBounds.width + deltaX);

                    setCustomRecordingBounds({
                      ...startBounds,
                      width: newWidth
                    });
                  };

                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
            />

            {/* 调整高度的底部手柄 */}
            <div
                className="resize-handle resize-handle--bottom"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const startY = e.clientY;
                  const startBounds = { ...customRecordingBounds };

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const deltaY = moveEvent.clientY - startY;
                    const newHeight = Math.max(100, startBounds.height + deltaY);

                    setCustomRecordingBounds({
                      ...startBounds,
                      height: newHeight
                    });
                  };

                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
            />
          </div>
      )}

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
              const audio = audioRefs.current.get(id);
              if (audio) {
                audio.pause();
                audio.src = '';
                audioRefs.current.delete(id);
              }
              // 清理音频分析器
              const analyzerData = audioAnalyzersRef.current.get(id);
              if (analyzerData) {
                try {
                  analyzerData.source.disconnect();
                  analyzerData.analyzer.disconnect();
                } catch {}
                audioAnalyzersRef.current.delete(id);
              }
            }
          }}
          onSetPlayhead={setPlayheadSec}
          onStartPlayback={startPlayback}
          onStopPlayback={stopPlayback}
          isPlaying={isPlaying}
      />

      {/* 导出工具条（右下角） */}
      <div className="export-toolbar">
        {/* 录制范围设置 */}
        <div className="recording-bounds-settings">
          <input
              type="checkbox"
              id="showRecordingBounds"
              checked={showRecordingBounds}
              onChange={(e) => setShowRecordingBounds(e.target.checked)}
              className="recording-bounds-checkbox"
          />
          <label htmlFor="showRecordingBounds" className="recording-bounds-label">
            显示录制区域边框
          </label>
        </div>

        {showRecordingBounds && (
            <>
              <div className="recording-bounds-info">
                录制区域: {customRecordingBounds.width.toFixed(0)} × {customRecordingBounds.height.toFixed(0)} px
                <br />
                位置: ({customRecordingBounds.x.toFixed(0)}, {customRecordingBounds.y.toFixed(0)})
              </div>

              {/* 录制范围调整控件 */}
              <div className="recording-bounds-controls">
                <div className="recording-bounds-controls-title">调整录制范围:</div>
                <div className="recording-bounds-grid">
                  <div className="recording-bounds-input-group">
                    <label>X:</label>
                    <input
                        type="number"
                        value={customRecordingBounds.x}
                        onChange={(e) => setCustomRecordingBounds(prev => ({ ...prev, x: Number(e.target.value) }))}
                        className="recording-bounds-input"
                    />
                  </div>
                  <div className="recording-bounds-input-group">
                    <label>Y:</label>
                    <input
                        type="number"
                        value={customRecordingBounds.y}
                        onChange={(e) => setCustomRecordingBounds(prev => ({ ...prev, y: Number(e.target.value) }))}
                        className="recording-bounds-input"
                    />
                  </div>
                  <div className="recording-bounds-input-group">
                    <label>宽度:</label>
                    <input
                        type="number"
                        value={customRecordingBounds.width}
                        onChange={(e) => setCustomRecordingBounds(prev => ({ ...prev, width: Number(e.target.value) }))}
                        className="recording-bounds-input"
                    />
                  </div>
                  <div className="recording-bounds-input-group">
                    <label>高度:</label>
                    <input
                        type="number"
                        value={customRecordingBounds.height}
                        onChange={(e) => setCustomRecordingBounds(prev => ({ ...prev, height: Number(e.target.value) }))}
                        className="recording-bounds-input"
                    />
                  </div>
                </div>

                {/* 预设按钮 */}
                <div className="preset-buttons">
                  <button
                      onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 800, height: 600 })}
                      className="preset-button"
                  >
                    800×600
                  </button>
                  <button
                      onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 1920, height: 1080 })}
                      className="preset-button"
                  >
                    1920×1080
                  </button>
                  <button
                      onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 1280, height: 720 })}
                      className="preset-button"
                  >
                    1280×720
                  </button>
                </div>

                {/* 重置为模型边框按钮 */}
                <button
                    onClick={() => {
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
                    }}
                    className="reset-button"
                >
                  重置为模型边框
                </button>
              </div>
            </>
        )}

        {/* 录制质量设置 */}
        <div className="recording-quality-section">
          <div className="recording-quality-title">录制质量:</div>
          <div className="recording-quality-options">
            <label className="recording-quality-option">
              <input
                  type="radio"
                  name="quality"
                  value="low"
                  checked={recordingQuality === "low"}
                  onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
                  className="recording-quality-radio"
              />
              低 (24fps)
            </label>
            <label className="recording-quality-option">
              <input
                  type="radio"
                  name="quality"
                  value="medium"
                  checked={recordingQuality === "medium"}
                  onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
                  className="recording-quality-radio"
              />
              中 (30fps)
            </label>
            <label className="recording-quality-option">
              <input
                  type="radio"
                  name="quality"
                  value="high"
                  checked={recordingQuality === "high"}
                  onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
                  className="recording-quality-radio"
              />
              高 (60fps)
            </label>
          </div>
        </div>

        <div className="recording-bounds-settings">
          <input
              type="checkbox"
              id="transparentBg"
              checked={transparentBg}
              onChange={(e) => setTransparentBg(e.target.checked)}
              className="transparent-bg-checkbox"
          />
          <label htmlFor="transparentBg" className="transparent-bg-label">
            透明背景
          </label>
        </div>

        {recState !== "rec" ? (
            <button
                onClick={start}
                disabled={!isVp9AlphaSupported()}
                className="record-button"
            >
              ⬤ 开始录制（VP9 透明）
            </button>
        ) : (
            <button
                onClick={stop}
                className="stop-button"
            >
              ■ 停止录制
            </button>
        )}

        {recState === "rec" && (
            <div className="recording-progress">
              <div>录制中... {recordingTime.toFixed(1)}s</div>
              <div className="recording-progress-bar">
                <div 
                  className="recording-progress-fill"
                  style={{ width: `${recordingProgress}%` }}
                />
              </div>
            </div>
        )}

        <button
            onClick={saveWebM}
            disabled={!blob}
            className="download-button"
        >
          下载 WebM（透明）
        </button>

        <button
            onClick={toMov}
            disabled={!blob}
            className="convert-button"
        >
          转 MOV（ProRes 4444）
        </button>
      </div>

      {!showControls && (
          <button className="l2d-toggle" onClick={() => setShowControls(true)}>
            🎛️ 显示控制面板
          </button>
      )}
    </div>
);
}
