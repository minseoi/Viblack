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
  workspaceRoot: string;
  targetAgentName: string;
  coordinatorName?: string | null;
  targetAgentMode: "coordinator" | "worker";
  taskRequesterName?: string | null;
  requiresArtifactReport?: boolean;
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
    input.coordinatorName ? `채널 coordinator: ${input.coordinatorName}` : "",
    `현재 응답 모드: ${input.targetAgentMode}`,
    "이 채널은 공개 협업 공간입니다. 멤버 목록과 최근 공개 대화를 먼저 읽고 응답하세요.",
    "후속 자동 실행은 답변 마지막의 CHANNEL_ACTION 블록만 해석됩니다. 본문에 @mention이 있어도 실행 신호로 간주되지 않을 수 있습니다.",
    "반드시 답변 마지막에 정확히 하나의 CHANNEL_ACTION_BEGIN ... CHANNEL_ACTION_END 블록을 넣으세요.",
    "허용 action type은 delegate, report, ask_user, final, noop 입니다.",
    "delegate는 다른 멤버에게 새 작업을 넘길 때만 사용합니다. report는 맡은 작업 결과를 요청자나 coordinator에게 돌려줄 때 사용합니다.",
    "ask_user는 사용자 확인이 꼭 필요할 때만 사용합니다. final은 coordinator가 사용자에게 최종 결과를 전달하고 종료할 때 사용합니다.",
    input.requiresArtifactReport
      ? "이번 작업은 코드/파일 산출물이 필요한 구현 작업입니다. 계획만 말하고 끝내지 말고, 실제 파일 편집/생성을 마친 뒤에만 답하세요."
      : "",
    input.requiresArtifactReport
      ? `답변 본문에 실제 산출물 파일 경로를 넣고, 마지막 CHANNEL_ACTION report에도 artifact_path를 포함하세요. artifact_path는 실제로 존재하는 경로여야 합니다. workspace root: ${input.workspaceRoot}`
      : "",
    input.targetAgentMode === "coordinator"
      ? "당신은 coordinator 입니다. 의존 관계가 있는 작업은 한 번에 한 단계씩만 위임하세요. 조사 결과가 채널에 올라오기 전에는 문서 작성처럼 다음 단계를 시작하지 마세요."
      : "당신은 worker 입니다. 다른 worker에게 다시 위임하거나 사용자를 직접 상대하지 말고, 맡은 결과를 공개 채널에 올린 뒤 requester/coordinator에게 report 하세요.",
    input.taskRequesterName
      ? `현재 작업을 직접 넘긴 멤버: ${input.taskRequesterName}`
      : "현재 작업을 직접 넘긴 멤버: User",
    "action block 예시:",
    "CHANNEL_ACTION_BEGIN",
    "type=delegate",
    "target=존",
    "CHANNEL_ACTION_END",
    "CHANNEL_ACTION_BEGIN",
    "type=report",
    "target=영희",
    "artifact_path=/absolute/or/repo-relative/path.ts",
    "CHANNEL_ACTION_END",
    "CHANNEL_ACTION_BEGIN",
    "type=final",
    "CHANNEL_ACTION_END",
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
      ? "5) In channel collaboration, every reply must end with exactly one CHANNEL_ACTION block delimited by CHANNEL_ACTION_BEGIN and CHANNEL_ACTION_END."
      : "",
    context === "channel"
      ? "6) Use type=delegate only when you are intentionally handing work to another member."
      : "",
    context === "channel"
      ? "7) If you are a worker finishing assigned work, publish the result publicly and use type=report to hand control back to the requester or coordinator."
      : "",
    context === "channel"
      ? "8) If user clarification is required, coordinator should use type=ask_user. Workers should not ask the user directly."
      : "",
    context === "channel"
      ? "9) If the assigned task is implementation or file delivery, do the actual file work before replying; do not answer with only intent such as '구현하겠습니다'."
      : "",
    context === "channel"
      ? "10) Only the coordinator should use type=final after required worker results are already present in CHANNEL_RECENT_MESSAGES."
      : "",
    context === "channel"
      ? "11) When you set target=..., use an exact member display name that appears in CHANNEL_MEMBERS."
      : "",
    context === "channel"
      ? "12) For code/file tasks, include the produced file path in the public reply and set artifact_path=... in the report action."
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
