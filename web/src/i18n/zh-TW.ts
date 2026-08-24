// GCAC 国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { devicesZhTW } from './devices.locale'
import { caOperationsZhTW } from './ca-operations.locale'
import { credentialsZhTW } from './credentials.locale'
import { acmeZhTW } from './acme.locale'
import { providersZhTW } from './providers.locale'
import { monitoringTlsZhTW } from './monitoring-tls.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
export default {
  credentials: credentialsZhTW,
  devices: devicesZhTW,
  caOperations: caOperationsZhTW,
  acme: acmeZhTW,
  providers: providersZhTW,
  app: {
    brand: "GCAC 控制台",
    platform: "企業 SSL 憑證生命週期管理平台",
    defaultBreadcrumb: "控制台",
    dashboard: "儀表板",
    versionLabel: "版本 {version}"
  },
  common: {
    refresh: "重新整理",
    logout: "登出",
    enter: "進入",
    loading: "載入中",
    actions: { done: "完成" },
    cancel: "取消",
    save: "儲存",
    edit: "編輯",
    delete: "刪除",
    notAvailable: "暫無",
    close: "關閉",
    unknownError: "未知錯誤",
    userFallback: "未登入使用者",
    tenantFallback: "預設租戶"
  },
  api: {
    errors: {
      requestFailed: "請求失敗"
    }
  },
  auth: {
    errors: {
      missingSession: "登入失敗，未取得有效工作階段"
    },
    mock: {
      displayName: "系統使用者（Mock）"
    }
  },
  designSystem: {
    confirm: {
      title: "確認{action}",
      impactCount: "影響資源數量：{count}",
      defaultRisk: "該操作可能觸發部署、重試、復原或不可逆變更。",
      typeToConfirm: "輸入 {text} 二次確認",
      cancel: "取消",
      confirm: "確認"
    },
    dataTable: {
      empty: "暫無資料",
      loading: "載入中..."
    },
    dryRunChecklist: {
      title: "Dry-run 預檢結論",
      ariaLabel: "dry-run 預檢結論",
      empty: "尚未產生 dry-run 預檢結果。",
      unnamedCheck: "未命名檢查項"
    },
    dryRunResult: {
      title: "Dry-run 執行結果",
      close: "關閉"
    },
    modal: {
      closeAria: "關閉彈出視窗"
    },
    toast: {
      close: "關閉"
    },
    drawer: {
      closeAria: "關閉抽屜"
    },
    secretInput: {
      label: "Secret 引用",
      placeholder: "選擇或輸入密文引用（SecretRef），內容不會明文儲存",
      hint: "敏感欄位僅儲存密文引用，不會在介面明文展示。"
    },
    riskBadge: {
      levelPrefix: "級別："
    },
    status: {
      DRAFT: "草稿",
      PUBLISHED: "已釋出",
      PENDING_APPROVAL: "待審核",
      READY: "待執行",
      RUNNING: "執行中",
      SUCCESS: "成功",
      PARTIAL_SUCCESS: "部分成功",
      FAILED: "失敗",
      CANCELLED: "已取消",
      ROLLED_BACK: "已復原",
      DISCOVERED: "已發現",
      MANAGED: "已納管",
      DRIFTED: "已漂移",
      EXPIRED: "已過期",
      ERROR: "異常",
      IGNORED: "已忽略",
      ONLINE: "線上",
      OFFLINE: "離線",
      ACTIVE: "已啟用",
      DISABLED: "已停用",
      OPEN: "未解決",
      ACKED: "已確認",
      RESOLVED: "已解決",
      UPGRADING: "升級中",
      UPDATE_REQUIRED: "需更新",
      UP_TO_DATE: "已最新",
      UNKNOWN: "未知"
    },
    risk: {
      LOW: {
        label: "低",
        description: "需要關注，但不會直接阻斷操作。"
      },
      MEDIUM: {
        label: "中",
        description: "可能影響部署或監控結果，需要確認。"
      },
      HIGH: {
        label: "高",
        description: "可能導致服務中斷或安全暴露。"
      },
      CRITICAL: {
        label: "嚴重",
        description: "必須優先處理，危險操作需二次確認。"
      }
    },
    capability: {
      available: "具備",
      missing: "缺少",
      title: "能力相容性",
      description: "僅展示已確認的能力相容性結果，未確認項不視為支援。",
      matrixLabel: "能力相容性矩陣",
      satisfied: "滿足",
      unknown: "未知",
      manualRisk: "人工確認",
      empty: "暫無能力相容性資料。"
    },
    executionLogViewer: {
      mode: {
        realtime: "即時更新",
        autoRefresh: "自動重新整理"
      },
      search: {
        placeholder: "搜尋記錄內容"
      },
      level: {
        aria: "記錄級別",
        all: "全部"
      },
      actions: {
        showAll: "顯示全部 {count} 條",
        showRecent: "只顯示最近 {count} 條"
      },
      hint: {
        streaming: "任務狀態與記錄會持續即時更新。",
        autoRefresh: "任務狀態與記錄會自動重新整理。",
        pollingFallback: "目前使用定時重新整理模式。",
        limited: "已顯示最近 {visible} 條記錄，共 {total} 條。"
      },
      steps: {
        aria: "執行步驟",
        emptyDetail: "暫無步驟說明"
      },
      empty: {
        logs: "暫無記錄。"
      }
    },
    executionProgress: {
      aria: {
        progressOverview: "執行進度總覽",
        taskList: "任務列表",
        latestEvents: "最新事件",
        executionLog: "執行記錄"
      },
      checklist: {
        title: "檢查結論"
      },
      detail: {
        stepsCompleted: "{completed}/{total} 步驟已完成",
        summaryFailed: "{total} 項檢查結果已返回，{failed} 項失敗",
        summaryPassed: "{passed} 項檢查全部通過",
        summaryReturned: "{total} 項檢查結果已返回",
        summaryWarning: "{total} 項檢查結果已返回，{warning} 項警告",
        waitingStart: "等待任務開始執行",
        waitingSteps: "等待執行步驟…"
      },
      empty: {
        activity: "執行記錄將在任務完成後逐步顯示。",
        events: "暫無事件記錄。",
        tasks: "任務尚未建立，等待執行步驟…"
      },
      event: {
        collapse: "收起事件",
        defaultLabel: "事件",
        defaultTitle: "任務事件",
        expand: "展開事件",
        waitingDetail: "等待事件記錄"
      },
      feed: {
        completed: "執行完成",
        failed: "執行失敗",
        skipped: "已跳過",
        warning: "完成，帶警告"
      },
      loading: {
        pollingFallback: "正在定時重新整理…",
        refreshing: "重新整理中"
      },
      log: {
        collapse: "收起完整記錄",
        expand: "檢視完整記錄"
      },
      metrics: {
        completed: "已完成",
        failed: "失敗",
        passed: "通過",
        queued: "排隊中",
        running: "執行中",
        totalTasks: "總任務",
        unknown: "未知",
        warning: "警告"
      },
      process: {
        dryRun: "更新檢查",
        execution: "執行"
      },
      operation: {
        prepare: "檢查憑證材料與目標狀態，為更新做好準備。",
        backup: "保存目前狀態，確保需要時可以安全還原。",
        update: "將新憑證安全套用到目標服務。",
        reload: "讓服務載入新憑證，並等待運行狀態穩定。",
        verify: "檢查服務是否已正確使用新憑證。",
        rollback: "還原更新前的憑證與服務狀態。"
      },
      progress: {
        completed: "全部完成",
        failed: "已完成，存在失敗項",
        pending: "等待結果回寫",
        processFailed: "{process} 失敗",
        queued: "等待排程",
        running: "任務推進中",
        warning: "已完成，存在風險提示"
      },
      section: {
        completedCount: "{completed}/{total} 已完成",
        executionLog: "執行記錄",
        latestEvents: "最新事件",
        taskProgress: "任務進度"
      },
      status: {
        completed: "已完成",
        failed: "失敗",
        queued: "等待中",
        running: "執行中",
        skipped: "已跳過",
        warning: "有警告"
      },
      step: {
        backup: "前置備份",
        discover: "環境識別",
        prepare: "憑證準備",
        installDryRun: "材料準備",
        installExecution: "憑證安裝",
        updateDryRun: "更新檢查",
        updateExecution: "憑證更新",
        reload: "服務重新整理",
        verify: "結果驗證"
      },
      subtitle: {
        completed: "任務已完成。",
        failed: "任務已結束，但返回了失敗結果。",
        failedFriendly: "此步驟未能完成，請展開詳細記錄查看原因。",
        failedChecks: "{total} 項檢查，{failed} 項失敗",
        passedChecks: "{total} 項檢查通過",
        queued: "任務已建立，等待執行。",
        running: "任務已開始，等待執行結果。",
        runningChecks: "已返回 {total} 項檢查",
        skipped: "此步驟已跳過，不會繼續等待。",
        warningChecks: "{total} 項檢查，{warning} 項警告"
      },
      time: {
        waitingStart: "等待開始"
      }
    },
    deploymentWizard: {
      actions: {
        cancel: "取消",
        dryRun: "先做 Dry-run",
        next: "下一步",
        previous: "上一步",
        save: "儲存計畫"
      },
      aria: {
        steps: "部署步驟",
        wizard: "部署精靈"
      },
      capability: {
        targetMissingDetail: "尚未選擇部署目標。",
        targetSelectedDetail: "已選擇部署目標，建議先完成 dry-run 再提交執行。",
        targetSelection: "部署目標選擇",
        targetSource: "部署目標"
      },
      checks: {
        failed: "失敗 {count}",
        passed: "通過 {count}",
        unknown: "未知 {count}",
        unnamed: "未命名檢查項",
        warning: "警告 {count}"
      },
      empty: {
        noTargets: "暫無可選應用資產目標",
        selectTarget: "請選擇一個應用資產部署目標。"
      },
      fallback: {
        generatedByApplicationEntry: "按應用入口產生",
        missingBinding: "未提供繫結資訊",
        unboundCertificateVariable: "未繫結憑證變數",
        unconfigured: "未設定",
        unconfiguredRunner: "未設定執行位置",
        unknownEnd: "未知結束",
        unknownStart: "未知開始",
        unnamedSite: "未命名站點",
        unnamedVersion: "未命名版本",
        unrecognizedManagedTarget: "未識別受管目標",
        unselected: "未選擇",
        unselectedVersion: "未選擇版本",
        unselectedWorkflow: "未選擇工作流"
      },
      fields: {
        applicationTarget: "應用資產部署目標",
        artifactConfig: "產物設定",
        binding: "繫結",
        certificateAsset: "憑證資產",
        certificateVariable: "憑證變數",
        certificateVersion: "憑證版本",
        deploymentTarget: "部署目標",
        keyword: "關鍵字搜尋",
        managedTarget: "受管目標",
        runner: "執行位置",
        site: "站點",
        verifyUrl: "驗證 URL",
        version: "版本",
        workflow: "工作流"
      },
      panels: {
        certificateTitle: "1. 憑證材料",
        submitTitle: "3. 預檢與提交",
        targetTitle: "2. 部署目標"
      },
      panelState: {
        needPrerequisites: "待完成前置選擇",
        operable: "可操作",
        pending: "待完成",
        readyNext: "可進入下一步"
      },
      placeholders: {
        selectTarget: "請選擇應用資產目標",
        targetKeyword: "按域名、站點、繫結資訊搜尋"
      },
      plan: {
        dryRunCompleted: "最近一次 dry-run 已完成。",
        submitCompleted: "最近一次提交已完成。"
      },
      preview: {
        needCertificate: "先完成憑證材料選擇。",
        needTarget: "完成憑證材料選擇後，再指定要下發的應用資產目標。",
        ready: "將把已選憑證版本部署到 {count} 個應用資產目標。"
      },
      status: {
        checksReturned: "預檢結果已返回，可根據結果決定儲存、提交或直接執行。",
        current: "目前狀態",
        default: "建議先啟動 dry-run，再決定是否提交執行。",
        dryRunStarted: "預檢已啟動，請在執行結果區檢視進度。",
        submitted: "計畫已提交。"
      },
      steps: {
        certificate: {
          description: "憑證資產與版本",
          title: "選擇憑證材料"
        },
        submit: {
          description: "Dry-run、儲存、提交、執行",
          title: "預檢並提交"
        },
        target: {
          description: "應用資產、站點與繫結",
          title: "選擇部署目標"
        }
      },
      stepState: {
        active: "進行中",
        done: "已完成",
        pending: "待開始"
      },
      target: {
        workflowMode: "工作流模式",
        workflowModeWithName: "工作流模式（{name}）"
      },
      version: {
        autoLatest: "自動選擇最新可部署版本（目前：{current}）",
        noDeployableVersion: "目前暫無可部署憑證版本",
        range: "{id} ({notBefore} ~ {notAfter})"
      },
      currentStep: "步驟 {current} / {total}",
      selectedTargetCount: "已選 {count} 個目標",
      subtitle: "分步驟完成部署計畫設定",
      title: "部署精靈"
    }
  },
  tasks: {
      title: "全域任務",
      description: "查看目前租戶中的排隊、執行、監控與系統任務。",
      quick: { active: "活動任務", recent: "最近完成" },
      tabs: { all: "全部任務", execution: "執行任務", monitoring: "監控任務", system: "系統任務", other: "其他任務" },
    aria: { openDrawer: "開啟全域任務", tabs: "任務分類" },
    filters: {
      includeAll: "顯示全部任務",
      keyword: "搜尋任務、錯誤或 ID",
      taskType: "任務類型",
      status: "狀態",
      allStatuses: "全部狀態",
      resourceType: "資源類型",
      resourceId: "資源 ID",
      requestedBy: "發起使用者",
      taskId: "任務 ID",
      createdFrom: "開始時間",
      createdTo: "結束時間"
    },
    fields: { requestedBy: "發起使用者", triggerSource: "觸發來源", createdAt: "建立時間", startedAt: "開始時間", finishedAt: "結束時間", error: "最後錯誤" },
    sections: { timeline: "狀態時間線", attempts: "嘗試記錄", logs: "日誌", children: "子任務", errors: "錯誤", audit: "稽核事件", monitoringProbes: "探測記錄" },
    actions: { backToList: "返回任務列表", viewAll: "查看所有任務", search: "搜尋", reset: "重設", previousPage: "上一頁", nextPage: "下一頁" },
    messages: { loadFailed: "任務列表載入失敗。", detailFailed: "任務詳情載入失敗。" },
    values: { system: "系統", empty: "暫無記錄", none: "無" },
    relatedNames: { builtinCatalog: "內建外掛目錄", deploymentPlan: "部署計畫" },
    typeLabels: {
      ACME_CERTIFICATE_ISSUE: "ACME簽發",
      ACME_CERTIFICATE_RENEWAL: "ACME續簽",
      ACME_CHALLENGE: "ACME挑戰",
      CERTIFICATE_DRY_RUN: "證書Dry-run",
      CERTIFICATE_DEPLOY: "證書部署",
      CERTIFICATE_VERIFY: "證書驗證",
      CERTIFICATE_ROLLBACK: "證書回滾",
      PROVIDER_OPERATION: "雲服務操作",
      AGENT_INSTALL: "Agent安裝",
      AGENT_UPDATE: "Agent更新",
      AGENT_CAPABILITY_RESCAN: "Agent能力重掃",
      PLUGIN_REFERENCE_REFRESH: "外掛引用刷新",
      DEPLOYMENT_PLAN_REFRESH: "部署計畫刷新",
      MONITORING_BATCH: "監控批次",
      MONITORING_PROBE: "監控探測",
      CA_NODE_TASK: "CA節點任務",
      CA_RECORD_SYNC: "CA記錄同步",
      CERTIFICATE_REVOCATION: "證書吊銷",
      CRL_PUBLISH: "CRL發布",
      TRUST_DISTRIBUTION: "信任分發",
      GATEWAY_DELEGATION: "閘道委派",
      WORKFLOW_RUN: "工作流程執行",
      AUTOMATION_RUN: "自動化執行",
      REPORT_EXPORT: "報表匯出",
      NOTIFICATION_DELIVERY: "通知投遞",
      OTHER: "其他任務"
    },
    summaryTemplates: {
      QUEUED: "{task}已入列",
      RUNNING: "{task}執行中",
      RETRY_WAITING: "{task}等待重試",
      CANCELLING: "{task}取消中",
      SUCCEEDED: "已完成{task}",
      FAILED: "{task}執行失敗",
      CANCELLED: "{task}已取消"
    },
    status: { QUEUED: "排隊中", RUNNING: "執行中", RETRY_WAITING: "等待重試", CANCELLING: "取消中", SUCCEEDED: "成功", FAILED: "失敗", CANCELLED: "已取消" }
  },
  shell: {
    currentLocation: "目前位置",
    breadcrumb: "麵包屑",
    currentGroupNavigation: "目前分群組導航",
    backDashboard: "返回儀表板"
  },
  preferences: {
    theme: "主題",
    language: "語言",
    themeLight: "日間模式",
    themeDark: "夜間模式",
    themeToggle: "切換主題模式",
    languageSelect: "選擇介面語言",
    title: "顯示偏好",
    description: "主題和語言會儲存到目前使用者的後端偏好。",
    errors: {
      loadFailed: "偏好載入失敗",
      saveFailed: "偏好儲存失敗"
    }
  },
  userMenu: {
    currentUser: "目前使用者",
    changePassword: "修改密碼",
    logout: "登出"
  },
  password: {
    title: "修改密碼",
    description: "修改目前登入使用者的本機密碼。",
    current: "目前密碼",
    new: "新密碼",
    confirm: "確認新密碼",
    cancel: "取消",
    submit: "儲存密碼",
    submitting: "正在儲存…",
    success: "密碼已更新",
    failed: "密碼修改失敗",
    mismatch: "兩次輸入的新密碼不一致",
    tooShort: "新密碼長度不能少於 8 位"
  },
  nav: {
    viewMode: {
      switchLabel: 'Application view mode',
      user: 'User view',
      professional: 'Professional view',
      steps: {
        certificates: 'Certificates',
        applications: 'Applications',
        deployments: 'Deployments'
      }
    },
    dashboard: "總覽",
    dashboardDesc: "應用、憑證、Agent、閘道和審計狀態總覽",
    certificates: "憑證",
    certificatesDesc: "憑證庫、繫結關係和到期狀態",
    certificateAssets: "憑證資產",
    certificateAssetsDesc: "憑證、私密金鑰引用、指紋和到期時間",
    certificateFormats: "憑證格式設定",
    certificateFormatsDesc: "為已儲存憑證定義 PFX、CER、CRT、PEM 等格式規則",
    assetCenter: "資產中心",
    assetCenterDesc: "統一管理應用資產、設備資產和雲服務資產",
    assetManagement: "應用管理",
    assets: "應用資產",
    assetsDesc: "域名/IP 維度的應用入口與憑證部署目標",
    devices: "設備",
    agents: "Agent",
    agentsDesc: "線上狀態、心跳和能力集合",
    gateways: "閘道",
    gatewaysDesc: "隔離區閘道、協議和可連線目標",
    deployments: "憑證部署",
    deploymentsDesc: "部署計畫、工作流、自動化和執行記錄",
    deploymentPlans: "部署計畫",
    deploymentPlansDesc: "憑證部署計畫和審核入口",
    executions: "執行記錄",
    executionsDesc: "執行步驟、記錄、失敗和復原",
    workflows: "工作流",
    workflowsDesc: "工作流和外掛",
    workflowTemplates: "工作流",
    workflowTemplatesDesc: "畫布草稿、變數、能力宣告和釋出",
    automations: "自動化",
    automationsDesc: "定時、按需和批次執行憑證更新計畫",
    plugins: "外掛",
    pluginsDesc: "Provider、執行器和沙箱狀態",
    monitoring: "監控",
    monitoringDesc: "警示、審計和憑證狀態",
    monitorAlerts: "監控警示",
    monitorAlertsDesc: "到期、漂移和執行失敗事件",
    monitorTls: "TLS 深度監控",
    monitorTlsDesc: "證書認證路徑、協議套件、相容性模擬與協議細節",
    audits: "審計記錄",
    auditsDesc: "操作證據與合規匯出",
    settings: "設定",
    settingsDesc: "租戶、使用者、權限和系統設定",
    systemSettings: "系統設定",
    systemSettingsDesc: "系統設定和安全後設資料",
    users: "使用者管理",
    usersDesc: "控制台使用者、狀態和角色",
    roles: "權限管理",
    rolesDesc: "角色、授權物件範圍和成員分配",
    identitySources: "身分來源",
    identitySourcesDesc: "AD/LDAP 服務設定",
    groupRoleMappings: "群組角色對映"
  },
  automations: {
    title: "自動化",
    description: "集中管理憑證更新計畫的定時、按需和批次執行。",
    empty: "暫無自動化設定。",
    emptyDescription: "未填寫說明",
    common: { notAvailable: "暫無", allRelated: "全部關聯目標" },
    formStep: { stepProgress: "第 {current} 步，共 {total} 步", previous: "上一步", next: "下一步", reviewTitle: "設定摘要", reviewText: "觸發器：{trigger}；執行範圍：{scope}；憑證網域：{domains}。執行開始後會凍結目標快照。" },
    scheduleBuilder: { api: "透過外部 API 觸發", apiHelp: "儲存後由外部系統呼叫自動化執行 API。每次呼叫仍會執行目標預覽、Dry Run 和審批規則。", once: "在固定時間執行一次", onceHelp: "選擇瀏覽器本地時間。任務執行一次後不會再次排程。", recurring: "定期執行", scheduleHelp: "依計畫週期執行。僅建議用於確實需要持續輪詢的情境。", recurringHelp: "依計畫週期執行。僅建議用於確實需要持續輪詢的情境。", recurringWarningTitle: "憑證更新不建議使用定期執行", recurringWarning: "憑證更新通常應由外部系統在憑證簽發後觸發，或安排一次固定時間執行。只有明確需要週期檢查時才使用此選項。", certificateVersionCreated: "憑證新版本事件", certificateVersionCreatedHelp: "憑證透過 ACME 或匯入產生新版本後，由平台事件觸發自動化。", runAt: "執行時間", frequency: "執行週期", daily: "每天", weekly: "每週", monthly: "每月", time: "執行時刻", weekday: "星期", monthDay: "每月日期", legacyCustom: "保留原有自訂計畫", legacyCron: "原有 Cron（唯讀）", weekdays: { 0: "星期日", 1: "星期一", 2: "星期二", 3: "星期三", 4: "星期四", 5: "星期五", 6: "星期六" } },
    form: { existingAssetTitle: "只更新現有應用資產", existingAssetDescription: "自動化只處理已建立憑證繫結的應用資產，不負責首次安裝憑證或新增部署目標。", certificateDomains: "憑證網域", certificateDomainsPlaceholder: "輸入憑證網域，多個以逗號分隔", certificateDomainsHelp: "只更新這些網域對應憑證的現有應用資產繫結。", versionSelection: "要更新到哪個憑證版本", versionSelectionLatest: "自動使用最新憑證版本", versionSelectionSpecific: "使用指定憑證版本", versionSelectionHelp: "執行開始時解析並凍結版本，執行期間不會因新增版本而改變。", certificateVersionIds: "指定憑證版本", certificateVersionIdsPlaceholder: "輸入憑證版本 ID，多個以逗號分隔", certificateVersionIdsHelp: "每個版本都必須屬於上方選取網域對應的憑證。", versionLoading: "正在載入可選憑證版本。", versionLoadFailed: "憑證版本載入失敗，請稍後再試。", versionEmpty: "找不到這些網域對應的可選憑證版本。", schedule: "何時更新", scheduleHelp: "管理員可按需啟動，也可以依 Cron 和時區定期檢查並更新。", execution: "執行時會做什麼", executionHelp: "系統為每個現有資產繫結建立獨立更新計畫，並重用 DeploymentPlan、Dry Run、審批和 ExecutionRun。", snapshot: "凍結網域、資產和憑證版本快照" },
    fields: { name: "名稱", description: "說明", trigger: "觸發方式", eventSources: "事件來源", eventSourcesHelp: "選擇哪些憑證版本事件可以啟動這條自動化。", targetScope: "更新範圍", selectedAssets: "指定應用資產", selectedAssetsHelp: "請至少選擇一個已納管的應用資產。", certificateTags: "憑證標籤（逗號分隔）", certificateTagsHelp: "依憑證標籤過濾事件或輪詢範圍。", targetEnvironments: "目標環境（逗號分隔）", targetEnvironmentsHelp: "依目標應用環境過濾。", targetOwners: "目標負責人（逗號分隔）", targetOwnersHelp: "依目標負責人過濾。", cron: "Cron 運算式", timeZone: "時區", expiresWithinDays: "到期天數範圍", environments: "目標環境（逗號分隔）", certificateIds: "指定憑證（可選）", certificateIdsPlaceholder: "輸入憑證 ID，多個以逗號分隔", certificateIdsHelp: "填寫後只處理指定憑證；留空則按到期範圍和環境自動匹配。", expiresWithinDaysHelp: "只匹配在此天數內到期的憑證。", environmentsHelp: "只處理這些環境中的憑證，例如 production、staging。", planType: "部署計畫類型", planTypeHelp: "每個命中的憑證目標都會在執行時建立獨立的 DeploymentPlan。", planTypeUpdate: "更新現有憑證繫結", planTypeInstall: "在目標安裝憑證", planTypeVerifyOnly: "只驗證，不變更憑證", planMode: "執行方式", planModeHelp: "自動化不繫結既有計畫；執行時會為每個目標建立新計畫。", planModeCreateAndExecute: "建立計畫並執行", planModeCreateOnly: "只建立計畫，暫不執行", maxTargets: "單次最大目標數", concurrency: "並行數", failureCount: "失敗數量閾值", requireDryRun: "執行前必須完成 Dry Run", requireApproval: "執行前必須審批", startedAt: "開始時間", finishedAt: "結束時間", failureStage: "失敗階段", parentRun: "父執行" },
    actions: { create: "新增自動化", detail: "詳情", edit: "編輯", delete: "刪除", cancel: "取消", save: "儲存", copy: "複製", enable: "啟用", disable: "停用", runNow: "立即執行", preview: "預覽目標", history: "執行歷史", confirmRun: "確認執行", stop: "停止執行", retryFailed: "重試失敗目標", openPlan: "查看部署計畫", openExecution: "查看執行記錄" },
    manualRun: { title: "手動執行", description: "請先選擇一個憑證版本再執行。", versionLabel: "憑證版本", versionPlaceholder: "請選擇憑證版本", help: "執行時會依所選版本所屬的憑證資產解析關聯的應用資產。", empty: "沒有可供手動執行的憑證版本。", stopOnError: "錯誤中斷工作流", dryRun: "先執行 Dry-run", start: "開始執行" },
    columns: { status: "狀態", trigger: "觸發方式", targets: "目標上限", actions: "執行動作", nextRun: "下次執行", lastRun: "最近執行" },
    triggers: { onDemand: "按需執行", schedule: "定時執行" },
    triggerTypes: { on_demand: "按需執行", schedule: "定時執行", certificate_version_created: "憑證新版本事件", retry: "失敗重試" },
    eventSources: { acme: "ACME", manual_import: "手動匯入" },
    targetScopes: { allRelatedAssets: "更新關聯的全部應用資產", allRelatedAssetsHelp: "命中事件或條件後，系統自動解析所有已綁定且可部署的應用資產。", selectedAssets: "只更新指定應用資產", selectedAssetsHelp: "只對手動選中的應用資產建立並執行 DeploymentPlan。" },
    assetPicker: { available: "可選資產", selected: "已選資產", add: "添加", remove: "移除", clear: "清空選擇", emptyAvailable: "目前沒有可添加的應用資產。", emptySelected: "尚未選擇應用資產。" },
    actionTypes: { create_deployment_plan: "建立憑證更新計畫", execute_deployment_plan: "執行憑證更新計畫", send_notification: "傳送通知" },
    values: { enabled: "已啟用", disabled: "未啟用", latest: "自動使用最新版本", specific: "使用指定憑證版本", fixedByEvent: "由憑證新版本事件固定" },
    summaries: { targets: "最多 {count} 個目標" },
    preview: { title: "資產影響預覽", description: "查看已選取應用資產目前憑證到期時間與目標憑證到期時間的關係。", matched: "符合 {count} 項", executable: "可執行 {count} 項", excluded: "排除 {count} 項", affected: "受影響 {count} 項", upgrade: "有效期延長 {count} 項", same: "到期一致 {count} 項", downgrade: "需注意 {count} 項", version: "版本 {version}", versionUnknown: "版本未知", ready: "可執行", impact: { upgrade: "有效期延長", same: "到期時間一致", downgrade: "有效期縮短風險", missing_current: "缺少目前憑證", unknown: "影響未知" } },
    detail: { title: "自動化詳情", description: "查看目前自動化配置、觸發條件與執行護欄。", assetCount: "涉及 {count} 個應用資產", assetsResolvedAtRuntime: "目標資產會在執行時依憑證網域與繫結關係解析。", sections: { summary: "概覽", execution: "執行鏈", guardrails: "執行安全控制" }, fields: { automationId: "自動化 ID", currentVersion: "目前配置版本", recordVersion: "記錄版本號", eventSources: "事件來源", certificateDomains: "憑證網域", versionSelection: "憑證版本策略", actionChain: "執行動作鏈", involvedAssets: "涉及資產", nextRun: "下次執行", lastRun: "最近執行" } },
    history: { title: "執行歷史", description: "查看目前自動化最近的執行記錄。", summary: "共 {count} 筆執行記錄", latestTarget: "自動化：{name}", empty: "目前還沒有執行記錄。" },
    exclusions: { permission_denied: "無目標權限", missing_version: "缺少憑證版本", version_not_deployable: "憑證版本不可部署", binding_not_managed: "綁定未納管", environment_not_allowed: "環境不在允許範圍", binding_missing: "缺少綁定", asset_missing_deployment_capability: "目標資產不支援部署", certificate_version_downgrade: "目標憑證版本低於資產目前版本", filter_not_matched: "不符合過濾條件", runtime_context_required: "缺少執行期上下文", unknown: "未知排除原因" },
    failureStages: { selection: "目標選擇", plan_creation: "計畫建立", dry_run: "Dry Run", approval: "審批", execution: "執行", verification: "驗證", rollback: "回滾", notification: "通知" },
    progress: { total: "總數", pending: "等待中", running: "執行中", waitingApproval: "等待審批", succeeded: "成功", failed: "失敗", skipped: "已跳過", cancelled: "已取消" },
    editor: { createTitle: "新增自動化", editTitle: "編輯自動化", description: "設定何時執行、處理哪些憑證、如何建立部署計畫，以及失敗時的安全邊界。", exactVersionFromEvent: "憑證新版本事件會把這次產生的精確憑證版本固定到執行快照中，審批恢復後也不會漂移到後續版本。", sections: { basic: "基本資料", basicHelp: "為自動化命名，說明它負責哪類憑證變更。", trigger: "觸發器", triggerHelp: "先定義由什麼事實啟動自動化，再決定後續的執行和條件。", targets: "處理哪些憑證", targetsHelp: "這裡選擇的是憑證目標，不是既有部署計畫；執行開始時會固定目標快照。", execution: "執行器", executionHelp: "先決定自動化如何更新資產，再追加條件與安全護欄。", conditions: "條件與安全", conditionsHelp: "這一步同時定義命中條件、範圍過濾、審批與並行等護欄。", plan: "憑證部署計畫", planRelationTitle: "不會繫結既有部署計畫", planRelationDescription: "自動化會根據上面的憑證篩選條件，在每次執行時建立部署計畫。", planRelationHelp: "每個命中的憑證目標都有自己的 DeploymentPlan，計畫 ID 會顯示在執行詳情中。", guardrails: "執行安全控制", guardrailsHelp: "這些限制決定單次最多處理多少目標、是否預檢/審批，以及失敗何時停止。" }, chain: { createPlan: "按目標建立 DeploymentPlan", dryRun: "執行 Dry Run 預檢", approval: "等待審批通過", executePlan: "執行該目標的 DeploymentPlan" } },
    runs: { title: "自動化執行歷史", description: "查看執行級狀態、不可變目標快照和失敗階段。", progress: "{succeeded}/{total} 成功" },
    runDetail: { title: "自動化執行詳情", description: "設定版本 {version}", noFailure: "未發生失敗", triggerContext: "觸發上下文", sourceType: "來源類型", certificateVersion: "精確憑證版本", approvalId: "審批 ID", deliveryId: "投遞 ID", excludedReasons: "排除原因" },
    aria: { preview: "自動化目標預覽", runs: "自動化執行列表", progress: "自動化執行進度" },
    errors: { loadFailed: "自動化列表載入失敗", applicationAssetsLoadFailed: "應用資產列表載入失敗，請稍後再試。" }
  },
  routes: {
    certificateImport: "匯入憑證",
    certificateDetail: "憑證詳情",
    certificateUsages: "使用關係",
    certificateFormats: "格式產物"
  },
  businessPage: {
    request: {
      notRequested: "尚未請求"
    },
    error: {
      unknown: "未知錯誤"
    },
    primaryActionFailed: "主操作執行失敗",
    processing: "處理中…",
    metricsAria: "業務指標",
    apiFailed: "服務請求失敗",
    errorCode: "錯誤碼：{code}",
    retry: "重試",
    resourceList: "{resource}列表",
    total: "總數 {count}",
    toggleFilters: "篩選",
    all: "全部",
    clearFilters: "清空篩選",
    pagination: "第 {page} 頁 / 每頁 {pageSize} 筆",
    resourceDetailAria: "資源詳情",
    resourceDetailTitle: "{resource}詳情",
    contextAria: "上下文入口",
    resourceActionsAria: "資源操作",
    resourceActionsTitle: "資源操作",
    resourceActionsHint: "高風險操作需二次確認，最終以系統授權驗證為準。"
  },
  executionDetail: {
    error: {
      loadStepsFailed: "查詢執行步驟失敗",
      streamConnectFailed: "執行詳情更新連線失敗"
    },
    step: {
      nameFallback: "步驟 {index}",
      dryRunCheckSummary: "預檢結論：通過 {passed} / 警告 {warning} / 失敗 {failed} / 未知 {unknown}。{topChecks}",
      dryRunPending: {
        queued: "目前仍在佇列中，尚未開始執行。",
        running: "目前步驟執行中，等待 Agent 返回預檢結果。",
        failed: "目前步驟執行失敗，尚未取得預檢結果。",
        finished: "目前步驟已結束，尚未取得預檢結果。"
      },
      dryRunDiscover: "唯讀預檢：識別部署目標與 {providerLabel} 站點資訊。站點 {siteName}，繫結 {binding}。{pendingText}",
      dryRunVerify: "唯讀預檢：驗證憑證材料、目標繫結和域名匹配。目標 {providerLabel} 繫結 {binding}。{pendingText}",
      dryRunCreated: "唯讀預檢已建立。{pendingText}",
      workflowIdentity: "執行版本：外掛程式 {plugin}；工作流程 {workflow}",
      failure: {
        emptyMessage: "未收到具體錯誤資訊",
        issue: "類型 {category}，槽位 {slot}，路徑 {path}，來源 {source}，修復位置 {remediation}"
      },
      skipped: "步驟已跳過：{reason}",
      running: {
        dispatched: "Agent 任務已下發（{taskId}），等待執行結果。",
        waitingAgentResult: "步驟執行中，等待 Agent 返回結果…"
      },
      pending: {
        waitingDependency: "步驟等待前置步驟完成。"
      },
      verifyRecovered: {
        detail: "Agent 側遠端 TLS 探測失敗，但系統已對 {remoteTarget} 完成真實 TLS 驗證並確認目標憑證匹配。{originalError}",
        originalSuffix: "原始 Agent 錯誤：{originalError}"
      },
      resultReturned: {
        withTask: "{executor} {mode} 已返回。Agent taskId={taskId}",
        withoutTask: "{executor} {mode} 已返回。"
      },
      createdFallback: "步驟 {index} 已建立，等待執行詳情…"
    },
    dryRun: {
      failedNoChecks: {
        label: "Dry-run 執行失敗",
        detail: "已有 {failedStepCount} 個預檢步驟失敗或逾時，未收到結構化預檢結論。"
      },
      queued: {
        label: "Dry-run 排隊中",
        detail: "預檢任務已建立，等待開始執行。"
      },
      running: {
        label: "Dry-run 執行中",
        detail: "預檢已開始，等待結果返回。"
      },
      pending: {
        label: "Dry-run 已結束但無結論",
        detail: "共有 {finishedWithoutChecks} 個步驟已結束，但未收到預檢結論。"
      },
      receiving: {
        label: "Dry-run 接收中",
        detail: "已收到部分結論：通過 {passed}，警告 {warning}，失敗 {failed}，未知 {unknown}。"
      },
      failed: {
        label: "Dry-run 失敗",
        detail: "預檢失敗 {failed} 項，警告 {warning} 項，通過 {passed} 項。"
      },
      tlsGrantRequired: {
        label: "Dry-run 已完成，但需要宿主授權",
        detail: "結構與安全校驗已完成；dry-run 不簽發正式 ExecutionGrant，因此 TLS 跳過校驗步驟被拒絕。審批通過後，正式執行會由宿主簽發短期 ExecutionGrant。"
      },
      warning: {
        label: "Dry-run 有風險提示",
        detail: "預檢已完成：通過 {passed} 項，警告 {warning} 項，未知 {unknown} 項。"
      },
      passed: {
        label: "Dry-run 成功",
        detail: "預檢全部通過，共 {passed} 項。"
      }
    },
    agent: {
      taskSuffix: "（Agent taskId={taskId}）"
    },
    log: {
      verifyRecovered: "[ControlPlane] Agent 側遠端 TLS 探測失敗，但系統已完成真實 TLS 驗證並確認目標憑證匹配。"
    },
    workflowStep: {
      failedDefault: "工作流節點 {index} 執行失敗",
      skipped: "工作流節點已跳過，筆件未滿足。",
      successAssertions: "工作流節點執行成功，斷言通過 {passed}/{total}。",
      success: "工作流節點執行成功。"
    },
    binding: {
      hostMissing: "未提供Host Header（Host Header）"
    },
    site: {
      unnamed: "未命名站點"
    },
    provider: {
      target: "目標"
    }
  },
  executions: {
    title: "執行記錄",
    description: "檢視部署執行狀態、步驟記錄、dry-run 預檢結論、失敗原因和復原入口。",
    resourceName: "執行記錄",
    errors: {
      streamConnectFailed: "執行詳情更新連線失敗：HTTP {status}",
      loadFailed: "執行記錄載入失敗"
    },
    actions: {
      refreshList: "重新整理列表",
      refreshing: "正在重新整理",
      viewDetail: "檢視詳情",
      rollback: "啟動復原",
      rollbackRisk: "復原會再次改動目標服務憑證設定，必須確認備份引用和影響範圍。"
    },
    columns: {
      name: "執行編號",
      status: "狀態",
      risk: "風險",
      planId: "部署計畫",
      startedAt: "開始時間"
    },
    metrics: {
      total: {
        title: "執行總數",
        description: "目前可追蹤的執行記錄。"
      },
      risky: {
        title: "高危待處理",
        description: "失敗、部分成功或需要復原的執行。"
      }
    },
    fields: {
      executionId: "執行 ID",
      deploymentPlan: "部署計畫",
      runType: "執行型別",
      status: "執行狀態",
      target: "執行目標",
      externalRunId: "外部執行 ID",
      startedAt: "開始時間",
      finishedAt: "結束時間",
      errorCode: "錯誤碼",
      failureReason: "失敗原因"
    },
    links: {
      deploymentPlan: "檢視部署計畫",
      auditEvents: "檢視審計事件"
    },
    empty: {
      title: "暫無執行記錄",
      description: "部署計畫執行後會在這裡展示記錄、狀態和審計關聯。"
    },
    list: {
      ariaLabel: "執行記錄列表",
      title: "執行記錄列表",
      summary: "共 {total} 筆執行記錄，依開始時間倒序排列。",
      range: "顯示 {start}-{end} / {total}",
      assetsLabel: "資產",
      logLabel: "記錄摘要",
      runNumber: "第 {number} 次",
      planUnknown: "未關聯部署計畫",
      assetUnknown: "未記錄對應資產",
      timeUnknown: "未記錄開始時間",
      logRunning: "執行正在進行，詳細記錄會持續更新。",
      logPending: "執行已進入佇列，等待排程。",
      logFailed: "執行失敗，錯誤碼：{code}",
      logSuccess: "執行成功，耗時 {duration}。",
      logCompleted: "執行已結束，可開啟詳情檢視完整記錄。",
      errorCodeUnknown: "未記錄",
      durationUnknown: "未知",
      durationSeconds: "{count} 秒",
      durationMinutes: "{count} 分鐘",
      viewDetailHint: "點擊檢視詳情",
      openDetailAria: "檢視計畫 {plan} 的執行記錄 {id}",
      previousPage: "上一頁",
      nextPage: "下一頁",
      pageSummary: "第 {page} / {pages} 頁"
    },
    types: {
      dryRun: "預檢",
      apply: "正式執行",
      rollback: "復原",
      retry: "重試",
      unknown: "其他執行"
    },
    summary: {
      passed: "通過",
      warning: "警告",
      failed: "失敗",
      unknown: "未知"
    },
    detail: {
      title: "執行詳情",
      titleWithId: "執行詳情 {id}",
      description: "檢視執行記錄的基本資訊、步驟狀態和記錄。",
      eyebrow: "執行記錄",
      planLabel: "部署計畫 {plan}",
      loadingSteps: "正在載入步驟...",
      loadingLogs: "正在載入記錄...",
      noStepDetail: "暫無步驟說明",
      notStarted: "未開始",
      noSteps: "暫無步驟。",
      noLogs: "暫無記錄。"
    },
    tabs: {
      summary: "概覽",
      steps: "步驟",
      logs: "記錄"
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: '連線位址', connectionPort: '連線連接埠', basePath: '基礎路徑', timeoutSeconds: '逾時秒數', gateway: '執行 Gateway',
      authenticationMode: '驗證方式', credential: '裝置管理憑證', username: '使用者名稱', passwordSecret: '密碼 SecretRef', apiTokenSecret: 'API Token SecretRef', clientCertificate: '用戶端憑證',
      tlsEnabled: '啟用 TLS', tlsVerifyPeer: '驗證伺服器憑證', tlsServerName: 'TLS Server Name', caSecret: 'CA SecretRef', tlsMinimumVersion: '最低 TLS 版本',
      deviceDisplayName: '裝置顯示名稱', deviceDescription: '裝置說明', deviceTags: '裝置標籤', targetName: '目標名稱', targetLabels: '目標標籤'
    },
    forms: { loadOptions: '載入選項', previewTitle: '外掛設定表單', loading: '正在載入外掛表單...', loadFailed: '外掛表單載入失敗', empty: '此外掛未宣告設定表單。' },
    presentation: { previewTitle: '裝置標準展示預覽', sensitiveValue: '敏感值已隱藏', tabsAriaLabel: '裝置資訊分頁' },
    title: "外掛",
    description: "管理外掛包、執行器、權限宣告與沙箱隔離狀態。",
    resourceName: "外掛",
    actions: {
      install: "安裝外掛",
      detail: "詳情",
      create: "建立",
      refresh: "重新整理市場",
      refreshing: "重新整理中...",
      createWorkflow: "建立工作流程",
      creatingWorkflow: "建立中...",
      enable: "啟用",
      disabling: "停用中...",
      disable: "停用",
      disableRisk: "停用外掛會影響 Provider、模板和執行器能力。"
    },
    market: { eyebrow: "DSL 外掛市場", title: "探索可重用的自動化能力", description: "內建模板隨系統發布，使用者模板來自 data/workflows。每個模板都可維護 Logo、語意版本與能力標籤。" },
    sources: { builtin: "內建外掛", user: "使用者外掛" },
    statuses: { valid: "可用", invalid: "無效", available: "可建立", enabled: "已啟用", disabled: "未啟用", pendingApproval: "待審批", inUse: "正在使用", notInUse: "尚未使用" },
    filters: { searchLabel: "搜尋外掛", searchPlaceholder: "依名稱、標籤、分類或路徑搜尋", allSources: "全部來源", allStatuses: "全部狀態", statusLabel: "外掛狀態" },
    card: { defaultDescription: "此 DSL 外掛尚未設定說明。", unversioned: "未標示版本", stepCount: "{count} 個執行步驟", trustedJsRuntime: "Trusted JS 外掛", moreTags: "另 {count} 項" },
    columns: {
      name: "外掛名稱",
      status: "狀態",
      risk: "風險",
      version: "版本",
      signature: "簽名"
    },
    metrics: {
      total: {
        title: "外掛總數",
        description: "已安裝和可升級外掛。"
      },
      builtin: { title: "內建外掛" },
      user: { title: "使用者外掛" },
      using: { title: "正在使用" },
      risky: {
        title: "高危待處理",
        description: "高危權限、簽名異常或沙箱隔離外掛。"
      }
    },
    empty: {
      title: "暫無外掛",
      description: "安裝前請確認外掛權限、簽名與復原策略。"
    },
    detail: {
      title: "外掛詳情",
      titleWithName: "外掛 {name}",
      description: "檢視外掛詳情、權限宣告與沙箱隔離資訊。",
      versionLabel: "版本 {version}"
    },
    types: { provider: "雲端 Provider 外掛", standard: "標準外掛" },
    fields: {
      pluginId: "外掛 ID",
      pluginType: "外掛類型",
      provider: "雲端服務提供商",
      name: "外掛名稱",
      currentStatus: "目前狀態",
      version: "版本",
      source: "來源", category: "分類", steps: "執行步驟", rollbackSteps: "復原步驟", updatedAt: "更新時間", filePath: "模板路徑", logoUrl: "Logo 位址", platforms: "面向平台", updateMethods: "更新方式", maintainer: "維護者", homepage: "專案首頁", usage: "使用狀態", validationError: "驗證錯誤",
      signatureStatus: "簽名狀態",
      riskLevel: "風險等級", runtime: "執行環境", executionMode: "執行模型", scope: "適用範圍", support: "支援等級", capabilities: "能力", frameworks: "面向框架", products: "支援產品", operations: "支援操作"
    },
    capabilityKeys: { device_connection_test: "連線測試", device_identity_detect: "裝置身分識別", device_discover: "裝置發現", device_logs_read: "裝置記錄讀取", certificate_discover: "憑證發現", certificate_deploy: "憑證部署", certificate_rollback: "憑證復原", certificate_verify: "憑證驗證" },
    frameworkTypes: { web_iis: "IIS", web_nginx: "NGINX", web_apache: "Apache", app_tomcat: "Tomcat", custom_runtime: "自訂執行環境", runtime_custom: "自訂執行環境", adc_load_balancer: "ADC 負載平衡", cloud_aliyun_cdn: "阿里雲 CDN", cloud_aliyun_alb: "阿里雲 ALB", cloud_aliyun_clb: "阿里雲 CLB", cloud_aliyun_oss: "阿里雲 OSS", cloud_aliyun_waf_cname: "阿里雲 WAF CNAME", cloud_aliyun_waf_cloud: "阿里雲 WAF 雲產品", cloud_aliyun_live: "阿里雲 Live", cloud_aliyun_vod: "阿里雲 VOD", cloud_tencent_cdn: "騰訊雲 CDN", cloud_tencent_clb: "騰訊雲 CLB", cloud_tencent_live: "騰訊雲直播", cloud_huawei_cdn: "華為雲 CDN", cloud_huawei_elb: "華為雲 ELB", cloud_volcengine_cdn: "火山引擎 CDN", cloud_volcengine_alb: "火山引擎 ALB", cloud_volcengine_clb: "火山引擎 CLB", cloud_volcengine_live: "火山引擎直播", cloud_volcengine_vod: "火山引擎 VOD" },
    runtimeTypes: { agent_atomic: "Agent 原子執行", workflow_dsl: "工作流 DSL", trusted_js: "Trusted JS" },
    providerKeys: { cloud_aliyun: "阿里雲", cloud_tencent: "騰訊雲", cloud_huawei: "華為雲", cloud_volcengine: "火山引擎" },
    scopeTypes: { managed: "受管目標", standalone: "獨立目標", both: "受管 / 獨立" },
    supportTypes: { official: "官方支援", community: "社群支援", self_managed: "自行維護" },
    aria: { filters: "外掛市場篩選條件", list: "DSL 外掛清單", logo: "{name} 的 Logo" },
    errors: { loadFailed: "外掛市場載入失敗", createFailed: "依外掛建立工作流程失敗" },
    agentDeployment: {
      mount: '掛載到 Agent', mounting: '掛載中...', selectAgent: '請選擇目標 Agent', type: '外掛類型', targetAgent: '目標 Agent', mountFailed: 'Agent 外掛掛載失敗',
      executionMode: 'Agent 執行模式', nativeHandler: '原生處理器', pluginMode: 'Agent 外掛', mountedPlugin: '已掛載外掛', selectMountedPlugin: '請選擇已掛載外掛',
      plugin: '部署外掛', selectPlugin: '請選擇部署外掛', noCompatiblePlugin: '沒有符合目前平台與框架的已啟用外掛', compatiblePluginHint: '僅顯示與目前資產平台及框架相符的已啟用外掛。',
      secretRefPlaceholder: '輸入 SecretRef 識別碼', artifactBinding: '憑證產物 {name}', artifactBindingPlaceholder: '例如 value=fullchain,key=private', preview: '驗證外掛設定', previewFailed: 'Agent 外掛設定驗證失敗',
      approveAndEnable: '核准權限並啟用', activating: '啟用中...', activateFailed: 'Agent 外掛核准或啟用失敗',
      types: { WORKFLOW_TEMPLATE: '工作流程範本', UNIFIED_PLUGIN: '統一能力外掛' }
    },
    changeSummaries: { createWorkflow: "從外掛市場模板建立工作流程" }
  },
  deploymentPlans: {
    userView: {
      stepLabel: 'Step 3 of 3 · Deploy',
      title: 'Deploy the certificate to an application',
      description: 'Choose a certificate and a connected application. GCAC keeps the same preview, approval, and execution safeguards in the background.',
      createAction: 'Start deployment',
      listTitle: 'Deployment tasks',
      listDescription: 'Only the next action and business status are shown here.',
      loadFailed: 'Failed to load deployment tasks',
      emptyTitle: 'No deployment task yet',
      emptyDescription: 'Create the first deployment task after adding an application.',
      unnamedPlan: 'Unnamed deployment task',
      pendingCertificate: 'Certificate pending',
      pendingApplication: 'Application pending',
      nextActionHint: 'The next action follows the current approval and preview status.',
      prepareAction: 'Prepare deployment',
      waiting: 'Waiting for approval or execution'
    },
    title: "部署計畫",
    description: "計畫預覽、影響範圍、審核、執行批次、驗證和復原入口。",
    resourceName: "部署計畫",
    apiActions: {
      submit: "提交部署計畫",
      execute: "執行部署計畫",
      cancel: "取消部署計畫",
      delete: "刪除部署計畫"
    },
    actions: {
      create: "建立部署計畫",
      detail: "詳情",
      edit: "編輯計畫",
      dryRun: "Dry-run 影響預覽",
      dryRunRisk: "只產生影響預覽，不會執行正式部署。",
      submit: "提交審核",
      submitRisk: "提交後計畫會進入審核或待執行狀態。",
      review: "進行審核",
      approve: "核准審核",
      approveRisk: "核准後計畫才具備正式執行資格，但仍需要 Dry-run 和主機簽發的 ExecutionGrant。",
      reject: "駁回審核",
      rejectRisk: "駁回後計畫不能正式執行，需要重新提交審核。",
      execute: "執行部署",
      executeRisk: "執行會修改目標憑證設定。已完成或失敗的計畫再次執行也使用這個入口；執行前應先執行 Dry-run 影響預覽。",
      cancel: "取消計畫",
      cancelRisk: "只取消尚未完成的部署計畫，不回復已經完成的部署。",
      rollback: "復原執行",
      rollbackRisk: "復原會再次修改目標服務憑證設定，必須使用真實 runId。",
      delete: "刪除計畫",
      deleteRisk: "將永久刪除計畫、部署目標、執行記錄和對應審計歷史，不可恢復。"
    },
    columns: {
      name: "計畫名稱",
      status: "狀態",
      currentAssetCertificateExpiresAt: "目前憑證結束時間",
      updateNeeded: "需要更新",
      scheduledAt: "計畫時間",
      actions: "操作"
    },
    metrics: {
      total: {
        title: "計畫總數",
        description: "等待審核、待執行和執行中的計畫。"
      },
      risky: {
        title: "高危待處理",
        description: "影響生產服務或缺少復原能力的計畫。"
      }
    },
    fields: {
      planId: "計畫 ID",
      name: "計畫名稱",
      status: "計畫狀態",
      approvalStatus: "審核狀態",
      certificateVersionId: "憑證版本 ID",
      certificateFormatId: "憑證格式設定 ID",
      workflowDslVersion: "工作流 DSL 版本",
      currentAssetCertificateExpiresAt: "目前憑證結束時間",
      updateNeeded: "需要更新",
      targetSummary: "目標繫結摘要",
      latestRun: "最新執行批次",
      approvalId: "審核 ID",
      snapshotHash: "快照 Hash",
      failureReason: "失敗原因",
      createdAt: "建立時間",
      updatedAt: "更新時間"
    },
    links: {
      executions: "檢視執行記錄",
      bindings: "檢視相關繫結"
    },
    empty: {
      title: "暫無部署計畫",
      description: "先從憑證或繫結進入部署精靈，產生影響預覽後再提交計畫。"
    },
    disabled: {
      missingApproval: "缺少審核通過資訊，不能執行。",
      approvalPending: "審核申請已提交，等待審核人核准後才能執行。",
      approvalRejected: "審核未通過，不能執行。",
      needDryRun: "正式執行前必須先完成一次成功的 Dry-run 影響預覽。",
      missingRunId: "缺少 runId，不能復原。",
      missingSelection: "缺少部署計畫選擇"
    },
    common: {
      cancel: "取消",
      close: "關閉",
      notConfigured: "未設定",
      notProvided: "未提供"
    },
    approval: {
      title: "審核詳情",
      description: "確認部署計畫的審核範圍後，直接核准或駁回申請。",
      requestedBy: "申請人",
      riskLevel: "風險等級",
      decisionHint: "核准後計畫才能進入正式執行；駁回後需要重新提交審核。",
      processing: "處理中...",
      missingApprovalId: "缺少審核 ID，無法進行審核。",
      decisionFailed: "審核操作失敗。"
    },
    detail: {
      certificateVersionLabel: "憑證版本",
      description: "檢視計畫基礎資訊、關聯記錄與最近一次執行結果。",
      emptyRelatedRecords: "暫無關聯記錄。",
      loadingRelatedRecords: "正在載入關聯記錄...",
      noExecutionRecords: "目前計畫還沒有執行記錄。",
      inputSourcesLoadFailed: '載入部署輸入來源失敗',
      inputSourcesTitle: '部署輸入來源',
      inputSource: '來源：{source}',
      inputSourceTarget: '部署目標：{targetId}',
      noInputSources: '目前計畫沒有可顯示的變數來源。',
      noTargetSummary: "未提供目標摘要",
      workflowIdentityTitle: "工作流執行身分",
      workflowMode: "使用者工作流",
      workflowModePluginInternal: "外掛內建工作流",
      workflowDslVersion: "實際 DSL 版本：{version}",
      workflowPluginVersion: "實際外掛版本：{version}",
      workflowPluginVersionId: "外掛版本 ID：{versionId}",
      workflowVersionId: "版本快照 ID：{versionId}",
      workflowVersionSelectionPinned: "版本策略：計畫已固定",
      workflowVersionSelectionLatest: "版本策略：應用資產使用最新已發布版本",
      workflowIdentityUnavailable: "工作流版本資訊不可用",
      planIdLine: "計畫 ID {planId}",
      recordKinds: {
        certificateUpdate: "憑證更新",
        dryRun: "Dry-run"
      },
      relatedPlan: "計畫 {planId}",
      relatedRun: "執行 {runId}",
      relatedSource: "來源 {source}",
      tabs: {
        latestExecution: "最近執行",
        relatedRecords: "關聯記錄",
        summary: "概覽"
      },
      targetLabel: "目標",
      title: "部署計畫詳情",
      titleWithName: "部署計畫 {name}",
      viewLogs: "檢視記錄"
    },
    dryRunRequired: {
      copy: "目前操作：{action}。請先做一次 Dry-run，確認影響範圍和檢查結論後再繼續正式執行。",
      description: "正式執行前需要先完成一次成功的 Dry-run 影響預覽。",
      primaryAction: "先做 Dry-run",
      runningAction: "正在啟動 Dry-run…",
      title: "需要先執行 Dry-run"
    },
    execution: {
      applyName: "部署執行 {runId}",
      applyTitle: "憑證更新執行",
      dryRunName: "Dry-run {runId}",
      dryRunTitle: "Dry-run 結果",
      fallbackName: "執行 {runId}",
      rollbackTitle: "憑證復原執行",
      startingName: "正在啟動執行"
    },
    feedback: {
      cancelled: "部署計畫已取消。",
      cancelledWithPlanId: "部署計畫已取消（計畫 {planId}）。",
      deleted: "部署計畫已刪除。",
      deletedWithPlanId: "部署計畫已刪除（計畫 {planId}）。",
      dryRunStartedMissingRunId: "預檢已啟動。",
      dryRunStartedWithRunId: "預檢已啟動（{runId}），請在彈出視窗中檢視進度。",
      dryRunTriggered: "預檢已觸發。",
      dryRunTriggeredWithPlanId: "預檢已觸發（計畫 {planId}）。",
      dryRunTriggeredWithRunId: "預檢已觸發（{runId}），請在彈出視窗中檢視進度。",
      dryRunTaskStarted: "Dry-run 已開始，後續進度可在右上角任務列表檢視。",
      executeTriggered: "部署已觸發。",
      executeTriggeredWithPlanId: "部署已觸發（計畫 {planId}）。",
      executeTriggeredWithRunId: "部署已觸發（{runId}），請在彈出視窗中檢視進度。",
      executionTaskStarted: "任務已開始，後續進度可在右上角任務列表檢視。",
      executionTaskSucceeded: "任務已成功完成，可在右上角任務列表檢視結果。",
      executeTaskStarted: "憑證部署已開始，後續進度可在右上角任務列表檢視。",
      rollbackTaskStarted: "憑證回滾已開始，後續進度可在右上角任務列表檢視。",
      loadedDraft: "已載入草稿計畫。",
      loadedDraftWithPlanId: "已載入草稿（計畫 {planId}）。",
      savedWithPlanId: "計畫已儲存（{planId}）。",
      submitted: "部署計畫已提交。",
      submittedWithPlanId: "部署計畫已提交（計畫 {planId}）。",
      approvalApproved: "審核已通過，計畫現在可以執行。",
      approvalApprovedWithPlanId: "審核已通過，計畫 {planId} 現在可以執行。",
      approvalRejected: "審核已駁回，計畫不能執行。",
      approvalRejectedWithPlanId: "審核已駁回，計畫 {planId} 不能執行。"
    },
    target: {
      controlPlane: "平台",
      noBindingInfo: "未提供繫結資訊",
      noCertificateVariables: "未繫結憑證變數",
      noHostHeader: "未提供Host Header（Host Header）",
      noOutputSelected: "未選擇輸出項"
    },
    errors: {
      actionFailed: "{action}失敗",
      createReturnedMissingPlanId: "計畫建立成功但未取得編號，請重新整理列表。",
      loadCreateDataFailed: "載入部署計畫建立資料失敗",
      loadRelatedRecordsFailed: "載入關聯記錄失敗",
      missingApplicationAssetIdForDryRun: "缺少應用資產，無法啟動預檢。",
      missingApplicationAssetIdForSave: "缺少應用資產，無法儲存計畫。",
      missingPlanId: "計畫編號缺少，請重新選擇。",
      missingPlanIdForAction: "{action}失敗：計畫編號缺少，請重新選擇。",
      missingRunIdRequest: "執行編號缺少，請重新選擇。",
      saveFailed: "儲存部署計畫失敗",
      startDryRunFailed: "啟動 dry-run 失敗"
    }
  },
  agents: {
    actions: {
      close: "關閉",
      delete: "刪除",
      deleteRisk: "刪除會直接移除 Agent 記錄，這個操作不可逆。",
      detail: "詳情",
      disable: "停用",
      disableRisk: "停用後該 Agent 將停止接收新任務。",
      enable: "啟用",
      enableRisk: "啟用後該 Agent 將恢復為可排程狀態。"
    },
    app: {
      fallbackName: "應用 {index}"
    },
    certificate: {
      boundCertificate: "站點繫結憑證",
      expiredDays: "已過期 {days} 天",
      expiresToday: "今天到期",
      modalDescription: "展示目前站點繫結使用的憑證關鍵資訊。",
      modalTitle: "憑證詳情",
      overviewDescription: "展示憑證名稱、簽發者、開始時間、到期時間和指紋等關鍵資訊。",
      overviewTitle: "憑證概覽",
      projectDetailDescription: "在目前 Agent 詳情上下文中展示專案內憑證資產詳情和關聯使用關係。",
      projectDetailTitle: "本專案憑證詳情",
      querying: "查詢中...",
      remainingDays: "剩餘 {days} 天",
      remainingWithViewAction: "{remaining} / 點擊檢視憑證",
      statusExpired: "已過期",
      statusExpiring: "即將過期",
      statusLabel: "憑證狀態",
      statusUnknown: "有效期未知",
      statusValid: "有效",
      view: "檢視憑證",
      viewProjectDetail: "檢視本專案憑證詳情"
    },
    certificateUsage: {
      iisSite: "Agent IIS 站點",
      linuxSite: "Agent Linux 站點",
      tomcatConnector: "Agent Tomcat 聯結器"
    },
    columns: {
      actions: "操作",
      hostname: "主機名",
      ipAddress: "IP 位址",
      lastHeartbeat: "最近心跳",
      onlineStatus: "線上狀態",
      osType: "系統型別",
      version: "版本"
    },
    common: {
      defaultAddress: "預設位址",
      no: "否",
      noHostHeader: "無 Host Header",
      noListenAddress: "無監聽位址",
      none: "無",
      notConfigured: "未設定",
      notProvided: "未提供",
      notWritable: "不可寫",
      unrecognized: "未識別",
      writable: "可寫",
      yes: "是"
    },
    detail: {
      loading: "詳情載入中...",
      manualRescan: "手動重掃",
      manualRescanCannotPullTasks: "目前 Agent 不可拉取任務，無法執行重掃",
      manualRescanCreated: "已建立手動重掃任務，等待 Agent 拉取執行。",
      manualRescanSubmitting: "重掃提交中...",
      manualRescanUnsupportedType: "目前 Agent 型別不支援手動重掃",
      modalDescription: "檢視 Agent 的主要資訊、執行環境以及 IIS 站點資訊。",
      modalTitle: "Agent 詳情",
      nodeEyebrow: "Agent 節點",
      tabsAriaLabel: "Agent 詳情標籤頁"
    },
    empty: {
      description: "點擊右上角“安裝Agent ”，選擇平台和版本後產生一次性安裝命令。",
      noFrameworkSites: "未發現 {name} 站點",
      noIisSites: "未發現 IIS 站點",
      noRuntimeLogs: "暫無執行記錄",
      noTomcatApps: "未發現 Tomcat 應用",
      noTomcatConnectors: "未發現 Tomcat 聯結器",
      title: "暫無 Agent"
    },
    errors: {
      certificateAssetIncomplete: "憑證資產資料不完整，無法跳轉詳情。",
      certificateAssetNotFound: "本專案中未找到對應憑證資產。",
      certificateAssetQueryFailed: "查詢憑證資產失敗。",
      detailDataMissing: "未能取得詳情資訊。",
      generateInstallCommandFailed: "產生安裝命令失敗。",
      installCommandMissing: "系統未返回安裝命令。",
      loadDetailFailed: "載入詳情失敗。",
      manualRescanFailed: "手動重掃啟動失敗。"
    },
    fields: {
      agentVersion: "Agent 版本",
      appCount: "應用數量",
      appList: "應用列表",
      appPool: "應用程式池",
      arch: "系統架構",
      binaryPath: "二進位制路徑",
      certificateFile: "憑證檔案",
      certificateName: "憑證名稱",
      certificateStore: "憑證倉庫",
      certificateSubject: "憑證主題",
      certificateThumbprint: "憑證指紋",
      configFile: "設定檔案",
      configPath: "設定路徑",
      connectorCount: "聯結器數量",
      connectorList: "聯結器列表",
      domain: "域名",
      frameworkVersion: "{name} 版本",
      healthStatus: "健康狀態",
      healthSummary: "異常摘要",
      hostname: "主機名",
      httpsBinding: "HTTPS 繫結",
      httpsListen: "HTTPS 監聽",
      iisVersion: "IIS 版本",
      installPrefix: "安裝字首",
      installStatus: "安裝狀態",
      ipAddress: "IP 位址",
      issuer: "簽發者",
      lastCapabilityReportAt: "上次能力上報時間",
      lastHeartbeat: "最近心跳",
      lastRecoveryAt: "最近恢復時間",
      lastReportAt: "最近上報時間",
      linuxDistribution: "Linux 發行版",
      listenAddress: "監聽位址",
      notAfter: "到期時間",
      notBefore: "開始時間",
      offlineDetected: "已判定離線",
      osType: "系統型別",
      osVersion: "作業系統版本",
      patchVersion: "補丁版本",
      privateKeyOrKeystore: "私密金鑰 / Keystore",
      proxyTarget: "代理目標",
      remainingDays: "剩餘天數",
      role: "角色",
      runningStatus: "執行狀態",
      runtimeLog: "執行記錄",
      serviceName: "服務名稱",
      sha256Fingerprint: "SHA-256 指紋",
      siteCount: "站點數量",
      siteList: "站點列表",
      tlsConnector: "TLS 聯結器",
      tomcatVersion: "Tomcat 版本",
      zone: "區域"
    },
    health: {
      degraded: "降級",
      failed: "失敗",
      healthy: "健康",
      unknown: "未知"
    },
    install: {
      bootstrapToken: "安裝碼",
      command: "安裝命令",
      commandStepTitle: "產生安裝命令",
      commandCopied: "安裝命令已複製",
      copyCommand: "複製安裝命令",
      copyToken: "複製安裝碼",
      expired: "已過期",
      generateCommand: "產生安裝命令",
      generating: "產生中...",
      compatibilityInstallUnavailable: "Windows Compatibility Agent 的一次性安裝入口尚未發布，請勿使用 Windows Modern Agent 命令替代安裝。",
      installEntryPending: "安裝入口待發布",
      linuxGeneralTitle: "Linux 通用 Agent",
      linuxGroupTitle: "Linux",
      modalDescription: "選擇平台與版本，產生一次性安裝命令。安裝碼 10 分鐘內有效，且只能使用一次。",
      modalTitle: "安裝 Agent",
      platform: "平台",
      platformLinuxDescription: "適用於 Ubuntu、Debian、CentOS、Rocky、AlmaLinux 等 Linux 發行版。",
      platformWindowsDescription: "適用於 Windows Server 與 Windows 10/11，安裝後註冊為系統服務。",
      remainingTime: "{minutes}分 {seconds}秒",
      remainingValidity: "剩餘有效期",
      selectedAgent: "已選 Agent",
      selectionStepTitle: "選擇 Agent 類型",
      singleUseHint: "同一個安裝碼一旦被請求 bootstrap 指令碼，就會立刻失效，不能重複使用。",
      tokenCopied: "安裝碼已複製",
      version: "版本",
      versionLatest: "最新穩定版",
      windowsCompatibility2008: "Windows Server 2008 R2 SP1",
      windowsCompatibility2012: "Windows Server 2012 / 2012 R2",
      windowsCompatibilityTitle: "Windows Compatibility Agent",
      windowsGroupTitle: "Windows",
      windowsModernDesktop: "Windows 10/11",
      windowsModernServer: "Windows Server 2016 及以上",
      windowsModernTitle: "Windows Modern Agent",
      zone: "區域"
    },
    labels: {
      certificatePath: "憑證：{value}",
      deployDirectory: "部署目錄：{value}",
      directory: "目錄：{value}",
      keystorePath: "Keystore：{value}",
      listenAddress: "監聽位址：{value}",
      path: "路徑：{value}",
      privateKeyPath: "私密金鑰：{value}",
      reloadCommand: "Reload 命令：{value}",
      siteName: "站點名稱：{value}",
      taskType: "任務型別：{value}",
      testCommand: "測試命令：{value}",
      thumbprint: "指紋：{value}"
    },
    linux: {
      certDirectoryWritable: "憑證目錄：{status}",
      helperRequired: "需要 helper",
      keyDirectoryWritable: "私密金鑰目錄：{status}",
      permissionMode: "權限模式：{mode}"
    },
    logs: {
      collapse: "收起",
      expand: "展開",
      listAriaLabel: "執行記錄列表"
    },
    metrics: {
      abnormalDescription: "離線、失敗或漂移狀態的 Agent 需要優先處理。",
      abnormalTitle: "異常 Agent",
      totalDescription: "目前已註冊到系統的 Agent 數量。",
      totalTitle: "Agent 總數"
    },
    page: {
      description: "檢視 Agent 列表，產生不同平台的安裝命令，並在彈出視窗中檢視詳情。",
      installAgent: "安裝Agent"
    },
    sections: {
      frameworkOverviewDescription: "主機上的 {name} 安裝狀態、執行狀態和設定位置。",
      frameworkOverviewTitle: "{name} 概況",
      frameworkSitesDescription: "{name} 識別到的站點、根目錄、域名、反向代理目標和憑證檔案路徑。",
      frameworkSitesTitle: "{name} 站點",
      healthDescription: "系統對 Agent 的離線判斷、恢復時間與執行健康摘要。",
      healthTitle: "健康與恢復",
      iisOverviewDescription: "主機上的 IIS 安裝狀態和版本資訊。",
      iisOverviewTitle: "IIS 概況",
      iisSitesDescription: "IIS 網站列表、站點路徑、繫結埠以及憑證主題名。",
      iisSitesTitle: "IIS 站點",
      logOverviewDescription: "最近一次能力上報時間，用於判斷能力資訊的時效性。",
      logOverviewTitle: "記錄概覽",
      mainInfoDescription: "Agent 身分、角色與心跳狀態。",
      mainInfoTitle: "主要資訊",
      runtimeDescription: "Agent 上報的執行系統與版本資訊。",
      runtimeLogsDescription: "手動重掃結果、心跳異常以及能力上報中斷等執行記錄。",
      runtimeLogsTitle: "執行記錄",
      runtimeTitle: "執行環境",
      tomcatAppsDescription: "Tomcat Host/Context 中識別到的應用路徑與部署目錄。",
      tomcatAppsTitle: "Tomcat 應用",
      tomcatConnectorsDescription: "Tomcat Connector 的監聽位址、協議、TLS 開關和憑證路徑。",
      tomcatConnectorsTitle: "Tomcat 聯結器",
      tomcatOverviewDescription: "主機上的 Tomcat 安裝狀態、執行狀態和 Catalina 路徑。",
      tomcatOverviewTitle: "Tomcat 概況"
    },
    site: {
      domainCount: "{count} 個域名",
      fallbackName: "站點 {index}"
    },
    siteMode: {
      reverseProxy: "反向代理",
      staticRoot: "靜態站點"
    },
    status: {
      installed: "已安裝",
      notInstalled: "未安裝",
      notRunning: "未執行",
      running: "執行中"
    },
    tabs: {
      logs: "記錄",
      overview: "概覽"
    }
  },
  dashboard: {
    aria: {
      assetHeatmap: "應用資產狀態熱力圖",
      certificateStatusList: "憑證狀態列表",
      metrics: "核心指標",
      quickActions: "主要功能入口",
      statusHeatmap: "憑證、Agent、閘道和應用資產狀態",
      statusLegend: "狀態圖例"
    },
    assets: {
      groupCount: "{summary} · {total} 個",
      title: "應用資產狀態",
      updatedAt: "更新於 {time}"
    },
    audit: {
      description: "優先展示失敗、拒絕、高風險和關鍵業務變更。",
      title: "最近審計記錄"
    },
    certificateState: {
      critical: "臨近到期",
      expired: "已過期",
      expiring: "即將到期",
      unknown: "未知",
      valid: "正常"
    },
    days: {
      expired: "已過期 {days} 天",
      expiresToday: "今天到期",
      notRecorded: "未記錄",
      remaining: "{days} 天"
    },
    empty: {
      noAuditLogs: "暫無審計記錄",
      noCertificateStatus: "暫無憑證狀態資料",
      noObjects: "暫無物件"
    },
    errors: {
      loadFailed: "總覽資料載入失敗",
      missingOverviewData: "未能取得總覽資訊。"
    },
    legend: {
      disabled: "停用",
      error: "異常",
      ok: "正常",
      unknown: "未知",
      warning: "關注"
    },
    loading: {
      description: "正在載入總覽資訊…",
      title: "載入中"
    },
    metrics: {
      activeAgents: {
        title: "活躍 Agent 數量",
        description: "目前線上並可排程的 Agent。"
      },
      activeGateways: {
        title: "活躍閘道數量",
        description: "目前線上的隔離區閘道。"
      },
      applications: {
        title: "目前應用數量",
        description: "已納管的應用入口資產。"
      },
      expiringCertificates: {
        title: "15 天內到期憑證",
        description: "需要安排續期或替換的憑證。"
      },
      managedBindings: {
        title: "託管繫結數量",
        description: "已進入托管狀態的憑證繫結。"
      },
      validCertificates: {
        title: "活躍憑證數量",
        description: "狀態活躍且尚未過期的憑證版本。"
      }
    },
    quickActions: {
      agents: {
        title: "Agent",
        description: "檢視線上狀態和任務能力。"
      },
      assets: {
        title: "應用資產",
        description: "維護域名、埠和部署目標。"
      },
      audits: {
        title: "審計記錄",
        description: "追蹤操作人與執行結果。"
      },
      certificates: {
        title: "憑證管理",
        description: "匯入、檢視和轉換憑證。"
      },
      deploymentPlans: {
        title: "部署計畫",
        description: "建立和執行憑證更新計畫。"
      },
      gateways: {
        title: "閘道",
        description: "管理隔離區執行入口。"
      }
    },
    statusBlock: {
      detail: {
        certificateRemaining: "{name}，{days}"
      },
      status: {
        active: "活躍",
        critical: "臨近到期",
        deleted: "已刪除",
        disabled: "停用",
        expired: "已過期",
        expiring: "即將到期",
        inactive: "不活躍",
        offline: "離線",
        online: "線上",
        retired: "已退役",
        revoked: "已吊銷",
        stale: "已過期未更新",
        unknown: "未知",
        unreachable: "不可連線",
        upgrading: "升級中",
        valid: "正常"
      }
    },
    statusGroups: {
      agents: {
        title: "Agent"
      },
      applicationAssets: {
        title: "應用資產"
      },
      certificates: {
        title: "憑證"
      },
      gateways: {
        title: "閘道"
      },
      summary: {
        allNormal: "全部正常",
        needsAttention: "{count} 個需要關注"
      }
    },
    table: {
      bindings: "繫結",
      certificate: "憑證",
      domain: "域名",
      notAfterMissing: "未記錄到期時間",
      remainingTime: "剩餘時間",
      status: "狀態"
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: "新增 Gateway Agent",
      close: "關閉",
      copied: "已複製",
      copyEnableCommand: "複製啟用命令",
      copyInstallCommand: "複製安裝命令",
      detail: "詳情",
      enableExistingAgent: "現有 Agent 啟用 Gateway",
      generateEnableCommand: "產生啟用命令",
      generateInstallCommand: "產生安裝命令",
      generating: "產生中...",
      probe: "探測",
      probeRisk: "將從該 Gateway 所在區域啟動一次可連線性探測。"
    },
    columns: {
      actions: "操作",
      gateway: "閘道",
      lastHeartbeat: "最近心跳",
      load: "負載",
      region: "區域",
      status: "狀態"
    },
    detail: {
      abilities: {
        agentTask: {
          description: "把部署、檢查等任務轉給區域內的 Agent 執行。",
          title: "任務轉發"
        },
        directControl: {
          description: "把受控操作轉發到區域內 Agent，系統無需直連內網埠。",
          title: "遠端控制轉發"
        },
        probe: {
          description: "從該區域檢查主機、網站或 Agent 是否可存取。",
          title: "連線能力檢查"
        }
      },
      eyebrow: "區域閘道",
      heroDescription: "負責 {region} 區域內的探測和轉發",
      overview: {
        availableCapacity: "可用容量",
        connectionStatus: "連線狀態",
        lastContact: "最近聯絡",
        processing: "正在處理",
        serviceRegion: "服務區域",
        successRate: "成功率"
      },
      sections: {
        overview: "執行概覽",
        services: "可用服務"
      }
    },
    empty: {
      description: "新增 Gateway Agent，或在現有 Agent 上啟用 Gateway 角色。",
      title: "暫無閘道"
    },
    errors: {
      generateEnableCommandFailed: "產生 Gateway 啟用命令失敗。",
      generateInstallCommandFailed: "產生 Gateway Agent 安裝命令失敗。",
      missingEnableCommand: "系統未返回 Gateway 啟用命令。",
      missingInstallCommand: "系統未返回 Gateway Agent 安裝命令。"
    },
    fields: {
      config: "設定",
      enableCommand: "啟用命令",
      expiresAt: "過期時間",
      installCode: "安裝碼",
      installCommand: "安裝命令",
      platform: "平台",
      region: "區域",
      service: "服務",
      unboundAgent: "不繫結具體 Agent"
    },
    links: {
      assets: "檢視資產",
      executions: "檢視執行記錄"
    },
    modals: {
      detail: {
        title: "閘道詳情"
      },
      enable: {
        title: "現有 Agent 啟用 Gateway"
      },
      install: {
        title: "新增 Gateway Agent"
      }
    },
    page: {
      description: "管理區域路由 Gateway Agent。",
      title: "閘道"
    },
    platforms: {
      linuxSystemd: {
        description: "在 Linux 主機安裝 Gateway Agent 服務"
      },
      windowsService: {
        description: "在 Windows 主機安裝 Gateway Agent 服務"
      }
    },
    resourceName: "閘道",
    status: {
      disabled: "已停用",
      offline: "離線",
      online: "正常線上",
      revoked: "已撤銷",
      upgrading: "升級中"
    },
    values: {
      availableCapacity: "可接收 {count} 個任務",
      defaultRegion: "預設區域",
      regionGatewayName: "{region}閘道",
      taskCount: "{count} 個任務"
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: "服務讀取 Secret",
      secretResolve: "執行器讀取 Secret",
      secretCreate: "建立 Secret",
      secretVersionCreate: "建立 Secret 版本",
      secretRotate: "輪換 Secret",
      certificateImport: "匯入憑證",
      certificateFormatUpdate: "更新憑證產物",
      certificateFormatDelete: "刪除憑證產物",
      deploymentCreate: "建立部署計畫",
      deploymentExecute: "執行部署計畫",
      deploymentRollback: "請求復原",
      approvalCreate: "建立審核",
      approvalApprove: "核准審核",
      approvalReject: "拒絕審核",
      authLogin: "使用者登入",
      authLogout: "使用者登出"
    },
    events: {
      authLoginSuccess: "登入成功",
      authLoginFailure: "登入失敗",
      authLoginFailed: "登入失敗",
      authLogout: "登出",
      authExternalLoginSuccess: "外部身分登入成功",
      authExternalLoginFailed: "外部身分登入失敗",
      secretCreated: "建立 Secret",
      secretVersionCreated: "建立 Secret 版本",
      secretUsed: "讀取 Secret",
      secretRotated: "輪換 Secret",
      permissionDenied: "權限拒絕",
      approvalCreated: "建立審核",
      approvalApproved: "審核通過",
      approvalRejected: "審核退回",
      certificateImported: "憑證變更",
      deploymentCreated: "建立部署",
      deploymentExecuted: "執行部署",
      deploymentRollbackRequested: "請求部署復原",
      pluginInstalled: "安裝外掛",
      pluginPermissionDenied: "外掛權限拒絕",
      workflowTemplateExecuted: "執行工作流模板"
    },
    types: {
      audit: "審計",
      auth: "認證",
      security: "安全",
      secret: "Secret",
      certificate: "憑證",
      certificateVersion: "憑證",
      certificateVersionFormat: "憑證產物",
      deployment: "部署",
      deploymentPlan: "部署計畫",
      execution: "執行",
      approval: "審核",
      permission: "權限",
      plugin: "外掛",
      workflowTemplate: "工作流",
      gateway: "閘道",
      agent: "Agent",
      serviceAsset: "應用資產",
      binding: "繫結"
    },
    actors: {
      user: "使用者",
      system: "系統",
      agent: "Agent",
      plugin: "外掛",
      executor: "執行器"
    },
    resources: {
      secret: "Secret",
      secretVersion: "Secret 版本",
      certificate: "憑證",
      certificateVersion: "憑證版本",
      certificateVersionFormat: "憑證產物",
      deployment: "部署",
      deploymentPlan: "部署計畫",
      execution: "執行任務",
      executionRun: "執行任務",
      approval: "審核單",
      plugin: "外掛",
      workflowTemplate: "工作流模板",
      gateway: "閘道",
      agent: "Agent",
      serviceAsset: "應用資產",
      binding: "憑證繫結",
      auditLog: "審計記錄"
    },
    results: {
      success: "成功",
      failure: "失敗",
      denied: "拒絕"
    },
    verbs: {
      success: "完成",
      failure: "失敗",
      denied: "拒絕"
    },
    tokens: {
      auth: "認證",
      login: "登入",
      logout: "登出",
      external: "外部",
      secret: "Secret",
      resolve: "讀取",
      service: "服務",
      used: "使用",
      created: "建立",
      create: "建立",
      updated: "更新",
      update: "更新",
      deleted: "刪除",
      delete: "刪除",
      version: "版本",
      certificate: "憑證",
      imported: "匯入",
      import: "匯入",
      format: "產物",
      deployment: "部署",
      executed: "執行",
      execute: "執行",
      rollback: "復原",
      requested: "請求",
      approval: "審核",
      approved: "通過",
      rejected: "退回",
      permission: "權限",
      denied: "拒絕",
      gateway: "閘道",
      credential: "認證資訊",
      issued: "發放",
      revoked: "吊銷",
      task: "任務",
      evidence: "證據",
      recorded: "記錄",
      result: "結果",
      plugin: "外掛",
      workflow: "工作流",
      template: "模板",
      synced: "同步",
      tested: "測試",
      source: "來源",
      identity: "身分來源",
      group: "群組",
      mapping: "對映"
    },
    actorWithId: "{actorType} {actorId}",
    summary: "{actor}{verb}“{title}”，物件：{resource}。",
    fallbacks: {
      unknown: "未知"
    }
  },
  audit: {
    page: {
      title: "審計記錄",
      description: "按使用者操作、失敗/拒絕和關鍵業務變更組織記錄，保留可讀摘要。"
    },
    actions: {
      exportEvidence: "匯出審計證據",
      exporting: "匯出中…",
      refreshing: "重新整理中…"
    },
    errors: {
      exportFailed: "匯出審計證據失敗",
      loadFailed: "審計記錄載入失敗",
      withRequestId: "{message}（{requestId}）"
    },
    metrics: {
      ariaLabel: "審計概覽",
      total: {
        title: "審計總數",
        description: "目前篩選範圍內可追蹤的操作記錄。"
      },
      failed: {
        title: "失敗 / 拒絕",
        description: "需要優先複核的失敗執行和拒絕存取。"
      },
      userActions: {
        title: "使用者操作",
        description: "由使用者直接啟動的業務變更和存取動作。"
      }
    },
    list: {
      ariaLabel: "審計記錄列表",
      title: "記錄列表",
      summary: "共 {total} 筆，預設按最新時間排序。",
      timeNotRecorded: "未記錄時間"
    },
    empty: {
      title: "暫無審計事件",
      description: "關鍵操作應能回溯到對應的操作記錄和任務記錄。"
    }
  },
  securityAdmin: {
    emptyValue: "—",
    errors: {
      loadFailed: "載入失敗",
      submitFailed: "提交失敗"
    },
    actions: {
      createResource: "新增{resource}",
      submitting: "提交中…"
    },
    modal: {
      createDescription: "填寫以下欄位後建立{resource}"
    },
    placeholders: {
      selectField: "請選擇{field}"
    },
    table: {
      ariaLabel: "管理列表",
      resourceList: "{resource}列表",
      total: "共 {count} 筆"
    }
  },
  settings: {
    ...(licensingLocaleMessages['zh-TW'] ?? {}),
    securityLabel: "安全設定入口",
    version: {
      title: "版本資訊",
      description: "查看目前執行中的 GCAC 版本。",
      currentVersion: "目前版本",
      product: "產品"
    },
    permissionPolicies: {
      resourceName: "權限策略",
      actions: {
        create: "建立策略"
      },
      columns: {
        id: "策略 ID",
        subjectType: "主體型別",
        subjectId: "主體 ID",
        effect: "效果",
        actions: "動作",
        resourceTypes: "資源型別",
        scope: "作用域"
      },
      fields: {
        subjectType: "主體型別",
        subjectId: "主體 ID",
        effect: "效果",
        actions: "動作",
        resourceTypes: "資源型別",
        tenantId: "租戶作用域"
      },
      subjectTypes: {
        role: "角色",
        user: "使用者",
        plugin: "外掛",
        executor: "執行器"
      },
      effects: {
        allow: "允許",
        deny: "拒絕"
      }
    },
    groupRoleMappings: {
      resourceName: "群組對映",
      actions: {
        create: "建立對映"
      },
      columns: {
        sourceId: "身分來源 ID",
        externalGroup: "外部群組",
        roleId: "本機角色",
        enabled: "啟用",
        updatedAt: "更新時間"
      },
      fields: {
        sourceId: "身分來源 ID",
        externalGroup: "外部群組",
        roleId: "本機角色 ID"
      }
    },
    users: {
      title: "帳號主體列表",
      summary: {
        groups: "共 {count} 筆",
        users: "共 {total} 筆，已選 {selected} 筆"
      },
      actions: {
        createUser: "建立使用者",
        addGroup: "新增群組",
        bulkDelete: "批次刪除",
        edit: "編輯",
        delete: "刪除",
        lookupLoading: "搜尋中...",
        lookupUser: "搜尋使用者",
        lookupGroup: "搜尋群組",
        creating: "建立中...",
        saving: "儲存中...",
        saveChanges: "儲存修改",
        adding: "新增中..."
      },
      risks: {
        bulkDelete: "批次刪除會移除所選使用者的本機認證資訊和角色關聯。",
        deleteUser: "刪除使用者會移除該帳號的本機認證資訊和角色關聯。"
      },
      tabs: {
        users: "使用者",
        groups: "群組"
      },
      empty: {
        users: "暫無使用者",
        groups: "暫無使用者群組"
      },
      columns: {
        username: "使用者名稱",
        displayName: "顯示名稱",
        email: "電子郵件",
        source: "來源",
        identitySourceName: "身分來源名稱",
        status: "狀態",
        tenant: "租戶",
        roles: "角色",
        lastSyncedAt: "最近同步",
        updatedAt: "更新時間",
        actions: "操作",
        groupName: "群組名稱",
        code: "編碼",
        externalRef: "外部標識"
      },
      dialog: {
        userCreateTitle: "建立使用者",
        userEditTitle: "編輯使用者",
        userCreateDescription: "建立本機使用者，或從身分來源按使用者名稱搜尋後建立繫結使用者。",
        userEditDescription: "編輯使用者的顯示名稱、電子郵件、狀態和角色。",
        groupCreateTitle: "新增群組",
        groupCreateDescription: "建立本機群組，或從身分來源按群組名稱搜尋後新增外部群組。"
      },
      aria: {
        principalType: "主體型別",
        createMode: "建立方式",
        externalUserProfile: "身分來源使用者資料",
        groupCreateMode: "建立群組方式",
        externalGroupProfile: "身分來源使用者群組資料"
      },
      modes: {
        localUser: "本機使用者",
        externalUser: "身分來源使用者",
        localGroup: "本機群組",
        externalGroup: "身分來源群組"
      },
      fields: {
        identitySource: "身分來源",
        directoryUsername: "目錄使用者名稱",
        username: "使用者名稱",
        displayName: "顯示名稱",
        email: "電子郵件",
        role: "角色",
        initialPassword: "初始密碼",
        status: "狀態",
        directoryGroupName: "目錄群組名稱",
        groupName: "群組名稱",
        groupCode: "群組編碼",
        directoryDn: "目錄 DN"
      },
      placeholders: {
        selectIdentitySource: "請選擇身分來源",
        directoryUsername: "例如 jackson",
        displayName: "憑證操作員",
        initialPassword: "輸入初始密碼",
        directoryGroupName: "例如 GCAC-Ops",
        groupName: "憑證維運群組"
      },
      options: {
        unset: "不設定"
      },
      status: {
        active: "啟用",
        disabled: "停用"
      },
      labels: {
        identitySourceOption: "{name}（{type}）"
      },
      errors: {
        loadUsersFailed: "載入使用者失敗",
        loadGroupsFailed: "載入使用者群組失敗",
        createUserFailed: "建立使用者失敗",
        updateUserFailed: "更新使用者失敗",
        externalUserEmpty: "身分來源沒有返回使用者資料",
        lookupExternalUserFailed: "搜尋身分來源使用者失敗",
        externalGroupEmpty: "身分來源沒有返回使用者群組資料",
        lookupExternalGroupFailed: "搜尋身分來源使用者群組失敗",
        createGroupFailed: "建立使用者群組失敗",
        deleteUsersFailed: "刪除使用者失敗"
      }
    },
    roles: {
      page: {
        title: "權限管理",
        description: "以角色為中心維護授權物件範圍，並把使用者或群組分配到角色。"
      },
      actions: {
        createRole: "建立角色",
        refreshObjects: "重新整理物件",
        loading: "載入中...",
        creating: "建立中...",
        saving: "儲存中...",
        detail: "詳情",
        authorize: "授權",
        grantPermission: "授予權限",
        assignMembers: "分配成員",
        delete: "刪除",
        deleteRole: "刪除角色",
        deleting: "刪除中...",
        clearSelection: "清空選擇"
      },
      columns: {
        roleId: "角色 ID",
        code: "編碼",
        name: "名稱",
        builtin: "內建",
        policyCount: "策略數",
        permissions: "權限點",
        actions: "操作",
        objectScope: "物件範圍",
        accessLevel: "權限級別",
        effect: "效果",
        memberType: "成員型別",
        member: "成員"
      },
      table: {
        emptyRoles: "暫無角色",
        roleRecords: "角色記錄",
        emptyGrants: "目前角色暫無物件權限",
        currentPermissions: "目前角色權限",
        emptyMembers: "目前角色暫無成員分配",
        assignedMembers: "已分配成員"
      },
      categories: {
        certificate: "憑證",
        gateway: "閘道",
        agent: "Agent",
        serviceAsset: "應用資產",
        deploymentPlan: "更新計畫",
        workflow: "工作流",
        auditLog: "記錄",
        systemSetting: "系統設定"
      },
      accessLevel: {
        read: "唯讀",
        edit: "編輯",
        control: "完全控制"
      },
      effect: {
        allow: "允許",
        deny: "拒絕"
      },
      principal: {
        user: "使用者",
        group: "群組",
        externalGroup: "身分來源群組"
      },
      summary: {
        selectedMembers: "已選 {count} 個成員",
        chooseMembers: "請選擇使用者或群組",
        selectedScopes: "已選 {count} 個範圍",
        chooseObjectNode: "請選擇物件樹節點",
        selectedScopeLabel: "已選範圍",
        selectedMemberLabel: "已選成員"
      },
      tree: {
        rootLabel: "全部物件",
        rootDescription: "所有可授權業務物件",
        typeDescription: "{category}全部記錄",
        allBusinessObjects: "全部業務物件",
        selectedScopeAria: "已選授權範圍",
        objectTreeAria: "可授權物件樹",
        authorizableObjects: "可授權物件",
        loading: "正在載入物件樹...",
        kind: {
          all: "全部",
          category: "分類",
          record: "記錄"
        }
      },
      format: {
        labelWithId: "{label}（{id}）",
        recordFallback: "{category} {value}",
        unnamedRecord: "未命名記錄"
      },
      detail: {
        title: "角色詳情",
        titleWithName: "角色 {name}",
        description: "物件範圍、具體物件、權限級別和成員分配在這裡維護。"
      },
      create: {
        title: "建立角色",
        description: "填寫角色職責，並可直接為該角色授權物件範圍。",
        nameLabel: "角色名稱",
        namePlaceholder: "憑證操作員",
        descriptionLabel: "說明",
        descriptionPlaceholder: "負責憑證日常操作",
        authorizedRole: "授權角色",
        newRole: "新角色"
      },
      grant: {
        title: "授予角色權限",
        description: "從物件樹選擇範圍，並直接設定該範圍上的權限級別。",
        roleLabel: "角色"
      },
      member: {
        title: "分配成員",
        titleWithName: "分配成員：{name}",
        description: "選擇使用者或群組，系統會把成員分配到該角色已有的授權物件範圍。",
        targetRole: "目標角色",
        authorizedScope: "授權範圍",
        objectScopeCount: "{count} 個物件範圍",
        selectedMembersAria: "已選成員",
        assignableMembersAria: "可分配成員",
        emptyAssignable: "暫無可分配{type}"
      },
      errors: {
        loadObjectTreeFailed: "載入物件樹失敗",
        loadDataFailed: "載入權限管理資料失敗",
        missingRoleId: "未取得角色 ID",
        createRoleFailed: "建立角色失敗",
        grantRoleFailed: "授予角色權限失敗",
        roleNoObjectScopes: "該角色還沒有授權物件範圍，請先為角色授予權限。",
        assignMembersFailed: "分配成員失敗",
        deleteRoleFailed: "刪除角色失敗",
        missingObjectSetId: "未取得物件範圍 ID"
      },
      confirm: {
        deleteRole: "確認刪除角色“{name}”？刪除後會同步移除該角色的使用者分配和物件授權。"
      },
      auditLogs: {
        auth: {
          name: "認證登入記錄",
          description: "登入、登出、外部身分來源登入"
        },
        security: {
          name: "安全管理記錄",
          description: "使用者、角色、權限、身分來源變更"
        },
        certificate: {
          name: "憑證記錄",
          description: "憑證匯入、版本、產物與繫結操作"
        },
        asset: {
          name: "資產記錄",
          description: "應用資產、主機、服務例項與站點資產操作"
        },
        gateway: {
          name: "閘道記錄",
          description: "閘道路由、探測與狀態變更"
        },
        agent: {
          name: "Agent 記錄",
          description: "Agent 註冊、心跳、任務與升級操作"
        },
        deployment: {
          name: "更新計畫記錄",
          description: "部署計畫、執行、復原與審核"
        },
        workflow: {
          name: "工作流記錄",
          description: "工作流模板與執行操作"
        },
        secret: {
          name: "金鑰記錄",
          description: "Secret 建立、使用與輪換"
        },
        system: {
          name: "系統記錄",
          description: "系統設定與平台級事件"
        }
      }
    },
    identitySources: {
      actions: {
        create: "建立身分來源",
        edit: "編輯",
        delete: "刪除",
        testConnection: "測試連通性",
        testing: "檢測中...",
        creating: "建立中...",
        saving: "儲存中...",
        saveChanges: "儲存修改",
        expandAdvanced: "展開進階設定",
        collapseAdvanced: "收起進階設定"
      },
      columns: {
        name: "名稱",
        type: "目錄型別",
        server: "伺服器",
        status: "狀態",
        actions: "操作"
      },
      table: {
        title: "身分來源列表",
        total: "共 {count} 筆"
      },
      empty: "暫無身分來源",
      dialog: {
        createTitle: "建立身分來源",
        editTitle: "編輯身分來源",
        createDescription: "先填寫基礎連線資訊；過濾器和目錄型別放在進階設定裡。",
        editDescription: "修改身分來源設定；若要更新服務帳號密碼，請重新填寫密碼。"
      },
      fields: {
        name: "名稱",
        domain: "域名",
        protocol: "協議",
        serverAddress: "伺服器位址",
        baseDn: "Base DN",
        bindDn: "服務帳號 DN",
        bindPassword: "服務帳號密碼",
        directoryType: "目錄型別",
        defaultRole: "預設角色",
        enabled: "啟用狀態",
        userDnTemplate: "使用者 DN/UPN 模板",
        userFilter: "使用者過濾器",
        groupFilter: "群組過濾器",
        syncUserFilter: "同步使用者過濾器",
        requireGroupMapping: "要求登入使用者必須命中群組對映"
      },
      placeholders: {
        name: "例如：企業 AD",
        domain: "例如：example.com",
        serverAddress: "例如：ad.example.com:636",
        baseDn: "例如：DC=example,DC=com",
        bindDn: "例如：CN=svc-gcac,OU=Users,DC=example,DC=com",
        bindPasswordCreate: "輸入服務帳號密碼",
        bindPasswordEdit: "留空表示沿用現有密碼",
        autoByDirectoryType: "留空則按目錄型別自動推導",
        userFilter: "例如：(uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "例如：(member={'{'}{'{'}userDn{'}'}{'}'})"
      },
      labels: {
        finalUrl: "最終位址：{url}"
      },
      options: {
        unset: "不設定"
      },
      status: {
        enabled: "啟用",
        disabled: "已停用",
        disabledShort: "停用"
      },
      types: {
        activeDirectory: "Active Directory",
        ldap: "標準 LDAP"
      },
      protocols: {
        ldap: "LDAP",
        ldaps: "LDAPS"
      },
      risks: {
        delete: "刪除身分來源後，該目錄的登入、同步和群組對映都會失效。"
      },
      test: {
        dialogTitle: "測試身分來源連通性",
        dialogDescription: "正在檢測 {name}（{server}）的 DNS、LDAP 認證連接埠和 BIND 狀態。",
        loading: "正在依序檢測 DNS、LDAP 認證連接埠和 BIND 狀態...",
        checks: {
          dns: { title: "檢查 DNS 解析" },
          port: { title: "檢查 LDAP 認證連接埠" },
          bind: { title: "檢查 LDAP BIND" }
        },
        status: {
          passed: "成功",
          failed: "失敗",
          skipped: "已跳過"
        },
        messages: {
          summaryPassed: "LDAP 連通性檢測全部通過",
          summaryFailed: "LDAP 連通性檢測未通過",
          dnsIp: "目標是 IP 位址，無需進行 DNS 查詢",
          dnsResolved: "DNS 解析成功：{addresses}",
          dnsFailed: "DNS 解析失敗",
          portReachable: "{protocol} 認證連接埠 {port} 可連通",
          portFailed: "LDAP 認證連接埠不可達",
          bindServicePassed: "LDAP 服務帳號 BIND 和 Base DN 查詢成功",
          bindAnonymousPassed: "匿名 LDAP BIND 和 Base DN 查詢成功",
          bindFailed: "LDAP BIND 或 Base DN 查詢失敗",
          skippedInvalidUrl: "由於 LDAP 位址無效，已跳過",
          skippedDnsFailed: "由於 DNS 解析失敗，已跳過",
          skippedPortFailed: "由於 LDAP 認證連接埠不可達，已跳過",
          unknownCheck: "檢測項未通過（{code}）",
          checkNotReturned: "伺服器未返回此檢測項結果。"
        },
        errors: {
          emptyResult: "伺服器未返回連通性檢測結果",
          requestFailed: "連通性檢測請求失敗"
        }
      },
      secret: {
        bindPasswordName: "{name} LDAP 服務帳號密碼"
      },
      messages: {
        createSuccess: "身分來源建立成功",
        updateSuccess: "身分來源更新成功"
      },
      errors: {
        loadFailed: "載入身分來源失敗",
        createBindPasswordSecretFailed: "建立服務帳號密碼 Secret 失敗",
        createFailed: "建立身分來源失敗",
        updateFailed: "更新身分來源失敗",
        deleteFailed: "刪除身分來源失敗"
      }
    }
  },
  bindings: {
    actions: {
      create: "新增設定檔案",
      toggleFilters: "篩選",
      edit: "編輯",
      delete: "刪除",
      deleting: "刪除中...",
      applyTemplate: "套用內建模板",
      saving: "儲存中...",
      confirmSave: "確認儲存"
    },
    columns: {
      configName: "設定檔名稱",
      targetSummary: "目標環境",
      displayFormat: "內容格式",
      extension: "副檔名",
      encodingSummary: "編碼",
      exportSummary: "包含內容 / 匯出選項",
      actions: "操作"
    },
    dialog: {
      createTitle: "新增憑證格式設定",
      editTitle: "編輯憑證格式設定",
      description: "選擇系統平台與目標平台後，可套用內建模板並逐項調整匯出內容。"
    },
    list: {
      title: "憑證格式設定列表",
      descriptionWithCount: "可複用的憑證格式模板。目前 {count} 筆"
    },
    empty: {
      text: "暫無憑證格式設定"
    },
    fields: {
      contentFormat: "內容格式",
      systemPlatform: "系統平台",
      runtimePlatform: "目標平台",
      configName: "設定檔名稱",
      backendFormat: "底層格式",
      outputExtension: "輸出副檔名",
      expiresAt: "設定失效時間（可選）",
      certificateEncoding: "憑證編碼",
      certificateContentEncoding: "憑證內容編碼",
      privateKeyEncoding: "私密金鑰編碼",
      includeLeafCertificate: "包含公開金鑰憑證",
      includeCertificateChain: "包含憑證鏈",
      includePrivateKey: "包含私密金鑰",
      mainArtifactIncludesChain: "主產物包含憑證鏈",
      generateChainFile: "額外產生憑證鏈檔案",
      generatePrivateKeyFile: "額外產生私密金鑰檔案",
      exportPassword: "匯出密碼"
    },
    formats: {
      pfx: "PKCS#12 / PFX 容器",
      jks: "JKS 容器",
      pemBundle: "PEM 單檔案 Bundle",
      pemCert: "PEM 憑證檔案",
      pemKey: "私密金鑰檔案",
      cer: "憑證檔案（.cer）",
      crt: "憑證檔案（.crt）",
      p7b: "PKCS#7 / P7B 憑證鏈",
      custom: "自定義"
    },
    sections: {
      templates: {
        title: "內建模板",
        description: "模板基於各平台常見 TLS 落地方式預填內容格式、包含內容和匯出規則，套用後仍可繼續修改。"
      },
      basic: {
        title: "基礎資訊",
        description: "先定義設定檔案身分、真實內容格式，以及最終副檔名。"
      },
      encoding: {
        title: "編碼選擇",
        description: "僅顯示目前內容格式支援的編碼選項。"
      },
      content: {
        title: "包含內容",
        description: "定義主產物檔案中包含的內容：公開金鑰、憑證鏈、私密金鑰。"
      },
      export: {
        title: "匯出選項",
        description: "定義是否額外產生鏈檔案、私密金鑰檔案，以及容器專屬密碼選項。"
      }
    },
    filters: {
      keywordPlaceholder: "設定名稱 / 目標環境 / Alias / 內容格式"
    },
    placeholders: {
      configName: "例如：裝置相容單檔案PEM",
      exportPassword: "請輸入 PFX/JKS 匯出密碼"
    },
    validation: {
      selectPlatformsFirst: "請先選擇系統平台和目標平台。",
      configNameRequired: "必須填寫設定檔名稱",
      passwordRequired: "PFX/JKS 設定必須填寫匯出密碼"
    },
    errors: {
      loadFailed: "憑證格式設定載入失敗",
      saveFailed: "儲存憑證格式設定失敗",
      deleteFailed: "刪除憑證格式設定失敗",
      createExportSecretFailed: "建立匯出密碼 Secret 失敗",
      withCode: "{message}（{code}）"
    },
    fallbacks: {
      unnamedConfig: "未命名設定-{index}",
      unspecified: "未指定",
      aliasUnset: "未設定 Alias"
    },
    labels: {
      aliasWithValue: "Alias：{alias}",
      requestId: "請求 ID：{requestId}"
    },
    encoding: {
      pkcs12Container: "PKCS#12 容器",
      jksContainer: "JKS 容器",
      privateKeyWithEncoding: "私密金鑰 {encoding}",
      pkcs7Chain: "PKCS#7 憑證鏈",
      certificateWithEncoding: "憑證 {encoding}",
      default: "預設"
    },
    export: {
      leafCertificate: "公開金鑰",
      certificateChain: "憑證鏈",
      privateKey: "私密金鑰",
      extraChainFile: "額外鏈檔案",
      extraPrivateKeyFile: "額外私密金鑰檔案"
    },
    secret: {
      defaultConfigName: "憑證格式設定",
      exportPasswordName: "{name} 匯出密碼"
    },
    select: {
      placeholder: "請選擇"
    },
    separators: {
      export: " · "
    },
    hints: {
      savedPassword: "已設定匯出密碼；如需更換，請直接輸入新密碼覆蓋。"
    },
    templates: {
      windowsIis: {
        configName: "Windows-IIS-PKCS12-標準模板",
        description: "IIS 使用 PKCS#12/PFX 容器最常見，主產物內直接攜帶伺服器憑證、憑證鏈和私密金鑰。"
      },
      windowsNginx: {
        configName: "Windows-NGINX-PEM-標準模板",
        description: "NGINX 主流使用 PEM 單檔案承載伺服器憑證與鏈，再配獨立私密金鑰檔案。"
      },
      windowsApache: {
        configName: "Windows-Apache-PEM-標準模板",
        description: "Apache 通常以 PEM 憑證檔案和獨立私密金鑰交付，鏈檔案額外匯出便於相容不同維運習慣。"
      },
      windowsTomcat: {
        configName: "Windows-Tomcat-PKCS12-標準模板",
        description: "Tomcat 以 JKS/PKCS#12 keystore 為主，這裡預設使用更通用的 PKCS#12。"
      },
      windowsOther: {
        configName: "Windows-裝置相容單檔案PEM模板",
        description: "相容部分裝置要求：單檔案中同時包含公開金鑰憑證、憑證鏈與私密金鑰，副檔名可再改成 .crt/.cer。"
      },
      linuxIis: {
        configName: "Linux-IIS-相容模板",
        description: "如果最終目標仍是 IIS，最合理的交付物仍然是 PKCS#12/PFX 容器。"
      },
      linuxNginx: {
        configName: "Linux-NGINX-PEM-標準模板",
        description: "NGINX 官方設定圍繞 PEM 單檔案憑證鏈與獨立私密金鑰展開。"
      },
      linuxApache: {
        configName: "Linux-Apache-PEM-標準模板",
        description: "Apache 常見做法是 PEM 憑證檔案配獨立私密金鑰，鏈檔案額外匯出便於拆分部署。"
      },
      linuxTomcat: {
        configName: "Linux-Tomcat-PKCS12-標準模板",
        description: "Tomcat 預設建議交付 keystore 容器，這裡使用更通用的 PKCS#12。"
      },
      linuxOther: {
        configName: "Linux-裝置相容單檔案PEM模板",
        description: "Linux 通用裝置若接受單檔案 PEM，可先用 bundle 形式，再按目標裝置調整副檔名與包含內容。"
      }
    }
  },
  deploymentInputs: {
    title: '部署輸入',
    description: '根據外掛或工作流程宣告的統一輸入契約設定部署參數。',
    saveAssetFirst: '請先儲存應用資產與執行來源，再編輯由後端統一投影的部署輸入。',
    contractVersion: '契約 {version}',
    groups: { required: '必填設定', advanced: '進階設定', readonly: '唯讀與執行階段值' },
    actions: { expand: '展開進階設定', collapse: '收合進階設定' },
    placeholders: { select: '請選擇', credential: '請選擇憑證', artifact: '請選擇產物格式', output: '請選擇輸出' },
    artifacts: { format: '產物格式' },
    allowInsecureTls: {
      label: '允許略過 TLS 憑證驗證',
      description: '明確授權本次部署在裝置使用自簽或不受信任憑證時略過 TLS 憑證驗證。',
      help: '這只表示你的部署意圖，不會自動取得執行權限；仍需通過核准並由主機簽發執行授權。'
    },
    runtimeValue: '執行階段由 {source} 提供',
    source: '來源：{source}',
    sourceKinds: { asset: '資產', binding: '繫結', default: '預設值', derived: '衍生值', system: '系統值', step_output: '步驟輸出', unknown: '未知來源' },
    issues: {
      title: '輸入問題',
      unknown: '部署輸入驗證失敗（{code}）',
      DEPLOYMENT_INPUT_REQUIRED: '缺少必填部署輸入',
      DEPLOYMENT_CONNECTION_REQUIRED: '缺少必填連線設定',
      DEPLOYMENT_CREDENTIAL_REQUIRED: '缺少必填憑證',
      DEPLOYMENT_ARTIFACT_REQUIRED: '缺少必填部署產物',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: '此部署輸入不允許覆寫',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: '部署輸入槽位未宣告',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: '部署輸入欄位未宣告',
      DEPLOYMENT_INPUT_TYPE_INVALID: '部署輸入型別不正確',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: '固定部署輸入不允許覆寫',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: '缺少憑證快照',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: '憑證快照與目前選擇不一致',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: '不支援此憑證類型',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: '缺少產物快照',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: '缺少必填產物輸出'
    }
  },
  assets: {
    userView: {
      stepLabel: 'Step 2 of 3 · Application',
      title: 'Connect an application',
      description: 'Add the application that should receive the certificate. Technical deployment details stay hidden unless the selected target requires them.',
      addAction: 'Add application',
      listTitle: 'Connected applications',
      listDescription: 'These applications can be selected in the deployment step.',
      continueToDeployment: 'Continue to deployment',
      loadFailed: 'Failed to load applications',
      emptyTitle: 'No application connected yet',
      emptyDescription: 'Add an application so a certificate can be deployed to it.',
      deploymentLocation: 'Deployment location',
      targetPending: 'Deployment location pending',
      form: {
        eyebrow: 'Simple setup',
        title: 'Add the application to update',
        description: 'Provide the application address and choose where GCAC should deploy the certificate.',
        addressPlaceholder: 'app.example.com',
        portPlaceholder: '443',
        locationTitle: 'Where should it be updated?',
        locationDescription: 'Choose the existing device, service, and deployment target. The underlying binding logic remains unchanged.',
        device: 'Device',
        service: 'Service',
        site: 'Site',
        target: 'Deployment target',
        certificateFormat: 'Certificate format'
      }
    },
    title: "應用資產",
    description: "以域名或 IP 為主物件管理應用入口，聚焦位址、埠、協議、站點與執行定位。",
    resourceName: "應用資產",
    executionModes: {
      label: "執行方式",
      plugin: { title: "外掛執行", description: "使用受管目標已啟用的憑證部署能力。" },
      workflowOverride: { title: "工作流覆蓋執行", description: "略過外掛能力，改用使用者工作流執行。", notice: "啟用工作流覆蓋後，本資產的外掛指派將停用，只保留工作流執行綁定。" }
    },
    actions: {
      add: "新增資產",
      edit: "編輯",
      detail: "詳情",
      addVariable: "新增變數",
      delete: "刪除",
      deleteRisk: "刪除後，此應用資產及其人工目標關聯將從應用資產清單中移除；裝置探索出的框架、站點、Virtual Server 和受管目標不會被刪除。",
      rollbackFromLatestSnapshot: "從最新快照啟動回復",
      rollingBack: "回復中...",
      saving: "儲存中...",
      creating: "建立中...",
      saveChanges: "儲存修改",
      confirmCreate: "確認建立"
    },
    columns: {
      domain: "存取域名",
      port: "埠",
      protocol: "協議",
      platform: "平台",
      framework: "框架",
      site: "站點",
      status: "狀態",
      actions: "操作"
    },
    fields: {
      assetId: "應用資產 ID",
      domain: "存取域名",
      addressType: "位址型別",
      port: "埠",
      protocol: "協議",
      verifyUrl: "驗證 URL",
      platform: "平台",
      frameworkType: "框架型別",
      deploymentStrategyCompatibility: "部署策略相容模式",
      serviceInstanceId: "服務例項 ID",
      siteId: "站點 ID",
      managedTargetId: "受管目標 ID",
      bindingKey: "繫結鍵",
      hostId: "主機 ID",
      environment: "環境",
      discoverySource: "發現來源",
      lastDiscoveredAt: "最後發現時間",
      tags: "標籤",
      managedTarget: "受管目標",
      siteName: "站點名稱",
      bindingInformation: "繫結資訊",
      hostHeader: "Host Header",
      sniName: "SNI 名稱",
      currentCertificate: "目前憑證",
      targetCertificate: "目標憑證",
      expectedFingerprint: "期望指紋",
      certificateStore: "憑證儲存",
      snapshotType: "快照型別",
      time: "時間",
      executionRun: "執行記錄",
      displayName: "顯示名稱",
      siteInstance: "站點例項",
      certificateFormat: "憑證產物設定",
      workflow: "工作流",
      workflowVersionSelection: "工作流版本策略",
      publishedVersion: "已釋出版本",
      runner: "執行位置",
      artifactFormat: "產物格式設定",
      updatePlugin: "憑證更新外掛"
    },
    capability: { source: "能力來源", plugin: "外掛版本", runtime: "執行階段", executionLocation: "執行位置", pendingAssignment: "儲存後將建立應用資產層級的部署能力指派。" },
    links: {
      certificateBindings: "檢視憑證繫結",
      executions: "檢視執行記錄"
    },
    empty: {
      title: "暫無應用資產",
      description: "等待系統自動發現，或手動補錄應用入口。",
      noBindingInformation: "未提供繫結資訊",
      notSet: "未設定",
      notSelected: "未選擇",
      noVariablePreset: "暫無可新增變數",
      basicEntryIncomplete: "基礎入口未完成"
    },
    detail: {
      title: "應用詳情",
      description: "檢視資產詳情、繫結關係、部署入口和快照記錄。",
      tabsAriaLabel: "應用詳情標籤頁",
      tabs: {
        overview: "基礎資訊",
        snapshots: "快照"
      },
      loadingTargetBinding: "正在載入目標繫結詳情...",
      loadingSnapshots: "正在載入快照...",
      emptyCertificateBindings: "暫無憑證繫結關係。",
      emptySnapshots: "暫無快照。",
      rollbackSubmitted: "已提交回復請求，請到“執行記錄”查看回復執行。",
      sections: {
        overview: {
          title: "基礎資訊",
          description: "應用資產是主物件，主機和站點只作為執行定位資訊出現。"
        },
        targetBinding: {
          title: "目標繫結",
          description: "繫結必須明確落到站點和受管目標，而不是繼續靠域名猜。"
        },
        certificateBindings: {
          title: "憑證繫結關係",
          description: "把憑證關係明確到 binding 上，而不是隻看域名。"
        },
        snapshots: {
          title: "快照",
          description: "部署前後與回復後的現場狀態必須能直接看到，不能只剩任務記錄。"
        }
      }
    },
    compatibilityModes: {
      unified: "統一外掛繫結",
      legacy: "歷史相容",
      legacyAdapted: "統一繫結與歷史設定雙讀"
    },
    managementModes: {
      agent: "Agent 模式",
      agentDescription: "繫結 Agent、站點例項和受管目標",
      workflow: "工作流模式",
      workflowDescription: "選擇工作流版本和執行變數"
    },
    workflowVersionSelection: {
      pinned: "固定指定版本",
      latestPublished: "一律使用最新釋出版本"
    },
    loading: {
      agents: "載入 Agent 中...",
      sites: "載入站點中...",
      managedTargets: "載入目標中...",
      certificateFormats: "載入格式設定中...",
      workflows: "載入工作流中...",
      versions: "載入版本中...",
      gateways: "載入 Gateway 中...",
      credentials: "載入認證資訊中..."
    },
    select: {
      agent: "請選擇 Agent",
      siteInstance: "請選擇站點例項",
      managedTarget: "請選擇受管目標",
      certificateFormat: "請選擇憑證產物設定",
      workflow: "請選擇工作流",
      publishedVersion: "請選擇已釋出版本",
      gateway: "請選擇 Gateway",
      variablePreset: "選擇預設變數",
      credential: "請選擇認證資訊",
      generic: "請選擇",
      artifactFormat: "請選擇格式設定",
      output: "請選擇輸出項",
      optionalOutput: "可不選擇",
      updatePluginOptional: "可不選擇，繼續使用目前生效的外掛"
    },
    validation: {
      variableNameRequired: "變數名稱不能為空",
      variableNameInvalid: "變數 {name} 名稱不合法",
      variableDuplicated: "變數 {name} 重複",
      variableRequired: "變數 {name} 必填",
      variableMustBeNumber: "變數 {name} 必須是數字",
      variableMustBeJsonObject: "變數 {name} 必須是 JSON 物件",
      variableInvalidJson: "變數 {name} 不是合法 JSON",
      variableCredentialInvalid: "變數 {name} 必須選擇有效認證資訊",
      certificateFormatRequired: "憑證變數 {name} 必須選擇憑證格式設定",
      certificateOutputRequired: "憑證變數 {name}.{slot} 必須選擇輸出項",
      certificateOutputMissing: "憑證變數 {name}.{slot} 選擇的輸出項不存在"
    },
    workflowVariableTypes: {
      string: "字串",
      number: "數位",
      boolean: "布林",
      enum: "列舉",
      object: "物件",
      file: "檔案",
      credential: "認證資訊",
      certificate: "憑證"
    },
    wizard: {
      ariaLabel: "應用資產建立步驟",
      steps: {
        basicEntry: "基礎入口",
        deploymentMode: "部署模式",
        confirmSave: "確認儲存"
      },
      stepState: {
        active: "進行中",
        done: "已完成",
        pending: "待開始",
        incomplete: "待完成",
        readyNext: "可進入下一步",
        pendingSubmit: "等待提交"
      },
      panels: {
        basicEntryTitle: "基礎入口",
        basicEntryDescription: "先填寫域名、埠、協議和平台，用它們確定應用入口身分。",
        agentTitle: "Agent 目標繫結",
        agentDescription: "選擇 Agent、站點例項、受管目標和憑證產物設定。",
        workflowTitle: "工作流執行設定",
        workflowDescription: "選擇工作流版本、執行位置和變數，憑證變數會在執行時注入。",
        confirmTitle: "確認儲存",
        confirmDescription: "檢查應用入口、部署模式和執行引數，確認後寫入應用資產。"
      }
    },
    form: {
      createTitle: "手動新增應用資產",
      editTitle: "編輯應用資產",
      createDescription: "建立應用入口並繫結後續部署需要的目標資訊。",
      editDescription: "修改應用入口和部署目標繫結。",
      createRequestCompleted: "建立請求已完成。",
      editRequestCompleted: "儲存請求已完成。",
      agentCertificateFormatHint: "Agent 模式下會使用該憑證產物設定產生部署材料。",
      placeholders: {
        displayName: "例如：生產站點入口",
        verifyUrl: "例如：https://example.com/health",
        siteName: "例如：生產站點",
        bindingInformation: "例如：*:443:example.com",
        hostHeader: "例如：example.com",
        sniName: "例如：example.com"
      }
    },
    review: {
      accessEntry: "存取入口",
      deploymentMode: "部署模式",
      agentSiteTarget: "Agent / 站點 / 目標",
      workflowVersion: "工作流版本",
      gatewayRunner: "Gateway：{gateway}",
      variableCount: "{count} 個變數",
      onlyBasicEntry: "僅基礎入口",
      autoGeneratedByEntry: "按應用入口產生"
    },
    workflowTarget: {
      title: "工作流目標資訊",
      description: "用於工作流資產展示、部署後探測和 DSL 目標變數同步。",
      dslSyncHint: "已同步到 DSL 目標變數",
      advancedTitle: "進階設定",
      advancedDescription: "僅在需要覆寫預設監聽、請求網域或 TLS 憑證網域時修改。",
      expandAdvanced: "展開進階設定",
      collapseAdvanced: "收起進階設定",
      bindingInformationLabel: "服務監聽規則",
      bindingInformationHelp: "用於描述服務監聽的位址、連接埠與網域組合。",
      hostHeaderLabel: "存取請求網域",
      hostHeaderHelp: "僅在目標服務要求指定 HTTP Host 標頭時修改。",
      sniNameLabel: "TLS 憑證網域",
      sniNameHelp: "僅在 TLS 握手網域與存取網域不同時修改。"
    },
    workflowVariables: {
      title: "工作流變數",
      configuredCount: "已設定 {configured}/{total}",
      name: "變數名稱",
      type: "型別",
      value: "值",
      manual: "手動",
      empty: "暫無工作流變數。",
      noPublishedVersion: "請選擇已釋出工作流版本後設定變數。",
      certificateAutoInjected: "憑證版本由部署計畫選擇，執行時自動注入。",
      certificateDescription: "憑證版本由部署計畫選擇，應用資產在下方繫結格式設定和輸出項，執行時注入 {name}.outputs.*.content。",
      presets: {
        deviceHost: "目標主機或裝置位址",
        sshUsername: "SSH 使用者名稱",
        credential: "工作流憑據",
        certificate: "憑證產物",
        targetPlatform: "目標平台",
        apacheServiceName: "Apache systemd 服務名",
        apacheSiteConfigPath: "Apache 站點設定路徑",
        certificateFilePath: "憑證目的路徑",
        certificateKeyFilePath: "私密金鑰目的路徑",
        backupRoot: "憑證備份根目錄",
        expectedResponseContains: "驗證響應包含文本",
        virtualHostServerName: "虛擬主機 ServerName"
      }
    },
    certificateBindings: {
      title: "憑證變數繫結",
      description: "為工作流中的憑證變數選擇憑證產物設定和輸出項。",
      variableCount: "{count} 個憑證變數",
      defaultVariableDescription: "憑證產物變數",
      noArtifactOutputs: "目前格式設定暫無可選輸出項。"
    },
    certificateOutputs: {
      publicCertificateWithChain: "公開金鑰憑證+憑證鏈",
      publicCertificate: "公開金鑰憑證",
      certificateChain: "憑證鏈",
      privateKey: "私密金鑰",
      pemBundle: "PEM 合併產物",
      container: "{format} 容器",
      bundle: "Bundle"
    },
    certificateFormats: {
      savedConfigMissingWithId: "{id}（已儲存設定，目前列表未返回）",
      withPrivateKey: "含私密金鑰",
      withoutPrivateKey: "無私密金鑰"
    },
    snapshotTypes: {
      preDeploy: "部署前",
      postDeploy: "部署後",
      postRollback: "回復後",
      errorState: "錯誤態",
      rollbackPoint: "回復點"
    },
    errors: {
      loadWorkflowListFailed: "載入工作流列表失敗",
      loadWorkflowVersionsFailed: "載入工作流版本失敗",
      loadGatewayListFailed: "載入閘道列表失敗",
      loadCertificateFormatsFailed: "載入憑證格式設定失敗",
      loadAssetDetailFailed: "載入應用資產詳情失敗",
      rollbackFailed: "啟動回復失敗",
      loadTargetsFailed: "載入站點和受管目標失敗",
      createAssetFailed: "建立應用資產失敗",
      pluginFormLoadFailed: "載入外掛設定表單失敗",
      pluginBindingCreateFailed: "儲存外掛綁定失敗",
      loadWorkflowCredentialsFailed: "載入工作流憑據失敗",
      noAvailableSiteInstance: "未找到可用的站點例項，請先確認裝置探索已成功上報框架和站點。",
      managedTargetRediscoveryRequired: "目前站點沒有受管目標，請重新執行裝置探索。",
      noCompatibleManagedPlugin: "沒有與目前受管目標相容的已啟用外掛。",
      capabilityAssignmentMissing: "目前目標尚未設定生效的部署能力。"
    },
    platforms: {
      appliance: "裝置",
      linux: "Linux",
      windows: "Windows"
    },
    runners: {
      controlPlane: "平台",
      gateway: "Gateway"
    },
    status: {
      archived: "已歸檔",
      unknownStatus: "未知狀態"
    },
    common: {
      required: "必填",
      optional: "可選"
    }
  },
  certificates: {
    errors: {
      requestFailed: "請求失敗"
    },
    banners: {
      importSucceeded: "證書已匯入，新證書版本 ID：{id}"
    },
    views: {
      eyebrow: "頁面模式",
      switchLabel: "證書頁面視圖切換",
      modes: {
        user: "使用者視圖",
        professional: "專業視圖"
      },
      descriptions: {
        user: "只保留匯入證書、接入應用與設定自動更新這條常見流程。",
        professional: "展示證書版本、鏈狀態與完整技術細節。"
      }
    },
    userView: {
      hero: {
        eyebrow: "常見流程",
        title: "依業務流程處理證書更新",
        description: "先匯入或替換證書，再接入應用，最後設定自動更新計畫。大多數日常操作不需要看底層技術細節。",
        primaryAction: "匯入或替換證書",
        secondaryAction: "切到專業視圖"
      },
      summary: {
        ariaLabel: "證書使用者視圖總覽",
        managedCertificates: "已管理證書",
        expiredCertificates: "已過期證書",
        expiringSoonCertificates: "即將到期證書",
        connectedApplications: "已接入應用",
        activeAutomationPlans: "啟用中的自動計畫"
      },
      steps: {
        title: "常用流程",
        description: "照這個順序處理，大多數證書更新不需要關注技術細節。",
        status: {
          done: "已完成",
          todo: "待處理"
        },
        import: {
          title: "匯入或替換證書",
          description: "把新的證書材料匯入系統，後續的應用接入與更新計畫都會基於這裡的證書繼續。",
          helperCompleted: "目前已管理 {count} 個證書網域，可以繼續替換或補充證書版本。",
          helperEmpty: "先匯入目前證書，後面的應用接入與自動計畫才能繼續。",
          action: "開始匯入"
        },
        applications: {
          title: "新增應用",
          description: "告訴系統這張證書要給哪個應用或站點使用，部署時才知道要更新哪裡。",
          helperCompleted: "目前已有 {count} 個應用接入證書流程。",
          helperEmpty: "還沒有應用接入，匯入證書後建議馬上補上這一步。",
          action: "去新增應用"
        },
        automations: {
          title: "設定自動更新計畫",
          description: "把證書更新安排成自動執行，避免每次到期前都要手動處理。",
          helperCompleted: "目前已有 {count} 個啟用中的自動計畫。",
          helperEmpty: "還沒有啟用中的自動計畫，建議在業務低峰時補上。",
          action: "去設定計畫"
        }
      },
      common: {
        notAvailable: "暫不可用",
        permissionRequired: "目前帳號沒有對應權限，請聯絡管理員。"
      },
      focus: {
        currentSelectionTitle: "目前關注的證書",
        currentSelectionDescription: "切到專業視圖後，可以查看版本、簽發者與完整鏈路細節。",
        currentSelectionEmpty: "還沒有選中證書網域",
        currentSelectionHint: "先從下方待處理清單進入專業視圖，或直接切到專業視圖瀏覽全部證書。",
        validUntil: "到期時間：{value}",
        openProfessional: "打開專業視圖",
        attentionTitle: "優先處理",
        attentionDescription: "先處理已過期或即將到期的證書，再補應用接入與自動計畫。",
        assetAction: "查看專業詳情",
        emptyTitle: "目前沒有緊急證書",
        emptyDescription: "所有已匯入證書暫時都還在有效期內。"
      }
    },
    detail: {
      backList: "返回列表",
      description: "展示憑證版本詳情、格式產物和關聯資產。",
      title: "憑證詳情"
    },
    detailPanel: {
      sources: {
        agentContext: "Agent 上下文",
        platformBinding: "平台繫結記錄"
      },
      usage: {
        columns: {
          domainName: "域名/目標",
          agentName: "Agent 名稱",
          siteName: "站點名稱",
          bindingType: "繫結型別",
          usageSource: "來源",
          status: "狀態"
        },
        empty: "暫無關聯資產",
        toolbar: "關聯資產"
      },
      summary: {
        certificateName: "憑證名稱",
        logicalDomain: "邏輯域名",
        issuer: "簽發者",
        subject: "使用者",
        serialNumber: "序列號",
        chainStatus: "鏈狀態"
      },
      sections: {
        subjectInfo: "主體資訊",
        issuerInfo: "簽發者資訊",
        certificateFields: "憑證欄位",
        extensionFields: "擴充套件欄位"
      },
      fields: {
        commonName: "公用名(CN)",
        organization: "組織(O)",
        organizationalUnit: "組織單位(OU)",
        countryRegion: "國家/地區(C)",
        stateProvince: "省/州(ST)",
        locality: "城市(L)",
        version: "版本",
        signatureAlgorithm: "簽名演算法",
        publicKeyAlgorithm: "公開金鑰演算法",
        fingerprintSha256: "SHA-256 指紋",
        san: "SAN",
        deployable: "可部署",
        leafStorageRef: "葉子憑證引用",
        chainCertificateCount: "鏈憑證數量",
        trustRootCertificate: "目標根憑證",
        trustRootStatus: "根憑證狀態",
        chainDiagnostics: "鏈診斷"
      },
      fallbacks: {
        unknownCertificate: "未知憑證",
        unknownIssuer: "未知簽發者",
        unnamedCertificate: "未命名憑證",
        unknownDomain: "未知域名",
        unknownSubject: "未知使用者",
        unknown: "未知",
        notPartOfCertificate: "不是憑證的一部分",
        none: "暫無",
        emptyValue: "—",
        unknownType: "未知型別",
        unknownResource: "未知資源",
        unknownTarget: "未知目標"
      },
      values: {
        yes: "是",
        no: "否"
      },
      separators: {
        diagnostic: "；",
        list: "，"
      },
      diagnostics: {
        rootResolvedFromLibrary: "匯入材料未包含根憑證：{root}。平台根憑證庫已解析到該根憑證，部署時可補齊。"
      },
      chain: {
        roles: {
          leaf: "葉子憑證",
          root: "根憑證",
          intermediate: "中間憑證"
        },
        title: "憑證鏈",
        empty: "暫無憑證鏈資訊",
        subject: "主體：{value}",
        issuer: "簽發者：{value}"
      },
      errors: {
        loadFailedTitle: "憑證詳情載入失敗",
        code: "錯誤碼：{code}"
      },
      actions: {
        retry: "重試"
      },
      states: {
        loading: "載入中..."
      },
      tabs: {
        ariaLabel: "憑證詳情標籤",
        detail: "詳情",
        usage: "關聯資產"
      },
      validity: {
        title: "憑證有效期",
        notBefore: "生效：{value}",
        notAfter: "到期：{value}"
      }
    },
    formats: {
      columns: {
        certificateVersionId: "版本 ID",
        createdAt: "建立時間",
        format: "格式",
        secretRef: "Secret 引用",
        status: "狀態"
      },
      create: "建立格式設定",
      createFailed: "建立格式失敗",
      description: "憑證 {id} 的 PEM/DER/PFX/JKS/P7B 格式設定入口。",
      empty: "暫無格式設定",
      fields: {
        alias: "Alias（可選）",
        containsPrivateKey: "包含私密金鑰（PEM）",
        passwordSecretRef: "passwordSecretRef（PFX/JKS）",
        targetFormat: "目標格式",
        versionId: "版本 ID"
      },
      hint: "PFX/JKS 必須使用系統已有的 passwordSecretRef；實際部署時會基於憑證版本和格式設定即時產生材料。",
      loadFailed: "格式設定載入失敗",
      optionAvailable: "{label} - 可用",
      placeholders: {
        alias: "例如 gcac-cert"
      },
      title: "憑證格式設定",
      toolbar: "格式設定列表",
      unsupported: "{format} 目前能力宣告不可建立。"
    },
    import: {
      backList: "返回憑證列表",
      description: "目前僅支援 PEM + KEY 和 PFX；PFX 僅支援檔案匯入。匯入材料必須包含伺服器憑證、完整中間憑證鏈和私密金鑰，根憑證不是強制項。",
      errors: {
        importFailed: "匯入失敗",
        materialRequiredBeforeValidate: "必須先完成匯入材料填寫，才能開始驗證。",
        needPassedValidation: "請先完成第 3 步驗證，並確保驗證通過後再匯入。",
        validateFailed: "驗證失敗"
      },
      formats: {
        pem: {
          hint: "必須同時提供伺服器憑證、完整中間憑證鏈和私密金鑰。根憑證不是強制項，缺少時會給出警告。"
        },
        pfx: {
          hint: "僅支援檔案匯入，且容器內必須包含伺服器憑證、完整中間憑證鏈和私密金鑰。根憑證不是強制項，缺少時會給出警告。"
        }
      },
      methods: {
        file: {
          hint: "適合已有 cert / key 或 .pfx 檔案的場景。",
          label: "選擇檔案"
        },
        text: {
          hint: "適合直接貼上 PEM 文本，避免上傳臨時檔案。",
          label: "貼上文本"
        }
      },
      title: "匯入憑證"
    },
    importForm: {
      hints: {
        pemChainCheck: "請上傳或貼上伺服器憑證、完整中間憑證鏈和私密金鑰，系統會驗證憑證鏈與私密金鑰匹配關係。",
        pfxChainCheck: "請上傳 PFX/P12 檔案並填寫密碼，系統會解析容器中的伺服器憑證、憑證鏈和私密金鑰。",
        pfxFileOnly: "PFX 只支援檔案匯入。"
      },
      roles: {
        leaf: "葉子憑證",
        root: "根憑證",
        intermediate: "中間憑證"
      },
      steps: {
        ariaLabel: "憑證匯入步驟",
        formatAndMethod: "格式與方式",
        materials: "匯入材料",
        validateAndImport: "驗證並匯入"
      },
      formatIntro: {
        title: "選擇匯入格式和方式",
        description: "先確認材料格式，再選擇上傳檔案或貼上文本。PFX 目前只支援檔案匯入。"
      },
      labels: {
        importType: "匯入型別",
        importMethod: "匯入方式",
        materialStatus: "材料狀態"
      },
      status: {
        supported: "已支援",
        unsupported: "暫不支援",
        completed: "已完成",
        incomplete: "未完成",
        matched: "匹配",
        unmatched: "不匹配"
      },
      fields: {
        certificateChainFile: "憑證鏈檔案",
        certificatePemText: "憑證 PEM 文本",
        privateKey: "私密金鑰（{kind}）",
        file: "檔案",
        pemText: "PEM 文本",
        pfxFile: "PFX/P12 檔案",
        certificateName: "憑證名稱",
        pfxPassword: "PFX 密碼"
      },
      placeholders: {
        certificatePem: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
        certificateName: "例如 example.com 生產憑證",
        required: "必填"
      },
      validation: {
        title: "驗證匯入材料",
        description: "提交匯入前先驗證憑證鏈、有效期、私密金鑰匹配和材料完整性。",
        passed: "驗證通過，可以匯入",
        failed: "驗證未通過"
      },
      report: {
        certificateSummary: "憑證摘要",
        serialNumber: "序列號",
        validity: "有效期",
        validityRange: "{start} 至 {end}",
        issuer: "簽發者",
        issuerWithValue: "簽發者：{value}",
        subject: "使用者",
        chainValidation: "憑證鏈驗證",
        chainStatus: "鏈狀態",
        certificateCount: "憑證數量",
        privateKeyMatch: "私密金鑰匹配",
        provided: "已提供",
        matchResult: "匹配結果",
        privateKeySource: "私密金鑰來源",
        blockers: "阻斷項",
        warnings: "警告"
      },
      selectedFile: "已選擇：{name}",
      importSuccess: "匯入成功，憑證版本 ID：{id}",
      actions: {
        validating: "驗證中...",
        validate: "開始驗證",
        cancel: "取消",
        previous: "上一步",
        next: "下一步",
        importing: "匯入中...",
        import: "匯入憑證"
      }
    },
    list: {
      filters: {
        keyword: "關鍵字",
        domain: "域名",
        status: "狀態"
      },
      placeholders: {
        assetKeyword: "域名 / SAN / 指紋",
        primaryDomain: "example.com",
        versionKeyword: "名稱 / 簽發者 / 使用者 / 版本 ID"
      },
      columns: {
        notBefore: "開始日期",
        notAfter: "結束日期",
        associatedAsset: "關聯資產",
        sourceType: "新增方式",
        status: "狀態",
        certificateVersionId: "憑證版本 ID"
      },
      sourceTypes: {
        manual: "手動匯入",
        acme: "ACME",
        unknown: "未知"
      },
      lifecycle: {
        unknown: "未知",
        expired: "過期",
        expiringSoon: "即將過期",
        valid: "有效"
      },
      fallbacks: {
        unselectedDomain: "未選擇域名",
        unnamedDomain: "未命名域名",
        noSupplement: "暫無補充資訊"
      },
      assets: {
        title: "域名列表",
        loadFailed: "域名列表載入失敗",
        empty: "暫無域名列表",
        unselectedTitle: "未選擇域名",
        unselectedDescription: "請先在左側選擇一個邏輯憑證域名。"
      },
      versions: {
        title: "SSL 憑證列表",
        titleWithDomain: "{domain} 的 SSL 憑證列表",
        description: "右側顯示目前域名下的 SSL 憑證列表，包含憑證名稱、開始日期、結束日期、簽發者和使用者資訊。",
        loadFailed: "SSL 憑證列表載入失敗",
        emptyForDomain: "該域名下暫無 SSL 憑證",
        emptyForDomainDescription: "可以通過篩選欄右側的匯入憑證按鈕補充該域名的憑證版本。",
        empty: "暫無 SSL 憑證",
        toolbar: "憑證版本列表",
        currentCount: "目前 {count} 筆"
      },
      actions: {
        toggleFilters: "篩選",
        clear: "清空",
        deleteRisk: "刪除會直接移除目前憑證版本；如果該版本仍被繫結或部署引用，系統會拒絕此操作。"
      },
      errors: {
        deleteFailed: "刪除失敗",
        materialRequiredForFormat: "必須提供目前格式對應的憑證材料。",
        importFailedWithCheck: "匯入失敗，請檢查輸入材料。",
        validateFailedWithCheck: "驗證失敗，請檢查輸入材料。"
      },
      import: {
        description: "目前僅支援 PEM + KEY 和 PFX；每次匯入都必須包含伺服器憑證、完整中間憑證鏈和私密金鑰。根憑證不是強制項，缺少時會顯示警告。私密金鑰僅儲存到系統 Secret 儲存，不會在 API 回應中返回。"
      }
    },
    trustRoots: {
      title: "根憑證管理",
      description: "在目前頁面內查看根憑證庫、來源觀察記錄與葉子憑證關聯，不跳轉到獨立頁面。",
      actions: {
        open: "根憑證管理",
        refresh: "重新整理",
        expandVersions: "展開關聯版本",
        collapseVersions: "收起關聯版本"
      },
      toolbar: {
        title: "根憑證庫",
        description: "目前已識別 {count} 個目標根視圖。"
      },
      summary: {
        managedVersions: "目標根視圖",
        resolvedVersions: "已取得根憑證",
        missingVersions: "尚未取得根憑證",
        invalidChainVersions: "憑證鏈無效",
        targetRoot: "目標根指紋：{fingerprint}",
        rootFingerprintUnavailable: "目前還無法確定目標根指紋",
        relatedAssetCount: "關聯資產 {count} 個"
      },
      detail: {
        subtitle: "展示根憑證基本資訊、來源觀察與葉子版本關聯。"
      },
      fields: {
        fingerprintSha256: "SHA-256 指紋",
        serialNumber: "序號",
        subject: "主體",
        issuer: "簽發者",
        notBefore: "生效時間",
        notAfter: "到期時間",
        relatedAssets: "關聯憑證資產",
        relatedVersions: "關聯憑證版本"
      },
      sections: {
        observations: "來源觀察",
        relatedAssets: "關聯憑證資產",
        versionRelations: "葉子憑證關聯",
        managedCertificates: "已納管憑證根狀態"
      },
      states: {
        loadFailed: "根憑證列表載入失敗",
        detailFailed: "根憑證詳情載入失敗",
        assetLoadFailed: "關聯憑證資產載入失敗",
        emptyTitle: "暫無根憑證記錄",
        emptyDescription: "目前專案內尚未收錄根憑證，後續可再透過後端 API 匯入。",
        unselectedTitle: "尚未選擇根憑證",
        unselectedDescription: "請先在左側選擇一筆根憑證記錄。",
        rootNotInLibrary: "目前根憑證尚未入庫，以下關聯資產與狀態來自已納管憑證根鏈的推斷結果。",
        emptyObservations: "暫無來源觀察記錄",
        emptyRelations: "暫無葉子憑證關聯",
        emptyAssets: "目前根憑證尚未關聯任何憑證資產"
      },
      validationStatus: {
        pending: "待驗證",
        verified: "已驗證",
        rejected: "已拒絕",
        expired: "已過期"
      },
      sourceTypes: {
        control_plane_node: "控制面 Node Root Store",
        openssl: "控制面 OpenSSL 根庫",
        windows: "控制面 Windows Root Store",
        internet: "受控網際網路來源",
        manual: "手動匯入",
        managed_host_inspect: "受管宿主定向檢查"
      },
      observationStatus: {
        candidate: "候選",
        accepted: "已接受",
        rejected: "已拒絕",
        failed: "失敗"
      },
      relations: {
        selected_root: "已選根憑證",
        candidate: "候選根憑證"
      },
      resolutionStatus: {
        resolved: "已解析",
        ambiguous: "存在歧義",
        missing: "缺失",
        invalid: "無效"
      },
      rootStatus: {
        resolved: "已取得根憑證",
        missing: "尚未取得根憑證",
        invalid_chain: "憑證鏈無效"
      }
    },
    usages: {
      backDetail: "返回詳情",
      columns: {
        domainName: "域名/目標",
        resourceId: "資源 ID",
        resourceType: "資源型別",
        status: "狀態",
        updatedAt: "更新時間"
      },
      description: "憑證 {id} 的繫結、部署目標和資源引用。",
      empty: "暫無使用關係",
      loadFailed: "使用關係載入失敗",
      title: "憑證使用關係",
      toolbar: "使用關係"
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: "使用者名稱 + 密碼",
        usernamePasswordWithUsername: "使用者名稱 + 密碼 / {username}",
        sshKey: "SSH 私密金鑰",
        sshKeyWithUsername: "SSH 私密金鑰 / {username}",
        apiKey: "API Key / {name} / {location}",
        bearerToken: "Bearer Token"
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: "呼叫結構化 HTTP 介面，取代分散的 curl 命令。"
        },
        ssh: {
          displayName: "SSH 命令",
          description: "宣告要執行的 SSH 命令，只儲存連線和認證資訊引用。"
        },
        sftp: {
          displayName: "SFTP 上傳/下載",
          description: "通過正式 SFTP step 上傳或下載檔案，適合憑證與設定安裝。"
        },
        scp: {
          displayName: "SCP 上傳/下載",
          description: "通過 SCP 複製檔案，適合簡單主機檔案分發。"
        },
        verify: {
          displayName: "驗證",
          description: "對 HTTP 狀態、文本、正則或憑證指紋做斷言。"
        },
        condition: {
          displayName: "分支判斷",
          description: "根據變數存在性或值決定後續路徑。"
        },
        transform: {
          displayName: "資料轉換",
          description: "使用 JSONata 將上游輸出轉換為新的工作流程上下文變數。"
        },
        foreach: {
          displayName: "集合走訪",
          description: "依序走訪動態集合，並對每個元素執行同一組子步驟。"
        },
        checkpoint: {
          displayName: "復原檢查點",
          description: "在裝置寫入操作前儲存可驗證的遠端狀態摘要。"
        },
        wait: {
          displayName: "等待",
          description: "等待固定秒數後繼續執行。"
        },
        manual: {
          displayName: "人工確認",
          description: "暫停工作流，等待人工確認後繼續。"
        }
      },
      fields: {
        command: "命令",
        connectionRef: "連線變數",
        contentRef: "內容變數",
        credential: "認證資訊",
        description: "說明",
        direction: "方向",
        expected: "期望值",
        expectedHostKeyFingerprint: "Host Key 指紋",
        hostKeyPolicy: "Host Key 策略",
        hostRef: "主機變數",
        inputRef: "輸入變數",
        instruction: "確認說明",
        localPath: "本機路徑",
        mode: "檔案權限",
        operator: "運算子",
        remotePath: "遠端路徑",
        seconds: "等待秒數",
        temporaryPath: "臨時路徑",
        timeoutMs: "逾時毫秒",
        timeoutSeconds: "逾時秒數",
        transformInput: "轉換輸入",
        itemsPath: "集合路徑",
        itemVariable: "元素變數",
        indexVariable: "索引變數",
        maxItems: "最大項目數",
        foreachSteps: "子步驟 JSON",
        checkpointName: "檢查點名稱",
        checkpointCapture: "擷取路徑 JSON",
        requiredForRollback: "回復必需",
        outputFormat: "輸出格式",
        usernameVariable: "使用者名稱變數",
        variable: "變數",
        verifyType: "驗證型別"
      },
      options: {
        boolean: { yes: "是", no: "否" },
        direction: {
          download: "下載",
          upload: "上傳"
        },
        hostKeyPolicy: {
          manualApproval: "人工審核",
          strict: "嚴格驗證",
          trustOnFirstUse: "首次信任"
        },
        operator: {
          equals: "等於",
          exists: "存在",
          notEquals: "不等於",
          notExists: "不存在"
        },
        transformFormat: {
          raw: "原始值",
          jsonString: "JSON 字串"
        },
        verifyType: {
          certificateFingerprint: "憑證指紋",
          httpStatus: "HTTP 狀態",
          regex: "正則匹配",
          textContains: "文本包含"
        }
      },
      stages: {
        backup: {
          title: "備份",
          description: "保留可復原材料。"
        },
        install: {
          title: "安裝",
          description: "部署憑證或設定。"
        },
        prepare: {
          title: "準備",
          description: "準備連線、變數和材料。"
        },
        refresh: {
          title: "重新整理",
          description: "過載服務或重新整理目標。"
        },
        verify: {
          title: "驗證",
          description: "確認結果符合預期。"
        }
      },
      defaults: {
        displayName: "{name} 工作流",
        nodes: {
          backupExistingCertificate: "備份現有憑證",
          reloadService: "過載服務"
        },
        variables: {
          certificatePaths: {
            description: "目標憑證路徑設定"
          },
          credential: {
            description: "連線認證資訊"
          },
          deviceHost: {
            description: "目標主機"
          },
          serverCert: {
            description: "待部署伺服器憑證材料",
            outputs: {
              certFile: {
                description: "伺服器憑證檔案"
              },
              keyFile: {
                description: "私密金鑰檔案"
              }
            }
          },
          sshUsername: {
            description: "SSH 登入使用者名稱"
          },
          verifyUrl: {
            description: "部署後驗證位址"
          }
        },
        config: {
          conditionDescription: "檢查目標主機變數是否存在",
          manualInstruction: "請確認目標裝置憑證已切換到新版本。"
        }
      },
      variableFlow: {
        system: "系統",
        variable: "變數"
      },
      errors: {
        unknownNodeType: "未知節點型別：{type}"
      }
    },
    canvasEditor: {
      summary: "節點 {nodes} 個，連線 {edges} 筆，變數 {variables} 個",
      stageNodeCount: "{count} 個節點",
      copyLabel: "{label} 副本",
      actions: {
        addVariable: "新增變數",
        collapseBottomPanelAria: "摺疊底部控制面板",
        collapseDown: "向下摺疊",
        copy: "複製",
        copyNode: "複製節點",
        delete: "刪除",
        deleteNode: "刪除節點",
        expandBottomPanelAria: "展開底部控制面板",
        expandPanel: "展開面板",
        layout: "整理佈局",
        mockCurrentNode: "僅模擬目前節點",
        mockRunning: "模擬中...",
        paste: "貼上",
        pasteNode: "貼上節點",
        realRun: "真實試跑目前節點",
        realRunHttp: "真實 HTTP 試跑目前節點",
        realRunRunning: "試跑中...",
        realRunSsh: "真實 SSH 執行目前節點",
        realRunTransfer: "真實檔案傳輸試跑",
        redo: "重做",
        saveDraft: "儲存草稿",
        saving: "儲存中...",
        undo: "撤銷",
        zoomIn: "放大",
        zoomOut: "縮小"
      },
      aria: {
        bottomPanel: "底部面板",
        canvasArea: "畫布區域",
        dslPanel: "DSL 面板",
        nodePalette: "節點庫",
        propertiesPanel: "屬性面板",
        runtimePanel: "執行態面板",
        toolbar: "工作流畫布工具欄",
        validationPanel: "驗證面板",
        variablesPanel: "變數面板"
      },
      credentialHints: {
        savedApiKey: "已儲存的 API Key",
        savedBearerToken: "已儲存的 Bearer Token",
        savedSshSftp: "已儲存的 SSH / SFTP 認證資訊",
        savedUsernamePassword: "已儲存的使用者名稱 + 密碼"
      },
      credentials: {
        emptyCreateHint: "暫無可用認證資訊。請先在列表頁的憑據管理中建立。",
        loading: "正在載入認證資訊列表…"
      },
      dsl: {
        title: "DSL 匯入與覆蓋",
        hint: "可直接貼上外部 DSL JSON，或選擇本機 DSL 檔案。匯入只覆蓋瀏覽器中的目前畫布，點擊“儲存草稿”後才會產生新的工作流版本。",
        selectFile: "選擇 DSL 檔案",
        actions: {
          importOverwrite: "匯入 DSL 覆蓋畫布",
          resetToCanvas: "回填目前畫布 DSL"
        },
        messages: {
          fileLoaded: "已載入檔案：{fileName}",
          imported: "DSL 已匯入並覆蓋目前畫布，共 {count} 個節點。",
          resetToCompiled: "已回填編譯後的 DSL。"
        },
        errors: {
          importFailed: "DSL 匯入失敗",
          invalidTopLevel: "DSL 頂層結構無效，必須是物件。"
        }
      },
      empty: {
        selectNodeToEdit: "請選擇節點後編輯屬性。"
      },
      errors: {
        backendValidationFailed: "驗證失敗",
        credentialsLoadFailed: "載入工作流憑據失敗",
        missingStepName: "缺少步驟名稱",
        missingWorkflowDsl: "未能取得工作流 DSL"
      },
      fields: {
        authType: "認證型別",
        clientCertificate: "客戶端憑證",
        clientPrivateKey: "客戶端私密金鑰",
        command: "命令",
        connectionVariable: "連線變數",
        contentRef: "內容引用",
        cookieName: "Cookie 名稱",
        credential: "認證資訊",
        credentialSelector: "認證資訊選擇器",
        defaultValue: "預設值",
        deliveryLocation: "傳遞位置",
        description: "說明",
        direction: "方向",
        fileMode: "檔案權限",
        headerName: "Header 名稱",
        hostRefOrHostname: "主機變數 / 主機名",
        hostVariable: "主機變數",
        keyName: "Key 名稱",
        localPath: "本機路徑",
        newNodeStage: "新增節點階段",
        nodeName: "節點名稱",
        remotePath: "遠端路徑",
        required: "必填",
        secretValue: "密文值",
        sensitive: "敏感",
        stage: "所屬階段",
        temporaryPath: "臨時路徑",
        timeoutSeconds: "逾時秒數",
        type: "型別",
        username: "使用者名稱",
        variableName: "變數名"
      },
      options: {
        download: "下載",
        manualInput: "手動填寫",
        notSelected: "未選擇",
        upload: "上傳"
      },
      runtime: {
        noCredentialVariables: "目前工作流沒有認證資訊變數。",
        noExtraVariables: "目前節點沒有額外執行時變數。"
      },
      sections: {
        httpAuth: "HTTP 認證",
        nodePalette: "節點庫",
        properties: "屬性面板",
        referenceFlow: "引用流",
        runtimeCredentialVariables: "執行時認證資訊變數",
        runtimeVariables: "執行時變數",
        singleNodeTest: "單節點測試執行",
        variableConfig: "變數設定"
      },
      tabs: {
        runtime: "執行態",
        validation: "驗證",
        variables: "變數"
      },
      test: {
        cause: "原因",
        code: "程式碼",
        emptyHint: "選擇節點後可執行模擬或真實試跑。",
        error: "錯誤",
        executionPlan: "執行計畫",
        exitCode: "退出碼",
        failureDetails: "失敗詳情",
        hint: "測試提示",
        logs: "記錄",
        nodeOutput: "節點輸出",
        running: "執行中",
        stage: "階段",
        stderr: "標準錯誤",
        stdout: "標準輸出",
        suggestion: "建議",
        target: "目標",
        errors: {
          mockRunFailed: "模擬執行失敗",
          realRunFailed: "真實試跑失敗"
        },
        messages: {
          mockCompleted: "模擬執行完成。",
          mockFailed: "模擬執行失敗。",
          realCompleted: "真實試跑完成。",
          realFailed: "真實試跑失敗。"
        }
      },
      validation: {
        levels: {
          error: "錯誤",
          risk: "風險",
          warning: "警告"
        },
        location: {
          canvas: "畫布",
          edge: "連線",
          fieldSuffix: "欄位",
          node: "節點"
        },
        noBlockingErrors: "沒有阻斷錯誤。"
      },
      variables: {
        customRuntimeDescription: "自定義執行變數",
        notUsed: "未使用",
        usedBy: "使用位置：{nodes}"
      }
    },
    templates: {
      title: "工作流",
      resourceName: "工作流",
      description: "按畫布草稿管理 CURL/SSH/SFTP 工作流版本、釋出狀態與變更記錄。",
      pluginSources: {
        createTitle: "從外掛新建工作流", applyTitle: "從外掛產生草稿", description: "只列出已啟用外掛中的憑證工作流。先選擇工作流，再選擇外掛版本。複製後工作流歸目前使用者所有並可繼續編輯。",
        createAction: "建立工作流", applyAction: "產生草稿", currentTarget: "目前工作流：{name}", namePlaceholder: "輸入新工作流名稱", loading: "正在載入外掛工作流來源...", empty: "沒有可用的外掛工作流來源。", version: "外掛版本", workflowVersion: "工作流程版本", versionSource: "版本來源：{plugin} / {version} / {capability}",
        capabilities: { deploy: "憑證部署", rollback: "憑證回滾" }, errors: { loadFailed: "載入外掛工作流來源失敗", nameRequired: "請輸入工作流名稱", missingApplyTarget: "缺少要產生草稿的工作流", actionFailed: "外掛工作流複製失敗" }
      },
      origins: { user: "自訂", plugin_internal: "外掛內建" },
      actions: {
        addVersion: "新增版本",
        applyTemplate: "套用模板",
        cancel: "取消",
        close: "關閉",
        createBlank: "空白新增",
        credentialManagement: "憑據管理",
        delete: "刪除",
        detail: "詳情",
        edit: "編輯",
        publishVersion: "釋出版本",
        rename: "修改名稱",
        saveName: "儲存名稱",
        saveNote: "儲存備註",
        switchVersion: "切換版本",
        templateManagement: "模板管理",
        versionManagement: "版本管理"
      },
      states: {
        creating: "建立中...",
        loading: "載入中...",
        processing: "處理中...",
        saving: "儲存中..."
      },
      fields: {
        actions: "操作",
        createdAt: "建立時間",
        currentStatus: "目前狀態",
        currentVersion: "目前版本",
        currentVersionId: "目前版本 ID",
        id: "工作流 ID",
        name: "工作流名稱",
        origin: "來源",
        note: "備註",
        status: "狀態",
        updatedAt: "更新時間"
      },
      filters: {
        showNonDeployment: "顯示非部署工作流"
      },
      empty: {
        description: "先建立畫布草稿，再基於版本釋出到正式鏈路。",
        noChangeSummary: "沒有變更說明。",
        noChangeSummaryShort: "沒有變更說明",
        noVersions: "暫無版本。",
        title: "暫無工作流"
      },
      tabs: {
        summary: "概覽",
        versions: "版本"
      },
      versionStatuses: {
        disabled: "已停用",
        draft: "草稿",
        published: "已釋出"
      },
      detail: {
        description: "檢視工作流詳情、畫布草稿與版本清單。",
        publishedVersion: "目前釋出版本 {version}",
        title: "工作流詳情",
        titleWithName: "工作流 {name}"
      },
      rename: {
        title: "工作流名稱",
        description: "修改清單與詳情中顯示的工作流名稱，不會改寫歷史版本。",
        placeholder: "請輸入工作流名稱",
        messages: { success: "工作流名稱已更新。" },
        errors: { required: "工作流名稱不能為空。", failed: "工作流名稱修改失敗。" }
      },
      versionManager: {
        description: "管理工作流版本的新增與釋出，不涉及畫布內容的修改。",
        titleWithName: "版本管理：{name}"
      },
      changeSummaries: {
        createFromPlugin: "從外掛能力建立工作流",
        applyFromPlugin: "從外掛能力產生新草稿",
        applyFromFileTemplate: "從檔案模板覆蓋工作流草稿",
        createCanvasDraft: "前端畫布建立工作流草稿",
        createFromFileTemplate: "從檔案模板建立工作流草稿",
        createVersionDraft: "版本管理建立新版本草稿",
        saveCanvasDraft: "畫布編輯器儲存草稿版本"
      },
      messages: {
        canvasDraftUpdated: "目前草稿版本已更新。",
        switchedVersion: "已切換到 {version}。",
        versionDraftCreated: "新版本草稿已建立。",
        versionNoteUpdated: "版本備註已更新。"
      },
      errors: {
        createVersionFailed: "建立工作流版本失敗",
        loadVersionsFailed: "載入工作流版本失敗",
        missingWorkflowDsl: "未能取得工作流 DSL",
        publishVersionFailed: "釋出工作流版本失敗",
        saveCanvasDraftFailed: "儲存畫布草稿失敗",
        updateVersionNoteFailed: "更新版本備註失敗"
      },
      delete: {
        riskText: "刪除會停用該工作流及其全部版本，列表中不再展示；歷史執行記錄不會被改寫。"
      },
      loading: {
        versions: "正在載入版本..."
      },
      fileTemplates: {
        applyAction: "按模板覆蓋目前工作流",
        applyTitle: "用檔案模板覆蓋工作流",
        createAction: "按模板建立工作流",
        createTitle: "從檔案模板新增工作流",
        currentTarget: "目前目標：{name}",
        description: "模板檔案來自內建模板庫或使用者匯入目錄。覆蓋現有工作流時，會建立新的草稿版本，不會改寫歷史版本。",
        empty: "暫無可識別的工作流模板檔案。",
        identifier: "標識 {name}",
        invalid: "無效",
        invalidFile: "檔案無效",
        loading: "正在掃描檔案模板...",
        valid: "可用",
        sources: {
          builtin: "內建",
          userImported: "使用者匯入"
        },
        errors: {
          actionFailed: "執行檔案模板動作失敗",
          loadFailed: "載入工作流檔案模板失敗",
          missingApplyTarget: "缺少待覆蓋的工作流目標"
        }
      },
      credentials: {
        actions: {
          create: "建立認證資訊"
        },
        addTitle: "新增認證資訊",
        count: "{count} 個",
        description: "集中管理工作流所需的登入憑據與 API 認證資訊，支援在畫布和節點中直接選擇複用。",
        empty: "暫無認證資訊記錄。建立後可直接在變數、SSH 節點和 HTTP 節點裡選擇。",
        loading: "正在載入認證資訊資訊…",
        registeredTitle: "已登記認證資訊",
        title: "憑據管理",
        fields: {
          deliveryLocation: "傳遞位置",
          headerOrParam: "Header / 引數名",
          name: "憑據名稱",
          referenceLocation: "引用位置",
          storageType: "儲存型別",
          type: "認證資訊型別",
          username: "使用者名稱"
        },
        kinds: {
          common: {
            family: "通用"
          },
          sshKey: {
            title: "SSH 私密金鑰"
          },
          usernamePassword: {
            title: "使用者名稱 + 密碼"
          }
        },
        secretLabels: {
          password: "密碼",
          sshKey: "SSH 私密金鑰"
        },
        placeholders: {
          apiKey: "輸入 API Key",
          bearer: "輸入 Bearer Token",
          password: "輸入登入密碼",
          sshKey: "貼上 PEM 格式私密金鑰"
        },
        messages: {
          created: "認證資訊已建立，可直接在工作流變數、SSH 節點和 HTTP 節點中選擇。"
        },
        errors: {
          createFailed: "建立認證資訊失敗",
          loadFailed: "載入認證資訊失敗",
          missingCreatedId: "建立認證資訊未返回有效編號"
        }
      }
    }
  },
  monitoring: {
    tls: monitoringTlsZhTW,
    actions: {
      add: "新增監控",
      probe: "檢測站點",
      probing: "檢測中...",
      refresh: "重新整理資料",
      refreshing: "重新整理中...",
      remove: "移除"
    },
    errors: {
      addFailed: "監控目標新增失敗",
      deleteFailed: "監控目標刪除失敗",
      invalidTarget: "監控目標資料無效",
      loadFailed: "監控資料載入失敗",
      probeFailed: "探測請求失敗",
      updateIntervalFailed: "探測頻率更新失敗"
    },
    empty: {
      actualCertificate: "暫無實測 TLS 憑證。HTTPS 目標會在站點檢測時自動採集憑證資訊。",
      description: "點擊右上角新增監控，系統會按目標頻率檢測站點並同步採集憑證資訊。",
      noAddableAssets: "暫無可新增應用資產，已有目標請在詳情中調整探測頻率。",
      observedCertificateHistory: "暫無繫結憑證版本。站點檢測採集到第一張憑證後會自動保留。",
      probeHistory: "暫無探測歷史。",
      riskEvents: "暫無相關事件。",
      title: "暫無監控目標"
    },
    sections: {
      actualCertificate: "目前站點實測憑證",
      actualCertificateHint: "隨站點檢測自動採集",
      observedCertificateHistory: "繫結憑證版本",
      observedCertificateHistoryHint: "按實測 TLS 憑證變化保留版本記錄",
      probeHistory: "探測歷史",
      probeHistoryHint: "系統探測結果最近 20 次記錄",
      riskEvents: "風險事件",
      riskEventsHint: "憑證鏈、域名、指紋和執行狀態",
      targets: "監控目標"
    },
    labels: {
      applicationAsset: "應用資產",
      currentTarget: "目前目標",
      probeInterval: "探測頻率"
    },
    metrics: {
      availability: "可存取性",
      certificateStatus: "憑證狀態",
      latency: "存取延時",
      observedCertificateChanges: "實測憑證變更"
    },
    probe: {
      completed: "探測完成",
      emptyHistoryBlock: "第 {index} 次：暫無探測",
      latencyNotCollected: "未採集延時",
      recentAria: "最近 10 次探測結果",
      waiting: "等待站點檢測"
    },
    status: {
      error: "錯誤",
      none: "待執行",
      ready: "正常",
      warning: "警告"
    },
    warnings: {
      certificateNotApplied: "系統探測到站點仍未套用網域憑證的最新版本",
      chainVerificationFailed: "系統探測到憑證鏈驗證失敗"
    },
    fallback: {
      noEndpoint: "未設定存取位址",
      noFingerprint: "無指紋",
      notClosed: "未關閉",
      noSummary: "無摘要",
      notCollected: "未採集",
      notSelected: "未選擇",
      unknownAsset: "未知資產",
      unknownCertificate: "未知憑證",
      unknownIssuer: "未知簽發者",
      unnamedEvent: "未命名事件"
    },
    certificate: {
      actualCertificate: "實測憑證",
      chainUntrusted: "未通過系統信任鏈驗證",
      chainVerification: "鏈驗證",
      chainVerified: "鏈驗證通過",
      chainVerifyFailedWithReason: "鏈驗證失敗：{reason}",
      collectedAt: "採集時間",
      issuer: "簽發者",
      serialNumber: "序列號",
      sha256Fingerprint: "SHA-256 指紋",
      subject: "主體",
      validity: "有效期",
      validityRange: "{start} 至 {end}"
    },
    columns: {
      certificateName: "憑證名稱",
      changedAt: "更換時間",
      closedAt: "警告關閉時間",
      currentStatus: "目前狀態",
      expiresAt: "到期時間",
      issuerName: "簽發者名稱",
      latency: "延時",
      occurredAt: "發生時間",
      result: "結果",
      source: "來源",
      status: "狀態",
      time: "時間",
      warningContent: "警告內容"
    },
    dialog: {
      defaultMetricsHint: "預設監控可存取性、存取延時、憑證資訊和憑證歷史。",
      description: "從應用資產列表選擇一個目標，系統會固定採集可存取性、存取延時、憑證資訊和憑證歷史。",
      loadingAssets: "載入資產中...",
      selectAsset: "請選擇應用資產",
      title: "新增監控"
    },
    source: {
      controlPlane: "平台"
    },
    targets: {
      assetCount: "{count} 個資產"
    }
  },
  login: {
    visualLabel: "產品說明",
    brand: "GCAC 憑證控制台",
    brandSecondary: "憑證集中管理平台",
    headlinePrefix: "讓憑證管理",
    headlineHighlight: "更智慧",
    headlineSuffix: "、更安全",
    intro: "一站式管理憑證資產，自動化部署編排，全鏈路審計追蹤，將憑證維運從繁瑣的人工操作轉變為可驗證、可回溯的標準化流程，為企業數位基礎設施保駕護航。",
    capabilitiesLabel: "平台能力",
    featureLifecycle: "全生命週期管理",
    featureLifecycleDesc: "從匯入、續簽、版本追蹤到到期預警，覆蓋憑證資產的每一個環節。",
    featureAutomation: "自動化部署編排",
    featureAutomationDesc: "面向 Nginx、Tomcat、IIS 等主流環境，一鍵產生可審計的部署計畫。",
    featureRollback: "安全執行與復原",
    featureRollbackDesc: "部署前自動驗證，執行全程留痕，失敗即復原，確保生產環境穩定無憂。",
    formLabel: "登入表單",
    secure: "安全連線",
    welcome: "登入控制台",
    hint: "使用企業帳號進入 GCAC 管理工作台",
    username: "使用者名稱",
    usernamePlaceholder: "請輸入使用者名稱",
    password: "密碼",
    passwordPlaceholder: "請輸入密碼",
    failed: "登入失敗，請稍後重試",
    submitting: "正在驗證身分…",
    submit: "登入",
    policy: "RBAC 權限保護",
    audit: "操作全程審計"
  },
  compatibility: {
    title: '相容性目錄', description: '支援範圍、限制與證據均來自 Compatibility Profile。', generatedAt: '目錄產生時間：{time}', loading: '正在載入相容性目錄…', loadFailed: '相容性目錄載入失敗', none: '無',
    columns: { profile: 'Profile', version: '版本', status: '支援狀態', automation: '自動化', evidence: '證據', verifiedAt: '最近驗證', limitations: '限制' },
    status: { certified: '已認證', supported: '支援', compatible: '相容', experimental: '實驗性', legacy: '舊版支援', unsupported: '不支援' },
    evidence: { current: '有效', expired: '已過期', failed: '失敗' }
  },
  internalCa: {
    title: '內部 CA', description: '統一管理內部憑證機構、應用憑證生命週期、CA Node 與憑證重用風險。',
    tabs: { trustDomains: 'CA 信任域', authorities: '憑證機構', profiles: '憑證 Profile', requests: '憑證申請', operations: '生命週期維運', risks: '重用風險' },
    trustDomains: { recordsTitle: '信任域記錄', columns: { name: '名稱', purpose: '用途', isolationLevel: '隔離等級', status: '狀態', default: '預設狀態', createdAt: '建立時間' }, empty: '尚無 CA 信任域記錄。', modalTitle: '新增 CA 信任域', modalDescription: '填寫信任域基本資訊，唯一代碼由系統自動產生。', generatedCodeHint: '唯一代碼由系統自動產生，不需要手動填寫。', notDefault: '非預設' },
    requests: { recordsTitle: '證書申請記錄', columns: { commonName: 'Common Name', applicationAssetId: '應用資產 ID', updatedAt: '更新時間', actions: '操作' }, empty: '尚無證書申請記錄。', modalTitle: '新增證書申請', modalDescription: '填寫證書申請資訊，提交後將進入審批與簽發流程。' },
    profiles: { recordsTitle: '證書 Profile 記錄', columns: { securityDomain: '安全域', versionCount: '版本數' }, empty: '尚無證書 Profile 記錄。', modalTitle: '新增證書 Profile', modalDescription: '定義證書簽發規則與約束，包括有效期、DNS 後綴和審批要求。' },
    topology: { rootOnly: '僅根 CA', rootOnlyDescription: '根 CA 直接承擔日常簽發，部署簡單但根金鑰需長期上線。', rootOnlyRisk: '高風險：根金鑰失陷會影響整個信任域。', intermediate: '根 CA + 中繼 CA', intermediateDescription: '根 CA 離線保管，由中繼 CA 承擔日常簽發。', recommended: '建議：隔離根金鑰並縮小簽發故障域。' },
    sections: { trustDomain: '建立 CA 信任域', provider: 'CA Provider', providerSettings: 'CA Provider 設定', issuingBackends: '簽發後端與連線狀態', authorityWizard: 'CA 建立精靈', authorityOverview: '憑證機構架構', authorityOverviewDescription: '每張卡片代表一個根信任錨點，選取卡片可查看其下級簽發架構。', caArchitecture: 'CA 層級架構', riskSummary: '安全決策摘要', profile: '建立憑證 Profile', request: '建立應用憑證申請', revocation: '建立撤銷工作', trust: '建立信任散發工作', remediation: '改善預覽' },
    fields: { name: '名稱', code: '唯一代碼', purpose: '用途', isolationLevel: '隔離等級', defaultTrustDomain: '設為預設信任域', trustDomain: 'CA 信任域', parentAuthority: '父根 CA', authorityType: '憑證機構類型', providerType: '外部 CA 類型', deploymentMode: '部署模式', platform: '執行平台', provider: 'CA Provider', backendName: '簽發後端名稱', availabilityMode: '可用性模式', endpoint: '服務位址', authMode: '身分驗證方式', profile: '簽發 Profile', template: '憑證範本', crlUrl: 'CRL 位址', ocspUrl: 'OCSP 位址', issuingBackend: '簽發後端', entryMode: '建立方式', commonName: 'Common Name', securityDomain: '安全域', topology: 'CA 拓撲', dnsSuffixes: '允許的 DNS 後綴', validityDays: '最大有效期（天）', renewalDays: '提前續期（天）', requireApproval: '簽發前需要審批', applicationAssetId: '應用資產 ID', authority: '憑證機構', profileVersionId: 'Profile 版本 ID', sans: 'SAN 清單', custodyMode: '金鑰託管模式', certificateVersionId: '憑證版本 ID', reason: '撤銷原因', targetIds: '目標 ID 清單' },
    actions: { refresh: '重新整理', addTrustDomain: '新增信任域', addAuthority: '新增 CA', addIntermediate: '新增中繼 CA', previous: '上一步', next: '下一步', createTrustDomain: '建立信任域', createProvider: '建立 Provider', previewRisk: '預覽風險', createAuthority: '建立 CA', createProfile: '建立 Profile', createRequest: '提交申請', approve: '審批通過', retry: '重試', queryResult: '查詢結果', scanRenewals: '掃描到期續期', createRevocation: '建立撤銷工作', createTrust: '建立信任散發', previewRemediation: '預覽改善' },
    placeholders: { dnsSuffixes: 'example.com, office.example.com', sans: 'oa.example.com, 10.0.0.10' },
    messages: { loadFailed: '內部 CA 資料載入失敗。', actionFailed: '操作失敗，請檢查輸入、權限和審批狀態。', noIntermediate: '此根 CA 尚未設定中繼憑證機構。', noRootAuthority: '尚未設定根 CA', noRootAuthorityDescription: '新增根 CA 以建立第一套獨立信任架構。', trustDomainCreated: 'CA 信任域已建立。', providerCreated: 'CA Provider 已建立。', providerDeleted: '未綁定的 AD CS Provider 已刪除。', authorityCreated: '憑證機構已建立。', profileCreated: '憑證 Profile 已建立。', requestCreated: '憑證申請已提交。', requestApproved: '憑證申請已審批。', requestRetried: '憑證簽發已重試。', requestQueried: '遠端簽發結果已重新整理。', renewalScanned: '續期掃描已完成。', revocationCreated: '撤銷工作已建立並等待審批。', revocationApproved: '憑證撤銷已審批。', trustCreated: '信任散發工作已建立並等待審批。', trustApproved: '信任散發已審批。', adcsAgentInstallCreated: 'AD CS Agent 安裝命令已產生。' },
    metrics: { nodes: 'CA Node', renewals: '續期工作', revocations: '撤銷工作', trust: '信任散發', totalRisks: '風險總數', critical: '嚴重風險', affectedAssets: '受影響應用資產' },
    labels: { rootAuthority: '根憑證機構', intermediateAuthority: '中繼憑證機構', intermediateCount: '{count} 個中繼 CA', expiresAt: '到期時間：{time}', defaultTrustDomain: '預設信任域', independentTrustDomain: '獨立根信任邊界', trustDomainCount: '{count} 個 CA 信任域', versionCount: '{count} 個版本', assetCount: '{count} 個應用資產', requestCount: '將建立 {count} 個獨立憑證申請', backendUsageCount: '{count} 個憑證機構正在使用', unverifiedCapabilityCount: '有 {count} 項能力尚未驗證' },
    providerTypes: { gcac_builtin: 'GCAC 內建 CA', gcac_managed_node: 'GCAC 獨立 CA Node', microsoft_adcs: 'Microsoft AD CS', acme: 'ACME 服務', est: 'EST 服務', scep: 'SCEP 服務', product_adapter: '產品介接器' },
    adcsAgent: { title: '連接現有 Microsoft AD CS', description: '在已安裝並設定 AD CS 的 Windows Server 上部署 GCAC Adapter。', providerCount: '目前已設定 {count} 套 Microsoft AD CS 連線', addProvider: '連接現有 AD CS', updateAgent: '更新 Agent', updateTitle: '更新 Microsoft AD CS Agent', updateDescription: '為現有 Provider 產生一次性更新命令，不會建立新的 Provider，也不會變更已管理的 CA。', updateCommand: '產生更新命令', wizardTitle: '連接現有 Microsoft AD CS', wizardDescription: '為一台已執行憑證授權單位的 AD CS 伺服器建立獨立連線，並產生 Adapter 安裝命令。', requirementsTitle: '目標伺服器必須已符合', requirementInstalled: '已安裝 Active Directory Certificate Services 的 Certification Authority 角色服務。', requirementConfigured: '已完成 Enterprise CA 或 Standalone CA 初始化，並存在作用中的 CA Config。', requirementService: 'CertSvc 服務正在執行。', requirementPermission: '執行安裝命令及執行 Agent 的帳戶具備所需的範本申請、CA 查詢和管理權限。', connectionName: 'AD CS 連線名稱', coexistenceTitle: '與其他 GCAC Agent 共存', coexistenceDescription: 'AD CS Agent 使用獨立服務名稱和獨立目錄，透過主動對外長連線接收工作並回傳結果，不監聽本機連接埠。它可與裝置管理 Agent 或 Gateway Agent 安裝在同一台 Windows Server 上。', createCommand: '建立連線並產生 Agent 安裝命令', commandReadyTitle: 'Adapter 安裝命令已產生', commandReadyDescription: '已建立 {name}，請在執行現有 AD CS CA 的伺服器上，以系統管理員 PowerShell 執行以下命令。', expiresAt: '命令到期時間：{time}', deleteProvider: '刪除 Provider', deletingProvider: '刪除中…', deleteConfirmText: 'DELETE', deleteProviderRisk: '將刪除此 Provider 及其未完成的註冊權杖、Agent 節點、工作和能力記錄。已綁定憑證機構的 Provider 不允許刪除。', deleteProviderBlocked: '此 Provider 已被憑證機構使用，必須先遷移或移除對應憑證機構。', defaultProviderName: 'Microsoft AD CS Agent', defaultProviderNameIndexed: 'Microsoft AD CS 連線 {index}' },
    availability: { single: '單一節點', activeStandby: '主備', activeActive: '多活' },
    authModes: { managedSecret: '託管認證資訊', clientCertificate: '用戶端憑證', none: '無驗證' },
    wizard: { title: '新增憑證機構', description: '先選擇簽發方式，再逐步設定簽發後端、CA 參數與安全邊界。', stepsAria: 'CA 建立步驟', entryStep: '選擇方式', backendStep: '設定後端', parentStep: '選擇父 CA', authorityStep: '設定 CA', reviewStep: '確認建立', completed: '已完成', inProgress: '進行中', pending: '待填寫', entryEyebrow: '第一步', entryTitle: '這套 CA 由誰負責簽發？', entryDescription: '選擇符合部署邊界的入口。內建 CA 不需要手動建立 Provider。', recommended: '建議起步', builtinTitle: '直接建立 CA', builtinDescription: '由目前 GCAC 服務內建的 OpenSSL 與 SecretService 執行簽發。', builtinFeature1: '不需部署額外節點', builtinFeature2: '適合開發與中小型內部環境', managedTitle: '部署 GCAC CA Node', managedDescription: '將 CA 私鑰與簽發執行面隔離到獨立 Windows 或 Linux 主機。', managedFeature1: '使用一次性權杖註冊節點', managedFeature2: '為 HSM 與備援部署保留邊界', externalTitle: '連接外部 CA', externalDescription: '連接既有 Microsoft AD CS、ACME、EST、SCEP 或介接服務。', externalFeature1: '沿用企業既有 PKI', externalFeature2: 'CA 私鑰由外部系統維護', backendEyebrow: '簽發後端', builtinBackendTitle: '使用 GCAC 內建簽發後端', builtinBackendDescription: '系統會自動建立或重用租戶內建 Provider，使用者只需設定 CA。', managed_nodeBackendTitle: '設定獨立 GCAC CA Node', managed_nodeBackendDescription: '建立節點簽發後端並產生短效一次性註冊權杖。', externalBackendTitle: '設定外部 CA 連線', externalBackendDescription: '填寫介接服務位址與簽發參數，GCAC 不接管外部 CA 私鑰。', builtinAutomaticTitle: '不需要另外建立 Provider', builtinAutomaticDescription: '建立 CA 時系統會自動確保內建簽發後端存在並完成綁定。', authorityEyebrow: '憑證機構', rootConfigurationTitle: '設定根 CA', rootConfigurationDescription: '定義新的根信任邊界、名稱、主體與中繼 CA 拓撲。', intermediateConfigurationTitle: '設定中繼 CA', intermediateConfigurationDescription: '先選擇父根 CA，再設定承擔日常簽發的中繼憑證機構。', builtinSecurityNote: '軟體私鑰由 GCAC SecretService 託管，不等同於不可匯出的 HSM 金鑰。', managed_nodeSecurityNote: '私鑰位於獨立節點；節點註冊並通過能力驗證後才應投入正式環境。', externalSecurityNote: 'GCAC 透過外部連線申請憑證，不擁有外部 CA 的根私鑰。', reviewEyebrow: '最後確認', reviewTitle: '檢查信任邊界與簽發方式', reviewDescription: '確認 CA 名稱、信任域、簽發後端與風險提示後再建立。', enrollmentTitle: 'CA Node 一次性註冊權杖', enrollmentDescription: '權杖僅供獨立節點首次註冊，請透過安全通道複製到目標主機。', enrollmentExpiresAt: '權杖到期時間：{time}', builtinProviderName: 'GCAC 內建簽發後端', managedProviderName: 'GCAC 獨立 CA Node', externalProviderName: '外部 CA 連線', rootTitle: '根 CA', rootDescription: '建立新的獨立根信任錨點，並可同時建立首個中繼 CA。', intermediateTitle: '中繼 CA', intermediateDescription: '掛載至現有根 CA 下承擔日常簽發，不建立新的根信任邊界。', noWarnings: '未發現額外的拓撲風險警告。' },
    riskTypes: { certificate_fingerprint_reuse: '同一憑證跨資產重用', public_key_reuse: '同一公鑰跨資產重用' },
    common: { unknown: '未知' }, aria: { tabs: '內部 CA 功能導覽' }
  },
  errors: {
    forbiddenTitle: "403 無權限",
    forbiddenMessage: "你沒有存取該頁面所需的權限。",
    missingPermission: "缺少權限：{permission}",
    notFoundTitle: "404 頁面不存在",
    notFoundMessage: "該頁面不存在，請確認存取位址是否正確。",
    backDashboard: "返回儀表板",
    back: "返回",
    logout: "登出"
  }
} as const
