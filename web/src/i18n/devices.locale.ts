const english = {
  pluginVersionSwitch: { title: 'Effective plugin version', current: 'Current: {version}', unknown: 'Unknown', active: 'Active', unavailable: 'Unavailable', open: 'Switch effective version', selectAria: 'Select effective plugin version', switch: 'Switch version', confirm: 'Confirm switch', cancel: 'Cancel', switching: 'Switching...', switched: 'Plugin version switched. Run connection test and discovery again.', switchFailed: 'Plugin version switch failed.', validationHint: 'The switch updates control-plane bindings only. Run connection test and discovery to verify the device.' },
  page: { title: 'Assets', inventory: 'Asset inventory', description: 'Manage Windows, Linux, network, and cloud assets from one inventory.' },
  actions: { add: 'Add asset', detail: 'Detail', delete: 'Delete', upgrade: 'Upgrade', upgradeNew: 'New', cancel: 'Cancel', previous: 'Previous', finish: 'Finish', generateCommand: 'Generate command', copyCommand: 'Copy command', copied: 'Copied' },
  expiryCountdown: { expired: 'Expired for {days} days', remaining: 'Expires in: {days} days' },
  columns: { name: 'Name', category: 'Type', productFamily: 'Product', managementMethod: 'Managed via', managementAddress: 'Endpoint', liveness: 'Connectivity', health: 'Health', deviceVersion: 'Software version', controlVersion: 'Control version', applications: 'Applications', lastContact: 'Last contact', actions: 'Actions' },
  metrics: { total: 'Total devices', totalDescription: 'All authorized managed devices', abnormal: 'Needs attention', abnormalDescription: 'Unreachable or degraded devices' },
  filters: { category: 'Type', managementMethod: 'Managed via', health: 'Health' },
  categories: { server: 'Server', networkAppliance: 'Network appliance', securityAppliance: 'Security appliance', cloud: 'Cloud', appliance: 'Appliance' },
  managementMethods: { agent: 'Agent-managed', api: 'API-managed', plugin: 'Plugin-managed' },
  products: { agentHost: 'Agent host', windowsCompatibility: 'Windows compatibility', chaitinSafelineWaf: 'Chaitin SafeLine WAF', f5BigIp: 'F5 BIG-IP', synologyDsm: 'Synology DSM', nginxProxyManager: 'Nginx Proxy Manager', citrixAdc: 'Citrix ADC', aliyunCdn: 'Alibaba Cloud CDN' },
  health: { healthy: 'Healthy', degraded: 'Degraded', unreachable: 'Unreachable', disabled: 'Disabled', unknown: 'Unknown' },
  empty: { title: 'No devices', description: 'Add a server agent or connect a supported network appliance.' },
  platforms: { windows: 'Windows', windowsCompatibility: 'Windows (compatibility)', windowsServer2008R2: 'Windows Server 2008 R2', windowsServer2012R2: 'Windows Server 2012 R2', windowsServer2016Plus: 'Windows Server 2016+', linux: 'Linux', linuxRedHat: 'Red Hat family', linuxDebianUbuntu: 'Debian/Ubuntu family', linuxKylin: 'Kylin family', linuxUos: 'UOS family', linuxRedHatDescription: 'RHEL/CentOS 7-9, Rocky/AlmaLinux 8-9; Linux kernel 3.2 and later', linuxDebianUbuntuDescription: 'Debian 10-13, Ubuntu 18.04-24.04; Linux kernel 3.2 and later', linuxKylinDescription: 'Kylin V10-V11', linuxUosDescription: 'UOS 20-25' },
  onboarding: { title: 'Add asset', description: 'Choose a platform first, then provide only the installation or connection information it requires to onboard the asset.', platformAria: 'Device platform selection', stepsAria: 'Device onboarding progress', unsupported: 'This platform is not supported and cannot be submitted.', completed: 'Device onboarding completed.', installReady: 'Install command generated', installDescription: 'Copy the command to the target machine and run it with administrator or root privileges. The agent appears in the device list after it registers.', expiresAt: 'Expires at', tokenHint: 'The command contains a one-time install token. Use it before the expiration time and do not share it after copying.', connectionStatus: 'Connection status', connectionTested: 'Asset created and connection test completed', connectionTestFailed: 'Asset created, but the connection test failed', connectionErrorCode: 'Connection error code', groups: { agent: 'Agent', other: 'Other platforms' }, steps: { platform: 'Select platform', configure: 'Configure', install: 'Install agent', confirm: 'Connection result' }, fields: { displayName: 'Display name', managementAddress: 'IP address or hostname', managementPort: 'Management port', username: 'Username', password: 'Password', credentialId: 'Credential reference', tlsVerify: 'Verify TLS certificate', insecureTlsAcknowledged: 'I understand the risk of disabling TLS certificate verification' } },
  detail: { title: 'Device details', deleteImpact: 'Deleting the device removes its management record and can make related managed targets unavailable.' },
  upgrade: { confirmTitle: 'Confirm agent upgrade', confirmDescription: 'Review the version change before sending the upgrade request to the host.', confirmAction: 'Confirm upgrade', notice: 'The agent service may restart during the upgrade. The operation will be tracked in global tasks.', fields: { target: 'Target host', currentVersion: 'Current version', targetVersion: 'Target version' }, values: { unknownVersion: 'Unknown' } },
  unifiedDetail: { modalDescription: 'View the latest unified detail of this managed device.', nodeEyebrow: 'Managed device', deviceType: 'Device type', discovery: { action: 'Rediscover', refreshing: 'Discovering...', success: 'Discovery completed and the device details were refreshed.', queued: 'Discovery task submitted. Device details refresh after the agent completes it.', failed: 'Discovery failed ({errorCode}). Check the device connection and credentials.', requestFailed: 'Failed to start device discovery.' }, action: { success: 'Device operation completed successfully.' }, certificateDetail: { title: 'Certificate details', description: 'View the certificate detected on this device or managed site.', eyebrow: 'Detected certificate', deviceResource: 'Device certificate resource', fingerprint: 'SHA-256 fingerprint', notManaged: 'This certificate is not currently maintained in this project.', queryFailed: 'Failed to query the project certificate association.', managedTitle: 'Project certificate details', managedDescription: 'View the complete certificate version, chain, formats, and usage records maintained by this project.', close: 'Close' }, tabs: { overview: 'Basic information', frameworks: 'Frameworks', sites: 'Sites', certificates: 'Certificates', iis: 'IIS', nginx: 'Nginx', apache: 'Apache', tomcat: 'Tomcat', logs: 'Logs' }, sections: { common: 'Basic information', agent: 'Agent information', runtime: 'Runtime status', networkAppliance: 'Network appliance information' }, fields: { hostname: 'Hostname', osType: 'OS type', managementMode: 'Management mode', updatedAt: 'Updated at', agentId: 'Agent ID', agentKey: 'Agent key', agentVersion: 'Agent version', osVersion: 'OS version', architecture: 'Architecture', ipAddress: 'IP address', agentRole: 'Agent role', agentStatus: 'Agent status', registeredAt: 'Registered at', lastHeartbeatAt: 'Last heartbeat', healthStatus: 'Health status', offline: 'Offline', pendingTaskCount: 'Pending tasks', runningTaskCount: 'Running tasks', upgradeStatus: 'Upgrade status', targetVersion: 'Target version', deviceFamily: 'Device family', managementAddress: 'Management address', managementPort: 'Management port', authMode: 'Authentication mode', tlsVerify: 'TLS verification', softwareVersion: 'Software version', softwareBuild: 'Software build', pluginVersion: 'Plugin version', supportTier: 'Support tier', virtualServerCount: 'Virtual servers', certificateCount: 'Certificates', frameworkVersion: 'Version', frameworkStatus: 'Status', subject: 'Subject', issuer: 'Issuer', notBefore: 'Valid from', notAfter: 'Valid until', address: 'Address', port: 'Port', protocol: 'Protocol', hostName: 'Host name' }, values: { empty: '—', yes: 'Yes', no: 'No', unknownCertificate: 'Unknown certificate', unbound: 'No certificate bound' }, empty: { frameworks: 'No framework records', logs: 'No device logs', sites: 'No site records', certificates: 'No certificate records', bindings: 'No certificate bindings' }, aria: { tabs: 'Device detail tabs', frameworks: 'Device frameworks', logs: 'Device operation logs', sites: 'Managed sites', certificates: 'Device certificates' } },
  deployment: { managedTarget: 'Managed target', managedTargetDescription: 'Deploy through a target owned by a server agent or device provider.', independentWorkflow: 'Independent workflow', independentWorkflowDescription: 'Deploy with an independent workflow running on the control plane or Gateway.', managedTargetTitle: 'Select managed target', managedTargetPanelDescription: 'Choose the managed object; the server resolves the driver and execution location.' },
  errors: { platformsLoadFailed: 'Failed to load onboarding platforms.', onboardingFailed: 'Failed to add device.', onboardingValidationFailed: 'Complete all required device fields before submitting.', detailLoadFailed: 'Failed to load device details.', detailTargetMissing: 'The agent identifier is missing and details cannot be opened.', unsupportedDetailType: 'This device type does not have an independent management view yet.', deleteTargetMissing: 'The device extension identifier is missing and cannot be deleted.', upgradeTargetMissing: 'The agent identifier is missing and cannot be upgraded.', upgradeNotRequired: 'This agent no longer needs an upgrade.', upgradePlanMissing: 'The upgrade plan was not created.', upgradeTargetVersionMissing: 'The target agent version is missing.', upgradeDispatchFailed: 'Failed to send the agent upgrade request.' },
} as const

