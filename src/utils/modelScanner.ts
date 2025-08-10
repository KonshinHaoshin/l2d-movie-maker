// src/utils/modelScanner.ts
export interface ModelInfo {
    path: string;   // 可 fetch 的 URL（/public/model/...）
    name: string;
    is_valid: boolean;  // 改为 is_valid 以匹配后端
  }
  
  // 兼容 Cubism2 / Cubism3/4
  function isLive2DJson(x: any): boolean {
    if (!x || typeof x !== "object") return false;
    if (x.model && Array.isArray(x.textures)) return true;
    if (x.FileReferences && x.FileReferences.Moc) return true;
    return false;
  }
  
  function nameFromPath(p: string): string {
    const segs = p.split("/");
    return segs.length >= 2 ? segs[segs.length - 2] : (segs.pop() || "").replace(/\.json$/i, "");
  }
  
  /** 浏览器环境：读取 /public/model/_manifest.json → 验证 */
  export async function scanModelDirectory(): Promise<ModelInfo[]> {
    try {
      const res = await fetch("/public/model/_manifest.json");
      if (!res.ok) return [];
      const list: string[] = await res.json(); // ["anon/model.json", ...]
      const out: ModelInfo[] = [];
      for (const rel of list) {
        const url = `/public/model/${rel}`;
        try {
          const r = await fetch(url);
          if (!r.ok) { out.push({ path: url, name: nameFromPath(rel), is_valid: false }); continue; }
          const j = await r.json();
          out.push({ path: url, name: nameFromPath(rel), is_valid: isLive2DJson(j) });
        } catch {
          out.push({ path: url, name: nameFromPath(rel), is_valid: false });
        }
      }
      return out;
    } catch {
      return [];
    }
  }
  