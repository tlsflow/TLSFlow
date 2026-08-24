import { AppError } from '../../../common/errors/app-error.js';

export interface PluginRuntimeGuardPolicy {
  maximumConcurrentPerTenant: number;
  maximumConcurrentPerPlugin: number;
  maximumConcurrentPerGateway: number;
  circuitFailureThreshold: number;
  circuitOpenMilliseconds: number;
}

export interface PluginRuntimeGuardContext {
  tenantId: string;
  pluginVersionId: string;
  capabilityKey: string;
  gatewayId?: string;
}

export interface PluginRuntimeMetricSnapshot {
  tenantId: string;
  pluginVersionId: string;
  capabilityKey: string;
  started: number;
  succeeded: number;
  failed: number;
  rejected: number;
  inFlight: number;
  circuitState: 'CLOSED' | 'OPEN';
  lastDurationMilliseconds?: number;
  lastError?: string;
}

const defaultPolicy: PluginRuntimeGuardPolicy = {
  maximumConcurrentPerTenant: 20,
  maximumConcurrentPerPlugin: 10,
  maximumConcurrentPerGateway: 5,
  circuitFailureThreshold: 5,
  circuitOpenMilliseconds: 60_000,
};

export class PluginRuntimeGuardService {
  private readonly metrics = new Map<string, InternalMetric>();
  private readonly tenantInFlight = new Map<string, number>();
  private readonly pluginInFlight = new Map<string, number>();
  private readonly gatewayInFlight = new Map<string, number>();

  constructor(private readonly policy: PluginRuntimeGuardPolicy = defaultPolicy) {}

  async execute<T>(context: PluginRuntimeGuardContext, work: () => Promise<T>): Promise<T> {
    const metric = this.metric(context);
    const now = Date.now();
    if (metric.openUntil && metric.openUntil > now) {
      metric.rejected += 1;
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '插件能力熔断中', { pluginVersionId: context.pluginVersionId, capabilityKey: context.capabilityKey, retryAfter: new Date(metric.openUntil).toISOString() });
    }
    this.assertLimit('tenant', context.tenantId, this.tenantInFlight, this.policy.maximumConcurrentPerTenant, metric);
    this.assertLimit('plugin', context.pluginVersionId, this.pluginInFlight, this.policy.maximumConcurrentPerPlugin, metric);
    if (context.gatewayId) this.assertLimit('gateway', context.gatewayId, this.gatewayInFlight, this.policy.maximumConcurrentPerGateway, metric);
    this.increment(context);
    metric.started += 1;
    metric.inFlight += 1;
    const startedAt = Date.now();
    try {
      const result = await work();
      metric.succeeded += 1;
      metric.consecutiveFailures = 0;
      metric.openUntil = undefined;
      return result;
    } catch (cause) {
      metric.failed += 1;
      metric.consecutiveFailures += 1;
      metric.lastError = cause instanceof Error ? cause.message : String(cause);
      if (metric.consecutiveFailures >= this.policy.circuitFailureThreshold) metric.openUntil = Date.now() + this.policy.circuitOpenMilliseconds;
      throw cause;
    } finally {
      metric.lastDurationMilliseconds = Date.now() - startedAt;
      metric.inFlight -= 1;
      this.decrement(context);
    }
  }

  listMetrics(tenantId?: string): PluginRuntimeMetricSnapshot[] {
    const now = Date.now();
    return [...this.metrics.values()]
      .filter((metric) => !tenantId || metric.tenantId === tenantId)
      .map((metric) => ({
        tenantId: metric.tenantId, pluginVersionId: metric.pluginVersionId, capabilityKey: metric.capabilityKey,
        started: metric.started, succeeded: metric.succeeded, failed: metric.failed, rejected: metric.rejected,
        inFlight: metric.inFlight, circuitState: metric.openUntil && metric.openUntil > now ? 'OPEN' : 'CLOSED',
        lastDurationMilliseconds: metric.lastDurationMilliseconds, lastError: metric.lastError,
      }));
  }

  private assertLimit(scope: string, key: string, counters: Map<string, number>, maximum: number, metric: InternalMetric): void {
    if ((counters.get(key) ?? 0) < maximum) return;
    metric.rejected += 1;
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '插件运行并发限制已达到', { scope, key, maximum });
  }

  private increment(context: PluginRuntimeGuardContext): void {
    increment(this.tenantInFlight, context.tenantId);
    increment(this.pluginInFlight, context.pluginVersionId);
    if (context.gatewayId) increment(this.gatewayInFlight, context.gatewayId);
  }

  private decrement(context: PluginRuntimeGuardContext): void {
    decrement(this.tenantInFlight, context.tenantId);
    decrement(this.pluginInFlight, context.pluginVersionId);
    if (context.gatewayId) decrement(this.gatewayInFlight, context.gatewayId);
  }

  private metric(context: PluginRuntimeGuardContext): InternalMetric {
    const key = `${context.tenantId}:${context.pluginVersionId}:${context.capabilityKey}`;
    let metric = this.metrics.get(key);
    if (!metric) {
      metric = { ...context, started: 0, succeeded: 0, failed: 0, rejected: 0, inFlight: 0, consecutiveFailures: 0 };
      this.metrics.set(key, metric);
    }
    return metric;
  }
}

interface InternalMetric extends PluginRuntimeGuardContext {
  started: number;
  succeeded: number;
  failed: number;
  rejected: number;
  inFlight: number;
  consecutiveFailures: number;
  openUntil?: number;
  lastDurationMilliseconds?: number;
  lastError?: string;
}

function increment(counters: Map<string, number>, key: string): void { counters.set(key, (counters.get(key) ?? 0) + 1); }
function decrement(counters: Map<string, number>, key: string): void { counters.set(key, Math.max(0, (counters.get(key) ?? 1) - 1)); }

export const pluginRuntimeGuard = new PluginRuntimeGuardService();
