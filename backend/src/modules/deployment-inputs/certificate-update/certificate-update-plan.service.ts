import { AppError } from '../../../common/errors/app-error.js';
import { CERTIFICATE_UPDATE_POLICY_REF, CERTIFICATE_UPDATE_POLICY_VERSION } from '../../agents/security/policy-version.constants.js';
import { allowedAgentOperationTypes, computeAgentPlanDigest, sha256Digest, agentSecurityContractVersion, type AgentPlanV1, type AgentPlanOperationV1 } from '../../agents/security/agent-security.contract.js';
import type { ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';
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
  resolvedInput?: ResolvedDeploymentInputV1;
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
  let operations = expandOperations(template.operations, input.snapshot, input.workflowVersionId, input.resourceHash);
  if (input.resolvedInput) {
    operations = bindCertificateArtifactContent(operations, input.snapshot, input.resolvedInput, template.capability);
  }
  if (operations.length === 0) fail('PLAN', 'Agent Plan 模板没有操作');
  const operationTypes = [...new Set(operations.map((operation) => operation.operationType))];
  const commandRules = operations
    .filter((operation) => operation.operationType === 'command.execute_allowlisted')
    .map((operation) => toCommandRule(operation.input));
  // IIS 证书库更新只调用固定的 IIS 绑定原语，不读取或写入快照中的文件路径。
  // sourceConfigPath/programPath/workingDirectory 是发现事实，不是本次计划的
  // 执行范围；把它们放进 Agent allowedPaths 会让 Windows 本地策略错误拒绝计划。
  const allowedPaths = input.snapshot.artifactKind === 'WINDOWS_CERTIFICATE_STORE'
    ? []
    : [...new Set([...input.snapshot.paths, input.snapshot.sourceConfigPath, input.snapshot.programPath, input.snapshot.workingDirectory])];
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
    policyRef: template.authorization?.policyRef ?? CERTIFICATE_UPDATE_POLICY_REF,
    policyVersion: template.authorization?.policyVersion ?? CERTIFICATE_UPDATE_POLICY_VERSION,
    actions: operationTypes,
    allowedPaths,
    allowedServices: input.snapshot.serviceName ? [input.snapshot.serviceName] : [],
    commandRules,
    // 证书材料和配置检查程序都是 Agent 实际执行的不可变输入，两个摘要都必须进入
    // 同一份授权范围；否则输入门禁虽然能生成计划，Agent 仍会拒绝真实程序。
    artifactDigests: [...new Set([input.snapshot.artifactDigest, input.snapshot.programSha256])],
    ...(template.authorization?.approvalRef ? { approvalRef: template.authorization.approvalRef } : {}),
    lifetimeSeconds: template.authorization?.lifetimeSeconds ?? 300,
  };
  return { plan, authorization };
}

function toCommandRule(input: Record<string, unknown>): {
  executablePath: string;
  executableSha256: string;
  argumentTemplate: string[];
  environmentAllowlist: string[];
  workingDirectory: string;
  networkScopes: string[];
  childProcessPolicy: 'deny' | 'allow-listed';
  timeoutSeconds: number;
  outputLimitBytes: number;
} {
  if (typeof input.executablePath !== 'string'
    || typeof input.executableSha256 !== 'string'
    || !Array.isArray(input.argumentTemplate)
    || !input.argumentTemplate.every((value) => typeof value === 'string')
    || !Array.isArray(input.environmentAllowlist)
    || !input.environmentAllowlist.every((value) => typeof value === 'string')
    || typeof input.workingDirectory !== 'string'
    || !Array.isArray(input.networkScopes)
    || !input.networkScopes.every((value) => typeof value === 'string')
    || (input.childProcessPolicy !== 'deny' && input.childProcessPolicy !== 'allow-listed')
    || !Number.isInteger(input.timeoutSeconds)
    || !Number.isInteger(input.outputLimitBytes)) {
    throw new AppError('VALIDATION_FAILED', '证书更新计划命令缺少完整 commandRules 字段');
  }
  return {
    executablePath: input.executablePath,
    executableSha256: input.executableSha256,
    argumentTemplate: [...input.argumentTemplate],
    environmentAllowlist: [...input.environmentAllowlist],
    workingDirectory: input.workingDirectory,
    networkScopes: [...input.networkScopes],
    childProcessPolicy: input.childProcessPolicy,
    timeoutSeconds: input.timeoutSeconds as number,
    outputLimitBytes: input.outputLimitBytes as number,
  };
}

/**
 * 把已解析输入中的证书产物绑定到每个文件写操作。摘要只证明产物身份，
 * Agent 真正写入的字节也必须进入签名计划，否则授权链和实际写入对象不是同一件事。
 */
export function bindCertificateUpdatePlanArtifacts(
  plan: AgentPlanV1,
  snapshot: CertificateUpdateResolvedSnapshotV1,
  resolvedInput: ResolvedDeploymentInputV1,
): AgentPlanV1 {
  const operations = bindCertificateArtifactContent(plan.operations, snapshot, resolvedInput, plan.capability);
  const boundPlan = { ...plan, operations, planDigest: '' };
  boundPlan.planDigest = computeAgentPlanDigest(boundPlan);
  return boundPlan;
}

