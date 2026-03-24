import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CodexStatus } from "./types";

export interface CodexStreamEvent {
  type: "progress" | "question" | "message" | "error";
  content: string;
  rawType?: string;
  raw?: unknown;
}

interface CodexRunParams {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  cwd: string;
  timeoutMs?: number;
  onStream?: (event: CodexStreamEvent) => void;
}

export interface CodexRunResult {
  ok: boolean;
  reply: string;
  sessionId: string | null;
  error?: string;
}

interface InternalCodexRunResult extends CodexRunResult {
  fallbackEligible?: boolean;
}

interface ActiveTurnState {
  threadId: string;
  turnId: string | null;
  onStream?: (event: CodexStreamEvent) => void;
  deltaParts: string[];
  messageParts: string[];
  terminalParts: string[];
  failureParts: string[];
  deltaAggregate: string;
  lastStreamEmit: string;
  resolved: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
  resolve: (result: InternalCodexRunResult) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

let codexCommand = process.env.VIBLACK_CODEX_PATH || "codex";
const activeCodexProcesses = new Set<ChildProcess>();
const CODEX_TRANSIENT_RETRY_DELAY_MS = 900;
const CODEX_MAX_TRANSIENT_RETRIES = 1;
const runtimePreference = (process.env.VIBLACK_CODEX_RUNTIME || "app-server").trim().toLowerCase();
const shouldPreferAppServer = runtimePreference !== "exec";

let appServerClient: CodexAppServerClient | null = null;
let appServerDisabledReason: string | null = null;

function trackProcess(child: ChildProcess): void {
  activeCodexProcesses.add(child);
  child.once("close", () => {
    activeCodexProcesses.delete(child);
  });
  child.once("error", () => {
    activeCodexProcesses.delete(child);
  });
}

function needsShellOnWindows(command: string): boolean {
  return process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
}

function getCandidateCommands(): string[] {
  const candidates = [codexCommand, "codex"];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    if (appData) {
      candidates.push(path.join(appData, "npm", "codex"));
      candidates.push(path.join(appData, "npm", "codex.cmd"));
    }
    if (userProfile) {
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex"));
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex.cmd"));
    }
  } else {
    candidates.push("/usr/local/bin/codex");
    candidates.push("/opt/homebrew/bin/codex");
  }

  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || unique.includes(candidate)) {
      continue;
    }
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
      continue;
    }
    unique.push(candidate);
  }
  return unique;
}

async function runCodexVersion(command: string, cwd: string): Promise<CodexStatus> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, ["--version"], {
        cwd,
        windowsHide: true,
        shell: needsShellOnWindows(command),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ ok: false, command, error: message });
      return;
    }
    let output = "";
    let err = "";

    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (spawnErr) => {
      resolve({ ok: false, command, error: spawnErr.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim(), command });
        return;
      }
      resolve({ ok: false, command, error: (err || output).trim() || "codex command failed" });
    });
  });
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextParts(item));
  }

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  const directKeys = ["text", "delta", "output_text", "message", "value", "detail"];
  for (const key of directKeys) {
    if (typeof obj[key] === "string") {
      parts.push(String(obj[key]));
    }
  }

  const nestedKeys = [
    "content",
    "message",
    "delta",
    "response",
    "output",
    "item",
    "items",
    "error",
    "turn",
    "params",
  ];
  for (const key of nestedKeys) {
    if (obj[key]) {
      parts.push(...extractTextParts(obj[key]));
    }
  }
  return parts;
}

function buildPrompt(systemPrompt: string, userPrompt: string, hasSession: boolean): string {
  if (hasSession) {
    return userPrompt;
  }
  return ["System role:", systemPrompt, "", "User request:", userPrompt].join("\n");
}

function isTerminalStreamEventType(type: string): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized === "turn.completed" ||
    normalized === "response.completed" ||
    normalized.endsWith(".done") ||
    normalized === "response.done"
  );
}

