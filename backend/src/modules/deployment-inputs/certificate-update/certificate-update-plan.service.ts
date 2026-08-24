import { AppError } from '../../../common/errors/app-error.js';
import { allowedAgentOperationTypes, computeAgentPlanDigest, agentSecurityContractVersion, type AgentPlanV1, type AgentPlanOperationV1 } from '../../agents/security/agent-security.contract.js';
import type { CertificateUpdateResolvedSnapshotV1 } from './certificate-update-input.service.js';

interface PlanTemplateOperation {
  operationId: string;
  operationType: AgentPlanOperationV1['operationType'];
  stage: AgentPlanOperationV1['stage'];
  input: Record<string, unknown>;
  timeoutSeconds?: number;
  expandPathRef?: string;
}

interface PlanTemplateV1 {
  apiVersion: 'gcac.certificate-update-plan/v1';
  pluginId: string;
  capability: 'certificate.deploy' | 'certificate.rollback' | 'certificate.verify';
  planId: string;
  writeEffect: boolean;
  operations: PlanTemplateOperation[];
  authorization?: {
    grantId?: string;
    policyRef?: string;
    policyVersion?: string;
    approvalRef?: string;
    lifetimeSeconds?: number;
  };
}

export function compileCertificateUpdatePlanTemplate(input: {
  templateText: string;
  snapshot: CertificateUpdateResolvedSnapshotV1;
  pluginVersionId: string;
  agentId: string;
  tenantId: string;
  workflowVersionId?: string;
  resourceHash?: string;
}): { plan: AgentPlanV1; authorization: Record<string, unknown> } {
  const template = parseTemplate(input.templateText);
  if (template.pluginId !== input.snapshot.pluginId) fail('PLUGIN', 'Agent Plan 模板与输入快照插件不一致');
  if (template.capability === 'certificate.verify' && template.writeEffect) fail('PLAN', 'Verify Agent Plan 不得声明写入副作用');
  if (template.capability !== 'certificate.verify' && !template.writeEffect) fail('PLAN', 'Deploy/Rollback Agent Plan 必须声明写入副作用');
  const operations = expandOperations(template.operations, input.snapshot, input.workflowVersionId, input.resourceHash);
  if (operations.length === 0) fail('PLAN', 'Agent Plan 模板没有操作');
  const operationTypes = [...new Set(operations.map((operation) => operation.operationType))];
  const plan: AgentPlanV1 = {
    planVersion: agentSecurityContractVersion,
    planId: template.planId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    pluginId: input.snapshot.pluginId,
    pluginVersionId: input.pluginVersionId,
    capability: template.capability,
    operations,
    planDigest: '',
    tokenId: 'draft-token',
    policyDecisionId: 'draft-decision',
    nonce: 'draft-nonce',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    writeEffect: template.writeEffect,
  };
  plan.planDigest = computeAgentPlanDigest(plan);
  const authorization = {
    grantId: template.authorization?.grantId ?? 'certificate-update-grant',
    policyRef: template.authorization?.policyRef ?? 'certificate-update-policy',
    policyVersion: template.authorization?.policyVersion ?? 'v1',
    actions: operationTypes,
    allowedPaths: [...new Set([...input.snapshot.paths, input.snapshot.sourceConfigPath, input.snapshot.programPath, input.snapshot.workingDirectory])],
    allowedServices: [input.snapshot.serviceName],
    artifactDigests: [input.snapshot.artifactDigest],
    ...(template.authorization?.approvalRef ? { approvalRef: template.authorization.approvalRef } : {}),
    lifetimeSeconds: template.authorization?.lifetimeSeconds ?? 300,
  };
  return { plan, authorization };
}

function expandOperations(
  definitions: PlanTemplateOperation[],
  snapshot: CertificateUpdateResolvedSnapshotV1,
  workflowVersionId?: string,
  resourceHash?: string,
): AgentPlanOperationV1[] {
  const expanded: Array<{ definition: PlanTemplateOperation; pathIndex?: number }> = [];
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail('PLAN', 'Agent Plan 操作定义必须是对象');
    validateTemplateOperation(definition);
    if (definition.expandPathRef !== undefined) {
      const values = readPath(snapshot, definition.expandPathRef);
      if (!Array.isArray(values) || values.length === 0) fail('PLAN', `路径集合 ${definition.expandPathRef} 为空`);
      values.forEach((_, index) => expanded.push({ definition, pathIndex: index }));
    } else expanded.push({ definition });
  }
  const result: AgentPlanOperationV1[] = [];
  const previousOperationIds: string[] = [];
  for (const [index, item] of expanded.entries()) {
    const definition = item.definition;
    const operationId = item.pathIndex === undefined ? definition.operationId : `${definition.operationId}-${item.pathIndex + 1}`;
    const input = resolveRefs(definition.input, snapshot, item.pathIndex);
    // command.execute_allowlisted 使用 Agent 的严格输入白名单，不能混入
    // 快照元数据；其余原子动作保留相同的执行身份绑定，供授权和审计校验。
    if (definition.operationType !== 'command.execute_allowlisted') {
      if (workflowVersionId) input.workflowVersionId = workflowVersionId;
      if (resourceHash) input.resourceHash = resourceHash;
      input.inputSnapshotSha256 = snapshot.resolvedInputSha256;
      input.configFingerprint = snapshot.configFingerprint;
      input.bindingKey = snapshot.bindingKey;
    }
    // 证书更新是破坏性顺序链：备份、替换、检查、刷新和验证不能并行。
    // 即使多个文件来自同一集合，也必须等待前一项完成后再执行下一项。
    const dependencies = [...previousOperationIds];
    result.push({
      operationId,
      operationType: definition.operationType,
      stage: definition.stage,
      input,
      dependsOn: dependencies,
      idempotencyKey: `${snapshot.pluginId}:${snapshot.resolvedInputSha256}:${operationId}`,
      timeoutSeconds: definition.timeoutSeconds ?? 60,
    });
    previousOperationIds.push(operationId);
    void index;
  }
  return result;
}