export const devicesZhCN = {
  ...english,
  pluginVersionSwitch: { title: '生效插件版本', current: '当前：{version}', unknown: '未知', active: '生效中', unavailable: '不可切换', open: '切换生效版本', selectAria: '选择生效插件版本', switch: '切换版本', confirm: '确认切换', cancel: '取消', switching: '切换中…', switched: '插件版本已切换。请重新执行连接测试和设备发现。', switchFailed: '插件版本切换失败。', validationHint: '本次切换只更新控制面绑定，请重新执行连接测试和设备发现以验证设备。' },
  page: { title: '资产', inventory: '资产清单', description: '统一管理 Windows、Linux、网络设备和云服务资产。' },
  actions: { add: '添加资产', detail: '详情', delete: '删除', upgrade: '升级', upgradeNew: 'new', cancel: '取消', previous: '上一步', finish: '完成', generateCommand: '生成命令', copyCommand: '复制命令', copied: '已复制' },
  expiryCountdown: { expired: '已过期{days}天', remaining: '到期时间：{days}天' },
  columns: { name: '名称', category: '设备类别', productFamily: '产品族', managementMethod: '管理方式', managementAddress: '管理地址', liveness: '存活状态', health: '健康状态', deviceVersion: '设备版本', controlVersion: '控制版本', applications: '应用数量', lastContact: '最近通信', actions: '操作' },
  metrics: { total: '资产总数', totalDescription: '当前有权访问的全部受管资产', abnormal: '需要关注', abnormalDescription: '不可达或降级的资产' },
  filters: { category: '设备类别', managementMethod: '管理方式', health: '健康状态' }, categories: { server: '服务器', networkAppliance: '网络设备', securityAppliance: '安全设备', cloud: 'CLOUD', appliance: 'APPLIANCE' }, managementMethods: { agent: 'Agent 管理', api: 'API 管理', plugin: '插件管理' }, health: { healthy: '健康', degraded: '降级', unreachable: '不可达', disabled: '已禁用', unknown: '未知' },
  empty: { title: '暂无资产', description: '安装服务器 Agent，或连接受支持的网络设备。' }, platforms: { windows: 'Windows', windowsCompatibility: 'Windows（兼容）', windowsServer2008R2: 'Windows Server 2008 R2', windowsServer2012R2: 'Windows Server 2012 R2', windowsServer2016Plus: 'Windows Server 2016+', linux: 'Linux', linuxRedHat: 'Red Hat 系列', linuxDebianUbuntu: 'Debian/Ubuntu 系列', linuxKylin: '麒麟系列', linuxUos: '统信 OS 系列', linuxRedHatDescription: 'RHEL/CentOS 7-9、Rocky/AlmaLinux 8-9；Linux 内核 3.2 及以上', linuxDebianUbuntuDescription: 'Debian 10-13、Ubuntu 18.04-24.04；Linux 内核 3.2 及以上', linuxKylinDescription: '银河麒麟 V10-V11', linuxUosDescription: '统信 UOS 20-25' },
  onboarding: { title: '添加资产', description: '先选择平台，再填写该平台真正需要的安装或连接信息，即可完成资产接入。', platformAria: '资产平台选择', stepsAria: '资产添加进度', unsupported: '该平台尚未支持，不能提交。', completed: '资产添加完成。', installReady: '安装命令已生成', installDescription: '复制命令到目标机器，并以管理员或 root 权限执行。Agent 注册后会自动出现在资产列表中。', expiresAt: '过期时间', tokenHint: '命令中包含一次性安装令牌，请在过期前使用，复制后不要继续转发。', connectionStatus: '连接状态', connectionTested: '资产已创建并完成连接测试', connectionTestFailed: '资产已创建，但连接测试失败', connectionErrorCode: '连接错误码', groups: { agent: 'Agent', other: '其他平台' }, steps: { platform: '选择平台', configure: '填写配置', install: '安装 Agent', confirm: '连接结果' }, fields: { displayName: '显示名称', managementAddress: 'IP 地址或主机名', managementPort: '管理端口', username: '用户名', password: '密码', credentialId: '凭据引用', tlsVerify: '验证 TLS 证书', insecureTlsAcknowledged: '我已了解关闭 TLS 证书验证的风险' } },
  detail: { title: '设备详情', deleteImpact: '删除资产会移除管理记录，并可能导致关联受管目标不可用。' },
  upgrade: { confirmTitle: '确认升级 Agent', confirmDescription: '请先核对版本变化，确认后才会向目标主机发送升级请求。', confirmAction: '确认升级', notice: '升级过程中 Agent 服务可能会重启，升级过程和结果会记录在全局任务中。', fields: { target: '目标主机', currentVersion: '当前版本', targetVersion: '目标版本' }, values: { unknownVersion: '未知' } },
  unifiedDetail: { modalDescription: '查看该受管设备的最新统一详情。', nodeEyebrow: '受管设备', deviceType: '设备类型', discovery: { action: '重新发现', refreshing: '正在重新发现…', success: '重新发现完成，设备详情已刷新。', queued: '重新发现任务已提交，等待 Agent 执行完成后刷新设备详情。', failed: '重新发现失败（{errorCode}），请检查设备连接和凭据。', requestFailed: '无法启动设备重新发现。' }, action: { success: '设备操作执行成功。' }, certificateDetail: { title: '证书详情', description: '查看该设备或受管站点识别到的证书信息。', eyebrow: '识别到的证书', deviceResource: '设备证书资源', fingerprint: 'SHA-256 指纹', notManaged: '该证书当前未在本项目中维护。', queryFailed: '查询项目证书关联失败。', managedTitle: '本项目证书详情', managedDescription: '查看本项目维护的完整证书版本、证书链、格式和使用记录。', close: '关闭' }, tabs: { overview: '基础信息', frameworks: '框架', sites: '站点', certificates: '证书', iis: 'IIS', nginx: 'Nginx', apache: 'Apache', tomcat: 'Tomcat', logs: '日志' }, sections: { common: '基础信息', agent: 'Agent 信息', runtime: '运行状态', networkAppliance: '网络设备信息' }, fields: { hostname: '主机名', osType: '操作系统类型', managementMode: '管理模式', updatedAt: '更新时间', agentId: 'Agent ID', agentKey: 'Agent key', agentVersion: 'Agent 版本', osVersion: '操作系统版本', architecture: '架构', ipAddress: 'IP 地址', agentRole: 'Agent 角色', agentStatus: 'Agent 状态', registeredAt: '注册时间', lastHeartbeatAt: '最后心跳', healthStatus: '健康状态', offline: '是否离线', pendingTaskCount: '待处理任务', runningTaskCount: '运行中任务', upgradeStatus: '升级状态', targetVersion: '目标版本', deviceFamily: '设备类型', managementAddress: '管理地址', managementPort: '管理端口', authMode: '认证模式', tlsVerify: 'TLS 校验', softwareVersion: '软件版本', softwareBuild: '软件 Build', pluginVersion: '插件版本', supportTier: '支持等级', virtualServerCount: 'Virtual Server 数量', certificateCount: '证书数量', frameworkVersion: '版本', frameworkStatus: '状态', subject: '使用者', issuer: '颁发者', notBefore: '开始时间', notAfter: '结束时间', address: '地址', port: '端口', protocol: '协议', hostName: '主机名' }, values: { empty: '—', yes: '是', no: '否', unknownCertificate: '未知证书', unbound: '未绑定证书' }, empty: { frameworks: '暂无框架记录', logs: '暂无设备日志', sites: '暂无站点记录', certificates: '暂无证书记录', bindings: '暂无证书绑定' }, aria: { tabs: '设备详情标签页', frameworks: '设备框架', logs: '设备操作日志', sites: '受管站点', certificates: '设备证书' } },
  deployment: { managedTarget: '受管目标', managedTargetDescription: '通过服务器 Agent 或设备 Provider 拥有的目标部署。', independentWorkflow: '独立工作流', independentWorkflowDescription: '通过运行在控制面或 Gateway 的独立工作流部署。', managedTargetTitle: '选择受管目标', managedTargetPanelDescription: '只选择受管对象，服务端负责解析部署驱动和执行位置。' },
  errors: { platformsLoadFailed: '加载设备平台失败。', onboardingFailed: '添加设备失败。', onboardingValidationFailed: '请完整填写设备必填信息后再提交。', detailLoadFailed: '加载设备详情失败。', detailTargetMissing: 'Agent 标识缺失，无法打开详情。', unsupportedDetailType: '该设备类型尚未定义独立管理界面。', deleteTargetMissing: '设备扩展标识缺失，无法删除。', upgradeTargetMissing: '缺少 Agent 标识，无法升级。', upgradeNotRequired: '该 Agent 当前已不需要升级。', upgradePlanMissing: '未能创建升级计划。', upgradeTargetVersionMissing: '缺少目标 Agent 版本。', upgradeDispatchFailed: '发送 Agent 升级请求失败。' },
} as const

