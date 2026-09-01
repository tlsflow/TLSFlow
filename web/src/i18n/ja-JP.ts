// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { internalCaEnglish } from './internal-ca.locale'
import { devicesJaJP } from './devices.locale'
import { caOperationsJaJP } from './ca-operations.locale'
import { credentialsJaJP } from './credentials.locale'
import { providersJaJP } from './providers.locale'
import { monitoringTlsJaJP } from './monitoring-tls.locale'
import { acmeAutomationJaJP } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
import { certificateFormatDefaultsJaJP } from './certificate-format.locale'
import { notificationsEnglish } from './notifications.locale'
import { reportsEnglish } from './reports.locale'
export default {
  credentials: credentialsJaJP,
  devices: devicesJaJP,
  caOperations: caOperationsJaJP,
  providers: providersJaJP,
  acme: acmeAutomationJaJP,
  notifications: notificationsEnglish,
  reports: reportsEnglish,
  app: {
    brand: 'GCAC',
    platform: '企業向け SSL 証明書ライフサイクル管理プラットフォーム',
    defaultBreadcrumb: 'コンソール',
    dashboard: 'ダッシュボード',
    versionLabel: 'バージョン {version}'
  },
  common: {
    refresh: '更新',
    logout: '終了',
    enter: '開く',
    loading: '読み込み中',
    actions: { done: '完了' },
    cancel: 'キャンセル',
    save: '保存',
    edit: '編集',
    delete: '削除',
    notAvailable: '利用不可',
    yes: 'はい',
    no: 'いいえ',
    close: '閉じる',
    unknownError: '不明なエラー',
    unknownValue: '不明な値: {value}',
    saving: '保存中…',
    userFallback: '未ログインユーザー',
    tenantFallback: 'デフォルトテナント'
  },
  api: {
    errors: {
      requestFailed: 'リクエストに失敗しました',
      timeout: 'リクエストが {seconds} 秒を超えたためキャンセルされました。'
    }
  },
  auth: {
    errors: {
      missingSession: 'ログインに失敗しました。有効なセッションを取得できませんでした'
    },
    mock: {
      displayName: 'システムユーザー（Mock）'
    }
  },
  designSystem: {
    confirm: {
      title: '{action}を確認',
      impactCount: '影響を受けるリソース数：{count}',
      defaultRisk: 'この操作により、デプロイ、再試行、ロールバック、または取り消せない変更が発生する可能性があります。',
      typeToConfirm: '二次確認のため {text} を入力',
      cancel: 'キャンセル',
      confirm: '確認'
    },
    dataTable: {
      empty: 'データはまだありません',
      loading: '読み込み中...'
    },
    pagination: {
      total: '合計 {count}',
      pageSize: '1ページ {size} 件',
      previous: '前へ',
      next: '次へ',
      goToPage: '{page} ページへ移動',
      pager: 'ページ送り'
    },
    dryRunChecklist: {
      title: 'Dry-run 事前チェック結果',
      ariaLabel: 'dry-run 事前チェック結果',
      empty: 'dry-run 事前チェック結果はまだ生成されていません。',
      unnamedCheck: '無名のチェック項目',
      evidence: 'チェック根拠',
      status: { passed: '合格', failed: '失敗', warning: '警告', unknown: '不明' }
    },
    dryRunResult: {
      title: 'Dry-run 実行結果',
      close: '閉じる'
    },
    modal: {
      closeAria: 'ダイアログを閉じる'
    },
    toast: {
      close: '閉じる'
    },
    drawer: {
      closeAria: 'ドロワーを閉じる'
    },
    secretInput: {
      label: 'Secret 参照',
      placeholder: 'シークレット参照（SecretRef）を選択または入力してください。内容は平文で保存されません',
      hint: '機密フィールドにはシークレット参照のみを保存し、画面に平文で表示しません。'
    },
    riskBadge: {
      levelPrefix: 'レベル：'
    },
    status: {
      DRAFT: 'ドラフト',
      PUBLISHED: '公開済み',
      PENDING_APPROVAL: '承認待ち',
      READY: '実行待ち',
      RUNNING: '実行中',
      SUCCESS: '成功',
      PARTIAL_SUCCESS: '一部成功',
      FAILED: '失敗',
      CANCELLED: 'キャンセル済み',
      ROLLED_BACK: 'ロールバック済み',
      DISCOVERED: '検出済み',
      MANAGED: '管理対象',
      DRIFTED: 'ドリフト検出済み',
      EXPIRED: '期限切れ',
      REVOKED: '失効',
      ERROR: '異常',
      IGNORED: '無視済み',
      ONLINE: 'オンライン',
      OFFLINE: 'オフライン',
      ACTIVE: '有効',
      DISABLED: '無効化済み',
      OPEN: '未解決',
      ACKED: '確認済み',
      RESOLVED: '解決済み',
      UPGRADING: 'アップグレード中',
      UPDATE_REQUIRED: '更新が必要',
      UP_TO_DATE: '最新',
      UNKNOWN: '不明'
    },
    risk: {
      LOW: {
        label: '低',
        description: '注意が必要ですが、操作を直接ブロックしません。'
      },
      MEDIUM: {
        label: '中',
        description: 'デプロイまたは監視結果に影響する可能性があるため、確認が必要です。'
      },
      HIGH: {
        label: '高',
        description: 'サービス中断またはセキュリティ露出を引き起こす可能性があります。'
      },
      CRITICAL: {
        label: '重大',
        description: '優先対応が必要です。危険な操作には二次確認が必要です。'
      }
    },
    capability: {
      available: '対応済み',
      missing: '不足',
      title: '機能互換性',
      description: '確認済みの機能互換性結果のみ表示します。未確認項目はサポート済みとは見なしません。',
      matrixLabel: '機能互換性マトリクス',
      satisfied: '満たしています',
      unknown: '不明',
      manualRisk: '手動確認',
      empty: '機能互換性データはまだありません。'
    },
    executionLogViewer: {
      mode: {
        realtime: 'リアルタイム更新',
        autoRefresh: '自動更新'
      },
      search: {
        placeholder: 'ログ内容を検索'
      },
      level: {
        aria: 'ログレベル',
        all: 'すべて'
      },
      actions: {
        showAll: '全 {count} 件を表示',
        showRecent: '最新 {count} 件だけ表示'
      },
      hint: {
        streaming: 'タスクステータスとログは持継リアルタイム更新。',
        autoRefresh: 'タスクステータスとログは自動更新。',
        pollingFallback: '現在は定期更新モードを使用しています。',
        limited: '最新 {visible} 件のログを表示中。全 {total} 件。'
      },
      steps: {
        aria: '実行ステップ',
        emptyDetail: 'ステップ説明はまだありません'
      },
      empty: {
        logs: 'ログはまだありません。'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: '実行進捗の概要',
        taskList: 'タスクリスト',
        latestEvents: '最新イベント',
        executionLog: '実行ログ'
      },
      checklist: {
        title: 'チェック結果'
      },
      detail: {
        stepsCompleted: '{completed}/{total} ステップ完了済み',
        summaryFailed: '{total} 件のチェック結果が返され、{failed} 件が失敗しました',
        summaryPassed: '{passed} 件チェック全部合格',
        summaryReturned: '{total} 件のチェック結果が返されました',
        summaryWarning: '{total} 件のチェック結果が返され、{warning} 件の警告があります',
        waitingStart: 'タスクの開始を待っています',
        waitingSteps: '実行ステップを待っています…'
      },
      empty: {
        activity: '実行ログでタスク完了後逐步表示。',
        events: 'イベント記録はまだありません。',
        tasks: 'タスクはまだ作成されていません。実行ステップを待っています…'
      },
      event: {
        collapse: 'イベントを折りたたむ',
        defaultLabel: 'イベント',
        defaultTitle: 'タスクイベント',
        expand: 'イベントを展開',
        waitingDetail: 'イベント記録を待っています'
      },
      feed: {
        completed: '実行完了',
        failed: '実行失敗',
        skipped: 'スキップ済み',
        warning: '警告付きで完了'
      },
      loading: {
        pollingFallback: '定期更新中…',
        refreshing: '更新中'
      },
      log: {
        collapse: '完全なログを折りたたむ',
        expand: '完全なログを表示'
      },
      metrics: {
        completed: '完了',
        failed: '失敗',
        passed: '合格',
        queued: 'キュー待ち',
        running: '実行中',
        totalTasks: '総タスク数',
        unknown: '不明',
        warning: '警告'
      },
      process: {
        dryRun: '更新チェック',
        execution: '実行'
      },
      operation: {
        prepare: '証明書ファイルと対象の状態を確認し、更新の準備をします。',
        backup: '必要な場合に復元できるよう、現在の状態を保存します。',
        update: '新しい証明書を対象サービスに安全に適用します。',
        reload: '新しい証明書を読み込み、サービスが安定するまで待ちます。',
        verify: 'サービスが新しい証明書を正しく使用しているか確認します。',
        rollback: '更新前の証明書とサービス状態を復元します。'
      },
      progress: {
        completed: 'すべて完了',
        failed: '完了済み、存で失敗件',
        pending: '結果の書き戻しを待っています',
        processFailed: '{process} に失敗しました',
        queued: 'スケジューリング待ち',
        running: 'タスク実行中',
        warning: '完了済み、存でリスク警告'
      },
      section: {
        completedCount: '{completed}/{total} 完了済み',
        executionLog: '実行ログ',
        latestEvents: '最新イベント',
        taskProgress: 'タスク進行状況'
      },
      status: {
        completed: '完了',
        failed: '失敗',
        queued: '待機中',
        running: '実行中',
        skipped: 'スキップ済み',
        warning: '警告あり'
      },
      step: {
        backup: '事前バックアップ',
        discover: '環境識別',
        prepare: '証明書の準備',
        installDryRun: 'マテリアル準備',
        installExecution: '証明書インストール',
        updateDryRun: '更新チェック',
        updateExecution: '証明書の更新',
        reload: 'サービス更新',
        verify: '結果検証'
      },
      subtitle: {
        completed: 'タスクは完了しました。',
        failed: 'タスク終了済み、但戻る了失敗結果。',
        failedFriendly: 'この手順を完了できませんでした。詳細を開いて原因を確認してください。',
        failedChecks: '{total} 件チェック、{failed} 件に失敗しました',
        passedChecks: '{total} 件チェック合格',
        queued: 'タスクは作成済みです。実行を待っています。',
        running: 'タスクは開始済みです。実行結果を待っています。',
        runningChecks: '戻る {total} 件チェック済み',
        skipped: 'このステップはスキップ済みで、これ以上待機しません。',
        warningChecks: '{total} 件チェック、{warning} 件警告'
      },
      time: {
        waitingStart: '開始待ち'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: 'キャンセル',
        dryRun: 'Dry-run プレビューを実行',
        next: '次へ',
        previous: '前へ',
        save: 'プランを保存'
      },
      aria: {
        steps: 'デプロイ手順',
        wizard: 'デプロイウィザード'
      },
      capability: {
        targetMissingDetail: 'デプロイターゲットがまだ選択されていません。',
        targetSelectedDetail: 'デプロイ対象を選択しました。直接送信できます。Dry-run は資産詳細から手動で実行できます。',
        targetSelection: 'デプロイターゲット選択',
        targetSource: 'デプロイターゲット'
      },
      checks: {
        failed: '失敗 {count}',
        passed: '合格 {count}',
        unknown: '不明 {count}',
        unnamed: '無名のチェック項目',
        warning: '警告 {count}'
      },
      empty: {
        noTargets: '選択可能なアプリケーションアセットターゲットはまだありません',
        selectTarget: '1 個アプリケーションアセットのデプロイターゲット。を選択してください'
      },
      fallback: {
        generatedByApplicationEntry: 'アプリケーションエントリから生成',
        missingBinding: 'バインド情報が指定されていません',
        unboundCertificateVariable: '証明書変数がバインドされていません',
        unconfigured: '未設定',
        unconfiguredRunner: '実行場所が未設定です',
        unknownEnd: '終了不明',
        unknownStart: '開始不明',
        unnamedSite: '無名のサイト',
        unnamedVersion: '無名のバージョン',
        unrecognizedManagedTarget: '未識別の管理対象ターゲット',
        unselected: '未選択',
        unselectedVersion: 'バージョン未選択',
        unselectedWorkflow: 'ワークフロー未選択'
      },
      fields: {
        applicationTarget: 'アプリケーションアセットのデプロイターゲット',
        artifactConfig: '成果物設定',
        binding: 'バインド',
        certificateAsset: '証明書アセット',
        certificateVariable: '証明書変数',
        certificateVersion: '証明書バージョン',
        deploymentTarget: 'デプロイターゲット',
        keyword: 'キーワード検索',
        managedTarget: '管理対象ターゲット',
        runner: '実行場所',
        site: 'サイト',
        verifyUrl: '検証 URL',
        version: 'バージョン',
        workflow: 'ワークフロー'
      },
      panels: {
        certificateTitle: '1. 証明書マテリアル',
        submitTitle: '3. 事前チェックと送信',
        targetTitle: '2. デプロイターゲット'
      },
      panelState: {
        needPrerequisites: '前提選択の完了待ち',
        operable: '操作可能',
        pending: '完了待ち',
        readyNext: '次のステップへ進めます'
      },
      placeholders: {
        selectTarget: 'アプリケーションアセットターゲットを選択してください',
        targetKeyword: 'ドメイン名、サイト、バインド情報で検索'
      },
      plan: {
        dryRunCompleted: '直近の dry-run は完了しました。',
        submitCompleted: '直近の送信は完了しました。'
      },
      preview: {
        needCertificate: '先に証明書マテリアルの選択を完了してください。',
        needTarget: '証明書マテリアルの選択後、配布先のアプリケーションアセットターゲットを指定してください。',
        ready: '選択した証明書バージョンを {count} 個のアプリケーションアセットターゲットへデプロイします。'
      },
      status: {
        checksReturned: '事前チェック結果が返されました。結果に基づいて保存、送信、または直接実行を決定できます。',
        current: '現在のステータス',
        default: '先に dry-run を開始してから、実行を送信するかどうかを決定することを推奨します。',
        dryRunStarted: '事前チェックを開始しました。実行結果エリアで進行状況を確認してください。',
        submitted: 'プランを送信しました。'
      },
      steps: {
        certificate: {
          description: '証明書アセットとバージョン',
          title: '証明書マテリアルを選択'
        },
        submit: {
          description: 'Dry-run、保存、送信、実行',
          title: '事前チェックして送信'
        },
        target: {
          description: 'アプリケーションアセット、サイト、バインド',
          title: 'デプロイターゲットを選択'
        }
      },
      stepState: {
        active: '進行中',
        done: '完了',
        pending: '開始待ち'
      },
      target: {
        workflowMode: 'ワークフローモード',
        workflowModeWithName: 'ワークフローモード（{name}）'
      },
      version: {
        autoLatest: '自動選択最新可デプロイバージョン（現在：{current}）',
        noDeployableVersion: '現在デプロイ可能な証明書バージョンはありません',
        range: '{id} ({notBefore} ~ {notAfter})'
      },
      currentStep: 'ステップ {current} / {total}',
      selectedTargetCount: '{count} 個のターゲットを選択済み',
      subtitle: '段階的にデプロイプラン設定を完了します',
      title: 'デプロイウィザード'
    }
  },
  tasks: {
      title: 'グローバルタスク',
      quick: { active: '進行中のタスク', recent: '最近完了したタスク' },
      tabs: { all: 'すべて', execution: '実行タスク', monitoring: '監視タスク', system: 'システムタスク', other: 'その他のタスク' },
    aria: { openDrawer: 'グローバルタスクを開く', tabs: 'タスク分類' },
    filters: {
      includeAll: 'すべてのタスクを表示',
      keyword: 'タスク、エラー、IDを検索',
      taskType: 'タスク種別',
      status: '状態',
      allStatuses: 'すべての状態',
      resourceType: 'リソース種別',
      resourceId: 'リソース ID',
      requestedBy: '実行ユーザー',
      taskId: 'タスク ID',
      createdFrom: '開始時刻',
      createdTo: '終了時刻'
    },
    fields: { requestedBy: '実行ユーザー', triggerSource: 'トリガー', createdAt: '作成日時', startedAt: '開始日時', finishedAt: '終了日時', error: '最後のエラー' },
    sections: { timeline: '状態タイムライン', attempts: '試行履歴', acmeHistory: '更新の進行状況', logs: '生ログ', children: '子タスク', errors: 'エラー', audit: '監査イベント', monitoringProbes: 'プローブ記録' },
    actions: { backToList: '一覧に戻る', viewAll: 'すべてのタスクを表示', viewRawLogs: '生ログを表示', search: '検索', reset: 'リセット', previousPage: '前のページ', nextPage: '次のページ', forceCancel: '強制終了', forceCancelConfirm: 'このタスクを強制終了しますか？ 実行中のリモート処理は手動確認が必要になる場合があります。', forceCancelReason: 'グローバルタスクからオペレーターが強制終了' },
    messages: { loadFailed: 'タスク一覧の読み込みに失敗しました。', detailFailed: 'タスク詳細の読み込みに失敗しました。', forceCancelFailed: 'タスクの強制終了に失敗しました。' },
    values: { system: 'システム', externalApi: '外部 API', empty: '記録なし', none: 'なし' },
    agentUpdate: {
      title: 'Agent 更新進捗', timelineTitle: '更新の進行状況',
      fields: { target: '対象ホスト', currentVersion: '現在のバージョン', targetVersion: '対象バージョン', phase: '現在の段階', planId: '更新計画', transactionId: '更新トランザクション' },
      values: { unknown: '不明' },
      phases: { queued: '待機中', dispatching: '承認送信中', accepted: 'Agent が受付', upgrading: '更新中', status_checking: '結果確認中', succeeded: '完了', failed: '未完了', rolled_back: 'ロールバック済み', manual_required: '手動対応が必要', unknown: '不明' },
      summary: { queued: '更新タスクは待機中です。', dispatching: '更新承認を送信しています。', accepted: 'Agent が更新を受け付け、実行を待っています。', upgrading: 'Agent が新しいバージョンをダウンロードして更新しています。', waiting: 'Agent の結果を待っています。', succeeded: 'Agent を {currentVersion} から {targetVersion} に更新しました。', failed: 'Agent の更新が完了しませんでした。' },
      events: { created: 'タスク作成', claimed: 'タスク割り当て', started: '更新状態の確認開始', progress: '更新状態を更新', waiting_result: '更新結果を待機', succeeded: '更新成功', failed: '更新失敗', retry_scheduled: '次の確認を待機', cancelled: 'タスクキャンセル' },
    },
    pluginRefresh: {
      subtitle: 'プラグインカタログ保守タスク',
      overview: { kicker: '更新結果', description: '{scope} を更新し、最新のプラグイン参照を利用可能な実行ノードへ同期しました。' },
      metrics: { catalogVersions: 'カタログバージョン', enabledVersions: '有効なバージョン', agentsProjected: '同期済みノード', agentsFailed: '同期失敗' },
      sections: { timeline: '処理履歴', catalogVersions: '現在のプラグインバージョン', failures: '同期エラー' },
      actions: { showTechnicalDetails: '技術詳細を表示' },
      fields: { taskId: 'タスク ID' },
      values: { unavailable: '未取得', noVersions: 'プラグインバージョンは返されませんでした', triggerSource: 'プラグインカタログ更新' },
      summary: { succeeded: '更新完了：{versions} 件のプラグインバージョンを更新し、{projected} 台の実行ノードへ同期しました。', failed: 'プラグインカタログの更新に失敗しました。', cancelled: 'プラグインカタログの更新をキャンセルしました。', retryWaiting: '後で自動的に再試行します。', waitingResult: '更新結果を待っています。', awaitingConfirmation: '更新結果の確認が必要です。', cancelling: '更新をキャンセルしています。', queued: '更新をキューに追加しました。', running: 'プラグインカタログを更新しています。' },
      events: { created: '更新タスクを作成しました。処理を待っています。', claimed: 'バックグラウンド処理へ割り当てました。', started: 'プラグインカタログの読み取りを開始しました。', progress: 'バージョンを整理し、実行ノードへ同期しています。', retryScheduled: '処理が完了せず、自動再試行を予約しました。', waitingResult: '実行ノードの結果を待っています。', awaitingConfirmation: '更新結果を確認してください。', cancelRequested: 'キャンセル要求を受け付けました。', expired: 'タスクがタイムアウトしました。', cancelled: '更新タスクをキャンセルしました。', succeeded: '更新完了：{versions} 件、{projected} 台のノードを同期しました。', failed: '更新失敗：{reason}' },
      versionStatus: { added: '追加', enabled: '有効', disabled: '無効', other: 'その他' }
    },
    approval: {
      title: '承認タスクの詳細',
      description: '承認内容、状態の履歴、実行できる操作を確認します。',
      contentTitle: '承認内容',
      fields: { operation: '操作種別', target: '対象', approvalId: '承認 ID', requestedBy: '申請者', riskLevel: 'リスクレベル', createdAt: '申請日時', decision: '承認結果', summary: '操作概要' },
      content: { deployment: '証明書デプロイ', automation: '自動化実行', defaultSummary: 'このタスクは承認判断を待っています。' },
      values: { approved: '承認済み', rejected: '拒否済み', pending: '承認待ち' },
      timelineTitle: '状態のタイムライン',
      timeline: { created: '承認を申請', createdDescription: 'タスクが作成され、承認者の処理を待っています。', approved: '承認済み', approvedDescription: '承認者が操作の続行を許可しました。', rejected: '承認を拒否', rejectedDescription: '承認者がこの操作を拒否しました。', forceEnded: 'タスクを強制終了', forceEndedDescription: 'オペレーターがこのタスクを強制終了しました。', pending: '承認処理中', pendingDescription: 'システムが承認結果を待っています。' }
    },
    relatedNames: { pluginCatalog: 'プラグインカタログ', deploymentPlan: '配備計画', acmeRenewal: 'ACME Provider（{provider}）- {certificate} 証明書更新' },
    acmeHistory: {
      queued: { title: '更新待ち', description: 'システムはこの証明書更新の処理を待機しています。' },
      running: { title: '更新中', description: 'システムは認証局に更新を要求しています。' },
      retryWaiting: { title: '自動再試行待ち', description: '今回の発行は完了していません。システムが後で再試行します。' },
      succeeded: { title: '更新成功', description: '新しい証明書が発行され、保存されました。' },
      failed: { title: '更新失敗', description: 'システムは証明書を更新できませんでした。詳細は生ログを確認してください。' },
      cancelled: { title: '更新をキャンセル', description: 'この証明書更新はキャンセルされました。' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: '証明書Dry-run',
      CERTIFICATE_DEPLOY: '証明書配備',
      DEPLOYMENT_APPROVAL: '配備承認',
      CERTIFICATE_VERIFY: '証明書検証',
      CERTIFICATE_ROLLBACK: '証明書ロールバック',
      AGENT_INSTALL: 'Agentインストール',
      AGENT_UPDATE: 'Agent更新',
      PLUGIN_REFERENCE_REFRESH: 'プラグイン参照更新',
      DEPLOYMENT_PLAN_REFRESH: '配備計画更新',
      MONITORING_BATCH: '監視バッチ',
      MONITORING_PROBE: '監視プローブ',
      CREDENTIAL_HEALTH_CHECK: '資格情報の有効性チェック',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CERTIFICATE_REVOCATION: '証明書失効',
      CRL_PUBLISH: 'CRL公開',
      TRUST_DISTRIBUTION: '信頼配布',
      GATEWAY_DELEGATION: 'ゲートウェイ委任',
      WORKFLOW_RUN: 'ワークフロー実行',
      AUTOMATION_RUN: '自動化実行',
      REPORT_EXPORT: 'レポート出力',
      NOTIFICATION_DELIVERY: '通知配信',
      OTHER: 'その他のタスク'
    },
    summaryTemplates: {
      QUEUED: '{task}をキュー登録済み',
      RUNNING: '{task}を実行中',
      RETRY_WAITING: '{task}の再試行待ち',
      WAITING_RESULT: '{task}の実行結果を待機中',
      AWAITING_CONFIRMATION: '{task}の結果を確認待ち',
      CANCELLING: '{task}をキャンセル中',
      SUCCEEDED: '{task}が完了',
      FAILED: '{task}が失敗',
      CANCELLED: '{task}をキャンセル済み'
    },
    status: { QUEUED: 'キュー待ち', RUNNING: '実行中', RETRY_WAITING: '再試行待ち', WAITING_RESULT: '実行結果待ち', AWAITING_CONFIRMATION: '結果確認待ち', WAITING_APPROVAL: '承認待ち', CANCELLING: 'キャンセル中', SUCCEEDED: '成功', FAILED: '失敗', CANCELLED: 'キャンセル済み' }
  },
  shell: {
    currentLocation: '現在位置',
    breadcrumb: 'パンくずリスト',
    currentGroupNavigation: '現在のグループナビゲーション',
    backDashboard: 'ダッシュボードへ戻る',
    sidebarCollapse: 'サイドバーを折りたたむ',
    sidebarExpand: 'サイドバーを展開',
    authorizationWarning: '有効な製品ライセンスがありません。製品ライセンスページで設定してください。',
    authorizationWarningAction: 'ライセンス設定を開く',
    authorizationWarningClose: 'ライセンス警告を閉じる'
  },
  globalSearch: {
    title: 'グローバル検索',
    description: '証明書、デバイス資産、システム設定、プラグインを検索します。',
    inputLabel: 'グローバルリソースを検索',
    inputPlaceholder: '名前、ドメイン、フィンガープリント、パスを入力',
    hint: 'キーワードを入力して検索を開始します。',
    aria: {
      open: 'グローバル検索を開く'
    },
    categories: {
      certificates: '証明書',
      assets: 'デバイス資産',
      settings: 'システム設定',
      plugins: 'プラグイン'
    },
    types: {
      serverCertificate: 'サーバー証明書',
      intermediateCertificate: '中間証明書',
      rootCertificate: 'ルート証明書',
      application: 'アプリケーション',
      device: 'デバイス',
      cloudService: 'クラウドサービス',
      systemSetting: 'システム設定',
      plugin: 'プラグイン'
    },
    empty: {
      title: '一致する結果がありません',
      description: '別の名前、ドメイン、フィンガープリント、パスを試してください。'
    },
    messages: {
      loadFailed: 'グローバル検索の読み込みに失敗しました。'
    }
  },
  preferences: {
    theme: 'テーマ',
    language: '言語',
    themeLight: 'ライトモード',
    themeDark: 'ダークモード',
    themeToggle: 'テーマモードを切り替え',
    languageSelect: '画面言語を選択',
    title: '表示設定',
    description: 'テーマと言語は現在のユーザーのバックエンド設定に保存されます。',
    errors: {
      loadFailed: '設定の読み込みに失敗しました',
      saveFailed: '設定の保存に失敗しました'
    }
  },
  systemInitialization: {
    intro: { ariaLabel: 'オープニングアニメーション', progressAriaLabel: '読み込み進捗', start: '利用を開始', slogan: '止まらないセキュリティサービスのために' },
    preview: { title: '初期設定プレビュー' },
    title: '初期設定', description: '管理者アカウントを作成し、表示設定を選びます。', help: '手順に沿って設定を完了します。', stepsLabel: '設定手順',
    steps: { account: '管理者アカウント', accountHelp: 'ログインに使うユーザー名とパスワードを設定します。', license: 'ライセンス', licenseHelp: 'ライセンスファイルを取り込みます。後で設定することもできます。', confirm: '内容の確認', confirmHelp: '入力した内容を確認します。', complete: '完了', completeHelp: '設定が終わり、ログインできます。' },
    stage: { account: { title: '管理者アカウント', help: 'このアカウントでログインしてシステムを管理します。' }, license: { title: 'ライセンス（任意）', help: '今スキップしても利用できます。後で「ライセンス」ページから設定できます。' }, confirm: { title: '内容の確認', help: 'パスワードはここには表示されません。' }, complete: { title: '設定完了', help: 'これでログインできます。' } },
    account: { username: 'ユーザー名', usernamePlaceholder: '例：admin', displayName: '表示名', displayNamePlaceholder: '例：システム管理者', password: 'パスワード', passwordPlaceholder: '8 文字以上', passwordConfirmation: 'パスワード確認', passwordConfirmationPlaceholder: 'もう一度入力', locale: '表示言語', theme: 'テーマ' },
    license: { description: 'まずリクエストファイルを出力して提供元に送り、受け取ったライセンスファイルを取り込みます。', createRequest: 'リクエストファイルを出力', copyRequest: 'リクエスト内容をコピー', requestCopied: 'コピーしました', importFile: 'ライセンスファイルを取り込む', activationResponse: 'ライセンス内容', activationResponsePlaceholder: 'ライセンスファイルを取り込むか、内容を貼り付け', importResponse: 'ライセンスを取り込む', configured: 'ライセンスが有効になりました。', skip: '後で設定' },
    confirm: { username: 'ユーザー名', locale: '表示言語', theme: 'テーマ', kekTitle: 'GCAC_SECRET_KEK を安全に保管してください', kekWarning: 'これはシステムがデータを復号するためのルートキーです。オフラインで保管し、コード、ログ、チャットツールには絶対に残さないでください。紛失するとデータを復元できず、漏えいすると他人にデータを読まれる可能性があります。' },
    complete: { licenseConfigured: 'ライセンスが有効になりました。ログインできます。', licenseSkipped: 'ライセンスは未設定です。後で「ライセンス」ページから設定できます。' },
    actions: { previous: '戻る', continue: '次へ', createAdmin: 'アカウントを作成して次へ', finish: '設定を完了', login: 'ログインへ' },
    errors: { passwordMismatch: '2 回入力したパスワードが一致しません。', missingSession: 'アカウントは作成されましたが自動ログインできませんでした。手動でログインしてください。', createFailed: 'アカウントを作成できませんでした。もう一度お試しください。', licenseFailed: 'ライセンスを処理できませんでした。ファイルが正しいか確認してください。', activationRequestMissing: 'リクエスト内容を取得できませんでした。もう一度出力してください。', jsonObjectRequired: 'ファイルの形式が正しくありません。完全なライセンスファイルか確認してください。' }
  },
  userMenu: {
    currentUser: '現在のユーザー',
    changePassword: 'パスワード変更',
    userGuide: 'ユーザーガイド',
    logout: 'ログアウト'
  },
  password: {
    title: 'パスワード変更',
    description: '現在ログイン中のユーザーのローカルパスワードを変更します。',
    current: '現在のパスワード',
    new: '新しいパスワード',
    confirm: '新しいパスワードを確認',
    cancel: 'キャンセル',
    submit: 'パスワードを保存',
    submitting: '保存中…',
    success: 'パスワードを更新しました',
    failed: 'パスワード変更に失敗しました',
    mismatch: '2 回入力した新しいパスワードが一致しません',
    tooShort: '新しいパスワードは 8 文字以上で入力してください'
  },
  viewMode: {
    switchLabel: 'アプリケーション表示モード',
    user: 'ユーザー表示',
    professional: 'プロフェッショナル表示',
    steps: {
      certificates: '証明書',
      applications: 'アプリケーション',
      deployments: 'デプロイ'
    }
  },
  nav: {
    dashboard: 'ダッシュボード',
    dashboardDesc: 'アプリケーション、証明書、Agent、ゲートウェイと監査ステータス概要',
    certificates: '証明書管理',
    certificatesDesc: '証明書ライブラリ、バインド関係と期限切れステータス',
    certificateAssets: '証明書アセット',
    certificateInventoryShort: '証明書台帳',
    certificateAssetsDesc: '証明書、秘密鍵参照、フィンガープリントと期限切れ日時',
    acmeAutomation: 'ACME 証明書自動化',
    acmeAutomationShort: 'ACME 自動化',
    acmeAutomationDesc: 'ACME 証明書の発行、更新、追跡',
    caOperationsShort: 'CA 運用',
    certificateFormats: '証明書形式設定',
    certificateFormatsShort: '納品形式',
    certificateFormatsDesc: '保存済み証明書に対して PFX、CER、CRT、PEM などの形式ルールを定義',
    assetCenter: 'Asset inventory',
    assetCenterDesc: 'Manage application, device, and cloud service assets',
    assetManagement: 'アプリケーション管理',
    assets: 'アプリケーション',
    assetsDesc: 'ドメイン名/IP 単位のアプリケーションエントリと証明書デプロイ先',
    devices: 'デバイス',
    agents: 'Agent',
    agentsDesc: 'オンラインステータス、ハートビートと機能セット',
    gateways: 'ゲートウェイ',
    gatewaysDesc: '隔離ゾーンゲートウェイ、プロトコルとへ達可能ターゲット',
    deployments: '証明書デプロイ',
    deploymentsDesc: 'デプロイプラン、ワークフロー、自動化、実行記録',
    deploymentPlans: 'デプロイプラン',
    deploymentPlansDesc: '証明書デプロイプラン',
    executions: '実行記録',
    executionsDesc: '実行ステップ、ログ、失敗とロールバック',
    reports: 'レポート',
    reportsDesc: '証明書インシデント期間、リスク対応、自動化効果',
    incidentWindowReport: 'インシデント期間レポート',
    incidentWindowReportDesc: '期限切れが近い証明書を優先表示',
    riskResponseReport: 'リスク対応レポート',
    riskResponseReportDesc: '確認、解決時間、SLA を確認',
    automationEffectivenessReport: '自動化効果レポート',
    automationEffectivenessReportDesc: '実行と対象の成功率、失敗段階を確認',
    workflows: 'ワークフロー',
    workflowsDesc: 'ワークフローとプラグイン',
    workflowTemplates: 'ワークフロー',
    workflowTemplatesDesc: 'キャンバスドラフト、変数、機能宣言と公開',
    automations: '自動化',
    automationsDesc: '証明書更新計画のスケジュール、オンデマンド、バッチ実行',
    plugins: 'プラグインセンター',
    pluginsDesc: 'Provider、Executorとサンドボックスステータス',
    monitoring: '監視と監査',
    monitoringDesc: 'アラート、監査と証明書ステータス',
    monitoringAnalysis: '監視分析',
    monitoringAnalysisDesc: '監視対象、プローブ結果、証明書リスクを分析',
    monitorAlerts: '監視アラート',
    monitorAlertsDesc: '期限切れ、ドリフトと実行失敗イベント',
    monitorTls: 'TLS 深度監視',
    monitorTlsDesc: '証明書認証パス、プロトコル/スイート、互換性シミュレーションとプロトコル詳細',
    audits: '監査ログ',
    auditsDesc: '操作証拠と合规エクスポート',
    logAudit: 'ログ監査',
    logAuditDesc: '監査イベントを確認し、操作証拠をエクスポート',
    settings: 'システム設定',
    settingsDesc: 'テナント、ユーザー、権限とシステム設定',
    settingsOverview: '設定',
    systemSettings: 'システム設定',
    systemSettingsDesc: 'システム設定と安全元データ',
    credentials: '資格情報',
    notifications: '通知',
    licensing: 'ライセンス',
    users: 'ユーザー管理',
    usersDesc: 'コンソールユーザー、ステータスとロール',
    roles: '権限管理',
    rolesDesc: 'ロール、認可対象範囲とメンバー割り当て',
    identitySources: 'ID ソース',
    identitySourcesDesc: 'AD/LDAP サービス設定',
    groupRoleMappings: 'グループロールマッピング'
  },
  automations: {
    title: '自動化',
    description: '証明書更新計画のスケジュール、オンデマンド、バッチ実行を一元管理します。',
    empty: '自動化設定はありません。',
    emptyDescription: '説明なし',
    common: { notAvailable: 'なし', allRelated: 'All related targets' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: '外部 API でトリガー', once: '指定時刻に一度だけ実行', onceHelp: 'ブラウザーのローカル時刻を選択します。実行後に再スケジュールされません。', recurring: '定期実行', scheduleHelp: '継続的な確認が本当に必要な場合だけ使用してください。', recurringHelp: '継続的な確認が本当に必要な場合だけ使用してください。', recurringWarningTitle: '証明書更新での定期実行は推奨されません', recurringWarning: '通常は証明書発行後に外部システムから起動するか、固定時刻に一度だけ実行します。', certificateVersionCreated: 'Certificate new-version event', runAt: '実行時刻', frequency: '実行周期', daily: '毎日', weekly: '毎週', monthly: '毎月', time: '時刻', weekday: '曜日', monthDay: '日付', legacyCustom: '既存のカスタム計画を保持', legacyCron: '既存 Cron（読み取り専用）', weekdays: { 0: '日曜日', 1: '月曜日', 2: '火曜日', 3: '水曜日', 4: '木曜日', 5: '金曜日', 6: '土曜日' } },
    externalApi: { executionModeLabel: '外部実行モード', executionModeAria: '外部実行モード', keyTitle: '外部 API Key', keyDescription: 'この Key は現在の自動化ページに表示され続け、いつでもコピーできます。', keyNotice: 'X-Automation-API-Key リクエストヘッダーで送信します。', keyStatusPending: '保存して有効化すると生成', keyStatusActive: '生成済み', keyStatusUnavailable: '生成済み（このページでは完全な Key を表示していません）', keyEditorDescription: '完全な Key は現在のページに表示され続け、いつでもコピーできます。更新すると古い Key は直ちに無効になります。', keyValueLabel: 'API Key', keyValueAria: '外部 API Key', keyUnavailableValue: 'このページでは完全な Key を表示していません', keyUnavailable: 'このページに完全な Key はありません。「Key を更新」をクリックして新しい Key を生成してください。', rotate: 'Key を更新', rotating: '更新中', rotateNotice: '更新すると古い Key は直ちに無効になります。', mode: '実行モード：{mode}', copy: 'Key をコピー', copied: 'コピーしました', copyAria: 'API Key をコピー', copyCurlAria: 'CURL コマンドをコピー', rotateAria: 'API Key を更新', apiManualButton: 'API ガイド', apiManualAutomationId: '現在の自動化 ID', apiManualAutomationIdUnavailable: '保存後に生成', apiManualTitle: '外部 API ガイド', apiManualDescription: '自動化 ID と API Key を使って以下のインターフェースを呼び出します。証明書ドメインは自動化に事前設定されています。', apiManualCertificateVersion: '起動と互換性確認には正確な certificateVersionId が必要です。', apiManualRunTitle: '自動化を起動', apiManualRunDescription: '証明書バージョンを指定して 1 回実行します。実行キューに追加されます。', apiManualRunCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/run' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -H Idempotency-Key:automation-run-$(date +%s) \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualPreviewTitle: '現在のアプリケーション互換性を確認', apiManualPreviewDescription: '証明書バージョンを指定し、対象アプリケーション、実行可否、除外理由を確認します。', apiManualPreviewCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/preview' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualVersionsTitle: '利用可能な証明書バージョン一覧', apiManualVersionsDescription: 'この自動化に事前設定された証明書ドメインで選択可能なバージョンを返します。', apiManualVersionsCurl: "curl 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/certificate-versions' \\\n  -H 'X-Automation-API-Key: ak_xxx'" },
    form: { existingAssetTitle: '既存アプリ資産のみを更新', existingAssetDescription: '既存の証明書バインドがあるアプリ資産だけを処理します。初回インストールや新しい対象の追加は行いません。', certificateDomains: '証明書ドメイン', certificateDomainsPlaceholder: '証明書ドメインをカンマ区切りで入力', certificateDomainsHelp: '指定したドメインに対応する既存のアプリ資産バインドだけを更新します。', versionSelection: '更新する証明書バージョン', versionSelectionLatest: '最新の証明書バージョンを自動使用', versionSelectionSpecific: '指定した証明書バージョンを使用', versionSelectionHelp: '実行開始時にバージョンを解決して固定します。', certificateVersionIds: '指定する証明書バージョン', certificateVersionIdsPlaceholder: '証明書バージョン ID をカンマ区切りで入力', certificateVersionIdsHelp: '各バージョンは上記ドメインの証明書に属している必要があります。', versionLoading: '選択可能な証明書バージョンを読み込んでいます。', versionLoadFailed: '証明書バージョンの読み込みに失敗しました。後で再試行してください。', versionEmpty: 'このドメインに選択可能な証明書バージョンはありません。', schedule: '更新するタイミング', scheduleHelp: 'オンデマンドで開始するか、Cron とタイムゾーンで定期実行します。', execution: '実行時の処理', executionHelp: '既存バインドごとに個別の更新計画を作成し、DeploymentPlan と ExecutionRun を再利用します。', snapshot: 'ドメイン、資産、証明書バージョンのスナップショットを固定' },
    fields: { name: '名前', description: '説明', trigger: 'トリガー', eventSources: 'Event sources', targetScope: 'Update scope', selectedAssets: 'Selected managed applications', selectedAssetsHelp: 'Select at least one managed application.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Cron 式', timeZone: 'タイムゾーン', expiresWithinDays: '有効期限までの日数', environments: '対象環境（カンマ区切り）', certificateIds: '指定証明書（任意）', certificateIdsPlaceholder: '証明書 ID をカンマ区切りで入力', certificateIdsHelp: '入力した場合は指定証明書だけを処理し、空欄の場合は期限と環境で自動選択します。', expiresWithinDaysHelp: 'この期間内に期限切れとなる証明書だけを対象にします。', environmentsHelp: '指定した環境の証明書だけを処理します。', planType: 'デプロイ計画の種類', planTypeHelp: '一致した証明書対象ごとに実行時に独立した DeploymentPlan を作成します。', planTypeUpdate: '既存の証明書バインドを更新', planTypeInstall: '対象へ証明書をインストール', planTypeVerifyOnly: '検証のみ、証明書は変更しない', planMode: '実行方式', planModeHelp: '既存計画には紐付けず、対象ごとに実行時に新しい計画を作成します。', planModeCreateAndExecute: '計画を作成して実行', planModeCreateOnly: '計画だけ作成して実行しない', maxTargets: '1 回の最大対象数', concurrency: '同時実行数', failureCount: '失敗件数しきい値', requireDryRun: '過去の Dry run 設定（実行の必須条件ではありません）', startedAt: '開始時刻', finishedAt: '終了時刻', failureStage: '失敗段階', parentRun: '親実行' },
    actions: { create: '自動化を作成', detail: 'Details', edit: '編集', delete: '削除', cancel: 'キャンセル', save: '保存', copy: '複製', enable: '有効化', disable: '無効化', runNow: 'Run now', preview: '対象をプレビュー', history: '実行履歴', confirmRun: '実行を確認', stop: '実行を停止', retryFailed: '失敗対象を再試行', openPlan: 'デプロイ計画を表示', openExecution: '実行記録を表示' },
    manualRun: { title: '手動実行', description: '実行前に証明書バージョンを選択してください。', versionLabel: '証明書バージョン', versionPlaceholder: '証明書バージョンを選択', help: '実行時に選択したバージョンに紐づくアプリ資産を解決します。', empty: '手動実行できる証明書バージョンがありません。', stopOnError: 'エラーで中断', dryRun: '任意の Dry-run プレビューを実行', start: '実行開始', downgradeNotice: '{count} 件のアプリ資産では対象証明書の有効期限が現在より短くなります。確認後にのみ実行を続行します。', downgradeConfirmTitle: '証明書の有効期限短縮を確認', downgradeConfirmDescription: '手動操作です。確認すると {count} 件のアプリ資産をより短い有効期限の証明書へ更新します。', downgradeConfirmAction: '確認して実行' },
    columns: { status: 'Status', trigger: 'トリガー', targets: '対象上限', actions: '実行アクション', nextRun: '次回実行', lastRun: '前回実行' },
    triggers: { onDemand: 'オンデマンド', onDemandDescription: 'プラットフォーム内の実行操作からのみ開始します。外部 API Key は生成されません。', schedule: 'スケジュール' },
    triggerTypes: { on_demand: 'オンデマンド', schedule: 'スケジュール', certificate_version_created: 'Certificate new-version event', retry: '失敗対象の再試行' },
    eventSources: { acme_issue: 'ACME 自動更新', manual_import: '手動インポート' },
    targetScopes: { allRelatedAssets: 'Update all related managed applications', allRelatedAssetsHelp: 'Resolve every bound and deployable managed application automatically after the event or filters match.', selectedAssets: 'Update selected managed applications only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for manually selected managed applications.' },
    assetPicker: { available: 'Available assets', selected: 'Selected assets', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No managed applications are available to add.', emptySelected: 'No managed applications selected yet.' },
    actionTypes: { create_deployment_plan: '証明書更新計画を作成', execute_deployment_plan: '証明書更新計画を実行', send_notification: '通知を送信' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: '最大 {count} 件' },
    preview: { title: '資産への影響プレビュー', description: '各行は 1 つの管理対象アプリケーションを表します。中央には現在の証明書の有効期限から選択した証明書の有効期限への変化を、右側には実行可否を表示します。', explanation: '影響分析では、各管理対象アプリケーションの現在の証明書の有効期限、対象証明書の有効期限、実行結果を表示します。', applicationAsset: 'アプリケーション資産', certificate: '証明書', applicationAssetId: 'アプリケーション資産 ID', bindingId: 'バインド ID', missingCurrentExplanation: '「日付なし → 対象日付」は、現在関連付けられている証明書の有効期限を読み取れないため更新できないことを示します。証明書の紐付けまたは現在の証明書情報を補完してください。', matched: '{count} 件一致', executable: '{count} 件実行可能', excluded: '{count} 件除外', affected: '{count} 件影響あり', upgrade: '{count} 件有効期限延長', same: '{count} 件同じ有効期限', skip: '{count} 件スキップ', downgrade: '{count} 件要確認', version: 'バージョン {version}', versionUnknown: 'バージョン不明', ready: '実行可能', skipUpdate: '更新をスキップ', expiryLabel: '有効期限', impact: { upgrade: '有効期限延長', same: '同じ有効期限', downgrade: '有効期限短縮のリスク', missing_current: '現在の証明書なし', unknown: '影響不明' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} managed applications involved', assetsResolvedAtRuntime: 'Target managed applications are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved assets', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: '対象への権限がありません', missing_version: '証明書バージョンがありません', version_not_deployable: '証明書バージョンをデプロイできません', binding_not_managed: 'バインディングが管理対象外です', environment_not_allowed: '環境が許可されていません', binding_missing: 'バインディングがありません', asset_missing_deployment_capability: '対象アセットは証明書をデプロイできません', certificate_version_downgrade: '対象バージョンが現在の資産より古いです', certificate_already_up_to_date: '対象の有効期限が現在の証明書と一致するため、更新をスキップします', filter_not_matched: 'フィルター条件に一致しません', runtime_context_required: '実行コンテキストが必要です', unknown: '不明な除外理由' },
    failureStages: { selection: '対象選択', plan_creation: '計画作成', dry_run: 'Dry run', approval: '承認', execution: '実行', verification: '検証', rollback: 'ロールバック', notification: '通知' },
    progress: { total: '合計', pending: '待機中', running: '実行中', waitingApproval: '承認待ち', succeeded: '成功', failed: '失敗', skipped: 'スキップ', cancelled: 'キャンセル済み' },
    editor: { createTitle: '自動化を作成', editTitle: '自動化を編集', description: '実行時期、対象証明書、計画の作成方法、失敗時の安全境界を設定します。', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot.', sections: { basic: '基本情報', basicHelp: '自動化の名前と、対象となる証明書変更を説明します。', trigger: 'Trigger', triggerHelp: 'Define what fact starts the automation before choosing execution and conditions.', targets: '処理する証明書', targetsHelp: '選択するのは証明書対象であり既存計画ではありません。実行開始時にスナップショットを固定します。', execution: 'Execution', executionHelp: 'Decide how the automation updates assets first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters and concurrency guardrails together in this step.', plan: '証明書デプロイ計画', planRelationTitle: '既存のデプロイ計画には紐付けません', planRelationDescription: '上の証明書条件から実行時に計画を作成します。', planRelationHelp: '対象ごとに固有の DeploymentPlan を作成し、計画 ID は実行詳細に表示します。', guardrails: '実行の安全制御', guardrailsHelp: 'バッチ数、事前チェック、失敗時の停止条件を制御します。' }, chain: { createPlan: '対象ごとに DeploymentPlan を作成', dryRun: '任意の Dry run プレビューを実行', executePlan: '対象の DeploymentPlan を実行' } },
    runs: { title: '自動化実行履歴', description: '実行単位の状態、不変の対象スナップショット、失敗段階を確認します。', progress: '{succeeded}/{total} 成功' },
    runDetail: { title: '自動化実行詳細', description: '設定バージョン {version}', noFailure: '失敗なし', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: '自動化対象プレビュー', runs: '自動化実行一覧', progress: '自動化実行進捗' },
    errors: { loadFailed: '自動化一覧の読み込みに失敗しました', applicationAssetsLoadFailed: 'Failed to load managed applications. Try again later.' }
  },
  routes: {
    certificateImport: '証明書をインポート',
    certificateDetail: '証明書詳細',
    certificateUsages: '使用関係',
    certificateFormats: '形式成果物'
  },
  businessPage: {
    request: {
      notRequested: 'まだリクエストしていません'
    },
    error: {
      unknown: '不明なエラー'
    },
    primaryActionFailed: '主操作の実行に失敗しました',
    processing: '処理中…',
    metricsAria: '業務指標',
    apiFailed: 'サービスリクエストに失敗しました',
    errorCode: 'エラーコード：{code}',
    retry: '再試行',
    resourceList: '{resource}一覧',
    total: '合計 {count}',
    toggleFilters: '絞り込み',
    all: 'すべて',
    clearFilters: 'フィルターをクリア',
    pagination: '{page} ページ / 1ページ {pageSize} 件',
    resourceDetailAria: 'リソース詳細',
    resourceDetailTitle: '{resource}詳細',
    contextAria: 'コンテキスト導線',
    resourceActionsAria: 'リソース操作',
    resourceActionsTitle: 'リソース操作',
    resourceActionsHint: '高リスク操作には二次確認が必要です。最終的にはシステムの権限検証に従います。'
  },
  executionDetail: {
    error: {
      loadStepsFailed: '実行ステップの照会に失敗しました',
      streamConnectFailed: '実行詳細更新接続に失敗しました'
    },
    step: {
      nameFallback: 'ステップ {index}',
      labels: {
        discover: 'デプロイ対象を検出',
        backup: '現在の証明書をバックアップ',
        install: '新しい証明書をインストール',
        reload: 'サービスを再読み込み',
        verify: '証明書を検証',
        rollback: '証明書をロールバック'
      },
      dryRunCheckSummary: '事前チェックの結論：合格 {passed} / 警告 {warning} / 失敗 {failed} / 不明 {unknown}。{topChecks}',
      dryRunPending: {
        queued: '現在もキュー内にあり、まだ実行を開始していません。',
        running: '現在のステップを実行中です。Agent から事前チェック結果が返るのを待っています。',
        failed: '現在のステップは失敗しましたが、事前チェック結果はまだ取得していません。',
        finished: '現在のステップは終了しましたが、事前チェック結果はまだ取得していません。'
      },
      dryRunDiscover: '読み取り専用事前チェック：識別デプロイターゲットと {providerLabel} サイト情報。サイト {siteName}、バインド {binding}。{pendingText}',
      dryRunVerify: '読み取り専用事前チェック：検証証明書マテリアル、ターゲットバインドとドメイン名一致。ターゲット {providerLabel} バインド {binding}。{pendingText}',
      dryRunCreated: '読み取り専用事前チェック作成済み。{pendingText}',
      workflowIdentity: '実行バージョン：プラグイン {plugin}；ワークフロー {workflow}',
      failure: {
          emptyMessage: '具体的なエラー情報を受信していません',
          issue: '分類 {category}、スロット {slot}、パス {path}、ソース {source}、修正箇所 {remediation}'
      },
      skipped: 'ステップをスキップしました：{reason}',
      running: {
        dispatched: 'Agent タスク（{taskId}）を配信しました。制御プレーンが結果を能動的に照会しています。',
        waitingAgentResult: 'ステップを実行中です。制御プレーンが Agent の結果を能動的に照会しています…',
        waitingExternalResult: 'ステップを実行中です。外部実行結果を待機しています…',
        resultUnconfirmed: '書き込み結果の確認が必要です：{code}：{message}。このステップは自動再実行されません。'
      },
      unknownResult: '書き込み結果が不明なため、自動再実行を停止しました。',
      diagnosticsTitle: '詳細な検証ログ',
      structuredDetail: '構造化された詳細を表示',
      pending: {
        waitingDependency: '前のステップが完了するまで待機しています。'
      },
      verifyRecovered: {
        detail: 'Agent 側リモート TLS プローブ失敗、ただし、システムは {remoteTarget} 実際の TLS 検証確認しターゲット証明書一致済み。{originalError}',
        originalSuffix: '原始 Agent エラー：{originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} が返されました。Agent taskId={taskId}',
        withoutTask: '{executor} {mode} が返されました。'
      },
      createdFallback: 'ステップ {index} を作成しました。実行詳細を待っています…'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run 実行に失敗しました',
        detail: '{failedStepCount} 個の事前チェックステップが失敗またはタイムアウトしました。構造化された事前チェックの結論は受信していません。'
      },
      queued: {
        label: 'Dry-run キュー待ち中',
        detail: '事前チェックタスクを作成しました。実行開始を待っています。'
      },
      running: {
        label: 'Dry-run 実行中',
        detail: '事前チェックを開始しました。結果が返るのを待っています。'
      },
      pending: {
        label: 'Dry-run は終了しましたが結論がありません',
        detail: '{finishedWithoutChecks} 個のステップが終了しましたが、事前チェックの結論は受信していません。'
      },
      receiving: {
        label: 'Dry-run 接收中',
        detail: '一部の結論を受信しました：合格 {passed}、警告 {warning}、失敗 {failed}、不明 {unknown}。'
      },
      failed: {
        label: 'Dry-run に失敗しました',
        detail: '事前チェック失敗 {failed} 件、警告 {warning} 件、合格 {passed} 件。'
      },
      tlsGrantRequired: {
        label: 'Dry-run は完了しましたが、ホスト認証が必要です',
        detail: '構造検証とセキュリティ検証は完了しました。Dry-run では正式な ExecutionGrant を発行しないため、TLS 検証スキップが拒否されました。正式実行時にホストが短期 ExecutionGrant を発行します。'
      },
      warning: {
        label: 'Dry-run 有リスク警告',
        detail: '事前チェック完了済み：合格 {passed} 件、警告 {warning} 件、不明 {unknown} 件。'
      },
      passed: {
        label: 'Dry-run に成功しました',
        detail: '事前チェック全部合格、共 {passed} 件。'
      }
    },
    agent: {
      taskSuffix: '（Agent taskId={taskId}）'
    },
    log: {
      verifyRecovered: '[ControlPlane] Agent 側リモート TLS プローブ失敗、但システム実際の TLS 検証確認しターゲット証明書一致。'
    },
    workflowStep: {
      failedDefault: 'ワークフローノード {index} 実行に失敗しました',
      skipped: 'ワークフローノード跳過済み、件件未満たしています。',
      successAssertions: 'ワークフローノード実行成功、断言合格 {passed}/{total}。',
      success: 'ワークフローノード実行成功。'
    },
    binding: {
      hostMissing: '未提供ホスト头（Host Header）'
    },
    site: {
      unnamed: '無名のサイト'
    },
    provider: {
      target: 'ターゲット'
    },
    recovery: {
      confirm: '証明書の状態を検証して続行',
      running: '証明書の状態を検証中…',
      confirmed: '対象証明書の有効化を確認しました。実行を続行します。',
      failed: '証明書検証に失敗したため、実行を停止しました。',
      pending: '対象証明書の状態を確認できません。後でもう一度お試しください。'
    }
  },
  executions: {
    title: '実行記録',
    description: 'デプロイ実行ステータス、ステップログ、dry-run 事前チェックの結論、失敗原因、ロールバック導線を表示します。',
    resourceName: '実行記録',
    errors: {
      streamConnectFailed: '実行詳細更新接続に失敗しました：HTTP {status}',
      loadFailed: '実行記録の読み込みに失敗しました'
    },
    actions: {
      refreshList: '更新一覧',
      refreshing: '更新中',
      viewDetail: '表示詳細',
      rollback: 'ロールバックを開始',
      rollbackRisk: 'ロールバックでは再度変更ターゲットサービス証明書設定、必ず確認バックアップ引用と影響範囲。'
    },
    messages: {
      recoveryConfirmed: '対象証明書の状態を確認しました。実行を続行します。グローバルタスク一覧で進捗を確認してください。',
      recoveryFailed: '証明書検証に失敗しました。詳細は実行ログに記録されています。',
      recoveryPending: '対象証明書の状態はまだ確認できません。タスクは確認待ちのままです。後で再試行してください。'
    },
    columns: {
      name: '実行番号',
      status: 'ステータス',
      risk: 'リスク',
      planId: 'デプロイプラン',
      startedAt: '開始時刻'
    },
    metrics: {
      total: {
        title: '実行合計',
        description: '現在可追踪の実行記録。'
      },
      risky: {
        title: '高リスク待処理',
        description: '失敗、部分成功または必要ロールバックの実行。'
      }
    },
    fields: {
      executionId: '実行 ID',
      deploymentPlan: 'デプロイプラン',
      runType: '実行タイプ',
      status: '実行ステータス',
      target: '実行ターゲット',
      externalRunId: '外部実行 ID',
      startedAt: '開始時刻',
      finishedAt: '終了時刻',
      errorCode: 'エラーコード',
      failureReason: '失敗原因'
    },
    links: {
      deploymentPlan: '表示デプロイプラン',
      auditEvents: '表示監査イベント'
    },
    empty: {
      title: '実行記録はまだありません',
      description: 'デプロイプラン実行後はここで表示ログ、ステータスと監査関連。'
    },
    list: {
      ariaLabel: '実行記録一覧',
      title: '実行記録一覧',
      summary: '{total} 件の実行記録を新しい順に表示します。',
      range: '{start}-{end} / {total}',
      assetsLabel: '資産',
      logLabel: 'ログ概要',
      runNumber: '{number} 回目',
      planUnknown: 'デプロイプラン未関連付け',
      assetUnknown: '資産未記録',
      timeUnknown: '開始時刻未記録',
      logRunning: '実行中です。詳細ログは継続して更新されます。',
      logPending: '実行はキューに入り、スケジュール待ちです。',
      logFailed: '実行に失敗しました。エラーコード: {code}',
      logSuccess: '実行に成功しました。所要時間 {duration}。',
      logCompleted: '実行は終了しました。詳細で完全なログを確認できます。',
      errorCodeUnknown: '未記録',
      durationUnknown: '不明',
      durationSeconds: '{count} 秒',
      durationMinutes: '{count} 分',
      viewDetailHint: '詳細を表示',
      openDetailAria: 'プラン {plan} の実行記録 {id} を表示',
      previousPage: '前へ',
      nextPage: '次へ',
      pageSummary: '{page} / {pages} ページ'
    },
    types: {
      dryRun: '事前チェック',
      apply: '本番実行',
      rollback: 'ロールバック',
      retry: '再試行',
      unknown: 'その他'
    },
    summary: {
      passed: '合格',
      warning: '警告',
      failed: '失敗',
      unknown: '不明'
    },
    detail: {
      title: '実行詳細',
      titleWithId: '実行詳細 {id}',
      description: '表示実行記録の基本情報、ステップステータスとログ。',
      eyebrow: '実行記録',
      planLabel: 'デプロイプラン {plan}',
      loadingSteps: '読み込みステップ中...',
      loadingLogs: '読み込みログ中...',
      noStepDetail: 'ステップ説明はまだありません',
      notStarted: '未開始',
      noSteps: 'ステップ。はまだありません',
      noLogs: 'ログはまだありません。',
      unknownResultDescription: '元のインストール操作は再実行しません。読み取り専用の TLS 証明書フィンガープリント検証のみを実行します。'
    },
    tabs: {
      summary: '概要',
      steps: 'ステップ',
      logs: 'ログ'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: '接続アドレス', connectionPort: '接続ポート', basePath: 'ベースパス', timeoutSeconds: 'タイムアウト秒数', gateway: '実行 Gateway',
      authenticationMode: '認証方式', credential: 'デバイス管理認証情報', username: 'ユーザー名', passwordSecret: 'パスワード SecretRef', apiTokenSecret: 'API トークン SecretRef', clientCertificate: 'クライアント証明書',
      tlsEnabled: 'HTTPS を有効化', tlsVerifyPeer: 'サーバー証明書を検証', tlsIgnoreCertificateErrors: '証明書エラーを無視', tlsServerName: 'TLS サーバー名', caSecret: 'CA SecretRef', tlsMinimumVersion: '最小 TLS バージョン',
      deviceDisplayName: 'デバイス表示名', deviceDescription: 'デバイス説明', deviceTags: 'デバイスタグ', targetName: 'ターゲット名', targetLabels: 'ターゲットラベル'
    },
    forms: { loadOptions: '選択肢を読み込む', previewTitle: 'プラグイン設定フォーム', loading: 'プラグインフォームを読み込み中...', loadFailed: 'プラグインフォームの読み込みに失敗しました', empty: 'このプラグインは設定フォームを宣言していません。' },
    presentation: { previewTitle: '標準デバイス表示プレビュー', sensitiveValue: '機密値は非表示です', tabsAriaLabel: 'デバイス情報タブ' },
    title: 'プラグイン',
    description: '管理プラグインパッケージ、Executor、権限宣言とサンドボックス隔離ステータス。',
    resourceName: 'プラグイン',
    actions: {
      install: 'インストールプラグイン',
      detail: '詳細',
      create: '作成',
      refresh: 'マーケットを更新',
      refreshing: '更新中...',
      createWorkflow: 'ワークフローを作成',
      creatingWorkflow: '作成中...',
      enable: '有効化',
      disabling: '無効化中...',
      disable: '無効化',
      disableRisk: '無効化プラグインは影響 Provider、テンプレートとExecutor機能。'
    },
    market: { eyebrow: 'DSL プラグインマーケット', title: '再利用可能な自動化機能を探す', description: '組み込みテンプレートはシステムに同梱され、ユーザーテンプレートは data/workflows から読み込まれます。各テンプレートで Logo、セマンティックバージョン、タグを管理できます。'},
    sources: { builtin: '組み込み', user: 'ユーザープラグイン' },
    statuses: { valid: '利用可能', invalid: '無効', available: '作成可能', enabled: '有効', disabled: '未有効化', pendingApproval: '承認待ち', inUse: '使用中', notInUse: '未使用' },
    filters: { searchLabel: 'プラグイン検索', searchPlaceholder: '名前、タグ、カテゴリ、パスで検索', allSources: 'すべての提供元', allStatuses: 'すべての状態', statusLabel: 'プラグイン状態' },
    card: { defaultDescription: 'この DSL プラグインには説明がありません。', unversioned: 'バージョン未設定', stepCount: '実行ステップ {count} 件', moreTags: 'ほか {count} 件' },
    columns: {
      name: 'プラグイン名前',
      status: 'ステータス',
      risk: 'リスク',
      version: 'バージョン',
      signature: '署名'
    },
    metrics: {
      total: {
        title: 'プラグイン合計',
        description: 'インストールとアップグレード可能なプラグイン済み。'
      },
      builtin: { title: '組み込みプラグイン' },
      user: { title: 'ユーザープラグイン' },
      enabled: { title: '有効化済みプラグイン' },
      using: { title: '使用中' },
      risky: {
        title: '高リスク待処理',
        description: '高リスク権限、署名異常またはサンドボックス隔離プラグイン。'
      }
    },
    empty: {
      title: 'プラグインはまだありません',
      description: 'インストール前確認してくださいプラグイン権限、署名とロールバックポリシー。'
    },
    detail: {
      title: 'プラグイン詳細',
      titleWithName: 'プラグイン {name}',
      description: '表示プラグイン詳細、権限宣言とサンドボックス隔離情報。',
      versionLabel: 'バージョン {version}'
    },
    types: { provider: 'クラウド Provider プラグイン', standard: '標準プラグイン' },
    fields: {
      pluginId: 'プラグイン ID',
      pluginType: 'プラグイン種別',
      provider: 'クラウドプロバイダー',
      name: 'プラグイン名前',
      currentStatus: '現在のステータス',
      version: 'バージョン',
      source: '提供元', category: 'カテゴリ', steps: '実行ステップ', rollbackSteps: 'ロールバックステップ', updatedAt: '更新日時', filePath: 'テンプレートパス', logoUrl: 'Logo URL', platforms: '対象プラットフォーム', updateMethods: '更新方法', maintainer: 'メンテナー', homepage: 'ホームページ', usage: '使用状態', validationError: '検証エラー',
      signatureStatus: '署名ステータス',
      riskLevel: 'リスク等级', runtime: 'ランタイム', executionMode: '実行モデル', scope: '適用範囲', support: 'サポートレベル', capabilities: 'ケイパビリティ', frameworks: '対象フレームワーク', products: '対応製品', operations: '対応操作'
    },
    labels: { permissions: '宣言された権限', runnerStatus: 'Runner の状態' },
    permissionKeys: {
      network_http: 'ネットワーク要求', secret_read: 'Secret の読み取り', artifact_read: '成果物の読み取り', device_write: 'デバイスへの書き込み',
      agent_execution_receipt: 'Agent 実行レシート', agent_fact_collect: 'Agent 情報収集', agent_plan_execute: 'Agent 計画実行', agent_plan_validate: 'Agent 計画検証',
      audit_append: '監査記録の追加', cloud_service_get: 'クラウドサービスの読み取り', execution_cancel_read: '実行キャンセル状態の読み取り', execution_checkpoint: '実行チェックポイント',
      execution_checkpoint_read: '実行チェックポイントの読み取り', execution_checkpoint_write: '実行チェックポイントの書き込み', execution_progress: '実行進捗', execution_progress_write: '実行進捗の書き込み',
      resource_lock: 'リソースロック', secret_resolve: 'Secret の解決'
    },
    runnerStatuses: { ready: 'Runner 準備完了', busy: 'Runner 実行中', unavailable: 'Runner 使用不可', notObserved: 'Runner 未観測' },
    capabilityKeys: {
      device_connection_test: '接続テスト', device_identity_detect: 'デバイス識別', device_discover: 'デバイス検出', device_logs_read: 'デバイスログ読み取り',
      certificate_discover: '証明書検出', certificate_deploy: '証明書デプロイ', certificate_rollback: '証明書ロールバック', certificate_verify: '証明書検証',
      application_discover: 'アプリケーション検出', ca_account_manage: 'CA アカウント管理', ca_order_manage: 'CA オーダー管理', ca_challenge_orchestrate: 'CA チャレンジ調整',
      ca_challenge_dns_solver: 'CA DNS チャレンジ解決', ca_certificate_issue: 'CA 証明書発行', ca_certificate_renew: 'CA 証明書更新', ca_certificate_revoke: 'CA 証明書失効',
      cloud_service_connection_test: 'クラウドサービス接続テスト', cloud_service_discover: 'クラウドサービス検出', credential_health_check: '資格情報の有効性チェック'
    },
    unknownCatalogValue: '不明なカタログ値: {value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: 'カスタムランタイム', runtime_custom: 'カスタムランタイム', adc_load_balancer: 'ADC ロードバランサー', cloud_aliyun_cdn: 'Alibaba Cloud CDN', cloud_aliyun_alb: 'Alibaba Cloud ALB', cloud_aliyun_clb: 'Alibaba Cloud CLB', cloud_aliyun_oss: 'Alibaba Cloud OSS', cloud_aliyun_waf_cname: 'Alibaba Cloud WAF CNAME', cloud_aliyun_waf_cloud: 'Alibaba Cloud WAF Cloud', cloud_aliyun_live: 'Alibaba Cloud Live', cloud_aliyun_vod: 'Alibaba Cloud VOD', cloud_tencent_cdn: 'Tencent Cloud CDN', cloud_tencent_clb: 'Tencent Cloud CLB', cloud_tencent_live: 'Tencent Cloud Live', cloud_huawei_cdn: 'Huawei Cloud CDN', cloud_huawei_elb: 'Huawei Cloud ELB', cloud_volcengine_cdn: 'Volcengine CDN', cloud_volcengine_alb: 'Volcengine ALB', cloud_volcengine_clb: 'Volcengine CLB', cloud_volcengine_live: 'Volcengine Live', cloud_volcengine_vod: 'Volcengine VOD' },
    runtimeTypes: { agent_atomic: 'Agent 原子実行', workflow_dsl: 'ワークフロー DSL' },
    scopeTypes: { managed: '管理対象', standalone: 'スタンドアロン対象', both: '管理対象 / スタンドアロン' },
    supportTypes: { official: '公式サポート', community: 'コミュニティサポート', self_managed: '自己管理' },
    aria: { filters: 'プラグインマーケットのフィルター', list: 'DSL プラグイン一覧', logo: '{name} の Logo' },
    errors: { loadFailed: 'プラグインマーケットの読み込みに失敗しました', createFailed: 'プラグインからワークフローを作成できませんでした' },
    agentDeployment: {
      mount: 'Agent にマウント', mounting: 'マウント中...', selectAgent: '対象 Agent を選択', type: 'プラグイン種別', targetAgent: '対象 Agent', mountFailed: 'Agent プラグインのマウントに失敗しました',
      executionMode: 'Agent 実行モード', nativeHandler: 'ネイティブハンドラー', pluginMode: 'Agent プラグイン', mountedPlugin: 'マウント済みプラグイン', selectMountedPlugin: 'マウント済みプラグインを選択',
      plugin: 'デプロイプラグイン', selectPlugin: 'デプロイプラグインを選択', noCompatiblePlugin: '現在のプラットフォームとフレームワークに一致する有効なプラグインがありません', compatiblePluginHint: '資産のプラットフォームとフレームワークに一致する有効なプラグインのみ表示します。',
      secretRefPlaceholder: 'SecretRef 識別子を入力', artifactBinding: '証明書成果物 {name}', artifactBindingPlaceholder: '例: value=fullchain,key=private', preview: 'プラグイン設定を検証', previewFailed: 'Agent プラグイン設定の検証に失敗しました',
      approveAndEnable: '権限を承認して有効化', activating: '有効化中...', activateFailed: 'Agent プラグインの承認または有効化に失敗しました', disableFailed: 'Agent プラグインの無効化に失敗しました',
      types: { WORKFLOW_TEMPLATE: 'ワークフローテンプレート', UNIFIED_PLUGIN: '統合ケイパビリティプラグイン' }
    },
    changeSummaries: { createWorkflow: 'プラグインマーケットのテンプレートからワークフローを作成' }
  },
  deploymentPlans: {
    userView: {
      stepLabel: 'Step 3 of 3 · Deploy',
      title: 'Deploy the certificate to an application',
      description: 'Choose a certificate and a connected application. GCAC keeps preview and execution safeguards in the background.',
      createAction: 'Start deployment',
      listTitle: 'Deployment tasks',
      listDescription: 'Only the next action and business status are shown here.',
      loadFailed: 'Failed to load deployment tasks',
      emptyTitle: 'No deployment task yet',
      emptyDescription: 'Create the first deployment task after adding an application.',
      unnamedPlan: 'Unnamed deployment task',
      pendingCertificate: 'Certificate pending',
      pendingApplication: 'Application pending',
      nextActionHint: 'The next action follows the current preview and execution status.',
      prepareAction: 'Prepare deployment',
      waiting: 'Waiting for execution'
    },
    title: 'デプロイプラン',
    description: 'プランのプレビュー、影響範囲、実行バッチ、検証、ロールバック導線を扱います。',
    resourceName: 'デプロイプラン',
    apiActions: {
      submit: '送信デプロイプラン',
      execute: '実行デプロイプラン',
      cancel: 'キャンセルデプロイプラン',
      delete: '削除デプロイプラン'
    },
    actions: {
      create: '作成デプロイプラン',
      detail: '詳細',
      edit: '編集プラン',
      dryRun: 'Dry-run 影響プレビュー',
      dryRunRisk: 'のみ生成影響プレビュー、しません実行正式デプロイ。',
      submit: '計画を送信',
      submitRisk: '送信後プランは待実行ステータス。',
      execute: '実行デプロイ',
      executeRisk: '実行すると対象の証明書設定が変更されます。完了済みまたは失敗したプランの再実行にもこの導線を使用します。実行時に必要な同期事前チェックを行い、資産詳細の証明書デプロイから任意の Dry-run プレビューを実行できます。',
      cancel: 'キャンセルプラン',
      cancelRisk: '未完了のデプロイプランのみキャンセルします。完了済みのデプロイはロールバックされません。',
      rollback: 'ロールバック実行',
      rollbackRisk: 'ロールバックでは再度変更ターゲットサービス証明書設定、必ず使用実際の runId。',
      delete: '削除プラン',
      deleteRisk: '永久削除プラン、デプロイターゲット、実行記録と对応監査履歴、不可恢复。'
    },
    columns: {
      name: 'プラン名前',
      status: 'ステータス',
      currentAssetCertificateExpiresAt: '現在証明書終了時刻',
      updateNeeded: '必要更新',
      scheduledAt: 'プラン時刻',
      actions: '操作'
    },
    metrics: {
      total: {
        title: 'プラン合計',
        description: '実行待ちまたは実行中のプランです。'
      },
      risky: {
        title: '高リスク待処理',
        description: '影響生産サービスまたは不足ロールバック機能のプラン。'
      }
    },
    fields: {
      planId: 'プラン ID',
      name: 'プラン名前',
      status: 'プランステータス',
      certificateVersionId: '証明書バージョン ID',
      certificateFormatId: '証明書形式設定 ID',
      workflowDslVersion: 'ワークフロー DSL バージョン',
      currentAssetCertificateExpiresAt: '現在証明書終了時刻',
      updateNeeded: '必要更新',
      targetSummary: 'ターゲットバインドサマリー',
      latestRun: '最新実行批回',
      snapshotHash: 'スナップショット Hash',
      failureReason: '失敗原因',
      createdAt: '作成時刻',
      updatedAt: '更新時刻'
    },
    links: {
      executions: '表示実行記録',
      bindings: '表示相関バインド'
    },
    empty: {
      title: 'デプロイプランはまだありません',
      description: '先から証明書またはバインド開くデプロイ向導、生成影響プレビュー後再送信プラン。'
    },
    disabled: {
      needDryRun: 'Dry-run は証明書、ドメイン、対象互換性のチェック結果を確認する任意の影響プレビューです。',
      missingRunId: ' runId、できませんロールバック。が不足しています',
      missingSelection: 'デプロイプラン選択が不足しています'
    },
    common: {
      cancel: 'キャンセル',
      close: '閉じる',
      notConfigured: '未設定',
      notProvided: '未提供'
    },
    detail: {
      certificateVersionLabel: '証明書バージョン',
      description: 'プランの基本情報、関連レコード、直近の実行結果を表示します。',
      emptyRelatedRecords: '関連記録。はまだありません',
      loadingRelatedRecords: '読み込み関連記録中...',
      noExecutionRecords: '現在プランまだありません実行記録。',
      inputSourcesLoadFailed: 'デプロイ入力ソースの読み込みに失敗しました',
      inputSourcesTitle: 'デプロイ入力ソース',
      inputSource: 'ソース：{source}',
      inputSourceTarget: 'デプロイ対象：{targetId}',
      noInputSources: 'この計画には表示可能な変数ソースがありません。',
      noTargetSummary: '未提供ターゲットサマリー',
      workflowIdentityTitle: 'ワークフロー実行 ID',
      workflowMode: 'ユーザーワークフロー',
      workflowModePluginInternal: 'プラグイン内蔵ワークフロー',
      workflowDslVersion: '実際の DSL バージョン：{version}',
      workflowPluginVersion: '実際のプラグインバージョン：{version}',
      workflowPluginVersionId: 'プラグインバージョン ID：{versionId}',
      workflowVersionId: 'バージョンスナップショット ID：{versionId}',
      workflowVersionSelectionPinned: 'バージョンポリシー：計画で固定',
      workflowVersionSelectionLatest: 'バージョンポリシー：アプリケーション資産の最新公開版',
      workflowIdentityUnavailable: 'ワークフローバージョン情報を取得できません',
      planIdLine: 'プラン ID {planId}',
      recordKinds: {
        certificateUpdate: '証明書更新',
        dryRun: 'Dry-run'
      },
      relatedPlan: 'プラン {planId}',
      relatedRun: '実行 {runId}',
      relatedSource: 'ソース {source}',
      tabs: {
        latestExecution: '直近実行',
        relatedRecords: '関連記録',
        summary: '概要'
      },
      targetLabel: 'ターゲット',
      title: 'デプロイプラン詳細',
      titleWithName: 'デプロイプラン {name}',
      viewLogs: '表示ログ'
    },
    dryRunRequired: {
      copy: '現在の操作：{action}。Dry-run は任意の影響プレビューであり、正式実行をブロックしません。',
      description: '同期 Dry-run で静的チェックを確認できます。正式実行時には必要な事前チェックを再度行います。',
      primaryAction: 'Dry-run を実行',
      runningAction: 'Dry-run を実行中…',
      title: '任意の Dry-run プレビュー'
    },
    execution: {
      applyName: 'デプロイ実行 {runId}',
      applyTitle: '証明書更新実行',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Dry-run 結果',
      fallbackName: '実行 {runId}',
      rollbackTitle: '証明書ロールバック実行',
      startingName: '実行を開始中'
    },
    feedback: {
      cancelled: 'デプロイプランキャンセル済み。',
      cancelledWithPlanId: 'デプロイプランキャンセル（プラン {planId}）済み。',
      deleted: 'デプロイプラン削除済み。',
      deletedWithPlanId: 'デプロイプラン削除（プラン {planId}）済み。',
      dryRunStartedMissingRunId: '事前チェックを開始しました。',
      dryRunStartedWithRunId: '事前チェックを開始しました（{runId}）。ダイアログで進行状況を確認してください。',
      dryRunTriggered: '事前チェック触発済み。',
      dryRunTriggeredWithPlanId: '事前チェック触発（プラン {planId}）済み。',
      dryRunTriggeredWithRunId: '事前チェックをトリガーしました（{runId}）。ダイアログで進行状況を確認してください。',
      dryRunTaskStarted: 'Dry-run を開始しました。右上のタスクリストで進行状況を確認できます。',
      executeTriggered: 'デプロイ触発済み。',
      executeTriggeredWithPlanId: 'デプロイ触発（プラン {planId}）済み。',
      executeTriggeredWithRunId: 'デプロイをトリガーしました（{runId}）。ダイアログで進行状況を確認してください。',
      executionTaskStarted: 'タスクを開始しました。右上のタスクリストで進行状況を確認できます。',
      executionTaskSucceeded: 'タスクが正常に完了しました。結果は右上のタスクリストで確認できます。',
      executeTaskStarted: '証明書デプロイを開始しました。右上のタスクリストで進行状況を確認できます。',
      rollbackTaskStarted: '証明書ロールバックを開始しました。右上のタスクリストで進行状況を確認できます。',
      loadedDraft: '読み込みドラフトプラン済み。',
      loadedDraftWithPlanId: '読み込みドラフト（プラン {planId}）済み。',
      savedWithPlanId: 'プラン保存済み（{planId}）。',
      submitted: 'デプロイプラン送信済み。',
      submittedWithPlanId: 'デプロイプラン送信（プラン {planId}）済み。',
    },
    target: {
      controlPlane: 'プラットフォーム',
      noBindingInfo: 'バインド情報が指定されていません',
      noCertificateVariables: '証明書変数がバインドされていません',
      noHostHeader: '未提供ホスト头（Host Header）',
      noOutputSelected: '出力項目が未選択です'
    },
    errors: {
      actionFailed: '{action}に失敗しました',
      createReturnedMissingPlanId: 'プランは作成されましたが、番号を取得できませんでした。一覧を更新してください。',
      loadCreateDataFailed: 'デプロイプラン作成データの読み込みに失敗しました',
      loadRelatedRecordsFailed: '関連記録の読み込みに失敗しました',
      missingApplicationAssetIdForDryRun: 'アプリケーションアセットが不足しているため、事前チェックを開始できません。',
      missingApplicationAssetIdForSave: 'アプリケーションアセット、できません保存プラン。が不足しています',
      missingPlanId: 'プラン番号が不足しています。再選択してください。',
      missingPlanIdForAction: '{action}に失敗しました：プラン番号が不足しています。再選択してください。',
      missingRunIdRequest: '実行番号が不足しています。再選択してください。',
      saveFailed: 'デプロイプランの保存に失敗しました',
      startDryRunFailed: 'dry-run の開始に失敗しました',
      inputIssuesHint: '表示されたスロットとバインディング層の入力を修正して再試行してください。'
    }
  },
  agents: {
    actions: {
      close: '閉じる',
      delete: '削除',
      deleteRisk: '削除では直接削除 Agent 記録、この操作元に戻せません。',
      detail: '詳細',
      disable: '無効化',
      disableRisk: '無効化後この Agent 停止接收新タスク。',
      enable: '有効化',
      enableRisk: '有効化後この Agent 恢复として可スケジューリングステータス。'
    },
    app: {
      fallbackName: 'アプリケーション {index}'
    },
    certificate: {
      boundCertificate: 'サイトバインド証明書',
      expiredDays: '期限切れ {days} 日',
      expiresToday: '本日付限切れ',
      modalDescription: '表示現在サイトバインド使用の証明書キー情報。',
      modalTitle: '証明書詳細',
      overviewDescription: '表示証明書名、発行者、開始時刻、期限切れ日時とフィンガープリント等キー情報。',
      overviewTitle: '証明書概要',
      projectDetailDescription: 'で現在 Agent 詳細上下文中表示件目内証明書アセット詳細と関連使用関係。',
      projectDetailTitle: '本件目証明書詳細',
      querying: '照会中...',
      remainingDays: '残り {days} 日',
      remainingWithViewAction: '{remaining} / クリック表示証明書',
      statusExpired: '期限切れ',
      statusExpiring: '期限切れ間近',
      statusLabel: '証明書ステータス',
      statusUnknown: '有効期間不明',
      statusValid: '有効',
      view: '表示証明書',
      viewProjectDetail: '表示本件目証明書詳細'
    },
    // 兼容旧版本证书卡片的翻译 key，避免已缓存 bundle 在升级后产生缺失告警。
    statusBlock: {
      tooltip: { name: '名前', issuer: '発行者', startTime: '開始時間', endTime: '終了時間', daysRemaining: '残り日数', connectionStatus: '接続状態', version: 'バージョン', managementAddress: '管理アドレス', lastCommunicationTime: '最終通信', platform: 'アプリプラットフォーム', protocolPort: 'プロトコルとポート', certificateDaysRemaining: '証明書残り日数', region: 'リージョン', latency: '遅延' },
      detail: {
        certificateRemaining: '{name}、{days}'
      }
    },
    certificateUsage: {
      iisSite: 'Agent IIS サイト',
      linuxSite: 'Agent Linux サイト',
      tomcatConnector: 'Agent Tomcat 接続器'
    },
    columns: {
      actions: '操作',
      hostname: 'ホスト名',
      ipAddress: 'IP アドレス',
      lastHeartbeat: '直近ハートビート',
      onlineStatus: 'オンラインステータス',
      osType: 'システムタイプ',
      version: 'バージョン'
    },
    common: {
      defaultAddress: 'デフォルトアドレス',
      no: '否',
      noHostHeader: '無 Host Header',
      noListenAddress: '無リッスンアドレス',
      none: '無',
      notConfigured: '未設定',
      notProvided: '未提供',
      notWritable: '不可写',
      unrecognized: '未識別',
      writable: '可写',
      yes: '是'
    },
    detail: {
      loading: '詳細読み込み中...',
      manualRescan: '手動再スキャン',
      manualRescanCannotPullTasks: '現在の Agent はタスクを取得できないため、再スキャンを実行できません',
      manualRescanCreated: '手動再スキャンタスクを作成しました。Agent による取得と実行を待っています。',
      manualRescanSubmitting: '再スキャンを送信中...',
      manualRescanUnsupportedType: '現在の Agent タイプは手動再スキャンに対応していません',
      modalDescription: '表示 Agent の主要情報、実行環境および IIS サイト情報。',
      modalTitle: 'Agent詳細',
      nodeEyebrow: 'Agent ノード',
      tabsAriaLabel: 'Agent 詳細タブ'
    },
    empty: {
      description: 'クリック右上“インストールAgent”、選択プラットフォームとバージョン後生成一度限りのインストールコマンド。',
      noFrameworkSites: '未検出 {name} サイト',
      noIisSites: '未検出 IIS サイト',
      noRuntimeLogs: '実行ログはまだありません',
      noTomcatApps: '未検出 Tomcat アプリケーション',
      noTomcatConnectors: '未検出 Tomcat 接続器',
      title: ' Agentはまだありません'
    },
    errors: {
      certificateAssetIncomplete: '証明書アセットデータ不完全な、できません跳转詳細。',
      certificateAssetNotFound: '本件目中未找へ对応証明書アセット。',
      certificateAssetQueryFailed: '証明書アセットの照会に失敗しました。',
      detailDataMissing: '詳細情報を取得できませんでした。',
      generateInstallCommandFailed: 'インストールコマンドを生成失敗。',
      installCommandMissing: 'システム未戻るインストールコマンド。',
      loadDetailFailed: '読み込み詳細失敗。',
      manualRescanFailed: '手動再スキャンの開始に失敗しました。'
    },
    fields: {
      agentVersion: 'Agent バージョン',
      appCount: 'アプリケーション数',
      appList: 'アプリケーション一覧',
      appPool: 'アプリケーション程序池',
      arch: 'システム架构',
      binaryPath: '二进制パス',
      certificateFile: '証明書ファイル',
      certificateName: '証明書名',
      certificateStore: '証明書仓庫',
      certificateSubject: '証明書主题',
      certificateThumbprint: '証明書フィンガープリント',
      configFile: '設定ファイル',
      configPath: '設定パス',
      connectorCount: '接続器数',
      connectorList: '接続器一覧',
      domain: 'ドメイン名',
      frameworkVersion: '{name} バージョン',
      healthStatus: '正常ステータス',
      healthSummary: '異常サマリー',
      hostname: 'ホスト名',
      httpsBinding: 'HTTPS バインド',
      httpsListen: 'HTTPS リッスン',
      iisVersion: 'IIS バージョン',
      installPrefix: 'インストール前缀',
      installStatus: 'インストールステータス',
      ipAddress: 'IP アドレス',
      issuer: '発行者',
      lastCapabilityReportAt: '上回機能報告時刻',
      lastHeartbeat: '直近ハートビート',
      lastRecoveryAt: '直近恢复時刻',
      lastReportAt: '直近報告時刻',
      linuxDistribution: 'Linux 発行版',
      listenAddress: 'リッスンアドレス',
      notAfter: '期限切れ日時',
      notBefore: '開始時刻',
      offlineDetected: '判定オフライン済み',
      osType: 'システムタイプ',
      osVersion: '操作システムバージョン',
      patchVersion: 'パッチバージョン',
      privateKeyOrKeystore: '秘密鍵 / Keystore',
      proxyTarget: 'プロキシターゲット',
      remainingDays: '残り日数',
      role: 'ロール',
      runningStatus: '実行ステータス',
      runtimeLog: '実行ログ',
      serviceName: 'サービス名',
      sha256Fingerprint: 'SHA-256 フィンガープリント',
      siteCount: 'サイト数',
      siteList: 'サイト一覧',
      tlsConnector: 'TLS コネクター',
      tomcatVersion: 'Tomcat バージョン',
      zone: 'ゾーン'
    },
    health: {
      degraded: '劣化',
      failed: '失敗',
      healthy: '正常',
      unknown: '不明'
    },
    install: {
      bootstrapToken: 'インストールコード',
      command: 'インストールコマンド',
      commandStepTitle: 'インストールコマンドを生成',
      commandCopied: 'インストールコマンドコピー済み',
      copyCommand: 'インストールコマンドをコピー',
      copyToken: 'インストールコードをコピー',
      expired: '期限切れ',
      generateCommand: 'インストールコマンドを生成',
      generating: '生成中...',
      compatibilityInstallUnavailable: 'Windows Compatibility Agent のワンタイムインストーラーはまだ公開されていません。Windows Modern Agent のコマンドで代用しないでください。',
      installEntryPending: 'インストーラー準備中',
      linuxGeneralTitle: 'Linux 共通 Agent',
      linuxGroupTitle: 'Linux',
      modalDescription: '選択プラットフォームとバージョン、生成一度限りのインストールコマンド。インストールコード 10 分内有効、かつ1 回だけ使用できます。',
      modalTitle: 'インストール Agent',
      platform: 'プラットフォーム',
      platformLinuxDescription: 'Ubuntu、Debian、CentOS、Rocky、AlmaLinux 等 Linux 発行版。',
      platformWindowsDescription: 'Windows Server と Windows 10/11、インストール後システムサービスとして登録。',
      remainingTime: '{minutes}分 {seconds}秒',
      remainingValidity: '残り有効期間',
      selectedAgent: '選択中の Agent',
      selectionStepTitle: 'Agent タイプを選択',
      singleUseHint: '同じインストールコードで bootstrap スクリプトがリクエストされると、ただちに失効し、再利用できません。',
      tokenCopied: 'インストールコードコピー済み',
      version: 'バージョン',
      versionLatest: '最新安定版',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 以降',
      windowsModernTitle: 'Windows Modern Agent',
      zone: 'ゾーン'
    },
    labels: {
      certificatePath: '証明書：{value}',
      deployDirectory: 'デプロイディレクトリ：{value}',
      directory: 'ディレクトリ：{value}',
      keystorePath: 'Keystore：{value}',
      listenAddress: 'リッスンアドレス：{value}',
      path: 'パス：{value}',
      privateKeyPath: '秘密鍵：{value}',
      reloadCommand: 'Reload コマンド：{value}',
      siteName: 'サイト名前：{value}',
      taskType: 'タスクタイプ：{value}',
      testCommand: '測試コマンド：{value}',
      thumbprint: 'フィンガープリント：{value}'
    },
    linux: {
      certDirectoryWritable: '証明書ディレクトリ：{status}',
      helperRequired: '必要 helper',
      keyDirectoryWritable: '秘密鍵ディレクトリ：{status}',
      permissionMode: '権限モード：{mode}'
    },
    logs: {
      collapse: '折りたたむ',
      expand: '展開',
      listAriaLabel: '実行ログ一覧'
    },
    metrics: {
      abnormalDescription: 'オフライン、失敗またはドリフトステータスの Agent 必要優先処理。',
      abnormalTitle: '異常 Agent',
      totalDescription: '現在登録済みへシステムの Agent 数。',
      totalTitle: 'Agent 合計'
    },
    page: {
      description: '表示 Agent 一覧、生成異なるプラットフォームのインストールコマンド、かつでダイアログ中表示詳細。',
      installAgent: 'インストールAgent'
    },
    sections: {
      frameworkOverviewDescription: '宿ホスト上の {name} インストールステータス、実行ステータスと設定場所。',
      frameworkOverviewTitle: '{name} 概况',
      frameworkSitesDescription: '{name} 識別へのサイト、根ディレクトリ、ドメイン名、反向プロキシターゲットと証明書ファイルパス。',
      frameworkSitesTitle: '{name} サイト',
      healthDescription: 'システム对 Agent のオフライン判断、恢复時刻と実行正常サマリー。',
      healthTitle: '正常と恢复',
      iisOverviewDescription: '宿ホスト上の IIS インストールステータスとバージョン情報。',
      iisOverviewTitle: 'IIS 概况',
      iisSitesDescription: 'IIS 網站一覧、サイトパス、バインドポートおよび証明書主题名。',
      iisSitesTitle: 'IIS サイト',
      logOverviewDescription: '直近直近の機能報告時刻、機能情報の判断に使用するの鮮度。',
      logOverviewTitle: 'ログ概要',
      mainInfoDescription: 'Agent ID、ロールとハートビートステータス。',
      mainInfoTitle: '主要情報',
      runtimeDescription: 'Agent 報告の実行システムとバージョン情報。',
      runtimeLogsDescription: '手動再スキャン結果、ハートビート異常および機能報告中断等実行ログ。',
      runtimeLogsTitle: '実行ログ',
      runtimeTitle: '実行環境',
      tomcatAppsDescription: 'Tomcat Host/Context 中識別へのアプリケーションパスとデプロイディレクトリ。',
      tomcatAppsTitle: 'Tomcat アプリケーション',
      tomcatConnectorsDescription: 'Tomcat Connector のリッスンアドレス、プロトコル、TLS 开関と証明書パス。',
      tomcatConnectorsTitle: 'Tomcat 接続器',
      tomcatOverviewDescription: '宿ホスト上の Tomcat インストールステータス、実行ステータスと Catalina パス。',
      tomcatOverviewTitle: 'Tomcat 概况'
    },
    site: {
      domainCount: '{count} 個ドメイン名',
      fallbackName: 'サイト {index}'
    },
    siteMode: {
      reverseProxy: '反向プロキシ',
      staticRoot: '静態サイト'
    },
    status: {
      installed: 'インストール済み',
      notInstalled: '未インストール',
      notRunning: '未実行',
      running: '実行中'
    },
    tabs: {
      logs: 'ログ',
      overview: '概要'
    }
  },
  dashboard: {
    overview: {
      eyebrow: '運用概要'
    },
    resources: {
      title: 'システムリソース', description: 'ダッシュボードホストの CPU とメモリのリアルタイム使用率です。', cpu: 'CPU 使用率', memory: 'メモリ使用率', host: 'ホスト', abnormal: '要確認', usageAria: '{metric}使用率 {value}%', unavailableAria: '{metric}は利用できません'
    },
    quickStart: {
      title: 'ここからすぐに始める', description: '証明書の準備をすばやく完了し、アプリケーションへ配布します。', addCertificate: '証明書をインポートまたは申請', deployExistingApplication: 'Web サイトまたはアプリケーションへ配布', unavailable: '利用可能な入口なし', safeExecution: '安全な実行', guidedFlow: 'ガイド付きフロー'
    },
    trends: {
      title: '実行トレンド', noDelta: '--', auditSuccess: { title: '監査成功率', suffix: '成功率' }, managedObjects: { title: 'オブジェクト健全性', suffix: '正常なオブジェクト' }, certificateAttention: { title: '証明書の要確認', suffix: '確認対象' }
    },
    statusPanel: { description: '証明書、Agent、ゲートウェイ、アプリ資産の現在の表示状態。', objects: 'オブジェクト' },
    recentLog: { title: '最近のログ', live: 'ライブ' },
    aria: {
      assetHeatmap: '資産ステータスのヒートマップ',
      certificateStatusList: '証明書ステータス一覧',
      metrics: '核心指標',
      quickActions: '主要機能への導線',
      statusHeatmap: '資産ステータス',
      statusLegend: 'ステータス图例'
    },
    assets: {
      groupCount: '{summary} · {total} 個',
      title: '資産ステータス',
      updatedAt: '更新于 {time}'
    },
    audit: {
      description: '優先表示失敗、拒否、高リスクとキー業務変更。',
      title: '直近監査ログ',
      activityTitle: '監査アクティビティ'
    },
    certificateState: {
      critical: '期限切れ間近',
      expired: '期限切れ',
      expiring: '期限切れ間近',
      unknown: '不明',
      valid: '正常',
      updateAvailable: '更新可能'
    },
    days: {
      expired: '期限切れ {days} 日',
      expiresToday: '本日付限切れ',
      notRecorded: '未記録',
      remaining: '{days} 日'
    },
    empty: {
      noAuditLogs: '監査ログはまだありません',
      noCertificateStatus: '証明書ステータスデータはまだありません',
      noObjects: 'オブジェクトはまだありません',
      noTrend: '傾向データはありません',
      noQuickActions: '利用可能なクイック入口はありません'
    },
    errors: {
      loadFailed: '概要データの読み込みに失敗しました',
      missingOverviewData: '概要情報を取得できませんでした。'
    },
    legend: {
      disabled: '無効化',
      error: '異常',
      ok: '正常',
      unknown: '不明',
      warning: '関注'
    },
    loading: {
      description: '読み込み概要情報中…',
      title: '読み込み中'
    },
    metrics: {
      attention: '要確認',
      sparklineLabel: '{metric}の傾向',
      stable: '安定',
      tracked: '追跡中',
      activeAgents: {
        title: 'アクティブ Agent 数',
        description: '現在オンラインかつスケジューリングの Agent。'
      },
      activeGateways: {
        title: 'アクティブゲートウェイ数',
        description: '現在オンラインの隔離ゾーンゲートウェイ。'
      },
      applications: {
        title: '現在アプリケーション数',
        description: '管理対象になっているアプリケーションエントリアセットです。'
      },
      expiringCertificates: {
        title: '15 日内期限切れ証明書',
        description: '必要安排継期または替换の証明書。'
      },
      managedBindings: {
        title: '管理対象バインド数',
        description: '開く管理対象ステータスの証明書バインド済み。'
      },
      validCertificates: {
        title: 'アクティブ証明書数',
        description: 'ステータスアクティブかつまだ期限切れの証明書バージョン。'
      }
    },
    health: {
      title: 'システムの健全性',
      description: '証明書、Agent、ゲートウェイ、アプリ資産の状態を集計します。',
      healthy: '正常',
      attention: '要確認',
      abnormal: '異常',
      noData: 'データなし',
      score: '正常なオブジェクト',
      progressAria: '正常なシステムオブジェクトの割合',
      normalObjects: '正常なオブジェクト',
      attentionObjects: '確認が必要なオブジェクト'
    },
    quickWizard: {
      title: 'クイックアクセス'
    },
    typeStats: {
      title: 'オブジェクト種別',
      description: '現在表示可能なオブジェクトの種別ごとの分布。'
    },
    quickActions: {
      agents: {
        title: 'アセット',
        description: 'Agent が管理するアセットとデプロイ状態を確認します。'
      },
      assets: {
        title: 'アプリケーションアセット',
        description: '維護ドメイン名、ポートとデプロイターゲット。'
      },
      audits: {
        title: '監査ログ',
        description: '追踪操作人と実行結果。'
      },
      certificates: {
        title: '証明書管理',
        description: 'インポート、表示と转换証明書。'
      },
      deploymentPlans: {
        title: 'デプロイプラン',
        description: '作成と実行証明書更新プラン。'
      },
      gateways: {
        title: 'ゲートウェイ',
        description: '隔離ゾーンの実行導線を管理します。'
      }
    },
    statusBlock: {
      tooltip: { name: '名前', issuer: '発行者', startTime: '開始時間', endTime: '終了時間', daysRemaining: '残り日数', connectionStatus: '接続状態', version: 'バージョン', managementAddress: '管理アドレス', lastCommunicationTime: '最終通信', platform: 'アプリプラットフォーム', protocolPort: 'プロトコルとポート', certificateDaysRemaining: '証明書残り日数', region: 'リージョン', latency: '遅延' },
      detail: {
        certificateRemaining: '{name}、{days}'
      },
      status: {
        active: 'アクティブ',
        critical: '期限切れ間近',
        deleted: '削除済み',
        disabled: '無効化',
        expired: '期限切れ',
        expiring: '期限切れ間近',
        inactive: '不アクティブ',
        offline: 'オフライン',
        online: 'オンライン',
        retired: '退役済み',
        revoked: '吊销済み',
        stale: '期限切れ未更新',
        unknown: '不明',
        unreachable: '不へ達可能',
        upgrading: 'アップグレード中',
        valid: '正常'
      }
    },
    statusGroups: {
      assets: {
        title: 'アセット'
      },
      agents: {
        title: 'デバイス'
      },
      applicationAssets: {
        title: 'アプリケーションアセット'
      },
      certificates: {
        title: '証明書'
      },
      gateways: {
        title: 'ゲートウェイ'
      },
      summary: {
        allNormal: '全部正常',
        needsAttention: '{count} 個必要関注'
      }
    },
    table: {
      bindings: 'バインド',
      certificate: '証明書',
      domain: 'ドメイン名',
      notAfterMissing: '未記録期限切れ日時',
      remainingTime: '残り時刻',
      status: 'ステータス'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: '追加 Gateway agent',
      close: '閉じる',
      copied: 'コピー済み',
      copyEnableCommand: 'コピー有効化コマンド',
      copyInstallCommand: 'インストールコマンドをコピー',
      detail: '詳細',
      enableExistingAgent: '既存 Agent 有効化 Gateway',
      generateEnableCommand: '生成有効化コマンド',
      generateInstallCommand: 'インストールコマンドを生成',
      generating: '生成中...',
      probe: 'プローブ',
      probeRisk: 'この Gateway が属するゾーンから到達性プローブを 1 回実行します。'
    },
    columns: {
      actions: '操作',
      gateway: 'ゲートウェイ',
      lastHeartbeat: '直近ハートビート',
      load: '负載',
      region: 'ゾーン',
      status: 'ステータス'
    },
    detail: {
      abilities: {
        agentTask: {
          description: '把デプロイ、チェック等タスク转给ゾーン内の Agent 実行。',
          title: 'タスク转発'
        },
        directControl: {
          description: '把受控操作转発へゾーン内 Agent、システム無必要直连内網ポート。',
          title: '远程控制转発'
        },
        probe: {
          description: 'このゾーンからホスト、Web サイト、Agent にアクセスできるかを確認します。',
          title: '连通性チェック'
        },
        relay: {
          description: '狭い認可の後、承認された対象とポートへ TCP バイトだけを透過転送します。',
          title: '直接 TCP リレー'
        }
      },
      eyebrow: 'ゾーンゲートウェイ',
      heroDescription: '负责 {region} ゾーン内のプローブと转発',
      overview: {
        availableCapacity: '利用可能容量',
        connectionStatus: '接続ステータス',
        lastContact: '直近連络',
        processing: '正で処理',
        serviceRegion: 'サービスゾーン',
        successRate: '成功率'
      },
      sections: {
        overview: '実行概要',
        services: '利用可能サービス'
      }
    },
    empty: {
      description: '追加 Gateway agent、またはで既存 Agent 上有効化 Gateway ロール。',
      title: 'ゲートウェイはまだありません'
    },
    errors: {
      generateEnableCommandFailed: '生成 Gateway 有効化コマンド失敗。',
      generateInstallCommandFailed: '生成 Gateway agent インストールコマンド失敗。',
      missingEnableCommand: 'システム未戻る Gateway 有効化コマンド。',
      missingInstallCommand: 'システム未戻る Gateway agent インストールコマンド。',
      relayPolicyRequired: 'Relay の対象とポートを 1 件以上入力してください。'
    },
    fields: {
      config: '設定',
      defaultRegion: 'default',
      enableCommand: '有効化コマンド',
      expiresAt: '期限切れ時刻',
      installCode: 'インストールコード',
      installCommand: 'インストールコマンド',
      platform: 'プラットフォーム',
      region: 'ゾーン',
      relayPorts: 'Relay ポート許可リスト',
      relayPortsPlaceholder: '例: 443, 8443',
      relayTargets: 'Relay 対象許可リスト',
      relayTargetsPlaceholder: '1 行またはカンマ区切り。例: app.internal.example, 10.20.0.0/16',
      service: 'サービス',
      unboundAgent: '不バインド具体的な Agent'
    },
    links: {
      assets: 'アセットを表示',
      executions: '表示実行記録'
    },
    modals: {
      detail: {
        title: 'ゲートウェイ詳細'
      },
      enable: {
        title: '既存 Agent 有効化 Gateway'
      },
      install: {
        title: '追加 Gateway agent'
      }
    },
    page: {
      description: '管理ゾーン路由 Gateway agent。',
      title: 'ゲートウェイ'
    },
    platforms: {
      linuxSystemd: {
        description: 'で Linux ホストインストール Gateway agent サービス'
      },
      windowsService: {
        description: 'で Windows ホストインストール Gateway agent サービス'
      }
    },
    resourceName: 'ゲートウェイ',
    status: {
      disabled: '停止済み',
      offline: 'オフライン',
      online: '正常オンライン',
      revoked: '撤销済み',
      upgrading: 'アップグレード中'
    },
    values: {
      availableCapacity: '可接收 {count} 個タスク',
      defaultRegion: 'デフォルトゾーン',
      regionGatewayName: '{region}ゲートウェイ',
      taskCount: '{count} 個タスク'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'サービス読取 Secret',
      secretResolve: 'Executor読取 Secret',
      secretCreate: '作成 Secret',
      secretVersionCreate: '作成 Secret バージョン',
      secretRotate: '轮换 Secret',
      certificateImport: '証明書をインポート',
      certificateFormatUpdate: '更新証明書成果物',
      certificateFormatDelete: '削除証明書成果物',
      deploymentCreate: '作成デプロイプラン',
      deploymentExecute: '実行デプロイプラン',
      deploymentRollback: 'リクエストロールバック',
      approvalCreate: '作成承認',
      approvalApprove: '承認を許可',
      approvalReject: '拒否承認',
      authLogin: 'ユーザーログイン',
      authLogout: 'ユーザー終了'
    },
    events: {
      authLoginSuccess: 'ログインに成功しました',
      authLoginFailure: 'ログインに失敗しました',
      authLoginFailed: 'ログインに失敗しました',
      authLogout: 'ログアウト',
      authExternalLoginSuccess: '外部IDログインに成功しました',
      authExternalLoginFailed: '外部IDログインに失敗しました',
      secretCreated: '作成 Secret',
      secretVersionCreated: '作成 Secret バージョン',
      secretUsed: '読取 Secret',
      secretRotated: '轮换 Secret',
      permissionDenied: '権限拒否',
      approvalCreated: '作成承認',
      approvalApproved: '承認合格',
      approvalRejected: '承認驳回',
      certificateImported: '証明書変更',
      deploymentCreated: '作成デプロイ',
      deploymentExecuted: '実行デプロイ',
      deploymentRollbackRequested: 'リクエストデプロイロールバック',
      pluginInstalled: 'インストールプラグイン',
      pluginPermissionDenied: 'プラグイン権限拒否',
      workflowTemplateExecuted: '実行ワークフローテンプレート'
    },
    types: {
      audit: '監査',
      auth: '認証',
      security: '安全',
      secret: 'Secret',
      certificate: '証明書',
      certificateVersion: '証明書',
      certificateVersionFormat: '証明書成果物',
      deployment: 'デプロイ',
      deploymentPlan: 'デプロイプラン',
      execution: '実行',
      approval: '承認',
      permission: '権限',
      plugin: 'プラグイン',
      workflowTemplate: 'ワークフロー',
      gateway: 'ゲートウェイ',
      agent: 'Agent',
      serviceAsset: 'アプリケーションアセット',
      binding: 'バインド'
    },
    actors: {
      user: 'ユーザー',
      admin: '管理者',
      system: 'システム',
      agent: 'Agent',
      plugin: 'プラグイン',
      executor: 'Executor'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Secret バージョン',
      certificate: '証明書',
      certificateVersion: '証明書バージョン',
      certificateVersionFormat: '証明書成果物',
      deployment: 'デプロイ',
      deploymentPlan: 'デプロイプラン',
      execution: '実行タスク',
      executionRun: '実行タスク',
      approval: '承認単',
      plugin: 'プラグイン',
      workflowTemplate: 'ワークフローテンプレート',
      gateway: 'ゲートウェイ',
      agent: 'Agent',
      serviceAsset: 'アプリケーションアセット',
      binding: '証明書バインド',
      auditLog: '監査ログ'
    },
    results: {
      success: '成功',
      failure: '失敗',
      denied: '拒否'
    },
    verbs: {
      success: '完了',
      failure: '失敗',
      denied: '拒否'
    },
    tokens: {
      auth: '認証',
      login: 'ログイン',
      logout: '終了',
      external: '外部',
      secret: 'Secret',
      resolve: '読取',
      service: 'サービス',
      used: '使用',
      created: '作成',
      create: '作成',
      updated: '更新',
      update: '更新',
      deleted: '削除',
      delete: '削除',
      version: 'バージョン',
      certificate: '証明書',
      imported: 'インポート',
      import: 'インポート',
      format: '成果物',
      deployment: 'デプロイ',
      executed: '実行',
      execute: '実行',
      rollback: 'ロールバック',
      requested: 'リクエスト',
      approval: '承認',
      approved: '合格',
      rejected: '驳回',
      permission: '権限',
      denied: '拒否',
      gateway: 'ゲートウェイ',
      credential: '認証情報',
      issued: '発放',
      revoked: '吊销',
      task: 'タスク',
      evidence: '証拠',
      recorded: '記録',
      result: '結果',
      plugin: 'プラグイン',
      workflow: 'ワークフロー',
      template: 'テンプレート',
      synced: '同時に',
      tested: '測試',
      source: 'ソース',
      identity: 'ID ソース',
      group: '組',
      mapping: '映射'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb}“{title}”、オブジェクト：{resource}。',
    summaries: {
      deployment: '{actor}{verb}「{action}」、デプロイ計画：{planName}、資産：{targetNames}。',
      permissionDenied: '{actor}は{reason}のため、{resource}への「{action}」操作を拒否されました。',
      taskCreated: '{actor}が「{taskType}」を作成しました。',
      secretUsed: '{actor}が{purpose}を読み取りました。',
      authExternalLoginSuccess: '{actor}が{sourceType} ID ソース経由でログインしました。',
      authExternalLoginFailed: '{actor}が{sourceType} ID ソース経由のログインに失敗しました。',
      authLoginSuccess: '{actor}がログインしました。',
      authLoginFailed: '{actor}のログインに失敗しました：{reason}。',
      authPasswordChanged: '{actor}がログインパスワードを変更しました。',
      authLogout: '{actor}がログアウトしました。',
      securityIdentitySourceSynced: '{actor}が{resource}を同期しました{counts}。',
      securityIdentitySourceTested: '{actor}が{resource}の接続テストに成功しました。',
      securityUserCreated: '{actor}がユーザー「{username}」を作成しました。'
    },
    deploymentActions: { execute: 'デプロイを実行', dryRun: 'デプロイ計画を試行', rollback: 'デプロイをロールバック' },
    taskTypes: { certificateDryRun: '証明書デプロイ試行タスク', certificateDeploy: '証明書デプロイタスク', acmeRenewal: 'ACME 証明書更新タスク', agentInstall: 'Agent インストールタスク', agentCapabilityRescan: 'Agent 機能再スキャンタスク', pluginReferenceRefresh: 'プラグインカタログ更新タスク', automationRun: '自動化実行タスク', automationTriggerDelivery: '自動化トリガー配信タスク', monitoring: '証明書監視タスク', backgroundTask: 'バックグラウンドタスク' },
    secretPurposes: { httpHeader: 'HTTP ヘッダー資格情報', deploymentPrivateKey: '証明書デプロイ秘密鍵', deploymentPassword: '証明書デプロイパスワード', exportPrivateKey: '証明書エクスポート秘密鍵', exportPassword: '証明書エクスポートパスワード', sshAuthentication: 'SSH 資格情報', providerOperation: 'Secret プロバイダー資格情報', ldapBind: 'LDAP バインド資格情報', httpFormPassword: 'HTTP フォームパスワード', debugCheck: 'Secret チェック資格情報', credential: '資格情報' },
    permissionActions: { taskRead: 'タスクを読む', auditRead: '監査ログを読む', serviceAssetRead: '管理アプリケーションを読む', certificateRead: '証明書を読む', certificateAssetRead: '証明書資産を読む', bindingRead: '証明書バインドを読む', pluginVersionRead: 'プラグインバージョンを読む', caOperationsRead: 'CA 運用を読む', approvalDecide: '承認を決定', providerRead: 'プロバイダーを読む', executionRead: '実行を読む', cloudAssetRead: 'クラウドアカウント資産を読む', managedTargetRead: '管理対象を読む', hostRead: 'ホストを読む', resourceAccess: 'リソースにアクセス' },
    permissionReasons: { noAllowPolicy: '一致する許可ポリシーがない', noObjectGrant: '一致するオブジェクト権限がない', explicitDeny: '明示的に拒否された', explicitBusinessDeny: '業務ルールで明示的に拒否された', tenantScopeDenied: 'テナント範囲で許可されない', resourceScopeDenied: 'リソース範囲で許可されない', missing: 'アクセス権限が不足している' },
    identitySources: { activeDirectory: 'Active Directory', ldap: 'LDAP', oidc: 'OIDC', saml: 'SAML', external: '外部' },
    authFailureReasons: { badCredentials: 'ユーザー名またはパスワードが正しくない', invalid: '認証情報が無効', },
    identitySyncCounts: '（合計 {total} アカウント、作成 {created}、更新 {updated}、失敗 {failed}）',
    moreTargets: '{names} など {count} 個の資産',
    listSeparator: '、',
    fallbacks: { unknown: '不明', unnamedDeploymentPlan: '名前なしのデプロイ計画', noTargetAssets: '対象資産の記録なし' }
  },
  audit: {
    page: {
      title: '監査ログ',
      description: 'によりユーザー操作、失敗/拒否とキー業務変更組织ログ、保留可読サマリー。'
    },
    actions: {
      exportEvidence: 'エクスポート監査証拠',
      exporting: 'エクスポート中…',
      refreshing: '更新中…'
    },
    errors: {
      exportFailed: 'エクスポート監査証拠に失敗しました',
      loadFailed: '監査ログの読み込みに失敗しました',
      withRequestId: '{message}（{requestId}）'
    },
    metrics: {
      ariaLabel: '監査概要',
      total: {
        title: '監査合計',
        description: '現在フィルター範囲内可追踪の操作記録。'
      },
      failed: {
        title: '失敗 / 拒否',
        description: '優先的な再確認が必要な失敗実行とアクセス拒否です。'
      },
      userActions: {
        title: 'ユーザー操作',
        description: 'ユーザーが直接開始した業務変更とアクセス操作です。'
      }
    },
    list: {
      ariaLabel: '監査ログ一覧',
      title: 'ログ一覧',
      summary: '合計 {total} 件。デフォルトでは最新時刻順に並びます。',
      timeNotRecorded: '未記録時刻'
    },
    empty: {
      title: '監査イベントはまだありません',
      description: 'キー操作応能回溯へ对応の操作記録とタスク記録。'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: '読み込みに失敗しました',
      submitFailed: '送信に失敗しました'
    },
    actions: {
      createResource: '追加{resource}',
      submitting: '送信中…'
    },
    modal: {
      createDescription: '入力以下フィールド後作成{resource}'
    },
    placeholders: {
      selectField: '{field}を選択してください'
    },
    table: {
      ariaLabel: '管理一覧',
      resourceList: '{resource}一覧',
      total: '共 {count} 件'
    }
  },
  settings: {
    ...(licensingLocaleMessages['ja-JP'] ?? {}),
    securityLabel: 'システム設定入口',
    deploymentTasks: {
      eyebrow: 'デプロイタスク',
      title: 'デプロイタスク設定',
      description: 'テナント全体で証明書デプロイ前に Dry-run を実行するか設定します。',
      readonly: 'このアカウントは読み取り専用です。',
      fields: {
        dryRun: { title: 'Dry-run を有効化', description: 'デプロイ前に読み取り専用の事前確認を行います。結果は参考情報であり、正式デプロイをブロックしません。', aria: '証明書デプロイ Dry-run を有効化' }
      },
      actions: { save: '設定を保存', saving: '保存中...' },
      messages: { saved: 'デプロイタスク設定を保存しました。' },
      errors: { loadFailed: 'デプロイタスク設定の読み込みに失敗しました。', saveFailed: 'デプロイタスク設定の保存に失敗しました。' }
    },
    version: {
      title: 'バージョン情報',
      description: '現在実行中の GCAC バージョンを表示します。',
      currentVersion: '現在のバージョン',
      product: '製品'
    },
    permissionPolicies: {
      resourceName: '権限ポリシー',
      actions: {
        create: '作成ポリシー'
      },
      columns: {
        id: 'ポリシー ID',
        subjectType: 'サブジェクトタイプ',
        subjectId: 'サブジェクト ID',
        effect: '效果',
        actions: '动作',
        resourceTypes: 'リソースタイプ',
        scope: 'スコープ'
      },
      fields: {
        subjectType: 'サブジェクトタイプ',
        subjectId: 'サブジェクト ID',
        effect: '效果',
        actions: '动作',
        resourceTypes: 'リソースタイプ',
        tenantId: 'テナントスコープ'
      },
      subjectTypes: {
        role: 'ロール',
        user: 'ユーザー',
        plugin: 'プラグイン',
        executor: 'Executor'
      },
      effects: {
        allow: '允許',
        deny: '拒否'
      }
    },
    groupRoleMappings: {
      resourceName: '組映射',
      actions: {
        create: '作成映射'
      },
      columns: {
        sourceId: 'ID ソース ID',
        externalGroup: '外部グループ',
        roleId: 'ローカルロール',
        enabled: '有効化',
        updatedAt: '更新時刻'
      },
      fields: {
        sourceId: 'ID ソース ID',
        externalGroup: '外部グループ',
        externalGroupPlaceholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com',
        roleId: 'ローカルロール ID'
      }
    },
    users: {
      title: 'アカウントサブジェクト一覧',
      summary: {
        groups: '共 {count} 件',
        users: '共 {total} 件、選 {selected} 件済み'
      },
      actions: {
        createUser: '作成ユーザー',
        addGroup: '追加組',
        bulkDelete: '一括削除',
        edit: '編集',
        delete: '削除',
        lookupLoading: '検索中...',
        lookupUser: '検索ユーザー',
        lookupGroup: '検索組',
        creating: '作成中...',
        saving: '保存中...',
        saveChanges: '保存変更',
        adding: '追加中...'
      },
      risks: {
        bulkDelete: '一括削除では削除選択したユーザーのローカル認証情報とロール関連。',
        deleteUser: '削除ユーザーは削除このアカウントのローカル認証情報とロール関連。'
      },
      tabs: {
        users: 'ユーザー',
        groups: '組'
      },
      empty: {
        users: 'ユーザーはまだありません',
        groups: 'ユーザー組はまだありません'
      },
      columns: {
        username: 'ユーザー名',
        displayName: '表示名',
        email: '邮箱',
        source: 'ソース',
        identitySourceName: 'ID ソース名前',
        status: 'ステータス',
        tenant: 'テナント',
        roles: 'ロール',
        lastSyncedAt: '直近同時に',
        updatedAt: '更新時刻',
        actions: '操作',
        groupName: '組名前',
        code: 'エンコーディング',
        externalRef: '外部標識'
      },
      dialog: {
        userCreateTitle: '作成ユーザー',
        userEditTitle: '編集ユーザー',
        userCreateDescription: '作成ローカルユーザー、またはID ソースからユーザー名で検索して作成バインドユーザー。',
        userEditDescription: '編集ユーザーの表示名、邮箱、ステータスとロール。',
        groupCreateTitle: '追加組',
        groupCreateDescription: '作成ローカル組、またはID ソースからグループ名で検索して追加外部グループ。'
      },
      aria: {
        principalType: 'サブジェクトタイプ',
        createMode: '作成方式',
        externalUserProfile: 'ID ソースユーザー资料',
        groupCreateMode: '作成組方式',
        externalGroupProfile: 'ID ソースユーザー組资料'
      },
      modes: {
        localUser: 'ローカルユーザー',
        externalUser: 'ID ソースユーザー',
        localGroup: 'ローカル組',
        externalGroup: 'ID ソース組'
      },
      fields: {
        identitySource: 'ID ソース',
        directoryUsername: 'ディレクトリユーザー名',
        username: 'ユーザー名',
        displayName: '表示名',
        email: '邮箱',
        role: 'ロール',
        initialPassword: '初始パスワード',
        status: 'ステータス',
        directoryGroupName: 'ディレクトリ組名前',
        groupName: '組名前',
        groupCode: '組エンコーディング',
        directoryDn: 'ディレクトリ DN'
      },
      placeholders: {
        selectIdentitySource: 'ID ソースを選択してください',
        directoryUsername: '例： jackson',
        displayName: '証明書操作员',
        initialPassword: '入力初始パスワード',
        directoryGroupName: '例： GCAC-Ops',
        groupName: '証明書運用グループ'
      },
      options: {
        unset: '不設定'
      },
      status: {
        active: '有効化',
        disabled: '無効化'
      },
      labels: {
        identitySourceOption: '{name}（{type}）'
      },
      errors: {
        loadUsersFailed: 'ユーザーの読み込みに失敗しました',
        loadGroupsFailed: 'ユーザー組の読み込みに失敗しました',
        createUserFailed: 'ユーザーの作成に失敗しました',
        updateUserFailed: '更新ユーザーに失敗しました',
        externalUserEmpty: 'ID ソース没有戻るユーザー资料',
        lookupExternalUserFailed: '検索ID ソースユーザーに失敗しました',
        externalGroupEmpty: 'ID ソース没有戻るユーザー組资料',
        lookupExternalGroupFailed: '検索ID ソースユーザー組に失敗しました',
        createGroupFailed: 'ユーザー組の作成に失敗しました',
        deleteUsersFailed: '削除ユーザーに失敗しました'
      }
    },
    roles: {
      page: {
        title: '権限管理',
        description: 'ロールを中心に管理認可対象範囲、かつユーザーまたはグループを割り当てへロール。'
      },
      actions: {
        createRole: '作成ロール',
        refreshObjects: '更新オブジェクト',
        loading: '読み込み中...',
        creating: '作成中...',
        saving: '保存中...',
        detail: '詳細',
        authorize: '授権',
        grantPermission: '付与権限',
        assignMembers: '分配成员',
        delete: '削除',
        deleteRole: '削除ロール',
        deleting: '削除中...',
        clearSelection: '清空選択', revokePermission: '権限を取り消す', revoking: '取り消し中...'
      },
      columns: {
        roleId: 'ロール ID',
        code: 'エンコーディング',
        name: '名前',
        builtin: '組み込み',
        policyCount: 'ポリシー数',
        permissions: '権限項目',
        actions: '操作',
        objectScope: 'オブジェクト範囲',
        accessLevel: '権限レベル',
        businessLevel: '業務権限レベル',
        effect: '效果',
        memberType: '成员タイプ',
        member: '成员'
      },
      table: {
        emptyRoles: 'ロールはまだありません',
        roleRecords: 'ロール記録',
        emptyGrants: '現在ロールまだありませんオブジェクト権限',
        currentPermissions: '現在ロール権限',
        emptyMembers: '現在ロールまだありませんメンバー割り当て',
        assignedMembers: '分配成员済み'
      },
      categories: {
        certificate: '証明書',
        application: 'アプリケーション',
        gateway: 'ゲートウェイ',
        agent: 'Agent',
        serviceAsset: 'アプリケーションアセット',
        deploymentPlan: '更新プラン',
        workflow: 'ワークフロー',
        auditLog: 'ログ',
        systemSetting: 'システム設定'
      },
      accessLevel: {
        read: '読み取り専用',
        edit: '編集',
        control: '完全控制'
      },
      levels: {
        user: '使用者',
        manager: '管理者'
      },
      presets: { label: '事前設定テンプレート', custom: 'カスタム業務権限', certificateViewer: '証明書閲覧', certificateManager: '証明書管理', applicationViewer: 'アプリ閲覧', applicationManager: 'アプリ管理' },
      effect: {
        allow: '允許',
        deny: '拒否'
      },
      principal: {
        user: 'ユーザー',
        group: '組',
        externalGroup: 'ID ソース組'
      },
      summary: {
        selectedMembers: '選 {count} 個成员済み',
        chooseMembers: 'ユーザーまたは組を選択してください',
        selectedScopes: '選 {count} 個範囲済み',
        chooseObjectNode: 'オブジェクトツリーノードを選択してください',
        selectedScopeLabel: '選範囲済み',
        selectedMemberLabel: '選成员済み'
      },
      tree: {
        rootLabel: '全部オブジェクト',
        rootDescription: '所有権限付与可能な業務オブジェクト',
        typeDescription: '{category}全部記録',
        allBusinessObjects: '全部業務オブジェクト',
        selectedScopeAria: '選授権範囲済み',
        objectTreeAria: '権限付与可能なオブジェクトツリー',
        authorizableObjects: '権限付与可能なオブジェクト',
        loading: '読み込みオブジェクトツリー中...',
        kind: {
          all: 'すべて',
          category: '分类',
          record: '記録'
        }
      },
      format: {
        labelWithId: '{label}（{id}）',
        recordFallback: '{category} {value}',
        unnamedRecord: '無名の記録'
      },
      detail: {
        title: 'ロール詳細',
        titleWithName: 'ロール {name}',
        description: 'オブジェクト範囲、具体的なオブジェクト、権限レベルとメンバー割り当てここで維護。'
      },
      create: {
        title: '作成ロール',
        description: '入力ロール職責、かつ直接としてこのロール認可対象範囲。',
        nameLabel: 'ロール名前',
        namePlaceholder: '証明書操作员',
        descriptionLabel: '説明',
        descriptionPlaceholder: '负责証明書日常操作',
        authorizedRole: '授権ロール',
        newRole: '新ロール'
      },
      grant: {
        title: '付与ロール権限',
        description: 'からオブジェクトツリー選択範囲、直接設定この範囲上の権限レベル。',
        roleLabel: 'ロール'
      },
      member: {
        title: '分配成员',
        titleWithName: '分配成员：{name}',
        description: '選択ユーザーまたは組、システムは把メンバー割り当てへこのロール有の認可対象範囲済み。',
        targetRole: 'ターゲットロール',
        authorizedScope: '授権範囲',
        objectScopeCount: '{count} 個オブジェクト範囲',
        selectedMembersAria: '選成员済み',
        assignableMembersAria: '可分配成员',
        emptyAssignable: '可分配{type}はまだありません'
      },
      errors: {
        loadObjectTreeFailed: 'オブジェクトツリーの読み込みに失敗しました',
        loadDataFailed: '権限管理データの読み込みに失敗しました',
        invalidBusinessScope: '対応する業務権限範囲が見つかりません。',
        missingRoleId: 'ロール ID を取得していません',
        createRoleFailed: 'ロールの作成に失敗しました',
        grantRoleFailed: '付与ロール権限に失敗しました',
        roleNoObjectScopes: 'このロールまだありません認可対象範囲、先にロールへ権限を付与してください。',
        assignMembersFailed: '分配成员に失敗しました',
        deleteRoleFailed: '削除ロールに失敗しました',
        missingObjectSetId: 'オブジェクト範囲 ID を取得していません', presetScopeMismatch: 'テンプレートと選択範囲が一致しません', revokePermissionFailed: '権限の取り消しに失敗しました'
      },
      confirm: {
        deleteRole: '確認削除ロール“{name}”？削除後は同時に削除このロールのユーザー分配とオブジェクト授権。', revokePermission: 'この業務権限を取り消しますか？互換オブジェクト権限も削除されます。'
      },
      auditLogs: {
        auth: {
          name: '認証ログインログ',
          description: 'ログイン、ログアウト、外部ID ソースログイン'
        },
        security: {
          name: '安全管理ログ',
          description: 'ユーザー、ロール、権限、ID ソース変更'
        },
        certificate: {
          name: '証明書ログ',
          description: '証明書インポート、バージョン、成果物とバインド操作'
        },
        asset: {
          name: 'アセットログ',
          description: 'アプリケーションアセット、ホスト、サービスインスタンス、サイトアセットの操作'
        },
        gateway: {
          name: 'ゲートウェイログ',
          description: 'ゲートウェイ路由、プローブとステータス変更'
        },
        agent: {
          name: 'Agent ログ',
          description: 'Agent 登録、ハートビート、タスクとアップグレード操作'
        },
        deployment: {
          name: '更新プランログ',
          description: 'デプロイプラン、実行、ロールバック'
        },
        workflow: {
          name: 'ワークフローログ',
          description: 'ワークフローテンプレートと実行操作'
        },
        secret: {
          name: '鍵ログ',
          description: 'Secret 作成、使用と轮换'
        },
        system: {
          name: 'システムログ',
          description: 'システム設定とプラットフォーム级イベント'
        }
      }
    },
    identitySources: {
      actions: {
        create: '作成ID ソース',
        edit: '編集',
        delete: '削除',
        testConnection: '接続テスト',
        testing: 'テスト中...',
        creating: '作成中...',
        saving: '保存中...',
        saveChanges: '保存変更',
        expandAdvanced: '展開高级設定',
        collapseAdvanced: '折りたたむ高级設定'
      },
      columns: {
        name: '名前',
        type: 'ディレクトリタイプ',
        server: 'サーバー',
        status: 'ステータス',
        actions: '操作'
      },
      table: {
        title: 'ID ソース一覧',
        total: '共 {count} 件'
      },
      empty: 'ID ソースはまだありません',
      dialog: {
        createTitle: '作成ID ソース',
        editTitle: '編集ID ソース',
        createDescription: 'まず基本的な接続情報を入力します。フィルターとディレクトリタイプは詳細設定にあります。',
        editDescription: '変更ID ソース設定；若要更新サービスアカウントパスワード、重新入力パスワード。'
      },
      fields: {
        name: '名前',
        domain: 'ドメイン名',
        protocol: 'プロトコル',
        serverAddress: 'サーバーアドレス',
        baseDn: 'Base DN',
        bindDn: 'サービスアカウント DN',
        bindPassword: 'サービスアカウントパスワード',
        directoryType: 'ディレクトリタイプ',
        defaultRole: 'デフォルトロール',
        enabled: '有効化ステータス',
        userDnTemplate: 'ユーザー DN/UPN テンプレート',
        userFilter: 'ユーザー過滤器',
        groupFilter: '組過滤器',
        syncUserFilter: '同時にユーザー過滤器',
        requireGroupMapping: '要求ログインユーザー必ず命中組映射'
      },
      placeholders: {
        name: '例：企業 AD',
        domain: '例：example.com',
        serverAddress: '例：ad.example.com:636',
        baseDn: '例：DC=example,DC=com',
        bindDn: '例：CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: '入力サービスアカウントパスワード',
        bindPasswordEdit: '空欄の場合は既存のパスワードを使用します',
        autoByDirectoryType: '留空则によりディレクトリタイプ自動推導',
        userFilter: "例：(uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "例：(member={'{'}{'{'}userDn{'}'}{'}'})"
      },
      labels: {
        finalUrl: '最終アドレス：{url}'
      },
      options: {
        unset: '不設定'
      },
      status: {
        enabled: '有効化',
        disabled: '停止済み',
        disabledShort: '無効化'
      },
      types: {
        activeDirectory: 'Active Directory',
        ldap: '標準 LDAP'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: '削除ID ソース後、このディレクトリのログイン、同時にと組映射都は失効。'
      },
      test: {
        dialogTitle: 'ID ソース接続テスト',
        dialogDescription: '{name}（{server}）の DNS、LDAP 認証ポート、BIND 状態を確認しています。',
        loading: 'DNS、LDAP 認証ポート、BIND 状態を順番に確認しています...',
        checks: {
          dns: { title: 'DNS 解決を確認' },
          port: { title: 'LDAP 認証ポートを確認' },
          bind: { title: 'LDAP BIND を確認' }
        },
        status: {
          passed: '成功',
          failed: '失敗',
          skipped: 'スキップ'
        },
        messages: {
          summaryPassed: 'LDAP 接続チェックにすべて成功しました',
          summaryFailed: 'LDAP 接続チェックに失敗しました',
          dnsIp: '対象は IP アドレスのため、DNS ルックアップは不要です',
          dnsResolved: 'DNS 解決に成功しました：{addresses}',
          dnsFailed: 'DNS 解決に失敗しました',
          portReachable: '{protocol} 認証ポート {port} に接続できます',
          portFailed: 'LDAP 認証ポートに接続できません',
          bindServicePassed: 'LDAP サービスアカウント BIND と Base DN クエリに成功しました',
          bindAnonymousPassed: '匿名 LDAP BIND と Base DN クエリに成功しました',
          bindFailed: 'LDAP BIND または Base DN クエリに失敗しました',
          skippedInvalidUrl: 'LDAP アドレスが無効なためスキップしました',
          skippedDnsFailed: 'DNS 解決に失敗したためスキップしました',
          skippedPortFailed: 'LDAP 認証ポートに接続できないためスキップしました',
          unknownCheck: 'このチェックに失敗しました（{code}）',
          checkNotReturned: 'サーバーからこの確認結果が返されませんでした。'
        },
        errors: {
          emptyResult: 'サーバーから接続テスト結果が返されませんでした',
          requestFailed: '接続テストに失敗しました'
        }
      },
      secret: {
        bindPasswordName: '{name} LDAP サービスアカウントパスワード'
      },
      messages: {
        createSuccess: 'ID ソース作成に成功しました',
        updateSuccess: 'ID ソース更新に成功しました'
      },
      errors: {
        loadFailed: 'ID ソースの読み込みに失敗しました',
        createBindPasswordSecretFailed: 'サービスアカウントパスワード Secret の作成に失敗しました',
        createFailed: 'ID ソースの作成に失敗しました',
        updateFailed: '更新ID ソースに失敗しました',
        deleteFailed: '削除ID ソースに失敗しました'
      }
    }
  },
  bindings: {
    defaults: certificateFormatDefaultsJaJP,
    actions: {
      create: '新建設定ファイル',
      toggleFilters: '絞り込み',
      export: 'エクスポート',
      exporting: 'エクスポート中...',
      edit: '編集',
      delete: '削除',
      deleting: '削除中...',
      applyTemplate: '適用組み込みテンプレート',
      saving: '保存中...',
      confirmSave: '確認保存'
    },
    columns: {
      configName: '設定ファイル名前',
      targetSummary: 'ターゲット環境',
      displayFormat: '内容形式',
      extension: '拡張子',
      encodingSummary: 'エンコーディング',
      exportSummary: '含める内容 / エクスポートオプション',
      actions: '操作'
    },
    dialog: {
      createTitle: '新建証明書形式設定',
      editTitle: '編集証明書形式設定',
      description: '選択システムプラットフォームとターゲットプラットフォーム後、可適用組み込みテンプレートかつ項目ごとに調整エクスポート内容。'
    },
    exportModal: {
      title: '証明書成果物をエクスポート',
      description: '証明書バージョンを選択し、この配布プロファイルを生成してダウンロードします。',
      certificateVersion: '証明書バージョン',
      loadingVersions: '証明書バージョンを読み込み中...',
      versionRequired: '証明書バージョンを選択してください',
      loadVersionsFailed: '証明書バージョンの読み込みに失敗しました',
      artifactUnavailable: 'ダウンロード可能な証明書成果物が返されませんでした',
      exportFailed: '証明書成果物のエクスポートに失敗しました',
      passwordRequired: 'PFX/JKS のエクスポートにはパスワードが必要です',
      passwordPlaceholder: '今回のエクスポート用パスワードを入力',
      passwordHint: '今回のエクスポートにのみ使用し、配布プロファイルは変更しません。',
      confirm: '生成してダウンロード',
      unnamedCertificate: '名前なし証明書',
      versionLabel: 'v{version}',
      expiresOn: '{date} に期限切れ'
    },
    list: {
      title: '証明書形式設定一覧',
      descriptionWithCount: '可复用の証明書形式テンプレート。現在 {count} 件'
    },
    empty: {
      text: '証明書形式設定はまだありません'
    },
    fields: {
      contentFormat: '内容形式',
      systemPlatform: 'システムプラットフォーム',
      runtimePlatform: 'ターゲットプラットフォーム',
      configName: '設定ファイル名前',
      backendFormat: '基盤形式',
      outputExtension: '輸出拡張子',
      expiresAt: '設定失効時刻（任意）',
      certificateEncoding: '証明書エンコーディング',
      certificateContentEncoding: '証明書内容エンコーディング',
      privateKeyEncoding: '秘密鍵エンコーディング',
      includeLeafCertificate: '公開鍵証明書を含める',
      includeCertificateChain: '含める証明書チェーン',
      includePrivateKey: '含める秘密鍵',
      mainArtifactIncludesChain: '主成果物含める証明書チェーン',
      generateChainFile: '証明書チェーンファイルも生成',
      generatePrivateKeyFile: '秘密鍵ファイルも生成',
      exportPassword: 'エクスポートパスワード'
    },
    formats: {
      pfx: 'PKCS#12 / PFX 容器',
      jks: 'JKS 容器',
      pemBundle: 'PEM 単ファイル Bundle',
      pemCert: 'PEM 証明書ファイル',
      pemKey: '秘密鍵ファイル',
      cer: '証明書ファイル（.cer）',
      crt: '証明書ファイル（.crt）',
      p7b: 'PKCS#7 / P7B 証明書チェーン',
      custom: 'カスタム'
    },
    sections: {
      templates: {
        title: '組み込みテンプレート',
        description: '各プラットフォームで一般的な TLS 配置方式に基づき、内容形式、含める内容、エクスポートルールを事前入力します。適用後も変更できます。'
      },
      basic: {
        title: '基本情報',
        description: 'まず設定ファイル ID、実際の内容形式、最終的な拡張子を定義します。'
      },
      encoding: {
        title: 'エンコーディング選択',
        description: '現在の内容形式でサポートされているエンコーディングオプションのみ表示します。'
      },
      content: {
        title: '含める内容',
        description: '主成果物ファイルに含める内容を定義します：公開鍵、証明書チェーン、秘密鍵。'
      },
      export: {
        title: 'エクスポートオプション',
        description: '証明書チェーンファイルや秘密鍵ファイルを追加生成するか、コンテナ専用パスワードを使うかを定義します。'
      }
    },
    filters: {
      keywordPlaceholder: '設定名前 / ターゲット環境 / Alias / 内容形式'
    },
    placeholders: {
      configName: '例：デバイス互換の単一ファイル PEM',
      exportPassword: ' PFX/JKS エクスポートパスワードを入力してください'
    },
    validation: {
      selectPlatformsFirst: '先選択システムプラットフォームとターゲットプラットフォーム。',
      configNameRequired: '必ず入力設定ファイル名前',
      passwordRequired: 'PFX/JKS 設定必ず入力エクスポートパスワード'
    },
    errors: {
      loadFailed: '証明書形式設定の読み込みに失敗しました',
      saveFailed: '証明書形式設定の保存に失敗しました',
      deleteFailed: '削除証明書形式設定に失敗しました',
      createExportSecretFailed: 'エクスポートパスワード Secret の作成に失敗しました',
      withCode: '{message}（{code}）'
    },
    fallbacks: {
      unnamedConfig: '無名の設定-{index}',
      unspecified: '未指定',
      aliasUnset: '未設定 Alias'
    },
    labels: {
      aliasWithValue: 'Alias：{alias}',
      requestId: 'リクエスト ID：{requestId}'
    },
    encoding: {
      pkcs12Container: 'PKCS#12 容器',
      jksContainer: 'JKS 容器',
      privateKeyWithEncoding: '秘密鍵 {encoding}',
      pkcs7Chain: 'PKCS#7 証明書チェーン',
      certificateWithEncoding: '証明書 {encoding}',
      default: 'デフォルト'
    },
    export: {
      leafCertificate: '公開鍵',
      certificateChain: '証明書チェーン',
      privateKey: '秘密鍵',
      extraChainFile: '追加の証明書チェーンファイル',
      extraPrivateKeyFile: '追加の秘密鍵ファイル'
    },
    secret: {
      defaultConfigName: '証明書形式設定',
      exportPasswordName: '{name} エクスポートパスワード'
    },
    select: {
      placeholder: '選択'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: '設定エクスポートパスワード；如必要更换済み、直接入力新パスワード上書き。'
    },
    templates: {
      windowsIis: {
        configName: 'Windows-IIS-PKCS12-標準テンプレート',
        description: 'IIS 使用 PKCS#12/PFX 容器最一般的な、主成果物内直接携带サーバー証明書、証明書チェーンと秘密鍵。'
      },
      windowsNginx: {
        configName: 'Windows-NGINX-PEM-標準テンプレート',
        description: 'NGINX では一般的に、サーバー証明書と証明書チェーンを単一の PEM ファイルにまとめ、秘密鍵ファイルを別に配置します。'
      },
      windowsApache: {
        configName: 'Windows-Apache-PEM-標準テンプレート',
        description: 'Apache では通常、PEM 証明書ファイルと独立した秘密鍵を配布します。証明書チェーンファイルを追加でエクスポートすると、運用習慣の違いに対応しやすくなります。'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12-標準テンプレート',
        description: 'Tomcat では JKS/PKCS#12 keystore が主に使われます。ここではより汎用的な PKCS#12 をデフォルトで使用します。'
      },
      windowsOther: {
        configName: 'Windows-デバイス互換の単一ファイル PEM テンプレート',
        description: '一部デバイスの要件に対応します。単一ファイルに公開証明書、証明書チェーン、秘密鍵をまとめ、必要に応じて拡張子を .crt/.cer に変更できます。'
      },
      linuxIis: {
        configName: 'Linux-IIS 互換テンプレート',
        description: '最終ターゲットが IIS の場合、最も妥当な配布物は引き続き PKCS#12/PFX コンテナです。'
      },
      linuxNginx: {
        configName: 'Linux-NGINX-PEM-標準テンプレート',
        description: 'NGINX の公式設定は、単一 PEM ファイルの証明書チェーンと独立した秘密鍵を前提に構成されています。'
      },
      linuxApache: {
        configName: 'Linux-Apache-PEM-標準テンプレート',
        description: 'Apache では一般的に、PEM 証明書ファイルと独立した秘密鍵を組み合わせます。証明書チェーンファイルを追加でエクスポートすると、分割デプロイしやすくなります。'
      },
      linuxTomcat: {
        configName: 'Linux-Tomcat-PKCS12-標準テンプレート',
        description: 'Tomcat では keystore コンテナでの配布がデフォルトで推奨されます。ここではより汎用的な PKCS#12 を使用します。'
      },
      linuxOther: {
        configName: 'Linux-デバイス互換の単一ファイル PEM テンプレート',
        description: 'Linux 汎用デバイスが受け入れる場合単ファイル PEM、先に使用できます bundle 形式、再によりターゲットデバイス調整拡張子と含める内容。'
      }
    }
  },
  deploymentInputs: {
    title: 'デプロイ入力',
    description: 'プラグインまたはワークフローが宣言した統一入力契約に基づいてデプロイ値を設定します。',
    saveAssetFirst: 'バックエンドが投影するデプロイ入力を編集する前に、アプリケーション資産と実行元を保存してください。',
    contractVersion: '契約 {version}',
    groups: { required: '必須設定', advanced: '詳細設定', readonly: '読み取り専用と実行時の値' },
    actions: { expand: '詳細設定を展開', collapse: '詳細設定を折りたたむ' },
    placeholders: { select: '選択してください', credential: '認証情報を選択', artifact: '成果物形式を選択', output: '出力を選択' },
    artifacts: { format: '成果物形式' },
    allowInsecureTls: {
      label: 'TLS 証明書の検証をスキップする',
      description: 'デバイスが自己署名または信頼されていない証明書を使用する場合に、今回のデプロイで TLS 証明書の検証をスキップすることを明示的に許可します。',
      help: 'これはデプロイの意図を記録するだけで、実行権限は付与しません。ホストが発行する実行許可が引き続き必要です。'
    },
    runtimeValue: '実行時に {source} から提供',
    source: 'ソース：{source}',
    sourceKinds: { asset: 'アセット', binding: 'バインディング', default: 'デフォルト値', derived: '派生値', system: 'システム値', step_output: 'ステップ出力', unknown: '不明なソース' },
    issues: {
      title: '入力の問題',
      unknown: 'デプロイ入力の検証に失敗しました（{code}）',
      DEPLOYMENT_INPUT_REQUIRED: '必須のデプロイ入力がありません',
      DEPLOYMENT_CONNECTION_REQUIRED: '必須の接続設定がありません',
      DEPLOYMENT_CREDENTIAL_REQUIRED: '必須の認証情報がありません',
      DEPLOYMENT_ARTIFACT_REQUIRED: '必須のデプロイ成果物がありません',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: 'このデプロイ入力は上書きできません',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: 'デプロイ入力スロットが宣言されていません',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: 'デプロイ入力フィールドが宣言されていません',
      DEPLOYMENT_INPUT_TYPE_INVALID: 'デプロイ入力の型が正しくありません',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: '固定デプロイ入力は上書きできません',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: '認証情報スナップショットがありません',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: '認証情報スナップショットが現在の選択と一致しません',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: 'サポートされていない認証情報種別です',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: '成果物スナップショットがありません',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: '必須の成果物出力がありません'
    }
  },
  assets: {
    presentation: {
      cards: 'カード表示',
      list: '表形式表示',
    },
    card: {
      presentation: { cards: 'カード', list: '表' },
      total: '{count} 件',
      status: { valid: '有効', attention: '注意', unknown: '不明' },
      days: { expired: '{days} 日前に期限切れ', expiresToday: '本日期限切れ', notRecorded: '未記録', remaining: '{days}日' },
      fields: { certificate: '証明書', validity: '有効期間', device: 'デバイス' },
      actions: { add: '追加', upToDate: '最新', deployUpdate: '更新をデプロイ' }
    },
    selection: {
      selectedCount: '{count} / {total} 件を選択中',
      actions: {
        bulkDelete: '一括削除',
        bulkUpdateCertificate: '証明書を一括更新'
      },
      bulkDeleteRisk: '選択したアプリケーション資産と手動ターゲット関連を削除します。検出済みのフレームワーク、サイト、管理対象は保持されます。',
      bulkDeleteSuccess: '{count} 件のアプリケーション資産を削除しました。',
      bulkDeletePartialSuccess: '{succeeded} 件を削除しました。{failed} 件は失敗しました。',
      bulkUpdateDescription: '同じ証明書ドメイン「{domain}」に紐づく {count} 件のアプリケーション資産に適用する証明書バージョンを選択します。',
      bulkUpdateFailed: '証明書の一括更新に失敗しました。{count} 件とも送信されていません。',
      bulkUpdateSuccess: '{count} 件のアプリケーション資産に証明書更新を送信しました。',
      bulkUpdatePartialSuccess: '{succeeded} 件に送信しました。{failed} 件は失敗しました。'
    },
    aria: {
      selectCard: 'アセット {name} を選択',
      detailCard: 'アセット {name} の詳細を表示',
      editCard: 'アセット {name} を編集',
      deleteCard: 'アセット {name} を削除'
    },
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
    title: 'アプリケーションアセット',
    description: 'ドメイン名または IP を主な対象としてアプリケーションエントリを管理し、アドレス、ポート、プロトコル、サイト、実行先の特定に集中します。',
    resourceName: 'アプリケーションアセット',
    linkage: { title: 'プラグインと Agent の連携', description: 'バージョンとローカル実行ポリシーを確認します。', status: '状態', agent: 'Agent バージョン', plugin: 'プラグイン バージョン', policy: 'ポリシー一致', repair: '修復' },
    executionModes: {
      label: '実行モード',
      plugin: { title: 'プラグイン実行', description: '管理対象で有効な証明書デプロイ機能を使用します。' },
      workflowOverride: { title: 'ワークフロー上書き', description: 'プラグインを使わず、ユーザー所有のワークフローを実行します。', notice: 'このモードではアセットのプラグイン割り当てを無効化し、ワークフロー実行バインディングのみ保持します。' }
    },
    actions: {
      add: 'アセットを追加',
      edit: '編集',
      detail: '詳細',
      addVariable: '追加変数',
      delete: '削除',
      deleteRisk: '削除すると、このアプリケーションアセットと手動ターゲット関連付けが一覧から削除されます。検出されたフレームワーク、サイト、Virtual Server、ManagedTarget は保持されます。',
      rollbackFromLatestSnapshot: '最新スナップショットからロールバックを開始',
      rollingBack: 'ロールバック中...',
      deployCertificate: '証明書をデプロイ',
      latestCertificate: '最新の証明書',
      updateCertificate: '証明書を更新',
      saving: '保存中...',
      creating: '作成中...',
      saveChanges: '保存変更',
      confirmCreate: '確認作成'
    },
    columns: {
      domain: 'アクセスドメイン名',
      port: 'ポート',
      protocol: 'プロトコル',
      device: '所属デバイス',
      platform: 'プラットフォーム',
      framework: 'フレームワーク',
      site: 'サイト',
      status: 'ステータス',
      actions: '操作'
    },
    fields: {
      assetId: 'アプリケーションアセット ID',
      domain: 'アクセスドメイン名',
      addressType: 'アドレスタイプ',
      port: 'ポート',
      protocol: 'プロトコル',
      device: '所属デバイス',
      verifyUrl: '検証 URL',
      platform: 'プラットフォーム',
      frameworkType: 'フレームワークタイプ',
      deploymentStrategyCompatibility: 'デプロイ戦略の互換モード',
      selectWorkflow: 'ワークフローを選択',
      serviceInstanceId: 'サービスインスタンス ID',
      siteId: 'サイト ID',
      managedTargetId: '管理対象ターゲット ID',
      bindingKey: 'バインドキー',
      hostId: '宿ホスト ID',
      environment: '環境',
      discoverySource: '検出ソース',
      lastDiscoveredAt: '最後検出時刻',
      tags: 'タグ',
      managedTarget: '管理対象ターゲット',
      siteName: 'サイト名',
      bindingInformation: 'バインド情報',
      hostHeader: 'Host Header',
      sniName: 'SNI 名',
      currentCertificate: '現在証明書',
      remainingValidity: '残り有効期間',
      targetCertificate: 'ターゲット証明書',
      expectedFingerprint: '期望フィンガープリント',
      certificateStore: '証明書ストレージ',
      snapshotType: 'スナップショットタイプ',
      time: '時刻',
      executionRun: '実行記録',
      displayName: '表示名前',
      siteInstance: 'サイトインスタンス',
      certificateFormat: '証明書成果物設定',
      workflow: 'ワークフロー',
      workflowVersionSelection: 'ワークフローバージョンポリシー',
      publishedVersion: '公開済みバージョン',
      runner: '実行場所',
      artifactFormat: '成果物形式設定',
      updatePlugin: '証明書更新プラグイン'
    },
    capability: { source: '機能の取得元', plugin: 'プラグインバージョン', runtime: 'ランタイム', executionLocation: '実行場所', pendingAssignment: '保存すると、アプリケーション資産レベルのデプロイ機能割り当てが作成されます。' },
    links: {
      certificateBindings: '表示証明書バインド',
      executions: '表示実行記録'
    },
    empty: {
      title: 'アプリケーションアセットはまだありません',
      description: 'システムによる自動検出を待つか、アプリケーションエントリを手動で補足してください。',
      noBindingInformation: 'バインド情報が指定されていません',
      notSet: '未設定',
      notSelected: '未選択',
      noVariablePreset: '可追加変数はまだありません',
      basicEntryIncomplete: '基本エントリが未完了です'
    },
    detail: {
      title: 'アプリケーション詳細',
      description: 'アセット詳細、バインド関係、デプロイ導線、スナップショット記録を表示します。',
      tabsAriaLabel: 'アプリケーション詳細タブ',
      tabs: {
        overview: '基本情報',
        snapshots: 'スナップショット'
      },
      loadingTargetBinding: '読み込みターゲットバインド詳細中...',
      loadingSnapshots: 'スナップショットを読み込み中...',
      emptyCertificateBindings: '証明書バインド関係。はまだありません',
      emptySnapshots: 'スナップショットはまだありません',
      rollbackSubmitted: 'ロールバックリクエストを送信しました。“実行記録”でロールバック実行を確認してください。',
      sections: {
        overview: {
          title: '基本情報',
          description: 'アプリケーションアセットが主対象です。ホストとサイトは実行先を特定する情報としてのみ表示されます。'
        },
        targetBinding: {
          title: 'ターゲットバインド',
          description: 'バインドはドメイン名から推測せず、サイトと管理対象ターゲットへ明確に紐付ける必要があります。'
        },
        certificateBindings: {
          title: '証明書バインド関係',
          description: '証明書の関係はドメイン名だけで判断せず、binding 上で明確にします。'
        },
        snapshots: {
          title: 'スナップショット',
          description: 'デプロイ前後とロールバック後の現場状態を直接確認できる必要があります。タスク記録だけを残してはいけません。'
        }
      }
    },
    deployment: {
      targetLocked: '更新対象を固定', latestVersionPointer: '現在の証明書の最新バージョンを自動適用',
      noCertificateAsset: 'デプロイ可能な証明書アセットがありません',
      title: '証明書デプロイ', description: 'このアプリケーション資産の証明書バージョンを選択します。システムはデプロイスナップショットを作成し、必要な事前確認を行ってデプロイを開始します。', dialogTitle: '証明書デプロイ', dialogDescription: '現在のアプリケーション資産だけに適用されます。デプロイプランはバックエンドのスナップショットと実行の境界として保持されます。', deployThisVersion: 'この証明書バージョンをデプロイ', loadingRecords: 'デプロイ記録を読み込み中...', emptyRecords: 'このアプリケーション資産にはデプロイ記録がありません。', preflightAvailable: '{count} 件の事前確認が返されました', preflightUnavailable: '事前確認は未実行です', rollbackUnavailable: 'ロールバックは要求されていません', fields: { status: 'デプロイ状態', latestRun: '最新実行', preflight: '事前確認', rollback: 'ロールバック', updatedAt: '更新日時' }, feedback: { preflightRunning: '事前確認の完了を待っています。', executionStarted: '事前確認が完了し、デプロイ実行を開始しました。' }, errors: { missingApplicationAssetId: '証明書デプロイを作成するにはアプリケーション資産 ID が必要です。', missingCertificateVersion: '現在の証明書供給ポリシーにはデプロイ可能な証明書バージョンがありません。', loadOptionsFailed: 'デプロイ可能な証明書バージョンを読み込めませんでした。', createPlanMissingId: 'デプロイスナップショットの作成後にプラン ID が返されませんでした。', deployFailed: '証明書デプロイに失敗しました。', preflightFailed: '証明書デプロイの事前確認に失敗しました。', preflightTimeout: '証明書デプロイの事前確認がタイムアウトしました。', loadRecordsFailed: 'アプリケーション資産のデプロイ記録を読み込めませんでした。' },
      dedicated: { kicker: '専用証明書', title: 'アプリ専用証明書', providerTypes: { acme: 'ACME', internalCa: '管理 CA' }, fields: { providerType: '発行方式', ca: '指定 CA', caStatus: 'CA 状態', custodyMode: '秘密鍵管理', certificate: '証明書状態', issuedAt: '申請日時', expiresAt: '有効期限', remainingDays: '残り日数' }, status: { available: '利用可能', unavailable: '利用不可', unknown: '不明' }, custody: { agentLocal: 'Agent ローカル管理', managedSecret: 'プラットフォーム管理' }, certificate: { exists: '発行済み', missing: '未発行' }, remainingDays: '残り {days} 日', reapply: '証明書を再申請', reapplyHint: 'デプロイ時に専用ドメイン証明書を再申請します。', deployCurrentHint: '現在発行済みの専用ドメイン証明書をデプロイします。', issuancePending: '専用証明書の申請を送信しました。発行完了後にデプロイしてください。' }
    },
    compatibilityModes: {
      unified: '統一プラグインバインド',
      legacy: 'レガシー互換',
      legacyAdapted: '統一バインドとレガシー設定の二重読み取り'
    },
    managementModes: {
      agent: 'Agent モード',
      agentDescription: 'Agent、サイトインスタンス、管理対象ターゲットをバインド',
      workflow: 'ワークフローモード',
      workflowDescription: '選択ワークフローバージョンと実行変数'
    },
    workflowVersionSelection: {
      pinned: '指定バージョンに固定',
      latestPublished: '常に最新の公開済みバージョンを使用'
    },
    loading: {
      agents: '読み込み Agent 中...',
      sites: '読み込みサイト中...',
      managedTargets: '読み込みターゲット中...',
      certificateFormats: '読み込み形式設定中...',
      workflows: '読み込みワークフロー中...',
      versions: '読み込みバージョン中...',
      gateways: '読み込み Gateway 中...',
      credentials: '認証情報を読み込み中...'
    },
    select: {
      agent: ' Agentを選択してください',
      siteInstance: 'サイトインスタンスを選択してください',
      managedTarget: '管理対象ターゲットを選択してください',
      certificateFormat: '証明書成果物設定を選択してください',
      workflow: 'ワークフローを選択してください',
      publishedVersion: '公開済みバージョンを選択してください',
      gateway: ' Gatewayを選択してください',
      variablePreset: 'プリセット変数を選択',
      credential: '認証情報を選択してください',
      generic: '選択',
      artifactFormat: '形式設定を選択してください',
      output: '出力項目を選択してください',
      optionalOutput: '選択しなくても構いません',
      updatePluginOptional: '任意。現在有効なプラグインを引き続き使用します'
    },
    validation: {
      variableNameRequired: '変数名前できませんとして空',
      variableNameInvalid: '変数 {name} の名前が不正です',
      variableDuplicated: '変数 {name} が重複しています',
      variableRequired: '変数 {name} 必須',
      variableMustBeNumber: '変数 {name} は数値である必要があります',
      variableMustBeJsonObject: '変数 {name} は JSON オブジェクトである必要があります',
      variableInvalidJson: '変数 {name} は有効な JSON ではありません',
      variableCredentialInvalid: '変数 {name} 必ず選択有効認証情報',
      certificateFormatRequired: '証明書変数 {name} 必ず選択証明書形式設定',
      certificateOutputRequired: '証明書変数 {name}.{slot} は出力項目を選択する必要があります',
      certificateOutputMissing: '証明書変数 {name}.{slot} で選択した出力項目が存在しません'
    },
    workflowVariableTypes: {
      string: '文字列',
      number: '数字',
      boolean: '真偽値',
      enum: '列挙',
      object: 'オブジェクト',
      file: 'ファイル',
      credential: '認証情報',
      certificate: '証明書'
    },
    wizard: {
      ariaLabel: 'アプリケーションアセット作成ステップ',
      steps: {
        basicEntry: '基本エントリ',
        deploymentMode: 'デプロイモード',
        confirmSave: '確認保存'
      },
      stepState: {
        active: '進行中',
        done: '完了',
        pending: '開始待ち',
        incomplete: '完了待ち',
        readyNext: '次のステップへ進めます',
        pendingSubmit: '送信待ち'
      },
      panels: {
        basicEntryTitle: '基本エントリ',
        basicEntryDescription: 'まずドメイン名、ポート、プロトコル、プラットフォームを入力し、アプリケーションエントリの識別情報を確定します。',
        agentTitle: 'Agent ターゲットバインド',
        agentDescription: 'Agent、サイトインスタンス、管理対象ターゲット、証明書成果物設定を選択します。',
        workflowTitle: 'ワークフロー実行設定',
        workflowDescription: '選択ワークフローバージョン、実行場所と変数、証明書変数はでランタイム注入。',
        confirmTitle: '確認保存',
        confirmDescription: 'アプリケーションエントリ、デプロイモード、実行パラメータを確認し、確認後にアプリケーションアセットへ書き込みます。'
      }
    },
    form: {
      createTitle: '手動追加アプリケーションアセット',
      editTitle: '編集アプリケーションアセット',
      createDescription: 'アプリケーションエントリを作成し、後続のデプロイに必要なターゲット情報をバインドします。',
      editDescription: 'アプリケーションエントリとデプロイターゲットのバインドを変更します。',
      createRequestCompleted: '作成リクエスト完了済み。',
      editRequestCompleted: '保存リクエスト完了済み。',
      agentCertificateFormatHint: 'Agent モードではは使用この証明書成果物設定生成デプロイマテリアル。',
      placeholders: {
        displayName: '例：本番サイトエントリ',
        verifyUrl: '例：https://example.com/health',
        siteName: '例：本番サイト',
        bindingInformation: '例：*:443:example.com',
        hostHeader: '例：example.com',
        sniName: '例：example.com'
      }
    },
    review: {
      accessEntry: 'アクセスエントリ',
      deploymentMode: 'デプロイモード',
      agentSiteTarget: 'Agent / サイト / ターゲット',
      workflowVersion: 'ワークフローバージョン',
      gatewayRunner: 'Gateway：{gateway}',
      variableCount: '{count} 個変数',
      onlyBasicEntry: '基本エントリのみ',
      autoGeneratedByEntry: 'アプリケーションエントリから生成'
    },
    workflowTarget: {
      title: 'ワークフローターゲット情報',
      description: 'ワークフロー資産表示、デプロイ後プローブ、DSL ターゲット変数同期に使用します。',
      dslSyncHint: 'DSL ターゲット変数に同期済み',
      advancedTitle: '詳細設定',
      advancedDescription: '既定のリスナー、リクエストドメイン、TLS 証明書名を上書きする場合のみ変更します。',
      expandAdvanced: '詳細設定を展開',
      collapseAdvanced: '詳細設定を折りたたむ',
      bindingInformationLabel: 'サービス待受ルール',
      bindingInformationHelp: 'サービスが待ち受けるアドレス、ポート、ドメインの組み合わせです。',
      hostHeaderLabel: 'アクセス要求ドメイン',
      hostHeaderHelp: 'HTTP Host ヘッダーの指定が必要な場合のみ変更します。',
      sniNameLabel: 'TLS 証明書ドメイン',
      sniNameHelp: 'TLS ハンドシェイク名がアクセスドメインと異なる場合のみ変更します。'
    },
    workflowVariables: {
      title: 'ワークフロー変数',
      configuredCount: '設定 {configured}/{total}済み',
      name: '変数名前',
      type: 'タイプ',
      value: '值',
      manual: '手動',
      empty: 'ワークフロー変数。はまだありません',
      noPublishedVersion: '公開済みワークフローバージョン後設定変数。を選択してください',
      certificateAutoInjected: '証明書バージョン由デプロイプラン選択、ランタイム自動注入。',
      certificateDescription: '証明書バージョンはデプロイプランで選択します。アプリケーションアセットでは下方で形式設定と出力項目をバインドし、実行時に {name}.outputs.*.content を注入します。',
      presets: {
        deviceHost: 'ターゲットホストまたはデバイスアドレス',
        sshUsername: 'SSH ユーザー名',
        credential: 'ワークフロー認証情報',
        certificate: '証明書成果物',
        targetPlatform: 'ターゲットプラットフォーム',
        apacheServiceName: 'Apache systemd サービス名',
        apacheSiteConfigPath: 'Apache サイト設定パス',
        certificateFilePath: '証明書目のパス',
        certificateKeyFilePath: '秘密鍵目のパス',
        backupRoot: '証明書バックアップ根ディレクトリ',
        expectedResponseContains: '検証応答含めるテキスト',
        virtualHostServerName: '虚拟ホスト ServerName'
      }
    },
    certificateBindings: {
      title: '証明書変数バインド',
      description: 'ワークフロー内の証明書変数に対して、証明書成果物設定と出力項目を選択します。',
      variableCount: '{count} 個証明書変数',
      defaultVariableDescription: '証明書成果物変数',
      noArtifactOutputs: '現在の形式設定には選択可能な出力項目がありません。'
    },
    certificateOutputs: {
      publicCertificateWithChain: '公開鍵証明書+証明書チェーン',
      publicCertificate: '公開鍵証明書',
      certificateChain: '証明書チェーン',
      privateKey: '秘密鍵',
      pemBundle: 'PEM 結合成果物',
      container: '{format} 容器',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id}（保存済み設定、現在一覧未戻る）',
      withPrivateKey: '含秘密鍵',
      withoutPrivateKey: '無秘密鍵'
    },
    snapshotTypes: {
      preDeploy: 'デプロイ前',
      postDeploy: 'デプロイ後',
      postRollback: 'ロールバック後',
      errorState: 'エラー態',
      rollbackPoint: 'ロールバックポイント'
    },
    errors: {
      loadWorkflowListFailed: 'ワークフロー一覧の読み込みに失敗しました',
      loadWorkflowVersionsFailed: 'ワークフローバージョンの読み込みに失敗しました',
      loadGatewayListFailed: 'ゲートウェイ一覧の読み込みに失敗しました',
      loadCertificateFormatsFailed: '証明書形式設定の読み込みに失敗しました',
      loadAssetDetailFailed: 'アプリケーションアセット詳細の読み込みに失敗しました',
      rollbackFailed: 'ロールバックの開始に失敗しました',
      loadTargetsFailed: 'サイトと管理対象ターゲットの読み込みに失敗しました',
      createAssetFailed: 'アプリケーションアセットの作成に失敗しました',
      pluginFormLoadFailed: 'プラグイン設定フォームの読み込みに失敗しました',
      pluginBindingCreateFailed: 'プラグインバインディングの保存に失敗しました',
      loadWorkflowCredentialsFailed: 'ワークフロー認証情報の読み込みに失敗しました',
      loadCredentialProfilesFailed: '資格情報プロファイルの読み込みに失敗しました',
      noAvailableSiteInstance: '利用可能なサイトインスタンスがありません。デバイス検出でフレームワークとサイトが報告されたことを確認してください。',
      managedTargetRediscoveryRequired: 'このサイトには管理対象がありません。デバイス検出を再実行してください。',
      noCompatibleManagedPlugin: 'この管理対象と互換性のある有効なプラグインがありません。',
      capabilityAssignmentMissing: 'この対象には有効なデプロイ機能の割り当てがありません。'
    },
    platforms: {
      appliance: 'デバイス',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: 'プラットフォーム',
      gateway: 'ゲートウェイ'
    },
    status: {
      archived: '归档済み',
      unknownStatus: '不明なステータス'
    },
    certificateSupply: { title: '証明書供給ポリシー', description: '手動証明書またはアプリ専用証明書を設定します。ポリシーの履歴は保持されます。', modeLabel: '証明書供給方式', manual: '証明書を手動選択', dedicated: '専用証明書を使用', certificateVersion: '証明書バージョン', selectCertificate: '現在のドメインに一致する証明書を選択', domainMatch: 'CN または SAN が {domain} をカバーする証明書のみ表示します。', provider: '発行 Provider', internalCa: 'Internal CA', acme: 'ACME', ca: '認証局', selectCa: 'CA を選択', profile: 'Certificate Profile', selectProfile: 'Profile バージョンを選択', acmeProvider: 'ACME Provider', acmeProfile: 'ACME Profile', selectAcmeProfile: 'ACME Profile を選択', selectProvider: 'Provider を選択', dnsProvider: 'DNS Provider', selectDnsProvider: 'DNS Provider を選択', secretRef: '資格情報 SecretRef', secretRefPlaceholder: 'secret://tenant/path', custodyMode: '鍵の保管場所', artifactMode: '配布アーティファクト', canSave: '保存可能', canIssue: '発行可能', canDeploy: 'デプロイ可能', lifecycle: 'ライフサイクル状態', errors: { loadFailed: '証明書供給ポリシーの読み込みに失敗しました。', previewFailed: '証明書供給ポリシーのプレビューに失敗しました。' } },
    common: {
      required: '必須',
      optional: '任意'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'リクエストに失敗しました'
    },
    banners: {
      importSucceeded: 'Certificate imported. New certificate version ID: {id}'
    },
    views: {
      eyebrow: 'Page mode',
      switchLabel: 'Certificate page view switch',
      modes: {
        user: 'User view',
        professional: 'Professional view'
      },
      descriptions: {
        user: 'Keep only the common flow: import a certificate, associate applications, and set automatic updates.',
        professional: 'Show certificate versions, chain state, and full technical details.'
      }
    },
    userView: {
      hero: {
        eyebrow: 'Common flow',
        title: 'Handle certificate updates by business flow',
        description: 'Import or replace the certificate first, then associate applications, and finally configure an automatic update plan. Most daily work does not need low-level technical details.',
        primaryAction: 'Import or replace certificate',
        secondaryAction: 'Switch to professional view'
      },
      summary: {
        ariaLabel: 'Certificate user view overview',
        managedCertificates: 'Managed certificates',
        expiredCertificates: 'Expired certificates',
        expiringSoonCertificates: 'Expiring soon',
        connectedApplications: 'Connected applications',
        activeAutomationPlans: 'Active automation plans'
      },
      steps: {
        title: 'Common flow',
        description: 'Follow this order. Most certificate updates do not require technical details.',
        status: {
          done: 'Done',
          todo: 'Pending'
        },
        import: {
          title: 'Import or replace certificate',
          description: 'Bring the new certificate material into the system. Application association and update plans continue from this certificate.',
          helperCompleted: '{count} certificate domains are already managed. You can keep replacing or adding certificate versions.',
          helperEmpty: 'Import the current certificate first. Application association and automatic plans depend on this step.',
          action: 'Start import'
        },
        applications: {
          title: 'Add application',
          description: 'Tell the system which application or site should use this certificate so deployment knows what to update.',
          helperCompleted: '{count} applications are already connected to the certificate flow.',
          helperEmpty: 'No applications are connected yet. Add them right after importing the certificate.',
          action: 'Add application'
        },
        automations: {
          title: 'Set automatic update plan',
          description: 'Arrange certificate updates to run automatically so renewals do not depend on manual work every time.',
          helperCompleted: '{count} active automatic plans are already enabled.',
          helperEmpty: 'No active automatic plan is enabled yet. Add one during a low-risk business window.',
          action: 'Set plan'
        }
      },
      common: {
        notAvailable: 'Not available',
        permissionRequired: 'Your current account does not have the required permission.'
      },
      focus: {
        currentSelectionTitle: 'Current certificate in focus',
        currentSelectionDescription: 'Switch to professional view to inspect versions, issuer, and the full chain details.',
        currentSelectionEmpty: 'No certificate domain selected yet',
        currentSelectionHint: 'Open the professional view from the attention list below, or switch directly to browse all certificates.',
        validUntil: 'Expires at: {value}',
        openProfessional: 'Open professional view',
        attentionTitle: 'Handle first',
        attentionDescription: 'Resolve expired or soon-to-expire certificates first, then finish connected applications and automatic plans.',
        assetAction: 'Open professional details',
        emptyTitle: 'No urgent certificate right now',
        emptyDescription: 'All imported certificates are currently still within their validity period.'
      },
      simple: {
        title: '証明書とアプリケーションの管理',
        subtitle: '証明書を管理し、使用しているアプリケーションを確認します',
        sections: {
          certificates: {
            title: '証明書管理',
            help: '有効期限や状態を含むすべての証明書を確認・管理します。'
          },
          applications: {
            title: 'アプリケーション連携',
            help: '証明書の利用先と更新頻度を確認します。'
          }
        },
        stats: {
          total: '証明書総数',
          expiring: 'まもなく期限切れ',
          expired: '期限切れ'
        },
        versionCount: '{count} バージョン',
        versionCountShort: '{count}',
        sourceLabels: {
          manual: '手動',
          acme: 'ACME',
          unknown: '不明'
        },
        fields: {
          expires: '有効期限',
          source: 'ソース',
          versions: 'バージョン'
        },
        empty: {
          title: '証明書はありません',
          description: '最初の証明書をインポートして管理を開始します。'
        },
        applications: {
          description: '選択した証明書を使用するアプリケーションと自動更新を確認します。',
          selectPrompt: '左側で証明書を選択してください',
          selectedCertificate: '選択中の証明書',
          connectedApps: '連携アプリケーション（{count}）',
          noApps: 'この証明書に連携されたアプリケーションはありません。',
          addApp: 'アプリケーションを追加',
          automationTitle: '自動更新の設定',
          activeAutomations: '有効な自動更新',
          totalAutomations: '自動更新プラン総数',
          automationDescription: '自動更新プランは証明書の状態を定期的に確認し、必要に応じて連携アプリケーションへ更新をデプロイします。'
        }
      }
    },
    detail: {
      backList: '戻る一覧',
      description: '証明書バージョンの詳細、形式別成果物、関連アセットを表示します。',
      title: '証明書詳細'
    },
    detailPanel: {
      sources: {
        agentContext: 'Agent上下文',
        platformBinding: 'プラットフォームバインド記録'
      },
      usage: {
        columns: {
          domainName: 'ドメイン名/ターゲット',
          assetName: 'アセット',
          frameworkName: 'フレームワーク',
          siteName: 'サイト名前',
          bindingType: 'バインドタイプ',
          usageSource: 'ソース',
          status: 'ステータス'
        },
        empty: '関連アセットはまだありません',
        toolbar: '関連アセット'
      },
      summary: {
        certificateName: '証明書名',
        logicalDomain: '逻輯ドメイン名',
        issuer: '発行者',
        subject: 'サブジェクト',
        serialNumber: 'シリアル番号',
        chainStatus: 'チェーンステータス'
      },
      sections: {
        subjectInfo: 'サブジェクト情報',
        issuerInfo: '発行者情報',
        certificateFields: '証明書フィールド',
        extensionFields: '扩展フィールド'
      },
      fields: {
        commonName: '公用名(CN)',
        organization: '組织(O)',
        organizationalUnit: '組织単位(OU)',
        countryRegion: '国家/地区(C)',
        stateProvince: '省/州(ST)',
        locality: '城市(L)',
        version: 'バージョン',
        signatureAlgorithm: '署名算法',
        publicKeyAlgorithm: '公開鍵アルゴリズム',
        fingerprintSha256: 'SHA-256 フィンガープリント',
        san: 'SAN',
        deployable: '可デプロイ',
        leafStorageRef: 'リーフ証明書引用',
        chainCertificateCount: 'チェーン証明書数',
        trustRootCertificate: '対象ルート証明書',
        trustRootStatus: 'ルート証明書状態',
        chainDiagnostics: 'チェーン診断'
      },
      fallbacks: {
        unknownCertificate: '不明な証明書',
        unknownIssuer: '不明な署発者',
        unnamedCertificate: '無名の証明書',
        unknownDomain: '不明なドメイン名',
        unknownSubject: '不明なサブジェクト',
        unknown: '不明',
        notPartOfCertificate: '証明書の一部ではありません',
        none: 'まだありません',
        emptyValue: '—',
        unknownType: '不明なタイプ',
        unknownResource: '不明なリソース',
        unknownTarget: '不明なターゲット'
      },
      values: {
        yes: '是',
        no: '否'
      },
      separators: {
        diagnostic: '；',
        list: '、'
      },
      diagnostics: {
        rootResolvedFromLibrary: 'インポート材料にルート証明書 {root} は含まれていません。プロジェクトのルート証明書庫で既に解決済みのため、デプロイ時に完全なチェーンを補完できます。'
      },
      chain: {
        roles: {
          leaf: 'リーフ証明書',
          root: 'ルート証明書',
          intermediate: '中間証明書'
        },
        title: '証明書チェーン',
        empty: '証明書チェーン情報はまだありません',
        subject: 'サブジェクト：{value}',
        issuer: '署発者：{value}'
      },
      errors: {
        loadFailedTitle: '証明書詳細の読み込みに失敗しました',
        code: 'エラーコード：{code}'
      },
      actions: {
        retry: '再試行'
      },
      states: {
        loading: '読み込み中...'
      },
      tabs: {
        ariaLabel: '証明書詳細タブ',
        detail: '詳細',
        usage: '関連アセット'
      },
      validity: {
        title: '証明書有効期間',
        notBefore: '生效：{value}',
        notAfter: '期限切れ：{value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'バージョン ID',
        createdAt: '作成時刻',
        format: '形式',
        secretRef: 'Secret 参照',
        status: 'ステータス'
      },
      create: '作成形式設定',
      createFailed: '形式の作成に失敗しました',
      description: '証明書 {id} の PEM/DER/PFX/JKS/P7B 形式設定への導線です。',
      empty: '形式設定はまだありません',
      fields: {
        alias: 'Alias（任意）',
        containsPrivateKey: '含める秘密鍵（PEM）',
        passwordSecretRef: 'passwordSecretRef（PFX/JKS）',
        targetFormat: 'ターゲット形式',
        versionId: 'バージョン ID'
      },
      hint: 'PFX/JKS ではシステム上の passwordSecretRef を必ず使用します。実際のデプロイ時は、証明書バージョンと形式設定に基づいてマテリアルを即時生成します。',
      loadFailed: '形式設定の読み込みに失敗しました',
      optionAvailable: '{label} - 利用可能',
      placeholders: {
        alias: '例： gcac-cert'
      },
      title: '証明書形式設定',
      toolbar: '形式設定一覧',
      unsupported: '{format} は現在の機能宣言では作成できません。'
    },
    import: {
      addTitle: '証明書を追加',
      backList: '証明書一覧へ戻る',
      description: '現在は PEM + KEY と PFX のみサポートします。PFX はファイルインポートのみ対応です。インポートマテリアルにはサーバー証明書、完全な中間証明書チェーン、秘密鍵を必ず含めてください。ルート証明書は必須ではありません。',
      errors: {
        importFailed: 'インポートに失敗しました',
        materialRequiredBeforeValidate: '先にインポートマテリアルの入力を完了してから検証を開始してください。',
        needPassedValidation: '先にステップ 3 の検証を完了し、検証合格後にインポートしてください。',
        validateFailed: '検証に失敗しました'
      },
      formats: {
        pem: {
          hint: 'サーバー証明書、完全な中間証明書チェーン、秘密鍵を同時に提供してください。ルート証明書は必須ではありません。不足している場合は警告を表示します。'
        },
        pfx: {
          hint: 'ファイルインポートのみ対応です。コンテナ内にはサーバー証明書、完全な中間証明書チェーン、秘密鍵を必ず含めてください。ルート証明書は必須ではありません。不足している場合は警告を表示します。'
        }
      },
      methods: {
        file: {
          hint: 'cert / key または .pfx ファイルがある場合に適しています。',
          label: '選択ファイル'
        },
        text: {
          hint: 'PEM テキストを直接貼り付け、臨時ファイルのアップロードを避けたい場合に適しています。',
          label: '貼り付けテキスト'
        }
      },
      title: '証明書をインポート'
    },
    importForm: {
      source: {
        title: '証明書の追加方法を選択',
        description: '既存の証明書をインポートするか、利用可能な場合は ACME 自動発行を使用します。',
        manual: {
          title: '既存の証明書をインポート',
          description: 'PEM、CRT、または PFX の証明書ファイルと秘密鍵をアップロードします。',
          recommended: '推奨'
        },
        acme: {
          title: 'ACME で証明書を申請',
          description: '認証局から証明書を自動で申請し、更新します。',
          unavailable: '現在利用できません'
        },
        unavailable: {
          title: 'ACME 発行チャネルが未設定です',
          description: 'このコンソールには利用可能な ACME 発行エントリがありません。既存の証明書をインポートするか、自動発行チャネルを設定してから再試行してください。'
        }
      },
      acme: {
        title: 'ACME 証明書を申請', loading: '発行経路を確認しています...', blocked: '申請経路の準備ができていません。表示された条件を解決してから更新してください。',
        status: { ready: '申請可能', blocked: '設定が必要', unknown: '状態不明' },
        fields: { issuer: '発行機関', email: '連絡先メール', domains: 'ドメイン名', dnsCredential: 'DNS 認証情報', keyType: '鍵の種類', autoRenew: '自動更新' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: '申請を送信', refresh: '状態を更新' },
        errors: { requestFailed: 'ACME リクエストに失敗しました' }
      },
      hints: {
        pemChainCheck: 'サーバー証明書、完全な中間証明書チェーン、秘密鍵をアップロードまたは貼り付けてください。システムが証明書チェーンと秘密鍵の一致関係を検証します。',
        pfxChainCheck: 'PFX/P12 ファイルをアップロードし、パスワードを入力してください。システムがコンテナ内のサーバー証明書、証明書チェーン、秘密鍵を解析します。',
        pfxFileOnly: 'PFX はファイルインポートのみサポートします。'
      },
      roles: {
        leaf: 'リーフ証明書',
        root: 'ルート証明書',
        intermediate: '中間証明書'
      },
      steps: {
        ariaLabel: '証明書インポートステップ',
        source: '追加方法',
        formatAndMethod: '形式と方式',
        materials: 'インポートマテリアル',
        validateAndImport: '検証かつインポート'
      },
      formatIntro: {
        title: '選択インポート形式と方式',
        description: '先確認マテリアル形式、再選択アップロードファイルまたは貼り付けテキスト。PFX 目前のみサポートファイルインポート。'
      },
      labels: {
        importType: 'インポートタイプ',
        importMethod: 'インポート方式',
        materialStatus: 'マテリアルステータス'
      },
      status: {
        supported: 'サポート済み',
        unsupported: '暫不サポート',
        completed: '完了',
        incomplete: '未完了',
        matched: '一致',
        unmatched: '不一致'
      },
      fields: {
        certificateChainFile: '証明書チェーンファイル',
        certificatePemText: '証明書 PEM テキスト',
        privateKey: '秘密鍵（{kind}）',
        file: 'ファイル',
        pemText: 'PEM テキスト',
        pfxFile: 'PFX/P12 ファイル',
        certificateName: '証明書名',
        pfxPassword: 'PFX パスワード'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----',
        certificateName: '例： example.com 生産証明書',
        required: '必須'
      },
      validation: {
        title: '検証インポートマテリアル',
        description: '送信インポート前先検証証明書チェーン、有効期間、秘密鍵一致とマテリアル完全な性。',
        passed: '検証合格、可以インポート',
        failed: '検証未合格'
      },
      report: {
        certificateSummary: '証明書サマリー',
        serialNumber: 'シリアル番号',
        validity: '有効期間',
        validityRange: '{start} 至 {end}',
        issuer: '発行者',
        issuerWithValue: '署発者：{value}',
        subject: 'サブジェクト',
        chainValidation: '証明書チェーン検証',
        chainStatus: 'チェーンステータス',
        certificateCount: '証明書数',
        privateKeyMatch: '秘密鍵一致',
        provided: '提供済み',
        matchResult: '一致結果',
        privateKeySource: '秘密鍵ソース',
        blockers: 'ブロック件',
        warnings: '警告'
      },
      selectedFile: '選択：{name}済み',
      upload: {
        choose: 'ファイルを選択',
        noFile: 'ファイル未選択'
      },
      importSuccess: 'インポート成功、証明書バージョン ID：{id}',
      actions: {
        validating: '検証中...',
        validate: '開始検証',
        cancel: 'キャンセル',
        previous: '前へ',
        next: '次へ',
        importing: 'インポート中...',
        import: '証明書をインポート'
      }
    },
    list: {
      filters: {
        keyword: 'キーワード',
        domain: 'ドメイン名',
        status: 'ステータス'
      },
      placeholders: {
        assetKeyword: 'ドメイン名 / SAN / フィンガープリント',
        primaryDomain: 'example.com',
        versionKeyword: '名前 / 発行者 / サブジェクト / バージョン ID'
      },
      columns: {
        notBefore: '開始日付',
        notAfter: '終了日付',
        associatedAsset: '関連アセット',
        applicationCount: 'アプリケーション数',
        sourceType: '追加方法',
        status: 'ステータス',
        certificateVersionId: '証明書バージョン ID'
      },
      sourceTypes: {
        manual: '手動インポート',
        internal_ca: '内部 CA',
        enterprise_ca: 'エンタープライズ CA',
        external_api: '外部 API',
        acme: 'ACME',
        unknown: '不明'
      },
      lifecycle: {
        unknown: '不明',
        expired: '期限切れ',
        expiringSoon: '期限切れ間近',
        valid: '有効'
      },
      fallbacks: {
        unselectedDomain: 'ドメイン名未選択',
        unnamedDomain: '無名のドメイン名',
        noSupplement: '补充情報はまだありません'
      },
      assets: {
        title: 'ドメイン名一覧',
        loadFailed: 'ドメイン名一覧の読み込みに失敗しました',
        empty: 'ドメイン名一覧はまだありません',
        unselectedTitle: 'ドメイン名未選択',
        unselectedDescription: '先で左侧選択1 個逻輯証明書ドメイン名。'
      },
      versions: {
        title: 'SSL 証明書一覧',
        titleWithDomain: '{domain} の SSL 証明書一覧',
        description: '右側表示現在ドメイン名下の SSL 証明書一覧、含める証明書名、開始日付、終了日付、発行者とサブジェクト情報。',
        loadFailed: 'SSL 証明書一覧の読み込みに失敗しました',
        emptyForDomain: 'このドメイン名下まだありません SSL 証明書',
        emptyForDomainDescription: '可以合格フィルター栏右側のインポート証明書により钮补充このドメイン名の証明書バージョン。',
        empty: ' SSL 証明書はまだありません',
        toolbar: '証明書バージョン一覧',
        currentCount: '現在 {count} 件'
      },
      actions: {
        toggleFilters: '絞り込み',
        clear: '清空',
        deleteRisk: '削除すると現在の証明書バージョンが直接削除されます。このバージョンがまだバインドまたはデプロイから参照されている場合、システムはこの操作を拒否します。'
      },
      errors: {
        deleteFailed: '削除に失敗しました',
        materialRequiredForFormat: '必ず提供現在形式对応の証明書マテリアル。',
        importFailedWithCheck: 'インポート失敗、チェック入力マテリアル。',
        validateFailedWithCheck: '検証失敗、チェック入力マテリアル。'
      },
      import: {
        description: '現在はのみサポート PEM + KEY 和 PFX；毎回インポート都必ず含めるサーバー証明書、完全な中間証明書チェーンと秘密鍵。ルート証明書は必須ではありません。不足している場合は警告を表示します。秘密鍵はシステムの Secret ストレージにのみ保存、API レスポンスには返されません。'
      }
    },
    trustRoots: {
      title: 'Root certificate management',
      description: 'View the project root certificate inventory, source observations, and leaf-version relations in a modal without leaving the certificate inventory page.',
      actions: {
        open: 'Root certificates',
        refresh: 'Refresh',
        expandVersions: 'Expand related versions',
        collapseVersions: 'Collapse related versions'
      },
      toolbar: {
        title: 'Root certificate inventory',
        description: '{count} root views are currently detected.'
      },
      summary: {
        managedVersions: 'Root views',
        resolvedVersions: 'Root acquired',
        missingVersions: 'Root missing',
        invalidChainVersions: 'Invalid chains',
        targetRoot: 'Target root fingerprint: {fingerprint}',
        rootFingerprintUnavailable: 'Target root fingerprint is not available yet',
        relatedAssetCount: '{count} related assets'
      },
      detail: {
        subtitle: 'Shows the root certificate summary, source observations, and related leaf certificate versions.'
      },
      fields: {
        fingerprintSha256: 'SHA-256 fingerprint',
        serialNumber: 'Serial number',
        subject: 'Subject',
        issuer: 'Issuer',
        notBefore: 'Valid from',
        notAfter: 'Valid until',
        relatedAssets: 'Related certificate inventory',
        relatedVersions: 'Related certificate versions'
      },
      sections: {
        observations: 'Source observations',
        relatedAssets: 'Related certificate inventory',
        versionRelations: 'Leaf certificate relations',
        managedCertificates: 'Managed certificate root status'
      },
      states: {
        loadFailed: 'Failed to load root certificate records',
        detailFailed: 'Failed to load root certificate details',
        assetLoadFailed: 'Failed to load related certificate inventory',
        emptyTitle: 'No root certificate records',
        emptyDescription: 'The current project does not have any imported root certificates yet.',
        unselectedTitle: 'No root certificate selected',
        unselectedDescription: 'Select a root certificate record from the list on the left first.',
        rootNotInLibrary: 'This root certificate is not in the library yet. The related assets and statuses below are inferred from managed certificate chains.',
        emptyObservations: 'No source observations yet',
        emptyRelations: 'No related leaf certificate versions',
        emptyAssets: 'No certificate inventory are currently related to this root'
      },
      validationStatus: {
        pending: 'Pending',
        verified: 'Verified',
        rejected: 'Rejected',
        expired: 'Expired'
      },
      sourceTypes: {
        control_plane_node: 'Control plane Node Root Store',
        openssl: 'Control plane OpenSSL store',
        windows: 'Control plane Windows Root Store',
        internet: 'Controlled internet source',
        manual: 'Manual import',
        managed_host_inspect: 'Managed host targeted inspect'
      },
      observationStatus: {
        candidate: 'Candidate',
        accepted: 'Accepted',
        rejected: 'Rejected',
        failed: 'Failed'
      },
      relations: {
        selected_root: 'Selected root',
        candidate: 'Candidate root'
      },
      resolutionStatus: {
        resolved: 'Resolved',
        ambiguous: 'Ambiguous',
        missing: 'Missing',
        invalid: 'Invalid'
      },
      rootStatus: {
        resolved: 'Root acquired',
        missing: 'Root missing',
        invalid_chain: 'Invalid chain'
      }
    },
    usages: {
      backDetail: '戻る詳細',
      columns: {
        domainName: 'ドメイン名/ターゲット',
        resourceId: 'リソース ID',
        resourceType: 'リソースタイプ',
        status: 'ステータス',
        updatedAt: '更新時刻'
      },
      description: '証明書 {id} のバインド、デプロイターゲットとリソース引用。',
      empty: '使用関係はまだありません',
      loadFailed: '使用関係の読み込みに失敗しました',
      title: '証明書使用関係',
      toolbar: '使用関係'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: 'ユーザー名 + パスワード',
        usernamePasswordWithUsername: 'ユーザー名 + パスワード / {username}',
        sshKey: 'SSH 秘密鍵',
        sshKeyWithUsername: 'SSH 秘密鍵 / {username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: '调用结构化 HTTP 接口、取代分散の curl コマンド。'
        },
        browser: {
          displayName: 'ブラウザステップ',
          description: 'ログイン済みブラウザセッションでページを移動、抽出、検証します。'
        },
        ssh: {
          displayName: 'SSH コマンド',
          description: '実行する SSH コマンドを宣言、のみ保存接続と認証情報引用。'
        },
        sftp: {
          displayName: 'SFTP アップロード/ダウンロード',
          description: '合格正式 SFTP step アップロードまたはダウンロードファイル、适合証明書と設定インストール。'
        },
        scp: {
          displayName: 'SCP アップロード/ダウンロード',
          description: '合格 SCP コピーファイル、适合简単ホストファイル分発。'
        },
        verify: {
          displayName: '検証',
          description: '对 HTTP ステータス、テキスト、正则または証明書フィンガープリント做断言。'
        },
        condition: {
          displayName: '分支判断',
          description: '根拠変数存で性または值决定後継パス。'
        },
        transform: {
          displayName: '変換',
          description: 'JSONata で上流出力を新しいワークフローコンテキスト変数に変換します。'
        },
        foreach: {
          displayName: 'コレクション反復',
          description: '動的コレクションを順番に反復し、各要素に同じ子ステップを実行します。'
        },
        checkpoint: {
          displayName: '復旧チェックポイント',
          description: 'デバイス書き込み前に検証可能なリモート状態の要約を保存します。'
        },
        pluginAction: {
          displayName: 'プラグイン原子アクション',
          description: 'DSL で明示された単一のプラグインアクションを呼び出します。順序やロールバックは管理しません。'
        },
        wait: {
          displayName: '待機',
          description: '指定した秒数待機してから実行を続行します。'
        },
        manual: {
          displayName: '手動確認',
          description: 'ワークフローを一時停止し、手動確認後に続行します。'
        }
      },
      fields: {
        command: 'コマンド',
        connectionRef: '接続変数',
        contentRef: '内容変数',
        credential: '認証情報',
        description: '説明',
        direction: '方向',
        expected: '期望值',
        expectedHostKeyFingerprint: 'Host Key フィンガープリント',
        hostKeyPolicy: 'Host Key ポリシー',
        hostRef: 'ホスト変数',
        inputRef: '入力変数',
        instruction: '確認説明',
        localPath: 'ローカルパス',
        mode: 'ファイル権限',
        operator: '操作符',
        remotePath: 'リモートパス',
        seconds: '待機秒数',
        temporaryPath: '一時パス',
        timeoutMs: 'タイムアウト ms',
        timeoutSeconds: '超時秒数',
        transformInput: '変換入力',
        itemsPath: 'コレクションパス',
        itemVariable: '要素変数',
        indexVariable: 'インデックス変数',
        maxItems: '最大項目数',
        foreachSteps: '子ステップ JSON',
        checkpointName: 'チェックポイント名',
        checkpointCapture: '取得パス JSON',
        requiredForRollback: 'ロールバック必須',
        pluginId: 'プラグイン ID',
        capability: 'Capability',
        actionId: 'アクション ID',
        actionContractVersion: 'アクション契約バージョン',
        actionInput: 'アクション入力 JSON',
        inputSchemaSha256: '入力 Schema ダイジェスト',
        outputSchemaSha256: '出力 Schema ダイジェスト',
        writeEffect: '書き込み効果',
        idempotencyKeyRef: '冪等キー参照',
        outputFormat: '出力形式',
        usernameVariable: 'ユーザー名変数',
        variable: '変数',
        verifyType: '検証タイプ',
        browserAction: 'ブラウザ操作',
        browserUrl: 'ページ URL',
        browserExtractions: '抽出 JSON',
        browserVerification: '検証 JSON'
      },
      options: {
        boolean: { yes: 'はい', no: 'いいえ' },
        direction: {
          download: 'ダウンロード',
          upload: 'アップロード'
        },
        hostKeyPolicy: {
          manualApproval: '手動承認',
          strict: '厳格検証',
          trustOnFirstUse: '首回信任'
        },
        operator: {
          equals: '等于',
          exists: '存で',
          notEquals: '不等于',
          notExists: '不存で'
        },
        transformFormat: {
          raw: '生値',
          jsonString: 'JSON 文字列'
        },
        verifyType: {
          certificateFingerprint: '証明書フィンガープリント',
          httpStatus: 'HTTP ステータス',
          regex: '正则一致',
          textContains: 'テキスト含める'
        }
      },
      stages: {
        backup: {
          title: 'バックアップ',
          description: '保留可ロールバックマテリアル。'
        },
        install: {
          title: 'インストール',
          description: 'デプロイ証明書または設定。'
        },
        prepare: {
          title: '準備',
          description: '接続、変数、マテリアルを準備します。'
        },
        refresh: {
          title: '更新',
          description: '重載サービスまたは更新ターゲット。'
        },
        verify: {
          title: '検証',
          description: '確認結果符合预期。'
        }
      },
      defaults: {
        displayName: '{name} ワークフロー',
        nodes: {
          backupExistingCertificate: 'バックアップ既存証明書',
          reloadService: '重載サービス'
        },
        variables: {
          certificatePaths: {
            description: 'ターゲット証明書パス設定'
          },
          credential: {
            description: '接続認証情報'
          },
          deviceHost: {
            description: 'ターゲットホスト'
          },
          serverCert: {
            description: '待デプロイサーバー証明書マテリアル',
            outputs: {
              certFile: {
                description: 'サーバー証明書ファイル'
              },
              keyFile: {
                description: '秘密鍵ファイル'
              }
            }
          },
          sshUsername: {
            description: 'SSH ログインユーザー名'
          },
          verifyUrl: {
            description: 'デプロイ後検証アドレス'
          }
        },
        config: {
          conditionDescription: 'チェックターゲットホスト変数是否存で',
          manualInstruction: '確認してくださいターゲットデバイス証明書切り替えへ新バージョン済み。'
        }
      },
      variableFlow: {
        system: 'システム',
        variable: '変数'
      },
      errors: {
        unknownNodeType: '不明なノードタイプ：{type}',
        missingWorkflowDsl: 'ワークフロー DSL を取得できませんでした'
      }
    },
    canvasEditor: {
      summary: 'ノード {nodes} 個、接続線 {edges} 件、変数 {variables} 個',
      stageNodeCount: '{count} 個ノード',
      copyLabel: '{label} 副本',
      actions: {
        addVariable: '追加変数',
        collapseBottomPanelAria: '折叠底部控制パネル',
        collapseDown: '向下折叠',
        copy: 'コピー',
        copyNode: 'コピーノード',
        delete: '削除',
        deleteNode: '削除ノード',
        expandBottomPanelAria: '展開底部控制パネル',
        expandPanel: '展開パネル',
        layout: '整理布局',
        mockCurrentNode: 'のみ模拟現在ノード',
        mockRunning: '模拟中...',
        paste: '貼り付け',
        pasteNode: '貼り付けノード',
        realRun: '真実試跑現在ノード',
        realRunHttp: '真実 HTTP 試跑現在ノード',
        realRunRunning: '試跑中...',
        realRunSsh: '真実 SSH 実行現在ノード',
        realRunTransfer: '真実ファイル传輸試跑',
        redo: '重做',
        saveDraft: '保存ドラフト',
        saving: '保存中...',
        undo: '撤销',
        zoomIn: '放大',
        zoomOut: '缩小'
      },
      aria: {
        bottomPanel: '下部パネル',
        canvasArea: 'キャンバスゾーン',
        dslPanel: 'DSL パネル',
        nodePalette: 'ノードライブラリ',
        propertiesPanel: 'プロパティパネル',
        runtimePanel: '実行時パネル',
        toolbar: 'ワークフローキャンバスツールバー',
        validationPanel: '検証パネル',
        variablesPanel: '変数パネル'
      },
      credentialHints: {
        savedApiKey: '保存済みの API Key',
        savedBearerToken: '保存済みの Bearer token',
        savedSshSftp: '保存済みの SSH / SFTP 認証情報',
        savedUsernamePassword: '保存済みのユーザー名 + パスワード'
      },
      credentials: {
        emptyCreateHint: '利用可能な認証情報はまだありません。一覧ページの認証情報管理で先に作成してください。',
        loading: '認証情報一覧を読み込み中…'
      },
      dsl: {
        title: 'DSL インポートと上書き',
        hint: '外部 DSL JSON を直接貼り付けるか、ローカル DSL ファイルを選択できます。インポートはブラウザー内の現在のキャンバスのみ上書きし、「ドラフトを保存」をクリックして初めて新しいワークフローバージョンが生成されます。',
        selectFile: 'DSL ファイルを選択',
        actions: {
          importOverwrite: 'DSL をインポートしてキャンバスを上書き',
          resetToCanvas: '現在のキャンバス DSL を反映',
          openStepEditor: 'ダイアログで現在のノード DSL を編集',
          openStepEditorAria: 'ダイアログで現在のノード DSL を編集',
          applyStepEditor: '変更を適用',
          cancelStepEditor: 'キャンセル'
        },
        editor: {
          title: '現在のノード DSL を編集',
          description: '完全な JSON を編集して適用します。無効な JSON では現在のノードを上書きしません。',
          ariaLabel: '現在のノード DSL 内容'
        },
        messages: {
          fileLoaded: 'ファイルを読み込みました：{fileName}',
          imported: 'DSL をインポートし、現在のキャンバスを上書きしました。合計 {count} 個のノードです。',
          resetToCompiled: 'コンパイル後の DSL を反映しました。'
        },
        errors: {
          importFailed: 'DSL インポートに失敗しました',
          invalidTopLevel: 'DSL のトップレベル構造が無効です。オブジェクトである必要があります。'
        }
      },
      empty: {
        selectNodeToEdit: 'ノードを選択してから属性を編集してください。'
      },
      errors: {
        backendValidationFailed: '検証に失敗しました',
        credentialsLoadFailed: 'ワークフロー認証情報の読み込みに失敗しました',
        missingStepName: 'ステップ名が不足しています',
        missingWorkflowDsl: 'ワークフロー DSL を取得できませんでした'
      },
      fields: {
        authType: '認証タイプ',
        clientCertificate: 'クライアント証明書',
        clientPrivateKey: 'クライアント秘密鍵',
        command: 'コマンド',
        connectionVariable: '接続変数',
        contentRef: '内容引用',
        cookieName: 'Cookie 名',
        credential: '認証情報',
        credentialSelector: '認証情報セレクター',
        defaultValue: 'デフォルト値',
        deliveryLocation: '受け渡し場所',
        description: '説明',
        direction: '方向',
        fileMode: 'ファイル権限',
        headerName: 'Header 名',
        hostRefOrHostname: 'ホスト変数 / ホスト名',
        hostVariable: 'ホスト変数',
        keyName: 'Key 名',
        localPath: 'ローカルパス',
        newNodeStage: '追加ノードステージ',
        nodeName: 'ノード名',
        remotePath: 'リモートパス',
        requestBody: 'リクエスト本文',
        requestBodyStructuredHint: 'このリクエストは form または multipart の構造化フィールドを使用します。DSL エディターで編集してください。',
        requestBodyEmptyHint: 'このリクエストには本文が設定されていません。',
        required: '必須',
        secretValue: 'シークレット値',
        sensitive: '機密',
        stage: '所属ステージ',
        temporaryPath: '一時パス',
        timeoutSeconds: '超時秒数',
        type: 'タイプ',
        username: 'ユーザー名',
        variableName: '変数名'
      },
      options: {
        download: 'ダウンロード',
        manualInput: '手動入力',
        notSelected: '未選択',
        upload: 'アップロード'
      },
      runtime: {
        noCredentialVariables: '現在ワークフロー没有認証情報変数。',
        noExtraVariables: '現在のノードには追加のランタイム変数がありません。'
      },
      sections: {
        httpAuth: 'HTTP 認証',
        nodePalette: 'ノードライブラリ',
        properties: 'プロパティパネル',
        referenceFlow: '引用流',
        runtimeCredentialVariables: 'ランタイム認証情報変数',
        runtimeVariables: 'ランタイム変数',
        singleNodeTest: '単ノード測試実行',
        variableConfig: '変数設定'
      },
      tabs: {
        runtime: '実行時',
        validation: '検証',
        variables: '変数'
      },
      test: {
        cause: '原因',
        code: 'コード',
        emptyHint: '選択ノード後可実行模拟または真実試跑。',
        error: 'エラー',
        executionPlan: '実行プラン',
        exitCode: '終了コード',
        failureDetails: '失敗詳細',
        hint: '測試提示',
        logs: 'ログ',
        nodeOutput: 'ノード出力',
        running: '実行中',
        stage: 'ステージ',
        stderr: '標準エラー',
        stdout: '標準出力',
        suggestion: '推奨',
        target: 'ターゲット',
        errors: {
          mockRunFailed: '模拟実行に失敗しました',
          realRunFailed: '真実試跑に失敗しました'
        },
        messages: {
          mockCompleted: '模拟実行完了。',
          mockFailed: '模拟実行失敗。',
          realCompleted: '真実試跑完了。',
          realFailed: '真実試跑失敗。'
        }
      },
      validation: {
        levels: {
          error: 'エラー',
          risk: 'リスク',
          warning: '警告'
        },
        location: {
          canvas: 'キャンバス',
          edge: '接続線',
          fieldSuffix: 'フィールド',
          node: 'ノード'
        },
        noBlockingErrors: '没有ブロックエラー。'
      },
      variables: {
        customRuntimeDescription: 'カスタム実行変数',
        notUsed: '未使用',
        usedBy: '使用場所：{nodes}'
      }
    },
    templates: {
      title: 'ワークフロー',
      resourceName: 'ワークフロー',
      description: 'によりキャンバスドラフト管理 CURL/SSH/SFTP ワークフローバージョン、公開ステータスと変更記録。',
      pluginSources: {
        createTitle: 'プラグインから作成', applyTitle: 'プラグインからドラフト作成', description: '有効なプラグインの証明書ワークフローのみ表示します。先にワークフローを選択し、その後プラグインバージョンを選択します。',
        createAction: 'ワークフローを作成', applyAction: 'ドラフトを作成', currentTarget: '現在のワークフロー：{name}', namePlaceholder: 'ワークフロー名を入力', loading: 'プラグインソースを読み込み中...', empty: '利用可能なプラグインソースがありません。', version: 'プラグインバージョン', workflowVersion: 'ワークフローバージョン', versionSource: 'バージョンソース：{plugin} / {version} / {capability}',
        capabilities: { deploy: '証明書デプロイ', rollback: '証明書ロールバック' }, errors: { loadFailed: 'プラグインソースの読み込みに失敗しました', nameRequired: 'ワークフロー名を入力してください', missingApplyTarget: '対象ワークフローがありません', actionFailed: 'プラグインワークフローのコピーに失敗しました' }
      },
      origins: { user: 'カスタム', plugin_internal: 'プラグイン内蔵' },
      actions: {
        addVersion: '追加バージョン',
        applyTemplate: '適用テンプレート',
        cancel: 'キャンセル',
        close: '閉じる',
        createBlank: '空白新建',
        credentialManagement: '認証情報管理',
        delete: '削除',
        detail: '詳細',
        edit: '編集',
        publishVersion: '公開バージョン',
        rename: '名前を変更',
        saveName: '名前を保存',
        saveNote: '保存メモ',
        switchVersion: '切り替えバージョン',
        templateManagement: 'テンプレート管理',
        versionManagement: 'バージョン管理'
      },
      states: {
        creating: '作成中...',
        loading: '読み込み中...',
        processing: '処理中...',
        saving: '保存中...'
      },
      fields: {
        actions: '操作',
        createdAt: '作成時刻',
        currentStatus: '現在のステータス',
        currentVersion: '現在バージョン',
        currentVersionId: '現在バージョン ID',
        id: 'ワークフロー ID',
        name: 'ワークフロー名前',
        origin: '由来',
        note: 'メモ',
        status: 'ステータス',
        updatedAt: '更新時刻'
      },
      filters: {
        showNonDeployment: '非デプロイワークフローを表示'
      },
      empty: {
        description: '先作成キャンバスドラフト、再に基づくバージョン公開へ正式経路。',
        noChangeSummary: '没有変更説明。',
        noChangeSummaryShort: '没有変更説明',
        noVersions: 'バージョン。はまだありません',
        title: 'ワークフローはまだありません'
      },
      tabs: {
        summary: '概要',
        versions: 'バージョン'
      },
      versionStatuses: {
        disabled: '無効化済み',
        draft: 'ドラフト',
        published: '公開済み'
      },
      detail: {
        description: '表示ワークフロー詳細、キャンバスドラフトとバージョン清単。',
        publishedVersion: '現在公開バージョン {version}',
        title: 'ワークフロー詳細',
        titleWithName: 'ワークフロー {name}'
      },
      rename: {
        title: 'ワークフロー名',
        description: '履歴バージョンを書き換えず、一覧と詳細に表示する名前を変更します。',
        placeholder: 'ワークフロー名を入力',
        messages: { success: 'ワークフロー名を更新しました。' },
        errors: { required: 'ワークフロー名は必須です。', failed: 'ワークフロー名の変更に失敗しました。' }
      },
      versionManager: {
        description: '管理ワークフローバージョンの新建と公開、不涉およびキャンバス内容の変更。',
        titleWithName: 'バージョン管理：{name}'
      },
      changeSummaries: {
        createFromPlugin: 'プラグイン機能からワークフローを作成',
        applyFromPlugin: 'プラグイン機能からドラフトを作成',
        applyFromFileTemplate: 'からファイルテンプレート上書きワークフロードラフト',
        createCanvasDraft: 'フロントエンドキャンバス作成ワークフロードラフト',
        createFromFileTemplate: 'からファイルテンプレート作成ワークフロードラフト',
        createVersionDraft: 'バージョン管理作成新バージョンドラフト',
        saveCanvasDraft: 'キャンバスエディター保存ドラフトバージョン'
      },
      messages: {
        canvasDraftUpdated: '現在ドラフトバージョン更新済み。',
        switchedVersion: '{version} に切り替えました。',
        versionDraftCreated: '新バージョンドラフト作成済み。',
        versionNoteUpdated: 'バージョンメモ更新済み。'
      },
      errors: {
        createVersionFailed: 'ワークフローバージョンの作成に失敗しました',
        loadVersionsFailed: 'ワークフローバージョンの読み込みに失敗しました',
        missingWorkflowDsl: 'ワークフロー DSL を取得できませんでした',
        publishVersionFailed: '公開ワークフローバージョンに失敗しました',
        saveCanvasDraftFailed: 'キャンバスドラフトの保存に失敗しました',
        updateVersionNoteFailed: '更新バージョンメモに失敗しました'
      },
      delete: {
        riskText: '削除では無効化このワークフローおよび其全部バージョン、一覧中不再表示；履歴実行記録しません被書き換え。'
      },
      loading: {
        versions: '読み込みバージョン中...'
      },
      fileTemplates: {
        applyAction: 'によりテンプレート上書き現在ワークフロー',
        applyTitle: '用ファイルテンプレート上書きワークフロー',
        createAction: 'によりテンプレート作成ワークフロー',
        createTitle: 'からファイルテンプレート新建ワークフロー',
        currentTarget: '現在ターゲット：{name}',
        description: 'テンプレートファイル由来組み込みテンプレート庫またはユーザーインポートディレクトリ。上書き既存ワークフロー時、は作成新のドラフトバージョン、しません書き換え履歴バージョン。',
        empty: '可識別のワークフローテンプレートファイル。はまだありません',
        identifier: '標識 {name}',
        invalid: '無効',
        invalidFile: 'ファイル無効',
        loading: 'スキャンファイルテンプレート中...',
        valid: '利用可能',
        sources: {
          builtin: '組み込み',
          userImported: 'ユーザーインポート'
        },
        errors: {
          actionFailed: '実行ファイルテンプレート动作に失敗しました',
          loadFailed: 'ワークフローファイルテンプレートの読み込みに失敗しました',
          missingApplyTarget: '待上書きのワークフローターゲットが不足しています'
        }
      },
      credentials: {
        actions: {
          create: '作成認証情報'
        },
        addTitle: '追加認証情報',
        count: '{count} 個',
        description: '集中管理ワークフロー所必要のログイン認証情報と API 認証情報、サポートでキャンバスとノード中直接選択复用。',
        empty: '認証情報記録。作成後可直接で変数、SSH ノードと HTTP ノード里選択。はまだありません',
        loading: '認証情報を読み込み中…',
        registeredTitle: '登録済み認証情報',
        title: '認証情報管理',
        fields: {
          deliveryLocation: '受け渡し場所',
          headerOrParam: 'Header / パラメータ名',
          name: '認証情報名前',
          referenceLocation: '引用場所',
          storageType: 'ストレージタイプ',
          type: '認証情報タイプ',
          username: 'ユーザー名'
        },
        kinds: {
          common: {
            family: '汎用'
          },
          sshKey: {
            title: 'SSH 秘密鍵'
          },
          usernamePassword: {
            title: 'ユーザー名 + パスワード'
          }
        },
        secretLabels: {
          password: 'パスワード',
          sshKey: 'SSH 秘密鍵'
        },
        placeholders: {
          apiKey: '入力 API Key',
          bearer: '入力 Bearer token',
          password: '入力ログインパスワード',
          sshKey: '貼り付け PEM 形式秘密鍵'
        },
        messages: {
          created: '認証情報作成済み、可直接でワークフロー変数、SSH ノードと HTTP ノード中選択。'
        },
        errors: {
          createFailed: '認証情報の作成に失敗しました',
          loadFailed: '認証情報の読み込みに失敗しました',
          missingCreatedId: '作成認証情報未戻る有効な番号'
        }
      }
    }
  },
  monitoring: {
    tls: monitoringTlsJaJP,
    actions: {
      add: '監視を追加',
      probe: 'サイトを検査',
      probing: '検査中...',
      refresh: 'データを更新',
      refreshing: '更新中...',
      remove: '削除'
    },
    errors: {
      addFailed: '監視対象の追加に失敗しました',
      deleteFailed: '監視対象の削除に失敗しました',
      invalidTarget: '監視対象データが無効です',
      loadFailed: '監視データの読み込みに失敗しました',
      probeFailed: 'サイト検査リクエストに失敗しました',
      updateIntervalFailed: '検査間隔の更新に失敗しました'
    },
    empty: {
      actualCertificate: '測定済みの TLS 証明書はまだありません。HTTPS 対象はサイト検査時に証明書情報を自動収集します。',
      description: '右上の「監視を追加」から対象を追加してください。設定した間隔でサイトを検査し、証明書情報を収集します。',
      noAddableAssets: '追加できるアプリケーション資産はありません。既存の対象は詳細画面で検査間隔を調整できます。',
      observedCertificateHistory: '関連付けられた証明書バージョンはまだありません。サイト検査で最初の証明書を取得すると自動的に保存します。',
      probeHistory: '検査履歴はありません。',
      riskEvents: '関連イベントはありません。',
      title: '監視対象はありません'
    },
    sections: {
      actualCertificate: '現在サイトで測定された証明書',
      actualCertificateHint: 'サイト検査時に自動収集',
      observedCertificateHistory: '関連付けられた証明書バージョン',
      observedCertificateHistoryHint: '測定された TLS 証明書の変更に応じてバージョンを保存',
      probeHistory: '検査履歴',
      probeHistoryHint: 'システムによる直近 20 件の検査結果',
      riskEvents: 'リスクイベント',
      riskEventsHint: '証明書チェーン、ドメイン、フィンガープリント、実行状態',
      targets: '監視対象'
    },
    labels: {
      applicationAsset: 'アプリケーション資産',
      currentTarget: '現在の対象',
      probeInterval: '検査間隔',
      secondsUnit: '秒',
      millisecondsUnit: 'ms'
    },
    metrics: {
      availability: '可用性',
      certificateStatus: '証明書ステータス',
      latency: 'アクセス遅延',
      observedCertificateChanges: '測定証明書の変更'
    },
    probe: {
      completed: '検査完了',
      emptyHistoryBlock: '検査 {index}：結果はまだありません',
      latencyNotCollected: '遅延は未収集',
      recentAria: '直近 10 件の検査結果',
      waiting: 'サイト検査を待機中'
    },
    status: {
      error: 'エラー',
      none: '実行待ち',
      ready: '正常',
      warning: '警告',
      removed: '削除済み'
    },
    warnings: {
      certificateNotApplied: 'システム検査でドメイン証明書の最新バージョンが適用されていないことを検出しました',
      chainVerificationFailed: 'システム検査で証明書チェーンの検証失敗を検出しました'
    },
    fallback: {
      noEndpoint: 'アクセス先が設定されていません',
      noFingerprint: 'フィンガープリントなし',
      notClosed: '未終了',
      noSummary: '概要なし',
      notCollected: '未収集',
      notSelected: '未選択',
      unknownAsset: '不明な資産',
      removedAsset: '{name}（削除済み）',
      unknownCertificate: '不明な証明書',
      unknownIssuer: '不明な発行者',
      unnamedEvent: '名前のないイベント'
    },
    certificate: {
      actualCertificate: '測定証明書',
      chainUntrusted: 'システムの信頼チェーンで信頼されていません',
      chainVerification: 'チェーン検証',
      chainVerified: 'チェーン検証済み',
      chainVerifyFailedWithReason: 'チェーン検証に失敗しました：{reason}',
      collectedAt: '収集日時',
      issuer: '発行者',
      serialNumber: 'シリアル番号',
      sha256Fingerprint: 'SHA-256 フィンガープリント',
      subject: 'サブジェクト',
      validity: '有効期間',
      validityRange: '{start} ～ {end}'
    },
    columns: {
      certificateName: '証明書名',
      changedAt: '変更日時',
      closedAt: '警告終了時刻',
      currentStatus: '現在の状態',
      expiresAt: '有効期限',
      issuerName: '発行者名',
      latency: '遅延',
      occurredAt: '発生時刻',
      result: '結果',
      source: 'ソース',
      status: 'ステータス',
      time: '時刻',
      warningContent: '警告内容'
    },
    dialog: {
      defaultMetricsHint: '可用性、アクセス遅延、証明書情報、証明書履歴を標準で監視します。',
      description: 'アプリケーション資産から対象を選択すると、可用性、アクセス遅延、証明書情報、証明書履歴を収集します。',
      loadingAssets: '資産を読み込み中...',
      selectAsset: 'アプリケーション資産を選択',
      title: '監視を追加'
    },
    source: {
      controlPlane: 'プラットフォーム'
    },
    targets: {
      assetCount: '{count} 件の資産',
      lazyLoadHint: '{shown} / {total} 件を読み込み中、スクロールしてさらに読み込む'
    }
  },
  login: {
    visualLabel: '製品説明',
    brand: 'GCAC',
    brandSecondary: '証明書集中管理プラットフォーム',
    headlinePrefix: '証明書管理を',
    headlineHighlight: 'よりスマートに',
    headlineSuffix: '、より安全に',
    intro: '証明書アセットの一元管理、自動デプロイのオーケストレーション、全経路の監査追跡により、煩雑な手作業による証明書運用を、検証可能で追跡可能な標準化プロセスへ転換し、企業のデジタル基盤を支えます。',
    capabilitiesLabel: 'プラットフォーム機能',
    featureLifecycle: 'ライフサイクル全体の管理',
    featureLifecycleDesc: 'からインポート、継署、バージョン追踪期限切れ限切れアラート、上書き証明書アセットの每1 個环節。',
    featureAutomation: '自動デプロイオーケストレーション',
    featureAutomationDesc: '面向 Nginx、Tomcat、IIS 等主要環境、一键生成可監査のデプロイプラン。',
    featureRollback: '安全な実行とロールバック',
    featureRollbackDesc: 'デプロイ前自動検証、実行全過程留痕、失敗即ロールバック、確認本番環境安定無忧。',
    formLabel: 'ログインフォーム',
    secure: '安全な接続',
    welcome: 'コンソールへログイン',
    hint: '企業アカウントで GCAC 管理ワークスペースに入ります',
    username: 'ユーザー名',
    usernamePlaceholder: 'ユーザー名を入力してください',
    password: 'パスワード',
    passwordPlaceholder: 'パスワードを入力してください',
    failed: 'ログインに失敗しました。しばらくしてから再試行してください',
    submitting: '本人確認中…',
    submit: 'ログイン',
    policy: 'RBAC 権限保護',
    audit: '操作の全過程を監査'
  },
  internalCa: internalCaEnglish,
  applicationOnboarding: {
    eyebrow: 'アプリケーション接続ウィザード', title: 'アプリケーション資産を追加', description: '業務プラットフォームを選択し、デバイス、サイト、証明書を設定します。', stepsAria: 'アプリケーション接続手順',
    steps: { platform: 'プラットフォーム', device: 'デバイス', target: 'サイト', certificate: '証明書', complete: '完了' },
    platforms: { customManual: 'カスタム手動作成', manualHint: '従来の手動フローを使用', pluginHint: 'プラグインの固定フローを使用', capabilityVersion: '接続機能バージョン', compatibility: '対応プラットフォームバージョン', requiredInformation: '事前に必要な情報', inReview: '機能検証中のため、現在は利用できません', searchLabel: 'プラットフォームを検索', searchPlaceholder: 'アプリ名、プラットフォームバージョン、接続情報で検索', pluginCenterPrompt: 'お探しのアプリが見つかりませんか？', pluginCenterAction: 'プラグインセンターを見る' },
    device: { title: 'プラットフォームに接続', existing: '既存デバイスを使用', new: 'デバイスを追加', deviceId: 'デバイス ID', selectPlaceholder: 'デバイスを選択', noExisting: 'このプラットフォームに使用できる正常なデバイスはありません。', existingLoading: '互換デバイスを読み込んでいます。', refreshExisting: 'デバイスを更新', newDescription: '統一デバイス登録ウィザードを開き、Agent 登録またはデバイス登録後にこのウィザードへ戻ります。', newAction: 'デバイス登録を開く', username: 'ユーザー名', password: 'パスワード', host: 'アドレス', port: 'ポート' },
    resource: { title: 'プラットフォーム資源を選択', refresh: '資源を更新', loading: '利用可能な資源を読み込んでいます。', empty: '利用可能なプラットフォーム資源はありません。' },
    target: { title: 'サイトを選択', siteName: 'サイト名', selectedSite: '選択したサイト', accessDomain: 'アクセスドメイン', verifyUrl: '検証 URL', accessDomainPlaceholder: '例: ikuai.jacksonz.cn', verifyUrlPlaceholder: '例: https://ikuai.jacksonz.cn:443', domainHint: '管理エンドポイントは IP を使用できますが、アクセスドメインと検証 URL は同じ DNS 名を使用してください。', invalidConfiguration: '有効な DNS アクセスドメインと同じホストの検証 URL を入力してください。', listenAddress: 'リッスンアドレス', listenPort: 'リッスンポート', protocol: 'プロトコル', selectable: '選択可能な管理対象', notSelectable: '選択不可', unavailableReason: '選択できない理由', missingValue: '未提供', reasons: { managedTargetInactive: 'この管理対象は無効になっています。', workflowCapabilityMissing: 'この対象には、現在のプラットフォームに必要なワークフロー実行機能がありません。', targetEndpointMissing: 'この対象には、完全なリッスンアドレス、ポート、またはプロトコルがありません。', unknown: 'この対象は現在、選択条件を満たしていません。' } }, certificate: { title: '証明書バージョンを選択', asset: '証明書資産', version: '証明書バージョン', requiredFormat: 'このプラットフォームは {formats} 形式の証明書が必要です' },
    complete: { title: '接続完了', description: 'アプリケーション資産とデプロイ計画を作成しました。' },
    actions: { customManual: '手動作成', openWizard: '接続ウィザード', previous: '前へ', continue: '続行', refresh: 'サイトを更新', review: '証明書を確認', complete: '接続を完了', cancel: 'キャンセル' },
    messages: { requestFailed: '接続に失敗しました。権限と入力を確認してください。', noPlatforms: '利用可能なプラットフォームはありません。', noSearchResults: '一致するプラットフォームがありません。' }
  },
  tenantArchitecture: { nav: 'グループ構成', eyebrow: 'マルチテナント管理', title: 'グループ構成', description: 'グループ、子会社、管理者の関係を管理します。', mode: { aria: 'グループ構成モード', label: 'グループ構成モード', hierarchical: '有効', single: '無効', updated: '最終更新：{time}' }, actions: { checking: '確認中', preflight: '事前確認', enabling: '有効化中', enable: '有効化', rollingBack: 'ロールバック中', rollback: '無効化', suspend: '停止', resume: '再開', revokeAdministrator: '管理者を撤回' }, preflight: { title: '有効化事前確認', summary: 'ブロッカー：{blockers}', passed: { title: '条件を満たしています', summary: '{count} 件の確認に合格' }, blocked: { title: '対応が必要です', summary: '{count} 件のブロッカー', description: '以下の問題を解決してから、もう一度事前確認を実行してください。' } }, confirm: { enable: 'グループ構成を有効にしますか？', rollback: 'シングルテナントに戻しますか？', revokeAdministrator: 'この管理者関係を撤回しますか？' }, messages: { preflightCompleted: '事前確認が完了しました。', enabled: 'グループ構成を有効にしました。', rolledBack: 'シングルテナントに戻しました。', companyCreated: '子会社を作成しました。', administratorAdded: '管理者を設定しました。', administratorRevoked: '管理者関係を撤回しました。', statusUpdated: '子会社の状態を更新しました。' }, errors: { emptyMode: '状態が返されませんでした。', loadFailed: '読み込みに失敗しました。', preflightFailed: '事前確認に失敗しました。', enableFailed: '有効化に失敗しました。', rollbackFailed: 'ロールバックに失敗しました。', companyCreateFailed: '子会社の作成に失敗しました。', administratorFailed: '管理者の設定に失敗しました。', administratorRevokeFailed: '管理者の撤回に失敗しました。', statusFailed: '状態の更新に失敗しました。' }, company: { title: '子会社を追加', name: '名称', namePlaceholder: '子会社名を入力', code: 'コード', codePlaceholder: '一意のコードを入力', submit: '子会社を作成' }, administrator: { title: '子会社管理者', tenant: '子会社', tenantPlaceholder: '子会社を選択', subjectId: 'ユーザー ID', subjectPlaceholder: 'ユーザー ID を入力', submit: '管理者を追加', empty: '管理者未設定' }, tree: { aria: 'グループ構成図', empty: '管理範囲内に表示可能なテナントはありません。' }, history: { aria: '最近のモード記録', title: '最近のモード記録', kind: { PREFLIGHT: '事前確認', ENABLE: '有効化', ROLLBACK: 'ロールバック' }, status: { RUNNING: '実行中', COMPLETED: '完了', FAILED: '失敗' } }, types: { GROUP: 'グループ', COMPANY: '子会社' }, status: { ACTIVE: '有効', SUSPENDED: '停止中' }, membership: { owner: '所有者', admin: '管理者' } },
  tenantSwitcher: { title: 'テナントを切替', aria: '切替可能なテナント', current: '現在', switching: '切替中', confirm: '{tenant} に切り替えますか？', success: '{tenant} に切り替えました。', errors: { contextStale: 'テナントコンテキストが期限切れです。利用可能なテナントを更新しました。', membershipRequired: '対象テナントの有効なメンバーシップがありません。', modeConflict: 'テナントモードを変更中です。', switchFailed: '切替に失敗しました。元のテナントを維持しています。' } },
  errors: {
    forbiddenTitle: '403 権限がありません',
    forbiddenMessage: 'このページにアクセスするために必要な権限がありません。',
    missingPermission: '不足している権限：{permission}',
    notFoundTitle: '404 ページが存在しません',
    notFoundMessage: 'このページは存在しません。アクセス先が正しいか確認してください。',
    backDashboard: 'ダッシュボードへ戻る',
    back: '戻る',
    logout: 'ログアウト'
  }
} as const
