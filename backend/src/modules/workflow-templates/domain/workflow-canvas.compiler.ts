import { AppError } from '../../../common/errors/app-error.js';
import type {
  WorkflowDslV1,
  WorkflowHttpRequest,
  WorkflowStage,
  WorkflowStep,
  WorkflowStepType,
  WorkflowSshArgumentTemplate,
  WorkflowSshProgram,
} from '../dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from '../schema/workflow-templates.schema.js';
import { validateDeploymentInputContractV1 } from '../../deployment-inputs/schema/deployment-input-contract.schema.js';
import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';

type CanvasNodeType = 'http' | 'ssh' | 'sftp' | 'scp' | 'verify' | 'condition' | 'transform' | 'foreach' | 'checkpoint' | 'wait' | 'manual' | 'plugin.action';
type CanvasEdgeType = 'success' | 'failure' | 'always' | 'rollback';
type CanvasHttpAuthType = 'none' | 'basic' | 'bearer' | 'api_key' | 'cookie' | 'custom_header' | 'mtls';

interface CanvasNode {
  readonly id: string;
  readonly type: CanvasNodeType;
  readonly position?: { readonly x?: number; readonly y?: number };
  readonly label?: string;
  readonly config?: Record<string, unknown>;
  readonly ui?: Record<string, unknown>;
}

interface CanvasEdge {
  readonly id?: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly edgeType?: CanvasEdgeType;
}

interface WorkflowCanvasDefinition {
  readonly schemaVersion?: string;
  readonly metadata?: {
    readonly name?: string;
    readonly displayName?: string;
    readonly category?: string;
    readonly tags?: readonly string[];
  };
  readonly inputContract?: DeploymentInputContractV1;
  readonly nodes?: readonly CanvasNode[];
  readonly edges?: readonly CanvasEdge[];
  readonly draftState?: Record<string, unknown>;
}

export interface WorkflowCanvasValidationIssue {
  readonly id: string;
  readonly severity: 'error' | 'warning' | 'risk';
  readonly message: string;
  readonly targetType: 'canvas' | 'node' | 'edge' | 'field';
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly field?: string;
  readonly suggestion: string;
}

export interface WorkflowCanvasCompileResult {
  readonly content: WorkflowDslV1;
  readonly issues: readonly WorkflowCanvasValidationIssue[];
  readonly stepNames: Record<string, string>;
}

const workflowStages: readonly WorkflowStage[] = ['prepare', 'backup', 'install', 'refresh', 'verify'];
const workflowStepTypes: readonly WorkflowStepType[] = ['http', 'ssh', 'sftp', 'scp', 'condition', 'transform', 'foreach', 'checkpoint', 'wait', 'manual', 'plugin.action'];
const requiredNodeTypes: readonly CanvasNodeType[] = ['http', 'ssh', 'sftp', 'verify'];

export function compileWorkflowCanvas(input: unknown): WorkflowCanvasCompileResult {
  const canvas = readCanvas(input);
  const issues = validateWorkflowCanvas(canvas);
  const blocking = issues.filter((item) => item.severity === 'error');
  if (blocking.length > 0) {
    throw new AppError('VALIDATION_FAILED', '工作流画布校验失败', { issues: blocking });
  }
  const compiled = workflowCanvasToDsl(canvas);
  const content = workflowTemplatesSchemaRegistry.validate(compiled.content);
  return { content, issues, stepNames: compiled.stepNames };
}

export function validateWorkflowCanvasInput(input: unknown): { issues: readonly WorkflowCanvasValidationIssue[] } {
  return { issues: validateWorkflowCanvas(readCanvas(input)) };
}

function readCanvas(input: unknown): WorkflowCanvasDefinition {
  if (!isRecord(input)) throw new AppError('VALIDATION_FAILED', '工作流画布必须是对象');
  const canvas = isRecord(input.canvas) ? input.canvas : input;
  if (!isRecord(canvas)) throw new AppError('VALIDATION_FAILED', '工作流画布必须是对象');
  return canvas as unknown as WorkflowCanvasDefinition;
}

