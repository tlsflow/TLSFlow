import type { CapabilityMatchResult, CapabilityRequirement } from '../../../shared/contracts/capability-contracts.js';
import {
  AdapterKinds,
  type AdapterKind,
  type AdapterManifest,
  type AdapterResolutionEvidence,
  type AdapterResolutionRequest,
  type AdapterResolutionResult,
} from '../../../shared/contracts/adapter-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';
import { AdapterRegistry } from './adapter-registry.js';

const riskRank = { low: 0, medium: 1, high: 2, critical: 3 } as const;

interface EvaluatedCandidate {
  manifest: AdapterManifest;
  match: CapabilityMatchResult;
}

export class AdapterResolver {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly capabilities = new CapabilitiesDomainService(),
  ) {}

  resolve(request: AdapterResolutionRequest): AdapterResolutionResult {
    const requiredKinds = [...new Set(request.requiredKinds)].sort(compareKind);
    const selected: AdapterResolutionResult['selected'] = {};
    const evidence: AdapterResolutionEvidence[] = [];
    const missingCapabilities: AdapterResolutionResult['missingCapabilities'] = [];
    const fallbackSuggestions: AdapterResolutionResult['fallbackSuggestions'] = [];
    const conflicts: AdapterResolutionResult['conflicts'] = [];

    for (const kind of requiredKinds) {
      const expectedAdapterId = request.composition?.[kind];
      const manifests = this.registry.list(kind)
        .filter((manifest) => expectedAdapterId === undefined || manifest.adapterId === expectedAdapterId)
        .filter((manifest) => manifest.supportedOperationSchemas.includes(request.actionSchemaVersion));
      const evaluated = manifests.map((manifest) => ({
        manifest,
        match: this.capabilities.matchRequirement(withManifestConflicts(manifest), request.declarations),
      }));
      const accepted = evaluated.filter((candidate) => candidate.match.status === 'matched').sort(compareCandidate);

      if (accepted.length === 0) {
        evidence.push(...evaluated.map(candidateEvidence));
        missingCapabilities.push(...evaluated.flatMap((candidate) => candidate.match.missingCapabilities));
        fallbackSuggestions.push(...evaluated.flatMap((candidate) => candidate.match.degradationSuggestions));
        evidence.push({
          kind,
          code: 'ADAPTER_NOT_FOUND',
          message: expectedAdapterId
            ? `目录指定的适配器 ${expectedAdapterId} 不满足能力或动作版本要求`
            : `没有 ${kind} 适配器满足能力或动作版本要求`,
        });
        return result('blocked', selected, missingCapabilities, conflicts, evidence, fallbackSuggestions);
      }

      const tied = accepted.filter((candidate) => sameRank(candidate, accepted[0]));
      if (tied.length > 1) {
        const adapterIds = tied.map((candidate) => `${candidate.manifest.adapterId}@${candidate.manifest.version}`).sort();
        conflicts.push({ kind, adapterIds, reason: '存在同优先级且同风险的多个合法候选' });
        evidence.push(...tied.map(candidateEvidence));
        evidence.push({ kind, code: 'ADAPTER_RESOLUTION_AMBIGUOUS', message: `无法在同级候选中静默选择：${adapterIds.join(', ')}` });
        return result('ambiguous', selected, missingCapabilities, conflicts, evidence, fallbackSuggestions);
      }

      selected[kind] = accepted[0].manifest;
      evidence.push({
        adapterId: accepted[0].manifest.adapterId,
        kind,
        code: 'ADAPTER_RESOLVED',
        message: `已选择 ${accepted[0].manifest.adapterId}@${accepted[0].manifest.version}`,
        capabilityMatch: accepted[0].match,
      });
    }

    return result('resolved', selected, missingCapabilities, conflicts, evidence, fallbackSuggestions);
  }
}

function withManifestConflicts(manifest: AdapterManifest): CapabilityRequirement {
  return {
    ...manifest.requirements,
    forbidden: [...manifest.requirements.forbidden, ...manifest.conflicts],
  };
}

function compareCandidate(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  return right.manifest.priority - left.manifest.priority
    || riskRank[left.manifest.riskLevel] - riskRank[right.manifest.riskLevel]
    || left.manifest.adapterId.localeCompare(right.manifest.adapterId)
    || left.manifest.version.localeCompare(right.manifest.version);
}

function sameRank(left: EvaluatedCandidate, right: EvaluatedCandidate): boolean {
  return left.manifest.priority === right.manifest.priority
    && riskRank[left.manifest.riskLevel] === riskRank[right.manifest.riskLevel];
}

function candidateEvidence(candidate: EvaluatedCandidate): AdapterResolutionEvidence {
  return {
    adapterId: candidate.manifest.adapterId,
    kind: candidate.manifest.kind,
    code: candidate.match.status === 'matched' ? 'ADAPTER_CANDIDATE_MATCHED' : 'ADAPTER_CANDIDATE_BLOCKED',
    message: candidate.match.status === 'matched' ? '候选能力满足' : `候选能力状态为 ${candidate.match.status}`,
    capabilityMatch: candidate.match,
  };
}

function result(
  status: AdapterResolutionResult['status'],
  selected: AdapterResolutionResult['selected'],
  missingCapabilities: AdapterResolutionResult['missingCapabilities'],
  conflicts: AdapterResolutionResult['conflicts'],
  evidence: AdapterResolutionResult['evidence'],
  fallbackSuggestions: AdapterResolutionResult['fallbackSuggestions'],
): AdapterResolutionResult {
  return {
    status,
    selected,
    missingCapabilities: dedupe(missingCapabilities, (item) => `${item.capabilityKey}:${item.operator}:${String(item.expected)}`),
    conflicts,
    evidence,
    fallbackSuggestions: dedupe(fallbackSuggestions, (item) => `${item.type}:${item.blockedBy.join(',')}`),
  };
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function compareKind(left: AdapterKind, right: AdapterKind): number {
  return AdapterKinds.indexOf(left) - AdapterKinds.indexOf(right);
}
