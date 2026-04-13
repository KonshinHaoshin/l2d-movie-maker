# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript frontend. Keep UI in `src/components/`, shared helpers in `src/utils/`, and small config values in `src/config/`. Static assets and bundled Live2D runtime files live in `public/`. The desktop backend is in `src-tauri/`, with Rust commands under `src-tauri/src/commands/` and app bootstrap in `src-tauri/src/lib.rs`. Helper scripts belong in `scripts/`. Build output goes to `dist/` and Rust artifacts to `target/`; do not edit generated files.

## Build, Test, and Development Commands
Use the existing npm scripts:

- `npm run dev` starts the Vite frontend in browser-only mode.
- `npm run tauri:dev` runs the desktop app with the Rust backend.
- `npm run build` runs TypeScript project builds, then creates the Vite production bundle.
- `npm run tauri:build` produces a packaged desktop build.
- `npm run lint` runs ESLint across the frontend codebase.
- `npm run preview` serves the built frontend locally for a quick smoke test.

## Coding Style & Naming Conventions
Frontend code uses TypeScript, React function components, and ESLint (`eslint.config.js`). Follow the existing file naming: components in PascalCase (`Live2DView.tsx`), utilities in camelCase (`motionDuration.ts`), and CSS beside the component when scoped UI styles make sense. Match the surrounding file’s formatting instead of reformatting unrelated code; the repo currently mixes indentation styles. In Rust, keep modules small and command-focused.

## Testing Guidelines
There is no automated test suite configured yet. Minimum verification for frontend changes is `npm run lint` plus a targeted manual check in `npm run dev` or `npm run tauri:dev`, depending on the feature. For Rust-side changes, add at least a `cargo check` pass in `src-tauri/` when practical. If you introduce automated tests later, place frontend tests next to source files or under a dedicated `tests/` directory and use clear names such as `featureName.test.ts`.

## Commit & Pull Request Guidelines
Recent history mixes version bumps and short Chinese summaries such as `release: bump version to 1.2.2` and `添加新模式`. Keep commits focused, imperative, and scoped to one change. PRs should include:

- a short problem/solution summary
- linked issue or task reference when available
- screenshots or short recordings for UI or export workflow changes
- verification notes listing the commands you actually ran

## Contributor Notes
Prefer small, reviewable diffs. Do not rename files, move assets, or rewrite formatting unless the task requires it. Preserve the current React/Tauri split and keep Live2D/WebGAL-specific logic close to the modules that already own it.
