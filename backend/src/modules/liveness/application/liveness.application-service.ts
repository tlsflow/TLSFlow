import { createConnection } from 'node:net';
import type { DatabasePort } from '../../../database/database-port.js';
import type { GatewayTaskService } from '../../gateway-agents/gateway-task.service.js';
import { LivenessDomainService } from '../domain/liveness.domain-service.js';
import { LivenessRepository } from '../repository/liveness.repository.js';
import type { LivenessProjection, LivenessResourceType, LivenessSignalType } from '../schema/liveness.schema.js';

interface ProbeTargetRow extends Record<string, unknown> {
  tenant_id: string;
  resource_type: LivenessResourceType;
  resource_id: string;
  endpoint_host: string | null;
  endpoint_port: number | null;
  gateway_id: string | null;
}

interface ProbeTarget {
  tenantId: string;
  resourceType: LivenessResourceType;
  resourceId: string;
  host?: string;
  port?: number;
  gatewayId?: string;
}

interface PendingGatewayProbe {
  taskId: string;
  target: ProbeTarget;
  dispatchedAt: number;
}

export class LivenessApplicationService {
  private readonly repository: LivenessRepository;
  private readonly domain = new LivenessDomainService();
  private readonly pendingGatewayProbes = new Map<string, PendingGatewayProbe>();

  constructor(
    private readonly db: DatabasePort,
    private readonly gatewayTasks?: GatewayTaskService,
  ) {
    this.repository = new LivenessRepository(db);
  }

  async recordHeartbeat(tenantId: string, agentId: string, observedAt = new Date().toISOString()): Promise<void> {
    await this.repository.record({
      tenantId,
      resourceType: 'AGENT',
      resourceId: agentId,
      signalType: 'HEARTBEAT',
      source: 'AGENT',
      success: true,
      observedAt,
      observationId: `heartbeat:${agentId}:${observedAt}`,
    });
  }

  async recordHeartbeatTimeout(input: { tenantId: string; agentId: string; observedAt: string; reasonDetail?: string }): Promise<void> {
    await this.repository.record({
      tenantId: input.tenantId,
      resourceType: 'AGENT',
      resourceId: input.agentId,
      signalType: 'HEARTBEAT',
      source: 'CONTROL_PLANE',
      success: false,
      observedAt: input.observedAt,
      reasonCode: 'HEARTBEAT_MISSED',
      reasonDetail: input.reasonDetail,
      observationId: `heartbeat-timeout:${input.agentId}:${input.observedAt}`,
      requiredConsecutiveFailures: 2,
    });
  }

  async project(tenantId: string, resourceType: LivenessResourceType, resourceId: string, requiredSignals: LivenessSignalType[]): Promise<LivenessProjection> {
    return this.domain.project(await this.repository.list(tenantId, resourceType, resourceId), requiredSignals);
  }

