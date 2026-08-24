import type { SupportedLocale } from './locales'

const zhCN = {
  app: {
    brand: 'GCAC 控制台',
    platform: '企业 SSL 证书生命周期管理平台',
    defaultBreadcrumb: '控制台',
    dashboard: '仪表盘'
  },
  common: {
    refresh: '刷新',
    logout: '退出',
    enter: '进入',
    loading: '加载中',
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
      DISABLED: '已禁用',
      UPGRADING: '升级中',
      UPDATE_REQUIRED: '需更新',
      UP_TO_DATE: '已最新',
      UNKNOWN: '未知'
    },
    risk: {
      LOW: { label: '低', description: '需要关注，但不会直接阻断操作。' },
      MEDIUM: { label: '中', description: '可能影响部署或监控结果，需要确认。' },
      HIGH: { label: '高', description: '可能导致服务中断或安全暴露。' },
      CRITICAL: { label: '严重', description: '必须优先处理，危险操作需二次确认。' }
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
        executionLog: '执行日志'
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
        activity: '执行日志将在任务完成后逐步显示。',
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
        expand: '查看完整日志'
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
        execution: '执行'
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
        executionLog: '执行日志',
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
        backup: '前置备份',
        discover: '环境识别',
        installDryRun: '材料准备',
        installExecution: '证书安装',
        reload: '服务刷新',
        verify: '结果校验'
      },
      subtitle: {
        completed: '任务已完成。',
        failed: '任务已结束，但返回了失败结果。',
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
    deploymentsDesc: '部署计划和执行记录',
    deploymentPlans: '部署计划',
    deploymentPlansDesc: '证书部署计划和审批入口',
    executions: '执行记录',
    executionsDesc: '执行步骤、日志、失败和回滚',
    workflows: '工作流',
    workflowsDesc: '工作流和插件',
    workflowTemplates: '工作流',
    workflowTemplatesDesc: '画布草稿、变量、能力声明和发布',
    plugins: '插件',
    pluginsDesc: 'Provider、执行器和沙箱状态',
    monitoring: '监控',
    monitoringDesc: '告警、审计和证书状态',
    monitorAlerts: '监控告警',
    monitorAlertsDesc: '到期、漂移和执行失败事件',
    audits: '审计日志',
    auditsDesc: '操作证据与合规导出',
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
    title: '插件',
    description: '管理插件包、执行器、权限声明与沙箱隔离状态。',
    resourceName: '插件',
    actions: {
      install: '安装插件',
      detail: '详情',
      disable: '禁用插件',
      disableRisk: '禁用插件会影响 Provider、模板和执行器能力。'
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
      risky: {
        title: '高危待处理',
        description: '高危权限、签名异常或沙箱隔离插件。'
      }
    },
    empty: {
      title: '暂无插件',
      description: '安装前请确认插件权限、签名与回滚策略。'
    },
    detail: {
      title: '插件详情',
      titleWithName: '插件 {name}',
      description: '查看插件详情、权限声明与沙箱隔离信息。',
      versionLabel: '版本 {version}'
    },
    fields: {
      pluginId: '插件 ID',
      name: '插件名称',
      currentStatus: '当前状态',
      version: '版本',
      signatureStatus: '签名状态',
      riskLevel: '风险等级'
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
      commandCopied: '安装命令已复制',
      copyCommand: '复制安装命令',
      copyToken: '复制安装码',
      expired: '已过期',
      generateCommand: '生成安装命令',
      generating: '生成中...',
      modalDescription: '选择平台与版本，生成一次性安装命令。安装码 10 分钟内有效，且只能使用一次。',
      modalTitle: '安装 Agent',
      platform: '平台',
      platformLinuxDescription: '适用于 Ubuntu、Debian、CentOS、Rocky、AlmaLinux 等 Linux 发行版。',
      platformWindowsDescription: '适用于 Windows Server 与 Windows 10/11，安装后注册为系统服务。',
      remainingTime: '{minutes}分 {seconds}秒',
      remainingValidity: '剩余有效期',
      singleUseHint: '同一个安装码一旦被请求 bootstrap 脚本，就会立刻失效，不能重复使用。',
      tokenCopied: '安装码已复制',
      version: '版本',
      versionLatest: '最新稳定版',
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
      activeAgents: { title: '活跃 Agent 数量', description: '当前在线并可调度的 Agent。' },
      activeGateways: { title: '活跃网关数量', description: '当前在线的隔离区网关。' },
      applications: { title: '当前应用数量', description: '已纳管的应用入口资产。' },
      expiringCertificates: { title: '15 天内到期证书', description: '需要安排续期或替换的证书。' },
      managedBindings: { title: '托管绑定数量', description: '已进入托管状态的证书绑定。' },
      validCertificates: { title: '活跃证书数量', description: '状态活跃且尚未过期的证书版本。' }
    },
    quickActions: {
      agents: { title: 'Agent', description: '查看在线状态和任务能力。' },
      assets: { title: '应用资产', description: '维护域名、端口和部署目标。' },
      audits: { title: '审计日志', description: '追踪操作人与执行结果。' },
      certificates: { title: '证书管理', description: '导入、查看和转换证书。' },
      deploymentPlans: { title: '部署计划', description: '创建和执行证书更新计划。' },
      gateways: { title: '网关', description: '管理隔离区执行入口。' }
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
      agents: { title: 'Agent' },
      applicationAssets: { title: '应用资产' },
      certificates: { title: '证书' },
      gateways: { title: '网关' },
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
  settings: {
    securityLabel: '安全设置入口',
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
      page: { title: '权限管理', description: '以角色为中心维护授权对象范围，并把用户或组分配到角色。' },
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
      accessLevel: { read: '只读', edit: '编辑', control: '完全控制' },
      effect: { allow: '允许', deny: '拒绝' },
      principal: { user: '用户', group: '组', externalGroup: '身份源组' },
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
        kind: { all: '全部', category: '分类', record: '记录' }
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
        auth: { name: '认证登录日志', description: '登录、登出、外部身份源登录' },
        security: { name: '安全管理日志', description: '用户、角色、权限、身份源变更' },
        certificate: { name: '证书日志', description: '证书导入、版本、产物与绑定操作' },
        asset: { name: '资产日志', description: '应用资产、主机、服务实例与站点资产操作' },
        gateway: { name: '网关日志', description: '网关路由、探测与状态变更' },
        agent: { name: 'Agent 日志', description: 'Agent 注册、心跳、任务与升级操作' },
        deployment: { name: '更新计划日志', description: '部署计划、执行、回滚与审批' },
        workflow: { name: '工作流日志', description: '工作流模板与执行操作' },
        secret: { name: '密钥日志', description: 'Secret 创建、使用与轮换' },
        system: { name: '系统日志', description: '系统设置与平台级事件' }
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
    actions: { create: '新建配置文件', edit: '编辑', delete: '删除', deleting: '删除中...', applyTemplate: '套用内置模板', saving: '保存中...', confirmSave: '确认保存' },
    columns: { configName: '配置文件名称', targetSummary: '目标环境', displayFormat: '内容格式', extension: '扩展名', encodingSummary: '编码', exportSummary: '包含内容 / 导出选项', actions: '操作' },
    dialog: {
      createTitle: '新建证书格式配置',
      editTitle: '编辑证书格式配置',
      description: '选择系统平台与目标平台后，可套用内置模板并逐项调整导出内容。'
    },
    list: { title: '证书格式配置列表', descriptionWithCount: '可复用的证书格式模板。当前 {count} 条' },
    empty: { text: '暂无证书格式配置' },
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
    formats: { pfx: 'PKCS#12 / PFX 容器', jks: 'JKS 容器', pemBundle: 'PEM 单文件 Bundle', pemCert: 'PEM 证书文件', pemKey: '私钥文件', cer: '证书文件（.cer）', crt: '证书文件（.crt）', p7b: 'PKCS#7 / P7B 证书链', custom: '自定义' },
    sections: {
      templates: { title: '内置模板', description: '模板基于各平台常见 TLS 落地方式预填内容格式、包含内容和导出规则，套用后仍可继续修改。' },
      basic: { title: '基础信息', description: '先定义配置文件身份、真实内容格式，以及最终扩展名。' },
      encoding: { title: '编码选择', description: '仅显示当前内容格式支持的编码选项。' },
      content: { title: '包含内容', description: '定义主产物文件中包含的内容：公钥、证书链、私钥。' },
      export: { title: '导出选项', description: '定义是否额外生成链文件、私钥文件，以及容器专属密码选项。' }
    },
    filters: { keywordPlaceholder: '配置名称 / 目标环境 / Alias / 内容格式' },
    placeholders: { configName: '例如：设备兼容单文件PEM', exportPassword: '请输入 PFX/JKS 导出密码' },
    validation: { selectPlatformsFirst: '请先选择系统平台和目标平台。', configNameRequired: '必须填写配置文件名称', passwordRequired: 'PFX/JKS 配置必须填写导出密码' },
    errors: { loadFailed: '证书格式配置加载失败', saveFailed: '保存证书格式配置失败', deleteFailed: '删除证书格式配置失败', createExportSecretFailed: '创建导出密码 Secret 失败', withCode: '{message}（{code}）' },
    fallbacks: { unnamedConfig: '未命名配置-{index}', unspecified: '未指定', aliasUnset: '未设置 Alias' },
    labels: { aliasWithValue: 'Alias：{alias}', requestId: '请求 ID：{requestId}' },
    encoding: { pkcs12Container: 'PKCS#12 容器', jksContainer: 'JKS 容器', privateKeyWithEncoding: '私钥 {encoding}', pkcs7Chain: 'PKCS#7 证书链', certificateWithEncoding: '证书 {encoding}', default: '默认' },
    export: { leafCertificate: '公钥', certificateChain: '证书链', privateKey: '私钥', extraChainFile: '额外链文件', extraPrivateKeyFile: '额外私钥文件' },
    secret: { defaultConfigName: '证书格式配置', exportPasswordName: '{name} 导出密码' },
    select: { placeholder: '请选择' },
    separators: { export: ' · ' },
    hints: { savedPassword: '已配置导出密码；如需更换，请直接输入新密码覆盖。' },
    templates: {
      windowsIis: { configName: 'Windows-IIS-PKCS12-标准模板', description: 'IIS 使用 PKCS#12/PFX 容器最常见，主产物内直接携带服务器证书、证书链和私钥。' },
      windowsNginx: { configName: 'Windows-NGINX-PEM-标准模板', description: 'NGINX 主流使用 PEM 单文件承载服务器证书与链，再配独立私钥文件。' },
      windowsApache: { configName: 'Windows-Apache-PEM-标准模板', description: 'Apache 通常以 PEM 证书文件和独立私钥交付，链文件额外导出便于兼容不同运维习惯。' },
      windowsTomcat: { configName: 'Windows-Tomcat-PKCS12-标准模板', description: 'Tomcat 以 JKS/PKCS#12 keystore 为主，这里默认使用更通用的 PKCS#12。' },
      windowsOther: { configName: 'Windows-设备兼容单文件PEM模板', description: '兼容部分设备要求：单文件中同时包含公钥证书、证书链与私钥，扩展名可再改成 .crt/.cer。' },
      linuxIis: { configName: 'Linux-IIS-兼容模板', description: '如果最终目标仍是 IIS，最合理的交付物仍然是 PKCS#12/PFX 容器。' },
      linuxNginx: { configName: 'Linux-NGINX-PEM-标准模板', description: 'NGINX 官方配置围绕 PEM 单文件证书链与独立私钥展开。' },
      linuxApache: { configName: 'Linux-Apache-PEM-标准模板', description: 'Apache 常见做法是 PEM 证书文件配独立私钥，链文件额外导出便于拆分部署。' },
      linuxTomcat: { configName: 'Linux-Tomcat-PKCS12-标准模板', description: 'Tomcat 默认建议交付 keystore 容器，这里使用更通用的 PKCS#12。' },
      linuxOther: { configName: 'Linux-设备兼容单文件PEM模板', description: 'Linux 通用设备若接受单文件 PEM，可先用 bundle 形式，再按目标设备调整扩展名与包含内容。' }
    }
  },
  assets: {
    title: '应用资产',
    description: '以域名或 IP 为主对象管理应用入口，聚焦地址、端口、协议、站点与执行定位。',
    resourceName: '应用资产',
    actions: { add: '添加资产', edit: '编辑', detail: '详情', addVariable: '添加变量', delete: '删除', rollbackFromLatestSnapshot: '从最新快照发起回退', rollingBack: '回退中...', saving: '保存中...', creating: '创建中...', saveChanges: '保存修改', confirmCreate: '确认创建' },
    columns: { domain: '访问域名', port: '端口', protocol: '协议', platform: '平台', framework: '框架', site: '站点', status: '状态', actions: '操作' },
    fields: {
      assetId: '应用资产 ID', domain: '访问域名', addressType: '地址类型', port: '端口', protocol: '协议', verifyUrl: '验证 URL', platform: '平台', frameworkType: '框架类型',
      serviceInstanceId: '服务实例 ID', siteId: '站点 ID', managedTargetId: '受管目标 ID', bindingKey: '绑定键', hostId: '宿主机 ID', environment: '环境',
      discoverySource: '发现来源', lastDiscoveredAt: '最后发现时间', tags: '标签', managedTarget: '受管目标', siteName: '站点名称', bindingInformation: '绑定信息', hostHeader: 'Host Header', sniName: 'SNI 名称',
      currentCertificate: '当前证书', targetCertificate: '目标证书', expectedFingerprint: '期望指纹', certificateStore: '证书存储', snapshotType: '快照类型',
      time: '时间', executionRun: '执行记录', displayName: '显示名称', siteInstance: '站点实例', certificateFormat: '证书产物配置', workflow: '工作流',
      publishedVersion: '已发布版本', runner: '运行位置', artifactFormat: '产物格式配置'
    },
    links: { certificateBindings: '查看证书绑定', executions: '查看执行记录' },
    empty: { title: '暂无应用资产', description: '等待系统自动发现，或手动补录应用入口。', noBindingInformation: '未提供绑定信息', notSet: '未设置', notSelected: '未选择', noVariablePreset: '暂无可添加变量', basicEntryIncomplete: '基础入口未完成' },
    detail: {
      title: '应用详情', description: '查看资产详情、绑定关系、部署入口和快照记录。', tabsAriaLabel: '应用详情标签页',
      tabs: { overview: '基础信息', snapshots: '快照' }, loadingTargetBinding: '正在加载目标绑定详情...', loadingSnapshots: '正在加载快照...',
      emptyCertificateBindings: '暂无证书绑定关系。', emptySnapshots: '暂无快照。', rollbackSubmitted: '已提交回退请求，请到“执行记录”查看回退运行。',
      sections: {
        overview: { title: '基础信息', description: '应用资产是主对象，宿主机和站点只作为执行定位信息出现。' },
        targetBinding: { title: '目标绑定', description: '绑定必须明确落到站点和受管目标，而不是继续靠域名猜。' },
        certificateBindings: { title: '证书绑定关系', description: '把证书关系明确到 binding 上，而不是只看域名。' },
        snapshots: { title: '快照', description: '部署前后与回退后的现场状态必须能直接看到，不能只剩任务记录。' }
      }
    },
    managementModes: { agent: 'Agent 模式', agentDescription: '绑定 Agent、站点实例和受管目标', workflow: '工作流模式', workflowDescription: '选择工作流版本和运行变量' },
    loading: { agents: '加载 Agent 中...', sites: '加载站点中...', managedTargets: '加载目标中...', certificateFormats: '加载格式配置中...', workflows: '加载工作流中...', versions: '加载版本中...', gateways: '加载 Gateway 中...', credentials: '加载凭据中...' },
    select: { agent: '请选择 Agent', siteInstance: '请选择站点实例', managedTarget: '请选择受管目标', certificateFormat: '请选择证书产物配置', workflow: '请选择工作流', publishedVersion: '请选择已发布版本', gateway: '请选择 Gateway', variablePreset: '选择预设变量', credential: '请选择凭据', generic: '请选择', artifactFormat: '请选择格式配置', output: '请选择输出项', optionalOutput: '可不选择' },
    validation: {
      variableNameRequired: '变量名称不能为空', variableNameInvalid: '变量 {name} 名称不合法', variableDuplicated: '变量 {name} 重复', variableRequired: '变量 {name} 必填',
      variableMustBeNumber: '变量 {name} 必须是数字', variableMustBeJsonObject: '变量 {name} 必须是 JSON 对象', variableInvalidJson: '变量 {name} 不是合法 JSON',
      variableCredentialInvalid: '变量 {name} 必须选择有效凭据', certificateFormatRequired: '证书变量 {name} 必须选择证书格式配置',
      certificateOutputRequired: '证书变量 {name}.{slot} 必须选择输出项', certificateOutputMissing: '证书变量 {name}.{slot} 选择的输出项不存在'
    },
    workflowVariableTypes: { string: '字符串', number: '数字', boolean: '布尔', enum: '枚举', object: '对象', file: '文件', credential: '凭据', certificate: '证书' },
    wizard: {
      ariaLabel: '应用资产创建步骤',
      steps: { basicEntry: '基础入口', deploymentMode: '部署模式', confirmSave: '确认保存' },
      stepState: { active: '进行中', done: '已完成', pending: '待开始', incomplete: '待完成', readyNext: '可进入下一步', pendingSubmit: '等待提交' },
      panels: {
        basicEntryTitle: '基础入口', basicEntryDescription: '先填写域名、端口、协议和平台，用它们确定应用入口身份。',
        agentTitle: 'Agent 目标绑定', agentDescription: '选择 Agent、站点实例、受管目标和证书产物配置。',
        workflowTitle: '工作流运行配置', workflowDescription: '选择工作流版本、运行位置和变量，证书变量会在运行时注入。',
        confirmTitle: '确认保存', confirmDescription: '检查应用入口、部署模式和运行参数，确认后写入应用资产。'
      }
    },
    form: {
      createTitle: '手动添加应用资产', editTitle: '编辑应用资产',
      createDescription: '创建应用入口并绑定后续部署需要的目标信息。', editDescription: '修改应用入口和部署目标绑定。',
      createRequestCompleted: '创建请求已完成。', editRequestCompleted: '保存请求已完成。',
      agentCertificateFormatHint: 'Agent 模式下会使用该证书产物配置生成部署材料。',
      placeholders: { displayName: '例如：生产站点入口', verifyUrl: '例如：https://example.com/health', siteName: '例如：生产站点', bindingInformation: '例如：*:443:example.com', hostHeader: '例如：example.com', sniName: '例如：example.com' }
    },
    review: { accessEntry: '访问入口', deploymentMode: '部署模式', agentSiteTarget: 'Agent / 站点 / 目标', workflowVersion: '工作流版本', gatewayRunner: 'Gateway：{gateway}', variableCount: '{count} 个变量', onlyBasicEntry: '仅基础入口', autoGeneratedByEntry: '按应用入口生成' },
    workflowTarget: { title: '工作流目标信息', description: '用于工作流资产展示、部署后探测和 DSL 目标变量同步。', dslSyncHint: '已同步到 DSL 目标变量' },
    workflowVariables: {
      title: '工作流变量', configuredCount: '已配置 {configured}/{total}', name: '变量名称', type: '类型', value: '值', manual: '手动',
      empty: '暂无工作流变量。', noPublishedVersion: '请选择已发布工作流版本后配置变量。', certificateAutoInjected: '证书版本由部署计划选择，运行时自动注入。',
      certificateDescription: '证书版本由部署计划选择，应用资产在下方绑定格式配置和输出项，运行时注入 {name}.outputs.*.content。',
      presets: {
        deviceHost: '目标主机或设备地址', sshUsername: 'SSH 用户名', credential: '工作流凭据', certificate: '证书产物', targetPlatform: '目标平台',
        verifyHost: '验证主机', verifyPort: '验证端口', verifyPath: '验证路径', apacheServiceName: 'Apache systemd 服务名',
        apacheSiteConfigPath: 'Apache 站点配置路径', certificateFilePath: '证书目的路径', certificateKeyFilePath: '私钥目的路径',
        backupRoot: '证书备份根目录', expectedResponseContains: '验证响应包含文本', virtualHostServerName: '虚拟主机 ServerName'
      }
    },
    certificateBindings: { title: '证书变量绑定', description: '为工作流中的证书变量选择证书产物配置和输出项。', variableCount: '{count} 个证书变量', defaultVariableDescription: '证书产物变量', noArtifactOutputs: '当前格式配置暂无可选输出项。' },
    certificateOutputs: { publicCertificateWithChain: '公钥证书+证书链', publicCertificate: '公钥证书', certificateChain: '证书链', privateKey: '私钥', pemBundle: 'PEM 合并产物', container: '{format} 容器', bundle: 'Bundle' },
    certificateFormats: { savedConfigMissingWithId: '{id}（已保存配置，当前列表未返回）', withPrivateKey: '含私钥', withoutPrivateKey: '无私钥' },
    snapshotTypes: { preDeploy: '部署前', postDeploy: '部署后', postRollback: '回退后', errorState: '错误态', rollbackPoint: '回退点' },
    errors: { loadWorkflowListFailed: '加载工作流列表失败', loadWorkflowVersionsFailed: '加载工作流版本失败', loadGatewayListFailed: '加载网关列表失败', loadCertificateFormatsFailed: '加载证书格式配置失败', loadAssetDetailFailed: '加载应用资产详情失败', rollbackFailed: '发起回退失败', loadTargetsFailed: '加载站点和受管目标失败', createAssetFailed: '创建应用资产失败', loadWorkflowCredentialsFailed: '加载工作流凭据失败', noAvailableSiteInstance: '未找到可用的站点实例，请先确认 Agent 详情中的框架站点已成功上报。' },
    platforms: { appliance: '设备' },
    runners: { controlPlane: '平台' },
    status: { archived: '已归档', unknownStatus: '未知状态' },
    common: { required: '必填', optional: '可选' }
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
        http: { description: '调用结构化 HTTP 接口，取代分散的 curl 命令。' },
        ssh: { displayName: 'SSH 命令', description: '声明要执行的 SSH 命令，只保存连接和凭据引用。' },
        sftp: { displayName: 'SFTP 上传/下载', description: '通过正式 SFTP step 上传或下载文件，适合证书与配置安装。' },
        scp: { displayName: 'SCP 上传/下载', description: '通过 SCP 复制文件，适合简单主机文件分发。' },
        verify: { displayName: '验证', description: '对 HTTP 状态、文本、正则或证书指纹做断言。' },
        condition: { displayName: '分支判断', description: '根据变量存在性或值决定后续路径。' },
        transform: { displayName: '数据转换', description: '使用 JSONata 把上游输出转换为新的工作流上下文变量。' },
        wait: { displayName: '等待', description: '等待固定秒数后继续执行。' },
        manual: { displayName: '人工确认', description: '暂停工作流，等待人工确认后继续。' }
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
        outputFormat: '输出格式',
        usernameVariable: '用户名变量',
        variable: '变量',
        verifyType: '验证类型'
      },
      options: {
        direction: { download: '下载', upload: '上传' },
        hostKeyPolicy: { manualApproval: '人工审批', strict: '严格校验', trustOnFirstUse: '首次信任' },
        operator: { equals: '等于', exists: '存在', notEquals: '不等于', notExists: '不存在' },
        transformFormat: { raw: '原始值', jsonString: 'JSON 字符串' },
        verifyType: { certificateFingerprint: '证书指纹', httpStatus: 'HTTP 状态', regex: '正则匹配', textContains: '文本包含' }
      },
      stages: {
        backup: { title: '备份', description: '保留可回滚材料。' },
        install: { title: '安装', description: '部署证书或配置。' },
        prepare: { title: '准备', description: '准备连接、变量和材料。' },
        refresh: { title: '刷新', description: '重载服务或刷新目标。' },
        verify: { title: '验证', description: '确认结果符合预期。' }
      },
      defaults: {
        displayName: '{name} 工作流',
        nodes: {
          backupExistingCertificate: '备份现有证书',
          reloadService: '重载服务'
        },
        variables: {
          certificatePaths: { description: '目标证书路径配置' },
          credential: { description: '连接凭据' },
          deviceHost: { description: '目标主机' },
          serverCert: {
            description: '待部署服务器证书材料',
            outputs: {
              certFile: { description: '服务器证书文件' },
              keyFile: { description: '私钥文件' }
            }
          },
          sshUsername: { description: 'SSH 登录用户名' },
          verifyUrl: { description: '部署后验证地址' }
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
      tabs: { summary: '概览', versions: '版本' },
      versionStatuses: { disabled: '已禁用', draft: '草稿', published: '已发布' },
      detail: {
        description: '查看工作流详情、画布草稿与版本清单。',
        publishedVersion: '当前发布版本 {version}',
        title: '工作流详情',
        titleWithName: '工作流 {name}'
      },
      versionManager: {
        description: '管理工作流版本的新建与发布，不涉及画布内容的修改。',
        titleWithName: '版本管理：{name}'
      },
      changeSummaries: {
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
        sources: { builtin: '内置', userImported: '用户导入' },
        errors: {
          actionFailed: '执行文件模板动作失败',
          loadFailed: '加载工作流文件模板失败',
          missingApplyTarget: '缺少待覆盖的工作流目标'
        }
      },
      credentials: {
        actions: { create: '创建凭据' },
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
          common: { family: '通用' },
          sshKey: { title: 'SSH 私钥' },
          usernamePassword: { title: '用户名 + 密码' }
        },
        secretLabels: { password: '密码', sshKey: 'SSH 私钥' },
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
  errors: {
    forbiddenTitle: '403 无权限',
    forbiddenMessage: '你没有访问该页面所需的权限。',
    missingPermission: '缺失权限：{permission}',
    notFoundTitle: '404 页面不存在',
    notFoundMessage: '该页面不存在，请确认访问地址是否正确。',
    backDashboard: '返回仪表盘'
  }
}

const zhTW = {
  ...zhCN,
  app: { ...zhCN.app, brand: 'GCAC 控制台', platform: '企業 SSL 憑證生命週期管理平台', defaultBreadcrumb: '控制台', dashboard: '儀表板' },
  common: { ...zhCN.common, refresh: '重新整理', logout: '登出', enter: '進入', userFallback: '未登入使用者', tenantFallback: '預設租戶' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: '確認{action}', impactCount: '影響資源數量：{count}', defaultRisk: '此操作可能觸發部署、重試、回滾或不可逆變更。', typeToConfirm: '輸入 {text} 二次確認', cancel: '取消', confirm: '確認' },
    dataTable: { empty: '暫無資料', loading: '載入中...' },
    dryRunChecklist: { title: 'Dry-run 預檢結論', ariaLabel: 'dry-run 預檢結論', empty: '尚未產生 dry-run 預檢結果。', unnamedCheck: '未命名檢查項' },
    dryRunResult: { title: 'Dry-run 執行結果', close: '關閉' },
    modal: { closeAria: '關閉模態框' },
    secretInput: { label: 'Secret 參照', placeholder: '選擇或輸入 SecretRef，不儲存明文', hint: '敏感欄位只儲存參照，不在瀏覽器長期明文保存。' },
    riskBadge: { levelPrefix: '級別：' },
    status: { DRAFT: '草稿', PUBLISHED: '已發布', PENDING_APPROVAL: '待審批', READY: '待執行', RUNNING: '執行中', SUCCESS: '成功', PARTIAL_SUCCESS: '部分成功', FAILED: '失敗', CANCELLED: '已取消', ROLLED_BACK: '已回滾', DISCOVERED: '已發現', MANAGED: '已納管', DRIFTED: '已漂移', EXPIRED: '已過期', ERROR: '異常', IGNORED: '已忽略', ONLINE: '線上', OFFLINE: '離線', DISABLED: '已停用', UPGRADING: '升級中', UPDATE_REQUIRED: '需更新', UP_TO_DATE: '已是最新', UNKNOWN: '未知' },
    risk: { LOW: { label: '低', description: '需要關注，但不會直接阻斷操作。' }, MEDIUM: { label: '中', description: '可能影響部署或監控結果，需要確認。' }, HIGH: { label: '高', description: '可能導致服務中斷或安全暴露。' }, CRITICAL: { label: '嚴重', description: '必須優先處理，危險操作需二次確認。' } },
    capability: { available: '具備', missing: '缺失', title: '能力相容性', description: '只顯示後端 capability 介面可確認的結果；未知項不會假裝成功。', matrixLabel: '能力相容性矩陣', satisfied: '滿足', unknown: '未知', manualRisk: '人工確認', empty: '暫無 capability 資料，前端保持降級顯示。' },
    executionProgress: {
      ...zhCN.designSystem.executionProgress,
      aria: { progressOverview: '執行進度總覽', taskList: '任務列表', latestEvents: '最新事件', executionLog: '執行日誌' },
      checklist: { title: '檢查結論' },
      detail: { stepsCompleted: '{completed}/{total} 步驟已完成', summaryFailed: '{total} 項檢查結果已返回，{failed} 項失敗', summaryPassed: '{passed} 項檢查全部通過', summaryReturned: '{total} 項檢查結果已返回', summaryWarning: '{total} 項檢查結果已返回，{warning} 項警告', waitingStart: '等待任務開始執行', waitingSteps: '等待後端返回執行步驟' },
      empty: { activity: '等待任務完成後逐條寫入執行日誌。', events: '還沒有事件回傳。', tasks: '任務尚未建立，等待後端返回執行步驟。' },
      event: { collapse: '收起事件', defaultLabel: '事件', defaultTitle: '任務事件', expand: '展開事件', waitingDetail: '等待事件回傳' },
      feed: { completed: '執行完成', failed: '執行失敗', warning: '完成，帶警告' },
      loading: { pollingFallback: '自動重新整理兜底中', refreshing: '重新整理中' },
      log: { collapse: '收起完整日誌', expand: '查看完整日誌' },
      metrics: { completed: '已完成', failed: '失敗', passed: '通過', queued: '排隊中', running: '執行中', totalTasks: '總任務', unknown: '未知', warning: '警告' },
      process: { execution: '執行' },
      progress: { completed: '全部完成', failed: '已完成，存在失敗項', pending: '等待結果回寫', processFailed: '{process}失敗', queued: '等待調度', running: '任務推進中', warning: '已完成，存在風險提示' },
      section: { completedCount: '{completed}/{total} 已完成', executionLog: '執行日誌', latestEvents: '最新事件', taskProgress: '任務進度' },
      status: { completed: '已完成', failed: '失敗', queued: '等待中', running: '執行中', warning: '有警告' },
      step: { backup: '前置備份', discover: '環境識別', installDryRun: '材料載入', installExecution: '憑證安裝', reload: '服務重新整理', verify: '結果校驗' },
      subtitle: { completed: '任務已完成。', failed: '任務已結束，但返回了失敗結果。', failedChecks: '{total} 項檢查，{failed} 項失敗', passedChecks: '{total} 項檢查通過', queued: '任務已建立，等待執行。', running: '任務已開始，等待後續結果回傳。', runningChecks: '已回傳 {total} 項檢查', warningChecks: '{total} 項檢查，{warning} 項警告' },
      time: { waitingStart: '等待開始' }
    },
    deploymentWizard: zhCN.designSystem.deploymentWizard
  },
  shell: { currentLocation: '目前位置', breadcrumb: '麵包屑', currentGroupNavigation: '目前分組導航', backDashboard: '返回儀表板' },
  preferences: { ...zhCN.preferences, theme: '主題', language: '語言', themeLight: '日間模式', themeDark: '夜間模式', title: '顯示偏好', description: '主題和語言會儲存到目前使用者的後端偏好。' },
  userMenu: { ...zhCN.userMenu, currentUser: '目前使用者', changePassword: '修改密碼', logout: '登出' },
  password: { ...zhCN.password, title: '修改密碼', description: '修改目前登入使用者的本機密碼。', current: '目前密碼', new: '新密碼', confirm: '確認新密碼', submit: '儲存密碼', success: '密碼已更新', failed: '密碼修改失敗', mismatch: '兩次輸入的新密碼不一致' },
  routes: { certificateImport: '匯入憑證', certificateDetail: '憑證詳情', certificateUsages: '使用關係', certificateFormats: '格式產物' },
  businessPage: {
    request: {
      notRequested: '尚未請求'
    },
    error: {
      unknown: '未知錯誤'
    },
    primaryActionFailed: '主操作執行失敗',
    processing: '處理中…',
    metricsAria: '業務指標',
    apiFailed: '介面呼叫失敗',
    errorCode: '錯誤碼：{code}',
    retry: '重試',
    resourceList: '{resource}列表',
    total: '總數 {count}',
    dangerConfirmRequired: '高危操作需確認',
    all: '全部',
    clearFilters: '清空篩選',
    pagination: '第 {page} 頁 / 每頁 {pageSize} 條',
    resourceDetailAria: '資源詳情',
    resourceDetailTitle: '{resource}詳情',
    contextAria: '上下文入口',
    resourceActionsAria: '資源操作',
    resourceActionsTitle: '資源操作',
    resourceActionsHint: '高危動作必須二次確認，授權仍以後端校驗為準。'
  },
  errors: { ...zhCN.errors, forbiddenTitle: '403 無權限', forbiddenMessage: '你沒有存取該頁面所需的權限。', missingPermission: '缺少權限：{permission}', notFoundTitle: '404 頁面不存在', notFoundMessage: '這個路由尚未註冊。不要在頁面裡硬跳未定義路徑。', backDashboard: '返回儀表板' }
}

const enUS = {
  ...zhCN,
  app: { brand: 'GCAC Console', platform: 'Enterprise SSL Certificate Lifecycle Platform', defaultBreadcrumb: 'Console', dashboard: 'Dashboard' },
  common: { refresh: 'Refresh', logout: 'Sign out', enter: 'Open', loading: 'Loading', userFallback: 'Guest user', tenantFallback: 'Default tenant' },
  api: {
    errors: {
      requestFailed: 'Request failed'
    }
  },
  auth: {
    errors: {
      missingSession: 'The login API did not return a session'
    },
    mock: {
      displayName: 'Frontend skeleton user'
    }
  },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: 'Confirm {action}', impactCount: 'Affected resources: {count}', defaultRisk: 'This operation may trigger deployment, retry, rollback, or irreversible changes.', typeToConfirm: 'Type {text} to confirm', cancel: 'Cancel', confirm: 'Confirm' },
    dataTable: { empty: 'No data', loading: 'Loading...' },
    dryRunChecklist: { title: 'Dry-run precheck results', ariaLabel: 'dry-run precheck results', empty: 'No dry-run precheck results have been generated.', unnamedCheck: 'Unnamed check' },
    dryRunResult: { title: 'Dry-run execution result', close: 'Close' },
    modal: { closeAria: 'Close modal' },
    secretInput: { label: 'Secret reference', placeholder: 'Select or enter a SecretRef. Plain text is not saved.', hint: 'Sensitive fields only store references and are not kept as long-lived plain text in the browser.' },
    riskBadge: { levelPrefix: 'Level: ' },
    status: { DRAFT: 'Draft', PUBLISHED: 'Published', PENDING_APPROVAL: 'Pending approval', READY: 'Ready', RUNNING: 'Running', SUCCESS: 'Success', PARTIAL_SUCCESS: 'Partial success', FAILED: 'Failed', CANCELLED: 'Cancelled', ROLLED_BACK: 'Rolled back', DISCOVERED: 'Discovered', MANAGED: 'Managed', DRIFTED: 'Drifted', EXPIRED: 'Expired', ERROR: 'Error', IGNORED: 'Ignored', ONLINE: 'Online', OFFLINE: 'Offline', DISABLED: 'Disabled', UPGRADING: 'Upgrading', UPDATE_REQUIRED: 'Update required', UP_TO_DATE: 'Up to date', UNKNOWN: 'Unknown' },
    risk: { LOW: { label: 'Low', description: 'Needs attention, but does not directly block the operation.' }, MEDIUM: { label: 'Medium', description: 'May affect deployment or monitoring results and needs confirmation.' }, HIGH: { label: 'High', description: 'May cause service interruption or security exposure.' }, CRITICAL: { label: 'Critical', description: 'Must be handled first. Risky operations require secondary confirmation.' } },
    capability: { available: 'Available', missing: 'Missing', title: 'Capability compatibility', description: 'Only backend-confirmed capability results are shown; unknown items are not treated as successful.', matrixLabel: 'Capability compatibility matrix', satisfied: 'Satisfied', unknown: 'Unknown', manualRisk: 'Manual review', empty: 'No capability data. The frontend keeps a degraded display.' },
    executionLogViewer: {
      mode: {
        realtime: 'Live updates',
        autoRefresh: 'Auto refresh'
      },
      search: {
        placeholder: 'Search log content'
      },
      level: {
        aria: 'Log level',
        all: 'All'
      },
      hint: {
        streaming: 'Task status and logs will update live.',
        autoRefresh: 'Task status and logs will refresh automatically.',
        pollingFallback: 'Currently using polling fallback.'
      },
      steps: {
        aria: 'Execution steps',
        emptyDetail: 'No step description yet'
      },
      empty: {
        logs: 'No logs yet.'
      }
    },
    executionProgress: {
      aria: { progressOverview: 'Execution progress overview', taskList: 'Task list', latestEvents: 'Latest events', executionLog: 'Execution log' },
      checklist: { title: 'Check results' },
      detail: { stepsCompleted: '{completed}/{total} steps completed', summaryFailed: '{total} check results returned, {failed} failed', summaryPassed: 'All {passed} checks passed', summaryReturned: '{total} check results returned', summaryWarning: '{total} check results returned, {warning} warnings', waitingStart: 'Waiting for the task to start', waitingSteps: 'Waiting for execution steps from the backend' },
      empty: { activity: 'Execution log entries will appear after the task completes.', events: 'No events have been returned yet.', tasks: 'The task has not been created yet. Waiting for execution steps from the backend.' },
      event: { collapse: 'Collapse events', defaultLabel: 'Event', defaultTitle: 'Task event', expand: 'Expand events', waitingDetail: 'Waiting for event data' },
      feed: { completed: 'Execution completed', failed: 'Execution failed', warning: 'Completed with warnings' },
      loading: { pollingFallback: 'Auto-refresh fallback active', refreshing: 'Refreshing' },
      log: { collapse: 'Collapse full log', expand: 'View full log' },
      metrics: { completed: 'Completed', failed: 'Failed', passed: 'Passed', queued: 'Queued', running: 'Running', totalTasks: 'Total tasks', unknown: 'Unknown', warning: 'Warnings' },
      process: { execution: 'Execution' },
      progress: { completed: 'All complete', failed: 'Completed with failed items', pending: 'Waiting for result writeback', processFailed: '{process} failed', queued: 'Waiting for scheduling', running: 'Task in progress', warning: 'Completed with risk warnings' },
      section: { completedCount: '{completed}/{total} completed', executionLog: 'Execution log', latestEvents: 'Latest events', taskProgress: 'Task progress' },
      status: { completed: 'Completed', failed: 'Failed', queued: 'Waiting', running: 'Running', warning: 'Warning' },
      step: { backup: 'Pre-backup', discover: 'Environment discovery', installDryRun: 'Material loading', installExecution: 'Certificate installation', reload: 'Service reload', verify: 'Result verification' },
      subtitle: { completed: 'The task has completed.', failed: 'The task ended with a failed result.', failedChecks: '{total} checks, {failed} failed', passedChecks: '{total} checks passed', queued: 'The task has been created and is waiting to run.', running: 'The task has started. Waiting for more results.', runningChecks: '{total} checks returned', warningChecks: '{total} checks, {warning} warnings' },
      time: { waitingStart: 'Waiting to start' }
    },
    deploymentWizard: {
      actions: {
        cancel: 'Cancel',
        dryRun: 'Run dry-run first',
        next: 'Next',
        previous: 'Previous',
        save: 'Save plan'
      },
      aria: {
        steps: 'Deployment steps',
        wizard: 'Deployment wizard'
      },
      capability: {
        targetMissingDetail: 'No deployment target selected.',
        targetSelectedDetail: 'Deployment target selected. Run a dry-run before submitting.',
        targetSelection: 'Deployment target selection',
        targetSource: 'Deployment target'
      },
      checks: {
        failed: 'Failed {count}',
        passed: 'Passed {count}',
        unknown: 'Unknown {count}',
        unnamed: 'Unnamed check',
        warning: 'Warning {count}'
      },
      empty: {
        noTargets: 'No application asset targets available',
        selectTarget: 'Select an application asset deployment target.'
      },
      fallback: {
        generatedByApplicationEntry: 'Generated from application entry',
        missingBinding: 'Binding information not provided',
        unboundCertificateVariable: 'Certificate variable not bound',
        unconfigured: 'Not configured',
        unconfiguredRunner: 'Runner not configured',
        unknownEnd: 'Unknown end',
        unknownStart: 'Unknown start',
        unnamedSite: 'Unnamed site',
        unnamedVersion: 'Unnamed version',
        unrecognizedManagedTarget: 'Unrecognized managed target',
        unselected: 'Not selected',
        unselectedVersion: 'Version not selected',
        unselectedWorkflow: 'Workflow not selected'
      },
      fields: {
        applicationTarget: 'Application asset deployment target',
        artifactConfig: 'Artifact config',
        binding: 'Binding',
        certificateAsset: 'Certificate asset',
        certificateVariable: 'Certificate variable',
        certificateVersion: 'Certificate version',
        deploymentTarget: 'Deployment target',
        keyword: 'Keyword search',
        managedTarget: 'Managed target',
        runner: 'Runner',
        site: 'Site',
        verifyUrl: 'Verify URL',
        version: 'Version',
        workflow: 'Workflow'
      },
      panels: {
        certificateTitle: '1. Certificate material',
        submitTitle: '3. Precheck and submit',
        targetTitle: '2. Deployment target'
      },
      panelState: {
        needPrerequisites: 'Prerequisites required',
        operable: 'Ready',
        pending: 'Pending',
        readyNext: 'Ready for next step'
      },
      placeholders: {
        selectTarget: 'Select application asset target',
        targetKeyword: 'Search by domain, site, or binding information'
      },
      plan: {
        dryRunCompleted: 'The latest dry-run has completed.',
        submitCompleted: 'The latest submit has completed.'
      },
      preview: {
        needCertificate: 'Select certificate material first.',
        needTarget: 'After selecting certificate material, choose application asset targets.',
        ready: 'The selected certificate version will be deployed to {count} application asset targets.'
      },
      status: {
        checksReturned: 'Precheck results returned. Decide whether to save, submit, or execute.',
        current: 'Current status',
        default: 'Run a dry-run before deciding whether to submit.',
        dryRunStarted: 'Dry-run started. Check progress in the execution result panel.',
        submitted: 'Plan submitted.'
      },
      steps: {
        certificate: {
          description: 'Certificate asset and version',
          title: 'Select certificate material'
        },
        submit: {
          description: 'Dry-run, save, submit, execute',
          title: 'Precheck and submit'
        },
        target: {
          description: 'Application asset, site, and binding',
          title: 'Select deployment target'
        }
      },
      stepState: {
        active: 'In progress',
        done: 'Done',
        pending: 'Pending'
      },
      target: {
        workflowMode: 'Workflow mode'
      },
      version: {
        autoLatest: 'Always select the latest deployable certificate automatically (current: {current})',
        noDeployableVersion: 'No deployable certificate version available',
        range: '{id} ({notBefore} ~ {notAfter})'
      },
      currentStep: 'Step {current} / {total}',
      selectedTargetCount: '{count} targets selected',
      subtitle: 'Configure the deployment plan step by step',
      title: 'Deployment wizard'
    }
  },
  shell: { currentLocation: 'Current location', breadcrumb: 'Breadcrumb', currentGroupNavigation: 'Current group navigation', backDashboard: 'Back to dashboard' },
  preferences: { theme: 'Theme', language: 'Language', themeLight: 'Light', themeDark: 'Dark', themeToggle: 'Switch theme', languageSelect: 'Select language', title: 'Display preferences', description: 'Theme and language are saved to your backend user preferences.', errors: { loadFailed: 'Failed to load preferences', saveFailed: 'Failed to save preferences' } },
  userMenu: { currentUser: 'Current user', changePassword: 'Change password', logout: 'Sign out' },
  password: { title: 'Change password', description: 'Change the local password for the signed-in user.', current: 'Current password', new: 'New password', confirm: 'Confirm new password', cancel: 'Cancel', submit: 'Save password', submitting: 'Saving…', success: 'Password updated', failed: 'Password change failed', mismatch: 'The new passwords do not match', tooShort: 'The new password must be at least 8 characters' },
  nav: {
    dashboard: 'Overview',
    dashboardDesc: 'Overview of applications, certificates, agents, gateways, and audit status',
    certificates: 'Certificates',
    certificatesDesc: 'Certificate library, bindings, and expiry status',
    certificateAssets: 'Certificate assets',
    certificateAssetsDesc: 'Certificates, private key references, fingerprints, and expiry times',
    certificateFormats: 'Certificate format config',
    certificateFormatsDesc: 'Define PFX, CER, CRT, PEM, and other format rules for saved certificates',
    assets: 'Application assets',
    assetsDesc: 'Application entry points and certificate deployment targets by domain/IP',
    agents: 'Agents',
    agentsDesc: 'Online status, heartbeat, and capability set',
    gateways: 'Gateways',
    gatewaysDesc: 'Gateway, protocol, and reachable target status for isolated zones',
    deployments: 'Certificate deployment',
    deploymentsDesc: 'Deployment plans and execution records',
    deploymentPlans: 'Deployment plans',
    deploymentPlansDesc: 'Certificate deployment plans and approval entry points',
    executions: 'Execution records',
    executionsDesc: 'Execution steps, logs, failures, and rollback',
    workflows: 'Workflows',
    workflowsDesc: 'Workflows and plugins',
    workflowTemplates: 'Workflows',
    workflowTemplatesDesc: 'Canvas drafts, variables, capability declarations, and publishing',
    plugins: 'Plugins',
    pluginsDesc: 'Provider, executor, and sandbox status',
    monitoring: 'Monitoring',
    monitoringDesc: 'Alerts, audit, and certificate status',
    monitorAlerts: 'Monitor alerts',
    monitorAlertsDesc: 'Expiry, drift, and execution failure events',
    audits: 'Audit logs',
    auditsDesc: 'Operation evidence and compliance exports',
    settings: 'Settings',
    settingsDesc: 'Tenants, users, permissions, and system configuration',
    systemSettings: 'System settings',
    systemSettingsDesc: 'System configuration and security metadata',
    users: 'Users',
    usersDesc: 'Console users, status, and roles',
    roles: 'Roles',
    rolesDesc: 'Roles, authorization object scopes, and member assignments',
    identitySources: 'Identity sources',
    identitySourcesDesc: 'AD/LDAP service configuration',
    groupRoleMappings: 'Group role mappings'
  },
  login: {
    visualLabel: 'Product overview',
    brand: 'GCAC Certificate Console',
    brandSecondary: 'Centralized certificate management platform',
    headlinePrefix: 'Certificate ',
    headlineHighlight: 'lifecycle',
    headlineSuffix: ' control center',
    intro: 'Manage certificate assets, deployment targets, and execution records in one verifiable workflow for import, renewal, rollout, audit, and rollback.',
    capabilitiesLabel: 'Platform capabilities',
    featureLifecycle: 'Lifecycle management',
    featureLifecycleDesc: 'Track import, renewal, versions, and expiry warnings across every certificate asset.',
    featureAutomation: 'Deployment orchestration',
    featureAutomationDesc: 'Generate auditable deployment plans for Nginx, Tomcat, IIS, and other common environments.',
    featureRollback: 'Safe execution and rollback',
    featureRollbackDesc: 'Validate before rollout, record every step, and roll back failed changes.',
    formLabel: 'Sign-in form',
    secure: 'Secure session',
    welcome: 'Sign in to console',
    hint: 'Use your enterprise account to access the GCAC workspace',
    username: 'Username',
    usernamePlaceholder: 'Enter username',
    password: 'Password',
    passwordPlaceholder: 'Enter password',
    failed: 'Sign-in failed. Try again later.',
    submitting: 'Verifying identity…',
    submit: 'Sign in',
    policy: 'RBAC protected',
    audit: 'Full audit trail'
  },
  routes: { certificateImport: 'Import certificate', certificateDetail: 'Certificate detail', certificateUsages: 'Usages', certificateFormats: 'Format artifacts' },
  businessPage: {
    request: {
      notRequested: 'No request yet'
    },
    error: {
      unknown: 'Unknown error'
    },
    primaryActionFailed: 'Primary action failed',
    processing: 'Processing…',
    metricsAria: 'Business metrics',
    apiFailed: 'API request failed',
    errorCode: 'Error code: {code}',
    retry: 'Retry',
    resourceList: '{resource} list',
    total: 'Total {count}',
    dangerConfirmRequired: 'High-risk action requires confirmation',
    all: 'All',
    clearFilters: 'Clear filters',
    pagination: 'Page {page} / {pageSize} per page',
    resourceDetailAria: 'Resource details',
    resourceDetailTitle: '{resource} details',
    contextAria: 'Context links',
    resourceActionsAria: 'Resource actions',
    resourceActionsTitle: 'Resource actions',
    resourceActionsHint: 'High-risk actions require secondary confirmation; authorization is still enforced by the backend.'
  },
  executionDetail: {
    error: {
      loadStepsFailed: 'Failed to query execution steps',
      streamConnectFailed: 'Failed to connect to the execution detail stream'
    },
    step: {
      nameFallback: 'Step {index}',
      dryRunCheckSummary: 'Precheck result: passed {passed} / warnings {warning} / failed {failed} / unknown {unknown}. {topChecks}',
      dryRunPending: {
        queued: 'Still queued and not started yet.',
        running: 'This step is running. Waiting for the agent to return a result.',
        failed: 'This step failed and no structured precheck result has been received yet.',
        finished: 'This step has ended, but no structured precheck result has been received yet.'
      },
      dryRunDiscover: 'Read-only precheck: discovered deployment target and {providerLabel} site context. Site {siteName}, binding {binding}. {pendingText}',
      dryRunVerify: 'Read-only precheck: validated certificate material, target binding, and domain match. Target {providerLabel} binding {binding}. {pendingText}',
      dryRunCreated: 'Read-only precheck has been created. {pendingText}',
      failure: {
        emptyMessage: 'The backend did not receive a concrete error message'
      },
      running: {
        dispatched: 'Agent task taskId={taskId} has been dispatched. Waiting for the agent result.',
        waitingAgentResult: 'The step is running, but no Agent taskId or result has been received yet.'
      },
      pending: {
        waitingDependency: 'The step is waiting for previous steps to finish.'
      },
      verifyRecovered: {
        detail: 'Agent-side remote TLS probing failed, but the control plane completed real TLS verification for {remoteTarget} and confirmed the target certificate matches. {originalError}',
        originalSuffix: 'Original Agent error: {originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} returned. Agent taskId={taskId}',
        withoutTask: '{executor} {mode} returned.'
      },
      createdFallback: 'Step {index} has been created. Waiting for the backend to add details'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run failed',
        detail: '{failedStepCount} precheck steps failed or timed out, and the agent did not return a structured conclusion.'
      },
      queued: {
        label: 'Dry-run queued',
        detail: 'The precheck task has been created and is waiting to start.'
      },
      running: {
        label: 'Dry-run running',
        detail: 'The precheck has started. Waiting for structured results.'
      },
      pending: {
        label: 'Dry-run ended without conclusion',
        detail: '{finishedWithoutChecks} steps have ended, but no dryRunChecks / dryRunSummary was returned.'
      },
      receiving: {
        label: 'Dry-run receiving results',
        detail: 'Partial conclusions received: passed {passed}, warnings {warning}, failed {failed}, unknown {unknown}.'
      },
      failed: {
        label: 'Dry-run failed',
        detail: 'Precheck failed {failed} items, warning {warning} items, passed {passed} items.'
      },
      warning: {
        label: 'Dry-run has risk warnings',
        detail: 'Precheck completed: passed {passed}, warnings {warning}, unknown {unknown}.'
      },
      passed: {
        label: 'Dry-run passed',
        detail: 'All prechecks passed, {passed} total.'
      }
    },
    agent: {
      taskSuffix: '(Agent taskId={taskId})'
    },
    log: {
      verifyRecovered: '[ControlPlane] Agent-side remote TLS probing failed, but the control plane completed real TLS verification and confirmed the target certificate matches.'
    },
    workflowStep: {
      failedDefault: 'Workflow node {index} failed',
      skipped: 'Workflow node skipped because the condition was not met.',
      successAssertions: 'Workflow node succeeded, assertions passed {passed}/{total}.',
      success: 'Workflow node succeeded.'
    },
    binding: {
      hostMissing: 'host header not provided'
    },
    site: {
      unnamed: 'Unnamed site'
    },
    provider: {
      target: 'Target'
    }
  },
  executions: {
    title: 'Execution records',
    description: 'View deployment execution status, step logs, dry-run precheck results, failure reasons, and rollback entry points.',
    resourceName: 'Execution run',
    errors: {
      streamConnectFailed: 'Failed to connect to the execution detail stream: HTTP {status}',
      loadFailed: 'Failed to load execution records'
    },
    actions: {
      refreshList: 'Refresh list',
      refreshing: 'Refreshing',
      viewDetail: 'View details',
      rollback: 'Start rollback',
      rollbackRisk: 'Rollback will modify the target service certificate configuration again. Confirm backup references and impact scope first.'
    },
    columns: {
      name: 'Execution ID',
      status: 'Status',
      risk: 'Risk',
      planId: 'Deployment plan',
      startedAt: 'Start time'
    },
    metrics: {
      total: {
        title: 'Total executions',
        description: 'Currently traceable execution runs.'
      },
      risky: {
        title: 'High-risk pending',
        description: 'Failed, partially successful, or rollback-needed executions.'
      }
    },
    fields: {
      executionId: 'Execution ID',
      deploymentPlan: 'Deployment plan',
      runType: 'Run type',
      status: 'Execution status',
      target: 'Execution target',
      externalRunId: 'External run ID',
      startedAt: 'Start time',
      finishedAt: 'End time',
      errorCode: 'Error code',
      failureReason: 'Failure reason'
    },
    links: {
      deploymentPlan: 'View deployment plan',
      auditEvents: 'View audit events'
    },
    empty: {
      title: 'No execution records',
      description: 'Logs, status, and audit links appear here after a deployment plan runs.'
    },
    list: {
      ariaLabel: 'Execution record list',
      title: 'Execution records',
      summary: '{total} execution records, newest first.',
      range: 'Showing {start}-{end} of {total}',
      assetsLabel: 'Assets',
      logLabel: 'Log summary',
      runNumber: 'Run {number}',
      planUnknown: 'No deployment plan linked',
      assetUnknown: 'No asset recorded',
      timeUnknown: 'Start time not recorded',
      logRunning: 'Execution is running and detail logs will keep updating.',
      logPending: 'Execution is queued and waiting for scheduling.',
      logFailed: 'Execution failed with error code {code}.',
      logSuccess: 'Execution succeeded in {duration}.',
      logCompleted: 'Execution finished. Open details for the full log.',
      errorCodeUnknown: 'not recorded',
      durationUnknown: 'unknown',
      durationSeconds: '{count} seconds',
      durationMinutes: '{count} minutes',
      viewDetailHint: 'Open details',
      openDetailAria: 'Open execution {id} for plan {plan}',
      previousPage: 'Previous',
      nextPage: 'Next',
      pageSummary: 'Page {page} of {pages}'
    },
    types: {
      dryRun: 'Precheck',
      apply: 'Apply',
      rollback: 'Rollback',
      retry: 'Retry',
      unknown: 'Other'
    },
    summary: {
      passed: 'Passed',
      warning: 'Warnings',
      failed: 'Failed',
      unknown: 'Unknown'
    },
    detail: {
      title: 'Execution details',
      titleWithId: 'Execution details {id}',
      description: 'View basic information, step status, and logs for the execution run.',
      eyebrow: 'Execution record',
      planLabel: 'Deployment plan {plan}',
      loadingSteps: 'Loading steps...',
      loadingLogs: 'Loading logs...',
      noStepDetail: 'No step details',
      notStarted: 'Not started',
      noSteps: 'No steps.',
      noLogs: 'No logs.'
    },
    tabs: {
      summary: 'Summary',
      steps: 'Steps',
      logs: 'Logs'
    }
  },
  plugins: {
    title: 'Plugins',
    description: 'Plugin packages, providers, permission declarations, signature validation, sandbox status, and isolation entry points.',
    resourceName: 'Plugin',
    actions: {
      install: 'Install plugin',
      detail: 'Details',
      disable: 'Disable plugin',
      disableRisk: 'Disabling a plugin affects provider, template, and executor capabilities.'
    },
    columns: {
      name: 'Plugin name',
      status: 'Status',
      risk: 'Risk',
      version: 'Version',
      signature: 'Signature'
    },
    metrics: {
      total: {
        title: 'Total plugins',
        description: 'Installed and upgradeable plugins.'
      },
      risky: {
        title: 'High-risk pending',
        description: 'Plugins with high-risk permissions, signature errors, or sandbox isolation.'
      }
    },
    empty: {
      title: 'No plugins',
      description: 'Review permission differences, signatures, and rollback strategy before installing plugins.'
    },
    detail: {
      title: 'Plugin details',
      titleWithName: 'Plugin {name}',
      description: 'Plugin details are shown in a modal while the main page keeps a compact list.',
      versionLabel: 'Version {version}'
    },
    fields: {
      pluginId: 'Plugin ID',
      name: 'Plugin name',
      currentStatus: 'Current status',
      version: 'Version',
      signatureStatus: 'Signature status',
      riskLevel: 'Risk level'
    }
  },
  deploymentPlans: {
    title: 'Deployment plans',
    description: 'Plan preview, impact scope, approval, execution batches, verification, and rollback entry points.',
    resourceName: 'Deployment plan',
    apiActions: {
      submit: 'Submit deployment plan',
      execute: 'Execute deployment plan',
      cancel: 'Cancel deployment plan',
      delete: 'Delete deployment plan'
    },
    actions: {
      create: 'Create deployment plan',
      detail: 'Details',
      edit: 'Edit plan',
      dryRun: 'Dry-run impact preview',
      dryRunRisk: 'Only generates an impact preview. It does not execute the real deployment.',
      submit: 'Submit for approval',
      submitRisk: 'After submission, the plan enters approval or pending execution status.',
      execute: 'Execute deployment',
      executeRisk: 'Execution modifies target certificate configuration. Completed or failed plans also use this entry for re-execution; run a dry-run impact preview first.',
      cancel: 'Cancel plan',
      cancelRisk: 'Only cancels unfinished deployment plans. Completed deployments are not rolled back.',
      rollback: 'Rollback execution',
      rollbackRisk: 'Rollback modifies the target service certificate configuration again and requires a real runId.',
      delete: 'Delete plan',
      deleteRisk: 'Hard-deletes the plan, deployment targets, execution records, and related audit history. This cannot be recovered.'
    },
    columns: {
      name: 'Plan name',
      status: 'Status',
      currentAssetCertificateExpiresAt: 'Current certificate end time',
      updateNeeded: 'Update needed',
      scheduledAt: 'Scheduled time',
      actions: 'Actions'
    },
    metrics: {
      total: {
        title: 'Total plans',
        description: 'Plans waiting for approval, pending execution, or running.'
      },
      risky: {
        title: 'High-risk pending',
        description: 'Plans affecting production services or lacking rollback capability.'
      }
    },
    fields: {
      planId: 'Plan ID',
      name: 'Plan name',
      status: 'Plan status',
      approvalStatus: 'Approval status',
      certificateVersionId: 'Certificate version ID',
      certificateFormatId: 'Certificate format config ID',
      currentAssetCertificateExpiresAt: 'Current certificate end time',
      updateNeeded: 'Update needed',
      targetSummary: 'Target binding summary',
      latestRun: 'Latest execution batch',
      approvalId: 'Approval ID',
      snapshotHash: 'Snapshot hash',
      failureReason: 'Failure reason',
      createdAt: 'Created at',
      updatedAt: 'Updated at'
    },
    links: {
      executions: 'View execution records',
      bindings: 'View related bindings'
    },
    empty: {
      title: 'No deployment plans',
      description: 'Start from a certificate or binding, create an impact preview in the deployment wizard, then submit the plan.'
    },
    disabled: {
      missingApproval: 'Approval information is missing, so execution is not allowed.',
      needDryRun: 'A successful dry-run impact preview is required before real execution.',
      missingRunId: 'runId is missing, so rollback is not allowed.',
      missingSelection: 'Deployment plan selection is missing'
    },
    common: {
      cancel: 'Cancel',
      close: 'Close',
      notConfigured: 'Not configured',
      notProvided: 'Not provided'
    },
    detail: {
      certificateVersionLabel: 'Certificate version',
      description: 'View basic plan information, related records, and the latest execution result.',
      emptyRelatedRecords: 'No related records.',
      loadingRelatedRecords: 'Loading related records...',
      noExecutionRecords: 'This plan has no execution records yet.',
      noTargetSummary: 'Target summary not provided',
      planIdLine: 'Plan ID {planId}',
      recordKinds: {
        certificateUpdate: 'Certificate update',
        dryRun: 'Dry-run'
      },
      relatedPlan: 'Plan {planId}',
      relatedRun: 'Run {runId}',
      relatedSource: 'Source {source}',
      tabs: {
        latestExecution: 'Latest execution',
        relatedRecords: 'Related records',
        summary: 'Summary'
      },
      targetLabel: 'Target',
      title: 'Deployment plan details',
      titleWithName: 'Deployment plan {name}',
      viewLogs: 'View logs'
    },
    dryRunRequired: {
      copy: 'Current action: {action}. Run a dry-run first, confirm impact scope and check results, then continue with real execution.',
      description: 'A successful dry-run impact preview is required before real execution.',
      primaryAction: 'Run dry-run first',
      runningAction: 'Starting dry-run…',
      title: 'Dry-run required first'
    },
    execution: {
      applyName: 'Deployment execution {runId}',
      applyTitle: 'Certificate update execution',
      dryRunTitle: 'Dry-run result',
      fallbackName: 'Execution {runId}',
      rollbackTitle: 'Certificate rollback execution'
    },
    feedback: {
      cancelled: 'Deployment plan cancelled.',
      cancelledWithPlanId: 'Deployment plan cancelled. planId: {planId}',
      deleted: 'Deployment plan deleted.',
      deletedWithPlanId: 'Deployment plan deleted. planId: {planId}',
      dryRunStartedMissingRunId: 'dry-run started, but the response is missing runId.',
      dryRunStartedWithRunId: 'dry-run started. Execution status is shown in the modal. runId: {runId}',
      dryRunTriggered: 'dry-run triggered.',
      dryRunTriggeredWithPlanId: 'dry-run triggered. planId: {planId}',
      dryRunTriggeredWithRunId: 'dry-run triggered. Precheck progress is shown in the modal. runId: {runId}',
      executeTriggered: 'Deployment execution triggered.',
      executeTriggeredWithPlanId: 'Deployment execution triggered. planId: {planId}',
      executeTriggeredWithRunId: 'Deployment execution triggered. Execution progress is shown in the modal. runId: {runId}',
      loadedDraft: 'Draft plan loaded.',
      loadedDraftWithPlanId: 'Draft plan loaded. planId: {planId}',
      savedWithPlanId: 'Deployment plan saved. planId: {planId}',
      submitted: 'Deployment plan submitted.',
      submittedWithPlanId: 'Deployment plan submitted. planId: {planId}'
    },
    target: {
      controlPlane: 'Control plane',
      noBindingInfo: 'Binding information not provided',
      noCertificateVariables: 'Certificate variables not bound',
      noHostHeader: 'host header not provided',
      noOutputSelected: 'No output selected'
    },
    errors: {
      actionFailed: '{action} failed',
      createReturnedMissingPlanId: 'Deployment plan was created but no planId was returned',
      loadCreateDataFailed: 'Failed to load deployment plan creation data',
      loadRelatedRecordsFailed: 'Failed to load related records',
      missingApplicationAssetIdForDryRun: 'Application asset ID is missing, so dry-run cannot start.',
      missingApplicationAssetIdForSave: 'Application asset ID is missing, so the deployment plan cannot be saved.',
      missingPlanId: 'Deployment plan ID is missing. Empty planId request blocked.',
      missingPlanIdForAction: '{action} is missing deployment plan ID. Empty planId request blocked.',
      missingRunIdRequest: 'Execution batch runId is missing. Empty runId request blocked.',
      saveFailed: 'Failed to save deployment plan',
      startDryRunFailed: 'Failed to start dry-run'
    }
  },
  agents: {
    actions: {
      close: 'Close',
      delete: 'Delete',
      deleteRisk: 'Deleting removes the Agent record directly and cannot be undone.',
      detail: 'Details',
      disable: 'Disable',
      disableRisk: 'After disabling, this Agent stops receiving new tasks.',
      enable: 'Enable',
      enableRisk: 'After enabling, this Agent becomes schedulable again.'
    },
    app: { fallbackName: 'App {index}' },
    certificate: {
      boundCertificate: 'Bound certificate',
      expiredDays: 'Expired {days} days ago',
      expiresToday: 'Expires today',
      modalDescription: 'Shows key certificate information used by the current site binding.',
      modalTitle: 'Certificate details',
      overviewDescription: 'Shows certificate name, issuer, validity period, fingerprint, and other key details.',
      overviewTitle: 'Certificate overview',
      projectDetailDescription: 'Shows project certificate asset details and related usages in the current Agent context.',
      projectDetailTitle: 'Project certificate details',
      querying: 'Querying...',
      remainingDays: '{days} days remaining',
      remainingWithViewAction: '{remaining} / click to view certificate',
      statusExpired: 'Expired',
      statusExpiring: 'Expiring soon',
      statusLabel: 'Certificate status',
      statusUnknown: 'Validity unknown',
      statusValid: 'Valid',
      view: 'View certificate',
      viewProjectDetail: 'View project certificate details'
    },
    certificateUsage: {
      iisSite: 'Agent IIS site',
      linuxSite: 'Agent Linux site',
      tomcatConnector: 'Agent Tomcat connector'
    },
    columns: {
      actions: 'Actions',
      hostname: 'Hostname',
      ipAddress: 'IP address',
      lastHeartbeat: 'Last heartbeat',
      onlineStatus: 'Online status',
      osType: 'OS type',
      version: 'Version'
    },
    common: {
      defaultAddress: 'Default address',
      no: 'No',
      noHostHeader: 'No Host Header',
      noListenAddress: 'No listen address',
      none: 'None',
      notConfigured: 'Not configured',
      notProvided: 'Not provided',
      notWritable: 'Not writable',
      unrecognized: 'Unrecognized',
      writable: 'Writable',
      yes: 'Yes'
    },
    detail: {
      loading: 'Loading details...',
      manualRescan: 'Manual rescan',
      manualRescanCannotPullTasks: 'This Agent cannot pull tasks, so rescan cannot run',
      manualRescanCreated: 'Manual rescan task created. Waiting for the Agent to pull it.',
      manualRescanSubmitting: 'Submitting rescan...',
      manualRescanUnsupportedType: 'This Agent type does not support manual rescan',
      modalDescription: 'Shows the Agent summary, runtime environment, and IIS site data.',
      modalTitle: 'Agent details',
      nodeEyebrow: 'Agent node',
      tabsAriaLabel: 'Agent detail tabs'
    },
    empty: {
      description: 'Click Install Agent, choose a platform and version, then generate a one-time install command.',
      noFrameworkSites: 'No {name} sites found',
      noIisSites: 'No IIS sites found',
      noRuntimeLogs: 'No runtime logs',
      noTomcatApps: 'No Tomcat apps found',
      noTomcatConnectors: 'No Tomcat connectors found',
      title: 'No Agents'
    },
    errors: {
      certificateAssetIncomplete: 'Certificate asset data is incomplete, so details cannot be opened.',
      certificateAssetNotFound: 'No matching certificate asset was found in this project.',
      certificateAssetQueryFailed: 'Failed to query certificate asset.',
      detailDataMissing: 'The detail API returned no data.',
      generateInstallCommandFailed: 'Failed to generate install command.',
      installCommandMissing: 'The backend did not return an install command.',
      loadDetailFailed: 'Failed to load details.',
      manualRescanFailed: 'Failed to start manual rescan.'
    },
    fields: {
      agentVersion: 'Agent version',
      appCount: 'App count',
      appList: 'App list',
      appPool: 'App pool',
      arch: 'Architecture',
      binaryPath: 'Binary path',
      certificateFile: 'Certificate file',
      certificateName: 'Certificate name',
      certificateStore: 'Certificate store',
      certificateSubject: 'Certificate subject',
      certificateThumbprint: 'Certificate thumbprint',
      configFile: 'Config file',
      configPath: 'Config path',
      connectorCount: 'Connector count',
      connectorList: 'Connector list',
      domain: 'Domain',
      frameworkVersion: '{name} version',
      healthStatus: 'Health status',
      healthSummary: 'Health summary',
      hostname: 'Hostname',
      httpsBinding: 'HTTPS binding',
      httpsListen: 'HTTPS listen',
      iisVersion: 'IIS version',
      installPrefix: 'Install prefix',
      installStatus: 'Install status',
      ipAddress: 'IP address',
      issuer: 'Issuer',
      lastCapabilityReportAt: 'Last capability report time',
      lastHeartbeat: 'Last heartbeat',
      lastRecoveryAt: 'Last recovery time',
      lastReportAt: 'Last report time',
      linuxDistribution: 'Linux distribution',
      listenAddress: 'Listen address',
      notAfter: 'Not after',
      notBefore: 'Not before',
      offlineDetected: 'Offline detected',
      osType: 'OS type',
      osVersion: 'OS version',
      patchVersion: 'Patch version',
      privateKeyOrKeystore: 'Private key / Keystore',
      proxyTarget: 'Proxy target',
      remainingDays: 'Remaining days',
      role: 'Role',
      runningStatus: 'Running status',
      runtimeLog: 'Runtime log',
      serviceName: 'Service name',
      sha256Fingerprint: 'SHA-256 fingerprint',
      siteCount: 'Site count',
      siteList: 'Site list',
      tlsConnector: 'TLS connector',
      tomcatVersion: 'Tomcat version',
      zone: 'Zone'
    },
    health: {
      degraded: 'Degraded',
      failed: 'Failed',
      healthy: 'Healthy',
      unknown: 'Unknown'
    },
    install: {
      bootstrapToken: 'Bootstrap token',
      command: 'Install command',
      commandCopied: 'Install command copied',
      copyCommand: 'Copy install command',
      copyToken: 'Copy token',
      expired: 'Expired',
      generateCommand: 'Generate install command',
      generating: 'Generating...',
      modalDescription: 'Choose platform and version to generate a one-time install command. The token is valid for 10 minutes and can only be used once.',
      modalTitle: 'Install Agent',
      platform: 'Platform',
      platformLinuxDescription: 'For Ubuntu, Debian, CentOS, Rocky, AlmaLinux, and other Linux distributions.',
      platformWindowsDescription: 'For Windows Server and Windows 10/11. Registers as a system service after installation.',
      remainingTime: '{minutes}m {seconds}s',
      remainingValidity: 'Remaining validity',
      singleUseHint: 'Once the bootstrap script requests this token, it expires immediately and cannot be reused.',
      tokenCopied: 'Token copied',
      version: 'Version',
      versionLatest: 'Latest stable',
      zone: 'Zone'
    },
    labels: {
      certificatePath: 'Certificate: {value}',
      deployDirectory: 'Deploy directory: {value}',
      directory: 'Directory: {value}',
      keystorePath: 'Keystore: {value}',
      listenAddress: 'Listen address: {value}',
      path: 'Path: {value}',
      privateKeyPath: 'Private key: {value}',
      reloadCommand: 'Reload command: {value}',
      siteName: 'Site name: {value}',
      taskType: 'Task type: {value}',
      testCommand: 'Test command: {value}',
      thumbprint: 'Thumbprint: {value}'
    },
    linux: {
      certDirectoryWritable: 'Certificate directory: {status}',
      helperRequired: 'Helper required',
      keyDirectoryWritable: 'Private key directory: {status}',
      permissionMode: 'Permission mode: {mode}'
    },
    logs: {
      collapse: 'Collapse',
      expand: 'Expand',
      listAriaLabel: 'Runtime log list'
    },
    metrics: {
      abnormalDescription: 'Offline, failed, or drifted Agents need priority handling.',
      abnormalTitle: 'Abnormal Agents',
      totalDescription: 'Number of Agents currently registered with the control plane.',
      totalTitle: 'Total Agents'
    },
    page: {
      description: 'View Agents, generate install commands for different platforms, and inspect details in a dedicated modal.',
      installAgent: 'Install Agent'
    },
    sections: {
      frameworkOverviewDescription: 'Shows {name} installation status, running status, and config location on the host.',
      frameworkOverviewTitle: '{name} overview',
      frameworkSitesDescription: 'Shows sites, roots, domains, reverse proxy targets, and certificate paths discovered by {name}.',
      frameworkSitesTitle: '{name} sites',
      healthDescription: 'Shows control-plane offline detection, latest recovery time, pending result uploads, and health summary.',
      healthTitle: 'Health and recovery',
      iisOverviewDescription: 'Shows IIS installation status and version information on the host.',
      iisOverviewTitle: 'IIS overview',
      iisSitesDescription: 'Shows IIS websites, site paths, binding ports, and certificate subjects.',
      iisSitesTitle: 'IIS sites',
      logOverviewDescription: 'Shows the latest capability report time to help judge whether detail data is fresh.',
      logOverviewTitle: 'Log overview',
      mainInfoDescription: 'Shows Agent identity, role, and latest heartbeat.',
      mainInfoTitle: 'Main information',
      runtimeDescription: 'Shows runtime system and version information reported by the Agent.',
      runtimeLogsDescription: 'Shows persisted runtime logs for manual rescans, heartbeat anomalies, and capability report interruptions.',
      runtimeLogsTitle: 'Runtime logs',
      runtimeTitle: 'Runtime environment',
      tomcatAppsDescription: 'Shows application paths and deployment directories discovered in Tomcat Host/Context.',
      tomcatAppsTitle: 'Tomcat apps',
      tomcatConnectorsDescription: 'Shows Tomcat Connector listen address, protocol, TLS switch, and certificate path.',
      tomcatConnectorsTitle: 'Tomcat connectors',
      tomcatOverviewDescription: 'Shows Tomcat installation status, running status, and Catalina path on the host.',
      tomcatOverviewTitle: 'Tomcat overview'
    },
    site: {
      domainCount: '{count} domains',
      fallbackName: 'Site {index}'
    },
    siteMode: {
      reverseProxy: 'Reverse proxy',
      staticRoot: 'Static site'
    },
    status: {
      installed: 'Installed',
      notInstalled: 'Not installed',
      notRunning: 'Not running',
      running: 'Running'
    },
    tabs: {
      logs: 'Logs',
      overview: 'Overview'
    }
  },
  dashboard: {
    aria: {
      assetHeatmap: 'Application asset status heatmap',
      certificateStatusList: 'Certificate status list',
      metrics: 'Core metrics',
      quickActions: 'Primary feature entry points',
      statusHeatmap: 'Certificate, Agent, gateway, and application asset status',
      statusLegend: 'Status legend'
    },
    assets: {
      groupCount: '{summary} · {total} items',
      title: 'Application asset status',
      updatedAt: 'Updated at {time}'
    },
    audit: {
      description: 'Prioritizes failures, denials, high-risk events, and key business changes.',
      title: 'Recent audit logs'
    },
    certificateState: {
      critical: 'Near expiry',
      expired: 'Expired',
      expiring: 'Expiring soon',
      unknown: 'Unknown',
      valid: 'Normal'
    },
    days: {
      expired: 'Expired {days} days ago',
      expiresToday: 'Expires today',
      notRecorded: 'Not recorded',
      remaining: '{days} days'
    },
    empty: {
      noAuditLogs: 'No audit logs',
      noCertificateStatus: 'No certificate status data',
      noObjects: 'No objects'
    },
    errors: {
      loadFailed: 'Failed to load overview data',
      missingOverviewData: 'Overview API returned no data'
    },
    legend: {
      disabled: 'Disabled',
      error: 'Abnormal',
      ok: 'Normal',
      unknown: 'Unknown',
      warning: 'Attention'
    },
    loading: {
      description: 'Reading overview data.',
      title: 'Loading'
    },
    metrics: {
      activeAgents: { title: 'Active Agents', description: 'Agents currently online and schedulable.' },
      activeGateways: { title: 'Active gateways', description: 'Isolation-zone gateways currently online.' },
      applications: { title: 'Current applications', description: 'Managed application entry assets.' },
      expiringCertificates: { title: 'Certificates expiring in 15 days', description: 'Certificates that need renewal or replacement.' },
      managedBindings: { title: 'Managed bindings', description: 'Certificate bindings already in managed status.' },
      validCertificates: { title: 'Active certificates', description: 'Certificate versions that are active and not expired.' }
    },
    quickActions: {
      agents: { title: 'Agent', description: 'View online status and task capabilities.' },
      assets: { title: 'Application assets', description: 'Maintain domains, ports, and deployment targets.' },
      audits: { title: 'Audit logs', description: 'Trace operators and execution results.' },
      certificates: { title: 'Certificate management', description: 'Import, view, and convert certificates.' },
      deploymentPlans: { title: 'Deployment plans', description: 'Create and execute certificate update plans.' },
      gateways: { title: 'Gateway', description: 'Manage isolation-zone execution entry points.' }
    },
    statusBlock: {
      detail: {
        certificateRemaining: '{name}, {days}'
      },
      status: {
        active: 'Active',
        critical: 'Near expiry',
        deleted: 'Deleted',
        disabled: 'Disabled',
        expired: 'Expired',
        expiring: 'Expiring soon',
        inactive: 'Inactive',
        offline: 'Offline',
        online: 'Online',
        retired: 'Retired',
        revoked: 'Revoked',
        stale: 'Stale',
        unknown: 'Unknown',
        unreachable: 'Unreachable',
        upgrading: 'Upgrading',
        valid: 'Normal'
      }
    },
    statusGroups: {
      agents: { title: 'Agent' },
      applicationAssets: { title: 'Application assets' },
      certificates: { title: 'Certificates' },
      gateways: { title: 'Gateways' },
      summary: {
        allNormal: 'All normal',
        needsAttention: '{count} need attention'
      }
    },
    table: {
      bindings: 'Bindings',
      certificate: 'Certificate',
      domain: 'Domain',
      notAfterMissing: 'Expiry time not recorded',
      remainingTime: 'Remaining time',
      status: 'Status'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: 'Add Gateway Agent',
      close: 'Close',
      copied: 'Copied',
      copyEnableCommand: 'Copy enable command',
      copyInstallCommand: 'Copy install command',
      detail: 'Details',
      enableExistingAgent: 'Enable Gateway on existing Agent',
      generateEnableCommand: 'Generate enable command',
      generateInstallCommand: 'Generate install command',
      generating: 'Generating...',
      probe: 'Probe',
      probeRisk: 'Starts a reachability probe from this Gateway region.'
    },
    columns: {
      actions: 'Actions',
      gateway: 'Gateway',
      lastHeartbeat: 'Last heartbeat',
      load: 'Load',
      region: 'Region',
      status: 'Status'
    },
    detail: {
      abilities: {
        agentTask: {
          description: 'Forward deployment, check, and other tasks to Agents in this region.',
          title: 'Task forwarding'
        },
        directControl: {
          description: 'Forward controlled operations to Agents in this region without direct control-plane access to internal ports.',
          title: 'Remote control forwarding'
        },
        probe: {
          description: 'Check whether hosts, websites, or Agents are reachable from this region.',
          title: 'Connectivity check'
        }
      },
      eyebrow: 'Regional gateway',
      heroDescription: 'Handles probing and forwarding in region {region}',
      overview: {
        availableCapacity: 'Available capacity',
        connectionStatus: 'Connection status',
        lastContact: 'Last contact',
        processing: 'Processing',
        serviceRegion: 'Service region',
        successRate: 'Success rate'
      },
      sections: {
        overview: 'Runtime overview',
        services: 'Available services'
      }
    },
    empty: {
      description: 'Add a Gateway Agent, or enable the Gateway role on an existing Agent.',
      title: 'No gateways'
    },
    errors: {
      generateEnableCommandFailed: 'Failed to generate Gateway enable command.',
      generateInstallCommandFailed: 'Failed to generate Gateway Agent install command.',
      missingEnableCommand: 'The backend did not return a Gateway enable command.',
      missingInstallCommand: 'The backend did not return a Gateway Agent install command.'
    },
    fields: {
      config: 'Config',
      enableCommand: 'Enable command',
      expiresAt: 'Expires at',
      installCode: 'Install code',
      installCommand: 'Install command',
      platform: 'Platform',
      region: 'Region',
      service: 'Service',
      unboundAgent: 'Do not bind a specific Agent'
    },
    links: {
      assets: 'View assets',
      executions: 'View execution records'
    },
    modals: {
      detail: {
        title: 'Gateway details'
      },
      enable: {
        title: 'Enable Gateway on existing Agent'
      },
      install: {
        title: 'Add Gateway Agent'
      }
    },
    page: {
      description: 'Manage regional routing Gateway Agents.',
      title: 'Gateways'
    },
    platforms: {
      linuxSystemd: {
        description: 'Install Gateway Agent service on a Linux host'
      },
      windowsService: {
        description: 'Install Gateway Agent service on a Windows host'
      }
    },
    resourceName: 'Gateway',
    status: {
      disabled: 'Disabled',
      offline: 'Offline',
      online: 'Online',
      revoked: 'Revoked',
      upgrading: 'Upgrading'
    },
    values: {
      availableCapacity: 'Can accept {count} tasks',
      defaultRegion: 'Default region',
      regionGatewayName: '{region} gateway',
      taskCount: '{count} tasks'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'Service reads Secret',
      secretResolve: 'Executor reads Secret',
      secretCreate: 'Create Secret',
      secretVersionCreate: 'Create Secret version',
      secretRotate: 'Rotate Secret',
      certificateImport: 'Import certificate',
      certificateFormatUpdate: 'Update certificate artifact',
      certificateFormatDelete: 'Delete certificate artifact',
      deploymentCreate: 'Create deployment plan',
      deploymentExecute: 'Execute deployment plan',
      deploymentRollback: 'Request rollback',
      approvalCreate: 'Create approval',
      approvalApprove: 'Approve request',
      approvalReject: 'Reject request',
      authLogin: 'User login',
      authLogout: 'User logout'
    },
    events: {
      authLoginSuccess: 'Login succeeded',
      authLoginFailure: 'Login failed',
      authLoginFailed: 'Login failed',
      authLogout: 'Logged out',
      authExternalLoginSuccess: 'External identity login succeeded',
      authExternalLoginFailed: 'External identity login failed',
      secretCreated: 'Created Secret',
      secretVersionCreated: 'Created Secret version',
      secretUsed: 'Read Secret',
      secretRotated: 'Rotated Secret',
      permissionDenied: 'Permission denied',
      approvalCreated: 'Created approval',
      approvalApproved: 'Approval approved',
      approvalRejected: 'Approval rejected',
      certificateImported: 'Certificate changed',
      deploymentCreated: 'Created deployment',
      deploymentExecuted: 'Executed deployment',
      deploymentRollbackRequested: 'Requested deployment rollback',
      pluginInstalled: 'Installed plugin',
      pluginPermissionDenied: 'Plugin permission denied',
      workflowTemplateExecuted: 'Executed workflow template'
    },
    types: {
      audit: 'Audit',
      auth: 'Authentication',
      security: 'Security',
      secret: 'Secret',
      certificate: 'Certificate',
      certificateVersion: 'Certificate',
      certificateVersionFormat: 'Certificate artifact',
      deployment: 'Deployment',
      deploymentPlan: 'Deployment plan',
      execution: 'Execution',
      approval: 'Approval',
      permission: 'Permission',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Application asset',
      binding: 'Binding'
    },
    actors: {
      user: 'User',
      system: 'System',
      agent: 'Agent',
      plugin: 'Plugin',
      executor: 'Executor'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Secret version',
      certificate: 'Certificate',
      certificateVersion: 'Certificate version',
      certificateVersionFormat: 'Certificate artifact',
      deployment: 'Deployment',
      deploymentPlan: 'Deployment plan',
      execution: 'Execution task',
      executionRun: 'Execution task',
      approval: 'Approval',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow template',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Application asset',
      binding: 'Certificate binding',
      auditLog: 'Audit log'
    },
    results: {
      success: 'Success',
      failure: 'Failed',
      denied: 'Denied'
    },
    verbs: {
      success: ' completed ',
      failure: ' failed ',
      denied: ' denied '
    },
    tokens: {
      auth: 'authentication',
      login: 'login',
      logout: 'logout',
      external: 'external',
      secret: 'Secret',
      resolve: 'read',
      service: 'service',
      used: 'used',
      created: 'created',
      create: 'create',
      updated: 'updated',
      update: 'update',
      deleted: 'deleted',
      delete: 'delete',
      version: 'version',
      certificate: 'certificate',
      imported: 'imported',
      import: 'import',
      format: 'artifact',
      deployment: 'deployment',
      executed: 'executed',
      execute: 'execute',
      rollback: 'rollback',
      requested: 'requested',
      approval: 'approval',
      approved: 'approved',
      rejected: 'rejected',
      permission: 'permission',
      denied: 'denied',
      gateway: 'gateway',
      credential: 'credential',
      issued: 'issued',
      revoked: 'revoked',
      task: 'task',
      evidence: 'evidence',
      recorded: 'recorded',
      result: 'result',
      plugin: 'plugin',
      workflow: 'workflow',
      template: 'template',
      synced: 'synced',
      tested: 'tested',
      source: 'source',
      identity: 'identity source',
      group: 'group',
      mapping: 'mapping'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb}"{title}", resource: {resource}.',
    fallbacks: {
      unknown: 'Unknown'
    }
  },
  audit: {
    page: {
      title: 'Audit logs',
      description: 'Organizes logs by user actions, failures/denials, and key business changes while keeping readable summaries.'
    },
    actions: {
      exportEvidence: 'Export audit evidence',
      exporting: 'Exporting…',
      refreshing: 'Refreshing…'
    },
    errors: {
      exportFailed: 'Failed to export audit evidence',
      loadFailed: 'Failed to load audit logs',
      withRequestId: '{message} ({requestId})'
    },
    metrics: {
      ariaLabel: 'Audit overview',
      total: {
        title: 'Total audits',
        description: 'Traceable operation records in the current filter scope.'
      },
      failed: {
        title: 'Failed / denied',
        description: 'Failed executions and denied access that need priority review.'
      },
      userActions: {
        title: 'User actions',
        description: 'Business changes and access actions directly initiated by users.'
      }
    },
    list: {
      ariaLabel: 'Audit log list',
      title: 'Log list',
      summary: '{total} total, sorted by newest first.',
      timeNotRecorded: 'Time not recorded'
    },
    empty: {
      title: 'No audit events',
      description: 'Key operations should be traceable to operation records and task records.'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: 'Load failed',
      submitFailed: 'Submit failed'
    },
    actions: {
      createResource: 'Add {resource}',
      submitting: 'Submitting…'
    },
    modal: {
      createDescription: 'Fill in the fields below to create {resource}'
    },
    placeholders: {
      selectField: 'Select {field}'
    },
    table: {
      ariaLabel: 'Management list',
      resourceList: '{resource} list',
      total: '{count} total'
    }
  },
  settings: {
    securityLabel: 'Security settings entry',
    permissionPolicies: {
      resourceName: 'Permission policy',
      actions: {
        create: 'Create policy'
      },
      columns: {
        id: 'Policy ID',
        subjectType: 'Subject type',
        subjectId: 'Subject ID',
        effect: 'Effect',
        actions: 'Actions',
        resourceTypes: 'Resource types',
        scope: 'Scope'
      },
      fields: {
        subjectType: 'Subject type',
        subjectId: 'Subject ID',
        effect: 'Effect',
        actions: 'Actions',
        resourceTypes: 'Resource types',
        tenantId: 'Tenant scope'
      },
      subjectTypes: {
        role: 'Role',
        user: 'User',
        plugin: 'Plugin',
        executor: 'Executor'
      },
      effects: {
        allow: 'Allow',
        deny: 'Deny'
      }
    },
    groupRoleMappings: {
      resourceName: 'Group mapping',
      actions: {
        create: 'Create mapping'
      },
      columns: {
        sourceId: 'Identity source ID',
        externalGroup: 'External group',
        roleId: 'Local role',
        enabled: 'Enabled',
        updatedAt: 'Updated at'
      },
      fields: {
        sourceId: 'Identity source ID',
        externalGroup: 'External group',
        roleId: 'Local role ID'
      }
    },
    users: {
      title: 'Account principals',
      summary: {
        groups: '{count} total',
        users: '{total} total, {selected} selected'
      },
      actions: {
        createUser: 'Create user',
        addGroup: 'Add group',
        bulkDelete: 'Bulk delete',
        edit: 'Edit',
        delete: 'Delete',
        lookupLoading: 'Looking up...',
        lookupUser: 'Look up user',
        lookupGroup: 'Look up group',
        creating: 'Creating...',
        saving: 'Saving...',
        saveChanges: 'Save changes',
        adding: 'Adding...'
      },
      risks: {
        bulkDelete: 'Bulk delete removes local credentials and role bindings for selected users.',
        deleteUser: 'Deleting the user removes this account\'s local credentials and role bindings.'
      },
      tabs: {
        users: 'Users',
        groups: 'Groups'
      },
      empty: {
        users: 'No users',
        groups: 'No groups'
      },
      columns: {
        username: 'User name',
        displayName: 'Display name',
        email: 'Email',
        source: 'Source',
        identitySourceName: 'Identity source name',
        status: 'Status',
        tenant: 'Tenant',
        roles: 'Roles',
        lastSyncedAt: 'Last synced',
        updatedAt: 'Updated at',
        actions: 'Actions',
        groupName: 'Group name',
        code: 'Code',
        externalRef: 'External reference'
      },
      dialog: {
        userCreateTitle: 'Create user',
        userEditTitle: 'Edit user',
        userCreateDescription: 'Create a local user, or look up an identity-source user by user name and create a bound user.',
        userEditDescription: 'Edit display name, email, status, and roles.',
        groupCreateTitle: 'Add group',
        groupCreateDescription: 'Create a local group, or look up an external group from an identity source.'
      },
      aria: {
        principalType: 'Principal type',
        createMode: 'Creation mode',
        externalUserProfile: 'External identity user profile',
        groupCreateMode: 'Group creation mode',
        externalGroupProfile: 'External identity group profile'
      },
      modes: {
        localUser: 'Local user',
        externalUser: 'Identity source user',
        localGroup: 'Local group',
        externalGroup: 'Identity source group'
      },
      fields: {
        identitySource: 'Identity source',
        directoryUsername: 'Directory user name',
        username: 'User name',
        displayName: 'Display name',
        email: 'Email',
        role: 'Role',
        initialPassword: 'Initial password',
        status: 'Status',
        directoryGroupName: 'Directory group name',
        groupName: 'Group name',
        groupCode: 'Group code',
        directoryDn: 'Directory DN'
      },
      placeholders: {
        selectIdentitySource: 'Select an identity source',
        directoryUsername: 'For example jackson',
        displayName: 'Certificate operator',
        initialPassword: 'Enter an initial password',
        directoryGroupName: 'For example GCAC-Ops',
        groupName: 'Certificate operations group'
      },
      options: {
        unset: 'Not set'
      },
      status: {
        active: 'Enabled',
        disabled: 'Disabled'
      },
      labels: {
        identitySourceOption: '{name} ({type})'
      },
      errors: {
        loadUsersFailed: 'Failed to load users',
        loadGroupsFailed: 'Failed to load groups',
        createUserFailed: 'Failed to create user',
        updateUserFailed: 'Failed to update user',
        externalUserEmpty: 'The identity source did not return a user profile',
        lookupExternalUserFailed: 'Failed to look up identity-source user',
        externalGroupEmpty: 'The identity source did not return a group profile',
        lookupExternalGroupFailed: 'Failed to look up identity-source group',
        createGroupFailed: 'Failed to create group',
        deleteUsersFailed: 'Failed to delete users'
      }
    },
    roles: {
      page: { title: 'Role permissions', description: 'Manage authorization object scopes by role, and assign users or groups to roles.' },
      actions: {
        createRole: 'Create role',
        refreshObjects: 'Refresh objects',
        loading: 'Loading...',
        creating: 'Creating...',
        saving: 'Saving...',
        detail: 'Details',
        authorize: 'Authorize',
        grantPermission: 'Grant permission',
        assignMembers: 'Assign members',
        delete: 'Delete',
        deleteRole: 'Delete role',
        deleting: 'Deleting...',
        clearSelection: 'Clear selection'
      },
      columns: {
        roleId: 'Role ID',
        code: 'Code',
        name: 'Name',
        builtin: 'Built-in',
        policyCount: 'Policy count',
        permissions: 'Permissions',
        actions: 'Actions',
        objectScope: 'Object scope',
        accessLevel: 'Access level',
        effect: 'Effect',
        memberType: 'Member type',
        member: 'Member'
      },
      table: {
        emptyRoles: 'No roles',
        roleRecords: 'Role records',
        emptyGrants: 'This role has no object permissions',
        currentPermissions: 'Current role permissions',
        emptyMembers: 'This role has no member assignments',
        assignedMembers: 'Assigned members'
      },
      categories: {
        certificate: 'Certificate',
        gateway: 'Gateway',
        agent: 'Agent',
        serviceAsset: 'Application asset',
        deploymentPlan: 'Deployment plan',
        workflow: 'Workflow',
        auditLog: 'Log',
        systemSetting: 'System setting'
      },
      accessLevel: { read: 'Read only', edit: 'Edit', control: 'Full control' },
      effect: { allow: 'Allow', deny: 'Deny' },
      principal: { user: 'User', group: 'Group', externalGroup: 'Identity source group' },
      summary: {
        selectedMembers: '{count} members selected',
        chooseMembers: 'Select users or groups',
        selectedScopes: '{count} scopes selected',
        chooseObjectNode: 'Select an object tree node',
        selectedScopeLabel: 'Selected scopes',
        selectedMemberLabel: 'Selected members'
      },
      tree: {
        rootLabel: 'All objects',
        rootDescription: 'All authorizable business objects',
        typeDescription: 'All {category} records',
        allBusinessObjects: 'All business objects',
        selectedScopeAria: 'Selected authorization scopes',
        objectTreeAria: 'Authorizable object tree',
        authorizableObjects: 'Authorizable objects',
        loading: 'Loading object tree...',
        kind: { all: 'All', category: 'Category', record: 'Record' }
      },
      format: {
        labelWithId: '{label} ({id})',
        recordFallback: '{category} {value}',
        unnamedRecord: 'Unnamed record'
      },
      detail: {
        title: 'Role details',
        titleWithName: 'Role {name}',
        description: 'Maintain object scopes, concrete objects, access levels, and member assignments here.'
      },
      create: {
        title: 'Create role',
        description: 'Describe the role responsibilities and optionally grant object scopes directly.',
        nameLabel: 'Role name',
        namePlaceholder: 'Certificate operator',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'Responsible for daily certificate operations',
        authorizedRole: 'Authorized role',
        newRole: 'New role'
      },
      grant: {
        title: 'Grant role permission',
        description: 'Select scopes from the object tree and set the access level for them.',
        roleLabel: 'Role'
      },
      member: {
        title: 'Assign members',
        titleWithName: 'Assign members: {name}',
        description: 'Select users or groups. The system assigns them to the role’s existing authorized object scopes.',
        targetRole: 'Target role',
        authorizedScope: 'Authorized scopes',
        objectScopeCount: '{count} object scopes',
        selectedMembersAria: 'Selected members',
        assignableMembersAria: 'Assignable members',
        emptyAssignable: 'No assignable {type}'
      },
      errors: {
        loadObjectTreeFailed: 'Failed to load object tree',
        loadDataFailed: 'Failed to load permission management data',
        missingRoleId: 'The backend did not return a role ID',
        createRoleFailed: 'Failed to create role',
        grantRoleFailed: 'Failed to grant role permission',
        roleNoObjectScopes: 'This role has no authorized object scopes yet. Grant permissions to the role first.',
        assignMembersFailed: 'Failed to assign members',
        deleteRoleFailed: 'Failed to delete role',
        missingObjectSetId: 'The backend did not return an object scope ID'
      },
      confirm: {
        deleteRole: 'Delete role "{name}"? This also removes its user assignments and object authorizations.'
      },
      auditLogs: {
        auth: { name: 'Authentication login logs', description: 'Login, logout, and external identity source login' },
        security: { name: 'Security management logs', description: 'User, role, permission, and identity source changes' },
        certificate: { name: 'Certificate logs', description: 'Certificate import, version, format, and binding operations' },
        asset: { name: 'Asset logs', description: 'Application asset, host, service instance, and site asset operations' },
        gateway: { name: 'Gateway logs', description: 'Gateway route, probe, and status changes' },
        agent: { name: 'Agent logs', description: 'Agent registration, heartbeat, task, and upgrade operations' },
        deployment: { name: 'Deployment plan logs', description: 'Deployment plans, execution, rollback, and approval' },
        workflow: { name: 'Workflow logs', description: 'Workflow template and execution operations' },
        secret: { name: 'Secret logs', description: 'Secret creation, use, and rotation' },
        system: { name: 'System logs', description: 'System settings and platform-level events' }
      }
    },
    identitySources: {
      actions: {
        create: 'Create identity source',
        edit: 'Edit',
        delete: 'Delete',
        creating: 'Creating...',
        saving: 'Saving...',
        saveChanges: 'Save changes',
        expandAdvanced: 'Expand advanced settings',
        collapseAdvanced: 'Collapse advanced settings'
      },
      columns: {
        name: 'Name',
        type: 'Directory type',
        server: 'Server',
        status: 'Status',
        actions: 'Actions'
      },
      table: {
        title: 'Identity source list',
        total: '{count} total'
      },
      empty: 'No identity sources',
      dialog: {
        createTitle: 'Create identity source',
        editTitle: 'Edit identity source',
        createDescription: 'Fill in basic connection information first; filters and directory type are in advanced settings.',
        editDescription: 'Update identity source configuration. To update the service account password, enter a new password.'
      },
      fields: {
        name: 'Name',
        domain: 'Domain',
        protocol: 'Protocol',
        serverAddress: 'Server address',
        bindDn: 'Service account DN',
        bindPassword: 'Service account password',
        directoryType: 'Directory type',
        defaultRole: 'Default role',
        enabled: 'Enabled status',
        userDnTemplate: 'User DN/UPN template',
        userFilter: 'User filter',
        groupFilter: 'Group filter',
        syncUserFilter: 'Sync user filter',
        requireGroupMapping: 'Require login users to match a group mapping'
      },
      placeholders: {
        name: 'For example: Enterprise AD',
        bindPasswordCreate: 'Enter the service account password',
        bindPasswordEdit: 'Leave empty to keep the existing password',
        autoByDirectoryType: 'Leave empty to derive from directory type',
        userFilter: 'For example: (uid={{username}})',
        groupFilter: 'For example: (member={{userDn}})'
      },
      labels: {
        finalUrl: 'Final URL: {url}'
      },
      options: {
        unset: 'Not set'
      },
      status: {
        enabled: 'Enabled',
        disabled: 'Disabled',
        disabledShort: 'Disabled'
      },
      types: {
        ldap: 'Standard LDAP'
      },
      risks: {
        delete: 'Deleting the identity source invalidates login, sync, and group mappings for this directory.'
      },
      secret: {
        bindPasswordName: '{name} LDAP service account password'
      },
      messages: {
        createSuccess: 'Identity source created',
        updateSuccess: 'Identity source updated'
      },
      errors: {
        loadFailed: 'Failed to load identity sources',
        createBindPasswordSecretFailed: 'Failed to create service account password Secret',
        createFailed: 'Failed to create identity source',
        updateFailed: 'Failed to update identity source',
        deleteFailed: 'Failed to delete identity source'
      }
    }
  },
  bindings: {
    actions: { create: 'New config file', edit: 'Edit', delete: 'Delete', deleting: 'Deleting...', applyTemplate: 'Apply built-in template', saving: 'Saving...', confirmSave: 'Save' },
    columns: { configName: 'Config name', targetSummary: 'Target environment', displayFormat: 'Content format', extension: 'Extension', encodingSummary: 'Encoding', exportSummary: 'Contents / export options', actions: 'Actions' },
    dialog: {
      createTitle: 'Create certificate format config',
      editTitle: 'Edit certificate format config',
      description: 'Select the system and target platform, apply a built-in template, then adjust each option and define what the single artifact contains.'
    },
    list: { title: 'Certificate format config list', descriptionWithCount: 'Reusable certificate format templates are saved here. {count} currently.' },
    empty: { text: 'No certificate format configs' },
    fields: {
      contentFormat: 'Content format',
      systemPlatform: 'System platform',
      runtimePlatform: 'Target platform',
      configName: 'Config name',
      backendFormat: 'Backend format',
      outputExtension: 'Output extension',
      expiresAt: 'Config expiry time (optional)',
      certificateEncoding: 'Certificate encoding',
      certificateContentEncoding: 'Certificate content encoding',
      privateKeyEncoding: 'Private key encoding',
      includeLeafCertificate: 'Include leaf certificate',
      includeCertificateChain: 'Include certificate chain',
      includePrivateKey: 'Include private key',
      mainArtifactIncludesChain: 'Main artifact includes certificate chain',
      generateChainFile: 'Generate extra chain file',
      generatePrivateKeyFile: 'Generate extra private key file',
      exportPassword: 'Export password'
    },
    formats: { pfx: 'PKCS#12 / PFX container', jks: 'JKS container', pemBundle: 'PEM single-file bundle', pemCert: 'PEM certificate file', pemKey: 'Private key file', cer: 'Certificate file (.cer)', crt: 'Certificate file (.crt)', p7b: 'PKCS#7 / P7B certificate chain', custom: 'Custom' },
    sections: {
      templates: { title: 'Built-in templates', description: 'Templates prefill format, contents, and export rules based on common TLS deployment patterns and can still be edited.' },
      basic: { title: 'Basic information', description: 'Define the config identity, real content format, and final extension.' },
      encoding: { title: 'Encoding', description: 'Only encoding options valid for the current content format are shown.' },
      content: { title: 'Contents', description: 'Defines what the main artifact contains: public certificate, certificate chain, and private key.' },
      export: { title: 'Export options', description: 'Define whether to generate extra chain/private-key files and container password options.' }
    },
    filters: { keywordPlaceholder: 'Config name / target environment / Alias / content format' },
    placeholders: { configName: 'For example: device-compatible single-file PEM', exportPassword: 'Enter the PFX/JKS export password' },
    validation: { selectPlatformsFirst: 'Select the system platform and target platform first.', configNameRequired: 'Config name is required', passwordRequired: 'PFX/JKS configs require an export password' },
    errors: { loadFailed: 'Failed to load certificate format configs', saveFailed: 'Failed to save certificate format config', deleteFailed: 'Failed to delete certificate format config', createExportSecretFailed: 'Failed to create export password Secret', withCode: '{message} ({code})' },
    fallbacks: { unnamedConfig: 'Unnamed config-{index}', unspecified: 'Unspecified', aliasUnset: 'Alias not set' },
    labels: { aliasWithValue: 'Alias: {alias}', requestId: 'Request ID: {requestId}' },
    encoding: { pkcs12Container: 'PKCS#12 container', jksContainer: 'JKS container', privateKeyWithEncoding: 'Private key {encoding}', pkcs7Chain: 'PKCS#7 certificate chain', certificateWithEncoding: 'Certificate {encoding}', default: 'Default' },
    export: { leafCertificate: 'Public certificate', certificateChain: 'Certificate chain', privateKey: 'Private key', extraChainFile: 'Extra chain file', extraPrivateKeyFile: 'Extra private key file' },
    secret: { defaultConfigName: 'Certificate format config', exportPasswordName: '{name} export password' },
    select: { placeholder: 'Select' },
    separators: { export: ' · ' },
    hints: { savedPassword: 'An export password is already configured. Enter a new password to replace it.' },
    templates: {
      windowsIis: { configName: 'Windows-IIS-PKCS12 standard template', description: 'IIS most commonly uses PKCS#12/PFX containers. The main artifact directly carries the server certificate, certificate chain, and private key.' },
      windowsNginx: { configName: 'Windows-NGINX-PEM standard template', description: 'NGINX commonly uses a PEM single file for the server certificate and chain, plus a separate private key file.' },
      windowsApache: { configName: 'Windows-Apache-PEM standard template', description: 'Apache is usually delivered as a PEM certificate file plus a separate private key, with an extra chain file for operational compatibility.' },
      windowsTomcat: { configName: 'Windows-Tomcat-PKCS12 standard template', description: 'Tomcat mainly uses JKS/PKCS#12 keystores. This template defaults to the more portable PKCS#12 format.' },
      windowsOther: { configName: 'Windows device-compatible single-file PEM template', description: 'For devices that require a single file containing the public certificate, certificate chain, and private key. The extension can be adjusted to .crt/.cer.' },
      linuxIis: { configName: 'Linux-IIS compatibility template', description: 'If the final target is still IIS, PKCS#12/PFX remains the most reasonable delivery artifact.' },
      linuxNginx: { configName: 'Linux-NGINX-PEM standard template', description: 'Official NGINX configuration revolves around a PEM single-file certificate chain and a separate private key.' },
      linuxApache: { configName: 'Linux-Apache-PEM standard template', description: 'Apache commonly uses a PEM certificate file plus a separate private key, with an extra chain file for split deployment.' },
      linuxTomcat: { configName: 'Linux-Tomcat-PKCS12 standard template', description: 'Tomcat defaults to keystore delivery. This template uses the more portable PKCS#12 format.' },
      linuxOther: { configName: 'Linux device-compatible single-file PEM template', description: 'For generic Linux devices that accept a single PEM file, start with a bundle and adjust extension and contents for the target device.' }
    }
  },
  assets: {
    title: 'Application assets',
    description: 'Manage application entry points by domain or IP, focusing on address, port, protocol, site, and execution targeting.',
    resourceName: 'Application asset',
    actions: { add: 'Add asset', edit: 'Edit', detail: 'Details', addVariable: 'Add variable', delete: 'Delete', rollbackFromLatestSnapshot: 'Rollback from latest snapshot', rollingBack: 'Rolling back...', saving: 'Saving...', creating: 'Creating...', saveChanges: 'Save changes', confirmCreate: 'Create' },
    columns: { domain: 'Domain', port: 'Port', protocol: 'Protocol', platform: 'Platform', framework: 'Framework', site: 'Site', status: 'Status', actions: 'Actions' },
    fields: {
      assetId: 'Application asset ID', domain: 'Domain', addressType: 'Address type', port: 'Port', protocol: 'Protocol', verifyUrl: 'Verify URL', platform: 'Platform', frameworkType: 'Framework type',
      serviceInstanceId: 'Service instance ID', siteId: 'Site ID', managedTargetId: 'Managed target ID', bindingKey: 'Binding key', hostId: 'Host ID', environment: 'Environment',
      discoverySource: 'Discovery source', lastDiscoveredAt: 'Last discovered at', tags: 'Tags', managedTarget: 'Managed target', siteName: 'Site name', bindingInformation: 'Binding information', hostHeader: 'Host Header', sniName: 'SNI name',
      currentCertificate: 'Current certificate', targetCertificate: 'Target certificate', expectedFingerprint: 'Expected fingerprint', certificateStore: 'Certificate store', snapshotType: 'Snapshot type',
      time: 'Time', executionRun: 'Execution run', displayName: 'Display name', siteInstance: 'Site instance', certificateFormat: 'Certificate artifact format', workflow: 'Workflow',
      publishedVersion: 'Published version', runner: 'Runner', artifactFormat: 'Artifact format'
    },
    links: { certificateBindings: 'View certificate bindings', executions: 'View execution records' },
    empty: { title: 'No application assets', description: 'Waiting for discovery to write ServiceAsset records, or add entry points through backend APIs.', noBindingInformation: 'No binding information', notSet: 'Not set', notSelected: 'Not selected', noVariablePreset: 'No variables can be added', basicEntryIncomplete: 'Basic entry incomplete' },
    detail: {
      title: 'Application details', description: 'Keep asset details, bindings, deployment entry, and snapshots in one modal.', tabsAriaLabel: 'Application detail tabs',
      tabs: { overview: 'Overview', snapshots: 'Snapshots' }, loadingTargetBinding: 'Loading target binding details...', loadingSnapshots: 'Loading snapshots...',
      emptyCertificateBindings: 'No certificate bindings.', emptySnapshots: 'No snapshots.', rollbackSubmitted: 'Rollback request submitted. Check executions for the rollback run.',
      sections: {
        overview: { title: 'Overview', description: 'The application asset is the primary object. Hosts and sites only provide execution targeting information.' },
        targetBinding: { title: 'Target binding', description: 'Bindings must point to a site and managed target instead of guessing by domain.' },
        certificateBindings: { title: 'Certificate bindings', description: 'Certificate relationships are tied to bindings instead of only relying on domains.' },
        snapshots: { title: 'Snapshots', description: 'Pre-deploy, post-deploy, and rollback state must be visible directly, not only as task records.' }
      }
    },
    managementModes: { agent: 'Agent mode', agentDescription: 'Bind Agent, site instance, and managed target', workflow: 'Workflow mode', workflowDescription: 'Select workflow version and runtime variables' },
    loading: { agents: 'Loading Agents...', sites: 'Loading sites...', managedTargets: 'Loading targets...', certificateFormats: 'Loading format configs...', workflows: 'Loading workflows...', versions: 'Loading versions...', gateways: 'Loading Gateways...', credentials: 'Loading credentials...' },
    select: { agent: 'Select Agent', siteInstance: 'Select site instance', managedTarget: 'Select managed target', certificateFormat: 'Select certificate artifact format', workflow: 'Select workflow', publishedVersion: 'Select published version', gateway: 'Select Gateway', variablePreset: 'Select preset variable', credential: 'Select credential', generic: 'Select', artifactFormat: 'Select format config', output: 'Select output', optionalOutput: 'Optional' },
    validation: {
      variableNameRequired: 'Variable name is required', variableNameInvalid: 'Variable {name} has an invalid name', variableDuplicated: 'Variable {name} is duplicated', variableRequired: 'Variable {name} is required',
      variableMustBeNumber: 'Variable {name} must be a number', variableMustBeJsonObject: 'Variable {name} must be a JSON object', variableInvalidJson: 'Variable {name} is not valid JSON',
      variableCredentialInvalid: 'Variable {name} must select a valid credential', certificateFormatRequired: 'Certificate variable {name} must select a certificate format config',
      certificateOutputRequired: 'Certificate variable {name}.{slot} must select an output', certificateOutputMissing: 'Selected output for certificate variable {name}.{slot} does not exist'
    },
    workflowVariableTypes: { string: 'String', number: 'Number', boolean: 'Boolean', enum: 'Enum', object: 'Object', file: 'File', credential: 'Credential', certificate: 'Certificate' },
    wizard: {
      ariaLabel: 'Application asset creation steps',
      steps: { basicEntry: 'Basic entry', deploymentMode: 'Deployment mode', confirmSave: 'Confirm and save' },
      stepState: { active: 'In progress', done: 'Completed', pending: 'Not started', incomplete: 'Incomplete', readyNext: 'Ready for next step', pendingSubmit: 'Ready to submit' },
      panels: {
        basicEntryTitle: 'Basic entry', basicEntryDescription: 'Fill in domain, port, protocol, and platform first to define the application entry identity.',
        agentTitle: 'Agent target binding', agentDescription: 'Select Agent, site instance, managed target, and certificate artifact format.',
        workflowTitle: 'Workflow runtime config', workflowDescription: 'Select workflow version, runner, and variables. Certificate variables are injected at runtime.',
        confirmTitle: 'Confirm and save', confirmDescription: 'Review application entry, deployment mode, and runtime parameters before saving the asset.'
      }
    },
    form: {
      createTitle: 'Add application asset manually', editTitle: 'Edit application asset',
      createDescription: 'Create an application entry and bind target information required for later deployment.', editDescription: 'Update the application entry and deployment target binding.',
      createRequestCompleted: 'Create request completed.', editRequestCompleted: 'Save request completed.',
      agentCertificateFormatHint: 'Agent mode uses this certificate artifact format to generate deployment materials.',
      placeholders: { displayName: 'For example: production site entry', verifyUrl: 'For example: https://example.com/health', siteName: 'For example: production site', bindingInformation: 'For example: *:443:example.com', hostHeader: 'For example: example.com', sniName: 'For example: example.com' }
    },
    review: { accessEntry: 'Access entry', deploymentMode: 'Deployment mode', agentSiteTarget: 'Agent / site / target', workflowVersion: 'Workflow version', gatewayRunner: 'Gateway: {gateway}', variableCount: '{count} variables', onlyBasicEntry: 'Basic entry only', autoGeneratedByEntry: 'Generated from application entry' },
    workflowTarget: { title: 'Workflow target information', description: 'Used for workflow asset display, post-deploy probing, and DSL target variable synchronization.', dslSyncHint: 'Synced to DSL target variables' },
    workflowVariables: {
      title: 'Workflow variables', configuredCount: '{configured}/{total} configured', name: 'Variable name', type: 'Type', value: 'Value', manual: 'Manual',
      empty: 'No workflow variables.', noPublishedVersion: 'Select a published workflow version before configuring variables.', certificateAutoInjected: 'The certificate version is selected by the deployment plan and injected automatically at runtime.',
      certificateDescription: 'The certificate version is selected by the deployment plan. Bind format config and outputs below; {name}.outputs.*.content is injected at runtime.',
      presets: {
        deviceHost: 'Target host or device address', sshUsername: 'SSH user name', credential: 'Workflow credential', certificate: 'Certificate artifact', targetPlatform: 'Target platform',
        verifyHost: 'Verification host', verifyPort: 'Verification port', verifyPath: 'Verification path', apacheServiceName: 'Apache systemd service name',
        apacheSiteConfigPath: 'Apache site config path', certificateFilePath: 'Certificate destination path', certificateKeyFilePath: 'Private key destination path',
        backupRoot: 'Certificate backup root', expectedResponseContains: 'Expected response contains text', virtualHostServerName: 'VirtualHost ServerName'
      }
    },
    certificateBindings: { title: 'Certificate variable bindings', description: 'Select certificate artifact format and outputs for certificate variables in the workflow.', variableCount: '{count} certificate variables', defaultVariableDescription: 'Certificate artifact variable', noArtifactOutputs: 'No selectable outputs for the current format config.' },
    certificateOutputs: { publicCertificateWithChain: 'Public certificate + certificate chain', publicCertificate: 'Public certificate', certificateChain: 'Certificate chain', privateKey: 'Private key', pemBundle: 'PEM bundle artifact', container: '{format} container', bundle: 'Bundle' },
    certificateFormats: { savedConfigMissingWithId: '{id} (saved config, not returned by current list)', withPrivateKey: 'With private key', withoutPrivateKey: 'Without private key' },
    snapshotTypes: { preDeploy: 'Pre-deploy', postDeploy: 'Post-deploy', postRollback: 'Post-rollback', errorState: 'Error state', rollbackPoint: 'Rollback point' },
    errors: { loadWorkflowListFailed: 'Failed to load workflow list', loadWorkflowVersionsFailed: 'Failed to load workflow versions', loadGatewayListFailed: 'Failed to load gateway list', loadCertificateFormatsFailed: 'Failed to load certificate format configs', loadAssetDetailFailed: 'Failed to load application asset details', rollbackFailed: 'Failed to start rollback', loadTargetsFailed: 'Failed to load sites and managed targets', createAssetFailed: 'Failed to create application asset', loadWorkflowCredentialsFailed: 'Failed to load workflow credentials', noAvailableSiteInstance: 'No available site instance found. Confirm framework sites have been reported successfully in Agent details.' },
    platforms: { appliance: 'Appliance' },
    runners: { controlPlane: 'Control plane' },
    status: { archived: 'Archived', unknownStatus: 'Unknown status' },
    common: { required: 'Required', optional: 'Optional' }
  },
  certificates: {
    errors: {
      requestFailed: 'Request failed'
    },
    detail: {
      backList: 'Back to list',
      description: 'Shows certificate version details, format artifacts, and related assets.',
      title: 'Certificate details'
    },
    detailPanel: {
      sources: {
        agentContext: 'Agent context',
        platformBinding: 'Platform binding record'
      },
      usage: {
        columns: {
          domainName: 'Domain / target',
          agentName: 'Agent name',
          siteName: 'Site name',
          bindingType: 'Binding type',
          usageSource: 'Source',
          status: 'Status'
        },
        empty: 'No related assets',
        toolbar: 'Related assets'
      },
      summary: {
        certificateName: 'Certificate name',
        logicalDomain: 'Logical domain',
        issuer: 'Issuer',
        subject: 'Subject',
        serialNumber: 'Serial number',
        chainStatus: 'Chain status'
      },
      sections: {
        subjectInfo: 'Subject information',
        issuerInfo: 'Issuer information',
        certificateFields: 'Certificate fields',
        extensionFields: 'Extension fields'
      },
      fields: {
        commonName: 'Common name (CN)',
        organization: 'Organization (O)',
        organizationalUnit: 'Organizational unit (OU)',
        countryRegion: 'Country / region (C)',
        stateProvince: 'State / province (ST)',
        locality: 'Locality (L)',
        version: 'Version',
        signatureAlgorithm: 'Signature algorithm',
        publicKeyAlgorithm: 'Public key algorithm',
        fingerprintSha256: 'SHA-256 fingerprint',
        san: 'SAN',
        deployable: 'Deployable',
        leafStorageRef: 'Leaf certificate reference',
        chainCertificateCount: 'Chain certificate count',
        chainDiagnostics: 'Chain diagnostics'
      },
      fallbacks: {
        unknownCertificate: 'Unknown certificate',
        unknownIssuer: 'Unknown issuer',
        unnamedCertificate: 'Unnamed certificate',
        unknownDomain: 'Unknown domain',
        unknownSubject: 'Unknown subject',
        unknown: 'Unknown',
        notPartOfCertificate: 'Not part of the certificate',
        none: 'None',
        emptyValue: '—',
        unknownType: 'Unknown type',
        unknownResource: 'Unknown resource',
        unknownTarget: 'Unknown target'
      },
      values: {
        yes: 'Yes',
        no: 'No'
      },
      separators: {
        diagnostic: '; ',
        list: ', '
      },
      chain: {
        roles: {
          leaf: 'Leaf certificate',
          root: 'Root certificate',
          intermediate: 'Intermediate certificate'
        },
        title: 'Certificate chain',
        empty: 'No certificate chain information',
        subject: 'Subject: {value}',
        issuer: 'Issuer: {value}'
      },
      errors: {
        loadFailedTitle: 'Failed to load certificate details',
        code: 'Error code: {code}'
      },
      actions: {
        retry: 'Retry'
      },
      states: {
        loading: 'Loading...'
      },
      tabs: {
        ariaLabel: 'Certificate detail tabs',
        detail: 'Details',
        usage: 'Related assets'
      },
      validity: {
        title: 'Certificate validity',
        notBefore: 'Valid from: {value}',
        notAfter: 'Expires at: {value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'Version ID',
        createdAt: 'Created at',
        format: 'Format',
        secretRef: 'Secret reference',
        status: 'Status'
      },
      create: 'Create format config',
      createFailed: 'Failed to create format',
      description: 'PEM/DER/PFX/JKS/P7B format configuration entry for certificate {id}.',
      empty: 'No format configs',
      fields: {
        alias: 'Alias (optional)',
        containsPrivateKey: 'Contains private key (PEM)',
        passwordSecretRef: 'passwordSecretRef (PFX/JKS)',
        targetFormat: 'Target format',
        versionId: 'Version ID'
      },
      hint: 'PFX/JKS must use an existing backend passwordSecretRef. Deployment materials are generated on demand from the certificate version and format config.',
      loadFailed: 'Failed to load format configs',
      optionAvailable: '{label} - available',
      placeholders: {
        alias: 'For example gcac-cert'
      },
      title: 'Certificate format config',
      toolbar: 'Format config list',
      unsupported: '{format} cannot be created with the current capability declaration.'
    },
    import: {
      backList: 'Back to certificate list',
      description: 'Currently only PEM + KEY and PFX are supported; PFX only supports file import. Imported material must include the server certificate, full intermediate chain, and private key. Root certificates are optional.',
      errors: {
        importFailed: 'Import failed',
        materialRequiredBeforeValidate: 'Complete the import material before starting validation.',
        needPassedValidation: 'Complete step 3 validation and make sure it passed before importing.',
        validateFailed: 'Validation failed'
      },
      formats: {
        pem: {
          hint: 'Server certificate, full intermediate chain, and private key must all be provided. Root certificates are optional and only produce a warning when missing.'
        },
        pfx: {
          hint: 'Only file import is supported. The container must include the server certificate, full intermediate chain, and private key. Root certificates are optional and only produce a warning when missing.'
        }
      },
      methods: {
        file: {
          hint: 'Use this when you already have cert / key or .pfx files.',
          label: 'Select file'
        },
        text: {
          hint: 'Paste PEM text directly to avoid uploading temporary files.',
          label: 'Paste text'
        }
      },
      title: 'Import certificate'
    },
    importForm: {
      hints: {
        pemChainCheck: 'Upload or paste the server certificate, full intermediate chain, and private key. The system will verify the chain and private key match.',
        pfxChainCheck: 'Upload a PFX/P12 file and enter its password. The system will parse the server certificate, chain, and private key from the container.',
        pfxFileOnly: 'PFX only supports file import.'
      },
      roles: {
        leaf: 'Leaf certificate',
        root: 'Root certificate',
        intermediate: 'Intermediate certificate'
      },
      steps: {
        ariaLabel: 'Certificate import steps',
        formatAndMethod: 'Format and method',
        materials: 'Import materials',
        validateAndImport: 'Validate and import'
      },
      formatIntro: {
        title: 'Choose import format and method',
        description: 'Confirm the material format first, then upload files or paste text. PFX currently only supports file import.'
      },
      labels: {
        importType: 'Import type',
        importMethod: 'Import method',
        materialStatus: 'Material status'
      },
      status: {
        supported: 'Supported',
        unsupported: 'Unsupported',
        completed: 'Completed',
        incomplete: 'Incomplete',
        matched: 'Matched',
        unmatched: 'Unmatched'
      },
      fields: {
        certificateChainFile: 'Certificate chain file',
        certificatePemText: 'Certificate PEM text',
        privateKey: 'Private key ({kind})',
        file: 'file',
        pemText: 'PEM text',
        pfxFile: 'PFX/P12 file',
        certificateName: 'Certificate name',
        pfxPassword: 'PFX password'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
        certificateName: 'For example example.com production certificate',
        required: 'Required'
      },
      validation: {
        title: 'Validate import materials',
        description: 'Validate the certificate chain, validity period, private key match, and material completeness before importing.',
        passed: 'Validation passed. Ready to import.',
        failed: 'Validation failed'
      },
      report: {
        certificateSummary: 'Certificate summary',
        serialNumber: 'Serial number',
        validity: 'Validity',
        validityRange: '{start} to {end}',
        issuer: 'Issuer',
        issuerWithValue: 'Issuer: {value}',
        subject: 'Subject',
        chainValidation: 'Chain validation',
        chainStatus: 'Chain status',
        certificateCount: 'Certificate count',
        privateKeyMatch: 'Private key match',
        provided: 'Provided',
        matchResult: 'Match result',
        privateKeySource: 'Private key source',
        blockers: 'Blockers',
        warnings: 'Warnings'
      },
      selectedFile: 'Selected: {name}',
      importSuccess: 'Imported successfully. Certificate version ID: {id}',
      actions: {
        validating: 'Validating...',
        validate: 'Validate',
        cancel: 'Cancel',
        previous: 'Previous',
        next: 'Next',
        importing: 'Importing...',
        import: 'Import certificate'
      }
    },
    list: {
      filters: {
        keyword: 'Keyword',
        domain: 'Domain',
        status: 'Status'
      },
      placeholders: {
        assetKeyword: 'Domain / SAN / fingerprint',
        versionKeyword: 'Name / issuer / subject / version ID'
      },
      columns: {
        notBefore: 'Start date',
        notAfter: 'End date',
        associatedAsset: 'Related asset',
        status: 'Status',
        certificateVersionId: 'Certificate version ID'
      },
      lifecycle: {
        unknown: 'Unknown',
        expired: 'Expired',
        expiringSoon: 'Expiring soon',
        valid: 'Valid'
      },
      fallbacks: {
        unselectedDomain: 'No domain selected',
        unnamedDomain: 'Unnamed domain',
        noSupplement: 'No additional information'
      },
      assets: {
        title: 'Domain list',
        loadFailed: 'Failed to load domain list',
        empty: 'No domains',
        unselectedTitle: 'No domain selected',
        unselectedDescription: 'Select a logical certificate domain on the left first.'
      },
      versions: {
        title: 'SSL certificate list',
        titleWithDomain: 'SSL certificates for {domain}',
        description: 'Shows SSL certificates under the current domain, including certificate name, start date, end date, issuer, and subject.',
        loadFailed: 'Failed to load SSL certificate list',
        emptyForDomain: 'No SSL certificates under this domain',
        emptyForDomainDescription: 'Use the import certificate button on the right of the filters to add certificate versions for this domain.',
        empty: 'No SSL certificates',
        toolbar: 'Certificate version list',
        currentCount: '{count} currently'
      },
      actions: {
        clear: 'Clear',
        deleteRisk: 'Deleting removes the current certificate version directly. If it is still referenced by a binding or deployment, the backend will reject the operation.'
      },
      errors: {
        deleteFailed: 'Delete failed',
        materialRequiredForFormat: 'Certificate material for the current format is required.',
        importFailedWithCheck: 'Import failed. Check the input material.',
        validateFailedWithCheck: 'Validation failed. Check the input material.'
      },
      import: {
        description: 'Currently only PEM + KEY and PFX are supported; each import must include the server certificate, full intermediate chain, and private key. Root certificates are optional and show a warning when missing. The private key is stored only as a backend Secret and is never echoed in responses.'
      }
    },
    usages: {
      backDetail: 'Back to details',
      columns: {
        domainName: 'Domain / target',
        resourceId: 'Resource ID',
        resourceType: 'Resource type',
        status: 'Status',
        updatedAt: 'Updated at'
      },
      description: 'Bindings, deployment targets, and resource references for certificate {id}.',
      empty: 'No usages',
      loadFailed: 'Failed to load usages',
      title: 'Certificate usages',
      toolbar: 'Usages'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: 'Username + password',
        usernamePasswordWithUsername: 'Username + password / {username}',
        sshKey: 'SSH private key',
        sshKeyWithUsername: 'SSH private key / {username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: { description: 'Call a structured HTTP API instead of scattered curl strings.' },
        ssh: { displayName: 'SSH command', description: 'Declare the SSH command to run while storing only connection and credential references.' },
        sftp: { displayName: 'SFTP upload/download', description: 'Upload or download files through a formal SFTP step, suitable for certificate and config installation.' },
        scp: { displayName: 'SCP upload/download', description: 'Copy files through SCP, suitable for simple host file distribution.' },
        verify: { displayName: 'Verify', description: 'Assert HTTP status, text, regex, or certificate fingerprint.' },
        condition: { displayName: 'Condition', description: 'Choose the next path based on variable existence or value.' },
        transform: { displayName: 'Transform', description: 'Use JSONata to convert upstream output into new workflow context variables.' },
        wait: { displayName: 'Wait', description: 'Wait for a fixed number of seconds before continuing.' },
        manual: { displayName: 'Manual approval', description: 'Pause the workflow until manual confirmation.' }
      },
      fields: {
        command: 'Command',
        connectionRef: 'Connection variable',
        contentRef: 'Content variable',
        credential: 'Credential',
        description: 'Description',
        direction: 'Direction',
        expected: 'Expected value',
        expectedHostKeyFingerprint: 'Host Key fingerprint',
        hostKeyPolicy: 'Host Key policy',
        hostRef: 'Host variable',
        inputRef: 'Input variable',
        instruction: 'Approval instruction',
        localPath: 'Local path',
        mode: 'File mode',
        operator: 'Operator',
        remotePath: 'Remote path',
        seconds: 'Wait seconds',
        temporaryPath: 'Temporary path',
        timeoutMs: 'Timeout ms',
        timeoutSeconds: 'Timeout seconds',
        transformInput: 'Transform input',
        outputFormat: 'Output format',
        usernameVariable: 'Username variable',
        variable: 'Variable',
        verifyType: 'Verify type'
      },
      options: {
        direction: { download: 'Download', upload: 'Upload' },
        hostKeyPolicy: { manualApproval: 'Manual approval', strict: 'Strict verification', trustOnFirstUse: 'Trust on first use' },
        operator: { equals: 'Equals', exists: 'Exists', notEquals: 'Not equals', notExists: 'Does not exist' },
        transformFormat: { raw: 'Raw value', jsonString: 'JSON string' },
        verifyType: { certificateFingerprint: 'Certificate fingerprint', httpStatus: 'HTTP status', regex: 'Regex match', textContains: 'Text contains' }
      },
      stages: {
        backup: { title: 'Backup', description: 'Keep rollback material.' },
        install: { title: 'Install', description: 'Write certificates or configuration.' },
        prepare: { title: 'Prepare', description: 'Prepare connections, variables, and material.' },
        refresh: { title: 'Refresh', description: 'Reload services or refresh targets.' },
        verify: { title: 'Verify', description: 'Confirm the result matches expectations.' }
      },
      defaults: {
        displayName: '{name} workflow',
        nodes: {
          backupExistingCertificate: 'Back up existing certificate',
          reloadService: 'Reload service'
        },
        variables: {
          certificatePaths: { description: 'Target certificate path configuration' },
          credential: { description: 'Connection credential' },
          deviceHost: { description: 'Target host' },
          serverCert: {
            description: 'Server certificate material to deploy',
            outputs: {
              certFile: { description: 'Server certificate file' },
              keyFile: { description: 'Private key file' }
            }
          },
          sshUsername: { description: 'SSH login username' },
          verifyUrl: { description: 'Post-deployment verification URL' }
        },
        config: {
          conditionDescription: 'Check whether the target host variable exists',
          manualInstruction: 'Please confirm the target device certificate has switched to the new version.'
        }
      },
      variableFlow: {
        system: 'System',
        variable: 'Variable'
      },
      errors: {
        unknownNodeType: 'Unknown node type: {type}'
      }
    },
    canvasEditor: {
      summary: '{nodes} nodes, {edges} edges, {variables} variables',
      stageNodeCount: '{count} nodes',
      copyLabel: '{label} copy',
      actions: {
        addVariable: 'Add variable',
        collapseBottomPanelAria: 'Collapse bottom control panel',
        collapseDown: 'Collapse down',
        copy: 'Copy',
        copyNode: 'Copy node',
        delete: 'Delete',
        deleteNode: 'Delete node',
        expandBottomPanelAria: 'Expand bottom control panel',
        expandPanel: 'Expand panel',
        layout: 'Arrange layout',
        mockCurrentNode: 'Simulate current node only',
        mockRunning: 'Simulating...',
        paste: 'Paste',
        pasteNode: 'Paste node',
        realRun: 'Run current node for real',
        realRunHttp: 'Run current HTTP node',
        realRunRunning: 'Running...',
        realRunSsh: 'Run current SSH node',
        realRunTransfer: 'Run real file transfer',
        redo: 'Redo',
        saveDraft: 'Save draft',
        saving: 'Saving...',
        undo: 'Undo',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out'
      },
      aria: {
        bottomPanel: 'Bottom panel',
        canvasArea: 'Canvas area',
        dslPanel: 'DSL panel',
        nodePalette: 'Node palette',
        propertiesPanel: 'Properties panel',
        runtimePanel: 'Runtime panel',
        toolbar: 'Workflow canvas toolbar',
        validationPanel: 'Validation panel',
        variablesPanel: 'Variables panel'
      },
      credentialHints: {
        savedApiKey: 'Saved API key',
        savedBearerToken: 'Saved Bearer token',
        savedSshSftp: 'Saved SSH / SFTP credentials',
        savedUsernamePassword: 'Saved username + password'
      },
      credentials: {
        emptyCreateHint: 'No available credentials. Create one from Credential Management on the list page.',
        loading: 'Loading credentials from backend...'
      },
      dsl: {
        title: 'DSL import and overwrite',
        hint: 'Paste external DSL JSON or choose a local DSL file. Import only overwrites the current canvas in the browser; a new workflow version is created only after saving the draft.',
        selectFile: 'Select DSL file',
        actions: {
          importOverwrite: 'Import DSL and overwrite canvas',
          resetToCanvas: 'Refill current canvas DSL'
        },
        messages: {
          fileLoaded: 'Loaded file: {fileName}',
          imported: 'DSL imported and current canvas overwritten, {count} nodes total.',
          resetToCompiled: 'Refilled backend-compiled DSL.'
        },
        errors: {
          importFailed: 'DSL import failed',
          invalidTopLevel: 'Invalid DSL top-level structure. It must be an object.'
        }
      },
      empty: {
        selectNodeToEdit: 'Select a node to edit properties.'
      },
      errors: {
        backendValidationFailed: 'Backend validation failed',
        credentialsLoadFailed: 'Failed to load workflow credentials',
        missingStepName: 'Step name is missing',
        missingWorkflowDsl: 'Backend did not return workflow DSL'
      },
      fields: {
        authType: 'Auth type',
        clientCertificate: 'Client certificate',
        clientPrivateKey: 'Client private key',
        command: 'Command',
        connectionVariable: 'Connection variable',
        contentRef: 'Content reference',
        cookieName: 'Cookie name',
        credential: 'Credential',
        credentialSelector: 'Credential selector',
        defaultValue: 'Default value',
        deliveryLocation: 'Delivery location',
        description: 'Description',
        direction: 'Direction',
        fileMode: 'File mode',
        headerName: 'Header name',
        hostRefOrHostname: 'Host variable / hostname',
        hostVariable: 'Host variable',
        keyName: 'Key name',
        localPath: 'Local path',
        newNodeStage: 'New node stage',
        nodeName: 'Node name',
        remotePath: 'Remote path',
        required: 'Required',
        secretValue: 'Secret value',
        sensitive: 'Sensitive',
        stage: 'Stage',
        temporaryPath: 'Temporary path',
        timeoutSeconds: 'Timeout seconds',
        type: 'Type',
        username: 'Username',
        variableName: 'Variable name'
      },
      options: {
        download: 'Download',
        manualInput: 'Manual input',
        notSelected: 'Not selected',
        upload: 'Upload'
      },
      runtime: {
        noCredentialVariables: 'This workflow has no credential variables.',
        noExtraVariables: 'The current node has no extra runtime variables.'
      },
      sections: {
        httpAuth: 'HTTP authentication',
        nodePalette: 'Node palette',
        properties: 'Properties',
        referenceFlow: 'Reference flow',
        runtimeCredentialVariables: 'Runtime credential variables',
        runtimeVariables: 'Runtime variables',
        singleNodeTest: 'Single-node test run',
        variableConfig: 'Variable configuration'
      },
      tabs: {
        runtime: 'Runtime',
        validation: 'Validation',
        variables: 'Variables'
      },
      test: {
        cause: 'Cause',
        code: 'Code',
        emptyHint: 'Select a node to run a simulation or real test.',
        error: 'Error',
        executionPlan: 'Execution plan',
        exitCode: 'Exit code',
        failureDetails: 'Failure details',
        hint: 'Test hint',
        logs: 'Logs',
        nodeOutput: 'Node output',
        running: 'Running',
        stage: 'Stage',
        stderr: 'Standard error',
        stdout: 'Standard output',
        suggestion: 'Suggestion',
        target: 'Target',
        errors: {
          mockRunFailed: 'Simulation failed',
          realRunFailed: 'Real test run failed'
        },
        messages: {
          mockCompleted: 'Simulation completed.',
          mockFailed: 'Simulation failed.',
          realCompleted: 'Real test run completed.',
          realFailed: 'Real test run failed.'
        }
      },
      validation: {
        levels: {
          error: 'Error',
          risk: 'Risk',
          warning: 'Warning'
        },
        location: {
          canvas: 'Canvas',
          edge: 'Edge',
          fieldSuffix: 'field',
          node: 'Node'
        },
        noBlockingErrors: 'No blocking errors.'
      },
      variables: {
        customRuntimeDescription: 'Custom runtime variable',
        notUsed: 'Not used',
        usedBy: 'Used by: {nodes}'
      }
    },
    templates: {
      title: 'Workflows',
      resourceName: 'Workflow',
      description: 'Manage CURL/SSH/SFTP workflow versions, publishing status, and change history from canvas drafts.',
      actions: {
        addVersion: 'Add version',
        applyTemplate: 'Apply template',
        cancel: 'Cancel',
        close: 'Close',
        createBlank: 'Create blank',
        credentialManagement: 'Credential management',
        delete: 'Delete',
        detail: 'Details',
        edit: 'Edit',
        publishVersion: 'Publish version',
        saveNote: 'Save note',
        switchVersion: 'Switch version',
        templateManagement: 'Template management',
        versionManagement: 'Version management'
      },
      states: {
        creating: 'Creating...',
        loading: 'Loading...',
        processing: 'Processing...',
        saving: 'Saving...'
      },
      fields: {
        actions: 'Actions',
        createdAt: 'Created at',
        currentStatus: 'Current status',
        currentVersion: 'Current version',
        currentVersionId: 'Current version ID',
        id: 'Workflow ID',
        name: 'Workflow name',
        note: 'Note',
        status: 'Status',
        updatedAt: 'Updated at'
      },
      empty: {
        description: 'Create a canvas draft first, then publish versions to the production flow.',
        noChangeSummary: 'No change summary.',
        noChangeSummaryShort: 'No change summary',
        noVersions: 'No versions.',
        title: 'No workflows'
      },
      tabs: { summary: 'Overview', versions: 'Versions' },
      versionStatuses: { disabled: 'Disabled', draft: 'Draft', published: 'Published' },
      detail: {
        description: 'Workflow details, canvas drafts, and versions are kept in this modal; the main page stays compact.',
        publishedVersion: 'Published version {version}',
        title: 'Workflow details',
        titleWithName: 'Workflow {name}'
      },
      versionManager: {
        description: 'Manage only workflow version creation and publishing here; workflow canvas content is not changed.',
        titleWithName: 'Version management: {name}'
      },
      changeSummaries: {
        applyFromFileTemplate: 'Apply file template to workflow draft',
        createCanvasDraft: 'Create workflow draft from frontend canvas',
        createFromFileTemplate: 'Create workflow draft from file template',
        createVersionDraft: 'Create new draft version from version management',
        saveCanvasDraft: 'Save draft version from canvas editor'
      },
      messages: {
        canvasDraftUpdated: 'Current draft version updated.',
        switchedVersion: 'Switched to {version}.',
        versionDraftCreated: 'New draft version created.',
        versionNoteUpdated: 'Version note updated.'
      },
      errors: {
        createVersionFailed: 'Failed to create workflow version',
        loadVersionsFailed: 'Failed to load workflow versions',
        missingWorkflowDsl: 'Backend did not return workflow DSL',
        publishVersionFailed: 'Failed to publish workflow version',
        saveCanvasDraftFailed: 'Failed to save canvas draft',
        updateVersionNoteFailed: 'Failed to update version note'
      },
      delete: {
        riskText: 'Deleting disables this workflow and all versions, hiding them from the list; historical execution records will not be rewritten.'
      },
      loading: {
        versions: 'Loading versions...'
      },
      fileTemplates: {
        applyAction: 'Apply template to current workflow',
        applyTitle: 'Apply file template to workflow',
        createAction: 'Create workflow from template',
        createTitle: 'Create workflow from file template',
        currentTarget: 'Current target: {name}',
        description: 'Template files come from the built-in template library or user import directory. Applying one to an existing workflow creates a new draft version and does not rewrite history.',
        empty: 'No recognizable workflow template files.',
        identifier: 'Identifier {name}',
        invalid: 'Invalid',
        invalidFile: 'Invalid file',
        loading: 'Scanning file templates...',
        valid: 'Available',
        sources: { builtin: 'Built-in', userImported: 'User imported' },
        errors: {
          actionFailed: 'Failed to run file template action',
          loadFailed: 'Failed to load workflow file templates',
          missingApplyTarget: 'Missing workflow target to apply'
        }
      },
      credentials: {
        actions: { create: 'Create credential' },
        addTitle: 'Add credential',
        count: '{count} item(s)',
        description: 'Create reusable login and API credentials for workflows in one place. The frontend only selects and reuses them, without requiring manual internal reference strings.',
        empty: 'No backend credential records. After creation, they can be selected directly in variables, SSH nodes, and HTTP nodes.',
        loading: 'Loading credential metadata from backend...',
        registeredTitle: 'Registered credentials',
        title: 'Credential management',
        fields: {
          deliveryLocation: 'Delivery location',
          headerOrParam: 'Header / parameter name',
          name: 'Credential name',
          referenceLocation: 'Reference location',
          storageType: 'Storage type',
          type: 'Credential type',
          username: 'Username'
        },
        kinds: {
          common: { family: 'General' },
          sshKey: { title: 'SSH private key' },
          usernamePassword: { title: 'Username + password' }
        },
        secretLabels: { password: 'Password', sshKey: 'SSH private key' },
        placeholders: {
          apiKey: 'Enter API Key',
          bearer: 'Enter Bearer Token',
          password: 'Enter login password',
          sshKey: 'Paste PEM private key'
        },
        messages: {
          created: 'Credential created. It can now be selected in workflow variables, SSH nodes, and HTTP nodes.'
        },
        errors: {
          createFailed: 'Failed to create credential',
          loadFailed: 'Failed to load backend credentials',
          missingCreatedId: 'Credential creation did not return a valid ID'
        }
      }
    }
  },
  monitoring: {
    actions: {
      add: 'Add monitor',
      probe: 'Probe sites',
      probing: 'Probing...',
      refresh: 'Refresh data',
      refreshing: 'Refreshing...',
      remove: 'Remove'
    },
    errors: {
      addFailed: 'Failed to add monitor target',
      deleteFailed: 'Failed to delete monitor target',
      invalidTarget: 'The backend returned an invalid monitor target',
      loadFailed: 'Failed to load monitoring data',
      probeFailed: 'Probe request failed',
      updateIntervalFailed: 'Failed to update probe interval'
    },
    empty: {
      actualCertificate: 'No observed TLS certificate yet. HTTPS targets collect certificate information automatically during site probes.',
      description: 'Add a monitor from the top right. The system will probe the site on schedule and collect certificate information.',
      noAddableAssets: 'No application assets can be added. Adjust existing target probe intervals in the detail view.',
      observedCertificateHistory: 'No bound certificate versions yet. The first certificate collected by a site probe will be retained automatically.',
      probeHistory: 'No probe history.',
      riskEvents: 'No related events.',
      title: 'No monitor targets'
    },
    sections: {
      actualCertificate: 'Current observed site certificate',
      actualCertificateHint: 'Collected automatically during site probes',
      observedCertificateHistory: 'Bound certificate versions',
      observedCertificateHistoryHint: 'Keeps version records as observed TLS certificates change',
      probeHistory: 'Probe history',
      probeHistoryHint: 'Latest 20 backend probe results',
      riskEvents: 'Risk events',
      riskEventsHint: 'Certificate chain, domain, fingerprint, and execution status',
      targets: 'Monitor targets'
    },
    labels: {
      applicationAsset: 'Application asset',
      currentTarget: 'Current target',
      probeInterval: 'Probe interval'
    },
    metrics: {
      availability: 'Availability',
      certificateStatus: 'Certificate status',
      latency: 'Latency',
      observedCertificateChanges: 'Observed certificate changes'
    },
    probe: {
      completed: 'Probe completed',
      emptyHistoryBlock: 'Probe {index}: no probe yet',
      latencyNotCollected: 'Latency not collected',
      recentAria: 'Latest 10 probe results',
      waiting: 'Waiting for site probe'
    },
    status: {
      error: 'Error',
      none: 'Pending',
      ready: 'Healthy',
      warning: 'Warning'
    },
    fallback: {
      noEndpoint: 'No endpoint configured',
      noFingerprint: 'No fingerprint',
      noSummary: 'No summary',
      notCollected: 'Not collected',
      notSelected: 'Not selected',
      unknownAsset: 'Unknown asset',
      unknownCertificate: 'Unknown certificate',
      unknownIssuer: 'Unknown issuer',
      unnamedEvent: 'Unnamed event'
    },
    certificate: {
      actualCertificate: 'Observed certificate',
      chainUntrusted: 'Not trusted by the system trust chain',
      chainVerification: 'Chain verification',
      chainVerified: 'Chain verified',
      chainVerifyFailedWithReason: 'Chain verification failed: {reason}',
      collectedAt: 'Collected at',
      issuer: 'Issuer',
      serialNumber: 'Serial number',
      sha256Fingerprint: 'SHA-256 fingerprint',
      subject: 'Subject',
      validity: 'Validity',
      validityRange: '{start} to {end}'
    },
    columns: {
      certificateName: 'Certificate name',
      changedAt: 'Changed at',
      expiresAt: 'Expires at',
      issuerName: 'Issuer name',
      latency: 'Latency',
      result: 'Result',
      source: 'Source',
      status: 'Status',
      time: 'Time'
    },
    dialog: {
      defaultMetricsHint: 'Availability, latency, certificate information, and certificate history are monitored by default.',
      description: 'Select a target from application assets. The system will collect availability, latency, certificate information, and certificate history.',
      loadingAssets: 'Loading assets...',
      selectAsset: 'Select application asset',
      title: 'Add monitor'
    },
    source: {
      controlPlane: 'Control plane'
    },
    targets: {
      assetCount: '{count} assets'
    }
  },
  errors: { forbiddenTitle: '403 Forbidden', forbiddenMessage: 'You do not have permission to access this page.', missingPermission: 'Missing permission: {permission}', notFoundTitle: '404 Not Found', notFoundMessage: 'This route is not registered.', backDashboard: 'Back to dashboard' }
}

