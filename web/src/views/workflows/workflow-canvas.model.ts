import {
  isWorkflowCredentialBinding,
  workflowCredentialBinding,
  type WorkflowCredentialBinding,
  type WorkflowManagedCredential,
} from './workflow-credentials'

export type WorkflowCanvasNodeType = 'http' | 'ssh' | 'sftp' | 'scp' | 'verify' | 'condition' | 'wait' | 'manual'
export type WorkflowCanvasEdgeType = 'success' | 'failure' | 'always' | 'rollback'
export type WorkflowCanvasFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'secret'
export type WorkflowValidationSeverity = 'error' | 'warning' | 'risk'
export type WorkflowCanvasStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify'
export type WorkflowCanvasHttpAuthType = 'none' | 'basic' | 'bearer' | 'api_key' | 'cookie' | 'custom_header' | 'mtls'
export type WorkflowDslCredentialValue = WorkflowCredentialBinding | string

export interface WorkflowCanvasPosition {
  readonly x: number
  readonly y: number
}

export interface WorkflowCanvasNode {
  readonly id: string
  readonly type: WorkflowCanvasNodeType
  readonly position: WorkflowCanvasPosition
  readonly label: string
  readonly config: Record<string, unknown>
  readonly ui?: Record<string, unknown>
}

export interface WorkflowCanvasEdge {
  readonly id: string
  readonly sourceNodeId: string
  readonly sourcePort: WorkflowCanvasEdgeType
  readonly targetNodeId: string
  readonly targetPort: 'input'
  readonly edgeType: WorkflowCanvasEdgeType
  readonly condition?: Record<string, unknown>
}

export interface WorkflowCanvasDefinition {
  readonly schemaVersion: 'gcac.workflow.canvas/v1'
  readonly dslVersion: 'gcac.workflow/v1'
  readonly metadata: {
    readonly name: string
    readonly displayName?: string
    readonly category?: string
    readonly tags?: readonly string[]
  }
  readonly variables: Record<string, WorkflowVariableDefinition>
  readonly nodes: readonly WorkflowCanvasNode[]
  readonly edges: readonly WorkflowCanvasEdge[]
  readonly viewport: {
    readonly x: number
    readonly y: number
    readonly zoom: number
  }
  readonly draftState?: Record<string, unknown>
}

export interface WorkflowVariableDefinition {
  readonly type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'file' | 'credential' | 'certificate'
  readonly required?: boolean
  readonly default?: unknown
  readonly enum?: readonly unknown[]
  readonly sensitive?: boolean
  readonly description?: string
}

export interface WorkflowNodeFieldDefinition {
  readonly key: string
  readonly label: string
  readonly kind: WorkflowCanvasFieldKind
  readonly required?: boolean
  readonly options?: readonly { readonly label: string; readonly value: string }[]
}

export interface WorkflowNodeTypeDefinition {
  readonly type: WorkflowCanvasNodeType
  readonly displayName: string
  readonly category: 'http' | 'ssh' | 'file' | 'verify' | 'control' | 'manual'
  readonly description: string
  readonly inputPorts: readonly ['input']
  readonly outputPorts: readonly WorkflowCanvasEdgeType[]
  readonly fields: readonly WorkflowNodeFieldDefinition[]
  readonly produces: readonly { readonly name: string; readonly type: string; readonly sensitive?: boolean }[]
}

export interface WorkflowStageDefinition {
  readonly key: WorkflowCanvasStage
  readonly title: string
  readonly description: string
}

export interface WorkflowValidationIssue {
  readonly id: string
  readonly severity: WorkflowValidationSeverity
  readonly message: string
  readonly targetType: 'canvas' | 'node' | 'edge' | 'field'
  readonly nodeId?: string
  readonly edgeId?: string
  readonly field?: string
  readonly suggestion: string
}

export interface WorkflowDslV1 {
  readonly apiVersion: 'gcac.workflow/v1'
  readonly kind: 'CurlSshWorkflow'
  readonly metadata: WorkflowCanvasDefinition['metadata']
  readonly variables: Record<string, WorkflowVariableDefinition>
  readonly steps: readonly WorkflowDslStep[]
  readonly rollback?: readonly WorkflowDslStep[]
}

export type WorkflowDslStep =
  | {
      readonly name: string
      readonly type: 'http'
      readonly stage?: WorkflowCanvasStage
      readonly request: {
        readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
        readonly url: string
        readonly headers?: Record<string, string>
        readonly auth?:
          | { readonly type: 'none' }
          | { readonly type: 'basic'; readonly username: string; readonly credential: WorkflowDslCredentialValue }
          | { readonly type: 'bearer'; readonly credential: WorkflowDslCredentialValue }
          | { readonly type: 'api_key'; readonly credential: WorkflowDslCredentialValue; readonly in?: 'header' | 'query'; readonly name: string }
          | { readonly type: 'cookie'; readonly secretRef: string; readonly name?: string }
          | { readonly type: 'custom_header'; readonly secretRef: string; readonly headerName: string }
          | { readonly type: 'mtls'; readonly certSecretRef: string; readonly keySecretRef: string }
        readonly body?: unknown
        readonly timeoutSeconds?: number
      }
      readonly retry?: { readonly count?: number; readonly intervalSeconds?: number }
      readonly extract?: readonly WorkflowDslExtractor[]
      readonly assert?: readonly WorkflowDslAssertion[]
    }
  | {
      readonly name: string
      readonly type: 'ssh'
      readonly stage?: WorkflowCanvasStage
      readonly ssh: {
        readonly mode: 'command' | 'script' | 'interactive'
        readonly connection: {
          readonly host: string
          readonly username: string
          readonly credential: WorkflowDslCredentialValue
          readonly expectedHostKeyFingerprint?: string
          readonly hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required'
        }
        readonly command?: string
        readonly commands?: readonly string[]
        readonly script?: string
        readonly timeoutSeconds?: number
      }
      readonly retry?: { readonly count?: number; readonly intervalSeconds?: number }
      readonly extract?: readonly WorkflowDslExtractor[]
      readonly assert?: readonly WorkflowDslAssertion[]
    }
  | {
      readonly name: string
      readonly type: 'sftp'
      readonly stage?: WorkflowCanvasStage
      readonly sftp: WorkflowDslFileTransferConfig
      readonly retry?: { readonly count?: number; readonly intervalSeconds?: number }
      readonly extract?: readonly WorkflowDslExtractor[]
      readonly assert?: readonly WorkflowDslAssertion[]
    }
  | {
      readonly name: string
      readonly type: 'scp'
      readonly stage?: WorkflowCanvasStage
      readonly scp: WorkflowDslFileTransferConfig
      readonly retry?: { readonly count?: number; readonly intervalSeconds?: number }
      readonly extract?: readonly WorkflowDslExtractor[]
      readonly assert?: readonly WorkflowDslAssertion[]
    }
  | {
      readonly name: string
      readonly type: 'condition'
      readonly stage?: WorkflowCanvasStage
      readonly condition: WorkflowDslCondition
      readonly description?: string
    }
  | { readonly name: string; readonly type: 'wait'; readonly stage?: WorkflowCanvasStage; readonly seconds: number }
  | { readonly name: string; readonly type: 'manual'; readonly stage?: WorkflowCanvasStage; readonly instruction: string }

export interface WorkflowDslFileTransferConfig {
  readonly direction: 'upload' | 'download'
  readonly connection: {
    readonly host: string
    readonly username: string
    readonly credential: WorkflowDslCredentialValue
    readonly expectedHostKeyFingerprint?: string
    readonly hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required'
  }
  readonly remotePath: string
  readonly contentRef?: string
  readonly contentEncoding?: 'utf8' | 'base64'
  readonly localPath?: string
  readonly temporaryPath?: string
  readonly expectedHash?: string
  readonly expectedSize?: number
  readonly verifyHash?: boolean
  readonly mode?: string
  readonly owner?: string
  readonly group?: string
  readonly timeoutSeconds?: number
}

