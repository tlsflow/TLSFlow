import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import { StandardDeviceDiscoveryProjector, type StandardDiscoveryProjectionSummary } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';

interface AgentHostAnchor extends Record<string, unknown> {
  id: string;
  hostname: string | null;
  display_name: string | null;
  primary_ip: string | null;
}

/**
 * 将 Agent 的原始能力快照投影为通用 Host 事实。
 *
 * Agent Core 不拥有第三方产品知识。产品识别、配置解析、证书位置和部署语义
 * 必须由控制面插件生成标准发现结果后再交给宿主投影；这里不能读取插件映射，
 * 也不能根据 capabilityKey 推断产品类型。
 */
export class AgentCapabilityDiscoveryProjector {
  constructor(
    private readonly db: DatabasePort,
    private readonly projector: StandardDeviceDiscoveryProjector,
    // 保留装配位，避免在生产 Runner 接线完成前把插件服务重新注入 Agent Core。
    _plugins?: unknown,
  ) {}

  async project(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): Promise<StandardDiscoveryProjectionSummary> {
    const host = await this.resolveHost(snapshot.tenantId, agent.id);
    return this.projector.project({
      tenantId: snapshot.tenantId,
      hostId: host.id,
      discoveryProviderKey: `agent:${agent.id}`,
      discoverySource: 'AGENT',
    }, this.buildDiscovery(agent, snapshot, host));
  }

  private async resolveHost(tenantId: string, agentId: string): Promise<AgentHostAnchor> {
    const result = await this.db.query<AgentHostAnchor>(
      `select id, hostname, display_name, primary_ip
       from pg_hosts
       where tenant_id=$1 and agent_id=$2 and deleted_at is null
       order by updated_at desc
       limit 1`,
      [tenantId, agentId],
    );
    const host = result.rows[0];
    if (!host) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent 尚未建立统一 Host 资产锚点，无法投影通用事实', { tenantId, agentId });
    }
    return host;
  }

  private buildDiscovery(
    agent: AgentRegistration,
    snapshot: AgentCapabilitySnapshot,
    host: AgentHostAnchor,
  ): StandardDeviceDiscoveryV2 {
    return {
      apiVersion: 'gcac.device-discovery/v2',
      device: {
        stableKey: `agent-host:${agent.id}`,
        displayName: host.display_name ?? host.hostname ?? agent.descriptor.hostname ?? agent.id,
        productFamily: 'AGENT_HOST',
        softwareVersion: agent.descriptor.osVersion,
        managementAddress: host.primary_ip ?? agent.descriptor.ipAddress,
        metadata: { agentId: agent.id, snapshotId: snapshot.id },
      },
      capabilities: snapshot.capabilities.map((capability) => ({
        key: capability.capabilityKey,
        available: capability.value !== false && capability.value !== null && capability.value !== undefined,
        metadata: { confidence: capability.confidence },
      })),
      frameworks: [],
      sites: [],
      managedTargets: [],
      certificates: [],
      certificateBindings: [],
      warnings: [],
      rawFacts: {
        agentId: agent.id,
        snapshotId: snapshot.id,
        reportedAt: snapshot.reportedAt,
        capabilityKeys: snapshot.capabilities.map((capability) => capability.capabilityKey),
      },
    };
  }
}