const jaJP = {
  ...zhCN,
  app: { brand: 'GCAC コンソール', platform: '企業向け SSL 証明書ライフサイクル管理平台', defaultBreadcrumb: 'コンソール', dashboard: 'ダッシュボード' },
  common: { ...enUS.common, refresh: '更新', logout: 'ログアウト', enter: '開く' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: '{action}を確認', impactCount: '影響を受けるリソース数：{count}', defaultRisk: 'この操作はデプロイ、再試行、ロールバック、または不可逆な変更を引き起こす可能性があります。', typeToConfirm: '確認のため {text} を入力', cancel: 'キャンセル', confirm: '確認' },
    dataTable: { empty: 'データがありません', loading: '読み込み中...' },
    dryRunChecklist: { title: 'Dry-run 事前チェック結果', ariaLabel: 'dry-run 事前チェック結果', empty: 'dry-run 事前チェック結果はまだ生成されていません。', unnamedCheck: '無名のチェック項目' },
    dryRunResult: { title: 'Dry-run 実行結果', close: '閉じる' },
    modal: { closeAria: 'モーダルを閉じる' },
    secretInput: { label: 'Secret 参照', placeholder: 'SecretRef を選択または入力。平文は保存しません', hint: '機密フィールドは参照のみを保存し、ブラウザーに長期の平文保存はしません。' },
    riskBadge: { levelPrefix: 'レベル：' },
    status: enUS.designSystem.status,
    risk: enUS.designSystem.risk,
    capability: { available: '利用可能', missing: '不足', title: '能力互換性', description: 'バックエンド capability API で確認できる結果のみを表示します。不明な項目を成功扱いにはしません。', matrixLabel: '能力互換性マトリクス', satisfied: '満たす', unknown: '不明', manualRisk: '手動確認', empty: 'capability データがありません。フロントエンドは縮退表示を維持します。' },
    executionLogViewer: enUS.designSystem.executionLogViewer,
    executionProgress: enUS.designSystem.executionProgress,
    deploymentWizard: enUS.designSystem.deploymentWizard
  },
  shell: enUS.shell,
  api: enUS.api,
  auth: enUS.auth,
  preferences: { ...enUS.preferences, theme: 'テーマ', language: '言語', themeLight: 'ライト', themeDark: 'ダーク', title: '表示設定' },
  userMenu: { ...enUS.userMenu, currentUser: '現在のユーザー', changePassword: 'パスワード変更', logout: 'ログアウト' },
  password: { ...enUS.password, title: 'パスワード変更', current: '現在のパスワード', new: '新しいパスワード', confirm: '新しいパスワードの確認', cancel: 'キャンセル', submit: '保存' },
  nav: enUS.nav,
  routes: enUS.routes,
  businessPage: enUS.businessPage,
  executionDetail: enUS.executionDetail,
  executions: enUS.executions,
  plugins: enUS.plugins,
  deploymentPlans: enUS.deploymentPlans,
  agents: enUS.agents,
  dashboard: enUS.dashboard,
  gateways: enUS.gateways,
  auditFormat: enUS.auditFormat,
  audit: enUS.audit,
  securityAdmin: enUS.securityAdmin,
  settings: enUS.settings,
  bindings: enUS.bindings,
  assets: enUS.assets,
  certificates: enUS.certificates,
  workflows: enUS.workflows,
  monitoring: enUS.monitoring,
  errors: { ...enUS.errors, forbiddenTitle: '403 権限がありません', notFoundTitle: '404 ページがありません', backDashboard: 'ダッシュボードへ戻る' }
}

