export type CaNodeTaskNotificationListener = () => void;

export class CaNodeTaskChannel {
  private readonly listeners = new Map<string, Set<CaNodeTaskNotificationListener>>();

  subscribe(providerId: string, listener: CaNodeTaskNotificationListener): () => void {
    const providerListeners = this.listeners.get(providerId) ?? new Set<CaNodeTaskNotificationListener>();
    providerListeners.add(listener);
    this.listeners.set(providerId, providerListeners);
    return () => {
      providerListeners.delete(listener);
      if (providerListeners.size === 0) this.listeners.delete(providerId);
    };
  }

  notify(providerId: string): void {
    for (const listener of this.listeners.get(providerId) ?? []) listener();
  }
}
