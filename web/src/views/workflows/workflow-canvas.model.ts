import { i18n } from '@/i18n'
import {
  workflowCredentialBinding,
  type WorkflowCredentialBinding,
  type WorkflowManagedCredential,
} from './workflow-credentials'

export type WorkflowCanvasNodeType = 'http' | 'ssh' | 'sftp' | 'scp' | 'tls_probe' | 'verify' | 'condition' | 'transform' | 'foreach' | 'checkpoint' | 'wait' | 'manual'
export type WorkflowCanvasEdgeType = 'success' | 'failure' | 'always' | 'rollback'
export type WorkflowCanvasFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'secret'
export type WorkflowValidationSeverity = 'error' | 'warning' | 'risk'
export type WorkflowCanvasStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify'
export type WorkflowCanvasHttpAuthType = 'none' | 'basic' | 'bearer' | 'api_key' | 'cookie' | 'custom_header' | 'mtls'
export type WorkflowDslCredentialValue = WorkflowCredentialBinding | string
export type WorkflowConfigurationMode = 'required' | 'advanced' | 'runtime'
export type WorkflowVariableLifecycle = 'pre_execution' | 'runtime_injected' | 'step_output'
export type WorkflowBindingPolicy = 'fixed' | 'default_overridable' | 'required_binding'

function canvasModelText(key: string, params?: Record<string, string | number>): string {
  const fullKey = `workflows.canvasModel.${key}`
  return params ? i18n.global.t(fullKey, params) : i18n.global.t(fullKey)
}

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
  readonly connections?: Record<string, WorkflowConnectionDefinition>
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
  readonly type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'file' | 'credential' | 'certificate'
  readonly required?: boolean
  readonly configurationMode?: WorkflowConfigurationMode
  readonly default?: unknown
  readonly enum?: readonly unknown[]
  readonly sensitive?: boolean
  readonly description?: string
  readonly source?: Record<string, unknown>
  readonly lifecycle?: WorkflowVariableLifecycle
  readonly bindingPolicy?: WorkflowBindingPolicy
  readonly ui?: Record<string, unknown>
  readonly artifactContract?: {
    readonly outputs: Record<string, {
      readonly role: string
      readonly required?: boolean
      readonly format?: string
      readonly encoding?: string
      readonly description?: string
    }>
  }
}

