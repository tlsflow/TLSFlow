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
  certificateAsset: 'auditFormat.types.certificate',
  certificate_version: 'auditFormat.types.certificateVersion',
  certificateVersion: 'auditFormat.types.certificateVersion',
  certificate_version_format: 'auditFormat.types.certificateVersionFormat',
  certificate_format: 'auditFormat.types.certificateVersionFormat',
  certificateVersionFormat: 'auditFormat.types.certificateVersionFormat',
  deployment: 'auditFormat.types.deployment',
  deployment_plan: 'auditFormat.types.deploymentPlan',
  deploymentPlan: 'auditFormat.types.deploymentPlan',
  execution: 'auditFormat.types.execution',
  approval: 'auditFormat.types.approval',
  permission: 'auditFormat.types.permission',
  plugin: 'auditFormat.types.plugin',
  workflow_template: 'auditFormat.types.workflowTemplate',
  gateway: 'auditFormat.types.gateway',
  agent: 'auditFormat.types.agent',
  service_asset: 'auditFormat.types.serviceAsset',
  binding: 'auditFormat.types.binding',
  task: 'auditFormat.types.execution',
  caSyncRun: 'auditFormat.types.certificate',
  authSession: 'auditFormat.types.auth',
  authUser: 'auditFormat.types.auth',
  credential: 'auditFormat.types.secret',
  certificate_request: 'auditFormat.types.certificate',
  certificate_binding: 'auditFormat.types.binding',
  certificate_asset: 'auditFormat.types.certificate',
  certificate_authority: 'auditFormat.types.certificate',
  certificate_profile: 'auditFormat.types.certificate',
  certificate_renewal: 'auditFormat.types.certificate',
  certificate_reuse_risk: 'auditFormat.types.certificate',
  certificate_revocation: 'auditFormat.types.certificate',
  trust_distribution: 'auditFormat.types.certificate',
  ca_provider: 'auditFormat.types.certificate',
  ca_node: 'auditFormat.types.certificate',
  caOperation: 'auditFormat.types.certificate',
  ca_trust_domain: 'auditFormat.types.certificate',
  automation: 'auditFormat.types.workflowTemplate',
  device_asset: 'auditFormat.types.agent',
  managed_target: 'auditFormat.types.serviceAsset',
  managed_target_snapshot: 'auditFormat.types.serviceAsset',
  service_instance: 'auditFormat.types.serviceAsset',
  site_asset: 'auditFormat.types.serviceAsset',
  identitySource: 'auditFormat.types.auth',
  group: 'auditFormat.types.security',
  role: 'auditFormat.types.permission',
  permissionRoleBinding: 'auditFormat.types.permission',
  permissionAccessGrant: 'auditFormat.types.permission',
  permissionObjectSet: 'auditFormat.types.permission',
  businessPermission: 'auditFormat.types.permission',
  plugin_version: 'auditFormat.types.plugin',
  provider_catalog: 'auditFormat.types.gateway',
  cloud_account_asset: 'auditFormat.types.gateway',
  tenantMode: 'auditFormat.types.security',
  user: 'auditFormat.types.security',
  host: 'auditFormat.types.gateway',
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
  certificateAsset: 'auditFormat.resources.certificate',
  certificate_version: 'auditFormat.resources.certificateVersion',
  certificateVersion: 'auditFormat.resources.certificateVersion',
  certificate_version_format: 'auditFormat.resources.certificateVersionFormat',
  certificate_format: 'auditFormat.resources.certificateVersionFormat',
  certificateVersionFormat: 'auditFormat.resources.certificateVersionFormat',
  deployment: 'auditFormat.resources.deployment',
  deployment_plan: 'auditFormat.resources.deploymentPlan',
  deploymentPlan: 'auditFormat.resources.deploymentPlan',
  execution: 'auditFormat.resources.execution',
  executionRun: 'auditFormat.resources.executionRun',
  execution_run: 'auditFormat.resources.executionRun',
  approval: 'auditFormat.resources.approval',
  plugin: 'auditFormat.resources.plugin',
  workflow_template: 'auditFormat.resources.workflowTemplate',
  gateway: 'auditFormat.resources.gateway',
  agent: 'auditFormat.resources.agent',
  service_asset: 'auditFormat.resources.serviceAsset',
  binding: 'auditFormat.resources.binding',
  auditLog: 'auditFormat.resources.auditLog',
  task: 'auditFormat.resources.execution',
  caSyncRun: 'auditFormat.resources.certificate',
  authSession: 'auditFormat.resources.auditLog',
  authUser: 'auditFormat.resources.auditLog',
  credential: 'auditFormat.resources.secret',
  certificate_request: 'auditFormat.resources.certificate',
  certificate_binding: 'auditFormat.resources.binding',
  certificate_asset: 'auditFormat.resources.certificate',
  certificate_authority: 'auditFormat.resources.certificate',
  certificate_profile: 'auditFormat.resources.certificate',
  certificate_renewal: 'auditFormat.resources.certificate',
  certificate_reuse_risk: 'auditFormat.resources.certificate',
  certificate_revocation: 'auditFormat.resources.certificate',
  trust_distribution: 'auditFormat.resources.certificate',
  ca_provider: 'auditFormat.resources.certificate',
  ca_node: 'auditFormat.resources.certificate',
  caOperation: 'auditFormat.resources.certificate',
  ca_trust_domain: 'auditFormat.resources.certificate',
  automation: 'auditFormat.resources.workflowTemplate',
  device_asset: 'auditFormat.resources.agent',
  managed_target: 'auditFormat.resources.serviceAsset',
  managed_target_snapshot: 'auditFormat.resources.serviceAsset',
  service_instance: 'auditFormat.resources.serviceAsset',
  site_asset: 'auditFormat.resources.serviceAsset',
  identitySource: 'auditFormat.resources.auditLog',
  group: 'auditFormat.resources.auditLog',
  role: 'auditFormat.resources.auditLog',
  permissionRoleBinding: 'auditFormat.resources.auditLog',
  permissionAccessGrant: 'auditFormat.resources.auditLog',
  permissionObjectSet: 'auditFormat.resources.auditLog',
  businessPermission: 'auditFormat.resources.auditLog',
  plugin_version: 'auditFormat.resources.plugin',
  provider_catalog: 'auditFormat.resources.gateway',
  cloud_account_asset: 'auditFormat.resources.gateway',
  tenantMode: 'auditFormat.resources.auditLog',
  user: 'auditFormat.resources.auditLog',
  host: 'auditFormat.resources.gateway',
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
  if (key) return t(key)
  if (item.eventType.startsWith('ca.operations.sync.') || item.eventType.startsWith('internal_ca.')) return t('auditFormat.types.certificate')
  if (item.eventType.startsWith('security.')) return t('auditFormat.types.security')
  if (item.eventType.startsWith('automation.')) return t('auditFormat.types.workflowTemplate')
  if (item.eventType.startsWith('task.')) return t('auditFormat.types.execution')
  return humanizeAuditCode(item.action || item.eventType, t)
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
  if (item.actorId === 'system' || item.actorId?.startsWith('system')) return t('auditFormat.actors.system')
  const actorTypeKey = auditActorTypeLabelKeys[item.actorType ?? 'user']
  const actorType = actorTypeKey ? t(actorTypeKey) : item.actorType ?? t('auditFormat.actors.user')
  if (item.actorId?.startsWith('external_ids_') || item.actorId?.startsWith('external_group_ids_')) {
    return `${t('auditFormat.tokens.external')} ${actorType}`
  }
  if (item.actorId?.startsWith('ids_')) return `${t('auditFormat.tokens.external')} ${t('auditFormat.actors.system')}`
  return actorType
}

function auditResourceLabel(item: AuditDisplayItem, t: Translate): string {
  const resourceTypeKey = auditResourceLabelKeys[item.resourceType]
  const resourceType = resourceTypeKey ? t(resourceTypeKey) : t('auditFormat.types.audit')
  const detailName = detailBusinessName(item.detail)
  if (detailName) return `${resourceType} ${detailName}`
  const certificateFormat = certificateFormatDetailName(item)
  return certificateFormat ? `${resourceType} ${certificateFormat}` : resourceType
}

function certificateFormatDetailName(item: AuditDisplayItem): string | undefined {
  if (item.resourceType !== 'certificate_version_format'
    && item.resourceType !== 'certificate_format'
    && item.resourceType !== 'certificateVersionFormat') return undefined
  if (!item.detail || typeof item.detail !== 'object' || Array.isArray(item.detail)) return undefined
  const format = (item.detail as Record<string, unknown>).format
  return typeof format === 'string' && format.trim() ? format.trim().toUpperCase() : undefined
}

function detailBusinessName(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined
  const root = detail as Record<string, unknown>
  const after = root.after && typeof root.after === 'object' && !Array.isArray(root.after)
    ? root.after as Record<string, unknown>
    : undefined
  const candidates = [
    root.name,
    root.displayName,
    root.username,
    root.groupName,
    root.commonName,
    root.primaryDomain,
    root.domainName,
    root.address,
    root.managementAddress,
    after?.name,
    after?.displayName,
    after?.username,
    after?.groupName,
    after?.commonName,
    after?.primaryDomain,
    after?.domainName,
    after?.address,
    after?.managementAddress,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const label = cleanBusinessLabel(candidate)
    if (label) return label
  }
  return undefined
}

function cleanBusinessLabel(value: string): string | undefined {
  const internalId = /(?:aud|task|casync|secv?|cert(?:asset|ver|fmt)?|pln|run|apr|autv?|arun|agt|sat|svc|sit|dev|ids|external_ids|external_group_ids|rbnd|oset|role|bpgr|agrant|caprov|canode|cantask|certreq|catd|mtg|cred|wfrun|wftplv?|artifact)[_-][a-z0-9-]+/gi
  const cleaned = value
    .replace(new RegExp(`\\s*[（(]\\s*${internalId.source}\\s*[）)]`, 'gi'), '')
    .replace(internalId, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || undefined
}

function humanizeAuditCode(value: string, t: Translate): string {
  const fallbackKeyByToken: Record<string, string> = {
    ca: 'auditFormat.types.certificate',
    operations: 'auditFormat.tokens.permission',
    sync: 'auditFormat.tokens.synced',
    started: 'auditFormat.tokens.created',
    completed: 'auditFormat.tokens.result',
    failed: 'auditFormat.results.failure',
    internal: 'auditFormat.types.security',
    provider: 'auditFormat.tokens.credential',
    authority: 'auditFormat.tokens.certificate',
    request: 'auditFormat.tokens.approval',
    identity: 'auditFormat.tokens.identity',
    source: 'auditFormat.tokens.source',
    users: 'auditFormat.tokens.task',
    test: 'auditFormat.tokens.tested',
  }
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => {
      const key = tokenLabelKeys[token] ?? fallbackKeyByToken[token]
      return key ? t(key) : token
    })
    .join(' ')
}
