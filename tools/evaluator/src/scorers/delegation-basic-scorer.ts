import type {
  EvalCriterion,
  EvalGateCheck,
  EvalJobEntry,
  EvalTranscriptEntry,
  ScenarioEvaluationReport,
} from "../types";

function isQuestionLike(content: string): boolean {
  return ["?", "선택해", "답변", "알려줘", "알려 주세요", "확인해 주세요", "물어", "질문"].some((token) =>
    content.includes(token),
  );
}

function buildCriterion(
  key: string,
  label: string,
  passed: boolean,
  evidence: string,
): EvalCriterion {
  return {
    key,
    label,
    passed,
    evidence,
  };
}

function buildGateCheck(key: string, label: string, passed: boolean, evidence: string): EvalGateCheck {
  return {
    key,
    label,
    passed,
    evidence,
  };
}

export function evaluateDelegationBasicReport(input: {
  channelId: string;
  channelName: string;
  initialPrompt: string;
  transcript: EvalTranscriptEntry[];
  jobs: EvalJobEntry[];
  coordinatorId: string;
  researcherId: string;
  writerId: string;
  coordinatorName: string;
  researcherName: string;
  writerName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}): ScenarioEvaluationReport {
  const mentionsById = new Map<number, string[]>(input.transcript.map((entry) => [entry.id, entry.mentions]));
  const nonProgressMessages = input.transcript.filter((entry) => entry.messageKind !== "progress");
  const agentMessages = nonProgressMessages.filter((entry) => entry.senderType === "agent");
  const progressMessages = input.transcript.filter(
    (entry) => entry.senderType === "agent" && entry.messageKind === "progress",
  );
  const systemMessages = nonProgressMessages.filter((entry) => entry.senderType === "system");
  const userMessages = nonProgressMessages.filter((entry) => entry.senderType === "user");

  const firstCoordinatorJob = input.jobs.find((job) => job.targetAgentId === input.coordinatorId);
  const firstResearcherJob = input.jobs.find((job) => job.targetAgentId === input.researcherId);
  const firstWriterJob = input.jobs.find((job) => job.targetAgentId === input.writerId);
  const firstResearcherMessage = agentMessages.find((entry) => entry.senderId === input.researcherId);
  const firstWriterMessage = agentMessages.find((entry) => entry.senderId === input.writerId);
  const lastAgentMessage = agentMessages[agentMessages.length - 1];
  const finalCoordinatorActionMessage = [...agentMessages]
    .reverse()
    .find((entry) => entry.senderId === input.coordinatorId && entry.actions.some((action) => action.type === "final"));

  const coordinatorFirst = Boolean(firstCoordinatorJob && input.jobs[0]?.targetAgentId === input.coordinatorId);
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
        lastAgentMessage.senderId === input.coordinatorId &&
        Number(lastAgentMessage.id) > Number(firstWriterMessage?.id ?? 0) &&
        (mentionsById.get(lastAgentMessage.id)?.length ?? 0) === 0),
  );
  const noBudgetExhausted = !systemMessages.some((entry) => entry.content.includes("멘션 실행 한도"));
  const noRunningJobs = !input.jobs.some((job) => job.status === "queued" || job.status === "running");

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

  const reasonableJobCount = input.jobs.length > 0 && input.jobs.length <= 6;
  const compactProgressUpdates = progressMessages.length <= 3;
  const irrelevantWorkspaceChatterMessage = input.transcript.find((entry) => {
    if (entry.senderType !== "agent") {
      return false;
    }
    return ["codexdocs/", "워크스페이스를 확인해 보니", "파일도 비어 있는 상태"].some((token) =>
      entry.content.includes(token),
    );
  });
  const genericTestDisclaimerMessage = agentMessages.find((entry) =>
    ["테스트는 진행하지 않았습니다", "코드 검증", "별도 코드 검증"].some((token) => entry.content.includes(token)),
  );

  const criteria = [
    buildCriterion(
      "initial_coordinator",
      "최초 요청이 coordinator에게 전달됨",
      coordinatorFirst,
      coordinatorFirst ? `첫 실행 대상이 ${input.coordinatorName}였다.` : "첫 실행 대상이 coordinator가 아니거나 job이 비어 있다.",
    ),
    buildCriterion(
      "research_before_writer",
      "조사 단계가 문서화보다 먼저 시작됨",
      researchBeforeWriter,
      researchBeforeWriter
        ? `${input.researcherName} job(${firstResearcherJob?.id})이 ${input.writerName} job(${firstWriterJob?.id})보다 먼저 생성됐다.`
        : "문서화가 조사보다 먼저 시작됐거나, 두 단계 중 하나가 누락됐다.",
    ),
    buildCriterion(
      "research_reported",
      "조사 결과가 공개 채널에 보고됨",
      researcherReported,
      researcherReported
        ? `${input.researcherName}가 message ${firstResearcherMessage?.id}로 공개 보고를 남겼다.`
        : `${input.researcherName}의 공개 결과 메시지를 찾지 못했다.`,
    ),
    buildCriterion(
      "writer_after_research",
      "문서 작성이 조사 결과 이후에 진행됨",
      writerAfterResearch,
      writerAfterResearch
        ? `${input.writerName}의 첫 결과(message ${firstWriterMessage?.id})가 조사 결과 이후에 나왔다.`
        : "문서 작성 결과가 조사 결과보다 먼저 나오거나 누락됐다.",
    ),
    buildCriterion(
      "final_report",
      "coordinator가 사용자에게 최종 완료를 보고함",
      finalCoordinatorReport,
      finalCoordinatorReport
        ? `${input.coordinatorName}가 후속 멘션 없이 마지막 답변을 남겼다.`
        : `${input.coordinatorName}의 명확한 최종 보고를 찾지 못했다.`,
    ),
    buildCriterion(
      "no_budget_exhausted",
      "실행 예산 소진 없이 종료됨",
      noBudgetExhausted,
      noBudgetExhausted ? "예산 소진 시스템 메시지가 없다." : "멘션 실행 한도 소진 메시지가 기록됐다.",
    ),
    buildCriterion(
      "no_question_loop",
      "사용자 답변 없이 내부 질문 루프로 진행하지 않음",
      !questionWithoutUserFollowup,
      questionWithoutUserFollowup
        ? `message ${questionWithoutUserFollowup.id}에서 질문 후 사용자 응답 없이 후속 에이전트 실행이 이어졌다.`
        : "질문 후 사용자 응답 없는 내부 진행 루프가 감지되지 않았다.",
    ),
    buildCriterion(
      "reasonable_job_count",
      "위임 체인이 과도하게 증식하지 않음",
      reasonableJobCount,
      reasonableJobCount ? `실행 job 수는 ${input.jobs.length}건이다.` : `실행 job 수가 과도하다: ${input.jobs.length}건.`,
    ),
    buildCriterion(
      "compact_progress_updates",
      "중간 progress 보고가 과도하게 반복되지 않음",
      compactProgressUpdates,
      compactProgressUpdates
        ? `progress message 수는 ${progressMessages.length}건이다.`
        : `progress message가 과도하다: ${progressMessages.length}건.`,
    ),
    buildCriterion(
      "no_irrelevant_workspace_chatter",
      "작업과 무관한 workspace 탐색 설명을 공개 채널에 흘리지 않음",
      !irrelevantWorkspaceChatterMessage,
      irrelevantWorkspaceChatterMessage
        ? `message ${irrelevantWorkspaceChatterMessage.id}에서 불필요한 workspace 탐색 설명이 노출됐다.`
        : "작업과 무관한 workspace 탐색 설명이 감지되지 않았다.",
    ),
    buildCriterion(
      "no_generic_test_disclaimer",
      "비코드 작업 결과에 generic 테스트 미실행 문구를 붙이지 않음",
      !genericTestDisclaimerMessage,
      genericTestDisclaimerMessage
        ? `message ${genericTestDisclaimerMessage.id}에서 generic 테스트 미실행 문구가 노출됐다.`
        : "generic 테스트 미실행 문구가 감지되지 않았다.",
    ),
  ];

  const hardGates = [
    buildGateCheck(
      "job_execution_completed",
      "실행 job이 시작되고 정리됨",
      input.jobs.length > 0 && noRunningJobs,
      input.jobs.length > 0 && noRunningJobs
        ? `총 ${input.jobs.length}건의 job이 종료 상태로 수집됐다.`
        : "실행 job이 없거나 queued/running 상태가 남아 있다.",
    ),
    buildGateCheck(
      "final_report_present",
      "최종 완료 보고가 존재함",
      finalCoordinatorReport,
      finalCoordinatorReport ? `${input.coordinatorName}의 최종 보고가 확인됐다.` : "최종 완료 보고가 누락됐다.",
    ),
    buildGateCheck(
      "budget_not_exhausted",
      "실행 예산 소진이 발생하지 않음",
      noBudgetExhausted,
      noBudgetExhausted ? "예산 소진이 없었다." : "예산 소진 시스템 메시지가 기록됐다.",
    ),
  ];

  const issues = [
    ...criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.evidence),
    ...hardGates.filter((gate) => !gate.passed).map((gate) => gate.evidence),
  ];
  const verdict = hardGates.every((gate) => gate.passed) ? "pass" : "fail";
  const summary =
    verdict === "pass"
      ? issues.length === 0
        ? "Delegation flow completed and no prompt improvement areas were flagged."
        : `Delegation flow completed, but ${issues.length} prompt improvement area(s) were flagged.`
      : `Delegation flow failed. ${issues[0] ?? "No issue details available."}`;

  const questionCount = agentMessages.filter((entry) => isQuestionLike(entry.content)).length;

  return {
    scenario: {
      id: "delegation-basic",
      title: "Delegation Basic",
      objective: "coordinator -> researcher -> writer -> coordinator 순서의 기본 채널 협업 흐름을 검증한다.",
      channelId: input.channelId,
      channelName: input.channelName,
      initialPrompt: input.initialPrompt,
      agentNames: {
        coordinator: input.coordinatorName,
        researcher: input.researcherName,
        writer: input.writerName,
      },
    },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    transcript: input.transcript,
    jobs: input.jobs,
    verdict,
    criteria,
    hardGates,
    issues,
    summary,
    metrics: {
      jobCount: input.jobs.length,
      agentMessageCount: agentMessages.length,
      progressMessageCount: progressMessages.length,
      userMessageCount: userMessages.length,
      systemMessageCount: systemMessages.length,
      questionCount,
      maxDelegationDepth: input.jobs.reduce((maxDepth, job) => Math.max(maxDepth, job.depth), 0),
      durationMs: input.durationMs,
    },
  };
}
