import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir, dirname, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseMotionDurationSeconds } from "./motionDuration";
import { normalizePath } from "./fs";
import type { WebGALCommand, WebGALDialogueCommand } from "./webgalScript";

const WEBGAL_STORE_FILE = "webgal-role-mappings.json";
const AUDIO_ROOT_CANDIDATES = ["vocal", "voice", "audio", "se"] as const;
const AUDIO_EXT_RE = /\.(wav|mp3|ogg|m4a)$/i;
const AUDIO_ROOT_PREFIX_RE = new RegExp(`^(?:${AUDIO_ROOT_CANDIDATES.join("|")})/`, "i");

export type WebGALRoleNameMap = Record<string, string>;

export type WebGALProjectRecord = {
  projectRoot: string;
  lastAudioRoot?: string;
  roleNameMap: WebGALRoleNameMap;
  lastSelectedRoleId?: string;
  updatedAt: string;
};

type WebGALStore = {
  version: 1;
  lastProjectRoot?: string;
  projects: Record<string, WebGALProjectRecord>;
};

export type WebGALRoleSummary = {
  roleId: string;
  label: string;
  changeFigureCount: number;
  dialogueCount: number;
  voiceCount: number;
  figurePaths: string[];
};

export type WebGALPreviewGroup = {
  index: number;
  startSec: number;
  durationSec: number;
  lineNumber: number;
  speaker?: string;
  text?: string;
  motion?: string;
  expression?: string;
  figurePath?: string;
  audioRelativePath?: string;
  audioAbsolutePath?: string;
  audioDurationSec?: number;
  skipReason?: string;
};

export type WebGALImportGroup = {
  index: number;
  lineNumber: number;
  speaker?: string;
  text?: string;
  motion?: string;
  expression?: string;
  figurePath?: string;
  audioRelativePath?: string;
  audioAbsolutePath?: string;
  audioDurationSec?: number;
  durationHintSec: number;
};

export type WebGALImportPlan = {
  projectRoot: string;
  audioRoot?: string;
  selectedRoleId: string;
  selectedRoleLabel: string;
  selectedFigurePath: string;
  includeSubtitles: boolean;
  extendClipToSpokenSpan: boolean;
  groups: WebGALImportGroup[];
};

type WebGALProjectValidation = {
  project_root: string;
  figure_root: string;
  adjusted_from_game_dir: boolean;
};

type ExternalAssetRootInfo = {
  root_key: string;
  root_path: string;
  base_url: string;
};

const externalAssetBaseUrlCache = new Map<string, string>();

async function externalPathExists(path: string): Promise<boolean> {
  return invoke<boolean>("webgal_path_exists", { path });
}

async function externalReadTextFile(path: string): Promise<string> {
  return invoke<string>("webgal_read_text_file", { path });
}