export interface WorkflowConnectionDefinition {
  readonly protocol: 'ssh' | 'http'
  readonly host: Record<string, unknown>
  readonly port: Record<string, unknown>
  readonly username?: Record<string, unknown>
  readonly credential?: Record<string, unknown>
  readonly hostKey?: Record<string, unknown>
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
  readonly connections?: Record<string, WorkflowConnectionDefinition>
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
        readonly query?: Record<string, string | number | boolean>
        readonly headers?: Record<string, string>
        readonly headerRefs?: Record<string, string>
        readonly bodyType?: 'json' | 'form' | 'multipart' | 'raw' | 'none'
        readonly auth?:
          | { readonly type: 'none' }
          | { readonly type: 'basic'; readonly username: string; readonly credential: WorkflowDslCredentialValue }
          | { readonly type: 'bearer'; readonly credential: WorkflowDslCredentialValue }
          | { readonly type: 'api_key'; readonly credential: WorkflowDslCredentialValue; readonly in?: 'header' | 'query'; readonly name: string }
          | { readonly type: 'cookie'; readonly secretRef: string; readonly name?: string }
          | { readonly type: 'custom_header'; readonly secretRef: string; readonly headerName: string }
          | { readonly type: 'mtls'; readonly certSecretRef: string; readonly keySecretRef: string }
        readonly body?: unknown
        readonly form?: Record<string, string | number | boolean>
        readonly formCredentialRefs?: Record<string, WorkflowDslCredentialValue>
        readonly multipart?: Record<string, { readonly value?: string | number | boolean; readonly filename?: string; readonly contentType?: string; readonly secretRef?: string }>
        readonly tls?: { readonly verify?: boolean; readonly caSecretRef?: string; readonly clientCertSecretRef?: string; readonly clientKeySecretRef?: string; readonly sni?: string; readonly allowInsecure?: boolean }
        readonly timeoutSeconds?: number
        readonly maxResponseBytes?: number
        readonly successStatusCodes?: readonly number[]
        readonly failOnNon2xx?: boolean
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
  | {
      readonly name: string
      readonly type: 'transform'
      readonly stage?: WorkflowCanvasStage
      readonly transform: {
        readonly engine: 'jsonata'
        readonly input?: unknown
        readonly outputs: Record<string, { readonly expression: string; readonly format?: 'raw' | 'jsonString'; readonly sensitive?: boolean; readonly optional?: boolean }>
        readonly timeoutMs?: number
        readonly maxInputBytes?: number
        readonly maxOutputBytes?: number
      }
    }
  | {
      readonly name: string
      readonly type: 'tls_probe'
      readonly stage?: WorkflowCanvasStage
      readonly tlsProbe: {
        readonly host: string
        readonly port?: number
        readonly serverName?: string
        readonly expectedFingerprintSha256: string
        readonly timeoutSeconds?: number
      }
    }
  | {
      readonly name: string
      readonly type: 'foreach'
      readonly stage?: WorkflowCanvasStage
      readonly foreach: {
        readonly itemsPath: string
        readonly itemVariable: string
        readonly indexVariable?: string
        readonly maxItems?: number
        readonly steps: readonly WorkflowDslStep[]
      }
    }
  | {
      readonly name: string
      readonly type: 'checkpoint'
      readonly stage?: WorkflowCanvasStage
      readonly checkpoint: {
        readonly name: string
        readonly capture: Record<string, string>
        readonly normalizedHash?: boolean
        readonly requiredForRollback: boolean
      }
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
    description: canvasModelText('nodeTypes.http.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'method', label: 'Method', kind: 'select', required: true, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ label: value, value })) },
      { key: 'url', label: 'URL', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea' },
      { key: 'timeoutSeconds', label: canvasModelText('fields.timeoutSeconds'), kind: 'number', required: true },
    ],
    produces: [
      { name: 'statusCode', type: 'number' },
      { name: 'body', type: 'object' },
      { name: 'extracted', type: 'object' },
    ],
  },
  {
    type: 'ssh',
    displayName: canvasModelText('nodeTypes.ssh.displayName'),
    category: 'ssh',
    description: canvasModelText('nodeTypes.ssh.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'hostRef', label: canvasModelText('fields.hostRef'), kind: 'text', required: true },
      { key: 'username', label: canvasModelText('fields.usernameVariable'), kind: 'text', required: true },
      { key: 'credential', label: canvasModelText('fields.credential'), kind: 'text', required: true },
      { key: 'hostKeyPolicy', label: canvasModelText('fields.hostKeyPolicy'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.hostKeyPolicy.trustOnFirstUse'), value: 'trust_on_first_use' },
        { label: canvasModelText('options.hostKeyPolicy.strict'), value: 'strict' },
        { label: canvasModelText('options.hostKeyPolicy.manualApproval'), value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: canvasModelText('fields.expectedHostKeyFingerprint'), kind: 'text' },
      { key: 'command', label: canvasModelText('fields.command'), kind: 'textarea', required: true },
      { key: 'timeoutSeconds', label: canvasModelText('fields.timeoutSeconds'), kind: 'number', required: true },
    ],
    produces: [
      { name: 'exitCode', type: 'number' },
      { name: 'stdout', type: 'string' },
      { name: 'stderr', type: 'string' },
    ],
  },
  {
    type: 'sftp',
    displayName: canvasModelText('nodeTypes.sftp.displayName'),
    category: 'file',
    description: canvasModelText('nodeTypes.sftp.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'direction', label: canvasModelText('fields.direction'), kind: 'select', required: true, options: [{ label: canvasModelText('options.direction.upload'), value: 'upload' }, { label: canvasModelText('options.direction.download'), value: 'download' }] },
      { key: 'connectionRef', label: canvasModelText('fields.connectionRef'), kind: 'text', required: true },
      { key: 'credential', label: canvasModelText('fields.credential'), kind: 'text', required: true },
      { key: 'remotePath', label: canvasModelText('fields.remotePath'), kind: 'text', required: true },
      { key: 'temporaryPath', label: canvasModelText('fields.temporaryPath'), kind: 'text' },
      { key: 'username', label: canvasModelText('fields.usernameVariable'), kind: 'text', required: true },
      { key: 'hostKeyPolicy', label: canvasModelText('fields.hostKeyPolicy'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.hostKeyPolicy.trustOnFirstUse'), value: 'trust_on_first_use' },
        { label: canvasModelText('options.hostKeyPolicy.strict'), value: 'strict' },
        { label: canvasModelText('options.hostKeyPolicy.manualApproval'), value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: canvasModelText('fields.expectedHostKeyFingerprint'), kind: 'text' },
      { key: 'contentRef', label: canvasModelText('fields.contentRef'), kind: 'text' },
      { key: 'localPath', label: canvasModelText('fields.localPath'), kind: 'text' },
      { key: 'mode', label: canvasModelText('fields.mode'), kind: 'text' },
      { key: 'timeoutSeconds', label: canvasModelText('fields.timeoutSeconds'), kind: 'number', required: true },
    ],
    produces: [
      { name: 'remotePath', type: 'string' },
      { name: 'hash', type: 'string' },
      { name: 'backupRef', type: 'string' },
    ],
  },
  {
    type: 'scp',
    displayName: canvasModelText('nodeTypes.scp.displayName'),
    category: 'file',
    description: canvasModelText('nodeTypes.scp.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'direction', label: canvasModelText('fields.direction'), kind: 'select', required: true, options: [{ label: canvasModelText('options.direction.upload'), value: 'upload' }, { label: canvasModelText('options.direction.download'), value: 'download' }] },
      { key: 'connectionRef', label: canvasModelText('fields.connectionRef'), kind: 'text', required: true },
      { key: 'username', label: canvasModelText('fields.usernameVariable'), kind: 'text', required: true },
      { key: 'credential', label: canvasModelText('fields.credential'), kind: 'text', required: true },
      { key: 'remotePath', label: canvasModelText('fields.remotePath'), kind: 'text', required: true },
      { key: 'temporaryPath', label: canvasModelText('fields.temporaryPath'), kind: 'text' },
      { key: 'hostKeyPolicy', label: canvasModelText('fields.hostKeyPolicy'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.hostKeyPolicy.trustOnFirstUse'), value: 'trust_on_first_use' },
        { label: canvasModelText('options.hostKeyPolicy.strict'), value: 'strict' },
        { label: canvasModelText('options.hostKeyPolicy.manualApproval'), value: 'manual_approval_required' },
      ] },
      { key: 'expectedHostKeyFingerprint', label: canvasModelText('fields.expectedHostKeyFingerprint'), kind: 'text' },
      { key: 'contentRef', label: canvasModelText('fields.contentRef'), kind: 'text' },
      { key: 'localPath', label: canvasModelText('fields.localPath'), kind: 'text' },
      { key: 'mode', label: canvasModelText('fields.mode'), kind: 'text' },
      { key: 'timeoutSeconds', label: canvasModelText('fields.timeoutSeconds'), kind: 'number', required: true },
    ],
    produces: [
      { name: 'remotePath', type: 'string' },
      { name: 'hash', type: 'string' },
      { name: 'backupRef', type: 'string' },
    ],
  },
  {
    type: 'verify',
    displayName: canvasModelText('nodeTypes.verify.displayName'),
    category: 'verify',
    description: canvasModelText('nodeTypes.verify.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'verifyType', label: canvasModelText('fields.verifyType'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.verifyType.httpStatus'), value: 'httpStatus' },
        { label: canvasModelText('options.verifyType.textContains'), value: 'text' },
        { label: 'JSONPath', value: 'jsonPath' },
        { label: canvasModelText('options.verifyType.regex'), value: 'regex' },
        { label: canvasModelText('options.verifyType.certificateFingerprint'), value: 'certificateFingerprint' },
      ] },
      { key: 'inputRef', label: canvasModelText('fields.inputRef'), kind: 'text', required: true },
      { key: 'expected', label: canvasModelText('fields.expected'), kind: 'text', required: true },
      { key: 'timeoutSeconds', label: canvasModelText('fields.timeoutSeconds'), kind: 'number', required: true },
    ],
    produces: [
      { name: 'passed', type: 'boolean' },
      { name: 'evidence', type: 'string' },
    ],
  },
  {
    type: 'condition',
    displayName: canvasModelText('nodeTypes.condition.displayName'),
    category: 'control',
    description: canvasModelText('nodeTypes.condition.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'variable', label: canvasModelText('fields.variable'), kind: 'text', required: true },
      { key: 'operator', label: canvasModelText('fields.operator'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.operator.equals'), value: 'equals' },
        { label: canvasModelText('options.operator.notEquals'), value: 'notEquals' },
        { label: canvasModelText('options.operator.exists'), value: 'exists' },
        { label: canvasModelText('options.operator.notExists'), value: 'notExists' },
      ] },
      { key: 'expected', label: canvasModelText('fields.expected'), kind: 'text' },
      { key: 'description', label: canvasModelText('fields.description'), kind: 'textarea' },
    ],
    produces: [{ name: 'passed', type: 'boolean' }],
  },
  {
    type: 'transform',
    displayName: canvasModelText('nodeTypes.transform.displayName'),
    category: 'control',
    description: canvasModelText('nodeTypes.transform.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'input', label: canvasModelText('fields.transformInput'), kind: 'textarea' },
      { key: 'expression', label: 'JSONata', kind: 'textarea', required: true },
      { key: 'format', label: canvasModelText('fields.outputFormat'), kind: 'select', options: [
        { label: canvasModelText('options.transformFormat.raw'), value: 'raw' },
        { label: canvasModelText('options.transformFormat.jsonString'), value: 'jsonString' },
      ] },
      { key: 'timeoutMs', label: canvasModelText('fields.timeoutMs'), kind: 'number' },
    ],
    produces: [{ name: 'outputs', type: 'object' }],
  },
  {
    type: 'foreach',
    displayName: canvasModelText('nodeTypes.foreach.displayName'),
    category: 'control',
    description: canvasModelText('nodeTypes.foreach.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'itemsPath', label: canvasModelText('fields.itemsPath'), kind: 'text', required: true },
      { key: 'itemVariable', label: canvasModelText('fields.itemVariable'), kind: 'text', required: true },
      { key: 'indexVariable', label: canvasModelText('fields.indexVariable'), kind: 'text' },
      { key: 'maxItems', label: canvasModelText('fields.maxItems'), kind: 'number', required: true },
      { key: 'steps', label: canvasModelText('fields.foreachSteps'), kind: 'textarea', required: true },
    ],
    produces: [{ name: 'iterations', type: 'object' }],
  },
  {
    type: 'checkpoint',
    displayName: canvasModelText('nodeTypes.checkpoint.displayName'),
    category: 'control',
    description: canvasModelText('nodeTypes.checkpoint.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [
      { key: 'checkpointName', label: canvasModelText('fields.checkpointName'), kind: 'text', required: true },
      { key: 'capture', label: canvasModelText('fields.checkpointCapture'), kind: 'textarea', required: true },
      { key: 'requiredForRollback', label: canvasModelText('fields.requiredForRollback'), kind: 'select', required: true, options: [
        { label: canvasModelText('options.boolean.yes'), value: 'true' },
        { label: canvasModelText('options.boolean.no'), value: 'false' },
      ] },
    ],
    produces: [{ name: 'captureHash', type: 'string' }],
  },
  {
    type: 'wait',
    displayName: canvasModelText('nodeTypes.wait.displayName'),
    category: 'control',
    description: canvasModelText('nodeTypes.wait.description'),
    inputPorts: ['input'],
    outputPorts: ['success'],
    fields: [{ key: 'seconds', label: canvasModelText('fields.seconds'), kind: 'number', required: true }],
    produces: [],
  },
  {
    type: 'manual',
    displayName: canvasModelText('nodeTypes.manual.displayName'),
    category: 'manual',
    description: canvasModelText('nodeTypes.manual.description'),
    inputPorts: ['input'],
    outputPorts: ['success', 'failure'],
    fields: [{ key: 'instruction', label: canvasModelText('fields.instruction'), kind: 'textarea', required: true }],
    produces: [],
  },
]

export const WORKFLOW_STAGE_DEFINITIONS: readonly WorkflowStageDefinition[] = [
  { key: 'prepare', title: canvasModelText('stages.prepare.title'), description: canvasModelText('stages.prepare.description') },
  { key: 'backup', title: canvasModelText('stages.backup.title'), description: canvasModelText('stages.backup.description') },
  { key: 'install', title: canvasModelText('stages.install.title'), description: canvasModelText('stages.install.description') },
  { key: 'refresh', title: canvasModelText('stages.refresh.title'), description: canvasModelText('stages.refresh.description') },
  { key: 'verify', title: canvasModelText('stages.verify.title'), description: canvasModelText('stages.verify.description') },
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
      label: canvasModelText('defaults.nodes.backupExistingCertificate'),
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
      label: canvasModelText('defaults.nodes.reloadService'),
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
      displayName: canvasModelText('defaults.displayName', { name }),
      category: 'deployment',
      tags: ['ssl', 'workflow'],
    },
    variables: {
      deviceHost: { type: 'string', required: true, description: canvasModelText('defaults.variables.deviceHost.description') },
      sshUsername: { type: 'string', required: true, description: canvasModelText('defaults.variables.sshUsername.description') },
      credential: { type: 'credential', required: true, sensitive: true, description: canvasModelText('defaults.variables.credential.description') },
      serverCert: {
        type: 'certificate',
        required: true,
        sensitive: true,
        description: canvasModelText('defaults.variables.serverCert.description'),
        artifactContract: {
          outputs: {
            certFile: { role: 'public_certificate', required: true, format: 'pem', encoding: 'utf8', description: canvasModelText('defaults.variables.serverCert.outputs.certFile.description') },
            keyFile: { role: 'private_key', required: true, format: 'pem', encoding: 'utf8', description: canvasModelText('defaults.variables.serverCert.outputs.keyFile.description') },
          },
        },
      },
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
        description: canvasModelText('defaults.variables.certificatePaths.description'),
      },
      verifyUrl: { type: 'string', required: true, description: canvasModelText('defaults.variables.verifyUrl.description') },
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
  if (!definition) throw new Error(canvasModelText('errors.unknownNodeType', { type }))
  return definition
}

