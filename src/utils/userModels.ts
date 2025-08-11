// src/utils/userModels.ts
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir, mkdir, readFile } from "@tauri-apps/plugin-fs";

export type UserModelItem = {
  name: string;     // 子目录名
  rel: string;      // 例如: "<name>/model.json"（仅展示用）
  abs: string;      // 绝对路径
  url: string;      // convertFileSrc(abs) 之后可直接用于 Live2DModel.from
};

// 确保用户模型目录存在
export async function ensureUserModelsDir(): Promise<string> {
  const base = await appLocalDataDir();
  const dir = await join(base, "models");
  try {
    await readDir(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

// 扫描一级子目录，找含有 model.json 的模型
export async function scanUserModels(): Promise<UserModelItem[]> {
  const root = await ensureUserModelsDir();
  const entries = await readDir(root);
  const out: UserModelItem[] = [];
  for (const e of entries) {
    if (!e.isDirectory || !e.name) continue;
    const abs = await join(root, e.name, "model.json");
    try {
      // 仅用来判断是否存在（能读到就算）
      await readFile(abs);
      out.push({
        name: e.name,
        rel: `${e.name}/model.json`,
        abs,
        url: convertFileSrc(abs),
      });
    } catch {
      // 没有 model.json 就跳过
    }
  }
  return out;
}
