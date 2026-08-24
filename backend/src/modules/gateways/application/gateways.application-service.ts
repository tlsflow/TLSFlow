import type { PageQuery } from '../../../common/pagination/pagination.js';
import { GatewaysDomainService } from '../domain/gateways.domain-service.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';
import { PgGatewaysRepository, type GatewaysRepository } from '../repository/gateways.repository.js';
import { PgGatewayTargetHistoryRepository, type GatewayTargetHistoryRepositoryPort } from '../../gateway-agents/gateway-target-history.service.js';

export class GatewaysApplicationService {
  private readonly domain: GatewaysDomainService;

  constructor(
    private readonly repository: GatewaysRepository = new PgGatewaysRepository(),
    private readonly targetHistoryRepository: GatewayTargetHistoryRepositoryPort = new PgGatewayTargetHistoryRepository(),
  ) {
    this.domain = new GatewaysDomainService(repository);
  }

  getRepository(): GatewaysRepository {
    return this.repository;
  }

  getTargetHistoryRepository(): GatewayTargetHistoryRepositoryPort {
    return this.targetHistoryRepository;
  }

  async list(tenantId: string, query: PageQuery) {
    await this.repository.ensureDefaultZones(tenantId);
    return this.repository.listGateways(tenantId, query);
  }

  async detail(tenantId: string, gatewayId: string) {
    const gateway = await this.repository.getGateway(tenantId, gatewayId);
    if (!gateway) return undefined;
    return {
      gateway,
      zones: (await this.repository.listZones(tenantId)).filter((zone) => gateway.zoneIds.includes(zone.id)),
      reachability: await this.repository.listReachability(tenantId, gatewayId),
    };
  }

  async register(tenantId: string, input: RegisterGatewayInput) {
    return this.domain.register(tenantId, input);
  }

  async status(tenantId: string, input: UpdateGatewayStatusInput) {
    return this.domain.status(tenantId, input);
  }

  async route(tenantId: string, input: RouteGatewayInput) {
    return this.domain.route(tenantId, input);
  }

  async probe(tenantId: string, input: ProbeGatewayInput) {
    return this.domain.probe(tenantId, input);
  }

  async targetHistory(tenantId: string, delegatedTargetId: string) {
    return {
      delegatedTargetId,
      items: await this.targetHistoryRepository.listByTarget(delegatedTargetId, tenantId),
    };
  }
}