/**
 * 把显式 Credential 的 KeyStore 密码注入当前执行内存中的计划。
 * 密码只存在于本次编译和入队载荷的短生命周期，不写入 resolvedInput、
 * 普通快照、Receipt 或审计字段。未提供时保留 configPath，让 Agent
 * 按目标 Tomcat 配置自动读取；显式值一旦存在，Agent 不得回退。
 */
export function bindCertificateUpdatePlanEphemeralSecrets(
  plan: AgentPlanV1,
  snapshot: CertificateUpdateResolvedSnapshotV1,
  ephemeralSecrets?: { keystorePassword?: string; sourceKeyStorePassword?: string },
): AgentPlanV1 {
  const password = ephemeralSecrets?.keystorePassword;
  const sourcePassword = ephemeralSecrets?.sourceKeyStorePassword;
  if (snapshot.artifactKind !== 'KEYSTORE' || (password === undefined && sourcePassword === undefined)) return plan;
  if (password !== undefined && (typeof password !== 'string' || password.length === 0 || password.length > 1024)) {
    throw new AppError('VALIDATION_FAILED', '显式 keystorePassword Credential 为空或超出长度限制');
  }
  if (sourcePassword !== undefined && (typeof sourcePassword !== 'string' || sourcePassword.length === 0 || sourcePassword.length > 1024)) {
    throw new AppError('VALIDATION_FAILED', 'KeyStore 源制品密码为空或超出长度限制');
  }
  const operations = plan.operations.map((operation) => {
    if (operation.operationType !== 'certificate.material.validate'
      && operation.operationType !== 'filesystem.atomic_replace') return operation;
    const { secretRef: _secretRef, ...inputWithoutSecretRef } = operation.input;
    return {
      ...operation,
      input: {
        ...inputWithoutSecretRef,
        ...(password !== undefined ? { keystorePassword: password } : {}),
        ...(sourcePassword !== undefined ? { sourceKeyStorePassword: sourcePassword } : {}),
        // 显式 Credential 已覆盖自动读取，不能保留可误解为回退来源的 SecretRef；
        // 源制品密码只用于在 Agent 内存中解开平台生成的 PFX/JKS。
        inputSnapshotSha256: snapshot.resolvedInputSha256,
      },
    };
  });
  const boundPlan = { ...plan, operations, planDigest: '' };
  boundPlan.planDigest = computeAgentPlanDigest(boundPlan);
  return boundPlan;
}

/**
 * 回滚只恢复 Agent 在备份阶段签发的 checkpoint，不应再次要求当前部署 Artifact。
 * checkpoint 会进入完整计划摘要，随后由 Policy Authority 和 Agent 一起验证。
 */
export function bindCertificateRollbackCheckpoint(
  plan: AgentPlanV1,
  checkpoint: Record<string, unknown>,
): AgentPlanV1 {
  let restoreCount = 0;
  const operations = plan.operations.map((operation) => {
    if (operation.operationType !== 'filesystem.restore') return operation;
    restoreCount += 1;
    return {
      ...operation,
      input: {
        ...operation.input,
        checkpoint: structuredClone(checkpoint),
      },
    };
  });
  if (restoreCount === 0) throw new AppError('VALIDATION_FAILED', '证书回滚计划缺少 filesystem.restore 操作');
  const boundPlan = { ...plan, operations, planDigest: '' };
  boundPlan.planDigest = computeAgentPlanDigest(boundPlan);
  return boundPlan;
}