export interface WorkflowDslCondition {
  readonly variable: string
  readonly equals?: unknown
  readonly notEquals?: unknown
  readonly exists?: boolean
}

export interface WorkflowDslExtractor {
  readonly name: string
  readonly type: 'jsonPath' | 'outputPath' | 'firstOf' | 'header' | 'regex' | 'statusCode' | 'textContains'
  readonly path?: string
  readonly paths?: readonly string[]
  readonly header?: string
  readonly pattern?: string
  readonly value?: string
  readonly optional?: boolean
  readonly sensitive?: boolean
}

export type WorkflowDslAssertion =
  | { readonly type: 'statusCode'; readonly equals: number }
  | { readonly type: 'jsonPath'; readonly path: string; readonly equals: unknown }
  | { readonly type: 'contains'; readonly value: string }
  | { readonly type: 'regex'; readonly pattern: string }
  | { readonly type: 'certificateFingerprint'; readonly actual: string; readonly expected: string }

type WorkflowHttpRequestAuth = NonNullable<Extract<WorkflowDslStep, { type: 'http' }>['request']['auth']>

export const NODE_TYPE_DEFINITIONS: readonly WorkflowNodeTypeDefinition[] = [
  {
    type: 'http',
    displayName: 'HTTP/CURL',
    category: 'http',
    description: '调用结构化 HTTP 接口，替代散落的 curl 字符串。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'method', label: 'Method', kind: 'select', required: true, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ label: value, value })) },
      { key: 'url', label: 'URL', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea' },
      { key: 'timeoutSeconds', label: '超时秒数', kind: 'number', required: true },
    ],
    produces: [
      { name: 'statusCode', type: 'number' },
      { name: 'body', type: 'object' },
      { name: 'extracted', type: 'object' },
    ],
  },
  {
    type: 'ssh',
    displayName: 'SSH 命令',
    category: 'ssh',
    description: '声明要执行的 SSH 命令，只保存连接和凭据引用。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'hostRef', label: '主机变量', kind: 'text', required: true },
      { key: 'username', label: '用户名变量', kind: 'text', required: true },
      { key: 'credential', label: '凭据', kind: 'text', required: true },
      { key: 'hostKeyPolicy', label: 'Host Key 策略', kind: 'select', required: true, options: [
        { label: '首次信任', value: 'trust_on_first_use' },
        { label: '严格校验', value: 'strict' },
        { label: '人工审批', value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: 'Host Key 指纹', kind: 'text' },
      { key: 'command', label: '命令', kind: 'textarea', required: true },
      { key: 'timeoutSeconds', label: '超时秒数', kind: 'number', required: true },
    ],
    produces: [
      { name: 'exitCode', type: 'number' },
      { name: 'stdout', type: 'string' },
      { name: 'stderr', type: 'string' },
    ],
  },
  {
    type: 'sftp',
    displayName: 'SFTP 上传/下载',
    category: 'file',
    description: '通过正式 SFTP step 上传或下载文件，适合证书与配置安装。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'direction', label: '方向', kind: 'select', required: true, options: [{ label: '上传', value: 'upload' }, { label: '下载', value: 'download' }] },
      { key: 'connectionRef', label: '连接变量', kind: 'text', required: true },
      { key: 'credential', label: '凭据', kind: 'text', required: true },
      { key: 'remotePath', label: '远端路径', kind: 'text', required: true },
      { key: 'temporaryPath', label: '临时路径', kind: 'text' },
      { key: 'username', label: '用户名变量', kind: 'text', required: true },
      { key: 'hostKeyPolicy', label: 'Host Key 策略', kind: 'select', required: true, options: [
        { label: '首次信任', value: 'trust_on_first_use' },
        { label: '严格校验', value: 'strict' },
        { label: '人工审批', value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: 'Host Key 指纹', kind: 'text' },
      { key: 'contentRef', label: '内容变量', kind: 'text' },
      { key: 'localPath', label: '本地路径', kind: 'text' },
      { key: 'mode', label: '文件权限', kind: 'text' },
      { key: 'timeoutSeconds', label: '超时秒数', kind: 'number', required: true },
    ],
    produces: [
      { name: 'remotePath', type: 'string' },
      { name: 'hash', type: 'string' },
      { name: 'backupRef', type: 'string' },
    ],
  },
  {
    type: 'scp',
    displayName: 'SCP 上传/下载',
    category: 'file',
    description: '通过正式 SCP step 上传或下载文件，作为 SFTP 不可用时的显式传输方案。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'direction', label: '方向', kind: 'select', required: true, options: [{ label: '上传', value: 'upload' }, { label: '下载', value: 'download' }] },
      { key: 'connectionRef', label: '连接变量', kind: 'text', required: true },
      { key: 'username', label: '用户名变量', kind: 'text', required: true },
      { key: 'credential', label: '凭据', kind: 'text', required: true },
      { key: 'remotePath', label: '远端路径', kind: 'text', required: true },
      { key: 'temporaryPath', label: '临时路径', kind: 'text' },
      { key: 'hostKeyPolicy', label: 'Host Key 策略', kind: 'select', required: true, options: [
        { label: '首次信任', value: 'trust_on_first_use' },
        { label: '严格校验', value: 'strict' },
        { label: '人工审批', value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: 'Host Key 指纹', kind: 'text' },
      { key: 'contentRef', label: '内容变量', kind: 'text' },
      { key: 'localPath', label: '本地路径', kind: 'text' },
      { key: 'mode', label: '文件权限', kind: 'text' },
      { key: 'timeoutSeconds', label: '超时秒数', kind: 'number', required: true },
    ],
    produces: [
      { name: 'remotePath', type: 'string' },
      { name: 'hash', type: 'string' },
      { name: 'backupRef', type: 'string' },
    ],
  },
  {
    type: 'verify',
    displayName: '验证',
    category: 'verify',
    description: '验证 HTTP 状态、文本、JSONPath、正则或证书指纹。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'verifyType', label: '验证类型', kind: 'select', required: true, options: [
        { label: 'HTTP 状态', value: 'httpStatus' },
        { label: '文本包含', value: 'text' },
        { label: 'JSONPath', value: 'jsonPath' },
        { label: '正则', value: 'regex' },
        { label: '证书指纹', value: 'certificateFingerprint' },
      ] },
      { key: 'inputRef', label: '输入引用', kind: 'text', required: true },
      { key: 'expected', label: '期望值', kind: 'text', required: true },
      { key: 'timeoutSeconds', label: '超时秒数', kind: 'number', required: true },
    ],
    produces: [
      { name: 'passed', type: 'boolean' },
      { name: 'evidence', type: 'string' },
    ],
  },
  {
    type: 'condition',
    displayName: '分支判断',
    category: 'control',
    description: '按变量、状态码或上游输出判断是否继续执行。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'variable', label: '判断变量', kind: 'text', required: true },
      { key: 'operator', label: '判断方式', kind: 'select', required: true, options: [
        { label: '等于', value: 'equals' },
        { label: '不等于', value: 'notEquals' },
        { label: '存在', value: 'exists' },
        { label: '不存在', value: 'notExists' },
      ] },
      { key: 'expected', label: '期望值', kind: 'text' },
      { key: 'description', label: '说明', kind: 'textarea' },
    ],
    produces: [{ name: 'passed', type: 'boolean' }],
  },
  {
    type: 'wait',
    displayName: '等待',
    category: 'control',
    description: '等待固定时间，不访问外部系统。',
    inputPorts: ['input'],
    outputPorts: ['success'],
    fields: [{ key: 'seconds', label: '等待秒数', kind: 'number', required: true }],
    produces: [],
  },
  {
    type: 'manual',
    displayName: '人工确认',
    category: 'manual',
    description: '插入人工确认点或回滚提示。',
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [{ key: 'instruction', label: '确认说明', kind: 'textarea', required: true }],
    produces: [],
  },
]

