import fs from "node:fs";
import path from "node:path";
import { runDelegationBasicEvaluation } from "./scenarios/delegation-basic";
import { ensureDirectory, resolveRepoRoot } from "./runtime/paths";
import type { EvaluationResult } from "./types";

interface CliOptions {
  scenario?: string;
  suite?: string;
  codexKind: "real";
  outputDir?: string;
  previousReportPath?: string;
  runtime?: string;
}

const SUITES: Record<string, string[]> = {
  "prompt-regression": ["delegation-basic"],
};

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  node dist/tools/evaluator/run.js --scenario delegation-basic --codex real --previous-report path/to/report.json",
      "  node dist/tools/evaluator/run.js --suite prompt-regression --codex real",
      "",
      "Options:",
      "  --scenario <id>           Scenario id to run",
      "  --suite <id>              Suite id to run",
      "  --codex <real>            Codex runtime kind (default: real)",
      "  --output-dir <path>       Directory to store evaluation artifacts",
      "  --previous-report <path>  Prior report JSON for qualitative comparison",
      "  --runtime <name>          Codex runtime preference, e.g. exec or app-server",
      "  --help                    Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    codexKind: "real",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--scenario") {
      options.scenario = next;
      index += 1;
    } else if (arg === "--suite") {
      options.suite = next;
      index += 1;
    } else if (arg === "--codex") {
      if (next !== "real") {
        throw new Error("fake codex mode is not supported by evaluate-tool CLI. Use real Codex only.");
      }
      options.codexKind = next;
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = next;
      index += 1;
    } else if (arg === "--previous-report" || arg === "--baseline-report") {
      options.previousReportPath = next;
      index += 1;
    } else if (arg === "--runtime") {
      options.runtime = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.scenario && !options.suite) {
    throw new Error("one of --scenario or --suite is required");
  }
  if (options.scenario && options.suite) {
    throw new Error("--scenario and --suite cannot be used together");
  }

  return options;
}

function resolveScenarioIds(options: CliOptions): string[] {
  if (options.scenario) {
    return [options.scenario];
  }
  const suiteScenarios = SUITES[options.suite ?? ""];
  if (!suiteScenarios) {
    throw new Error(`unknown suite: ${options.suite}`);
  }
  return suiteScenarios;
}

function defaultOutputDir(repoRoot: string, label: string, codexKind: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(repoRoot, "eval-results", `${stamp}-${label}-${codexKind}`);
}

function summarizeEvaluation(evaluation: EvaluationResult): string {
  const comparison = evaluation.previousRunComparison
    ? ` compare=${evaluation.previousRunComparison.verdict}`
    : "";
  return `[${evaluation.scenarioId}] ${evaluation.report.verdict}${comparison}`;
}

function writeSuiteSummary(outputDir: string, evaluations: EvaluationResult[]): void {
  const summaryJsonPath = path.join(outputDir, "suite.summary.json");
  const summaryMdPath = path.join(outputDir, "suite.summary.md");
  fs.writeFileSync(
    summaryJsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        evaluations: evaluations.map((evaluation) => ({
          scenarioId: evaluation.scenarioId,
          verdict: evaluation.report.verdict,
          improvementAreaCount: evaluation.feedback.improvementAreas.length,
          comparisonVerdict: evaluation.previousRunComparison?.verdict ?? null,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const markdown = [
    "# Evaluator Suite Summary",
    "",
    ...evaluations.map(
      (evaluation) =>
        `- ${evaluation.scenarioId}: verdict=${evaluation.report.verdict}, improvementAreas=${evaluation.feedback.improvementAreas.length}, compare=${evaluation.previousRunComparison?.verdict ?? "n/a"}`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(summaryMdPath, markdown, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const scenarioIds = resolveScenarioIds(options);
  const outputDir = ensureDirectory(
    path.resolve(options.outputDir ?? defaultOutputDir(repoRoot, options.suite ?? options.scenario ?? "eval", options.codexKind)),
  );

  const evaluations: EvaluationResult[] = [];
  for (const scenarioId of scenarioIds) {
    if (scenarioId !== "delegation-basic") {
      throw new Error(`unsupported scenario: ${scenarioId}`);
    }
    const scenarioOutputDir = scenarioIds.length > 1 ? ensureDirectory(path.join(outputDir, scenarioId)) : outputDir;
    const { evaluation, artifactPaths } = await runDelegationBasicEvaluation({
      codexKind: options.codexKind,
      outputDir: scenarioOutputDir,
      previousReportPath: options.previousReportPath,
      runtime: options.runtime,
      repoRoot,
    });
    evaluations.push(evaluation);
    process.stdout.write(`${summarizeEvaluation(evaluation)}\n`);
    process.stdout.write(`  json: ${artifactPaths.jsonPath}\n`);
    process.stdout.write(`  md:   ${artifactPaths.markdownPath}\n`);
  }

  if (evaluations.length > 1) {
    writeSuiteSummary(outputDir, evaluations);
  }

  if (evaluations.some((evaluation) => evaluation.report.verdict === "fail")) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[viblack-evaluator] ${message}\n`);
  process.exit(1);
});
