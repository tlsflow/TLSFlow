// Auto-generated from messages.ts — do not edit manually.
// Edit messages.ts and re-run: npx tsx src/i18n/extract-locales.ts
import { devicesZhCN } from './devices.locale'
import { caOperationsZhCN } from './ca-operations.locale'
import { credentialsZhCN } from './credentials.locale'
export default {
  credentials: credentialsZhCN,
  devices: devicesZhCN,
  caOperations: caOperationsZhCN,
  app: {
    brand: 'GCAC 控制台',
    platform: '企业 SSL 证书生命周期管理平台',
    defaultBreadcrumb: '控制台',
    dashboard: '仪表盘',
    versionLabel: '版本 {version}'
  },
  common: {
    refresh: '刷新',
    logout: '退出',
    enter: '进入',
    loading: '加载中',
    actions: { done: '完成' },
    cancel: '取消',
    save: '保存',
    edit: '编辑',
    delete: '删除',
    notAvailable: '暂无',
    unknownError: '未知错误',
    userFallback: '未登录用户',
    tenantFallback: '默认租户'
  },
  api: {
    errors: {
      requestFailed: '请求失败'
    }
  },
  auth: {
    errors: {
      missingSession: '登录失败，未获取到有效会话'
    },
    mock: {
      displayName: '系统用户（Mock）'
    }
  },
  designSystem: {
    confirm: {
      title: '确认{action}',
      impactCount: '影响资源数量：{count}',
      defaultRisk: '该操作可能触发部署、重试、回滚或不可逆变更。',
      typeToConfirm: '输入 {text} 二次确认',
      cancel: '取消',
      confirm: '确认'
    },
    dataTable: {
      empty: '暂无数据',
      loading: '加载中...'
    },
    dryRunChecklist: {
      title: 'Dry-run 预检结论',
      ariaLabel: 'dry-run 预检结论',
      empty: '尚未生成 dry-run 预检结果。',
      unnamedCheck: '未命名检查项'
    },
    dryRunResult: {
      title: 'Dry-run 执行结果',
      close: '关闭'
    },
    modal: {
      closeAria: '关闭弹窗'
    },
    secretInput: {
      label: 'Secret 引用',
      placeholder: '选择或输入密文引用（SecretRef），内容不会明文存储',
      hint: '敏感字段仅存储密文引用，不会在界面明文展示。'
    },
    riskBadge: {
      levelPrefix: '级别：'
    },
    status: {
      DRAFT: '草稿',
      PUBLISHED: '已发布',
      PENDING_APPROVAL: '待审批',
      READY: '待执行',
      RUNNING: '执行中',
      SUCCESS: '成功',
      PARTIAL_SUCCESS: '部分成功',
      FAILED: '失败',
      CANCELLED: '已取消',
      ROLLED_BACK: '已回滚',
      DISCOVERED: '已发现',
      MANAGED: '已纳管',
      DRIFTED: '已漂移',
      EXPIRED: '已过期',
      ERROR: '异常',
      IGNORED: '已忽略',
      ONLINE: '在线',
      OFFLINE: '离线',
      ACTIVE: '已启用',
      DISABLED: '已停用',
      UPGRADING: '升级中',
      UPDATE_REQUIRED: '需更新',
      UP_TO_DATE: '已最新',
      UNKNOWN: '未知'
    },
    risk: {
      LOW: {
        label: '低',
        description: '需要关注，但不会直接阻断操作。'
      },
      MEDIUM: {
        label: '中',
        description: '可能影响部署或监控结果，需要确认。'
      },
      HIGH: {
        label: '高',
        description: '可能导致服务中断或安全暴露。'
      },
      CRITICAL: {
        label: '严重',
        description: '必须优先处理，危险操作需二次确认。'
      }
    },
    capability: {
      available: '具备',
      missing: '缺失',
      title: '能力兼容性',
      description: '仅展示已确认的能力兼容性结果，未确认项不视为支持。',
      matrixLabel: '能力兼容性矩阵',
      satisfied: '满足',
      unknown: '未知',
      manualRisk: '人工确认',
      empty: '暂无能力兼容性数据。'
    },
    executionLogViewer: {
      mode: {
        realtime: '实时更新',
        autoRefresh: '自动刷新'
      },
      search: {
        placeholder: '搜索日志内容'
      },
      level: {
        aria: '日志级别',
        all: '全部'
      },
      hint: {
        streaming: '任务状态与日志会持续实时更新。',
        autoRefresh: '任务状态与日志会自动刷新。',
        pollingFallback: '当前使用定时刷新模式。'
      },
      steps: {
        aria: '执行步骤',
        emptyDetail: '暂无步骤说明'
      },
      empty: {
        logs: '暂无日志。'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: '执行进度总览',
        taskList: '任务列表',
        latestEvents: '最新事件',
        executionLog: '详细记录'
      },
      checklist: {
        title: '检查结论'
      },
      detail: {
        stepsCompleted: '{completed}/{total} 步骤已完成',
        summaryFailed: '{total} 项检查结果已返回，{failed} 项失败',
        summaryPassed: '{passed} 项检查全部通过',
        summaryReturned: '{total} 项检查结果已返回',
        summaryWarning: '{total} 项检查结果已返回，{warning} 项警告',
        waitingStart: '等待任务开始执行',
        waitingSteps: '等待执行步骤…'
      },
      empty: {
        activity: '执行动态将在步骤开始后显示。',
        events: '暂无事件记录。',
        tasks: '任务尚未创建，等待执行步骤…'
      },
      event: {
        collapse: '收起事件',
        defaultLabel: '事件',
        defaultTitle: '任务事件',
        expand: '展开事件',
        waitingDetail: '等待事件记录'
      },
      feed: {
        completed: '执行完成',
        failed: '执行失败',
        warning: '完成，带警告'
      },
      loading: {
        pollingFallback: '正在定时刷新…',
        refreshing: '刷新中'
      },
      log: {
        collapse: '收起完整日志',
        expand: '查看详细记录'
      },
      metrics: {
        completed: '已完成',
        failed: '失败',
        passed: '通过',
        queued: '排队中',
        running: '执行中',
        totalTasks: '总任务',
        unknown: '未知',
        warning: '警告'
      },
      process: {
        dryRun: '更新检查',
        execution: '执行'
      },
      operation: {
        prepare: '检查证书材料和目标状态，为更新做好准备。',
        backup: '保存当前状态，确保需要时可以安全恢复。',
        update: '将新证书安全应用到目标服务。',
        reload: '让服务加载新证书，并等待运行状态稳定。',
        verify: '检查服务是否已正确使用新证书。',
        rollback: '恢复更新前的证书和服务状态。'
      },
      progress: {
        completed: '全部完成',
        failed: '已完成，存在失败项',
        pending: '等待结果回写',
        processFailed: '{process} 失败',
        queued: '等待调度',
        running: '任务推进中',
        warning: '已完成，存在风险提示'
      },
      section: {
        completedCount: '{completed}/{total} 已完成',
        executionLog: '执行动态',
        latestEvents: '最新事件',
        taskProgress: '任务进度'
      },
      status: {
        completed: '已完成',
        failed: '失败',
        queued: '等待中',
        running: '执行中',
        warning: '有警告'
      },
      step: {
        backup: '备份',
        discover: '证书准备',
        prepare: '证书准备',
        installDryRun: '更新',
        installExecution: '更新',
        updateDryRun: '更新',
        updateExecution: '更新',
        reload: '重载',
        verify: '验证'
      },
      subtitle: {
        completed: '任务已完成。',
        failed: '任务已结束，但返回了失败结果。',
        failedFriendly: '此步骤未能完成，请展开详细记录查看原因。',
        failedChecks: '{total} 项检查，{failed} 项失败',
        passedChecks: '{total} 项检查通过',
        queued: '任务已创建，等待执行。',
        running: '任务已开始，等待执行结果。',
        runningChecks: '已返回 {total} 项检查',
        warningChecks: '{total} 项检查，{warning} 项警告'
      },
      time: {
        waitingStart: '等待开始'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: '取消',
        dryRun: '先做 Dry-run',
        next: '下一步',
        previous: '上一步',
        save: '保存计划'
      },
      aria: {
        steps: '部署步骤',
        wizard: '部署向导'
      },
      capability: {
        targetMissingDetail: '尚未选择部署目标。',
        targetSelectedDetail: '已选择部署目标，建议先完成 dry-run 再提交执行。',
        targetSelection: '部署目标选择',
        targetSource: '部署目标'
      },
      checks: {
        failed: '失败 {count}',
        passed: '通过 {count}',
        unknown: '未知 {count}',
        unnamed: '未命名检查项',
        warning: '警告 {count}'
      },
      empty: {
        noTargets: '暂无可选应用资产目标',
        selectTarget: '请选择一个应用资产部署目标。'
      },
      fallback: {
        generatedByApplicationEntry: '按应用入口生成',
        missingBinding: '未提供绑定信息',
        unboundCertificateVariable: '未绑定证书变量',
        unconfigured: '未配置',
        unconfiguredRunner: '未配置运行位置',
        unknownEnd: '未知结束',
        unknownStart: '未知开始',
        unnamedSite: '未命名站点',
        unnamedVersion: '未命名版本',
        unrecognizedManagedTarget: '未识别受管目标',
        unselected: '未选择',
        unselectedVersion: '未选择版本',
        unselectedWorkflow: '未选择工作流'
      },
      fields: {
        applicationTarget: '应用资产部署目标',
        artifactConfig: '产物配置',
        binding: '绑定',
        certificateAsset: '证书资产',
        certificateVariable: '证书变量',
        certificateVersion: '证书版本',
        deploymentTarget: '部署目标',
        keyword: '关键字检索',
        managedTarget: '受管目标',
        runner: '运行位置',
        site: '站点',
        verifyUrl: '验证 URL',
        version: '版本',
        workflow: '工作流'
      },
      panels: {
        certificateTitle: '1. 证书材料',
        submitTitle: '3. 预检与提交',
        targetTitle: '2. 部署目标'
      },
      panelState: {
        needPrerequisites: '待完成前置选择',
        operable: '可操作',
        pending: '待完成',
        readyNext: '可进入下一步'
      },
      placeholders: {
        selectTarget: '请选择应用资产目标',
        targetKeyword: '按域名、站点、绑定信息检索'
      },
      plan: {
        dryRunCompleted: '最近一次 dry-run 已完成。',
        submitCompleted: '最近一次提交已完成。'
      },
      preview: {
        needCertificate: '先完成证书材料选择。',
        needTarget: '完成证书材料选择后，再指定要下发的应用资产目标。',
        ready: '将把已选证书版本部署到 {count} 个应用资产目标。'
      },
      status: {
        checksReturned: '预检结果已返回，可根据结果决定保存、提交或直接执行。',
        current: '当前状态',
        default: '建议先发起 dry-run，再决定是否提交执行。',
        dryRunStarted: '预检已发起，请在执行结果区查看进度。',
        submitted: '计划已提交。'
      },
      steps: {
        certificate: {
          description: '证书资产与版本',
          title: '选择证书材料'
        },
        submit: {
          description: 'Dry-run、保存、提交、执行',
          title: '预检并提交'
        },
        target: {
          description: '应用资产、站点与绑定',
          title: '选择部署目标'
        }
      },
      stepState: {
        active: '进行中',
        done: '已完成',
        pending: '待开始'
      },
      target: {
        workflowMode: '工作流模式'
      },
      version: {
        autoLatest: '自动选择最新可部署版本（当前：{current}）',
        noDeployableVersion: '当前暂无可部署证书版本',
        range: '{id} ({notBefore} ~ {notAfter})'
      },
      currentStep: '步骤 {current} / {total}',
      selectedTargetCount: '已选 {count} 个目标',
      subtitle: '分步骤完成部署计划配置',
      title: '部署向导'
    }
  },
  shell: {
    currentLocation: '当前位置',
    breadcrumb: '面包屑',
    currentGroupNavigation: '当前分组导航',
    backDashboard: '返回仪表盘'
  },
  preferences: {
    theme: '主题',
    language: '语言',
    themeLight: '日间模式',
    themeDark: '夜间模式',
    themeToggle: '切换主题模式',
    languageSelect: '选择界面语言',
    title: '显示偏好',
    description: '主题和语言会保存到当前用户的后端偏好。',
    errors: {
      loadFailed: '偏好加载失败',
      saveFailed: '偏好保存失败'
    }
  },
  userMenu: {
    currentUser: '当前用户',
    changePassword: '修改密码',
    logout: '退出登录'
  },
  password: {
    title: '修改密码',
    description: '修改当前登录用户的本地密码。',
    current: '当前密码',
    new: '新密码',
    confirm: '确认新密码',
    cancel: '取消',
    submit: '保存密码',
    submitting: '正在保存…',
    success: '密码已更新',
    failed: '密码修改失败',
    mismatch: '两次输入的新密码不一致',
    tooShort: '新密码长度不能少于 8 位'
  },
  nav: {
    dashboard: '总览',
    dashboardDesc: '应用、证书、Agent、网关和审计状态总览',
    certificates: '证书',
    certificatesDesc: '证书库、绑定关系和到期状态',
    certificateAssets: '证书资产',
    certificateAssetsDesc: '证书、私钥引用、指纹和到期时间',
    certificateFormats: '证书格式配置',
    certificateFormatsDesc: '为已保存证书定义 PFX、CER、CRT、PEM 等格式规则',
    assets: '应用资产',
    assetsDesc: '域名/IP 维度的应用入口与证书部署目标',
    agents: 'Agent',
    agentsDesc: '在线状态、心跳和能力集合',
    gateways: '网关',
    gatewaysDesc: '隔离区网关、协议和可达目标',
    deployments: '证书部署',
    deploymentsDesc: '部署计划、工作流、自动化和执行记录',
    deploymentPlans: '部署计划',
    deploymentPlansDesc: '证书部署计划和审批入口',
    executions: '执行记录',
    executionsDesc: '执行步骤、日志、失败和回滚',
    workflows: '工作流',
    workflowsDesc: '工作流和插件',
    workflowTemplates: '工作流',
    workflowTemplatesDesc: '画布草稿、变量、能力声明和发布',
    automations: '自动化',
    automationsDesc: '定时、按需和批量执行证书更新计划',
    plugins: '插件',
    pluginsDesc: 'Provider、执行器和沙箱状态',
    monitoring: '监控',
    monitoringDesc: '告警、审计和证书状态',
    monitorAlerts: '监控告警',
    monitorAlertsDesc: '到期、漂移和执行失败事件',
    audits: '审计日志',
    auditsDesc: '操作证据与合规导出',
    reports: '报表',
    reportsDesc: '证书事故窗口、风险处置和自动化成效',
    incidentWindowReport: '事故窗口',
    incidentWindowReportDesc: '即将到期和已过期证书的处置优先级',
    riskResponseReport: '风险处置',
    riskResponseReportDesc: '风险确认、解决时长和 SLA',
    automationEffectivenessReport: '自动化成效',
    automationEffectivenessReportDesc: '运行级、目标级成功率和失败阶段',
    settings: '设置',
    settingsDesc: '租户、用户、权限和系统配置',
    systemSettings: '系统设置',
    systemSettingsDesc: '系统配置和安全元数据',
    users: '用户管理',
    usersDesc: '控制台用户、状态和角色',
    roles: '权限管理',
    rolesDesc: '角色、授权对象范围和成员分配',
    identitySources: '身份源',
    identitySourcesDesc: 'AD/LDAP 服务配置',
    groupRoleMappings: '组角色映射'
  },
  automations: {
    title: '自动化',
    description: '集中管理证书更新计划的定时、按需和批量执行。',
    empty: '暂无自动化配置。',
    emptyDescription: '未填写说明',
    common: { notAvailable: '暂无' },
    formStep: { stepProgress: '第 {current} 步，共 {total} 步', previous: '上一步', next: '下一步', reviewTitle: '配置摘要', reviewText: '将处理 {domains}，证书版本策略为：{version}。运行开始后会冻结目标快照。' },
    scheduleBuilder: { api: '通过外部 API 触发', apiHelp: '保存后由外部系统调用自动化运行 API。每次调用仍会执行目标预览、Dry Run 和审批规则。', once: '在固定时间执行一次', onceHelp: '选择浏览器本地时间。任务执行一次后不会再次排期。', recurring: '定期执行', scheduleHelp: '按计划周期执行。仅建议用于确实需要持续轮询的场景。', recurringHelp: '按计划周期执行。仅建议用于确实需要持续轮询的场景。', recurringWarningTitle: '证书更新不建议使用定期执行', recurringWarning: '证书换证通常应由外部系统在证书签发后触发，或安排一次固定时间执行。只有明确需要周期检查时才使用此选项。', runAt: '执行时间', frequency: '执行周期', daily: '每天', weekly: '每周', monthly: '每月', time: '执行时刻', weekday: '星期', monthDay: '每月日期', legacyCustom: '保留原有自定义计划', legacyCron: '原有 Cron（只读）', weekdays: { 0: '星期日', 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六' } },
    form: { existingAssetTitle: '只更新现有应用资产', existingAssetDescription: '自动化只处理已经建立证书绑定的应用资产，不负责首次安装证书或新增部署目标。', certificateDomains: '证书域名', certificateDomainsPlaceholder: '输入证书域名，多个用逗号分隔', certificateDomainsHelp: '只更新这些域名对应证书的现有应用资产绑定。', versionSelection: '更新到哪个证书版本', versionSelectionLatest: '自动使用最新证书版本', versionSelectionSpecific: '使用指定证书版本', versionSelectionHelp: '运行开始时解析并冻结版本，运行期间不会因新增版本而改变。', certificateVersionIds: '指定证书版本', certificateVersionIdsPlaceholder: '输入证书版本 ID，多个用逗号分隔', certificateVersionIdsHelp: '每个版本必须属于上面所选域名对应的证书。', versionLoading: '正在加载可选证书版本。', versionLoadFailed: '证书版本加载失败，请稍后重试。', versionEmpty: '没有找到这些域名对应的可选证书版本。', schedule: '什么时候更新', scheduleHelp: '可由管理员按需启动，也可以按 Cron 和时区定期检查并更新。', execution: '运行时会做什么', executionHelp: '系统为每个现有资产绑定创建独立更新计划，并复用 DeploymentPlan、Dry Run、审批和 ExecutionRun。', snapshot: '冻结域名、资产和证书版本快照' },
    fields: { name: '名称', description: '说明', trigger: '触发方式', cron: 'Cron 表达式', timeZone: '时区', expiresWithinDays: '到期天数范围', environments: '目标环境（逗号分隔）', certificateIds: '指定证书（可选）', certificateIdsPlaceholder: '输入证书 ID，多个用逗号分隔', certificateIdsHelp: '填写后只处理指定证书；留空则按到期范围和环境自动匹配。', expiresWithinDaysHelp: '只匹配在此天数内到期的证书。', environmentsHelp: '只处理这些环境中的证书，例如 production, staging。', planType: '部署计划类型', planTypeHelp: '每个命中的证书目标都会在运行时创建一份独立的 DeploymentPlan。', planTypeUpdate: '更新现有证书绑定', planTypeInstall: '安装证书到目标', planTypeVerifyOnly: '只验证，不变更证书', planMode: '运行方式', planModeHelp: '自动化不绑定已有计划；运行时会为每个目标创建新计划。', planModeCreateAndExecute: '创建计划并执行', planModeCreateOnly: '只创建计划，暂不执行', maxTargets: '单次最大目标数', concurrency: '并发数', failureCount: '失败数量阈值', requireDryRun: '执行前必须完成 Dry Run', requireApproval: '执行前必须审批', startedAt: '开始时间', finishedAt: '结束时间', failureStage: '失败阶段', parentRun: '父运行' },
    actions: { create: '新建自动化', edit: '编辑', delete: '删除', cancel: '取消', save: '保存', copy: '复制', enable: '启用', disable: '停用', preview: '预览目标', history: '运行历史', confirmRun: '确认执行', stop: '停止运行', retryFailed: '重试失败目标', openPlan: '查看部署计划', openExecution: '查看执行记录' },
    columns: { trigger: '触发方式', targets: '目标上限', actions: '执行动作', nextRun: '下次运行', lastRun: '最近运行' },
    triggers: { onDemand: '按需执行', schedule: '定时执行' },
    triggerTypes: { on_demand: '按需执行', schedule: '定时执行', retry: '失败重试' },
    actionTypes: { create_deployment_plan: '创建证书更新计划', execute_deployment_plan: '执行证书更新计划', send_notification: '发送通知' },
    summaries: { targets: '最多 {count} 个目标' },
    preview: { title: '目标预览', description: '确认启动时将被冻结的目标快照及排除原因。', matched: '匹配 {count} 项', executable: '可执行 {count} 项', excluded: '排除 {count} 项', ready: '可执行' },
    exclusions: { permission_denied: '无目标权限', missing_version: '缺少证书版本', version_not_deployable: '证书版本不可部署', binding_not_managed: '绑定未纳管', environment_not_allowed: '环境不在允许范围', unknown: '未知排除原因' },
    failureStages: { selection: '目标选择', plan_creation: '计划创建', dry_run: 'Dry Run', approval: '审批', execution: '执行', verification: '验证', rollback: '回滚', notification: '通知' },
    progress: { total: '总数', pending: '等待中', running: '执行中', waitingApproval: '等待审批', succeeded: '成功', failed: '失败', skipped: '已跳过', cancelled: '已取消' },
    editor: { createTitle: '新建自动化', editTitle: '编辑自动化', description: '配置何时运行、处理哪些证书、如何创建部署计划以及失败时的安全边界。', sections: { basic: '基本信息', basicHelp: '给自动化一个容易识别的名称，说明它负责哪类证书变更。', targets: '处理哪些证书', targetsHelp: '这里选择的是证书目标，不是已有部署计划；运行开始时会冻结目标快照。', plan: '证书部署计划', planRelationTitle: '不会绑定已有部署计划', planRelationDescription: '自动化会根据上面的证书筛选条件，在每次运行时创建部署计划。', planRelationHelp: '每个命中的证书目标对应一份独立 DeploymentPlan，计划 ID 会在运行详情中显示；这样不同证书不会共用错误的目标快照。', guardrails: '执行安全控制', guardrailsHelp: '这些限制决定一次最多处理多少目标、是否先预检/审批，以及失败后何时停止。' }, chain: { createPlan: '按目标创建 DeploymentPlan', dryRun: '执行 Dry Run 预检', approval: '等待审批通过', executePlan: '执行该目标的 DeploymentPlan' } },
    runs: { title: '自动化运行历史', description: '查看运行级状态、不可变目标快照和失败阶段。', progress: '{succeeded}/{total} 成功' },
    runDetail: { title: '自动化运行详情', description: '配置版本 {version}', noFailure: '未发生失败' },
    aria: { preview: '自动化目标预览', runs: '自动化运行列表', progress: '自动化运行进度' },
    errors: { loadFailed: '自动化列表加载失败' }
  },
  routes: {
    certificateImport: '导入证书',
    certificateDetail: '证书详情',
    certificateUsages: '使用关系',
    certificateFormats: '格式产物'
  },
  businessPage: {
    request: {
      notRequested: '尚未请求'
    },
    error: {
      unknown: '未知错误'
    },
    primaryActionFailed: '主操作执行失败',
    processing: '处理中…',
    metricsAria: '业务指标',
    apiFailed: '服务请求失败',
    errorCode: '错误码：{code}',
    retry: '重试',
    resourceList: '{resource}列表',
    total: '总数 {count}',
    dangerConfirmRequired: '高风险操作需确认',
    all: '全部',
    clearFilters: '清空筛选',
    pagination: '第 {page} 页 / 每页 {pageSize} 条',
    resourceDetailAria: '资源详情',
    resourceDetailTitle: '{resource}详情',
    contextAria: '上下文入口',
    resourceActionsAria: '资源操作',
    resourceActionsTitle: '资源操作',
    resourceActionsHint: '高风险操作需二次确认，最终以系统授权校验为准。'
  },
  executionDetail: {
    error: {
      loadStepsFailed: '查询执行步骤失败',
      streamConnectFailed: '执行详情更新连接失败'
    },
    step: {
      nameFallback: '步骤 {index}',
      dryRunCheckSummary: '预检结论：通过 {passed} / 警告 {warning} / 失败 {failed} / 未知 {unknown}。{topChecks}',
      dryRunPending: {
        queued: '当前仍在队列中，尚未开始执行。',
        running: '当前步骤执行中，等待 Agent 返回预检结果。',
        failed: '当前步骤执行失败，尚未获取预检结果。',
        finished: '当前步骤已结束，尚未获取预检结果。'
      },
      dryRunDiscover: '只读预检：识别部署目标与 {providerLabel} 站点信息。站点 {siteName}，绑定 {binding}。{pendingText}',
      dryRunVerify: '只读预检：校验证书材料、目标绑定和域名匹配。目标 {providerLabel} 绑定 {binding}。{pendingText}',
      dryRunCreated: '只读预检已创建。{pendingText}',
      failure: {
        emptyMessage: '未收到具体错误信息'
      },
      running: {
        dispatched: 'Agent 任务已下发（{taskId}），等待执行结果。',
        waitingAgentResult: '步骤执行中，等待 Agent 返回结果…'
      },
      pending: {
        waitingDependency: '步骤等待前置步骤完成。'
      },
      verifyRecovered: {
        detail: 'Agent 侧远程 TLS 探测失败，但系统已对 {remoteTarget} 完成真实 TLS 验证并确认目标证书匹配。{originalError}',
        originalSuffix: '原始 Agent 错误：{originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} 已返回。Agent taskId={taskId}',
        withoutTask: '{executor} {mode} 已返回。'
      },
      createdFallback: '步骤 {index} 已创建，等待执行详情…'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run 执行失败',
        detail: '已有 {failedStepCount} 个预检步骤失败或超时，未收到结构化预检结论。'
      },
      queued: {
        label: 'Dry-run 排队中',
        detail: '预检任务已创建，等待开始执行。'
      },
      running: {
        label: 'Dry-run 执行中',
        detail: '预检已开始，等待结果返回。'
      },
      pending: {
        label: 'Dry-run 已结束但无结论',
        detail: '共有 {finishedWithoutChecks} 个步骤已结束，但未收到预检结论。'
      },
      receiving: {
        label: 'Dry-run 接收中',
        detail: '已收到部分结论：通过 {passed}，警告 {warning}，失败 {failed}，未知 {unknown}。'
      },
      failed: {
        label: 'Dry-run 失败',
        detail: '预检失败 {failed} 项，警告 {warning} 项，通过 {passed} 项。'
      },
      warning: {
        label: 'Dry-run 有风险提示',
        detail: '预检已完成：通过 {passed} 项，警告 {warning} 项，未知 {unknown} 项。'
      },
      passed: {
        label: 'Dry-run 成功',
        detail: '预检全部通过，共 {passed} 项。'
      }
    },
    agent: {
      taskSuffix: '（Agent taskId={taskId}）'
    },
    log: {
      verifyRecovered: '[ControlPlane] Agent 侧远程 TLS 探测失败，但系统已完成真实 TLS 验证并确认目标证书匹配。'
    },
    workflowStep: {
      failedDefault: '工作流节点 {index} 执行失败',
      skipped: '工作流节点已跳过，条件未满足。',
      successAssertions: '工作流节点执行成功，断言通过 {passed}/{total}。',
      success: '工作流节点执行成功。'
    },
    binding: {
      hostMissing: '未提供主机头（Host Header）'
    },
    site: {
      unnamed: '未命名站点'
    },
    provider: {
      target: '目标'
    }
  },
  executions: {
    title: '执行记录',
    description: '查看部署执行状态、步骤日志、dry-run 预检结论、失败原因和回滚入口。',
    resourceName: '执行记录',
    errors: {
      streamConnectFailed: '执行详情更新连接失败：HTTP {status}',
      loadFailed: '执行记录加载失败'
    },
    actions: {
      refreshList: '刷新列表',
      refreshing: '正在刷新',
      viewDetail: '查看详情',
      rollback: '发起回滚',
      rollbackRisk: '回滚会再次改动目标服务证书配置，必须确认备份引用和影响范围。'
    },
    columns: {
      name: '执行编号',
      status: '状态',
      risk: '风险',
      planId: '部署计划',
      startedAt: '开始时间'
    },
    metrics: {
      total: {
        title: '执行总数',
        description: '当前可追踪的执行记录。'
      },
      risky: {
        title: '高危待处理',
        description: '失败、部分成功或需要回滚的执行。'
      }
    },
    fields: {
      executionId: '执行 ID',
      deploymentPlan: '部署计划',
      runType: '运行类型',
      status: '执行状态',
      target: '执行目标',
      externalRunId: '外部运行 ID',
      startedAt: '开始时间',
      finishedAt: '结束时间',
      errorCode: '错误码',
      failureReason: '失败原因'
    },
    links: {
      deploymentPlan: '查看部署计划',
      auditEvents: '查看审计事件'
    },
    empty: {
      title: '暂无执行记录',
      description: '部署计划执行后会在这里展示日志、状态和审计关联。'
    },
    list: {
      ariaLabel: '执行记录列表',
      title: '执行记录列表',
      summary: '共 {total} 条执行记录，按开始时间倒序排列。',
      range: '显示 {start}-{end} / {total}',
      assetsLabel: '资产',
      logLabel: '日志概要',
      runNumber: '第 {number} 次',
      planUnknown: '未关联部署计划',
      assetUnknown: '未记录对应资产',
      timeUnknown: '未记录开始时间',
      logRunning: '执行正在进行，详情日志会持续更新。',
      logPending: '执行已进入队列，等待调度。',
      logFailed: '执行失败，错误码：{code}',
      logSuccess: '执行成功，耗时 {duration}。',
      logCompleted: '执行已结束，可打开详情查看完整日志。',
      errorCodeUnknown: '未记录',
      durationUnknown: '未知',
      durationSeconds: '{count} 秒',
      durationMinutes: '{count} 分钟',
      viewDetailHint: '点击查看详情',
      openDetailAria: '查看计划 {plan} 的执行记录 {id}',
      previousPage: '上一页',
      nextPage: '下一页',
      pageSummary: '第 {page} / {pages} 页'
    },
    types: {
      dryRun: '预检',
      apply: '正式执行',
      rollback: '回滚',
      retry: '重试',
      unknown: '其他执行'
    },
    summary: {
      passed: '通过',
      warning: '警告',
      failed: '失败',
      unknown: '未知'
    },
    detail: {
      title: '执行详情',
      titleWithId: '执行详情 {id}',
      description: '查看执行记录的基本信息、步骤状态和日志。',
      eyebrow: '执行记录',
      planLabel: '部署计划 {plan}',
      loadingSteps: '正在加载步骤...',
      loadingLogs: '正在加载日志...',
      noStepDetail: '暂无步骤说明',
      notStarted: '未开始',
      noSteps: '暂无步骤。',
      noLogs: '暂无日志。'
    },
    tabs: {
      summary: '概览',
      steps: '步骤',
      logs: '日志'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: '连接地址', connectionPort: '连接端口', basePath: '基础路径', timeoutSeconds: '超时秒数', gateway: '执行 Gateway',
      authenticationMode: '认证方式', credential: '设备管理凭据', username: '用户名', passwordSecret: '密码 SecretRef', apiTokenSecret: 'API Token SecretRef', clientCertificate: '客户端证书',
      tlsEnabled: '启用 TLS', tlsVerifyPeer: '验证服务端证书', tlsServerName: 'TLS Server Name', caSecret: 'CA SecretRef', tlsMinimumVersion: '最低 TLS 版本',
      deviceDisplayName: '设备显示名称', deviceDescription: '设备说明', deviceTags: '设备标签', targetName: '目标名称', targetLabels: '目标标签'
    },
    forms: { loadOptions: '加载选项', previewTitle: '插件配置表单', loading: '正在加载插件表单...', loadFailed: '插件表单加载失败', empty: '此插件未声明配置表单。' },
    presentation: { previewTitle: '设备标准展示预览', sensitiveValue: '敏感值已隐藏', tabsAriaLabel: '设备信息标签页' },
    title: '插件',
    description: '浏览内置与用户自定义 DSL 模板，并以插件形式统一管理版本、Logo 和模板能力。',
    resourceName: '插件',
    actions: {
      install: '安装插件',
      detail: '详情',
      create: '创建',
      refresh: '刷新市场',
      refreshing: '刷新中...',
      createWorkflow: '创建工作流',
      creatingWorkflow: '创建中...',
      enable: '启用',
      disabling: '禁用中...',
      disable: '禁用',
      disableRisk: '禁用插件会影响 Provider、模板和执行器能力。'
    },
    market: {
      eyebrow: 'DSL 插件市场',
      title: '发现可复用的自动化能力',
      description: '内置模板随系统发布，用户模板来自 data/workflows。每个模板都可以维护独立 Logo、语义版本和能力标签。'
    },
    sources: {
      builtin: '内置插件',
      user: '用户插件'
    },
    statuses: {
      valid: '可用',
      invalid: '无效',
      available: '可创建',
      enabled: '已启用',
      disabled: '未启用',
      pendingApproval: '待审批',
      inUse: '正在使用',
      notInUse: '尚未使用'
    },
    filters: {
      searchLabel: '搜索插件',
      searchPlaceholder: '按名称、标签、分类或路径搜索',
      allSources: '全部来源',
      allStatuses: '全部状态',
      statusLabel: '插件状态'
    },
    card: {
      defaultDescription: '该 DSL 插件尚未配置说明。',
      unversioned: '未标注版本',
      stepCount: '{count} 个执行步骤',
      moreTags: '另 {count} 项'
    },
    columns: {
      name: '插件名称',
      status: '状态',
      risk: '风险',
      version: '版本',
      signature: '签名'
    },
    metrics: {
      total: {
        title: '插件总数',
        description: '已安装和可升级插件。'
      },
      builtin: { title: '内置插件' },
      user: { title: '用户插件' },
      using: { title: '正在使用' },
      risky: {
        title: '高危待处理',
        description: '高危权限、签名异常或沙箱隔离插件。'
      }
    },
    empty: {
      title: '暂无插件',
      description: '没有找到匹配的 DSL 插件，请调整筛选条件或向 data/workflows 导入模板。'
    },
    detail: {
      title: '插件详情',
      titleWithName: '插件 {name}',
      description: '查看 DSL 插件的来源、版本、Logo、步骤数量和文件位置。',
      versionLabel: '版本 {version}'
    },
    fields: {
      pluginId: '插件 ID',
      name: '插件名称',
      currentStatus: '当前状态',
      version: '版本',
      source: '来源',
      category: '分类',
      steps: '执行步骤',
      rollbackSteps: '回滚步骤',
      updatedAt: '更新时间',
      filePath: '模板路径',
      logoUrl: 'Logo 地址',
      platforms: '面向平台',
      updateMethods: '更新方式',
      maintainer: '维护者',
      homepage: '项目主页',
      usage: '使用状态',
      validationError: '校验错误',
      signatureStatus: '签名状态',
      riskLevel: '风险等级',
      runtime: '运行时',
      scope: '适用范围',
      support: '支持等级',
      capabilities: '能力',
      frameworks: '面向框架'
    },
    capabilityKeys: { device_connection_test: '连接测试', device_identity_detect: '设备身份识别', device_discover: '设备发现', device_logs_read: '设备日志读取', certificate_discover: '证书发现', certificate_deploy: '证书部署', certificate_rollback: '证书回滚', certificate_verify: '证书验证' },
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: '自定义运行环境', adc_load_balancer: 'ADC 负载均衡' },
    runtimeTypes: { agent_atomic: 'Agent 原子执行', workflow_dsl: '工作流 DSL' },
    scopeTypes: { managed: '受管目标', standalone: '独立目标', both: '受管 / 独立' },
    supportTypes: { official: '官方支持', community: '社区支持', self_managed: '自行维护' },
    aria: {
      filters: '插件市场筛选条件',
      list: 'DSL 插件列表',
      logo: '{name} 的 Logo'
    },
    errors: {
      loadFailed: '插件市场加载失败',
      createFailed: '基于插件创建工作流失败'
    },
    agentDeployment: {
      mount: '挂载到 Agent', mounting: '挂载中...', selectAgent: '请选择目标 Agent', type: '插件类型', targetAgent: '目标 Agent', mountFailed: 'Agent 插件挂载失败',
      executionMode: 'Agent 执行模式', nativeHandler: '原生处理器', pluginMode: 'Agent 插件', mountedPlugin: '已挂载插件', selectMountedPlugin: '请选择已挂载插件',
      plugin: '部署插件', selectPlugin: '请选择部署插件', noCompatiblePlugin: '没有匹配当前平台和框架的已启用插件', compatiblePluginHint: '仅显示与当前资产平台和框架匹配的已启用插件。',
      secretRefPlaceholder: '输入 SecretRef 标识', artifactBinding: '证书产物 {name}', artifactBindingPlaceholder: '例如 value=fullchain,key=private', preview: '校验插件配置', previewFailed: 'Agent 插件配置校验失败',
      approveAndEnable: '审批权限并启用', activating: '启用中...', activateFailed: 'Agent 插件审批或启用失败',
      types: { WORKFLOW_TEMPLATE: '工作流模板', UNIFIED_PLUGIN: '统一能力插件' }
    },
    changeSummaries: {
      createWorkflow: '从插件市场模板创建工作流'
    }
  },
  deploymentPlans: {
    title: '部署计划',
    description: '计划预览、影响范围、审批、执行批次、验证和回滚入口。',
    resourceName: '部署计划',
    apiActions: {
      submit: '提交部署计划',
      execute: '执行部署计划',
      cancel: '取消部署计划',
      delete: '删除部署计划'
    },
    actions: {
      create: '创建部署计划',
      detail: '详情',
      edit: '编辑计划',
      dryRun: 'Dry-run 影响预览',
      dryRunRisk: '只生成影响预览，不会执行正式部署。',
      submit: '提交审批',
      submitRisk: '提交后计划会进入审批或待执行状态。',
      execute: '执行部署',
      executeRisk: '执行会修改目标证书配置。已完成或失败的计划再次执行也使用这个入口；执行前应先运行 Dry-run 影响预览。',
      cancel: '取消计划',
      cancelRisk: '只取消尚未完成的部署计划，不回退已经完成的部署。',
      rollback: '回滚执行',
      rollbackRisk: '回滚会再次修改目标服务证书配置，必须使用真实 runId。',
      delete: '删除计划',
      deleteRisk: '将永久删除计划、部署目标、执行记录和对应审计历史，不可恢复。'
    },
    columns: {
      name: '计划名称',
      status: '状态',
      currentAssetCertificateExpiresAt: '当前证书结束时间',
      updateNeeded: '需要更新',
      scheduledAt: '计划时间',
      actions: '操作'
    },
    metrics: {
      total: {
        title: '计划总数',
        description: '等待审批、待执行和运行中的计划。'
      },
      risky: {
        title: '高危待处理',
        description: '影响生产服务或缺少回滚能力的计划。'
      }
    },
    fields: {
      planId: '计划 ID',
      name: '计划名称',
      status: '计划状态',
      approvalStatus: '审批状态',
      certificateVersionId: '证书版本 ID',
      certificateFormatId: '证书格式配置 ID',
      currentAssetCertificateExpiresAt: '当前证书结束时间',
      updateNeeded: '需要更新',
      targetSummary: '目标绑定摘要',
      latestRun: '最新执行批次',
      approvalId: '审批 ID',
      snapshotHash: '快照 Hash',
      failureReason: '失败原因',
      createdAt: '创建时间',
      updatedAt: '更新时间'
    },
    links: {
      executions: '查看执行记录',
      bindings: '查看相关绑定'
    },
    empty: {
      title: '暂无部署计划',
      description: '先从证书或绑定进入部署向导，生成影响预览后再提交计划。'
    },
    disabled: {
      missingApproval: '缺少审批通过信息，不能执行。',
      needDryRun: '正式执行前必须先完成一次成功的 Dry-run 影响预览。',
      missingRunId: '缺少 runId，不能回滚。',
      missingSelection: '缺少部署计划选择'
    },
    common: {
      cancel: '取消',
      close: '关闭',
      notConfigured: '未配置',
      notProvided: '未提供'
    },
    detail: {
      certificateVersionLabel: '证书版本',
      description: '查看计划基础信息、关联记录与最近一次执行结果。',
      emptyRelatedRecords: '暂无关联记录。',
      loadingRelatedRecords: '正在加载关联记录...',
      noExecutionRecords: '当前计划还没有执行记录。',
      noTargetSummary: '未提供目标摘要',
      planIdLine: '计划 ID {planId}',
      recordKinds: {
        certificateUpdate: '证书更新',
        dryRun: 'Dry-run'
      },
      relatedPlan: '计划 {planId}',
      relatedRun: '运行 {runId}',
      relatedSource: '来源 {source}',
      tabs: {
        latestExecution: '最近执行',
        relatedRecords: '关联记录',
        summary: '概览'
      },
      targetLabel: '目标',
      title: '部署计划详情',
      titleWithName: '部署计划 {name}',
      viewLogs: '查看日志'
    },
    dryRunRequired: {
      copy: '当前操作：{action}。请先做一次 Dry-run，确认影响范围和检查结论后再继续正式执行。',
      description: '正式执行前需要先完成一次成功的 Dry-run 影响预览。',
      primaryAction: '先做 Dry-run',
      runningAction: '正在发起 Dry-run…',
      title: '需要先执行 Dry-run'
    },
    execution: {
      applyName: '部署执行 {runId}',
      applyTitle: '证书更新执行',
      dryRunTitle: 'Dry-run 结果',
      fallbackName: '执行 {runId}',
      rollbackTitle: '证书回滚执行'
    },
    feedback: {
      cancelled: '部署计划已取消。',
      cancelledWithPlanId: '部署计划已取消（计划 {planId}）。',
      deleted: '部署计划已删除。',
      deletedWithPlanId: '部署计划已删除（计划 {planId}）。',
      dryRunStartedMissingRunId: '预检已发起。',
      dryRunStartedWithRunId: '预检已发起（{runId}），请在弹窗中查看进度。',
      dryRunTriggered: '预检已触发。',
      dryRunTriggeredWithPlanId: '预检已触发（计划 {planId}）。',
      dryRunTriggeredWithRunId: '预检已触发（{runId}），请在弹窗中查看进度。',
      executeTriggered: '部署已触发。',
      executeTriggeredWithPlanId: '部署已触发（计划 {planId}）。',
      executeTriggeredWithRunId: '部署已触发（{runId}），请在弹窗中查看进度。',
      loadedDraft: '已加载草稿计划。',
      loadedDraftWithPlanId: '已加载草稿（计划 {planId}）。',
      savedWithPlanId: '计划已保存（{planId}）。',
      submitted: '部署计划已提交。',
      submittedWithPlanId: '部署计划已提交（计划 {planId}）。'
    },
    target: {
      controlPlane: '平台',
      noBindingInfo: '未提供绑定信息',
      noCertificateVariables: '未绑定证书变量',
      noHostHeader: '未提供主机头（Host Header）',
      noOutputSelected: '未选择输出项'
    },
    errors: {
      actionFailed: '{action}失败',
      createReturnedMissingPlanId: '计划创建成功但未获取到编号，请刷新列表。',
      loadCreateDataFailed: '加载部署计划创建数据失败',
      loadRelatedRecordsFailed: '加载关联记录失败',
      missingApplicationAssetIdForDryRun: '缺少应用资产，无法发起预检。',
      missingApplicationAssetIdForSave: '缺少应用资产，无法保存计划。',
      missingPlanId: '计划编号缺失，请重新选择。',
      missingPlanIdForAction: '{action}失败：计划编号缺失，请重新选择。',
      missingRunIdRequest: '执行编号缺失，请重新选择。',
      saveFailed: '保存部署计划失败',
      startDryRunFailed: '发起 dry-run 失败'
    }
  },
  agents: {
    actions: {
      close: '关闭',
      delete: '删除',
      deleteRisk: '删除会直接移除 Agent 记录，这个操作不可逆。',
      detail: '详情',
      disable: '禁用',
      disableRisk: '禁用后该 Agent 将停止接收新任务。',
      enable: '启用',
      enableRisk: '启用后该 Agent 将恢复为可调度状态。'
    },
    app: {
      fallbackName: '应用 {index}'
    },
    certificate: {
      boundCertificate: '站点绑定证书',
      expiredDays: '已过期 {days} 天',
      expiresToday: '今天到期',
      modalDescription: '展示当前站点绑定使用的证书关键信息。',
      modalTitle: '证书详情',
      overviewDescription: '展示证书名称、颁发者、开始时间、到期时间和指纹等关键信息。',
      overviewTitle: '证书概览',
      projectDetailDescription: '在当前 Agent 详情上下文中展示项目内证书资产详情和关联使用关系。',
      projectDetailTitle: '本项目证书详情',
      querying: '查询中...',
      remainingDays: '剩余 {days} 天',
      remainingWithViewAction: '{remaining} / 点击查看证书',
      statusExpired: '已过期',
      statusExpiring: '即将过期',
      statusLabel: '证书状态',
      statusUnknown: '有效期未知',
      statusValid: '有效',
      view: '查看证书',
      viewProjectDetail: '查看本项目证书详情'
    },
    certificateUsage: {
      iisSite: 'Agent IIS 站点',
      linuxSite: 'Agent Linux 站点',
      tomcatConnector: 'Agent Tomcat 连接器'
    },
    columns: {
      actions: '操作',
      hostname: '主机名',
      ipAddress: 'IP 地址',
      lastHeartbeat: '最近心跳',
      onlineStatus: '在线状态',
      osType: '系统类型',
      version: '版本'
    },
    common: {
      defaultAddress: '默认地址',
      no: '否',
      noHostHeader: '无 Host Header',
      noListenAddress: '无监听地址',
      none: '无',
      notConfigured: '未配置',
      notProvided: '未提供',
      notWritable: '不可写',
      unrecognized: '未识别',
      writable: '可写',
      yes: '是'
    },
    detail: {
      loading: '详情加载中...',
      manualRescan: '手动重扫',
      manualRescanCannotPullTasks: '当前 Agent 不可拉取任务，无法执行重扫',
      manualRescanCreated: '已创建手动重扫任务，等待 Agent 拉取执行。',
      manualRescanSubmitting: '重扫提交中...',
      manualRescanUnsupportedType: '当前 Agent 类型不支持手动重扫',
      modalDescription: '查看 Agent 的主要信息、运行环境以及 IIS 站点信息。',
      modalTitle: 'Agent详情',
      nodeEyebrow: 'Agent 节点',
      tabsAriaLabel: 'Agent详情标签页'
    },
    empty: {
      description: '点击右上角“安装Agent”，选择平台和版本后生成一次性安装命令。',
      noFrameworkSites: '未发现 {name} 站点',
      noIisSites: '未发现 IIS 站点',
      noRuntimeLogs: '暂无运行日志',
      noTomcatApps: '未发现 Tomcat 应用',
      noTomcatConnectors: '未发现 Tomcat 连接器',
      title: '暂无 Agent'
    },
    errors: {
      certificateAssetIncomplete: '证书资产数据不完整，无法跳转详情。',
      certificateAssetNotFound: '本项目中未找到对应证书资产。',
      certificateAssetQueryFailed: '查询证书资产失败。',
      detailDataMissing: '未能获取到详情信息。',
      generateInstallCommandFailed: '生成安装命令失败。',
      installCommandMissing: '系统未返回安装命令。',
      loadDetailFailed: '加载详情失败。',
      manualRescanFailed: '手动重扫发起失败。'
    },
    fields: {
      agentVersion: 'Agent 版本',
      appCount: '应用数量',
      appList: '应用列表',
      appPool: '应用程序池',
      arch: '系统架构',
      binaryPath: '二进制路径',
      certificateFile: '证书文件',
      certificateName: '证书名称',
      certificateStore: '证书仓库',
      certificateSubject: '证书主题',
      certificateThumbprint: '证书指纹',
      configFile: '配置文件',
      configPath: '配置路径',
      connectorCount: '连接器数量',
      connectorList: '连接器列表',
      domain: '域名',
      frameworkVersion: '{name} 版本',
      healthStatus: '健康状态',
      healthSummary: '异常摘要',
      hostname: '主机名',
      httpsBinding: 'HTTPS 绑定',
      httpsListen: 'HTTPS 监听',
      iisVersion: 'IIS 版本',
      installPrefix: '安装前缀',
      installStatus: '安装状态',
      ipAddress: 'IP 地址',
      issuer: '颁发者',
      lastCapabilityReportAt: '上次能力上报时间',
      lastHeartbeat: '最近心跳',
      lastRecoveryAt: '最近恢复时间',
      lastReportAt: '最近上报时间',
      linuxDistribution: 'Linux 发行版',
      listenAddress: '监听地址',
      notAfter: '到期时间',
      notBefore: '开始时间',
      offlineDetected: '已判定离线',
      osType: '系统类型',
      osVersion: '操作系统版本',
      patchVersion: '补丁版本',
      privateKeyOrKeystore: '私钥 / Keystore',
      proxyTarget: '代理目标',
      remainingDays: '剩余天数',
      role: '角色',
      runningStatus: '运行状态',
      runtimeLog: '运行日志',
      serviceName: '服务名称',
      sha256Fingerprint: 'SHA-256 指纹',
      siteCount: '站点数量',
      siteList: '站点列表',
      tlsConnector: 'TLS 连接器',
      tomcatVersion: 'Tomcat 版本',
      zone: '区域'
    },
    health: {
      degraded: '降级',
      failed: '失败',
      healthy: '健康',
      unknown: '未知'
    },
    install: {
      bootstrapToken: '安装码',
      command: '安装命令',
      commandStepTitle: '生成安装命令',
      commandCopied: '安装命令已复制',
      copyCommand: '复制安装命令',
      copyToken: '复制安装码',
      expired: '已过期',
      generateCommand: '生成安装命令',
      generating: '生成中...',
      compatibilityInstallUnavailable: 'Windows Compatibility Agent 的一次性安装入口尚未发布。请勿使用 Windows Modern Agent 命令替代安装。',
      installEntryPending: '安装入口待发布',
      linuxGeneralTitle: 'Linux 通用 Agent',
      linuxGroupTitle: 'Linux',
      modalDescription: '选择平台与版本，生成一次性安装命令。安装码 10 分钟内有效，且只能使用一次。',
      modalTitle: '安装 Agent',
      platform: '平台',
      platformLinuxDescription: '适用于 Ubuntu、Debian、CentOS、Rocky、AlmaLinux 等 Linux 发行版。',
      platformWindowsDescription: '适用于 Windows Server 与 Windows 10/11，安装后注册为系统服务。',
      remainingTime: '{minutes}分 {seconds}秒',
      remainingValidity: '剩余有效期',
      selectedAgent: '已选 Agent',
      selectionStepTitle: '选择 Agent 类型',
      singleUseHint: '同一个安装码一旦被请求 bootstrap 脚本，就会立刻失效，不能重复使用。',
      tokenCopied: '安装码已复制',
      version: '版本',
      versionLatest: '最新稳定版',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 及以上',
      windowsModernTitle: 'Windows Modern Agent',
      zone: '区域'
    },
    labels: {
      certificatePath: '证书：{value}',
      deployDirectory: '部署目录：{value}',
      directory: '目录：{value}',
      keystorePath: 'Keystore：{value}',
      listenAddress: '监听地址：{value}',
      path: '路径：{value}',
      privateKeyPath: '私钥：{value}',
      reloadCommand: 'Reload 命令：{value}',
      siteName: '站点名称：{value}',
      taskType: '任务类型：{value}',
      testCommand: '测试命令：{value}',
      thumbprint: '指纹：{value}'
    },
    linux: {
      certDirectoryWritable: '证书目录：{status}',
      helperRequired: '需要 helper',
      keyDirectoryWritable: '私钥目录：{status}',
      permissionMode: '权限模式：{mode}'
    },
    logs: {
      collapse: '收起',
      expand: '展开',
      listAriaLabel: '运行日志列表'
    },
    metrics: {
      abnormalDescription: '离线、失败或漂移状态的 Agent 需要优先处理。',
      abnormalTitle: '异常 Agent',
      totalDescription: '当前已注册到系统的 Agent 数量。',
      totalTitle: 'Agent 总数'
    },
    page: {
      description: '查看 Agent 列表，生成不同平台的安装命令，并在弹窗中查看详情。',
      installAgent: '安装Agent'
    },
    sections: {
      frameworkOverviewDescription: '宿主机上的 {name} 安装状态、运行状态和配置位置。',
      frameworkOverviewTitle: '{name} 概况',
      frameworkSitesDescription: '{name} 识别到的站点、根目录、域名、反向代理目标和证书文件路径。',
      frameworkSitesTitle: '{name} 站点',
      healthDescription: '系统对 Agent 的离线判断、恢复时间与运行健康摘要。',
      healthTitle: '健康与恢复',
      iisOverviewDescription: '宿主机上的 IIS 安装状态和版本信息。',
      iisOverviewTitle: 'IIS 概况',
      iisSitesDescription: 'IIS 网站列表、站点路径、绑定端口以及证书主题名。',
      iisSitesTitle: 'IIS 站点',
      logOverviewDescription: '最近一次能力上报时间，用于判断能力信息的时效性。',
      logOverviewTitle: '日志概览',
      mainInfoDescription: 'Agent 身份、角色与心跳状态。',
      mainInfoTitle: '主要信息',
      runtimeDescription: 'Agent 上报的运行系统与版本信息。',
      runtimeLogsDescription: '手动重扫结果、心跳异常以及能力上报中断等运行日志。',
      runtimeLogsTitle: '运行日志',
      runtimeTitle: '运行环境',
      tomcatAppsDescription: 'Tomcat Host/Context 中识别到的应用路径与部署目录。',
      tomcatAppsTitle: 'Tomcat 应用',
      tomcatConnectorsDescription: 'Tomcat Connector 的监听地址、协议、TLS 开关和证书路径。',
      tomcatConnectorsTitle: 'Tomcat 连接器',
      tomcatOverviewDescription: '宿主机上的 Tomcat 安装状态、运行状态和 Catalina 路径。',
      tomcatOverviewTitle: 'Tomcat 概况'
    },
    site: {
      domainCount: '{count} 个域名',
      fallbackName: '站点 {index}'
    },
    siteMode: {
      reverseProxy: '反向代理',
      staticRoot: '静态站点'
    },
    status: {
      installed: '已安装',
      notInstalled: '未安装',
      notRunning: '未运行',
      running: '运行中'
    },
    tabs: {
      logs: '日志',
      overview: '概览'
    }
  },
  dashboard: {
    aria: {
      assetHeatmap: '应用资产状态热力图',
      certificateStatusList: '证书状态列表',
      metrics: '核心指标',
      quickActions: '主要功能入口',
      statusHeatmap: '证书、Agent、网关和应用资产状态',
      statusLegend: '状态图例'
    },
    assets: {
      groupCount: '{summary} · {total} 个',
      title: '应用资产状态',
      updatedAt: '更新于 {time}'
    },
    audit: {
      description: '优先展示失败、拒绝、高风险和关键业务变更。',
      title: '最近审计日志'
    },
    certificateState: {
      critical: '临近到期',
      expired: '已过期',
      expiring: '即将到期',
      unknown: '未知',
      valid: '正常'
    },
    days: {
      expired: '已过期 {days} 天',
      expiresToday: '今天到期',
      notRecorded: '未记录',
      remaining: '{days} 天'
    },
    empty: {
      noAuditLogs: '暂无审计日志',
      noCertificateStatus: '暂无证书状态数据',
      noObjects: '暂无对象'
    },
    errors: {
      loadFailed: '总览数据加载失败',
      missingOverviewData: '未能获取到总览信息。'
    },
    legend: {
      disabled: '禁用',
      error: '异常',
      ok: '正常',
      unknown: '未知',
      warning: '关注'
    },
    loading: {
      description: '正在加载总览信息…',
      title: '加载中'
    },
    metrics: {
      activeAgents: {
        title: '活跃 Agent 数量',
        description: '当前在线并可调度的 Agent。'
      },
      activeGateways: {
        title: '活跃网关数量',
        description: '当前在线的隔离区网关。'
      },
      applications: {
        title: '当前应用数量',
        description: '已纳管的应用入口资产。'
      },
      expiringCertificates: {
        title: '15 天内到期证书',
        description: '需要安排续期或替换的证书。'
      },
      managedBindings: {
        title: '托管绑定数量',
        description: '已进入托管状态的证书绑定。'
      },
      validCertificates: {
        title: '活跃证书数量',
        description: '状态活跃且尚未过期的证书版本。'
      }
    },
    quickActions: {
      agents: {
        title: 'Agent',
        description: '查看在线状态和任务能力。'
      },
      assets: {
        title: '应用资产',
        description: '维护域名、端口和部署目标。'
      },
      audits: {
        title: '审计日志',
        description: '追踪操作人与执行结果。'
      },
      certificates: {
        title: '证书管理',
        description: '导入、查看和转换证书。'
      },
      deploymentPlans: {
        title: '部署计划',
        description: '创建和执行证书更新计划。'
      },
      gateways: {
        title: '网关',
        description: '管理隔离区执行入口。'
      }
    },
    statusBlock: {
      detail: {
        certificateRemaining: '{name}，{days}'
      },
      status: {
        active: '活跃',
        critical: '临近到期',
        deleted: '已删除',
        disabled: '禁用',
        expired: '已过期',
        expiring: '即将到期',
        inactive: '不活跃',
        offline: '离线',
        online: '在线',
        retired: '已退役',
        revoked: '已吊销',
        stale: '已过期未更新',
        unknown: '未知',
        unreachable: '不可达',
        upgrading: '升级中',
        valid: '正常'
      }
    },
    statusGroups: {
      agents: {
        title: 'Agent'
      },
      applicationAssets: {
        title: '应用资产'
      },
      certificates: {
        title: '证书'
      },
      gateways: {
        title: '网关'
      },
      summary: {
        allNormal: '全部正常',
        needsAttention: '{count} 个需要关注'
      }
    },
    table: {
      bindings: '绑定',
      certificate: '证书',
      domain: '域名',
      notAfterMissing: '未记录到期时间',
      remainingTime: '剩余时间',
      status: '状态'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: '新增 Gateway Agent',
      close: '关闭',
      copied: '已复制',
      copyEnableCommand: '复制启用命令',
      copyInstallCommand: '复制安装命令',
      detail: '详情',
      enableExistingAgent: '现有 Agent 启用 Gateway',
      generateEnableCommand: '生成启用命令',
      generateInstallCommand: '生成安装命令',
      generating: '生成中...',
      probe: '探测',
      probeRisk: '将从该 Gateway 所在区域发起一次可达性探测。'
    },
    columns: {
      actions: '操作',
      gateway: '网关',
      lastHeartbeat: '最近心跳',
      load: '负载',
      region: '区域',
      status: '状态'
    },
    detail: {
      abilities: {
        agentTask: {
          description: '把部署、检查等任务转给区域内的 Agent 执行。',
          title: '任务转发'
        },
        directControl: {
          description: '把受控操作转发到区域内 Agent，系统无需直连内网端口。',
          title: '远程控制转发'
        },
        probe: {
          description: '从该区域检查主机、网站或 Agent 是否可访问。',
          title: '连通性检查'
        }
      },
      eyebrow: '区域网关',
      heroDescription: '负责 {region} 区域内的探测和转发',
      overview: {
        availableCapacity: '可用容量',
        connectionStatus: '连接状态',
        lastContact: '最近联络',
        processing: '正在处理',
        serviceRegion: '服务区域',
        successRate: '成功率'
      },
      sections: {
        overview: '运行概览',
        services: '可用服务'
      }
    },
    empty: {
      description: '新增 Gateway Agent，或在现有 Agent 上启用 Gateway 角色。',
      title: '暂无网关'
    },
    errors: {
      generateEnableCommandFailed: '生成 Gateway 启用命令失败。',
      generateInstallCommandFailed: '生成 Gateway Agent 安装命令失败。',
      missingEnableCommand: '系统未返回 Gateway 启用命令。',
      missingInstallCommand: '系统未返回 Gateway Agent 安装命令。'
    },
    fields: {
      config: '配置',
      enableCommand: '启用命令',
      expiresAt: '过期时间',
      installCode: '安装码',
      installCommand: '安装命令',
      platform: '平台',
      region: '区域',
      service: '服务',
      unboundAgent: '不绑定具体 Agent'
    },
    links: {
      assets: '查看资产',
      executions: '查看执行记录'
    },
    modals: {
      detail: {
        title: '网关详情'
      },
      enable: {
        title: '现有 Agent 启用 Gateway'
      },
      install: {
        title: '新增 Gateway Agent'
      }
    },
    page: {
      description: '管理区域路由 Gateway Agent。',
      title: '网关'
    },
    platforms: {
      linuxSystemd: {
        description: '在 Linux 主机安装 Gateway Agent 服务'
      },
      windowsService: {
        description: '在 Windows 主机安装 Gateway Agent 服务'
      }
    },
    resourceName: '网关',
    status: {
      disabled: '已停用',
      offline: '离线',
      online: '正常在线',
      revoked: '已撤销',
      upgrading: '升级中'
    },
    values: {
      availableCapacity: '可接收 {count} 个任务',
      defaultRegion: '默认区域',
      regionGatewayName: '{region}网关',
      taskCount: '{count} 个任务'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: '服务读取 Secret',
      secretResolve: '执行器读取 Secret',
      secretCreate: '创建 Secret',
      secretVersionCreate: '创建 Secret 版本',
      secretRotate: '轮换 Secret',
      certificateImport: '导入证书',
      certificateFormatUpdate: '更新证书产物',
      certificateFormatDelete: '删除证书产物',
      deploymentCreate: '创建部署计划',
      deploymentExecute: '执行部署计划',
      deploymentRollback: '请求回滚',
      approvalCreate: '创建审批',
      approvalApprove: '批准审批',
      approvalReject: '拒绝审批',
      authLogin: '用户登录',
      authLogout: '用户退出'
    },
    events: {
      authLoginSuccess: '登录成功',
      authLoginFailure: '登录失败',
      authLoginFailed: '登录失败',
      authLogout: '退出登录',
      authExternalLoginSuccess: '外部身份登录成功',
      authExternalLoginFailed: '外部身份登录失败',
      secretCreated: '创建 Secret',
      secretVersionCreated: '创建 Secret 版本',
      secretUsed: '读取 Secret',
      secretRotated: '轮换 Secret',
      permissionDenied: '权限拒绝',
      approvalCreated: '创建审批',
      approvalApproved: '审批通过',
      approvalRejected: '审批驳回',
      certificateImported: '证书变更',
      deploymentCreated: '创建部署',
      deploymentExecuted: '执行部署',
      deploymentRollbackRequested: '请求部署回滚',
      pluginInstalled: '安装插件',
      pluginPermissionDenied: '插件权限拒绝',
      workflowTemplateExecuted: '执行工作流模板'
    },
    types: {
      audit: '审计',
      auth: '认证',
      security: '安全',
      secret: 'Secret',
      certificate: '证书',
      certificateVersion: '证书',
      certificateVersionFormat: '证书产物',
      deployment: '部署',
      deploymentPlan: '部署计划',
      execution: '执行',
      approval: '审批',
      permission: '权限',
      plugin: '插件',
      workflowTemplate: '工作流',
      gateway: '网关',
      agent: 'Agent',
      serviceAsset: '应用资产',
      binding: '绑定'
    },
    actors: {
      user: '用户',
      system: '系统',
      agent: 'Agent',
      plugin: '插件',
      executor: '执行器'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Secret 版本',
      certificate: '证书',
      certificateVersion: '证书版本',
      certificateVersionFormat: '证书产物',
      deployment: '部署',
      deploymentPlan: '部署计划',
      execution: '执行任务',
      executionRun: '执行任务',
      approval: '审批单',
      plugin: '插件',
      workflowTemplate: '工作流模板',
      gateway: '网关',
      agent: 'Agent',
      serviceAsset: '应用资产',
      binding: '证书绑定',
      auditLog: '审计日志'
    },
    results: {
      success: '成功',
      failure: '失败',
      denied: '拒绝'
    },
    verbs: {
      success: '完成',
      failure: '失败',
      denied: '拒绝'
    },
    tokens: {
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
      mapping: '映射'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb}“{title}”，对象：{resource}。',
    fallbacks: {
      unknown: '未知'
    }
  },
  audit: {
    page: {
      title: '审计日志',
      description: '按用户操作、失败/拒绝和关键业务变更组织日志，保留可读摘要。'
    },
    actions: {
      exportEvidence: '导出审计证据',
      exporting: '导出中…',
      refreshing: '刷新中…'
    },
    errors: {
      exportFailed: '导出审计证据失败',
      loadFailed: '审计日志加载失败',
      withRequestId: '{message}（{requestId}）'
    },
    metrics: {
      ariaLabel: '审计概览',
      total: {
        title: '审计总数',
        description: '当前筛选范围内可追踪的操作记录。'
      },
      failed: {
        title: '失败 / 拒绝',
        description: '需要优先复核的失败执行和拒绝访问。'
      },
      userActions: {
        title: '用户操作',
        description: '由用户直接发起的业务变更和访问动作。'
      }
    },
    list: {
      ariaLabel: '审计日志列表',
      title: '日志列表',
      summary: '共 {total} 条，默认按最新时间排序。',
      timeNotRecorded: '未记录时间'
    },
    empty: {
      title: '暂无审计事件',
      description: '关键操作应能回溯到对应的操作记录和任务记录。'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: '加载失败',
      submitFailed: '提交失败'
    },
    actions: {
      createResource: '新增{resource}',
      submitting: '提交中…'
    },
    modal: {
      createDescription: '填写以下字段后创建{resource}'
    },
    placeholders: {
      selectField: '请选择{field}'
    },
    table: {
      ariaLabel: '管理列表',
      resourceList: '{resource}列表',
      total: '共 {count} 条'
    }
  },
  notifications: {
    title: '通知管理',
    description: '统一管理通知渠道、路由、模板、静默和可靠投递记录。',
    tabs: { channels: '通知渠道', deliveries: '投递记录', rules: '规则与模板' },
    sections: { channels: '通知渠道记录', deliveries: '投递记录' },
    channels: { createTitle: '新建通知渠道' },
    settings: { privateOriginsTitle: '私有化平台地址', privateOriginsDescription: '配置允许通知中心访问的企业微信、飞书和钉钉私有化 HTTPS Origin。' },
    channelTypes: { email: 'Email', wecom: '企业微信', slack: 'Slack', feishu: '飞书', dingtalk: '钉钉', telegram: 'Telegram', webhook: '通用 Webhook' },
    deploymentModes: { public: '公有云', private: '私有化部署' },
    fields: {
      name: '渠道名称', type: '渠道类型', deploymentMode: '部署模式', smtpHost: 'SMTP 主机', smtpPort: 'SMTP 端口', from: '发件地址',
      smtpSecurity: '连接加密', smtpUsername: 'SMTP 用户名', smtpPassword: 'SMTP 密码', secretValuePlaceholder: '请输入密文内容',
      optionalSecretValuePlaceholder: '可选；请输入密文内容', wecomWebhookUrl: '企业微信群机器人 Webhook URL', slackWebhookUrl: 'Slack Incoming Webhook URL',
      feishuWebhookUrl: '飞书自定义机器人 Webhook URL', dingtalkWebhookUrl: '钉钉自定义机器人 Webhook URL', feishuSigningSecret: '飞书签名密钥',
      dingtalkSigningSecret: '钉钉加签密钥', telegramBotToken: 'Telegram Bot Token', telegramChatId: 'Telegram Chat ID', telegramMessageThreadId: 'Telegram Topic ID（可选）',
      webhookUrl: 'Webhook URL', webhookUrlPlaceholder: '请输入完整 Webhook URL', webhookMethod: 'HTTP 方法', webhookHeaders: '固定 Header（JSON）',
      webhookHeadersPlaceholder: '示例：x-source = gcac', signingSecret: 'HMAC-SHA256 签名密钥', testTarget: '测试接收目标',
      testTargetPlaceholder: 'Email 可输入逗号分隔的收件地址', lastSuccess: '最近成功', latency: '延迟（毫秒）',
      createdAt: '创建时间', updatedAt: '更新时间', failureCategory: '失败分类', channel: '通知渠道', selectChannel: '请选择通知渠道',
      source: '事件来源', priority: '路由优先级', dedupeWindow: '去重窗口（秒）', templateKey: '模板键', locale: '语言',
      titleTemplate: '标题模板', bodyTemplate: '正文模板', reason: '静默原因', startsAt: '开始时间', endsAt: '结束时间',
      wecomPrivateOrigins: '企业微信私有化 Origin', feishuPrivateOrigins: '飞书私有化 Origin', dingtalkPrivateOrigins: '钉钉私有化 Origin', privateOriginsPlaceholder: '每行一个，例如 https://notify.example.internal'
    },
    actions: {
      createChannel: '新建通知渠道', createRoute: '新建通知路由', createTemplate: '新建通知模板', createSilence: '新建静默规则',
      confirmCreate: '确认创建', cancel: '取消', saveSettings: '保存设置', test: '测试发送', testChannel: '测试渠道：{name}', retry: '重新投递', enable: '启用', disable: '停用'
    },
    rules: { createRoute: '新建通知路由', createTemplate: '新建通知模板', createSilence: '新建静默规则' },
    summary: { routes: '通知路由', templates: '通知模板', silences: '静默规则', recordCount: '共 {count} 条记录' },
    empty: { channels: '暂无通知渠道', deliveries: '暂无投递记录', routes: '暂无通知路由', templates: '暂无通知模板', silences: '暂无静默规则' },
    values: { notAvailable: '—' },
    secrets: { name: '{channel} - {field}', fields: { smtpUsername: 'SMTP 用户名', smtpPassword: 'SMTP 密码', webhookUrl: 'Webhook URL', signingSecret: '签名密钥', botToken: 'Bot Token' } },
    messages: {
      loadFailed: '通知管理数据加载失败', operationFailed: '通知管理操作失败', testUsesChannelTarget: '该渠道将使用已配置的接收目标发送测试通知。',
      secretStoredHint: '该内容将加密保存，创建后不会明文回显。', createSecretFailed: '密文保存失败', invalidHeaders: '固定 Header 必须是合法的 JSON 对象',
      smtpCredentialsPairRequired: 'SMTP 用户名和密码必须同时填写', webhookUrlRequired: 'Webhook URL 不能为空', botTokenRequired: 'Telegram Bot Token 不能为空',
      chatIdRequired: 'Telegram Chat ID 不能为空', feishuWebhookUrlInvalid: '请输入飞书官方自定义机器人 Webhook URL', dingtalkWebhookUrlInvalid: '请输入钉钉官方自定义机器人 Webhook URL',
      wecomWebhookUrlInvalid: '请输入有效的企业微信机器人 HTTPS Webhook URL', telegramBotTokenInvalid: 'Telegram Bot Token 格式无效', telegramMessageThreadIdInvalid: 'Telegram Topic ID 必须是正整数',
      privateDeploymentAllowlistHint: '私有化地址必须先加入上方对应平台的受信任 HTTPS Origin 白名单，否则测试和投递会被后端拒绝。', privateOriginInvalid: '私有化地址必须是精确 HTTPS Origin，不能包含路径、查询参数、用户信息或 Fragment。', privateOriginsSecurityHint: '这里只填写协议、主机和可选端口；完整 Webhook URL、Token 和签名密钥仍通过密文服务保存。', telegramUsesBotApi: 'Telegram 使用官方 Bot API sendMessage 发送通知，不使用接收事件的 Webhook。'
    }
  },
  settings: {
    securityLabel: '安全设置入口',
    version: {
      title: '版本信息',
      description: '查看当前运行的 GCAC 版本。',
      currentVersion: '当前版本',
      product: '产品'
    },
    permissionPolicies: {
      resourceName: '权限策略',
      actions: {
        create: '创建策略'
      },
      columns: {
        id: '策略 ID',
        subjectType: '主体类型',
        subjectId: '主体 ID',
        effect: '效果',
        actions: '动作',
        resourceTypes: '资源类型',
        scope: '作用域'
      },
      fields: {
        subjectType: '主体类型',
        subjectId: '主体 ID',
        effect: '效果',
        actions: '动作',
        resourceTypes: '资源类型',
        tenantId: '租户作用域'
      },
      subjectTypes: {
        role: '角色',
        user: '用户',
        plugin: '插件',
        executor: '执行器'
      },
      effects: {
        allow: '允许',
        deny: '拒绝'
      }
    },
    groupRoleMappings: {
      resourceName: '组映射',
      actions: {
        create: '创建映射'
      },
      columns: {
        sourceId: '身份源 ID',
        externalGroup: '外部组',
        roleId: '本地角色',
        enabled: '启用',
        updatedAt: '更新时间'
      },
      fields: {
        sourceId: '身份源 ID',
        externalGroup: '外部组',
        roleId: '本地角色 ID'
      }
    },
    users: {
      title: '账号主体列表',
      summary: {
        groups: '共 {count} 条',
        users: '共 {total} 条，已选 {selected} 条'
      },
      actions: {
        createUser: '创建用户',
        addGroup: '添加组',
        bulkDelete: '批量删除',
        edit: '编辑',
        delete: '删除',
        lookupLoading: '检索中...',
        lookupUser: '检索用户',
        lookupGroup: '检索组',
        creating: '创建中...',
        saving: '保存中...',
        saveChanges: '保存修改',
        adding: '添加中...'
      },
      risks: {
        bulkDelete: '批量删除会移除所选用户的本地凭据和角色关联。',
        deleteUser: '删除用户会移除该账号的本地凭据和角色关联。'
      },
      tabs: {
        users: '用户',
        groups: '组'
      },
      empty: {
        users: '暂无用户',
        groups: '暂无用户组'
      },
      columns: {
        username: '用户名',
        displayName: '显示名',
        email: '邮箱',
        source: '来源',
        identitySourceName: '身份源名称',
        status: '状态',
        tenant: '租户',
        roles: '角色',
        lastSyncedAt: '最近同步',
        updatedAt: '更新时间',
        actions: '操作',
        groupName: '组名称',
        code: '编码',
        externalRef: '外部标识'
      },
      dialog: {
        userCreateTitle: '创建用户',
        userEditTitle: '编辑用户',
        userCreateDescription: '创建本地用户，或从身份源按用户名检索后创建绑定用户。',
        userEditDescription: '编辑用户的显示名、邮箱、状态和角色。',
        groupCreateTitle: '添加组',
        groupCreateDescription: '创建本地组，或从身份源按组名称检索后添加外部组。'
      },
      aria: {
        principalType: '主体类型',
        createMode: '创建方式',
        externalUserProfile: '身份源用户资料',
        groupCreateMode: '创建组方式',
        externalGroupProfile: '身份源用户组资料'
      },
      modes: {
        localUser: '本地用户',
        externalUser: '身份源用户',
        localGroup: '本地组',
        externalGroup: '身份源组'
      },
      fields: {
        identitySource: '身份源',
        directoryUsername: '目录用户名',
        username: '用户名',
        displayName: '显示名',
        email: '邮箱',
        role: '角色',
        initialPassword: '初始密码',
        status: '状态',
        directoryGroupName: '目录组名称',
        groupName: '组名称',
        groupCode: '组编码',
        directoryDn: '目录 DN'
      },
      placeholders: {
        selectIdentitySource: '请选择身份源',
        directoryUsername: '例如 jackson',
        displayName: '证书操作员',
        initialPassword: '输入初始密码',
        directoryGroupName: '例如 GCAC-Ops',
        groupName: '证书运维组'
      },
      options: {
        unset: '不设置'
      },
      status: {
        active: '启用',
        disabled: '禁用'
      },
      labels: {
        identitySourceOption: '{name}（{type}）'
      },
      errors: {
        loadUsersFailed: '加载用户失败',
        loadGroupsFailed: '加载用户组失败',
        createUserFailed: '创建用户失败',
        updateUserFailed: '更新用户失败',
        externalUserEmpty: '身份源没有返回用户资料',
        lookupExternalUserFailed: '检索身份源用户失败',
        externalGroupEmpty: '身份源没有返回用户组资料',
        lookupExternalGroupFailed: '检索身份源用户组失败',
        createGroupFailed: '创建用户组失败',
        deleteUsersFailed: '删除用户失败'
      }
    },
    roles: {
      page: {
        title: '权限管理',
        description: '以角色为中心维护授权对象范围，并把用户或组分配到角色。'
      },
      actions: {
        createRole: '创建角色',
        refreshObjects: '刷新对象',
        loading: '加载中...',
        creating: '创建中...',
        saving: '保存中...',
        detail: '详情',
        authorize: '授权',
        grantPermission: '授予权限',
        assignMembers: '分配成员',
        delete: '删除',
        deleteRole: '删除角色',
        deleting: '删除中...',
        clearSelection: '清空选择'
      },
      columns: {
        roleId: '角色 ID',
        code: '编码',
        name: '名称',
        builtin: '内置',
        policyCount: '策略数',
        permissions: '权限点',
        actions: '操作',
        objectScope: '对象范围',
        accessLevel: '权限级别',
        effect: '效果',
        memberType: '成员类型',
        member: '成员'
      },
      table: {
        emptyRoles: '暂无角色',
        roleRecords: '角色记录',
        emptyGrants: '当前角色暂无对象权限',
        currentPermissions: '当前角色权限',
        emptyMembers: '当前角色暂无成员分配',
        assignedMembers: '已分配成员'
      },
      categories: {
        certificate: '证书',
        gateway: '网关',
        agent: 'Agent',
        serviceAsset: '应用资产',
        deploymentPlan: '更新计划',
        workflow: '工作流',
        auditLog: '日志',
        systemSetting: '系统设置'
      },
      accessLevel: {
        read: '只读',
        edit: '编辑',
        control: '完全控制'
      },
      effect: {
        allow: '允许',
        deny: '拒绝'
      },
      principal: {
        user: '用户',
        group: '组',
        externalGroup: '身份源组'
      },
      summary: {
        selectedMembers: '已选 {count} 个成员',
        chooseMembers: '请选择用户或组',
        selectedScopes: '已选 {count} 个范围',
        chooseObjectNode: '请选择对象树节点',
        selectedScopeLabel: '已选范围',
        selectedMemberLabel: '已选成员'
      },
      tree: {
        rootLabel: '全部对象',
        rootDescription: '所有可授权业务对象',
        typeDescription: '{category}全部记录',
        allBusinessObjects: '全部业务对象',
        selectedScopeAria: '已选授权范围',
        objectTreeAria: '可授权对象树',
        authorizableObjects: '可授权对象',
        loading: '正在加载对象树...',
        kind: {
          all: '全部',
          category: '分类',
          record: '记录'
        }
      },
      format: {
        labelWithId: '{label}（{id}）',
        recordFallback: '{category} {value}',
        unnamedRecord: '未命名记录'
      },
      detail: {
        title: '角色详情',
        titleWithName: '角色 {name}',
        description: '对象范围、具体对象、权限级别和成员分配在这里维护。'
      },
      create: {
        title: '创建角色',
        description: '填写角色职责，并可直接为该角色授权对象范围。',
        nameLabel: '角色名称',
        namePlaceholder: '证书操作员',
        descriptionLabel: '说明',
        descriptionPlaceholder: '负责证书日常操作',
        authorizedRole: '授权角色',
        newRole: '新角色'
      },
      grant: {
        title: '授予角色权限',
        description: '从对象树选择范围，并直接设置该范围上的权限级别。',
        roleLabel: '角色'
      },
      member: {
        title: '分配成员',
        titleWithName: '分配成员：{name}',
        description: '选择用户或组，系统会把成员分配到该角色已有的授权对象范围。',
        targetRole: '目标角色',
        authorizedScope: '授权范围',
        objectScopeCount: '{count} 个对象范围',
        selectedMembersAria: '已选成员',
        assignableMembersAria: '可分配成员',
        emptyAssignable: '暂无可分配{type}'
      },
      errors: {
        loadObjectTreeFailed: '加载对象树失败',
        loadDataFailed: '加载权限管理数据失败',
        missingRoleId: '未获取到角色 ID',
        createRoleFailed: '创建角色失败',
        grantRoleFailed: '授予角色权限失败',
        roleNoObjectScopes: '该角色还没有授权对象范围，请先为角色授予权限。',
        assignMembersFailed: '分配成员失败',
        deleteRoleFailed: '删除角色失败',
        missingObjectSetId: '未获取到对象范围 ID'
      },
      confirm: {
        deleteRole: '确认删除角色“{name}”？删除后会同步移除该角色的用户分配和对象授权。'
      },
      auditLogs: {
        auth: {
          name: '认证登录日志',
          description: '登录、登出、外部身份源登录'
        },
        security: {
          name: '安全管理日志',
          description: '用户、角色、权限、身份源变更'
        },
        certificate: {
          name: '证书日志',
          description: '证书导入、版本、产物与绑定操作'
        },
        asset: {
          name: '资产日志',
          description: '应用资产、主机、服务实例与站点资产操作'
        },
        gateway: {
          name: '网关日志',
          description: '网关路由、探测与状态变更'
        },
        agent: {
          name: 'Agent 日志',
          description: 'Agent 注册、心跳、任务与升级操作'
        },
        deployment: {
          name: '更新计划日志',
          description: '部署计划、执行、回滚与审批'
        },
        workflow: {
          name: '工作流日志',
          description: '工作流模板与执行操作'
        },
        secret: {
          name: '密钥日志',
          description: 'Secret 创建、使用与轮换'
        },
        system: {
          name: '系统日志',
          description: '系统设置与平台级事件'
        }
      }
    },
    identitySources: {
      actions: {
        create: '创建身份源',
        edit: '编辑',
        delete: '删除',
        creating: '创建中...',
        saving: '保存中...',
        saveChanges: '保存修改',
        expandAdvanced: '展开高级设置',
        collapseAdvanced: '收起高级设置'
      },
      columns: {
        name: '名称',
        type: '目录类型',
        server: '服务器',
        status: '状态',
        actions: '操作'
      },
      table: {
        title: '身份源列表',
        total: '共 {count} 条'
      },
      empty: '暂无身份源',
      dialog: {
        createTitle: '创建身份源',
        editTitle: '编辑身份源',
        createDescription: '先填写基础连接信息；过滤器和目录类型放在高级设置里。',
        editDescription: '修改身份源配置；若要更新服务账号密码，请重新填写密码。'
      },
      fields: {
        name: '名称',
        domain: '域名',
        protocol: '协议',
        serverAddress: '服务器地址',
        bindDn: '服务账号 DN',
        bindPassword: '服务账号密码',
        directoryType: '目录类型',
        defaultRole: '默认角色',
        enabled: '启用状态',
        userDnTemplate: '用户 DN/UPN 模板',
        userFilter: '用户过滤器',
        groupFilter: '组过滤器',
        syncUserFilter: '同步用户过滤器',
        requireGroupMapping: '要求登录用户必须命中组映射'
      },
      placeholders: {
        name: '例如：企业 AD',
        bindPasswordCreate: '输入服务账号密码',
        bindPasswordEdit: '留空表示沿用现有密码',
        autoByDirectoryType: '留空则按目录类型自动推导',
        userFilter: '例如：(uid={{username}})',
        groupFilter: '例如：(member={{userDn}})'
      },
      labels: {
        finalUrl: '最终地址：{url}'
      },
      options: {
        unset: '不设置'
      },
      status: {
        enabled: '启用',
        disabled: '已停用',
        disabledShort: '禁用'
      },
      types: {
        ldap: '标准 LDAP'
      },
      risks: {
        delete: '删除身份源后，该目录的登录、同步和组映射都会失效。'
      },
      secret: {
        bindPasswordName: '{name} LDAP 服务账号密码'
      },
      messages: {
        createSuccess: '身份源创建成功',
        updateSuccess: '身份源更新成功'
      },
      errors: {
        loadFailed: '加载身份源失败',
        createBindPasswordSecretFailed: '创建服务账号密码 Secret 失败',
        createFailed: '创建身份源失败',
        updateFailed: '更新身份源失败',
        deleteFailed: '删除身份源失败'
      }
    }
  },
  bindings: {
    actions: {
      create: '新建配置文件',
      edit: '编辑',
      delete: '删除',
      deleting: '删除中...',
      applyTemplate: '套用内置模板',
      saving: '保存中...',
      confirmSave: '确认保存'
    },
    columns: {
      configName: '配置文件名称',
      targetSummary: '目标环境',
      displayFormat: '内容格式',
      extension: '扩展名',
      encodingSummary: '编码',
      exportSummary: '包含内容 / 导出选项',
      actions: '操作'
    },
    dialog: {
      createTitle: '新建证书格式配置',
      editTitle: '编辑证书格式配置',
      description: '选择系统平台与目标平台后，可套用内置模板并逐项调整导出内容。'
    },
    list: {
      title: '证书格式配置列表',
      descriptionWithCount: '可复用的证书格式模板。当前 {count} 条'
    },
    empty: {
      text: '暂无证书格式配置'
    },
    fields: {
      contentFormat: '内容格式',
      systemPlatform: '系统平台',
      runtimePlatform: '目标平台',
      configName: '配置文件名称',
      backendFormat: '底层格式',
      outputExtension: '输出扩展名',
      expiresAt: '配置失效时间（可选）',
      certificateEncoding: '证书编码',
      certificateContentEncoding: '证书内容编码',
      privateKeyEncoding: '私钥编码',
      includeLeafCertificate: '包含公钥证书',
      includeCertificateChain: '包含证书链',
      includePrivateKey: '包含私钥',
      mainArtifactIncludesChain: '主产物包含证书链',
      generateChainFile: '额外生成证书链文件',
      generatePrivateKeyFile: '额外生成私钥文件',
      exportPassword: '导出密码'
    },
    formats: {
      pfx: 'PKCS#12 / PFX 容器',
      jks: 'JKS 容器',
      pemBundle: 'PEM 单文件 Bundle',
      pemCert: 'PEM 证书文件',
      pemKey: '私钥文件',
      cer: '证书文件（.cer）',
      crt: '证书文件（.crt）',
      p7b: 'PKCS#7 / P7B 证书链',
      custom: '自定义'
    },
    sections: {
      templates: {
        title: '内置模板',
        description: '模板基于各平台常见 TLS 落地方式预填内容格式、包含内容和导出规则，套用后仍可继续修改。'
      },
      basic: {
        title: '基础信息',
        description: '先定义配置文件身份、真实内容格式，以及最终扩展名。'
      },
      encoding: {
        title: '编码选择',
        description: '仅显示当前内容格式支持的编码选项。'
      },
      content: {
        title: '包含内容',
        description: '定义主产物文件中包含的内容：公钥、证书链、私钥。'
      },
      export: {
        title: '导出选项',
        description: '定义是否额外生成链文件、私钥文件，以及容器专属密码选项。'
      }
    },
    filters: {
      keywordPlaceholder: '配置名称 / 目标环境 / Alias / 内容格式'
    },
    placeholders: {
      configName: '例如：设备兼容单文件PEM',
      exportPassword: '请输入 PFX/JKS 导出密码'
    },
    validation: {
      selectPlatformsFirst: '请先选择系统平台和目标平台。',
      configNameRequired: '必须填写配置文件名称',
      passwordRequired: 'PFX/JKS 配置必须填写导出密码'
    },
    errors: {
      loadFailed: '证书格式配置加载失败',
      saveFailed: '保存证书格式配置失败',
      deleteFailed: '删除证书格式配置失败',
      createExportSecretFailed: '创建导出密码 Secret 失败',
      withCode: '{message}（{code}）'
    },
    fallbacks: {
      unnamedConfig: '未命名配置-{index}',
      unspecified: '未指定',
      aliasUnset: '未设置 Alias'
    },
    labels: {
      aliasWithValue: 'Alias：{alias}',
      requestId: '请求 ID：{requestId}'
    },
    encoding: {
      pkcs12Container: 'PKCS#12 容器',
      jksContainer: 'JKS 容器',
      privateKeyWithEncoding: '私钥 {encoding}',
      pkcs7Chain: 'PKCS#7 证书链',
      certificateWithEncoding: '证书 {encoding}',
      default: '默认'
    },
    export: {
      leafCertificate: '公钥',
      certificateChain: '证书链',
      privateKey: '私钥',
      extraChainFile: '额外链文件',
      extraPrivateKeyFile: '额外私钥文件'
    },
    secret: {
      defaultConfigName: '证书格式配置',
      exportPasswordName: '{name} 导出密码'
    },
    select: {
      placeholder: '请选择'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: '已配置导出密码；如需更换，请直接输入新密码覆盖。'
    },
    templates: {
      windowsIis: {
        configName: 'Windows-IIS-PKCS12-标准模板',
        description: 'IIS 使用 PKCS#12/PFX 容器最常见，主产物内直接携带服务器证书、证书链和私钥。'
      },
      windowsNginx: {
        configName: 'Windows-NGINX-PEM-标准模板',
        description: 'NGINX 主流使用 PEM 单文件承载服务器证书与链，再配独立私钥文件。'
      },
      windowsApache: {
        configName: 'Windows-Apache-PEM-标准模板',
        description: 'Apache 通常以 PEM 证书文件和独立私钥交付，链文件额外导出便于兼容不同运维习惯。'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12-标准模板',
        description: 'Tomcat 以 JKS/PKCS#12 keystore 为主，这里默认使用更通用的 PKCS#12。'
      },
      windowsOther: {
        configName: 'Windows-设备兼容单文件PEM模板',
        description: '兼容部分设备要求：单文件中同时包含公钥证书、证书链与私钥，扩展名可再改成 .crt/.cer。'
      },
      linuxIis: {
        configName: 'Linux-IIS-兼容模板',
        description: '如果最终目标仍是 IIS，最合理的交付物仍然是 PKCS#12/PFX 容器。'
      },
      linuxNginx: {
        configName: 'Linux-NGINX-PEM-标准模板',
        description: 'NGINX 官方配置围绕 PEM 单文件证书链与独立私钥展开。'
      },
      linuxApache: {
        configName: 'Linux-Apache-PEM-标准模板',
        description: 'Apache 常见做法是 PEM 证书文件配独立私钥，链文件额外导出便于拆分部署。'
      },
      linuxTomcat: {
        configName: 'Linux-Tomcat-PKCS12-标准模板',
        description: 'Tomcat 默认建议交付 keystore 容器，这里使用更通用的 PKCS#12。'
      },
      linuxOther: {
        configName: 'Linux-设备兼容单文件PEM模板',
        description: 'Linux 通用设备若接受单文件 PEM，可先用 bundle 形式，再按目标设备调整扩展名与包含内容。'
      }
    }
  },
  assets: {
    title: '应用资产',
    description: '以域名或 IP 为主对象管理应用入口，聚焦地址、端口、协议、站点与执行定位。',
    resourceName: '应用资产',
    executionModes: {
      label: '执行方式',
      plugin: { title: '插件执行', description: '使用受管目标已启用的证书部署能力。' },
      workflowOverride: { title: '工作流覆盖执行', description: '绕过插件能力，改用用户工作流执行。', notice: '启用工作流覆盖后，本资产的插件分配将停用，只保留工作流执行绑定。' }
    },
    actions: {
      add: '添加资产',
      edit: '编辑',
      detail: '详情',
      addVariable: '添加变量',
      delete: '删除',
      deleteRisk: '删除后，该应用资产及其人工目标关联将从应用资产列表中移除；设备发现出的框架、站点、Virtual Server 和受管目标不会被删除。',
      rollbackFromLatestSnapshot: '从最新快照发起回退',
      rollingBack: '回退中...',
      saving: '保存中...',
      creating: '创建中...',
      saveChanges: '保存修改',
      confirmCreate: '确认创建'
    },
    columns: {
      domain: '访问域名',
      port: '端口',
      protocol: '协议',
      platform: '平台',
      framework: '框架',
      site: '站点',
      status: '状态',
      actions: '操作'
    },
    fields: {
      assetId: '应用资产 ID',
      domain: '访问域名',
      addressType: '地址类型',
      port: '端口',
      protocol: '协议',
      verifyUrl: '验证 URL',
      platform: '平台',
      frameworkType: '框架类型',
      deploymentStrategyCompatibility: '部署策略兼容模式',
      selectWorkflow: '选择工作流',
      workflowVersionSelection: '版本更新方式',
      serviceInstanceId: '服务实例 ID',
      siteId: '站点 ID',
      managedTargetId: '受管目标 ID',
      bindingKey: '绑定键',
      hostId: '宿主机 ID',
      environment: '环境',
      discoverySource: '发现来源',
      lastDiscoveredAt: '最后发现时间',
      tags: '标签',
      managedTarget: '受管目标',
      siteName: '站点名称',
      bindingInformation: '绑定信息',
      hostHeader: 'Host Header',
      sniName: 'SNI 名称',
      currentCertificate: '当前证书',
      targetCertificate: '目标证书',
      expectedFingerprint: '期望指纹',
      certificateStore: '证书存储',
      snapshotType: '快照类型',
      time: '时间',
      executionRun: '执行记录',
      displayName: '显示名称',
      siteInstance: '站点实例',
      certificateFormat: '证书产物配置',
      workflow: '工作流',
      publishedVersion: '已发布版本',
      runner: '运行位置',
      artifactFormat: '产物格式配置',
      updatePlugin: '证书更新插件'
    },
    capability: { source: '能力来源', plugin: '插件版本', runtime: '运行时', executionLocation: '执行位置', pendingAssignment: '保存后将创建应用资产级部署能力指派。' },
    links: {
      certificateBindings: '查看证书绑定',
      executions: '查看执行记录'
    },
    empty: {
      title: '暂无应用资产',
      description: '等待系统自动发现，或手动补录应用入口。',
      noBindingInformation: '未提供绑定信息',
      notSet: '未设置',
      notSelected: '未选择',
      noVariablePreset: '暂无可添加变量',
      basicEntryIncomplete: '基础入口未完成'
    },
    detail: {
      title: '应用详情',
      description: '查看资产详情、绑定关系、部署入口和快照记录。',
      tabsAriaLabel: '应用详情标签页',
      tabs: {
        overview: '基础信息',
        snapshots: '快照'
      },
      loadingTargetBinding: '正在加载目标绑定详情...',
      loadingSnapshots: '正在加载快照...',
      emptyCertificateBindings: '暂无证书绑定关系。',
      emptySnapshots: '暂无快照。',
      rollbackSubmitted: '已提交回退请求，请到“执行记录”查看回退运行。',
      sections: {
        overview: {
          title: '基础信息',
          description: '应用资产是主对象，宿主机和站点只作为执行定位信息出现。'
        },
        targetBinding: {
          title: '目标绑定',
          description: '绑定必须明确落到站点和受管目标，而不是继续靠域名猜。'
        },
        certificateBindings: {
          title: '证书绑定关系',
          description: '把证书关系明确到 binding 上，而不是只看域名。'
        },
        snapshots: {
          title: '快照',
          description: '部署前后与回退后的现场状态必须能直接看到，不能只剩任务记录。'
        }
      }
    },
    compatibilityModes: {
      unified: '统一插件绑定',
      legacy: '历史兼容',
      legacyAdapted: '统一绑定与历史配置双读'
    },
    managementModes: {
      agent: 'Agent 模式',
      agentDescription: '绑定 Agent、站点实例和受管目标',
      workflow: '工作流模式',
      workflowDescription: '选择工作流版本和运行变量'
    },
    loading: {
      agents: '加载 Agent 中...',
      sites: '加载站点中...',
      managedTargets: '加载目标中...',
      certificateFormats: '加载格式配置中...',
      workflows: '加载工作流中...',
      versions: '加载版本中...',
      gateways: '加载 Gateway 中...',
      credentials: '加载凭据中...'
    },
    select: {
      agent: '请选择 Agent',
      siteInstance: '请选择站点实例',
      managedTarget: '请选择受管目标',
      certificateFormat: '请选择证书产物配置',
      workflow: '请选择工作流',
      publishedVersion: '请选择已发布版本',
      gateway: '请选择 Gateway',
      variablePreset: '选择预设变量',
      credential: '请选择凭据',
      generic: '请选择',
      artifactFormat: '请选择格式配置',
      output: '请选择输出项',
      optionalOutput: '可不选择',
      updatePluginOptional: '可不选择，继续使用当前生效插件'
    },
    validation: {
      variableNameRequired: '变量名称不能为空',
      variableNameInvalid: '变量 {name} 名称不合法',
      variableDuplicated: '变量 {name} 重复',
      variableRequired: '变量 {name} 必填',
      variableMustBeNumber: '变量 {name} 必须是数字',
      variableMustBeJsonObject: '变量 {name} 必须是 JSON 对象',
      variableInvalidJson: '变量 {name} 不是合法 JSON',
      variableCredentialInvalid: '变量 {name} 必须选择有效凭据',
      certificateFormatRequired: '证书变量 {name} 必须选择证书格式配置',
      certificateOutputRequired: '证书变量 {name}.{slot} 必须选择输出项',
      certificateOutputMissing: '证书变量 {name}.{slot} 选择的输出项不存在'
    },
    workflowVariableTypes: {
      string: '字符串',
      number: '数字',
      boolean: '布尔',
      enum: '枚举',
      object: '对象',
      file: '文件',
      credential: '凭据',
      certificate: '证书'
    },
    wizard: {
      ariaLabel: '应用资产创建步骤',
      steps: {
        basicEntry: '基础入口',
        deploymentMode: '部署模式',
        confirmSave: '确认保存'
      },
      stepState: {
        active: '进行中',
        done: '已完成',
        pending: '待开始',
        incomplete: '待完成',
        readyNext: '可进入下一步',
        pendingSubmit: '等待提交'
      },
      panels: {
        basicEntryTitle: '基础入口',
        basicEntryDescription: '先填写域名、端口、协议和平台，用它们确定应用入口身份。',
        agentTitle: 'Agent 目标绑定',
        agentDescription: '选择 Agent、站点实例、受管目标和证书产物配置。',
        workflowTitle: '工作流运行配置',
        workflowDescription: '选择工作流版本、运行位置和变量，证书变量会在运行时注入。',
        confirmTitle: '确认保存',
        confirmDescription: '检查应用入口、部署模式和运行参数，确认后写入应用资产。'
      }
    },
    form: {
      createTitle: '手动添加应用资产',
      editTitle: '编辑应用资产',
      createDescription: '创建应用入口并绑定后续部署需要的目标信息。',
      editDescription: '修改应用入口和部署目标绑定。',
      createRequestCompleted: '创建请求已完成。',
      editRequestCompleted: '保存请求已完成。',
      agentCertificateFormatHint: 'Agent 模式下会使用该证书产物配置生成部署材料。',
      placeholders: {
        displayName: '例如：生产站点入口',
        verifyUrl: '例如：https://example.com/health',
        siteName: '例如：生产站点',
        bindingInformation: '例如：*:443:example.com',
        hostHeader: '例如：example.com',
        sniName: '例如：example.com'
      }
    },
    review: {
      accessEntry: '访问入口',
      deploymentMode: '部署模式',
      agentSiteTarget: 'Agent / 站点 / 目标',
      workflowVersion: '工作流版本',
      gatewayRunner: 'Gateway：{gateway}',
      variableCount: '{count} 个变量',
      onlyBasicEntry: '仅基础入口',
      autoGeneratedByEntry: '按应用入口生成'
    },
    workflowTarget: {
      title: '应用资产属性',
      description: '用于应用资产展示、部署后探测和 DSL 目标变量同步。',
      dslSyncHint: '已同步到 DSL 目标变量',
      advancedTitle: '高级设置',
      advancedDescription: '仅在需要覆盖默认监听、请求域名或 TLS 证书域名时修改。',
      expandAdvanced: '展开高级设置',
      collapseAdvanced: '收起高级设置',
      bindingInformationLabel: '服务监听规则',
      bindingInformationHelp: '用于描述服务监听的地址、端口和域名组合。',
      hostHeaderLabel: '访问请求域名',
      hostHeaderHelp: '仅在目标服务要求指定 HTTP Host 请求头时修改。',
      sniNameLabel: 'TLS 证书域名',
      sniNameHelp: '仅在 TLS 握手域名与访问域名不一致时修改。'
    },
    workflowVersionSelection: {
      pinned: '固定当前版本',
      latestPublished: '始终使用最新已发布版本'
    },
    workflowVariables: {
      title: '工作流变量',
      configuredCount: '已配置 {configured}/{total}',
      name: '变量名称',
      type: '类型',
      value: '值',
      manual: '手动',
      empty: '暂无工作流变量。',
      noPublishedVersion: '请选择已发布工作流版本后配置变量。',
      certificateAutoInjected: '证书版本由部署计划选择，运行时自动注入。',
      certificateDescription: '证书版本由部署计划选择，应用资产在下方绑定格式配置和输出项，运行时注入 {name}.outputs.*.content。',
      presets: {
        deviceHost: '目标主机或设备地址',
        sshUsername: 'SSH 用户名',
        credential: '工作流凭据',
        certificate: '证书产物',
        targetPlatform: '目标平台',
        apacheServiceName: 'Apache systemd 服务名',
        apacheSiteConfigPath: 'Apache 站点配置路径',
        certificateFilePath: '证书目的路径',
        certificateKeyFilePath: '私钥目的路径',
        backupRoot: '证书备份根目录',
        expectedResponseContains: '验证响应包含文本',
        virtualHostServerName: '虚拟主机 ServerName'
      }
    },
    certificateBindings: {
      title: '证书变量绑定',
      description: '为工作流中的证书变量选择证书产物配置和输出项。',
      variableCount: '{count} 个证书变量',
      defaultVariableDescription: '证书产物变量',
      noArtifactOutputs: '当前格式配置暂无可选输出项。'
    },
    certificateOutputs: {
      publicCertificateWithChain: '公钥证书+证书链',
      publicCertificate: '公钥证书',
      certificateChain: '证书链',
      privateKey: '私钥',
      pemBundle: 'PEM 合并产物',
      container: '{format} 容器',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id}（已保存配置，当前列表未返回）',
      withPrivateKey: '含私钥',
      withoutPrivateKey: '无私钥'
    },
    snapshotTypes: {
      preDeploy: '部署前',
      postDeploy: '部署后',
      postRollback: '回退后',
      errorState: '错误态',
      rollbackPoint: '回退点'
    },
    errors: {
      loadWorkflowListFailed: '加载工作流列表失败',
      loadWorkflowVersionsFailed: '加载工作流版本失败',
      loadGatewayListFailed: '加载网关列表失败',
      loadCertificateFormatsFailed: '加载证书格式配置失败',
      loadAssetDetailFailed: '加载应用资产详情失败',
      rollbackFailed: '发起回退失败',
      loadTargetsFailed: '加载站点和受管目标失败',
      createAssetFailed: '创建应用资产失败',
      pluginFormLoadFailed: '加载插件配置表单失败',
      pluginBindingCreateFailed: '保存插件绑定失败',
      loadWorkflowCredentialsFailed: '加载工作流凭据失败',
      noAvailableSiteInstance: '未找到可用的站点实例，请先确认设备发现已成功上报框架和站点。',
      managedTargetRediscoveryRequired: '当前站点没有受管目标，请重新执行设备发现。',
      noCompatibleManagedPlugin: '没有与当前受管目标兼容的已启用插件。',
      capabilityAssignmentMissing: '当前目标尚未配置生效的部署能力。'
    },
    platforms: {
      appliance: '设备'
    },
    runners: {
      controlPlane: '平台',
      gateway: 'Gateway'
    },
    status: {
      archived: '已归档',
      unknownStatus: '未知状态'
    },
    common: {
      required: '必填',
      optional: '可选'
    }
  },
  certificates: {
    errors: {
      requestFailed: '请求失败'
    },
    detail: {
      backList: '返回列表',
      description: '展示证书版本详情、格式产物和关联资产。',
      title: '证书详情'
    },
    detailPanel: {
      sources: {
        agentContext: 'Agent上下文',
        platformBinding: '平台绑定记录'
      },
      usage: {
        columns: {
          domainName: '域名/目标',
          agentName: 'Agent名称',
          siteName: '站点名称',
          bindingType: '绑定类型',
          usageSource: '来源',
          status: '状态'
        },
        empty: '暂无关联资产',
        toolbar: '关联资产'
      },
      summary: {
        certificateName: '证书名称',
        logicalDomain: '逻辑域名',
        issuer: '颁发者',
        subject: '使用者',
        serialNumber: '序列号',
        chainStatus: '链状态'
      },
      sections: {
        subjectInfo: '主体信息',
        issuerInfo: '颁发者信息',
        certificateFields: '证书字段',
        extensionFields: '扩展字段'
      },
      fields: {
        commonName: '公用名(CN)',
        organization: '组织(O)',
        organizationalUnit: '组织单位(OU)',
        countryRegion: '国家/地区(C)',
        stateProvince: '省/州(ST)',
        locality: '城市(L)',
        version: '版本',
        signatureAlgorithm: '签名算法',
        publicKeyAlgorithm: '公钥算法',
        fingerprintSha256: 'SHA-256 指纹',
        san: 'SAN',
        deployable: '可部署',
        leafStorageRef: '叶子证书引用',
        chainCertificateCount: '链证书数量',
        chainDiagnostics: '链诊断'
      },
      fallbacks: {
        unknownCertificate: '未知证书',
        unknownIssuer: '未知签发者',
        unnamedCertificate: '未命名证书',
        unknownDomain: '未知域名',
        unknownSubject: '未知使用者',
        unknown: '未知',
        notPartOfCertificate: '不是证书的一部分',
        none: '暂无',
        emptyValue: '—',
        unknownType: '未知类型',
        unknownResource: '未知资源',
        unknownTarget: '未知目标'
      },
      values: {
        yes: '是',
        no: '否'
      },
      separators: {
        diagnostic: '；',
        list: '，'
      },
      chain: {
        roles: {
          leaf: '叶子证书',
          root: '根证书',
          intermediate: '中间证书'
        },
        title: '证书链',
        empty: '暂无证书链信息',
        subject: '主体：{value}',
        issuer: '签发者：{value}'
      },
      errors: {
        loadFailedTitle: '证书详情加载失败',
        code: '错误码：{code}'
      },
      actions: {
        retry: '重试'
      },
      states: {
        loading: '加载中...'
      },
      tabs: {
        ariaLabel: '证书详情标签',
        detail: '详情',
        usage: '关联资产'
      },
      validity: {
        title: '证书有效期',
        notBefore: '生效：{value}',
        notAfter: '到期：{value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: '版本 ID',
        createdAt: '创建时间',
        format: '格式',
        secretRef: 'Secret 引用',
        status: '状态'
      },
      create: '创建格式配置',
      createFailed: '创建格式失败',
      description: '证书 {id} 的 PEM/DER/PFX/JKS/P7B 格式配置入口。',
      empty: '暂无格式配置',
      fields: {
        alias: 'Alias（可选）',
        containsPrivateKey: '包含私钥（PEM）',
        passwordSecretRef: 'passwordSecretRef（PFX/JKS）',
        targetFormat: '目标格式',
        versionId: '版本 ID'
      },
      hint: 'PFX/JKS 必须使用系统已有的 passwordSecretRef；实际部署时会基于证书版本和格式配置即时生成材料。',
      loadFailed: '格式配置加载失败',
      optionAvailable: '{label} - 可用',
      placeholders: {
        alias: '例如 gcac-cert'
      },
      title: '证书格式配置',
      toolbar: '格式配置列表',
      unsupported: '{format} 当前能力声明不可创建。'
    },
    import: {
      backList: '返回证书列表',
      description: '当前仅支持 PEM + KEY 和 PFX；PFX 仅支持文件导入。导入材料必须包含服务器证书、完整中间证书链和私钥，根证书不是强制项。',
      errors: {
        importFailed: '导入失败',
        materialRequiredBeforeValidate: '必须先完成导入材料填写，才能开始校验。',
        needPassedValidation: '请先完成第 3 步校验，并确保校验通过后再导入。',
        validateFailed: '校验失败'
      },
      formats: {
        pem: {
          hint: '必须同时提供服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时会给出警告。'
        },
        pfx: {
          hint: '仅支持文件导入，且容器内必须包含服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时会给出警告。'
        }
      },
      methods: {
        file: {
          hint: '适合已有 cert / key 或 .pfx 文件的场景。',
          label: '选择文件'
        },
        text: {
          hint: '适合直接粘贴 PEM 文本，避免上传临时文件。',
          label: '粘贴文本'
        }
      },
      title: '导入证书'
    },
    importForm: {
      hints: {
        pemChainCheck: '请上传或粘贴服务器证书、完整中间证书链和私钥，系统会校验证书链与私钥匹配关系。',
        pfxChainCheck: '请上传 PFX/P12 文件并填写密码，系统会解析容器中的服务器证书、证书链和私钥。',
        pfxFileOnly: 'PFX 只支持文件导入。'
      },
      roles: {
        leaf: '叶子证书',
        root: '根证书',
        intermediate: '中间证书'
      },
      steps: {
        ariaLabel: '证书导入步骤',
        formatAndMethod: '格式与方式',
        materials: '导入材料',
        validateAndImport: '校验并导入'
      },
      formatIntro: {
        title: '选择导入格式和方式',
        description: '先确认材料格式，再选择上传文件或粘贴文本。PFX 目前只支持文件导入。'
      },
      labels: {
        importType: '导入类型',
        importMethod: '导入方式',
        materialStatus: '材料状态'
      },
      status: {
        supported: '已支持',
        unsupported: '暂不支持',
        completed: '已完成',
        incomplete: '未完成',
        matched: '匹配',
        unmatched: '不匹配'
      },
      fields: {
        certificateChainFile: '证书链文件',
        certificatePemText: '证书 PEM 文本',
        privateKey: '私钥（{kind}）',
        file: '文件',
        pemText: 'PEM 文本',
        pfxFile: 'PFX/P12 文件',
        certificateName: '证书名称',
        pfxPassword: 'PFX 密码'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
        certificateName: '例如 example.com 生产证书',
        required: '必填'
      },
      validation: {
        title: '校验导入材料',
        description: '提交导入前先校验证书链、有效期、私钥匹配和材料完整性。',
        passed: '校验通过，可以导入',
        failed: '校验未通过'
      },
      report: {
        certificateSummary: '证书摘要',
        serialNumber: '序列号',
        validity: '有效期',
        validityRange: '{start} 至 {end}',
        issuer: '颁发者',
        issuerWithValue: '签发者：{value}',
        subject: '使用者',
        chainValidation: '证书链校验',
        chainStatus: '链状态',
        certificateCount: '证书数量',
        privateKeyMatch: '私钥匹配',
        provided: '已提供',
        matchResult: '匹配结果',
        privateKeySource: '私钥来源',
        blockers: '阻断项',
        warnings: '警告'
      },
      selectedFile: '已选择：{name}',
      importSuccess: '导入成功，证书版本 ID：{id}',
      actions: {
        validating: '校验中...',
        validate: '开始校验',
        cancel: '取消',
        previous: '上一步',
        next: '下一步',
        importing: '导入中...',
        import: '导入证书'
      }
    },
    list: {
      filters: {
        keyword: '关键字',
        domain: '域名',
        status: '状态'
      },
      placeholders: {
        assetKeyword: '域名 / SAN / 指纹',
        versionKeyword: '名称 / 颁发者 / 使用者 / 版本 ID'
      },
      columns: {
        notBefore: '开始日期',
        notAfter: '结束日期',
        associatedAsset: '关联资产',
        status: '状态',
        certificateVersionId: '证书版本 ID'
      },
      lifecycle: {
        unknown: '未知',
        expired: '过期',
        expiringSoon: '即将过期',
        valid: '有效'
      },
      fallbacks: {
        unselectedDomain: '未选择域名',
        unnamedDomain: '未命名域名',
        noSupplement: '暂无补充信息'
      },
      assets: {
        title: '域名列表',
        loadFailed: '域名列表加载失败',
        empty: '暂无域名列表',
        unselectedTitle: '未选择域名',
        unselectedDescription: '请先在左侧选择一个逻辑证书域名。'
      },
      versions: {
        title: 'SSL 证书列表',
        titleWithDomain: '{domain} 的 SSL 证书列表',
        description: '右侧显示当前域名下的 SSL 证书列表，包含证书名称、开始日期、结束日期、颁发者和使用者信息。',
        loadFailed: 'SSL 证书列表加载失败',
        emptyForDomain: '该域名下暂无 SSL 证书',
        emptyForDomainDescription: '可以通过筛选栏右侧的导入证书按钮补充该域名的证书版本。',
        empty: '暂无 SSL 证书',
        toolbar: '证书版本列表',
        currentCount: '当前 {count} 条'
      },
      actions: {
        clear: '清空',
        deleteRisk: '删除会直接移除当前证书版本；如果该版本仍被绑定或部署引用，系统会拒绝此操作。'
      },
      errors: {
        deleteFailed: '删除失败',
        materialRequiredForFormat: '必须提供当前格式对应的证书材料。',
        importFailedWithCheck: '导入失败，请检查输入材料。',
        validateFailedWithCheck: '校验失败，请检查输入材料。'
      },
      import: {
        description: '当前仅支持 PEM + KEY 和 PFX；每次导入都必须包含服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时会显示警告。私钥仅保存到系统 Secret 存储，不会在 API 响应中返回。'
      }
    },
    usages: {
      backDetail: '返回详情',
      columns: {
        domainName: '域名/目标',
        resourceId: '资源 ID',
        resourceType: '资源类型',
        status: '状态',
        updatedAt: '更新时间'
      },
      description: '证书 {id} 的绑定、部署目标和资源引用。',
      empty: '暂无使用关系',
      loadFailed: '使用关系加载失败',
      title: '证书使用关系',
      toolbar: '使用关系'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: '用户名 + 密码',
        usernamePasswordWithUsername: '用户名 + 密码 / {username}',
        sshKey: 'SSH 私钥',
        sshKeyWithUsername: 'SSH 私钥 / {username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: '调用结构化 HTTP 接口，取代分散的 curl 命令。'
        },
        ssh: {
          displayName: 'SSH 命令',
          description: '声明要执行的 SSH 命令，只保存连接和凭据引用。'
        },
        sftp: {
          displayName: 'SFTP 上传/下载',
          description: '通过正式 SFTP step 上传或下载文件，适合证书与配置安装。'
        },
        scp: {
          displayName: 'SCP 上传/下载',
          description: '通过 SCP 复制文件，适合简单主机文件分发。'
        },
        verify: {
          displayName: '验证',
          description: '对 HTTP 状态、文本、正则或证书指纹做断言。'
        },
        condition: {
          displayName: '分支判断',
          description: '根据变量存在性或值决定后续路径。'
        },
        transform: {
          displayName: '数据转换',
          description: '使用 JSONata 把上游输出转换为新的工作流上下文变量。'
        },
        foreach: {
          displayName: '集合遍历',
          description: '按顺序遍历动态集合，并对每个元素执行同一组子步骤。'
        },
        checkpoint: {
          displayName: '恢复检查点',
          description: '在设备写操作前保存可验证的远端状态摘要。'
        },
        wait: {
          displayName: '等待',
          description: '等待固定秒数后继续执行。'
        },
        manual: {
          displayName: '人工确认',
          description: '暂停工作流，等待人工确认后继续。'
        }
      },
      fields: {
        command: '命令',
        connectionRef: '连接变量',
        contentRef: '内容变量',
        credential: '凭据',
        description: '说明',
        direction: '方向',
        expected: '期望值',
        expectedHostKeyFingerprint: 'Host Key 指纹',
        hostKeyPolicy: 'Host Key 策略',
        hostRef: '主机变量',
        inputRef: '输入变量',
        instruction: '确认说明',
        localPath: '本地路径',
        mode: '文件权限',
        operator: '操作符',
        remotePath: '远端路径',
        seconds: '等待秒数',
        temporaryPath: '临时路径',
        timeoutMs: '超时毫秒',
        timeoutSeconds: '超时秒数',
        transformInput: '转换输入',
        itemsPath: '集合路径',
        itemVariable: '元素变量',
        indexVariable: '索引变量',
        maxItems: '最大项数',
        foreachSteps: '子步骤 JSON',
        checkpointName: '检查点名称',
        checkpointCapture: '捕获路径 JSON',
        requiredForRollback: '回滚必需',
        outputFormat: '输出格式',
        usernameVariable: '用户名变量',
        variable: '变量',
        verifyType: '验证类型'
      },
      options: {
        boolean: { yes: '是', no: '否' },
        direction: {
          download: '下载',
          upload: '上传'
        },
        hostKeyPolicy: {
          manualApproval: '人工审批',
          strict: '严格校验',
          trustOnFirstUse: '首次信任'
        },
        operator: {
          equals: '等于',
          exists: '存在',
          notEquals: '不等于',
          notExists: '不存在'
        },
        transformFormat: {
          raw: '原始值',
          jsonString: 'JSON 字符串'
        },
        verifyType: {
          certificateFingerprint: '证书指纹',
          httpStatus: 'HTTP 状态',
          regex: '正则匹配',
          textContains: '文本包含'
        }
      },
      stages: {
        backup: {
          title: '备份',
          description: '保留可回滚材料。'
        },
        install: {
          title: '安装',
          description: '部署证书或配置。'
        },
        prepare: {
          title: '准备',
          description: '准备连接、变量和材料。'
        },
        refresh: {
          title: '刷新',
          description: '重载服务或刷新目标。'
        },
        verify: {
          title: '验证',
          description: '确认结果符合预期。'
        }
      },
      defaults: {
        displayName: '{name} 工作流',
        nodes: {
          backupExistingCertificate: '备份现有证书',
          reloadService: '重载服务'
        },
        variables: {
          certificatePaths: {
            description: '目标证书路径配置'
          },
          credential: {
            description: '连接凭据'
          },
          deviceHost: {
            description: '目标主机'
          },
          serverCert: {
            description: '待部署服务器证书材料',
            outputs: {
              certFile: {
                description: '服务器证书文件'
              },
              keyFile: {
                description: '私钥文件'
              }
            }
          },
          sshUsername: {
            description: 'SSH 登录用户名'
          },
          verifyUrl: {
            description: '部署后验证地址'
          }
        },
        config: {
          conditionDescription: '检查目标主机变量是否存在',
          manualInstruction: '请确认目标设备证书已切换到新版本。'
        }
      },
      variableFlow: {
        system: '系统',
        variable: '变量'
      },
      errors: {
        unknownNodeType: '未知节点类型：{type}'
      }
    },
    canvasEditor: {
      summary: '节点 {nodes} 个，连线 {edges} 条，变量 {variables} 个',
      stageNodeCount: '{count} 个节点',
      copyLabel: '{label} 副本',
      actions: {
        addVariable: '添加变量',
        collapseBottomPanelAria: '折叠底部控制面板',
        collapseDown: '向下折叠',
        copy: '复制',
        copyNode: '复制节点',
        delete: '删除',
        deleteNode: '删除节点',
        expandBottomPanelAria: '展开底部控制面板',
        expandPanel: '展开面板',
        layout: '整理布局',
        mockCurrentNode: '仅模拟当前节点',
        mockRunning: '模拟中...',
        paste: '粘贴',
        pasteNode: '粘贴节点',
        realRun: '真实试跑当前节点',
        realRunHttp: '真实 HTTP 试跑当前节点',
        realRunRunning: '试跑中...',
        realRunSsh: '真实 SSH 执行当前节点',
        realRunTransfer: '真实文件传输试跑',
        redo: '重做',
        saveDraft: '保存草稿',
        saving: '保存中...',
        undo: '撤销',
        zoomIn: '放大',
        zoomOut: '缩小'
      },
      aria: {
        bottomPanel: '底部面板',
        canvasArea: '画布区域',
        dslPanel: 'DSL 面板',
        nodePalette: '节点库',
        propertiesPanel: '属性面板',
        runtimePanel: '运行态面板',
        toolbar: '工作流画布工具栏',
        validationPanel: '校验面板',
        variablesPanel: '变量面板'
      },
      credentialHints: {
        savedApiKey: '已保存的 API Key',
        savedBearerToken: '已保存的 Bearer Token',
        savedSshSftp: '已保存的 SSH / SFTP 凭据',
        savedUsernamePassword: '已保存的用户名 + 密码'
      },
      credentials: {
        emptyCreateHint: '暂无可用凭据。请先在列表页的凭据管理中创建。',
        loading: '正在加载凭据列表…'
      },
      dsl: {
        title: 'DSL 导入与覆盖',
        hint: '可直接粘贴外部 DSL JSON，或选择本地 DSL 文件。导入只覆盖浏览器中的当前画布，点击“保存草稿”后才会生成新的工作流版本。',
        selectFile: '选择 DSL 文件',
        actions: {
          importOverwrite: '导入 DSL 覆盖画布',
          resetToCanvas: '回填当前画布 DSL'
        },
        messages: {
          fileLoaded: '已加载文件：{fileName}',
          imported: 'DSL 已导入并覆盖当前画布，共 {count} 个节点。',
          resetToCompiled: '已回填编译后的 DSL。'
        },
        errors: {
          importFailed: 'DSL 导入失败',
          invalidTopLevel: 'DSL 顶层结构无效，必须是对象。'
        }
      },
      empty: {
        selectNodeToEdit: '请选择节点后编辑属性。'
      },
      errors: {
        backendValidationFailed: '校验失败',
        credentialsLoadFailed: '加载工作流凭据失败',
        missingStepName: '缺少步骤名称',
        missingWorkflowDsl: '未能获取到工作流 DSL'
      },
      fields: {
        authType: '认证类型',
        clientCertificate: '客户端证书',
        clientPrivateKey: '客户端私钥',
        command: '命令',
        connectionVariable: '连接变量',
        contentRef: '内容引用',
        cookieName: 'Cookie 名称',
        credential: '凭据',
        credentialSelector: '凭据选择器',
        defaultValue: '默认值',
        deliveryLocation: '传递位置',
        description: '说明',
        direction: '方向',
        fileMode: '文件权限',
        headerName: 'Header 名称',
        hostRefOrHostname: '主机变量 / 主机名',
        hostVariable: '主机变量',
        keyName: 'Key 名称',
        localPath: '本地路径',
        newNodeStage: '新增节点阶段',
        nodeName: '节点名称',
        remotePath: '远端路径',
        required: '必填',
        secretValue: '密文值',
        sensitive: '敏感',
        stage: '所属阶段',
        temporaryPath: '临时路径',
        timeoutSeconds: '超时秒数',
        type: '类型',
        username: '用户名',
        variableName: '变量名'
      },
      options: {
        download: '下载',
        manualInput: '手动填写',
        notSelected: '未选择',
        upload: '上传'
      },
      runtime: {
        noCredentialVariables: '当前工作流没有凭据变量。',
        noExtraVariables: '当前节点没有额外运行时变量。'
      },
      sections: {
        httpAuth: 'HTTP 认证',
        nodePalette: '节点库',
        properties: '属性面板',
        referenceFlow: '引用流',
        runtimeCredentialVariables: '运行时凭据变量',
        runtimeVariables: '运行时变量',
        singleNodeTest: '单节点测试运行',
        variableConfig: '变量配置'
      },
      tabs: {
        runtime: '运行态',
        validation: '校验',
        variables: '变量'
      },
      test: {
        cause: '原因',
        code: '代码',
        emptyHint: '选择节点后可运行模拟或真实试跑。',
        error: '错误',
        executionPlan: '执行计划',
        exitCode: '退出码',
        failureDetails: '失败详情',
        hint: '测试提示',
        logs: '日志',
        nodeOutput: '节点输出',
        running: '运行中',
        stage: '阶段',
        stderr: '标准错误',
        stdout: '标准输出',
        suggestion: '建议',
        target: '目标',
        errors: {
          mockRunFailed: '模拟运行失败',
          realRunFailed: '真实试跑失败'
        },
        messages: {
          mockCompleted: '模拟运行完成。',
          mockFailed: '模拟运行失败。',
          realCompleted: '真实试跑完成。',
          realFailed: '真实试跑失败。'
        }
      },
      validation: {
        levels: {
          error: '错误',
          risk: '风险',
          warning: '警告'
        },
        location: {
          canvas: '画布',
          edge: '连线',
          fieldSuffix: '字段',
          node: '节点'
        },
        noBlockingErrors: '没有阻断错误。'
      },
      variables: {
        customRuntimeDescription: '自定义运行变量',
        notUsed: '未使用',
        usedBy: '使用位置：{nodes}'
      }
    },
    templates: {
      title: '工作流',
      resourceName: '工作流',
      description: '按画布草稿管理 CURL/SSH/SFTP 工作流版本、发布状态与变更记录。',
      pluginSources: {
        createTitle: '从插件新建工作流',
        applyTitle: '从插件生成草稿',
        description: '只列出已启用插件中的证书部署或回滚工作流。复制后工作流归当前用户所有，可继续编辑。',
        createAction: '创建工作流',
        applyAction: '生成草稿',
        currentTarget: '当前工作流：{name}',
        namePlaceholder: '输入新工作流名称',
        loading: '正在加载插件工作流来源...',
        empty: '没有可用的插件工作流来源。',
        version: '插件版本',
        provenance: '插件派生来源',
        capabilities: { deploy: '证书部署', rollback: '证书回滚' },
        errors: { loadFailed: '加载插件工作流来源失败', nameRequired: '请输入工作流名称', missingApplyTarget: '缺少要生成草稿的工作流', actionFailed: '插件工作流复制失败' }
      },
      origins: { legacy: '历史工作流', user: '用户工作流', plugin_internal: '插件内部工作流', plugin_derived: '插件派生工作流' },
      actions: {
        addVersion: '新增版本',
        applyTemplate: '套用模板',
        cancel: '取消',
        close: '关闭',
        createBlank: '空白新建',
        credentialManagement: '凭据管理',
        delete: '删除',
        detail: '详情',
        edit: '编辑',
        publishVersion: '发布版本',
        rename: '修改名称',
        saveName: '保存名称',
        saveNote: '保存备注',
        switchVersion: '切换版本',
        templateManagement: '模板管理',
        versionManagement: '版本管理'
      },
      states: {
        creating: '创建中...',
        loading: '加载中...',
        processing: '处理中...',
        saving: '保存中...'
      },
      fields: {
        actions: '操作',
        createdAt: '创建时间',
        currentStatus: '当前状态',
        currentVersion: '当前版本',
        currentVersionId: '当前版本 ID',
        id: '工作流 ID',
        name: '工作流名称',
        origin: '来源',
        note: '备注',
        status: '状态',
        updatedAt: '更新时间'
      },
      empty: {
        description: '先创建画布草稿，再基于版本发布到正式链路。',
        noChangeSummary: '没有变更说明。',
        noChangeSummaryShort: '没有变更说明',
        noVersions: '暂无版本。',
        title: '暂无工作流'
      },
      tabs: {
        summary: '概览',
        versions: '版本'
      },
      versionStatuses: {
        disabled: '已禁用',
        draft: '草稿',
        published: '已发布'
      },
      detail: {
        description: '查看工作流详情、画布草稿与版本清单。',
        publishedVersion: '当前发布版本 {version}',
        title: '工作流详情',
        titleWithName: '工作流 {name}'
      },
      rename: {
        title: '工作流名称',
        description: '修改列表和详情中展示的工作流名称，不会改写历史版本。',
        placeholder: '请输入工作流名称',
        messages: { success: '工作流名称已更新。' },
        errors: { required: '工作流名称不能为空。', failed: '工作流名称修改失败。' }
      },
      versionManager: {
        description: '管理工作流版本的新建与发布，不涉及画布内容的修改。',
        titleWithName: '版本管理：{name}'
      },
      changeSummaries: {
        createFromPlugin: '从插件能力创建工作流',
        applyFromPlugin: '从插件能力生成新草稿',
        applyFromFileTemplate: '从文件模板覆盖工作流草稿',
        createCanvasDraft: '前端画布创建工作流草稿',
        createFromFileTemplate: '从文件模板创建工作流草稿',
        createVersionDraft: '版本管理创建新版本草稿',
        saveCanvasDraft: '画布编辑器保存草稿版本'
      },
      messages: {
        canvasDraftUpdated: '当前草稿版本已更新。',
        switchedVersion: '已切换到 {version}。',
        versionDraftCreated: '新版本草稿已创建。',
        versionNoteUpdated: '版本备注已更新。'
      },
      errors: {
        createVersionFailed: '创建工作流版本失败',
        loadVersionsFailed: '加载工作流版本失败',
        missingWorkflowDsl: '未能获取到工作流 DSL',
        publishVersionFailed: '发布工作流版本失败',
        saveCanvasDraftFailed: '保存画布草稿失败',
        updateVersionNoteFailed: '更新版本备注失败'
      },
      delete: {
        riskText: '删除会禁用该工作流及其全部版本，列表中不再展示；历史运行记录不会被改写。'
      },
      loading: {
        versions: '正在加载版本...'
      },
      fileTemplates: {
        applyAction: '按模板覆盖当前工作流',
        applyTitle: '用文件模板覆盖工作流',
        createAction: '按模板创建工作流',
        createTitle: '从文件模板新建工作流',
        currentTarget: '当前目标：{name}',
        description: '模板文件来自内置模板库或用户导入目录。覆盖现有工作流时，会创建新的草稿版本，不会改写历史版本。',
        empty: '暂无可识别的工作流模板文件。',
        identifier: '标识 {name}',
        invalid: '无效',
        invalidFile: '文件无效',
        loading: '正在扫描文件模板...',
        valid: '可用',
        sources: {
          builtin: '内置',
          userImported: '用户导入'
        },
        errors: {
          actionFailed: '执行文件模板动作失败',
          loadFailed: '加载工作流文件模板失败',
          missingApplyTarget: '缺少待覆盖的工作流目标'
        }
      },
      credentials: {
        actions: {
          create: '创建凭据'
        },
        addTitle: '新增凭据',
        count: '{count} 个',
        description: '集中管理工作流所需的登录凭据与 API 凭据，支持在画布和节点中直接选择复用。',
        empty: '暂无凭据记录。创建后可直接在变量、SSH 节点和 HTTP 节点里选择。',
        loading: '正在加载凭据信息…',
        registeredTitle: '已登记凭据',
        title: '凭据管理',
        fields: {
          deliveryLocation: '传递位置',
          headerOrParam: 'Header / 参数名',
          name: '凭据名称',
          referenceLocation: '引用位置',
          storageType: '存储类型',
          type: '凭据类型',
          username: '用户名'
        },
        kinds: {
          common: {
            family: '通用'
          },
          sshKey: {
            title: 'SSH 私钥'
          },
          usernamePassword: {
            title: '用户名 + 密码'
          }
        },
        secretLabels: {
          password: '密码',
          sshKey: 'SSH 私钥'
        },
        placeholders: {
          apiKey: '输入 API Key',
          bearer: '输入 Bearer Token',
          password: '输入登录密码',
          sshKey: '粘贴 PEM 格式私钥'
        },
        messages: {
          created: '凭据已创建，可直接在工作流变量、SSH 节点和 HTTP 节点中选择。'
        },
        errors: {
          createFailed: '创建凭据失败',
          loadFailed: '加载凭据失败',
          missingCreatedId: '创建凭据未返回有效编号'
        }
      }
    }
  },
  monitoring: {
    actions: {
      add: '添加监控',
      probe: '检测站点',
      probing: '检测中...',
      refresh: '刷新数据',
      refreshing: '刷新中...',
      remove: '移除'
    },
    errors: {
      addFailed: '监控目标添加失败',
      deleteFailed: '监控目标删除失败',
      invalidTarget: '监控目标数据无效',
      loadFailed: '监控数据加载失败',
      probeFailed: '探测请求失败',
      updateIntervalFailed: '探测频率更新失败'
    },
    empty: {
      actualCertificate: '暂无实测 TLS 证书。HTTPS 目标会在站点检测时自动采集证书信息。',
      description: '点击右上角添加监控，系统会按目标频率检测站点并同步采集证书信息。',
      noAddableAssets: '暂无可添加应用资产，已有目标请在详情中调整探测频率。',
      observedCertificateHistory: '暂无绑定证书版本。站点检测采集到第一张证书后会自动保留。',
      probeHistory: '暂无探测历史。',
      riskEvents: '暂无相关事件。',
      title: '暂无监控目标'
    },
    sections: {
      actualCertificate: '当前站点实测证书',
      actualCertificateHint: '随站点检测自动采集',
      observedCertificateHistory: '绑定证书版本',
      observedCertificateHistoryHint: '按实测 TLS 证书变化保留版本记录',
      probeHistory: '探测历史',
      probeHistoryHint: '系统探测结果最近 20 次记录',
      riskEvents: '风险事件',
      riskEventsHint: '证书链、域名、指纹和执行状态',
      targets: '监控目标'
    },
    labels: {
      applicationAsset: '应用资产',
      currentTarget: '当前目标',
      probeInterval: '探测频率'
    },
    metrics: {
      availability: '可访问性',
      certificateStatus: '证书状态',
      latency: '访问延时',
      observedCertificateChanges: '实测证书变更'
    },
    probe: {
      completed: '探测完成',
      emptyHistoryBlock: '第 {index} 次：暂无探测',
      latencyNotCollected: '未采集延时',
      recentAria: '最近 10 次探测结果',
      waiting: '等待站点检测'
    },
    status: {
      error: '错误',
      none: '待执行',
      ready: '正常',
      warning: '警告'
    },
    fallback: {
      noEndpoint: '未配置访问地址',
      noFingerprint: '无指纹',
      noSummary: '无摘要',
      notCollected: '未采集',
      notSelected: '未选择',
      unknownAsset: '未知资产',
      unknownCertificate: '未知证书',
      unknownIssuer: '未知颁发者',
      unnamedEvent: '未命名事件'
    },
    certificate: {
      actualCertificate: '实测证书',
      chainUntrusted: '未通过系统信任链验证',
      chainVerification: '链验证',
      chainVerified: '链验证通过',
      chainVerifyFailedWithReason: '链验证失败：{reason}',
      collectedAt: '采集时间',
      issuer: '颁发者',
      serialNumber: '序列号',
      sha256Fingerprint: 'SHA-256 指纹',
      subject: '主体',
      validity: '有效期',
      validityRange: '{start} 至 {end}'
    },
    columns: {
      certificateName: '证书名称',
      changedAt: '更换时间',
      expiresAt: '到期时间',
      issuerName: '颁发者名称',
      latency: '延时',
      result: '结果',
      source: '来源',
      status: '状态',
      time: '时间'
    },
    dialog: {
      defaultMetricsHint: '默认监控可访问性、访问延时、证书信息和证书历史。',
      description: '从应用资产列表选择一个目标，系统会固定采集可访问性、访问延时、证书信息和证书历史。',
      loadingAssets: '加载资产中...',
      selectAsset: '请选择应用资产',
      title: '添加监控'
    },
    source: {
      controlPlane: '平台'
    },
    targets: {
      assetCount: '{count} 个资产'
    }
  },
  login: {
    visualLabel: '产品说明',
    brand: 'GCAC 证书控制台',
    brandSecondary: '证书集中管理平台',
    headlinePrefix: '让证书管理',
    headlineHighlight: '更智能',
    headlineSuffix: '、更安全',
    intro: '一站式管理证书资产，自动化部署编排，全链路审计追踪，将证书运维从繁琐的人工操作转变为可验证、可回溯的标准化流程，为企业数字基础设施保驾护航。',
    capabilitiesLabel: '平台能力',
    featureLifecycle: '全生命周期管理',
    featureLifecycleDesc: '从导入、续签、版本追踪到到期预警，覆盖证书资产的每一个环节。',
    featureAutomation: '自动化部署编排',
    featureAutomationDesc: '面向 Nginx、Tomcat、IIS 等主流环境，一键生成可审计的部署计划。',
    featureRollback: '安全执行与回滚',
    featureRollbackDesc: '部署前自动校验，执行全程留痕，失败即回滚，确保生产环境稳定无忧。',
    formLabel: '登录表单',
    secure: '安全连接',
    welcome: '登录控制台',
    hint: '使用企业账号进入 GCAC 管理工作台',
    username: '用户名',
    usernamePlaceholder: '请输入用户名',
    password: '密码',
    passwordPlaceholder: '请输入密码',
    failed: '登录失败，请稍后重试',
    submitting: '正在验证身份…',
    submit: '登 录',
    policy: 'RBAC 权限保护',
    audit: '操作全程审计'
  },
  reports: {
    common: {
      loadFailed: '报表加载失败，请稍后重试',
      dataAsOf: '数据截止时间：{time}',
      rangeDays: '最近 {days} 天',
      samples: '样本数：{count}',
      secondsValue: '{value} 秒',
      emptyValue: '—',
      trend: '历史趋势',
      date: '日期',
      snapshotMetrics: '快照指标数',
      completeness: '完整性',
      complete: '完整',
      incomplete: '不完整',
      noTrend: '当前时间范围暂无历史快照',
      groupBreakdown: '分组对比',
      dimension: '维度',
      groupValue: '分组值',
      count: '数量',
      noGroups: '暂无分组数据',
      drilldown: '对象下钻',
      selectedMetric: '当前指标：{metric}',
      noItems: '暂无符合条件的对象'
    },
    incidentWindow: {
      title: '证书事故窗口报表',
      description: '识别正在进入事故窗口的证书，并定位缺少替换证书、计划或执行通道的对象。'
    },
    riskResponse: {
      title: '风险处置报表',
      description: '查看风险确认与解决是否及时，定位未完成样本、重新打开和 SLA 逾期。'
    },
    automationEffectiveness: {
      title: '自动化成效报表',
      description: '分别查看运行级和目标级成功率，并定位重试、回滚、人工介入和失败阶段。'
    },
    export: {
      csv: '导出 CSV',
      generating: '正在生成…',
      failed: 'CSV 生成失败',
      history: '导出记录',
      download: '下载',
      noHistory: '暂无导出记录',
      status: {
        queued: '排队中',
        running: '生成中',
        succeeded: '已完成',
        failed: '失败',
        expired: '已过期'
      }
    },
    aria: {
      reportPage: '运营报表页面',
      rangeFilter: '报表时间范围',
      metrics: '报表核心指标',
      filters: '报表筛选条件'
    },
    filters: {
      environment: '环境',
      ownerId: '负责人 ID',
      assetId: '对象 ID',
      tag: '标签',
      severity: '风险等级',
      riskType: '风险类型',
      automationId: '自动化 ID',
      failureStage: '失败阶段',
      all: '全部',
      apply: '应用筛选',
      reset: '重置筛选'
    },
    groups: {
      dimensions: {
        usage_status: '使用状态',
        readiness_stage: '准备阶段',
        environment: '环境',
        owner_id: '负责人',
        severity: '风险等级',
        risk_type: '风险类型',
        action_type: '动作类型',
        failure_stage: '失败阶段'
      },
      values: {
        in_use: '在用',
        idle: '闲置',
        unknown: '未知',
        missing_replacement: '缺少替换证书',
        plan_missing: '尚未创建计划',
        waiting_approval: '等待审批',
        blocked: '执行通道阻塞',
        ready: '已准备',
        critical: '严重',
        high: '高',
        medium: '中',
        low: '低',
        create_deployment_plan: '创建部署计划',
        execute_deployment_plan: '执行部署计划',
        send_notification: '发送通知',
        selection: '目标选择',
        plan_creation: '计划创建',
        dry_run: '预检',
        approval: '审批',
        execution: '执行',
        verification: '验证',
        rollback: '回滚',
        notification: '通知',
        none: '无失败阶段'
      }
    },
    columns: {
      certificateAssetId: '证书资产 ID',
      certificateVersionId: '证书版本 ID',
      name: '名称',
      primaryDomain: '主域名',
      notAfter: '到期时间',
      usageStatus: '使用状态',
      readinessStage: '准备阶段',
      environment: '环境',
      ownerId: '负责人',
      tags: '标签',
      publicExposure: '公网暴露',
      bindingIds: '绑定 ID',
      risk: '风险',
      history: '状态历史',
      slaPolicy: 'SLA 策略',
      timing: '处置时长',
      id: 'ID',
      automationId: '自动化 ID',
      automationVersion: '自动化版本',
      automationNameSnapshot: '自动化名称',
      triggerType: '触发类型',
      status: '状态',
      failureStage: '失败阶段',
      startedAt: '开始时间',
      finishedAt: '完成时间',
      createdAt: '创建时间',
      runId: '运行 ID',
      targetSnapshot: '目标快照',
      actionType: '动作类型',
      deploymentPlanId: '部署计划 ID',
      executionRunId: '执行记录 ID',
      notificationRequestIds: '通知请求 ID',
      attemptCount: '尝试次数',
      rollbackStatus: '回滚状态',
      manualIntervention: '人工介入',
      unknown: '{name}'
    },
    metrics: {
      certificates: {
        expiring: {
          '30d': '16–30 天到期',
          '15d': '8–15 天到期',
          '7d': '4–7 天到期',
          '3d': '2–3 天到期',
          '1d': '0–1 天到期'
        },
        expired: {
          in_use: '已过期且在用'
        },
        missing_replacement: '缺少替换证书',
        missing_deployment_plan: '尚未创建计划',
        waiting_approval: '等待审批',
        execution_channel_blocked: '执行通道阻塞'
      },
      risks: {
        created: '新增风险',
        resolved: '已解决风险',
        reopened: '重新打开',
        open_end_of_period: '期末未解决',
        overdue_acknowledgement: '确认 SLA 逾期',
        overdue_resolution: '解决 SLA 逾期',
        tta: {
          average_seconds: '平均确认时长'
        },
        ttr: {
          average_seconds: '平均解决时长'
        },
        ack_sla_rate: '确认 SLA 达标率',
        resolve_sla_rate: '解决 SLA 达标率'
      },
      automations: {
        runs: {
          total: '自动化运行数',
          success_rate: '运行级成功率'
        },
        targets: {
          total: '自动化目标数',
          success_rate: '目标级成功率',
          failed: '失败目标',
          retried: '重试目标',
          rollback_succeeded: '回滚成功',
          rollback_failed: '回滚失败',
          manual_intervention: '需要人工介入',
          waiting_approval: '等待审批目标'
        }
      }
    }
  },
  internalCa: {
    title: '内部 CA', description: '统一管理内部证书机构、应用证书生命周期、CA Node 与证书复用风险。',
    tabs: { trustDomains: 'CA 信任域', authorities: '证书机构', profiles: '证书 Profile', requests: '证书申请', operations: '生命周期运维', risks: '复用风险' },
    trustDomains: { recordsTitle: '信任域记录', columns: { name: '名称', purpose: '用途', isolationLevel: '隔离等级', status: '状态', default: '默认状态', createdAt: '创建时间' }, empty: '暂无 CA 信任域记录。', modalTitle: '新增 CA 信任域', modalDescription: '填写信任域基本信息，唯一代码由系统自动生成。', generatedCodeHint: '唯一代码由系统自动生成，无需手动填写。', notDefault: '非默认' },
    topology: { rootOnly: '仅根 CA', rootOnlyDescription: '根 CA 直接承担日常签发，部署简单但根密钥需要长期在线。', rootOnlyRisk: '高风险：根密钥失陷会影响整个信任域。', intermediate: '根 CA + 中间 CA', intermediateDescription: '根 CA 离线保管，由中间 CA 承担日常签发。', recommended: '推荐：隔离根密钥并缩小签发故障域。' },
    sections: { trustDomain: '创建 CA 信任域', provider: 'CA Provider', providerSettings: 'CA Provider 配置', issuingBackends: '签发后端与连接状态', authorityWizard: 'CA 创建向导', authorityOverview: '证书机构架构', authorityOverviewDescription: '每张卡片代表一个根信任锚点，选择卡片可查看其下级签发架构。', caArchitecture: 'CA 层级架构', riskSummary: '安全决策摘要', profile: '创建证书 Profile', request: '创建应用证书申请', revocation: '创建吊销任务', trust: '创建信任分发任务', remediation: '整改预览' },
    fields: { name: '名称', code: '唯一代码', purpose: '用途', isolationLevel: '隔离等级', defaultTrustDomain: '设为默认信任域', trustDomain: 'CA 信任域', parentAuthority: '父根 CA', authorityType: '证书机构类型', providerType: '外部 CA 类型', deploymentMode: '部署模式', platform: '运行平台', provider: 'CA Provider', backendName: '签发后端名称', availabilityMode: '可用性模式', endpoint: '服务地址', authMode: '身份认证方式', profile: '签发 Profile', template: '证书模板', crlUrl: 'CRL 地址', ocspUrl: 'OCSP 地址', issuingBackend: '签发后端', entryMode: '创建方式', commonName: 'Common Name', securityDomain: '安全域', topology: 'CA 拓扑', dnsSuffixes: '允许的 DNS 后缀', validityDays: '最大有效期（天）', renewalDays: '提前续期（天）', requireApproval: '签发前需要审批', applicationAssetId: '应用资产 ID', authority: '证书机构', profileVersionId: 'Profile 版本 ID', sans: 'SAN 列表', custodyMode: '密钥托管模式', certificateVersionId: '证书版本 ID', reason: '吊销原因', targetIds: '目标 ID 列表' },
    actions: { refresh: '刷新', addTrustDomain: '新增信任域', addAuthority: '添加 CA', addIntermediate: '添加中间 CA', previous: '上一步', next: '下一步', createTrustDomain: '创建信任域', createProvider: '创建 Provider', previewRisk: '预览风险', createAuthority: '创建 CA', createProfile: '创建 Profile', createRequest: '提交申请', approve: '审批通过', retry: '重试', queryResult: '查询结果', scanRenewals: '扫描到期续期', createRevocation: '创建吊销任务', createTrust: '创建信任分发', previewRemediation: '预览整改' },
    placeholders: { dnsSuffixes: 'example.com, office.example.com', sans: 'oa.example.com, 10.0.0.10' },
    messages: { loadFailed: '内部 CA 数据加载失败。', actionFailed: '操作失败，请检查输入、权限和审批状态。', noIntermediate: '该根 CA 尚未配置中间证书颁发机构。', noRootAuthority: '尚未配置根 CA', noRootAuthorityDescription: '添加根 CA 以建立第一套独立信任架构。', trustDomainCreated: 'CA 信任域已创建。', providerCreated: 'CA Provider 已创建。', providerDeleted: '未绑定的 AD CS Provider 已删除。', authorityCreated: '证书机构已创建。', profileCreated: '证书 Profile 已创建。', requestCreated: '证书申请已提交。', requestApproved: '证书申请已审批。', requestRetried: '证书签发已重试。', requestQueried: '远程签发结果已刷新。', renewalScanned: '续期扫描已完成。', revocationCreated: '吊销任务已创建并等待审批。', revocationApproved: '证书吊销已审批。', trustCreated: '信任分发任务已创建并等待审批。', trustApproved: '信任分发已审批。', adcsAgentInstallCreated: 'AD CS Agent 安装命令已生成。' },
    metrics: { nodes: 'CA Node', renewals: '续期任务', revocations: '吊销任务', trust: '信任分发', totalRisks: '风险总数', critical: '严重风险', affectedAssets: '受影响应用资产' },
    labels: { rootAuthority: '根证书颁发机构', intermediateAuthority: '中间证书颁发机构', intermediateCount: '{count} 个中间 CA', expiresAt: '到期时间：{time}', defaultTrustDomain: '默认信任域', independentTrustDomain: '独立根信任边界', trustDomainCount: '{count} 个 CA 信任域', versionCount: '{count} 个版本', assetCount: '{count} 个应用资产', requestCount: '将创建 {count} 个独立证书申请', backendUsageCount: '{count} 个证书机构正在使用', unverifiedCapabilityCount: '{count} 项能力尚未验证' },
    providerTypes: { gcac_builtin: 'GCAC 内置 CA', gcac_managed_node: 'GCAC 独立 CA Node', microsoft_adcs: 'Microsoft AD CS', acme: 'ACME 服务', est: 'EST 服务', scep: 'SCEP 服务', product_adapter: '产品适配器' },
    adcsAgent: { title: '连接现有 Microsoft AD CS', description: '在已经安装并配置 AD CS 的 Windows Server 上部署 GCAC Adapter。', providerCount: '当前已配置 {count} 套 Microsoft AD CS 连接', addProvider: '连接现有 AD CS', updateAgent: '更新 Agent', updateTitle: '更新 Microsoft AD CS Agent', updateDescription: '为已有 Provider 生成一次性更新命令，不会创建新的 Provider，也不会改变已管理的 CA。', updateCommand: '生成更新命令', wizardTitle: '连接现有 Microsoft AD CS', wizardDescription: '为一台已经运行证书颁发机构的 AD CS 服务器创建独立连接，并生成 Adapter 安装命令。', requirementsTitle: '目标服务器必须已经满足', requirementInstalled: '已安装 Active Directory Certificate Services 的 Certification Authority 角色服务。', requirementConfigured: '已完成 Enterprise CA 或 Standalone CA 初始化，并存在活动 CA Config。', requirementService: 'CertSvc 服务正在运行。', requirementPermission: '执行安装命令及运行 Agent 的账户具备所需的模板申请、CA 查询和管理权限。', connectionName: 'AD CS 连接名称', coexistenceTitle: '与其他 GCAC Agent 共存', coexistenceDescription: 'AD CS Agent 使用独立服务名和独立目录，通过主动出站长连接接收任务并回传结果，不监听本地端口。它可与设备管理 Agent 或 Gateway Agent 安装在同一台 Windows Server 上。', createCommand: '创建连接并生成 Agent 安装命令', commandReadyTitle: 'Adapter 安装命令已生成', commandReadyDescription: '已创建 {name}，请在运行现有 AD CS CA 的服务器上，以管理员 PowerShell 执行以下命令。', expiresAt: '命令到期时间：{time}', deleteProvider: '删除 Provider', deletingProvider: '删除中…', deleteConfirmText: 'DELETE', deleteProviderRisk: '将删除该 Provider 及其未完成的注册令牌、Agent 节点、任务和能力记录。已绑定证书机构的 Provider 不允许删除。', deleteProviderBlocked: '该 Provider 已被证书机构使用，必须先迁移或移除对应证书机构。', defaultProviderName: 'Microsoft AD CS Agent', defaultProviderNameIndexed: 'Microsoft AD CS 连接 {index}' },
    availability: { single: '单节点', activeStandby: '主备', activeActive: '多活' },
    authModes: { managedSecret: '托管凭据', clientCertificate: '客户端证书', none: '无认证' },
    wizard: { title: '添加证书颁发机构', description: '先选择签发方式，再逐步配置签发后端、CA 参数和安全边界。', stepsAria: 'CA 创建步骤', entryStep: '选择方式', backendStep: '配置后端', parentStep: '选择父 CA', authorityStep: '配置 CA', reviewStep: '确认创建', completed: '已完成', inProgress: '进行中', pending: '待填写', entryEyebrow: '第一步', entryTitle: '这套 CA 由谁负责签发？', entryDescription: '选择最符合部署边界的入口。内置 CA 无需手工创建 Provider。', recommended: '推荐起步', builtinTitle: '直接创建 CA', builtinDescription: '由当前 GCAC 服务内置的 OpenSSL 与 SecretService 执行签发。', builtinFeature1: '无需部署额外节点', builtinFeature2: '适合开发和中小规模内部环境', managedTitle: '部署 GCAC CA Node', managedDescription: '将 CA 私钥和签发执行面隔离到独立 Windows 或 Linux 机器。', managedFeature1: '一次性令牌注册节点', managedFeature2: '为 HSM 与冗余部署预留边界', externalTitle: '连接外部 CA', externalDescription: '连接现有 Microsoft AD CS、ACME、EST、SCEP 或适配服务。', externalFeature1: '复用企业已有 PKI', externalFeature2: '由外部系统维护 CA 密钥', backendEyebrow: '签发后端', builtinBackendTitle: '使用 GCAC 内置签发后端', builtinBackendDescription: '系统自动创建或复用租户内置 Provider，用户只需要配置 CA。', managed_nodeBackendTitle: '配置独立 GCAC CA Node', managed_nodeBackendDescription: '创建节点签发后端并生成短期一次性注册令牌。', externalBackendTitle: '配置外部 CA 连接', externalBackendDescription: '填写适配服务地址和签发参数，GCAC 不接管外部 CA 私钥。', builtinAutomaticTitle: '无需单独创建 Provider', builtinAutomaticDescription: '创建 CA 时系统会自动确保内置签发后端存在，并绑定到当前 CA。', authorityEyebrow: '证书机构', rootConfigurationTitle: '配置根 CA', rootConfigurationDescription: '定义新的根信任边界、名称、主题和是否启用中间 CA。', intermediateConfigurationTitle: '配置中间 CA', intermediateConfigurationDescription: '先选择父根 CA，再配置承担日常签发的中间证书颁发机构。', builtinSecurityNote: '软件私钥由 GCAC SecretService 托管，不等同于不可导出 HSM 密钥。', managed_nodeSecurityNote: '私钥位于独立节点；只有节点注册并通过能力验证后才应投入生产。', externalSecurityNote: 'GCAC 通过外部连接申请证书，不拥有外部 CA 的根私钥。', reviewEyebrow: '最终确认', reviewTitle: '检查信任边界与签发方式', reviewDescription: '确认 CA 名称、信任域、签发后端和风险提示后再创建。', enrollmentTitle: 'CA Node 一次性注册令牌', enrollmentDescription: '令牌仅用于独立节点首次注册，请通过安全通道复制到目标机器。', enrollmentExpiresAt: '令牌到期时间：{time}', builtinProviderName: 'GCAC 内置签发后端', managedProviderName: 'GCAC 独立 CA Node', externalProviderName: '外部 CA 连接', rootTitle: '根 CA', rootDescription: '创建新的独立根信任锚点，并可同时创建首个中间 CA。', intermediateTitle: '中间 CA', intermediateDescription: '挂载到已有根 CA 下承担日常签发，不创建新的根信任边界。', noWarnings: '未发现额外的拓扑风险警告。' },
    riskTypes: { certificate_fingerprint_reuse: '同一证书跨资产复用', public_key_reuse: '同一公钥跨资产复用' },
    common: { unknown: '未知' }, aria: { tabs: '内部 CA 功能导航' }
  },
  errors: {
    forbiddenTitle: '403 无权限',
    forbiddenMessage: '你没有访问该页面所需的权限。',
    missingPermission: '缺失权限：{permission}',
    notFoundTitle: '404 页面不存在',
    notFoundMessage: '该页面不存在，请确认访问地址是否正确。',
    backDashboard: '返回仪表盘'
  }
} as const
