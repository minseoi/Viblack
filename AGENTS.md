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

## Agent Workflow Rules
- Always check relevant context in `codexdocs/` before implementation.
- While working, continuously append meaningful progress to `codexdocs/work_log.md` (not only at the end).
- For every newly added feature or behavior change, update/add Playwright E2E coverage in `tests/e2e/*.spec.ts` in the same task.
- Do not treat a task as complete until `npm run verify` passes successfully.
- Before commit, run:
  1. `npm run check`
  2. `npm run build`
  3. `npm run verify`
- Keep commit scope focused and aligned with the logged work.
- Exception for documentation-only changes (`README.md`, `AGENTS.md`, `codexdocs/*`): skip `codexdocs/work_log.md` logging and skip Playwright/verify gates unless explicitly requested.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run check`: TypeScript type-check only (`tsc --noEmit`).
- `npm run build`: compile TS to `dist/`.
- `npm run start`: build then launch Electron app.
- `npm run test:e2e`: build then run Playwright Electron E2E tests.
- `npm run verify`: run `check + build + test:e2e` as the post-task regression gate.

Example:
```bash
npm run verify
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
- Playwright-based Electron E2E tests are configured.
- Minimum quality gate for changes:
  1. `npm run check`
  2. `npm run build`
  3. `npm run verify`
  4. Manual smoke test via `npm run start` (send a message, verify response flow).
- Documentation-only changes are exempt from Playwright and verify/check/build gates unless explicitly requested.
- Feature-to-test sync rule:
  - If a feature is added/changed, the related E2E scenario must be added/updated in the same PR/commit scope.
  - If no test update is needed, leave an explicit reason in the PR description.
- Playwright E2E run:
  1. `npm run test:e2e`
- Playwright files:
  - config: `playwright.config.ts`
  - tests: `tests/e2e/*.spec.ts`
  - current smoke test: `tests/e2e/electron.smoke.spec.ts`
- Windows note:
  - If `spawn EPERM` occurs during Playwright run, rerun with elevated terminal/admin permissions.
- Playwright outputs:
  - `test-results/`, `playwright-report/` (git-ignored)

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
