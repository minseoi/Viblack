import type { Agent, ChannelMessageKind, SenderType } from "../types";
import { sanitizeText } from "./text-utils";

export function isAgentMessageStreamType(rawType: string | undefined): boolean {
  if (!rawType) {
    return false;
  }
  const normalized = rawType.toLowerCase();
  return normalized === "agent_message" || normalized.includes(".agent_message");
}

export interface ChannelPromptMemberSummary {
  name: string;
  role: string;
  roleProfile: string | null;
}

export interface ChannelPromptTimelineEntry {
  senderLabel: string;
  senderType: SenderType;
  messageKind: ChannelMessageKind;
  content: string;
}

function formatPromptTextBlock(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const safeValue = normalized || "(empty)";
  return safeValue.split("\n").map((line) => `  ${line}`);
}

export function buildChannelPrompt(input: {
  channelName: string;
  channelDescription?: string | null;
  targetAgentName: string;
  taskRequesterName?: string | null;
  members: ChannelPromptMemberSummary[];
  recentMessages: ChannelPromptTimelineEntry[];
  triggerMessage: ChannelPromptTimelineEntry | null;
}): string {
  const membersBlock =
    input.members.length > 0
      ? input.members.map((member, index) => {
          const parts = [`${index + 1}. ${member.name}`, `role=${member.role}`];
          if (member.roleProfile) {
            parts.push(`profile=${member.roleProfile}`);
          }
          return parts.join(" | ");
        })
      : ["(none)"];

  const recentMessagesBlock =
    input.recentMessages.length > 0
      ? input.recentMessages.flatMap((message, index) => [
          `${index + 1}. [${message.senderType}/${message.messageKind}] ${message.senderLabel}`,
          ...formatPromptTextBlock(message.content),
        ])
      : ["(no recent public messages)"];

  const triggerMessageBlock = input.triggerMessage
    ? [
        `[${input.triggerMessage.senderType}/${input.triggerMessage.messageKind}] ${input.triggerMessage.senderLabel}`,
        ...formatPromptTextBlock(input.triggerMessage.content),
      ]
    : ["(trigger message unavailable)"];

  return [
    `채널 이름: #${input.channelName}`,
    input.channelDescription ? `채널 설명: ${input.channelDescription}` : "",
    `현재 응답 담당 멤버: ${input.targetAgentName}`,
    "이 채널은 공개 협업 공간입니다. 멤버 목록과 최근 공개 대화를 먼저 읽고 응답하세요.",
    "필요하면 확인 질문을 하되, 채널에 없는 멤버를 가정하지 말고 아래 멤버의 정확한 이름만 사용하세요.",
    "다른 멤버에게 질문하거나 일을 시킬 때는 답변 본문에 정확한 채널 멘션을 써야 실제 실행됩니다.",
    "예시: 공백 없는 이름은 @존, 공백 있는 이름은 @{John Smith} 형태를 사용하세요.",
    "다른 멤버의 결과가 아직 채널에 올라오지 않았다면, 받은 것처럼 말하지 말고 먼저 멘션으로 위임하세요.",
    input.taskRequesterName
      ? "현재 작업을 준 멤버가 있다면, 재질문이나 결과 보고를 할 때 반드시 그 멤버를 명시적으로 멘션하세요."
      : "",
    "",
    "[ACTIVE_TASK_REQUESTER_BEGIN]",
    input.taskRequesterName || "(none)",
    "[ACTIVE_TASK_REQUESTER_END]",
    "",
    "[CHANNEL_MEMBERS_BEGIN]",
    ...membersBlock,
    "[CHANNEL_MEMBERS_END]",
    "",
    "[CHANNEL_RECENT_MESSAGES_BEGIN]",
    ...recentMessagesBlock,
    "[CHANNEL_RECENT_MESSAGES_END]",
    "",
    "[ACTIVE_TRIGGER_MESSAGE_BEGIN]",
    ...triggerMessageBlock,
    "[ACTIVE_TRIGGER_MESSAGE_END]",
  ].join("\n");
}

export function buildMemberExecutionSystemPrompt(
  agent: Agent,
  context: "dm" | "channel",
): string {
  const roleProfile = sanitizeText(agent.roleProfile);
  const userDefinedPrompt = sanitizeText(agent.systemPrompt);
  return [
    "You are a Viblack member agent.",
    "",
    "[IDENTITY]",
    `- Name: ${agent.name}`,
    `- Role: ${agent.role}`,
    roleProfile ? `- Role profile: ${roleProfile}` : "",
    "",
    "[CONTEXT]",
    `- Runtime context: ${context === "dm" ? "direct_message" : "channel_collaboration"}`,
    "- Product: Viblack (AI workspace messenger)",
    "",
    "[EXECUTION_RULES]",
    "1) Prioritize the user request in the active conversation.",
    "2) Follow USER_DEFINED_MEMBER_PROMPT as role-specific behavior.",
    "3) When requirements are ambiguous, ask a concise clarifying question before execution.",
    context === "channel"
      ? "4) In channel collaboration, read CHANNEL_MEMBERS and CHANNEL_RECENT_MESSAGES before replying."
      : "",
    context === "channel"
      ? "5) If you ask, assign, hand off, or delegate work to another member, your reply must include an exact channel mention to that member (@name or @{name}); otherwise no execution occurs."
      : "",
    context === "channel"
      ? "6) If the active request tells you to use another member's help and then summarize, delegate first via mention and wait for that member's public reply before claiming their findings."
      : "",
    context === "channel"
      ? "7) If another member delegates work to you in channel, post the result publicly and mention the delegating member back using their exact name so the chain can continue."
      : "",
    context === "channel"
      ? "8) If ACTIVE_TASK_REQUESTER exists and you ask a clarifying question or report a result, explicitly mention that requester in the message body. A plain question without @mention can break the workflow."
      : "",
    context === "channel"
      ? "9) Do not claim to have another member's findings unless that member has already replied in CHANNEL_RECENT_MESSAGES."
      : "",
    context === "channel"
      ? "10) Only mention exact member display names that appear in CHANNEL_MEMBERS."
      : "",
    "",
    "[VALIDATION_RULES]",
    "1) Distinguish facts from assumptions. Mark uncertainty explicitly.",
    "2) Do not fabricate outcomes, references, or execution results.",
    "3) Keep outputs practical and directly actionable.",
    "",
    "[SAFETY_GATES]",
    "1) Refuse harmful, illegal, or policy-violating requests.",
    "2) Do not expose secrets, credentials, or sensitive internal data.",
    "3) If a request exceeds granted permissions, state the required permission first.",
    "",
    "[OUTPUT_FORMAT]",
    "1) Default language: Korean. If the user requests another language, follow it.",
    "2) Lead with the conclusion, then provide concise supporting details.",
    "3) If execution steps are needed, provide numbered next actions.",
    "",
    "[USER_DEFINED_MEMBER_PROMPT_BEGIN]",
    userDefinedPrompt || "(none)",
    "[USER_DEFINED_MEMBER_PROMPT_END]",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
