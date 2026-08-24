const english = {
  page: {
    title: 'Cloud Services',
    description: 'Manage generic cloud assets and keep credentials as references. Provider operations require an attached PluginVersion and Runner.',
  },
  actions: {
    add: 'Add cloud account',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    test: 'Test connection',
    discover: 'Discover resources',
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
    accounts: 'Cloud account assets',
    operation: 'Opaque Provider operation',
  },
  messages: {
    loadFailed: 'Cloud Provider data could not be loaded.',
    createFailed: 'Cloud account asset could not be created.',
    saved: 'Cloud account asset created.',
    updated: 'Cloud account asset updated.',
    deleted: 'Cloud account asset deleted.',
    deleteConfirmText: 'DELETE',
    deleteRisk: 'This removes the cloud account asset.',
    testCompleted: 'Connection test completed.',
    discoveryCompleted: 'Resource discovery completed.',
    operationCompleted: 'Provider operation completed.',
    operationUnavailable: 'Provider PluginVersion/Runner is not connected. The operation was closed without execution.',
    operationOpaqueHint: 'The host stores and forwards these values as opaque descriptions. It does not interpret or execute provider algorithms.',
    operationJsonInvalid: 'Enter a valid JSON object.',
    noAccounts: 'No cloud account assets.',
    noProviders: 'No Provider definitions.',
    noCapabilities: 'No declared operations.',
    credentialSelectHint: 'Choose a managed credential. This asset stores only its CredentialRef.',
    credentialHint: 'Only the credential reference is stored. Secret material is not resolved in the Provider host.',
    metadataHint: 'Additional metadata is stored as opaque JSON and is not interpreted by the host.',
    providerLocked: 'The Provider of an existing asset cannot be changed.',
    providerRequired: 'Select an enabled Provider plugin.',
    providerUnavailable: 'No enabled Provider plugin with a valid Form resource is available.',
    versionUnavailable: 'The current asset version is unavailable. Refresh the list and try again.',
    credentialRequired: 'Select a credential reference first.',
    metadataInvalid: 'Metadata JSON must be an object.',
    scopeEmpty: 'No endpoint or metadata',
  },
  wizard: {
    ariaLabel: 'Cloud account asset wizard',
    steps: {
      provider: 'Provider',
      asset: 'Asset details',
    },
    stepDescriptions: {
      provider: 'Choose a Provider and review its declared operation descriptions.',
      asset: 'Save common asset fields, a CredentialRef, and opaque endpoint metadata.',
    },
    panels: {
      providerTitle: 'Choose a Provider',
      providerDescription: 'Provider entries describe capabilities only. Provider-specific execution is unavailable until a PluginVersion and Runner are connected.',
      assetTitle: 'Configure the common asset',
      assetDescription: 'Only common identity fields, a credential reference, endpoint, and opaque metadata are stored.',
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
  },
  aria: {
    accountForm: 'Cloud account asset form',
    operationForm: 'Opaque Provider operation form',
  },
  detail: {
    title: 'Cloud service details',
    description: 'Read-only details for the selected cloud service.',
  },
} as const

export const providersEnUS = english

export const providersZhCN = {
  page: {
    title: '云服务',
    description: '管理通用云账号资产，凭据只以引用保存。Provider 操作必须接入 PluginVersion 和 Runner。',
  },
  actions: {
    add: '添加云账号', edit: '编辑', save: '保存', cancel: '取消', test: '测试连接', discover: '发现资源', execute: '执行操作', delete: '删除', previous: '上一步', next: '下一步',
  },
  fields: {
    displayName: '显示名称', provider: 'Provider', accountId: '账号标识', credentialProfile: '凭据引用', scope: 'Endpoint 与元数据', endpoint: 'Endpoint', metadataJson: 'Opaque 元数据 JSON', framework: 'Framework 类型', operation: 'Operation Key', targetJson: 'Opaque Target JSON', inputJson: 'Opaque Input JSON', status: '状态', actions: '操作', updatedAt: '更新时间',
  },
  placeholders: {
    displayName: '例如：生产云账号', accountId: '可选的账号标识', endpoint: '可选的 Endpoint URL', metadataJson: '{"key":"value"}', targetJson: '{"resourceId":"opaque-resource"}', inputJson: '{"property":"value"}',
  },
  sections: { providers: 'Provider 目录', accounts: '云账号资产', operation: 'Opaque Provider 操作' },
  messages: {
    loadFailed: '云 Provider 数据加载失败。', createFailed: '云账号资产创建失败。', saved: '云账号资产已创建。', updated: '云账号资产已更新。', deleted: '云账号资产已删除。', deleteConfirmText: 'DELETE', deleteRisk: '将删除云账号资产。', testCompleted: '连接测试完成。', discoveryCompleted: '资源发现完成。', operationCompleted: 'Provider 操作完成。', operationUnavailable: 'Provider PluginVersion/Runner 未接入，操作已失败关闭，宿主未执行。', operationOpaqueHint: '这些值只作为 opaque 描述保存和转发，宿主不会解释或执行厂商算法。', operationJsonInvalid: '请输入有效的 JSON 对象。', noAccounts: '暂无云账号资产。', noProviders: '暂无 Provider 定义。', noCapabilities: '暂无已声明操作。', credentialSelectHint: '请选择托管凭据，资产只保存 CredentialRef。', credentialHint: '这里只保存凭据引用，Provider 宿主不会解析密文。', metadataHint: '附加元数据以 opaque JSON 保存，宿主不会解释。', providerLocked: '已有资产不允许修改 Provider。', providerRequired: '请选择已启用的 Provider 插件。', providerUnavailable: '没有可用的已启用 Provider 插件或有效 Form 资源。', versionUnavailable: '当前资产版本不可用，请刷新列表后重试。', credentialRequired: '请先选择凭据引用。', metadataInvalid: '元数据 JSON 必须是对象。', scopeEmpty: '未填写 Endpoint 或元数据',
  },
  wizard: {
    ariaLabel: '云账号资产向导',
    steps: { provider: '选择 Provider', asset: '资产信息' },
    stepDescriptions: { provider: '选择 Provider 并查看它声明的操作描述。', asset: '保存通用资产字段、CredentialRef 以及 opaque Endpoint 元数据。' },
    panels: { providerTitle: '选择 Provider', providerDescription: 'Provider 条目只描述能力；接入 PluginVersion 和 Runner 前不会执行厂商操作。', assetTitle: '配置通用资产', assetDescription: '这里只保存通用身份字段、凭据引用、Endpoint 和 opaque 元数据。' },
    state: { active: '进行中', ready: '可保存', incomplete: '待完善', locked: '已锁定' },
    providerCard: { products: '已声明 Framework' },
    summary: { provider: 'Provider', account: '账号', credential: '凭据' },
  },
  aria: { accountForm: '云账号资产表单', operationForm: 'Opaque Provider 操作表单' },
  detail: { title: '云服务详情', description: '查看选中云服务的只读详情。' },
} as const

export const providersZhTW = providersZhCN
export const providersFrFR = english
export const providersJaJP = english
export const providersRuRU = english
export const providersPtBR = english
export const providersKoKR = english
