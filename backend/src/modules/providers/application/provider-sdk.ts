import { AppError } from '../../../common/errors/app-error.js';
import type { Provider } from './provider.interface.js';
import type { DeploymentStepDraft, ProviderFixture, ProviderFixtureReport } from '../dto/providers.dto.js';
import { ProvidersDomainService } from '../domain/providers.domain-service.js';

export class ProviderSdk {
  constructor(private readonly domain = new ProvidersDomainService()) {}

  async runFixture(provider: Provider, fixture: ProviderFixture): Promise<ProviderFixtureReport> {
    const normalizedInput = this.domain.normalizeRunInput(fixture.input);
    const rawResult = await provider.discover(fixture.context, normalizedInput);
    const result = this.domain.normalizeDiscoveryResult(rawResult);
    this.domain.assertNoSensitiveFields(result);
    const draftBundle = provider.toDeploymentDraft(result);
    this.assertDraftBundle(draftBundle);

    const diagnostics: string[] = [];
    const expected = fixture.expected;
    if (expected.hostCount !== undefined && result.hosts.length !== expected.hostCount) diagnostics.push(`hostCount expected ${expected.hostCount}, got ${result.hosts.length}`);
    if (expected.serviceCount !== undefined && result.services.length !== expected.serviceCount) diagnostics.push(`serviceCount expected ${expected.serviceCount}, got ${result.services.length}`);
    if (expected.endpointCount !== undefined && result.endpoints.length !== expected.endpointCount) diagnostics.push(`endpointCount expected ${expected.endpointCount}, got ${result.endpoints.length}`);
    if (expected.bindingCount !== undefined && result.bindings.length !== expected.bindingCount) diagnostics.push(`bindingCount expected ${expected.bindingCount}, got ${result.bindings.length}`);
    if (expected.minStepCount !== undefined && draftBundle.steps.length < expected.minStepCount) diagnostics.push(`stepCount expected >= ${expected.minStepCount}, got ${draftBundle.steps.length}`);

    return {
      fixtureName: fixture.name,
      providerId: provider.getDescriptor().metadata.id,
      passed: diagnostics.length === 0,
      diagnostics,
      summary: draftBundle.summary,
    };
  }

  assertDraftBundle(bundle: { steps: DeploymentStepDraft[] }): void {
    const stepIds = new Set<string>();
    for (const step of bundle.steps) {
      if (!step.id) throw new AppError('VALIDATION_FAILED', 'step draft 缺少 id');
      if (stepIds.has(step.id)) throw new AppError('VALIDATION_FAILED', 'step draft id 重复', { stepId: step.id });
      stepIds.add(step.id);
      if (!step.idempotencyKey) throw new AppError('VALIDATION_FAILED', 'step draft 缺少幂等键', { stepId: step.id });
      if (!step.requiredCapabilities?.length) throw new AppError('VALIDATION_FAILED', 'step draft 缺少能力需求', { stepId: step.id });
      scanSecretLikeValue(step.inputs, ['inputs']);
    }
    for (const step of bundle.steps) {
      for (const dependency of step.dependsOn) {
        if (!stepIds.has(dependency)) throw new AppError('VALIDATION_FAILED', 'step draft 依赖不存在', { stepId: step.id, dependency });
      }
    }
    assertAcyclic(bundle.steps);
  }
}

function assertAcyclic(steps: Array<{ id: string; dependsOn: string[] }>): void {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(stepId: string): void {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) throw new AppError('VALIDATION_FAILED', 'step draft 存在循环依赖', { stepId });
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  }

  steps.forEach((step) => visit(step.id));
}

function scanSecretLikeValue(value: unknown, path: string[]): void {
  if (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|sk-[A-Za-z0-9]{20,}/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'step draft 输入包含疑似明文敏感信息', { fieldPath: path.join('.') });
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanSecretLikeValue(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) scanSecretLikeValue(child, [...path, key]);
  }
}
