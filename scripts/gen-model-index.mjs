// scripts/gen-model-index.mjs
import { promises as fs } from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_MODEL_DIR = path.join(ROOT, "dist", "model");
const OUTPUT = path.join(DIST_MODEL_DIR, "models.json");

// 允许的文件：model.json / model3.json / *.jsonl
const allow = (basename) =>
  basename === "model.json" ||
  basename === "model3.json" ||
  basename.toLowerCase().endsWith(".jsonl");

async function walk(dir, baseDir) {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      out.push(...(await walk(full, baseDir)));
    } else if (it.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      const base = path.basename(rel);
      if (allow(base) && base !== "models.json") out.push(rel);
    }
  }
  return out;
}

async function main() {
  try {
    await fs.access(DIST_MODEL_DIR);
  } catch {
    console.error(`[gen-model-index] 未找到目录: ${DIST_MODEL_DIR}
先执行 vite build 让模型从 public/model/** 拷贝到 dist/model/**。`);
    process.exit(1);
  }

  const list = await walk(DIST_MODEL_DIR, DIST_MODEL_DIR);
  list.sort((a, b) => a.localeCompare(b));
  await fs.writeFile(OUTPUT, JSON.stringify(list, null, 2), "utf8");
  console.log(`[gen-model-index] OK -> ${OUTPUT}，共 ${list.length} 个条目`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