const frFR = {
  ...zhCN,
  app: { brand: 'Console GCAC', platform: 'Plateforme de cycle de vie des certificats SSL', defaultBreadcrumb: 'Console', dashboard: 'Tableau de bord' },
  common: { ...enUS.common, refresh: 'Actualiser', logout: 'Déconnexion', enter: 'Ouvrir' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: 'Confirmer {action}', impactCount: 'Ressources affectées : {count}', defaultRisk: 'Cette opération peut déclencher un déploiement, une nouvelle tentative, un retour arrière ou des changements irréversibles.', typeToConfirm: 'Saisissez {text} pour confirmer', cancel: 'Annuler', confirm: 'Confirmer' },
    dataTable: { empty: 'Aucune donnée', loading: 'Chargement...' },
    dryRunChecklist: { title: 'Résultats de précontrôle dry-run', ariaLabel: 'résultats de précontrôle dry-run', empty: 'Aucun résultat de précontrôle dry-run n’a encore été généré.', unnamedCheck: 'Contrôle sans nom' },
    dryRunResult: { title: 'Résultat d’exécution dry-run', close: 'Fermer' },
    modal: { closeAria: 'Fermer la fenêtre modale' },
    secretInput: { label: 'Référence Secret', placeholder: 'Sélectionnez ou saisissez un SecretRef. Le texte clair n’est pas enregistré', hint: 'Les champs sensibles ne stockent que des références et ne conservent pas de texte clair durable dans le navigateur.' },
    riskBadge: { levelPrefix: 'Niveau : ' },
    status: enUS.designSystem.status,
    risk: enUS.designSystem.risk,
    capability: { available: 'Disponible', missing: 'Manquant', title: 'Compatibilité des capacités', description: 'Seuls les résultats confirmés par l’API capability du backend sont affichés ; les éléments inconnus ne sont pas considérés comme réussis.', matrixLabel: 'Matrice de compatibilité des capacités', satisfied: 'Satisfait', unknown: 'Inconnu', manualRisk: 'Vérification manuelle', empty: 'Aucune donnée capability. Le frontend conserve un affichage dégradé.' },
    executionLogViewer: enUS.designSystem.executionLogViewer,
    executionProgress: enUS.designSystem.executionProgress,
    deploymentWizard: enUS.designSystem.deploymentWizard
  },
  shell: enUS.shell,
  api: enUS.api,
  auth: enUS.auth,
  preferences: { ...enUS.preferences, theme: 'Thème', language: 'Langue', themeLight: 'Clair', themeDark: 'Sombre', title: 'Préférences d’affichage' },
  userMenu: { ...enUS.userMenu, currentUser: 'Utilisateur courant', changePassword: 'Modifier le mot de passe', logout: 'Déconnexion' },
  password: { ...enUS.password, title: 'Modifier le mot de passe', current: 'Mot de passe actuel', new: 'Nouveau mot de passe', confirm: 'Confirmer le mot de passe', cancel: 'Annuler', submit: 'Enregistrer' },
  nav: enUS.nav,
  routes: enUS.routes,
  businessPage: enUS.businessPage,
  executionDetail: enUS.executionDetail,
  executions: enUS.executions,
  plugins: enUS.plugins,
  deploymentPlans: enUS.deploymentPlans,
  agents: enUS.agents,
  dashboard: enUS.dashboard,
  gateways: enUS.gateways,
  auditFormat: enUS.auditFormat,
  audit: enUS.audit,
  securityAdmin: enUS.securityAdmin,
  settings: enUS.settings,
  bindings: enUS.bindings,
  assets: enUS.assets,
  certificates: enUS.certificates,
  workflows: enUS.workflows,
  monitoring: enUS.monitoring,
  errors: { ...enUS.errors, forbiddenTitle: '403 Accès refusé', notFoundTitle: '404 Page introuvable', backDashboard: 'Retour au tableau de bord' }
}