function validateWorkflowCanvas(canvas: WorkflowCanvasDefinition): WorkflowCanvasValidationIssue[] {
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
  const issues: WorkflowCanvasValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (isRecord(canvas) && ('variables' in canvas || 'connections' in canvas)) {
    issues.push(canvasIssue('legacy-input-contract', 'error', '画布不能包含旧 variables/connections 根字段。', '迁移为完整的 inputContract。'));
  }
  if (canvas.inputContract === undefined) {
    issues.push(canvasIssue('input-contract-required', 'error', '画布缺少 inputContract。', '声明 gcac.deployment-input/v1 输入契约。'));
  } else {
    try {
      validateDeploymentInputContractV1(canvas.inputContract);
    } catch (cause) {
      issues.push(canvasIssue('input-contract-invalid', 'error', cause instanceof Error ? cause.message : 'inputContract 校验失败。', '修正变量、连接、凭据和 Artifact 槽位定义。'));
    }
  }
  if (nodes.length === 0) issues.push(canvasIssue('empty-canvas', 'error', '画布至少需要一个执行节点。', '添加 HTTP、SSH、SFTP 或验证节点。'));

  for (const node of nodes) {
    const config = node.config ?? {};
    validateRequiredConfig(node, issues);
    for (const [key, value] of Object.entries(config)) {
      if (containsPlainSecret(value)) {
        issues.push(fieldIssue(node, key, `${node.label ?? node.id} 的 ${key} 疑似包含明文密钥。`, '改为选择已保存凭据、密文输入或变量表达式。'));
      }
    }
    const timeout = config.timeoutSeconds ?? config.seconds;
    if (['http', 'ssh', 'sftp', 'scp', 'verify'].includes(node.type) && (!Number.isInteger(Number(timeout)) || Number(timeout) <= 0)) {
      issues.push(fieldIssue(node, 'timeoutSeconds', `${node.label ?? node.id} 必须声明正整数超时。`, '为外部动作设置明确 timeoutSeconds。'));
    }
  }

  for (const edge of edges) {
    const edgeId = edge.id ?? `${edge.sourceNodeId}:${edge.targetNodeId}`;
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      issues.push(edgeIssue(edgeId, '连线引用了不存在的节点。', '删除这条连线或重新连接有效节点。'));
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push(edgeIssue(edgeId, '节点不能连接到自己。', '选择另一个目标节点。'));
    }
  }

  if (hasCycle(nodes, edges)) issues.push(canvasIssue('graph-cycle', 'error', '画布存在循环依赖。', '删除导致回到上游节点的连线。'));
  for (const type of requiredNodeTypes) {
    if (!nodes.some((node) => node.type === type)) {
      issues.push(canvasIssue(`missing-${type}`, 'warning', `草稿缺少 ${type} 节点。`, '验收草稿建议包含 HTTP、SSH、SFTP 和验证节点。'));
    }
  }
  return issues;
}

function workflowCanvasToDsl(canvas: WorkflowCanvasDefinition): { content: WorkflowDslV1; stepNames: Record<string, string> } {
  const normalized = normalizeWorkflowCanvasFlow(canvas);
  const orderedNodes = getExecutableDslNodes(normalized);
  const stepNames = Object.fromEntries(orderedNodes.map((node, index) => [node.id, buildDslStepName(node, index)]));
  const steps = orderedNodes.map((node, index) => nodeToDslStep(node, index));
  const rollback = resolveRollbackSteps(normalized);
  return {
    stepNames,
    content: {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: {
      name: normalizeIdentifier(String(canvas.metadata?.name ?? 'workflow-canvas-draft')),
      displayName: canvas.metadata?.displayName,
      category: canvas.metadata?.category,
      tags: [...(canvas.metadata?.tags ?? [])],
    },
    inputContract: cloneRecord(canvas.inputContract!),
    steps,
    rollback,
    },
  };
}

