const english = {
  page: {
    title: 'Cloud services',
    description: 'Manage generic cloud services and keep credentials as references. Provider operations require an attached plugin version and runner.',
  },
  actions: {
    add: 'Add cloud account',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    test: 'Test connection',
    discover: 'Discover resources',
    resources: 'View resources',
    execute: 'Run operation',
    delete: 'Delete',
    previous: 'Previous',
    next: 'Next',
  },
  fields: {
    displayName: 'Display name',
    provider: 'Provider',
    accountId: 'Account ID',
    credentialProfile: 'Credential reference',
    scope: 'Endpoint and metadata',
    endpoint: 'Endpoint',
    metadataJson: 'Opaque metadata JSON',
    framework: 'Framework type',
    operation: 'Operation key',
    targetJson: 'Opaque target JSON',
    inputJson: 'Opaque input JSON',
    status: 'Status',
    actions: 'Actions',
    updatedAt: 'Updated at',
    frameworkCount: 'Frameworks',
    deviceCount: 'Control-plane devices',
    siteCount: 'Sites',
  },
  placeholders: {
    displayName: 'For example: Production cloud account',
    accountId: 'Optional account identifier',
    endpoint: 'Optional endpoint URL',
    metadataJson: '{"key":"value"}',
    targetJson: '{"resourceId":"opaque-resource"}',
    inputJson: '{"property":"value"}',
  },
  sections: {
    providers: 'Provider catalog',
    accounts: 'Cloud accounts',
    operation: 'Opaque provider operation',
  },
  messages: {
    loadFailed: 'Cloud provider data could not be loaded.',
    createFailed: 'Cloud account could not be created.',
    saved: 'Cloud account created.',
    savedAndDiscovered: 'Cloud account saved and resources discovered automatically.',
    updated: 'Cloud account updated.',
    deleted: 'Cloud account deleted.',
    deleteConfirmText: 'DELETE',
    deleteRisk: 'This removes the cloud account.',
    testCompleted: 'Connection test completed.',
    testCompletedUnverified: 'Connection test returned without a verified signature.',
    discoveryCompleted: 'Resource discovery completed.',
    discoveryFailedAfterSave: 'The cloud account was saved, but automatic discovery failed. Fix the credential or provider access and retry discovery.',
    operationFailed: 'Cloud account operation failed.',
    resourcesLoading: 'Loading discovered resources…',
    resourcesLoadFailed: 'Discovered resources could not be loaded.',
    operationCompleted: 'Provider operation completed.',
    operationUnavailable: 'Provider plugin version/runner is not connected. The operation was closed without execution.',
    operationOpaqueHint: 'The host stores and forwards these values as opaque descriptions. It does not interpret or execute provider algorithms.',
    operationJsonInvalid: 'Enter a valid JSON object.',
    noAccounts: 'No cloud accounts.',
    noProviders: 'No provider definitions.',
    noCapabilities: 'No declared operations.',
    credentialSelectHint: 'Choose a managed credential. This cloud account stores only its credential reference.',
    credentialHint: 'Only the credential reference is stored. Secret material is not resolved in the provider host.',
    metadataHint: 'Additional metadata is stored as opaque JSON and is not interpreted by the host.',
    providerLocked: 'The provider of an existing cloud account cannot be changed.',
    providerRequired: 'Select an enabled provider plugin.',
    providerUnavailable: 'No enabled provider plugin with a valid Form resource is available.',
    versionUnavailable: 'The current cloud account version is unavailable. Refresh the list and try again.',
    credentialRequired: 'Select a credential reference first.',
    metadataInvalid: 'Metadata JSON must be an object.',
    scopeEmpty: 'No endpoint or metadata',
    scopeInvalid: 'Scope must be a valid JSON object.',
  },
  wizard: {
    ariaLabel: 'Cloud account wizard',
    steps: {
      provider: 'Provider',
      asset: 'Account details',
    },
    stepDescriptions: {
      provider: 'Choose a provider and review its declared operation descriptions.',
      asset: 'Save a display name and managed credential. Endpoint, region, and provider parameters are discovered automatically.',
    },
    panels: {
      providerTitle: 'Choose a provider',
      providerDescription: 'Provider entries describe capabilities only. Provider-specific execution is unavailable until a plugin version and runner are connected.',
      assetTitle: 'Connect the cloud account',
      assetDescription: 'Only a display name and managed credential are required. The system discovers regions and resources after saving.',
    },
    state: {
      active: 'In progress',
      ready: 'Ready',
      incomplete: 'Incomplete',
      locked: 'Locked',
    },
    providerCard: {
      products: 'Declared frameworks',
    },
    summary: {
      provider: 'Provider',
      account: 'Account',
      credential: 'Credential',
    },
    autoDiscovery: {
      title: 'Automatic discovery',
      description: 'After saving, GCAC tests the connection and discovers Mainland China, International site, and other resources. You do not need to enter an endpoint or region.',
    },
  },
  aria: {
    accountForm: 'Cloud account form',
    operationForm: 'Opaque provider operation form',
  },
  detail: {
    title: 'Cloud service details',
    description: 'Read-only details for the selected cloud service.',
    resourcesTitle: 'Discovered resources',
    resourcesDescription: 'The account has one CDN control-plane device. Mainland China and International site are frameworks, and each CDN instance is a site.',
    devices: 'CDN control-plane devices',
    frameworks: 'Frameworks',
    sites: 'Sites',
    regions: 'Regions / zones',
    noFrameworks: 'No framework records.',
    noSites: 'No site records.',
    noRegions: 'No regions were returned by the provider.',
    noDevices: 'No CDN control-plane device was returned by the provider.',
  },
} as const

