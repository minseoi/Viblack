import fs from "node:fs";
import path from "node:path";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";

export interface DelegationScenarioAgent {
  id: string;
  name: string;
  role: string;
}

export interface DelegationScenario {
  channelId: string;
  channelName: string;
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

export interface DelegationTranscriptEntry {
  id: number;
  senderType: "user" | "agent" | "system";
  senderId: string | null;
  senderName: string;
  messageKind: string;
  createdAt: string;
  content: string;
  mentions: string[];
  actions: ChannelAction[];
}

export interface DelegationJobEntry {
  id: number;
  sourceMessageId: number;
  targetAgentId: string;
  targetAgentName: string;
  executionKind: string;
  status: string;
  depth: number;
  errorText: string | null;
}

export interface ChannelAction {
  type: string;
  target?: string;
  mode?: string;
  deliverTo?: string;
  question?: string;
}

export interface DelegationCriterion {
  key: string;
  label: string;
  maxScore: number;
  earnedScore: number;
  passed: boolean;
  evidence: string;
}

export interface DelegationEvaluationReport {
  scenario: {
    channelId: string;
    channelName: string;
    initialPrompt: string;
    agentNames: {
      coordinator: string;
      researcher: string;
      writer: string;
    };
  };
  transcript: DelegationTranscriptEntry[];
  jobs: DelegationJobEntry[];
  score: number;
  maxScore: number;
  verdict: "pass" | "fail";
  criteria: DelegationCriterion[];
  issues: string[];
  summary: string;
}

function resolveCodexPath(kind: "real" | "fake"): string {
  if (kind === "real") {
    return "codex";
  }
  if (process.platform === "win32") {
    return path.resolve(__dirname, "..", "fixtures", "fake-codex.cmd");
  }
  const unixPath = path.resolve(__dirname, "..", "fixtures", "fake-codex");
  try {
    fs.chmodSync(unixPath, 0o755);
  } catch {
    // Best-effort only.
  }
  return unixPath;
}

export async function launchDelegationEvalApp(
  testInfo: TestInfo,
  options: {
    codexKind: "real" | "fake";
    dbFileName: string;
    extraEnv?: Record<string, string | undefined>;
  },
): Promise<{ electronApp: ElectronApplication; page: Page; backendBaseUrl: string }> {
  const dbPath = testInfo.outputPath(options.dbFileName);
  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      ...options.extraEnv,
      VIBLACK_DB_PATH: dbPath,
      VIBLACK_CODEX_PATH: resolveCodexPath(options.codexKind),
      VIBLACK_KEEP_ALIVE_WITHOUT_WINDOW: "1",
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle("Viblack");
  await expect(page.locator("#status")).not.toHaveText("Loading...");
  const backendBaseUrl = await page.evaluate(async () => window.viblackApi.getBackendBaseUrl());
  return { electronApp, page, backendBaseUrl };
}

export async function apiRequest<T>(
  backendBaseUrl: string,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${backendBaseUrl}${pathname}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as T) : (null as T),
  };
}

export async function createDelegationScenario(backendBaseUrl: string): Promise<DelegationScenario> {
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
  expect(coordinatorCreate.status).toBe(201);

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
  expect(researcherCreate.status).toBe(201);

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
  expect(writerCreate.status).toBe(201);

  const channelName = `delegation-eval-${Date.now()}`;
  const channelCreate = await apiRequest<{ channel: { id: string; name: string } }>(backendBaseUrl, "/api/channels", {
    method: "POST",
    body: {
      name: channelName,
      description: "channel delegation evaluation loop",
    },
  });
  expect(channelCreate.status).toBe(201);

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
    expect(addMember.status).toBe(201);
  }

  return {
    channelId,
    channelName,
    agents: {
      coordinator: coordinatorCreate.data.agent,
      researcher: researcherCreate.data.agent,
      writer: writerCreate.data.agent,
    },
    initialPrompt:
      "@영희 인스타 맛집 계정 운영을 시작하는 사람에게 줄 가이드 문서를 만들어야 해. 존한테 조사 시키고 그거를 매튜한테 문서 만들게 시킨 다음에 나한테 알려줘",
  };
}

