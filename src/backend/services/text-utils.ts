import type { ChannelMessageKind } from "../types";

const allowedChannelMessageKinds: ReadonlySet<ChannelMessageKind> = new Set([
  "request",
  "progress",
  "result",
  "remention",
  "general",
]);

export function sanitizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sanitizeChannelMessageKind(value: unknown): ChannelMessageKind {
  if (typeof value !== "string") {
    return "general";
  }
  return allowedChannelMessageKinds.has(value as ChannelMessageKind)
    ? (value as ChannelMessageKind)
    : "general";
}

export function unwrapCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1].trim() : trimmed;
}