export const providersEnUS = english

export const providersZhCN = {
  page: {
    title: '云服务',
    description: '管理通用云账号资产，凭据只以引用保存。Provider 操作必须接入 PluginVersion 和 Runner。',
  },
  actions: {
    add: '添加云账号', edit: '编辑', save: '保存', cancel: '取消', test: '测试连接', discover: '发现资源', resources: '查看资源', execute: '执行操作', delete: '删除', previous: '上一步', next: '下一步',
  },
  fields: {
    displayName: '显示名称', provider: 'Provider', accountId: '账号标识', credentialProfile: '凭据引用', scope: 'Endpoint 与元数据', endpoint: 'Endpoint', metadataJson: 'Opaque 元数据 JSON', framework: 'Framework 类型', deviceCount: '控制面设备数量', frameworkCount: 'Framework 数量', siteCount: 'Site 数量', operation: 'Operation Key', targetJson: 'Opaque Target JSON', inputJson: 'Opaque Input JSON', status: '状态', actions: '操作', updatedAt: '更新时间',
  },
  placeholders: {
    displayName: '例如：生产云账号', accountId: '可选的账号标识', endpoint: '可选的 Endpoint URL', metadataJson: '{"key":"value"}', targetJson: '{"resourceId":"opaque-resource"}', inputJson: '{"property":"value"}',
  },
  sections: { providers: 'Provider 目录', accounts: '云账号资产', operation: 'Opaque Provider 操作' },
  messages: {
    loadFailed: '云 Provider 数据加载失败。', createFailed: '云账号资产创建失败。', saved: '云账号资产已创建。', savedAndDiscovered: '云账号已保存，并已自动发现资源。', updated: '云账号资产已更新。', deleted: '云账号资产已删除。', deleteConfirmText: 'DELETE', deleteRisk: '将删除云账号资产。', testCompleted: '连接测试完成。', testCompletedUnverified: '连接测试返回，但签名未被验证。', discoveryCompleted: '资源发现完成。', discoveryFailedAfterSave: '云账号已保存，但自动发现失败。请修复凭据或 Provider 权限后重试发现。', operationFailed: '云账号操作失败。', resourcesLoading: '正在加载已发现资源…', resourcesLoadFailed: '已发现资源加载失败。', operationCompleted: 'Provider 操作完成。', operationUnavailable: 'provider plugin version/runner 未接入，操作已失败关闭，宿主未执行。', operationOpaqueHint: '这些值只作为 opaque 描述保存和转发，宿主不会解释或执行厂商算法。', operationJsonInvalid: '请输入有效的 JSON 对象。', noAccounts: '暂无云账号资产。', noProviders: '暂无 Provider 定义。', noCapabilities: '暂无已声明操作。', credentialSelectHint: '请选择托管凭据，资产只保存 CredentialRef。', credentialHint: '这里只保存凭据引用，Provider 宿主不会解析密文。', metadataHint: '附加元数据以 opaque JSON 保存，宿主不会解释。', providerLocked: '已有资产不允许修改 Provider。', providerRequired: '请选择已启用的 Provider 插件。', providerUnavailable: '没有可用的已启用 Provider 插件或有效 Form 资源。', versionUnavailable: '当前资产版本不可用，请刷新列表后重试。', credentialRequired: '请先选择凭据引用。', metadataInvalid: '元数据 JSON 必须是对象。', scopeEmpty: '资源发现完成后自动显示区域', scopeInvalid: '作用域必须是有效的 JSON 对象。',
  },
  wizard: {
    ariaLabel: '云账号资产向导',
    steps: { provider: '选择 Provider', asset: '资产信息' },
    stepDescriptions: { provider: '选择 Provider 并查看它声明的操作描述。', asset: '填写显示名称和托管凭据，区域与资源由系统自动发现。' },
    panels: { providerTitle: '选择 Provider', providerDescription: '选择要连接的云服务 Provider。', assetTitle: '连接云账号', assetDescription: '这里只需要显示名称和托管凭据，保存后系统会自动测试连接并发现区域与资源。' },
    state: { active: '进行中', ready: '可保存', incomplete: '待完善', locked: '已锁定' },
    providerCard: { products: '已声明 Framework' },
    summary: { provider: 'Provider', account: '账号', credential: '凭据' },
    autoDiscovery: { title: '自动发现', description: '保存后 GCAC 会自动测试连接并发现中国大陆、国际站和其他资源，无需填写 Endpoint 或区域。' },
  },
  aria: { accountForm: '云账号资产表单', operationForm: 'Opaque Provider 操作表单' },
    detail: { title: '云服务详情', description: '查看选中云服务的只读详情。', resourcesTitle: '已发现资源', resourcesDescription: '账号只有一个 CDN 控制面设备；中国大陆和国际站是 Framework，每个 CDN 实例是一个 Site。', devices: 'CDN 控制面设备', frameworks: 'Framework', sites: 'Site', regions: 'CDN 区域', noDevices: 'Provider 没有返回 CDN 控制面设备。', noFrameworks: '暂无 Framework 记录。', noSites: '暂无 Site 记录。', noRegions: 'Provider 没有返回 CDN 区域信息。' },
} as const

export const providersZhTW = providersZhCN
export const providersFrFR = english
export const providersJaJP = english
export const providersRuRU = english
export const providersPtBR = english
export const providersKoKR = english
