import fs from "node:fs";
import path from "node:path";
import type { Agent } from "../types";
import { sanitizeText } from "./text-utils";

interface PromptTemplates {
  defaultMemberSystemPrompt: string;
  memberExecutionSystemPrompt: string;
  memberExecutionChannelRules: string;
  systemPromptGenerationUser: string;
  systemPromptGenerationSystem: string;
}

const PROMPT_TEMPLATE_FILES: Record<keyof PromptTemplates, string> = {
  defaultMemberSystemPrompt: "default-member-system-prompt.md",
  memberExecutionSystemPrompt: "member-execution-system-prompt.md",
  memberExecutionChannelRules: "member-execution-channel-rules.md",
  systemPromptGenerationUser: "system-prompt-generation-user.md",
  systemPromptGenerationSystem: "system-prompt-generation-system.md",
};

function normalizeTemplateText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function renderTemplate(template: string, values: Record<string, string>): string {
  const rendered = template.replace(/{{([a-zA-Z0-9_]+)}}/g, (_match, key: string) => values[key] ?? "");
  const unresolvedKeys = rendered.match(/{{[a-zA-Z0-9_]+}}/g);
  if (unresolvedKeys) {
    throw new Error(`unresolved prompt template placeholders: ${unresolvedKeys.join(", ")}`);
  }
  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}

function resolvePromptTemplateDir(appDir: string): string {
  const normalizedAppDir = path.resolve(appDir);
  const candidates = [
    path.join(normalizedAppDir, "src", "backend", "prompt-templates"),
    path.join(normalizedAppDir, "dist", "backend", "prompt-templates"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `prompt template directory not found. checked: ${candidates.join(", ")}`,
    );
  }
  return found;
}

function loadPromptTemplates(appDir: string): PromptTemplates {
  const templateDir = resolvePromptTemplateDir(appDir);
  return {
    defaultMemberSystemPrompt: normalizeTemplateText(
      fs.readFileSync(path.join(templateDir, PROMPT_TEMPLATE_FILES.defaultMemberSystemPrompt), "utf8"),
    ),
    memberExecutionSystemPrompt: normalizeTemplateText(
      fs.readFileSync(path.join(templateDir, PROMPT_TEMPLATE_FILES.memberExecutionSystemPrompt), "utf8"),
    ),
    memberExecutionChannelRules: normalizeTemplateText(
      fs.readFileSync(path.join(templateDir, PROMPT_TEMPLATE_FILES.memberExecutionChannelRules), "utf8"),
    ),
    systemPromptGenerationUser: normalizeTemplateText(
      fs.readFileSync(path.join(templateDir, PROMPT_TEMPLATE_FILES.systemPromptGenerationUser), "utf8"),
    ),
    systemPromptGenerationSystem: normalizeTemplateText(
      fs.readFileSync(path.join(templateDir, PROMPT_TEMPLATE_FILES.systemPromptGenerationSystem), "utf8"),
    ),
  };
}

export class PromptTemplateService {
  private readonly templates: PromptTemplates;

  constructor(appDir: string) {
    this.templates = loadPromptTemplates(appDir);
  }

  getDefaultMemberSystemPrompt(): string {
    return this.templates.defaultMemberSystemPrompt;
  }

  getRendererPromptTemplates(): { defaultMemberSystemPrompt: string } {
    return {
      defaultMemberSystemPrompt: this.getDefaultMemberSystemPrompt(),
    };
  }

  buildSystemPromptGenerationUserPrompt(input: { role: string; name?: string | null }): string {
    return renderTemplate(this.templates.systemPromptGenerationUser, {
      agentName: sanitizeText(input.name) || "(미지정)",
      agentRole: sanitizeText(input.role),
    });
  }

  getSystemPromptGenerationSystemPrompt(): string {
    return this.templates.systemPromptGenerationSystem;
  }

  buildMemberExecutionSystemPrompt(agent: Agent, context: "dm" | "channel"): string {
    const roleProfile = sanitizeText(agent.roleProfile);
    const userDefinedPrompt = sanitizeText(agent.systemPrompt) || "(none)";
    const channelExecutionRules =
      context === "channel" ? this.templates.memberExecutionChannelRules : "";

    return renderTemplate(this.templates.memberExecutionSystemPrompt, {
      agentName: agent.name,
      agentRole: agent.role,
      roleProfileLine: roleProfile ? `- Role profile: ${roleProfile}` : "",
      runtimeContext: context === "dm" ? "direct_message" : "channel_collaboration",
      channelExecutionRules,
      userDefinedPrompt,
    });
  }
}