export async function runDelegationScenario(
  backendBaseUrl: string,
  scenario: DelegationScenario,
): Promise<{ sendMessageId: number }> {
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
  expect(sendMessage.status).toBe(200);
  return { sendMessageId: sendMessage.data.message.id };
}

export async function waitForChannelToSettle(
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
  const pattern = /\[CHANNEL_ACTION\]\s*([\s\S]*?)\s*\[\/CHANNEL_ACTION\]/g;
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
      } else if (key === "mode") {
        nextAction.mode = value;
      } else if (key === "deliver_to") {
        nextAction.deliverTo = value;
      } else if (key === "question") {
        nextAction.question = value;
      }
    }
    if (nextAction.type) {
      actions.push(nextAction);
    }
  }
  return actions;
}

function isQuestionLike(content: string): boolean {
  return ["?", "선택해", "답변", "알려줘", "알려 주세요", "확인해 주세요", "물어", "질문"].some((token) =>
    content.includes(token),
  );
}

function buildCriterion(
  key: string,
  label: string,
  maxScore: number,
  passed: boolean,
  evidence: string,
): DelegationCriterion {
  return {
    key,
    label,
    maxScore,
    earnedScore: passed ? maxScore : 0,
    passed,
    evidence,
  };
}

export function evaluateDelegationScenario(input: {
  scenario: DelegationScenario;
  transcript: DelegationTranscriptEntry[];
  jobs: DelegationJobEntry[];
}): DelegationEvaluationReport {
  const { scenario, transcript, jobs } = input;
  const mentionsById = new Map<number, string[]>(transcript.map((entry) => [entry.id, entry.mentions]));
  const coordinatorId = scenario.agents.coordinator.id;
  const researcherId = scenario.agents.researcher.id;
  const writerId = scenario.agents.writer.id;
  const nonProgressMessages = transcript.filter((entry) => entry.messageKind !== "progress");
  const agentMessages = nonProgressMessages.filter((entry) => entry.senderType === "agent");
  const systemMessages = nonProgressMessages.filter((entry) => entry.senderType === "system");
  const userMessages = nonProgressMessages.filter((entry) => entry.senderType === "user");

  const firstCoordinatorJob = jobs.find((job) => job.targetAgentId === coordinatorId);
  const firstResearcherJob = jobs.find((job) => job.targetAgentId === researcherId);
  const firstWriterJob = jobs.find((job) => job.targetAgentId === writerId);
  const firstResearcherMessage = agentMessages.find((entry) => entry.senderId === researcherId);
  const firstWriterMessage = agentMessages.find((entry) => entry.senderId === writerId);
  const lastAgentMessage = agentMessages[agentMessages.length - 1];
  const finalCoordinatorActionMessage = [...agentMessages]
    .reverse()
    .find((entry) => entry.senderId === coordinatorId && entry.actions.some((action) => action.type === "final"));

  const coordinatorFirst = Boolean(firstCoordinatorJob && jobs[0]?.targetAgentId === coordinatorId);
  const researchBeforeWriter =
    Boolean(firstResearcherJob) &&
    Boolean(firstWriterJob) &&
    Number(firstResearcherJob?.id ?? 0) < Number(firstWriterJob?.id ?? Number.MAX_SAFE_INTEGER);
  const researcherReported = Boolean(firstResearcherMessage);
  const writerAfterResearch =
    Boolean(firstWriterMessage) &&
    Boolean(firstResearcherMessage) &&
    Number(firstWriterMessage?.id ?? 0) > Number(firstResearcherMessage?.id ?? Number.MAX_SAFE_INTEGER);
  const finalCoordinatorReport = Boolean(
    finalCoordinatorActionMessage ||
      (lastAgentMessage &&
        lastAgentMessage.senderId === coordinatorId &&
        Number(lastAgentMessage.id) > Number(firstWriterMessage?.id ?? 0) &&
        (mentionsById.get(lastAgentMessage.id)?.length ?? 0) === 0),
  );
  const noBudgetExhausted = !systemMessages.some((entry) => entry.content.includes("멘션 실행 한도"));

  const questionWithoutUserFollowup = agentMessages.find((entry) => {
    if (!isQuestionLike(entry.content)) {
      return false;
    }
    if ((mentionsById.get(entry.id)?.length ?? 0) > 0 && !entry.content.includes("?")) {
      return false;
    }
    const hasLaterUser = userMessages.some((candidate) => candidate.id > entry.id);
    const hasLaterAgentWork = agentMessages.some((candidate) => candidate.id > entry.id);
    return !hasLaterUser && hasLaterAgentWork;
  });

  const reasonableJobCount = jobs.length > 0 && jobs.length <= 6;

  const criteria = [
    buildCriterion(
      "initial_coordinator",
      "최초 요청이 coordinator에게 전달됨",
      15,
      coordinatorFirst,
      coordinatorFirst
        ? `첫 실행 대상이 ${scenario.agents.coordinator.name}였다.`
        : "첫 실행 대상이 coordinator가 아니거나 job이 비어 있다.",
    ),
    buildCriterion(
      "research_before_writer",
      "조사 단계가 문서화보다 먼저 시작됨",
      20,
      researchBeforeWriter,
      researchBeforeWriter
        ? `${scenario.agents.researcher.name} job(${firstResearcherJob?.id})이 ${scenario.agents.writer.name} job(${firstWriterJob?.id})보다 먼저 생성됐다.`
        : "문서화가 조사보다 먼저 시작됐거나, 두 단계 중 하나가 누락됐다.",
    ),
    buildCriterion(
      "research_reported",
      "조사 결과가 공개 채널에 보고됨",
      15,
      researcherReported,
      researcherReported
        ? `${scenario.agents.researcher.name}가 message ${firstResearcherMessage?.id}로 공개 보고를 남겼다.`
        : `${scenario.agents.researcher.name}의 공개 결과 메시지를 찾지 못했다.`,
    ),
    buildCriterion(
      "writer_after_research",
      "문서 작성이 조사 결과 이후에 진행됨",
      15,
      writerAfterResearch,
      writerAfterResearch
        ? `${scenario.agents.writer.name}의 첫 결과(message ${firstWriterMessage?.id})가 조사 결과 이후에 나왔다.`
        : "문서 작성 결과가 조사 결과보다 먼저 나오거나 누락됐다.",
    ),
    buildCriterion(
      "final_report",
      "coordinator가 사용자에게 최종 완료를 보고함",
      20,
      finalCoordinatorReport,
      finalCoordinatorReport
        ? `${scenario.agents.coordinator.name}가 후속 멘션 없이 마지막 답변을 남겼다.`
        : `${scenario.agents.coordinator.name}의 명확한 최종 보고를 찾지 못했다.`,
    ),
    buildCriterion(
      "no_budget_exhausted",
      "실행 예산 소진 없이 종료됨",
      5,
      noBudgetExhausted,
      noBudgetExhausted ? "예산 소진 시스템 메시지가 없다." : "멘션 실행 한도 소진 메시지가 기록됐다.",
    ),
    buildCriterion(
      "no_question_loop",
      "사용자 답변 없이 내부 질문 루프로 진행하지 않음",
      5,
      !questionWithoutUserFollowup,
      questionWithoutUserFollowup
        ? `message ${questionWithoutUserFollowup.id}에서 질문 후 사용자 응답 없이 후속 에이전트 실행이 이어졌다.`
        : "질문 후 사용자 응답 없는 내부 진행 루프가 감지되지 않았다.",
    ),
    buildCriterion(
      "reasonable_job_count",
      "위임 체인이 과도하게 증식하지 않음",
      5,
      reasonableJobCount,
      reasonableJobCount ? `실행 job 수는 ${jobs.length}건이다.` : `실행 job 수가 과도하다: ${jobs.length}건.`,
    ),
  ];

  const score = criteria.reduce((sum, criterion) => sum + criterion.earnedScore, 0);
  const maxScore = criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  const issues = criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.evidence);
  const verdict = score >= 85 && issues.length === 0 ? "pass" : "fail";
  const summary =
    verdict === "pass"
      ? `Delegation flow succeeded with score ${score}/${maxScore}.`
      : `Delegation flow failed with score ${score}/${maxScore}. ${issues[0] ?? "No issue details available."}`;

  return {
    scenario: {
      channelId: scenario.channelId,
      channelName: scenario.channelName,
      initialPrompt: scenario.initialPrompt,
      agentNames: {
        coordinator: scenario.agents.coordinator.name,
        researcher: scenario.agents.researcher.name,
        writer: scenario.agents.writer.name,
      },
    },
    transcript,
    jobs,
    score,
    maxScore,
    verdict,
    criteria,
    issues,
    summary,
  };
}

