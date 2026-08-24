export class HealthDomainService {
  resolveOverallStatus(dependencies: Record<string, 'OK' | 'DEGRADED' | 'UNKNOWN'>): 'OK' | 'DEGRADED' {
    return Object.values(dependencies).some((status) => status === 'DEGRADED') ? 'DEGRADED' : 'OK';
  }
}
