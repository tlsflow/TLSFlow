import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { CertificateAssetEntity, CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { ExecutionRunEntity } from '../../executions/schema/executions.schema.js';
import type { AutomationHealthInput, CreateAlertRuleInput, MonitorTlsProbeRiskInput, RemoteTlsObservationInput, UpsertRiskEventInput } from '../dto/monitors.dto.js';
import type { AlertRule, MonitorDashboardSnapshot, RiskEvent } from '../schema/monitors.schema.js';

export function riskDedupKey(parts: Array<string | undefined>): string {
  return parts.map((part) => (part ?? '').trim().toLowerCase()).join('|');
}

export class MonitorsDomainService {
  buildCertificateRiskEvent(
    asset: CertificateAssetEntity,
    version: CertificateVersionEntity,
    nowIso: string,
    expiringThresholdDays: number,
  ): UpsertRiskEventInput | undefined {
    const now = new Date(nowIso).getTime();
    const notAfter = new Date(version.notAfter).getTime();
    if (Number.isNaN(notAfter)) return undefined;

    const diffDays = Math.ceil((notAfter - now) / 86_400_000);
    if (diffDays < 0) {
      return {
        dedupKey: riskDedupKey(['certificate', 'expired', asset.id, version.id]),
        type: 'certificate_expired',
        source: 'certificate',
        severity: 'critical',
        title: `证书已过期: ${asset.primaryDomain}`,
        summary: `证书 ${asset.primaryDomain} 已于 ${version.notAfter} 过期`,
        scope: { tenantId: undefined, certificateAssetId: asset.id, certificateVersionId: version.id },
        metadata: { primaryDomain: asset.primaryDomain, notAfter: version.notAfter, diffDays },
        detectedAt: nowIso,
      };
    }

    if (diffDays <= expiringThresholdDays) {
      return {
        dedupKey: riskDedupKey(['certificate', 'expiring', asset.id, version.id]),
        type: 'certificate_expiring',
        source: 'certificate',
        severity: diffDays <= 7 ? 'high' : 'medium',
        title: `证书即将过期: ${asset.primaryDomain}`,
        summary: `证书 ${asset.primaryDomain} 将在 ${diffDays} 天后过期`,
        scope: { tenantId: undefined, certificateAssetId: asset.id, certificateVersionId: version.id },
        metadata: { primaryDomain: asset.primaryDomain, notAfter: version.notAfter, diffDays },
        detectedAt: nowIso,
      };
    }

    return undefined;
  }

  buildBindingRiskEvent(binding: CertificateBindingDto): UpsertRiskEventInput | undefined {
    const bindingLabel = binding.domainName ?? binding.id;
    const certificateVersionId = binding.certificateVersionId ?? binding.targetCertificateVersionId ?? binding.localCertificateVersionId;
    const desiredFingerprintSha256 = binding.desiredFingerprintSha256 ?? binding.targetFingerprintSha256;
    if (binding.status === 'DRIFTED') {
      return {
        dedupKey: riskDedupKey(['binding', 'drift', binding.tenantId, binding.id, desiredFingerprintSha256]),
        type: 'binding_drift',
        source: 'binding',
        severity: 'high',
        title: `绑定证书漂移: ${bindingLabel}`,
        summary: `绑定 ${bindingLabel} 的观测证书与期望证书不一致`,
        scope: {
          tenantId: binding.tenantId,
          bindingId: binding.id,
          serviceInstanceId: binding.serviceInstanceId,
          hostId: binding.hostId,
          certificateVersionId,
        },
        metadata: {
          observedFingerprintSha256: binding.observedFingerprintSha256,
          desiredFingerprintSha256,
          bindingType: binding.bindingType,
        },
        detectedAt: new Date().toISOString(),
      };
    }

    if (!certificateVersionId && !desiredFingerprintSha256) {
      return {
        dedupKey: riskDedupKey(['binding', 'unknown-certificate', binding.tenantId, binding.id]),
        type: 'binding_unknown_certificate',
        source: 'binding',
        severity: 'medium',
        title: `绑定缺少证书映射: ${bindingLabel}`,
        summary: `绑定 ${bindingLabel} 缺少可追踪的证书版本或目标指纹`,
        scope: {
          tenantId: binding.tenantId,
          bindingId: binding.id,
          serviceInstanceId: binding.serviceInstanceId,
          hostId: binding.hostId,
        },
        metadata: {
          certificateVersionId,
          desiredFingerprintSha256,
          observedFingerprintSha256: binding.observedFingerprintSha256,
        },
        detectedAt: new Date().toISOString(),
      };
    }

    return undefined;
  }

  buildMonitorTlsProbeRiskEvent(input: MonitorTlsProbeRiskInput): UpsertRiskEventInput | undefined {
    if (!input.verificationError) return undefined;
    const label = input.domainName ?? input.serviceAssetId;
    return {
      dedupKey: riskDedupKey(['tls', 'chain', 'monitor', input.tenantId, input.serviceAssetId]),
      type: 'tls_chain_invalid',
      source: 'monitor',
      severity: 'high',
      title: `TLS 证书链异常: ${label}`,
      summary: `应用资产 ${label} 的系统探测证书链验证失败：${input.verificationError}`,
      scope: { tenantId: input.tenantId, serviceAssetId: input.serviceAssetId },
      metadata: { url: input.url, verificationError: input.verificationError },
      detectedAt: input.checkedAt,
    };
  }

  buildExecutionRiskEvent(run: ExecutionRunEntity): UpsertRiskEventInput | undefined {
    if (!['FAILED', 'TIMEOUT', 'ROLLBACK_FAILED'].includes(run.status)) return undefined;
    return {
      dedupKey: riskDedupKey(['execution', 'failed', run.tenantId, run.id, run.status]),
      type: 'execution_failed',
      source: 'execution',
      severity: run.status === 'ROLLBACK_FAILED' ? 'critical' : 'high',
      title: `执行失败: ${run.id}`,
      summary: `执行运行 ${run.id} 处于 ${run.status} 状态`,
      scope: {
        tenantId: run.tenantId,
        executionRunId: run.id,
      },
      metadata: {
        deploymentPlanId: run.deploymentPlanId,
        status: run.status,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
      },
      detectedAt: run.finishedAt ?? run.updatedAt,
    };
  }

  buildRemoteTlsRiskEvents(input: RemoteTlsObservationInput): UpsertRiskEventInput[] {
    const events: UpsertRiskEventInput[] = [];
    const label = input.domainName ?? input.bindingId;
    if (input.chainStatus && input.chainStatus !== 'valid') {
      events.push({
        dedupKey: riskDedupKey(['tls', 'chain', input.tenantId, input.bindingId, input.chainStatus]),
        type: 'tls_chain_invalid',
        source: 'binding',
        severity: input.chainStatus === 'invalid' ? 'critical' : 'high',
        title: `TLS 证书链异常: ${label}`,
        summary: `绑定 ${label} 的远程 TLS 链状态为 ${input.chainStatus}`,
        scope: { tenantId: input.tenantId, bindingId: input.bindingId },
        metadata: { chainStatus: input.chainStatus },
        detectedAt: input.checkedAt,
      });
    }
    if (input.expectedDomainName && input.domainName && input.expectedDomainName.toLowerCase() !== input.domainName.toLowerCase()) {
      events.push({
        dedupKey: riskDedupKey(['tls', 'domain-mismatch', input.tenantId, input.bindingId, input.expectedDomainName, input.domainName]),
        type: 'tls_domain_mismatch',
        source: 'binding',
        severity: 'high',
        title: `TLS 域名错配: ${label}`,
        summary: `期望域名 ${input.expectedDomainName}，实际观测 ${input.domainName}`,
        scope: { tenantId: input.tenantId, bindingId: input.bindingId },
        metadata: { expectedDomainName: input.expectedDomainName, observedDomainName: input.domainName },
        detectedAt: input.checkedAt,
      });
    }
    if (input.desiredFingerprintSha256 && input.observedFingerprintSha256 && input.desiredFingerprintSha256.toLowerCase() !== input.observedFingerprintSha256.toLowerCase()) {
      events.push({
        dedupKey: riskDedupKey(['tls', 'fingerprint-mismatch', input.tenantId, input.bindingId, input.desiredFingerprintSha256]),
        type: 'tls_fingerprint_mismatch',
        source: 'binding',
        severity: 'high',
        title: `TLS 指纹错配: ${label}`,
        summary: `绑定 ${label} 的远程 TLS 指纹与期望指纹不一致`,
        scope: { tenantId: input.tenantId, bindingId: input.bindingId },
        metadata: { desiredFingerprintSha256: input.desiredFingerprintSha256, observedFingerprintSha256: input.observedFingerprintSha256 },
        detectedAt: input.checkedAt,
      });
    }
    return events;
  }

  buildAutomationHealthRiskEvent(input: AutomationHealthInput): UpsertRiskEventInput | undefined {
    if (input.agentStatus && ['OFFLINE', 'DISABLED'].includes(input.agentStatus)) {
      return {
        dedupKey: riskDedupKey(['agent', 'offline', input.tenantId, input.hostId, input.agentStatus]),
        type: 'agent_offline',
        source: 'agent',
        severity: input.agentStatus === 'DISABLED' ? 'high' : 'medium',
        title: `执行节点不可用: ${input.hostId ?? input.serviceInstanceId ?? 'unknown'}`,
        summary: `目标执行节点状态为 ${input.agentStatus}`,
        scope: { tenantId: input.tenantId, hostId: input.hostId, serviceInstanceId: input.serviceInstanceId },
        metadata: { agentStatus: input.agentStatus },
        detectedAt: input.checkedAt,
      };
    }
    if (input.compatibilityLevel && ['L4', 'L5'].includes(input.compatibilityLevel)) {
      return {
        dedupKey: riskDedupKey(['capability', 'degraded', input.tenantId, input.hostId, input.serviceInstanceId, input.capabilityKey]),
        type: 'capability_degraded',
        source: 'capability',
        severity: input.compatibilityLevel === 'L5' ? 'high' : 'medium',
        title: `自动化能力受限: ${input.capabilityKey ?? input.compatibilityLevel}`,
        summary: `目标兼容等级为 ${input.compatibilityLevel}，可能无法自动更新证书`,
        scope: { tenantId: input.tenantId, hostId: input.hostId, serviceInstanceId: input.serviceInstanceId },
        metadata: { capabilityKey: input.capabilityKey, compatibilityLevel: input.compatibilityLevel },
        detectedAt: input.checkedAt,
      };
    }
    return undefined;
  }

  aggregateDashboard(events: RiskEvent[]): MonitorDashboardSnapshot {
    const active = events.filter((event) => event.status === 'OPEN');
    return {
      expiringCount: active.filter((event) => event.type === 'certificate_expiring').length,
      expiredCount: active.filter((event) => event.type === 'certificate_expired').length,
      driftCount: active.filter((event) => event.type === 'binding_drift').length,
      failedCount: active.filter((event) => event.type === 'execution_failed').length,
      unknownCertificateCount: active.filter((event) => event.type === 'binding_unknown_certificate').length,
      tlsIssueCount: active.filter((event) => event.type.startsWith('tls_')).length,
      automationBlockedCount: active.filter((event) => event.type === 'agent_offline' || event.type === 'capability_degraded').length,
      totalActiveCount: active.length,
      lastScannedAt: active
        .map((event) => event.lastDetectedAt)
        .sort((left, right) => right.localeCompare(left))[0],
    };
  }

  evaluateRule(rule: AlertRule, events: RiskEvent[], nowIso: string): boolean {
    if (rule.status !== 'active') return false;
    if (this.isSilenced(rule, nowIso)) return false;
    const matched = events.filter((event) => this.matchesRuleScope(rule, event));
    return matched.length >= rule.threshold.value;
  }

  normalizeCreateAlertRule(input: CreateAlertRuleInput): CreateAlertRuleInput {
    const name = input.name.trim();
    if (!name) throw new AppError('VALIDATION_FAILED', '告警规则名称不能为空', { field: 'name' });
    if (input.threshold.metric !== 'count' || input.threshold.operator !== 'gte') {
      throw new AppError('VALIDATION_FAILED', '当前仅支持 count gte 阈值模型', { field: 'threshold' });
    }
    if (!Number.isInteger(input.threshold.value) || input.threshold.value < 1) {
      throw new AppError('VALIDATION_FAILED', 'threshold.value 必须是大于 0 的整数', { field: 'threshold.value' });
    }
    return {
      ...input,
      name,
      scope: { ...(input.scope ?? {}) },
    };
  }

  private isSilenced(rule: AlertRule, nowIso: string): boolean {
    if (!rule.silence) return false;
    const now = new Date(nowIso).getTime();
    const startsAt = rule.silence.startsAt ? new Date(rule.silence.startsAt).getTime() : undefined;
    const endsAt = rule.silence.endsAt ? new Date(rule.silence.endsAt).getTime() : undefined;
    if (startsAt !== undefined && !Number.isNaN(startsAt) && now < startsAt) return false;
    if (endsAt !== undefined && !Number.isNaN(endsAt) && now > endsAt) return false;
    return true;
  }

  private matchesRuleScope(rule: AlertRule, event: RiskEvent): boolean {
    const scope = rule.scope;
    if (scope.tenantId !== undefined && event.scope.tenantId !== scope.tenantId) return false;
    if (scope.riskTypes?.length && !scope.riskTypes.includes(event.type)) return false;
    if (scope.severities?.length && !scope.severities.includes(event.severity)) return false;
    if (scope.certificateAssetId !== undefined && event.scope.certificateAssetId !== scope.certificateAssetId) return false;
    if (scope.certificateVersionId !== undefined && event.scope.certificateVersionId !== scope.certificateVersionId) return false;
    if (scope.bindingId !== undefined && event.scope.bindingId !== scope.bindingId) return false;
    if (scope.serviceInstanceId !== undefined && event.scope.serviceInstanceId !== scope.serviceInstanceId) return false;
    if (scope.hostId !== undefined && event.scope.hostId !== scope.hostId) return false;
    return true;
  }
}
