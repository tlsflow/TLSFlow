import { AppError } from '../../../common/errors/app-error.js';
import {
  CapabilityConstraintOperators,
  CapabilityDeclarationSources,
  CapabilityDeclarationStatuses,
  CapabilityMatchStatuses,
  CapabilityOwnerTypes,
  CapabilityRiskLevels,
  CapabilityTargetTypes,
  CapabilityValueTypes,
  CompatibilityLevels,
  type CapabilityDeclarationSource,
  type CapabilityRiskLevel,
  type CapabilityTargetType,
  type CompatibilityLevel,
} from '../../../shared/enums/core.enums.js';
import { newId } from '../../../shared/id.js';
import type {
  CapabilityConstraint,
  CapabilityConstraintResolution,
  CapabilityDeclaration,
  CapabilityDefinition,
  CapabilityGap,
  CapabilityMatchContext,
  CapabilityMatchResult,
  CapabilityManualRisk,
  CapabilityRequirement,
  CapabilityUnknown,
  CompatibilityEvaluation,
  DegradationSuggestion,
  ManualCapabilityDeclarationInput,
} from '../../../shared/contracts/capability-contracts.js';
import { capabilityDefinitionMap } from '../schema/capabilities.schema.js';

interface NormalizedDeclarationBucket {
  definition?: CapabilityDefinition;
  declarations: CapabilityDeclaration[];
}

interface ConstraintMatchState {
  satisfied?: CapabilityConstraintResolution;
  missing?: CapabilityGap;
  unknown?: CapabilityUnknown;
  manualRisk?: CapabilityManualRisk;
}

export class CapabilitiesDomainService {
  describeBoundary(): string {
    return 'capabilities domain boundary implemented by spec008';
  }

  getBuiltInCapabilityKeys(): string[] {
    return [...new Set([...capabilityDefinitionMap.values()].map((item) => item.key))];
  }

  normalizeDeclaration(input: Omit<CapabilityDeclaration, 'id' | 'originalCapabilityKey' | 'riskLevel'> & { id?: string }): CapabilityDeclaration {
    const targetType = readEnum(input.targetType, CapabilityTargetTypes, 'targetType');
    const source = readEnum(input.source, CapabilityDeclarationSources, 'source');
    const status = readEnum(input.status, CapabilityDeclarationStatuses, 'status');
    const capabilityKey = normalizeCapabilityKey(input.capabilityKey);
    const definition = this.requireDefinition(capabilityKey);
    const confidence = normalizeConfidence(input.confidence, 'confidence');
    const parameters = normalizeParameters(input.parameters);
    const detectedAt = normalizeOptionalIso(input.detectedAt, 'detectedAt');
    const expiresAt = normalizeOptionalIso(input.expiresAt, 'expiresAt');

    if (source === 'manual') {
      throw new AppError('VALIDATION_FAILED', '标准能力声明不能使用 manual 来源', { field: 'source' });
    }
    if (definition.valueType === 'boolean' && typeof input.value !== 'boolean') {
      throw new AppError('VALIDATION_FAILED', '布尔能力值必须为 boolean', { field: 'value', capabilityKey });
    }
    if (detectedAt === undefined && isAutoSource(source)) {
      throw new AppError('VALIDATION_FAILED', '自动能力声明必须提供 detectedAt', { field: 'detectedAt', source });
    }

    return {
      id: input.id ?? newId('capdecl'),
      tenantId: normalizeRequiredString(input.tenantId, 'tenantId'),
      targetType,
      targetId: normalizeRequiredString(input.targetId, 'targetId'),
      capabilityKey: definition.key,
      originalCapabilityKey: normalizeRequiredString(input.capabilityKey, 'capabilityKey'),
      value: normalizeValue(input.value),
      parameters,
      source,
      confidence,
      riskLevel: definition.riskLevel,
      evidence: input.evidence,
      detectedAt,
      expiresAt,
      status,
      createdBy: normalizeOptionalString(input.createdBy),
      auditRef: normalizeOptionalString(input.auditRef),
    };
  }

