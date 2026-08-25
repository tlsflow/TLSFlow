export const caOperationsZhCN = {
  title: 'CA管理',
  actions: { sync: '同步当前视图', syncing: '正在创建同步任务…', search: '搜索', manageInternalCa: '内部CA管理' },
  tree: { title: '证书颁发机构', count: '共 {count} 个 CA', unassigned: '未分配信任域' },
  views: { request: '申请', issuance: '已颁发证书', revocation: '已吊销证书', template: '证书模板' },
  columns: { subject: '使用者', identifier: '标识', template: '模板', source: '数据来源', status: '状态', observedAt: '观测时间' },
  sources: { gcac_native: 'GCAC 原生', external_sync: '外部 CA 同步', historical_backfill: '历史回填' },
  statuses: { pending: '待处理', issued: '已颁发', rejected: '已拒绝', revoked: '已吊销', failed: '失败', unknown: '未知', complete: '完整', partial: '部分完成', stale: '数据过期', syncing: '同步中', queued: '排队中', running: '运行中', succeeded: '已完成', cancelled: '已取消' },
  freshness: { realtime: '实时', normal: '正常', delayed: '同步延迟', stale: '数据过期', syncing: '正在同步', offline: '同步失败', unknown: '尚未同步' },
  summary: { currentAuthority: '当前 CA', integrity: '数据完整性', lastSuccessfulSync: '最近成功同步', latestRun: '当前视图同步' },
  filters: { searchPlaceholder: '搜索使用者、序列号、申请 ID 或模板' },
  messages: { loadTreeFailed: 'CA 资源树加载失败，请检查权限和服务状态。', loadRecordsFailed: 'CA 运营记录加载失败。', syncFailed: '无法创建 CA 同步任务，请检查 Agent 在线状态和权限。', empty: '当前 CA 和视图暂无记录。', noAuthority: '暂无可访问的证书颁发机构', noAuthorityDescription: '请先连接或创建 CA，并确认当前账号具有 CA 读取权限。' },
  aria: { authorityTree: '证书颁发机构资源树', objectViews: 'CA 运营对象视图', search: '搜索 CA 运营记录' },
} as const

export const caOperationsEnUS = {
  title: 'Certificate authority operations',
  actions: { sync: 'Sync current view', syncing: 'Creating sync run…', search: 'Search', manageInternalCa: 'Manage internal CA' },
  tree: { title: 'Certificate authorities', count: '{count} CAs', unassigned: 'Unassigned trust domain' },
  views: { request: 'Requests', issuance: 'Issued certificates', revocation: 'Revoked certificates', template: 'Certificate templates' },
  columns: { subject: 'Subject', identifier: 'Identifier', template: 'Template', source: 'Source', status: 'Status', observedAt: 'Observed at' },
  sources: { gcac_native: 'GCAC native', external_sync: 'External CA sync', historical_backfill: 'Historical backfill' },
  statuses: { pending: 'Pending', issued: 'Issued', rejected: 'Rejected', revoked: 'Revoked', failed: 'Failed', unknown: 'Unknown', complete: 'Complete', partial: 'Partial', stale: 'Stale', syncing: 'Syncing', queued: 'Queued', running: 'Running', succeeded: 'Succeeded', cancelled: 'Cancelled' },
  freshness: { realtime: 'Real-time', normal: 'Current', delayed: 'Delayed', stale: 'Stale', syncing: 'Syncing', offline: 'Sync failed', unknown: 'Not synchronized' },
  summary: { currentAuthority: 'Current CA', integrity: 'Data integrity', lastSuccessfulSync: 'Last successful sync', latestRun: 'Current view sync' },
  filters: { searchPlaceholder: 'Search subject, serial number, request ID, or template' },
  messages: { loadTreeFailed: 'Failed to load the CA resource tree. Check permissions and service status.', loadRecordsFailed: 'Failed to load CA operation records.', syncFailed: 'Failed to create a CA sync run. Check agent availability and permissions.', empty: 'No records exist for the selected CA and view.', noAuthority: 'No accessible certificate authorities', noAuthorityDescription: 'Connect or create a CA and verify that the current account has CA read access.' },
  aria: { authorityTree: 'Certificate authority resource tree', objectViews: 'CA operation object views', search: 'Search CA operation records' },
} as const

export const caOperationsZhTW = caOperationsZhCN
export const caOperationsJaJP = caOperationsEnUS
export const caOperationsFrFR = caOperationsEnUS
export const caOperationsRuRU = caOperationsEnUS
export const caOperationsPtBR = caOperationsEnUS
export const caOperationsKoKR = caOperationsEnUS
