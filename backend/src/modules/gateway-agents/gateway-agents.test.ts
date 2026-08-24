import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { GatewayRouteExecutorAdapter } from '../executions/application/executors.js';
import { AgentsDomainService } from '../agents/domain/agents.domain-service.js';
import type { GatewaysRepository } from '../gateways/repository/gateways.repository.js';
import { GatewaysDomainService } from '../gateways/domain/gateways.domain-service.js';
import { GatewayFailoverService } from './failover.service.js';
import { ForwardingGrantService } from './forwarding-grant.service.js';
import { GatewayAgentProcess } from './gateway-agent-process.js';
import type { GatewayAgentProfile, GatewayAdapterType, ReachabilityRecord, TargetEndpoint, Zone } from './gateway-agent.types.js';
import { GatewayV2ForwardingService } from './gateway-v2-forwarding.service.js';
import { GatewayTaskService } from './gateway-task.service.js';
import { ReachabilityService } from './reachability.service.js';
import { ZoneRouter } from './zone-router.js';

const now = new Date();

function gateway(overrides: Partial<GatewayAgentProfile> = {}): GatewayAgentProfile {
  return {
    id: 'gw-1',
    agentId: 'agent-gateway-1',
    zoneIds: ['zone-prod'],
    version: '0.1.0',
    status: 'online',
    adapters: ['relay.tcp'],
    capabilities: ['gateway.relay.tcp'],
    capabilitySetId: 'capset-1',
    currentLoad: 0,
    maxConcurrentTasks: 4,
    successRate: 1,
    lastHeartbeatAt: now.toISOString(),
    ...overrides,
  };
}

function zone(overrides: Partial<Zone['policy']> = {}): Zone {
  return {
    id: 'zone-prod',
    name: '生产区',
    type: 'production',
    enabled: true,
    policy: {
      allowedAdapters: ['relay.tcp'],
      allowedTargets: ['target-1'],
      allowedPorts: [443],
      ...overrides,
    },
  };
}

