export type CaNodeTaskNotificationListener = () => void;

export class CaNodeTaskChannel {
  private readonly listeners = new Map<string, Set<CaNodeTaskNotificationListener>>();

  subscribe(tenantId: string, providerId: string, listener: CaNodeTaskNotificationListener): () => void {
    const key = channelKey(tenantId, providerId);
    const providerListeners = this.listeners.get(key) ?? new Set<CaNodeTaskNotificationListener>();
    providerListeners.add(listener);
    this.listeners.set(key, providerListeners);
    return () => {
      providerListeners.delete(listener);
      if (providerListeners.size === 0) this.listeners.delete(key);
    };
  }

  notify(tenantId: string, providerId: string): void {
    for (const listener of this.listeners.get(channelKey(tenantId, providerId)) ?? []) listener();
  }
}

function channelKey(tenantId: string, providerId: string): string {
  return `${tenantId}:${providerId}`;
}
