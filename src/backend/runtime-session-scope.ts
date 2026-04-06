export const DM_RUNTIME_SESSION_SCOPE = "dm";

export function getChannelRuntimeSessionScope(channelId: string): string {
  return `channel:${channelId}`;
}