export const WORKFLOW_STAGE_DEFINITIONS: readonly WorkflowStageDefinition[] = [
  { key: 'prepare', title: '准备', description: '完成认证登录、凭据获取和前置上下文准备' },
  { key: 'backup', title: '备份', description: '保存变更前状态和回滚材料' },
  { key: 'install', title: '安装', description: '上传、写入或替换证书材料' },
  { key: 'refresh', title: '刷新', description: '重载服务、刷新缓存或触发生效' },
  { key: 'verify', title: '验证', description: '检查状态、连通性和证书结果' },
]

export const WORKFLOW_FLOW_LAYOUT = {
  surfaceWidth: 900,
  nodeX: 340,
  nodeWidth: 220,
  nodeHeight: 92,
  top: 72,
  stageHeaderHeight: 58,
  nodeGap: 132,
  stageGap: 56,
} as const

export function createDefaultWorkflowCanvas(name = 'workflow-canvas-draft'): WorkflowCanvasDefinition {
  const nodes: WorkflowCanvasNode[] = [
    createCanvasNode('http', 0, undefined, 'prepare'),
    {
      ...createCanvasNode('ssh', 1, undefined, 'backup'),
      label: '备份现有证书',
      config: {
        ...createDefaultConfig('ssh'),
        command: [
          'mkdir -p {{certificatePaths.backupDir}}',
          'cp -f {{certificatePaths.certPath}} {{certificatePaths.backupCertPath}}',
          'cp -f {{certificatePaths.keyPath}} {{certificatePaths.backupKeyPath}}',
        ].join('\n'),
      },
    },
    createCanvasNode('sftp', 2, undefined, 'install'),
    createCanvasNode('scp', 3, undefined, 'install'),
    {
      ...createCanvasNode('ssh', 4, undefined, 'refresh'),
      label: '重载服务',
      config: {
        ...createDefaultConfig('ssh'),
        command: 'nginx -t\nsystemctl reload nginx',
      },
    },
    createCanvasNode('verify', 5, undefined, 'verify'),
  ]
  return normalizeWorkflowCanvasFlow({
    schemaVersion: 'gcac.workflow.canvas/v1',
    dslVersion: 'gcac.workflow/v1',
    metadata: {
      name: normalizeIdentifier(name),
      displayName: `${name} 工作流`,
      category: 'deployment',
      tags: ['ssl', 'workflow'],
    },
    variables: {
      deviceHost: { type: 'string', required: true, description: '目标主机' },
      sshUsername: { type: 'string', required: true, description: 'SSH 用户名' },
      credential: { type: 'credential', required: true, sensitive: true, description: '连接凭据' },
      certificate: { type: 'certificate', required: true, sensitive: true, description: '证书材料' },
      certificatePaths: {
        type: 'object',
        required: true,
        default: {
          certPath: '/etc/ssl/certs/site.pem',
          keyPath: '/etc/ssl/private/site.key',
          tempCertPath: '/tmp/gcac-certs/site.pem',
          tempKeyPath: '/tmp/gcac-certs/site.key',
          backupDir: '/var/backups/gcac-certs',
          backupCertPath: '/var/backups/gcac-certs/site.pem.bak',
          backupKeyPath: '/var/backups/gcac-certs/site.key.bak',
        },
        description: '证书部署、临时写入和备份路径',
      },
      verifyUrl: { type: 'string', required: true, description: '验证 URL' },
    },
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
}

export function createEmptyWorkflowCanvas(name = 'workflow-canvas-draft'): WorkflowCanvasDefinition {
  return {
    ...createDefaultWorkflowCanvas(name),
    nodes: [],
    edges: [],
  }
}

export function createCanvasNode(type: WorkflowCanvasNodeType, index: number, position?: WorkflowCanvasPosition, stage?: WorkflowCanvasStage): WorkflowCanvasNode {
  const definition = getNodeTypeDefinition(type)
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}_${index}`,
    type,
    position: position ?? { x: 80 + index * 260, y: 120 + (index % 2) * 130 },
    label: definition.displayName,
    config: createDefaultConfig(type),
    ui: { stage: stage ?? defaultStageForType(type) },
  }
}

export function createCanvasEdge(sourceNodeId: string, targetNodeId: string, edgeType: WorkflowCanvasEdgeType = 'success'): WorkflowCanvasEdge {
  return {
    id: `edge_${sourceNodeId}_${targetNodeId}_${edgeType}`,
    sourceNodeId,
    sourcePort: edgeType,
    targetNodeId,
    targetPort: 'input',
    edgeType,
  }
}

export function getNodeTypeDefinition(type: WorkflowCanvasNodeType): WorkflowNodeTypeDefinition {
  const definition = NODE_TYPE_DEFINITIONS.find((item) => item.type === type)
  if (!definition) throw new Error(`未知节点类型：${type}`)
  return definition
}

export function createDefaultConfig(type: WorkflowCanvasNodeType): Record<string, unknown> {
  if (type === 'http') return { method: 'GET', url: '{{verifyUrl}}', authType: 'none', authCredential: '', authUsername: '', authApiKeyName: 'X-API-Key', authApiKeyIn: 'header', authHeaderName: 'X-Custom-Auth', authCookieName: '', authSecretValue: '', authCertSecretRef: '', authKeySecretRef: '', authCredentialId: '', body: '', timeoutSeconds: 30 }
  if (type === 'ssh') return { hostRef: '{{deviceHost}}', username: '{{sshUsername}}', credential: '{{credential}}', hostKeyPolicy: 'trust_on_first_use', expectedHostKeyFingerprint: '', command: 'systemctl reload nginx', timeoutSeconds: 60 }
  if (type === 'sftp') return createDefaultFileTransferConfig('{{certificate.pem}}', '{{certificatePaths.certPath}}', '{{certificatePaths.tempCertPath}}', '0644')
  if (type === 'scp') return createDefaultFileTransferConfig('{{certificate.privateKey}}', '{{certificatePaths.keyPath}}', '{{certificatePaths.tempKeyPath}}', '0600')
  if (type === 'verify') return { verifyType: 'httpStatus', inputRef: '{{verifyUrl}}', expected: '200', timeoutSeconds: 30 }
  if (type === 'condition') return { variable: 'deviceHost', operator: 'exists', expected: '', description: '目标变量存在时继续执行' }
  if (type === 'wait') return { seconds: 10 }
  return { instruction: '请确认目标设备证书已切换到新版本。' }
}

export function validateWorkflowCanvas(canvas: WorkflowCanvasDefinition): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const nodeIds = new Set(canvas.nodes.map((node) => node.id))
  if (canvas.nodes.length === 0) {
    issues.push(canvasIssue('empty-canvas', 'error', '画布至少需要一个执行节点。', '添加 HTTP、SSH、SFTP 或验证节点。'))
  }

  for (const node of canvas.nodes) {
    const definition = getNodeTypeDefinition(node.type)
    for (const field of definition.fields) {
      const value = node.config[field.key]
      if (field.required && isBlank(value)) {
        issues.push(fieldIssue(node, field.key, `${node.label} 缺少 ${field.label}。`, `在属性面板补全 ${field.label}。`))
      }
      if (field.kind === 'secret' && !isBlank(value) && containsPlainSecret(String(value))) {
        issues.push(fieldIssue(node, field.key, `${node.label} 的 ${field.label} 疑似包含明文密钥。`, '改为选择已保存凭据或使用密文输入。'))
      }
    }
    for (const [key, value] of Object.entries(node.config)) {
      if (containsPlainSecret(value)) {
        issues.push(fieldIssue(node, key, `${node.label} 的 ${key} 疑似包含明文密钥。`, '改为选择已保存凭据、密文输入或变量表达式。'))
      }
    }
    if (node.type === 'http') validateHttpNodeConfig(node, issues)
    const timeout = node.config.timeoutSeconds ?? node.config.seconds
    if (['http', 'ssh', 'sftp', 'scp', 'verify'].includes(node.type) && (!Number.isInteger(Number(timeout)) || Number(timeout) <= 0)) {
      issues.push(fieldIssue(node, 'timeoutSeconds', `${node.label} 必须声明正整数超时。`, '为外部动作设置明确 timeoutSeconds。'))
    }
  }

  for (const edge of canvas.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      issues.push(edgeIssue(edge.id, '连线引用了不存在的节点。', '删除这条连线或重新连接有效节点。'))
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push(edgeIssue(edge.id, '节点不能连接到自己。', '选择另一个目标节点。'))
    }
  }

  if (hasCycle(canvas)) {
    issues.push(canvasIssue('graph-cycle', 'error', '画布存在循环依赖。', '删除导致回到上游节点的连线。'))
  }

  const requiredTypes: WorkflowCanvasNodeType[] = ['http', 'ssh', 'sftp', 'verify']
  for (const type of requiredTypes) {
    if (!canvas.nodes.some((node) => node.type === type)) {
      issues.push(canvasIssue(`missing-${type}`, 'warning', `草稿缺少 ${getNodeTypeDefinition(type).displayName} 节点。`, '验收草稿建议包含 HTTP、SSH、SFTP 和验证节点。'))
    }
  }

  return issues
}

export function workflowCanvasToDsl(canvas: WorkflowCanvasDefinition): WorkflowDslV1 {
  const normalized = normalizeWorkflowCanvasFlow(canvas)
  const orderedNodes = getExecutableDslNodes(normalized)
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: {
      name: normalizeIdentifier(canvas.metadata.name),
      displayName: canvas.metadata.displayName,
      category: canvas.metadata.category,
      tags: [...(canvas.metadata.tags ?? [])],
    },
    variables: cloneRecord(canvas.variables),
    steps: orderedNodes.map((node, index) => nodeToDslStep(node, index)),
    rollback: resolveRollbackSteps(normalized),
  }
}

export function getWorkflowDslStepName(canvas: WorkflowCanvasDefinition, nodeId: string): string {
  const orderedNodes = getExecutableDslNodes(canvas)
  const index = orderedNodes.findIndex((node) => node.id === nodeId)
  if (index < 0) throw new Error(`节点不存在：${nodeId}`)
  return buildDslStepName(orderedNodes[index]!, index)
}

export function workflowDslToCanvas(dsl: WorkflowDslV1): WorkflowCanvasDefinition {
  const nodes = dsl.steps.map((step, index) => dslStepToNode(step, index))
  return normalizeWorkflowCanvasFlow({
    schemaVersion: 'gcac.workflow.canvas/v1',
    dslVersion: 'gcac.workflow/v1',
    metadata: dsl.metadata,
    variables: cloneRecord(dsl.variables),
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    draftState: {
      importedRollback: cloneRecord(dsl.rollback ?? []),
    },
  })
}

export function isWorkflowDslV1(value: unknown): value is WorkflowDslV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.apiVersion !== 'gcac.workflow/v1' || record.kind !== 'CurlSshWorkflow') return false
  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) return false
  if (!record.variables || typeof record.variables !== 'object' || Array.isArray(record.variables)) return false
  if (!Array.isArray(record.steps) || record.steps.length === 0) return false
  if (record.rollback !== undefined && !Array.isArray(record.rollback)) return false
  return true
}

export function cloneCanvas(canvas: WorkflowCanvasDefinition): WorkflowCanvasDefinition {
  return JSON.parse(JSON.stringify(canvas)) as WorkflowCanvasDefinition
}

export function setNodeConfigValue(canvas: WorkflowCanvasDefinition, nodeId: string, key: string, value: unknown): WorkflowCanvasDefinition {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => node.id === nodeId ? { ...node, config: { ...node.config, [key]: value } } : node),
  }
}

export function getNodeStage(node: WorkflowCanvasNode): WorkflowCanvasStage {
  const stage = String(node.ui?.stage ?? '')
  return isWorkflowStage(stage) ? stage : defaultStageForType(node.type)
}

export function setNodeStage(canvas: WorkflowCanvasDefinition, nodeId: string, stage: WorkflowCanvasStage): WorkflowCanvasDefinition {
  return normalizeWorkflowCanvasFlow({
    ...canvas,
    nodes: canvas.nodes.map((node) => node.id === nodeId ? { ...node, ui: { ...(node.ui ?? {}), stage } } : node),
  })
}

export function setNodeLabel(canvas: WorkflowCanvasDefinition, nodeId: string, label: string): WorkflowCanvasDefinition {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => node.id === nodeId ? { ...node, label } : node),
  }
}

export function upsertWorkflowVariable(canvas: WorkflowCanvasDefinition, name: string, definition: WorkflowVariableDefinition): WorkflowCanvasDefinition {
  const normalized = normalizeVariableName(name)
  if (!normalized) return canvas
  return {
    ...canvas,
    variables: {
      ...canvas.variables,
      [normalized]: sanitizeVariableDefinition(definition),
    },
  }
}

export function renameWorkflowVariable(canvas: WorkflowCanvasDefinition, oldName: string, newName: string): WorkflowCanvasDefinition {
  const normalized = normalizeVariableName(newName)
  if (!canvas.variables[oldName] || !normalized || normalized === oldName) return canvas
  const entries = Object.entries(canvas.variables).map(([name, definition]) => name === oldName ? [normalized, definition] as const : [name, definition] as const)
  return { ...canvas, variables: Object.fromEntries(entries) }
}

export function removeWorkflowVariable(canvas: WorkflowCanvasDefinition, name: string): WorkflowCanvasDefinition {
  if (!canvas.variables[name]) return canvas
  return { ...canvas, variables: Object.fromEntries(Object.entries(canvas.variables).filter(([key]) => key !== name)) }
}

export function autoLayoutCanvas(canvas: WorkflowCanvasDefinition): WorkflowCanvasDefinition {
  return normalizeWorkflowCanvasFlow(canvas)
}

export function addNode(canvas: WorkflowCanvasDefinition, type: WorkflowCanvasNodeType, stage: WorkflowCanvasStage = defaultStageForType(type)): WorkflowCanvasDefinition {
  const node = createCanvasNode(type, canvas.nodes.length, undefined, stage)
  return normalizeWorkflowCanvasFlow({ ...canvas, nodes: [...canvas.nodes, node] })
}

export function removeNode(canvas: WorkflowCanvasDefinition, nodeId: string): WorkflowCanvasDefinition {
  return normalizeWorkflowCanvasFlow({
    ...canvas,
    nodes: canvas.nodes.filter((node) => node.id !== nodeId),
    edges: canvas.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
  })
}

export function connectNodes(canvas: WorkflowCanvasDefinition, sourceNodeId: string, targetNodeId: string, edgeType: WorkflowCanvasEdgeType = 'success'): WorkflowCanvasDefinition {
  if (sourceNodeId === targetNodeId) return canvas
  const exists = canvas.edges.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId && edge.edgeType === edgeType)
  if (exists) return canvas
  return { ...canvas, edges: [...canvas.edges, createCanvasEdge(sourceNodeId, targetNodeId, edgeType)] }
}

export function getVariableFlow(canvas: WorkflowCanvasDefinition) {
  const system = [
    { source: '系统', name: 'runId', type: 'string', sensitive: false, usedBy: [] as string[] },
    { source: '系统', name: 'targetId', type: 'string', sensitive: false, usedBy: [] as string[] },
  ]
  const declared = Object.entries(canvas.variables).map(([name, definition]) => ({
    source: '变量',
    name,
    type: definition.type,
    sensitive: Boolean(definition.sensitive || definition.type === 'credential'),
    usedBy: findVariableUsers(canvas, name),
  }))
  const produced = canvas.nodes.flatMap((node) => getNodeTypeDefinition(node.type).produces.map((item) => ({
    source: node.label,
    name: `${node.id}.${item.name}`,
    type: item.type,
    sensitive: Boolean(item.sensitive),
    usedBy: findVariableUsers(canvas, item.name),
  })))
  return [...system, ...declared, ...produced]
}

function nodeToDslStep(node: WorkflowCanvasNode, index: number): WorkflowDslStep {
  const name = buildDslStepName(node, index)
  if (node.type === 'http') {
    const auth = buildHttpRequestAuth(node.config)
    return mergeImportedDslStep(node, {
      name,
      type: 'http',
      stage: getNodeStage(node),
      request: {
        method: String(node.config.method ?? 'GET') as 'GET',
        url: String(node.config.url ?? '{{verifyUrl}}'),
        ...(auth ? { auth } : {}),
        ...(isBlank(node.config.body) ? {} : { body: parseLooseJson(String(node.config.body)) }),
        timeoutSeconds: Number(node.config.timeoutSeconds ?? 30),
      },
      extract: [{ name: `${name}_status`, type: 'statusCode', optional: true }],
      assert: [{ type: 'statusCode', equals: 200 }],
    })
  }
  if (node.type === 'ssh') {
    const commands = splitCommandLines(String(node.config.command ?? ''))
    const imported = readImportedStep(node)
    const importedMode = imported?.type === 'ssh' ? imported.ssh.mode : 'command'
    const sshBody = importedMode === 'script'
      ? { script: String(node.config.command ?? '') }
      : commands.length > 1
        ? { commands }
        : { command: commands[0] ?? '' }
    return mergeImportedDslStep(node, {
      name,
      type: 'ssh',
      stage: getNodeStage(node),
      ssh: {
        mode: importedMode === 'script' ? 'script' : 'command',
        connection: {
          host: String(node.config.hostRef ?? '{{deviceHost}}'),
          username: String(node.config.username ?? '{{sshUsername}}'),
          credential: readCredentialValue(node.config.credential) ?? '{{credential}}',
          hostKeyPolicy: readHostKeyPolicy(node.config.hostKeyPolicy),
          ...(isBlank(node.config.expectedHostKeyFingerprint) ? {} : { expectedHostKeyFingerprint: String(node.config.expectedHostKeyFingerprint) }),
        },
        ...sshBody,
        timeoutSeconds: Number(node.config.timeoutSeconds ?? 60),
      },
      assert: [{ type: 'regex', pattern: '.*' }],
    })
  }
  if (node.type === 'sftp') {
    return mergeImportedDslStep(node, buildFileTransferDslStep(node, name, 'sftp'))
  }
  if (node.type === 'scp') {
    return mergeImportedDslStep(node, buildFileTransferDslStep(node, name, 'scp'))
  }
  if (node.type === 'verify') {
    const verifyType = String(node.config.verifyType ?? 'httpStatus')
    if (verifyType === 'httpStatus') {
      return mergeImportedDslStep(node, {
        name,
        type: 'http',
        stage: getNodeStage(node),
        request: { method: 'GET', url: String(node.config.inputRef ?? '{{verifyUrl}}'), timeoutSeconds: Number(node.config.timeoutSeconds ?? 30) },
        assert: [{ type: 'statusCode', equals: Number(node.config.expected ?? 200) }],
      })
    }
    return mergeImportedDslStep(node, {
      name,
      type: 'manual',
      stage: getNodeStage(node),
      instruction: `验证 ${String(node.config.inputRef ?? '')} 应匹配 ${String(node.config.expected ?? '')}`,
    })
  }
  if (node.type === 'condition') {
    return mergeImportedDslStep(node, {
      name,
      type: 'condition',
      stage: getNodeStage(node),
      condition: buildDslCondition(node.config),
      description: String(node.config.description ?? ''),
    })
  }
  if (node.type === 'wait') return mergeImportedDslStep(node, { name, type: 'wait', stage: getNodeStage(node), seconds: Number(node.config.seconds ?? 10) })
  return mergeImportedDslStep(node, { name, type: 'manual', stage: getNodeStage(node), instruction: String(node.config.instruction ?? '人工确认') })
}

function dslStepToNode(step: WorkflowDslStep, index: number): WorkflowCanvasNode {
  const stage = stageForDslStep(step, index)
  if (step.type === 'http') {
    const isVerify = step.name.includes('verify')
    return {
      id: `${isVerify ? 'verify' : 'http'}_${index + 1}`,
      type: isVerify ? 'verify' : 'http',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, isVerify ? '验证' : 'HTTP/CURL'),
      ui: { stage, rawStep: cloneRecord(step) },
      config: isVerify
        ? { verifyType: 'httpStatus', inputRef: step.request.url, expected: String((step.assert?.[0] as { equals?: unknown } | undefined)?.equals ?? 200), timeoutSeconds: step.request.timeoutSeconds ?? 30 }
        : {
            method: step.request.method,
            url: step.request.url,
            ...buildHttpNodeConfig(step.request.auth),
            body: stringifyBody(step.request.body),
            timeoutSeconds: step.request.timeoutSeconds ?? 30,
          },
    }
  }
  if (step.type === 'ssh') {
    const command = sshConfigText(step)
    if (command.startsWith('SFTP_')) {
      const [, direction = 'UPLOAD', localArtifactRef = '{{certificate.pem}}', remotePath = '/tmp/cert.pem'] = command.split(/\s+/)
      return {
        id: `sftp_${index + 1}`,
        type: 'sftp',
        position: { x: 80 + index * 260, y: 120 },
        label: dslStepLabel(step, 'SFTP 上传/下载'),
        ui: { stage, rawStep: cloneRecord(step) },
        config: {
          direction: direction.toLowerCase() === 'download' ? 'download' : 'upload',
          connectionRef: step.ssh.connection.host,
          credential: cloneCredentialValue(step.ssh.connection.credential),
          localArtifactRef,
          remotePath,
          timeoutSeconds: step.ssh.timeoutSeconds ?? 60,
        },
      }
    }
    return {
      id: `ssh_${index + 1}`,
      type: 'ssh',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, 'SSH 命令'),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        hostRef: step.ssh.connection.host,
        username: step.ssh.connection.username,
        credential: cloneCredentialValue(step.ssh.connection.credential),
        hostKeyPolicy: step.ssh.connection.hostKeyPolicy ?? 'trust_on_first_use',
        expectedHostKeyFingerprint: step.ssh.connection.expectedHostKeyFingerprint ?? '',
        command,
        timeoutSeconds: step.ssh.timeoutSeconds ?? 60,
      },
    }
  }
  if (step.type === 'sftp' || step.type === 'scp') {
    const config = step.type === 'sftp' ? step.sftp : step.scp
    return {
      id: `${step.type}_${index + 1}`,
      type: step.type,
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, step.type === 'sftp' ? 'SFTP 上传/下载' : 'SCP 上传/下载'),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        direction: config.direction,
        connectionRef: config.connection.host,
        username: config.connection.username,
        credential: cloneCredentialValue(config.connection.credential),
        hostKeyPolicy: config.connection.hostKeyPolicy ?? 'trust_on_first_use',
        expectedHostKeyFingerprint: config.connection.expectedHostKeyFingerprint ?? '',
        remotePath: config.remotePath,
        temporaryPath: config.temporaryPath ?? '',
        contentRef: config.contentRef ?? '',
        localPath: config.localPath ?? '',
        mode: config.mode ?? '',
        timeoutSeconds: config.timeoutSeconds ?? 60,
      },
    }
  }
  if (step.type === 'condition') {
    return {
      id: `condition_${index + 1}`,
      type: 'condition',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, '分支判断'),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        variable: step.condition.variable,
        operator: step.condition.equals !== undefined ? 'equals' : step.condition.notEquals !== undefined ? 'notEquals' : step.condition.exists === false ? 'notExists' : 'exists',
        expected: String(step.condition.equals ?? step.condition.notEquals ?? ''),
        description: step.description ?? '',
      },
    }
  }
  if (step.type === 'wait') return { id: `wait_${index + 1}`, type: 'wait', position: { x: 80 + index * 260, y: 120 }, label: dslStepLabel(step, '等待'), config: { seconds: step.seconds }, ui: { stage, rawStep: cloneRecord(step) } }
  return { id: `manual_${index + 1}`, type: 'manual', position: { x: 80 + index * 260, y: 120 }, label: dslStepLabel(step, '人工确认'), config: { instruction: step.instruction }, ui: { stage, rawStep: cloneRecord(step) } }
}

function buildRollbackSteps(canvas: WorkflowCanvasDefinition): readonly WorkflowDslStep[] {
  const rollbackTargets = new Set(canvas.edges.filter((edge) => edge.edgeType === 'rollback').map((edge) => edge.targetNodeId))
  const steps = canvas.nodes.filter((node) => rollbackTargets.has(node.id)).map((node, index) => nodeToDslStep(node, index))
  return steps.length ? steps : [{ name: 'manual_rollback', type: 'manual', instruction: '回滚到上一个稳定证书版本' }]
}

function resolveRollbackSteps(canvas: WorkflowCanvasDefinition): readonly WorkflowDslStep[] {
  const imported = canvas.draftState?.importedRollback
  return Array.isArray(imported) && imported.length > 0 ? cloneRecord(imported) as WorkflowDslStep[] : buildRollbackSteps(canvas)
}

function getExecutableDslNodes(canvas: WorkflowCanvasDefinition): WorkflowCanvasNode[] {
  const normalized = normalizeWorkflowCanvasFlow(canvas)
  return sortNodesByStage(normalized.nodes).filter((node) => !isRollbackOnlyNode(normalized, node.id))
}

function buildDslStepName(node: WorkflowCanvasNode, index: number): string {
  const imported = readImportedStep(node)
  if (imported?.name && node.label === imported.name) return normalizeIdentifier(imported.name)
  return normalizeIdentifier(`${node.type}_${index + 1}_${node.label}`)
}

function isRollbackOnlyNode(canvas: WorkflowCanvasDefinition, nodeId: string): boolean {
  return canvas.edges.some((edge) => edge.edgeType === 'rollback' && edge.targetNodeId === nodeId)
}

function sortNodesByEdges(canvas: WorkflowCanvasDefinition): WorkflowCanvasNode[] {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  const incoming = new Map(canvas.nodes.map((node) => [node.id, 0]))
  for (const edge of canvas.edges.filter((item) => item.edgeType !== 'rollback')) {
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1)
  }
  const queue = canvas.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).sort(positionSort)
  const result: WorkflowCanvasNode[] = []
  while (queue.length) {
    const node = queue.shift()!
    if (result.some((item) => item.id === node.id)) continue
    result.push(node)
    const outgoing = canvas.edges.filter((edge) => edge.sourceNodeId === node.id && edge.edgeType !== 'rollback').sort((a, b) => a.targetNodeId.localeCompare(b.targetNodeId))
    for (const edge of outgoing) {
      incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 1) - 1)
      if ((incoming.get(edge.targetNodeId) ?? 0) <= 0) {
        const target = byId.get(edge.targetNodeId)
        if (target) queue.push(target)
      }
    }
    queue.sort(positionSort)
  }
  return [...result, ...canvas.nodes.filter((node) => !result.some((item) => item.id === node.id)).sort(positionSort)]
}

export function normalizeWorkflowCanvasFlow(canvas: WorkflowCanvasDefinition): WorkflowCanvasDefinition {
  const ordered = sortNodesByStage(canvas.nodes.map((node) => ({
    ...node,
    ui: { ...(node.ui ?? {}), stage: getNodeStage(node) },
  })))
  const positions = new Map<string, WorkflowCanvasPosition>()
  let stageTop = WORKFLOW_FLOW_LAYOUT.top
  WORKFLOW_STAGE_DEFINITIONS.forEach((stage) => {
    const nodes = ordered.filter((node) => getNodeStage(node) === stage.key)
    nodes.forEach((node, nodeIndex) => {
      positions.set(node.id, {
        x: WORKFLOW_FLOW_LAYOUT.nodeX,
        y: stageTop + WORKFLOW_FLOW_LAYOUT.stageHeaderHeight + nodeIndex * WORKFLOW_FLOW_LAYOUT.nodeGap,
      })
    })
    stageTop += WORKFLOW_FLOW_LAYOUT.stageHeaderHeight + Math.max(nodes.length, 1) * WORKFLOW_FLOW_LAYOUT.nodeGap + WORKFLOW_FLOW_LAYOUT.stageGap
  })
  const nodes = ordered.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
  return {
    ...canvas,
    nodes,
    edges: buildStageEdges(nodes),
  }
}

export function sortNodesByStage(nodes: readonly WorkflowCanvasNode[]): WorkflowCanvasNode[] {
  const stageOrder = new Map(WORKFLOW_STAGE_DEFINITIONS.map((stage, index) => [stage.key, index]))
  return [...nodes].sort((left, right) => {
    const stageDelta = (stageOrder.get(getNodeStage(left)) ?? 0) - (stageOrder.get(getNodeStage(right)) ?? 0)
    return stageDelta || left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id)
  })
}

function buildStageEdges(nodes: readonly WorkflowCanvasNode[]): WorkflowCanvasEdge[] {
  const sorted = sortNodesByStage(nodes)
  return sorted.slice(0, -1).map((node, index) => createCanvasEdge(node.id, sorted[index + 1]!.id))
}

function defaultStageForType(type: WorkflowCanvasNodeType): WorkflowCanvasStage {
  if (type === 'http' || type === 'condition') return 'prepare'
  if (type === 'sftp' || type === 'scp') return 'install'
  if (type === 'ssh' || type === 'wait') return 'refresh'
  if (type === 'verify') return 'verify'
  return 'backup'
}

function stageForDslStep(step: WorkflowDslStep, index: number): WorkflowCanvasStage {
  if (step.stage && isWorkflowStage(step.stage)) return step.stage
  if (step.type === 'http' && step.name.includes('verify')) return 'verify'
  if (step.type === 'http') return 'prepare'
  if (step.type === 'sftp' || step.type === 'scp') return 'install'
  if (step.type === 'ssh' && (step.ssh.command ?? '').startsWith('SFTP_')) return 'install'
  if (step.type === 'ssh' || step.type === 'wait') return 'refresh'
  if (step.type === 'manual' && index > 0) return 'verify'
  if (step.type === 'condition') return 'prepare'
  return 'backup'
}

function isWorkflowStage(value: string): value is WorkflowCanvasStage {
  return WORKFLOW_STAGE_DEFINITIONS.some((stage) => stage.key === value)
}

function hasCycle(canvas: WorkflowCanvasDefinition): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const next = (nodeId: string): string[] => canvas.edges.filter((edge) => edge.sourceNodeId === nodeId && edge.edgeType !== 'rollback').map((edge) => edge.targetNodeId)
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const target of next(nodeId)) {
      if (visit(target)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  return canvas.nodes.some((node) => visit(node.id))
}

function validateHttpNodeConfig(node: WorkflowCanvasNode, issues: WorkflowValidationIssue[]) {
  const authType = readHttpAuthType(node.config.authType)
  if (!authType) {
    issues.push(fieldIssue(node, 'authType', `${node.label} 的 HTTP 认证类型不支持。`, '改为 none、basic、bearer、api_key、cookie、custom_header 或 mtls。'))
    return
  }
  if (authType === 'none') return
  if (authType === 'basic') {
    if (isBlank(node.config.authUsername)) issues.push(fieldIssue(node, 'authUsername', `${node.label} 的 Basic 用户名不能为空。`, '填写用户名或选择已保存的用户名密码凭据。'))
    if (!isCredentialValue(node.config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label} 的 Basic 凭据不能为空。`, '直接选择已保存的用户名密码凭据，或引用 credential 变量。'))
    return
  }
  if (authType === 'bearer') {
    if (!isCredentialValue(node.config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label} 的 Bearer 凭据不能为空。`, '直接选择已保存的 Bearer 凭据，或引用 credential 变量。'))
    return
  }
  if (authType === 'cookie') {
    if (isBlank(node.config.authSecretValue)) issues.push(fieldIssue(node, 'authSecretValue', `${node.label} 的认证值不能为空。`, '填写密文值或改用已保存凭据。'))
    return
  }
  if (authType === 'api_key') {
    if (!isCredentialValue(node.config.authCredential)) issues.push(fieldIssue(node, 'authCredential', `${node.label} 的 API Key 凭据不能为空。`, '直接选择已保存的 API Key 凭据，或引用 credential 变量。'))
    if (isBlank(node.config.authApiKeyName)) issues.push(fieldIssue(node, 'authApiKeyName', `${node.label} 的 API Key 名称不能为空。`, '填写 Header 名称或 Query 参数名。'))
    if (!['header', 'query'].includes(String(node.config.authApiKeyIn ?? 'header'))) issues.push(fieldIssue(node, 'authApiKeyIn', `${node.label} 的 API Key 传递位置不支持。`, '改为 header 或 query。'))
    return
  }
  if (authType === 'custom_header') {
    if (isBlank(node.config.authSecretValue)) issues.push(fieldIssue(node, 'authSecretValue', `${node.label} 的自定义 Header 值不能为空。`, '填写密文值或改用已保存凭据。'))
    if (isBlank(node.config.authHeaderName)) issues.push(fieldIssue(node, 'authHeaderName', `${node.label} 的 Header 名称不能为空。`, '填写实际 Header 名称。'))
    return
  }
  if (isBlank(node.config.authCertSecretRef)) issues.push(fieldIssue(node, 'authCertSecretRef', `${node.label} 的客户端证书不能为空。`, '填写证书密文或使用证书变量。'))
  if (isBlank(node.config.authKeySecretRef)) issues.push(fieldIssue(node, 'authKeySecretRef', `${node.label} 的客户端私钥不能为空。`, '填写私钥密文或使用证书变量。'))
}

function buildHttpRequestAuth(config: Record<string, unknown>): WorkflowHttpRequestAuth | undefined {
  const authType = readHttpAuthType(config.authType) ?? 'none'
  if (authType === 'none') return { type: 'none' }
  if (authType === 'basic') {
    const credential = readCredentialValue(config.authCredential)
    if (!credential || isBlank(config.authUsername)) return undefined
    return { type: 'basic', username: String(config.authUsername), credential }
  }
  if (authType === 'bearer') {
    const credential = readCredentialValue(config.authCredential)
    if (!credential) return undefined
    return { type: 'bearer', credential }
  }
  if (authType === 'api_key') {
    const credential = readCredentialValue(config.authCredential)
    if (!credential || isBlank(config.authApiKeyName)) return undefined
    return { type: 'api_key', credential, name: String(config.authApiKeyName), in: String(config.authApiKeyIn ?? 'header') === 'query' ? 'query' : 'header' }
  }
  if (authType === 'cookie') {
    if (isBlank(config.authSecretValue)) return undefined
    return { type: 'cookie', secretRef: String(config.authSecretValue), ...(isBlank(config.authCookieName) ? {} : { name: String(config.authCookieName) }) }
  }
  if (authType === 'custom_header') {
    if (isBlank(config.authSecretValue) || isBlank(config.authHeaderName)) return undefined
    return { type: 'custom_header', secretRef: String(config.authSecretValue), headerName: String(config.authHeaderName) }
  }
  if (isBlank(config.authCertSecretRef) || isBlank(config.authKeySecretRef)) return undefined
  return { type: 'mtls', certSecretRef: String(config.authCertSecretRef), keySecretRef: String(config.authKeySecretRef) }
}

function buildHttpNodeConfig(auth: Extract<WorkflowDslStep, { type: 'http' }>['request']['auth']): Record<string, unknown> {
  const base = {
    authType: 'none',
    authCredential: '',
    authUsername: '',
    authApiKeyName: 'X-API-Key',
    authApiKeyIn: 'header',
    authHeaderName: 'X-Custom-Auth',
    authCookieName: '',
    authSecretValue: '',
    authCertSecretRef: '',
    authKeySecretRef: '',
    authCredentialId: '',
  } as Record<string, unknown>
  if (!auth || auth.type === 'none') return base
  if (auth.type === 'basic') return { ...base, authType: 'basic', authCredential: cloneCredentialValue(auth.credential), authCredentialId: credentialValueId(auth.credential), authUsername: auth.username }
  if (auth.type === 'bearer') return { ...base, authType: 'bearer', authCredential: cloneCredentialValue(auth.credential), authCredentialId: credentialValueId(auth.credential) }
  if (auth.type === 'api_key') return { ...base, authType: 'api_key', authCredential: cloneCredentialValue(auth.credential), authCredentialId: credentialValueId(auth.credential), authApiKeyName: auth.name, authApiKeyIn: auth.in ?? 'header' }
  if (auth.type === 'cookie') return { ...base, authType: 'cookie', authSecretValue: auth.secretRef, authCookieName: auth.name ?? '' }
  if (auth.type === 'custom_header') return { ...base, authType: 'custom_header', authSecretValue: auth.secretRef, authHeaderName: auth.headerName }
  return { ...base, authType: 'mtls', authCertSecretRef: auth.certSecretRef, authKeySecretRef: auth.keySecretRef }
}

function readHttpAuthType(value: unknown): WorkflowCanvasHttpAuthType | null {
  const authType = String(value ?? 'none')
  return ['none', 'basic', 'bearer', 'api_key', 'cookie', 'custom_header', 'mtls'].includes(authType)
    ? authType as WorkflowCanvasHttpAuthType
    : null
}

function isCredentialValue(value: unknown): value is WorkflowDslCredentialValue {
  return typeof value === 'string'
    ? value.trim().startsWith('{{') && value.trim().endsWith('}}')
    : isWorkflowCredentialBinding(value)
}

function readCredentialValue(value: unknown): WorkflowDslCredentialValue | undefined {
  if (!isCredentialValue(value)) return undefined
  return typeof value === 'string' ? value.trim() : workflowCredentialBinding(value)
}

function cloneCredentialValue(value: WorkflowDslCredentialValue): WorkflowDslCredentialValue {
  return typeof value === 'string' ? value : workflowCredentialBinding(value)
}

function credentialValueId(value: WorkflowDslCredentialValue): string {
  return typeof value === 'string' ? '' : value.id
}

function readHostKeyPolicy(value: unknown): 'strict' | 'trust_on_first_use' | 'manual_approval_required' {
  const policy = String(value ?? 'trust_on_first_use')
  if (policy === 'strict' || policy === 'manual_approval_required') return policy
  return 'trust_on_first_use'
}

function findVariableUsers(canvas: WorkflowCanvasDefinition, variableName: string): string[] {
  const needle = `{{${variableName}}}`
  return canvas.nodes.filter((node) => JSON.stringify(node.config).includes(needle)).map((node) => node.label)
}

function canvasIssue(id: string, severity: WorkflowValidationSeverity, message: string, suggestion: string): WorkflowValidationIssue {
  return { id, severity, message, targetType: 'canvas', suggestion }
}

function fieldIssue(node: WorkflowCanvasNode, field: string, message: string, suggestion: string): WorkflowValidationIssue {
  return { id: `${node.id}:${field}`, severity: 'error', message, targetType: 'field', nodeId: node.id, field, suggestion }
}

function edgeIssue(edgeId: string, message: string, suggestion: string): WorkflowValidationIssue {
  return { id: edgeId, severity: 'error', message, targetType: 'edge', edgeId, suggestion }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value)
}

function containsPlainSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.includes('{{') || isSecretRef(value)) return false
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*[^{}\s]+|token\s*[:=]\s*[^{}\s]+|api[_-]?key\s*[:=]\s*[^{}\s]+/i.test(value)
}

function parseLooseJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

function stringifyBody(value: unknown): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function splitCommandLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function sshConfigText(step: Extract<WorkflowDslStep, { type: 'ssh' }>): string {
  if (step.ssh.mode === 'script') return step.ssh.script ?? ''
  if (step.ssh.commands?.length) return step.ssh.commands.join('\n')
  return step.ssh.command ?? ''
}

function dslStepLabel(step: WorkflowDslStep, fallback: string): string {
  return step.name?.trim() || fallback
}

function normalizeVariableName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]+/g, '_')
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(normalized)) return ''
  return normalized
}

function sanitizeVariableDefinition(definition: WorkflowVariableDefinition): WorkflowVariableDefinition {
  const next: WorkflowVariableDefinition = {
    type: definition.type,
    required: Boolean(definition.required),
    sensitive: Boolean(definition.sensitive || definition.type === 'credential' || definition.type === 'certificate'),
    description: definition.description,
    enum: definition.enum,
  }
  if (definition.default !== undefined && definition.default !== '') return { ...next, default: definition.default }
  return next
}

function buildDslCondition(config: Record<string, unknown>): WorkflowDslCondition {
  const variable = String(config.variable ?? '').trim() || 'deviceHost'
  const operator = String(config.operator ?? 'exists')
  if (operator === 'equals') return { variable, equals: parseConditionValue(config.expected) }
  if (operator === 'notEquals') return { variable, notEquals: parseConditionValue(config.expected) }
  if (operator === 'notExists') return { variable, exists: false }
  return { variable, exists: true }
}

function parseConditionValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return value
}

function createDefaultFileTransferConfig(contentRef: string, remotePath: string, temporaryPath: string, mode: string): Record<string, unknown> {
  return {
    direction: 'upload',
    connectionRef: '{{deviceHost}}',
    username: '{{sshUsername}}',
    credential: '{{credential}}',
    hostKeyPolicy: 'trust_on_first_use',
    expectedHostKeyFingerprint: '',
    remotePath,
    temporaryPath,
    contentRef,
    localPath: '',
    mode,
    timeoutSeconds: 60,
  }
}

function buildFileTransferDslStep(node: WorkflowCanvasNode, name: string, protocol: 'sftp' | 'scp'): Extract<WorkflowDslStep, { type: 'sftp' | 'scp' }> {
  const config = {
    direction: normalizeTransferDirection(node.config.direction),
    connection: {
      host: String(node.config.connectionRef ?? '{{deviceHost}}'),
      username: String(node.config.username ?? '{{sshUsername}}'),
      credential: readCredentialValue(node.config.credential) ?? '{{credential}}',
      hostKeyPolicy: readHostKeyPolicy(node.config.hostKeyPolicy),
      ...(isBlank(node.config.expectedHostKeyFingerprint) ? {} : { expectedHostKeyFingerprint: String(node.config.expectedHostKeyFingerprint) }),
    },
    remotePath: String(node.config.remotePath ?? '/tmp/cert.pem'),
    ...(isBlank(node.config.temporaryPath) ? {} : { temporaryPath: String(node.config.temporaryPath) }),
    ...(isBlank(node.config.contentRef) ? {} : { contentRef: String(node.config.contentRef) }),
    ...(isBlank(node.config.localPath) ? {} : { localPath: String(node.config.localPath) }),
    ...(isBlank(node.config.mode) ? {} : { mode: String(node.config.mode) }),
    timeoutSeconds: Number(node.config.timeoutSeconds ?? 60),
  }
  const common = {
    name,
    stage: getNodeStage(node),
    extract: [{ name: `${name}_hash`, type: 'jsonPath', path: '$.transferResults[0].hash', optional: true } satisfies WorkflowDslExtractor],
  }
  return protocol === 'sftp'
    ? { ...common, type: 'sftp', sftp: config }
    : { ...common, type: 'scp', scp: config }
}

function normalizeTransferDirection(value: unknown): 'upload' | 'download' {
  return String(value ?? 'upload').toLowerCase() === 'download' ? 'download' : 'upload'
}

function readImportedStep(node: WorkflowCanvasNode): WorkflowDslStep | null {
  const value = node.ui?.rawStep
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.type !== 'string') return null
  return cloneRecord(record) as WorkflowDslStep
}

function mergeImportedDslStep(node: WorkflowCanvasNode, generated: WorkflowDslStep): WorkflowDslStep {
  const imported = readImportedStep(node)
  if (!imported || imported.type !== generated.type) return generated
  if (generated.type === 'http' && imported.type === 'http') {
    return {
      ...imported,
      ...generated,
      request: { ...imported.request, ...generated.request },
      retry: generated.retry ?? imported.retry,
      extract: imported.extract ?? generated.extract,
      assert: imported.assert ?? generated.assert,
    }
  }
  if (generated.type === 'ssh' && imported.type === 'ssh') {
    return {
      ...imported,
      ...generated,
      ssh: {
        ...imported.ssh,
        ...generated.ssh,
        connection: { ...imported.ssh.connection, ...generated.ssh.connection },
      },
      retry: generated.retry ?? imported.retry,
      extract: imported.extract ?? generated.extract,
      assert: imported.assert ?? generated.assert,
    }
  }
  if (generated.type === 'sftp' && imported.type === 'sftp') {
    return {
      ...imported,
      ...generated,
      sftp: {
        ...imported.sftp,
        ...generated.sftp,
        connection: { ...imported.sftp.connection, ...generated.sftp.connection },
      },
      retry: generated.retry ?? imported.retry,
      extract: imported.extract ?? generated.extract,
      assert: imported.assert ?? generated.assert,
    }
  }
  if (generated.type === 'scp' && imported.type === 'scp') {
    return {
      ...imported,
      ...generated,
      scp: {
        ...imported.scp,
        ...generated.scp,
        connection: { ...imported.scp.connection, ...generated.scp.connection },
      },
      retry: generated.retry ?? imported.retry,
      extract: imported.extract ?? generated.extract,
      assert: imported.assert ?? generated.assert,
    }
  }
  if (generated.type === 'condition' && imported.type === 'condition') {
    return { ...imported, ...generated, condition: { ...imported.condition, ...generated.condition } }
  }
  return { ...imported, ...generated }
}

function normalizeIdentifier(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const normalized = cleaned || 'workflow_canvas_draft'
  return /^[a-zA-Z]/.test(normalized) ? normalized : `workflow_${normalized}`
}

function positionSort(a: WorkflowCanvasNode, b: WorkflowCanvasNode): number {
  return a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id)
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
