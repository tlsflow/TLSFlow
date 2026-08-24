export interface ProviderFallbackInput {
  missingCapabilities: string[];
  osType?: string;
  providerType?: string;
}

export interface ProviderFallbackSuggestion {
  strategy: 'FULL_AGENT' | 'GATEWAY' | 'SSH' | 'WINRM' | 'SCRIPT_PACKAGE' | 'MANUAL_BINDING' | 'MONITOR_ONLY';
  reason: string;
  requiredActions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class ProviderFallbackAdvisor {
  suggest(input: ProviderFallbackInput): ProviderFallbackSuggestion[] {
    const missing = new Set(input.missingCapabilities);
    const suggestions: ProviderFallbackSuggestion[] = [];
    if (missing.has('file.write') || missing.has('process.exec') || missing.has('service.reload')) {
      suggestions.push({
        strategy: input.osType === 'WINDOWS' ? 'WINRM' : 'SSH',
        reason: '目标缺少本地写入或重载能力，需要无代理执行通道补足。',
        requiredActions: ['配置 SecretRef 凭据', '执行 dry-run', '保留回滚备份'],
        riskLevel: 'high',
      });
      suggestions.push({
        strategy: 'GATEWAY',
        reason: '目标无法直连时通过 Gateway 代理执行，避免 Provider 自己执行危险动作。',
        requiredActions: ['选择可达 Gateway', '复核网络访问范围', '审批高风险计划'],
        riskLevel: 'high',
      });
    }
    if (missing.has('certificate.verify')) {
      suggestions.push({
        strategy: 'MONITOR_ONLY',
        reason: '无法远程验证 TLS，部署后只能降级为监控或人工验收。',
        requiredActions: ['补充外部探测点', '人工上传验证证据'],
        riskLevel: 'medium',
      });
    }
    if (!suggestions.length) {
      suggestions.push({
        strategy: 'MANUAL_BINDING',
        reason: '当前能力缺口无法自动补齐，需要人工确认绑定事实。',
        requiredActions: ['创建人工能力声明', '记录审计引用', '设置较短有效期'],
        riskLevel: 'medium',
      });
    }
    return suggestions;
  }
}
