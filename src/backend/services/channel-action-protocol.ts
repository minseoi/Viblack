export type ChannelActionType = "delegate" | "report" | "ask_user" | "final" | "noop";

export interface ParsedChannelAction {
  type: ChannelActionType;
  targetName: string | null;
  mode: string | null;
  deliverTo: string | null;
  question: string | null;
}

const channelActionPattern = /\[CHANNEL_ACTION\]\s*([\s\S]*?)\s*\[\/CHANNEL_ACTION\]/g;

function normalizeActionType(value: string): ChannelActionType | null {
  switch (value.trim().toLowerCase()) {
    case "delegate":
      return "delegate";
    case "report":
      return "report";
    case "ask_user":
      return "ask_user";
    case "final":
      return "final";
    case "noop":
      return "noop";
    default:
      return null;
  }
}

function normalizeTargetName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("@{") && trimmed.endsWith("}")) {
    return trimmed.slice(2, -1).trim();
  }
  return trimmed.replace(/^@/, "").trim();
}

export function parseChannelActions(content: string): ParsedChannelAction[] {
  const actions: ParsedChannelAction[] = [];

  for (const match of content.matchAll(channelActionPattern)) {
    const nextAction: ParsedChannelAction = {
      type: "noop",
      targetName: null,
      mode: null,
      deliverTo: null,
      question: null,
    };

    for (const rawLine of match[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();

      if (key === "type") {
        const normalizedType = normalizeActionType(value);
        if (normalizedType) {
          nextAction.type = normalizedType;
        }
        continue;
      }

      if (key === "target") {
        nextAction.targetName = normalizeTargetName(value) || null;
        continue;
      }

      if (key === "mode") {
        nextAction.mode = value || null;
        continue;
      }

      if (key === "deliver_to") {
        nextAction.deliverTo = normalizeTargetName(value) || null;
        continue;
      }

      if (key === "question") {
        nextAction.question = value || null;
      }
    }

    actions.push(nextAction);
  }

  return actions;
}