function nodeToDslStep(node: CanvasNode, index: number): WorkflowStep {
  const config = node.config ?? {};
  const name = buildDslStepName(node, index);
  if (node.type === 'http') {
    const auth = buildHttpRequestAuth(config);
    return mergeImportedDslStep(node, {
      name,
      type: 'http',
      stage: getNodeStage(node),
      request: {
        method: readHttpMethod(config.method),
        url: String(config.url ?? '{{verifyUrl}}'),
        connectionRef: String(config.connectionRef ?? ''),
        ...(auth ? { auth } : {}),
        ...(isBlank(config.body) ? {} : { body: parseLooseJson(String(config.body)) }),
        timeoutSeconds: Number(config.timeoutSeconds ?? 30),
      },
      extract: [{ name: `${name}_status`, type: 'statusCode', optional: true }],
      assert: [{ type: 'statusCode', equals: 200 }],
    });
  }
  if (node.type === 'ssh') {
    const imported = readImportedStep(node);
    return {
      name,
      type: 'ssh',
      stage: getNodeStage(node),
      ssh: {
        connectionRef: String(config.connectionRef ?? ''),
        program: String(config.program ?? '') as WorkflowSshProgram,
        args: Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
        argumentTemplate: String(config.argumentTemplate ?? '') as WorkflowSshArgumentTemplate,
        timeoutSeconds: Number(config.timeoutSeconds ?? 60),
      },
      assert: [{ type: 'regex', pattern: '.*' }],
      ...(imported?.type === 'ssh' ? { retry: imported.retry, extract: imported.extract, assert: imported.assert } : {}),
    } as WorkflowStep;
  }
  if (node.type === 'sftp') return mergeImportedDslStep(node, buildFileTransferDslStep(node, name, 'sftp'));
  if (node.type === 'scp') return mergeImportedDslStep(node, buildFileTransferDslStep(node, name, 'scp'));
  if (node.type === 'verify') {
    if (String(config.verifyType ?? 'httpStatus') === 'httpStatus') {
      return mergeImportedDslStep(node, {
        name,
        type: 'http',
        stage: getNodeStage(node),
        request: { method: 'GET', url: String(config.inputRef ?? '{{verifyUrl}}'), connectionRef: String(config.connectionRef ?? ''), timeoutSeconds: Number(config.timeoutSeconds ?? 30) },
        assert: [{ type: 'statusCode', equals: Number(config.expected ?? 200) }],
      });
    }
    return mergeImportedDslStep(node, {
      name,
      type: 'manual',
      stage: getNodeStage(node),
      instruction: `验证 ${String(config.inputRef ?? '')} 应匹配 ${String(config.expected ?? '')}`,
    });
  }
  if (node.type === 'condition') {
    return mergeImportedDslStep(node, {
      name,
      type: 'condition',
      stage: getNodeStage(node),
      condition: buildDslCondition(config),
      description: String(config.description ?? ''),
    });
  }
  if (node.type === 'transform') {
    const imported = readImportedStep(node);
    if (imported?.type === 'transform') return { ...imported, name, stage: getNodeStage(node) };
    return {
      name,
      type: 'transform',
      stage: getNodeStage(node),
      transform: {
        engine: 'jsonata',
        input: parseLooseJson(String(config.input ?? '{}')),
        outputs: {
          value: {
            expression: String(config.expression ?? '$'),
            format: String(config.format ?? 'raw') === 'jsonString' ? 'jsonString' : 'raw',
          },
        },
        timeoutMs: Number(config.timeoutMs ?? 200),
        maxInputBytes: Number(config.maxInputBytes ?? 262144),
        maxOutputBytes: Number(config.maxOutputBytes ?? 262144),
      },
    };
  }
  if (node.type === 'foreach') {
    return mergeImportedDslStep(node, {
      name,
      type: 'foreach',
      stage: getNodeStage(node),
      foreach: {
        itemsPath: String(config.itemsPath ?? ''),
        itemVariable: String(config.itemVariable ?? ''),
        ...(isBlank(config.indexVariable) ? {} : { indexVariable: String(config.indexVariable) }),
        maxItems: Number(config.maxItems ?? 100),
        continueOnError: config.continueOnError === true,
        steps: readForeachSteps(config.steps),
      },
    });
  }
  if (node.type === 'checkpoint') {
    const capture = parseLooseJson(String(config.capture ?? '{}'));
    if (!capture || typeof capture !== 'object' || Array.isArray(capture)) throw new AppError('VALIDATION_FAILED', 'checkpoint capture 必须是 JSON 对象');
    return mergeImportedDslStep(node, {
      name,
      type: 'checkpoint',
      stage: getNodeStage(node),
      checkpoint: {
        name: String(config.checkpointName ?? ''),
        capture: capture as Record<string, string>,
        normalizedHash: true,
        requiredForRollback: String(config.requiredForRollback ?? 'true') !== 'false',
      },
    });
  }
  if (node.type === 'plugin.action') {
    const imported = readImportedStep(node);
    const generated: WorkflowStep = {
      name,
      type: 'plugin.action',
      stage: getNodeStage(node),
      pluginId: String(config.pluginId ?? ''),
      capability: String(config.capability ?? ''),
      actionId: String(config.actionId ?? ''),
      actionContractVersion: String(config.actionContractVersion ?? 'v1'),
      input: parseLooseJson(String(config.input ?? '{}')) as Record<string, unknown>,
      inputSchemaSha256: String(config.inputSchemaSha256 ?? ''),
      outputSchemaSha256: String(config.outputSchemaSha256 ?? ''),
      timeoutSeconds: Number(config.timeoutSeconds ?? 30),
      writeEffect: config.writeEffect === true || String(config.writeEffect).toLowerCase() === 'true',
      idempotencyKeyRef: String(config.idempotencyKeyRef ?? '{{variables.idempotencyKey}}'),
    };
    return imported?.type === 'plugin.action' ? { ...imported, ...generated } : generated;
  }
  if (node.type === 'wait') return mergeImportedDslStep(node, { name, type: 'wait', stage: getNodeStage(node), seconds: Number(config.seconds ?? 10) });
  return mergeImportedDslStep(node, { name, type: 'manual', stage: getNodeStage(node), instruction: String(config.instruction ?? '人工确认') });
}

