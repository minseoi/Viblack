import fs from "node:fs";
import path from "node:path";
import type { EvaluationArtifactPaths, EvaluationResult } from "../types";

export function writeEvaluationJson(outputDir: string, stem: string, evaluation: EvaluationResult): EvaluationArtifactPaths {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${stem}.report.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  return {
    jsonPath,
    markdownPath: path.join(outputDir, `${stem}.report.md`),
  };
}
