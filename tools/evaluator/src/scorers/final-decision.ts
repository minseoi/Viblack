import fs from "node:fs";
import type {
  EvalCriterion,
  EvalGateCheck,
  EvaluationResult,
  PreviousRunComparison,
  PromptFeedback,
  ScenarioEvaluationReport,
} from "../types";

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function buildCheckMaps<T extends EvalCriterion | EvalGateCheck>(checks: T[]): Map<string, T> {
  return new Map(checks.map((check) => [check.key, check]));
}

function recordCheckDelta(
  kindLabel: string,
  currentChecks: Array<EvalCriterion | EvalGateCheck>,
  previousChecks: Array<EvalCriterion | EvalGateCheck>,
  improvements: string[],
  regressions: string[],
  unchangedConcerns: string[],
): void {
  const previousByKey = buildCheckMaps(previousChecks);
  for (const currentCheck of currentChecks) {
    const previousCheck = previousByKey.get(currentCheck.key);
    if (!previousCheck) {
      continue;
    }

    if (!previousCheck.passed && currentCheck.passed) {
      improvements.push(`${kindLabel} 개선: ${currentCheck.label}`);
      continue;
    }

    if (previousCheck.passed && !currentCheck.passed) {
      regressions.push(`${kindLabel} 퇴보: ${currentCheck.evidence}`);
      continue;
    }

    if (!previousCheck.passed && !currentCheck.passed) {
      unchangedConcerns.push(`${kindLabel} 미해결: ${currentCheck.evidence}`);
    }
  }
}

function compareMetricDirection(
  label: string,
  previousValue: number,
  currentValue: number,
  improvements: string[],
  regressions: string[],
): void {
  if (currentValue < previousValue) {
    improvements.push(`${label} 감소: ${previousValue} -> ${currentValue}`);
  } else if (currentValue > previousValue) {
    regressions.push(`${label} 증가: ${previousValue} -> ${currentValue}`);
  }
}

function compareDuration(
  previousDurationMs: number,
  currentDurationMs: number,
  improvements: string[],
  regressions: string[],
): void {
  if (currentDurationMs < previousDurationMs * 0.9) {
    improvements.push(`실행 시간 단축: ${previousDurationMs}ms -> ${currentDurationMs}ms`);
  } else if (currentDurationMs > previousDurationMs * 1.2) {
    regressions.push(`실행 시간 증가: ${previousDurationMs}ms -> ${currentDurationMs}ms`);
  }
}

export function loadScenarioReportFromJson(filePath: string): ScenarioEvaluationReport {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ScenarioEvaluationReport | EvaluationResult;
  if ("report" in raw) {
    return raw.report;
  }
  return raw;
}

export function compareWithPreviousRun(
  current: ScenarioEvaluationReport,
  previous: ScenarioEvaluationReport,
  previousReportPath: string,
): PreviousRunComparison {
  if (current.scenario.id !== previous.scenario.id) {
    return {
      previousReportPath,
      previousScenarioId: previous.scenario.id,
      verdict: "uncomparable",
      improvements: [],
      regressions: [],
      unchangedConcerns: [],
      summary: "Previous report의 scenario id가 달라 직접 비교할 수 없다.",
    };
  }

  const improvements: string[] = [];
  const regressions: string[] = [];
  const unchangedConcerns: string[] = [];

  recordCheckDelta("criterion", current.criteria, previous.criteria, improvements, regressions, unchangedConcerns);
  recordCheckDelta("hard gate", current.hardGates, previous.hardGates, improvements, regressions, unchangedConcerns);

  compareMetricDirection("job 수", previous.metrics.jobCount, current.metrics.jobCount, improvements, regressions);
  compareMetricDirection(
    "질문 수",
    previous.metrics.questionCount,
    current.metrics.questionCount,
    improvements,
    regressions,
  );
  compareMetricDirection(
    "progress message 수",
    previous.metrics.progressMessageCount,
    current.metrics.progressMessageCount,
    improvements,
    regressions,
  );
  if (current.metrics.agentMessageCount < previous.metrics.agentMessageCount - 1) {
    improvements.push(
      `agent message 수 감소: ${previous.metrics.agentMessageCount} -> ${current.metrics.agentMessageCount}`,
    );
  } else if (current.metrics.agentMessageCount > previous.metrics.agentMessageCount + 1) {
    regressions.push(
      `agent message 수 증가: ${previous.metrics.agentMessageCount} -> ${current.metrics.agentMessageCount}`,
    );
  }
  compareDuration(previous.metrics.durationMs, current.metrics.durationMs, improvements, regressions);

  const verdict =
    improvements.length > 0 && regressions.length === 0
      ? "better"
      : regressions.length > 0 && improvements.length === 0
        ? "worse"
        : improvements.length > 0 && regressions.length > 0
          ? "mixed"
          : "same";

  const summary =
    verdict === "better"
      ? "직전 실행 대비 개선만 확인됐다."
      : verdict === "worse"
        ? "직전 실행 대비 퇴보만 확인됐다."
        : verdict === "mixed"
          ? "직전 실행 대비 개선과 퇴보가 함께 나타났다."
          : "직전 실행과 큰 차이가 없다.";

  return {
    previousReportPath,
    previousScenarioId: previous.scenario.id,
    verdict,
    improvements: uniqueNonEmpty(improvements),
    regressions: uniqueNonEmpty(regressions),
    unchangedConcerns: uniqueNonEmpty(unchangedConcerns),
    summary,
  };
}

function suggestionForCriterion(key: string): string {
  switch (key) {
    case "initial_coordinator":
      return "최초 요청을 coordinator가 직접 받아 라우팅하도록 역할 문구를 더 명확히 한다.";
    case "research_before_writer":
      return "조사 결과 없이는 writer 단계를 시작하지 말라고 의존 관계를 강화한다.";
    case "research_reported":
      return "researcher가 결과를 비공개 추론으로 끝내지 말고 공개 channel report로 남기게 강제한다.";
    case "writer_after_research":
      return "writer는 researcher 결과를 수신한 뒤에만 초안을 작성하도록 제한한다.";
    case "final_report":
      return "coordinator가 마지막에 사용자 대상 final 보고를 반드시 남기게 한다.";
    case "no_budget_exhausted":
      return "재멘션과 재위임 상한을 낮추고 불필요한 반복 보고를 금지한다.";
    case "no_question_loop":
      return "명확한 요청에서는 clarification 없이 진행하고 질문은 정말 필요한 경우만 하게 한다.";
    case "reasonable_job_count":
      return "중간 handoff와 중복 요약을 줄여 위임 체인을 압축한다.";
    case "compact_progress_updates":
      return "중간 progress 보고는 꼭 필요한 1~2회 수준으로 줄이고, 완료 직전까지 불필요한 상태 설명을 반복하지 않게 한다.";
    case "no_irrelevant_workspace_chatter":
      return "사용자 과업과 직접 관련 없는 repo/워크스페이스 탐색 설명은 공개 답변에 드러내지 말고 결과 보고에 집중하게 한다.";
    case "no_generic_test_disclaimer":
      return "문서/비코드 작업에서는 generic한 테스트 미실행 문구를 제거하고 산출물과 핵심 결과만 보고하게 한다.";
    default:
      return "실패 기준에 맞는 행동 제약을 프롬프트에 더 구체적으로 반영한다.";
  }
}

export function buildPromptFeedback(
  report: ScenarioEvaluationReport,
  comparison: PreviousRunComparison | null,
): PromptFeedback {
  const strengths = uniqueNonEmpty([
    ...report.criteria.filter((criterion) => criterion.passed).slice(0, 3).map((criterion) => criterion.label),
    ...(report.hardGates.every((gate) => gate.passed) ? ["핵심 hard gate를 모두 통과함"] : []),
    ...(comparison?.improvements.slice(0, 2) ?? []),
  ]);

  const improvementAreas = uniqueNonEmpty([
    ...report.hardGates.filter((gate) => !gate.passed).map((gate) => gate.evidence),
    ...report.criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.evidence),
    ...(comparison?.regressions ?? []),
    ...(comparison?.unchangedConcerns ?? []),
  ]);

  const nextPromptChanges = uniqueNonEmpty([
    ...report.criteria.filter((criterion) => !criterion.passed).map((criterion) => suggestionForCriterion(criterion.key)),
    ...(comparison?.regressions.some((entry) => entry.includes("질문 수 증가"))
      ? ["clarification은 정말 필요한 경우에만 허용하고, 질문 후 바로 후속 실행으로 이어지는 루프를 더 강하게 금지한다."]
      : []),
    ...(comparison?.regressions.some((entry) => entry.includes("progress message 수 증가"))
      ? ["worker의 progress 업데이트 수를 제한하고, 상태 설명보다 결과 보고를 우선하도록 문구를 압축한다."]
      : []),
  ]);

  return {
    strengths,
    improvementAreas,
    nextPromptChanges,
  };
}
