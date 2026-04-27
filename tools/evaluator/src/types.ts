export type CodexKind = "real" | "fake";

export type EvaluationVerdict = "pass" | "fail";

export type ComparisonVerdict = "better" | "same" | "worse" | "mixed" | "uncomparable";

export interface ChannelAction {
  type: string;
  target?: string;
  artifactPath?: string;
}

export interface EvalTranscriptEntry {
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

export interface EvalJobEntry {
  id: number;
  sourceMessageId: number;
  targetAgentId: string;
  targetAgentName: string;
  executionKind: string;
  status: string;
  depth: number;
  errorText: string | null;
}

export interface EvalCriterion {
  key: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface EvalGateCheck {
  key: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface EfficiencyMetrics {
  jobCount: number;
  agentMessageCount: number;
  progressMessageCount: number;
  userMessageCount: number;
  systemMessageCount: number;
  questionCount: number;
  maxDelegationDepth: number;
  durationMs: number;
}

export interface ScenarioEvaluationReport {
  scenario: {
    id: string;
    title: string;
    objective: string;
    channelId: string;
    channelName: string;
    initialPrompt: string;
    agentNames: {
      coordinator: string;
      researcher: string;
      writer: string;
    };
  };
  startedAt: string;
  finishedAt: string;
  transcript: EvalTranscriptEntry[];
  jobs: EvalJobEntry[];
  verdict: EvaluationVerdict;
  criteria: EvalCriterion[];
  hardGates: EvalGateCheck[];
  issues: string[];
  summary: string;
  metrics: EfficiencyMetrics;
}

export interface PreviousRunComparison {
  previousReportPath: string;
  previousScenarioId: string;
  verdict: ComparisonVerdict;
  improvements: string[];
  regressions: string[];
  unchangedConcerns: string[];
  summary: string;
}

export interface PromptFeedback {
  strengths: string[];
  improvementAreas: string[];
  nextPromptChanges: string[];
}

export interface EvaluationRuntimePaths {
  outputDir: string;
  runtimeDir: string;
  dbPath: string;
  backendWorkspaceDir: string;
  scenarioWorkspaceDir: string;
}

export interface EvaluationResult {
  toolName: "viblack-evaluator";
  toolVersion: 1;
  generatedAt: string;
  scenarioId: string;
  codexKind: CodexKind;
  runtime: string;
  report: ScenarioEvaluationReport;
  feedback: PromptFeedback;
  previousRunComparison: PreviousRunComparison | null;
  runtimePaths: EvaluationRuntimePaths;
}

export interface EvaluationArtifactPaths {
  jsonPath: string;
  markdownPath: string;
}
