import type {
  LegacyAgentProfile,
  LegacyCapabilityGateResult,
  LegacyCompatibilityLevel,
  LegacyDegradePath,
  LegacyGateSuggestion,
  LegacyRiskLevel,
} from './legacy-agent.types.js';

const LEGACY_MINIMUM_CAPABILITIES = ['agent.legacy.online', 'file.write', 'process.exec', 'backup.create', 'verify.basic'] as const;

const RISK_BY_LEVEL: Record<LegacyCompatibilityLevel, LegacyRiskLevel> = {
  L2: 'medium',
  L3: 'medium',
  L4: 'high',
  L5: 'critical',
};

export class LegacyCapabilityGate {
  evaluate(profile: LegacyAgentProfile, requiredCapabilities: string[]): LegacyCapabilityGateResult {
    const active = activeCapabilities(profile);
    const missingMinimum = LEGACY_MINIMUM_CAPABILITIES.filter((key) => !active.has(key));
    const missingRequired = requiredCapabilities.filter((key) => !active.has(key));
    const missingCapabilities = unique([...missingMinimum, ...missingRequired]);
    const reasons = buildReasons(profile, missingCapabilities);

    if (profile.compatibilityLevel === 'L2' && missingCapabilities.length === 0 && profile.protocolMode !== 'offline_result') {
      return {
        decision: 'allow',
        selectedPath: 'legacy_task',
        compatibilityLevel: profile.compatibilityLevel,
        missingCapabilities: [],
        risk: RISK_BY_LEVEL[profile.compatibilityLevel],
        reasons,
        suggestions: [],
      };
    }

    const suggestions = this.suggest(profile, missingCapabilities);
    const selectedPath = suggestions[0]?.path ?? 'monitor_only';

    return {
      decision: selectedPath === 'monitor_only' ? 'block' : 'degrade',
      selectedPath,
      compatibilityLevel: profile.compatibilityLevel,
      missingCapabilities,
      risk: RISK_BY_LEVEL[profile.compatibilityLevel],
      reasons,
      suggestions,
    };
  }

  private suggest(profile: LegacyAgentProfile, missingCapabilities: string[]): LegacyGateSuggestion[] {
    if (profile.compatibilityLevel === 'L5') {
      return [
        {
          path: 'monitor_only',
          reason: '目标处于 L5，只允许监控、告警和人工登记，不能生成自动执行路径。',
          requiredOperatorAction: '由操作员在目标侧完成变更后上传人工证据。',
        },
        {
          path: 'manual_result',
          reason: '如果已有离线执行结果，只能按人工确认归档，不能标记为自动验证成功。',
          requiredOperatorAction: '提供 evidenceRef、operator 和 auditRef。',
        },
      ];
    }

    if (profile.compatibilityLevel === 'L4' || profile.protocolMode === 'offline_result') {
      return [
        {
          path: 'script_package',
          reason: '目标无法安全接入控制面，使用离线脚本包并要求人工回传结果。',
          requiredOperatorAction: '下载脚本包，在目标侧人工执行 install/verify/rollback。',
        },
        {
          path: 'manual_result',
          reason: '缺少自动验证结果时必须进入人工确认，不能伪装成自动成功。',
          requiredOperatorAction: '上传证据引用和审计引用。',
        },
      ];
    }

    if (profile.compatibilityLevel === 'L3') {
      return [
        {
          path: 'gateway',
          reason: '目标更适合通过 Gateway 间接执行，Legacy Agent 不直接扩大权限。',
        },
        {
          path: 'script_package',
          reason: 'Gateway 不可用时生成脚本包，避免降低控制面安全。',
        },
      ];
    }

    if (missingCapabilities.includes('service.reload')) {
      return [
        {
          path: 'script_package',
          reason: '目标缺少服务重载能力，交给操作员使用脚本包确认服务命令更安全。',
        },
        {
          path: 'manual_result',
          reason: '服务动作无法自动验证时必须人工确认。',
        },
      ];
    }

    return [
      {
        path: 'script_package',
        reason: `Legacy Agent 缺少能力：${missingCapabilities.join(', ') || 'unknown'}。`,
      },
      {
        path: 'monitor_only',
        reason: '如果不能提供可信人工证据，只允许监控。',
      },
    ];
  }
}

export function activeCapabilities(profile: LegacyAgentProfile): Set<string> {
  return new Set(profile.capabilities.filter((item) => item.value === true || item.value === 'true').map((item) => item.key));
}

function buildReasons(profile: LegacyAgentProfile, missingCapabilities: string[]): string[] {
  const reasons: string[] = [];
  if (profile.osVersionText) reasons.push(`OS 信息仅用于展示和风险解释：${profile.osVersionText}`);
  if (profile.riskLabels?.length) reasons.push(`风险标签：${profile.riskLabels.join(', ')}`);
  if (missingCapabilities.length) reasons.push(`缺少能力：${missingCapabilities.join(', ')}`);
  if (profile.supportsAutoUpgrade === false) reasons.push('Legacy Agent 默认不支持自动升级。');
  return reasons;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