type DeviceLocaleShape = {
  readonly platforms: Readonly<Record<keyof typeof english.platforms, string>>
  readonly onboarding: {
    readonly groups: Readonly<Record<keyof typeof english.onboarding.groups, string>>
  }
}

function withPlatformTranslations<T extends DeviceLocaleShape>(
  base: T,
  platforms: Partial<Record<keyof T['platforms'], string>>,
  groups: Partial<Record<keyof T['onboarding']['groups'], string>>,
): T {
  return {
    ...base,
    platforms: { ...base.platforms, ...platforms },
    onboarding: { ...base.onboarding, groups: { ...base.onboarding.groups, ...groups } },
  } as T
}

export const devicesZhTW = withPlatformTranslations(devicesZhCN, {
  linuxRedHat: 'Red Hat 系列',
  linuxDebianUbuntu: 'Debian/Ubuntu 系列',
  linuxKylin: '麒麟系列',
  linuxUos: '統信 OS 系列',
  linuxRedHatDescription: 'RHEL/CentOS 7-9、Rocky/AlmaLinux 8-9；Linux 核心 3.2 以上',
  linuxDebianUbuntuDescription: 'Debian 10-13、Ubuntu 18.04-24.04；Linux 核心 3.2 以上',
  linuxKylinDescription: '銀河麒麟 V10-V11',
  linuxUosDescription: '統信 UOS 20-25',
}, { agent: 'Agent', other: '其他平台' })
export const devicesEnUS = english
export const devicesJaJP = withPlatformTranslations(english, {
  linuxRedHat: 'Red Hat 系',
  linuxDebianUbuntu: 'Debian/Ubuntu 系',
  linuxKylin: 'Kylin 系',
  linuxUos: 'UOS 系',
  linuxRedHatDescription: 'RHEL/CentOS 7-9、Rocky/AlmaLinux 8-9；Linux カーネル 3.2 以降',
  linuxDebianUbuntuDescription: 'Debian 10-13、Ubuntu 18.04-24.04；Linux カーネル 3.2 以降',
  linuxKylinDescription: '銀河麒麟 V10-V11',
  linuxUosDescription: '統信 UOS 20-25',
}, { agent: 'Agent', other: 'その他のプラットフォーム' })
export const devicesFrFR = withPlatformTranslations(english, {
  linuxRedHat: 'Famille Red Hat',
  linuxDebianUbuntu: 'Famille Debian/Ubuntu',
  linuxKylin: 'Famille Kylin',
  linuxUos: 'Famille UOS',
  linuxRedHatDescription: 'RHEL/CentOS 7-9, Rocky/AlmaLinux 8-9 ; noyau Linux 3.2 ou ultérieur',
  linuxDebianUbuntuDescription: 'Debian 10-13, Ubuntu 18.04-24.04 ; noyau Linux 3.2 ou ultérieur',
  linuxKylinDescription: 'Kylin V10-V11',
  linuxUosDescription: 'UOS 20-25',
}, { agent: 'Agent', other: 'Autres plateformes' })
export const devicesRuRU = withPlatformTranslations(english, {
  linuxRedHat: 'Семейство Red Hat',
  linuxDebianUbuntu: 'Семейство Debian/Ubuntu',
  linuxKylin: 'Семейство Kylin',
  linuxUos: 'Семейство UOS',
  linuxRedHatDescription: 'RHEL/CentOS 7-9, Rocky/AlmaLinux 8-9; ядро Linux 3.2 и новее',
  linuxDebianUbuntuDescription: 'Debian 10-13, Ubuntu 18.04-24.04; ядро Linux 3.2 и новее',
  linuxKylinDescription: 'Kylin V10-V11',
  linuxUosDescription: 'UOS 20-25',
}, { agent: 'Agent', other: 'Другие платформы' })
export const devicesPtBR = withPlatformTranslations(english, {
  linuxRedHat: 'Família Red Hat',
  linuxDebianUbuntu: 'Família Debian/Ubuntu',
  linuxKylin: 'Família Kylin',
  linuxUos: 'Família UOS',
  linuxRedHatDescription: 'RHEL/CentOS 7-9, Rocky/AlmaLinux 8-9; kernel Linux 3.2 ou posterior',
  linuxDebianUbuntuDescription: 'Debian 10-13, Ubuntu 18.04-24.04; kernel Linux 3.2 ou posterior',
  linuxKylinDescription: 'Kylin V10-V11',
  linuxUosDescription: 'UOS 20-25',
}, { agent: 'Agent', other: 'Outras plataformas' })
export const devicesKoKR = withPlatformTranslations(english, {
  linuxRedHat: 'Red Hat 계열',
  linuxDebianUbuntu: 'Debian/Ubuntu 계열',
  linuxKylin: 'Kylin 계열',
  linuxUos: 'UOS 계열',
  linuxRedHatDescription: 'RHEL/CentOS 7-9, Rocky/AlmaLinux 8-9; Linux 커널 3.2 이상',
  linuxDebianUbuntuDescription: 'Debian 10-13, Ubuntu 18.04-24.04; Linux 커널 3.2 이상',
  linuxKylinDescription: 'Kylin V10-V11',
  linuxUosDescription: 'UOS 20-25',
}, { agent: 'Agent', other: '기타 플랫폼' })