function reachableRecord(overrides: Partial<ReachabilityRecord> = {}): ReachabilityRecord {
  return {
    id: 'reach-1',
    gatewayId: 'gw-1',
    targetId: 'target-1',
    protocol: 'relay.tcp',
    port: 443,
    status: 'reachable',
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function hasReason(error: unknown, reason: string): boolean {
  return error instanceof AppError && (error.details as { reason?: unknown } | undefined)?.reason === reason;
}

function domainRepository(overrides: Partial<{
  endpoint: TargetEndpoint | undefined;
  reachability: ReachabilityRecord[];
  gateway: GatewayAgentProfile;
  upserted: unknown;
}> = {}): GatewaysRepository {
  const endpoint = overrides.endpoint === undefined
    ? { targetId: 'target-1', tenantId: 'tenant-1', zoneId: 'zone-prod', host: 'target.example.test', port: 443 }
    : overrides.endpoint;
  const selectedGateway = overrides.gateway ?? gateway();
  const reachability = overrides.reachability ?? [reachableRecord({ gatewayId: selectedGateway.id })];
  return {
    findTargetEndpoint: async () => endpoint,
    listReachability: async () => reachability,
    toZoneRouterInputs: async () => ({ zones: [zone()], gateways: [selectedGateway] }),
    getGateway: async () => selectedGateway,
    upsertReachability: async (input: Parameters<GatewaysRepository['upsertReachability']>[1]) => ({ ...input, id: 'reach-1', tenantId: 'tenant-1', checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() }),
  } as unknown as GatewaysRepository;
}

describe('Gateway Relay-only 控制面边界', () => {
  it('只接受 relay.tcp，旧业务通道在生产路由门禁处失败关闭', () => {
    const router = new ZoneRouter([zone()], [gateway()], new ReachabilityService());
    assert.throws(
      () => router.route({ zoneId: 'zone-prod', targetId: 'target-1', protocols: ['forward.agent_task'], now }),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
  });

  it('选择 online、同 Zone、能力匹配且近期可达的 Gateway', () => {
    const reachability = new ReachabilityService();
    reachability.upsert({ ...reachableRecord(), ttlSeconds: 60, now });
    const result = new ZoneRouter([zone()], [gateway()], reachability, new GatewayFailoverService()).route({
      zoneId: 'zone-prod',
      targetId: 'target-1',
      targetHost: 'target.example.test',
      targetPort: 443,
      protocols: ['relay.tcp'],
      requiredCapabilities: ['gateway.relay.tcp'],
      now,
    });
    assert.equal(result.status, 'selected');
    assert.equal(result.selectedGateway?.id, 'gw-1');
    assert.equal(result.candidateGateways[0]?.reachability.protocol, 'relay.tcp');
  });

  it('目标白名单、端口白名单和可达性过期时阻断路由', () => {
    const reachability = new ReachabilityService();
    reachability.upsert({ ...reachableRecord({ expiresAt: new Date(now.getTime() - 1).toISOString() }), ttlSeconds: -1, now: new Date(now.getTime() - 2_000) });
    const expired = new ZoneRouter([zone()], [gateway()], reachability).route({
      zoneId: 'zone-prod', targetId: 'target-1', targetPort: 443, protocols: ['relay.tcp'], now,
    });
    assert.equal(expired.status, 'blocked');
    assert.equal(expired.blockedReason, 'reachability_expired');

    const blockedTarget = new ZoneRouter([zone()], [gateway()], new ReachabilityService()).route({
      zoneId: 'zone-prod', targetId: 'target-unknown', targetPort: 443, protocols: ['relay.tcp'], now,
    });
    assert.equal(blockedTarget.blockedReason, 'target_not_allowed');
  });

  it('控制面只为登记端点签发短时 RelayAuthorization，并拒绝旧能力', async () => {
    const service = new GatewaysDomainService(domainRepository());
    const selected = await service.route('tenant-1', {
      zoneId: 'zone-prod',
      targetId: 'target-1',
      targetHost: 'target.example.test',
      targetPort: 443,
      protocols: ['relay.tcp'],
      requiredCapabilities: ['gateway.relay.tcp'],
      callerId: 'caller-1',
    });
    assert.equal(selected.status, 'selected');
    assert.equal(selected.relayAuthorization?.tenantId, 'tenant-1');
    assert.equal(selected.relayAuthorization?.targetId, 'target-1');
    assert.equal(selected.relayAuthorization?.port, 443);
    assert.ok(Date.parse(selected.relayAuthorization?.expiresAt ?? '') > Date.parse(selected.relayAuthorization?.issuedAt ?? ''));

    await assert.rejects(
      service.route('tenant-1', { zoneId: 'zone-prod', targetId: 'target-1', protocols: ['relay.tcp'], requiredCapabilities: ['gateway.forward.agent_task'] }),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
  });

  it('登记端点的 host 或 port 被改写时不签发授权', async () => {
    const service = new GatewaysDomainService(domainRepository());
    const result = await service.route('tenant-1', {
      zoneId: 'zone-prod', targetId: 'target-1', targetHost: 'other.example.test', targetPort: 443, protocols: ['relay.tcp'],
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'target_endpoint_mismatch');
  });

  it('可达性记录接口只接受 relay.tcp，不触发 HTTP 或 Agent 探测', async () => {
    const service = new GatewaysDomainService(domainRepository());
    await assert.rejects(
      service.probe('tenant-1', { gatewayId: 'gw-1', targetId: 'target-1', protocol: 'probe.http' as GatewayAdapterType }),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
  });

  it('Full Agent 携带 Gateway 字段时拒绝注册', () => {
    const service = new AgentsDomainService();
    assert.throws(
      () => service.normalizeGatewayOnRegister({
        agentKey: 'full-agent-1', hostname: 'full-agent-1', version: '1.0.0', osType: 'linux', role: 'full_agent',
        adapters: ['relay.tcp'], capabilities: ['gateway.relay.tcp'], zoneIds: ['zone-prod'],
      }),
      (error: unknown) => hasReason(error, 'FULL_AGENT_GATEWAY_FIELDS_REJECTED'),
    );
  });

  it('部署执行器对历史 Gateway 任务只返回明确的 Relay-only 阻断，不创建任何任务', async () => {
    const result = await new GatewayRouteExecutorAdapter().executeStep({
      runType: 'apply',
      dryRun: false,
      step: {
        id: 'step-retired-gateway',
        tenantId: 'tenant-1',
        executionRunId: 'run-retired-gateway',
        deploymentPlanTargetId: 'target-1',
        stepType: 'INSTALL',
        attemptCount: 0,
        inputSnapshot: { gatewayRoute: { gatewayId: 'gw-1', adapter: 'forward.agent_task' } },
      },
    } as never);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'GATEWAY_RELAY_ONLY');
    assert.equal(result.detail?.fallback, false);
  });

  it('历史 Gateway 任务、Grant、Agent v2 和进程入口全部失败关闭', () => {
    const gatewayTasks = new GatewayTaskService();
    assert.throws(
      () => gatewayTasks.dispatch({} as never),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
    assert.throws(
      () => new ForwardingGrantService().issue({} as never),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
    assert.throws(
      () => new GatewayV2ForwardingService().prepare({} as never, 'tenant-1', 'request-1'),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
    assert.throws(
      () => new GatewayAgentProcess({} as never),
      (error: unknown) => hasReason(error, 'GATEWAY_RELAY_ONLY'),
    );
  });
});
