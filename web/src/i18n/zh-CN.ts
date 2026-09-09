// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { devicesZhCN } from './devices.locale'
import { caOperationsZhCN } from './ca-operations.locale'
import { credentialsZhCN } from './credentials.locale'
import { providersZhCN } from './providers.locale'
import { monitoringTlsZhCN } from './monitoring-tls.locale'
import { acmeAutomationZhCN } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
import { certificateFormatDefaultsZhCN } from './certificate-format.locale'
export default {
  credentials: credentialsZhCN,
  devices: devicesZhCN,
  caOperations: caOperationsZhCN,
  providers: providersZhCN,
  acme: acmeAutomationZhCN,
  app: {
    brand: 'GCAC',
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
    yes: '是',
    no: '否',
    close: '关闭',
    unknownError: '未知错误',
    unknownValue: '未知值：{value}',
    saving: '保存中…',
    userFallback: '未登录用户',
    tenantFallback: '默认租户'
  },
  api: {
    errors: {
      requestFailed: '请求失败',
      timeout: '请求超过 {seconds} 秒，已取消本次操作。'
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
    pagination: {
      total: '总数 {count}',
      pageSize: '每页 {size} 条',
      previous: '上一页',
      next: '下一页',
      goToPage: '跳转到第 {page} 页',
      pager: '分页'
    },
    dryRunChecklist: {
      title: 'Dry-run 预检结论',
      ariaLabel: 'dry-run 预检结论',
      empty: '尚未生成 dry-run 预检结果。',
      unnamedCheck: '未命名检查项',
      evidence: '检查证据',
      status: { passed: '通过', failed: '失败', warning: '警告', unknown: '未知' }
    },
    dryRunResult: {
      title: 'Dry-run 执行结果',
      close: '关闭'
    },
    modal: {
      closeAria: '关闭弹窗'
    },
    toast: {
      close: '关闭'
    },
    drawer: {
      closeAria: '关闭抽屉'
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
      REVOKED: '已吊销',
      ERROR: '异常',
      IGNORED: '已忽略',
      ONLINE: '在线',
      OFFLINE: '离线',
      ACTIVE: '已启用',
      DISABLED: '已停用',
      OPEN: '未解决',
      ACKED: '已确认',
      RESOLVED: '已解决',
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
      actions: {
        showAll: '显示全部 {count} 条',
        showRecent: '只显示最近 {count} 条'
      },
      hint: {
        streaming: '任务状态与日志会持续实时更新。',
        autoRefresh: '任务状态与日志会自动刷新。',
        pollingFallback: '当前使用定时刷新模式。',
        limited: '已显示最近 {visible} 条日志，共 {total} 条。'
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
        skipped: '已跳过',
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
        skipped: '已跳过',
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
        skipped: '该步骤已跳过，不会继续等待。',
        warningChecks: '{total} 项检查，{warning} 项警告'
      },
      time: {
        waitingStart: '等待开始'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: '取消',
        dryRun: '运行 Dry-run 预检',
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
        targetSelectedDetail: '已选择部署目标，可直接提交执行；Dry-run 可在资产详情页手动发起。',
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
        workflowMode: '工作流模式',
        workflowModeWithName: '工作流模式（{name}）'
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
  tasks: {
    title: '全局任务',
    quick: { active: '活动任务', recent: '最近完成' },
    tabs: { all: '全部任务', execution: '执行任务', monitoring: '监控任务', system: '系统任务', other: '其他任务' },
    aria: { openDrawer: '打开全局任务', tabs: '任务分类' },
    filters: {
      includeAll: '显示全部任务',
      keyword: '搜索任务、错误或 ID',
      taskType: '任务类型',
      status: '状态',
      allStatuses: '全部状态',
      resourceType: '资源类型',
      resourceId: '资源 ID',
      requestedBy: '发起用户',
      taskId: '任务 ID',
      createdFrom: '开始时间',
      createdTo: '结束时间'
    },
    fields: { requestedBy: '发起用户', triggerSource: '触发来源', createdAt: '创建时间', startedAt: '开始时间', finishedAt: '结束时间', error: '最后错误' },
    sections: { timeline: '状态时间线', attempts: '尝试记录', acmeHistory: '续签过程', logs: '原始日志', children: '子任务', errors: '错误', audit: '审计事件', monitoringProbes: '探测记录' },
    actions: { backToList: '返回任务列表', viewAll: '查看所有任务', viewRawLogs: '查看原始日志', search: '搜索', reset: '重置', previousPage: '上一页', nextPage: '下一页', forceCancel: '强制结束', forceCancelConfirm: '确定要强制结束此任务吗？正在进行的远端动作可能仍需人工确认。', forceCancelReason: '操作员从全局任务中强制结束' },
    messages: { loadFailed: '任务列表加载失败。', detailFailed: '任务详情加载失败。', forceCancelFailed: '强制结束任务失败。' },
    values: { system: '系统', externalApi: '外部 API', empty: '暂无记录', none: '无' },
    agentUpdate: {
      title: 'Agent 升级进度', timelineTitle: '升级过程',
      fields: { target: '目标主机', currentVersion: '当前版本', targetVersion: '目标版本', phase: '当前阶段', planId: '升级计划', transactionId: '升级事务' },
      values: { unknown: '未知' },
      phases: { queued: '已排队', dispatching: '发送授权中', accepted: 'Agent 已接受', upgrading: '正在升级', status_checking: '正在读取结果', succeeded: '已完成', failed: '未完成', rolled_back: '已回滚', manual_required: '需要人工处理', unknown: '未知' },
      summary: { queued: '升级任务已排队。', dispatching: '正在发送升级授权。', accepted: 'Agent 已接受升级，等待本地执行。', upgrading: 'Agent 正在下载、替换并检查版本。', waiting: '正在等待 Agent 返回结果。', succeeded: 'Agent 已从 {currentVersion} 升级到 {targetVersion}。', failed: 'Agent 升级未完成。' },
      events: { created: '任务已创建', claimed: '任务已分配', started: '开始查询升级状态', progress: '升级状态已更新', waiting_result: '等待升级结果', succeeded: '升级成功', failed: '升级失败', retry_scheduled: '等待再次查询', cancelled: '任务已取消' },
    },
    pluginRefresh: {
      subtitle: '插件目录维护任务',
      overview: { kicker: '刷新结果', description: '本次操作刷新了 {scope}，并将最新插件引用同步到可用运行节点。' },
      metrics: { catalogVersions: '目录版本', enabledVersions: '已启用版本', agentsProjected: '已同步节点', agentsFailed: '同步失败' },
      sections: { timeline: '处理过程', catalogVersions: '当前插件版本', failures: '同步异常' },
      actions: { showTechnicalDetails: '查看技术详情' },
      fields: { taskId: '任务编号' },
      values: { unavailable: '暂无', noVersions: '本次没有返回插件版本', triggerSource: '插件目录刷新' },
      summary: {
        succeeded: '已完成刷新，共更新 {versions} 个插件版本，并同步 {projected} 个运行节点。',
        failed: '插件目录刷新失败。',
        cancelled: '插件目录刷新已取消。',
        retryWaiting: '插件目录刷新将在稍后自动重试。',
        waitingResult: '正在等待插件目录刷新结果。',
        awaitingConfirmation: '插件目录刷新结果待确认。',
        cancelling: '正在取消插件目录刷新。',
        queued: '插件目录刷新已排队。',
        running: '正在刷新插件目录。'
      },
      events: {
        created: '已创建刷新任务，等待系统处理。',
        claimed: '任务已分配给后台处理器。',
        started: '开始读取插件目录。',
        progress: '正在整理插件版本并同步运行节点。',
        retryScheduled: '本次处理未完成，系统已安排自动重试。',
        waitingResult: '正在等待运行节点返回结果。',
        awaitingConfirmation: '刷新结果已生成，等待确认。',
        cancelRequested: '已收到取消请求。',
        expired: '任务已超时。',
        cancelled: '刷新任务已取消。',
        succeeded: '刷新完成：{versions} 个插件版本，已同步 {projected} 个运行节点。',
        failed: '刷新失败：{reason}'
      },
      versionStatus: { added: '新增', enabled: '已启用', disabled: '未启用', other: '其他状态' }
    },
    approval: {
      title: '审批任务详情',
      description: '查看审批内容、处理状态和后续操作。',
      contentTitle: '审批内容',
      fields: { operation: '操作类型', target: '目标', approvalId: '审批单号', requestedBy: '发起用户', riskLevel: '风险等级', createdAt: '提交时间', decision: '审批结果', summary: '操作摘要' },
      content: { deployment: '证书部署', automation: '自动化执行', defaultSummary: '该任务正在等待审批决定。' },
      values: { approved: '已通过', rejected: '已拒绝', pending: '待审批' },
      timelineTitle: '状态时间线',
      timeline: { created: '已提交审批', createdDescription: '任务已创建，等待审批人处理。', approved: '审批已通过', approvedDescription: '审批人已允许继续执行。', rejected: '审批已拒绝', rejectedDescription: '审批人已拒绝本次操作。', forceEnded: '任务已强制结束', forceEndedDescription: '操作员已强制结束该任务。', pending: '审批处理中', pendingDescription: '系统正在等待审批结果。' }
    },
    relatedNames: { pluginCatalog: '插件目录', deploymentPlan: '部署计划', acmeRenewal: '{certificate}（{provider}）证书续签' },
    dedicated: {
      description: { supply: '系统正在协调专属证书签发、部署和结果确认。', issue: '系统正在为该应用签发专属证书。', deploy: '系统正在将专属证书部署到该应用。' },
      fields: { target: '目标应用', certificateAsset: '证书资产', certificateRequest: '证书申请名称', policyVersion: '策略版本' },
      timelineTitle: '处理进度', childrenTitle: '后续步骤', emptyTimeline: '暂无进度记录', technicalDetails: '查看技术明细', failureTitle: '处理未完成',
      events: { created: '任务已创建', claimed: '任务已接收', started: '开始处理', progress: '进度更新', retry_scheduled: '已安排重试', waiting_result: '等待签发结果', awaiting_confirmation: '等待结果确认', cancel_requested: '已请求取消', succeeded: '处理成功', failed: '处理失败', cancelled: '任务已取消' }
    },
    acmeHistory: {
      queued: { title: '等待续签', description: '系统正在等待处理此证书续签。' },
      running: { title: '正在续签', description: '系统正在向证书机构请求续签。' },
      retryWaiting: { title: '等待自动重试', description: '本次签发未完成，系统将在稍后自动重试。' },
      succeeded: { title: '续签成功', description: '新证书已签发并保存。' },
      failed: { title: '续签失败', description: '系统无法完成续签，请查看原始日志了解详情。' },
      cancelled: { title: '续签已取消', description: '此证书续签已被取消。' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: '证书Dry-run',
      CERTIFICATE_DEPLOY: '证书部署',
      APPLICATION_CERTIFICATE_SUPPLY: '专属证书处理',
      APPLICATION_CERTIFICATE_DEPLOY: '专属证书部署',
      applicationCertificate: '专属证书',
      applicationCertificateIssue: '专属证书签发',
      CERTIFICATE_ISSUE: '证书签发',
      ACME_CERTIFICATE_ISSUE: 'ACME证书签发',
      DEPLOYMENT_APPROVAL: '部署审批',
      CERTIFICATE_VERIFY: '证书验证',
      CERTIFICATE_ROLLBACK: '证书回滚',
      AGENT_INSTALL: 'Agent安装',
      AGENT_UPDATE: 'Agent更新',
      PLUGIN_REFERENCE_REFRESH: '插件引用刷新',
      DEPLOYMENT_PLAN_REFRESH: '部署计划刷新',
      MONITORING_BATCH: '监控批次',
      MONITORING_PROBE: '监控探测',
      CREDENTIAL_HEALTH_CHECK: '凭据有效性检测',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CERTIFICATE_REVOCATION: '证书吊销',
      CRL_PUBLISH: 'CRL发布',
      TRUST_DISTRIBUTION: '信任分发',
      GATEWAY_DELEGATION: '网关委派',
      WORKFLOW_RUN: '工作流执行',
      AUTOMATION_RUN: '自动化执行',
      REPORT_EXPORT: '报表导出',
      NOTIFICATION_DELIVERY: '通知投递',
      OTHER: '其他任务'
    },
    summaryTemplates: {
      WAITING_RESULT_COUNTDOWN: '等待部署时间，倒计时 {countdown}',
      QUEUED: '{task}已入队',
      RUNNING: '{task}执行中',
      RETRY_WAITING: '{task}等待重试',
      WAITING_RESULT: '{task}等待执行结果',
      AWAITING_CONFIRMATION: '{task}结果待确认',
      CANCELLING: '{task}取消中',
      SUCCEEDED: '已完成{task}',
      FAILED: '{task}执行失败',
      CANCELLED: '{task}已取消'
    },
    status: { QUEUED: '排队中', RUNNING: '执行中', RETRY_WAITING: '等待重试', WAITING_RESULT: '等待结果', AWAITING_CONFIRMATION: '结果待确认', WAITING_APPROVAL: '等待审批', CANCELLING: '取消中', SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消' }
  },
  shell: {
    currentLocation: '当前位置',
    breadcrumb: '面包屑',
    currentGroupNavigation: '当前分组导航',
    backDashboard: '返回仪表盘',
    sidebarCollapse: '收起侧边栏',
    sidebarExpand: '展开侧边栏',
    authorizationWarning: '未检测到有效产品授权，请前往产品授权页面完成配置。',
    authorizationWarningAction: '前往授权页面',
    authorizationWarningClose: '关闭无授权警告'
  },
  globalSearch: {
    title: '全局搜索',
    description: '搜索证书、设备资产、系统设置和插件。',
    inputLabel: '搜索全局资源',
    inputPlaceholder: '输入名称、域名、指纹或路径',
    hint: '输入关键词开始搜索。',
    aria: {
      open: '打开全局搜索'
    },
    categories: {
      certificates: '证书',
      assets: '设备资产',
      settings: '系统设置',
      plugins: '插件'
    },
    types: {
      serverCertificate: '服务器证书',
      intermediateCertificate: '中间证书',
      rootCertificate: '根证书',
      application: '应用',
      device: '设备',
      cloudService: '云服务',
      systemSetting: '系统设置',
      plugin: '插件'
    },
    empty: {
      title: '没有找到匹配结果',
      description: '请尝试其他名称、域名、指纹或路径。'
    },
    messages: {
      loadFailed: '全局搜索加载失败。'
    }
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
  systemInitialization: {
    intro: { ariaLabel: '开场动画', progressAriaLabel: '载入进度', start: '开始使用', slogan: '为了永不中断的安全服务' },
    preview: { title: '首次设置预览' },
    title: '首次设置', description: '创建管理员账号并设置界面偏好。', help: '按提示逐步完成设置。', stepsLabel: '设置步骤',
    steps: { account: '管理员账号', accountHelp: '设置用来登录系统的账号和密码。', license: '产品授权', licenseHelp: '导入授权文件，也可以稍后再填。', confirm: '确认信息', confirmHelp: '核对刚才填写的信息。', complete: '完成', completeHelp: '设置完成，可以登录使用了。' },
    stage: { account: { title: '管理员账号', help: '这个账号用来登录和管理系统。' }, license: { title: '产品授权（可选）', help: '现在跳过不影响使用，之后可在“产品授权”页面补充。' }, confirm: { title: '确认信息', help: '这里不会显示密码。' }, complete: { title: '设置完成', help: '现在可以登录使用了。' } },
    account: { username: '用户名', usernamePlaceholder: '例如 admin', displayName: '显示名称', displayNamePlaceholder: '例如 系统管理员', password: '密码', passwordPlaceholder: '至少 8 位', passwordConfirmation: '确认密码', passwordConfirmationPlaceholder: '再次输入密码', locale: '界面语言', theme: '主题' },
    license: { description: '先导出请求文件发给供应商，拿到授权文件后再导入。', createRequest: '导出请求文件', copyRequest: '复制请求内容', requestCopied: '已复制', importFile: '导入授权文件', activationResponse: '授权内容', activationResponsePlaceholder: '导入授权文件，或粘贴授权内容', importResponse: '导入授权', configured: '授权已生效。', skip: '稍后设置' },
    confirm: { username: '用户名', locale: '界面语言', theme: '主题', kekTitle: '请妥善保管 GCAC_SECRET_KEK', kekWarning: '这是系统解密数据用的根密钥。请离线保存，不要写进代码、日志或聊天工具。一旦丢失，数据将无法恢复；一旦泄露，数据可能被他人读取。' },
    complete: { licenseConfigured: '授权已生效，现在可以登录使用。', licenseSkipped: '还没有填写授权，之后可在“产品授权”页面补充。' },
    actions: { previous: '上一步', continue: '继续', createAdmin: '创建账号并继续', finish: '完成设置', login: '去登录' },
    errors: { passwordMismatch: '两次输入的密码不一样。', missingSession: '账号已创建，但没有自动登录，请手动登录。', createFailed: '账号创建失败，请重试。', licenseFailed: '授权处理失败，请检查文件是否正确。', activationRequestMissing: '没有拿到请求内容，请重新导出。', jsonObjectRequired: '文件内容格式不对，请确认是完整的授权文件。' }
  },
  userMenu: {
    currentUser: '当前用户',
    changePassword: '修改密码',
    userGuide: '使用手册',
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
  viewMode: {
    switchLabel: '全局页面视图切换',
    user: '用户视图',
    professional: '专业视图',
    steps: {
      certificates: '证书',
      applications: '应用',
      deployments: '部署'
    }
  },
  nav: {
    dashboard: '仪表盘',
    dashboardDesc: '应用、证书、Agent、网关和审计状态总览',
    certificates: '证书管理',
    certificatesDesc: '证书库、绑定关系和到期状态',
    certificateAssets: '证书资产',
    certificateInventoryShort: '证书库',
    certificateAssetsDesc: '证书、私钥引用、指纹和到期时间',
    acmeAutomation: 'ACME 管理',
    acmeAutomationShort: 'ACME 自动化',
    acmeAutomationDesc: '申请、续签和跟踪 ACME 证书',
    caOperationsShort: 'CA 运维',
    certificateFormats: '证书格式配置',
    certificateFormatsShort: '交付格式',
    certificateFormatsDesc: '为已保存证书定义 PFX、CER、CRT、PEM 等格式规则',
    assetCenter: '资产中心',
    assetsShort: '资产',
    assetCenterDesc: '统一管理应用资产、设备资产和云服务资产',
    assetManagement: '应用管理',
    assets: '应用',
    assetsDesc: '域名/IP 维度的应用入口与证书部署目标',
    applications: '应用',
    applicationsDesc: '管理需要证书保护和部署的业务应用端点',
    devices: '设备',
    agents: 'Agent',
    agentsDesc: '在线状态、心跳和能力集合',
    gateways: '网关',
    gatewaysDesc: '隔离区网关、协议和可达目标',
    deployments: '证书部署',
    deploymentsDesc: '部署计划、工作流、自动化和执行记录',
    deploymentPlans: '部署计划',
    deploymentPlansDesc: '证书部署计划和执行入口',
    executions: '执行记录',
    executionsDesc: '执行步骤、日志、失败和回滚',
    workflows: '工作流',
    workflowsDesc: '工作流和插件',
    workflowTemplates: '工作流',
    workflowTemplatesDesc: '画布草稿、变量、能力声明和发布',
    automations: '自动化',
    automationsDesc: '定时、按需和批量执行证书更新计划',
    plugins: '插件中心',
    pluginsDesc: 'Provider、执行器和沙箱状态',
    monitoring: '监控审计',
    monitoringDesc: '告警、审计和证书状态',
    monitoringAnalysis: '监控分析',
    monitoringAnalysisDesc: '分析监控目标、探测结果和证书风险',
    monitorAlerts: '监控告警',
    monitorAlertsDesc: '到期、漂移和执行失败事件',
    monitorTls: 'TLS 深度监控',
    monitorTlsDesc: '证书认证路径、协议套件、兼容性模拟与协议细节',
    audits: '审计日志',
    auditsDesc: '操作证据与合规导出',
    logAudit: '日志审计',
    logAuditDesc: '查看审计事件并导出操作证据',
    reports: '报表',
    reportsDesc: '证书事故窗口、风险处置和自动化成效',
    incidentWindowReport: '事故窗口',
    incidentWindowReportDesc: '即将到期和已过期证书的处置优先级',
    riskResponseReport: '风险处置',
    riskResponseReportDesc: '风险确认、解决时长和 SLA',
    automationEffectivenessReport: '自动化成效',
    automationEffectivenessReportDesc: '运行级、目标级成功率和失败阶段',
    settings: '系统设置',
    settingsDesc: '租户、用户、权限和系统配置',
    settingsOverview: '系统设置',
    systemSettings: '系统设置',
    systemSettingsDesc: '系统配置和安全元数据',
    credentials: '凭据管理',
    notifications: '通知管理',
    licensing: '产品授权',
    users: '用户管理',
    usersDesc: '控制台用户、状态和角色',
    roles: '权限管理',
    rolesDesc: '角色、授权对象范围和成员分配',
    identitySources: '身份源',
    identitySourcesDesc: 'AD/LDAP 服务配置',
    groupRoleMappings: '组角色映射'
  },
  automations: {
    deploymentSchedule: { immediate: '立刻更新', scheduled: '指定时间更新', help: '在证书更新版本后的下一个指定时间运行' },
    title: '自动化',
    description: '集中管理证书更新计划的定时、按需和批量执行。',
    empty: '暂无自动化配置。',
    emptyDescription: '未填写说明',
    common: { notAvailable: '暂无', allRelated: '全部关联目标' },
    formStep: { stepProgress: '第 {current} 步，共 {total} 步', previous: '上一步', next: '下一步', reviewTitle: '配置摘要', reviewText: '触发器：{trigger}；执行范围：{scope}；证书域名：{domains}。运行开始后会冻结目标快照。' },
    scheduleBuilder: { api: '通过外部 API 触发', once: '在固定时间执行一次', onceHelp: '选择浏览器本地时间。任务执行一次后不会再次排期。', recurring: '定期执行', scheduleHelp: '按计划周期执行。仅建议用于确实需要持续轮询的场景。', recurringHelp: '按计划周期执行。仅建议用于确实需要持续轮询的场景。', recurringWarningTitle: '证书更新不建议使用定期执行', recurringWarning: '证书换证通常应由外部系统在证书签发后触发，或安排一次固定时间执行。只有明确需要周期检查时才使用此选项。', certificateVersionCreated: '证书新版本事件', runAt: '执行时间', frequency: '执行周期', daily: '每天', weekly: '每周', monthly: '每月', time: '执行时刻', weekday: '星期', monthDay: '每月日期', legacyCustom: '保留原有自定义计划', legacyCron: '原有 Cron（只读）', weekdays: { 0: '星期日', 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六' } },
    externalApi: { executionModeLabel: '外部调用方式', executionModeAria: '外部执行方式', keyTitle: '外部 API Key', keyDescription: '该 Key 会持续显示在当前自动化页面，可随时复制。', keyNotice: '后续请求使用请求头 X-Automation-API-Key。', keyStatusPending: '保存并启用后生成', keyStatusActive: '已生成', keyStatusUnavailable: '已生成（当前页面未显示完整 Key）', keyEditorDescription: '当前页面会持续显示完整 Key，可随时复制；刷新后旧 Key 会立即失效。', keyValueLabel: 'API Key', keyValueAria: '外部 API Key', keyUnavailableValue: '当前页面未显示完整 Key', keyUnavailable: '当前页面未持有完整 Key，请点击“刷新 Key”生成新的 Key。', rotate: '刷新 Key', rotating: '刷新中', rotateNotice: '刷新后旧 Key 会立即失效。', mode: '执行方式：{mode}', copy: '复制 Key', copied: '已复制', copyAria: '复制 API Key', copyCurlAria: '复制 CURL 命令', rotateAria: '刷新 API Key', apiManualButton: 'API 接口手册', apiManualAutomationId: '当前自动化 ID', apiManualAutomationIdUnavailable: '保存后生成', apiManualTitle: '外部 API 接口手册', apiManualDescription: '使用自动化 ID 和 API Key 调用接口；证书域名已在自动化中预设。', apiManualCertificateVersion: '启动和兼容性查询都必须传入精确的 certificateVersionId。', apiManualRunTitle: '启动自动化', apiManualRunDescription: '提交指定证书版本，启动一次自动化；执行会进入当前运行队列。', apiManualRunCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/run' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -H Idempotency-Key:automation-run-$(date +%s) \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualPreviewTitle: '查看当前应用兼容性', apiManualPreviewDescription: '提交证书版本，返回目标应用匹配、可执行性及排除原因。', apiManualPreviewCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/preview' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualVersionsTitle: '查看可用证书版本列表', apiManualVersionsDescription: '返回该自动化预设证书域名下可用于选择的证书版本。', apiManualVersionsCurl: "curl 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/certificate-versions' \\\n  -H 'X-Automation-API-Key: ak_xxx'" },
    form: { existingAssetTitle: '只更新现有应用资产', existingAssetDescription: '自动化只处理已经建立证书绑定的应用资产，不负责首次安装证书或新增部署目标。', certificateDomains: '证书域名', certificateDomainsPlaceholder: '输入证书域名，多个用逗号分隔', certificateDomainsHelp: '只更新这些域名对应证书的现有应用资产绑定。', versionSelection: '更新到哪个证书版本', versionSelectionLatest: '自动使用最新证书版本', versionSelectionSpecific: '使用指定证书版本', versionSelectionHelp: '运行开始时解析并冻结版本，运行期间不会因新增版本而改变。', certificateVersionIds: '指定证书版本', certificateVersionIdsPlaceholder: '输入证书版本 ID，多个用逗号分隔', certificateVersionIdsHelp: '每个版本必须属于上面所选域名对应的证书。', versionLoading: '正在加载可选证书版本。', versionLoadFailed: '证书版本加载失败，请稍后重试。', versionEmpty: '没有找到这些域名对应的可选证书版本。', schedule: '什么时候更新', scheduleHelp: '可由管理员按需启动，也可以按 Cron 和时区定期检查并更新。', execution: '运行时会做什么', executionHelp: '系统为每个现有资产绑定创建独立更新计划，并复用 DeploymentPlan 和 ExecutionRun。', snapshot: '冻结域名、资产和证书版本快照' },
    fields: { name: '名称', description: '说明', trigger: '触发方式', eventSources: '事件来源', targetScope: '更新范围', selectedAssets: '指定应用资产', selectedAssetsHelp: '请选择至少一个已纳管的应用资产。', certificateTags: '证书标签（逗号分隔）', certificateTagsHelp: '按证书标签过滤事件或轮询范围。', targetEnvironments: '目标环境（逗号分隔）', targetEnvironmentsHelp: '按目标资产环境过滤。', targetOwners: '目标负责人（逗号分隔）', targetOwnersHelp: '按目标资产负责人过滤。', cron: 'Cron 表达式', timeZone: '时区', expiresWithinDays: '到期天数范围', environments: '目标环境（逗号分隔）', certificateIds: '指定证书（可选）', certificateIdsPlaceholder: '输入证书 ID，多个用逗号分隔', certificateIdsHelp: '填写后只处理指定证书；留空则按到期范围和环境自动匹配。', expiresWithinDaysHelp: '只匹配在此天数内到期的证书。', environmentsHelp: '只处理这些环境中的证书，例如 production, staging。', planType: '部署计划类型', planTypeHelp: '每个命中的证书目标都会在运行时创建一份独立的 DeploymentPlan。', planTypeUpdate: '更新现有证书绑定', planTypeInstall: '安装证书到目标', planTypeVerifyOnly: '只验证，不变更证书', planMode: '运行方式', planModeHelp: '自动化不绑定已有计划；运行时会为每个目标创建新计划。', planModeCreateAndExecute: '创建计划并执行', planModeCreateOnly: '只创建计划，暂不执行', maxTargets: '单次最大目标数', concurrency: '并发数', failureCount: '失败数量阈值', requireDryRun: '历史 Dry Run 设置（当前不作为执行门槛）', startedAt: '开始时间', finishedAt: '结束时间', failureStage: '失败阶段', parentRun: '父运行' },
    actions: { create: '新建自动化', detail: '详情', edit: '编辑', delete: '删除', cancel: '取消', save: '保存', copy: '复制', enable: '启用', disable: '停用', runNow: '立即执行', preview: '预览目标', history: '运行历史', confirmRun: '确认执行', stop: '停止运行', retryFailed: '重试失败目标', openPlan: '查看部署计划', openExecution: '查看执行记录' },
    manualRun: { title: '手动执行', description: '请选择一个证书版本后再执行。', versionLabel: '证书版本', versionPlaceholder: '请选择证书版本', help: '执行时会按该版本所属证书资产解析关联的应用资产。', empty: '没有可用于手动执行的证书版本。', stopOnError: '错误中断工作流', dryRun: '运行可选 Dry-run 预检', start: '开始执行', downgradeNotice: '以下 {count} 个应用资产的目标证书有效期短于当前证书。确认后仍将继续执行。', downgradeConfirmTitle: '确认降低证书有效期', downgradeConfirmDescription: '这是手动操作，确认后将把 {count} 个应用资产更新为更短有效期的证书。', downgradeConfirmAction: '确认并执行' },
    columns: { status: '状态', trigger: '触发方式', targets: '目标上限', actions: '执行动作', nextRun: '下次运行', lastRun: '最近运行' },
    triggers: { onDemand: '按需执行', onDemandDescription: '仅通过平台内的立即执行操作启动，不生成外部 API Key。', schedule: '定时执行' },
    triggerTypes: { on_demand: '按需执行', schedule: '定时执行', certificate_version_created: '证书新版本事件', retry: '失败重试' },
    eventSources: { acme_issue: 'ACME 自动续期', manual_import: '手工导入' },
    targetScopes: { allRelatedAssets: '更新关联的全部应用资产', allRelatedAssetsHelp: '命中事件或条件后，系统自动解析所有已绑定且可部署的应用资产。', selectedAssets: '只更新指定应用资产', selectedAssetsHelp: '只在手动选中的应用资产范围内创建和执行 DeploymentPlan。' },
    assetPicker: { available: '可选资产', selected: '已选资产', add: '添加', remove: '移除', clear: '清空选择', emptyAvailable: '当前没有可添加的应用资产。', emptySelected: '尚未选择应用资产。' },
    actionTypes: { create_deployment_plan: '创建证书更新计划', execute_deployment_plan: '执行证书更新计划', send_notification: '发送通知' },
    values: { enabled: '已启用', disabled: '未启用', latest: '自动使用最新版本', specific: '使用指定证书版本', fixedByEvent: '由证书新版本事件固定' },
    summaries: { targets: '最多 {count} 个目标' },
    preview: { title: '资产影响预览', description: '每行代表一个应用资产；中间显示当前证书有效期 → 本次选定证书有效期，右侧显示是否可以执行更新。', explanation: '影响分析按每个应用资产展示当前证书有效期、目标证书有效期和执行结果。', applicationAsset: '应用资产', certificate: '证书', applicationAssetId: '应用资产 ID', bindingId: '绑定 ID', missingCurrentExplanation: '“暂无 → 日期”表示系统没有读取到该应用当前绑定证书的有效期，因此本次不会执行更新；请先补齐证书绑定或当前证书信息。', matched: '匹配 {count} 项', executable: '可执行 {count} 项', excluded: '排除 {count} 项', affected: '受影响 {count} 项', upgrade: '有效期延长 {count} 项', same: '到期一致 {count} 项', skip: '跳过更新 {count} 项', downgrade: '需关注 {count} 项', version: '版本 {version}', versionUnknown: '版本未知', ready: '可执行', skipUpdate: '跳过更新', expiryLabel: '有效期', impact: { upgrade: '有效期延长', same: '到期时间一致', downgrade: '有效期缩短风险', missing_current: '缺少当前证书', unknown: '影响未知' } },
    detail: { title: '自动化详情', description: '查看当前自动化配置、触发条件与执行护栏。', assetCount: '涉及 {count} 个应用资产', assetsResolvedAtRuntime: '目标资产在运行时按证书域名和绑定关系解析。', sections: { summary: '概览', execution: '执行链', guardrails: '执行安全控制' }, fields: { automationId: '自动化 ID', currentVersion: '当前配置版本', recordVersion: '记录版本号', eventSources: '事件来源', certificateDomains: '证书域名', versionSelection: '证书版本策略', actionChain: '执行动作链', involvedAssets: '涉及资产', nextRun: '下次运行', lastRun: '最近运行' } },
    history: { title: '运行历史', description: '查看当前自动化的最近运行记录。', summary: '共 {count} 条运行记录', latestTarget: '自动化：{name}', empty: '当前还没有运行记录。' },
    exclusions: { permission_denied: '无目标权限', missing_version: '缺少证书版本', version_not_deployable: '证书版本不可部署', binding_not_managed: '绑定未纳管', environment_not_allowed: '环境不在允许范围', binding_missing: '缺少绑定', asset_missing_deployment_capability: '目标资产不支持部署', certificate_version_downgrade: '目标证书版本低于资产当前版本', certificate_already_up_to_date: '当前资产已是目标有效期，跳过更新', filter_not_matched: '不满足过滤条件', runtime_context_required: '缺少运行时上下文', unknown: '未知排除原因' },
    failureStages: { selection: '目标选择', plan_creation: '计划创建', dry_run: 'Dry Run', approval: '审批', execution: '执行', verification: '验证', rollback: '回滚', notification: '通知' },
    progress: { total: '总数', pending: '等待中', running: '执行中', waitingApproval: '等待审批', succeeded: '成功', failed: '失败', skipped: '已跳过', cancelled: '已取消' },
    editor: { createTitle: '新建自动化', editTitle: '编辑自动化', description: '配置何时运行、处理哪些证书、如何创建部署计划以及失败时的安全边界。', exactVersionFromEvent: '证书新版本事件会把本次产生的精确证书版本固定到运行快照里，运行恢复后也不会漂移到后续版本。', sections: { basic: '基本信息', basicHelp: '给自动化一个容易识别的名称，说明它负责哪类证书变更。', trigger: '触发器', triggerHelp: '先定义自动化由什么事实触发，再决定后续的执行和条件。', targets: '处理哪些证书', targetsHelp: '这里选择的是证书目标，不是已有部署计划；运行开始时会冻结目标快照。', execution: '执行器', executionHelp: '先确定这条自动化会如何更新资产，再决定额外条件和安全控制。', conditions: '条件与安全', conditionsHelp: '这里同时定义命中条件、范围过滤和并发等执行护栏。', plan: '证书部署计划', planRelationTitle: '不会绑定已有部署计划', planRelationDescription: '自动化会根据上面的证书筛选条件，在每次运行时创建部署计划。', planRelationHelp: '每个命中的证书目标对应一份独立 DeploymentPlan，计划 ID 会在运行详情中显示；这样不同证书不会共用错误的目标快照。', guardrails: '执行安全控制', guardrailsHelp: '这些限制决定一次最多处理多少目标、是否先预检，以及失败后何时停止。' }, chain: { createPlan: '按目标创建 DeploymentPlan', dryRun: '可选 Dry Run 预检', executePlan: '执行该目标的 DeploymentPlan' } },
    runs: { title: '自动化运行历史', description: '查看运行级状态、不可变目标快照和失败阶段。', progress: '{succeeded}/{total} 成功' },
    runDetail: { title: '自动化运行详情', description: '配置版本 {version}', noFailure: '未发生失败', triggerContext: '触发上下文', sourceType: '来源类型', certificateVersion: '精确证书版本', deliveryId: '投递 ID', excludedReasons: '排除原因' },
    aria: { preview: '自动化目标预览', runs: '自动化运行列表', progress: '自动化运行进度' },
    errors: { loadFailed: '自动化列表加载失败', applicationAssetsLoadFailed: '应用资产列表加载失败，请稍后重试。' }
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
    toggleFilters: '筛选',
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
      labels: {
        discover: '发现部署目标',
        backup: '备份当前证书',
        install: '安装新证书',
        reload: '重载服务',
        verify: '验证证书',
        rollback: '回滚证书'
      },
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
      workflowIdentity: '执行版本：插件 {plugin}；工作流 {workflow}',
      failure: {
        emptyMessage: '未收到具体错误信息',
        issue: '类型 {category}，槽位 {slot}，路径 {path}，来源 {source}，修复位置 {remediation}'
      },
      skipped: '步骤已跳过：{reason}',
      running: {
        dispatched: 'Agent 任务已下发（{taskId}），控制面正在主动查询结果。',
        waitingAgentResult: '步骤执行中，控制面正在主动查询 Agent 结果…',
        waitingExternalResult: '步骤执行中，等待外部执行结果…',
        resultUnconfirmed: '写入结果待确认：{code}：{message}。系统不会自动重放此步骤。'
      },
      unknownResult: '写入结果未知，已暂停自动重放。',
      diagnosticsTitle: '详细核验日志',
      structuredDetail: '查看结构化详情',
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
      tlsGrantRequired: {
        label: 'Dry-run 已完成，但需要宿主授权',
        detail: '结构和安全校验已完成；dry-run 不签发正式 ExecutionGrant，因此 TLS 跳过校验步骤被拒绝。正式执行时由宿主签发短期 ExecutionGrant。'
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
    },
    recovery: {
      confirm: '核验证书状态并继续',
      running: '正在核验证书状态…',
      confirmed: '已确认目标证书生效，执行将继续。',
      failed: '证书状态核验未通过，执行已停止。',
      pending: '暂时无法确认目标证书状态，请稍后重试。'
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
    messages: {
      recoveryConfirmed: '已确认目标证书状态，执行将继续；请在全局任务列表查看进度。',
      recoveryFailed: '证书状态核验未通过，详细原因已记录在执行日志中。',
      recoveryPending: '暂时无法确认目标证书状态，任务保持待确认；请稍后重试。'
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
      noLogs: '暂无日志。',
      unknownResultDescription: '系统不会重放原始安装操作，只会进行只读 TLS 证书指纹核验。'
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
      tlsEnabled: '启用 HTTPS', tlsVerifyPeer: '验证服务端证书', tlsIgnoreCertificateErrors: '忽略证书错误', tlsServerName: 'TLS Server Name', caSecret: 'CA SecretRef', tlsMinimumVersion: '最低 TLS 版本',
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
    categories: { label: '产品分类', all: '全部', WEB_SITE: 'Web 站点', APPLICATION_MIDDLEWARE: '应用中间件', NETWORK_GATEWAY: '网络与设备', CLOUD_PLATFORM: '云平台', CA_ISSUANCE: 'CA 与签发' },
    statuses: {
      valid: '可用',
      invalid: '无效',
      available: '可创建',
      enabled: '已启用',
      disabled: '已禁用',
      pendingApproval: '待审批',
      inUse: '正在使用',
      notInUse: '尚未使用'
    },
    filters: {
      searchLabel: '搜索插件',
      searchPlaceholder: '按照名称、标签进行搜索',
      allSources: '全部来源',
      sourceAll: '全部',
      sourceBuiltin: '内置',
      sourceUser: '用户',
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
      enabled: { title: '已启用插件' },
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
    types: { provider: '云 Provider 插件', standard: '标准插件' },
    fields: {
      pluginId: '插件 ID',
      pluginType: '插件类型',
      provider: '云服务提供商',
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
      executionMode: '执行模型',
      scope: '适用范围',
      support: '支持等级',
      capabilities: '能力',
      frameworks: '面向框架',
      products: '支持产品',
      operations: '支持操作'
    },
    labels: { permissions: '声明权限', runnerStatus: 'Runner 状态' },
    permissionKeys: {
      network_http: '网络请求', secret_read: '读取密钥', artifact_read: '读取制品', device_write: '写入设备',
      agent_execution_receipt: 'Agent 执行回执', agent_fact_collect: 'Agent 信息采集', agent_plan_execute: 'Agent 计划执行', agent_plan_validate: 'Agent 计划校验',
      audit_append: '追加审计记录', cloud_service_get: '读取云服务', execution_cancel_read: '读取执行取消状态', execution_checkpoint: '执行检查点',
      execution_checkpoint_read: '读取执行检查点', execution_checkpoint_write: '写入执行检查点', execution_progress: '执行进度', execution_progress_write: '写入执行进度',
      resource_lock: '资源锁', secret_resolve: '解析密钥'
    },
    runnerStatuses: { ready: 'Runner 就绪', busy: 'Runner 执行中', unavailable: 'Runner 不可用', notObserved: 'Runner 未观测' },
    capabilityKeys: {
      device_connection_test: '连接测试', device_identity_detect: '设备身份识别', device_discover: '设备发现', device_logs_read: '设备日志读取',
      certificate_discover: '证书发现', certificate_deploy: '证书部署', certificate_rollback: '证书回滚', certificate_verify: '证书验证',
      application_discover: '应用发现', ca_account_manage: 'CA 账户管理', ca_order_manage: 'CA 订单管理', ca_challenge_orchestrate: 'CA 挑战编排',
      ca_challenge_dns_solver: 'CA DNS 挑战解析', ca_certificate_issue: 'CA 证书签发', ca_certificate_renew: 'CA 证书续期', ca_certificate_revoke: 'CA 证书吊销',
      cloud_service_connection_test: '云服务连接测试', cloud_service_discover: '云服务发现', credential_health_check: '凭据检测'
    },
    unknownCatalogValue: '未知目录值：{value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: '自定义运行环境', runtime_custom: '自定义运行时', adc_load_balancer: 'ADC 负载均衡', cloud_aliyun_cdn: '阿里云 CDN', cloud_aliyun_alb: '阿里云 ALB', cloud_aliyun_clb: '阿里云 CLB', cloud_aliyun_oss: '阿里云 OSS', cloud_aliyun_waf_cname: '阿里云 WAF CNAME', cloud_aliyun_waf_cloud: '阿里云 WAF 云产品', cloud_aliyun_live: '阿里云 Live', cloud_aliyun_vod: '阿里云 VOD', cloud_tencent_cdn: '腾讯云 CDN', cloud_tencent_clb: '腾讯云 CLB', cloud_tencent_live: '腾讯云直播', cloud_huawei_cdn: '华为云 CDN', cloud_huawei_elb: '华为云 ELB', cloud_volcengine_cdn: '火山引擎 CDN', cloud_volcengine_alb: '火山引擎 ALB', cloud_volcengine_clb: '火山引擎 CLB', cloud_volcengine_live: '火山引擎直播', cloud_volcengine_vod: '火山引擎 VOD' },
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
      approveAndEnable: '审批权限并启用', activating: '启用中...', activateFailed: 'Agent 插件审批或启用失败', disableFailed: '停用 Agent 插件失败',
      types: { WORKFLOW_TEMPLATE: '工作流模板', UNIFIED_PLUGIN: '统一能力插件' }
    },
    changeSummaries: {
      createWorkflow: '从插件市场模板创建工作流'
    }
  },
  deploymentPlans: {
    userView: {
      stepLabel: '第 3 步 / 3 · 部署',
      title: '把证书部署到应用',
      description: '选择证书和已接入的应用。系统会在后台执行预览和执行保护，只是不把技术细节放在前台。',
      createAction: '开始部署',
      listTitle: '部署任务',
      listDescription: '这里只显示当前业务状态和下一步动作。',
      loadFailed: '部署任务加载失败',
      emptyTitle: '还没有部署任务',
      emptyDescription: '添加应用后，就可以创建第一个部署任务。',
      unnamedPlan: '未命名部署任务',
      pendingCertificate: '等待选择证书',
      pendingApplication: '等待选择应用',
      nextActionHint: '下一步动作会根据当前预览和执行状态决定。',
      prepareAction: '准备部署',
      waiting: '等待执行'
    },
    title: '部署计划',
    description: '计划预览、影响范围、执行批次、验证和回滚入口。',
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
      submit: '提交计划',
      submitRisk: '提交后计划进入待执行状态。',
      execute: '执行部署',
      executeRisk: '执行会修改目标证书配置。已完成或失败的计划再次执行也使用这个入口；正式执行会同步完成必要预检，也可在资产详情页先运行 Dry-run 影响预览。',
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
        description: '待执行和运行中的计划。'
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
      certificateVersionId: '证书版本 ID',
      certificateFormatId: '证书格式配置 ID',
      workflowDslVersion: '工作流 DSL 版本',
      currentAssetCertificateExpiresAt: '当前证书结束时间',
      updateNeeded: '需要更新',
      targetSummary: '目标绑定摘要',
      latestRun: '最新执行批次',
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
      needDryRun: 'Dry-run 是可选的影响预览，用于查看证书、域名和目标兼容性检查结论。',
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
      inputSourcesLoadFailed: '加载部署输入来源失败',
      inputSourcesTitle: '部署输入来源',
      inputSource: '来源：{source}',
      inputSourceTarget: '部署目标：{targetId}',
      noInputSources: '当前计划没有可展示的变量来源。',
      noTargetSummary: '未提供目标摘要',
      workflowIdentityTitle: '工作流执行身份',
      workflowMode: '用户工作流',
      workflowModePluginInternal: '插件内置工作流',
      workflowDslVersion: '实际 DSL 版本：{version}',
      workflowPluginVersion: '实际插件版本：{version}',
      workflowPluginVersionId: '插件版本 ID：{versionId}',
      workflowVersionId: '版本快照 ID：{versionId}',
      workflowVersionSelectionPinned: '版本策略：计划已固定',
      workflowVersionSelectionLatest: '版本策略：应用资产使用最新已发布版本',
      workflowIdentityUnavailable: '工作流版本信息不可用',
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
      copy: '当前操作：{action}。Dry-run 是可选的影响预览，不会阻止正式执行。',
      description: '可先运行同步 Dry-run 查看静态检查结论，正式执行时系统仍会再次完成必要预检。',
      primaryAction: '运行 Dry-run',
      runningAction: '正在运行 Dry-run…',
      title: '可选 Dry-run 影响预览'
    },
    execution: {
      applyName: '部署执行 {runId}',
      applyTitle: '证书更新执行',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Dry-run 结果',
      fallbackName: '执行 {runId}',
      rollbackTitle: '证书回滚执行',
      startingName: '正在启动执行'
    },
    feedback: {
      cancelled: '部署计划已取消。',
      cancelledWithPlanId: '部署计划已取消（计划 {planId}）。',
      deleted: '部署计划已删除。',
      deletedWithPlanId: '部署计划已删除（计划 {planId}）。',
      dryRunStartedMissingRunId: '预检已发起。',
      dryRunStartedWithRunId: '预检已发起（{runId}），请在右上角任务列表查看进度。',
      dryRunTriggered: '预检已触发。',
      dryRunTriggeredWithPlanId: '预检已触发（计划 {planId}）。',
      dryRunTriggeredWithRunId: '预检已触发（{runId}），请在右上角任务列表查看进度。',
      dryRunTaskStarted: 'Dry-run 已开始，后续进度可在右上角任务列表查看。',
      executeTriggered: '部署已触发。',
      executeTriggeredWithPlanId: '部署已触发（计划 {planId}）。',
      executeTriggeredWithRunId: '部署已触发（{runId}），请在右上角任务列表查看进度。',
      executionTaskStarted: '任务已开始，后续进度可在右上角任务列表查看。',
      executionTaskSucceeded: '任务已成功完成，可在右上角任务列表查看结果。',
      executeTaskStarted: '证书部署已开始，后续进度可在右上角任务列表查看。',
      rollbackTaskStarted: '证书回滚已开始，后续进度可在右上角任务列表查看。',
      loadedDraft: '已加载草稿计划。',
      loadedDraftWithPlanId: '已加载草稿（计划 {planId}）。',
      savedWithPlanId: '计划已保存（{planId}）。',
      submitted: '部署计划已提交。',
      submittedWithPlanId: '部署计划已提交（计划 {planId}）。',
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
      startDryRunFailed: '发起 dry-run 失败',
      inputIssuesHint: '请按上述槽位和绑定层修复应用资产部署输入后重试。'
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
    // 兼容旧版本证书卡片的翻译 key，避免已缓存 bundle 在升级后产生缺失告警。
    statusBlock: {
      tooltip: {
        name: '名称', issuer: '颁发者', startTime: '开始时间', endTime: '结束时间', daysRemaining: '剩余天数', connectionStatus: '连接状态', version: '版本', managementAddress: '管理地址', lastCommunicationTime: '最近通信时间', platform: '应用平台', protocolPort: '协议与端口', certificateDaysRemaining: '剩余证书天数', region: '区域', latency: '延时'
      },
      detail: {
        certificateRemaining: '{name}，{days}'
      }
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
    overview: {
      eyebrow: '运行总览'
    },
    resources: {
      title: '系统资源',
      description: '显示仪表盘后端主机的实时资源使用率。',
      cpu: 'CPU 使用率',
      memory: '内存使用率',
      host: '主机',
      abnormal: '需关注',
      usageAria: '{metric}使用率 {value}%',
      unavailableAria: '{metric}暂无数据'
    },
    quickStart: {
      title: '从这里快速开始',
      description: '帮您快速完成证书准备并部署到您的应用',
      addCertificate: '导入或申请新证书',
      deployExistingApplication: '部署到网站或应用',
      unavailable: '暂无可用入口',
      safeExecution: '安全执行',
      guidedFlow: '向导流程'
    },
    trends: {
      title: '运行趋势',
      noDelta: '--',
      auditSuccess: { title: '审计操作成功率', suffix: '成功率' },
      managedObjects: { title: '对象健康度', suffix: '正常对象' },
      certificateAttention: { title: '证书到期关注', suffix: '项待处理' }
    },
    statusPanel: {
      description: '证书、Agent、网关和应用资产的当前可见状态。',
      objects: '对象'
    },
    recentLog: {
      title: '最近日志',
      live: '实时'
    },
    aria: {
      assetHeatmap: '资产状态热力图',
      certificateStatusList: '证书状态列表',
      metrics: '核心指标',
      quickActions: '主要功能入口',
      statusHeatmap: '资产状态',
      statusLegend: '状态图例'
    },
    assets: {
      groupCount: '{summary} · {total} 个',
      title: '资产状态',
      updatedAt: '更新于 {time}'
    },
    audit: {
      description: '优先展示失败、拒绝、高风险和关键业务变更。',
      title: '最近审计日志',
      activityTitle: '审计活动'
    },
    certificateState: {
      critical: '临近到期',
      expired: '已过期',
      expiring: '即将到期',
      unknown: '未知',
      valid: '正常',
      updateAvailable: '可更新'
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
      noObjects: '暂无对象',
      noTrend: '暂无趋势数据',
      noQuickActions: '暂无可用快速入口'
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
      attention: '需关注',
      sparklineLabel: '{metric}趋势',
      stable: '稳定',
      tracked: '已跟踪',
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
    health: {
      title: '系统健康',
      description: '根据证书、Agent、网关和应用资产状态汇总。',
      healthy: '健康',
      attention: '需关注',
      abnormal: '异常',
      noData: '暂无数据',
      score: '健康对象占比',
      progressAria: '系统健康对象占比',
      normalObjects: '正常对象',
      attentionObjects: '关注对象'
    },
    quickWizard: {
      title: '快速入口'
    },
    typeStats: {
      title: '对象类型统计',
      description: '按当前可见对象数量分布。'
    },
    quickActions: {
      agents: {
        title: '资产',
        description: '查看 Agent 状态和任务能力。'
      },
      assets: {
        title: '应用',
        description: '维护域名、端口和部署目标。'
      },
      audits: {
        title: '日志',
        description: '追踪操作人与执行结果。'
      },
      certificates: {
        title: '证书',
        description: '导入、查看和转换证书。'
      },
      deploymentPlans: {
        title: '自动化',
        description: '创建和执行证书更新计划。'
      },
      gateways: {
        title: '网关',
        description: '管理隔离区执行入口。'
      }
    },
    statusBlock: {
      tooltip: {
        name: '名称', issuer: '颁发者', startTime: '开始时间', endTime: '结束时间', daysRemaining: '剩余天数', connectionStatus: '连接状态', version: '版本', managementAddress: '管理地址', lastCommunicationTime: '最近通信时间', platform: '应用平台', protocolPort: '协议与端口', certificateDaysRemaining: '剩余证书天数', region: '区域', latency: '延时'
      },
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
      assets: {
        title: '资产'
      },
      agents: {
        title: '设备'
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
        },
        relay: {
          description: '完成窄授权鉴权后，只在指定目标和端口之间双向透传 TCP 字节。',
          title: 'TCP 直接中继'
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
      missingInstallCommand: '系统未返回 Gateway Agent 安装命令。',
      relayPolicyRequired: '必须填写至少一个 Relay 目标和端口。'
    },
    fields: {
      config: '配置',
      defaultRegion: 'default',
      enableCommand: '启用命令',
      expiresAt: '过期时间',
      installCode: '安装码',
      installCommand: '安装命令',
      platform: '平台',
      region: '区域',
      relayPorts: 'Relay 端口白名单',
      relayPortsPlaceholder: '例如：443, 8443',
      relayTargets: 'Relay 目标白名单',
      relayTargetsPlaceholder: '每行或逗号分隔，例如：app.internal.example、10.20.0.0/16',
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
      title: '网关',
      testingNotice: '网关功能正在测试'
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
      admin: '管理员',
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
    summaries: {
      deployment: '{actor}{verb}“{action}”，部署计划：{planName}，资产：{targetNames}。',
      permissionDenied: '{actor}因{reason}，访问{resource}的“{action}”操作被拒绝。',
      taskCreated: '{actor}创建“{taskType}”。',
      secretUsed: '{actor}读取{purpose}。',
      authExternalLoginSuccess: '{actor}通过{sourceType}身份源登录成功。',
      authExternalLoginFailed: '{actor}通过{sourceType}身份源登录失败。',
      authLoginSuccess: '{actor}登录成功。',
      authLoginFailed: '{actor}登录失败：{reason}。',
      authPasswordChanged: '{actor}修改了登录密码。',
      authLogout: '{actor}退出登录。',
      securityIdentitySourceSynced: '{actor}同步{resource}{counts}。',
      securityIdentitySourceTested: '{actor}测试{resource}连接成功。',
      securityUserCreated: '{actor}创建用户“{username}”。'
    },
    deploymentActions: { execute: '执行部署', dryRun: '试运行部署计划', rollback: '回滚部署计划' },
    taskTypes: { certificateDryRun: '证书部署试运行任务', certificateDeploy: '证书部署任务', applicationCertificateDeploy: '应用专属证书部署任务', certificateIssue: '证书签发任务', acmeCertificateIssue: 'ACME 证书签发任务', acmeRenewal: 'ACME 证书续期任务', agentInstall: 'Agent 安装任务', agentCapabilityRescan: 'Agent 能力重扫任务', pluginReferenceRefresh: '插件目录刷新任务', automationRun: '自动化执行任务', automationTriggerDelivery: '自动化触发投递任务', monitoring: '证书监控任务', backgroundTask: '后台任务' },
    secretPurposes: { httpHeader: 'HTTP 请求头凭据', deploymentPrivateKey: '证书部署私钥', deploymentPassword: '证书部署密码', exportPrivateKey: '证书导出私钥', exportPassword: '证书导出密码', sshAuthentication: 'SSH 登录凭据', providerOperation: 'Secret 提供方操作凭据', ldapBind: 'LDAP 绑定凭据', httpFormPassword: 'HTTP 表单密码', debugCheck: 'Secret 检查凭据', credential: '凭据' },
    permissionActions: { taskRead: '读取任务', auditRead: '读取审计日志', serviceAssetRead: '读取应用资产', certificateRead: '读取证书', certificateAssetRead: '读取证书资产', bindingRead: '读取证书绑定', pluginVersionRead: '读取插件版本', caOperationsRead: '读取 CA 运维数据', approvalDecide: '执行审批决策', providerRead: '读取提供方目录', executionRead: '读取执行记录', cloudAssetRead: '读取云账号资产', managedTargetRead: '读取托管目标', hostRead: '读取主机', resourceAccess: '访问资源' },
    permissionReasons: { noAllowPolicy: '没有匹配的允许策略', noObjectGrant: '没有匹配的对象授权', explicitDeny: '显式拒绝', explicitBusinessDeny: '业务规则显式拒绝', tenantScopeDenied: '租户范围不允许', resourceScopeDenied: '对象范围不允许', missing: '缺少访问权限' },
    identitySources: { activeDirectory: 'Active Directory', ldap: 'LDAP', oidc: 'OIDC', saml: 'SAML', external: '外部' },
    authFailureReasons: { badCredentials: '用户名或密码错误', invalid: '认证信息无效' },
    identitySyncCounts: '，共 {total} 个账号，新增 {created} 个，更新 {updated} 个，失败 {failed} 个',
    moreTargets: '{names} 等 {count} 个资产',
    listSeparator: '、',
    fallbacks: {
      unknown: '未知',
      unnamedDeploymentPlan: '未命名部署计划',
      noTargetAssets: '未记录目标资产'
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
      refreshing: '刷新中…',
      viewDetail: '查看详情'
    },
    filters: {
      keywordPlaceholder: '搜索操作、对象或摘要',
      apply: '搜索'
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
      },
      success: {
        title: '成功事件',
        description: '已成功完成并记录的操作事件。'
      }
    },
    list: {
      ariaLabel: '审计日志列表',
      title: '日志列表',
      summary: '共 {total} 条，默认按最新时间排序。',
      timeNotRecorded: '未记录时间'
    },
    detail: {
      title: '审计日志详情',
      description: '查看该事件从后端返回的完整脱敏记录。'
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
    description: '统一管理证书事件、模板、渠道发送和可靠投递记录。',
    tabs: { events: '事件定义', templates: '通知模板', channels: '渠道管理', deliveries: '投递记录', rules: '规则与模板' },
    sections: { events: '事件定义', templates: '通知模板', channels: '渠道管理', deliveries: '投递记录' },
    channels: { createTitle: '新建通知渠道', editTitle: '编辑通知渠道' },
    events: { createTitle: '配置事件定义', editTitle: '配置事件定义', description: '系统预置常见证书场景；只需为每个场景选择通知模板和渠道。', renewalResultDescription: '证书续期、签发或更新完成后发送结果通知。', statusDescription: '证书状态发生变化时发送通知。', reportDescription: '定期证书报表生成完成后发送通知。', expiryWarningDescription: '证书进入预设临期窗口时发送通知。', expiredDescription: '证书已经过期时发送通知。', revokedDescription: '证书被吊销时发送通知。', bindingDriftDescription: '实际绑定证书与期望版本不一致时发送通知。', reportFailedDescription: '定期证书报表最终生成失败时发送通知。' },
    templates: { createTitle: '新建通知模板', editTitle: '编辑通知模板', previewTitle: '预览模板：{key}', missingVariables: '预览缺少变量：{variables}' },
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
      createdAt: '创建时间', updatedAt: '更新时间', failureCategory: '失败分类', channel: '通知渠道', selectChannel: '请选择通知渠道', selectTemplate: '请选择通知模板',
      source: '事件来源', eventType: '事件类型', priority: '路由优先级', dedupeWindow: '去重窗口（秒）', templateKey: '模板键', locale: '语言', nextAttemptAt: '下次重试时间', variables: '模板变量', deliveryStatus: '投递状态', attempts: '发送尝试',
      titleTemplate: '标题模板', bodyTemplate: '正文模板', reason: '静默原因', startsAt: '开始时间', endsAt: '结束时间',
      privateOrigin: '私有化平台地址', privateOriginPlaceholder: '例如 https://notify.example.internal', wecomPrivateOrigins: '企业微信私有化 Origin', feishuPrivateOrigins: '飞书私有化 Origin', dingtalkPrivateOrigins: '钉钉私有化 Origin', privateOriginsPlaceholder: '每行一个，例如 https://notify.example.internal'
    },
    actions: {
      createChannel: '新建通知渠道', createRoute: '新建通知路由', createTemplate: '新建通知模板', createSilence: '新建静默规则', configure: '配置',
      confirmCreate: '确认创建', cancel: '取消', saveSettings: '保存设置', test: '测试发送', testChannel: '测试渠道：{name}', retry: '重新投递', detail: '详情', preview: '预览', enable: '启用', disable: '停用'
    },
    rules: { createRoute: '新建通知路由', createTemplate: '新建通知模板', createSilence: '新建静默规则' },
    summary: { routes: '事件映射', templates: '通知模板', silences: '静默规则', attempts: '发送尝试', outbox: '派发队列', attemptProgress: '第 {current} / {total} 次', attemptNumber: '第 {number} 次尝试', dispatchGeneration: '第 {generation} 次派发', recordCount: '共 {count} 条记录' },
    empty: { channels: '暂无通知渠道', deliveries: '暂无投递记录', routes: '暂无通知路由', events: '暂无事件定义', eventDefinitions: '暂无系统预置事件定义', templates: '暂无通知模板', silences: '暂无静默规则', attempts: '暂无发送尝试', outbox: '暂无派发记录' },
    values: { notAvailable: '—', notConfigured: '未配置', certificateSource: '证书' },
    eventTypes: { renewalResult: '证书续期结果', status: '证书状态变更', report: '证书定期报表', expiryWarning: '证书临期提醒', expired: '证书已过期', revoked: '证书已吊销', bindingDrift: '证书绑定漂移', reportFailed: '证书报表失败' },
    deliveryFilters: { all: '全部状态', failed: '投递失败', retrying: '重试中', queued: '等待投递', delivered: '投递成功' },
    secrets: { name: '{channel} - {field}', fields: { smtpUsername: 'SMTP 用户名', smtpPassword: 'SMTP 密码', webhookUrl: 'Webhook URL', signingSecret: '签名密钥', botToken: 'Bot Token' } },
    messages: {
      loadFailed: '通知管理数据加载失败', operationFailed: '通知管理操作失败', testUsesChannelTarget: '该渠道将使用已配置的接收目标发送测试通知。',
      secretStoredHint: '该内容将加密保存，创建后不会明文回显。', createSecretFailed: '密文保存失败', invalidHeaders: '固定 Header 必须是合法的 JSON 对象',
      smtpCredentialsPairRequired: 'SMTP 用户名和密码必须同时填写', webhookUrlRequired: 'Webhook URL 不能为空', botTokenRequired: 'Telegram Bot Token 不能为空',
      chatIdRequired: 'Telegram Chat ID 不能为空', feishuWebhookUrlInvalid: '请输入飞书官方自定义机器人 Webhook URL', dingtalkWebhookUrlInvalid: '请输入钉钉官方自定义机器人 Webhook URL',
      wecomWebhookUrlInvalid: '请输入有效的企业微信机器人 HTTPS Webhook URL', telegramBotTokenInvalid: 'Telegram Bot Token 格式无效', telegramMessageThreadIdInvalid: 'Telegram Topic ID 必须是正整数',
      privateDeploymentAllowlistHint: '私有化地址必须先加入上方对应平台的受信任 HTTPS Origin 白名单，否则测试和投递会被后端拒绝。', privateOriginInvalid: '私有化地址必须是精确 HTTPS Origin，不能包含路径、查询参数、用户信息或 Fragment。', privateOriginMismatch: 'Webhook URL 必须属于当前渠道填写的私有化平台地址。', privateOriginHint: '可选。仅当当前渠道的 Webhook 部署在私有化平台时填写；这里只填写协议、主机和可选端口，完整 Webhook URL 仍通过下方密文字段保存。', privateOriginsSecurityHint: '这里只填写协议、主机和可选端口；完整 Webhook URL、Token 和签名密钥仍通过密文服务保存。', telegramUsesBotApi: 'Telegram 使用官方 Bot API sendMessage 发送通知，不使用接收事件的 Webhook。'
    }
  },
  settings: {
    ...(licensingLocaleMessages['zh-CN'] ?? {}),
    securityLabel: '系统设置入口',
    deploymentTasks: {
      eyebrow: '部署任务',
      title: '部署任务参数',
      description: '按当前租户控制证书部署是否先执行 Dry-run。',
      readonly: '当前账号只有查看权限。',
      fields: {
        dryRun: { title: '启用 Dry-run', description: '部署证书前执行只读预检；检查结论仅供参考，不阻止正式部署。', aria: '启用证书部署 Dry-run' }
      },
      actions: { save: '保存设置', saving: '保存中...' },
      messages: { saved: '部署任务参数已保存。' },
      errors: { loadFailed: '加载部署任务参数失败。', saveFailed: '保存部署任务参数失败。' }
    },
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
        externalGroupPlaceholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com',
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
        clearSelection: '清空选择',
        revokePermission: '撤销授权',
        revoking: '撤销中...'
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
        businessLevel: '业务权限级别',
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
        application: '应用',
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
      levels: {
        user: '使用者',
        manager: '管理者'
      },
      presets: {
        label: '预置授权模板',
        custom: '自定义业务授权',
        certificateViewer: '证书查看',
        certificateManager: '证书管理',
        applicationViewer: '应用查看',
        applicationManager: '应用管理'
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
        invalidBusinessScope: '未找到对应的业务权限范围。',
        missingRoleId: '未获取到角色 ID',
        createRoleFailed: '创建角色失败',
        grantRoleFailed: '授予角色权限失败',
        roleNoObjectScopes: '该角色还没有授权对象范围，请先为角色授予权限。',
        assignMembersFailed: '分配成员失败',
        deleteRoleFailed: '删除角色失败',
        missingObjectSetId: '未获取到对象范围 ID',
        presetScopeMismatch: '预置模板与所选对象范围不匹配',
        revokePermissionFailed: '撤销授权失败'
      },
      confirm: {
        deleteRole: '确认删除角色“{name}”？删除后会同步移除该角色的用户分配和对象授权。',
        revokePermission: '确认撤销这条业务授权？撤销后关联的兼容对象权限也会回收。'
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
          description: '部署计划、执行与回滚'
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
        testConnection: '测试连通性',
        testing: '检测中...',
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
        baseDn: 'Base DN',
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
        domain: '例如：example.com',
        serverAddress: '例如：ad.example.com:636',
        baseDn: '例如：DC=example,DC=com',
        bindDn: '例如：CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: '输入服务账号密码',
        bindPasswordEdit: '留空表示沿用现有密码',
        autoByDirectoryType: '留空则按目录类型自动推导',
        userFilter: "例如：(uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "例如：(member={'{'}{'{'}userDn{'}'}{'}'})"
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
        activeDirectory: 'Active Directory',
        ldap: '标准 LDAP'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: '删除身份源后，该目录的登录、同步和组映射都会失效。'
      },
      test: {
        dialogTitle: '测试身份源连通性',
        dialogDescription: '正在检测 {name}（{server}）的 DNS、LDAP 认证端口和 BIND 状态。',
        loading: '正在依次检测 DNS、LDAP 认证端口和 BIND 状态...',
        checks: {
          dns: { title: '检查 DNS 解析' },
          port: { title: '检查 LDAP 认证端口' },
          bind: { title: '检查 LDAP BIND' }
        },
        status: {
          passed: '成功',
          failed: '失败',
          skipped: '已跳过'
        },
        messages: {
          summaryPassed: 'LDAP 连通性检测全部通过',
          summaryFailed: 'LDAP 连通性检测未通过',
          dnsIp: '目标是 IP 地址，无需进行 DNS 查询',
          dnsResolved: 'DNS 解析成功：{addresses}',
          dnsFailed: 'DNS 解析失败',
          portReachable: '{protocol} 认证端口 {port} 可连通',
          portFailed: 'LDAP 认证端口不可达',
          bindServicePassed: 'LDAP 服务账号 BIND 和 Base DN 查询成功',
          bindAnonymousPassed: '匿名 LDAP BIND 和 Base DN 查询成功',
          bindFailed: 'LDAP BIND 或 Base DN 查询失败',
          skippedInvalidUrl: '由于 LDAP 地址无效，已跳过',
          skippedDnsFailed: '由于 DNS 解析失败，已跳过',
          skippedPortFailed: '由于 LDAP 认证端口不可达，已跳过',
          unknownCheck: '检测项未通过（{code}）',
          checkNotReturned: '服务端未返回该检测项结果。'
        },
        errors: {
          emptyResult: '服务端未返回连通性检测结果',
          requestFailed: '连通性检测请求失败'
        }
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
    defaults: certificateFormatDefaultsZhCN,
    actions: {
      create: '新建交付配置',
      toggleFilters: '筛选',
      export: '导出',
      exporting: '导出中...',
      edit: '编辑',
      delete: '删除',
      deleting: '删除中...',
      applyTemplate: '套用内置模板',
      saving: '保存中...',
      confirmSave: '确认保存'
    },
    columns: {
      configName: '交付配置',
      targetSummary: '目标环境',
      displayFormat: '内容格式',
      extension: '扩展名',
      encodingSummary: '编码',
      exportSummary: '包含内容',
      actions: '操作'
    },
    dialog: {
      createTitle: '新建交付配置',
      editTitle: '编辑交付配置',
      description: '选择系统平台与目标平台后，可套用内置模板并定义证书交付内容。'
    },
    exportModal: {
      title: '导出证书产物',
      description: '选择证书版本，按此交付格式生成并下载文件。',
      certificateVersion: '证书版本',
      loadingVersions: '正在加载证书版本...',
      versionRequired: '请选择证书版本',
      loadVersionsFailed: '证书版本加载失败',
      artifactUnavailable: '服务端未返回可下载的证书产物',
      exportFailed: '证书产物导出失败',
      passwordRequired: 'PFX/JKS 导出必须输入密码',
      passwordPlaceholder: '请输入本次导出的密码',
      passwordHint: '仅用于本次导出，不会修改交付配置。',
      confirm: '生成并下载',
      unnamedCertificate: '未命名证书',
      versionLabel: 'v{version}',
      expiresOn: '到期 {date}'
    },
    list: {
      title: '证书交付配置',
      descriptionWithCount: '当前有 {count} 个可复用的交付配置'
    },
    empty: {
      text: '暂无交付配置'
    },
    fields: {
      contentFormat: '内容格式',
      systemPlatform: '系统平台',
      runtimePlatform: '目标平台',
      configName: '交付配置',
      backendFormat: '底层格式',
      outputExtension: '文件扩展名',
      expiresAt: '交付配置失效时间（可选）',
      certificateEncoding: '证书编码',
      certificateContentEncoding: '证书内容编码',
      privateKeyEncoding: '私钥编码',
      includeLeafCertificate: '包含终端证书',
      includeCertificateChain: '包含证书链',
      includePrivateKey: '包含私钥',
      mainArtifactIncludesChain: '主文件包含证书链',
      generateChainFile: '生成证书链文件',
      generatePrivateKeyFile: '生成私钥文件',
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
        description: '定义交付配置、内容格式和文件扩展名。'
      },
      encoding: {
        title: '编码选择',
        description: '仅显示当前内容格式支持的编码选项。'
      },
      content: {
        title: '包含内容',
        description: '选择主文件中包含的证书、证书链和私钥。'
      },
      export: {
        title: '导出选项',
        description: '选择额外的证书链文件、私钥文件和容器密码选项。'
      }
    },
    filters: {
      keywordPlaceholder: '交付配置 / 目标 / Alias / 格式'
    },
    placeholders: {
      configName: '例如：设备兼容单文件PEM',
      exportPassword: '请输入 PFX/JKS 导出密码'
    },
    validation: {
      selectPlatformsFirst: '请先选择系统平台和目标平台。',
      configNameRequired: '必须填写交付配置名称',
      passwordRequired: 'PFX/JKS 交付配置必须填写导出密码'
    },
    errors: {
      loadFailed: '交付配置加载失败',
      saveFailed: '保存交付配置失败',
      deleteFailed: '删除交付配置失败',
      createExportSecretFailed: '创建导出密码 Secret 失败',
      withCode: '{message}（{code}）'
    },
    fallbacks: {
      unnamedConfig: '未命名交付配置-{index}',
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
      leafCertificate: '终端证书',
      certificateChain: '证书链',
      privateKey: '私钥',
      extraChainFile: '额外链文件',
      extraPrivateKeyFile: '额外私钥文件'
    },
    secret: {
      defaultConfigName: '证书交付配置',
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
  deploymentInputs: {
    title: '部署输入',
    description: '根据插件或工作流声明的统一输入契约配置部署参数。',
    saveAssetFirst: '请先保存应用资产及执行来源，再编辑由后端统一投影的部署输入。',
    contractVersion: '契约 {version}',
    groups: { required: '必填配置', advanced: '高级配置', readonly: '只读与运行时值' },
    actions: { expand: '展开高级配置', collapse: '收起高级配置' },
    placeholders: { select: '请选择', credential: '请选择凭据', artifact: '请选择产物格式', output: '请选择输出' },
    artifacts: { format: '产物格式' },
    allowInsecureTls: {
      label: '允许跳过 TLS 证书校验',
      description: '显式授权本次部署在设备使用自签名或不受信任证书时跳过 TLS 证书校验。',
      help: '仅表示你的部署意图，不会自动获得执行权限；仍需通过宿主签发的执行授权。'
    },
    runtimeValue: '运行时由 {source} 提供',
    source: '来源：{source}',
    sourceKinds: {
      asset: '资产',
      binding: '绑定',
      default: '默认值',
      derived: '派生值',
      system: '系统值',
      step_output: '步骤输出',
      unknown: '未知来源'
    },
    issues: {
      title: '输入问题',
      unknown: '部署输入校验失败（{code}）',
      DEPLOYMENT_INPUT_REQUIRED: '缺少必填部署输入',
      DEPLOYMENT_CONNECTION_REQUIRED: '缺少必填连接配置',
      DEPLOYMENT_CREDENTIAL_REQUIRED: '缺少必填凭据',
      DEPLOYMENT_ARTIFACT_REQUIRED: '缺少必填部署产物',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: '该部署输入不允许覆盖',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: '部署输入槽位未声明',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: '部署输入字段未声明',
      DEPLOYMENT_INPUT_TYPE_INVALID: '部署输入类型不正确',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: '固定部署输入不允许覆盖',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: '缺少凭据快照',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: '凭据快照与当前选择不一致',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: '凭据类型不受支持',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: '缺少产物快照',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: '缺少必填产物输出'
    }
  },
  assets: {
    inventory: {
      title: '资产中心', description: '统一查看和管理设备、服务器与云服务资产。', list: '资产列表',
      columns: { name: '名称', category: '资产类别', productFamily: '产品族', managementMethod: '管理方式', managementAddress: '管理地址', status: '状态', version: '版本', controlVersion: '控制版本', sites: '站点', actions: '操作' },
      categories: { server: '服务器', networkAppliance: '网络设备', securityAppliance: '安全设备', cloud: '云服务', appliance: '设备' },
      managementMethods: { agent: 'Agent', api: 'API', plugin: '插件' },
      filters: { category: '资产类别', managementMethod: '管理方式', health: '健康状态' },
      health: { healthy: '健康', degraded: '降级', unreachable: '不可达', disabled: '已禁用', unknown: '未知' },
      metrics: { total: '资产总数', totalDescription: '当前有权访问的全部资产', abnormal: '需要关注' },
      empty: { title: '暂无资产', description: '当前没有可显示的资产。' },
      actions: { add: '添加资产', detail: '详情', operation: '操作', edit: '编辑', delete: '删除', upgrade: '升级 Agent' },
      deleteImpact: '删除资产会移除管理记录，并可能导致关联受管目标不可用。',
      errors: { detailLoadFailed: '加载资产详情失败', editSaveFailed: '保存资产失败', deleteTargetMissing: '资产管理目标缺失' },
    },
    presentation: {
      cards: '卡片视图',
      list: '表格视图'
    },
    card: {
      presentation: { cards: '卡片', list: '表格' },
      total: '共 {count} 个',
      status: { valid: '有效', attention: '关注', unknown: '未知', executable: '可执行', needsConfiguration: '需配置' },
      days: { expired: '已过期 {days} 天', expiresToday: '今天到期', notRecorded: '未记录', remaining: '{days} 天' },
      fields: { certificate: '证书', validity: '有效期', device: '设备' },
      actions: { add: '添加', upToDate: '已是最新', deployUpdate: '部署更新' }
    },
    selection: {
      selectedCount: '已选中 {count} / {total} 个资产',
      actions: {
        bulkDelete: '批量删除',
        bulkUpdateCertificate: '批量更新证书'
      },
      bulkDeleteRisk: '将删除所选应用资产及其人工目标关联；系统发现的框架、站点和受管目标不会被删除。',
      bulkDeleteSuccess: '已删除 {count} 个应用资产。',
      bulkDeletePartialSuccess: '已删除 {succeeded} 个应用资产，{failed} 个资产删除失败。',
      bulkUpdateDescription: '将为绑定同一证书域名“{domain}”的 {count} 个应用资产选择并提交新证书版本。',
      bulkUpdateFailed: '批量更新证书失败，{count} 个资产均未提交。',
      bulkUpdateSuccess: '已为 {count} 个应用资产提交证书更新。',
      bulkUpdatePartialSuccess: '已提交 {succeeded} 个应用资产的证书更新，{failed} 个资产失败。'
    },
    aria: {
      selectCard: '选择资产 {name}',
      detailCard: '查看资产详情 {name}',
      editCard: '编辑资产 {name}',
      deleteCard: '删除资产 {name}'
    },
    userView: {
      stepLabel: '第 2 步 / 3 · 应用',
      title: '接入一个应用',
      description: '添加要接收证书的应用。除非所选目标确实需要额外参数，否则不会显示技术部署细节。',
      addAction: '添加应用',
      listTitle: '已接入应用',
      listDescription: '这些应用可以在部署步骤中被选择。',
      continueToDeployment: '继续部署',
      loadFailed: '应用加载失败',
      emptyTitle: '还没有接入应用',
      emptyDescription: '先添加一个应用，证书才能部署到它。',
      deploymentLocation: '部署位置',
      targetPending: '等待配置部署位置',
      form: {
        eyebrow: '简化设置',
        title: '添加需要更新的应用',
        description: '填写应用地址并选择证书应该部署到哪里。',
        addressPlaceholder: 'app.example.com',
        portPlaceholder: '443',
        locationTitle: '证书要更新到哪里？',
        locationDescription: '选择已有的设备、服务和部署目标，底层绑定逻辑保持不变。',
        device: '设备',
        service: '服务',
        site: '站点',
        target: '部署目标',
        certificateFormat: '证书格式'
      }
    },
    title: '应用',
    description: '以域名或 IP 为主对象管理应用入口，聚焦地址、端口、协议、站点与执行定位。',
    resourceName: '应用',
    linkage: {
      title: '插件与 Agent 联动',
      description: '检查插件版本、Agent 版本和本机执行策略是否匹配。',
      status: '状态',
      agent: 'Agent 版本',
      plugin: '插件版本',
      policy: '策略匹配',
      repair: '一键修复'
    },
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
      deleteRisk: '删除后，该应用及其人工目标关联将从应用列表中移除；资产发现出的框架、站点、Virtual Server 和受管目标不会被删除。',
      rollbackFromLatestSnapshot: '从最新快照发起回退',
      rollingBack: '回退中...',
      deployCertificate: '证书部署',
      latestCertificate: '证书最新',
      updateCertificate: '证书更新',
      saving: '保存中...',
      creating: '创建中...',
      saveChanges: '保存修改',
      confirmCreate: '确认创建'
    },
    columns: {
      domain: '访问域名',
      port: '端口',
      protocol: '协议',
      device: '所属设备',
      platform: '平台',
      framework: '框架',
      site: '站点',
      status: '状态',
      actions: '操作'
    },
    fields: {
      assetId: '应用 ID',
      domain: '访问域名',
      addressType: '地址类型',
      port: '端口',
      protocol: '协议',
      device: '所属设备',
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
      remainingValidity: '剩余时长',
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
      title: '暂无应用',
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
          description: '应用是主对象，资产和站点只作为执行定位信息出现。'
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
    deployment: {
      title: '证书部署',
      description: '从当前应用资产选择一个证书版本。系统会创建部署快照并执行必要预检，然后开始部署。',
      dialogTitle: '证书部署',
      dialogDescription: '此操作只作用于当前应用资产，部署计划仍作为后台快照和执行边界保留。',
      noCertificateAsset: '没有可部署的证书资产',
      targetLocked: '已锁定更新目标',
      latestVersionPointer: '自动应用当前证书的最新版本',
      deployThisVersion: '部署此证书版本',
      loadingRecords: '正在加载部署记录...',
      emptyRecords: '该应用资产还没有部署记录。',
      preflightAvailable: '已返回 {count} 项预检',
      preflightUnavailable: '尚未执行预检',
      rollbackUnavailable: '尚未发起回滚',
      fields: {
        status: '部署状态',
        latestRun: '最新运行',
        preflight: '预检',
        rollback: '回滚',
        updatedAt: '更新时间'
      },
      feedback: {
        preflightRunning: '正在等待预检运行完成。',
        executionStarted: '预检完成，部署运行已开始。'
      },
      errors: {
        missingApplicationAssetId: '缺少应用资产 ID，无法创建证书部署。',
        missingCertificateVersion: '当前证书配置没有可部署的证书版本。',
        loadOptionsFailed: '加载可部署证书版本失败。',
        createPlanMissingId: '创建部署快照后未返回计划 ID。', createTaskMissingId: '创建专属证书部署任务后未返回任务 ID。',
        deployFailed: '证书部署操作失败。',
        preflightFailed: '证书部署预检未通过。',
        preflightTimeout: '证书部署预检等待超时。',
        loadRecordsFailed: '加载应用资产部署记录失败。'
      },
      dedicated: {
        kicker: '专属证书',
        title: '应用专属证书',
        providerTypes: { acme: 'ACME', internalCa: '受管 CA' },
        fields: {
          providerType: '证书生成方式',
          ca: '指定 CA',
          caStatus: 'CA 状态',
          custodyMode: '私钥管理方式',
          certificate: '证书状态',
          issuedAt: '申请时间',
          expiresAt: '过期时间',
          remainingDays: '剩余天数'
        },
        status: { available: '可用', unavailable: '不可用', unknown: '未知' },
        custody: { agentLocal: 'Agent 本地管理', managedSecret: '平台托管' },
        certificate: { exists: '已存在', missing: '尚未签发', failed: '签发失败' },
        remainingDays: '剩余 {days} 天',
        reapply: '重新申请证书',
        reapplyHint: '申请新的专属证书。用于证书私钥轮换',
        deployCurrentHint: '部署当前已生成的专属域名证书。',
        issuancePending: '专属证书申请已提交，等待签发完成后再部署。',
        issuanceFailed: '专属证书签发失败，请查看全局任务中的失败详情后重试。',
        issuanceFailedWithCode: '专属证书签发失败：{message}（{code}）'
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
      ariaLabel: '应用创建步骤',
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
        confirmDescription: '检查应用入口、部署模式和运行参数，确认后写入应用。'
      }
    },
    form: {
      createTitle: '手动添加应用',
      editTitle: '编辑应用',
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
      description: '用于应用展示、部署后探测和 DSL 目标变量同步。',
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
      certificateDescription: '证书版本由部署计划选择，应用在下方绑定格式配置和输出项，运行时注入 {name}.outputs.*.content。',
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
      loadAssetDetailFailed: '加载应用详情失败',
      rollbackFailed: '发起回退失败',
      loadTargetsFailed: '加载站点和受管目标失败',
      createAssetFailed: '创建应用失败',
      pluginFormLoadFailed: '加载插件配置表单失败',
      pluginBindingCreateFailed: '保存插件绑定失败',
      loadWorkflowCredentialsFailed: '加载工作流凭据失败',
      loadCredentialProfilesFailed: '加载凭据配置失败',
      noAvailableSiteInstance: '未找到可用的站点实例，请先确认设备发现已成功上报框架和站点。',
      managedTargetRediscoveryRequired: '当前站点没有受管目标，请重新执行设备发现。',
      noCompatibleManagedPlugin: '没有与当前受管目标兼容的已启用插件。',
      capabilityAssignmentMissing: '当前目标尚未配置生效的部署能力。'
    },
    platforms: {
      appliance: '设备',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: '平台',
      gateway: 'Gateway'
    },
    status: {
      archived: '已归档',
      unknownStatus: '未知状态'
    },
    certificateSupply: {
      title: '证书配置',
      description: '在这里配置手动证书或应用专属证书，历史配置会保留。',
      modeLabel: '证书配置方式',
      manual: '手动选择证书',
      dedicated: '使用专属证书',
      certificateVersion: '证书版本',
      selectCertificate: '匹配当前域名的证书',
      domainMatch: '仅显示 CN 或 SAN 覆盖 {domain} 的证书。',
      provider: '签发 Provider',
      internalCa: 'Internal CA',
      acme: 'ACME',
      ca: '证书颁发机构',
      selectCa: '选择 CA',
      profile: 'Certificate Profile',
      selectProfile: '选择 Profile 版本',
      acmeProvider: 'ACME Provider',
      acmeProfile: 'ACME Profile',
      selectAcmeProfile: '选择 ACME Profile',
      selectProvider: '选择 Provider',
      dnsProvider: 'DNS Provider',
      selectDnsProvider: '选择 DNS Provider',
      secretRef: '凭据 SecretRef',
      secretRefPlaceholder: 'secret://tenant/path',
      custodyMode: '密钥归属',
      artifactMode: '部署制品模式',
      canSave: '可保存',
      canIssue: '可签发',
      canDeploy: '可部署',
      lifecycle: '生命周期状态',
      errors: { loadFailed: '加载证书配置失败。', previewFailed: '预览证书配置失败。' }
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
    banners: {
      importSucceeded: '证书已导入，新证书版本 ID：{id}'
    },
    views: {
      eyebrow: '页面模式',
      switchLabel: '证书页面视图切换',
      modes: {
        user: '用户视图',
        professional: '专业视图'
      },
      descriptions: {
        user: '只保留导入证书、接入应用和设置自动更新这条常见流程。',
        professional: '展示证书版本、链状态和完整技术细节。'
      }
    },
    userView: {
      hero: {
        eyebrow: '常见流程',
        title: '按业务流程处理证书更新',
        description: '先导入或替换证书，再接入应用，最后设置自动更新计划。大多数日常操作不需要看底层技术细节。',
        primaryAction: '导入或替换证书',
        secondaryAction: '切到专业视图'
      },
      summary: {
        ariaLabel: '证书用户视图概览',
        managedCertificates: '已管理证书',
        expiredCertificates: '已过期证书',
        expiringSoonCertificates: '即将到期证书',
        connectedApplications: '已接入应用',
        activeAutomationPlans: '启用中的自动计划'
      },
      steps: {
        title: '常用流程',
        description: '按这个顺序处理，大多数证书更新不需要关注技术细节。',
        status: {
          done: '已完成',
          todo: '待处理'
        },
        import: {
          title: '导入或替换证书',
          description: '把新的证书材料导入系统，后续应用接入和计划都会基于这里的证书继续。',
          helperCompleted: '当前已管理 {count} 个证书域名，可以继续替换或补充证书版本。',
          helperEmpty: '先导入当前证书，后面的应用接入和自动计划才能继续。',
          action: '开始导入'
        },
        applications: {
          title: '添加应用',
          description: '告诉系统这张证书要给哪个应用或站点使用，部署时才知道要更新哪里。',
          helperCompleted: '当前已有 {count} 个应用接入证书流程。',
          helperEmpty: '还没有应用接入，导入证书后建议马上补齐这一步。',
          action: '去添加应用'
        },
        automations: {
          title: '设置自动更新计划',
          description: '把证书更新安排成自动执行，避免每次到期前都手工处理。',
          helperCompleted: '当前已有 {count} 个启用中的自动计划。',
          helperEmpty: '还没有启用中的自动计划，建议在业务低峰时补上。',
          action: '去设置计划'
        }
      },
      common: {
        notAvailable: '暂不可用',
        permissionRequired: '当前账号没有对应权限，请联系管理员。'
      },
      focus: {
        currentSelectionTitle: '当前关注的证书',
        currentSelectionDescription: '切到专业视图后，可以查看版本、签发方和完整链路细节。',
        currentSelectionEmpty: '还没有选中证书域名',
        currentSelectionHint: '先从下方待处理列表进入专业视图，或直接切到专业视图浏览全部证书。',
        validUntil: '到期时间：{value}',
        openProfessional: '打开专业视图',
        attentionTitle: '优先处理',
        attentionDescription: '先处理已经过期或即将到期的证书，再补应用接入和自动计划。',
        assetAction: '查看专业详情',
        emptyTitle: '当前没有紧急证书',
        emptyDescription: '所有已导入证书暂时都在有效期内。'
      },
      simple: {
        title: '证书与应用管理',
        subtitle: '管理证书和查看哪些应用在使用它们',
        sections: {
          certificates: {
            title: '证书管理',
            help: '查看和管理所有证书，包括到期时间和状态。'
          },
          applications: {
            title: '应用关联',
            help: '查看证书在哪些应用中使用，以及更新方式和频率。'
          }
        },
        stats: {
          total: '证书总数',
          expiring: '即将到期',
          expired: '已过期'
        },
        versionCount: '{count} 个版本',
        versionCountShort: '{count} 个',
        sourceLabels: {
          manual: '手动',
          acme: 'ACME',
          unknown: '未知'
        },
        fields: {
          expires: '到期时间',
          source: '来源',
          versions: '版本'
        },
        empty: {
          title: '还没有证书',
          description: '导入第一个证书开始管理。'
        },
        applications: {
          description: '查看选中证书在哪些应用中使用，以及自动更新配置。',
          selectPrompt: '请先在左侧选择一个证书',
          selectedCertificate: '当前证书',
          connectedApps: '关联应用（{count}）',
          noApps: '该证书还没有关联任何应用。',
          addApp: '添加应用',
          automationTitle: '自动更新配置',
          activeAutomations: '活跃的自动更新',
          totalAutomations: '总自动更新计划',
          automationDescription: '自动更新计划会定期检查证书状态，并在需要时自动部署到关联的应用。'
        }
      }
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
          assetName: '资产',
          frameworkName: '框架',
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
        trustRootCertificate: '目标根证书',
        trustRootStatus: '根证书状态',
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
      diagnostics: {
        rootResolvedFromLibrary: '导入材料未包含根证书：{root}。平台根证书库已解析到该根证书，部署时可补齐。'
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
      addTitle: '添加证书',
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
      source: {
        title: '选择添加方式',
        description: '选择导入已有证书，或在可用时使用 ACME 自动申请。',
        manual: {
          title: '导入已有证书',
          description: '上传 PEM、CRT 或 PFX 证书文件及私钥。',
          recommended: '推荐'
        },
        acme: {
          title: '通过 ACME 申请证书',
          description: '自动向证书颁发机构申请并续期证书。',
          unavailable: '当前不可用'
        },
        unavailable: {
          title: 'ACME 申请通道尚未配置',
          description: '当前控制台没有可用的 ACME 申请入口。请选择导入已有证书，或在配置自动化申请通道后重试。'
        }
      },
      acme: {
        title: '申请 ACME 证书', loading: '正在检查申请通道...', blocked: '当前申请通道尚未就绪，请根据下列原因完成配置后刷新。',
        status: { ready: '可申请', blocked: '待配置', unknown: '状态未知' },
        fields: { issuer: '颁发机构', email: '联系人邮箱', domains: '域名', dnsCredential: 'DNS 凭据', keyType: '密钥类型', autoRenew: '自动续签' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: '提交申请', refresh: '刷新状态' },
        errors: { requestFailed: 'ACME 请求失败' }
      },
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
        source: '添加方式',
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
      upload: {
        choose: '选择文件',
        noFile: '尚未选择文件'
      },
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
        primaryDomain: 'example.com',
        versionKeyword: '名称 / 颁发者 / 使用者 / 版本 ID'
      },
      columns: {
        notBefore: '开始日期',
        notAfter: '结束日期',
        associatedAsset: '关联资产',
        applicationCount: '应用数',
        sourceType: '添加方式',
        status: '状态',
        certificateVersionId: '证书版本 ID'
      },
      sourceTypes: {
        manual: '手动导入',
        internal_ca: '内部 CA',
        enterprise_ca: '企业 CA',
        external_api: '外部 API',
        acme: 'ACME',
        unknown: '未知'
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
        toggleFilters: '筛选',
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
    trustRoots: {
      title: '根证书管理',
      description: '在当前页面内查看根证书库、来源观察记录和叶子证书关联关系，不跳转到独立页面。',
      actions: {
        open: '根证书管理',
        refresh: '刷新',
        expandVersions: '展开关联版本',
        collapseVersions: '收起关联版本'
      },
      toolbar: {
        title: '根证书库',
        description: '当前已识别 {count} 个目标根视图。'
      },
      summary: {
        managedVersions: '目标根视图',
        resolvedVersions: '已获取',
        missingVersions: '未获得根证书',
        invalidChainVersions: '证书链无效',
        targetRoot: '目标根指纹：{fingerprint}',
        rootFingerprintUnavailable: '当前还无法确定目标根指纹',
        relatedAssetCount: '关联资产 {count} 个'
      },
      detail: {
        subtitle: '展示根证书基本信息、来源观察和叶子版本关联。'
      },
      fields: {
        fingerprintSha256: 'SHA-256 指纹',
        serialNumber: '序列号',
        subject: '主体',
        issuer: '签发者',
        notBefore: '生效时间',
        notAfter: '到期时间',
        relatedAssets: '关联证书资产',
        relatedVersions: '关联证书版本'
      },
      sections: {
        observations: '来源观察',
        relatedAssets: '关联证书资产',
        versionRelations: '叶子证书关联',
        managedCertificates: '已纳管证书根状态'
      },
      states: {
        loadFailed: '根证书列表加载失败',
        detailFailed: '根证书详情加载失败',
        assetLoadFailed: '关联证书资产加载失败',
        emptyTitle: '暂无根证书记录',
        emptyDescription: '当前项目内还没有收录根证书，可以后续再通过后端 API 导入。',
        unselectedTitle: '未选择根证书',
        unselectedDescription: '请先在左侧选择一条根证书记录。',
        rootNotInLibrary: '当前根证书还未入库，以下关联资产与状态来自已纳管证书的根链推断结果。',
        emptyObservations: '暂无来源观察记录',
        emptyRelations: '暂无叶子证书关联',
        emptyAssets: '当前根证书暂未关联任何证书资产'
      },
      validationStatus: {
        pending: '待验证',
        verified: '已验证',
        rejected: '已拒绝',
        expired: '已过期'
      },
      sourceTypes: {
        control_plane_node: '控制面 Node Root Store',
        openssl: '控制面 OpenSSL 根库',
        windows: '控制面 Windows Root Store',
        internet: '受控互联网来源',
        manual: '手动导入',
        managed_host_inspect: '受管宿主定向检查'
      },
      observationStatus: {
        candidate: '候选',
        accepted: '已接受',
        rejected: '已拒绝',
        failed: '失败'
      },
      relations: {
        selected_root: '已选根证书',
        candidate: '候选根证书'
      },
      resolutionStatus: {
        resolved: '已解析',
        ambiguous: '存在歧义',
        missing: '缺失',
        invalid: '无效'
      },
      rootStatus: {
        resolved: '已获取',
        missing: '未获得根证书',
        invalid_chain: '证书链无效'
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
        browser: {
          displayName: '浏览器步骤',
          description: '在已登录的浏览器会话中导航、提取或验证页面信息。'
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
        pluginAction: {
          displayName: '插件原子动作',
          description: '调用 DSL 明确声明的单个插件动作，不接管工作流顺序或回滚。'
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
        pluginId: '插件 ID',
        capability: '能力标识',
        actionId: '动作 ID',
        actionContractVersion: '动作合同版本',
        actionInput: '动作输入 JSON',
        inputSchemaSha256: '输入 Schema 摘要',
        outputSchemaSha256: '输出 Schema 摘要',
        writeEffect: '写入效果',
        idempotencyKeyRef: '幂等键变量引用',
        outputFormat: '输出格式',
        usernameVariable: '用户名变量',
        variable: '变量',
        verifyType: '验证类型',
        browserAction: '浏览器动作',
        browserUrl: '页面 URL',
        browserExtractions: '提取配置 JSON',
        browserVerification: '验证配置 JSON'
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
        unknownNodeType: '未知节点类型：{type}',
        missingWorkflowDsl: '未能获取到工作流 DSL'
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
          resetToCanvas: '回填当前画布 DSL',
          openStepEditor: '在弹窗中编辑当前节点 DSL',
          openStepEditorAria: '在弹窗中编辑当前节点 DSL',
          applyStepEditor: '应用修改',
          cancelStepEditor: '取消'
        },
        editor: {
          title: '编辑当前节点 DSL',
          description: '修改完整 JSON 后点击应用；解析失败时不会覆盖当前节点。',
          ariaLabel: '当前节点 DSL 内容'
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
        requestBody: '请求体',
        requestBodyStructuredHint: '当前请求使用 form、multipart 等结构化字段，请通过 DSL 编辑器修改。',
        requestBodyEmptyHint: '当前请求未配置请求体。',
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
        description: '只列出已启用插件中的证书工作流。先选择工作流，再选择插件版本。复制后工作流归当前用户所有，可继续编辑。',
        createAction: '创建工作流',
        applyAction: '生成草稿',
        currentTarget: '当前工作流：{name}',
        namePlaceholder: '输入新工作流名称',
        loading: '正在加载插件工作流来源...',
        empty: '没有可用的插件工作流来源。',
        version: '插件版本',
        workflowVersion: '工作流版本',
        versionSource: '版本来源：{plugin} / {version} / {capability}',
        capabilities: { deploy: '证书部署', rollback: '证书回滚' },
        errors: { loadFailed: '加载插件工作流来源失败', nameRequired: '请输入工作流名称', missingApplyTarget: '缺少要生成草稿的工作流', actionFailed: '插件工作流复制失败' }
      },
      origins: { user: '自定义', plugin_internal: '插件内置' },
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
      filters: {
        showNonDeployment: '显示非部署工作流'
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
    tls: monitoringTlsZhCN,
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
      probeInterval: '探测频率',
      secondsUnit: '秒',
      millisecondsUnit: 'ms'
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
      warning: '警告',
      removed: '已移除'
    },
    warnings: {
      certificateNotApplied: '系统探测到站点仍未应用域名证书的最新版本',
      chainVerificationFailed: '系统探测到证书链验证失败'
    },
    fallback: {
      noEndpoint: '未配置访问地址',
      noFingerprint: '无指纹',
      notClosed: '未关闭',
      noSummary: '无摘要',
      notCollected: '未采集',
      notSelected: '未选择',
      unknownAsset: '未知资产',
      removedAsset: '{name}（移除）',
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
      closedAt: '警告关闭时间',
      currentStatus: '当前状态',
      expiresAt: '到期时间',
      issuerName: '颁发者名称',
      latency: '延时',
      occurredAt: '发生时间',
      result: '结果',
      source: '来源',
      status: '状态',
      time: '时间',
      warningContent: '警告内容'
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
      assetCount: '{count} 个资产',
      lazyLoadHint: '已加载 {shown} / {total} 条，继续滚动加载更多'
    }
  },
  login: {
    visualLabel: '产品说明',
    brand: 'GCAC',
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
        waiting_approval: '等待执行',
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
        approval: '执行门槛',
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
        waiting_approval: '等待执行',
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
          waiting_approval: '等待执行目标'
        }
      }
    }
  },
  internalCa: {
    title: '内部 CA', description: '统一管理内部证书机构、应用证书生命周期与证书复用风险。',
    tabs: { trustDomains: 'CA 信任域', authorities: '证书机构', profiles: '证书 Profile', requests: '证书申请', operations: '生命周期运维', risks: '复用风险' },
    trustDomains: { recordsTitle: '信任域记录', columns: { name: '名称', purpose: '用途', isolationLevel: '隔离等级', status: '状态', default: '默认状态', createdAt: '创建时间', actions: '操作' }, empty: '暂无 CA 信任域记录。', modalTitle: '新增 CA 信任域', modalDescription: '填写信任域基本信息，唯一代码由系统自动生成。', editModalTitle: '编辑 CA 信任域', editModalDescription: '修改信任域基本信息及默认状态。', generatedCodeHint: '唯一代码由系统自动生成，无需手动填写。', notDefault: '非默认' },
    authorityEdit: { modalTitle: '编辑 CA', modalDescription: '修改 CA 管理参数；证书主题、私钥、层级和 Provider 保持不变。', selectProfile: '选择现有证书 Profile', noProfiles: '没有与当前 CA Provider 兼容的活动 Internal CA Profile。' },
    operations: { title: '生命周期运维', policiesTitle: '证书策略', bindingsTitle: 'Provider 动作绑定', rotationsTitle: '换钥轮换', crlTitle: 'CRL 发布', policyVersion: '当前版本：{version}', policyApproval: '签发审批：{required}', emptyPolicies: '暂无证书策略记录。', emptyBindings: '暂无外部 CA 动作绑定。', emptyRotations: '暂无证书轮换记录。', emptyCrl: '暂无 CRL 发布记录。', plan: '部署计划：{id}', targetVersion: '目标证书版本：{id}', tlsStatus: 'TLS 验证：{status}', tlsPending: '待验证', rollbackRequired: '需要回滚或人工处理', crlNumber: 'CRL 编号：{number}', publishCrl: '重新发布 CRL', publishCrlFor: '发布 {name} 的 CRL', crlPublished: 'CRL 已发布。' },
    requests: { recordsTitle: '证书申请记录', columns: { commonName: 'Common Name', applicationAssetId: '应用资产 ID', keyReference: '密钥托管', certificate: '证书与部署', updatedAt: '更新时间', actions: '操作' }, empty: '暂无证书申请记录。', modalTitle: '新建证书申请', modalDescription: '填写证书申请信息，提交后将进入审批与签发流程。', policyVersion: '策略：{id}', certificateVersion: '证书版本：{id}', deployment: '部署：{status}', deploymentPlan: '部署计划：{id}', deploymentActive: '已在目标生效', deploymentBlocked: '部署已阻断', deploymentPending: '尚未部署', localAgentHint: '本地 Agent 会在目标主机生成私钥和 CSR，GCAC 只接收公开 CSR 证据。', agentId: 'Agent ID', targetId: '目标 ID', keyPath: '私钥路径', certificatePath: '证书输出路径', configPath: '本机 Tomcat 配置路径', alias: 'KeyStore 别名', format: '证书格式', storageMode: '密钥存储', storageFile: 'PEM 文件', storageCng: 'Windows CNG/KSP', localAgentRequestIdMissing: '未返回证书申请 ID，未发送本机 CSR 任务。' },
    profiles: { recordsTitle: '证书 Profile 记录', columns: { providerType: '签发来源', securityDomain: '安全域', versionCount: '版本数', actions: '操作' }, empty: '暂无证书 Profile 记录。', modalTitle: '新建证书 Profile', modalDescription: '创建可复用的 HTTPS 证书规则；创建后在证书机构中关联并生效。', providerTypes: { acme: '公网 ACME', internalCa: '企业 Internal CA' }, anyProvider: '任意活动 Provider', anyAuthority: '任意活动 CA', anyAcmeProviderProfile: '使用 Provider 默认预设', noDnsProvider: '不使用 DNS Provider', domainPatterns: '域名匹配模式', domainPatternsPlaceholder: 'example.com、*.example.com', applicableDomains: '适用域名', applicableDomainsPlaceholder: '*.example.com, *.example.org', applicableDomainsHint: '留空表示不限制；填写的域名同时用于 Profile 匹配和 DNS 后缀校验。', targetCapabilities: '目标必须具备的能力', targetCapabilitiesPlaceholder: 'certificate.deploy、key.generate_csr', securityDomainPlaceholder: '* 表示所有安全域', priority: '管理员排序优先级', defaultProfile: '默认自动 Profile', credentialRefPlaceholder: 'secret://租户/路径' },
    topology: { rootOnly: '仅根 CA', rootOnlyDescription: '根 CA 直接承担日常签发，部署简单但根密钥需要长期在线。', rootOnlyRisk: '高风险：根密钥失陷会影响整个信任域。', intermediate: '根 CA + 中间 CA', intermediateDescription: '根 CA 离线保管，由中间 CA 承担日常签发。', recommended: '推荐：隔离根密钥并缩小签发故障域。' },
    sections: { trustDomain: '创建 CA 信任域', issuingBackends: '签发后端与连接状态', authorityWizard: 'CA 创建向导', authorityOverview: '证书机构架构', authorityOverviewDescription: '每张卡片代表一个根信任锚点，选择卡片可查看其下级签发架构。', caArchitecture: 'CA 层级架构', riskSummary: '安全决策摘要', profile: '创建证书 Profile', request: '创建应用证书申请', revocation: '创建吊销任务', trust: '创建信任分发任务', remediation: '整改预览' },
    fields: { name: '名称', code: '唯一代码', purpose: '用途', isolationLevel: '隔离等级', defaultTrustDomain: '设为默认信任域', trustDomain: 'CA 信任域', parentAuthority: '父根 CA', authorityType: '证书机构类型', deploymentMode: '部署模式', platform: '运行平台', backendName: '签发后端名称', availabilityMode: '可用性模式', endpoint: '服务地址', authMode: '身份认证方式', profile: '签发 Profile', certificateProfiles: '证书 Profile', template: '证书模板', crlUrl: 'CRL 地址', ocspUrl: 'OCSP 地址', issuingBackend: '签发后端', entryMode: '创建方式', commonName: 'Common Name', certificateSubjectCommonName: '证书主题 Common Name', securityDomain: '安全域', topology: 'CA 拓扑', dnsSuffixes: '允许的 DNS 后缀', validityDays: '最大有效期（天）', renewalDays: '提前续期（天）', requireApproval: '签发前需要审批', applicationAssetId: '应用资产 ID', authority: '证书机构', providerType: '签发来源类型', profileVersionId: 'Profile 版本 ID', acmeProviderProfile: 'ACME Provider 预设', dnsProvider: 'DNS Provider', credentialRef: '凭据 SecretRef', sans: 'SAN 列表', custodyMode: '密钥托管模式', certificateVersionId: '证书版本 ID', reason: '吊销原因', targetIds: '目标 ID 列表' },
    actions: { refresh: '刷新', addTrustDomain: '新增信任域', editTrustDomain: '编辑信任域', updateTrustDomain: '保存信任域', deleteTrustDomain: '删除信任域', addAuthority: '添加 CA', editAuthority: '编辑 CA', updateAuthority: '保存 CA', deleteAuthority: '删除 CA', associateProfile: '关联', removeProfileAssociation: '移除关联', addIntermediate: '添加中间 CA', previous: '上一步', next: '下一步', createTrustDomain: '创建信任域', previewRisk: '预览风险', createAuthority: '创建 CA', createProfile: '创建 Profile', deleteProfile: '删除 Profile', createRequest: '提交申请', approve: '审批通过', retry: '重试', queryResult: '查询结果', scanRenewals: '扫描到期续期', createRevocation: '创建吊销任务', createTrust: '创建信任分发', previewRemediation: '预览整改' },
    placeholders: { dnsSuffixes: 'example.com, office.example.com', sans: 'oa.example.com, 10.0.0.10' },
    messages: { loadFailed: '内部 CA 数据加载失败。', actionFailed: '操作失败，请检查输入、权限和审批状态。', confirmAuthorityDelete: '确定删除 CA“{name}”？历史证书和审计记录会保留。', authorityDeleted: '证书机构已删除。', authorityUpdated: 'CA 管理参数已更新。', confirmTrustDomainDelete: '确定删除 CA 信任域“{name}”？它将不再用于新签发，历史证书和审计记录会保留。', trustDomainDeleted: 'CA 信任域已删除。', trustDomainUpdated: 'CA 信任域已更新。', confirmProfileDelete: '确定删除证书 Profile“{name}”？它将不再参与自动解析，历史版本和申请记录会保留。', profileDeleted: '证书 Profile 已删除。', noIntermediate: '该根 CA 尚未配置中间证书颁发机构。', noRootAuthority: '尚未配置根 CA', noRootAuthorityDescription: '添加根 CA 以建立第一套独立信任架构。', trustDomainCreated: 'CA 信任域已创建。', authorityCreated: '证书机构已创建。', profileCreated: '证书 Profile 已创建。', requestCreated: '证书申请已提交。', requestApproved: '证书申请已审批。', requestRetried: '证书签发已重试。', requestQueried: '远程签发结果已刷新。', renewalScanned: '续期扫描已完成。', revocationCreated: '吊销任务已创建并等待审批。', revocationApproved: '证书吊销已审批。', trustCreated: '信任分发任务已创建并等待审批。', trustApproved: '信任分发已审批。' },
    metrics: { renewals: '续期任务', revocations: '吊销任务', trust: '信任分发', totalRisks: '风险总数', critical: '严重风险', affectedAssets: '受影响应用资产' },
    labels: { rootAuthority: '根证书颁发机构', intermediateAuthority: '中间证书颁发机构', intermediateCount: '{count} 个中间 CA', expiresAt: '到期时间：{time}', defaultTrustDomain: '默认信任域', independentTrustDomain: '独立根信任边界', trustDomainCount: '{count} 个 CA 信任域', versionCount: '{count} 个版本', assetCount: '{count} 个应用资产', requestCount: '将创建 {count} 个独立证书申请', backendUsageCount: '{count} 个证书机构正在使用', unverifiedCapabilityCount: '{count} 项能力尚未验证' },
    backendTypes: { builtin: '内置签发后端', acme: '公共 ACME 证书机构', external: '外部签发后端' },
    backendSummary: { createAndIssue: '可创建和签发证书', requestPublicCertificates: '可申请公共证书', external: '需接入外部执行器', localVerified: '本地验证通过', remoteVerified: '连接验证通过', unverified: '尚未验证', agentVersion: 'Agent 版本', agentVersionSource: '版本来源', versionFromHeartbeat: '最近心跳上报（实际运行）', versionFromRegistration: '注册记录（尚未收到心跳）', registeredVersion: '注册版本', agentKey: 'Agent Key', agentStatus: 'Agent 状态', heartbeatAt: '最近心跳', observationAt: '最近观测', storedRecords: '后端记录数', observationStats: '扫描 {scanned} · 发送 {submitted} · 入库 {inserted}', refresh: '立即扫描并刷新', refreshing: '扫描中…', noAgent: '该 CA 尚未关联 AD CS Agent。', statusOnline: '工作中', statusOffline: '离线', statusUnknown: '未知', observationNever: '尚未收到观测', refreshSucceeded: 'AD CS 扫描完成，本轮新增 {count} 条记录。', refreshFailed: 'AD CS 扫描失败。' },
    adcs: {
      actions: { add: '添加 AD CS Agent', edit: '编辑', delete: '删除' },
      modal: { addTitle: '添加 Microsoft AD CS Agent', editTitle: '编辑 Microsoft AD CS Agent', description: '维护用于生成 AD CS 证书操作计划的 Windows Agent 连接。' },
      fields: { name: '实例名称', agentKey: 'Agent Key', caConfig: 'AD CS CA 配置', templateId: '证书模板', endpoint: 'AD CS 地址', secretRef: '凭据 SecretRef', commonName: 'CA 显示名称', securityDomain: '安全域', trustDomain: '信任域' },
      install: { title: '安装 Windows AD CS Agent', description: '生成一次性 PowerShell 安装命令，在目标 Windows 服务器执行后，再关联注册成功的 Agent。', displayName: 'GCAC AD CS Agent - {name}', version: 'Agent 版本', generate: '生成安装命令', regenerate: '重新生成命令', copy: '复制命令', notGenerated: '尚未生成安装命令。', expiresAt: '命令过期时间：{time}', associated: '已关联 Agent：{agentId}', waitingAssociation: '尚未关联 Agent。', associate: '检测并关联' },
      placeholders: { caConfig: 'CA-SERVER\\\\IssuingCA', endpoint: 'https://ca-server.example.com', secretRef: 'secret://...' },
      options: { createTrustDomain: '自动创建新的信任域' },
      defaultTrustDomainName: '{name} 信任域',
      messages: { created: 'Microsoft AD CS Agent 已添加，并已关联到 CA 管理。', updated: 'Microsoft AD CS Agent 已更新。', deleted: 'Microsoft AD CS Agent 已删除。', deleteInUse: '该 Agent 已被 CA 使用，不能删除。', pluginUnavailable: 'Microsoft AD CS 插件未启用，请先启用内置插件。', authorityRegistrationFailed: 'Agent 已保存，但 CA 登记失败。完成 CA 登记后才能签发证书。', agentPlanHint: '控制面生成固定 Agent Plan；Windows Agent 执行本机 AD CS 操作并返回结果。', nameRequired: '请先填写实例名称，再生成安装命令。', installCommandGenerated: 'Windows Agent 安装命令已生成。', installCommandCopied: '安装命令已复制。', copyFailed: '浏览器不允许访问剪贴板，请手动复制命令。', installCommandFailed: 'Windows Agent 安装命令生成失败。', saveBeforeAssociation: '请先保存 AD CS Agent，再检测并关联。', agentKeyMissing: '请先生成安装命令，再关联 Agent。', agentNotFound: '未找到该 Agent Key 对应的已注册 Agent，请先在目标服务器执行安装命令。', agentAssociated: '已关联注册成功的 Windows Agent。', associationFailed: 'Windows Agent 关联失败。', autoRegistrationFailed: '已注册的 AD CS Agent 未能加入签发后端。' },
    },
    availability: { single: '单节点', activeStandby: '主备', activeActive: '多活' },
    authModes: { managedSecret: '托管凭据', clientCertificate: '客户端证书', none: '无认证' },
    isolationLevels: { standard: '标准隔离', strict: '严格隔离', regulated: '受监管隔离' },
    custodyModes: { managedSecret: '托管 Secret', localAgent: '本地 Agent', deviceLocal: '设备本地', externalKey: '外部密钥' },
    protectionLevels: { softwareControlled: '软件受控', osProtected: '操作系统保护', hardwareBacked: '硬件保护' },
    wizard: { title: '添加证书颁发机构', description: '选择内置或已维护的外部签发后端，再配置 CA 参数和安全边界。', stepsAria: 'CA 创建步骤', entryStep: '选择方式', backendStep: '配置后端', parentStep: '选择父 CA', authorityStep: '配置 CA', reviewStep: '确认创建', completed: '已完成', inProgress: '进行中', pending: '待填写', entryEyebrow: '第一步', entryTitle: '这套 CA 由谁负责签发？', entryDescription: '可使用 GCAC 内置后端，或选择已注册的 Windows AD CS Agent。', recommended: '推荐起步', builtinTitle: '直接创建 CA', builtinDescription: '由当前 GCAC 服务内置的通用证书签发执行面完成。', builtinFeature1: '无需部署额外节点', builtinFeature2: '适合开发和中小规模内部环境', externalTitle: '连接 Microsoft AD CS', externalDescription: '通过已维护的 Windows Agent 接入外部 AD CS CA。', externalFeature1: '复用已安装的 AD CS Agent', externalFeature2: 'CA 参数只保存在对应 CA 记录中', externalUnavailable: '请先在签发后端中添加并注册 AD CS Agent。', backendEyebrow: '签发后端', builtinBackendTitle: '使用 GCAC 内置签发后端', builtinBackendDescription: '系统自动创建或复用租户内置执行后端，用户只需要配置 CA。', externalBackendTitle: '使用已维护的 AD CS Agent', externalBackendDescription: '选择负责在 Windows 本机执行该 CA 操作的 Agent Provider。', builtinAutomaticTitle: '无需单独创建执行后端', builtinAutomaticDescription: '创建 CA 时系统会自动确保内置签发执行后端存在，并绑定到当前 CA。', externalAgentTitle: 'Agent 已经维护完成', externalAgentDescription: '此步骤只选择已注册 Agent，CA 名称默认使用选中的 Microsoft CA 名称。', externalTrustDomainHint: 'Microsoft CA 的信任域将由系统自动生成。', externalTrustDomainAuto: '系统自动生成', authorityEyebrow: '证书机构', rootConfigurationTitle: '配置根 CA', rootConfigurationDescription: '定义新的根信任边界、名称、主题和是否启用中间 CA。', intermediateConfigurationTitle: '配置中间 CA', intermediateConfigurationDescription: '先选择父根 CA，再配置承担日常签发的中间证书颁发机构。', advancedSubjectTitle: '高级证书主题设置', commonNameHelp: '写入 CA 证书主题，用于证书链识别，不是域名。', builtinSecurityNote: '软件私钥由 GCAC SecretService 托管，不等同于不可导出 HSM 密钥。', externalSecurityNote: 'CA 私钥和签发操作由 Windows AD CS Agent 在本机执行。', reviewEyebrow: '最终确认', reviewTitle: '检查信任边界与签发方式', reviewDescription: '确认 CA 名称、信任域、签发后端和 CA 专属参数后再创建。', builtinProviderName: 'GCAC 内置签发后端', rootTitle: '根 CA', rootDescription: '创建新的独立根信任锚点，并可同时创建首个中间 CA。', intermediateTitle: '中间 CA', intermediateDescription: '挂载到已有根 CA 下承担日常签发，不创建新的根信任边界。', noWarnings: '未发现额外的拓扑风险警告。' },
    riskTypes: { certificate_fingerprint_reuse: '同一证书跨资产复用', public_key_reuse: '同一公钥跨资产复用' },
    common: { unknown: '未知' }, aria: { tabs: '内部 CA 功能导航' }
  },
  applicationOnboarding: {
    eyebrow: '应用接入向导', title: '添加应用资产', description: '选择业务平台，按向导完成设备、站点和证书配置。', helpAria: '查看应用接入向导说明', stepsAria: '应用接入步骤',
    steps: { platform: '平台', device: '资产', target: '站点', certificate: '证书', complete: '完成' },
    platforms: { customManual: '自定义手动创建', manualHint: '使用传统手动创建流程', pluginHint: '由平台插件提供固定流程', capabilityVersion: '接入能力版本', compatibility: '支持的平台版本', requiredInformation: '接入前需提供', inReview: '正在进行能力验证，暂不可接入', searchLabel: '搜索平台', searchPlaceholder: '搜索应用名称、平台版本或接入信息', pluginCenterPrompt: '没有找到想要的应用？', pluginCenterAction: '来插件中心看看' },
    device: { title: '连接业务平台', existing: '使用已有设备', new: '新增设备', deviceId: '设备 ID', selectPlaceholder: '请选择设备', noExisting: '没有可用于该平台的健康设备。', existingLoading: '正在加载兼容设备。', refreshExisting: '刷新设备', newDescription: '将打开统一设备接入向导，完成 Agent 注册或设备接入后返回本向导。', newAction: '打开设备接入向导', username: '用户名', password: '密码', host: '地址', port: '端口' },
    resource: { title: '选择平台资源', refresh: '刷新资源', loading: '正在加载可用资源。', empty: '暂无可用的平台资源。' },
    target: { title: '选择业务站点', siteName: '站点名称', selectedSite: '已选站点', accessDomain: '访问域名', verifyUrl: '验证 URL', accessDomainPlaceholder: '例如 ikuai.jacksonz.cn', verifyUrlPlaceholder: '例如 https://ikuai.jacksonz.cn:443', domainHint: '管理端点可以是 IP，但访问域名和验证 URL 必须使用同一 DNS 域名。', invalidConfiguration: '请填写有效的 DNS 访问域名和同域验证 URL。', listenAddress: '监听地址', listenPort: '监听端口', protocol: '协议', selectable: '可选择的受管目标', notSelectable: '不可选择', unavailableReason: '不可选择原因', missingValue: '未提供', reasons: { managedTargetInactive: '这个受管目标已经停用。', workflowCapabilityMissing: '这个目标不具备当前平台所需的工作流执行能力。', targetEndpointMissing: '这个目标缺少完整的监听地址、端口或协议。', unknown: '这个目标当前不符合选择条件。' } }, certificate: { title: '配置证书', modeLabel: '证书配置方式', manual: '手动选择证书', manualDescription: '从证书库选择已签发版本。', dedicated: '选择专属证书', dedicatedDescription: '为此应用单独申请和续期证书。', testPhase: '测试阶段', provider: '证书签发方式', internalCa: '内部 CA', acme: 'ACME', dedicatedHint: '专属证书将在应用创建后保存为证书配置草稿，可在应用设置中补充完整签发参数。', asset: '证书资产', version: '证书版本', latest: '始终使用最新版本', requiredFormat: '该平台需要 {formats} 格式证书', noMatchingAssets: '没有找到与域名“{domain}”匹配的证书资产。' },
    automation: { title: '证书更新自动化', triggerLabel: '触发条件', none: '暂不设置', noneDescription: '先创建应用，稍后在应用设置中配置。', certificateVersionCreated: '证书产生新版本时自动更新', certificateVersionCreatedDescription: '证书库出现新版本后，自动为此应用创建更新任务。', once: '指定时间执行一次', onceDescription: '只执行一次，适合上线前或维护窗口。', schedule: '按固定周期自动更新', scheduleDescription: '每天、每周或每月在指定时间检查并更新。', runAt: '执行时间', onceHint: '时间按当前浏览器的本地时间执行。', frequency: '执行频率', daily: '每天', weekly: '每周', monthly: '每月', scheduleDay: '执行日', scheduleTime: '执行时间', scheduleHint: '时间按当前浏览器的本地时间执行。', monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日', cron: 'Cron 表达式', defaultName: '应用证书自动更新', defaultDescription: '由应用接入向导创建的证书更新自动化。' },
    complete: { title: '接入已完成', description: '请核对前四步设置，确认后创建应用及关联任务。', progressAria: '创建进度', viewSummary: '查看配置摘要', stages: { application: '创建应用', certificate: '关联证书', automation: '创建自动计划' }, status: { pending: '等待中', running: '进行中', success: '已完成', failed: '失败' } },
    actions: { customManual: '传统手动创建', openWizard: '使用接入向导', previous: '上一步', continue: '继续', refresh: '刷新站点', review: '查看摘要', complete: '确认并创建', close: '关闭', cancel: '取消向导' },
    messages: { requestFailed: '接入请求失败，请检查权限和输入。', noPlatforms: '暂无可用业务平台。', noSearchResults: '未找到匹配的平台。' }
  },
  tenantArchitecture: {
    nav: '集团架构', eyebrow: '多租户治理', title: '集团架构', description: '管理集团、子公司及其管理员关系。',
    mode: { aria: '集团架构模式', label: '集团架构模式', hierarchical: '已开启', single: '已关闭', updated: '最近更新：{time}' },
    actions: { checking: '检查中', preflight: '执行预检查', enabling: '启用中', enable: '启用集团架构', rollingBack: '回滚中', rollback: '关闭集团架构', suspend: '停用', resume: '恢复', revokeAdministrator: '撤销管理员' },
    preflight: { title: '启用预检查', summary: '阻断项：{blockers}', passed: { title: '已满足', summary: '{count} 项检查通过' }, blocked: { title: '需要处理', summary: '{count} 项阻断', description: '请先解决以下问题，再重新执行预检查。' } },
    confirm: { enable: '确认启用集团架构？', rollback: '确认关闭集团架构并回滚到单租户模式？', revokeAdministrator: '确认撤销该管理员关系？' },
    messages: { preflightCompleted: '预检查已完成。', enabled: '集团架构已启用。', rolledBack: '已回滚到单租户模式。', companyCreated: '子公司已创建。', administratorAdded: '管理员已配置。', administratorRevoked: '管理员关系已撤销。', statusUpdated: '子公司状态已更新。' },
    errors: { emptyMode: '未返回集团架构状态。', loadFailed: '集团架构加载失败。', preflightFailed: '预检查失败。', enableFailed: '启用集团架构失败。', rollbackFailed: '回滚集团架构失败。', companyCreateFailed: '创建子公司失败。', administratorFailed: '配置管理员失败。', administratorRevokeFailed: '撤销管理员失败。', statusFailed: '更新子公司状态失败。' },
    company: { title: '新增子公司', name: '名称', namePlaceholder: '输入子公司名称', code: '编码', codePlaceholder: '输入唯一编码', submit: '创建子公司' },
    administrator: { title: '配置子公司管理员', tenant: '子公司', tenantPlaceholder: '选择子公司', subjectId: '用户 ID', subjectPlaceholder: '输入用户 ID', submit: '添加管理员', empty: '未配置管理员' },
    tree: { aria: '集团架构图', empty: '当前管理范围内没有可显示的租户。' },
    history: { aria: '最近模式记录', title: '最近模式记录', kind: { PREFLIGHT: '预检查', ENABLE: '启用', ROLLBACK: '回滚' }, status: { RUNNING: '进行中', COMPLETED: '已完成', FAILED: '失败' } },
    types: { GROUP: '集团', COMPANY: '子公司' }, status: { ACTIVE: '正常', SUSPENDED: '已停用' }, membership: { owner: '所有者', admin: '管理员' }
  },
  tenantSwitcher: { title: '切换租户', aria: '可切换租户', current: '当前', switching: '切换中', confirm: '切换到 {tenant}？', success: '已切换到 {tenant}。', errors: { contextStale: '租户上下文已过期，已刷新可用租户，请重新选择。', membershipRequired: '当前用户已不具备目标租户的有效成员关系。', modeConflict: '租户模式正在变更，暂时无法切换。', switchFailed: '租户切换失败，仍保留原租户。' } },
  errors: {
    forbiddenTitle: '403 无权限',
    forbiddenMessage: '你没有访问该页面所需的权限。',
    missingPermission: '缺失权限：{permission}',
    notFoundTitle: '404 页面不存在',
    notFoundMessage: '该页面不存在，请确认访问地址是否正确。',
    backDashboard: '返回仪表盘',
    back: '后退',
    logout: '注销'
  }
} as const
