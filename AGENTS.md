# Repository Guidelines

## Project Structure & Module Organization
- `src/main.ts`: Electron main process (window lifecycle, app boot/shutdown).
- `src/preload.ts`: secure bridge between main and renderer.
- `src/renderer/`: UI layer (`index.html`, `renderer.ts`, renderer globals).
- `src/backend/`: local API and runtime orchestration.
  - `server.ts`: Express routes.
  - `codex.ts`: Codex CLI detection/execution and process cleanup.
  - `db.ts`: SQLite schema and data access.
  - `types.ts`: shared backend types.
- `src/types/node-sqlite.d.ts`: local typing shim for `node:sqlite`.
- Product/planning docs live in `codexdocs/`:
  - `codexdocs/Idea.md`
  - `codexdocs/idea_plan.md`
  - `codexdocs/work_log.md`

## Agent Workflow Rules
- Always check relevant context in `codexdocs/` before implementation.
- While working, continuously append meaningful progress to `codexdocs/work_log.md` (not only at the end).
- Before commit, run:
  1. `npm run check`
  2. `npm run build`
- Keep commit scope focused and aligned with the logged work.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run check`: TypeScript type-check only (`tsc --noEmit`).
- `npm run build`: compile TS to `dist/`.
- `npm run start`: build then launch Electron app.

Example:
```bash
npm run check && npm run build
npm run start
```

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode enabled).
- Indentation: 2 spaces; keep lines readable and avoid deep nesting.
- Naming:
  - `camelCase` for variables/functions.
  - `PascalCase` for interfaces/types/classes.
  - lowercase file names in feature folders (e.g., `codex.ts`, `server.ts`).
- Prefer small, single-purpose functions; handle runtime failures with explicit fallbacks.

## Testing Guidelines
- No automated test framework is configured yet.
- Minimum quality gate for changes:
  1. `npm run check`
  2. `npm run build`
  3. Manual smoke test via `npm run start` (send a message, verify response flow).
- When adding tests later, place them near source as `*.test.ts` or under `tests/`.

## Commit & Pull Request Guidelines
- Current history uses prefix-style commit subjects:
  - `feat_...`, `fix_...`, `docs_...`, `chore_...`
- Keep commits focused and small (one logical change per commit).
- PRs should include:
  - what changed and why,
  - verification steps/commands,
  - screenshots or short video for renderer/UI changes,
  - linked issue/task when applicable.

## Security & Configuration Tips
- Do not commit tokens, local DB files, or OS-specific secrets.
- Codex CLI must be installed and logged in on the host machine.
- Windows/macOS path differences are expected; keep shell/process handling cross-platform.
