export class AgentLockManager {
  private readonly locks = new Map<string, Promise<unknown>>();

  async withAgentLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => task()) as Promise<T>;
    this.locks.set(agentId, next);
    next.finally(() => {
      if (this.locks.get(agentId) === next) {
        this.locks.delete(agentId);
      }
    });
    return next;
  }
}