function classifyStreamEventType(type: string): "progress" | "question" | "message" | null {
  const normalized = type.toLowerCase();
  if (isTerminalStreamEventType(normalized)) {
    return null;
  }
  if (normalized === "agent_message" || normalized.includes(".agent_message")) {
    return "message";
  }
  if (normalized.includes("question") || normalized.includes("ask")) {
    return "question";
  }
  if (normalized.includes("delta") || normalized.includes("progress")) {
    return "progress";
  }
  if (normalized.includes("message") || normalized.includes("output_text")) {
    return "message";
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pickLongest(parts: string[]): string {
  return [...parts]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

function isTransientCodexFailure(result: CodexRunResult): boolean {
  if (result.ok) {
    return false;
  }
  const text = `${result.error ?? ""}\n${result.reply}`.toLowerCase();
  const transientNeedles = [
    "stream disconnected before completion",
    "error sending request for url",
    "connection reset",
    "connection refused",
    "temporarily unavailable",
    "network is unreachable",
    "operation timed out",
    "timed out",
    "reconnecting...",
    "econnreset",
    "etimedout",
  ];
  return transientNeedles.some((needle) => text.includes(needle));
}

function isAppServerUnavailableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("unsupported command") ||
    text.includes("unknown command") ||
    text.includes("unrecognized subcommand") ||
    text.includes("app-server") && text.includes("not") && text.includes("found")
  );
}

function shouldEmitDeltaAggregate(nextValue: string, lastValue: string): boolean {
  if (!nextValue || nextValue === lastValue) {
    return false;
  }
  if (nextValue.length >= 18 && lastValue.length === 0) {
    return true;
  }
  if (nextValue.length - lastValue.length >= 80) {
    return true;
  }
  return /[\n.!?]$/.test(nextValue);
}

class CodexAppServerClient {
  private child: ChildProcess | null = null;
  private startupPromise: Promise<void> | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stderrLog = "";
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly activeTurnsByThread = new Map<string, ActiveTurnState>();
  private readonly loadedThreadIds = new Set<string>();
  private nextRequestId = 1;

  async ensureStarted(cwd: string): Promise<void> {
    if (this.child) {
      return;
    }
    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }

    this.startupPromise = this.startChildAndInitialize(cwd)
      .catch((err) => {
        this.startupPromise = null;
        throw err;
      })
      .then(() => {
        this.startupPromise = null;
      });

    await this.startupPromise;
  }

  async prepareThread(threadId: string | null, cwd: string): Promise<string> {
    await this.ensureStarted(cwd);
    if (!this.child) {
      throw new Error("codex app-server is not running");
    }

    if (threadId) {
      if (this.loadedThreadIds.has(threadId)) {
        return threadId;
      }
      const result = await this.request("thread/resume", {
        threadId,
        cwd,
        approvalPolicy: "never",
      });
      const resumedThreadId = this.extractThreadId(result) ?? threadId;
      this.loadedThreadIds.add(resumedThreadId);
      return resumedThreadId;
    }

    const started = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
    });
    const startedThreadId = this.extractThreadId(started);
    if (!startedThreadId) {
      throw new Error("codex app-server did not return thread id");
    }
    this.loadedThreadIds.add(startedThreadId);
    return startedThreadId;
  }

  async runTurn(params: {
    threadId: string;
    prompt: string;
    cwd: string;
    timeoutMs: number;
    onStream?: (event: CodexStreamEvent) => void;
  }): Promise<InternalCodexRunResult> {
    await this.ensureStarted(params.cwd);
    if (!this.child) {
      return {
        ok: false,
        reply: "",
        sessionId: params.threadId,
        error: "codex app-server is not running",
        fallbackEligible: true,
      };
    }

    const completion = new Promise<InternalCodexRunResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        void this.interruptTurn(params.threadId, state.turnId);
        this.finishTurn(state, {
          ok: false,
          reply: "",
          sessionId: params.threadId,
          error: "codex app-server turn timed out",
          fallbackEligible: true,
        });
      }, params.timeoutMs);

      const state: ActiveTurnState = {
        threadId: params.threadId,
        turnId: null,
        onStream: params.onStream,
        deltaParts: [],
        messageParts: [],
        terminalParts: [],
        failureParts: [],
        deltaAggregate: "",
        lastStreamEmit: "",
        resolved: false,
        timeoutHandle,
        resolve,
      };

      this.activeTurnsByThread.set(params.threadId, state);
    });

    try {
      const result = await this.request("turn/start", {
        threadId: params.threadId,
        cwd: params.cwd,
        approvalPolicy: "never",
        input: [{ type: "text", text: params.prompt }],
      });

      const state = this.activeTurnsByThread.get(params.threadId);
      if (!state) {
        return completion;
      }

      const record = result as Record<string, unknown>;
      const turn =
        record.turn && typeof record.turn === "object"
          ? (record.turn as Record<string, unknown>)
          : null;

      if (turn && typeof turn.id === "string") {
        state.turnId = turn.id;
      }

      const status = typeof turn?.status === "string" ? turn.status.toLowerCase() : "";
      if (status.includes("failed")) {
        const errorText = pickLongest(extractTextParts(turn?.error ?? turn));
        this.finishTurn(state, {
          ok: false,
          reply: "",
          sessionId: params.threadId,
          error: errorText || "codex app-server turn failed",
          fallbackEligible: false,
        });
      }

      if (status.includes("completed")) {
        const reply = pickLongest(state.terminalParts) || pickLongest(state.messageParts) || state.deltaParts.join("");
        this.finishTurn(state, {
          ok: true,
          reply: reply.trim(),
          sessionId: params.threadId,
        });
      }
    } catch (err) {
      const state = this.activeTurnsByThread.get(params.threadId);
      if (state) {
        const message = err instanceof Error ? err.message : String(err);
        this.finishTurn(state, {
          ok: false,
          reply: "",
          sessionId: params.threadId,
          error: message,
          fallbackEligible: true,
        });
      }
    }

    return completion;
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    this.child = null;
    this.loadedThreadIds.clear();

    try {
      child.kill();
    } catch {
      // Ignore shutdown errors.
    }
  }

  private async startChildAndInitialize(cwd: string): Promise<void> {
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stderrLog = "";

    let child: ChildProcess;
    try {
      child = spawn(codexCommand, ["app-server", "--listen", "stdio://"], {
        cwd,
        windowsHide: true,
        shell: needsShellOnWindows(codexCommand),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to spawn codex app-server: ${message}`);
    }

    this.child = child;
    trackProcess(child);

    child.stdout?.on("data", (chunk) => {
      this.stdoutBuffer += String(chunk);
      this.flushStdout(false);
    });

    child.stderr?.on("data", (chunk) => {
      this.stderrBuffer += String(chunk);
      this.flushStderr(false);
    });

    child.on("error", (err) => {
      this.handleChildTermination(`codex app-server error: ${err.message}`);
    });

    child.on("close", (code, signal) => {
      this.flushStdout(true);
      this.flushStderr(true);
      const details = [
        `codex app-server closed (code=${code ?? "null"}, signal=${signal ?? "none"})`,
        this.stderrLog.trim(),
      ]
        .filter((part) => part.length > 0)
        .join(" | ");
      this.handleChildTermination(details);
    });

    await this.request(
      "initialize",
      {
        clientInfo: {
          name: "viblack",
          version: "1.0.0",
        },
        capabilities: {},
      },
      20_000,
    );
  }

  private async interruptTurn(threadId: string, turnId: string | null): Promise<void> {
    try {
      await this.request(
        "turn/interrupt",
        {
          threadId,
          turnId,
        },
        5_000,
      );
    } catch {
      // Best effort only.
    }
  }

  private extractThreadId(result: unknown): string | null {
    if (!result || typeof result !== "object") {
      return null;
    }
    const record = result as Record<string, unknown>;
    const thread =
      record.thread && typeof record.thread === "object"
        ? (record.thread as Record<string, unknown>)
        : null;
    if (thread && typeof thread.id === "string") {
      return thread.id;
    }
    return null;
  }

  private flushStdout(flushAll: boolean): void {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = flushAll ? "" : (lines.pop() ?? "");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      this.handleStdoutLine(line);
    }
  }

  private flushStderr(flushAll: boolean): void {
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = flushAll ? "" : (lines.pop() ?? "");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      this.appendStderrLog(line);
    }
  }

  private appendStderrLog(line: string): void {
    const merged = `${this.stderrLog}\n${line}`.trim();
    this.stderrLog = merged.length > 6000 ? merged.slice(-6000) : merged;
  }

  private handleStdoutLine(line: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (!payload || typeof payload !== "object") {
      return;
    }

    const message = payload as Record<string, unknown>;
    const method = typeof message.method === "string" ? message.method : null;
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");

    if (method && hasId) {
      const id = message.id;
      if (typeof id === "number" || typeof id === "string") {
        this.handleServerRequest(id, method, message.params);
      }
      return;
    }

    if (method) {
      this.handleNotification(method, message.params);
      return;
    }

    if (hasId) {
      const id = message.id;
      if (typeof id === "number") {
        const pending = this.pendingRequests.get(id);
        if (!pending) {
          return;
        }
        this.pendingRequests.delete(id);
        clearTimeout(pending.timeoutHandle);

        if (message.error && typeof message.error === "object") {
          const errorRecord = message.error as Record<string, unknown>;
          const msg =
            (typeof errorRecord.message === "string" && errorRecord.message) ||
            pickLongest(extractTextParts(errorRecord)) ||
            "codex app-server request failed";
          pending.reject(new Error(msg));
          return;
        }

        pending.resolve(message.result);
      }
    }
  }

  private handleServerRequest(id: number | string, method: string, _params: unknown): void {
    let result: unknown = {};

    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval": {
        result = { decision: "accept" };
        break;
      }
      case "execCommandApproval":
      case "applyPatchApproval": {
        result = { decision: "approved" };
        break;
      }
      case "item/tool/requestUserInput": {
        result = { answers: {} };
        break;
      }
      case "item/tool/call": {
        result = {
          success: false,
          output: {
            type: "text",
            text: "Viblack runtime does not support dynamic tool calls.",
          },
        };
        break;
      }
      default: {
        this.writeJson({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unsupported server request: ${method}`,
          },
        });
        return;
      }
    }

    this.writeJson({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  private handleNotification(method: string, params: unknown): void {
    const record = params && typeof params === "object" ? (params as Record<string, unknown>) : null;
    if (!record) {
      return;
    }
    const threadId = record && typeof record.threadId === "string" ? record.threadId : null;

    if (!threadId) {
      return;
    }

    const state = this.activeTurnsByThread.get(threadId);
    if (!state) {
      return;
    }

    const incomingTurnId = record && typeof record.turnId === "string" ? record.turnId : null;
    if (incomingTurnId && state.turnId && incomingTurnId !== state.turnId) {
      return;
    }
    if (!state.turnId && incomingTurnId) {
      state.turnId = incomingTurnId;
    }

    if (method === "item/agentMessage/delta") {
      const delta = typeof record.delta === "string" ? record.delta : "";
      if (delta) {
        state.deltaParts.push(delta);
        state.deltaAggregate += delta;
        const aggregated = state.deltaAggregate.trim();
        if (aggregated && shouldEmitDeltaAggregate(aggregated, state.lastStreamEmit)) {
          state.lastStreamEmit = aggregated;
          state.onStream?.({
            type: "message",
            content: aggregated,
            rawType: "agent_message",
            raw: { method, params },
          });
        }
      }
      return;
    }

    if (method === "item/completed") {
      const item =
        record.item && typeof record.item === "object"
          ? (record.item as Record<string, unknown>)
          : null;
      const itemType = typeof item?.type === "string" ? item.type : "";
      if (itemType === "agentMessage") {
        const text = pickLongest(extractTextParts(item));
        if (text) {
          state.messageParts.push(text);
          if (text !== state.lastStreamEmit) {
            state.lastStreamEmit = text;
            state.onStream?.({
              type: "message",
              content: text,
              rawType: "agent_message",
              raw: { method, params },
            });
          }
        }
      }
      return;
    }

    if (method === "turn/completed") {
      const turn =
        record.turn && typeof record.turn === "object"
          ? (record.turn as Record<string, unknown>)
          : null;
      const status = typeof turn?.status === "string" ? turn.status.toLowerCase() : "";
      const failureText = pickLongest(extractTextParts(turn?.error ?? turn));

      if (status.includes("failed")) {
        if (failureText) {
          state.failureParts.push(failureText);
        }
        const reply = pickLongest(state.terminalParts) || pickLongest(state.messageParts) || state.deltaParts.join("");
        this.finishTurn(state, {
          ok: false,
          reply: reply.trim(),
          sessionId: state.threadId,
          error: failureText || "codex app-server turn failed",
          fallbackEligible: false,
        });
        return;
      }

      const reply = pickLongest(state.terminalParts) || pickLongest(state.messageParts) || state.deltaParts.join("");
      this.finishTurn(state, {
        ok: true,
        reply: reply.trim(),
        sessionId: state.threadId,
      });
    }
  }

  private finishTurn(state: ActiveTurnState, result: InternalCodexRunResult): void {
    if (state.resolved) {
      return;
    }

    state.resolved = true;
    clearTimeout(state.timeoutHandle);

    const current = this.activeTurnsByThread.get(state.threadId);
    if (current === state) {
      this.activeTurnsByThread.delete(state.threadId);
    }

    state.resolve(result);
  }

  private handleChildTermination(reason: string): void {
    this.child = null;
    this.loadedThreadIds.clear();

    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id);
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(reason));
    }

    for (const [, state] of this.activeTurnsByThread) {
      this.finishTurn(state, {
        ok: false,
        reply: "",
        sessionId: state.threadId,
        error: reason,
        fallbackEligible: true,
      });
    }
  }

  private writeJson(payload: Record<string, unknown>): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) {
      throw new Error("codex app-server stdin is not writable");
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error("codex app-server is not running"));
    }

    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeoutHandle,
      });

      try {
        this.writeJson({
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
      } catch (err) {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutHandle);
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(message));
      }
    });
  }
}

