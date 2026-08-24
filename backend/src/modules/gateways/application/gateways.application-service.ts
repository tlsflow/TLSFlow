import type { PageQuery } from '../../../common/pagination/pagination.js';
import { GatewaysDomainService } from '../domain/gateways.domain-service.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';
import { InMemoryGatewaysRepository, type GatewaysRepository } from '../repository/gateways.repository.js';

export class GatewaysApplicationService {
  private readonly domain: GatewaysDomainService;

  constructor(private readonly repository: GatewaysRepository = new InMemoryGatewaysRepository()) {
    this.domain = new GatewaysDomainService(repository);
  }

  getRepository(): GatewaysRepository {
    return this.repository;
  }

  list(tenantId: string, query: PageQuery) {
    this.repository.ensureDefaultZones(tenantId);
    return this.repository.listGateways(tenantId, query);
  }

  detail(tenantId: string, gatewayId: string) {
    const gateway = this.repository.getGateway(tenantId, gatewayId);
    if (!gateway) return undefined;
    return { gateway, zones: this.repository.listZones(tenantId).filter((zone) => gateway.zoneIds.includes(zone.id)), reachability: this.repository.listReachability(tenantId, gatewayId) };
  }

  register(tenantId: string, input: RegisterGatewayInput) {
    return this.domain.register(tenantId, input);
  }

  status(tenantId: string, input: UpdateGatewayStatusInput) {
    return this.domain.status(tenantId, input);
  }

  route(tenantId: string, input: RouteGatewayInput) {
    return this.domain.route(tenantId, input);
  }

  probe(tenantId: string, input: ProbeGatewayInput) {
    return this.domain.probe(tenantId, input);
  }
}
