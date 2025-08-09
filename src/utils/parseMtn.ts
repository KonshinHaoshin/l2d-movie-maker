// utils/parseMtn.ts
export type MtnParseResult = {
    fps: number;
    frameCount: number;        // 取所有 PARAM 行中的最大帧数
    durationMs: number;
    globalFadeInMs?: number;
    globalFadeOutMs?: number;
    paramFadeInMs: Record<string, number>;
    paramFadeOutMs: Record<string, number>;
    paramLengths: Record<string, number>; // 每个 PARAM_* 的帧数
};

export function parseMtn(text: string): MtnParseResult {
    const lines = text
        .replace(/^\uFEFF/, "")    // 去掉 UTF-8 BOM
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

    let fps = 30;
    let globalFadeInMs: number | undefined;
    let globalFadeOutMs: number | undefined;

    const paramFadeInMs: Record<string, number> = {};
    const paramFadeOutMs: Record<string, number> = {};
    const paramLengths: Record<string, number> = {};

    const numList = (s: string) =>
        s.split(",").map(x => +x.trim()).filter(n => Number.isFinite(n));

    for (const line of lines) {
        if (line.startsWith("#")) continue;

        // 全局 fps
        const mFps = line.match(/^\$fps\s*=\s*(\d+(\.\d+)?)/i);
        if (mFps) {
            fps = parseFloat(mFps[1]);
            continue;
        }

        // 全局淡入淡出
        const mFI = line.match(/^\$fadein\s*=\s*(\d+)/i);
        if (mFI) {
            globalFadeInMs = parseInt(mFI[1], 10);
            continue;
        }
        const mFO = line.match(/^\$fadeout\s*=\s*(\d+)/i);
        if (mFO) {
            globalFadeOutMs = parseInt(mFO[1], 10);
            continue;
        }

        // 单参数淡入淡出覆盖：$fadein:PARAM_NAME=500
        const mPFI = line.match(/^\$fadein:([A-Z0-9_]+)\s*=\s*(\d+)/i);
        if (mPFI) {
            paramFadeInMs[mPFI[1]] = parseInt(mPFI[2], 10);
            continue;
        }
        const mPFO = line.match(/^\$fadeout:([A-Z0-9_]+)\s*=\s*(\d+)/i);
        if (mPFO) {
            paramFadeOutMs[mPFO[1]] = parseInt(mPFO[2], 10);
            continue;
        }

        // 参数行：PARAM_XXXX=1,2,3,...
        const mParam = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/i);
        if (mParam) {
            const name = mParam[1];
            const values = numList(mParam[2]);
            paramLengths[name] = values.length;
            continue;
        }
    }

    const frameCount =
        Object.values(paramLengths).length
            ? Math.max(...Object.values(paramLengths))
            : 0;

    const durationMs = frameCount > 0 ? (frameCount / fps) * 1000 : 0;

    return {
        fps,
        frameCount,
        durationMs,
        globalFadeInMs,
        globalFadeOutMs,
        paramFadeInMs,
        paramFadeOutMs,
        paramLengths,
    };
}
