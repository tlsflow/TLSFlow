const english = {
  page: { title: 'Devices', description: 'Manage servers and network appliances from one device inventory.' },
  actions: { add: 'Add device', detail: 'View details', cancel: 'Cancel' },
  columns: { name: 'Name', category: 'Category', productFamily: 'Product family', managementMethod: 'Management method', managementAddress: 'Management address', health: 'Health', version: 'Version', applications: 'Applications', lastContact: 'Last contact' },
  metrics: { total: 'Total devices', totalDescription: 'All authorized managed devices', abnormal: 'Needs attention', abnormalDescription: 'Unreachable or degraded devices' },
  filters: { category: 'Category', managementMethod: 'Management method', health: 'Health' },
  categories: { server: 'Server', networkAppliance: 'Network appliance', securityAppliance: 'Security appliance' },
  managementMethods: { agent: 'Agent managed', api: 'API managed' },
  health: { healthy: 'Healthy', degraded: 'Degraded', unreachable: 'Unreachable', disabled: 'Disabled', unknown: 'Unknown' },
  empty: { title: 'No devices', description: 'Add a server Agent or connect a supported network appliance.' },
  platforms: { windows: 'Windows', windowsCompatibility: 'Windows (compatibility)', linux: 'Linux', citrixAdc: 'Citrix ADC', sangfor: 'Sangfor', f5: 'F5' },
  onboarding: { title: 'Add device', description: 'Choose a platform first, then provide only the installation or connection information it requires.', platformAria: 'Device platform selection', unsupported: 'This platform is not supported and cannot be submitted.', completed: 'Device onboarding completed.', fields: { displayName: 'Display name', managementAddress: 'IP address or hostname', managementPort: 'Management port', username: 'Username', password: 'Password', credentialId: 'Credential reference', tlsVerify: 'Verify TLS certificate' } },
  detail: { title: 'Device details', disableImpact: 'Disabling the device stops future deployments to all managed targets owned by it.', sections: { overview: 'Overview', runtime: 'Runtime', agent: 'Agent extension', networkAppliance: 'Network appliance extension', actions: 'Available actions' }, fields: { hostname: 'Hostname', osType: 'OS type', managementMode: 'Management mode', statusReason: 'Status reason' }, actions: { VIEW_APPLICATIONS: 'View applications', VIEW_RUNTIME: 'View runtime', UPGRADE_AGENT: 'Upgrade Agent', TEST_CONNECTION: 'Test connection', REFRESH_DISCOVERY: 'Refresh discovery', EDIT_CONNECTION: 'Edit connection', DISABLE_DEVICE: 'Disable device' } },
  deployment: { managedTarget: 'Managed target', managedTargetDescription: 'Deploy through a target owned by a server Agent or device Provider.', independentWorkflow: 'Independent workflow', independentWorkflowDescription: 'Deploy with an independent workflow running on the Control Plane or Gateway.', managedTargetTitle: 'Select managed target', managedTargetPanelDescription: 'Choose the managed object; the server resolves the driver and execution location.' },
  errors: { platformsLoadFailed: 'Failed to load onboarding platforms.', onboardingFailed: 'Failed to add device.', detailLoadFailed: 'Failed to load device details.' },
} as const

export const devicesZhCN = {
  ...english,
  page: { title: '设备', description: '在同一设备清单中管理服务器和网络设备。' },
  actions: { add: '添加设备', detail: '查看详情', cancel: '取消' },
  columns: { name: '名称', category: '设备类别', productFamily: '产品族', managementMethod: '管理方式', managementAddress: '管理地址', health: '健康状态', version: '版本', applications: '应用数量', lastContact: '最近通信' },
  metrics: { total: '设备总数', totalDescription: '当前有权访问的全部受管设备', abnormal: '需要关注', abnormalDescription: '不可达或降级的设备' },
  filters: { category: '设备类别', managementMethod: '管理方式', health: '健康状态' }, categories: { server: '服务器', networkAppliance: '网络设备', securityAppliance: '安全设备' }, managementMethods: { agent: 'Agent 管理', api: 'API 管理' }, health: { healthy: '健康', degraded: '降级', unreachable: '不可达', disabled: '已禁用', unknown: '未知' },
  empty: { title: '暂无设备', description: '安装服务器 Agent，或连接受支持的网络设备。' }, platforms: { windows: 'Windows', windowsCompatibility: 'Windows（兼容）', linux: 'Linux', citrixAdc: 'Citrix ADC', sangfor: 'Sangfor', f5: 'F5' },
  onboarding: { title: '添加设备', description: '先选择平台，再填写该平台真正需要的安装或连接信息。', platformAria: '设备平台选择', unsupported: '该平台尚未支持，不能提交。', completed: '设备添加完成。', fields: { displayName: '显示名称', managementAddress: 'IP 地址或主机名', managementPort: '管理端口', username: '用户名', password: '密码', credentialId: '凭据引用', tlsVerify: '验证 TLS 证书' } },
  detail: { title: '设备详情', disableImpact: '禁用设备后，其拥有的全部受管目标将停止后续部署。', sections: { overview: '概览', runtime: '运行信息', agent: 'Agent 扩展', networkAppliance: '网络设备扩展', actions: '可用操作' }, fields: { hostname: '主机名', osType: '操作系统类型', managementMode: '管理模式', statusReason: '状态原因' }, actions: { VIEW_APPLICATIONS: '查看应用', VIEW_RUNTIME: '查看运行信息', UPGRADE_AGENT: '升级 Agent', TEST_CONNECTION: '测试连接', REFRESH_DISCOVERY: '重新发现', EDIT_CONNECTION: '编辑连接', DISABLE_DEVICE: '禁用设备' } },
  deployment: { managedTarget: '受管目标', managedTargetDescription: '通过服务器 Agent 或设备 Provider 拥有的目标部署。', independentWorkflow: '独立工作流', independentWorkflowDescription: '通过运行在控制面或 Gateway 的独立工作流部署。', managedTargetTitle: '选择受管目标', managedTargetPanelDescription: '只选择受管对象，服务端负责解析部署驱动和执行位置。' },
  errors: { platformsLoadFailed: '加载设备平台失败。', onboardingFailed: '添加设备失败。', detailLoadFailed: '加载设备详情失败。' },
} as const

export const devicesZhTW = devicesZhCN
export const devicesEnUS = english
export const devicesJaJP = english
export const devicesFrFR = english
export const devicesRuRU = english
export const devicesPtBR = english
export const devicesKoKR = english
