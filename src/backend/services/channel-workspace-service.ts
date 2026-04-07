import fs from "node:fs";
import path from "node:path";

export class InvalidChannelWorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChannelWorkspacePathError";
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export interface ResolvedChannelArtifactPath {
  workspacePath: string;
  resolvedPath: string | null;
  exists: boolean;
  insideWorkspace: boolean;
}

export class ChannelWorkspaceService {
  normalizeWorkspacePath(rawPath: string): string {
    const trimmedPath = rawPath.trim();
    if (!trimmedPath) {
      throw new InvalidChannelWorkspacePathError("workspace path is required");
    }
    if (!path.isAbsolute(trimmedPath)) {
      throw new InvalidChannelWorkspacePathError("workspace path must be an absolute path");
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(trimmedPath);
    } catch {
      throw new InvalidChannelWorkspacePathError("workspace path does not exist");
    }

    if (!stat.isDirectory()) {
      throw new InvalidChannelWorkspacePathError("workspace path must point to a directory");
    }

    try {
      fs.accessSync(trimmedPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      throw new InvalidChannelWorkspacePathError("workspace path must be readable and writable");
    }

    try {
      return fs.realpathSync(trimmedPath);
    } catch {
      throw new InvalidChannelWorkspacePathError("workspace path could not be resolved");
    }
  }

  resolveArtifactPath(workspacePath: string, candidatePath: string): ResolvedChannelArtifactPath {
    const normalizedWorkspacePath = this.normalizeWorkspacePath(workspacePath);
    const trimmedPath = candidatePath.trim();
    if (!trimmedPath) {
      return {
        workspacePath: normalizedWorkspacePath,
        resolvedPath: null,
        exists: false,
        insideWorkspace: false,
      };
    }

    const resolvedPath = path.isAbsolute(trimmedPath)
      ? path.resolve(trimmedPath)
      : path.resolve(normalizedWorkspacePath, trimmedPath);
    const insideWorkspace = isPathInside(normalizedWorkspacePath, resolvedPath);
    const exists = insideWorkspace && fs.existsSync(resolvedPath);
    return {
      workspacePath: normalizedWorkspacePath,
      resolvedPath: insideWorkspace ? resolvedPath : null,
      exists,
      insideWorkspace,
    };
  }
}
