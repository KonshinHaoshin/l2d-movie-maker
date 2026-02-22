// 参数编辑器组件 - 实时预览和关键帧曲线编辑
import React, { useState, useEffect, useCallback, useRef } from "react";
import type { Live2DModel } from "pixi-live2d-display";
import type { ParameterKeyframe, ParameterTrack } from "../../types/parameterEditor";

// 常见的 Live2D 参数（会被动态检测补充）
// 参数分组
const PARAM_GROUPS = {
  eye: ["Eye", "eye", "EyeL", "EyeR", "Blink"],
  mouth: ["Mouth", "mouth", "Lip", "lip"],
  brow: ["Brow", "brow", "Eyebrow", "eyebrow"],
  face: ["Face", "face", "Angle", "angle", "Head", "head"],
  hair: ["Hair", "hair", "Front", "Side", "Back"],
  body: ["Body", "body", "Breath", "breath", "Arm", "arm", "Hand", "hand"],
  other: []
};

const getParamGroup = (paramId: string): string => {
  for (const [group, keywords] of Object.entries(PARAM_GROUPS)) {
    if (keywords.some(kw => paramId.includes(kw))) {
      return group;
    }
  }
  return "other";
};

const COMMON_PARAMS = [
  "ParamAngleX", "ParamAngleY", "ParamAngleZ",
  "ParamEyeLOpen", "ParamEyeLSmile", "ParamEyeROpen", "ParamEyeRSmile",
  "ParamEyeBallX", "ParamEyeBallY",
  "ParamMouthOpen", "ParamMouthForm",
  "ParamCheek", "ParamBrowL", "ParamBrowR", "ParamBrowLX", "ParamBrowLY", "ParamBrowRX", "ParamBrowRY",
  "ParamHairFront", "ParamHairSide", "ParamHairBack",
  "ParamBreath", "ParamConfigFace",
];

interface ParameterEditorProps {
  model: Live2DModel | null;
  isComposite: boolean;
  subModels?: Live2DModel[];
  onParameterChange?: () => any[];
  onSetParameter?: (model: Live2DModel, paramId: string, value: number) => boolean;
  onTrackChange?: (tracks: ParameterTrack[]) => void;
}

