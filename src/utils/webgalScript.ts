import { normalizePath } from "./fs";

const AUDIO_EXT_RE = /\.(wav|mp3|ogg|m4a)$/i;

export type WebGALChangeFigureCommand = {
  type: "changeFigure";
  lineNumber: number;
  rawText: string;
  data: {
    id?: string;
    path: string;
    motion?: string;
    expression?: string;
  };
};

export type WebGALDialogueCommand = {
  type: "dialogue";
  lineNumber: number;
  rawText: string;
  data: {
    speaker: string;
    text: string;
    audioPath?: string;
    figureId?: string;
  };
};

export type WebGALNarrationCommand = {
  type: "narration";
  lineNumber: number;
  rawText: string;
  data: {
    text: string;
  };
};

export type WebGALCommand =
  | WebGALChangeFigureCommand
  | WebGALDialogueCommand
  | WebGALNarrationCommand;

type ParseOptions = {
  roleNameMap?: Record<string, string>;
};

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function buildSpeakerLookup(roleNameMap: Record<string, string> | undefined): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!roleNameMap) return lookup;

  for (const [id, name] of Object.entries(roleNameMap)) {
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) continue;
    lookup.set(normalizeSpeakerKey(trimmedName), trimmedId);
  }

  return lookup;
}

function stripLineEnding(line: string): string {
  return line.trim().replace(/;+\s*$/, "");
}

function parseFlagToken(token: string): { key: string; value?: string } | null {
  if (!token.startsWith("-")) return null;
  const body = token.slice(1);
  if (!body) return null;
  const eqIndex = body.indexOf("=");
  if (eqIndex === -1) {
    return { key: body.toLowerCase() };
  }

  const key = body.slice(0, eqIndex).trim().toLowerCase();
  const value = body.slice(eqIndex + 1).trim();
  return key ? { key, value } : null;
}

export class WebGALParser {
  public parseScript(script: string, options: ParseOptions = {}): WebGALCommand[] {
    const commands: WebGALCommand[] = [];
    const lines = script.split(/\r?\n/);
    const speakerLookup = buildSpeakerLookup(options.roleNameMap);

    for (let index = 0; index < lines.length; index += 1) {
      const rawText = lines[index].trim();
      if (!rawText) continue;

      const content = stripLineEnding(rawText);
      if (!content) continue;

      if (/^changeFigure\s*:/i.test(content)) {
        const match = content.match(/^changeFigure\s*:\s*(.+)$/i);
        if (!match) continue;

        const tokens = match[1].split(/\s+/).filter(Boolean);
        const path = normalizePath(tokens.shift() ?? "");
        if (!path) continue;

        let id: string | undefined;
        let motion: string | undefined;
        let expression: string | undefined;

        for (const token of tokens) {
          const flag = parseFlagToken(token);
          if (!flag?.value) continue;
          if (flag.key === "id") id = flag.value;
          if (flag.key === "motion") motion = flag.value;
          if (flag.key === "expression") expression = flag.value;
        }

        commands.push({
          type: "changeFigure",
          lineNumber: index + 1,
          rawText,
          data: {
            id,
            path,
            motion,
            expression,
          },
        });
        continue;
      }

      const dialogueMatch = content.match(/^([^:：]*)\s*[:：]\s*(.+)$/);
      if (!dialogueMatch) continue;

      const speaker = dialogueMatch[1].trim();
      const tokens = dialogueMatch[2].trim().split(/\s+/).filter(Boolean);
      const textTokens: string[] = [];
      let audioPath: string | undefined;
      let figureId: string | undefined;

      for (const token of tokens) {
        if (!token.startsWith("-")) {
          textTokens.push(token);
          continue;
        }

        const strippedToken = token.slice(1);
        if (!audioPath && AUDIO_EXT_RE.test(strippedToken)) {
          audioPath = normalizePath(strippedToken);
          continue;
        }

        const flag = parseFlagToken(token);
        if (!flag) continue;
        if (flag.key === "figureid" && flag.value) {
          figureId = flag.value;
          continue;
        }
        if (flag.key === "id" && flag.value && !figureId) {
          figureId = flag.value;
          continue;
        }
      }

      const text = textTokens.join(" ").trim();
      if (!speaker) {
        if (!text) continue;
        commands.push({
          type: "narration",
          lineNumber: index + 1,
          rawText,
          data: { text },
        });
        continue;
      }

      if (!figureId) {
        figureId = speakerLookup.get(normalizeSpeakerKey(speaker));
      }

      commands.push({
        type: "dialogue",
        lineNumber: index + 1,
        rawText,
        data: {
          speaker,
          text,
          audioPath,
          figureId,
        },
      });
    }

    return commands;
  }
}