export async function checkCodexAvailability(cwd: string): Promise<CodexStatus> {
  const errors: string[] = [];
  for (const candidate of getCandidateCommands()) {
    const status = await runCodexVersion(candidate, cwd);
    if (status.ok) {
      codexCommand = candidate;
      return status;
    }
    errors.push(`${candidate}: ${status.error ?? "unknown"}`);
  }

  return {
    ok: false,
    error: errors.join(" | ") || "codex not found",
  };
}

async function runCodexViaAppServer(params: {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  sessionId: string | null;
  onStream?: (event: CodexStreamEvent) => void;
}): Promise<InternalCodexRunResult> {
  let latestResult: InternalCodexRunResult | null = null;

  for (let attempt = 0; attempt <= CODEX_MAX_TRANSIENT_RETRIES; attempt += 1) {
    const result = await runCodexViaAppServerOnce(params);
    latestResult = result;
    if (result.ok) {
      return result;
    }
    const shouldRetry = isTransientCodexFailure(result) && attempt < CODEX_MAX_TRANSIENT_RETRIES;
    if (!shouldRetry) {
      return result;
    }
    await sleep(CODEX_TRANSIENT_RETRY_DELAY_MS * (attempt + 1));
  }

  return (
    latestResult ?? {
      ok: false,
      reply: "",
      sessionId: params.sessionId,
      error: "codex app-server execution failed",
      fallbackEligible: true,
    }
  );
}

