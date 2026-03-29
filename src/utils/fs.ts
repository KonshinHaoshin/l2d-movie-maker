// src/utils/fs.ts
import { readTextFile, readFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

/** 把 Windows 反斜杠转成正斜杠，去掉多余前缀（file:// 等） */
export function normalizePath(p: string): string {
  if (!p) return p;
  
  // 去掉 file:// 前缀
  p = p.replace(/^file:\/\//i, "");
  
  // 检查是否是 Windows 绝对路径
  const isWindowsAbsolute = /^[a-z]:[\\\/]/i.test(p);
  
  if (isWindowsAbsolute) {
    // Windows 绝对路径：保持反斜杠，只处理连续的反斜杠
    p = p.replace(/\\+/g, "\\");
    // 确保盘符后有反斜杠
    if (/^[a-z]:[^\\]/i.test(p)) {
      p = p.replace(/^([a-z]:)/i, "$1\\");
    }
  } else {
    const hasNetworkRoot = p.startsWith("//") || p.startsWith("\\\\");
    const hasPosixAbsoluteRoot = !hasNetworkRoot && (p.startsWith("/") || p.startsWith("\\"));

    // 非 Windows 路径：统一为正斜杠
    p = p.replace(/\\/g, "/");
    // 处理连续的斜杠
    p = p.replace(/\/+/g, "/");
    // 保留 POSIX / UNC 绝对路径的根前缀，只清理相对路径上的多余前导斜杠
    if (hasNetworkRoot) {
      p = `//${p.replace(/^\/+/g, "")}`;
    } else if (hasPosixAbsoluteRoot) {
      p = `/${p.replace(/^\/+/g, "")}`;
    } else {
      p = p.replace(/^\/+/g, "");
    }
  }
  
  // 特殊处理：确保中文路径被正确处理
  // 移除任何可能导致问题的字符，但保留 Windows 路径中的冒号
  if (isWindowsAbsolute) {
    // Windows 路径：只移除 < > " | ? *，保留冒号
    p = p.replace(/[<>"|?*]/g, "");
  } else {
    // 非 Windows 路径：移除所有可能导致问题的字符
    p = p.replace(/[<>:"|?*]/g, "");
  }
  
  return p;
}

/** 拼路径（跨平台），自动规范化 */
export async function pathJoin(...parts: string[]): Promise<string> {
  const norm = parts.map(normalizePath);
  return await join(...(norm as [string, ...string[]]));
}

/** 文件是否存在（绝对路径或相对路径） */
export async function fileExists(path: string): Promise<boolean> {
  try {
    return await exists(normalizePath(path));
  } catch {
    return false;
  }
}

/** 读取文本（UTF-8），支持绝对路径/相对路径 */
export async function readText(path: string): Promise<string> {
  const p = normalizePath(path);
  return await readTextFile(p);
}

/** 读取二进制（Uint8Array） */
export async function readBinary(path: string): Promise<Uint8Array> {
  const p = normalizePath(path);
  return await readFile(p);
}