export async function collectDelegationReport(
  backendBaseUrl: string,
  scenario: DelegationScenario,
): Promise<DelegationEvaluationReport> {
  const [messagesResponse, jobsResponse] = await Promise.all([
    apiRequest<ChannelApiMessagesPayload>(backendBaseUrl, `/api/channels/${scenario.channelId}/messages`),
    apiRequest<ChannelApiJobsPayload>(backendBaseUrl, `/api/channels/${scenario.channelId}/executions`),
  ]);

  const memberNameById = new Map(messagesResponse.data.members.map((member) => [member.id, member.name]));
  const transcript = messagesResponse.data.messages.map<DelegationTranscriptEntry>((message) => ({
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

  const jobs = jobsResponse.data.jobs.map<DelegationJobEntry>((job) => ({
    id: job.id,
    sourceMessageId: job.sourceMessageId,
    targetAgentId: job.targetAgentId,
    targetAgentName: memberNameById.get(job.targetAgentId) ?? job.targetAgentId,
    executionKind: job.executionKind,
    status: job.status,
    depth: job.depth,
    errorText: job.errorText,
  }));

  return evaluateDelegationScenario({ scenario, transcript, jobs });
}

export function writeDelegationArtifacts(
  testInfo: TestInfo,
  report: DelegationEvaluationReport,
  stem: string,
): { jsonPath: string; markdownPath: string } {
  const jsonPath = testInfo.outputPath(`${stem}.json`);
  const markdownPath = testInfo.outputPath(`${stem}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const markdown = [
    `# Delegation Evaluation Report`,
    ``,
    `- Score: ${report.score}/${report.maxScore}`,
    `- Verdict: ${report.verdict}`,
    `- Channel: ${report.scenario.channelName} (${report.scenario.channelId})`,
    ``,
    `## Prompt`,
    ``,
    "```text",
    report.scenario.initialPrompt,
    "```",
    ``,
    `## Criteria`,
    ``,
    ...report.criteria.map(
      (criterion) =>
        `- [${criterion.passed ? "x" : " "}] ${criterion.label}: ${criterion.earnedScore}/${criterion.maxScore} - ${criterion.evidence}`,
    ),
    ``,
    `## Issues`,
    ``,
    ...(report.issues.length > 0 ? report.issues.map((issue) => `- ${issue}`) : ["- none"]),
    ``,
    `## Jobs`,
    ``,
    ...report.jobs.map(
      (job) =>
        `- job ${job.id}: ${job.executionKind} -> ${job.targetAgentName} | status=${job.status} | depth=${job.depth} | sourceMessage=${job.sourceMessageId}`,
    ),
    ``,
    `## Transcript`,
    ``,
    ...report.transcript.map((entry) => {
      const header = `- [${entry.id}] ${entry.senderType}/${entry.messageKind} ${entry.senderName}`;
      const mentions =
        entry.mentions.length > 0 ? `  mentions: ${entry.mentions.join(", ")}` : "  mentions: (none)";
      const actions =
        entry.actions.length > 0
          ? `  actions: ${entry.actions
              .map((action) => `${action.type}${action.target ? `:${action.target}` : ""}`)
              .join(", ")}`
          : "  actions: (none)";
      const content = `  content: ${entry.content.replace(/\s+/g, " ").trim()}`;
      return [header, mentions, actions, content].join("\n");
    }),
    "",
  ].join("\n");

  fs.writeFileSync(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath };
}