async function runCodexViaAppServerOnce(params: {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  sessionId: string | null;
  onStream?: (event: CodexStreamEvent) => void;
}): Promise<InternalCodexRunResult> {
  try {
    appServerClient ??= new CodexAppServerClient();

    const threadId = await appServerClient.prepareThread(params.sessionId, params.cwd);
    const result = await appServerClient.runTurn({
      threadId,
      prompt: params.prompt,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
      onStream: params.onStream,
    });

    return {
      ...result,
      sessionId: threadId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAppServerUnavailableError(message)) {
      appServerDisabledReason = message;
    }
    return {
      ok: false,
      reply: "",
      sessionId: params.sessionId,
      error: message,
      fallbackEligible: true,
    };
  }
}

export async function runCodex(params: CodexRunParams): Promise<CodexRunResult> {
  const prompt = buildPrompt(params.systemPrompt, params.prompt, Boolean(params.sessionId));
  const timeoutMs = params.timeoutMs ?? 120_000;

  if (shouldPreferAppServer && !appServerDisabledReason) {
    const appServerResult = await runCodexViaAppServer({
      prompt,
      timeoutMs,
      cwd: params.cwd,
      sessionId: params.sessionId,
      onStream: params.onStream,
    });
    if (appServerResult.ok) {
      return appServerResult;
    }

    if (!appServerResult.fallbackEligible) {
      return appServerResult;
    }

    const execFallback = await runCodexViaExec({
      prompt,
      timeoutMs,
      cwd: params.cwd,
      sessionId: params.sessionId,
      onStream: params.onStream,
    });

    if (!execFallback.ok && appServerResult.error && execFallback.error) {
      return {
        ...execFallback,
        error: `app-server: ${appServerResult.error}\nexec: ${execFallback.error}`,
      };
    }

    return execFallback;
  }

  return runCodexViaExec({
    prompt,
    timeoutMs,
    cwd: params.cwd,
    sessionId: params.sessionId,
    onStream: params.onStream,
  });
}

