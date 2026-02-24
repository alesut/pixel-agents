# Pixel Agents — Agent Guide

Canonical instructions for coding agents in this repository.
This file merges project context from `CLAUDE.md` with Beads (`bd`) task workflow.

## Task Tracking with Beads

This repository uses `bd` as the source of truth for tasks.
Run `bd onboard` once in a new clone.

### Core commands

```bash
bd ready                        # List unblocked work
bd show <id>                    # Open task details
bd create "Title" -p 1          # Create task
bd update <id> --claim          # Claim and mark in_progress
bd close <id> --reason "Done"   # Complete task
bd dep add <child> <parent>     # Add dependency link
bd sync                         # Sync bd state with git
```

### Expected task lifecycle

1. Pick work from `bd ready` (or create a task if missing).
2. Claim it with `bd update <id> --claim`.
3. Implement changes.
4. Run quality gates relevant to the change.
5. Close with `bd close <id> --reason "..."`
6. Create follow-up tasks for anything left.

## Landing the Plane (End of Session)

When ending a coding session, complete all of the following:

1. File remaining work in `bd`.
2. Run checks (types, lint, build, tests if present).
3. Update/close related `bd` tasks.
4. Sync and push:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status
   ```
5. Hand off concise status and next steps.

Rules:
- Do not leave completed work only in local state.
- Do not leave untracked follow-up work outside `bd`.

## Project Overview

Pixel Agents is a VS Code extension with an embedded React webview.
It renders Claude/Codex agent terminals as animated characters in a pixel office.

- Extension backend: `src/` (TypeScript, VS Code API)
- Webview UI: `webview-ui/` (React 19 + Vite + Canvas)
- Optional desktop shell: `desktop/` (Electron)
- Assets and extraction pipeline: `scripts/` + `webview-ui/public/assets/`

## Architecture Map

### Extension side (`src/`)

- `extension.ts`: activate/deactivate entrypoints
- `PixelAgentsViewProvider.ts`: webview provider, message bridge, asset loading
- `agentManager.ts`: terminal lifecycle (create/remove/restore/persist)
- `fileWatcher.ts`: JSONL watch (`fs.watch` + polling), `/clear` handling
- `transcriptParser.ts`: parse tool events from JSONL
- `layoutPersistence.ts`: load/save/watch `~/.pixel-agents/layout.json`
- `assetLoader.ts`: PNG parsing, sprite conversion, catalog/default layout loading
- `constants.ts`: backend constants and IDs

### Webview side (`webview-ui/src/`)

- `App.tsx`: composition root
- `office/engine/*`: simulation, game loop, renderer
- `office/layout/*`: layout serialization, tile map/pathfinding, furniture catalog
- `office/editor/*`: editor state/actions/toolbar
- `hooks/*`: extension message handling and editor hooks
- `constants.ts`: webview constants (rendering, camera, editor, gameplay)

## Core Runtime Concepts

- One terminal maps to one agent character.
- Extension and webview communicate via `postMessage`.
- Transcript source: `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- Watch strategy: `fs.watch` plus polling fallback for robustness.
- Tool completion uses both structured signals and idle heuristics.
- Layout is user-level (`~/.pixel-agents/layout.json`), shared across windows.

## Build and Dev Commands

```bash
# Install dependencies
npm install
npm --prefix webview-ui install

# Full extension build (types + lint + extension + webview)
npm run build

# Watch mode
npm run watch

# Desktop preview
npm run desktop:build
npm run desktop:start

# Dev desktop mode (webview preview + electron)
npm run desktop:dev
```

## Coding Constraints

- No TypeScript `enum` (use `as const` objects).
- Use `import type` for type-only imports.
- Respect `noUnusedLocals` and `noUnusedParameters`.
- Do not scatter magic numbers/strings:
  - backend constants in `src/constants.ts`
  - webview constants in `webview-ui/src/constants.ts`
  - UI color tokens in `webview-ui/src/index.css` (`:root` vars)

## UI and Editor Rules

- Pixel aesthetic is intentional: hard edges, no rounded corners, no blur shadows.
- Keep zoom integer and rendering pixel-perfect.
- Office/editor state is mostly imperative (`OfficeState`, `editorState`), not pure React state.
- For editor selection/state changes, ensure the React update callback path is triggered.

## Asset and Layout Notes

- Bundled assets are copied by `esbuild.js` to `dist/assets`.
- Default layout fallback: `webview-ui/public/assets/default-layout.json`
- Furniture metadata source: `furniture-catalog.json`
- Asset pipeline entrypoint: `npm run import-tileset`
- Walls/floors/furniture support colorization and placement constraints (surface/wall/bg tiles).

## Reliability Notes

- Always assume partial JSONL lines during append; buffer until newline.
- Keep short delay before clearing tool activity to avoid UI flicker.
- `/clear` rotates to a new transcript file; watcher must adopt new file.
- Cross-platform watch behavior is inconsistent; polling fallback is required.

## Definition of Done

- Code builds and checks pass for affected parts.
- Related task in `bd` is updated/closed with a clear reason.
- Changes are synced (`bd sync`) and pushed.
- Handoff notes mention what changed and what remains.