function encodeUrlPathSegments(path: string): string {
  return normalizePath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function trimRelativeAssetPath(path: string): string {
  return normalizePath(path)
    .replace(/^\.\/+/g, "")
    .replace(/^[\\/]+/g, "");
}

function toProjectRelativePath(projectRoot: string, targetPath: string): string | null {
  const normalizedRoot = normalizePath(projectRoot).replace(/[\\/]+$/g, "");
  const normalizedTarget = normalizePath(targetPath).replace(/^\.\/+/g, "");

  if (!isAbsolutePath(normalizedTarget)) {
    return trimRelativeAssetPath(normalizedTarget);
  }

  const rootLower = normalizedRoot.toLowerCase();
  const targetLower = normalizedTarget.toLowerCase();

  if (targetLower === rootLower) {
    return "";
  }

  if (targetLower.startsWith(`${rootLower}/`) || targetLower.startsWith(`${rootLower}\\`)) {
    return normalizedTarget.slice(normalizedRoot.length).replace(/^[\\/]+/g, "");
  }

  return null;
}

function getPathLeaf(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/g, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

async function getExternalAssetBaseUrl(projectRoot: string): Promise<string> {
  const normalizedRoot = normalizePath(projectRoot);
  const cached = externalAssetBaseUrlCache.get(normalizedRoot);
  if (cached) return cached;

  const result = await invoke<ExternalAssetRootInfo>("register_external_asset_root", {
    path: normalizedRoot,
  });
  const normalizedBaseUrl = result.base_url.replace(/\/+$/g, "");
  externalAssetBaseUrlCache.set(normalizedRoot, normalizedBaseUrl);
  return normalizedBaseUrl;
}

export async function buildWebGALExternalAssetUrl(projectRoot: string, targetPath: string): Promise<string> {
  const normalizedTarget = normalizePath(targetPath).replace(/^\.\/+/g, "");
  const projectRelativePath = toProjectRelativePath(projectRoot, normalizedTarget);

  if (projectRelativePath !== null) {
    const baseUrl = await getExternalAssetBaseUrl(projectRoot);
    if (!projectRelativePath) return baseUrl;
    return `${baseUrl}/${encodeUrlPathSegments(projectRelativePath)}`;
  }

  if (!isAbsolutePath(normalizedTarget)) {
    throw new Error(`无法解析外部资源路径: ${targetPath}`);
  }

  // 项目外资源当前只用于独立音频文件，直接以文件所在目录作为静态根即可。
  const assetRoot = normalizePath(await dirname(normalizedTarget));
  const baseUrl = await getExternalAssetBaseUrl(assetRoot);
  const relativePath = getPathLeaf(normalizedTarget);
  if (!relativePath) return baseUrl;
  return `${baseUrl}/${encodeUrlPathSegments(relativePath)}`;
}

function createEmptyStore(): WebGALStore {
  return {
    version: 1,
    projects: {},
  };
}

async function getStoreFilePath(): Promise<string> {
  const dir = await appLocalDataDir();
  await mkdir(dir, { recursive: true });
  return join(dir, WEBGAL_STORE_FILE);
}

async function readStore(): Promise<WebGALStore> {
  const filePath = await getStoreFilePath();
  if (!(await exists(filePath))) {
    return createEmptyStore();
  }

  try {
    const text = await readTextFile(filePath);
    const parsed = JSON.parse(text) as Partial<WebGALStore>;
    if (parsed.version !== 1 || !parsed.projects) {
      return createEmptyStore();
    }
    return {
      version: 1,
      lastProjectRoot: parsed.lastProjectRoot,
      projects: parsed.projects,
    };
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store: WebGALStore): Promise<void> {
  const filePath = await getStoreFilePath();
  await writeTextFile(filePath, JSON.stringify(store, null, 2));
}

function toStoreKey(projectRoot: string): string {
  return normalizePath(projectRoot);
}

export async function loadLastWebGALProjectRecord(): Promise<WebGALProjectRecord | null> {
  const store = await readStore();
  if (!store.lastProjectRoot) return null;
  return store.projects[toStoreKey(store.lastProjectRoot)] ?? null;
}

export async function loadWebGALProjectRecord(projectRoot: string): Promise<WebGALProjectRecord | null> {
  const store = await readStore();
  return store.projects[toStoreKey(projectRoot)] ?? null;
}

export async function saveWebGALProjectRecord(
  projectRoot: string,
  patch: Partial<Omit<WebGALProjectRecord, "projectRoot" | "updatedAt">>,
  options: { setAsLastProject?: boolean } = {},
): Promise<WebGALProjectRecord> {
  const store = await readStore();
  const key = toStoreKey(projectRoot);
  const current = store.projects[key];
  const next: WebGALProjectRecord = {
    projectRoot: key,
    lastAudioRoot: patch.lastAudioRoot ?? current?.lastAudioRoot,
    roleNameMap: patch.roleNameMap ?? current?.roleNameMap ?? {},
    lastSelectedRoleId: patch.lastSelectedRoleId ?? current?.lastSelectedRoleId,
    updatedAt: new Date().toISOString(),
  };
  store.projects[key] = next;
  if (options.setAsLastProject ?? true) {
    store.lastProjectRoot = key;
  }
  await writeStore(store);
  return next;
}

export async function selectWebGALProject(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "选择 WebGAL 项目目录",
  });

  if (!picked) return null;
  return normalizePath(Array.isArray(picked) ? picked[0] : picked);
}

export async function validateWebGALProject(projectRoot: string): Promise<{ projectRoot: string; figureRoot: string }> {
  const validated = await invoke<WebGALProjectValidation>("validate_webgal_project_dir", {
    path: projectRoot,
  });

  return {
    projectRoot: normalizePath(validated.project_root),
    figureRoot: normalizePath(validated.figure_root),
  };
}

export function extractRoleNameMapFromCommands(commands: WebGALCommand[]): WebGALRoleNameMap {
  const next: WebGALRoleNameMap = {};
  for (const command of commands) {
    if (command.type !== "dialogue") continue;
    const { figureId, speaker } = command.data;
    if (!figureId || !speaker) continue;
    next[figureId] = speaker;
  }
  return next;
}

export function mergeRoleNameMaps(base: WebGALRoleNameMap, patch: WebGALRoleNameMap): WebGALRoleNameMap {
  const merged: WebGALRoleNameMap = { ...base };
  for (const [id, name] of Object.entries(patch)) {
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) continue;
    merged[trimmedId] = trimmedName;
  }
  return merged;
}

