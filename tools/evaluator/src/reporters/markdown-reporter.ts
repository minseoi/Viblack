import fs from "node:fs";
import type { EvaluationArtifactPaths, EvaluationResult } from "../types";

export function writeEvaluationMarkdown(
  artifactPaths: EvaluationArtifactPaths,
  evaluation: EvaluationResult,
): EvaluationArtifactPaths {
  const { report, feedback, previousRunComparison } = evaluation;
  const markdown = [
    `# ${report.scenario.title} Evaluation Report`,
    ``,
    `- Scenario: ${report.scenario.id}`,
    `- Codex kind: ${evaluation.codexKind}`,
    `- Runtime: ${evaluation.runtime}`,
    `- Verdict: ${report.verdict}`,
    `- Improvement areas: ${feedback.improvementAreas.length}`,
    `- Previous comparison: ${previousRunComparison?.verdict ?? "none"}`,
    `- Duration: ${report.metrics.durationMs}ms`,
    ``,
    `## Summary`,
    ``,
    report.summary,
    ``,
    `## Prompt Feedback`,
    ``,
    `- Strengths: ${feedback.strengths.length > 0 ? feedback.strengths.join(" | ") : "(none)"}`,
    `- Improvement areas: ${feedback.improvementAreas.length > 0 ? feedback.improvementAreas.join(" | ") : "(none)"}`,
    `- Next changes: ${feedback.nextPromptChanges.length > 0 ? feedback.nextPromptChanges.join(" | ") : "(none)"}`,
    ``,
    `## Previous Run Comparison`,
    ``,
    ...(previousRunComparison
      ? [
          `- Previous report: ${previousRunComparison.previousReportPath}`,
          `- Verdict: ${previousRunComparison.verdict}`,
          `- Summary: ${previousRunComparison.summary}`,
          `- Improvements: ${previousRunComparison.improvements.length > 0 ? previousRunComparison.improvements.join(" | ") : "(none)"}`,
          `- Regressions: ${previousRunComparison.regressions.length > 0 ? previousRunComparison.regressions.join(" | ") : "(none)"}`,
          `- Unchanged concerns: ${previousRunComparison.unchangedConcerns.length > 0 ? previousRunComparison.unchangedConcerns.join(" | ") : "(none)"}`,
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
    `- Progress messages: ${report.metrics.progressMessageCount}`,
    `- User messages: ${report.metrics.userMessageCount}`,
    `- System messages: ${report.metrics.systemMessageCount}`,
    `- Questions: ${report.metrics.questionCount}`,
    `- Max delegation depth: ${report.metrics.maxDelegationDepth}`,
    ``,
    `## Criteria`,
    ``,
    ...report.criteria.map((criterion) => `- [${criterion.passed ? "x" : " "}] ${criterion.label} - ${criterion.evidence}`),
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