  normalizeManualDeclaration(input: ManualCapabilityDeclarationInput): CapabilityDeclaration {
    const capabilityKey = normalizeCapabilityKey(input.capabilityKey);
    const definition = this.requireDefinition(capabilityKey);
    if (!definition.manualAllowed) {
      throw new AppError('VALIDATION_FAILED', '该能力不允许人工声明', { capabilityKey: definition.key });
    }
    const confidence = normalizeConfidence(input.confidence, 'confidence');
    if (!input.evidence?.summary?.trim()) {
      throw new AppError('VALIDATION_FAILED', '人工能力声明必须提供证据摘要', { field: 'evidence.summary' });
    }
    if (!normalizeOptionalString(input.createdBy)) {
      throw new AppError('VALIDATION_FAILED', '人工能力声明必须提供 createdBy', { field: 'createdBy' });
    }
    if (!normalizeOptionalString(input.auditRef)) {
      throw new AppError('VALIDATION_FAILED', '人工能力声明必须提供 auditRef', { field: 'auditRef' });
    }
    const expiresAt = normalizeOptionalIso(input.expiresAt, 'expiresAt');
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      throw new AppError('CAPABILITY_EXPIRED', '人工能力声明过期时间必须晚于当前时间', { expiresAt });
    }

    return {
      id: newId('capdecl'),
      tenantId: normalizeRequiredString(input.tenantId, 'tenantId'),
      targetType: readEnum(input.targetType, CapabilityTargetTypes, 'targetType'),
      targetId: normalizeRequiredString(input.targetId, 'targetId'),
      capabilityKey: definition.key,
      originalCapabilityKey: normalizeRequiredString(input.capabilityKey, 'capabilityKey'),
      value: normalizeValue(input.value),
      parameters: normalizeParameters(input.parameters),
      source: 'manual',
      confidence,
      riskLevel: definition.riskLevel,
      evidence: input.evidence,
      expiresAt,
      status: 'active',
      createdBy: input.createdBy.trim(),
      auditRef: input.auditRef.trim(),
    };
  }

  normalizeRequirement(input: CapabilityRequirement): CapabilityRequirement {
    const ownerType = readEnum(input.ownerType, CapabilityOwnerTypes, 'ownerType');
    const riskLevel = readEnum(input.riskLevel, CapabilityRiskLevels, 'riskLevel');
    const requiredAll = input.requiredAll.map((item, index) => this.normalizeConstraint(item, `requiredAll[${index}]`));
    if (requiredAll.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'requiredAll 不能为空', { field: 'requiredAll' });
    }
    const optional = (input.optional ?? []).map((item, index) => this.normalizeConstraint(item, `optional[${index}]`));
    const anyOfGroups = (input.anyOfGroups ?? []).map((group, groupIndex) => {
      if (group.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'anyOfGroups 不能包含空组', { field: `anyOfGroups[${groupIndex}]` });
      }
      return group.map((item, itemIndex) => this.normalizeConstraint(item, `anyOfGroups[${groupIndex}][${itemIndex}]`));
    });
    const forbidden = (input.forbidden ?? []).map((item, index) => this.normalizeConstraint(item, `forbidden[${index}]`));
    const minConfidence = normalizeConfidence(input.minConfidence ?? defaultConfidenceByRisk(riskLevel), 'minConfidence');
    const allowManual = Boolean(input.allowManual);

    return {
      id: normalizeOptionalString(input.id) ?? newId('capreq'),
      ownerType,
      ownerId: normalizeRequiredString(input.ownerId, 'ownerId'),
      requiredAll,
      optional,
      anyOfGroups,
      forbidden,
      minConfidence,
      allowManual,
      riskLevel,
    };
  }

  matchRequirement(requirement: CapabilityRequirement, declarations: CapabilityDeclaration[], context: CapabilityMatchContext = {}): CapabilityMatchResult {
    const normalizedRequirement = this.normalizeRequirement(requirement);
    const filtered = declarations.filter((item) => item.status !== 'revoked');
    const buckets = this.bucketDeclarations(filtered);
    const conflicts = this.findConflicts(buckets);
    const forbiddenHit = normalizedRequirement.forbidden.map((constraint) => this.evaluateConstraint(constraint, buckets, normalizedRequirement, context)).find((item) => item.satisfied);
    if (forbiddenHit?.satisfied) {
      return this.buildResult('blocked', normalizedRequirement, [], [{
        capabilityKey: forbiddenHit.satisfied.capabilityKey,
        originalCapabilityKey: forbiddenHit.satisfied.originalCapabilityKey,
        operator: forbiddenHit.satisfied.operator,
        reason: '命中禁止能力条件',
        riskIfMissing: '禁止条件触发，必须阻断执行',
        expected: forbiddenHit.satisfied.expected,
      }], [], [], conflicts, context, true, [
        suggestion('manual_confirm', '命中禁止能力条件', '当前目标命中了禁止条件，必须先修正环境或改走人工流程。', ['检查禁止能力来源', '确认是否误报能力', '必要时转人工流程'], normalizedRequirement.riskLevel, true, [forbiddenHit.satisfied.capabilityKey]),
      ]);
    }

    if (conflicts.length > 0 && isHighRisk(normalizedRequirement.riskLevel)) {
      return this.buildResult('blocked', normalizedRequirement, [], [], [], [], conflicts, context, true, [
        suggestion('manual_confirm', '能力声明冲突', '同一能力存在互相冲突的声明，高风险动作不能继续。', ['清理冲突声明', '重新探测能力', '人工复核证据'], normalizedRequirement.riskLevel, true, conflicts.map((item) => item.capabilityKey)),
      ]);
    }

    const satisfied: CapabilityConstraintResolution[] = [];
    const missing: CapabilityGap[] = [];
    const unknown: CapabilityUnknown[] = [];
    const manualRisk: CapabilityManualRisk[] = [];
    const anyOfGroupResults: Array<{ index: number; satisfied: boolean }> = [];

    for (const constraint of normalizedRequirement.requiredAll) {
      const result = this.evaluateConstraint(constraint, buckets, normalizedRequirement, context);
      collectConstraintState(result, satisfied, missing, unknown, manualRisk);
    }

    normalizedRequirement.anyOfGroups.forEach((group, index) => {
      let groupSatisfied = false;
      const groupUnknown: CapabilityUnknown[] = [];
      const groupManual: CapabilityManualRisk[] = [];
      const groupMissing: CapabilityGap[] = [];

      for (const constraint of group) {
        const result = this.evaluateConstraint(constraint, buckets, normalizedRequirement, context);
        if (result.satisfied) {
          satisfied.push(result.satisfied);
          if (result.manualRisk) manualRisk.push(result.manualRisk);
          groupSatisfied = true;
          break;
        }
        if (result.unknown) groupUnknown.push(result.unknown);
        if (result.manualRisk) groupManual.push(result.manualRisk);
        if (result.missing) groupMissing.push(result.missing);
      }

      anyOfGroupResults.push({ index, satisfied: groupSatisfied });
      if (!groupSatisfied) {
        if (groupUnknown.length > 0) {
          unknown.push(...groupUnknown);
        } else if (groupMissing.length > 0) {
          missing.push(groupMissing[0]);
        }
        manualRisk.push(...groupManual);
      }
    });

    const lowConfidenceUnknown = uniqueUnknowns(unknown);
    const manualRisks = uniqueManualRisk(manualRisk);
    const missingGaps = uniqueGaps(missing);
    const usedCapabilities = uniqueSatisfied(satisfied);
    const compatibilityLevel = this.evaluateCompatibility({
      targetType: context.targetType ?? 'execution_target',
      targetId: context.targetId ?? normalizedRequirement.ownerId,
      declarations: filtered,
      criticalCapabilityKeys: context.criticalCapabilityKeys,
    }).level;
    const requiresApproval = manualRisks.some((item) => item.blocking) || (normalizedRequirement.riskLevel !== 'low' && manualRisks.length > 0);

    if (missingGaps.length === 0 && lowConfidenceUnknown.length === 0 && manualRisks.length === 0) {
      return this.buildResult('matched', normalizedRequirement, usedCapabilities, missingGaps, lowConfidenceUnknown, manualRisks, conflicts, context, false, [], compatibilityLevel, anyOfGroupResults);
    }

    if (missingGaps.length === 0 && lowConfidenceUnknown.length === 0 && manualRisks.length > 0) {
      return this.buildResult(
        normalizedRequirement.allowManual ? 'manual_required' : 'blocked',
        normalizedRequirement,
        usedCapabilities,
        missingGaps,
        lowConfidenceUnknown,
        manualRisks,
        conflicts,
        context,
        requiresApproval,
        this.buildSuggestions(missingGaps, lowConfidenceUnknown, manualRisks, normalizedRequirement),
        compatibilityLevel,
        anyOfGroupResults,
      );
    }

    const status: 'unknown' | 'degraded' | 'blocked' = missingGaps.length > 0
      ? (this.canDegrade(missingGaps) ? 'degraded' : 'blocked')
      : (lowConfidenceUnknown.length > 0 ? 'unknown' : 'blocked');
    return this.buildResult(
      status,
      normalizedRequirement,
      usedCapabilities,
      missingGaps,
      lowConfidenceUnknown,
      manualRisks,
      conflicts,
      context,
      true,
      this.buildSuggestions(missingGaps, lowConfidenceUnknown, manualRisks, normalizedRequirement),
      compatibilityLevel,
      anyOfGroupResults,
    );
  }

  evaluateCompatibility(input: {
    targetType: CapabilityTargetType;
    targetId: string;
    declarations: CapabilityDeclaration[];
    criticalCapabilityKeys?: string[];
    sourceSnapshotId?: string;
  }): CompatibilityEvaluation {
    const activeKeys = new Set(
      input.declarations
        .filter((item) => item.status === 'active' && !isExpired(item))
        .map((item) => normalizeCapabilityKey(item.capabilityKey)),
    );
    const criticalKeys = input.criticalCapabilityKeys ?? [];

    const hasL1Core = hasAll(activeKeys, ['agent.full.online', 'agent.task.receive', 'agent.log.report', 'file.read', 'file.write', 'file.backup', 'process.exec', 'rollback.snapshot', 'rollback.restore']);
    const hasL1Critical = criticalKeys.length === 0 || criticalKeys.every((item) => activeKeys.has(normalizeCapabilityKey(item)));
    if (hasL1Core && hasL1Critical) {
      return evaluation(input.targetType, input.targetId, 'L1', ['full_agent_online', 'full_execution_path'], [], input.sourceSnapshotId);
    }

    const hasL2Core = activeKeys.has('agent.legacy.online') && (activeKeys.has('file.write') || activeKeys.has('process.exec'));
    if (hasL2Core) {
      return evaluation(input.targetType, input.targetId, 'L2', ['legacy_agent_online'], missingForLevel(activeKeys, ['agent.full.online', 'agent.task.receive', 'agent.log.report']), input.sourceSnapshotId);
    }

    const hasTransport = anyOf(activeKeys, ['ssh.sftp', 'ssh.scp', 'smb.copy']);
    const hasExec = anyOf(activeKeys, ['ssh.exec', 'winrm.exec', 'wmi.exec']);
    const hasGateway = activeKeys.has('gateway.reachable') || activeKeys.has('ssh.connect') || activeKeys.has('winrm.connect');
    if (hasGateway && hasTransport && hasExec) {
      return evaluation(input.targetType, input.targetId, 'L3', ['gateway_or_agentless_path'], missingForLevel(activeKeys, ['agent.legacy.online', 'manual.operation']), input.sourceSnapshotId);
    }

    const hasL4Core = hasAll(activeKeys, ['script_package.generate', 'manual.operation', 'manual.result_upload']);
    if (hasL4Core) {
      return evaluation(input.targetType, input.targetId, 'L4', ['script_package_manual_path'], missingForLevel(activeKeys, ['gateway.reachable', 'ssh.connect', 'winrm.connect']), input.sourceSnapshotId);
    }

    if (activeKeys.has('tls.remote_probe') || activeKeys.has('manual.record')) {
      return evaluation(input.targetType, input.targetId, 'L5', ['monitor_only'], [], input.sourceSnapshotId);
    }

    return evaluation(input.targetType, input.targetId, 'L5', ['insufficient_capabilities'], ['tls.remote_probe', 'manual.record'], input.sourceSnapshotId);
  }

  private buildSuggestions(
    missing: CapabilityGap[],
    unknown: CapabilityUnknown[],
    manualRisk: CapabilityManualRisk[],
    requirement: CapabilityRequirement,
  ): DegradationSuggestion[] {
    const blockedKeys = [...missing.map((item) => item.capabilityKey), ...unknown.map((item) => item.capabilityKey)];
    const suggestions: DegradationSuggestion[] = [];

    if (blockedKeys.includes('agent.full.online')) {
      suggestions.push(suggestion('use_full_agent', '优先安装 Full Agent', '缺失完整 Agent 在线能力，自动化主路径不成立。', ['安装或恢复 Full Agent', '确认控制通道可连接'], 'medium', false, ['agent.full.online']));
      suggestions.push(suggestion('use_legacy_agent', '旧系统可降级到 Legacy Agent', '如果目标太旧跑不了 Full Agent，至少先走 Legacy Agent。', ['安装 Legacy Agent', '重新上报基础能力'], 'medium', false, ['agent.full.online']));
    }
    if (blockedKeys.includes('file.write')) {
      suggestions.push(suggestion('generate_script_package', '缺失写入能力可改用脚本包', '当前执行账户无法写入目标文件，直接自动部署就是扯淡。', ['调整执行账户权限', '或生成脚本包交由本机管理员执行'], 'high', true, ['file.write']));
    }
    if (blockedKeys.includes('process.exec')) {
      suggestions.push(suggestion('use_ssh', '缺失执行能力时改走远程执行', '本地无法安全执行命令，可以改用 SSH/WinRM/WMI。', ['配置 SSH 或 WinRM 凭据', '限制命令白名单', '保留执行证据'], 'critical', true, ['process.exec']));
      suggestions.push(suggestion('manual_confirm', '转人工执行', '命令执行能力缺失时，人工流程比伪自动化靠谱。', ['生成脚本包', '人工执行后上传结果'], 'critical', true, ['process.exec']));
    }
    if (blockedKeys.some((item) => item.endsWith('.reload') || item === 'service.reload')) {
      suggestions.push(suggestion('manual_confirm', '缺失重载能力，允许人工补 reload', '文件能写但不会 reload，就别假装部署成功。', ['允许只写入文件', '人工执行 reload', '等待 TLS 验证通过后再完成'], requirement.riskLevel, requirement.riskLevel !== 'low', blockedKeys.filter((item) => item.endsWith('.reload') || item === 'service.reload')));
    }
    if (blockedKeys.includes('tls.remote_probe')) {
      suggestions.push(suggestion('monitor_only', '补齐验证链路', '没有 TLS 验证能力时，部署最多只能算 installed_unverified。', ['配置远程 TLS 探测', '或让人工上传验证结果'], 'medium', true, ['tls.remote_probe']));
    }
    if (manualRisk.length > 0) {
      suggestions.push(suggestion('manual_confirm', '人工声明需要复核', '人工声明不是能力事实，只是风险接受记录。', ['核验人工证据', '补探测或审批', '必要时缩短过期时间'], requirement.riskLevel, true, manualRisk.map((item) => item.capabilityKey)));
    }
    return dedupeSuggestions(suggestions);
  }

  private canDegrade(missing: CapabilityGap[]): boolean {
    if (missing.length === 0) return false;
    const keys = new Set(missing.map((item) => item.capabilityKey));
    if (keys.has('file.write') || keys.has('process.exec') || keys.has('service.reload')) return true;
    if ([...keys].some((item) => item.endsWith('.reload') || item === 'tls.remote_probe')) return true;
    return false;
  }

  private normalizeConstraint(input: CapabilityConstraint, field: string): CapabilityConstraint {
    const capabilityKey = normalizeCapabilityKey(input.capabilityKey);
    this.requireDefinition(capabilityKey);
    const operator = readEnum(input.operator, CapabilityConstraintOperators, `${field}.operator`);
    const reason = normalizeRequiredString(input.reason, `${field}.reason`);
    const riskIfMissing = normalizeRequiredString(input.riskIfMissing, `${field}.riskIfMissing`);
    return {
      capabilityKey,
      operator,
      expected: input.expected,
      scope: normalizeScope(input.scope),
      reason,
      riskIfMissing,
    };
  }

  private requireDefinition(capabilityKey: string): CapabilityDefinition {
    const definition = capabilityDefinitionMap.get(capabilityKey);
    if (!definition) {
      throw new AppError('VALIDATION_FAILED', '能力键不存在于字典中', { capabilityKey });
    }
    return definition;
  }

  private bucketDeclarations(declarations: CapabilityDeclaration[]): Map<string, NormalizedDeclarationBucket> {
    const buckets = new Map<string, NormalizedDeclarationBucket>();
    for (const item of declarations) {
      const normalizedKey = normalizeCapabilityKey(item.capabilityKey);
      const definition = capabilityDefinitionMap.get(normalizedKey);
      const bucket = buckets.get(normalizedKey) ?? { definition, declarations: [] };
      bucket.declarations.push({ ...item, capabilityKey: definition?.key ?? normalizedKey });
      bucket.definition = definition;
      buckets.set(normalizedKey, bucket);
    }
    return buckets;
  }

  private findConflicts(buckets: Map<string, NormalizedDeclarationBucket>) {
    const conflicts: CapabilityMatchResult['conflictedCapabilities'] = [];
    for (const [capabilityKey, bucket] of buckets.entries()) {
      const active = bucket.declarations.filter((item) => item.status === 'active' && !isExpired(item));
      const valueSet = new Set(active.map((item) => stableStringify(item.value)));
      if (valueSet.size > 1) {
        conflicts.push({
          capabilityKey,
          declarationIds: active.map((item) => item.id),
          values: active.map((item) => item.value),
        });
      }
    }
    return conflicts;
  }

  private evaluateConstraint(
    constraint: CapabilityConstraint,
    buckets: Map<string, NormalizedDeclarationBucket>,
    requirement: CapabilityRequirement,
    context: CapabilityMatchContext,
  ): ConstraintMatchState {
    const normalizedKey = normalizeCapabilityKey(constraint.capabilityKey);
    const bucket = buckets.get(normalizedKey);
    const definition = capabilityDefinitionMap.get(normalizedKey);
    if (!definition) {
      return {
        unknown: {
          capabilityKey: normalizedKey,
          originalCapabilityKey: constraint.capabilityKey,
          operator: constraint.operator,
          reason: constraint.reason,
          expected: constraint.expected,
          blockingReason: 'unknown_definition',
          candidateDeclarationIds: [],
        },
      };
    }
    if (!bucket) {
      return {
        missing: {
          capabilityKey: normalizedKey,
          originalCapabilityKey: constraint.capabilityKey,
          operator: constraint.operator,
          reason: constraint.reason,
          riskIfMissing: constraint.riskIfMissing,
          expected: constraint.expected,
          scope: constraint.scope,
        },
      };
    }

    const active = bucket.declarations.filter((item) => item.status === 'active');
    const valid = active.filter((item) => !isExpired(item));
    const matched = valid.find((item) => this.matchesDeclaration(item, constraint));
    if (matched) {
      const satisfied: CapabilityConstraintResolution = {
        capabilityKey: normalizedKey,
        originalCapabilityKey: constraint.capabilityKey,
        operator: constraint.operator,
        declarationId: matched.id,
        source: matched.source,
        confidence: matched.confidence,
        manual: matched.source === 'manual',
        reason: constraint.reason,
        expected: constraint.expected,
      };

      const manualRisk = matched.source === 'manual'
        ? {
            capabilityKey: normalizedKey,
            declarationId: matched.id,
            confidence: matched.confidence,
            riskLevel: matched.riskLevel,
            blocking: !requirement.allowManual || isHighRisk(requirement.riskLevel),
            reason: requirement.allowManual ? '当前能力由人工声明满足，执行前应复核证据。' : '当前需求禁止人工声明直接满足。',
          }
        : undefined;

      if (matched.confidence < requirement.minConfidence) {
        return {
          satisfied,
          manualRisk,
          unknown: {
            capabilityKey: normalizedKey,
            originalCapabilityKey: constraint.capabilityKey,
            operator: constraint.operator,
            reason: constraint.reason,
            expected: constraint.expected,
            blockingReason: 'low_confidence',
            candidateDeclarationIds: [matched.id],
          },
        };
      }
      return { satisfied, manualRisk };
    }

    if (active.length > 0 && valid.length === 0) {
      return {
        unknown: {
          capabilityKey: normalizedKey,
          originalCapabilityKey: constraint.capabilityKey,
          operator: constraint.operator,
          reason: constraint.reason,
          expected: constraint.expected,
          blockingReason: 'inactive_declaration',
          candidateDeclarationIds: active.map((item) => item.id),
        },
      };
    }

    return {
      missing: {
        capabilityKey: normalizedKey,
        originalCapabilityKey: constraint.capabilityKey,
        operator: constraint.operator,
        reason: constraint.reason,
        riskIfMissing: constraint.riskIfMissing,
        expected: constraint.expected,
        scope: constraint.scope,
      },
    };
  }

  private matchesDeclaration(declaration: CapabilityDeclaration, constraint: CapabilityConstraint): boolean {
    if (declaration.status !== 'active') return false;
    switch (constraint.operator) {
      case 'exists':
        return existsValue(declaration.value);
      case 'equals':
        return declaration.value === constraint.expected;
      case 'contains':
        return containsValue(declaration.value, constraint.expected);
      case 'gte':
        return compareNumber(declaration.value, constraint.expected, 'gte');
      case 'lte':
        return compareNumber(declaration.value, constraint.expected, 'lte');
      case 'matches':
        return typeof declaration.value === 'string' && typeof constraint.expected === 'string' && new RegExp(constraint.expected).test(declaration.value);
      case 'path_writable':
        return matchesScopedParameter(declaration, constraint, ['writablePaths', 'paths']);
      case 'format_supported':
        return matchesScopedParameter(declaration, constraint, ['formats', 'supportedFormats']);
      default:
        return false;
    }
  }

  private buildResult(
    status: CapabilityMatchResult['status'],
    requirement: CapabilityRequirement,
    satisfied: CapabilityConstraintResolution[],
    missing: CapabilityGap[],
    unknown: CapabilityUnknown[],
    manualRisk: CapabilityManualRisk[],
    conflicts: CapabilityMatchResult['conflictedCapabilities'],
    _context: CapabilityMatchContext,
    requiresApproval: boolean,
    degradationSuggestions: DegradationSuggestion[],
    compatibilityLevel: CompatibilityLevel = 'L5',
    anyOfGroupResults: Array<{ index: number; satisfied: boolean }> = [],
  ): CapabilityMatchResult {
    const totalSignals = requirement.requiredAll.length + requirement.anyOfGroups.length;
    const positiveSignals = satisfied.length;
    const negativeSignals = missing.length + unknown.length + conflicts.length;
    const scoreBase = totalSignals === 0 ? 100 : Math.round((positiveSignals / totalSignals) * 100);
    const scorePenalty = manualRisk.length * 8 + negativeSignals * 15;
    const score = Math.max(0, Math.min(100, scoreBase - scorePenalty));

    return {
      status: readEnum(status, CapabilityMatchStatuses, 'status'),
      score,
      satisfied,
      missing,
      unknown,
      manualRisk,
      usedCapabilities: satisfied,
      missingCapabilities: missing,
      lowConfidenceCapabilities: unknown,
      conflictedCapabilities: conflicts,
      degradationSuggestions,
      compatibilityLevel,
      requiresApproval,
      diagnostics: {
        satisfiedCount: satisfied.length,
        missingCount: missing.length,
        unknownCount: unknown.length,
        manualRiskCount: manualRisk.length,
        evaluatedDeclarationCount: positiveSignals + negativeSignals,
        anyOfGroupResults,
      },
    };
  }
}

