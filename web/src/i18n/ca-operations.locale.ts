export const caOperationsZhCN = {
  title: 'CA管理',
  actions: { search: '搜索', manageInternalCa: 'CA', caStatus: 'CA 状态', setDefaultCa: '设为默认 CA', settingDefaultCa: '正在保存默认 CA…', defaultCaSelected: '当前为默认 CA', refreshAgent: '立即扫描并刷新', refreshingAgent: 'Agent 扫描中…' },
  tree: { title: '证书颁发机构', count: '共 {count} 个 CA', unassigned: '未分配信任域' },
  views: { request: '申请', issuance: '已颁发证书', revocation: '已吊销证书', template: '证书模板' },
  columns: { subject: '使用者', identifier: '标识', template: '模板', source: '数据来源', status: '状态', observedAt: '观测时间' },
  sources: { gcac_native: 'GCAC 原生', external_sync: 'Agent 观测', historical_backfill: '历史导入' },
  statuses: { pending: '待处理', issued: '已颁发', rejected: '已拒绝', revoked: '已吊销', failed: '失败', unknown: '未知', complete: '完整', partial: '部分完成', stale: '数据过期' },
  summary: { currentAuthority: '当前 CA', integrity: '数据完整性', agentVersion: 'Agent 版本', agentVersionSource: '版本来源', versionFromHeartbeat: '最近心跳上报（实际运行）', versionFromRegistration: '注册记录（尚未收到心跳）', registeredVersion: '注册版本', agentId: 'Agent ID', agentStatus: 'Agent 状态', observationStatus: '观测状态', parserVersion: '解析器版本', statusCounts: '本轮归类：申请 {request} · 已颁发 {issuance} · 已吊销 {revocation}', agentKey: 'Agent Key', heartbeatAt: '最近心跳', observationAt: '最近观测', storedRecords: '后端记录数', observationStats: '扫描 {scanned} · 成功发送 {sent} · 后端接受 {accepted} · 入库 {inserted} · 重复 {duplicates} · 拒绝 {rejected} · 失败批次 {failed} · 待重试 {pending}', observationWarnings: '观测诊断', noAgent: '未关联 AD CS Agent', working: '工作中', offline: '离线', active: '正常', degraded: '降级', retiring: '退休中', disabled: '已禁用', unknown: '未知' },
  filters: { searchPlaceholder: '搜索使用者、序列号、申请 ID 或模板' },
  messages: { loadTreeFailed: 'CA 资源树加载失败，请检查权限和服务状态。', loadRecordsFailed: 'CA 运营记录加载失败。', saveDefaultFailed: '默认 CA 保存失败。', empty: '当前 CA 和视图暂无记录。', noAuthority: '暂无可访问的证书颁发机构', noAuthorityDescription: '请先连接或创建 CA，并确认当前账号具有 CA 读取权限。', refreshAgentFailed: 'Agent 扫描失败，请检查 Agent 在线状态和管理端口。', refreshAgentSucceeded: 'Agent 扫描完成，后端记录已刷新。', refreshAgentSucceededWithStats: 'Agent 扫描完成：扫描 {scanned} 条，成功发送 {sent} 条，后端接受 {accepted} 条，入库 {inserted} 条，重复 {duplicates} 条，拒绝 {rejected} 条，失败 {failed} 批，待重试 {pending} 批。' },
  aria: { authorityTree: '证书颁发机构资源树', authoritySelect: '选择证书颁发机构', caStatus: '打开 CA 状态', objectViews: 'CA 运营对象视图', search: '搜索 CA 运营记录' },
  modals: { caStatusTitle: 'CA 状态', caStatusDescription: '查看当前 CA、Agent 运行状态和最近一次观测统计。', nativeCaStatus: '当前 CA 为宿主内置 CA，不使用 AD CS Agent。' },
} as const