const ruRU = {
  ...zhCN,
  app: { brand: 'Консоль GCAC', platform: 'Платформа управления жизненным циклом SSL-сертификатов', defaultBreadcrumb: 'Консоль', dashboard: 'Панель' },
  common: { ...enUS.common, refresh: 'Обновить', logout: 'Выйти', enter: 'Открыть' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: 'Подтвердить {action}', impactCount: 'Затронуто ресурсов: {count}', defaultRisk: 'Эта операция может запустить развертывание, повтор, откат или необратимые изменения.', typeToConfirm: 'Введите {text} для подтверждения', cancel: 'Отмена', confirm: 'Подтвердить' },
    dataTable: { empty: 'Нет данных', loading: 'Загрузка...' },
    dryRunChecklist: { title: 'Результаты dry-run проверки', ariaLabel: 'результаты dry-run проверки', empty: 'Результаты dry-run проверки еще не сформированы.', unnamedCheck: 'Проверка без имени' },
    dryRunResult: { title: 'Результат выполнения dry-run', close: 'Закрыть' },
    modal: { closeAria: 'Закрыть модальное окно' },
    secretInput: { label: 'Ссылка Secret', placeholder: 'Выберите или введите SecretRef. Открытый текст не сохраняется', hint: 'Чувствительные поля хранят только ссылки и не сохраняются в браузере как открытый текст.' },
    riskBadge: { levelPrefix: 'Уровень: ' },
    status: enUS.designSystem.status,
    risk: enUS.designSystem.risk,
    capability: { available: 'Доступно', missing: 'Отсутствует', title: 'Совместимость возможностей', description: 'Показаны только результаты, подтвержденные backend API capability; неизвестные элементы не считаются успешными.', matrixLabel: 'Матрица совместимости возможностей', satisfied: 'Выполнено', unknown: 'Неизвестно', manualRisk: 'Ручная проверка', empty: 'Нет данных capability. Фронтенд сохраняет упрощенное отображение.' },
    executionLogViewer: enUS.designSystem.executionLogViewer,
    executionProgress: enUS.designSystem.executionProgress,
    deploymentWizard: enUS.designSystem.deploymentWizard
  },
  shell: enUS.shell,
  api: enUS.api,
  auth: enUS.auth,
  preferences: { ...enUS.preferences, theme: 'Тема', language: 'Язык', themeLight: 'Светлая', themeDark: 'Темная', title: 'Настройки отображения' },
  userMenu: { ...enUS.userMenu, currentUser: 'Текущий пользователь', changePassword: 'Сменить пароль', logout: 'Выйти' },
  password: { ...enUS.password, title: 'Сменить пароль', current: 'Текущий пароль', new: 'Новый пароль', confirm: 'Подтвердите пароль', cancel: 'Отмена', submit: 'Сохранить' },
  nav: enUS.nav,
  routes: enUS.routes,
  businessPage: enUS.businessPage,
  executionDetail: enUS.executionDetail,
  executions: enUS.executions,
  plugins: enUS.plugins,
  deploymentPlans: enUS.deploymentPlans,
  agents: enUS.agents,
  dashboard: enUS.dashboard,
  gateways: enUS.gateways,
  auditFormat: enUS.auditFormat,
  audit: enUS.audit,
  securityAdmin: enUS.securityAdmin,
  settings: enUS.settings,
  bindings: enUS.bindings,
  assets: enUS.assets,
  certificates: enUS.certificates,
  workflows: enUS.workflows,
  monitoring: enUS.monitoring,
  errors: { ...enUS.errors, forbiddenTitle: '403 Нет доступа', notFoundTitle: '404 Страница не найдена', backDashboard: 'Вернуться на панель' }
}

