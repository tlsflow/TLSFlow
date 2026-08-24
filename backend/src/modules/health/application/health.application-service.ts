import { HealthDomainService } from '../domain/health.domain-service.js';
import type { HealthResponseDto } from '../dto/health.dto.js';
import { StaticHealthRepository, type HealthRepository } from '../repository/health.repository.js';

export class HealthApplicationService {
  constructor(
    private readonly repository: HealthRepository = new StaticHealthRepository(),
    private readonly domainService: HealthDomainService = new HealthDomainService(),
  ) {}

  async getHealth(): Promise<HealthResponseDto> {
    const dependencies = {
      database: await this.repository.checkDependency('database'),
      queue: await this.repository.checkDependency('queue'),
    };
    return {
      status: this.domainService.resolveOverallStatus(dependencies),
      service: 'gcac-backend',
      version: '0.0.1',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