export const caOperationsEnUS = {
  title: 'Certificate authority operations',
  actions: { search: 'Search', manageInternalCa: 'CA', caStatus: 'CA status', setDefaultCa: 'Set as default CA', settingDefaultCa: 'Saving default CA…', defaultCaSelected: 'Default CA', refreshAgent: 'Scan and refresh', refreshingAgent: 'Agent scanning…' },
  tree: { title: 'Certificate authorities', count: '{count} CAs', unassigned: 'Unassigned trust domain' },
  views: { request: 'Requests', issuance: 'Issued certificates', revocation: 'Revoked certificates', template: 'Certificate templates' },
  columns: { subject: 'Subject', identifier: 'Identifier', template: 'Template', source: 'Source', status: 'Status', observedAt: 'Observed at' },
  sources: { gcac_native: 'GCAC native', external_sync: 'Agent observation', historical_backfill: 'Historical import' },
  statuses: { pending: 'Pending', issued: 'Issued', rejected: 'Rejected', revoked: 'Revoked', failed: 'Failed', unknown: 'Unknown', complete: 'Complete', partial: 'Partial', stale: 'Stale' },
  summary: { currentAuthority: 'Current CA', integrity: 'Data integrity', agentVersion: 'Agent version', agentVersionSource: 'Version source', versionFromHeartbeat: 'Latest heartbeat (running binary)', versionFromRegistration: 'Registration record (no heartbeat yet)', registeredVersion: 'Registered version', agentId: 'Agent ID', agentStatus: 'Agent status', observationStatus: 'Observation status', parserVersion: 'Parser version', statusCounts: 'Current classification: requests {request} · issued {issuance} · revoked {revocation}', agentKey: 'Agent key', heartbeatAt: 'Last heartbeat', observationAt: 'Last observation', storedRecords: 'Stored records', observationStats: 'Scan {scanned} · sent {sent} · accepted {accepted} · inserted {inserted} · duplicate {duplicates} · rejected {rejected} · failed batches {failed} · retry {pending}', observationWarnings: 'Observation diagnostics', noAgent: 'No AD CS Agent', working: 'Working', offline: 'Offline', active: 'Active', degraded: 'Degraded', retiring: 'Retiring', disabled: 'Disabled', unknown: 'Unknown' },
  filters: { searchPlaceholder: 'Search subject, serial number, request ID, or template' },
  messages: { loadTreeFailed: 'Failed to load the CA resource tree. Check permissions and service status.', loadRecordsFailed: 'Failed to load CA operation records.', saveDefaultFailed: 'Failed to save the default CA.', empty: 'No records exist for the selected CA and view.', noAuthority: 'No accessible certificate authorities', noAuthorityDescription: 'Connect or create a CA and verify that the current account has CA read access.', refreshAgentFailed: 'Agent scan failed. Check Agent liveness and management port.', refreshAgentSucceeded: 'Agent scan completed and records were refreshed.', refreshAgentSucceededWithStats: 'Agent scan completed: scanned {scanned}, sent {sent}, accepted {accepted}, inserted {inserted}, rejected {rejected}, failed batches {failed}, retry batches {pending}.' },
  aria: { authorityTree: 'Certificate authority resource tree', authoritySelect: 'Select a certificate authority', caStatus: 'Open CA status', objectViews: 'CA operation object views', search: 'Search CA operation records' },
  modals: { caStatusTitle: 'CA status', caStatusDescription: 'View the selected CA, Agent runtime status, and latest observation statistics.', nativeCaStatus: 'The selected CA is a built-in CA and does not use an AD CS Agent.' },
} as const

export const caOperationsZhTW = caOperationsZhCN
export const caOperationsJaJP = caOperationsEnUS
export const caOperationsFrFR = caOperationsEnUS
export const caOperationsRuRU = caOperationsEnUS
export const caOperationsPtBR = caOperationsEnUS
export const caOperationsKoKR = caOperationsEnUS
