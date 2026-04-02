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

const DIALOGUE_CONTROL_FLAGS = new Set([
  "id",
  "figureid",
  "fontsize",
  "next",
  "when",
  "concat",
  "notend",
  "hold",
  "voice",
]);

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

function unquoteToken(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function tokenizeCommandPayload(value: string): string[] {
  return value.match(/-(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) ?? [];
}

function splitLeadingSegment(payload: string): { leading: string; options: string } {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (quote) {
      if (char === quote && payload[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (!/\s/.test(char)) continue;

    let probe = index;
    while (probe < payload.length && /\s/.test(payload[probe])) {
      probe += 1;
    }
    if (probe >= payload.length || payload[probe] !== "-" || !/[a-z]/i.test(payload[probe + 1] ?? "")) {
      continue;
    }

    return {
      leading: payload.slice(0, index).trim(),
      options: payload.slice(probe).trim(),
    };
  }

  return { leading: payload.trim(), options: "" };
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
  const value = unquoteToken(body.slice(eqIndex + 1).trim());
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

        const { leading, options: optionText } = splitLeadingSegment(match[1]);
        const path = normalizePath(unquoteToken(leading));
        if (!path) continue;

        let id: string | undefined;
        let motion: string | undefined;
        let expression: string | undefined;

        for (const token of tokenizeCommandPayload(optionText)) {
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
      const tokens = tokenizeCommandPayload(dialogueMatch[2].trim());
      const textTokens: string[] = [];
      let audioPath: string | undefined;
      let figureId: string | undefined;

      for (const token of tokens) {
        const strippedToken = token.startsWith("-") ? unquoteToken(token.slice(1)) : token;
        if (token.startsWith("-") && !audioPath && AUDIO_EXT_RE.test(strippedToken)) {
          audioPath = normalizePath(strippedToken);
          continue;
        }

        const flag = parseFlagToken(token);
        if (flag?.key === "voice" && flag.value && !audioPath && AUDIO_EXT_RE.test(flag.value)) {
          audioPath = normalizePath(flag.value);
          continue;
        }
        if (flag?.key === "figureid" && flag.value) {
          figureId = flag.value;
          continue;
        }
        if (flag?.key === "id" && flag.value && !figureId) {
          figureId = flag.value;
          continue;
        }
        if (flag && DIALOGUE_CONTROL_FLAGS.has(flag.key)) {
          continue;
        }

        textTokens.push(unquoteToken(token));
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