function normalizeCapabilityKey(value: string): string {
  return normalizeRequiredString(value, 'capabilityKey').trim();
}

function normalizeConfidence(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是 0-100 的整数`, { field, value });
  }
  return value;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  }
  return normalized;
}

function normalizeOptionalIso(value: string | undefined, field: string): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  if (Number.isNaN(Date.parse(normalized))) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是合法 ISO 时间`, { field, value });
  }
  return new Date(normalized).toISOString();
}

function normalizeParameters(value: unknown): Record<string, any> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'parameters 必须是对象', { field: 'parameters' });
  }
  return value as Record<string, any>;
}

function normalizeScope(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'scope 必须是对象', { field: 'scope' });
  }
  return value as Record<string, unknown>;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
  return value;
}

function readEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new AppError('VALIDATION_FAILED', '枚举值不合法', { field, allowedValues: allowed, value });
  }
  return value as T;
}

function isAutoSource(source: CapabilityDeclarationSource): boolean {
  return source === 'agent_report' || source === 'auto_probe' || source === 'gateway_probe' || source === 'agentless_probe' || source === 'inferred' || source === 'plugin_manifest';
}

function isExpired(declaration: CapabilityDeclaration): boolean {
  return declaration.status === 'expired' || (declaration.expiresAt !== undefined && Date.parse(declaration.expiresAt) <= Date.now());
}