export function createDefaultConfig(type: WorkflowCanvasNodeType): Record<string, unknown> {
  if (type === 'http') return { method: 'GET', url: '{{verifyUrl}}', authType: 'none', authCredential: '', authUsername: '', authApiKeyName: 'X-API-Key', authApiKeyIn: 'header', authHeaderName: 'X-Custom-Auth', authCookieName: '', authSecretValue: '', authCertSecretRef: '', authKeySecretRef: '', authCredentialId: '', body: '', timeoutSeconds: 30 }
  if (type === 'ssh') return { hostRef: '{{deviceHost}}', username: '{{sshUsername}}', credential: '{{credential}}', hostKeyPolicy: 'trust_on_first_use', expectedHostKeyFingerprint: '', command: 'systemctl reload nginx', timeoutSeconds: 60 }
  if (type === 'sftp') return createDefaultFileTransferConfig('{{serverCert.outputs.certFile.content}}', '{{certificatePaths.certPath}}', '{{certificatePaths.tempCertPath}}', '0644')
  if (type === 'scp') return createDefaultFileTransferConfig('{{serverCert.outputs.keyFile.content}}', '{{certificatePaths.keyPath}}', '{{certificatePaths.tempKeyPath}}', '0600')
  if (type === 'verify') return { verifyType: 'httpStatus', inputRef: '{{verifyUrl}}', expected: '200', timeoutSeconds: 30 }
  if (type === 'condition') return { variable: 'deviceHost', operator: 'exists', expected: '', description: canvasModelText('defaults.config.conditionDescription') }
  if (type === 'transform') return { input: '{}', expression: '$', format: 'raw', timeoutMs: 200 }
  if (type === 'foreach') return { itemsPath: 'asset.items', itemVariable: 'item', indexVariable: 'index', maxItems: 100, steps: '[]' }
  if (type === 'checkpoint') return { checkpointName: 'before-write', capture: '{}', requiredForRollback: 'true' }
  if (type === 'wait') return { seconds: 10 }
  return { instruction: canvasModelText('defaults.config.manualInstruction') }
}

