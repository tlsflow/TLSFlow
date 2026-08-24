export interface AuditDisplayItem {
  readonly eventType: string
  readonly actorType?: string
  readonly actorId?: string
  readonly action: string
  readonly resourceType: string
  readonly resourceId?: string
  readonly result: string
  readonly riskLevel?: string
  readonly requestId?: string
  readonly detail?: unknown
  readonly summary?: string
}

type Translate = (key: string, named?: Record<string, unknown>) => string

const defaultT: Translate = (key) => key

const auditActionTitleKeys: Record<string, string> = {
  'secret.resolve.service': 'auditFormat.actions.secretResolveService',
  'secret.resolve': 'auditFormat.actions.secretResolve',
  'secret.create': 'auditFormat.actions.secretCreate',
  'secret.version.create': 'auditFormat.actions.secretVersionCreate',
  'secret.rotate': 'auditFormat.actions.secretRotate',
  'certificate.import': 'auditFormat.actions.certificateImport',
  'certificate.format.update': 'auditFormat.actions.certificateFormatUpdate',
  'certificate.format.delete': 'auditFormat.actions.certificateFormatDelete',
  'deployment.create': 'auditFormat.actions.deploymentCreate',
  'deployment.execute': 'auditFormat.actions.deploymentExecute',
  'deployment.rollback': 'auditFormat.actions.deploymentRollback',
  'approval.create': 'auditFormat.actions.approvalCreate',
  'approval.approve': 'auditFormat.actions.approvalApprove',
  'approval.reject': 'auditFormat.actions.approvalReject',
  'auth.login': 'auditFormat.actions.authLogin',
  'auth.logout': 'auditFormat.actions.authLogout',
}

const auditEventTitleKeys: Record<string, string> = {
  'auth.login.success': 'auditFormat.events.authLoginSuccess',
  'auth.login.failure': 'auditFormat.events.authLoginFailure',
  'auth.login.failed': 'auditFormat.events.authLoginFailed',
  'auth.logout': 'auditFormat.events.authLogout',
  'auth.external_login.success': 'auditFormat.events.authExternalLoginSuccess',
  'auth.external_login.failed': 'auditFormat.events.authExternalLoginFailed',
  'secret.created': 'auditFormat.events.secretCreated',
  'secret.version.created': 'auditFormat.events.secretVersionCreated',
  'secret.used': 'auditFormat.events.secretUsed',
  'secret.rotated': 'auditFormat.events.secretRotated',
  'permission.denied': 'auditFormat.events.permissionDenied',
  'approval.created': 'auditFormat.events.approvalCreated',
  'approval.approved': 'auditFormat.events.approvalApproved',
  'approval.rejected': 'auditFormat.events.approvalRejected',
  'certificate.imported': 'auditFormat.events.certificateImported',
  'deployment.created': 'auditFormat.events.deploymentCreated',
  'deployment.executed': 'auditFormat.events.deploymentExecuted',
  'deployment.rollback_requested': 'auditFormat.events.deploymentRollbackRequested',
  'plugin.installed': 'auditFormat.events.pluginInstalled',
  'plugin.permission_denied': 'auditFormat.events.pluginPermissionDenied',
  'workflow_template.executed': 'auditFormat.events.workflowTemplateExecuted',
}

const auditTypeLabelKeys: Record<string, string> = {
  auth: 'auditFormat.types.auth',
  security: 'auditFormat.types.security',
  secret: 'auditFormat.types.secret',
  certificate: 'auditFormat.types.certificate',
  certificate_version: 'auditFormat.types.certificateVersion',
  certificate_version_format: 'auditFormat.types.certificateVersionFormat',
  deployment: 'auditFormat.types.deployment',
  deployment_plan: 'auditFormat.types.deploymentPlan',
  execution: 'auditFormat.types.execution',
  approval: 'auditFormat.types.approval',
  permission: 'auditFormat.types.permission',
  plugin: 'auditFormat.types.plugin',
  workflow_template: 'auditFormat.types.workflowTemplate',
  gateway: 'auditFormat.types.gateway',
  agent: 'auditFormat.types.agent',
  service_asset: 'auditFormat.types.serviceAsset',
  binding: 'auditFormat.types.binding',
}

const auditActorTypeLabelKeys: Record<string, string> = {
  user: 'auditFormat.actors.user',
  system: 'auditFormat.actors.system',
  agent: 'auditFormat.actors.agent',
  plugin: 'auditFormat.actors.plugin',
  executor: 'auditFormat.actors.executor',
}

const auditResourceLabelKeys: Record<string, string> = {
  secret: 'auditFormat.resources.secret',
  secret_version: 'auditFormat.resources.secretVersion',
  certificate: 'auditFormat.resources.certificate',
  certificate_version: 'auditFormat.resources.certificateVersion',
  certificate_version_format: 'auditFormat.resources.certificateVersionFormat',
  deployment: 'auditFormat.resources.deployment',
  deployment_plan: 'auditFormat.resources.deploymentPlan',
  execution: 'auditFormat.resources.execution',
  executionRun: 'auditFormat.resources.executionRun',
  approval: 'auditFormat.resources.approval',
  plugin: 'auditFormat.resources.plugin',
  workflow_template: 'auditFormat.resources.workflowTemplate',
  gateway: 'auditFormat.resources.gateway',
  agent: 'auditFormat.resources.agent',
  service_asset: 'auditFormat.resources.serviceAsset',
  binding: 'auditFormat.resources.binding',
  auditLog: 'auditFormat.resources.auditLog',
}

