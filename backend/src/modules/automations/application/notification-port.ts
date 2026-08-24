export interface NotificationPort {
  enqueue(input: {
    tenantId: string;
    routeId?: string;
    channelId?: string;
    templateKey: string;
    eventKey: string;
    idempotencyKey: string;
    context: Record<string, unknown>;
  }): Promise<{ requestId: string }>;
}

export class FakeNotificationPort implements NotificationPort {
  readonly requests: Array<Parameters<NotificationPort['enqueue']>[0]> = [];
  private readonly responses = new Map<string, { requestId: string }>();

  failWith?: Error;

  async enqueue(input: Parameters<NotificationPort['enqueue']>[0]): Promise<{ requestId: string }> {
    if (this.failWith) throw this.failWith;
    const existing = this.responses.get(input.idempotencyKey);
    if (existing) return existing;
    this.requests.push(structuredClone(input));
    const response = { requestId: `notification_${this.requests.length}` };
    this.responses.set(input.idempotencyKey, response);
    return response;
  }
}