export function workflowDslToCanvas(dsl: WorkflowDslV1): WorkflowCanvasDefinition {
  const nodes = dsl.steps.map((step, index) => dslStepToNode(step, index))
  return normalizeWorkflowCanvasFlow({
    schemaVersion: 'gcac.workflow.canvas/v1',
    dslVersion: 'gcac.workflow/v1',
    metadata: dsl.metadata,
    variables: cloneRecord(dsl.variables),
    connections: cloneRecord(dsl.connections ?? {}),
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
    { source: canvasModelText('variableFlow.system'), name: 'runId', type: 'string', sensitive: false, usedBy: [] as string[] },
    { source: canvasModelText('variableFlow.system'), name: 'targetId', type: 'string', sensitive: false, usedBy: [] as string[] },
  ]
  const declared = Object.entries(canvas.variables).map(([name, definition]) => ({
    source: canvasModelText('variableFlow.variable'),
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

function dslStepToNode(step: WorkflowDslStep, index: number): WorkflowCanvasNode {
  const stage = stageForDslStep(step, index)
  if (step.type === 'http') {
    const isVerify = step.name.includes('verify')
    return {
      id: `${isVerify ? 'verify' : 'http'}_${index + 1}`,
      type: isVerify ? 'verify' : 'http',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, isVerify ? canvasModelText('nodeTypes.verify.displayName') : 'HTTP/CURL'),
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
      const [, direction = 'UPLOAD', localArtifactRef = '{{serverCert.outputs.certFile.content}}', remotePath = '/tmp/cert.pem'] = command.split(/\s+/)
      return {
        id: `sftp_${index + 1}`,
        type: 'sftp',
        position: { x: 80 + index * 260, y: 120 },
        label: dslStepLabel(step, canvasModelText('nodeTypes.sftp.displayName')),
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
      label: dslStepLabel(step, canvasModelText('nodeTypes.ssh.displayName')),
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
      label: dslStepLabel(step, step.type === 'sftp' ? canvasModelText('nodeTypes.sftp.displayName') : canvasModelText('nodeTypes.scp.displayName')),
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
      label: dslStepLabel(step, canvasModelText('nodeTypes.condition.displayName')),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        variable: step.condition.variable,
        operator: step.condition.equals !== undefined ? 'equals' : step.condition.notEquals !== undefined ? 'notEquals' : step.condition.exists === false ? 'notExists' : 'exists',
        expected: String(step.condition.equals ?? step.condition.notEquals ?? ''),
        description: step.description ?? '',
      },
    }
  }
  if (step.type === 'transform') {
    const firstOutput = Object.values(step.transform.outputs)[0]
    return {
      id: `transform_${index + 1}`,
      type: 'transform',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, canvasModelText('nodeTypes.transform.displayName')),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        input: stringifyBody(step.transform.input ?? {}),
        expression: firstOutput?.expression ?? '$',
        format: firstOutput?.format ?? 'raw',
        timeoutMs: step.transform.timeoutMs ?? 200,
      },
    }
  }
  if (step.type === 'tls_probe') {
    return {
      id: `tls_probe_${index + 1}`,
      type: 'tls_probe',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, 'TLS Probe'),
      ui: { stage, rawStep: cloneRecord(step) },
      config: cloneRecord(step.tlsProbe),
    }
  }
  if (step.type === 'foreach') {
    return {
      id: `foreach_${index + 1}`,
      type: 'foreach',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, canvasModelText('nodeTypes.foreach.displayName')),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        itemsPath: step.foreach.itemsPath,
        itemVariable: step.foreach.itemVariable,
        indexVariable: step.foreach.indexVariable ?? '',
        maxItems: step.foreach.maxItems ?? 100,
        steps: JSON.stringify(step.foreach.steps, null, 2),
      },
    }
  }
  if (step.type === 'checkpoint') {
    return {
      id: `checkpoint_${index + 1}`,
      type: 'checkpoint',
      position: { x: 80 + index * 260, y: 120 },
      label: dslStepLabel(step, canvasModelText('nodeTypes.checkpoint.displayName')),
      ui: { stage, rawStep: cloneRecord(step) },
      config: {
        checkpointName: step.checkpoint.name,
        capture: JSON.stringify(step.checkpoint.capture, null, 2),
        requiredForRollback: String(step.checkpoint.requiredForRollback),
      },
    }
  }
  if (step.type === 'wait') return { id: `wait_${index + 1}`, type: 'wait', position: { x: 80 + index * 260, y: 120 }, label: dslStepLabel(step, canvasModelText('nodeTypes.wait.displayName')), config: { seconds: step.seconds }, ui: { stage, rawStep: cloneRecord(step) } }
  return { id: `manual_${index + 1}`, type: 'manual', position: { x: 80 + index * 260, y: 120 }, label: dslStepLabel(step, canvasModelText('nodeTypes.manual.displayName')), config: { instruction: step.instruction }, ui: { stage, rawStep: cloneRecord(step) } }
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
  if (type === 'checkpoint') return 'backup'
  if (type === 'transform' || type === 'foreach') return 'refresh'
  if (type === 'sftp' || type === 'scp') return 'install'
  if (type === 'ssh' || type === 'wait') return 'refresh'
  if (type === 'verify' || type === 'tls_probe') return 'verify'
  return 'backup'
}