const ptBR = {
  ...zhCN,
  app: { brand: 'Console GCAC', platform: 'Plataforma de ciclo de vida de certificados SSL corporativos', defaultBreadcrumb: 'Console', dashboard: 'Painel' },
  common: { ...enUS.common, refresh: 'Atualizar', logout: 'Sair', enter: 'Abrir' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: 'Confirmar {action}', impactCount: 'Recursos afetados: {count}', defaultRisk: 'Esta operação pode acionar implantação, nova tentativa, rollback ou alterações irreversíveis.', typeToConfirm: 'Digite {text} para confirmar', cancel: 'Cancelar', confirm: 'Confirmar' },
    dataTable: { empty: 'Sem dados', loading: 'Carregando...' },
    dryRunChecklist: { title: 'Resultados de pré-verificação dry-run', ariaLabel: 'resultados de pré-verificação dry-run', empty: 'Nenhum resultado de pré-verificação dry-run foi gerado.', unnamedCheck: 'Verificação sem nome' },
    dryRunResult: { title: 'Resultado da execução dry-run', close: 'Fechar' },
    modal: { closeAria: 'Fechar modal' },
    secretInput: { label: 'Referência Secret', placeholder: 'Selecione ou insira um SecretRef. Texto puro não é salvo', hint: 'Campos sensíveis armazenam apenas referências e não ficam salvos em texto puro no navegador.' },
    riskBadge: { levelPrefix: 'Nível: ' },
    status: enUS.designSystem.status,
    risk: enUS.designSystem.risk,
    capability: { available: 'Disponível', missing: 'Ausente', title: 'Compatibilidade de capacidades', description: 'Somente resultados confirmados pela API capability do backend são exibidos; itens desconhecidos não são tratados como sucesso.', matrixLabel: 'Matriz de compatibilidade de capacidades', satisfied: 'Atendido', unknown: 'Desconhecido', manualRisk: 'Revisão manual', empty: 'Sem dados de capability. O frontend mantém uma exibição degradada.' },
    executionLogViewer: enUS.designSystem.executionLogViewer,
    executionProgress: enUS.designSystem.executionProgress,
    deploymentWizard: enUS.designSystem.deploymentWizard
  },
  shell: enUS.shell,
  api: enUS.api,
  auth: enUS.auth,
  preferences: { ...enUS.preferences, theme: 'Tema', language: 'Idioma', themeLight: 'Claro', themeDark: 'Escuro', title: 'Preferências de exibição' },
  userMenu: { currentUser: 'Usuário atual', changePassword: 'Alterar senha', logout: 'Sair' },
  password: { title: 'Alterar senha', description: 'Altere a senha local do usuário conectado.', current: 'Senha atual', new: 'Nova senha', confirm: 'Confirmar nova senha', cancel: 'Cancelar', submit: 'Salvar senha', submitting: 'Salvando…', success: 'Senha atualizada', failed: 'Falha ao alterar a senha', mismatch: 'As novas senhas não coincidem', tooShort: 'A nova senha deve ter pelo menos 8 caracteres' },
  nav: enUS.nav,
  routes: enUS.routes,
  businessPage: enUS.businessPage,
  executionDetail: enUS.executionDetail,
  executions: enUS.executions,
  plugins: enUS.plugins,
  deploymentPlans: enUS.deploymentPlans,
  agents: enUS.agents,
  dashboard: enUS.dashboard,
  gateways: enUS.gateways,
  auditFormat: enUS.auditFormat,
  audit: enUS.audit,
  securityAdmin: enUS.securityAdmin,
  settings: enUS.settings,
  bindings: enUS.bindings,
  assets: enUS.assets,
  certificates: enUS.certificates,
  workflows: enUS.workflows,
  monitoring: enUS.monitoring,
  errors: { ...enUS.errors, forbiddenTitle: '403 Sem permissão', notFoundTitle: '404 Página não encontrada', backDashboard: 'Voltar ao painel' }
}