const tokenLabelKeys: Record<string, string> = {
  auth: 'auditFormat.tokens.auth',
  login: 'auditFormat.tokens.login',
  logout: 'auditFormat.tokens.logout',
  external: 'auditFormat.tokens.external',
  secret: 'auditFormat.tokens.secret',
  resolve: 'auditFormat.tokens.resolve',
  service: 'auditFormat.tokens.service',
  used: 'auditFormat.tokens.used',
  created: 'auditFormat.tokens.created',
  create: 'auditFormat.tokens.create',
  updated: 'auditFormat.tokens.updated',
  update: 'auditFormat.tokens.update',
  deleted: 'auditFormat.tokens.deleted',
  delete: 'auditFormat.tokens.delete',
  version: 'auditFormat.tokens.version',
  certificate: 'auditFormat.tokens.certificate',
  imported: 'auditFormat.tokens.imported',
  import: 'auditFormat.tokens.import',
  format: 'auditFormat.tokens.format',
  deployment: 'auditFormat.tokens.deployment',
  executed: 'auditFormat.tokens.executed',
  execute: 'auditFormat.tokens.execute',
  rollback: 'auditFormat.tokens.rollback',
  requested: 'auditFormat.tokens.requested',
  approval: 'auditFormat.tokens.approval',
  approved: 'auditFormat.tokens.approved',
  rejected: 'auditFormat.tokens.rejected',
  permission: 'auditFormat.tokens.permission',
  denied: 'auditFormat.tokens.denied',
  gateway: 'auditFormat.tokens.gateway',
  credential: 'auditFormat.tokens.credential',
  issued: 'auditFormat.tokens.issued',
  revoked: 'auditFormat.tokens.revoked',
  task: 'auditFormat.tokens.task',
  evidence: 'auditFormat.tokens.evidence',
  recorded: 'auditFormat.tokens.recorded',
  result: 'auditFormat.tokens.result',
  plugin: 'auditFormat.tokens.plugin',
  workflow: 'auditFormat.tokens.workflow',
  template: 'auditFormat.tokens.template',
  synced: 'auditFormat.tokens.synced',
  tested: 'auditFormat.tokens.tested',
  source: 'auditFormat.tokens.source',
  identity: 'auditFormat.tokens.identity',
  group: 'auditFormat.tokens.group',
  mapping: 'auditFormat.tokens.mapping',
}

export function auditReadableTitle(item: AuditDisplayItem, t: Translate = defaultT): string {
  const key = auditActionTitleKeys[item.action] ?? auditEventTitleKeys[item.eventType]
  return key ? t(key) : humanizeAuditCode(item.action || item.eventType, t)
}

export function auditTypeLabel(item: AuditDisplayItem, t: Translate = defaultT): string {
  const eventRoot = item.eventType.split('.')[0]
  const gatewayPrefix = item.eventType.startsWith('gateway.') ? 'gateway' : ''
  const key = auditTypeLabelKeys[item.resourceType] ?? auditTypeLabelKeys[gatewayPrefix] ?? auditTypeLabelKeys[eventRoot]
  return key ? t(key) : t('auditFormat.types.audit')
}

export function auditResultLabel(result: string, t: Translate = defaultT): string {
  const key = result === 'success'
    ? 'auditFormat.results.success'
    : result === 'failure'
      ? 'auditFormat.results.failure'
      : result === 'denied'
        ? 'auditFormat.results.denied'
        : ''
  return key ? t(key) : result
}

export function auditSummary(item: AuditDisplayItem, t: Translate = defaultT): string {
  if (item.summary) return item.summary
  return t('auditFormat.summary', {
    actor: auditActorLabel(item, t),
    verb: auditResultVerb(item.result, t),
    title: auditReadableTitle(item, t),
    resource: auditResourceLabel(item, t),
  })
}

function auditResultVerb(result: string, t: Translate): string {
  const key = result === 'success'
    ? 'auditFormat.verbs.success'
    : result === 'failure'
      ? 'auditFormat.verbs.failure'
      : result === 'denied'
        ? 'auditFormat.verbs.denied'
        : ''
  return key ? t(key) : result
}

function auditActorLabel(item: AuditDisplayItem, t: Translate): string {
  if (item.actorId === 'system') return t('auditFormat.actors.system')
  const actorTypeKey = auditActorTypeLabelKeys[item.actorType ?? 'user']
  const actorType = actorTypeKey ? t(actorTypeKey) : item.actorType ?? t('auditFormat.actors.user')
  return t('auditFormat.actorWithId', { actorType, actorId: item.actorId || t('auditFormat.fallbacks.unknown') })
}

function auditResourceLabel(item: AuditDisplayItem, t: Translate): string {
  const resourceTypeKey = auditResourceLabelKeys[item.resourceType]
  const resourceType = resourceTypeKey ? t(resourceTypeKey) : item.resourceType
  return item.resourceId ? `${resourceType} ${shortIdentifier(item.resourceId)}` : resourceType
}

function shortIdentifier(value: string): string {
  if (value.length <= 34) return value
  return `${value.slice(0, 18)}...${value.slice(-8)}`
}

function humanizeAuditCode(value: string, t: Translate): string {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => {
      const key = tokenLabelKeys[token]
      return key ? t(key) : token
    })
    .join(' ')
}
