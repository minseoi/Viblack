#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

function parseArgValue(args, longName, shortName) {
  const longIndex = args.indexOf(longName);
  if (longIndex >= 0 && longIndex + 1 < args.length) {
    return args[longIndex + 1];
  }
  if (shortName) {
    const shortIndex = args.indexOf(shortName);
    if (shortIndex >= 0 && shortIndex + 1 < args.length) {
      return args[shortIndex + 1];
    }
  }
  return null;
}

function parseRequestedModel(args) {
  return parseArgValue(args, "--model", "-m");
}

function parseExecContext(args) {
  const resumeIndex = args.indexOf("resume");
  const jsonIndex = args.indexOf("--json");

  if (jsonIndex < 0) {
    return { sessionId: null, promptText: "" };
  }

  if (resumeIndex >= 0) {
    const sessionId = jsonIndex + 1 < args.length ? args[jsonIndex + 1] : null;
    const promptText = jsonIndex + 2 < args.length ? args.slice(jsonIndex + 2).join(" ") : "";
    return { sessionId, promptText };
  }

  const promptText = jsonIndex + 1 < args.length ? args.slice(jsonIndex + 1).join(" ") : "";
  return { sessionId: null, promptText };
}

function extractEmbeddedMemberPrompt(promptText) {
  const match = promptText.match(
    /\[USER_DEFINED_MEMBER_PROMPT_BEGIN\]\r?\n([\s\S]*?)\r?\n\[USER_DEFINED_MEMBER_PROMPT_END\]/,
  );
  return match ? match[1].trim() : "";
}

function extractPromptSection(promptText, sectionName) {
  const pattern = new RegExp(`\\[${sectionName}_BEGIN\\]\\r?\\n([\\s\\S]*?)\\r?\\n\\[${sectionName}_END\\]`);
  const match = promptText.match(pattern);
  return match ? match[1].trim() : "";
}

function getControlPromptText(promptText) {
  return extractPromptSection(promptText, "ACTIVE_TRIGGER_MESSAGE") || promptText;
}

function extractAgentName(promptText) {
  const match = promptText.match(/^- Name:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractChannelMemberNames(promptText) {
  const membersSection = extractPromptSection(promptText, "CHANNEL_MEMBERS");
  if (!membersSection) {
    return [];
  }
  return membersSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^\d+\.\s+(.+?)(?:\s+\|.*)?$/))
    .map((match) => (match ? match[1].trim() : ""))
    .filter((name) => name.length > 0);
}

function extractActiveTaskRequester(promptText) {
  const requester = extractPromptSection(promptText, "ACTIVE_TASK_REQUESTER");
  if (!requester || requester === "(none)") {
    return "";
  }
  return requester;
}

function extractMentionedMemberNames(text, memberNames) {
  return memberNames.filter(
    (memberName) =>
      text.includes(`@{${memberName}}`) ||
      text.includes(`@${memberName}`),
  );
}

function hasExactMentionDelegationRules(promptText) {
  return (
    promptText.includes("your reply must include an exact channel mention to that member") &&
    promptText.includes("otherwise no execution occurs") &&
    promptText.includes("mention the delegating member back using their exact name")
  );
}

function hasChannelActionDelegationRules(promptText) {
  return (
    promptText.includes("CHANNEL_ACTION") &&
    promptText.includes("type=delegate") &&
    promptText.includes("type=report")
  );
}

function getSessionStatePath(sessionId) {
  return path.join(os.tmpdir(), `viblack-fake-codex-state-${sanitizeMarkerPart(sessionId)}.json`);
}

