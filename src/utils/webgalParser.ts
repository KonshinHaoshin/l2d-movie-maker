// src/utils/webgalParser.ts
import { readText, fileExists, pathJoin, normalizePath } from "./fs";
import { invoke } from "@tauri-apps/api/core";

export type WebGALCommand =
  | {
      type: "changeFigure";
      lineNumber: number;
      data: {
        id?: string;
        path: string;         // 模型路径（可相对）
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
  // ✅ 用普通私有字段代替"参数属性"
  private gameDir: string;

  constructor(gameDir: string) {
    // 不对游戏目录进行路径标准化，保持原始格式
    this.gameDir = gameDir;
    // 尝试设置文件系统作用域
    this.setupFileSystemScope();
  }

  /** 设置文件系统作用域，允许访问游戏目录 */
  private async setupFileSystemScope() {
    try {
      // 使用 Tauri 命令设置文件系统作用域
      await invoke('set_fs_scope', { 
        path: this.gameDir,
        recursive: true 
      });
      console.log('✅ 文件系统作用域设置成功:', this.gameDir);
    } catch (error) {
      console.warn('⚠️ 文件系统作用域设置失败:', error);
    }
  }

  /** 解析一段脚本（支持 changeFigure: 与 “角色:台词 … -xxx.wav …”） */
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

  /** 直接测试文件访问，绕过路径解析 */
  public async testDirectFileAccess(filePath: string): Promise<boolean> {
    try {
      console.log('🧪 直接测试文件访问:', filePath);
      
      // 尝试直接读取文件
      const content = await readText(filePath);
      console.log('✅ 直接访问成功，文件大小:', content.length);
      return true;
    } catch (error) {
      console.log('❌ 直接访问失败:', error);
      return false;
    }
  }

  /** 解析模型 json/jsonl 文件（支持绝对或相对 game/figure/）并返回文本 */
  public async loadModelFile(modelPath: string): Promise<string> {
    try {
      const resolved = await this.resolveFigurePath(modelPath);
      console.log('📖 尝试读取模型文件:', resolved);
      
      // 验证路径是否安全（防止路径遍历攻击）
      if (resolved.includes('..') || resolved.includes('//')) {
        throw new Error(`不安全的路径: ${resolved}`);
      }
      
      const content = await readText(resolved);
      console.log('✅ 模型文件读取成功，大小:', content.length, '字符');
      return content;
    } catch (error) {
      console.error('❌ 模型文件读取失败:', {
        originalPath: modelPath,
        resolvedPath: modelPath, // 直接使用原始路径，避免重复解析
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /** 解析相对/绝对路径为完整可读路径（相对则默认 game/figure/） */
  public async resolveFigurePath(p: string): Promise<string> {
    p = normalizePath(p);
    console.log('🔍 解析路径:', p);
    
    // 绝对路径：存在即用（改进检测逻辑）
    if (/^[a-z]:\//i.test(p) || p.startsWith("/") || p.includes("\\")) {
      console.log('✅ 已经是绝对路径:', p);
      return p;
    }
    
    try {
      // 尝试多种路径组合
      const pathVariations = [
        // 1. game/figure/xxx
        await pathJoin(this.gameDir, "game", "figure", p),
        // 2. game/xxx
        await pathJoin(this.gameDir, "game", p),
        // 3. 直接在当前游戏目录下
        await pathJoin(this.gameDir, p)
      ];
      
      console.log('🔄 尝试的路径变体:', pathVariations);
      
      for (let i = 0; i < pathVariations.length; i++) {
        const path = pathVariations[i];
        console.log(`🔍 尝试路径 ${i + 1}:`, path);
        
        try {
          if (await fileExists(path)) {
            console.log(`✅ 路径 ${i + 1} 存在:`, path);
            return path;
          }
        } catch (error) {
          console.log(`⚠️ 路径 ${i + 1} 检查失败:`, error);
        }
      }
      
      // 如果都不存在，返回第一个拼接的路径
      console.log('⚠️ 所有路径都不存在，返回第一个:', pathVariations[0]);
      return pathVariations[0];
      
    } catch (error) {
      console.error('❌ 路径解析失败:', error);
      // 如果路径拼接失败，尝试直接返回原始路径
      return p;
    }
  }

  /** 把对话里的音频相对路径解析成绝对路径（默认 game/voice/ 或 game/** ） */
  public async resolveAudioPath(p: string | undefined): Promise<string | undefined> {
    if (!p) return undefined;
    p = normalizePath(p);
    if (/^[a-z]:\//i.test(p) || p.startsWith("/")) return p;

    // 常见放置：game/voice/、game/**（你可按项目结构调整）
    const voice1 = await pathJoin(this.gameDir, "game", "voice", p);
    if (await fileExists(voice1)) return voice1;

    const voice2 = await pathJoin(this.gameDir, "game", p);
    if (await fileExists(voice2)) return voice2;

    // 如果都不存在，返回默认拼出来的路径（上层失败时可提示）
    return voice2;
  }
}
