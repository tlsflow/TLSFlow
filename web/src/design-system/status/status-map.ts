export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export interface StatusMeta {
  readonly label: string
  readonly tone: StatusTone
}

export const statusDictionary = {
  DRAFT: { label: '草稿', tone: 'muted' },
  PENDING_APPROVAL: { label: '待审批', tone: 'warning' },
  READY: { label: '待执行', tone: 'info' },
  RUNNING: { label: '执行中', tone: 'info' },
  SUCCESS: { label: '成功', tone: 'success' },
  PARTIAL_SUCCESS: { label: '部分成功', tone: 'warning' },
  FAILED: { label: '失败', tone: 'danger' },
  CANCELLED: { label: '已取消', tone: 'muted' },
  ROLLED_BACK: { label: '已回滚', tone: 'warning' },
  DISCOVERED: { label: '已发现', tone: 'info' },
  MANAGED: { label: '已纳管', tone: 'success' },
  DRIFTED: { label: '已漂移', tone: 'warning' },
  EXPIRED: { label: '已过期', tone: 'danger' },
  ERROR: { label: '异常', tone: 'danger' },
  IGNORED: { label: '已忽略', tone: 'muted' },
  ONLINE: { label: '在线', tone: 'success' },
  OFFLINE: { label: '离线', tone: 'danger' },
  DISABLED: { label: '已禁用', tone: 'muted' },
  UPGRADING: { label: '升级中', tone: 'info' },
  UNKNOWN: { label: '未知', tone: 'muted' }
} satisfies Record<string, StatusMeta>

export function resolveStatusMeta(status: string): StatusMeta {
  return statusDictionary[status as keyof typeof statusDictionary] ?? { label: status, tone: 'muted' }
}