function buildFileTransferDslStep(node: CanvasNode, name: string, protocol: 'sftp' | 'scp'): Extract<WorkflowStep, { type: 'sftp' | 'scp' }> {
  const config = node.config ?? {};
  const transfer = {
    direction: normalizeTransferDirection(config.direction),
    connectionRef: String(config.connectionRef ?? ''),
    remotePath: String(config.remotePath ?? '/tmp/cert.pem'),
    ...(isBlank(config.temporaryPath) ? {} : { temporaryPath: String(config.temporaryPath) }),
    ...(isBlank(config.contentRef) ? {} : { contentRef: String(config.contentRef) }),
    ...(isBlank(config.localPath) ? {} : { localPath: String(config.localPath) }),
    ...(isBlank(config.mode) ? {} : { mode: String(config.mode) }),
    timeoutSeconds: Number(config.timeoutSeconds ?? 60),
  };
  const common = {
    name,
    stage: getNodeStage(node),
    extract: [{ name: `${name}_hash`, type: 'jsonPath' as const, path: '$.transferResults[0].hash', optional: true }],
  };
  return protocol === 'sftp'
    ? { ...common, type: 'sftp', sftp: transfer }
    : { ...common, type: 'scp', scp: transfer };
}

function validateRequiredConfig(node: CanvasNode, issues: WorkflowCanvasValidationIssue[]): void {
  const config = node.config ?? {};
  const required = requiredFieldsForType(node.type);
  for (const field of required) {
    if (field === 'args' && Array.isArray(config[field])) continue;
    if (isBlank(config[field])) issues.push(fieldIssue(node, field, `${node.label ?? node.id} 缺少 ${field}。`, `补全 ${field}。`));
  }
  if (node.type === 'http') validateHttpNodeConfig(node, issues);
}

function requiredFieldsForType(type: CanvasNodeType): string[] {
  if (type === 'http') return ['method', 'url', 'connectionRef', 'timeoutSeconds'];
  if (type === 'ssh') return ['connectionRef', 'program', 'args', 'argumentTemplate', 'timeoutSeconds'];
  if (type === 'sftp' || type === 'scp') return ['direction', 'connectionRef', 'remotePath', 'timeoutSeconds'];
  if (type === 'verify') return ['verifyType', 'inputRef', 'expected', 'timeoutSeconds'];
  if (type === 'condition') return ['variable', 'operator'];
  if (type === 'foreach') return ['itemsPath', 'itemVariable', 'maxItems', 'continueOnError', 'steps'];
  if (type === 'checkpoint') return ['checkpointName', 'capture', 'requiredForRollback'];
  if (type === 'plugin.action') return ['pluginId', 'capability', 'actionId', 'actionContractVersion', 'input', 'inputSchemaSha256', 'outputSchemaSha256', 'timeoutSeconds', 'writeEffect', 'idempotencyKeyRef'];
  if (type === 'wait') return ['seconds'];
  if (type === 'manual') return ['instruction'];
  return [];
}