function bindCertificateArtifactContent(
  operations: AgentPlanOperationV1[],
  snapshot: CertificateUpdateResolvedSnapshotV1,
  resolvedInput: ResolvedDeploymentInputV1,
  capability: string,
): AgentPlanOperationV1[] {
  const needsArtifact = operations.some((operation) => operation.operationType === 'certificate.material.validate'
    || operation.operationType === 'filesystem.backup'
    || operation.operationType === 'filesystem.atomic_replace'
    || operation.operationType === 'certificate.iis.binding.update');
  if (!needsArtifact) return operations;
  const artifactName = resolvedInput.assetContext.deployment.certificateResourceName;
  const artifact = resolvedInput.artifacts.certificateArtifact
    ?? (artifactName ? resolvedInput.artifacts[artifactName] : undefined);
  if (!artifact || !artifact.outputs || typeof artifact.outputs !== 'object' || Array.isArray(artifact.outputs)) {
    throw new AppError('VALIDATION_FAILED', '证书更新计划缺少可绑定的 Artifact 输出');
  }

  const pathIndex = new Map(snapshot.paths.map((path, index) => [normalizePath(path), index]));
  const outputs = artifact.outputs as Record<string, unknown>;
  return operations.map((operation) => {
    if (operation.operationType === 'certificate.iis.binding.update') {
      const pfxBase64 = outputs.pfxBase64;
      const pfxPassword = outputs.pfxPassword;
      if (typeof pfxBase64 !== 'string' || typeof pfxPassword !== 'string' || pfxPassword.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'IIS 证书 Artifact 缺少 PFX 内容或密码');
      }
      return {
        ...operation,
        input: {
          ...operation.input,
          pfxBase64,
          pfxPassword,
          artifactDigest: snapshot.artifactDigest,
          expectedFingerprintSha256: snapshot.expectedFingerprintSha256,
        },
      };
    }
    if (operation.operationType === 'certificate.iis.binding.verify') {
      return {
        ...operation,
        input: {
          ...operation.input,
          artifactDigest: snapshot.artifactDigest,
          expectedFingerprintSha256: snapshot.pluginId === 'web.iis' && capability === 'certificate.rollback'
            ? snapshot.previousFingerprintSha256
            : snapshot.expectedFingerprintSha256,
        },
      };
    }
    if (operation.operationType !== 'certificate.material.validate'
      && operation.operationType !== 'filesystem.backup'
      && operation.operationType !== 'filesystem.atomic_replace') return operation;
    const path = typeof operation.input.path === 'string' ? operation.input.path : undefined;
    if (!path) throw new AppError('VALIDATION_FAILED', '证书更新文件操作缺少目标路径');
    const index = pathIndex.get(normalizePath(path));
    if (index === undefined) throw new AppError('VALIDATION_FAILED', '证书更新文件路径未绑定到 Artifact 槽位', { path });
    const contentBase64 = resolveArtifactContentBase64(snapshot, outputs, index);
    return { ...operation, input: { ...operation.input, contentBase64 } };
  });
}

function resolveArtifactContentBase64(
  snapshot: CertificateUpdateResolvedSnapshotV1,
  outputs: Record<string, unknown>,
  pathIndex: number,
): string {
  const outputName = snapshot.artifactKind === 'KEYSTORE'
    ? snapshot.keystoreType === 'JKS' ? 'jksBase64' : 'pfxBase64'
    : pathIndex === 0 ? 'leafPem' : pathIndex === 1 ? 'privateKeyPem' : 'orderedChainPem';
  const value = outputs[outputName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `证书 Artifact 缺少 ${outputName} 输出`);
  }
  const contentBase64 = snapshot.artifactKind === 'KEYSTORE' || !value.includes('-----BEGIN ')
    ? value
    : Buffer.from(value, 'utf8').toString('base64');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== contentBase64 || bytes.length > 64 * 1024) {
    throw new AppError('VALIDATION_FAILED', `证书 Artifact 的 ${outputName} Base64 输出无效或超出大小限制`);
  }
  return contentBase64;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
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
    // command.execute_allowlisted 和 IIS 专用原语都有严格的固定输入合同，不能混入
    // 通用快照元数据；其余原子动作保留相同的执行身份绑定，供授权和审计校验。
    const hasStrictInputContract = definition.operationType === 'command.execute_allowlisted'
      || definition.operationType.startsWith('certificate.iis.binding.');
    if (definition.operationType.startsWith('certificate.iis.binding.')) {
      // IIS 的 bindingInformation 允许 `*:443:host` 等原生格式，不能直接充当
      // Agent 合同的 bindingKey。这里保留原生字段给插件，把合同标识规范化为
      // 已持久化的 targetId，必要时再使用确定性摘要，避免历史脏数据阻断执行。
      input.bindingKey = resolveIisAgentBindingKey(snapshot);
    }
    if (!hasStrictInputContract) {
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

function resolveIisAgentBindingKey(snapshot: CertificateUpdateResolvedSnapshotV1): string {
  const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/;
  const isIdentifier = (value: unknown): value is string => typeof value === 'string' && identifierPattern.test(value);
  if (isIdentifier(snapshot.targetId)) return snapshot.targetId;
  if (isIdentifier(snapshot.bindingKey)) return snapshot.bindingKey;
  return `iis-binding-${sha256Digest({
    pluginId: snapshot.pluginId,
    targetId: snapshot.targetId,
    siteId: snapshot.siteId,
    siteName: snapshot.siteName,
    bindingInformation: snapshot.bindingInformation,
  })}`;
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
    // keystorePassword 是可选凭据。没有显式 Credential 时不把空 SecretRef
    // 写入计划，Agent 将按 configPath 自动读取目标 Tomcat 当前密码。
    if ((ref.startsWith('secretRefs.') || ref === 'keyAlias') && readOptionalPath(snapshot, ref) === undefined) return undefined;
    return readPath(snapshot, ref);
  }
  return Object.fromEntries(Object.entries(record)
    .map(([key, item]) => [key, replaceRefs(item, snapshot, pathIndex)] as const)
    .filter(([, item]) => item !== undefined));
}

function readOptionalPath(snapshot: CertificateUpdateResolvedSnapshotV1, path: string): unknown {
  const segments = path.replaceAll('[', '.').replaceAll(']', '').split('.').filter(Boolean);
  let current: unknown = snapshot;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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