function readSessionState(sessionId) {
  if (!sessionId) {
    return {};
  }
  try {
    const raw = fs.readFileSync(getSessionStatePath(sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function updateSessionState(sessionId, patch) {
  if (!sessionId) {
    return {};
  }
  const nextState = {
    ...readSessionState(sessionId),
    ...patch,
  };
  fs.writeFileSync(getSessionStatePath(sessionId), JSON.stringify(nextState), "utf8");
  return nextState;
}

function findDelegationTarget(triggerText, currentAgentName, memberNames) {
  const delegationKeywords = ["시키", "조사", "부탁", "요청", "넘겨", "맡겨", "물어", "해봐"];
  const normalizedTrigger = triggerText.replace(/\s+/g, " ");
  if (!delegationKeywords.some((keyword) => normalizedTrigger.includes(keyword))) {
    return "";
  }

  for (const memberName of memberNames) {
    if (!memberName || memberName === currentAgentName) {
      continue;
    }
    if (
      normalizedTrigger.includes(`${memberName}한테`) ||
      normalizedTrigger.includes(`${memberName}에게`) ||
      normalizedTrigger.includes(`@{${memberName}}`) ||
      normalizedTrigger.includes(`@${memberName}`)
    ) {
      return memberName;
    }
  }

  return "";
}

function isAmbiguousDelegationPrompt(text) {
  return ["그거", "저거", "2번", "모호", "불명확", "방금 말한"].some((token) => text.includes(token));
}

function appendDelegationAction(contentParts, actionLines, actionProtocolEnabled) {
  if (!actionProtocolEnabled) {
    return contentParts.join("\n\n");
  }
  return [...contentParts, buildChannelActionBlock(actionLines)].join("\n\n");
}

function maybeBuildDelegationReply(promptText, controlPromptText, sessionState = {}) {
  const delegationRulesEnabled =
    hasExactMentionDelegationRules(promptText) ||
    hasChannelActionDelegationRules(promptText) ||
    Boolean(sessionState.hasExactMentionDelegationRules) ||
    Boolean(sessionState.hasChannelActionDelegationRules);
  if (!delegationRulesEnabled) {
    return "";
  }

  const actionProtocolEnabled =
    hasChannelActionDelegationRules(promptText) || Boolean(sessionState.hasChannelActionDelegationRules);
  const currentAgentName = extractAgentName(promptText) || sessionState.agentName || "";
  const memberNames = extractChannelMemberNames(promptText);
  const activeTaskRequester = extractActiveTaskRequester(promptText);
  if (!currentAgentName || memberNames.length === 0) {
    return "";
  }

  const mentionedMembers = extractMentionedMemberNames(controlPromptText, memberNames);
  if (
    activeTaskRequester &&
    isAmbiguousDelegationPrompt(controlPromptText) &&
    !controlPromptText.includes("확인 질문:")
  ) {
    return appendDelegationAction(
      [`@{${activeTaskRequester}} 확인 질문: 방금 말한 "그거"가 정확히 어떤 범위인지 먼저 알려줘.`],
      ["type=report", `target=${activeTaskRequester}`],
      actionProtocolEnabled,
    );
  }

  if (
    mentionedMembers.includes(currentAgentName) &&
    controlPromptText.includes("보고해줘")
  ) {
    const returnTarget = mentionedMembers.find((memberName) => memberName !== currentAgentName);
    if (returnTarget) {
      return appendDelegationAction(
        [`조사 결과 보고: 핵심 사실 3개를 정리했습니다. @{${returnTarget}} 이어서 사용자용으로 요약해줘.`],
        ["type=report", `target=${returnTarget}`],
        actionProtocolEnabled,
      );
    }
  }

  if (
    mentionedMembers.includes(currentAgentName) &&
    controlPromptText.includes("조사 결과 보고:")
  ) {
    return appendDelegationAction(
      ["최종 정리: 하위 리서치 결과를 바탕으로 사용자용 초안을 정리했습니다."],
      ["type=final"],
      actionProtocolEnabled,
    );
  }

  if (
    mentionedMembers.includes(currentAgentName) &&
    controlPromptText.includes("확인 질문:")
  ) {
    return appendDelegationAction(
      ['확인 질문: 방금 말한 "그거"의 정확한 범위를 먼저 알려주면 다음 단계를 진행하겠습니다.'],
      ['type=ask_user', 'question=방금 말한 "그거"의 정확한 범위를 먼저 알려줘.'],
      actionProtocolEnabled,
    );
  }

  const delegationTarget = findDelegationTarget(controlPromptText, currentAgentName, memberNames);
  if (delegationTarget) {
    if (isAmbiguousDelegationPrompt(controlPromptText)) {
      return appendDelegationAction(
        [
          `@{${delegationTarget}} 방금 말한 그거를 조사해줘. 범위가 불명확하면 @{${currentAgentName}} 에게 먼저 확인 질문해줘.`,
        ],
        ["type=delegate", `target=${delegationTarget}`, "mode=blocking"],
        actionProtocolEnabled,
      );
    }
    return appendDelegationAction(
      [
        `@{${delegationTarget}} 조사 부탁합니다. 공개 자료 기준 핵심 사실만 정리하고 결과는 @{${currentAgentName}} 에게 채널에서 보고해줘.`,
      ],
      ["type=delegate", `target=${delegationTarget}`, "mode=blocking"],
      actionProtocolEnabled,
    );
  }

  return "";
}

function buildChannelActionBlock(lines) {
  return ["[CHANNEL_ACTION]", ...lines, "[/CHANNEL_ACTION]"].join("\n");
}

function maybeBuildDelegationScenarioReply(promptText, sessionId, sessionState = {}) {
  if (!promptText.includes("인스타 맛집 계정 운영")) {
    return "";
  }

  const currentAgentName = (extractAgentName(promptText) || sessionState.agentName || "").trim();
  if (!currentAgentName) {
    return "";
  }

  if (currentAgentName === "영희") {
    const stage = sessionState.delegationScenarioStage || "";
    if (!stage) {
      updateSessionState(sessionId, { delegationScenarioStage: "delegated_research" });
      return [
        "결론: 먼저 존 조사부터 진행합니다. 조사 결과가 공개 채널에 올라오면 그 다음에 매튜에게 문서화를 넘기겠습니다.",
        "@존 인스타 맛집 계정 운영 초보자 가이드에 필요한 조사 결과를 체크리스트 중심으로 정리해줘.",
        buildChannelActionBlock(["type=delegate", "target=존", "mode=blocking"]),
      ].join("\n\n");
    }

    if (stage === "delegated_research") {
      updateSessionState(sessionId, { delegationScenarioStage: "delegated_writer" });
      return [
        "결론: 존 조사 결과가 확보됐으니 이제 매튜가 사용자용 가이드 문서로 정리하면 됩니다.",
        "@매튜 존 조사 결과를 바탕으로 사용자에게 바로 줄 수 있는 가이드 문서 초안을 작성해줘.",
        buildChannelActionBlock(["type=delegate", "target=매튜", "mode=blocking"]),
      ].join("\n\n");
    }

    updateSessionState(sessionId, { delegationScenarioStage: "completed" });
    return [
      "최종 정리: 조사와 문서화가 모두 끝났습니다. 아래 가이드를 사용자에게 바로 전달하면 됩니다.",
      "핵심 구성은 계정 목표 설정, 콘텐츠 운영 원칙, 초반 30일 루틴, 체크리스트입니다.",
      buildChannelActionBlock(["type=final"]),
    ].join("\n\n");
  }

  if (currentAgentName === "존") {
    return [
      "조사 결과 보고: 초보자용 가이드에 필요한 핵심 내용을 정리했습니다. 계정 목적, 콘텐츠 포맷, 업로드 루틴, 광고 표기 주의사항, 초기 체크리스트까지 포함했습니다.",
      "@영희 조사 결과를 바탕으로 다음 문서화 단계를 진행하면 됩니다.",
      buildChannelActionBlock(["type=report", "target=영희"]),
    ].join("\n\n");
  }

  if (currentAgentName === "매튜") {
    return [
      "문서 초안 보고: 존 조사 결과를 구조화해 사용자 전달용 가이드 문서 초안을 완성했습니다.",
      "@영희 최종 검토 후 사용자에게 전달해줘.",
      buildChannelActionBlock(["type=report", "target=영희"]),
    ].join("\n\n");
  }

  return "";
}

function maybeBuildCodeArtifactScenarioReply(promptText, sessionId, sessionState = {}) {
  const isIntentOnlyScenario = promptText.includes("FORCE_CODE_ARTIFACT_INTENT_ONLY");
  const successMatch = promptText.match(/FORCE_CODE_ARTIFACT_SUCCESS:\s*([^\s\r\n]+)/);
  if (!isIntentOnlyScenario && !successMatch) {
    return "";
  }

  const currentAgentName = (extractAgentName(promptText) || sessionState.agentName || "").trim();
  const memberNames = extractChannelMemberNames(promptText);
  const coordinatorName = memberNames.find((name) => name.startsWith("영희")) || "영희";
  const workerName = memberNames.find((name) => name.startsWith("철수")) || "철수";
  if (!currentAgentName) {
    return "";
  }

  if (currentAgentName === coordinatorName) {
    if (promptText.includes("구현 완료 보고:")) {
      const artifactPathMatches = [...promptText.matchAll(/artifact_path=([^\s\r\n]+)/g)];
      const artifactPathMatch = artifactPathMatches[artifactPathMatches.length - 1] ?? null;
      return [
        `최종 보고: 철수가 구현 파일을 전달했습니다.${artifactPathMatch ? ` ${artifactPathMatch[1]}` : ""}`,
        buildChannelActionBlock(["type=final"]),
      ].join("\n\n");
    }

    return [
      "철수에게 구현 작업을 넘깁니다. 실제 구현 파일 경로까지 보고받아야 합니다.",
      `@${workerName} 블럭 회전 로직을 구현하고 완료되면 파일 경로를 포함해 보고해줘.`,
      buildChannelActionBlock(["type=delegate", `target=${workerName}`, "mode=blocking"]),
    ].join("\n\n");
  }

  if (currentAgentName !== workerName) {
    return "";
  }

  if (isIntentOnlyScenario) {
    return [
      "아래 로직으로 구현하겠습니다.",
      "- 회전 방향(CW/CCW) 처리",
      "- 보드 경계/충돌 검사",
      "- 최소 wall kick 적용",
    ].join("\n");
  }

  const artifactPath = path.join(
    os.tmpdir(),
    `viblack-fake-code-artifact-${sanitizeMarkerPart(successMatch[1])}.ts`,
  );
  fs.writeFileSync(
    artifactPath,
    "export function rotateBlock() { return 'ok'; }\n",
    "utf8",
  );
  return [
    "구현 완료 보고: 블럭 회전 로직 구현을 마쳤습니다.",
    `산출물: ${artifactPath}`,
    buildChannelActionBlock(["type=report", `target=${coordinatorName}`, `artifact_path=${artifactPath}`]),
  ].join("\n\n");
}

function parseForcedStreamMessage(promptText) {
  const match = promptText.match(/FORCE_STREAM_AGENT_MESSAGE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function parseForcedStreamSequence(promptText) {
  const match = promptText.match(/FORCE_STREAM_AGENT_MESSAGE_SEQ:\s*([^\s\r\n]+)/);
  if (!match) {
    return [];
  }
  return match[1]
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseForcedFinalReply(promptText) {
  const match = promptText.match(/FORCE_FINAL_REPLY:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function shouldForceTurnFailed(promptText) {
  return promptText.includes("FORCE_TURN_FAILED");
}

function parseForcedItemCompletedMessage(promptText) {
  const match = promptText.match(/FORCE_ITEM_COMPLETED_AGENT_MESSAGE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function parseForcedItemCompletedMessageSequence(promptText) {
  const match = promptText.match(/FORCE_ITEM_COMPLETED_AGENT_MESSAGE_SEQ:\s*([^\s\r\n]+)/);
  if (!match) {
    return [];
  }
  return match[1]
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseTransientFailOnceKey(promptText) {
  const match = promptText.match(/FORCE_TRANSIENT_FAIL_ONCE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function parseEmptySuccessOnceKey(promptText) {
  const match = promptText.match(/FORCE_EMPTY_SUCCESS_ONCE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function shouldTransientFailOnce(promptText) {
  const key = parseTransientFailOnceKey(promptText);
  if (!key) {
    return false;
  }
  const markerPath = path.join(os.tmpdir(), `viblack-fake-codex-transient-${key}`);
  if (fs.existsSync(markerPath)) {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Ignore cleanup failures and continue as success on this invocation.
    }
    return false;
  }
  try {
    fs.writeFileSync(markerPath, "1", "utf8");
  } catch {
    // If marker cannot be written, keep test deterministic by failing this invocation.
  }
  return true;
}

function shouldReturnEmptySuccessOnce(promptText) {
  const key = parseEmptySuccessOnceKey(promptText);
  if (!key) {
    return false;
  }
  const markerPath = path.join(os.tmpdir(), `viblack-fake-codex-empty-success-${key}`);
  if (fs.existsSync(markerPath)) {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Ignore cleanup failures and continue as normal on retry.
    }
    return false;
  }
  try {
    fs.writeFileSync(markerPath, "1", "utf8");
  } catch {
    // If marker cannot be written, keep behavior deterministic by returning empty once.
  }
  return true;
}

function sanitizeMarkerPart(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 120);
}

function getSessionMemoryMarkerPath(sessionId, token) {
  return path.join(
    os.tmpdir(),
    `viblack-fake-codex-session-${sanitizeMarkerPart(sessionId)}-${sanitizeMarkerPart(token)}`,
  );
}

function writeSessionMemory(sessionId, token) {
  if (!sessionId || !token) {
    return;
  }
  fs.writeFileSync(getSessionMemoryMarkerPath(sessionId, token), "1", "utf8");
}

function hasSessionMemory(sessionId, token) {
  if (!sessionId || !token) {
    return false;
  }
  return fs.existsSync(getSessionMemoryMarkerPath(sessionId, token));
}

function buildReply(
  promptText,
  runtimeMode = "exec",
  requestedModel = null,
  controlPromptText = promptText,
  sessionId = "",
) {
  const persistedAgentName = extractAgentName(promptText);
  const hasDelegationRules = hasExactMentionDelegationRules(promptText);
  const hasChannelActionRules = hasChannelActionDelegationRules(promptText);
  const sessionState =
    persistedAgentName || hasDelegationRules || hasChannelActionRules
      ? updateSessionState(sessionId, {
          ...(persistedAgentName ? { agentName: persistedAgentName } : {}),
          ...(hasDelegationRules ? { hasExactMentionDelegationRules: true } : {}),
          ...(hasChannelActionRules ? { hasChannelActionDelegationRules: true } : {}),
        })
      : readSessionState(sessionId);
  if (promptText.includes("SYSTEM PROMPT를 작성하세요")) {
    return "당신은 테스트용 에이전트입니다. 한국어로 간결하고 정확하게 응답하세요.";
  }
  const sessionMemoryWriteMatch = controlPromptText.match(/FORCE_SESSION_MEMORY_WRITE:\s*([^\s\r\n]+)/);
  if (sessionMemoryWriteMatch) {
    const token = sessionMemoryWriteMatch[1].trim();
    writeSessionMemory(sessionId, token);
    return `세션 메모리 기록:${token}`;
  }
  const sessionMemoryReadMatch = controlPromptText.match(/FORCE_SESSION_MEMORY_READ:\s*([^\s\r\n]+)/);
  if (sessionMemoryReadMatch) {
    const token = sessionMemoryReadMatch[1].trim();
    return hasSessionMemory(sessionId, token) ? `세션 메모리 존재:${token}` : `세션 메모리 없음:${token}`;
  }
  const deterministicDelegationScenarioReply = maybeBuildDelegationScenarioReply(
    promptText,
    sessionId,
    sessionState,
  );
  if (deterministicDelegationScenarioReply) {
    return deterministicDelegationScenarioReply;
  }
  const codeArtifactScenarioReply = maybeBuildCodeArtifactScenarioReply(promptText, sessionId, sessionState);
  if (codeArtifactScenarioReply) {
    return codeArtifactScenarioReply;
  }
  const delegatedReply = maybeBuildDelegationReply(promptText, controlPromptText, sessionState);
  if (delegatedReply) {
    return delegatedReply;
  }
  const assertChannelMembersMatch = controlPromptText.match(
    /FORCE_ASSERT_CHANNEL_MEMBERS:\s*([^\s\r\n]+)/,
  );
  const assertChannelHistoryMatch = controlPromptText.match(
    /FORCE_ASSERT_CHANNEL_HISTORY:\s*([^\s\r\n]+)/,
  );
  if (assertChannelMembersMatch || assertChannelHistoryMatch) {
    const membersSection = extractPromptSection(promptText, "CHANNEL_MEMBERS");
    const historySection = extractPromptSection(promptText, "CHANNEL_RECENT_MESSAGES");

    if (!membersSection) {
      return "채널 멤버 섹션 누락";
    }
    if (!historySection) {
      return "채널 히스토리 섹션 누락";
    }

    if (assertChannelMembersMatch) {
      const expectedMembers = assertChannelMembersMatch[1]
        .split("|")
        .map((member) => member.trim())
        .filter((member) => member.length > 0);
      const missingMember = expectedMembers.find((member) => !membersSection.includes(member));
      if (missingMember) {
        return `채널 멤버 누락:${missingMember}`;
      }
    }

    if (assertChannelHistoryMatch) {
      const expectedHistoryToken = assertChannelHistoryMatch[1].trim();
      if (!historySection.includes(expectedHistoryToken)) {
        return `채널 히스토리 누락:${expectedHistoryToken}`;
      }
    }

    return "채널 컨텍스트 확인:ok";
  }
  const assertModelMatch = controlPromptText.match(/FORCE_ASSERT_MODEL:\s*([^\s\r\n]+)/);
  if (assertModelMatch) {
    const expectedModel = assertModelMatch[1].trim();
    const normalizedExpected = expectedModel.toLowerCase();
    const normalizedActual = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
    if (
      (normalizedExpected === "none" && !normalizedActual) ||
      normalizedExpected === normalizedActual
    ) {
      return `모델 확인:${expectedModel}`;
    }
    return `모델 불일치:${requestedModel || "none"}`;
  }
  if (promptText.includes("FORCE_REQUIRE_APP_SERVER")) {
    return runtimeMode === "app-server" ? "APP_SERVER_RUNTIME_OK" : "EXEC_RUNTIME_ONLY";
  }
  const assertMemberPromptMatch = controlPromptText.match(/FORCE_ASSERT_MEMBER_PROMPT:\s*([^\s\r\n]+)/);
  if (controlPromptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE") && assertMemberPromptMatch) {
    const requiredSections = [
      "[IDENTITY]",
      "[CONTEXT]",
      "[EXECUTION_RULES]",
      "[VALIDATION_RULES]",
      "[SAFETY_GATES]",
      "[OUTPUT_FORMAT]",
      "[USER_DEFINED_MEMBER_PROMPT_BEGIN]",
      "[USER_DEFINED_MEMBER_PROMPT_END]",
    ];
    const missingSection = requiredSections.find((section) => !promptText.includes(section));
    if (missingSection) {
      return `멤버 템플릿 누락:${missingSection}`;
    }
    const expectedToken = assertMemberPromptMatch[1];
    const embeddedPrompt = extractEmbeddedMemberPrompt(promptText);
    if (!embeddedPrompt.includes(expectedToken)) {
      return `멤버 프롬프트 누락:${expectedToken}`;
    }
    return `멤버 템플릿/프롬프트 확인:${expectedToken}`;
  }
  if (controlPromptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE")) {
    const requiredSections = [
      "[IDENTITY]",
      "[CONTEXT]",
      "[EXECUTION_RULES]",
      "[VALIDATION_RULES]",
      "[SAFETY_GATES]",
      "[OUTPUT_FORMAT]",
      "[USER_DEFINED_MEMBER_PROMPT_BEGIN]",
      "[USER_DEFINED_MEMBER_PROMPT_END]",
    ];
    const missingSection = requiredSections.find((section) => !promptText.includes(section));
    if (missingSection) {
      return `멤버 템플릿 누락:${missingSection}`;
    }
    return "멤버 템플릿 확인:ok";
  }
  if (assertMemberPromptMatch) {
    const expectedToken = assertMemberPromptMatch[1];
    const embeddedPrompt = extractEmbeddedMemberPrompt(promptText);
    if (embeddedPrompt.includes(expectedToken)) {
      return `멤버 프롬프트 확인:${expectedToken}`;
    }
    return `멤버 프롬프트 누락:${expectedToken}`;
  }
  const bounceSeedMatch = controlPromptText.match(
    /FORCE_BOUNCE_MENTIONS:\s*([^\s,\r\n]+)\s*,\s*([^\s,\r\n]+)/,
  );
  if (bounceSeedMatch) {
    const returnTarget = bounceSeedMatch[1];
    const nextTarget = bounceSeedMatch[2];
    return `테스트 바운스 1단계: @{${nextTarget}} FORCE_BOUNCE_RETURN:${returnTarget}`;
  }
  const bounceReturnMatch = controlPromptText.match(/FORCE_BOUNCE_RETURN:\s*([^\s\r\n]+)/);
  if (bounceReturnMatch) {
    return `테스트 바운스 2단계: @{${bounceReturnMatch[1]}} FORCE_BOUNCE_DONE`;
  }
  const bounceChainMatch = controlPromptText.match(
    /FORCE_CHAIN_BOUNCE:\s*([^\s,\r\n]+)\s*,\s*(\d{1,3})/,
  );
  if (bounceChainMatch) {
    const nextTarget = bounceChainMatch[1];
    const remaining = Number(bounceChainMatch[2]);
    const currentAgentName =
      extractAgentName(promptText) ||
      sessionState.agentName ||
      extractMentionedMemberNames(controlPromptText, extractChannelMemberNames(promptText))[0] ||
      "";
    if (!currentAgentName || remaining <= 0) {
      return "체인 종료: 더 이상 후속 멘션이 없습니다.";
    }
    return `체인 계속: @{${nextTarget}} FORCE_CHAIN_BOUNCE:${currentAgentName},${remaining - 1}`;
  }
  const forcedMentionMatch = controlPromptText.match(/FORCE_MENTION_NAME:\s*([^\s\r\n]+)/);
  if (forcedMentionMatch) {
    return `테스트 재멘션: @{${forcedMentionMatch[1]}} FORCE_DELAY_MS:1800 확인 부탁합니다.`;
  }
  const forcedFinalReply = parseForcedFinalReply(controlPromptText);
  if (forcedFinalReply) {
    return forcedFinalReply;
  }
  return "테스트 응답: 요청을 정상 처리했습니다.";
}

function parseForcedDelayMs(promptText) {
  const match = promptText.match(/FORCE_DELAY_MS:\s*(\d{1,5})/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 10000);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractTurnInputText(input) {
  if (!Array.isArray(input)) {
    return "";
  }
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const value = item;
      if (value.type === "text" && typeof value.text === "string") {
        return value.text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function createThreadPayload(threadId, cwd) {
  const now = Math.floor(Date.now() / 1000);
  return {
    approvalPolicy: "never",
    cwd,
    model: "fake-model",
    modelProvider: "fake",
    sandbox: {
      mode: "workspace-write",
      writableRoots: [cwd],
    },
    thread: {
      id: threadId,
      cliVersion: "fake-codex-1.0.0",
      createdAt: now,
      cwd,
      modelProvider: "fake",
      preview: "fake thread",
      source: "codex_app_server",
      turns: [],
      updatedAt: now,
    },
  };
}

async function runAppServer() {
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  let buffer = "";

  const writeJson = (payload) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const respond = (id, result) => {
    writeJson({ jsonrpc: "2.0", id, result });
  };

  const respondError = (id, code, message) => {
    writeJson({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
  };

  const notify = (method, params) => {
    writeJson({
      jsonrpc: "2.0",
      method,
      params,
    });
  };

  const flush = async (flushAll) => {
    const lines = buffer.split(/\r?\n/);
    buffer = flushAll ? "" : (lines.pop() ?? "");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (!message || typeof message !== "object") {
        continue;
      }

      const id = message.id;
      const method = typeof message.method === "string" ? message.method : "";
      const params = message.params && typeof message.params === "object" ? message.params : {};

      if (!method) {
        continue;
      }

      if (method === "initialize") {
        respond(id, { userAgent: "fake-codex-app-server/1.0.0" });
        continue;
      }

      if (method === "thread/start") {
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
        const threadId = `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        respond(id, createThreadPayload(threadId, cwd));
        continue;
      }

      if (method === "thread/resume") {
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
        const threadId =
          typeof params.threadId === "string" && params.threadId
            ? params.threadId
            : `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        respond(id, createThreadPayload(threadId, cwd));
        continue;
      }

      if (method === "turn/interrupt") {
        const turnId = typeof params.turnId === "string" ? params.turnId : `fake-turn-${Date.now()}`;
        respond(id, { turn: { id: turnId, status: "failed", items: [] } });
        continue;
      }

      if (method === "turn/start") {
        const threadId =
          typeof params.threadId === "string" && params.threadId
            ? params.threadId
            : `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const turnId = `fake-turn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const promptText = extractTurnInputText(params.input);
        const controlPromptText = getControlPromptText(promptText);
        const forceTurnFailed = shouldForceTurnFailed(controlPromptText);
        const forceEmptySuccessOnce = shouldReturnEmptySuccessOnce(controlPromptText);
        const forceItemCompletedMessage = parseForcedItemCompletedMessage(controlPromptText);
        const forceItemCompletedMessageSequence = parseForcedItemCompletedMessageSequence(controlPromptText);
        const streamMessage = parseForcedStreamMessage(controlPromptText);
        const streamSequence = parseForcedStreamSequence(controlPromptText);
        const forcedDelayMs = parseForcedDelayMs(controlPromptText);

        respond(id, { turn: { id: turnId, status: "started", items: [] } });
        notify("turn/started", { threadId, turn: { id: turnId, status: "started", items: [] } });

        if (forceTurnFailed) {
          notify("turn/completed", {
            threadId,
            turn: {
              id: turnId,
              status: "failed",
              items: [],
              error: { message: "forced turn failure" },
            },
          });
          continue;
        }

        if (streamMessage) {
          notify("item/agentMessage/delta", {
            threadId,
            turnId,
            itemId: `item-delta-${turnId}`,
            delta: streamMessage,
          });
        }
        for (const streamChunk of streamSequence) {
          notify("item/agentMessage/delta", {
            threadId,
            turnId,
            itemId: `item-delta-${turnId}`,
            delta: streamChunk,
          });
        }

        if (forcedDelayMs > 0) {
          await sleep(forcedDelayMs);
        }

        const reply =
          forceItemCompletedMessage ||
          buildReply(promptText, "app-server", null, controlPromptText, threadId);

        if (forceItemCompletedMessageSequence.length > 0) {
          forceItemCompletedMessageSequence.forEach((messageText, index) => {
            notify("item/completed", {
              threadId,
              turnId,
              item: {
                id: `item-message-${turnId}-${index + 1}`,
                type: "agentMessage",
                text: messageText,
              },
            });
          });
        } else {
          notify("item/completed", {
            threadId,
            turnId,
            item: {
              id: `item-message-${turnId}`,
              type: "agentMessage",
              text: forceEmptySuccessOnce ? "" : reply,
            },
          });
        }

        notify("turn/completed", {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [],
          },
        });
        continue;
      }

      respondError(id, -32601, `Method not found: ${method}`);
    }
  };

  process.stdin.on("data", async (chunk) => {
    buffer += String(chunk);
    await flush(false);
  });

  process.stdin.on("end", async () => {
    await flush(true);
    process.exit(0);
  });
}

async function runExec(args) {
  const outputPath =
    parseArgValue(args, "--output-last-message", null) ?? parseArgValue(args, "-o", null);

  const requestedModel = parseRequestedModel(args);
  const { sessionId, promptText: promptFromArgs } = parseExecContext(args);
  const promptText = promptFromArgs || (await readStdin());
  const controlPromptText = getControlPromptText(promptText);
  const forceTurnFailed = shouldForceTurnFailed(controlPromptText);
  const forceTransientFailOnce = shouldTransientFailOnce(controlPromptText);
  const forceEmptySuccessOnce = shouldReturnEmptySuccessOnce(controlPromptText);
  const forceItemCompletedMessage = parseForcedItemCompletedMessage(controlPromptText);
  const forceItemCompletedMessageSequence = parseForcedItemCompletedMessageSequence(controlPromptText);
  const streamMessage = parseForcedStreamMessage(controlPromptText);
  const streamSequence = parseForcedStreamSequence(controlPromptText);
  const forcedDelayMs = parseForcedDelayMs(controlPromptText);
  const effectiveSessionId = sessionId || `fake-session-${Date.now()}`;
  const reply = buildReply(promptText, "exec", requestedModel, controlPromptText, effectiveSessionId);

  if (outputPath) {
    fs.writeFileSync(outputPath, reply, "utf8");
  }

  if (!sessionId) {
    process.stdout.write(
      `${JSON.stringify({ type: "thread.started", thread_id: effectiveSessionId })}\n`,
    );
  }

  if (forceTurnFailed) {
    process.stdout.write(
      `${JSON.stringify({ type: "turn.failed", error: { message: "forced turn failure" } })}\n`,
    );
    process.exit(0);
  }

  if (forceTransientFailOnce) {
    const transientError =
      "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)";
    process.stdout.write(`${JSON.stringify({ type: "error", message: transientError })}\n`);
    process.stderr.write(`${transientError}\n`);
    process.exit(1);
  }

  if (forceItemCompletedMessage) {
    process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "agent_message",
          text: forceItemCompletedMessage,
        },
      })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "turn.completed", usage: { output_tokens: 1 } })}\n`,
    );
    process.exit(0);
  }

  if (forceItemCompletedMessageSequence.length > 0) {
    forceItemCompletedMessageSequence.forEach((messageText, index) => {
      process.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            id: `item_${index + 1}`,
            type: "agent_message",
            text: messageText,
          },
        })}\n`,
      );
    });
    process.stdout.write(
      `${JSON.stringify({
        type: "response.completed",
        output_text: forceEmptySuccessOnce
          ? ""
          : forceItemCompletedMessageSequence[forceItemCompletedMessageSequence.length - 1],
      })}\n`,
    );
    process.exit(0);
  }

  if (streamMessage) {
    process.stdout.write(`${JSON.stringify({ type: "agent_message", message: streamMessage })}\n`);
  }
  let aggregatedStream = "";
  for (const streamChunk of streamSequence) {
    aggregatedStream += streamChunk;
    process.stdout.write(
      `${JSON.stringify({ type: "agent_message", message: aggregatedStream })}\n`,
    );
  }

  if (forcedDelayMs > 0) {
    await sleep(forcedDelayMs);
  }

  process.stdout.write(
    `${JSON.stringify({ type: "response.completed", output_text: forceEmptySuccessOnce ? "" : reply })}\n`,
  );
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    process.stdout.write("fake-codex 1.0.0\n");
    process.exit(0);
  }

  if (args[0] === "app-server") {
    await runAppServer();
    return;
  }

  if (args[0] !== "exec") {
    process.stderr.write("unsupported command\n");
    process.exit(1);
  }

  await runExec(args);
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
