import fs from "node:fs";
import path from "node:path";

function isRepoRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "src")) &&
    fs.existsSync(path.join(candidate, "tests"))
  );
}

export function resolveRepoRoot(fromDir: string = __dirname): string {
  let current = path.resolve(fromDir);
  while (true) {
    if (isRepoRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`failed to resolve repo root from ${fromDir}`);
    }
    current = parent;
  }
}

export function resolveBuiltTestServerEntry(repoRoot: string): string {
  const entryPath = path.join(repoRoot, "dist", "backend", "test-server-entry.js");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`backend test server entry not found at ${entryPath}. run npm run build first.`);
  }
  return entryPath;
}

export function resolveFakeCodexPath(repoRoot: string): string {
  const fixtureBase = path.join(repoRoot, "tests", "e2e", "fixtures");
  if (process.platform === "win32") {
    return path.join(fixtureBase, "fake-codex.cmd");
  }
  const unixPath = path.join(fixtureBase, "fake-codex");
  try {
    fs.chmodSync(unixPath, 0o755);
  } catch {
    // Best-effort for non-Windows environments.
  }
  return unixPath;
}

export function ensureDirectory(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}
