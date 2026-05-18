import fs from "node:fs";
import path from "node:path";
import { apiRequest, launchBackendHarness } from "../runtime/backend-harness";
import { ensureDirectory, resolveFakeCodexPath, resolveRepoRoot } from "../runtime/paths";
import { writeEvaluationJson } from "../reporters/json-reporter";
import { writeEvaluationMarkdown } from "../reporters/markdown-reporter";
import { evaluateDelegationBasicReport } from "../scorers/delegation-basic-scorer";
import { buildFinalDecision, compareAgainstBaseline, loadScenarioReportFromJson } from "../scorers/final-decision";
import type {
  ChannelAction,
  CodexKind,
  EvalJobEntry,
  EvalTranscriptEntry,
  EvaluationResult,
} from "../types";

export const DELEGATION_BASIC_SCENARIO_ID = "delegation-basic";

export interface RunDelegationBasicEvaluationOptions {
  codexKind: CodexKind;
  outputDir: string;
  baselineReportPath?: string;
  runtime?: string;
  settleOptions?: {
    timeoutMs?: number;
    quietMs?: number;
    pollMs?: number;
    maxRunningMs?: number;
  };
  extraEnv?: Record<string, string | undefined>;
  repoRoot?: string;
}

interface DelegationScenarioAgent {
  id: string;
  name: string;
  role: string;
}

interface DelegationScenario {
  channelId: string;
  channelName: string;
  workspacePath: string;
  agents: {
    coordinator: DelegationScenarioAgent;
    researcher: DelegationScenarioAgent;
    writer: DelegationScenarioAgent;
  };
  initialPrompt: string;
}

interface ChannelApiMessage {
  id: number;
  senderType: "user" | "agent" | "system";
  senderId: string | null;
  content: string;
  messageKind: string;
  createdAt: string;
}

interface ChannelApiMessagesPayload {
  channel: { id: string; name: string };
  members: Array<{ id: string; name: string; role: string }>;
  messages: ChannelApiMessage[];
  mentionsByMessage: Record<number, Array<{ agentId: string; mentionName: string }>>;
}

interface ChannelApiJobsPayload {
  channel: { id: string; name: string };
  jobs: Array<{
    id: number;
    sourceMessageId: number;
    targetAgentId: string;
    executionKind: string;
    status: string;
    depth: number;
    errorText: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }>;
}

function assertStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected ${expected}, got ${actual}`);
  }
}

function resolveCodexPath(kind: CodexKind, repoRoot: string): string {
  return kind === "real" ? "codex" : resolveFakeCodexPath(repoRoot);
}

function createScenarioWorkspaceDir(rootDir: string, label: string): string {
  const safeLabel = label.replace(/[^a-z0-9_.-]+/gi, "-");
  const workspacePath = path.join(rootDir, `${safeLabel}-${Date.now()}`);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

async function createDelegationScenario(backendBaseUrl: string, scenarioWorkspaceRoot: string): Promise<DelegationScenario> {
  const coordinatorCreate = await apiRequest<{ agent: { id: string; name: string; role: string } }>(
    backendBaseUrl,
    "/api/agents",
    {
      method: "POST",
      body: {
        name: "영희",
        role: "시스템 기획자",
        systemPrompt: [
          "너는 영희다.",
          "역할은 시스템 기획자이자 채널 조율자다.",
          "사용자 목표를 구조화하고 필요한 경우 멤버에게 일을 나눈 뒤 결과를 취합한다.",
          "채널 프로토콜이 주어지면 반드시 CHANNEL_ACTION 형식을 지킨다.",
          "의존 관계가 있는 작업은 한 번에 한 단계씩만 넘긴다.",
          "다음 단계를 예고할 수는 있지만, 실제 실행은 선행 결과가 채널에 올라온 뒤에만 시작한다.",
          "불확실하면 추정으로 확정하지 말고 필요한 질문만 최소화한다.",
          "답변은 짧고 명확하게 유지하고, 최종 답변은 사용자가 바로 쓸 수 있게 정리한다.",
        ].join("\n"),
      },
    },
  );
  assertStatus(coordinatorCreate.status, 201, "create coordinator");

  const researcherCreate = await apiRequest<{ agent: { id: string; name: string; role: string } }>(
    backendBaseUrl,
    "/api/agents",
    {
      method: "POST",
      body: {
        name: "존",
        role: "리서치 전문가",
        systemPrompt: [
          "너는 존이다.",
          "역할은 리서치 전문가다.",
          "사실 기반 조사 결과를 짧고 명확하게 정리한다.",
          "모르는 것은 추정하지 않고 불확실성을 명시한다.",
          "이 평가에서는 깊은 웹 리서치보다 빠른 1차 실무 초안을 우선한다.",
          "latest가 명시되지 않으면 보유 지식으로 먼저 답하고, 한 턴 안에 끝낸다.",
          "채널 worker로 호출되면 다른 멤버에게 넘기지 말고 결과를 공개 보고한 뒤 CHANNEL_ACTION type=report 로 영희에게 돌려준다.",
        ].join("\n"),
      },
    },
  );
  assertStatus(researcherCreate.status, 201, "create researcher");

  const writerCreate = await apiRequest<{ agent: { id: string; name: string; role: string } }>(
    backendBaseUrl,
    "/api/agents",
    {
      method: "POST",
      body: {
        name: "매튜",
        role: "문서 작성 전문가",
        systemPrompt: [
          "너는 매튜다.",
          "역할은 문서 작성 전문가다.",
          "조사 결과나 요구사항을 실무 문서로 구조화한다.",
          "근거 없는 사실을 새로 만들지 않는다.",
          "채널 worker로 호출되면 한 턴 안에 초안을 만들고 CHANNEL_ACTION type=report 로 영희에게 돌려준다.",
          "문서는 사용자가 바로 전달 가능한 수준으로 간결하게 정리한다.",
        ].join("\n"),
      },
    },
  );
  assertStatus(writerCreate.status, 201, "create writer");

  const channelName = `delegation-eval-${Date.now()}`;
  const workspacePath = createScenarioWorkspaceDir(scenarioWorkspaceRoot, channelName);
  const channelCreate = await apiRequest<{ channel: { id: string; name: string } }>(backendBaseUrl, "/api/channels", {
    method: "POST",
    body: {
      name: channelName,
      description: "channel delegation evaluation loop",
      workspacePath,
    },
  });
  assertStatus(channelCreate.status, 201, "create channel");

  const channelId = channelCreate.data.channel.id;
  for (const agentId of [
    coordinatorCreate.data.agent.id,
    researcherCreate.data.agent.id,
    writerCreate.data.agent.id,
  ]) {
    const addMember = await apiRequest(backendBaseUrl, `/api/channels/${channelId}/members`, {
      method: "POST",
      body: { agentId },
    });
    assertStatus(addMember.status, 201, `add member ${agentId}`);
  }

  return {
    channelId,
    channelName,
    workspacePath,
    agents: {
      coordinator: coordinatorCreate.data.agent,
      researcher: researcherCreate.data.agent,
      writer: writerCreate.data.agent,
    },
    initialPrompt:
      "@영희 인스타 맛집 계정 운영을 시작하는 사람에게 줄 가이드 문서를 만들어야 해. 존한테 조사 시키고 그거를 매튜한테 문서 만들게 시킨 다음에 나한테 알려줘",
  };
}

async function runDelegationScenario(backendBaseUrl: string, scenario: DelegationScenario): Promise<void> {
  const sendMessage = await apiRequest<{ message: { id: number } }>(
    backendBaseUrl,
    `/api/channels/${scenario.channelId}/messages`,
    {
      method: "POST",
      body: {
        content: scenario.initialPrompt,
        messageKind: "general",
      },
    },
  );
  assertStatus(sendMessage.status, 200, "send delegation message");
}

async function waitForChannelToSettle(
  backendBaseUrl: string,
  channelId: string,
  options?: {
    timeoutMs?: number;
    quietMs?: number;
    pollMs?: number;
    maxRunningMs?: number;
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const quietMs = options?.quietMs ?? 4_000;
  const pollMs = options?.pollMs ?? 800;
  const maxRunningMs = options?.maxRunningMs ?? 150_000;
  const startedAt = Date.now();
  let stableSince = 0;
  let lastFingerprint = "";

  while (Date.now() - startedAt < timeoutMs) {
    const [messagesResponse, jobsResponse] = await Promise.all([
      apiRequest<ChannelApiMessagesPayload>(backendBaseUrl, `/api/channels/${channelId}/messages`),
      apiRequest<ChannelApiJobsPayload>(backendBaseUrl, `/api/channels/${channelId}/executions`),
    ]);

    const messages = messagesResponse.data.messages;
    const jobs = jobsResponse.data.jobs;
    const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
    const stalledJob = activeJobs.find((job) => {
      if (!job.startedAt || job.status !== "running") {
        return false;
      }
      const jobStartedAt = Number.parseInt(String(Date.parse(job.startedAt)), 10);
      return Number.isFinite(jobStartedAt) && Date.now() - jobStartedAt >= maxRunningMs;
    });
    const fingerprint = `${messages[messages.length - 1]?.id ?? 0}:${jobs
      .map((job) => `${job.id}:${job.status}`)
      .join("|")}`;

    if (stalledJob) {
      return;
    }

    if (activeJobs.length === 0) {
      if (fingerprint === lastFingerprint) {
        if (stableSince === 0) {
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= quietMs) {
          return;
        }
      } else {
        lastFingerprint = fingerprint;
        stableSince = Date.now();
      }
    } else {
      lastFingerprint = fingerprint;
      stableSince = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`channel did not settle within ${timeoutMs}ms`);
}

function parseChannelActions(content: string): ChannelAction[] {
  const actions: ChannelAction[] = [];
  const patterns = [
    /CHANNEL_ACTION_BEGIN\s*([\s\S]*?)\s*CHANNEL_ACTION_END/g,
    /\[CHANNEL_ACTION\]\s*([\s\S]*?)\s*(?:\[\/CHANNEL_ACTION\]|\[\/CHANNEL_ACTION>|<\/CHANNEL_ACTION>)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const block = match[1];
      const nextAction: ChannelAction = { type: "" };
      for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        const separatorIndex = line.indexOf("=");
        if (separatorIndex < 0) {
          continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key === "type") {
          nextAction.type = value;
        } else if (key === "target") {
          nextAction.target = value;
        } else if (key === "artifact_path") {
          nextAction.artifactPath = value;
        }
      }
      if (nextAction.type) {
        actions.push(nextAction);
      }
    }
  }
  return actions;
}

async function collectDelegationReport(input: {
  backendBaseUrl: string;
  scenario: DelegationScenario;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}) {
  const [messagesResponse, jobsResponse] = await Promise.all([
    apiRequest<ChannelApiMessagesPayload>(input.backendBaseUrl, `/api/channels/${input.scenario.channelId}/messages`),
    apiRequest<ChannelApiJobsPayload>(input.backendBaseUrl, `/api/channels/${input.scenario.channelId}/executions`),
  ]);
  assertStatus(messagesResponse.status, 200, "load channel messages");
  assertStatus(jobsResponse.status, 200, "load channel executions");

  const memberNameById = new Map(messagesResponse.data.members.map((member) => [member.id, member.name]));
  const transcript = messagesResponse.data.messages.map<EvalTranscriptEntry>((message) => ({
    id: message.id,
    senderType: message.senderType,
    senderId: message.senderId,
    senderName:
      message.senderType === "user"
        ? "User"
        : message.senderType === "system"
          ? "System"
          : memberNameById.get(message.senderId ?? "") ?? message.senderId ?? "Unknown",
    messageKind: message.messageKind,
    createdAt: message.createdAt,
    content: message.content,
    mentions: (messagesResponse.data.mentionsByMessage[message.id] ?? []).map((mention) => mention.mentionName),
    actions: parseChannelActions(message.content),
  }));

  const jobs = jobsResponse.data.jobs.map<EvalJobEntry>((job) => ({
    id: job.id,
    sourceMessageId: job.sourceMessageId,
    targetAgentId: job.targetAgentId,
    targetAgentName: memberNameById.get(job.targetAgentId) ?? job.targetAgentId,
    executionKind: job.executionKind,
    status: job.status,
    depth: job.depth,
    errorText: job.errorText,
  }));

  return evaluateDelegationBasicReport({
    channelId: input.scenario.channelId,
    channelName: input.scenario.channelName,
    initialPrompt: input.scenario.initialPrompt,
    transcript,
    jobs,
    coordinatorId: input.scenario.agents.coordinator.id,
    researcherId: input.scenario.agents.researcher.id,
    writerId: input.scenario.agents.writer.id,
    coordinatorName: input.scenario.agents.coordinator.name,
    researcherName: input.scenario.agents.researcher.name,
    writerName: input.scenario.agents.writer.name,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
  });
}

export async function runDelegationBasicEvaluation(
  options: RunDelegationBasicEvaluationOptions,
): Promise<{ evaluation: EvaluationResult; artifactPaths: { jsonPath: string; markdownPath: string } }> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const outputDir = ensureDirectory(path.resolve(options.outputDir));
  const runtimeDir = ensureDirectory(path.join(outputDir, "runtime"));
  const backendWorkspaceDir = ensureDirectory(path.join(runtimeDir, "backend-workspace"));
  const scenarioWorkspaceDir = ensureDirectory(path.join(runtimeDir, "channel-workspaces"));
  const dbPath = path.join(runtimeDir, "viblack.evaluator.sqlite");
  const runtime =
    options.codexKind === "fake"
      ? "app-server"
      : options.runtime?.trim() || process.env.VIBLACK_CODEX_RUNTIME?.trim() || "app-server";

  const server = await launchBackendHarness({
    repoRoot,
    appDir: repoRoot,
    dbPath,
    workspaceDir: backendWorkspaceDir,
    env: {
      ...options.extraEnv,
      VIBLACK_CODEX_PATH: resolveCodexPath(options.codexKind, repoRoot),
      VIBLACK_CODEX_RUNTIME: runtime,
    },
  });

  try {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const scenario = await createDelegationScenario(server.backendBaseUrl, scenarioWorkspaceDir);
    await runDelegationScenario(server.backendBaseUrl, scenario);
    await waitForChannelToSettle(server.backendBaseUrl, scenario.channelId, options.settleOptions);
    const finishedAt = new Date().toISOString();
    const report = await collectDelegationReport({
      backendBaseUrl: server.backendBaseUrl,
      scenario,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedAtMs,
    });

    const baselineComparison = options.baselineReportPath
      ? compareAgainstBaseline(report, loadScenarioReportFromJson(path.resolve(options.baselineReportPath)), path.resolve(options.baselineReportPath))
      : null;
    const finalDecision = buildFinalDecision(report, baselineComparison);

    const evaluation: EvaluationResult = {
      toolName: "viblack-evaluator",
      toolVersion: 1,
      generatedAt: new Date().toISOString(),
      scenarioId: DELEGATION_BASIC_SCENARIO_ID,
      codexKind: options.codexKind,
      runtime,
      report,
      baselineComparison,
      finalDecision,
      runtimePaths: {
        outputDir,
        runtimeDir,
        dbPath,
        backendWorkspaceDir,
        scenarioWorkspaceDir: scenario.workspacePath,
      },
    };

    const artifactPaths = writeEvaluationJson(outputDir, DELEGATION_BASIC_SCENARIO_ID, evaluation);
    writeEvaluationMarkdown(artifactPaths, evaluation);

    return { evaluation, artifactPaths };
  } finally {
    await server.close();
  }
}
