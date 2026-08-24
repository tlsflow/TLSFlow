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

const auditActionTitles: Record<string, string> = {
  'secret.resolve.service': '服务读取 Secret',
  'secret.resolve': '执行器读取 Secret',
  'secret.create': '创建 Secret',
  'secret.version.create': '创建 Secret 版本',
  'secret.rotate': '轮换 Secret',
  'certificate.import': '导入证书',
  'certificate.format.update': '更新证书产物',
  'certificate.format.delete': '删除证书产物',
  'deployment.create': '创建部署计划',
  'deployment.execute': '执行部署计划',
  'deployment.rollback': '请求回滚',
  'approval.create': '创建审批',
  'approval.approve': '批准审批',
  'approval.reject': '拒绝审批',
  'auth.login': '用户登录',
  'auth.logout': '用户退出',
}

const auditEventTitles: Record<string, string> = {
  'auth.login.success': '登录成功',
  'auth.login.failure': '登录失败',
  'auth.login.failed': '登录失败',
  'auth.logout': '退出登录',
  'auth.external_login.success': '外部身份登录成功',
  'auth.external_login.failed': '外部身份登录失败',
  'secret.created': '创建 Secret',
  'secret.version.created': '创建 Secret 版本',
  'secret.used': '读取 Secret',
  'secret.rotated': '轮换 Secret',
  'permission.denied': '权限拒绝',
  'approval.created': '创建审批',
  'approval.approved': '审批通过',
  'approval.rejected': '审批驳回',
  'certificate.imported': '证书变更',
  'deployment.created': '创建部署',
  'deployment.executed': '执行部署',
  'deployment.rollback_requested': '请求部署回滚',
  'plugin.installed': '安装插件',
  'plugin.permission_denied': '插件权限拒绝',
  'workflow_template.executed': '执行工作流模板',
}

const auditTypeLabels: Record<string, string> = {
  auth: '认证',
  security: '安全',
  secret: 'Secret',
  certificate: '证书',
  certificate_version: '证书',
  certificate_version_format: '证书产物',
  deployment: '部署',
  deployment_plan: '部署计划',
  execution: '执行',
  approval: '审批',
  permission: '权限',
  plugin: '插件',
  workflow_template: '工作流',
  gateway: '网关',
  agent: 'Agent',
  service_asset: '应用资产',
  binding: '绑定',
}

const auditActorTypeLabels: Record<string, string> = {
  user: '用户',
  system: '系统',
  agent: 'Agent',
  plugin: '插件',
  executor: '执行器',
}

const auditResourceLabels: Record<string, string> = {
  secret: 'Secret',
  secret_version: 'Secret 版本',
  certificate: '证书',
  certificate_version: '证书版本',
  certificate_version_format: '证书产物',
  deployment: '部署',
  deployment_plan: '部署计划',
  execution: '执行任务',
  executionRun: '执行任务',
  approval: '审批单',
  plugin: '插件',
  workflow_template: '工作流模板',
  gateway: '网关',
  agent: 'Agent',
  service_asset: '应用资产',
  binding: '证书绑定',
  auditLog: '审计日志',
}

export function auditReadableTitle(item: AuditDisplayItem): string {
  return auditActionTitles[item.action] ?? auditEventTitles[item.eventType] ?? humanizeAuditCode(item.action || item.eventType)
}

export function auditTypeLabel(item: AuditDisplayItem): string {
  const eventRoot = item.eventType.split('.')[0]
  const gatewayPrefix = item.eventType.startsWith('gateway.') ? 'gateway' : ''
  return auditTypeLabels[item.resourceType] ?? auditTypeLabels[gatewayPrefix] ?? auditTypeLabels[eventRoot] ?? '审计'
}

export function auditResultLabel(result: string): string {
  const labels: Record<string, string> = {
    success: '成功',
    failure: '失败',
    denied: '拒绝',
  }
  return labels[result] ?? result
}

export function auditSummary(item: AuditDisplayItem): string {
  if (item.summary) return item.summary
  return `${auditActorLabel(item)}${auditResultVerb(item.result)}“${auditReadableTitle(item)}”，对象：${auditResourceLabel(item)}。`
}

function auditResultVerb(result: string): string {
  const labels: Record<string, string> = {
    success: '完成',
    failure: '失败',
    denied: '拒绝',
  }
  return labels[result] ?? result
}

function auditActorLabel(item: AuditDisplayItem): string {
  if (item.actorId === 'system') return '系统'
  const actorType = auditActorTypeLabels[item.actorType ?? 'user'] ?? item.actorType ?? '用户'
  return `${actorType} ${item.actorId || '未知'}`
}

function auditResourceLabel(item: AuditDisplayItem): string {
  const resourceType = auditResourceLabels[item.resourceType] ?? item.resourceType
  return item.resourceId ? `${resourceType} ${shortIdentifier(item.resourceId)}` : resourceType
}

function shortIdentifier(value: string): string {
  if (value.length <= 34) return value
  return `${value.slice(0, 18)}…${value.slice(-8)}`
}

function humanizeAuditCode(value: string): string {
  const tokenLabels: Record<string, string> = {
    auth: '认证',
    login: '登录',
    logout: '退出',
    external: '外部',
    secret: 'Secret',
    resolve: '读取',
    service: '服务',
    used: '使用',
    created: '创建',
    create: '创建',
    updated: '更新',
    update: '更新',
    deleted: '删除',
    delete: '删除',
    version: '版本',
    certificate: '证书',
    imported: '导入',
    import: '导入',
    format: '产物',
    deployment: '部署',
    executed: '执行',
    execute: '执行',
    rollback: '回滚',
    requested: '请求',
    approval: '审批',
    approved: '通过',
    rejected: '驳回',
    permission: '权限',
    denied: '拒绝',
    gateway: '网关',
    credential: '凭据',
    issued: '发放',
    revoked: '吊销',
    task: '任务',
    evidence: '证据',
    recorded: '记录',
    result: '结果',
    plugin: '插件',
    workflow: '工作流',
    template: '模板',
    synced: '同步',
    tested: '测试',
    source: '来源',
    identity: '身份源',
    group: '组',
    mapping: '映射',
  }
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => tokenLabels[token] ?? token)
    .join(' ')
}