interface CodexRunOnceParams {
  prompt: string;
  sessionId: string | null;
  cwd: string;
  timeoutMs: number;
  onStream?: (event: CodexStreamEvent) => void;
}

async function runCodexViaExec(params: CodexRunOnceParams): Promise<CodexRunResult> {
  let latestResult: CodexRunResult | null = null;

  for (let attempt = 0; attempt <= CODEX_MAX_TRANSIENT_RETRIES; attempt += 1) {
    const result = await runCodexExecOnce(params);
    latestResult = result;
    if (result.ok) {
      return result;
    }
    const shouldRetry = isTransientCodexFailure(result) && attempt < CODEX_MAX_TRANSIENT_RETRIES;
    if (!shouldRetry) {
      return result;
    }
    await sleep(CODEX_TRANSIENT_RETRY_DELAY_MS * (attempt + 1));
  }

  return (
    latestResult ?? {
      ok: false,
      reply: "",
      sessionId: params.sessionId,
      error: "codex execution failed",
    }
  );
}

async function runCodexExecOnce(params: CodexRunOnceParams): Promise<CodexRunResult> {
  const args = params.sessionId
    ? [
        "exec",
        "resume",
        "--full-auto",
        "--skip-git-repo-check",
        "--json",
        params.sessionId,
        params.prompt,
      ]
    : [
        "exec",
        "--full-auto",
        "--skip-git-repo-check",
        "--json",
        params.prompt,
      ];

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(codexCommand, args, {
        cwd: params.cwd,
        windowsHide: true,
        shell: needsShellOnWindows(codexCommand),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        ok: false,
        reply: "",
        sessionId: params.sessionId,
        error: message,
      });
      return;
    }

    trackProcess(child);
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrOutput = "";
    let stdoutOutput = "";
    let sessionId = params.sessionId;
    const deltaParts: string[] = [];
    const fullParts: string[] = [];
    const terminalParts: string[] = [];
    const failureParts: string[] = [];
    let sawFailureEvent = false;

    const processLine = (rawLine: string, source: "stdout" | "stderr"): void => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const topLevelType = typeof event.type === "string" ? event.type : "";
        const nestedItem = event.item;
        const nestedItemType =
          nestedItem &&
          typeof nestedItem === "object" &&
          typeof (nestedItem as Record<string, unknown>).type === "string"
            ? String((nestedItem as Record<string, unknown>).type)
            : "";
        const streamType =
          topLevelType === "item.completed" && nestedItemType ? nestedItemType : topLevelType;

        if (topLevelType === "thread.started" && typeof event.thread_id === "string") {
          sessionId = event.thread_id;
        }

        if (topLevelType.toLowerCase().includes("failed")) {
          sawFailureEvent = true;
          const failureText = extractTextParts(event.error ?? event)
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .join(" ");
          if (failureText) {
            failureParts.push(failureText);
          }
        }

        if (topLevelType === "error") {
          const errorParts = extractTextParts(event);
          if (errorParts.length > 0) {
            failureParts.push(errorParts.join(" "));
            if (params.onStream) {
              params.onStream({
                type: "error",
                content: errorParts.join(" "),
                raw: event,
              });
            }
          }
          return;
        }

        const parts = extractTextParts(event)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);

        if (parts.length > 0) {
          const terminalEvent = isTerminalStreamEventType(topLevelType);
          const streamEventType = classifyStreamEventType(streamType);
          if (params.onStream && streamEventType) {
            params.onStream({
              type: streamEventType,
              content: parts.join(" "),
              rawType: streamType,
              raw: event,
            });
          }

          if (streamType.toLowerCase().includes("delta")) {
            deltaParts.push(...parts);
          } else if (terminalEvent) {
            terminalParts.push(...parts);
          } else if (streamEventType === "message") {
            fullParts.push(...parts);
          }
        }
      } catch {
        if (source === "stderr") {
          stderrOutput += `${line}\n`;
        } else {
          stdoutOutput += `${line}\n`;
        }
      }
    };

    const flushLines = (source: "stdout" | "stderr", flushAll: boolean): void => {
      const buffer = source === "stdout" ? stdoutBuffer : stderrBuffer;
      const lines = buffer.split(/\r?\n/);
      const remain = flushAll ? "" : (lines.pop() ?? "");
      if (source === "stdout") {
        stdoutBuffer = remain;
      } else {
        stderrBuffer = remain;
      }

      for (const rawLine of lines) {
        processLine(rawLine, source);
      }
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
    }, params.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      flushLines("stdout", false);
    });

    child.stderr?.on("data", (chunk) => {
      stderrBuffer += String(chunk);
      flushLines("stderr", false);
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        ok: false,
        reply: "",
        sessionId,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      flushLines("stdout", true);
      flushLines("stderr", true);

      const bestTerminal = pickLongest(terminalParts);
      const bestFull = pickLongest(fullParts);
      const bestFailure = pickLongest(failureParts);
      const mergedReply = (bestTerminal || bestFull || deltaParts.join("") || stdoutOutput.trim()).trim();
      const mergedFailure = (bestFailure || stderrOutput.trim()).trim();

      if (code === 0 && sawFailureEvent) {
        resolve({
          ok: false,
          reply: mergedReply,
          sessionId,
          error: mergedFailure || "codex turn failed",
        });
        return;
      }
      if (code === 0) {
        resolve({
          ok: true,
          reply: mergedReply,
          sessionId,
        });
        return;
      }

      resolve({
        ok: false,
        reply: mergedReply,
        sessionId,
        error: mergedFailure || "codex execution failed",
      });
    });
  });
}

export async function shutdownCodexProcesses(): Promise<void> {
  if (appServerClient) {
    try {
      await appServerClient.shutdown();
    } catch {
      // Ignore app-server shutdown errors.
    }
    appServerClient = null;
  }

  if (activeCodexProcesses.size === 0) {
    return;
  }

  const processes = Array.from(activeCodexProcesses);
  for (const child of processes) {
    try {
      child.kill();
    } catch {
      // Ignore and continue shutdown.
    }
  }

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      const remaining = Array.from(activeCodexProcesses);
      for (const child of remaining) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore and continue shutdown.
        }
      }
      resolve();
    }, 500);
  });
}
