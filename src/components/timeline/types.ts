export type Clip = {
    id: string;
    name: string;     // 动作组名 或 表情名 或 音频文件名
    start: number;    // 秒
    duration: number; // 秒
    // 音频特有属性
    audioUrl?: string; // 音频文件URL
    audioBuffer?: AudioBuffer; // 音频缓冲区
    // 参数关键帧特有属性
    paramId?: string;    // 参数 ID (如 ParamAngleX)
    paramValue?: number; // 参数值
    // 目标角色（用于多角色）
    targetCharacter?: string; // 角色 ID
};

export type TrackKind = "motion" | "expr" | "audio" | "param";
