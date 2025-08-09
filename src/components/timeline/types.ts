export type Clip = {
    id: string;
    name: string;     // 动作组名 或 表情名
    start: number;    // 秒
    duration: number; // 秒
};

export type TrackKind = "motion" | "expr";