  async evaluateManagementProbes(options: { timeoutMs?: number; concurrency?: number; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const timeoutMs = positiveInteger(options.timeoutMs, 3_000);
    const concurrency = positiveInteger(options.concurrency, 20);
    const targets = await this.listProbeTargets();
    await this.collectGatewayResults(now, timeoutMs);
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const workers = Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        if (!target) continue;
        if (!target.host || !target.port) {
          await this.recordProbe(target, false, now, 'MANAGEMENT_ENDPOINT_MISSING');
          failed += 1;
          continue;
        }
        if (target.gatewayId && this.gatewayTasks) {
          this.dispatchGatewayProbe(target, now);
          continue;
        }
        const result = await probeTcp(target.host, target.port, timeoutMs);
        await this.recordProbe(target, result.success, now, result.reasonCode, result.reasonDetail);
        if (result.success) succeeded += 1;
        else failed += 1;
      }
    });
    await Promise.all(workers);
    return { evaluated: targets.length, succeeded, failed, pendingGateway: this.pendingGatewayProbes.size, evaluatedAt: now.toISOString() };
  }

  private async listProbeTargets(): Promise<ProbeTarget[]> {
    const result = await this.db.query<ProbeTargetRow>(
      `with agent_targets as (
         select payload->>'tenantId' tenant_id,
                'AGENT'::text resource_type,
                document_id resource_id,
                coalesce(nullif(payload->'directControl'->>'listenAddress', ''), nullif(payload->'descriptor'->>'ipAddress', ''), nullif(payload->'descriptor'->>'hostname', '')) endpoint_host,
                null::integer endpoint_port,
                null::text gateway_id
           from pg_documents
          where namespace='agents:registrations'
            and payload->>'status' not in ('DISABLED', 'REVOKED')
       ), device_targets as (
         select host.tenant_id,
                'DEVICE'::text resource_type,
                host.id resource_id,
                service.address endpoint_host,
                device.management_port endpoint_port,
                device.gateway_id
           from pg_hosts host
           join pg_device_assets device on device.tenant_id=host.tenant_id and device.host_id=host.id
           join pg_service_assets service on service.tenant_id=device.tenant_id and service.id=device.service_asset_id and service.deleted_at is null
          where host.deleted_at is null and host.agent_id is null
       )
       select * from agent_targets
       union all
       select * from device_targets`,
    );
    return result.rows.map((row) => {
      if (row.resource_type === 'AGENT') {
        const endpoint = parseAgentEndpoint(row.endpoint_host);
        return {
          tenantId: row.tenant_id,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          host: endpoint.host,
          port: endpoint.port,
        };
      }
      return {
        tenantId: row.tenant_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        host: row.endpoint_host ?? undefined,
        port: row.endpoint_port === null ? undefined : Number(row.endpoint_port),
        gatewayId: row.gateway_id ?? undefined,
      };
    });
  }

  private dispatchGatewayProbe(target: ProbeTarget, now: Date): void {
    const key = targetKey(target);
    if (this.pendingGatewayProbes.has(key)) return;
    const task = this.gatewayTasks!.dispatch({
      idempotencyKey: `liveness:${key}:${Math.floor(now.getTime() / 10_000)}`,
      tenantId: target.tenantId,
      executionRunId: `liveness:${target.resourceId}`,
      stepId: `probe:${now.getTime()}`,
      gatewayId: target.gatewayId!,
      delegatedTargetId: target.resourceId,
      target: { id: target.resourceId, zoneId: 'default', host: target.host, port: target.port },
      adapter: 'probe.tcp',
      action: 'gateway.probe',
      payload: { host: target.host, port: target.port },
      now,
    });
    this.pendingGatewayProbes.set(key, { taskId: task.id, target, dispatchedAt: now.getTime() });
  }

  private async collectGatewayResults(now: Date, timeoutMs: number): Promise<void> {
    for (const [key, pending] of this.pendingGatewayProbes) {
      const task = this.gatewayTasks?.get(pending.taskId);
      if (task?.result) {
        await this.recordProbe(pending.target, task.result.success, new Date(task.result.finishedAt), task.result.errorCode, task.result.errorMessage);
        this.pendingGatewayProbes.delete(key);
        continue;
      }
      if (now.getTime() - pending.dispatchedAt >= timeoutMs) {
        await this.recordProbe(pending.target, false, now, 'GATEWAY_PROBE_TIMEOUT');
        this.pendingGatewayProbes.delete(key);
      }
    }
  }

  private async recordProbe(target: ProbeTarget, success: boolean, observedAt: Date, reasonCode?: string, reasonDetail?: string): Promise<void> {
    await this.repository.record({
      tenantId: target.tenantId,
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      signalType: 'MANAGEMENT_TCP',
      source: target.gatewayId ? 'GATEWAY' : 'CONTROL_PLANE',
      success,
      observedAt: observedAt.toISOString(),
      endpointHost: target.host,
      endpointPort: target.port,
      reasonCode,
      reasonDetail,
      observationId: `tcp:${target.resourceType}:${target.resourceId}:${observedAt.toISOString()}`,
      requiredConsecutiveFailures: 2,
    });
  }
}

function parseAgentEndpoint(value: string | null): { host?: string; port?: number } {
  if (!value) return {};
  const candidate = value.includes('://') ? value : `http://${value}`;
  try {
    const url = new URL(candidate);
    const port = Number(url.port);
    return { host: normalizeListenHost(url.hostname), port: Number.isInteger(port) && port > 0 ? port : undefined };
  } catch {
    return {};
  }
}

function normalizeListenHost(host: string): string | undefined {
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return undefined;
  return host;
}

function targetKey(target: ProbeTarget): string {
  return `${target.tenantId}:${target.resourceType}:${target.resourceId}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback;
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ success: boolean; reasonCode?: string; reasonDetail?: string }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: { success: boolean; reasonCode?: string; reasonDetail?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ success: false, reasonCode: 'TCP_CONNECT_TIMEOUT' }));
    socket.once('connect', () => finish({ success: true }));
    socket.once('error', (error: NodeJS.ErrnoException) => finish({
      success: false,
      reasonCode: tcpReasonCode(error.code),
      reasonDetail: error.message,
    }));
  });
}

function tcpReasonCode(code?: string): string {
  if (code === 'ECONNREFUSED') return 'TCP_CONNECTION_REFUSED';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'TCP_DNS_FAILED';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'TCP_NO_ROUTE';
  return 'TCP_CONNECT_FAILED';
}
