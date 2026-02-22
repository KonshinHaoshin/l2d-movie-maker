// WebGAL 脚本解析器
// 将 WebGAL 脚本解析为时间线命令

import { Clip } from "../components/timeline/types";

export type WebGALCommandType = 
  | "changeFigure"  // 切换模型
  | "changeMotion"  // 切换动作
  | "changeExpression"  // 切换表情
  | "dialogue"      // 对话（生成音频 clip）
  | "setPosition"   // 设置位置
  | "setScale"      // 设置缩放
  | "fadeIn"        // 淡入
  | "fadeOut";      // 淡出

export interface WebGALCommand {
  type: WebGALCommandType;
  lineNumber: number;
  characterId?: string;  // 对应的角色 ID
  startTime: number;     // 在时间线上的开始时间
  data: {
    // changeFigure
    path?: string;
    // changeMotion / changeExpression
    name?: string;
    // dialogue
    speaker?: string;
    text?: string;
    audioPath?: string;
    // setPosition / setScale
    x?: number;
    y?: number;
    scale?: number;
    // fade
    duration?: number;
    // 通用
    [key: string]: any;
  };
}

export class WebGALParser {
  private audioOffset = 0;  // 当前音频累积偏移

  /** 解析脚本，返回命令列表 */
  public parseScript(script: string): WebGALCommand[] {
    const commands: WebGALCommand[] = [];
    const lines = script.split(/\r?\n/);
    let currentTime = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith("//")) continue;

      // 1. changeFigure: 路径 -id=xxx -motion=xxx -expression=xxx
      if (/^changeFigure\s*:/.test(raw)) {
        const cmd = this.parseChangeFigure(raw, i + 1, currentTime);
        if (cmd) commands.push(cmd);
        continue;
      }

      // 2. setPosition: x,y 或 setPosition:x,y
      if (/^setPosition\s*:?/i.test(raw)) {
        const cmd = this.parseSetPosition(raw, i + 1, currentTime);
        if (cmd) commands.push(cmd);
        continue;
      }

      // 3. setScale: value
      if (/^setScale\s*:?/i.test(raw)) {
        const cmd = this.parseSetScale(raw, i + 1, currentTime);
        if (cmd) commands.push(cmd);
        continue;
      }

      // 4. 对话: 角色:台词 -音频路径
      const dialogueMatch = raw.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (dialogueMatch) {
        const cmd = this.parseDialogue(dialogueMatch[1], dialogueMatch[2], i + 1, currentTime);
        if (cmd) {
          commands.push(cmd);
          // 更新当前时间（基于音频长度或默认对话时长）
          currentTime += cmd.data.duration || 3;
        }
        continue;
      }

      // 5. 纯音频: -xxx.wav（不带对话）
      const audioMatch = raw.match(/^-\s*(.+\.wav|.+\.mp3)/i);
      if (audioMatch) {
        // 简单的音频片，等待默认时长
        currentTime += 3;
      }
    }

    return commands;
  }

  private parseChangeFigure(raw: string, lineNumber: number, startTime: number): WebGALCommand | null {
    const match = raw.match(/^changeFigure\s*:\s*([^;]+)(;|$)/i);
    if (!match) return null;

    const payload = match[1].trim();
    const tokens = payload.split(/\s+/);
    const path = tokens.shift() || "";

    let id: string | undefined;
    let motion: string | undefined;
    let expression: string | undefined;

    for (const token of tokens) {
      const [key, value] = token.split("=");
      if (!key || !value) continue;
      const k = key.replace(/^-+/, "").toLowerCase();
      if (k === "id") id = value;
      else if (k === "motion") motion = value;
      else if (k === "expression") expression = value;
    }

    return {
      type: "changeFigure",
      lineNumber,
      characterId: id,
      startTime,
      data: { path, motion, expression }
    };
  }

  private parseSetPosition(raw: string, lineNumber: number, startTime: number): WebGALCommand | null {
    const match = raw.match(/^setPosition\s*:?\s*([\d.-]+)\s*,\s*([\d.-]+)/i);
    if (!match) return null;

    return {
      type: "setPosition",
      lineNumber,
      startTime,
      data: {
        x: parseFloat(match[1]),
        y: parseFloat(match[2])
      }
    };
  }

  private parseSetScale(raw: string, lineNumber: number, startTime: number): WebGALCommand | null {
    const match = raw.match(/^setScale\s*:?\s*([\d.]+)/i);
    if (!match) return null;

    return {
      type: "setScale",
      lineNumber,
      startTime,
      data: { scale: parseFloat(match[1]) }
    };
  }

  private parseDialogue(speaker: string, content: string, lineNumber: number, startTime: number): WebGALCommand | null {
    // 提取音频路径：-xxx.wav 或 -xxx.mp3
    const audioMatch = content.match(/-\s*(.+?\.(?:wav|mp3|ogg))/i);
    let audioPath: string | undefined;
    let text = content;

    if (audioMatch) {
      audioPath = audioMatch[1].trim();
      text = content.replace(audioMatch[0], "").trim();
    }

    // 估算对话时长（有音频用音频长度，否则默认 3 秒）
    const duration = audioPath ? 3 : 3;

    return {
      type: "dialogue",
      lineNumber,
      startTime,
      data: {
        speaker: speaker.trim(),
        text: text.trim(),
        audioPath,
        duration
      }
    };
  }

  /** 将命令转换为时间线 clips */
  public commandsToClips(commands: WebGALCommand[], characterId: string): Clip[] {
    const clips: Clip[] = [];

    for (const cmd of commands) {
      if (cmd.type === "changeFigure") {
        // 解析模型路径，获取模型名
        const modelPath = cmd.data.path || "";
        const modelName = modelPath.split("/").pop()?.replace(/\.(jsonl|json)$/i, "") || "model";
        
        clips.push({
          id: `clip_${cmd.lineNumber}`,
          kind: "model" as const,
          start: cmd.startTime,
          duration: 0.1,
          name: modelName,
          modelUrl: modelPath,
        });
      }

      if (cmd.type === "changeMotion" && cmd.data.name) {
        clips.push({
          id: `clip_${cmd.lineNumber}`,
          kind: "motion" as const,
          start: cmd.startTime,
          duration: -1,  // 循环播放
          name: cmd.data.name,
          targetCharacter: cmd.characterId,
        });
      }

      if (cmd.type === "changeExpression" && cmd.data.name) {
        clips.push({
          id: `clip_${cmd.lineNumber}`,
          kind: "expression" as const,
          start: cmd.startTime,
          duration: -1,
          name: cmd.data.name,
          targetCharacter: cmd.characterId,
        });
      }

      if (cmd.type === "dialogue" && cmd.data.audioPath) {
        clips.push({
          id: `clip_${cmd.lineNumber}`,
          kind: "audio" as const,
          start: cmd.startTime,
          duration: cmd.data.duration || 3,
          name: cmd.data.audioPath.split("/").pop() || "audio",
          audioUrl: cmd.data.audioPath,
        });
      }
    }

    return clips;
  }
}