export function summarizeWebGALRoles(commands: WebGALCommand[], roleNameMap: WebGALRoleNameMap): WebGALRoleSummary[] {
  const summaryMap = new Map<string, WebGALRoleSummary & { figurePathSet: Set<string> }>();

  const ensureSummary = (roleId: string): (WebGALRoleSummary & { figurePathSet: Set<string> }) => {
    const existing = summaryMap.get(roleId);
    if (existing) return existing;
    const created = {
      roleId,
      label: roleNameMap[roleId] ?? roleId,
      changeFigureCount: 0,
      dialogueCount: 0,
      voiceCount: 0,
      figurePaths: [],
      figurePathSet: new Set<string>(),
    };
    summaryMap.set(roleId, created);
    return created;
  };

  for (const command of commands) {
    if (command.type === "changeFigure" && command.data.id) {
      const summary = ensureSummary(command.data.id);
      summary.changeFigureCount += 1;
      if (command.data.path) {
        summary.figurePathSet.add(command.data.path);
      }
      summary.label = roleNameMap[command.data.id] ?? summary.label;
      continue;
    }

    if (command.type === "dialogue" && command.data.figureId) {
      const summary = ensureSummary(command.data.figureId);
      summary.dialogueCount += 1;
      if (command.data.audioPath) summary.voiceCount += 1;
      summary.label = roleNameMap[command.data.figureId] ?? command.data.speaker ?? summary.label;
    }
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      roleId: summary.roleId,
      label: summary.label,
      changeFigureCount: summary.changeFigureCount,
      dialogueCount: summary.dialogueCount,
      voiceCount: summary.voiceCount,
      figurePaths: Array.from(summary.figurePathSet),
    }))
    .sort((left, right) => left.roleId.localeCompare(right.roleId, "zh-CN"));
}

function isAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("/");
}

function deriveProjectRootFromFigurePath(baseFigurePath: string): string | null {
  const normalized = normalizePath(baseFigurePath);
  const match = normalized.match(/^(.*?)[\\/]+game[\\/]+figure(?:[\\/]|$)/i);
  return match?.[1] ? normalizePath(match[1]) : null;
}

function deriveProjectRootFromAudioRoot(audioRoot: string): string | null {
  const normalized = normalizePath(audioRoot);
  const match = normalized.match(
    new RegExp(`^(.*?)[\\\\/]+game[\\\\/]+(?:${AUDIO_ROOT_CANDIDATES.join("|")})(?:[\\\\/]|$)`, "i"),
  );
  return match?.[1] ? normalizePath(match[1]) : null;
}

