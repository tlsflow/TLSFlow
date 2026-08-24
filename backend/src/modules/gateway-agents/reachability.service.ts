import { newId } from '../../shared/id.js';
import type { GatewayAdapterType, ReachabilityRecord, ReachabilityStatus } from './gateway-agent.types.js';

export class ReachabilityService {
  private readonly records = new Map<string, ReachabilityRecord>();

  upsert(input: {
    gatewayId: string;
    targetId: string;
    protocol: GatewayAdapterType;
    port?: number;
    status: ReachabilityStatus;
    latencyMs?: number;
    ttlSeconds: number;
    now?: Date;
  }): ReachabilityRecord {
    const now = input.now ?? new Date();
    const existing = this.findRaw(input.gatewayId, input.targetId, input.protocol);
    const record: ReachabilityRecord = {
      id: existing?.id ?? newId('reach'),
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      port: input.port,
      status: input.status,
      latencyMs: input.latencyMs,
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
    };
    this.records.set(this.key(record.gatewayId, record.targetId, record.protocol), record);
    return record;
  }

  find(gatewayId: string, targetId: string, protocol: GatewayAdapterType, now = new Date()): ReachabilityRecord | undefined {
    const record = this.findRaw(gatewayId, targetId, protocol);
    if (!record) return undefined;
    if (this.isExpired(record, now)) return { ...record, status: 'expired' };
    return record;
  }

  findAny(gatewayId: string, targetId: string, protocols: GatewayAdapterType[], now = new Date()): ReachabilityRecord | undefined {
    return protocols.map((protocol) => this.find(gatewayId, targetId, protocol, now)).find((record) => record !== undefined);
  }

  list(): ReachabilityRecord[] {
    return [...this.records.values()];
  }

  isExpired(record: ReachabilityRecord, now = new Date()): boolean {
    return new Date(record.expiresAt).getTime() <= now.getTime();
  }

  private findRaw(gatewayId: string, targetId: string, protocol: GatewayAdapterType): ReachabilityRecord | undefined {
    return this.records.get(this.key(gatewayId, targetId, protocol));
  }

  private key(gatewayId: string, targetId: string, protocol: GatewayAdapterType): string {
    return `${gatewayId}:${targetId}:${protocol}`;
  }
}