function stageForDslStep(step: WorkflowDslStep, index: number): WorkflowCanvasStage {
  if (step.stage && isWorkflowStage(step.stage)) return step.stage
  if (step.type === 'http' && step.name.includes('verify')) return 'verify'
  if (step.type === 'tls_probe') return 'verify'
  if (step.type === 'http') return 'prepare'
  if (step.type === 'sftp' || step.type === 'scp') return 'install'
  if (step.type === 'checkpoint') return 'backup'
  if (step.type === 'transform' || step.type === 'foreach') return 'refresh'
  if (step.type === 'ssh' && (step.ssh.command ?? '').startsWith('SFTP_')) return 'install'
  if (step.type === 'ssh' || step.type === 'wait') return 'refresh'
  if (step.type === 'manual' && index > 0) return 'verify'
  if (step.type === 'condition') return 'prepare'
  return 'backup'
}

function isWorkflowStage(value: string): value is WorkflowCanvasStage {
  return WORKFLOW_STAGE_DEFINITIONS.some((stage) => stage.key === value)
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

function cloneCredentialValue(value: WorkflowDslCredentialValue): WorkflowDslCredentialValue {
  return typeof value === 'string' ? value : workflowCredentialBinding(value)
}

function credentialValueId(value: WorkflowDslCredentialValue): string {
  return typeof value === 'string' ? '' : value.id
}

function findVariableUsers(canvas: WorkflowCanvasDefinition, variableName: string): string[] {
  const needle = `{{${variableName}}}`
  return canvas.nodes.filter((node) => JSON.stringify(node.config).includes(needle)).map((node) => node.label)
}

function stringifyBody(value: unknown): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
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
    artifactContract: definition.type === 'certificate' ? definition.artifactContract : undefined,
  }
  if (definition.default !== undefined && definition.default !== '') return { ...next, default: definition.default }
  return next
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