export async function resolveFigureAbsolutePath(projectRoot: string, figurePath: string): Promise<string> {
  const normalizedPath = normalizePath(figurePath);
  if (isAbsolutePath(normalizedPath)) return normalizedPath;
  const cleaned = normalizedPath
    .replace(/^\.\/+/g, "")
    .replace(/^game\/figure\//i, "")
    .replace(/^figure\//i, "");
  return normalizePath(await join(projectRoot, "game", "figure", cleaned));
}

export async function resolveAudioAbsolutePath(
  audioRoot: string | undefined,
  audioPath: string | undefined,
  projectRoot?: string,
): Promise<string | undefined> {
  if (!audioPath) return undefined;
  const normalized = normalizePath(audioPath);
  if (isAbsolutePath(normalized)) return normalized;

  const effectiveProjectRoot = projectRoot ?? (audioRoot ? deriveProjectRootFromAudioRoot(audioRoot) : null);
  const cleaned = normalized.replace(/^\.\/+/g, "");

  if (/^game\//i.test(cleaned) && effectiveProjectRoot) {
    return normalizePath(await join(effectiveProjectRoot, cleaned));
  }

  if (AUDIO_ROOT_PREFIX_RE.test(cleaned) && effectiveProjectRoot) {
    return normalizePath(await join(effectiveProjectRoot, "game", cleaned));
  }

  if (!audioRoot) return undefined;
  return normalizePath(await join(audioRoot, cleaned));
}

export async function detectWebGALAudioRoot(
  projectRoot: string,
  commands: WebGALCommand[],
  lastAudioRoot?: string,
): Promise<string | undefined> {
  const audioPaths = Array.from(
    new Set(
      commands
        .filter((command): command is WebGALDialogueCommand => command.type === "dialogue" && !!command.data.audioPath)
        .map((command) => normalizePath(command.data.audioPath!)),
    ),
  );

  if (audioPaths.length === 0) {
    if (lastAudioRoot && (await externalPathExists(lastAudioRoot))) {
      return normalizePath(lastAudioRoot);
    }
    return undefined;
  }

  for (const audioPath of audioPaths) {
    if (isAbsolutePath(audioPath) && (await externalPathExists(audioPath))) {
      return normalizePath(await dirname(audioPath));
    }
  }

  const candidateRoots: string[] = [];
  if (lastAudioRoot) {
    candidateRoots.push(normalizePath(lastAudioRoot));
  }
  for (const folderName of AUDIO_ROOT_CANDIDATES) {
    candidateRoots.push(normalizePath(await join(projectRoot, "game", folderName)));
  }

  let bestRoot: string | undefined;
  let bestScore = 0;

  for (const candidateRoot of candidateRoots) {
    let score = 0;
    for (const audioPath of audioPaths) {
      const candidatePath = await resolveAudioAbsolutePath(candidateRoot, audioPath, projectRoot);
      if (candidatePath && (await externalPathExists(candidatePath))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestRoot = candidateRoot;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestRoot : undefined;
}

export async function probeAudioDuration(projectRoot: string, audioAbsolutePath: string): Promise<number | undefined> {
  if (!AUDIO_EXT_RE.test(audioAbsolutePath)) return undefined;
  if (!(await externalPathExists(audioAbsolutePath))) return undefined;

  let audioUrl: string;
  try {
    audioUrl = await buildWebGALExternalAssetUrl(projectRoot, audioAbsolutePath);
  } catch {
    return undefined;
  }

  return new Promise((resolve) => {
    const audio = new Audio(audioUrl);
    audio.crossOrigin = "anonymous";
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.load();
  });
}

type BuildPreviewArgs = {
  projectRoot: string;
  commands: WebGALCommand[];
  selectedRoleId: string;
  selectedFigurePath?: string;
  audioRoot?: string;
  motionDurationMap?: Record<string, number>;
  defaultMotionDuration: number;
  defaultExpressionDuration: number;
};

export async function buildWebGALPreviewGroups({
  projectRoot,
  commands,
  selectedRoleId,
  selectedFigurePath,
  audioRoot,
  motionDurationMap = {},
  defaultMotionDuration,
  defaultExpressionDuration,
}: BuildPreviewArgs): Promise<WebGALPreviewGroup[]> {
  let currentMotion: string | undefined;
  let currentExpression: string | undefined;
  let currentFigurePath: string | undefined;
  let spokenTimelineCursor = 0;
  let groupIndex = 0;

  const groups: WebGALPreviewGroup[] = [];
  let pendingGroup: WebGALPreviewGroup | null = null;

  const defaultDialogueDuration = defaultMotionDuration ?? defaultExpressionDuration;

  const finalizePendingGroup = (endSec: number) => {
    if (!pendingGroup) return;
    pendingGroup.durationSec = Math.max(
      pendingGroup.durationSec,
      endSec - pendingGroup.startSec,
    );
    groups.push(pendingGroup);
    pendingGroup = null;
  };

  for (const command of commands) {
    if (command.type === "changeFigure" && command.data.id === selectedRoleId) {
      currentFigurePath = command.data.path ?? currentFigurePath;
      currentMotion = command.data.motion ?? currentMotion;
      currentExpression = command.data.expression ?? currentExpression;
      continue;
    }

    if (command.type !== "dialogue") {
      continue;
    }

    const audioAbsolutePath = await resolveAudioAbsolutePath(audioRoot, command.data.audioPath, projectRoot);
    const audioDurationSec =
      audioAbsolutePath && projectRoot
        ? await probeAudioDuration(projectRoot, audioAbsolutePath)
        : undefined;
    const isSelectedRoleDialogue = command.data.figureId === selectedRoleId;
    const fallbackDuration = isSelectedRoleDialogue
      ? (
          (currentMotion ? motionDurationMap[currentMotion] : undefined) ??
          defaultMotionDuration ??
          defaultExpressionDuration
        )
      : defaultDialogueDuration;
    const dialogueDurationSec = audioDurationSec ?? fallbackDuration;

    if (isSelectedRoleDialogue) {
      finalizePendingGroup(spokenTimelineCursor);

      const skipReason =
        currentFigurePath && selectedFigurePath && currentFigurePath !== selectedFigurePath
          ? `当前立绘为 ${currentFigurePath}，不属于本次导入立绘`
          : undefined;

      pendingGroup = {
        index: groupIndex,
        startSec: spokenTimelineCursor,
        durationSec: dialogueDurationSec,
        lineNumber: command.lineNumber,
        speaker: command.data.speaker,
        text: command.data.text,
        motion: currentMotion,
        expression: currentExpression,
        figurePath: currentFigurePath,
        audioRelativePath: command.data.audioPath,
        audioAbsolutePath,
        audioDurationSec,
        skipReason,
      };
      groupIndex += 1;
    }

    spokenTimelineCursor += dialogueDurationSec;
  }

  finalizePendingGroup(spokenTimelineCursor);
  return groups;
}

export function createWebGALImportPlan(args: {
  projectRoot: string;
  audioRoot?: string;
  selectedRoleId: string;
  selectedRoleLabel: string;
  selectedFigurePath: string;
  includeSubtitles: boolean;
  extendClipToSpokenSpan: boolean;
  previewGroups: WebGALPreviewGroup[];
}): WebGALImportPlan {
  return {
    projectRoot: args.projectRoot,
    audioRoot: args.audioRoot,
    selectedRoleId: args.selectedRoleId,
    selectedRoleLabel: args.selectedRoleLabel,
    selectedFigurePath: args.selectedFigurePath,
    includeSubtitles: args.includeSubtitles,
    extendClipToSpokenSpan: args.extendClipToSpokenSpan,
    groups: args.previewGroups
      .filter((group) => !group.skipReason)
      .map((group) => ({
        index: group.index,
        lineNumber: group.lineNumber,
        speaker: group.speaker,
        text: group.text,
        motion: group.motion,
        expression: group.expression,
        figurePath: group.figurePath,
        audioRelativePath: group.audioRelativePath,
        audioAbsolutePath: group.audioAbsolutePath,
        audioDurationSec: group.audioDurationSec,
        durationHintSec: group.durationSec,
      })),
  };
}

type MotionFileMap = Record<string, string>;

async function resolveProjectRelativeAsset(baseFilePath: string, relativePath: string): Promise<string> {
  const normalized = normalizePath(relativePath);
  if (isAbsolutePath(normalized)) return normalized;

  if (/^game\//i.test(normalized)) {
    const projectRoot = deriveProjectRootFromFigurePath(baseFilePath);
    if (projectRoot) {
      return normalizePath(await join(projectRoot, normalized));
    }
  }

  const baseDir = await dirname(baseFilePath);
  return normalizePath(await join(baseDir, normalized.replace(/^\.\//, "")));
}

async function readMotionFileMapFromModel(modelAbsolutePath: string): Promise<MotionFileMap> {
  if (/\.jsonl$/i.test(modelAbsolutePath)) {
    const text = await externalReadTextFile(modelAbsolutePath);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const summary: { motions?: string[] } = {};
    let firstPartPath: string | undefined;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { motions?: string[]; path?: string };
        if (Array.isArray(parsed.motions)) {
          summary.motions = parsed.motions;
          continue;
        }
        if (!firstPartPath && parsed.path) {
          firstPartPath = await resolveProjectRelativeAsset(modelAbsolutePath, parsed.path);
        }
      } catch {
        continue;
      }
    }

    if (!firstPartPath) return {};
    const firstModelText = await externalReadTextFile(firstPartPath);
    const firstModelData = JSON.parse(firstModelText) as { motions?: Record<string, Array<{ file?: string }>> };
    const sourceMotions = firstModelData.motions ?? {};
    const groups = summary.motions?.length ? summary.motions : Object.keys(sourceMotions);

    return Object.fromEntries(
      groups
        .map((group) => [group, sourceMotions[group]?.[0]?.file] as const)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]),
    );
  }

  const text = await externalReadTextFile(modelAbsolutePath);
  const modelData = JSON.parse(text) as { motions?: Record<string, Array<{ file?: string }>> };
  const sourceMotions = modelData.motions ?? {};

  return Object.fromEntries(
    Object.entries(sourceMotions)
      .map(([group, entries]) => [group, entries?.[0]?.file] as const)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]),
  );
}

export async function loadWebGALMotionDurations(modelAbsolutePath: string): Promise<Record<string, number>> {
  const fileMap = await readMotionFileMapFromModel(modelAbsolutePath);
  const durations: Record<string, number> = {};

  for (const [group, relativeFilePath] of Object.entries(fileMap)) {
    if (!/\.(?:mtn|motion3\.json)$/i.test(relativeFilePath)) continue;
    try {
      const absoluteMotionPath = await resolveProjectRelativeAsset(modelAbsolutePath, relativeFilePath);
      const text = await externalReadTextFile(absoluteMotionPath);
      const durationSec = parseMotionDurationSeconds(relativeFilePath, text);
      if (durationSec && durationSec > 0) {
        durations[group] = durationSec;
      }
    } catch {
      continue;
    }
  }

  return durations;
}
