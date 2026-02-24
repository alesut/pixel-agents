# Pixel Agents — Electron standalone plan (macOS, Codex-first)

This plan converts the current VS Code extension into a standalone macOS desktop app, while keeping the extension usable during migration.

## Goals

- Ship a **standalone macOS app** (`.app` + `dmg`) powered by Electron.
- Replace Claude-specific assumptions with a **provider model**, defaulting to **Codex agents**.
- Reuse the existing office UI/game loop with minimal visual regressions.
- Keep extension and desktop variants sharing one core runtime.

## Non-goals (first release)

- Linux/Windows desktop installers.
- Cloud sync/multi-device state.
- Rewriting rendering engine or moving away from Canvas.

## Proposed target architecture

- `core/` (shared domain runtime)
  - Agent lifecycle state machine
  - Transcript parsing and tool-status derivation
  - File watch/poll fallback
  - Layout/settings persistence interfaces
- `adapters/vscode/`
  - Existing extension APIs and terminal integration
- `adapters/electron/`
  - Child process / pty integration
  - Desktop persistence + IPC transport
- `webview-ui/` -> shared renderer UI
  - Bridge abstraction instead of hardcoded `acquireVsCodeApi`

## 6-phase migration plan

### Phase 0 — Baseline and risk reduction (1-2 days)

Deliverables:
- Freeze current behavior with a smoke checklist:
  - create/remove agents,
  - tool start/stop animation,
  - layout save/load,
  - seat reassignment,
  - `/clear` JSONL rollover behavior.
- Add architecture notes for extension-only dependencies and replacement strategy.

Exit criteria:
- Team agrees on a minimal "desktop parity" acceptance list.

### Phase 1 — Shared core extraction (2-4 days)

Deliverables:
- Create `src/core` modules from extension code that do not require VS Code runtime.
- Introduce explicit interfaces:
  - `TerminalPort`,
  - `TranscriptPort`,
  - `UiPort`,
  - `PersistencePort`.
- Keep current extension behavior by wiring `adapters/vscode` to those interfaces.

Exit criteria:
- Extension still runs with no feature regression and core has no direct `vscode` imports.

### Phase 2 — Agent CLI provider abstraction (1-2 days)

Deliverables:
- Add `AgentProvider` config contract:
  - command,
  - args template,
  - transcript resolver,
  - terminal display name.
- Move current Claude logic to `providers/claude`.
- Add `providers/codex` and set as desktop default.
- Replace user-facing wording from Claude-specific to provider-neutral where possible.

Exit criteria:
- Runtime can launch agents via configurable provider without code edits.

### Phase 3 — Renderer transport decoupling (1-3 days)

Deliverables:
- Replace direct `vscodeApi` usage with `bridge` abstraction:
  - `send`,
  - `subscribe`,
  - optional request/response helper.
- Implement two bridges:
  - `vscodeBridge` (current behavior),
  - `electronBridge` (IPC via preload).

Exit criteria:
- Same React app bundle works in both Extension Webview and Electron renderer.

### Phase 4 — Electron shell (2-4 days)

Deliverables:
- Add `desktop/`:
  - `main.ts` (BrowserWindow, lifecycle),
  - `preload.ts` (safe IPC surface),
  - `desktopRuntime.ts` (adapters/electron wiring).
- Run Codex agents through child processes or pty layer.
- Wire transcript watching and push state to renderer.
- Add desktop scripts:
  - `desktop:dev`,
  - `desktop:build`,
  - `desktop:dist:mac`.

Exit criteria:
- Local macOS developer build launches, creates Codex agents, and animates office state.

### Phase 5 — Packaging + QA hardening (2-3 days)

Deliverables:
- Configure `electron-builder` for macOS (`dmg` + zipped app).
- Add app metadata/icons and signing/notarization env contracts.
- QA pass for:
  - cold start,
  - workspace switching,
  - sleep/wake file watcher resilience,
  - large transcript tailing,
  - corrupted layout recovery.

Exit criteria:
- Reproducible signed (or at least unsigned internal) macOS artifacts from CI.

## Suggested repository shape

```text
src/
  core/
  adapters/
    vscode/
    electron/
  providers/
    claude/
    codex/
desktop/
  main.ts
  preload.ts
  runtime/
webview-ui/
```

## Milestone checklist

- M1: Extension uses extracted core (no behavior change).
- M2: Provider switch supports Codex profile.
- M3: Shared renderer runs in both hosts.
- M4: Electron app usable on macOS for daily workflows.
- M5: Signed distributable produced in CI.

## Testing strategy

- Unit tests:
  - transcript parser,
  - status transitions,
  - provider path resolution,
  - layout migration.
- Integration tests:
  - simulated transcript append + watcher behavior,
  - bridge protocol contract tests.
- Manual smoke (desktop):
  - open app, add 2+ agents, run tools, reassign seats, restart app, verify restore.

## Immediate next steps (first coding session)

1. Scaffold `src/core` and move parser/timer modules first.
2. Add provider contract + `codex` provider skeleton.
3. Introduce UI bridge abstraction without changing message payloads.
4. Scaffold minimal Electron shell that loads current `webview-ui` build.