export function ParameterEditor({ 
  model, 
  isComposite, 
  subModels = [],
  onParameterChange,
  onSetParameter,
  onTrackChange 
}: ParameterEditorProps) {
  const [parameters, setParameters] = useState<any[]>([]);
  const [selectedParam, setSelectedParam] = useState<string | null>(null);
  const [tracks, setTracks] = useState<ParameterTrack[]>([]);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCurves, setShowCurves] = useState(false);
  const previewRef = useRef<number | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);

  // 保存原始参数值（用于预览恢复）
  const originalValuesRef = useRef<Map<string, number>>(new Map());

  // 检测模型参数
  const detectParameters = useCallback(() => {
    // 如果提供了回调，使用回调获取参数
    if (onParameterChange) {
      const params = onParameterChange();
      setParameters(params);
      // 保存原始值
      params.forEach(p => originalValuesRef.current.set(p.id, p.value));
      return;
    }

    // 否则使用原有的检测逻辑
    if (!model) return;

    // 定义参数类型
    interface ParamInfo {
      id: string;
      name: string;
      value: number;
      min: number;
      max: number;
      modelIndex: number;
    }

    const params: ParamInfo[] = [];
    const visited = new Set<string>();

    // 遍历所有模型（主模型 + 子模型）
    const modelsToCheck = isComposite ? [model, ...subModels] : [model];

    modelsToCheck.forEach((m, modelIndex) => {
      if (!m) return;
      
      try {
        // 改进类型推断
        const modelAny = m as unknown as {
          internalModel?: {
            coreModel?: {
              _paramIds?: string[];
              getParamFloat?: (id: string) => number;
              getParamMinValue?: (id: string) => number;
              getParamMaxValue?: (id: string) => number;
            }
          }
        };
        
        const im = modelAny.internalModel;
        if (!im?.coreModel) return;

        const coreModel = im.coreModel;

        // 尝试获取参数列表
        let paramIds: string[] = [];
        
        if (coreModel._paramIds && Array.isArray(coreModel._paramIds)) {
          paramIds = coreModel._paramIds;
        } else {
          // 尝试从 Common params 获取
          paramIds = COMMON_PARAMS;
        }

        paramIds.forEach(paramId => {
          if (visited.has(paramId)) return;
          visited.add(paramId);

          try {
            const value = coreModel.getParamFloat?.(paramId) ?? 0;
            const min = coreModel.getParamMinValue?.(paramId) ?? -1;
            const max = coreModel.getParamMaxValue?.(paramId) ?? 1;
            
            originalValuesRef.current.set(paramId, value);

            params.push({
              id: paramId,
              name: paramId.replace(/^Param/, ""),
              value,
              min,
              max,
              modelIndex,
            });
          } catch {
            // 参数可能不存在
          }
        });
      } catch (e) {
        console.warn("检测参数失败:", e);
      }
    });

    setParameters(params);
  }, [model, isComposite, subModels, onParameterChange]);

  // 初始化检测参数
  useEffect(() => {
    if (model) {
      detectParameters();
      modelRef.current = model;
    }
  }, [model, detectParameters]);

  // 设置参数值
  const setParameterValue = useCallback((paramId: string, value: number) => {
    // 如果提供了回调，使用回调设置参数
    if (onSetParameter && model) {
      const modelsToUpdate = isComposite ? [model, ...subModels] : [model];
      modelsToUpdate.forEach(m => {
        if (m) onSetParameter(m, paramId, value);
      });
    } else {
      // 否则使用原有的直接设置逻辑
      const modelsToUpdate = isComposite ? [model, ...subModels] : [model];

      modelsToUpdate.forEach((m) => {
        if (!m) return;
        try {
          // 改进类型推断
          const modelAny = m as unknown as {
            internalModel?: {
              coreModel?: {
                setParamFloat?: (id: string, val: number) => void;
              }
            }
          };
          const im = modelAny.internalModel;
          if (im?.coreModel?.setParamFloat) {
            im.coreModel.setParamFloat(paramId, value);
          }
        } catch {
          // 忽略错误
        }
      });
    }

    // 更新本地状态
    setParameters(prev => prev.map(p => 
      p.id === paramId ? { ...p, value } : p
    ));
  }, [model, isComposite, subModels, onSetParameter]);

  // 滑块改变时实时预览
  const handleSliderChange = (paramId: string, value: number) => {
    setParameterValue(paramId, value);
  };

  // 滑块松开时恢复原始值（如果需要）
  const handleSliderCommit = (paramId: string, value: number) => {
    // 可以选择保存到关键帧轨道
    addKeyframe(paramId, previewTime, value);
  };

  // 添加关键帧
  const addKeyframe = (paramId: string, time: number, value: number) => {
    setTracks(prev => {
      const existing = prev.find(t => t.parameterId === paramId);
      if (existing) {
        // 更新或添加关键帧
        const newKeyframes = [...existing.keyframes, { time, value }].sort((a, b) => a.time - b.time);
        const updated = { ...existing, keyframes: newKeyframes };
        onTrackChange?.(prev.map(t => t.parameterId === paramId ? updated : t));
        return prev.map(t => t.parameterId === paramId ? updated : t);
      } else {
        // 新建轨道
        const newTrack: ParameterTrack = { parameterId: paramId, keyframes: [{ time, value }] };
        onTrackChange?.([...prev, newTrack]);
        return [...prev, newTrack];
      }
    });
  };

  // 预览播放
  useEffect(() => {
    if (isPlaying) {
      previewRef.current = window.setInterval(() => {
        setPreviewTime(t => {
          const newTime = t + 0.1;
          // 应用关键帧
          tracks.forEach(track => {
            const value = getInterpolatedValue(track, newTime);
            if (value !== null) {
              setParameterValue(track.parameterId, value);
            }
          });
          return newTime;
        });
      }, 100);
    } else {
      if (previewRef.current) {
        clearInterval(previewRef.current);
        previewRef.current = null;
      }
    }

    return () => {
      if (previewRef.current) {
        clearInterval(previewRef.current);
      }
    };
  }, [isPlaying, tracks]);

  // 计算插值
  const getInterpolatedValue = (track: ParameterTrack, time: number): number | null => {
    const { keyframes } = track;
    if (keyframes.length === 0) return null;

    // 找到前后关键帧
    let prev = keyframes[0];
    let next = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (keyframes[i].time <= time && keyframes[i + 1].time >= time) {
        prev = keyframes[i];
        next = keyframes[i + 1];
        break;
      }
    }

    if (time <= prev.time) return prev.value;
    if (time >= next.time) return next.value;

    // 线性插值
    const ratio = (time - prev.time) / (next.time - prev.time);
    return prev.value + (next.value - prev.value) * ratio;
  };

  // 恢复所有参数
  // 保存预设
  const savePreset = () => {
    const presetName = prompt("输入预设名称:");
    if (!presetName) return;

    const preset = {
      name: presetName,
      timestamp: Date.now(),
      parameters: parameters.map(p => ({
        id: p.id,
        value: p.value
      }))
    };

    // 保存到 localStorage
    const presets = JSON.parse(localStorage.getItem("l2d_param_presets") || "[]");
    presets.push(preset);
    localStorage.setItem("l2d_param_presets", JSON.stringify(presets));

    alert(`预设 "${presetName}" 已保存！`);
  };

  // 加载预设
  const loadPreset = () => {
    const presets = JSON.parse(localStorage.getItem("l2d_param_presets") || "[]");
    if (presets.length === 0) {
      alert("没有保存的预设");
      return;
    }

    const presetNames = presets.map((p: any) => p.name).join("\n");
    const selected = prompt(`选择预设名称:\n${presetNames}\n\n输入名称:`);
    if (!selected) return;

    const preset = presets.find((p: any) => p.name === selected);
    if (!preset) {
      alert("未找到该预设");
      return;
    }

    // 应用预设
    preset.parameters.forEach((p: any) => {
      setParameterValue(p.id, p.value);
    });

    // 更新原始值
    preset.parameters.forEach((p: any) => {
      originalValuesRef.current.set(p.id, p.value);
    });

    alert(`已加载预设 "${selected}"`);
  };

  // 删除预设
  const deletePreset = () => {
    const presets = JSON.parse(localStorage.getItem("l2d_param_presets") || "[]");
    if (presets.length === 0) {
      alert("没有保存的预设");
      return;
    }

    const presetNames = presets.map((p: any) => p.name).join("\n");
    const selected = prompt(`输入要删除的预设名称:\n${presetNames}`);
    if (!selected) return;

    const newPresets = presets.filter((p: any) => p.name !== selected);
    localStorage.setItem("l2d_param_presets", JSON.stringify(newPresets));

    alert(`已删除预设 "${selected}"`);
  };

  // 导出关键帧为 JSON
  const exportKeyframes = () => {
    if (tracks.length === 0) {
      alert("没有关键帧可导出");
      return;
    }

    const exportData = {
      version: 1,
      exportTime: Date.now(),
      tracks: tracks
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keyframes_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入关键帧 JSON
  const importKeyframes = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.tracks && Array.isArray(data.tracks)) {
            setTracks(data.tracks);
            alert(`导入了 ${data.tracks.length} 条轨道`);
          } else {
            alert("无效的关键帧文件");
          }
        } catch (err) {
          alert("解析文件失败: " + err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // 清除所有关键帧
  const clearAllKeyframes = () => {
    if (confirm("确定清除所有关键帧?")) {
      setTracks([]);
    }
  };

  // 导出到时间线（作为 param 类型的 clips）
  const exportToTimeline = (): any[] => {
    const clips: any[] = [];
    
    tracks.forEach(track => {
      track.keyframes.forEach(kf => {
        clips.push({
          id: `param_${kf.time}_${track.parameterId}`,
          kind: "param",
          name: track.parameterId,
          start: kf.time,
          duration: 0.1, // 参数 clip 很短
          paramId: track.parameterId,
          paramValue: kf.value
        });
      });
    });
    
    return clips;
  };

  // 显示导出的 clips（用于复制）
  const showExportedClips = () => {
    const clips = exportToTimeline();
    const json = JSON.stringify(clips, null, 2);
    console.log("导出的参数 clips:", clips);
    alert(`已生成 ${clips.length} 个参数 clips\n查看控制台获取 JSON`);
  };

  const restoreAllParameters = useCallback(() => {
    originalValuesRef.current.forEach((value, paramId) => {
      setParameterValue(paramId, value);
    });
  }, [setParameterValue]);

  // 切换到指定参数
  const selectParameter = (paramId: string) => {
    setSelectedParam(paramId);
    const param = parameters.find(p => p.id === paramId);
    if (param) {
      setParameterValue(paramId, param.value);
    }
  };

  return (
    <div className="parameter-editor">
      <div className="parameter-editor-header">
        <h3>🎛️ 参数编辑器</h3>
        <div className="parameter-editor-actions">
          <button onClick={() => setShowCurves(!showCurves)}>
            {showCurves ? "隐藏曲线" : "显示曲线"}
          </button>
          <button onClick={detectParameters}>🔄</button>
          <button onClick={restoreAllParameters}>↩️</button>
          <button onClick={savePreset}>💾</button>
          <button onClick={loadPreset}>📂</button>
          <button onClick={deletePreset}>🗑️</button>
        </div>
      </div>

      {/* 关键帧操作栏 */}
      {showCurves && (
        <div className="keyframe-actions">
          <button onClick={exportKeyframes}>⬇️ 导出</button>
          <button onClick={importKeyframes}>⬆️ 导入</button>
          <button onClick={showExportedClips}>📋 复制</button>
          <button onClick={clearAllKeyframes}>🗑️ 清除</button>
        </div>
      )}

      {/* 预览时间轴 */}
      <div className="parameter-preview-timeline">
        <button onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? "⏸ 暂停" : "▶ 播放"}
        </button>
        <span className="preview-time">{previewTime.toFixed(1)}s</span>
        <input
          type="range"
          min="0"
          max="10"
          step="0.1"
          value={previewTime}
          onChange={(e) => setPreviewTime(parseFloat(e.target.value))}
          className="preview-slider"
        />
      </div>

      {/* 参数列表 */}
      <div className="parameter-list">
        {parameters.length === 0 ? (
          <div className="parameter-list-empty">
            加载参数中... 或模型不支持
          </div>
        ) : (
          // 按分组显示参数
          (() => {
            // 分组
            const grouped: Record<string, typeof parameters> = {};
            parameters.forEach(p => {
              const group = getParamGroup(p.id);
              if (!grouped[group]) grouped[group] = [];
              grouped[group].push(p);
            });
            
            const groupLabels: Record<string, string> = {
              eye: "👁️ 眼睛",
              mouth: "👄 嘴巴",
              brow: "🩹 眉毛",
              face: "🎭 脸部",
              hair: "💇 头发",
              body: "🧘 身体",
              other: "🔧 其他"
            };
            
            return Object.entries(grouped).map(([group, params]) => (
              <div key={group} className="parameter-group">
                <div className="parameter-group-header">
                  {groupLabels[group] || group}
                </div>
                {params.map(param => (
                  <div 
                    key={param.id} 
                    className={`parameter-item ${selectedParam === param.id ? "selected" : ""}`}
                    onClick={() => selectParameter(param.id)}
                  >
                    <div className="parameter-name">
                      {param.name}
                      {isComposite && <span className="model-badge">#{param.modelIndex}</span>}
                    </div>
                    <div className="parameter-control">
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step="0.01"
                        value={param.value}
                        onChange={(e) => handleSliderChange(param.id, parseFloat(e.target.value))}
                        onMouseUp={(e) => handleSliderCommit(param.id, parseFloat((e.target as HTMLInputElement).value))}
                        className="parameter-slider"
                      />
                      <span className="parameter-value">{param.value.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()
        )}
      </div>
            </div>
          ))
        )}
      </div>

      {/* 曲线编辑器 */}
      {showCurves && (
        <div className="parameter-curves">
          <h4>🎢 关键帧曲线</h4>
          {tracks.length === 0 ? (
            <div className="curves-empty">
              在参数上拖动滑块添加关键帧
            </div>
          ) : (
            tracks.map(track => (
              <div key={track.parameterId} className="curve-track">
                <div className="curve-header">
                  <span>{track.parameterId}</span>
                  <span className="keyframe-count">{track.keyframes.length} 个关键帧</span>
                </div>
                <div className="curve-canvas">
                  {/* 简化的曲线可视化 */}
                  <svg viewBox="0 0 200 50" className="curve-svg">
                    {track.keyframes.map((kf, i) => {
                      const x = (kf.time / 10) * 200;
                      const y = 50 - ((kf.value + 1) / 2) * 50;
                      return (
                        <circle 
                          key={i} 
                          cx={x} 
                          cy={y} 
                          r="3" 
                          fill="#0d6efd"
                          onClick={() => {
                            setTracks(prev => prev.map(t => 
                              t.parameterId === track.parameterId 
                                ? { ...t, keyframes: t.keyframes.filter((_, idx) => idx !== i) }
                                : t
                            ));
                          }}
                        />
                      );
                    })}
                    {track.keyframes.length > 1 && (
                      <polyline
                        points={track.keyframes.map(kf => {
                          const x = (kf.time / 10) * 200;
                          const y = 50 - ((kf.value + 1) / 2) * 50;
                          return `${x},${y}`;
                        }).join(" ")}
                        fill="none"
                        stroke="#0d6efd"
                        strokeWidth="1"
                      />
                    )}
                  </svg>
                </div>
              </div>
            ))}
          )}
        </div>
      )}
    </div>
  );
}
