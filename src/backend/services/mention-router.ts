import type { Agent } from "../types";

export interface MentionedAgent {
  agentId: string;
  mentionName: string;
}

function isMentionBoundaryChar(char: string | undefined): boolean {
  return !char || /[\s.,!?;:()[\]{}<>"'`]/.test(char);
}

const allowedMentionSuffixes = [
  "에게서",
  "한테서",
  "에게는",
  "한테는",
  "에게도",
  "한테도",
  "이랑",
  "으로",
  "에게",
  "한테",
  "께서",
  "에서",
  "께는",
  "께도",
  "보고",
  "이여",
  "랑",
  "과",
  "와",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "도",
  "만",
  "의",
  "로",
  "께",
];

function hasAllowedMentionSuffix(content: string, afterIndex: number): boolean {
  for (const suffix of allowedMentionSuffixes) {
    if (!content.startsWith(suffix, afterIndex)) {
      continue;
    }
    const suffixAfter = content[afterIndex + suffix.length];
    if (isMentionBoundaryChar(suffixAfter)) {
      return true;
    }
  }
  return false;
}

export function extractMentionedAgents(
  content: string,
  candidateAgents: Agent[],
): MentionedAgent[] {
  const normalizedContent = content.toLowerCase();
  const candidates = [...candidateAgents]
    .map((agent) => ({ id: agent.id, name: agent.name.trim() }))
    .filter((agent) => agent.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  const seenAgentIds = new Set<string>();
  const mentions: MentionedAgent[] = [];

  for (const candidate of candidates) {
    const normalizedName = candidate.name.toLowerCase();
    const mentionTokens = [`@${normalizedName}`, `@{${normalizedName}}`];

    for (const token of mentionTokens) {
      let index = normalizedContent.indexOf(token);
      while (index >= 0) {
        const before = index > 0 ? normalizedContent[index - 1] : undefined;
        const afterIndex = index + token.length;
        const after = afterIndex < normalizedContent.length ? normalizedContent[afterIndex] : undefined;

        if (
          isMentionBoundaryChar(before) &&
          (isMentionBoundaryChar(after) || hasAllowedMentionSuffix(normalizedContent, afterIndex))
        ) {
          if (!seenAgentIds.has(candidate.id)) {
            seenAgentIds.add(candidate.id);
            mentions.push({ agentId: candidate.id, mentionName: candidate.name });
          }
          break;
        }
        index = normalizedContent.indexOf(token, index + 1);
      }
      if (seenAgentIds.has(candidate.id)) {
        break;
      }
    }
  }

  return mentions;
}
