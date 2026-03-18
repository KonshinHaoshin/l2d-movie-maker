# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start Vite dev server (port 1431)
npm run tauri:dev    # Run full Tauri desktop app in dev mode

# Build
npm run build        # TypeScript check + Vite build
npm run tauri:build  # Build distributable desktop app

# Lint
npm run lint         # ESLint check
```

No test suite is configured.

## Architecture

This is a **Live2D recording desktop app** built with React + Tauri (Rust backend).

### Frontend (src/)

- `src/components/Live2DView.tsx` — Central orchestrator (1000+ lines). Manages the PIXI.js canvas, Live2D model loading, motion/expression state, timeline playback, recording coordination, and model drag/transform.
- `src/components/Timeline.tsx` — Timeline editor for sequencing motion, expression, and audio clips.
- `src/components/RecordingManager.tsx` — Coordinates VP9 alpha recording and model frame capture.
- `src/components/AudioManager.tsx` — Audio playback and level detection.
- `src/components/ModelManager.tsx` — Model loading and management UI.
- `src/components/WebGALMode.tsx` — WebGAL game engine format support.
- `src/utils/recorder.ts` — MediaRecorder-based VP9/VP8 alpha recording logic.
- `src/utils/offlineExporter.ts` — Offline WebM export pipeline.
- `src/utils/ffmpegTranscode.ts` — FFmpeg WASM wrapper for in-browser transcoding.
- `src/utils/webgalParser.ts` — Parses WebGAL script format.

### Backend (src-tauri/)

Rust/Tauri backend exposes commands to the frontend via `invoke()`:

- `src-tauri/src/commands/media.rs` — FFmpeg CLI transcoding: VP9→ProRes4444, MOV→WebM alpha, alpha flatten to MP4, PNG sequence→WebM.
- `src-tauri/src/commands/models.rs` — Model file discovery on disk.
- `src-tauri/src/commands/server.rs` — `tiny_http` local server that serves model files to the PIXI renderer.

### Rendering Stack

PIXI.js 6.5 (WebGL) + `pixi-live2d-display` renders Live2D models in a transparent Tauri window (1200×800). The window transparency enables alpha-channel video export.

### Recording Pipeline

1. `MediaRecorder` captures the canvas as VP9/VP8 WebM with alpha.
2. Tauri FFmpeg commands transcode to ProRes 4444 (MOV) or flatten to MP4.
3. Offline export path uses FFmpeg WASM for frame-by-frame PNG→WebM encoding.

### Key Config

- Vite dev port: **1431** (strict, required by Tauri)
- Tauri app ID: `com.DongshanRandeng.l2dmm`
- Build targets: Chrome 105 (Windows), Safari 13 (macOS)
- TypeScript strict mode, no unused locals/parameters
