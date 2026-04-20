import fs from "node:fs";
import type { EvaluationArtifactPaths, EvaluationResult } from "../types";

export function writeEvaluationMarkdown(
  artifactPaths: EvaluationArtifactPaths,
  evaluation: EvaluationResult,
): EvaluationArtifactPaths {
  const { report, baselineComparison, finalDecision } = evaluation;
  const markdown = [
    `# ${report.scenario.title} Evaluation Report`,
    ``,
    `- Scenario: ${report.scenario.id}`,
    `- Codex kind: ${evaluation.codexKind}`,
    `- Runtime: ${evaluation.runtime}`,
    `- Score: ${report.score}/${report.maxScore}`,
    `- Verdict: ${report.verdict}`,
    `- Final decision: ${finalDecision.decision}`,
    `- Duration: ${report.metrics.durationMs}ms`,
    ``,
    `## Summary`,
    ``,
    report.summary,
    ``,
    `## Final Decision`,
    ``,
    `- Reason: ${finalDecision.reason}`,
    `- Strengths: ${finalDecision.strengths.length > 0 ? finalDecision.strengths.join(" | ") : "(none)"}`,
    `- Weaknesses: ${finalDecision.weaknesses.length > 0 ? finalDecision.weaknesses.join(" | ") : "(none)"}`,
    `- Next changes: ${finalDecision.nextPromptChanges.length > 0 ? finalDecision.nextPromptChanges.join(" | ") : "(none)"}`,
    ``,
    `## Baseline Comparison`,
    ``,
    ...(baselineComparison
      ? [
          `- Baseline score: ${baselineComparison.baselineScore}`,
          `- Current score: ${baselineComparison.currentScore}`,
          `- Delta: ${baselineComparison.deltaScore}`,
          `- Delta verdict: ${baselineComparison.deltaVerdict} (confidence ${baselineComparison.deltaConfidence.toFixed(2)})`,
          `- Efficiency verdict: ${baselineComparison.efficiencyVerdict}`,
          `- Notes: ${baselineComparison.efficiencyNotes.length > 0 ? baselineComparison.efficiencyNotes.join(" | ") : "(none)"}`,
          `- Summary: ${baselineComparison.summary}`,
        ]
      : ["- none"]),
    ``,
    `## Hard Gates`,
    ``,
    ...report.hardGates.map((gate) => `- [${gate.passed ? "x" : " "}] ${gate.label} - ${gate.evidence}`),
    ``,
    `## Metrics`,
    ``,
    `- Jobs: ${report.metrics.jobCount}`,
    `- Agent messages: ${report.metrics.agentMessageCount}`,
    `- User messages: ${report.metrics.userMessageCount}`,
    `- System messages: ${report.metrics.systemMessageCount}`,
    `- Questions: ${report.metrics.questionCount}`,
    `- Max delegation depth: ${report.metrics.maxDelegationDepth}`,
    ``,
    `## Criteria`,
    ``,
    ...report.criteria.map(
      (criterion) =>
        `- [${criterion.passed ? "x" : " "}] ${criterion.label}: ${criterion.earnedScore}/${criterion.maxScore} - ${criterion.evidence}`,
    ),
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
      const mentions = entry.mentions.length > 0 ? `  mentions: ${entry.mentions.join(", ")}` : "  mentions: (none)";
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

  fs.writeFileSync(artifactPaths.markdownPath, markdown, "utf8");
  return artifactPaths;
}