function validateHttpNodeConfig(node: CanvasNode, issues: WorkflowCanvasValidationIssue[]): void {
  const config = node.config ?? {};
  const authType = readHttpAuthType(config.authType);
  if (!authType) {
    issues.push(fieldIssue(node, 'authType', `${node.label ?? node.id} 的 HTTP 认证类型不支持。`, '改为 none、basic、bearer、api_key、cookie、custom_header 或 mtls。'));
    return;
  }
  if (authType === 'none') return;
  if (authType === 'basic') {
    if (isBlank(config.authUsername)) issues.push(fieldIssue(node, 'authUsername', `${node.label ?? node.id} 的 Basic 用户名不能为空。`, '填写用户名或选择已保存的用户名密码凭据。'));
    if (!isCredentialValue(config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label ?? node.id} 的 Basic 凭据不能为空。`, '选择已保存凭据或引用 credential 变量。'));
    return;
  }
  if (authType === 'bearer') {
    if (!isCredentialValue(config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label ?? node.id} 的 Bearer 凭据不能为空。`, '选择已保存凭据或引用 credential 变量。'));
    return;
  }
  if (authType === 'api_key') {
    if (!isCredentialValue(config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label ?? node.id} 的 API Key 凭据不能为空。`, '选择已保存凭据或引用 credential 变量。'));
    if (isBlank(config.authApiKeyName)) issues.push(fieldIssue(node, 'authApiKeyName', `${node.label ?? node.id} 的 API Key 名称不能为空。`, '填写 Header 名称或 Query 参数名。'));
    if (!['header', 'query'].includes(String(config.authApiKeyIn ?? 'header'))) issues.push(fieldIssue(node, 'authApiKeyIn', `${node.label ?? node.id} 的 API Key 传递位置不支持。`, '改为 header 或 query。'));
    return;
  }
  if (authType === 'cookie') {
    if (isBlank(config.authSecretValue)) issues.push(fieldIssue(node, 'authSecretValue', `${node.label ?? node.id} 的认证值不能为空。`, '填写 Secret 引用。'));
    return;
  }
  if (authType === 'custom_header') {
    if (isBlank(config.authSecretValue)) issues.push(fieldIssue(node, 'authSecretValue', `${node.label ?? node.id} 的自定义 Header 值不能为空。`, '填写 Secret 引用。'));
    if (isBlank(config.authHeaderName)) issues.push(fieldIssue(node, 'authHeaderName', `${node.label ?? node.id} 的 Header 名称不能为空。`, '填写实际 Header 名称。'));
    return;
  }
  if (isBlank(config.authCertSecretRef)) issues.push(fieldIssue(node, 'authCertSecretRef', `${node.label ?? node.id} 的客户端证书不能为空。`, '填写证书 Secret 引用。'));
  if (isBlank(config.authKeySecretRef)) issues.push(fieldIssue(node, 'authKeySecretRef', `${node.label ?? node.id} 的客户端私钥不能为空。`, '填写私钥 Secret 引用。'));
}

function buildHttpRequestAuth(config: Record<string, unknown>): WorkflowHttpRequest['auth'] | undefined {
  const authType = readHttpAuthType(config.authType) ?? 'none';
  if (authType === 'none') return { type: 'none' };
  if (authType === 'basic') {
    const credential = readCredentialValue(config.authCredential);
    if (!credential || isBlank(config.authUsername)) return undefined;
    return { type: 'basic', username: String(config.authUsername), credential };
  }
  if (authType === 'bearer') {
    const credential = readCredentialValue(config.authCredential);
    return credential ? { type: 'bearer', credential } : undefined;
  }
  if (authType === 'api_key') {
    const credential = readCredentialValue(config.authCredential);
    if (!credential || isBlank(config.authApiKeyName)) return undefined;
    return { type: 'api_key', credential, name: String(config.authApiKeyName), in: String(config.authApiKeyIn ?? 'header') === 'query' ? 'query' : 'header' };
  }
  if (authType === 'cookie') {
    if (isBlank(config.authSecretValue)) return undefined;
    return { type: 'cookie', secretRef: String(config.authSecretValue), ...(isBlank(config.authCookieName) ? {} : { name: String(config.authCookieName) }) };
  }
  if (authType === 'custom_header') {
    if (isBlank(config.authSecretValue) || isBlank(config.authHeaderName)) return undefined;
    return { type: 'custom_header', secretRef: String(config.authSecretValue), headerName: String(config.authHeaderName) };
  }
  if (isBlank(config.authCertSecretRef) || isBlank(config.authKeySecretRef)) return undefined;
  return { type: 'mtls', certSecretRef: String(config.authCertSecretRef), keySecretRef: String(config.authKeySecretRef) };
}

function resolveRollbackSteps(canvas: WorkflowCanvasDefinition): WorkflowStep[] {
  const imported = canvas.draftState?.importedRollback;
  if (Array.isArray(imported) && imported.length > 0) return cloneRecord(imported) as WorkflowStep[];
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
  const rollbackTargets = new Set(edges.filter((edge) => edge.edgeType === 'rollback').map((edge) => edge.targetNodeId));
  const steps = nodes.filter((node) => rollbackTargets.has(node.id)).map((node, index) => nodeToDslStep(node, index));
  return steps.length ? steps : [{ name: 'manual_rollback', type: 'manual', instruction: '回滚到上一个稳定证书版本' }];
}

function getExecutableDslNodes(canvas: WorkflowCanvasDefinition): CanvasNode[] {
  const normalized = normalizeWorkflowCanvasFlow(canvas);
  return sortNodesByStage(normalized.nodes ?? []).filter((node) => !isRollbackOnlyNode(normalized, node.id));
}

function isRollbackOnlyNode(canvas: WorkflowCanvasDefinition, nodeId: string): boolean {
  return (canvas.edges ?? []).some((edge) => edge.edgeType === 'rollback' && edge.targetNodeId === nodeId);
}

function normalizeWorkflowCanvasFlow(canvas: WorkflowCanvasDefinition): WorkflowCanvasDefinition {
  return {
    ...canvas,
    nodes: sortNodesByStage((canvas.nodes ?? []).map((node) => ({ ...node, ui: { ...(node.ui ?? {}), stage: getNodeStage(node) } }))),
  };
}

function sortNodesByStage(nodes: readonly CanvasNode[]): CanvasNode[] {
  const stageOrder = new Map(workflowStages.map((stage, index) => [stage, index]));
  return [...nodes].sort((left, right) => {
    const stageDelta = (stageOrder.get(getNodeStage(left)) ?? 0) - (stageOrder.get(getNodeStage(right)) ?? 0);
    return stageDelta || positionSort(left, right);
  });
}

function hasCycle(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const next = (nodeId: string): string[] => edges.filter((edge) => edge.sourceNodeId === nodeId && edge.edgeType !== 'rollback').map((edge) => edge.targetNodeId);
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const target of next(nodeId)) {
      if (visit(target)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

function buildDslStepName(node: CanvasNode, index: number): string {
  const imported = readImportedStep(node);
  if (imported?.name && node.label === imported.name) return normalizeIdentifier(imported.name);
  return normalizeIdentifier(`${node.type}_${index + 1}_${node.label ?? node.id}`);
}

function mergeImportedDslStep(node: CanvasNode, generated: WorkflowStep): WorkflowStep {
  const imported = readImportedStep(node);
  if (!imported || imported.type !== generated.type) return generated;
  if (generated.type === 'http' && imported.type === 'http') return { ...imported, ...generated, request: { ...imported.request, ...generated.request }, retry: generated.retry ?? imported.retry, extract: imported.extract ?? generated.extract, assert: imported.assert ?? generated.assert };
  if (generated.type === 'ssh' && imported.type === 'ssh') return { ...imported, ...generated, ssh: { ...imported.ssh, ...generated.ssh }, retry: generated.retry ?? imported.retry, extract: imported.extract ?? generated.extract, assert: imported.assert ?? generated.assert };
  if (generated.type === 'sftp' && imported.type === 'sftp') return { ...imported, ...generated, sftp: { ...imported.sftp, ...generated.sftp }, retry: generated.retry ?? imported.retry, extract: imported.extract ?? generated.extract, assert: imported.assert ?? generated.assert };
  if (generated.type === 'scp' && imported.type === 'scp') return { ...imported, ...generated, scp: { ...imported.scp, ...generated.scp }, retry: generated.retry ?? imported.retry, extract: imported.extract ?? generated.extract, assert: imported.assert ?? generated.assert };
  if (generated.type === 'condition' && imported.type === 'condition') return { ...imported, ...generated, condition: { ...imported.condition, ...generated.condition } };
  if (generated.type === 'transform' && imported.type === 'transform') return { ...imported, ...generated, transform: { ...imported.transform, ...generated.transform, outputs: { ...imported.transform.outputs, ...generated.transform.outputs } } };
  return { ...imported, ...generated };
}

function readImportedStep(node: CanvasNode): WorkflowStep | null {
  const value = node.ui?.rawStep;
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || !isWorkflowStepType(value.type)) return null;
  return cloneRecord(value) as unknown as WorkflowStep;
}

function isWorkflowStepType(value: unknown): value is WorkflowStepType {
  return typeof value === 'string' && workflowStepTypes.includes(value as WorkflowStepType);
}

function buildDslCondition(config: Record<string, unknown>) {
  const variable = String(config.variable ?? '').trim() || 'deviceHost';
  const operator = String(config.operator ?? 'exists');
  if (operator === 'equals') return { variable, equals: parseConditionValue(config.expected) };
  if (operator === 'notEquals') return { variable, notEquals: parseConditionValue(config.expected) };
  if (operator === 'notExists') return { variable, exists: false };
  return { variable, exists: true };
}

function parseConditionValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

function getNodeStage(node: CanvasNode): WorkflowStage {
  const stage = String(node.ui?.stage ?? '');
  return workflowStages.includes(stage as WorkflowStage) ? stage as WorkflowStage : defaultStageForType(node.type);
}

function defaultStageForType(type: CanvasNodeType): WorkflowStage {
  if (type === 'http' || type === 'condition') return 'prepare';
  if (type === 'checkpoint') return 'backup';
  if (type === 'transform' || type === 'foreach') return 'refresh';
  if (type === 'sftp' || type === 'scp') return 'install';
  if (type === 'ssh' || type === 'wait') return 'refresh';
  if (type === 'plugin.action') return 'install';
  if (type === 'verify') return 'verify';
  return 'backup';
}

function readHttpAuthType(value: unknown): CanvasHttpAuthType | null {
  const authType = String(value ?? 'none');
  return ['none', 'basic', 'bearer', 'api_key', 'cookie', 'custom_header', 'mtls'].includes(authType)
    ? authType as CanvasHttpAuthType
    : null;
}

function isCredentialValue(value: unknown): value is string {
  return typeof value === 'string' && /^\{\{credentials\.[A-Za-z][A-Za-z0-9_.-]*\}\}$/.test(value.trim());
}

function readCredentialValue(value: unknown): string | undefined {
  if (!isCredentialValue(value)) return undefined;
  return value.trim();
}

function readHostKeyPolicy(value: unknown): 'strict' | 'trust_on_first_use' | 'manual_approval_required' {
  const policy = String(value ?? 'trust_on_first_use');
  if (policy === 'strict' || policy === 'manual_approval_required') return policy;
  return 'trust_on_first_use';
}

function normalizeTransferDirection(value: unknown): 'upload' | 'download' {
  return String(value ?? 'upload').toLowerCase() === 'download' ? 'download' : 'upload';
}

function readHttpMethod(value: unknown): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  const method = String(value ?? 'GET').toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' : 'GET';
}

function canvasIssue(id: string, severity: 'error' | 'warning' | 'risk', message: string, suggestion: string): WorkflowCanvasValidationIssue {
  return { id, severity, message, targetType: 'canvas', suggestion };
}

function fieldIssue(node: CanvasNode, field: string, message: string, suggestion: string): WorkflowCanvasValidationIssue {
  return { id: `${node.id}:${field}`, severity: 'error', message, targetType: 'field', nodeId: node.id, field, suggestion };
}

function edgeIssue(edgeId: string, message: string, suggestion: string): WorkflowCanvasValidationIssue {
  return { id: edgeId, severity: 'error', message, targetType: 'edge', edgeId, suggestion };
}

function containsPlainSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.includes('{{') || isSecretRef(value)) return false;
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*[^{}\s]+|token\s*[:=]\s*[^{}\s]+|api[_-]?key\s*[:=]\s*[^{}\s]+/i.test(value);
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseLooseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function readForeachSteps(value: unknown): WorkflowStep[] {
  const parsed = typeof value === 'string' ? parseLooseJson(value) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'foreach 子步骤必须是非空 JSON 数组');
  }
  return parsed as WorkflowStep[];
}

function normalizeIdentifier(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const normalized = cleaned || 'workflow_canvas_draft';
  return /^[a-zA-Z]/.test(normalized) ? normalized : `workflow_${normalized}`;
}

function positionSort(left: CanvasNode, right: CanvasNode): number {
  return Number(left.position?.x ?? 0) - Number(right.position?.x ?? 0)
    || Number(left.position?.y ?? 0) - Number(right.position?.y ?? 0)
    || left.id.localeCompare(right.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
