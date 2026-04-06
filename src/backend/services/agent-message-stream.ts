function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeItemType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getItemTypeFromRaw(raw: unknown): string {
  const rawRecord = asRecord(raw);
  if (!rawRecord) {
    return "";
  }

  const paramsRecord = asRecord(rawRecord.params);
  const nestedItem = asRecord(paramsRecord?.item ?? rawRecord.item);
  return normalizeItemType(nestedItem?.type);
}

export function isCompletedAgentMessageStreamEvent(raw: unknown): boolean {
  const rawRecord = asRecord(raw);
  if (!rawRecord) {
    return false;
  }

  const method = typeof rawRecord.method === "string" ? rawRecord.method.trim().toLowerCase() : "";
  if (method === "item/completed") {
    const itemType = getItemTypeFromRaw(raw);
    return itemType === "agentmessage" || itemType === "agent_message";
  }

  const type = typeof rawRecord.type === "string" ? rawRecord.type.trim().toLowerCase() : "";
  if (type === "item.completed") {
    const itemType = getItemTypeFromRaw(raw);
    return itemType === "agentmessage" || itemType === "agent_message";
  }

  return false;
}

export function isDeltaAgentMessageStreamEvent(raw: unknown): boolean {
  const rawRecord = asRecord(raw);
  if (!rawRecord) {
    return false;
  }

  const method = typeof rawRecord.method === "string" ? rawRecord.method.trim().toLowerCase() : "";
  return method === "item/agentmessage/delta";
}
