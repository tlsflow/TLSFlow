import { metricDefinitions } from '../domain/metric-definition-registry.js';
import type { MetricSnapshot, MetricValue } from '../schema/reports.schema.js';
import { ReportsRepository } from '../repository/reports.repository.js';

export type SnapshotMetricCalculator = (input: {
  tenantId: string;
  snapshotDate: string;
  asOf: string;
}) => Promise<Array<MetricValue & { dimensions?: Record<string, string | boolean | null> }>>;

export class MetricSnapshotWorker {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly calculator: SnapshotMetricCalculator,
  ) {}

  async run(input: { tenantId: string; snapshotDate: string; asOf: string }): Promise<MetricSnapshot[]> {
    const run = await this.repository.startSnapshotRun(input.tenantId, input.snapshotDate, input.asOf);
    try {
      const calculated = await this.calculator(input);
      const generatedAt = new Date().toISOString();
      const snapshots = calculated.map((metric): MetricSnapshot => ({
        tenantId: input.tenantId,
        snapshotDate: input.snapshotDate,
        asOf: input.asOf,
        metricKey: metric.metricKey,
        metricVersion: metric.metricVersion,
        dimensions: metric.dimensions ?? {},
        value: metric.value,
        sampleCount: metric.sampleCount,
        generatedAt,
      }));
      assertKnownMetrics(snapshots);
      await this.repository.saveSnapshots(snapshots);
      await this.repository.finishSnapshotRun(run.id, 'succeeded');
      return snapshots;
    } catch (error) {
      await this.repository.finishSnapshotRun(run.id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

function assertKnownMetrics(snapshots: MetricSnapshot[]): void {
  const known = new Set(metricDefinitions.map((definition) => `${definition.key}:${definition.version}`));
  for (const snapshot of snapshots) {
    if (!known.has(`${snapshot.metricKey}:${snapshot.metricVersion}`)) {
      throw new Error(`快照包含未知指标：${snapshot.metricKey}@${snapshot.metricVersion}`);
    }
  }
}