function collectConstraintState(
  state: ConstraintMatchState,
  satisfied: CapabilityConstraintResolution[],
  missing: CapabilityGap[],
  unknown: CapabilityUnknown[],
  manualRisk: CapabilityManualRisk[],
) {
  if (state.satisfied) satisfied.push(state.satisfied);
  if (state.missing) missing.push(state.missing);
  if (state.unknown) unknown.push(state.unknown);
  if (state.manualRisk) manualRisk.push(state.manualRisk);
}

function uniqueSatisfied(items: CapabilityConstraintResolution[]): CapabilityConstraintResolution[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.capabilityKey}:${item.declarationId}:${item.operator}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueGaps(items: CapabilityGap[]): CapabilityGap[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.capabilityKey}:${item.operator}:${stableStringify(item.expected)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueUnknowns(items: CapabilityUnknown[]): CapabilityUnknown[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.capabilityKey}:${item.operator}:${item.blockingReason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueManualRisk(items: CapabilityManualRisk[]): CapabilityManualRisk[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.capabilityKey}:${item.declarationId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function existsValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function containsValue(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) return value.includes(expected);
  if (typeof value === 'string' && typeof expected === 'string') return value.includes(expected);
  return false;
}

function compareNumber(actual: unknown, expected: unknown, operator: 'gte' | 'lte'): boolean {
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  return operator === 'gte' ? actual >= expected : actual <= expected;
}

function matchesScopedParameter(declaration: CapabilityDeclaration, constraint: CapabilityConstraint, parameterKeys: string[]): boolean {
  const expected = typeof constraint.expected === 'string' ? constraint.expected : undefined;
  const scopedValue = typeof constraint.scope?.value === 'string' ? constraint.scope.value : expected;
  if (!scopedValue) return existsValue(declaration.value);

  for (const key of parameterKeys) {
    const source = declaration.parameters[key];
    if (Array.isArray(source) && source.some((item) => item === scopedValue)) {
      return true;
    }
  }

  return containsValue(declaration.value, scopedValue);
}

function suggestion(
  type: DegradationSuggestion['type'],
  title: string,
  description: string,
  requiredActions: string[],
  riskLevel: CapabilityRiskLevel,
  requiresApproval: boolean,
  blockedBy: string[],
): DegradationSuggestion {
  return { type, title, description, requiredActions, riskLevel, requiresApproval, blockedBy };
}

function dedupeSuggestions(items: DegradationSuggestion[]): DegradationSuggestion[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.blockedBy.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}:${stableStringify(item)}`).join(',')}}`;
  }
  return String(value);
}

function hasAll(source: Set<string>, keys: string[]): boolean {
  return keys.every((item) => source.has(item));
}

function anyOf(source: Set<string>, keys: string[]): boolean {
  return keys.some((item) => source.has(item));
}

function missingForLevel(source: Set<string>, keys: string[]): string[] {
  return keys.filter((item) => !source.has(item));
}

function evaluation(
  targetType: CapabilityTargetType,
  targetId: string,
  level: CompatibilityLevel,
  reasonCodes: string[],
  missingForNextLevel: string[],
  sourceSnapshotId?: string,
): CompatibilityEvaluation {
  return {
    targetType,
    targetId,
    level: readEnum(level, CompatibilityLevels, 'level'),
    reasonCodes,
    missingForNextLevel,
    evaluatedAt: new Date().toISOString(),
    sourceSnapshotId,
  };
}

function defaultConfidenceByRisk(riskLevel: CapabilityRiskLevel): number {
  if (riskLevel === 'critical') return 90;
  if (riskLevel === 'high') return 80;
  return 70;
}

function isHighRisk(riskLevel: CapabilityRiskLevel): boolean {
  return riskLevel === 'high' || riskLevel === 'critical';
}
