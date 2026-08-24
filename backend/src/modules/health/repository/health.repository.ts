export interface HealthRepository {
  checkDependency(name: string): Promise<'OK' | 'DEGRADED' | 'UNKNOWN'>;
}

export class StaticHealthRepository implements HealthRepository {
  async checkDependency(name: string): Promise<'OK' | 'DEGRADED' | 'UNKNOWN'> {
    if (name === 'database' || name === 'queue') return 'UNKNOWN';
    return 'OK';
  }
}
