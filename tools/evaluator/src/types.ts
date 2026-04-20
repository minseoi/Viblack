export type CodexKind = "real" | "fake";

export type ScoreVerdict = "pass" | "fail";

export type DeltaVerdict = "better" | "same" | "worse" | "unclear";

export type EfficiencyVerdict = "better" | "same" | "worse" | "unclear";

export type FinalDecisionKind = "promote" | "hold" | "reject" | "investigate";

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
  maxScore: number;
  earnedScore: number;
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
  score: number;
  maxScore: number;
  verdict: ScoreVerdict;
  criteria: EvalCriterion[];
  hardGates: EvalGateCheck[];
  issues: string[];
  summary: string;
  metrics: EfficiencyMetrics;
}

export interface BaselineComparison {
  baselineReportPath: string;
  baselineScenarioId: string;
  baselineScore: number;
  currentScore: number;
  deltaScore: number;
  deltaVerdict: DeltaVerdict;
  deltaConfidence: number;
  efficiencyVerdict: EfficiencyVerdict;
  efficiencyNotes: string[];
  summary: string;
}

export interface FinalDecision {
  decision: FinalDecisionKind;
  reason: string;
  strengths: string[];
  weaknesses: string[];
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
  baselineComparison: BaselineComparison | null;
  finalDecision: FinalDecision;
  runtimePaths: EvaluationRuntimePaths;
}

export interface EvaluationArtifactPaths {
  jsonPath: string;
  markdownPath: string;
}
