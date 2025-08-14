// src/utils/webgalParser.ts
import { normalizePath } from "./fs";
import { getFigureResourceUrl } from "../config/ports";

export type WebGALCommand =
  | {
      type: "changeFigure";
      lineNumber: number;
      data: {
        id?: string;
        path: string;         // 模型路径（相对于figure文件夹）
        motion?: string;
        expression?: string;
      };
    }
  | {
      type: "dialogue";
      lineNumber: number;
      data: {
        speaker?: string;
        text: string;
        audioPath?: string;   // 语音文件路径（可相对）
      };
    };

export class WebGALParser {
  /** 解析一段脚本（支持 changeFigure: 与 "角色:台词 … -xxx.wav …"） */
  public parseScript(script: string): WebGALCommand[] {
    const out: WebGALCommand[] = [];
    const lines = script.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;

      // changeFigure: xxx.jsonl -id=anon -motion=... -expression=...
      if (/^changeFigure\s*:/.test(raw)) {
        const m = raw.match(/^changeFigure\s*:\s*([^;\n]+)(?:;|$)/i);
        if (!m) continue;
        const payload = m[1]; // e.g. 改模/拼好模/大棉袄/大棉袄.jsonl -id=anon -motion=xxx -expression=yyy
        const tokens = payload.split(/\s+/);

        const path = tokens.shift() || "";
        let id: string | undefined;
        let motion: string | undefined;
        let expression: string | undefined;

        for (const t of tokens) {
          const kv = t.split("=");
          if (kv.length === 2) {
            const k = kv[0].replace(/^-+/, "").toLowerCase();
            const v = kv[1];
            if (k === "id") id = v;
            else if (k === "motion") motion = v;
            else if (k === "expression") expression = v;
          }
        }

        out.push({
          type: "changeFigure",
          lineNumber: i + 1,
          data: {
            id,
            path: normalizePath(path),
            motion,
            expression,
          },
        });
        continue;
      }

      // 对话： 角色:台词  ... -xxx/yyy.wav ...
      // 例：千早爱音:xxx -anon/wjzs2/anon_wjzs2_09.wav
      const dm = raw.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (dm) {
        const speaker = dm[1].trim();
        let rest = dm[2].trim();
        let audioPath: string | undefined;

        // 捕获形如 "-xxx/yyy.wav" 的片段
        const am = rest.match(/-(.+?\.(?:wav|mp3|ogg|m4a))/i);
        if (am) {
          audioPath = normalizePath(am[1]);
          // 去掉音频标记
          rest = rest.replace(am[0], "").trim();
        }

        out.push({
          type: "dialogue",
          lineNumber: i + 1,
          data: {
            speaker,
            text: rest,
            audioPath,
          },
        });
        continue;
      }

      // 其他行暂不处理，可扩展
    }

    return out;
  }

  /** 解析模型路径为完整的figure路径，支持中文 */
  public resolveFigurePath(p: string): string {
    p = normalizePath(p);
    
    // 使用正确的端口构建完整URL
    const fullUrl = getFigureResourceUrl(p);
    console.log(`🔗 构建完整URL: ${fullUrl}`);
    
    return fullUrl;
  }

  /** 解析音频路径 */
  public resolveAudioPath(p: string | undefined): string | undefined {
    if (!p) return undefined;
    p = normalizePath(p);
    // 直接返回相对路径
    return p;
  }
}
