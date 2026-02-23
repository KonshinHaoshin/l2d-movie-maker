export type Clip = {
    id: string;
    name: string;     // 动作组名 或 表情名 或 音频文件名
    start: number;    // 秒
    duration: number; // 秒
    // 音频特有属性
    audioUrl?: string; // 音频文件URL
    audioBuffer?: AudioBuffer; // 音频缓冲区
};

export type TrackKind = "motion" | "expr" | "audio";