const koKR = {
  ...zhCN,
  app: { brand: 'GCAC 콘솔', platform: '엔터프라이즈 SSL 인증서 수명 주기 관리 플랫폼', defaultBreadcrumb: '콘솔', dashboard: '대시보드' },
  common: { ...enUS.common, refresh: '새로고침', logout: '로그아웃', enter: '열기' },
  designSystem: {
    ...zhCN.designSystem,
    confirm: { title: '{action} 확인', impactCount: '영향 받는 리소스 수: {count}', defaultRisk: '이 작업은 배포, 재시도, 롤백 또는 되돌릴 수 없는 변경을 유발할 수 있습니다.', typeToConfirm: '확인을 위해 {text} 입력', cancel: '취소', confirm: '확인' },
    dataTable: { empty: '데이터 없음', loading: '로딩 중...' },
    dryRunChecklist: { title: 'Dry-run 사전 점검 결과', ariaLabel: 'dry-run 사전 점검 결과', empty: '아직 dry-run 사전 점검 결과가 생성되지 않았습니다.', unnamedCheck: '이름 없는 점검 항목' },
    dryRunResult: { title: 'Dry-run 실행 결과', close: '닫기' },
    modal: { closeAria: '모달 닫기' },
    secretInput: { label: 'Secret 참조', placeholder: 'SecretRef 를 선택하거나 입력하세요. 평문은 저장하지 않습니다', hint: '민감 필드는 참조만 저장하며 브라우저에 장기 평문으로 저장하지 않습니다.' },
    riskBadge: { levelPrefix: '수준: ' },
    status: enUS.designSystem.status,
    risk: enUS.designSystem.risk,
    capability: { available: '사용 가능', missing: '누락', title: '기능 호환성', description: '백엔드 capability API 로 확인된 결과만 표시하며, 알 수 없는 항목을 성공으로 처리하지 않습니다.', matrixLabel: '기능 호환성 매트릭스', satisfied: '충족', unknown: '알 수 없음', manualRisk: '수동 확인', empty: 'capability 데이터가 없습니다. 프론트엔드는 축소 표시를 유지합니다.' },
    executionLogViewer: enUS.designSystem.executionLogViewer,
    executionProgress: enUS.designSystem.executionProgress,
    deploymentWizard: enUS.designSystem.deploymentWizard
  },
  shell: enUS.shell,
  api: enUS.api,
  auth: enUS.auth,
  preferences: { ...enUS.preferences, theme: '테마', language: '언어', themeLight: '라이트', themeDark: '다크', title: '표시 설정' },
  userMenu: { ...enUS.userMenu, currentUser: '현재 사용자', changePassword: '비밀번호 변경', logout: '로그아웃' },
  password: { ...enUS.password, title: '비밀번호 변경', current: '현재 비밀번호', new: '새 비밀번호', confirm: '새 비밀번호 확인', cancel: '취소', submit: '저장' },
  nav: enUS.nav,
  routes: enUS.routes,
  businessPage: enUS.businessPage,
  executionDetail: enUS.executionDetail,
  executions: enUS.executions,
  plugins: enUS.plugins,
  deploymentPlans: enUS.deploymentPlans,
  agents: enUS.agents,
  dashboard: enUS.dashboard,
  gateways: enUS.gateways,
  auditFormat: enUS.auditFormat,
  audit: enUS.audit,
  securityAdmin: enUS.securityAdmin,
  settings: enUS.settings,
  bindings: enUS.bindings,
  assets: enUS.assets,
  certificates: enUS.certificates,
  workflows: enUS.workflows,
  monitoring: enUS.monitoring,
  errors: { ...enUS.errors, forbiddenTitle: '403 권한 없음', notFoundTitle: '404 페이지 없음', backDashboard: '대시보드로 돌아가기' }
}

export const messages: Record<SupportedLocale, typeof zhCN> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'pt-BR': ptBR,
  'ko-KR': koKR
}


// Export raw locale objects for extraction scripts
export { zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR }
