import fs from "node:fs";
import type {
  BaselineComparison,
  EvaluationResult,
  FinalDecision,
  ScenarioEvaluationReport,
} from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadScenarioReportFromJson(filePath: string): ScenarioEvaluationReport {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ScenarioEvaluationReport | EvaluationResult;
  if ("report" in raw) {
    return raw.report;
  }
  return raw;
}

export function compareAgainstBaseline(
  current: ScenarioEvaluationReport,
  baseline: ScenarioEvaluationReport,
  baselineReportPath: string,
): BaselineComparison {
  if (current.scenario.id !== baseline.scenario.id) {
    return {
      baselineReportPath,
      baselineScenarioId: baseline.scenario.id,
      baselineScore: baseline.score,
      currentScore: current.score,
      deltaScore: current.score - baseline.score,
      deltaVerdict: "unclear",
      deltaConfidence: 0.25,
      efficiencyVerdict: "unclear",
      efficiencyNotes: ["baseline report의 scenario id가 current와 다르다."],
      summary: "Baseline scenario가 달라 직접 비교할 수 없다.",
    };
  }

  const deltaScore = current.score - baseline.score;
  const deltaVerdict =
    deltaScore >= 5 ? "better" : deltaScore <= -5 ? "worse" : Math.abs(deltaScore) <= 2 ? "same" : "unclear";

  const efficiencyNotes: string[] = [];
  let worseSignals = 0;
  let betterSignals = 0;

  if (current.metrics.jobCount < baseline.metrics.jobCount) {
    efficiencyNotes.push(`job 수 감소: ${baseline.metrics.jobCount} -> ${current.metrics.jobCount}`);
    betterSignals += 1;
  } else if (current.metrics.jobCount > baseline.metrics.jobCount) {
    efficiencyNotes.push(`job 수 증가: ${baseline.metrics.jobCount} -> ${current.metrics.jobCount}`);
    worseSignals += 1;
  }

  if (current.metrics.questionCount < baseline.metrics.questionCount) {
    efficiencyNotes.push(`질문 수 감소: ${baseline.metrics.questionCount} -> ${current.metrics.questionCount}`);
    betterSignals += 1;
  } else if (current.metrics.questionCount > baseline.metrics.questionCount) {
    efficiencyNotes.push(`질문 수 증가: ${baseline.metrics.questionCount} -> ${current.metrics.questionCount}`);
    worseSignals += 1;
  }

  if (current.metrics.agentMessageCount < baseline.metrics.agentMessageCount) {
    efficiencyNotes.push(
      `agent message 수 감소: ${baseline.metrics.agentMessageCount} -> ${current.metrics.agentMessageCount}`,
    );
    betterSignals += 1;
  } else if (current.metrics.agentMessageCount > baseline.metrics.agentMessageCount + 1) {
    efficiencyNotes.push(
      `agent message 수 증가: ${baseline.metrics.agentMessageCount} -> ${current.metrics.agentMessageCount}`,
    );
    worseSignals += 1;
  }

  if (current.metrics.durationMs < baseline.metrics.durationMs * 0.9) {
    efficiencyNotes.push(`실행 시간 단축: ${baseline.metrics.durationMs}ms -> ${current.metrics.durationMs}ms`);
    betterSignals += 1;
  } else if (current.metrics.durationMs > baseline.metrics.durationMs * 1.2) {
    efficiencyNotes.push(`실행 시간 증가: ${baseline.metrics.durationMs}ms -> ${current.metrics.durationMs}ms`);
    worseSignals += 1;
  }

  let efficiencyVerdict: BaselineComparison["efficiencyVerdict"] = "same";
  if (betterSignals > 0 && worseSignals === 0) {
    efficiencyVerdict = "better";
  } else if (worseSignals > 0 && betterSignals === 0) {
    efficiencyVerdict = "worse";
  } else if (worseSignals > 0 && betterSignals > 0) {
    efficiencyVerdict = "unclear";
  }

  const confidenceBase =
    deltaVerdict === "better" || deltaVerdict === "worse"
      ? 0.75 + Math.min(Math.abs(deltaScore), 15) / 50
      : deltaVerdict === "same"
        ? 0.7
        : 0.5;
  const efficiencyAdjustment =
    efficiencyVerdict === "unclear" ? -0.15 : efficiencyVerdict === "same" ? -0.05 : 0;

  const deltaConfidence = clamp(confidenceBase + efficiencyAdjustment, 0.2, 0.95);

  const summary =
    deltaVerdict === "better"
      ? `Baseline 대비 ${deltaScore}점 상승했다.`
      : deltaVerdict === "worse"
        ? `Baseline 대비 ${Math.abs(deltaScore)}점 하락했다.`
        : deltaVerdict === "same"
          ? "Baseline과 유사한 점수대다."
          : "점수 변화가 애매해 개선 여부가 불명확하다.";

  return {
    baselineReportPath,
    baselineScenarioId: baseline.scenario.id,
    baselineScore: baseline.score,
    currentScore: current.score,
    deltaScore,
    deltaVerdict,
    deltaConfidence,
    efficiencyVerdict,
    efficiencyNotes,
    summary,
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
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
    default:
      return "실패 기준에 맞는 행동 제약을 프롬프트에 더 구체적으로 반영한다.";
  }
}

export function buildFinalDecision(
  report: ScenarioEvaluationReport,
  comparison: BaselineComparison | null,
): FinalDecision {
  const hardGateFailure = report.hardGates.some((gate) => !gate.passed);
  const strengths = uniqueNonEmpty([
    ...report.criteria.filter((criterion) => criterion.passed).slice(0, 3).map((criterion) => criterion.label),
    ...(comparison?.deltaVerdict === "better" ? ["baseline 대비 품질 개선"] : []),
    ...(comparison?.efficiencyVerdict === "better" ? ["효율성 개선"] : []),
  ]);
  const weaknesses = uniqueNonEmpty([
    ...report.criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.evidence),
    ...report.hardGates.filter((gate) => !gate.passed).map((gate) => gate.evidence),
    ...(comparison?.efficiencyVerdict === "worse" ? comparison.efficiencyNotes : []),
  ]);
  const nextPromptChanges = uniqueNonEmpty([
    ...report.criteria.filter((criterion) => !criterion.passed).map((criterion) => suggestionForCriterion(criterion.key)),
    ...(comparison?.efficiencyVerdict === "worse"
      ? ["중간 보고와 질문을 줄여 더 적은 턴으로 끝나도록 프롬프트를 압축한다."]
      : []),
    ...(!comparison ? ["baseline report를 저장해 다음 실험부터 개선 폭을 비교 가능하게 만든다."] : []),
  ]);

  if (hardGateFailure || report.verdict === "fail") {
    return {
      decision: "reject",
      reason: report.hardGates.find((gate) => !gate.passed)?.evidence ?? report.summary,
      strengths,
      weaknesses,
      nextPromptChanges,
    };
  }

  if (!comparison) {
    return {
      decision: "hold",
      reason: "현재 실행은 통과했지만 baseline report가 없어 개선 여부를 판정할 수 없다.",
      strengths,
      weaknesses,
      nextPromptChanges,
    };
  }

  if (comparison.deltaVerdict === "worse") {
    return {
      decision: "reject",
      reason: `Baseline 대비 품질이 악화됐다. ${comparison.summary}`,
      strengths,
      weaknesses,
      nextPromptChanges,
    };
  }

  if (comparison.deltaVerdict === "better" && comparison.efficiencyVerdict !== "worse") {
    return {
      decision: "promote",
      reason: `Baseline 대비 개선이 확인됐다. ${comparison.summary}`,
      strengths,
      weaknesses,
      nextPromptChanges,
    };
  }

  if (comparison.deltaVerdict === "unclear" && comparison.efficiencyVerdict === "unclear") {
    return {
      decision: "investigate",
      reason: "점수 변화와 효율성 변화가 엇갈려 추가 진단이 필요하다.",
      strengths,
      weaknesses,
      nextPromptChanges,
    };
  }

  return {
    decision: "hold",
    reason:
      comparison.deltaVerdict === "better"
        ? "품질은 좋아졌지만 효율성이 악화돼 바로 승격하기 어렵다."
        : "Baseline 대비 개선 폭이 충분히 명확하지 않다.",
    strengths,
    weaknesses,
    nextPromptChanges,
  };
}
