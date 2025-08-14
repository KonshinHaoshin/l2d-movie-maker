import React from 'react';
import { Live2DModel } from "pixi-live2d-display";

interface Clip {
  id: string;
  name: string;
  start: number;
  duration: number;
  audioUrl?: string;
}

interface AudioManagerProps {
  modelRef: React.MutableRefObject<Live2DModel | Live2DModel[] | null>;
  audioClips: Clip[];
  setCurrentAudioLevel: (level: number) => void;
}

export default function AudioManager({
  modelRef,
  audioClips,
  setCurrentAudioLevel
}: AudioManagerProps) {
  
  // 音频引用和分析器引用
  const audioRefs = React.useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const audioAnalyzersRef = React.useRef<Map<string, { source: MediaElementAudioSourceNode; analyzer: AnalyserNode }>>(new Map());
  const mouthAnimationRef = React.useRef<{ audioLevel: number; lastUpdate: number }>({ audioLevel: 0, lastUpdate: 0 });

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

  // 遍历模型的工具函数
  const forEachModel = (fn: (m: Live2DModel) => void) => {
    const cur = modelRef.current;
    if (!cur) return;
    if (Array.isArray(cur)) cur.forEach(fn);
    else fn(cur as Live2DModel);
  };

  // 添加音频片段
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
          start: 0, // 这里需要从外部传入
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
        
        // 这里需要调用外部的添加函数
        console.log('音频片段创建成功:', audioClip);
      };
      
      input.click();
    } catch (error) {
      console.error('导入音频失败:', error);
      alert('导入音频失败: ' + error);
    }
  };

  // 清理音频引用
  const cleanupAudio = () => {
    audioRefs.current.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    audioRefs.current.clear();
    
    audioAnalyzersRef.current.forEach(({ source, analyzer }) => {
      try {
        source.disconnect();
        analyzer.disconnect();
      } catch {}
    });
    audioAnalyzersRef.current.clear();
    
    resetMouthAnimation();
  };

  // 停止所有音频播放
  const stopAllAudio = () => {
    audioRefs.current.forEach(audio => {
      if (!audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    resetMouthAnimation();
  };

  // 音频分析和嘴部动画处理
  const processAudioAnimation = (t: number) => {
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
  };

  // 音频播放控制
  const playAudioAtTime = (t: number) => {
    audioClips.forEach(clip => {
      const audioElement = audioRefs.current.get(clip.id);
      if (!audioElement) return;
      
      if (t >= clip.start && t < clip.start + clip.duration) {
        // 如果音频还没开始播放，开始播放
        if (audioElement.paused) {
          audioElement.currentTime = t - clip.start;
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
    });
  };

  return {
    audioRefs,
    audioContextRef,
    audioAnalyzersRef,
    mouthAnimationRef,
    initAudioContext,
    applyMouthAnimation,
    resetMouthAnimation,
    addAudioClip,
    cleanupAudio,
    stopAllAudio,
    processAudioAnimation,
    playAudioAtTime
  };
} 