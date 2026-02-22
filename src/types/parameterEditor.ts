// 参数编辑器类型定义

export interface ModelParameter {
  id: string;
  name: string;
  type: 'float' | 'int' | 'bool';
  min: number;
  max: number;
  defaultValue: number;
  currentValue: number;
}

export interface ParameterKeyframe {
  time: number;      // 秒
  value: number;
  curve?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface ParameterTrack {
  parameterId: string;
  keyframes: ParameterKeyframe[];
}

export interface ParameterEditorState {
  parameters: ModelParameter[];
  tracks: ParameterTrack[];
}