function resolveRefs(value: unknown, snapshot: CertificateUpdateResolvedSnapshotV1, pathIndex?: number): Record<string, unknown> {
  const resolved = replaceRefs(value, snapshot, pathIndex);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) fail('PLAN', '操作 input 必须是对象');
  return resolved as Record<string, unknown>;
}

function replaceRefs(value: unknown, snapshot: CertificateUpdateResolvedSnapshotV1, pathIndex?: number): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceRefs(item, snapshot, pathIndex));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    const ref = record.$ref === 'paths.current' && pathIndex !== undefined ? `paths.${pathIndex}` : record.$ref;
    return readPath(snapshot, ref);
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, replaceRefs(item, snapshot, pathIndex)]));
}

function readPath(snapshot: CertificateUpdateResolvedSnapshotV1, path: string): unknown {
  const segments = path.replaceAll('[', '.').replaceAll(']', '').split('.').filter(Boolean);
  let current: unknown = snapshot;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') fail('PLAN', `模板引用不存在：${path}`);
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) fail('PLAN', `模板引用不存在：${path}`);
  return current;
}

function parseTemplate(value: string): PlanTemplateV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', 'Agent Plan 模板不是有效 JSON', { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('PLAN', 'Agent Plan 模板必须是对象');
  const template = parsed as Record<string, unknown>;
  if (template.apiVersion !== 'gcac.certificate-update-plan/v1') fail('PLAN', 'Agent Plan 模板版本不受支持');
  if (typeof template.pluginId !== 'string' || typeof template.planId !== 'string' || typeof template.capability !== 'string' || typeof template.writeEffect !== 'boolean' || !Array.isArray(template.operations) || template.operations.length === 0) fail('PLAN', 'Agent Plan 模板字段不完整');
  return template as unknown as PlanTemplateV1;
}

function validateTemplateOperation(definition: PlanTemplateOperation): void {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(definition.operationId)) fail('PLAN', '操作 ID 格式无效');
  if (!allowedAgentOperationTypes.includes(definition.operationType)) fail('PLAN', `操作类型不受支持：${String(definition.operationType)}`);
  if (!['prepare', 'execute', 'verify', 'compensate'].includes(definition.stage)) fail('PLAN', '操作阶段不受支持');
  if (!definition.input || typeof definition.input !== 'object' || Array.isArray(definition.input)) fail('PLAN', '操作 input 必须是对象');
  if (definition.timeoutSeconds !== undefined && (!Number.isInteger(definition.timeoutSeconds) || definition.timeoutSeconds < 1 || definition.timeoutSeconds > 3600)) {
    fail('PLAN', '操作超时必须是 1 到 3600 秒');
  }
  if (definition.expandPathRef !== undefined && definition.expandPathRef !== 'paths') fail('PLAN', '只能按快照 paths 展开操作');
  rejectDangerousTemplateInput(definition.input);
}

function rejectDangerousTemplateInput(input: unknown): void {
  if (typeof input === 'string' && /(?:\||&&|;|`|\$\(|\b(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|python|perl|ruby|node)\b|download|invoke-webrequest|invoke-expression)/i.test(input)) {
    fail('PLAN', 'Agent Plan 模板包含 Shell、解释器或下载执行语义');
  }
  if (!input || typeof input !== 'object') return;
  if (Array.isArray(input)) {
    input.forEach(rejectDangerousTemplateInput);
    return;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (['command', 'shell', 'script', 'powershell', 'cmd', 'spawn', 'exec', 'interpreter'].includes(key.toLowerCase())) {
      fail('PLAN', `Agent Plan 模板包含禁止字段：${key}`);
    }
    rejectDangerousTemplateInput(value);
  }
}

function fail(category: string, message: string): never {
  throw new AppError('VALIDATION_FAILED', `证书更新 Agent Plan 模板无效：${message}`, { category, fallback: false });
}
