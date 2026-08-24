// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { internalCaEnglish } from './internal-ca.locale'
import { devicesKoKR } from './devices.locale'
import { caOperationsKoKR } from './ca-operations.locale'
import { credentialsKoKR } from './credentials.locale'
import { providersKoKR } from './providers.locale'
import { monitoringTlsKoKR } from './monitoring-tls.locale'
import { acmeAutomationKoKR } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
import { notificationsEnglish } from './notifications.locale'
import { reportsEnglish } from './reports.locale'
export default {
  credentials: credentialsKoKR,
  devices: devicesKoKR,
  caOperations: caOperationsKoKR,
  providers: providersKoKR,
  acme: acmeAutomationKoKR,
  notifications: notificationsEnglish,
  reports: reportsEnglish,
  app: {
    brand: 'GCAC',
    platform: '기업 SSL 인증서 수명 주기 관리 플랫폼',
    defaultBreadcrumb: '콘솔',
    dashboard: '대시보드',
    versionLabel: '버전 {version}'
  },
  common: {
    refresh: '새로고침',
    logout: '로그아웃',
    enter: '열기',
    loading: '로드 중',
    actions: { done: '완료' },
    cancel: '취소',
    save: '저장',
    edit: '편집',
    delete: '삭제',
    notAvailable: '사용할 수 없음',
    close: '닫기',
    unknownError: '알 수 없는 오류',
    unknownValue: '알 수 없는 값: {value}',
    saving: '저장 중…',
    userFallback: '로그인하지 않은 사용자',
    tenantFallback: '기본 테넌트'
  },
  api: {
    errors: {
      requestFailed: '요청 실패',
      timeout: '요청이 {seconds}초를 초과하여 취소되었습니다.'
    }
  },
  auth: {
    errors: {
      missingSession: '로그인 실패, 유효한 세션을 가져오지 못했습니다'
    },
    mock: {
      displayName: '시스템 사용자(Mock)'
    }
  },
  designSystem: {
    confirm: {
      title: '확인{action}',
      impactCount: '영향받는 리소스 수: {count}',
      defaultRisk: '이 작업은 배포, 재시도, 롤백 또는 되돌릴 수 없는 변경을 트리거할 수 있다.',
      typeToConfirm: '{text}를 입력하여 2차 확인',
      cancel: '취소',
      confirm: '확인'
    },
    dataTable: {
      empty: '데이터 없음',
      loading: '로드 중...'
    },
    pagination: {
      total: '총 {count}',
      pageSize: '페이지당 {size}',
      previous: '이전',
      next: '다음',
      goToPage: '{page} 페이지로 이동',
      pager: '페이지 매김'
    },
    dryRunChecklist: {
      title: 'Dry-run 사전 점검 결과',
      ariaLabel: 'dry-run 사전 점검 결과',
      empty: 'dry-run 사전 점검 결과가 생성되지 않았습니다.',
      unnamedCheck: '이름 없는 점검 항목',
      evidence: '점검 근거',
      status: { passed: '통과', failed: '실패', warning: '경고', unknown: '알 수 없음' }
    },
    dryRunResult: {
      title: 'Dry-run 실행 결과',
      close: '닫기'
    },
    modal: {
      closeAria: '모달을 닫다'
    },
    toast: {
      close: '닫기'
    },
    drawer: {
      closeAria: '드로어 닫기'
    },
    secretInput: {
      label: 'Secret 참조',
      placeholder: '암호문 참조 (SecretRef)를 선택하거나 입력하세요. 내용은 평문으로 저장되지 않습니다',
      hint: '중요한 필드는 암호문 참조만 저장하며 화면에 명시적으로 표시하지 않습니다.'
    },
    riskBadge: {
      levelPrefix: '수준:'
    },
    status: {
      DRAFT: '초안',
      PUBLISHED: '게시됨',
      PENDING_APPROVAL: '승인 대기',
      READY: '실행 대기',
      RUNNING: '실행 중',
      SUCCESS: '성공',
      PARTIAL_SUCCESS: '부분 성공',
      FAILED: '실패',
      CANCELLED: '취소됨',
      ROLLED_BACK: '롤백됨',
      DISCOVERED: '발견됨',
      MANAGED: '관리 중',
      DRIFTED: '드리프트됨',
      EXPIRED: '만료됨',
      REVOKED: '폐기됨',
      ERROR: '예외',
      IGNORED: '무시됨',
      ONLINE: '온라인',
      OFFLINE: '오프라인',
      ACTIVE: '활성화됨',
      DISABLED: '비활성화됨',
      OPEN: '미해결',
      ACKED: '확인됨',
      RESOLVED: '해결됨',
      UPGRADING: '업그레이드 중',
      UPDATE_REQUIRED: '업데이트 필요',
      UP_TO_DATE: '최신 상태',
      UNKNOWN: '알 수 없음'
    },
    risk: {
      LOW: {
        label: '낮음',
        description: '주의사항이 필요하지만, 직접 작업을 차단하지는 않는다.'
      },
      MEDIUM: {
        label: '중간',
        description: '배포나 모니터링 결과에 영향을 미칠 수 있으므로 확인해야 합니다.'
      },
      HIGH: {
        label: '높음',
        description: '서비스 중단 또는 보안 노출을 초래할 수 있습니다.'
      },
      CRITICAL: {
        label: '심각',
        description: '반드시 우선적으로 처리하고 위험한 작업은 재차 확인해야 한다.'
      }
    },
    capability: {
      available: '보유',
      missing: '누락',
      title: '기능 호환성',
      description: '호환성이 검증된 결과만 보여 주며 검증되지 않은 항목은 지원되지 않습니다.',
      matrixLabel: '용량 호환성 행렬',
      satisfied: '충족',
      unknown: '알 수 없음',
      manualRisk: '수동 확인',
      empty: '일시적으로 호환성 데이터를 사용할 수 없습니다.'
    },
    executionLogViewer: {
      mode: {
        realtime: '실시간 업데이트',
        autoRefresh: '자동 새로 고침'
      },
      search: {
        placeholder: '로그 내용 검색'
      },
      level: {
        aria: '로그 단계',
        all: '전체'
      },
      actions: {
        showAll: '전체 {count}개 표시',
        showRecent: '최근 {count}개만 표시'
      },
      hint: {
        streaming: '작업 상태와 로그는 실시간으로 업데이트됩니다.',
        autoRefresh: '작업 상태와 로그는 자동으로 새로 고칩니다.',
        pollingFallback: '현재 예약 새로고침 모드를 사용 중입니다.',
        limited: '최근 {visible}개 로그를 표시 중입니다. 전체 {total}개.'
      },
      steps: {
        aria: '실행 단계',
        emptyDetail: '잠시 절차 설명이 없다'
      },
      empty: {
        logs: '아직 로그가 없습니다.'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: '진행 현황 요약',
        taskList: '작업 목록',
        latestEvents: '최신 사건',
        executionLog: '실행로그'
      },
      checklist: {
        title: '검사 결론'
      },
      detail: {
        stepsCompleted: '{completed}/{total} 절차가 완료되었습니다',
        summaryFailed: '{total} 항목의 점검 결과가 반환되었고, {failed} 항목은 실패했습니다',
        summaryPassed: '{passed} 항목 검사가 전부 통과되었다',
        summaryReturned: '{total} 항목의 점검 결과가 반환되었습니다',
        summaryWarning: '{total} 항목의 점검 결과가 반환되었고, {warning} 항목 경고가 주어졌습니다',
        waitingStart: '임무 시작을 기다리다',
        waitingSteps: '실행 대기 중...'
      },
      empty: {
        activity: '실행 로그는 작업이 끝난 후 단계적으로 표시됩니다.',
        events: '아직 이벤트 기록이 없습니다.',
        tasks: '작업이 생성되지 않았습니다. 단계를 기다리는 중...'
      },
      event: {
        collapse: '이벤트 접기',
        defaultLabel: '이벤트',
        defaultTitle: '작업 이벤트',
        expand: '이벤트 열기',
        waitingDetail: '이벤트 기록 대기'
      },
      feed: {
        completed: '실행 완료',
        failed: '실행 실패',
        skipped: '건너뜀',
        warning: '완료, 경고와 함께'
      },
      loading: {
        pollingFallback: '주기적으로 새로 고침 중...',
        refreshing: '새로 고침 중'
      },
      log: {
        collapse: '전체 로그를 접습니다',
        expand: '전체 로그 보기'
      },
      metrics: {
        completed: '완료',
        failed: '실패',
        passed: '통과',
        queued: '줄 서 있는 중',
        running: '실행 중',
        totalTasks: '전체 작업',
        unknown: '알 수 없음',
        warning: '경고'
      },
      process: {
        dryRun: '업데이트 확인',
        execution: '실행'
      },
      operation: {
        prepare: '업데이트 전에 인증서 자료와 대상 상태를 확인합니다.',
        backup: '필요할 때 안전하게 복원할 수 있도록 현재 상태를 저장합니다.',
        update: '새 인증서를 대상 서비스에 안전하게 적용합니다.',
        reload: '새 인증서를 불러오고 서비스가 안정될 때까지 기다립니다.',
        verify: '서비스가 새 인증서를 올바르게 사용하는지 확인합니다.',
        rollback: '업데이트 전 인증서와 서비스 상태를 복원합니다.'
      },
      progress: {
        completed: '전부 완성하다',
        failed: '완료되었습니다. 실패한 항목이 있습니다',
        pending: '결과를 기다렸다가 다시 쓰세요',
        processFailed: '{process} 가 실패했습니다',
        queued: '대기스케줄링',
        running: '임무추진중',
        warning: '완료되었습니다. 위험 경고가 있습니다'
      },
      section: {
        completedCount: '{completed}/{total} 가 완료되었습니다',
        executionLog: '실행로그',
        latestEvents: '최신 사건',
        taskProgress: '작업 진도'
      },
      status: {
        completed: '완료',
        failed: '실패',
        queued: '기다리는 중',
        running: '실행 중',
        skipped: '건너뜀',
        warning: '경고가 나다'
      },
      step: {
        backup: '미리 백업',
        discover: '환경 식별',
        prepare: '인증서 준비',
        installDryRun: '재료 준비',
        installExecution: '인증서 설치',
        updateDryRun: '업데이트 확인',
        updateExecution: '인증서 업데이트',
        reload: '서비스 새로 고침',
        verify: '결과 검사'
      },
      subtitle: {
        completed: '임무를 이미 완수하였다.',
        failed: '작업이 끝났지만 실패한 결과를 반환했습니다.',
        failedFriendly: '이 단계를 완료하지 못했습니다. 자세한 기록에서 원인을 확인하세요.',
        failedChecks: '{total} 항목 검사, {failed} 항목 실패',
        passedChecks: '{total} 항목 검사 통과',
        queued: '작업이 생성되었습니다. 대기 중입니다.',
        running: '작업이 시작되었고 결과를 기다립니다.',
        runningChecks: '{total} 항목이 반환되었습니다',
        skipped: '이 단계는 건너뛰었으며 더 이상 대기하지 않습니다.',
        warningChecks: '{total} 항목 검사, {warning} 항목 경고'
      },
      time: {
        waitingStart: '시작을 기다리다'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: '취소',
        dryRun: '먼저 Dry-run를 하세요',
        next: '다음',
        previous: '이전 단계',
        save: '계획 저장'
      },
      aria: {
        steps: '배포 단계',
        wizard: '배포 마법사'
      },
      capability: {
        targetMissingDetail: '배포 대상은 선택되지 않았습니다.',
        targetSelectedDetail: '배포 대상이 선택되었습니다. 바로 제출할 수 있으며 Dry-run은 자산 상세에서 수동 실행할 수 있습니다.',
        targetSelection: '배포 대상 선택',
        targetSource: '배포 목표'
      },
      checks: {
        failed: '실패 {count}',
        passed: '통과 {count}',
        unknown: '알 수 없는 {count}',
        unnamed: '이름 없는 점검 항목',
        warning: '경고 {count}'
      },
      empty: {
        noTargets: '현재 적용 자산 대상을 선택할 수 없습니다',
        selectTarget: '애플리케이션 자산 배포 대상을 선택하세요.'
      },
      fallback: {
        generatedByApplicationEntry: '적용 항목을 기준으로 생성합니다',
        missingBinding: '바인딩 정보가 제공되지 않았습니다',
        unboundCertificateVariable: '인증서 변수를 바인딩하지 않았습니다',
        unconfigured: '구성되지 않음',
        unconfiguredRunner: '실행 위치가 설정되지 않았습니다',
        unknownEnd: '알 수 없는 끝',
        unknownStart: '알 수 없는 시작',
        unnamedSite: '이름 없는 사이트',
        unnamedVersion: '이름 없는 버전',
        unrecognizedManagedTarget: '관리 대상을 식별하지 못하다',
        unselected: '선택되지 않음',
        unselectedVersion: '버전이 선택되지 않았습니다',
        unselectedWorkflow: '워크플로가 선택되지 않았습니다'
      },
      fields: {
        applicationTarget: '애플리케이션 자산 배포 목표',
        artifactConfig: '제품 설정',
        binding: '바인딩',
        certificateAsset: '인증서 자산',
        certificateVariable: '인증서 변수',
        certificateVersion: '인증서 버전',
        deploymentTarget: '배포 목표',
        keyword: '키워드 검색',
        managedTarget: '관리대상',
        runner: '실행 위치',
        site: '사이트',
        verifyUrl: 'URL 인증',
        version: '버전',
        workflow: '워크플로'
      },
      panels: {
        certificateTitle: '(1) 인증서 자료',
        submitTitle: '(3) 사전 점검와 제출',
        targetTitle: '(2) 배포목표'
      },
      panelState: {
        needPrerequisites: '완료 시점 선택',
        operable: '작업 가능',
        pending: '완성을 기다리다',
        readyNext: '다음 단계로 가기'
      },
      placeholders: {
        selectTarget: '적용 자산 대상을 선택하세요',
        targetKeyword: '도메인, 사이트, 바인딩에 따라 정보를 검색합니다'
      },
      plan: {
        dryRunCompleted: '최근에 dry-run 가 완료되었습니다.',
        submitCompleted: '마지막 커밋이 완료되었습니다.'
      },
      preview: {
        needCertificate: '먼저 인증서 자료 선택을 완료하세요.',
        needTarget: '인증서 자료 선택을 완료한 후, 배포할 응용 프로그램 자산의 대상을 지정합니다.',
        ready: '선택한 인증서 버전이 {count} 애플리케이션 자산 대상에 배포됩니다.'
      },
      status: {
        checksReturned: '사전 점검의 결과가 반환되었으며 결과에 따라 저장, 전송 또는 직접 수행할 수 있습니다.',
        current: '현재 상태',
        default: '먼저 dry-run를 발기하고 다시 제출하여 집행할지를 결정할것을 건의한다.',
        dryRunStarted: '사전 점검가 시작되었습니다. 결과 영역에서 진행 상황을 보십시오.',
        submitted: '계획이 이미 제출되었다.'
      },
      steps: {
        certificate: {
          description: '인증서 자산 및 버전',
          title: '인증서 자료 선택'
        },
        submit: {
          description: 'Dry-run, 저장, 제출, 실행',
          title: '미리 점검하여 제출하다'
        },
        target: {
          description: '자산, 사이트 및 바인딩을 적용합니다',
          title: '배포 대상 선택'
        }
      },
      stepState: {
        active: '진행 중',
        done: '완료',
        pending: '시작 대기'
      },
      target: {
        workflowMode: '워크플로 모드',
        workflowModeWithName: '워크플로 모드({name})'
      },
      version: {
        autoLatest: '최신 배포 가능한 버전 자동 선택 (현재:{current})',
        noDeployableVersion: '인증서 버전을 배포할 수 없습니다',
        range: '{id} ({notBefore}—{notAfter})'
      },
      currentStep: '절차 {current} / {total}',
      selectedTargetCount: '목표 {count}를 선택하였습니다',
      subtitle: '배포 계획 설정을 단계별로 완료합니다',
      title: '배포 마법사'
    }
  },
  tasks: {
      title: '전역 작업',
      quick: { active: '활성 작업', recent: '최근 완료 작업' },
      tabs: { all: '전체 작업', execution: '실행 작업', monitoring: '모니터링 작업', system: '시스템 작업', other: '기타 작업' },
    aria: { openDrawer: '전역 작업 열기', tabs: '작업 분류' },
    filters: {
      includeAll: '전체 작업 표시',
      keyword: '작업, 오류 또는 ID 검색',
      taskType: '작업 유형',
      status: '상태',
      allStatuses: '모든 상태',
      resourceType: '리소스 유형',
      resourceId: '리소스 ID',
      requestedBy: '요청 사용자',
      taskId: '작업 ID',
      createdFrom: '시작 시간',
      createdTo: '종료 시간'
    },
    fields: { requestedBy: '요청 사용자', triggerSource: '트리거 소스', createdAt: '생성 시간', startedAt: '시작 시간', finishedAt: '완료 시간', error: '마지막 오류' },
    sections: { timeline: '상태 타임라인', attempts: '시도 기록', acmeHistory: '갱신 진행 상황', logs: '원시 로그', children: '하위 작업', errors: '오류', audit: '감사 이벤트', monitoringProbes: '탐지 기록' },
    actions: { backToList: '목록으로 돌아가기', viewAll: '모든 작업 보기', viewRawLogs: '원시 로그 보기', search: '검색', reset: '초기화', previousPage: '이전 페이지', nextPage: '다음 페이지', forceCancel: '강제 종료', forceCancelConfirm: '이 작업을 강제 종료할까요? 진행 중인 원격 작업은 수동 확인이 필요할 수 있습니다.', forceCancelReason: '전체 작업에서 운영자가 강제 종료' },
    messages: { loadFailed: '작업을 불러오지 못했습니다.', detailFailed: '작업 상세를 불러오지 못했습니다.', forceCancelFailed: '작업을 강제 종료하지 못했습니다.' },
    values: { system: '시스템', empty: '기록 없음', none: '없음' },
    agentUpdate: {
      title: 'Agent 업데이트 진행률', timelineTitle: '업데이트 진행 과정',
      fields: { target: '대상 호스트', currentVersion: '현재 버전', targetVersion: '대상 버전', phase: '현재 단계', planId: '업데이트 계획', transactionId: '업데이트 트랜잭션' },
      values: { unknown: '알 수 없음' },
      phases: { queued: '대기 중', dispatching: '승인 전송 중', accepted: 'Agent 수락', upgrading: '업데이트 중', status_checking: '결과 확인 중', succeeded: '완료', failed: '완료되지 않음', rolled_back: '롤백됨', manual_required: '수동 조치 필요', unknown: '알 수 없음' },
      summary: { queued: '업데이트 작업이 대기 중입니다.', dispatching: '업데이트 승인을 전송하는 중입니다.', accepted: 'Agent가 업데이트를 수락했으며 실행을 기다립니다.', upgrading: 'Agent가 새 버전을 다운로드하고 교체하는 중입니다.', waiting: 'Agent 결과를 기다리는 중입니다.', succeeded: 'Agent가 {currentVersion}에서 {targetVersion}(으)로 업데이트되었습니다.', failed: 'Agent 업데이트가 완료되지 않았습니다.' },
      events: { created: '작업 생성', claimed: '작업 할당', started: '업데이트 상태 확인 시작', progress: '업데이트 상태 갱신', waiting_result: '업데이트 결과 대기', succeeded: '업데이트 성공', failed: '업데이트 실패', retry_scheduled: '다음 확인 대기', cancelled: '작업 취소' },
    },
    pluginRefresh: {
      subtitle: '플러그인 카탈로그 유지 관리 작업',
      overview: { kicker: '새로 고침 결과', description: '{scope}을(를) 새로 고치고 최신 플러그인 참조를 사용 가능한 실행 노드에 동기화했습니다.' },
      metrics: { catalogVersions: '카탈로그 버전', enabledVersions: '활성 버전', agentsProjected: '동기화된 노드', agentsFailed: '동기화 실패' },
      sections: { timeline: '처리 과정', catalogVersions: '현재 플러그인 버전', failures: '동기화 문제' },
      actions: { showTechnicalDetails: '기술 세부 정보 보기' },
      fields: { taskId: '작업 ID' },
      values: { unavailable: '없음', noVersions: '반환된 플러그인 버전이 없습니다', triggerSource: '플러그인 카탈로그 새로 고침' },
      summary: { succeeded: '새로 고침 완료: 플러그인 버전 {versions}개를 갱신하고 실행 노드 {projected}개에 동기화했습니다.', failed: '플러그인 카탈로그 새로 고침에 실패했습니다.', cancelled: '플러그인 카탈로그 새로 고침이 취소되었습니다.', retryWaiting: '나중에 자동으로 다시 시도합니다.', waitingResult: '새로 고침 결과를 기다리는 중입니다.', awaitingConfirmation: '새로 고침 결과 확인이 필요합니다.', cancelling: '새로 고침을 취소하는 중입니다.', queued: '새로 고침이 대기열에 추가되었습니다.', running: '플러그인 카탈로그를 새로 고치는 중입니다.' },
      events: { created: '새로 고침 작업이 생성되어 처리를 기다리고 있습니다.', claimed: '백그라운드 처리기에 작업을 할당했습니다.', started: '내장 플러그인 카탈로그 읽기를 시작했습니다.', progress: '플러그인 버전을 정리하고 실행 노드에 동기화하는 중입니다.', retryScheduled: '처리가 완료되지 않아 자동 재시도를 예약했습니다.', waitingResult: '실행 노드 결과를 기다리는 중입니다.', awaitingConfirmation: '새로 고침 결과를 확인해야 합니다.', cancelRequested: '취소 요청을 받았습니다.', expired: '작업 시간이 초과되었습니다.', cancelled: '새로 고침 작업이 취소되었습니다.', succeeded: '새로 고침 완료: 버전 {versions}개, 노드 {projected}개를 동기화했습니다.', failed: '새로 고침 실패: {reason}' },
      versionStatus: { added: '추가됨', enabled: '활성', disabled: '비활성', other: '기타 상태' }
    },
    approval: {
      title: '승인 작업 세부 정보',
      description: '승인 내용, 상태 이력 및 가능한 작업을 확인합니다.',
      contentTitle: '승인 내용',
      fields: { operation: '작업 유형', target: '대상', approvalId: '승인 ID', requestedBy: '요청자', riskLevel: '위험 수준', createdAt: '요청 시간', decision: '승인 결과', summary: '작업 요약' },
      content: { deployment: '인증서 배포', automation: '자동화 실행', defaultSummary: '이 작업은 승인 결정을 기다리고 있습니다.' },
      values: { approved: '승인됨', rejected: '거부됨', pending: '승인 대기' },
      timelineTitle: '상태 타임라인',
      timeline: { created: '승인 요청됨', createdDescription: '작업이 생성되었으며 승인자의 처리를 기다립니다.', approved: '승인됨', approvedDescription: '승인자가 작업을 계속하도록 허용했습니다.', rejected: '승인 거부됨', rejectedDescription: '승인자가 이 작업을 거부했습니다.', forceEnded: '작업 강제 종료됨', forceEndedDescription: '운영자가 이 작업을 강제 종료했습니다.', pending: '승인 처리 중', pendingDescription: '시스템이 승인 결과를 기다리고 있습니다.' }
    },
    relatedNames: { builtinCatalog: '내장 플러그인 카탈로그', deploymentPlan: '배포 계획', acmeRenewal: 'ACME Provider({provider}) - {certificate} 인증서 갱신' },
    acmeHistory: {
      queued: { title: '갱신 대기 중', description: '시스템이 이 인증서 갱신을 처리할 때까지 대기 중입니다.' },
      running: { title: '인증서 갱신 중', description: '시스템이 인증 기관에 갱신을 요청하고 있습니다.' },
      retryWaiting: { title: '자동 재시도 대기 중', description: '이번 발급이 완료되지 않았습니다. 시스템이 나중에 다시 시도합니다.' },
      succeeded: { title: '갱신 성공', description: '새 인증서가 발급되고 저장되었습니다.' },
      failed: { title: '갱신 실패', description: '시스템이 인증서를 갱신할 수 없습니다. 원시 로그를 확인하세요.' },
      cancelled: { title: '갱신 취소됨', description: '이 인증서 갱신이 취소되었습니다.' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: '인증서 Dry-run',
      CERTIFICATE_DEPLOY: '인증서 배포',
      DEPLOYMENT_APPROVAL: '배포 승인',
      CERTIFICATE_VERIFY: '인증서 검증',
      CERTIFICATE_ROLLBACK: '인증서 롤백',
      AGENT_INSTALL: 'Agent 설치',
      AGENT_UPDATE: 'Agent 업데이트',
      PLUGIN_REFERENCE_REFRESH: '플러그인 참조 새로고침',
      DEPLOYMENT_PLAN_REFRESH: '배포 계획 새로고침',
      MONITORING_BATCH: '모니터링 배치',
      MONITORING_PROBE: '모니터링 프로브',
      CA_NODE_TASK: 'CA 노드 작업',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CA_RECORD_SYNC: 'CA 기록 동기화',
      CERTIFICATE_REVOCATION: '인증서 폐기',
      CRL_PUBLISH: 'CRL 게시',
      TRUST_DISTRIBUTION: '신뢰 배포',
      GATEWAY_DELEGATION: '게이트웨이 위임',
      WORKFLOW_RUN: '워크플로 실행',
      AUTOMATION_RUN: '자동화 실행',
      REPORT_EXPORT: '보고서 내보내기',
      NOTIFICATION_DELIVERY: '알림 전달',
      OTHER: '기타 작업'
    },
    summaryTemplates: {
      QUEUED: '{task} 대기열 등록됨',
      RUNNING: '{task} 실행 중',
      RETRY_WAITING: '{task} 재시도 대기 중',
      WAITING_RESULT: '{task} 실행 결과 대기 중',
      AWAITING_CONFIRMATION: '{task} 결과 확인 필요',
      CANCELLING: '{task} 취소 중',
      SUCCEEDED: '{task} 완료됨',
      FAILED: '{task} 실패',
      CANCELLED: '{task} 취소됨'
    },
    status: { QUEUED: '대기 중', RUNNING: '실행 중', RETRY_WAITING: '재시도 대기', WAITING_RESULT: '결과 대기', AWAITING_CONFIRMATION: '결과 확인 필요', WAITING_APPROVAL: '승인 대기', CANCELLING: '취소 중', SUCCEEDED: '성공', FAILED: '실패', CANCELLED: '취소됨' }
  },
  shell: {
    currentLocation: '현재 위치',
    breadcrumb: '브레드크럼',
    currentGroupNavigation: '현재 그룹 탐색',
    backDashboard: '대시보드로 돌아가기',
    sidebarCollapse: '사이드바 접기',
    sidebarExpand: '사이드바 펼치기'
  },
  globalSearch: {
    title: '전역 검색',
    description: '인증서, 디바이스 자산, 시스템 설정 및 플러그인을 검색합니다.',
    inputLabel: '전역 리소스 검색',
    inputPlaceholder: '이름, 도메인, 지문 또는 경로 입력',
    hint: '키워드를 입력하여 검색을 시작하세요.',
    aria: {
      open: '전역 검색 열기'
    },
    categories: {
      certificates: '인증서',
      assets: '디바이스 자산',
      settings: '시스템 설정',
      plugins: '플러그인'
    },
    types: {
      serverCertificate: '서버 인증서',
      intermediateCertificate: '중간 인증서',
      rootCertificate: '루트 인증서',
      application: '애플리케이션',
      device: '디바이스',
      cloudService: '클라우드 서비스',
      systemSetting: '시스템 설정',
      plugin: '플러그인'
    },
    empty: {
      title: '일치하는 결과가 없습니다',
      description: '다른 이름, 도메인, 지문 또는 경로를 입력해 보세요.'
    },
    messages: {
      loadFailed: '전역 검색을 불러오지 못했습니다.'
    }
  },
  preferences: {
    theme: '테마',
    language: '언어',
    themeLight: '주간 모드',
    themeDark: '다크 모드',
    themeToggle: '테마 모드 전환',
    languageSelect: '화면 언어 선택',
    title: '표시환경설정',
    description: '테마와 언어는 현재 사용자의 백엔드 환경 설정에 저장됩니다.',
    errors: {
      loadFailed: '기본 설정 로드 실패',
      saveFailed: '환경설정 저장 실패'
    }
  },
  systemInitialization: {
    intro: { ariaLabel: '시스템 초기화 애니메이션', eyebrow: '첫 실행', title: '콘솔을 준비하고 있습니다', description: '잠시 후 시스템 초기화 마법사가 열립니다.', loading: '초기화 마법사를 불러오는 중…', progressAriaLabel: '초기화 로딩 진행률', start: '사용 시작', skip: '애니메이션 건너뛰기', slogan: '중단 없는 보안 서비스를 위해' },
    preview: { title: '시스템 초기화 미리보기', notice: '개발 미리보기: 사용자나 라이선스가 저장되지 않습니다.' },
    title: '시스템 초기화 마법사', description: '첫 Admin 계정과 콘솔 환경설정을 만듭니다.', help: '초기 설정을 단계별로 완료합니다.', stepsLabel: '초기화 단계',
    steps: { account: 'Admin 계정 및 환경설정', accountHelp: '첫 로컬 관리자를 만들고 언어와 테마를 선택합니다.', license: '라이선스 설정', licenseHelp: '오프라인 요청을 내보내고 인증 파일을 가져오거나 나중에 처리합니다.', confirm: '쓰기 확인', confirmHelp: '민감하지 않은 요약과 보안 경고를 확인합니다.', complete: '완료', completeHelp: '초기화가 끝났으며 로그인을 사용할 수 있습니다.' },
    stage: { account: { title: 'Admin 계정 및 화면 환경설정', help: '이 값은 첫 Admin 사용자에게 저장됩니다.' }, license: { title: '라이선스 설정(선택 사항)', help: '라이선스 실패가 Admin 초기화를 되돌리지는 않습니다.' }, confirm: { title: '쓰기 확인', help: '민감하지 않은 요약만 표시합니다.' }, complete: { title: '초기화 완료', help: '시스템을 사용할 수 있습니다.' } },
    account: { heading: '첫 Admin 사용자 만들기', description: '콘솔 로그인에 사용할 로컬 관리자 계정을 설정합니다.', username: 'Admin 사용자 이름', usernamePlaceholder: '예: admin', displayName: 'Admin 표시 이름', displayNamePlaceholder: '예: 시스템 관리자', password: 'Admin 비밀번호', passwordPlaceholder: '8자 이상', passwordConfirmation: '비밀번호 확인', passwordConfirmationPlaceholder: '비밀번호를 다시 입력', locale: '기본 언어', theme: '테마' },
    license: { description: '먼저 오프라인 활성화 요청 파일을 내보낸 다음 인증 파일을 가져오거나 JSON을 붙여넣습니다.', createRequest: '오프라인 요청 파일 내보내기', copyRequest: '활성화 요청 복사', requestCopied: '활성화 요청이 복사되었습니다', importFile: '인증 파일 가져오기', activationResponse: '인증 파일 또는 활성화 응답 JSON', activationResponsePlaceholder: '인증 파일을 가져오거나 JSON을 붙여넣으세요', importResponse: '인증 가져오기', configured: '라이선스가 설정되었습니다.', skip: '건너뛰고 나중에 설정' },
    confirm: { username: 'Admin 사용자 이름', locale: '언어', theme: '테마', kekTitle: 'GCAC_SECRET_KEK를 안전하게 보관하세요', kekWarning: 'GCAC_SECRET_KEK는 런타임 보안 자료를 복호화하는 루트 키입니다. 코드, 로그, 공개 문서 또는 브라우저에 기록하지 마세요. 유출 시 심각한 보안 위험이 발생할 수 있습니다.' },
    complete: { heading: '시스템 초기화가 완료되었습니다', licenseConfigured: '라이선스가 설정되었습니다.', licenseSkipped: '라이선스 설정을 건너뛰었습니다. 나중에 Licensing 페이지에서 완료할 수 있습니다.' },
    actions: { previous: '이전', continue: '계속', createAdmin: 'Admin 생성 후 계속', finish: '초기화 완료', login: '로그인으로 이동' },
    errors: { passwordMismatch: '비밀번호가 일치하지 않습니다.', missingSession: '초기화는 성공했지만 세션을 받지 못했습니다.', createFailed: 'Admin 생성에 실패했습니다.', licenseFailed: '라이선스 작업에 실패했습니다.', activationRequestMissing: '오프라인 활성화 요청을 받지 못했습니다.', jsonObjectRequired: '유효한 JSON 객체를 입력하세요.' }
  },
  userMenu: {
    currentUser: '현재 사용자',
    changePassword: '비밀번호 변경',
    userGuide: '사용자 가이드',
    logout: '로그아웃'
  },
  password: {
    title: '비밀번호 변경',
    description: '현재 로그인 사용자의 로컬 비밀번호를 변경합니다.',
    current: '현재 비밀번호',
    new: '새 비밀번호',
    confirm: '새 비밀번호 확인',
    cancel: '취소',
    submit: '비밀번호 저장',
    submitting: '저장하는 중...',
    success: '비밀번호 업데이트',
    failed: '비밀번호 변경 실패',
    mismatch: '두 번 입력한 비밀번호가 일치하지 않습니다',
    tooShort: '새 비밀번호는 8자리 이상이여야 한다'
  },
  viewMode: {
    switchLabel: '애플리케이션 보기 모드',
    user: '사용자 보기',
    professional: '전문가 보기',
    steps: {
      certificates: '인증서',
      applications: '애플리케이션',
      deployments: '배포'
    }
  },
  nav: {
    dashboard: '대시보드',
    dashboardDesc: '애플리케이션, 인증서, Agent, 게이트웨이 및 감사 상태 요약',
    certificates: '인증서 관리',
    certificatesDesc: '인증서 라이브러리, 바인딩 관계 및 만료 상태',
    certificateAssets: '인증서 자산',
    certificateAssetsDesc: '인증서, 개인 키 참조, 지문, 만료 시간입니다',
    acmeAutomation: 'ACME 인증서 자동화',
    acmeAutomationDesc: 'ACME 인증서 발급, 갱신 및 추적',
    certificateFormats: '인증서 형식 설정',
    certificateFormatsDesc: '저장된 인증서에 대해 PFX, CER, CRT, PEM 포맷 규칙을 정의한다',
    assetCenter: 'Asset Center',
    assetCenterDesc: 'Manage application, device, and cloud service assets',
    assetManagement: '애플리케이션 관리',
    assets: '응용자산',
    assetsDesc: '도메인/IP 차원의 애플리케이션 포털과 인증서 배포 대상',
    devices: '장비',
    agents: 'Agent',
    agentsDesc: '온라인 상태, 심장 박동, 능력 집합입니다',
    gateways: '게이트웨이',
    gatewaysDesc: '격리 구역 관문, 프로토콜 및 접근 가능성',
    deployments: '인증서 배포',
    deploymentsDesc: '배포 계획, 워크플로, 자동화 및 실행 기록',
    deploymentPlans: '계획을 배포하다.',
    deploymentPlansDesc: '인증서 배포 계획 및 승인 포털입니다',
    executions: '실행 기록',
    executionsDesc: '실행 단계, 로그, 실패, 스크롤백',
    reports: '보고서',
    reportsDesc: '인증서 사고 기간, 위험 대응 및 자동화 효과',
    incidentWindowReport: '사고 기간 보고서',
    incidentWindowReportDesc: '만료 예정 및 만료된 인증서 우선순위 지정',
    riskResponseReport: '위험 대응 보고서',
    riskResponseReportDesc: '확인, 해결 시간 및 SLA',
    automationEffectivenessReport: '자동화 효과 보고서',
    automationEffectivenessReportDesc: '실행 및 대상 성공률과 실패 단계',
    workflows: '워크플로',
    workflowsDesc: '워크플로 및 플러그인',
    workflowTemplates: '워크플로',
    workflowTemplatesDesc: '캔버스 스케치, 변수, 기능 선언 및 배포',
    automations: '자동화',
    automationsDesc: '예약, 요청 및 일괄 인증서 갱신 계획',
    plugins: '플러그인 센터',
    pluginsDesc: 'Provider, 실행기 및 샌드박스 상태',
    monitoring: '모니터링 및 감사',
    monitoringDesc: '경보, 감사 및 인증서 상태',
    monitoringAnalysis: '모니터링 분석',
    monitoringAnalysisDesc: '모니터링 대상, 탐지 결과 및 인증서 위험 분석',
    monitorAlerts: '감시 통제와 경보',
    monitorAlertsDesc: '만료, 드리프트, 실행 실패 이벤트',
    monitorTls: 'TLS 심층 모니터링',
    monitorTlsDesc: '신뢰 경로, 프로토콜 스위트, 호환성 시뮬레이션 및 프로토콜 세부 정보',
    audits: '감사 로그',
    auditsDesc: '작업 자격 증명와 준법 내보내기',
    logAudit: '로그 감사',
    logAuditDesc: '감사 이벤트를 확인하고 작업 증거를 내보냅니다',
    settings: '시스템 설정',
    settingsDesc: '테넌트, 사용자, 권한, 시스템 설정',
    systemSettings: '시스템 설정',
    systemSettingsDesc: '시스템 구성 및 보안 메타데이터',
    users: '사용자관리',
    usersDesc: '콘솔 사용자, 상태 및 역할',
    roles: '권한 관리',
    rolesDesc: '역할, 권한 부여 객체 범위와 구성원 할당',
    identitySources: '정체성 원천',
    identitySourcesDesc: 'AD/LDAP 서비스 설정',
    groupRoleMappings: '그룹 역할 맵'
  },
  automations: {
    title: '자동화',
    description: '인증서 갱신 계획의 예약, 요청 및 일괄 실행을 관리합니다.',
    empty: '자동화가 없습니다.',
    emptyDescription: '설명 없음',
    common: { notAvailable: '없음', allRelated: 'All related targets' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: '외부 API로 실행', apiHelp: '외부 시스템이 자동화 실행 API를 호출합니다. 대상 미리보기 및 승인 규칙은 계속 적용됩니다.', once: '고정 시간에 한 번 실행', onceHelp: '브라우저 로컬 시간을 선택합니다. 실행 후 다시 예약되지 않습니다.', recurring: '정기 실행', scheduleHelp: '지속적인 확인이 실제로 필요한 경우에만 사용하세요.', recurringHelp: '지속적인 확인이 실제로 필요한 경우에만 사용하세요.', recurringWarningTitle: '인증서 업데이트에는 정기 실행을 권장하지 않습니다', recurringWarning: '일반적으로 인증서 발급 후 외부 시스템에서 실행하거나 고정 시간에 한 번만 실행해야 합니다.', certificateVersionCreated: 'Certificate new-version event', certificateVersionCreatedHelp: '외부 소스 또는 수동 가져오기로 인증서 새 버전이 생성되면 자동화를 시작합니다.', runAt: '실행 시간', frequency: '실행 주기', daily: '매일', weekly: '매주', monthly: '매월', time: '시간', weekday: '요일', monthDay: '매월 날짜', legacyCustom: '기존 사용자 지정 일정 유지', legacyCron: '기존 Cron(읽기 전용)', weekdays: { 0: '일요일', 1: '월요일', 2: '화요일', 3: '수요일', 4: '목요일', 5: '금요일', 6: '토요일' } },
    form: { existingAssetTitle: '기존 애플리케이션 자산만 업데이트', existingAssetDescription: '기존 인증서 바인딩이 있는 애플리케이션 자산만 처리합니다. 최초 설치나 새 대상 추가는 수행하지 않습니다.', certificateDomains: '인증서 도메인', certificateDomainsPlaceholder: '인증서 도메인을 쉼표로 구분해 입력', certificateDomainsHelp: '지정한 도메인에 해당하는 기존 애플리케이션 자산 바인딩만 업데이트합니다.', versionSelection: '업데이트할 인증서 버전', versionSelectionLatest: '최신 인증서 버전 자동 사용', versionSelectionSpecific: '지정한 인증서 버전 사용', versionSelectionHelp: '실행 시작 시 버전을 확인하고 고정하므로 실행 중 새 버전으로 바뀌지 않습니다.', certificateVersionIds: '지정 인증서 버전', certificateVersionIdsPlaceholder: '인증서 버전 ID를 쉼표로 구분해 입력', certificateVersionIdsHelp: '각 버전은 위 도메인이 선택한 인증서에 속해야 합니다.', versionLoading: '선택 가능한 인증서 버전을 불러오는 중입니다.', versionLoadFailed: '인증서 버전을 불러오지 못했습니다. 나중에 다시 시도하세요.', versionEmpty: '이 도메인에 선택 가능한 인증서 버전이 없습니다.', schedule: '업데이트 시점', scheduleHelp: '요청 시 시작하거나 Cron과 시간대로 정기 실행할 수 있습니다.', execution: '실행 중 처리', executionHelp: '기존 바인딩마다 독립적인 업데이트 계획을 만들고 DeploymentPlan, 승인, ExecutionRun을 재사용합니다.', snapshot: '도메인, 자산 및 인증서 버전 스냅샷 고정' },
    fields: { name: '이름', description: '설명', trigger: '트리거', eventSources: 'Event sources', eventSourcesHelp: 'Choose which certificate version events can start this automation.', targetScope: 'Update scope', selectedAssets: 'Selected application assets', selectedAssetsHelp: 'Select at least one managed application asset.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Cron 표현식', timeZone: '시간대', expiresWithinDays: '만료 예정 일수', environments: '대상 환경(쉼표로 구분)', certificateIds: '지정 인증서(선택)', certificateIdsPlaceholder: '인증서 ID를 쉼표로 구분해 입력', certificateIdsHelp: '입력하면 지정된 인증서만 처리하고, 비워두면 만료 기간과 환경으로 자동 선택합니다.', expiresWithinDaysHelp: '이 기간 내에 만료되는 인증서만 대상으로 합니다.', environmentsHelp: '지정한 환경의 인증서만 처리합니다.', planType: '배포 계획 유형', planTypeHelp: '일치하는 인증서 대상마다 실행 시 독립적인 DeploymentPlan을 만듭니다.', planTypeUpdate: '기존 인증서 바인딩 업데이트', planTypeInstall: '대상에 인증서 설치', planTypeVerifyOnly: '검증만 수행하고 인증서는 변경하지 않음', planMode: '실행 방식', planModeHelp: '기존 계획에 연결하지 않고 대상마다 실행 시 새 계획을 만듭니다.', planModeCreateAndExecute: '계획 생성 후 실행', planModeCreateOnly: '계획만 생성하고 실행하지 않음', maxTargets: '실행당 최대 대상 수', concurrency: '동시 실행 수', failureCount: '실패 수 임계값', requireDryRun: '기존 Dry Run 설정(실행 조건으로 사용되지 않음)', requireApproval: '실행 전 승인 필수', startedAt: '시작 시간', finishedAt: '완료 시간', failureStage: '실패 단계', parentRun: '상위 실행' },
    actions: { create: '자동화 만들기', detail: 'Details', edit: '편집', delete: '삭제', cancel: '취소', save: '저장', copy: '복사', enable: '활성화', disable: '비활성화', runNow: 'Run now', preview: '대상 미리 보기', history: '실행 기록', confirmRun: '실행 확인', stop: '실행 중지', retryFailed: '실패 대상 재시도', openPlan: '배포 계획 보기', openExecution: '실행 기록 보기' },
    manualRun: { title: '수동 실행', description: '실행 전에 인증서 버전을 선택하세요.', versionLabel: '인증서 버전', versionPlaceholder: '인증서 버전 선택', help: '선택한 버전에 연결된 애플리케이션 자산을 실행 시점에 해석합니다.', empty: '수동 실행할 인증서 버전이 없습니다.', stopOnError: '오류 시 중단', dryRun: '선택적 Dry-run 미리보기 실행', start: '실행 시작' },
    columns: { status: 'Status', trigger: '트리거', targets: '대상 한도', actions: '실행 작업', nextRun: '다음 실행', lastRun: '최근 실행' },
    triggers: { onDemand: '요청 시', schedule: '예약' },
    triggerTypes: { on_demand: '요청 시', schedule: '예약', certificate_version_created: 'Certificate new-version event', retry: '실패 대상 재시도' },
    eventSources: { external_source: '외부 소스', manual_import: '수동 가져오기' },
    targetScopes: { allRelatedAssets: 'Update all related application assets', allRelatedAssetsHelp: 'Resolve every bound and deployable application asset automatically after the event or filters match.', selectedAssets: 'Update selected application assets only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for manually selected application assets.' },
    assetPicker: { available: 'Available assets', selected: 'Selected assets', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No application assets are available to add.', emptySelected: 'No application assets selected yet.' },
    actionTypes: { create_deployment_plan: '인증서 갱신 계획 만들기', execute_deployment_plan: '인증서 갱신 계획 실행', send_notification: '알림 보내기' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: '최대 {count}개 대상' },
    preview: { title: '자산 영향 미리 보기', description: '선택한 각 애플리케이션 자산의 현재 인증서 만료 시각과 대상 인증서 만료 시각을 비교합니다.', matched: '{count}개 일치', executable: '{count}개 실행 가능', excluded: '{count}개 제외', affected: '{count}개 영향', upgrade: '{count}개 유효기간 연장', same: '{count}개 만료 시각 동일', skip: '{count}개 업데이트 건너뜀', downgrade: '{count}개 확인 필요', version: '버전 {version}', versionUnknown: '버전 알 수 없음', ready: '실행 가능', skipUpdate: '업데이트 건너뛰기', expiryLabel: '만료', impact: { upgrade: '유효기간 연장', same: '만료 시각 동일', downgrade: '유효기간 단축 위험', missing_current: '현재 인증서 없음', unknown: '영향 알 수 없음' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} application assets involved', assetsResolvedAtRuntime: 'Target assets are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved assets', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: '대상 권한 없음', missing_version: '인증서 버전 없음', version_not_deployable: '인증서 버전을 배포할 수 없음', binding_not_managed: '바인딩이 관리되지 않음', environment_not_allowed: '허용되지 않은 환경', binding_missing: '바인딩 없음', asset_missing_deployment_capability: '대상 자산은 인증서를 배포할 수 없음', certificate_version_downgrade: '대상 버전이 현재 자산 버전보다 낮음', certificate_already_up_to_date: '대상 만료 시각이 현재 인증서와 같아 업데이트를 건너뜀', filter_not_matched: '필터 조건이 일치하지 않음', runtime_context_required: '실행 컨텍스트가 필요함', unknown: '알 수 없는 제외 이유' },
    failureStages: { selection: '대상 선택', plan_creation: '계획 생성', dry_run: 'Dry Run', approval: '승인', execution: '실행', verification: '검증', rollback: '롤백', notification: '알림' },
    progress: { total: '전체', pending: '대기 중', running: '실행 중', waitingApproval: '승인 대기', succeeded: '성공', failed: '실패', skipped: '건너뜀', cancelled: '취소됨' },
    editor: { createTitle: '자동화 만들기', editTitle: '자동화 편집', description: '실행 시점, 대상 인증서, 계획 생성 방식과 실패 시 안전 경계를 설정합니다.', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot.', sections: { basic: '기본 정보', basicHelp: '자동화 이름과 처리할 인증서 변경을 설명합니다.', trigger: 'Trigger', triggerHelp: 'Define what fact starts the automation before choosing execution and conditions.', targets: '처리할 인증서', targetsHelp: '기존 배포 계획이 아니라 인증서 대상을 선택하며, 실행 시작 시 스냅샷을 고정합니다.', execution: 'Execution', executionHelp: 'Decide how the automation updates assets first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters, approval, and concurrency guardrails together in this step.', plan: '인증서 배포 계획', planRelationTitle: '기존 배포 계획에 연결하지 않습니다', planRelationDescription: '위 인증서 조건에 따라 실행 시 계획을 생성합니다.', planRelationHelp: '대상마다 별도의 DeploymentPlan을 만들고 계획 ID를 실행 상세에 표시합니다.', guardrails: '실행 안전 제어', guardrailsHelp: '배치 수, 사전 점검, 승인 및 실패 중지 조건을 제어합니다.' }, chain: { createPlan: '대상별 DeploymentPlan 생성', dryRun: '선택적 Dry Run 미리보기 실행', approval: '승인 대기', executePlan: '대상 DeploymentPlan 실행' } },
    runs: { title: '자동화 실행 기록', description: '실행 상태, 변경 불가능한 대상 스냅샷 및 실패 단계를 확인합니다.', progress: '{succeeded}/{total} 성공' },
    runDetail: { title: '자동화 실행 상세', description: '구성 버전 {version}', noFailure: '실패 없음', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', approvalId: 'Approval ID', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: '자동화 대상 미리 보기', runs: '자동화 실행 목록', progress: '자동화 실행 진행률' },
    errors: { loadFailed: '자동화 목록을 불러오지 못했습니다', applicationAssetsLoadFailed: 'Failed to load application assets. Try again later.' }
  },
  routes: {
    certificateImport: '인증서 가져오기',
    certificateDetail: '인증서 정보',
    certificateUsages: '사용 관계',
    certificateFormats: '포맷 제품'
  },
  businessPage: {
    request: {
      notRequested: '아직 요청'
    },
    error: {
      unknown: '알 수 없는 오류'
    },
    primaryActionFailed: '주 작업을 수행하는데 실패했습니다',
    processing: '처리 중...',
    metricsAria: '업무 지표',
    apiFailed: '서비스 요청 실패',
    errorCode: '오류 코드: {code}',
    retry: '재시도',
    resourceList: '{resource}목록',
    total: '총 개수가 {count}이다',
    toggleFilters: '필터',
    all: '전체',
    clearFilters: '필터 비우기',
    pagination: '{page} 페이지/페이지당 {pageSize}',
    resourceDetailAria: '리소스상세 정보',
    resourceDetailTitle: '{resource}상세 정보',
    contextAria: '컨텍스트 항목',
    resourceActionsAria: '자원 작업',
    resourceActionsTitle: '자원 작업',
    resourceActionsHint: '고위험 작업은 시스템 인증 기준에 따라 재확인이 필요합니다.'
  },
  executionDetail: {
    error: {
      loadStepsFailed: '실행 단계 쿼리가 실패했습니다',
      streamConnectFailed: '자세한 업데이트 연결을 실행하는 데 실패했습니다'
    },
    step: {
      nameFallback: '절차 {index}',
      labels: {
        discover: '배포 대상 검색',
        backup: '현재 인증서 백업',
        install: '새 인증서 설치',
        reload: '서비스 다시 로드',
        verify: '인증서 검증',
        rollback: '인증서 롤백'
      },
      dryRunCheckSummary: '사전 점검결론:통과 {passed}/경고 {warning}/실패 {failed}/미확인 {unknown}.{topChecks}',
      dryRunPending: {
        queued: '아직 실행 중이지만 아직 실행되지 않았습니다.',
        running: '현재 단계 실행 중, Agent 가 사전 점검 결과를 반환하기를 기다립니다.',
        failed: '현재 단계가 실패했습니다. 사전 점검 결과를 가져오지 않았습니다.',
        finished: '현재단계종료, 아직 가져오기사전 점검결과.'
      },
      dryRunDiscover: '읽기 전용 사전 점검:배포 대상과 {providerLabel} 사이트 정보를 식별합니다.{siteName}, {binding} 바인딩.{pendingText}',
      dryRunVerify: '읽기 전용 사전 점검: 검증인증서 자료, 대상 바인딩 및 도메인 일치.대상 {providerLabel} 바인딩 {binding}.{pendingText}',
      dryRunCreated: '읽기 전용 사전 점검이 생성되었습니다.{pendingText}',
      workflowIdentity: '실행 버전: 플러그인 {plugin}; 워크플로 {workflow}',
      failure: {
        emptyMessage: '구체적인 오류 메시지가 없습니다',
        issue: '유형 {category}, 슬롯 {slot}, 경로 {path}, 소스 {source}, 수정 위치 {remediation}'
      },
      skipped: '단계를 건너뛰었습니다: {reason}',
      running: {
        dispatched: 'Agent 작업({taskId})이 발송되었으며 제어 플레인이 결과를 능동적으로 조회하고 있습니다.',
        waitingAgentResult: '단계 실행 중, 제어 플레인이 Agent 결과를 능동적으로 조회하고 있습니다…',
        waitingExternalResult: '절차 실행 중, 외부 실행 결과를 기다립니다...',
        resultUnconfirmed: '쓰기 결과를 확인해야 합니다: {code}: {message}. 이 단계는 자동으로 재실행되지 않습니다.'
      },
      unknownResult: '쓰기 결과를 알 수 없어 자동 재실행을 일시 중지했습니다.',
      diagnosticsTitle: '상세 검증 로그',
      structuredDetail: '구조화된 세부 정보 보기',
      pending: {
        waitingDependency: '절차가 선행절차가 완료되기를 기다린다.'
      },
      verifyRecovered: {
        detail: 'Agent 측의 원격 TLS 탐지에 실패하였으나 시스템은 이미 {remoteTarget}에 대한 실제 TLS 검증을 완료하여 대상 인증서가 일치하는 것을 확인하였다.{originalError}',
        originalSuffix: '원본 Agent 오류:{originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} 가 반환되었습니다.Agent taskId = {taskId}',
        withoutTask: '{executor} {mode} 가 반환되었습니다.'
      },
      createdFallback: '단계 {index} 가 생성되었습니다, 자세한 실행 대기...'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run를 실행하지 못했습니다',
        detail: '{failedStepCount}의 사전검사절차가 실패하였거나 시간을 초과하여 구조화된 사전점검 결론을 받지 못했다.'
      },
      queued: {
        label: 'Dry-run 대기 중',
        detail: '미리 보기 작업이 생성되었습니다. 실행을 기다립니다.'
      },
      running: {
        label: 'Dry-run 실행 중',
        detail: '사전 점검가 시작되었습니다. 결과가 반환되기를 기다립니다.'
      },
      pending: {
        label: 'Dry-run는 이미 끝났지만 결론이 없다',
        detail: '총 {finishedWithoutChecks} 절차가 이미 끝났지만 사전 점검결론을 받지 못했다.'
      },
      receiving: {
        label: 'Dry-run 접수 중',
        detail: '이미 부분적인 결론을 받았음:{passed}를 통해 {warning} 경고, {failed} 실패, {unknown} 알 수 없음.'
      },
      failed: {
        label: 'Dry-run 가 실패했습니다',
        detail: '{failed} 항목 사전 점검가 실패하면 {warning} 항목 경고, {passed} 항목 통과.'
      },
      tlsGrantRequired: {
        label: 'Dry-run 완료, 호스트 승인이 필요합니다',
        detail: '구조 및 보안 검사가 완료되었습니다. Dry-run은 정식 ExecutionGrant를 발급하지 않으므로 TLS 검증 우회가 거부되었습니다. 승인 후 정식 실행 시 호스트가 단기 ExecutionGrant를 발급합니다.'
      },
      warning: {
        label: 'Dry-run에 위험정보가 있습니다',
        detail: '사전 점검가 완료되었습니다:{passed} 항목 통과, {warning} 항목 경고, 알 수 없는 {unknown} 항목.'
      },
      passed: {
        label: 'Dry-run 가 성공하였다',
        detail: '사전 점검를 모두 통과하여 총 {passed} 항목을 획득했다.'
      }
    },
    agent: {
      taskSuffix: '(Agent taskId = {taskId})'
    },
    log: {
      verifyRecovered: '[ControlPlane] Agent 측의 원격 TLS 탐지에 실패하였으나 시스템에서 실제 TLS 검증을 완료하여 대상 인증서가 일치하는 것을 확인하였다.'
    },
    workflowStep: {
      failedDefault: '워크플로 노드 {index} 가 실패했습니다',
      skipped: '워크플로 노드가 건너뛰었습니다. 조건이 충족되지 않았습니다.',
      successAssertions: '워크플로 노드가 {passed}/{total}를 통해 성공적으로 실행되었다.',
      success: '워크플로 노드가 성공적으로 실행되었습니다.'
    },
    binding: {
      hostMissing: '호스트 헤더가 제공되지 않았습니다 (Host Header)'
    },
    site: {
      unnamed: '이름 없는 사이트'
    },
    provider: {
      target: '대상'
    },
    recovery: {
      confirm: '인증서 상태 확인 후 계속',
      running: '인증서 상태 확인 중…',
      confirmed: '대상 인증서가 적용된 것을 확인했습니다. 실행을 계속합니다.',
      failed: '인증서 검증에 실패하여 실행을 중지했습니다.',
      pending: '대상 인증서 상태를 아직 확인할 수 없습니다. 나중에 다시 시도하세요.'
    }
  },
  executions: {
    title: '실행 기록',
    description: '보기배포실행상태, 단계로그, dry-run 사전 점검결론, 실패원인 및 롤백엔트리.',
    resourceName: '실행 기록',
    errors: {
      streamConnectFailed: '세부 업데이트 연결 실패:HTTP {status}',
      loadFailed: '실행 기록을 불러오지 못했습니다'
    },
    actions: {
      refreshList: '목록 새로 고침',
      refreshing: '새로 고치는 중',
      viewDetail: '상세한 상황을 조사하다.',
      rollback: '스크롤백 시작',
      rollbackRisk: '롤백은 대상 서비스 인증서 구성을 다시 변경하므로 백업 참조 및 영향을 확인해야 합니다.'
    },
    messages: {
      recoveryConfirmed: '대상 인증서 상태를 확인했습니다. 실행을 계속합니다. 전역 작업 목록에서 진행 상황을 확인하세요.',
      recoveryFailed: '인증서 검증에 실패했습니다. 자세한 내용은 실행 로그에 기록되었습니다.',
      recoveryPending: '대상 인증서 상태가 아직 확인되지 않았습니다. 작업은 확인 대기 상태로 유지됩니다. 나중에 다시 시도하세요.'
    },
    columns: {
      name: '실행 번호',
      status: '상태',
      risk: '위험',
      planId: '계획을 배포하다.',
      startedAt: '시작 시간'
    },
    metrics: {
      total: {
        title: '실행총수',
        description: '현재 추적 가능한 실행 기록입니다.'
      },
      risky: {
        title: '고위험군은 처리를 기다린다.',
        description: '실패, 부분적 성공 또는 롤백해야 할 실행'
      }
    },
    fields: {
      executionId: 'ID를 실행한다',
      deploymentPlan: '계획을 배포하다.',
      runType: '실행 유형',
      status: '실행 상태',
      target: '목표를 실행하다',
      externalRunId: '외부에서 ID를 실행한다',
      startedAt: '시작 시간',
      finishedAt: '종료 시간',
      errorCode: '오류 코드',
      failureReason: '실패 원인'
    },
    links: {
      deploymentPlan: '배포 계획 보기',
      auditEvents: '보기감사이벤트'
    },
    empty: {
      title: '실행 기록이 없다',
      description: '배포 계획이 실행된 후 로그, 상태, 감사 연결이 표시됩니다.'
    },
    list: {
      ariaLabel: '실행 기록 목록', title: '실행 기록', summary: '총 {total}건, 최신 순으로 표시합니다.', range: '{start}-{end} / {total}',
      assetsLabel: '자산', logLabel: '로그 요약', runNumber: '{number}번째 실행', planUnknown: '연결된 배포 계획 없음', assetUnknown: '기록된 자산 없음', timeUnknown: '시작 시간 미기록',
      logRunning: '실행 중입니다.', logPending: '실행이 대기 중입니다.', logFailed: '실행 실패, 오류 코드: {code}', logSuccess: '실행 성공, 소요 시간 {duration}.', logCompleted: '실행이 종료되었습니다.',
      errorCodeUnknown: '미기록', durationUnknown: '알 수 없음', durationSeconds: '{count}초', durationMinutes: '{count}분', viewDetailHint: '상세 보기', openDetailAria: '계획 {plan}의 실행 기록 {id} 보기', previousPage: '이전', nextPage: '다음', pageSummary: '{page} / {pages} 페이지'
    },
    types: { dryRun: '사전 점검', apply: '실행', rollback: '롤백', retry: '재시도', unknown: '기타' },
    summary: {
      passed: '통과',
      warning: '경고',
      failed: '실패',
      unknown: '알 수 없음'
    },
    detail: {
      title: '실행 내역',
      titleWithId: '자세한 정보 실행 {id}',
      description: '실행 기록의 기본 정보, 단계 상태 및 로그 보기.',
      eyebrow: '실행 기록',
      planLabel: '배포 계획 {plan}',
      loadingSteps: '단계 불러오는 중...',
      loadingLogs: '로그 불러오는 중...',
      noStepDetail: '잠시 절차 설명이 없다',
      notStarted: '아직 시작하지 않음',
      noSteps: '잠시 절차가 없다.',
      noLogs: '아직 로그가 없습니다.',
      unknownResultDescription: '원래 설치 작업을 다시 실행하지 않습니다. 읽기 전용 TLS 인증서 지문 확인만 수행합니다.'
    },
    tabs: {
      summary: '개요',
      steps: '단계',
      logs: '로그'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: '연결 주소', connectionPort: '연결 포트', basePath: '기본 경로', timeoutSeconds: '시간 제한(초)', gateway: '실행 Gateway',
      authenticationMode: '인증 방식', credential: '장치 관리 자격 증명', username: '사용자 이름', passwordSecret: '암호 SecretRef', apiTokenSecret: 'API 토큰 SecretRef', clientCertificate: '클라이언트 인증서',
      tlsEnabled: 'HTTPS 사용', tlsVerifyPeer: '서버 인증서 검증', tlsIgnoreCertificateErrors: '인증서 오류 무시', tlsServerName: 'TLS 서버 이름', caSecret: 'CA SecretRef', tlsMinimumVersion: '최소 TLS 버전',
      deviceDisplayName: '장치 표시 이름', deviceDescription: '장치 설명', deviceTags: '장치 태그', targetName: '대상 이름', targetLabels: '대상 레이블'
    },
    forms: { loadOptions: '옵션 불러오기', previewTitle: '플러그인 구성 양식', loading: '플러그인 양식을 불러오는 중...', loadFailed: '플러그인 양식을 불러오지 못했습니다', empty: '이 플러그인은 구성 양식을 선언하지 않았습니다.' },
    presentation: { previewTitle: '표준 장치 표시 미리보기', sensitiveValue: '민감한 값 숨김', tabsAriaLabel: '장치 정보 탭' },
    title: '플러그인',
    description: '플러그인 패키지, 실행기, 권한 선언, 샌드박스와 격리된 상태를 관리합니다.',
    resourceName: '플러그인',
    actions: {
      install: '플러그인 설치',
      detail: '상세 정보',
      create: '만들기',
      refresh: '마켓 새로고침',
      refreshing: '새로고침 중...',
      createWorkflow: '워크플로 만들기',
      creatingWorkflow: '만드는 중...',
      enable: '활성화',
      disabling: '비활성화 중...',
      disable: '비활성화',
      disableRisk: '플러그인을 사용하지 않으면 Provider, 템플릿, 실행기 기능에 영향을 준다.'
    },
    market: { eyebrow: 'DSL 플러그인 마켓', title: '재사용 가능한 자동화 기능 찾기', description: '기본 제공 템플릿은 시스템과 함께 배포되고 사용자 템플릿은 data/workflows 에서 로드됩니다. 각 템플릿은 Logo, 시맨틱 버전, 태그를 관리할 수 있습니다.' },
    sources: { builtin: '기본 제공', user: '사용자 플러그인' },
    statuses: { valid: '사용 가능', invalid: '유효하지 않음', available: '생성 가능', enabled: '활성화됨', disabled: '활성화되지 않음', pendingApproval: '승인 대기', inUse: '사용 중', notInUse: '사용하지 않음' },
    filters: { searchLabel: '플러그인 검색', searchPlaceholder: '이름, 태그, 분류 또는 경로로 검색', allSources: '모든 출처', allStatuses: '모든 상태', statusLabel: '플러그인 상태' },
    card: { defaultDescription: '이 DSL 플러그인에는 아직 설명이 없습니다.', unversioned: '버전 없음', stepCount: '실행 단계 {count}개', moreTags: '{count}개 더' },
    columns: {
      name: '플러그인 이름',
      status: '상태',
      risk: '위험',
      version: '버전',
      signature: '서명'
    },
    metrics: {
      total: {
        title: '총 플러그인',
        description: '설치되어 업그레이드 가능한 플러그인.'
      },
      builtin: { title: '기본 제공 플러그인' },
      user: { title: '사용자 플러그인' },
      enabled: { title: '활성화된 플러그인' },
      using: { title: '사용 중' },
      risky: {
        title: '고위험군은 처리를 기다린다.',
        description: '고위험 권한, 예외 서명 또는 샌드박스 격리 플러그인.'
      }
    },
    empty: {
      title: '없음플러그인',
      description: '설치 전에 플러그인 권한, 서명, 롤백 정책을 확인하세요.'
    },
    detail: {
      title: '플러그인 자세한 정보',
      titleWithName: '플러그인 {name}',
      description: '플러그인, 권한 선언, 샌드박스 검역 정보 보기.',
      versionLabel: '{version} 버전'
    },
    types: { provider: '클라우드 Provider 플러그인', standard: '표준 플러그인' },
    fields: {
      pluginId: '플러그인 ID',
      pluginType: '플러그인 유형',
      provider: '클라우드 공급자',
      name: '플러그인 이름',
      currentStatus: '현재 상태',
      version: '버전',
      source: '출처', category: '분류', steps: '실행 단계', rollbackSteps: '롤백 단계', updatedAt: '업데이트 시간', filePath: '템플릿 경로', logoUrl: 'Logo URL', platforms: '대상 플랫폼', updateMethods: '업데이트 방식', maintainer: '관리자', homepage: '프로젝트 홈페이지', usage: '사용 상태', validationError: '검증 오류',
      signatureStatus: '서명 상태',
      riskLevel: '위험수준', runtime: '런타임', executionMode: '실행 모델', scope: '적용 범위', support: '지원 수준', capabilities: '기능', frameworks: '대상 프레임워크', products: '지원 제품', operations: '지원 작업'
    },
    labels: { permissions: '선언된 권한', runnerStatus: 'Runner 상태' },
    permissionKeys: {
      network_http: '네트워크 요청', secret_read: '비밀 읽기', artifact_read: '아티팩트 읽기', device_write: '장치 쓰기',
      agent_execution_receipt: 'Agent 실행 영수증', agent_fact_collect: 'Agent 정보 수집', agent_plan_execute: 'Agent 계획 실행', agent_plan_validate: 'Agent 계획 검증',
      audit_append: '감사 기록 추가', cloud_service_get: '클라우드 서비스 읽기', execution_cancel_read: '실행 취소 상태 읽기', execution_checkpoint: '실행 체크포인트',
      execution_checkpoint_read: '실행 체크포인트 읽기', execution_checkpoint_write: '실행 체크포인트 쓰기', execution_progress: '실행 진행률', execution_progress_write: '실행 진행률 쓰기',
      resource_lock: '리소스 잠금', secret_resolve: '비밀 확인'
    },
    runnerStatuses: { ready: 'Runner 준비됨', busy: 'Runner 실행 중', unavailable: 'Runner 사용 불가', notObserved: 'Runner 관측되지 않음' },
    capabilityKeys: {
      device_connection_test: '연결 테스트', device_identity_detect: '장치 식별', device_discover: '장치 검색', device_logs_read: '장치 로그 읽기',
      certificate_discover: '인증서 검색', certificate_deploy: '인증서 배포', certificate_rollback: '인증서 롤백', certificate_verify: '인증서 검증',
      application_discover: '애플리케이션 검색', ca_account_manage: 'CA 계정 관리', ca_order_manage: 'CA 주문 관리', ca_challenge_orchestrate: 'CA 챌린지 조정',
      ca_challenge_dns_solver: 'CA DNS 챌린지 해결', ca_certificate_issue: 'CA 인증서 발급', ca_certificate_renew: 'CA 인증서 갱신', ca_certificate_revoke: 'CA 인증서 폐기',
      cloud_service_connection_test: '클라우드 서비스 연결 테스트', cloud_service_discover: '클라우드 서비스 검색'
    },
    unknownCatalogValue: '알 수 없는 카탈로그 값: {value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: '사용자 지정 런타임', runtime_custom: '사용자 지정 런타임', adc_load_balancer: 'ADC 로드 밸런서', cloud_aliyun_cdn: 'Alibaba Cloud CDN', cloud_aliyun_alb: 'Alibaba Cloud ALB', cloud_aliyun_clb: 'Alibaba Cloud CLB', cloud_aliyun_oss: 'Alibaba Cloud OSS', cloud_aliyun_waf_cname: 'Alibaba Cloud WAF CNAME', cloud_aliyun_waf_cloud: 'Alibaba Cloud WAF Cloud', cloud_aliyun_live: 'Alibaba Cloud Live', cloud_aliyun_vod: 'Alibaba Cloud VOD', cloud_tencent_cdn: 'Tencent Cloud CDN', cloud_tencent_clb: 'Tencent Cloud CLB', cloud_tencent_live: 'Tencent Cloud Live', cloud_huawei_cdn: 'Huawei Cloud CDN', cloud_huawei_elb: 'Huawei Cloud ELB', cloud_volcengine_cdn: 'Volcengine CDN', cloud_volcengine_alb: 'Volcengine ALB', cloud_volcengine_clb: 'Volcengine CLB', cloud_volcengine_live: 'Volcengine Live', cloud_volcengine_vod: 'Volcengine VOD' },
    runtimeTypes: { agent_atomic: 'Agent 원자 실행', workflow_dsl: '워크플로 DSL' },
    scopeTypes: { managed: '관리 대상', standalone: '독립 대상', both: '관리 / 독립' },
    supportTypes: { official: '공식 지원', community: '커뮤니티 지원', self_managed: '자체 관리' },
    aria: { filters: '플러그인 마켓 필터', list: 'DSL 플러그인 목록', logo: '{name} Logo' },
    errors: { loadFailed: '플러그인 마켓을 불러오지 못했습니다', createFailed: '플러그인에서 워크플로를 만들지 못했습니다' },
    agentDeployment: {
      mount: 'Agent에 마운트', mounting: '마운트 중...', selectAgent: '대상 Agent 선택', type: '플러그인 유형', targetAgent: '대상 Agent', mountFailed: 'Agent 플러그인을 마운트하지 못했습니다',
      executionMode: 'Agent 실행 모드', nativeHandler: '기본 핸들러', pluginMode: 'Agent 플러그인', mountedPlugin: '마운트된 플러그인', selectMountedPlugin: '마운트된 플러그인 선택',
      plugin: '배포 플러그인', selectPlugin: '배포 플러그인 선택', noCompatiblePlugin: '현재 플랫폼 및 프레임워크와 일치하는 활성 플러그인이 없습니다', compatiblePluginHint: '자산 플랫폼 및 프레임워크와 일치하는 활성 플러그인만 표시합니다.',
      secretRefPlaceholder: 'SecretRef 식별자 입력', artifactBinding: '인증서 산출물 {name}', artifactBindingPlaceholder: '예: value=fullchain,key=private', preview: '플러그인 설정 검증', previewFailed: 'Agent 플러그인 설정 검증에 실패했습니다',
      approveAndEnable: '권한 승인 및 활성화', activating: '활성화 중...', activateFailed: 'Agent 플러그인 승인 또는 활성화에 실패했습니다', disableFailed: 'Agent 플러그인 비활성화에 실패했습니다',
      types: { WORKFLOW_TEMPLATE: '워크플로 템플릿', UNIFIED_PLUGIN: '통합 기능 플러그인' }
    },
    changeSummaries: { createWorkflow: '플러그인 마켓 템플릿에서 워크플로 만들기' }
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
    title: '계획을 배포하다.',
    description: '계획 미리보기, 영향 범위, 승인, 배포 실행, 인증 및 롤백 항목.',
    resourceName: '계획을 배포하다.',
    apiActions: {
      submit: '배포 계획을 제출하다',
      execute: '배포 계획을 실행하다.',
      cancel: '배포 계획을 철회하다',
      delete: '배포 계획 삭제'
    },
    actions: {
      create: '배포 계획 만들기',
      detail: '상세 정보',
      edit: '계획 편집',
      dryRun: 'Dry-run 영향 미리보기',
      dryRunRisk: '영향 미리보기만 생성하고 정식 배포는 하지 않습니다.',
      submit: '심사 비준에 회부하다.',
      submitRisk: '제출되면 계획은 허가 또는 이행 상태에 들어갈 것이다.',
      review: '승인 검토',
      approve: '승인 요청 승인',
      approveRisk: '승인 후 실행할 수 있으며 호스트가 발급한 ExecutionGrant는 실행 시 계속 필요합니다.',
      reject: '승인 요청 거부',
      rejectRisk: '거부된 계획은 실행할 수 없으며 다시 승인을 제출해야 합니다.',
      execute: '포치를 실행하다.',
      executeRisk: '실행은 대상 인증서 설정을 수정합니다. 완료되었거나 실패한 계획을 다시 실행할 때도 이 항목을 사용합니다. 실행 시 필요한 동기 사전 검사를 수행하며, 자산 상세 인증서 배포에서 선택적으로 Dry-run 미리보기를 실행할 수 있습니다.',
      cancel: '계획을 취소하다',
      cancelRisk: '미완의 배포 계획은 취소될 뿐, 이미 배포된 배포는 철수하지 않는다.',
      rollback: '실행 롤백',
      rollbackRisk: '롤백은 대상 서비스 인증서 설정을 다시 수정하며 실제 runId를 사용해야 한다.',
      delete: '계획 삭제',
      deleteRisk: '계획, 배포 대상, 실행 기록 및 감사 기록은 영구적으로 삭제되며 복구할 수 없습니다.'
    },
    columns: {
      name: '프로젝트 이름',
      status: '상태',
      currentAssetCertificateExpiresAt: '현재 인증서 만료 시간',
      updateNeeded: '업데이트 필요',
      scheduledAt: '시간을 계획하다',
      actions: '작업'
    },
    metrics: {
      total: {
        title: '계획 총수',
        description: '승인, 실행 및 실행을 기다리는 계획.'
      },
      risky: {
        title: '고위험군은 처리를 기다린다.',
        description: '생산 서비스에 영향을 미치거나 롤오버 능력이 부족한 계획.'
      }
    },
    fields: {
      planId: 'ID로 계획한다',
      name: '프로젝트 이름',
      status: '계획 상태',
      approvalStatus: '승인상태',
      certificateVersionId: '인증서 버전 ID',
      certificateFormatId: '인증서 형식 설정 ID',
      workflowDslVersion: '워크플로 DSL 버전',
      currentAssetCertificateExpiresAt: '현재 인증서 만료 시간',
      updateNeeded: '업데이트 필요',
      targetSummary: '대상 바인딩 요약',
      latestRun: '최신 실행 일정',
      approvalId: 'ID를 심사비준한다',
      snapshotHash: 'Hash 스냅샷',
      failureReason: '실패 원인',
      createdAt: '만든 시간',
      updatedAt: '업데이트 시간'
    },
    links: {
      executions: '실행 기록 보기',
      bindings: '연결된 바인딩 보기'
    },
    empty: {
      title: '배포 계획은 잠시 없다',
      description: '인증서나 바인딩에서 배포 마법사를 시작하여 영향 미리보기를 만든 다음 계획을 제출합니다.'
    },
    disabled: {
      missingApproval: '승인 정보가 없으면 실행할 수 없습니다.',
      approvalPending: '승인 요청이 제출되었습니다. 승인자가 승인한 후 실행할 수 있습니다.',
      approvalRejected: '승인이 거부되어 실행할 수 없습니다.',
      needDryRun: 'Dry-run은 인증서, 도메인 및 대상 호환성 검사를 확인하는 선택적 영향 미리보기입니다.',
      missingRunId: 'runId 가 없으면 롤백할 수 없습니다.',
      missingSelection: '배포 계획 선택이 없습니다'
    },
    common: {
      cancel: '취소',
      close: '닫기',
      notConfigured: '구성되지 않음',
      notProvided: '제공되지 않음'
    },
    approval: {
      title: '승인 상세',
      description: '배포 계획 범위를 검토한 후 요청을 직접 승인하거나 거부합니다.',
      requestedBy: '요청자',
      riskLevel: '위험 수준',
      decisionHint: '승인 후 실제 실행이 가능합니다. 거부된 계획은 다시 제출해야 합니다.',
      processing: '처리 중...',
      missingApprovalId: '승인 ID가 없어 검토할 수 없습니다.',
      decisionFailed: '승인 작업에 실패했습니다.'
    },
    detail: {
      certificateVersionLabel: '인증서 버전',
      description: '계획 기본 정보, 연결 기록 및 최근 실행 결과 보기.',
      emptyRelatedRecords: '잠시 관련 기록이 없다.',
      loadingRelatedRecords: '연결된 레코드 불러오는 중...',
      noExecutionRecords: '현재의 계획은 아직 집행 기록이 없다.',
      inputSourcesLoadFailed: '배포 입력 출처를 불러오지 못했습니다',
      inputSourcesTitle: '배포 입력 출처',
      inputSource: '출처: {source}',
      inputSourceTarget: '배포 대상: {targetId}',
      noInputSources: '이 계획에 표시할 변수 출처가 없습니다.',
      noTargetSummary: '대상 요약이 제공되지 않았습니다',
      workflowIdentityTitle: '워크플로 실행 식별자',
      workflowMode: '사용자 워크플로',
      workflowModePluginInternal: '플러그인 내장 워크플로',
      workflowDslVersion: '실제 DSL 버전: {version}',
      workflowPluginVersion: '실제 플러그인 버전: {version}',
      workflowPluginVersionId: '플러그인 버전 ID: {versionId}',
      workflowVersionId: '버전 스냅샷 ID: {versionId}',
      workflowVersionSelectionPinned: '버전 정책: 계획에서 고정',
      workflowVersionSelectionLatest: '버전 정책: 애플리케이션 자산의 최신 게시 버전',
      workflowIdentityUnavailable: '워크플로 버전 정보를 사용할 수 없습니다',
      planIdLine: '계획 ID {planId}',
      recordKinds: {
        certificateUpdate: '인증서 갱신',
        dryRun: 'Dry-run'
      },
      relatedPlan: '{planId}로 계획하고 있다',
      relatedRun: '{runId}를 실행한다',
      relatedSource: '출처 {source}',
      tabs: {
        latestExecution: '최근 실행',
        relatedRecords: '관련 기록',
        summary: '개요'
      },
      targetLabel: '대상',
      title: '배포 계획 상세 사항',
      titleWithName: '배포 계획 {name}',
      viewLogs: '로그 보기'
    },
    dryRunRequired: {
      copy: '현재 작업: {action}. Dry-run은 선택적 영향 미리보기이며 실제 실행을 차단하지 않습니다.',
      description: '동기 Dry-run으로 정적 검사 결과를 확인할 수 있으며, 실행 시 필요한 사전 검사를 다시 수행합니다.',
      primaryAction: 'Dry-run 실행',
      runningAction: 'Dry-run 실행 중...',
      title: '선택적 Dry-run 미리보기'
    },
    execution: {
      applyName: '{runId}를 구현합니다',
      applyTitle: '인증서 갱신 실행',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Dry-run 결과',
      fallbackName: '{runId}를 실행합니다',
      rollbackTitle: '인증서 롤백 실행',
      startingName: '실행 시작 중'
    },
    feedback: {
      cancelled: '배포 계획은 이미 취소되었다.',
      cancelledWithPlanId: '배포 계획이 취소되었습니다(계획 {planId}).',
      deleted: '배포 계획이 삭제되었습니다.',
      deletedWithPlanId: '배포 계획이 삭제되었습니다 (플랜 {planId}).',
      dryRunStartedMissingRunId: '사전 점검가 이미 시작되었다.',
      dryRunStartedWithRunId: '사전 점검가 시작되었습니다 ({runId}) 모달에서 진행 상황을 확인하세요.',
      dryRunTriggered: '사전 점검가 실행되었습니다.',
      dryRunTriggeredWithPlanId: '사전 테스트 트리거 (program {planId})',
      dryRunTriggeredWithRunId: '{runId} 가 트리거되었습니다. 모달에서 진행 상황을 보십시오.',
      dryRunTaskStarted: 'Dry-run이 시작되었습니다. 오른쪽 위 작업 목록에서 진행 상황을 확인하세요.',
      executeTriggered: '배포가 트리거되었습니다.',
      executeTriggeredWithPlanId: '배포 트리거 (플랜 {planId}).',
      executeTriggeredWithRunId: '배포가 트리거되었습니다 ({runId}) 모달에서 진행 상황을 확인하세요.',
      executionTaskStarted: '작업이 시작되었습니다. 오른쪽 위 작업 목록에서 진행 상황을 확인하세요.',
      executionTaskSucceeded: '작업이 성공적으로 완료되었습니다. 오른쪽 위 작업 목록에서 결과를 확인하세요.',
      executeTaskStarted: '인증서 배포가 시작되었습니다. 오른쪽 위 작업 목록에서 진행 상황을 확인하세요.',
      executeTaskPendingApproval: '인증서 배포가 제출되었고 승인을 기다리고 있습니다. 오른쪽 위 작업 목록에서 확인하세요.',
      rollbackTaskStarted: '인증서 롤백이 시작되었습니다. 오른쪽 위 작업 목록에서 진행 상황을 확인하세요.',
      loadedDraft: '계획 초안을 불러왔습니다.',
      loadedDraftWithPlanId: '초안 로딩 ({planId}).',
      savedWithPlanId: '계획저장({planId}).',
      submitted: '배포 계획이 제출되었습니다.',
      submittedWithPlanId: '배포 계획이 제출되었습니다(계획 {planId}).',
      approvalApproved: '승인이 완료되었습니다. 이제 계획을 실행할 수 있습니다.',
      approvalApprovedWithPlanId: '승인이 완료되었습니다. 계획 {planId}을(를) 실행할 수 있습니다.',
      approvalRejected: '승인이 거부되었습니다. 계획을 실행할 수 없습니다.',
      approvalRejectedWithPlanId: '승인이 거부되었습니다. 계획 {planId}을(를) 실행할 수 없습니다.'
    },
    target: {
      controlPlane: '플랫폼',
      noBindingInfo: '바인딩 정보가 제공되지 않았습니다',
      noCertificateVariables: '인증서 변수를 바인딩하지 않았습니다',
      noHostHeader: '호스트 헤더가 제공되지 않았습니다 (Host Header)',
      noOutputSelected: '출력 항목이 선택되지 않았습니다'
    },
    errors: {
      actionFailed: '{action}실패',
      createReturnedMissingPlanId: '플래그를 성공적으로 만들었지만 번호를 받지 못했습니다. 목록을 새로 고치십시오.',
      loadCreateDataFailed: '생성 데이터를 만들기 위해 배포 계획을 불러오는 데 실패했습니다',
      loadRelatedRecordsFailed: '연결 로그를 불러오는 데 실패했습니다',
      missingApplicationAssetIdForDryRun: '응용 자산이 없어 사전 점검을 시작할 수 없습니다.',
      missingApplicationAssetIdForSave: '어플리케이션 자산이 없습니다. 계획을 저장할 수 없습니다.',
      missingPlanId: '플랜 번호가 없습니다. 다시 선택하세요.',
      missingPlanIdForAction: '{action} 실패:플랜 번호가 없습니다. 다시 선택하세요.',
      missingRunIdRequest: '실행 번호가 없습니다. 다시 선택하세요.',
      saveFailed: '배포 계획을 저장하는 데 실패했습니다',
      startDryRunFailed: 'dry-run를 시작하는데 실패했습니다',
      inputIssuesHint: '표시된 슬롯과 바인딩 계층의 배포 입력을 수정한 후 다시 시도하세요.'
    }
  },
  agents: {
    actions: {
      close: '닫기',
      delete: '삭제',
      deleteRisk: '삭제는 직접 Agent 기록을 삭제하며,이 작업은 되돌릴 수 없다.',
      detail: '상세 정보',
      disable: '비활성화',
      disableRisk: '비활성화 후 이 Agent는 새 작업 수신을 중지합니다.',
      enable: '활성화',
      enableRisk: '사용 후 Agent는 예약가능 상태로 복원됩니다.'
    },
    app: {
      fallbackName: '응용 프로그램 {index}'
    },
    certificate: {
      boundCertificate: '사이트 바인딩 인증서',
      expiredDays: '{days}일 만료됨',
      expiresToday: '오늘이 기한이다',
      modalDescription: '현재 사이트 바인딩에 사용되는 인증서 키 정보를 보여줍니다.',
      modalTitle: '인증서 정보',
      overviewDescription: '인증서의 이름, 발행인, 시작 시간, 만료 시간, 지문 등과 같은 중요 정보를 표시합니다.',
      overviewTitle: '인증서 개요',
      projectDetailDescription: '현재 Agent 상세 정보 문맥에서 항목 내 인증서 자산의 상세 정보와 관련 사용 관계를 보여줍니다.',
      projectDetailTitle: '이 항목의 인증서에 대한 자세한 정보입니다',
      querying: '조회 중...',
      remainingDays: '나머지 {days} 데이',
      remainingWithViewAction: '{remaining} / 클릭하여 인증서 보기',
      statusExpired: '만료됨',
      statusExpiring: '기한이 곧 지나가다',
      statusLabel: '인증서 상태',
      statusUnknown: '알 수 없는 유효기간',
      statusValid: '유효',
      view: '인증서 보기',
      viewProjectDetail: '이 항목의 인증서에 대한 자세한 정보를 참조하세요'
    },
    // 兼容旧版本证书卡片的翻译 key，避免已缓存 bundle 在升级后产生缺失告警。
    statusBlock: {
      tooltip: { name: '이름', issuer: '발급자', startTime: '시작 시간', endTime: '종료 시간', daysRemaining: '남은 일수', connectionStatus: '연결 상태', version: '버전', managementAddress: '관리 주소', lastCommunicationTime: '최근 통신 시간', platform: '애플리케이션 플랫폼', protocolPort: '프로토콜 및 포트', certificateDaysRemaining: '인증서 남은 일수', region: '지역', latency: '지연 시간' },
      detail: {
        certificateRemaining: '{name}, {days}'
      }
    },
    certificateUsage: {
      iisSite: 'Agent IIS 사이트',
      linuxSite: 'Agent Linux 사이트',
      tomcatConnector: 'Agent Tomcat 링커'
    },
    columns: {
      actions: '작업',
      hostname: '호스트명',
      ipAddress: 'IP 주소',
      lastHeartbeat: '최근 하트비트',
      onlineStatus: '온라인 상태',
      osType: '시스템 형식',
      version: '버전'
    },
    common: {
      defaultAddress: '기본 주소',
      no: '아니요',
      noHostHeader: '없음 Host Header',
      noListenAddress: '수신기 주소 없음',
      none: '없음',
      notConfigured: '구성되지 않음',
      notProvided: '제공되지 않음',
      notWritable: '쓰기 불가',
      unrecognized: '인식되지 않음',
      writable: '쓰기 가능',
      yes: '예'
    },
    detail: {
      loading: '더 자세히 불러오는 중...',
      manualRescan: '수동으로 다시 청소',
      manualRescanCannotPullTasks: '현재 Agent를 사용할 수 없으므로 다시 스캔할 수 없습니다',
      manualRescanCreated: '수동 다시 스윕 작업이 생성되었습니다. Agent 호출을 기다립니다.',
      manualRescanSubmitting: '전송을 다시 스캔하는 중...',
      manualRescanUnsupportedType: '현재 Agent 형식은 수동으로 다시 스캔할 수 없습니다',
      modalDescription: 'Agent의 주요 정보, 실행 환경 및 IIS 사이트 정보를 보기.',
      modalTitle: 'Agent상세 정보',
      nodeEyebrow: 'Agent 노드',
      tabsAriaLabel: 'Agent상세 정보탭'
    },
    empty: {
      description: '오른쪽 상단의\'Agent 설치\'를 클릭하고, 플랫폼과 버전을 선택한 후 한번에 설치 명령을 생성한다.',
      noFrameworkSites: '{name} 사이트를 찾을 수 없습니다',
      noIisSites: 'IIS 사이트를 찾을 수 없습니다',
      noRuntimeLogs: '아직 로그가 없습니다.',
      noTomcatApps: 'Tomcat 앱을 찾을 수 없습니다',
      noTomcatConnectors: 'Tomcat 링크를 찾을 수 없습니다',
      title: '현재 Agent 가 없습니다'
    },
    errors: {
      certificateAssetIncomplete: '인증서 자산 데이터가 완전하지 않습니다. 자세한 정보를 확인할 수 없습니다.',
      certificateAssetNotFound: '이 항목에서 해당 인증서 자산을 찾을 수 없습니다.',
      certificateAssetQueryFailed: '인증서 자산 검색이 실패했습니다.',
      detailDataMissing: '자세한 정보를 얻을 수 없습니다.',
      generateInstallCommandFailed: '설치 명령 생성에 실패했습니다.',
      installCommandMissing: '시스템이 설치 명령을 반환하지 않았습니다.',
      loadDetailFailed: '자세한 정보를 불러오는 데 실패했습니다.',
      manualRescanFailed: '수동 다시 스캔을 시작할 수 없습니다.'
    },
    fields: {
      agentVersion: 'Agent 버전',
      appCount: '응용 프로그램 수',
      appList: '적용 목록',
      appPool: '프로그램 풀',
      arch: '시스템아키텍처',
      binaryPath: '이진 경로',
      certificateFile: '인증서 파일',
      certificateName: '인증서 이름',
      certificateStore: '인증서 저장소',
      certificateSubject: '인증서 주체',
      certificateThumbprint: '인증서 지문',
      configFile: '구성파일',
      configPath: '경로 설정',
      connectorCount: '연결기 수',
      connectorList: '커넥터목록',
      domain: '도메인',
      frameworkVersion: '{name} 버전',
      healthStatus: '건강 상태',
      healthSummary: '예외 요약',
      hostname: '호스트명',
      httpsBinding: 'HTTPS 바인딩',
      httpsListen: 'HTTPS 모니터',
      iisVersion: 'IIS 버전',
      installPrefix: '접두사 설치하기',
      installStatus: '설치 상태',
      ipAddress: 'IP 주소',
      issuer: '발급자',
      lastCapabilityReportAt: '지난번 능력 보고 시간',
      lastHeartbeat: '최근 하트비트',
      lastRecoveryAt: '최근 복구 시간',
      lastReportAt: '최근 상신 시간',
      linuxDistribution: 'Linux 발행판',
      listenAddress: '수신 주소',
      notAfter: '기한',
      notBefore: '시작 시간',
      offlineDetected: '오프라인 확인',
      osType: '시스템 형식',
      osVersion: '운영체제 버전',
      patchVersion: '패치 버전',
      privateKeyOrKeystore: '개인 전용 키/Keystore',
      proxyTarget: '프록시 대상',
      remainingDays: '잔여 일수',
      role: '역할',
      runningStatus: '실행상태',
      runtimeLog: '실행 로그',
      serviceName: '서비스 이름',
      sha256Fingerprint: 'SHA-256 지문',
      siteCount: '사이트 수',
      siteList: '사이트 목록',
      tlsConnector: 'TLS 링커',
      tomcatVersion: 'Tomcat 버전',
      zone: '영역'
    },
    health: {
      degraded: '저하됨',
      failed: '실패',
      healthy: '정상',
      unknown: '알 수 없음'
    },
    install: {
      bootstrapToken: '설치 코드',
      command: '설치 명령',
      commandStepTitle: '설치 명령 생성',
      commandCopied: '설치 명령복사',
      copyCommand: '설치 명령 복사',
      copyToken: '복사설치 코드',
      expired: '만료됨',
      generateCommand: '생성설치 명령',
      generating: '생성 중...',
      compatibilityInstallUnavailable: 'Windows Compatibility Agent의 일회용 설치 프로그램은 아직 게시되지 않았습니다. Windows Modern Agent 명령으로 대체하지 마십시오.',
      installEntryPending: '설치 프로그램 준비 중',
      linuxGeneralTitle: 'Linux 공용 Agent',
      linuxGroupTitle: 'Linux',
      modalDescription: '플랫폼과 버전을 선택하고 일회용 설치 명령을 생성합니다.설치 코드는 10분 이내에 유효하며, 한 번만 사용할 수 있다.',
      modalTitle: 'Agent를 설치합니다',
      platform: '플랫폼',
      platformLinuxDescription: 'Ubuntu, Debian, CentOS, Rocky, AlmaLinux 등 Linux 발행판에 적용된다.',
      platformWindowsDescription: 'Windows Server 및 Windows 10/11에 적용, 설치 후 등록시스템 서비스.',
      remainingTime: '{minutes} 분 {seconds} 초',
      remainingValidity: '잔여 유효기간',
      selectedAgent: '선택한 Agent',
      selectionStepTitle: 'Agent 유형 선택',
      singleUseHint: '동일한 설치 코드가 일단 bootstrap 스크립트를 요청받으면 즉시 효력을 잃으며 다시 사용할 수 없다.',
      tokenCopied: '설치 코드를 복사했습니다',
      version: '버전',
      versionLatest: '최신 안정판',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 이상',
      windowsModernTitle: 'Windows Modern Agent',
      zone: '영역'
    },
    labels: {
      certificatePath: '인증서: {value}',
      deployDirectory: '배포디렉터리: {value}',
      directory: '디렉터리: {value}',
      keystorePath: 'Keystore: {value}',
      listenAddress: '수신 주소: {value}',
      path: '경로: {value}',
      privateKeyPath: '개인 키: {value}',
      reloadCommand: 'Reload 명령: {value}',
      siteName: '사이트이름: {value}',
      taskType: '작업유형: {value}',
      testCommand: '테스트 명령: {value}',
      thumbprint: '지문: {value}'
    },
    linux: {
      certDirectoryWritable: '인증서 디렉터리: {status}',
      helperRequired: 'helper 필요합니다',
      keyDirectoryWritable: '개인 키디렉터리: {status}',
      permissionMode: '권한모드: {mode}'
    },
    logs: {
      collapse: '접기',
      expand: '펼치기',
      listAriaLabel: '실행 로그 목록'
    },
    metrics: {
      abnormalDescription: '오프라인, 실패 또는 드리프트 상태의 Agent를 우선 처리해야 합니다.',
      abnormalTitle: '이상하다',
      totalDescription: '현재 시스템에 등록된 Agent 수.',
      totalTitle: 'Agent 총 번호'
    },
    page: {
      description: 'Agent 목록을 보고, 여러 플랫폼에 대한 설치 명령을 생성하고 모달에서 자세한 내용을 볼 수 있다.',
      installAgent: '설치Agent'
    },
    sections: {
      frameworkOverviewDescription: '호스트 프레임의 {name} 설치 상태, 실행 상태 및 설정 위치.',
      frameworkOverviewTitle: '{name} 프로필',
      frameworkSitesDescription: '{name}이 식별한 사이트, 루트 디렉터리, 도메인, 역방향 프록시 대상 및 인증서 파일 경로입니다.',
      frameworkSitesTitle: '{name} 사이트',
      healthDescription: '시스템은 Agent의 오프라인 판단, 복구 시간과 실행 건강 요지를 제공합니다.',
      healthTitle: '건강과 회복',
      iisOverviewDescription: '호스트 프레임에 IIS 설치 상태 및 버전 정보.',
      iisOverviewTitle: 'IIS 프로필',
      iisSitesDescription: 'IIS 사이트 목록, 사이트 경로, 바인딩 포트, 인증서 테마 이름.',
      iisSitesTitle: 'IIS 사이트',
      logOverviewDescription: '가장 최근의 능력 보고 시간은 능력 정보의 실효성을 판단하는데 사용된다.',
      logOverviewTitle: '로그개요',
      mainInfoDescription: 'Agent 아이디, 캐릭터 및 하트비트 상태.',
      mainInfoTitle: '주요 정보',
      runtimeDescription: 'Agent는 실행 시스템과 버전 정보를 보고합니다.',
      runtimeLogsDescription: '수동으로 다시 스캔한 결과, 이상 심장박동 및 중단 기능 보고 등 작동일지를 작성해야 한다.',
      runtimeLogsTitle: '실행 로그',
      runtimeTitle: '실행 환경',
      tomcatAppsDescription: 'Tomcat Host/Context에서 앱 경로와 배포 디렉토리를 식별합니다.',
      tomcatAppsTitle: 'Tomcat 앱',
      tomcatConnectorsDescription: 'Tomcat Connector 수신 주소, 프로토콜, TLS 스위치 및 인증서 경로.',
      tomcatConnectorsTitle: 'Tomcat 링커',
      tomcatOverviewDescription: '호스트 프레임의 Tomcat 설치 상태, 실행 상태와 Catalina 경로.',
      tomcatOverviewTitle: 'Tomcat 프로필'
    },
    site: {
      domainCount: '{count} 도메인',
      fallbackName: '사이트 {index}'
    },
    siteMode: {
      reverseProxy: '역방향 프록시',
      staticRoot: '정적 사이트'
    },
    status: {
      installed: '설치됨',
      notInstalled: '설치되지 않음',
      notRunning: '실행되지 않음',
      running: '실행 중'
    },
    tabs: {
      logs: '로그',
      overview: '개요'
    }
  },
  dashboard: {
    overview: {
      eyebrow: '운영 개요'
    },
    resources: {
      title: '시스템 리소스', description: '대시보드 호스트의 CPU 및 메모리 실시간 사용량입니다.', cpu: 'CPU 사용량', memory: '메모리 사용량', host: '호스트', abnormal: '주의', usageAria: '{metric} 사용량 {value}%', unavailableAria: '{metric}을 사용할 수 없습니다'
    },
    quickStart: {
      title: '여기에서 빠르게 시작', description: '인증서 준비를 빠르게 완료하고 애플리케이션에 배포하도록 도와줍니다.', addCertificate: '새 인증서 가져오기 또는 신청', deployExistingApplication: '웹 사이트 또는 애플리케이션에 배포', unavailable: '사용 가능한 입구 없음', safeExecution: '안전한 실행', guidedFlow: '안내 흐름'
    },
    trends: {
      title: '실행 추세', noDelta: '--', auditSuccess: { title: '감사 성공률', suffix: '성공률' }, managedObjects: { title: '객체 상태', suffix: '정상 객체' }, certificateAttention: { title: '인증서 주의', suffix: '검토 필요' }
    },
    statusPanel: { description: '인증서, Agent, 게이트웨이 및 애플리케이션 자산의 현재 표시 상태.', objects: '객체' },
    recentLog: { title: '최근 로그', live: '실시간' },
    aria: {
      assetHeatmap: '응용자산상태 열력그래프',
      certificateStatusList: '인증서 상태 목록',
      metrics: '핵심 지표',
      quickActions: '주요 기능 액세스',
      statusHeatmap: '인증서, Agent, 게이트웨이 및 애플리케이션 자산 상태',
      statusLegend: '상태범례'
    },
    assets: {
      groupCount: '{summary} · {total} 개',
      title: '애플리케이션 자산 상태',
      updatedAt: '{time}에 업데이트'
    },
    audit: {
      description: '실패, 거부, 위험 및 중요한 비즈니스 변화의 우선순위를 표시합니다.',
      title: '최근 감사 로그',
      activityTitle: '감사 활동'
    },
    certificateState: {
      critical: '만기가 다가오다',
      expired: '만료됨',
      expiring: '만기가 다가오다',
      unknown: '알 수 없음',
      valid: '정상',
      updateAvailable: '업데이트 가능'
    },
    days: {
      expired: '{days}일 만료됨',
      expiresToday: '오늘이 기한이다',
      notRecorded: '기록되지 않음',
      remaining: '{days} 일'
    },
    empty: {
      noAuditLogs: '아직 로그가 없습니다.',
      noCertificateStatus: '인증서 없음',
      noObjects: '잠시 파트너가 없다.',
      noTrend: '추세 데이터가 없습니다.',
      noQuickActions: '사용 가능한 빠른 입구가 없습니다.'
    },
    errors: {
      loadFailed: '전체 보기 데이터를 불러올 수 없습니다',
      missingOverviewData: '전체 보기 정보를 받을 수 없습니다.'
    },
    legend: {
      disabled: '비활성화',
      error: '예외',
      ok: '정상',
      unknown: '알 수 없음',
      warning: '주의'
    },
    loading: {
      description: '전체 보기 불러오는 중...',
      title: '로드 중'
    },
    metrics: {
      attention: '주의',
      sparklineLabel: '{metric} 추세',
      stable: '안정적',
      tracked: '추적 중',
      activeAgents: {
        title: 'Agent를 활성화합니다',
        description: '현재 온라인으로 예약할 수 있는 Agent.'
      },
      activeGateways: {
        title: '활성 게이트웨이의 개수입니다',
        description: '현재 온라인 격리 게이트웨이.'
      },
      applications: {
        title: '현재 응용 프로그램 수',
        description: '이미 납입 관리하는 응용수입자산.'
      },
      expiringCertificates: {
        title: '15일 이내에 인증서가 만료된다',
        description: '갱신이 필요한 인증서'
      },
      managedBindings: {
        title: '관리된 바인딩 갯수',
        description: '관리되는 인증서 바인딩입니다.'
      },
      validCertificates: {
        title: '활성 인증서 수',
        description: '상태가 활성이고 아직 만료되지 않은 인증서 버전입니다.'
      }
    },
    health: {
      title: '시스템 상태',
      description: '인증서, Agent, 게이트웨이 및 애플리케이션 자산 상태 요약.',
      healthy: '정상',
      attention: '주의',
      abnormal: '비정상',
      noData: '데이터 없음',
      score: '정상 객체 비율',
      progressAria: '정상 시스템 객체 비율',
      normalObjects: '정상 객체',
      attentionObjects: '검토할 객체'
    },
    quickWizard: {
      title: '빠른 접근'
    },
    typeStats: {
      title: '객체 유형 분포',
      description: '현재 표시되는 객체를 유형별로 나눕니다.'
    },
    quickActions: {
      agents: {
        title: 'Agent',
        description: '온라인 상태 및 작업 능력 보기.'
      },
      assets: {
        title: '응용자산',
        description: '도메인, 포트, 배포 대상을 관리합니다.'
      },
      audits: {
        title: '감사 로그',
        description: '작업자와 실행 결과를 추적하다.'
      },
      certificates: {
        title: '인증서 관리',
        description: '가져오기, 보기 및 인증서 변환.'
      },
      deploymentPlans: {
        title: '계획을 배포하다.',
        description: '인증서 갱신 스케줄을 만들고 실행합니다.'
      },
      gateways: {
        title: '게이트웨이',
        description: '관리 격리 구역 집행 입구.'
      }
    },
    statusBlock: {
      tooltip: { name: '이름', issuer: '발급자', startTime: '시작 시간', endTime: '종료 시간', daysRemaining: '남은 일수', connectionStatus: '연결 상태', version: '버전', managementAddress: '관리 주소', lastCommunicationTime: '최근 통신 시간', platform: '애플리케이션 플랫폼', protocolPort: '프로토콜 및 포트', certificateDaysRemaining: '인증서 남은 일수', region: '지역', latency: '지연 시간' },
      detail: {
        certificateRemaining: '{name}, {days}'
      },
      status: {
        active: '활성',
        critical: '만기가 다가오다',
        deleted: '삭제',
        disabled: '비활성화',
        expired: '만료됨',
        expiring: '만기가 다가오다',
        inactive: '비활성',
        offline: '오프라인',
        online: '온라인',
        retired: '이미 퇴역하다',
        revoked: '취소됨',
        stale: '기한이 지났으나 업데이트하지 않았습니다',
        unknown: '알 수 없음',
        unreachable: '도달할 수 없다',
        upgrading: '업그레이드 중',
        valid: '정상'
      }
    },
    statusGroups: {
      agents: {
        title: '장치'
      },
      applicationAssets: {
        title: '응용자산'
      },
      certificates: {
        title: '인증서'
      },
      gateways: {
        title: '게이트웨이'
      },
      summary: {
        allNormal: '모두 정상이다',
        needsAttention: '{count} 개에는 주의를 돌려야 한다'
      }
    },
    table: {
      bindings: '바인딩',
      certificate: '인증서',
      domain: '도메인',
      notAfterMissing: '만료 시간을 기록하지 않았습니다',
      remainingTime: '남은 시간',
      status: '상태'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: 'Gateway Agent 추가',
      close: '닫기',
      copied: '복사됨',
      copyEnableCommand: '복사 사용 명령',
      copyInstallCommand: '설치 명령 복사',
      detail: '상세 정보',
      enableExistingAgent: '현재 Agent는 Gateway를 사용한다',
      generateEnableCommand: '생성 사용 명령',
      generateInstallCommand: '생성설치 명령',
      generating: '생성 중...',
      probe: '프로브',
      probeRisk: '이 Gateway 구역으로부터 접근 가능 탐지를 시작할 것이다.'
    },
    columns: {
      actions: '작업',
      gateway: '게이트웨이',
      lastHeartbeat: '최근 하트비트',
      load: '부하',
      region: '영역',
      status: '상태'
    },
    detail: {
      abilities: {
        agentTask: {
          description: '배포, 점검 등의 임무는 지역 내의 Agent로 이관하여 수행하게 한다.',
          title: '작업 전달'
        },
        directControl: {
          description: '제어받은 작업을 구역내의 Agent로 전송하면 시스템은 직접 인트라넷 포트를 연결할 필요가 없다.',
          title: '전송을 원격으로 제어하다'
        },
        probe: {
          description: '이 지역에서 호스트, 웹 사이트 또는 Agent에 액세스할 수 있는지 확인합니다.',
          title: '연결성 검사'
        },
        relay: {
          description: '좁은 권한 부여 후 승인된 대상과 포트로 TCP 바이트만 양방향 중계합니다.',
          title: '직접 TCP 릴레이'
        }
      },
      eyebrow: '지역 게이트웨이',
      heroDescription: '{region} 구역내의 탐지와 전송을 책임진다',
      overview: {
        availableCapacity: '사용 가능용량',
        connectionStatus: '연결 상태',
        lastContact: '최근 연락',
        processing: '처리 중',
        serviceRegion: '서비스 구역',
        successRate: '성공율'
      },
      sections: {
        overview: '운영 개요',
        services: '사용 가능한 서비스'
      }
    },
    empty: {
      description: 'Gateway Agent를 추가하거나, 기존의 Agent에 Gateway 캐릭터를 활성화한다.',
      title: '게이트웨이가 없습니다'
    },
    errors: {
      generateEnableCommandFailed: 'Gateway 활성화 명령을 생성하지 못했습니다.',
      generateInstallCommandFailed: 'Gateway Agent 설치 명령을 생성하지 못했습니다.',
      missingEnableCommand: '시스템이 Gateway 활성화 명령을 반환하지 않았습니다.',
      missingInstallCommand: '시스템이 Gateway Agent 설치 명령을 반환하지 않았습니다.',
      relayPolicyRequired: 'Relay 대상과 포트를 하나 이상 입력하세요.'
    },
    fields: {
      config: '구성',
      defaultRegion: 'default',
      enableCommand: '명령 사용하기',
      expiresAt: '만료 시간',
      installCode: '설치 코드',
      installCommand: '설치 명령',
      platform: '플랫폼',
      region: '영역',
      relayPorts: 'Relay 포트 허용 목록',
      relayPortsPlaceholder: '예: 443, 8443',
      relayTargets: 'Relay 대상 허용 목록',
      relayTargetsPlaceholder: '줄바꿈 또는 쉼표로 구분, 예: app.internal.example, 10.20.0.0/16',
      service: '서비스',
      unboundAgent: 'Agent에 바인딩되지 않음'
    },
    links: {
      assets: '자산 보기',
      executions: '실행 기록 보기'
    },
    modals: {
      detail: {
        title: '게이트웨이 정보'
      },
      enable: {
        title: '현재 Agent는 Gateway를 사용한다'
      },
      install: {
        title: 'Gateway Agent 추가'
      }
    },
    page: {
      description: '관리 지역은 Gateway Agent로 라우팅한다.',
      title: '게이트웨이'
    },
    platforms: {
      linuxSystemd: {
        description: 'Linux 메인 화면에 Gateway Agent 서비스를 설치하면 된다'
      },
      windowsService: {
        description: 'Windows 메인 화면에 Gateway Agent 서비스를 설치하면 된다'
      }
    },
    resourceName: '게이트웨이',
    status: {
      disabled: '사용이 중지되다',
      offline: '오프라인',
      online: '정상 온라인',
      revoked: '철회',
      upgrading: '업그레이드 중'
    },
    values: {
      availableCapacity: '{count} 미션을 접수할 수 있다',
      defaultRegion: '기본 영역',
      regionGatewayName: '{region}게이트웨이',
      taskCount: '{count} 개 임무'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'Secret을 검색하는 서비스',
      secretResolve: '실행기는 Secret을 읽는다',
      secretCreate: 'Secret을 만듭니다',
      secretVersionCreate: 'Secret 버전을 만듭니다',
      secretRotate: '교대하다',
      certificateImport: '인증서 가져오기',
      certificateFormatUpdate: '인증서 아티팩트 갱신',
      certificateFormatDelete: '인증서 항목 삭제',
      deploymentCreate: '배포 계획 만들기',
      deploymentExecute: '배포 계획을 실행하다.',
      deploymentRollback: '스크롤백 요청',
      approvalCreate: '승인 생성',
      approvalApprove: '심사 비준하다.',
      approvalReject: '승인 거부',
      authLogin: '사용자 로그인',
      authLogout: '사용자 종료'
    },
    events: {
      authLoginSuccess: '로그인 성공',
      authLoginFailure: '로그인 실패',
      authLoginFailed: '로그인 실패',
      authLogout: '로그아웃',
      authExternalLoginSuccess: '외부 인인이 성공적으로 등록되었습니다',
      authExternalLoginFailed: '외부 인력으로 로그인하는 데 실패했습니다',
      secretCreated: 'Secret을 만듭니다',
      secretVersionCreated: 'Secret 버전을 만듭니다',
      secretUsed: 'Secret을 검색합니다',
      secretRotated: '교대하다',
      permissionDenied: '권한 거부',
      approvalCreated: '승인 생성',
      approvalApproved: '심사 비준을 통과하다.',
      approvalRejected: '심사비준기각하다',
      certificateImported: '인증서 변경',
      deploymentCreated: '배포 만들기',
      deploymentExecuted: '포치를 실행하다.',
      deploymentRollbackRequested: '배포 롤백 요청',
      pluginInstalled: '플러그인 설치',
      pluginPermissionDenied: '플러그인 권한 거부',
      workflowTemplateExecuted: '워크스트림 템플릿을 실행합니다'
    },
    types: {
      audit: '감사',
      auth: '인증',
      security: '보안',
      secret: 'Secret',
      certificate: '인증서',
      certificateVersion: '인증서',
      certificateVersionFormat: '인증서 아티팩트',
      deployment: '배포',
      deploymentPlan: '계획을 배포하다.',
      execution: '실행',
      approval: '승인',
      permission: '권한',
      plugin: '플러그인',
      workflowTemplate: '워크플로',
      gateway: '게이트웨이',
      agent: 'Agent',
      serviceAsset: '응용자산',
      binding: '바인딩'
    },
    actors: {
      user: '사용자',
      system: '시스템',
      agent: 'Agent',
      plugin: '플러그인',
      executor: '실행기'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Secret 버전',
      certificate: '인증서',
      certificateVersion: '인증서 버전',
      certificateVersionFormat: '인증서 아티팩트',
      deployment: '배포',
      deploymentPlan: '계획을 배포하다.',
      execution: '실행작업',
      executionRun: '실행작업',
      approval: '심사비준서',
      plugin: '플러그인',
      workflowTemplate: '워크스트림 템플릿',
      gateway: '게이트웨이',
      agent: 'Agent',
      serviceAsset: '응용자산',
      binding: '인증서 바인딩',
      auditLog: '감사 로그'
    },
    results: {
      success: '성공',
      failure: '실패',
      denied: '거부'
    },
    verbs: {
      success: '완료',
      failure: '실패',
      denied: '거부'
    },
    tokens: {
      auth: '인증',
      login: '로그인',
      logout: '로그아웃',
      external: '외부',
      secret: 'Secret',
      resolve: '읽기',
      service: '서비스',
      used: '사용',
      created: '생성',
      create: '생성',
      updated: '업데이트',
      update: '업데이트',
      deleted: '삭제',
      delete: '삭제',
      version: '버전',
      certificate: '인증서',
      imported: '가져오기',
      import: '가져오기',
      format: '아티팩트',
      deployment: '배포',
      executed: '실행',
      execute: '실행',
      rollback: '롤백',
      requested: '요청',
      approval: '승인',
      approved: '통과',
      rejected: '반려',
      permission: '권한',
      denied: '거부',
      gateway: '게이트웨이',
      credential: '자격 증명',
      issued: '발급',
      revoked: '폐기',
      task: '작업',
      evidence: '증거',
      recorded: '기록',
      result: '결과',
      plugin: '플러그인',
      workflow: '워크플로',
      template: '템플릿',
      synced: '동기화',
      tested: '테스트',
      source: '출처',
      identity: '정체성 원천',
      group: '그룹',
      mapping: '매핑'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb}"{title}"대상:{resource}.',
    fallbacks: {
      unknown: '알 수 없음'
    }
  },
  audit: {
    page: {
      title: '감사 로그',
      description: '사용자 작업, 실패/거부, 중요한 비즈니스 변경 사항에 따라 로그를 구성하고 읽을 수 있는 요약을 저장합니다.'
    },
    actions: {
      exportEvidence: '감사 자격 증명 내보내기',
      exporting: '내보내기 중…',
      refreshing: '새로 고침 중...'
    },
    errors: {
      exportFailed: '내보내기감사증거실패',
      loadFailed: '감사 로그를 불러오는 데 실패했습니다',
      withRequestId: '{message}({requestId})'
    },
    metrics: {
      ariaLabel: '감사개요',
      total: {
        title: '감사 총수',
        description: '현재 필터를 통해 추적할 수 있는 작업 기록'
      },
      failed: {
        title: '실패/거부',
        description: '우선 순위 검증이 필요한 실행 실패 및 접근 거부.'
      },
      userActions: {
        title: '사용자 작업',
        description: '사용자가 직접 시작하는 업무 변경 및 접근 작업.'
      }
    },
    list: {
      ariaLabel: '감사 로그 목록',
      title: '로그 목록',
      summary: '총 {total} 바, 기본값은 최신 시간 순으로 정렬합니다.',
      timeNotRecorded: '기록되지 않은 시간'
    },
    empty: {
      title: '아직 이벤트 기록이 없습니다.',
      description: '중요 작업은 해당 운영 기록과 작업 기록으로 거슬러 올라갈 수 있어야 한다.'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: '불러오는 데 실패했습니다',
      submitFailed: '전송 실패'
    },
    actions: {
      createResource: '추가{resource}',
      submitting: '보내는 중...'
    },
    modal: {
      createDescription: '다음 필드를 입력하신 후 {resource}를 만드세요'
    },
    placeholders: {
      selectField: '선택{field}'
    },
    table: {
      ariaLabel: '목록 관리',
      resourceList: '{resource}목록',
      total: '총 {count} 개'
    }
  },
  settings: {
    ...(licensingLocaleMessages['ko-KR'] ?? {}),
    securityLabel: '시스템 설정 입구',
    deploymentTasks: {
      eyebrow: '배포 작업',
      title: '배포 작업 매개변수',
      description: '테넌트 전체 Dry-run과 앱에서 별도로 승인을 지정하지 않은 경우의 인증서 배포 승인 여부를 제어합니다.',
      readonly: '이 계정은 읽기 전용 권한입니다.',
      fields: {
        dryRun: { title: 'Dry-run 활성화', description: '배포 전에 읽기 전용 사전 검사를 실행합니다. 결과는 참고용이며 실제 배포를 차단하지 않습니다.', aria: '인증서 배포 Dry-run 활성화' },
        approval: { title: '승인 흐름 활성화', description: '앱에서 별도로 승인을 지정하지 않은 경우 이 테넌트 설정으로 인증서 배포 승인 여부를 결정합니다.', aria: '인증서 배포 승인 흐름 활성화' }
      },
      actions: { save: '설정 저장', saving: '저장 중...' },
      messages: { saved: '배포 작업 매개변수를 저장했습니다.' },
      errors: { loadFailed: '배포 작업 매개변수를 불러오지 못했습니다.', saveFailed: '배포 작업 매개변수를 저장하지 못했습니다.' }
    },
    version: {
      title: '버전 정보',
      description: '현재 실행 중인 GCAC 버전을 확인합니다.',
      currentVersion: '현재 버전',
      product: '제품'
    },
    permissionPolicies: {
      resourceName: '권한 정책',
      actions: {
        create: '정책 만들기'
      },
      columns: {
        id: '전략 ID',
        subjectType: '주체 형식',
        subjectId: 'ID',
        effect: '효과',
        actions: '동작',
        resourceTypes: '자원 형식',
        scope: '범위'
      },
      fields: {
        subjectType: '주체 형식',
        subjectId: 'ID',
        effect: '효과',
        actions: '동작',
        resourceTypes: '자원 형식',
        tenantId: '테넌트 영역'
      },
      subjectTypes: {
        role: '역할',
        user: '사용자',
        plugin: '플러그인',
        executor: '실행기'
      },
      effects: {
        allow: '허용',
        deny: '거부'
      }
    },
    groupRoleMappings: {
      resourceName: '그룹 맵',
      actions: {
        create: '맵 만들기'
      },
      columns: {
        sourceId: 'ID',
        externalGroup: '외부 그룹',
        roleId: '지역 인물',
        enabled: '활성화',
        updatedAt: '업데이트 시간'
      },
      fields: {
        sourceId: 'ID',
        externalGroup: '외부 그룹',
        externalGroupPlaceholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com',
        roleId: '"ID"'
      }
    },
    users: {
      title: '계정 제목 목록',
      summary: {
        groups: '총 {count} 개',
        users: '총 {total} 메시지 중 이미 {selected} 메시지를 선택했습니다'
      },
      actions: {
        createUser: '사용자 생성',
        addGroup: '그룹 추가',
        bulkDelete: '일괄 삭제',
        edit: '편집',
        delete: '삭제',
        lookupLoading: '검색 중...',
        lookupUser: '사용자 검색',
        lookupGroup: '검색 그룹',
        creating: '생성 중...',
        saving: '저장 중...',
        saveChanges: '저장변경',
        adding: '추가하는 중...'
      },
      risks: {
        bulkDelete: '일괄 삭제는 선택한 사용자에 대한 로컬 자격 증명과 역할 관계를 제거합니다.',
        deleteUser: '사용자를 삭제하면 해당 계정의 로컬 자격 증명과 역할 연결을 삭제합니다.'
      },
      tabs: {
        users: '사용자',
        groups: '그룹'
      },
      empty: {
        users: '사용자 없음',
        groups: '현재 사용자 그룹이 없습니다'
      },
      columns: {
        username: '사용자 이름',
        displayName: '표시 이름',
        email: '이메일',
        source: '출처',
        identitySourceName: '신원 원본 이름',
        status: '상태',
        tenant: '테넌트',
        roles: '역할',
        lastSyncedAt: '최근 동기화',
        updatedAt: '업데이트 시간',
        actions: '작업',
        groupName: '그룹 이름',
        code: '코드',
        externalRef: '외부 인증'
      },
      dialog: {
        userCreateTitle: '사용자 생성',
        userEditTitle: '사용자 편집',
        userCreateDescription: '로컬 사용자를 만들거나, 아이디에서 사용자 이름으로 검색해서 바인딩된 사용자를 만듭니다.',
        userEditDescription: '사용자의 디스플레이 이름, 메일박스, 상태, 역할을 편집합니다.',
        groupCreateTitle: '그룹 추가',
        groupCreateDescription: '로컬 그룹을 만들거나 외부 그룹을 아이디 소스에서 그룹 이름으로 검색하여 추가합니다.'
      },
      aria: {
        principalType: '주체 형식',
        createMode: '만드는 방법',
        externalUserProfile: 'ID 소스사용자프로필',
        groupCreateMode: '그룹 만드는 방법',
        externalGroupProfile: '원본 사용자 그룹 데이터'
      },
      modes: {
        localUser: '로컬 사용자',
        externalUser: 'ID 소스사용자',
        localGroup: '로컬 그룹',
        externalGroup: '아이디 원본 그룹'
      },
      fields: {
        identitySource: '정체성 원천',
        directoryUsername: '디렉터리 사용자 이름',
        username: '사용자 이름',
        displayName: '표시 이름',
        email: '이메일',
        role: '역할',
        initialPassword: '초기 비밀번호',
        status: '상태',
        directoryGroupName: '디렉터리 그룹 이름',
        groupName: '그룹 이름',
        groupCode: '그룹코드',
        directoryDn: '디렉터리 DN'
      },
      placeholders: {
        selectIdentitySource: '아이디 원본을 선택하세요',
        directoryUsername: '예를 들면 jackson이다',
        displayName: '인증서 운영자',
        initialPassword: '초기 비밀번호를 입력하세요',
        directoryGroupName: '예를 들면 GCAC-Ops이다',
        groupName: '인증서 운영팀'
      },
      options: {
        unset: '아니요설정'
      },
      status: {
        active: '활성화',
        disabled: '비활성화'
      },
      labels: {
        identitySourceOption: '{name}({type})'
      },
      errors: {
        loadUsersFailed: '사용자 불러오는 데 실패했습니다',
        loadGroupsFailed: '사용자 그룹을 불러오는 데 실패했습니다',
        createUserFailed: '사용자 생성 실패',
        updateUserFailed: '사용자 업데이트 실패',
        externalUserEmpty: '인증서가 사용자 정보를 반환하지 않았습니다',
        lookupExternalUserFailed: '원본 사용자를 검색하는 데 실패했습니다',
        externalGroupEmpty: '인증서가 그룹 정보를 반환하지 않았습니다',
        lookupExternalGroupFailed: '원본 사용자 그룹을 검색하는 데 실패했습니다',
        createGroupFailed: '사용자 그룹을 만들 수 없습니다',
        deleteUsersFailed: '사용자 삭제 실패'
      }
    },
    roles: {
      page: {
        title: '권한 관리',
        description: '권한을 부여받은 객체 범위를 역할을 중심으로 관리하고 사용자나 그룹을 역할에 할당합니다.'
      },
      actions: {
        createRole: '역할 만들기',
        refreshObjects: '새로 고침 대상',
        loading: '로드 중...',
        creating: '생성 중...',
        saving: '저장 중...',
        detail: '상세 정보',
        authorize: '권한 부여',
        grantPermission: '권한 부여',
        assignMembers: '구성원을 할당하다',
        delete: '삭제',
        deleteRole: '역할 삭제',
        deleting: '삭제하는 중...',
        clearSelection: '선택 비우기'
      },
      columns: {
        roleId: '캐릭터 ID',
        code: '코드',
        name: '이름',
        builtin: '내장',
        policyCount: '정책 수',
        permissions: '권한점',
        actions: '작업',
        objectScope: '대상 범위',
        accessLevel: '권한 단계',
        businessLevel: '업무 권한 수준',
        effect: '효과',
        memberType: '멤버유형',
        member: '멤버'
      },
      table: {
        emptyRoles: '잠시 역할이 없다.',
        roleRecords: '캐릭터 레코드',
        emptyGrants: '현재 역할에 객체 권한이 없습니다',
        currentPermissions: '현재 역할 권한',
        emptyMembers: '현재 역할의 멤버가 없다',
        assignedMembers: '할당된 구성원'
      },
      categories: {
        certificate: '인증서',
        application: '애플리케이션',
        gateway: '게이트웨이',
        agent: 'Agent',
        serviceAsset: '응용자산',
        deploymentPlan: '업데이트계획',
        workflow: '워크플로',
        auditLog: '로그',
        systemSetting: '시스템 설정'
      },
      accessLevel: {
        read: '읽기 전용',
        edit: '편집',
        control: '전체 제어'
      },
      levels: {
        user: '사용자',
        manager: '관리자'
      },
      effect: {
        allow: '허용',
        deny: '거부'
      },
      principal: {
        user: '사용자',
        group: '그룹',
        externalGroup: '아이디 원본 그룹'
      },
      summary: {
        selectedMembers: '이미 {count} 멤버를 선택하였다',
        chooseMembers: '사용자나 그룹을 선택하세요',
        selectedScopes: '{count} 범위를 선택하였습니다',
        chooseObjectNode: '객체 트리 노드를 선택하세요',
        selectedScopeLabel: '선택한 영역',
        selectedMemberLabel: '선출된 구성원'
      },
      tree: {
        rootLabel: '모든 객체',
        rootDescription: '모든 인증 가능한 비즈니스 객체',
        typeDescription: '{category} 전체 기록',
        allBusinessObjects: '모든 업무 대상',
        selectedScopeAria: '인증 범위가 선택되었습니다',
        objectTreeAria: '인증 가능한 객체 트리',
        authorizableObjects: '인증 가능한 객체',
        loading: '객체 트리 불러오는 중...',
        kind: {
          all: '전체',
          category: '분류',
          record: '기록'
        }
      },
      format: {
        labelWithId: '{label}({id})',
        recordFallback: '{category} {value}',
        unnamedRecord: '이름 없는 기록'
      },
      detail: {
        title: '역할상세 정보',
        titleWithName: '캐릭터 {name}',
        description: '객체 범위, 객체, 권한 수준, 멤버 할당은이 곳에서 관리된다.'
      },
      create: {
        title: '역할 만들기',
        description: '역할의 책임을 입력하고 그 역할의 객체에 직접 권한을 부여할 수 있습니다.',
        nameLabel: '역할 이름',
        namePlaceholder: '인증서 운영자',
        descriptionLabel: '설명',
        descriptionPlaceholder: '일상적인 인증서 작업을 담당합니다',
        authorizedRole: '공인된 역할',
        newRole: '새 배역'
      },
      grant: {
        title: '역할 권한 부여',
        description: '객체 트리에서 범위를 선택하고 범위의 권한 수준을 직접 설정합니다.',
        roleLabel: '역할'
      },
      member: {
        title: '구성원을 할당하다',
        titleWithName: '할당멤버: {name}',
        description: '사용자 또는 그룹을 선택하세요. 시스템은이 역할에 존재하는 인증 객체의 범위에 구성원을 할당합니다.',
        targetRole: '목표 역할',
        authorizedScope: '권한 부여 범위',
        objectScopeCount: '{count} 대상 범위',
        selectedMembersAria: '선출된 구성원',
        assignableMembersAria: '할당가능성원',
        emptyAssignable: '없음할당 가능{type}'
      },
      errors: {
        loadObjectTreeFailed: '객체 트리를 불러오는 데 실패했습니다',
        loadDataFailed: '권한 관리 데이터를 불러오는 데 실패했습니다',
        invalidBusinessScope: '해당 비즈니스 권한 범위를 찾을 수 없습니다.',
        missingRoleId: '캐릭터 ID를 얻지 못했습니다',
        createRoleFailed: '역할 생성 실패',
        grantRoleFailed: '역할 권한을 부여하는데 실패했습니다',
        roleNoObjectScopes: '이 역할에는 권한이 부여된 객체 범위가 없습니다. 먼저 역할에 권한을 부여하세요.',
        assignMembersFailed: '구성원 할당 실패',
        deleteRoleFailed: '역할 지우기 실패',
        missingObjectSetId: '객체 범위가 ID를 얻지 못했습니다'
      },
      confirm: {
        deleteRole: '캐릭터\'{name}\'삭제 확인?이 역할은 사용자 할당 및 객체 인증과 함께 제거됩니다.'
      },
      auditLogs: {
        auth: {
          name: '인증로그인로그',
          description: '로그인, 로그아웃, 외부 신원 정보 등록'
        },
        security: {
          name: '안전관리 로그',
          description: '사용자, 역할, 권한, 신원 원본 변경'
        },
        certificate: {
          name: '인증서 로그',
          description: '인증서 가져오기, 버전, 제품 및 바인딩 작업'
        },
        asset: {
          name: '자산 로그',
          description: '자산, 호스트, 서비스 인스턴스 및 사이트 자산 운영을 적용합니다'
        },
        gateway: {
          name: '게이트웨이 로그',
          description: '게이트웨이 라우팅, 탐지 및 상태 변경'
        },
        agent: {
          name: 'Agent 로그',
          description: 'Agent 등록, 하트비트, 작업 및 업그레이드 동작'
        },
        deployment: {
          name: '예약 로그 업데이트 중',
          description: '배포 계획, 실행, 롤백 및 승인'
        },
        workflow: {
          name: '워크플로 로그',
          description: '워크플로 템플릿 및 실행 작업'
        },
        secret: {
          name: '키 로그',
          description: 'Secret 생성, 사용 및 교체'
        },
        system: {
          name: '시스템 로그',
          description: '시스템 설정 및 플랫폼 수준 이벤트'
        }
      }
    },
    identitySources: {
      actions: {
        create: '아이디 원본 만들기',
        edit: '편집',
        delete: '삭제',
        testConnection: '연결 테스트',
        testing: '테스트 중...',
        creating: '생성 중...',
        saving: '저장 중...',
        saveChanges: '저장변경',
        expandAdvanced: '고급 설정 확장하기',
        collapseAdvanced: '고급 설정을 취소합니다'
      },
      columns: {
        name: '이름',
        type: '디렉터리 형식',
        server: '서비스기',
        status: '상태',
        actions: '작업'
      },
      table: {
        title: '아이디 원본 목록',
        total: '총 {count} 개'
      },
      empty: '정체성의 원천이 없다',
      dialog: {
        createTitle: '아이디 원본 만들기',
        editTitle: '아이디 원본 편집',
        createDescription: '먼저 기초련결정보를 기입한다.필터와 디렉터리 형식은 고급 설정으로 되어 있습니다.',
        editDescription: '아이디 원본 설정 수정;서비스 아이디의 비밀번호를 업데이트할 경우, 비밀번호를 다시 적어주세요.'
      },
      fields: {
        name: '이름',
        domain: '도메인',
        protocol: '프로토콜',
        serverAddress: '서버 주소',
        baseDn: 'Base DN',
        bindDn: '서비스 계정은 DN이다',
        bindPassword: '서비스 계정 비밀번호',
        directoryType: '디렉터리 형식',
        defaultRole: '묵인 역할',
        enabled: '사용 상태',
        userDnTemplate: '사용자 DN/UPN 템플릿',
        userFilter: '사용자 필터',
        groupFilter: '그룹 필터',
        syncUserFilter: '사용자 필터 동기화',
        requireGroupMapping: '로그인 사용자가 그룹 맵을 실행해야 합니다'
      },
      placeholders: {
        name: '예를 들어:회사 AD',
        domain: '예: example.com',
        serverAddress: '예: ad.example.com:636',
        baseDn: '예: DC=example,DC=com',
        bindDn: '예: CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: '서비스 계정 비밀번호를 입력하세요',
        bindPasswordEdit: '비밀번호를 유지하려면 비워 두세요',
        autoByDirectoryType: '빈 공간은 디렉터리 형식에 따라 자동으로 유추됩니다',
        userFilter: "예: (uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "예: (member={'{'}{'{'}userDn{'}'}{'}'})"
      },
      labels: {
        finalUrl: '최종주소: {url}'
      },
      options: {
        unset: '아니요설정'
      },
      status: {
        enabled: '활성화',
        disabled: '사용이 중지되다',
        disabledShort: '비활성화'
      },
      types: {
        activeDirectory: 'Active Directory',
        ldap: '표준 LDAP'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: '소스가 삭제되면 디렉토리의 로그인, 동기화, 그룹 맵이 유효하지 않습니다.'
      },
      test: {
        dialogTitle: 'ID 소스 연결 테스트',
        dialogDescription: '{name} ({server})의 DNS, LDAP 인증 포트 및 BIND 상태를 확인합니다.',
        loading: 'DNS, LDAP 인증 포트 및 BIND 상태를 순서대로 확인하는 중...',
        checks: {
          dns: { title: 'DNS 확인' },
          port: { title: 'LDAP 인증 포트 확인' },
          bind: { title: 'LDAP BIND 확인' }
        },
        status: {
          passed: '성공',
          failed: '실패',
          skipped: '건너뜀'
        },
        messages: {
          summaryPassed: '모든 LDAP 연결 검사를 통과했습니다',
          summaryFailed: 'LDAP 연결 검사를 통과하지 못했습니다',
          dnsIp: '대상이 IP 주소이므로 DNS 조회가 필요하지 않습니다',
          dnsResolved: 'DNS 확인 성공: {addresses}',
          dnsFailed: 'DNS 확인에 실패했습니다',
          portReachable: '{protocol} 인증 포트 {port}에 연결할 수 있습니다',
          portFailed: 'LDAP 인증 포트에 연결할 수 없습니다',
          bindServicePassed: 'LDAP 서비스 계정 BIND 및 Base DN 조회에 성공했습니다',
          bindAnonymousPassed: '익명 LDAP BIND 및 Base DN 조회에 성공했습니다',
          bindFailed: 'LDAP BIND 또는 Base DN 조회에 실패했습니다',
          skippedInvalidUrl: 'LDAP 주소가 잘못되어 건너뛰었습니다',
          skippedDnsFailed: 'DNS 확인에 실패하여 건너뛰었습니다',
          skippedPortFailed: 'LDAP 인증 포트에 연결할 수 없어 건너뛰었습니다',
          unknownCheck: '검사를 통과하지 못했습니다 ({code})',
          checkNotReturned: '서버가 이 검사 결과를 반환하지 않았습니다.'
        },
        errors: {
          emptyResult: '서버가 연결 테스트 결과를 반환하지 않았습니다',
          requestFailed: '연결 테스트 요청에 실패했습니다'
        }
      },
      secret: {
        bindPasswordName: '{name} LDAP 서비스 계정 비밀번호'
      },
      messages: {
        createSuccess: '아이디 원본을 성공적으로 생성했습니다',
        updateSuccess: 'id 원본을 성공적으로 업데이트했습니다'
      },
      errors: {
        loadFailed: '신원 원본을 불러오는 데 실패했습니다',
        createBindPasswordSecretFailed: 'Secret 서비스 비밀번호를 생성할 수 없습니다',
        createFailed: '생성ID 소스실패',
        updateFailed: '신원 원본을 업데이트하는 데 실패했습니다',
        deleteFailed: '원본 지우기 실패'
      }
    }
  },
  bindings: {
    actions: {
      create: '새 프로필',
      toggleFilters: '필터',
      edit: '편집',
      delete: '삭제',
      deleting: '삭제하는 중...',
      applyTemplate: '내장된 템플릿을 적용합니다',
      saving: '저장 중...',
      confirmSave: '저장 확인'
    },
    columns: {
      configName: '파일 이름 설정',
      targetSummary: '대상 환경',
      displayFormat: '콘텐츠형식',
      extension: '확장명',
      encodingSummary: '코드',
      exportSummary: '내용/내보내기 옵션 포함',
      actions: '작업'
    },
    dialog: {
      createTitle: '새 인증서 형식 설정입니다',
      editTitle: '인증서 형식 설정을 편집합니다',
      description: '시스템 플랫폼과 대상 플랫폼을 선택한 후, 내장된 템플릿을 적용하고 내보내기 내용을 항목별로 조정한다.'
    },
    list: {
      title: '인증서 형식 설정 목록입니다',
      descriptionWithCount: '재사용 가능한 인증서 형식 템플릿입니다.현재 {count} 개'
    },
    empty: {
      text: '인증서 없음'
    },
    fields: {
      contentFormat: '콘텐츠형식',
      systemPlatform: '시스템플랫폼',
      runtimePlatform: '대상 플랫폼',
      configName: '파일 이름 설정',
      backendFormat: '기본 형식',
      outputExtension: '출력 확장자',
      expiresAt: '만료 시간 설정 (옵션)',
      certificateEncoding: '인증서 인코딩',
      certificateContentEncoding: '인증서 내용 인코딩',
      privateKeyEncoding: '개인 키 인코딩',
      includeLeafCertificate: '공개 키 인증서 포함',
      includeCertificateChain: '인증서 체인 포함',
      includePrivateKey: '개인 전용 키 포함',
      mainArtifactIncludesChain: '주요 생산물은 인증서 체인을 포함한다',
      generateChainFile: '추가로 인증서 체인 파일을 생성합니다',
      generatePrivateKeyFile: '개인 키 파일을 추가로 생성합니다',
      exportPassword: '내보내기 비밀번호'
    },
    formats: {
      pfx: 'PKCS#12 / PFX 용기',
      jks: 'JKS 용기',
      pemBundle: 'PEM 파일 Bundle',
      pemCert: 'PEM 인증서 파일',
      pemKey: '개인 키 파일',
      cer: '인증서 파일(.cer)',
      crt: '인증서 파일(.crt)',
      p7b: 'PKCS#7 / P7B 인증서 체인',
      custom: '사용자 정의'
    },
    sections: {
      templates: {
        title: '내장된 템플릿',
        description: '템플릿 기반 각 플랫폼의 일반적인 TLS 방식 사전 기입 내용 형식, 내용 포함 및 내보내기 규칙, 적용 후 계속 수정할 수 있습니다.'
      },
      basic: {
        title: '기초 정보',
        description: '프로필의 아이디와 실제 내용 형식, 마지막으로 확장자를 정의한다.'
      },
      encoding: {
        title: '인코딩 선택',
        description: '현재 콘텐트 형식만 지원하는 인코딩 옵션을 표시합니다.'
      },
      content: {
        title: '포함콘텐츠',
        description: '주 제품 파일에 포함할 내용을 정의합니다:공개 키, 인증서 체인, 개인 키.'
      },
      export: {
        title: '내보내기 옵션',
        description: '체인 파일, 개인 키 파일, 컨테이너 전용 비밀번호 옵션을 추가로 생성할지 여부를 정의한다.'
      }
    },
    filters: {
      keywordPlaceholder: '이름/대상 환경/Alias/콘텐트 형식을 설정합니다'
    },
    placeholders: {
      configName: '예를 들어:장치는 단일 파일 PEM와 호환된다',
      exportPassword: 'PFX/JKS 내보내기 비밀번호를 입력하세요'
    },
    validation: {
      selectPlatformsFirst: '먼저 시스템 플랫폼과 대상 플랫폼을 선택하세요.',
      configNameRequired: '프로필 이름을 입력해야 합니다',
      passwordRequired: 'PFX/JKS 설정시 반드시 비밀번호를 입력해야 한다'
    },
    errors: {
      loadFailed: '인증서 형식 설정을 로드하지 못했습니다',
      saveFailed: '저장인증서형식구성실패',
      deleteFailed: '인증서 형식 설정을 삭제하는데 실패했습니다',
      createExportSecretFailed: '생성내보내기비밀번호 Secret 실패',
      withCode: '{message}({code})'
    },
    fallbacks: {
      unnamedConfig: '이름 없음구성-{index}',
      unspecified: '지정되지 않음',
      aliasUnset: 'Alias를 설정하지 않았습니다'
    },
    labels: {
      aliasWithValue: 'Alias: {alias}',
      requestId: 'ID:{requestId} 요청'
    },
    encoding: {
      pkcs12Container: 'PKCS#12 용기',
      jksContainer: 'JKS 용기',
      privateKeyWithEncoding: '개인 전용 키 {encoding}',
      pkcs7Chain: 'PKCS#7 인증서 체인',
      certificateWithEncoding: '인증서 {encoding}',
      default: '기본'
    },
    export: {
      leafCertificate: '공개 키',
      certificateChain: '인증서 체인',
      privateKey: '개인 전용 키',
      extraChainFile: '추가 체인 파일',
      extraPrivateKeyFile: '추가 개인 키 파일'
    },
    secret: {
      defaultConfigName: '인증서 형식 설정',
      exportPasswordName: '{name} 내보내기 비밀번호'
    },
    select: {
      placeholder: '선택하세요'
    },
    separators: {
      export: '·'
    },
    hints: {
      savedPassword: '내보내기 비밀번호가 설정되었습니다. 변경하려면 덮어쓸 새 비밀번호를 입력하세요.'
    },
    templates: {
      windowsIis: {
        configName: 'Windows-IIS-PKCS12-표준템플릿',
        description: 'IIS는 PKCS#12/PFX 컨테이너를 사용하는 것이 가장 일반적이며, 메인 제품 내에 직접 서버 인증서, 인증서 체인과 개인 전용 키를 휴대한다.'
      },
      windowsNginx: {
        configName: 'Windows-NGINX-PEM-표준템플릿',
        description: 'NGINX 주류는 PEM 단일 파일을 사용하여 서버 인증서와 체인을 탑재하고, 독립적인 개인 키 파일과 결합한다.'
      },
      windowsApache: {
        configName: 'Windows-Apache-PEM-표준템플릿',
        description: 'Apache는 일반적으로 PEM 인증서 파일과 독립적인 개인 전용 키로 전달되며, 체인 파일을 추가로 내보내면 다른 운영 관행과 호환할 수 있다.'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12-표준템플릿',
        description: 'Tomcat는 JKS/PKCS#12 keystore를 위주로 하며, 여기서는 기본적으로 더 통용되는 PKCS#12를 사용한다.'
      },
      windowsOther: {
        configName: 'Windows-장치 호환 단일파일PEM템플릿',
        description: '일부 장치 호환성 요구 사항:공개 키 인증서, 인증서 체인, 개인 키를 모두 포함하는 단일 파일, 확장자를.crt/.cer로 변경할 수 있다.'
      },
      linuxIis: {
        configName: 'Linux-IIS-호환 템플릿',
        description: '만약 최종 목표가 여전히 IIS 라면, 가장 합리적인 인도물은 여전히 PKCS#12/PFX 용기일 것이다.'
      },
      linuxNginx: {
        configName: 'Linux-NGINX-PEM-표준템플릿',
        description: 'NGINX 공식 설정은 PEM 단일 파일 인증서 체인과 개인 전용 키를 중심으로 확장된다.'
      },
      linuxApache: {
        configName: 'Linux-Apache-PEM-표준템플릿',
        description: 'Apache의 일반적인 방법은 PEM 인증서 파일에 개인 전용 키를 장착하여, 분할 배포에 편리하도록 체인 파일을 추가로 내보내는 것이다.'
      },
      linuxTomcat: {
        configName: 'Linux-Tomcat-PKCS12-표준템플릿',
        description: 'Tomcat 기본값은 keystore 컨테이너를 제공하는 것을 제안하며, 여기에서 더 일반적인 PKCS#12를 사용한다.'
      },
      linuxOther: {
        configName: 'Linux-장치 호환 단일파일PEM템플릿',
        description: 'Linux 범용 장비가 만약 단일 파일 PEM를 접수하면 먼저 bundle 형식을 사용하여 대상 장비에 따라 확장명과 내용을 조정할수 있다.'
      }
    }
  },
  deploymentInputs: {
    title: '배포 입력',
    description: '플러그인 또는 워크플로가 선언한 통합 입력 계약에 따라 배포 값을 구성합니다.',
    saveAssetFirst: '백엔드에서 투영한 배포 입력을 편집하기 전에 애플리케이션 자산과 실행 소스를 저장하세요.',
    contractVersion: '계약 {version}',
    groups: { required: '필수 구성', advanced: '고급 구성', readonly: '읽기 전용 및 런타임 값' },
    actions: { expand: '고급 구성 펼치기', collapse: '고급 구성 접기' },
    placeholders: { select: '선택하세요', credential: '자격 증명 선택', artifact: '아티팩트 형식 선택', output: '출력 선택' },
    artifacts: { format: '아티팩트 형식' },
    allowInsecureTls: {
      label: 'TLS 인증서 검증 건너뛰기 허용',
      description: '장비가 자체 서명 또는 신뢰할 수 없는 인증서를 사용하는 경우 이번 배포에서 TLS 인증서 검증을 건너뛰도록 명시적으로 허용합니다.',
      help: '이는 배포 의도만 기록하며 실행 권한을 부여하지 않습니다. 승인과 호스트가 발급한 실행 권한이 계속 필요합니다.'
    },
    runtimeValue: '런타임에 {source}에서 제공',
    source: '출처: {source}',
    sourceKinds: { asset: '자산', binding: '바인딩', default: '기본값', derived: '파생값', system: '시스템 값', step_output: '단계 출력', unknown: '알 수 없는 출처' },
    issues: {
      title: '입력 문제',
      unknown: '배포 입력 검증에 실패했습니다 ({code})',
      DEPLOYMENT_INPUT_REQUIRED: '필수 배포 입력이 없습니다',
      DEPLOYMENT_CONNECTION_REQUIRED: '필수 연결 설정이 없습니다',
      DEPLOYMENT_CREDENTIAL_REQUIRED: '필수 자격 증명이 없습니다',
      DEPLOYMENT_ARTIFACT_REQUIRED: '필수 배포 아티팩트가 없습니다',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: '이 배포 입력은 재정의할 수 없습니다',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: '배포 입력 슬롯이 선언되지 않았습니다',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: '배포 입력 필드가 선언되지 않았습니다',
      DEPLOYMENT_INPUT_TYPE_INVALID: '배포 입력 형식이 올바르지 않습니다',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: '고정 배포 입력은 재정의할 수 없습니다',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: '자격 증명 스냅샷이 없습니다',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: '자격 증명 스냅샷이 현재 선택과 일치하지 않습니다',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: '지원되지 않는 자격 증명 유형입니다',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: '아티팩트 스냅샷이 없습니다',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: '필수 아티팩트 출력이 없습니다'
    }
  },
  assets: {
    presentation: {
      cards: '카드 보기',
      list: '표 보기',
    },
    selection: {
      selectedCount: '{count} / {total}개 자산 선택됨',
      actions: {
        bulkDelete: '일괄 삭제',
        bulkUpdateCertificate: '인증서 일괄 업데이트'
      },
      bulkDeleteRisk: '선택한 응용 자산과 수동 대상 연결을 삭제합니다. 검색된 프레임워크, 사이트 및 관리 대상은 유지됩니다.',
      bulkDeleteSuccess: '응용 자산 {count}개를 삭제했습니다.',
      bulkDeletePartialSuccess: '{succeeded}개를 삭제했으며 {failed}개는 실패했습니다.',
      bulkUpdateDescription: '동일한 인증서 도메인 “{domain}”에 연결된 응용 자산 {count}개에 적용할 인증서 버전을 선택합니다.',
      bulkUpdateFailed: '인증서 일괄 업데이트에 실패했습니다. {count}개 모두 제출되지 않았습니다.',
      bulkUpdateSuccess: '응용 자산 {count}개의 인증서 업데이트를 제출했습니다.',
      bulkUpdatePartialSuccess: '{succeeded}개에 제출했으며 {failed}개는 실패했습니다.'
    },
    aria: {
      selectCard: '자산 {name} 선택',
      detailCard: '자산 {name} 상세 보기',
      editCard: '자산 {name} 편집',
      deleteCard: '자산 {name} 삭제'
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
    title: '응용자산',
    description: '도메인 네임 또는 IP를 주요 객체로 응용 프로그램의 포털을 관리하여 주소, 포트, 프로토콜, 웹 사이트에 초점을 맞추고 위치추적 작업을 수행합니다.',
    resourceName: '응용자산',
    linkage: { title: '플러그인 및 Agent 연동', description: '버전과 로컬 실행 정책을 확인합니다.', status: '상태', agent: 'Agent 버전', plugin: '플러그인 버전', policy: '정책 일치', repair: '복구' },
    executionModes: {
      label: '실행 모드',
      plugin: { title: '플러그인 실행', description: '관리 대상에 활성화된 인증서 배포 기능을 사용합니다.' },
      workflowOverride: { title: '워크플로 재정의', description: '플러그인을 우회하고 사용자 소유 워크플로를 실행합니다.', notice: '이 모드는 자산의 플러그인 할당을 비활성화하고 워크플로 실행 바인딩만 유지합니다.' }
    },
    actions: {
      add: '자산을 추가하다',
      edit: '편집',
      detail: '상세 정보',
      addVariable: '변수 추가',
      delete: '삭제',
      deleteRisk: '삭제하면 이 응용 자산과 수동 대상 연결이 목록에서 제거됩니다. 검색된 프레임워크, 사이트, Virtual Server 및 ManagedTarget은 유지됩니다.',
      rollbackFromLatestSnapshot: '최신 스냅샷을 취소합니다',
      rollingBack: '뒤로...',
      deployCertificate: '인증서 배포',
      latestCertificate: '최신 인증서',
      updateCertificate: '인증서 업데이트',
      saving: '저장 중...',
      creating: '생성 중...',
      saveChanges: '저장변경',
      confirmCreate: '생성 확인'
    },
    columns: {
      domain: '도메인에 접근하다',
      port: '포트',
      protocol: '프로토콜',
      device: '소속 장치',
      platform: '플랫폼',
      framework: '프레임워크',
      site: '사이트',
      status: '상태',
      actions: '작업'
    },
    fields: {
      assetId: '응용 자산 ID',
      domain: '도메인에 접근하다',
      addressType: '주소 형식',
      port: '포트',
      protocol: '프로토콜',
      device: '소속 장치',
      verifyUrl: 'URL 인증',
      platform: '플랫폼',
      frameworkType: '프레임 형식',
      deploymentStrategyCompatibility: '배포 전략 호환 모드',
      selectWorkflow: '워크플로 선택',
      serviceInstanceId: '서비스 인스턴스 ID',
      siteId: '사이트 ID',
      managedTargetId: '관리 대상대상 ID',
      bindingKey: '키 바인딩',
      hostId: 'ID 호스팅',
      environment: '환경',
      discoverySource: '근원을 발견하다',
      lastDiscoveredAt: '최종 발견 시간',
      tags: '태그',
      managedTarget: '관리대상',
      siteName: '사이트 이름',
      bindingInformation: '정보 바인딩',
      hostHeader: 'Host Header',
      sniName: 'SNI 이름',
      currentCertificate: '현재 인증서',
      remainingValidity: '남은 유효기간',
      targetCertificate: '대상 인증서',
      expectedFingerprint: '지문 채취 기대',
      certificateStore: '인증서 저장소',
      snapshotType: '스냅샷유형',
      time: '시간',
      executionRun: '실행 기록',
      displayName: '이름 보이기',
      siteInstance: '사이트 인스턴스',
      certificateFormat: '인증서 아티팩트 설정',
      workflow: '워크플로',
      workflowVersionSelection: '워크플로 버전 정책',
      publishedVersion: '배포된 버전',
      runner: '실행 위치',
      artifactFormat: '제품 형식 설정',
      updatePlugin: '인증서 업데이트 플러그인',
      approvalRequired: '인증서 배포 승인 필요'
    },
    capability: { source: '기능 출처', plugin: '플러그인 버전', runtime: '런타임', executionLocation: '실행 위치', pendingAssignment: '저장하면 애플리케이션 자산 수준 배포 기능 할당이 생성됩니다.' },
    links: {
      certificateBindings: '인증서 바인딩 보기',
      executions: '실행 기록 보기'
    },
    empty: {
      title: '현재 응용 자산이 없습니다',
      description: '자동으로 검색될 때까지 기다리거나 수동으로 응용 프로그램 항목을 추가하세요.',
      noBindingInformation: '바인딩 정보가 제공되지 않았습니다',
      notSet: '설정되지 않음',
      notSelected: '선택되지 않음',
      noVariablePreset: '현재 변수를 추가할 수 없습니다',
      basicEntryIncomplete: '기본 접근이 완료되지 않았습니다'
    },
    detail: {
      title: '응용 정보',
      description: '자산 정보, 바인딩 관계, 배포 포털 및 스냅샷 기록 보기',
      tabsAriaLabel: '응용 정보 탭입니다',
      tabs: {
        overview: '기초 정보',
        snapshots: '스냅샷'
      },
      loadingTargetBinding: '대상 바인딩 정보 불러오는 중...',
      loadingSnapshots: '스냅샷 불러오는 중...',
      emptyCertificateBindings: '인증서 없음',
      emptySnapshots: '잠시 스냅샷 없음.',
      rollbackSubmitted: '롤백 요청을 제출했습니다. "실행 기록"에서 롤백 실행을 확인하세요.',
      sections: {
        overview: {
          title: '기초 정보',
          description: '애플리케이션 자산은 주 객체이며 호스트 컴퓨터와 사이트는 위치 정보를 실행하는 것으로만 나타난다.'
        },
        targetBinding: {
          title: '대상 바인딩',
          description: '도메인 이름 추정에 의존하지 않고 바인딩은 웹사이트와 대상을 명시적으로 설정해야 합니다.'
        },
        certificateBindings: {
          title: '인증서 바인딩 관계',
          description: '도메인 이름만 보는 것이 아니라 binding에 인증서 관계를 명확히 합니다.'
        },
        snapshots: {
          title: '스냅샷',
          description: '배포 전후와 후퇴 후의 현장 상태는 반드시 직접 볼 수 있어야 하며, 임무기록만 남겨둬서는 안 된다.'
        }
      }
    },
    deployment: {
      noCertificateAsset: '배포 가능한 인증서 자산이 없습니다',
      targetLocked: '업데이트 대상 고정',
      title: '인증서 배포', description: '이 애플리케이션 자산에 적용할 인증서 버전을 선택합니다. 시스템은 배포 스냅샷 생성, 사전 점검, 승인 제출 및 승인 후 실행을 수행합니다.', dialogTitle: '인증서 배포', dialogDescription: '현재 애플리케이션 자산에만 적용됩니다. 배포 계획은 백엔드의 스냅샷, 승인 및 실행 경계로 유지됩니다.', latestVersionPointer: '현재 인증서의 최신 버전 자동 적용', deployThisVersion: '이 인증서 버전 배포', loadingRecords: '배포 기록을 불러오는 중...', emptyRecords: '이 애플리케이션 자산에는 배포 기록이 없습니다.', preflightAvailable: '사전 점검 {count}개 반환됨', preflightUnavailable: '사전 점검이 아직 실행되지 않았습니다', rollbackUnavailable: '롤백이 요청되지 않았습니다', fields: { status: '배포 상태', approval: '승인 상태', latestRun: '최근 실행', preflight: '사전 점검', rollback: '롤백', updatedAt: '업데이트 시간' }, feedback: { preflightRunning: '사전 점검 실행이 완료되기를 기다리는 중입니다.', pendingApproval: '사전 점검이 완료되었으며 배포는 승인을 기다리고 있습니다.', executionStarted: '사전 점검과 승인이 완료되어 배포 실행이 시작되었습니다.' }, errors: { missingApplicationAssetId: '인증서 배포를 만들려면 애플리케이션 자산 ID가 필요합니다.', loadOptionsFailed: '배포 가능한 인증서 버전을 불러오지 못했습니다.', createPlanMissingId: '배포 스냅샷 생성 후 계획 ID가 반환되지 않았습니다.', deployFailed: '인증서 배포에 실패했습니다.', preflightFailed: '인증서 배포 사전 점검을 통과하지 못했습니다.', preflightTimeout: '인증서 배포 사전 점검 시간이 초과되었습니다.', loadRecordsFailed: '애플리케이션 자산 배포 기록을 불러오지 못했습니다.' }
    },
    compatibilityModes: {
      unified: '통합 플러그인 바인딩',
      legacy: '레거시 호환',
      legacyAdapted: '통합 바인딩과 레거시 설정 이중 읽기'
    },
    managementModes: {
      agent: 'Agent 모드',
      agentDescription: 'Agent 바인딩, 사이트 인스턴스 및 관리되는 대상',
      workflow: '워크플로 모드',
      workflowDescription: '워크플로 버전과 실행 변수를 선택하세요'
    },
    workflowVersionSelection: {
      pinned: '지정 버전 고정',
      latestPublished: '항상 최신 배포 버전 사용'
    },
    loading: {
      agents: 'Agent 로드 중...',
      sites: '로드사이트 중...',
      managedTargets: '대상 불러오는 중...',
      certificateFormats: '형식 설정 불러오는 중...',
      workflows: '워크플로 불러오는 중...',
      versions: '버전 불러오는 중...',
      gateways: 'Gateway 로드 중...',
      credentials: '인증서 불러오는 중...'
    },
    select: {
      agent: 'Agent를 선택해 주세요',
      siteInstance: '사이트 인스턴스를 선택하세요',
      managedTarget: '관리할 대상을 선택하세요',
      certificateFormat: '인증서 아티팩트 설정을 선택하세요',
      workflow: '워크플로을 선택하세요',
      publishedVersion: '배포된 버전을 선택하세요',
      gateway: 'Gateway를 선택해 주세요',
      variablePreset: '미리 설정한 변수를 선택하세요',
      credential: '인증서를 선택하세요',
      generic: '선택하세요',
      artifactFormat: '형식 설정을 선택하세요',
      output: '출력 항목을 선택하세요',
      optionalOutput: '선택하지 않기',
      updatePluginOptional: '선택 사항이며 현재 유효한 플러그인을 계속 사용합니다'
    },
    validation: {
      variableNameRequired: '변수의 이름은 비어 있을 수 없습니다',
      variableNameInvalid: '변수 {name} 가 올바르지 않습니다',
      variableDuplicated: '변수 {name} 반복',
      variableRequired: '변수 {name} 필수',
      variableMustBeNumber: '변수 {name}는 숫자여야 합니다',
      variableMustBeJsonObject: '변수 {name}는 반드시 JSON 대상이어야 한다',
      variableInvalidJson: '변량 {name}는 합법적인 JSON 가 아니다',
      variableCredentialInvalid: '{name} 변수는 유효한 증명을 선택해야 한다',
      certificateFormatRequired: '인증서 변수 {name} 인증서 형식 설정을 선택해야 합니다',
      certificateOutputRequired: '인증서 변수 {name}.{slot}는 출력 항목을 선택해야 합니다',
      certificateOutputMissing: '인증서 변수 {name}.{slot}에서 선택한 출력 항목이 존재하지 않습니다'
    },
    workflowVariableTypes: {
      string: '문자열',
      number: '숫자',
      boolean: '불리언',
      enum: '열거형',
      object: '대상',
      file: '파일',
      credential: '자격 증명',
      certificate: '인증서'
    },
    wizard: {
      ariaLabel: '자산 생성 단계를 적용합니다',
      steps: {
        basicEntry: '기본엔트리',
        deploymentMode: '배포 모드',
        confirmSave: '저장 확인'
      },
      stepState: {
        active: '진행 중',
        done: '완료',
        pending: '시작 대기',
        incomplete: '완성을 기다리다',
        readyNext: '다음 단계로 가기',
        pendingSubmit: '제출을 기다리다'
      },
      panels: {
        basicEntryTitle: '기본엔트리',
        basicEntryDescription: '도메인, 포트, 프로토콜, 플랫폼을 입력하여 응용 프로그램의 신원을 확인합니다.',
        agentTitle: 'Agent 대상 바인딩',
        agentDescription: 'Agent, 사이트 인스턴스, 관리 대상, 인증서 아티팩트 설정을 선택합니다.',
        workflowTitle: '워크플로 실행 설정',
        workflowDescription: '워크플로 버전, 실행 위치, 런타임에 주입될 인증서 변수를 선택하세요.',
        confirmTitle: '저장 확인',
        confirmDescription: '애플리케이션 포털, 배포 모드, 실행 매개변수를 검사하고 애플리케이션 자산에 기록합니다.'
      }
    },
    form: {
      createTitle: '수동으로 애플리케이션 자산을 추가합니다',
      editTitle: '애플리케이션 자산 편집',
      createDescription: '애플리케이션 항목을 만들고 후속 배포에 필요한 대상 정보를 바인딩합니다.',
      editDescription: '적용 항목 및 배포 대상 바인딩을 수정합니다.',
      createRequestCompleted: '생성 요청이 완료되었습니다.',
      editRequestCompleted: '저장 요청이 완료되었습니다.',
      agentCertificateFormatHint: 'Agent 모드에서 이 인증서 아티팩트 구성을 사용해 배포 자료를 생성합니다.',
      approvalRequiredHint: '선택하면 이 애플리케이션의 배포는 항상 승인이 필요하며, 선택하지 않으면 테넌트 전체 배포 설정을 사용합니다.',
      placeholders: {
        displayName: '예를 들어, 생산 사이트 액세스',
        verifyUrl: '예: https://example.com/health',
        siteName: '예: 프로덕션 사이트',
        bindingInformation: '예: *:443:example.com',
        hostHeader: '예: example.com',
        sniName: '예: example.com'
      }
    },
    review: {
      accessEntry: '액세스 포트',
      deploymentMode: '배포 모드',
      agentSiteTarget: 'Agent/사이트/목표',
      workflowVersion: '워크플로버전',
      gatewayRunner: 'Gateway: {gateway}',
      variableCount: '{count} 개 변수',
      onlyBasicEntry: '기본 접근만',
      autoGeneratedByEntry: '적용 항목을 기준으로 생성합니다'
    },
    workflowTarget: {
      title: '워크플로 대상 정보',
      description: '워크플로 자산 표시, 배포 후 프로브, DSL 대상 변수 동기화에 사용됩니다.',
      dslSyncHint: 'DSL 대상 변수에 동기화됨',
      advancedTitle: '고급 설정',
      advancedDescription: '기본 수신 규칙, 요청 도메인 또는 TLS 인증서 이름을 재정의할 때만 변경합니다.',
      expandAdvanced: '고급 설정 펼치기',
      collapseAdvanced: '고급 설정 접기',
      bindingInformationLabel: '서비스 수신 규칙',
      bindingInformationHelp: '서비스가 수신하는 주소, 포트 및 도메인 조합입니다.',
      hostHeaderLabel: '접속 요청 도메인',
      hostHeaderHelp: '대상 서비스가 특정 HTTP Host 헤더를 요구할 때만 변경합니다.',
      sniNameLabel: 'TLS 인증서 도메인',
      sniNameHelp: 'TLS 핸드셰이크 이름이 접속 도메인과 다를 때만 변경합니다.'
    },
    workflowVariables: {
      title: '워크플로 변수',
      configuredCount: '{configured}/{total} 가 설정되었습니다',
      name: '변수 이름',
      type: '유형',
      value: '값',
      manual: '수동',
      empty: '워크플로가 없습니다',
      noPublishedVersion: '배포된 워크플로 버전에 대한 설정 변수를 선택하세요.',
      certificateAutoInjected: '인증서 버전은 배포 계획에 의해 선택되며 런타임에 자동으로 주입됩니다.',
      certificateDescription: '인증서 버전은 배포 계획에서 선택하며, 애플리케이션 자산의 아래 바인딩 형식 구성과 출력 개수는 실행 시 {name}.outputs.*.content에 주입됩니다.',
      presets: {
        deviceHost: '대상 호스트나 장치 주소입니다',
        sshUsername: 'SSH 사용자 이름',
        credential: '업무 흐름 자격 증명',
        certificate: '인증서 아티팩트',
        targetPlatform: '대상 플랫폼',
        apacheServiceName: 'Apache systemd 서비스명',
        apacheSiteConfigPath: 'Apache 사이트 설정 경로',
        certificateFilePath: '인증서 대상 경로',
        certificateKeyFilePath: '개인 키 대상의 경로입니다',
        backupRoot: '인증서 백업 루트 디렉터리입니다',
        expectedResponseContains: '인증 응답에 텍스트가 포함되어 있습니다',
        virtualHostServerName: '가상 호스트 ServerName'
      }
    },
    certificateBindings: {
      title: '인증서 변수 바인딩',
      description: '워크스트림의 인증서 변수의 인증서 아티팩트 설정 및 출력 항목을 선택하세요.',
      variableCount: '{count} 인증서 변수',
      defaultVariableDescription: '인증서 아티팩트 변수',
      noArtifactOutputs: '현재 형식 설정은 출력 항목을 선택할 수 없습니다.'
    },
    certificateOutputs: {
      publicCertificateWithChain: '공개 키 인증서 + 인증서 체인',
      publicCertificate: '공개 키 인증서',
      certificateChain: '인증서 체인',
      privateKey: '개인 전용 키',
      pemBundle: 'PEM 통합 제품',
      container: '{format} 박스',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (프로필이 저장되었음, 현재 목록은 반환되지 않음)',
      withPrivateKey: '개인 전용 키 포함',
      withoutPrivateKey: '없음개인 키'
    },
    snapshotTypes: {
      preDeploy: '배포 전',
      postDeploy: '배포 후',
      postRollback: '뒤로 물러서다',
      errorState: '오류상태',
      rollbackPoint: '후퇴점'
    },
    errors: {
      loadWorkflowListFailed: '워크플로 목록을 불러오는 데 실패했습니다',
      loadWorkflowVersionsFailed: '워크플로 버전을 불러오는 데 실패했습니다',
      loadGatewayListFailed: '게이트웨이 목록을 불러오는 데 실패했습니다',
      loadCertificateFormatsFailed: '인증서 형식 설정을 불러오는 데 실패했습니다',
      loadAssetDetailFailed: '애플리케이션 자산 정보를 불러오는 데 실패했습니다',
      rollbackFailed: '후퇴를 시작하는 데 실패하다',
      loadTargetsFailed: '웹 사이트와 관리하는 대상을 불러오는 데 실패했습니다',
      createAssetFailed: '애플리케이션 자산을 만들 수 없습니다',
      pluginFormLoadFailed: '플러그인 설정 양식을 불러올 수 없습니다',
      pluginBindingCreateFailed: '플러그인 바인딩을 저장할 수 없습니다',
      loadWorkflowCredentialsFailed: '워크플로 자격 증명을 불러오는 데 실패했습니다',
      loadCredentialProfilesFailed: '자격 증명 프로필을 불러오지 못했습니다',
      noAvailableSiteInstance: '사용 가능한 사이트 인스턴스가 없습니다. 장치 검색이 프레임워크와 사이트를 보고했는지 확인하세요.',
      managedTargetRediscoveryRequired: '이 사이트에 관리 대상이 없습니다. 장치 검색을 다시 실행하세요.',
      noCompatibleManagedPlugin: '현재 관리 대상과 호환되는 활성 플러그인이 없습니다.',
      capabilityAssignmentMissing: '현재 대상에 유효한 배포 기능 할당이 없습니다.'
    },
    platforms: {
      appliance: '장치',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: '플랫폼',
      gateway: '게이트웨이'
    },
    status: {
      archived: '압축 파일',
      unknownStatus: '알 수 없는 상태'
    },
    common: {
      required: '필수',
      optional: '선택 사항'
    }
  },
  certificates: {
    errors: {
      requestFailed: '요청 실패'
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
        user: 'Keep only the common flow: import a certificate, attach applications, and set automatic updates.',
        professional: 'Show certificate versions, chain state, and full technical details.'
      }
    },
    userView: {
      hero: {
        eyebrow: 'Common flow',
        title: 'Handle certificate updates by business flow',
        description: 'Import or replace the certificate first, then attach applications, and finally configure an automatic update plan. Most daily work does not need low-level technical details.',
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
          description: 'Bring the new certificate material into the system. Application attachment and update plans continue from this certificate.',
          helperCompleted: '{count} certificate domains are already managed. You can keep replacing or adding certificate versions.',
          helperEmpty: 'Import the current certificate first. Application attachment and automatic plans depend on this step.',
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
        attentionDescription: 'Resolve expired or soon-to-expire certificates first, then finish application attachment and automatic plans.',
        assetAction: 'Open professional details',
        emptyTitle: 'No urgent certificate right now',
        emptyDescription: 'All imported certificates are currently still within their validity period.'
      },
      simple: {
        title: '인증서 및 애플리케이션 관리',
        subtitle: '인증서를 관리하고 인증서를 사용하는 애플리케이션을 확인합니다',
        sections: {
          certificates: {
            title: '인증서 관리',
            help: '만료일과 상태를 포함한 모든 인증서를 확인하고 관리합니다.'
          },
          applications: {
            title: '애플리케이션 연결',
            help: '인증서가 사용되는 위치와 업데이트 빈도를 확인합니다.'
          }
        },
        stats: {
          total: '인증서 수',
          expiring: '곧 만료',
          expired: '만료됨'
        },
        versionCount: '{count}개 버전',
        versionCountShort: '{count}개',
        sourceLabels: {
          manual: '수동',
          acme: 'ACME',
          unknown: '알 수 없음'
        },
        fields: {
          expires: '만료일',
          source: '출처'
        },
        empty: {
          title: '인증서가 없습니다',
          description: '첫 번째 인증서를 가져와 관리를 시작하세요.'
        },
        applications: {
          description: '선택한 인증서를 사용하는 애플리케이션과 자동 업데이트를 확인합니다.',
          selectPrompt: '먼저 왼쪽에서 인증서를 선택하세요',
          selectedCertificate: '선택한 인증서',
          connectedApps: '연결된 애플리케이션 ({count})',
          noApps: '이 인증서에 연결된 애플리케이션이 아직 없습니다.',
          addApp: '애플리케이션 추가',
          automationTitle: '자동 업데이트 설정',
          activeAutomations: '활성 자동 업데이트',
          totalAutomations: '전체 자동 업데이트 계획',
          automationDescription: '자동 업데이트 계획은 인증서 상태를 정기적으로 확인하고 필요할 때 연결된 애플리케이션에 업데이트를 배포합니다.'
        }
      }
    },
    detail: {
      backList: '반환 목록',
      description: '인증서 버전 정보, 형식 산출물 및 관련 자산을 표시합니다.',
      title: '인증서 정보'
    },
    detailPanel: {
      sources: {
        agentContext: 'Agent컨텍스트',
        platformBinding: '플랫폼 바인딩 기록'
      },
      usage: {
        columns: {
          domainName: '도메인/대상',
          agentName: 'Agent이름',
          siteName: '사이트 이름',
          bindingType: '바인딩 형식',
          usageSource: '출처',
          status: '상태'
        },
        empty: '현재 관련 자산이 없다',
        toolbar: '관련 자산'
      },
      summary: {
        certificateName: '인증서 이름',
        logicalDomain: '논리적 도메인',
        issuer: '발급자',
        subject: '주체',
        serialNumber: '일련번호',
        chainStatus: '체인 상태'
      },
      sections: {
        subjectInfo: '메인 정보',
        issuerInfo: '발급자 정보',
        certificateFields: '인증서 필드',
        extensionFields: '확장 필드'
      },
      fields: {
        commonName: '공통 이름(CN)',
        organization: '조직(O)',
        organizationalUnit: '조직 단위(OU)',
        countryRegion: '국가/지역(C)',
        stateProvince: '주/도(ST)',
        locality: '도시(L)',
        version: '버전',
        signatureAlgorithm: '서명 알고리즘',
        publicKeyAlgorithm: '공개 키 알고리즘',
        fingerprintSha256: 'SHA-256 지문',
        san: 'SAN',
        deployable: '배포 가능',
        leafStorageRef: '잎 인증서 참조',
        chainCertificateCount: '체인 인증서 개수',
        trustRootCertificate: '대상 루트 인증서',
        trustRootStatus: '루트 인증서 상태',
        chainDiagnostics: '연쇄 진단'
      },
      fallbacks: {
        unknownCertificate: '알 수 없는 인증서',
        unknownIssuer: '알 수 없는 발행자',
        unnamedCertificate: '이름 없는 인증서',
        unknownDomain: '알 수 없는 도메인',
        unknownSubject: '알 수 없는 사용자',
        unknown: '알 수 없음',
        notPartOfCertificate: '인증서의 일부가 아닙니다',
        none: '없음',
        emptyValue: '—',
        unknownType: '알 수 없는 형식',
        unknownResource: '알 수 없는 자원',
        unknownTarget: '알 수 없는 대상'
      },
      values: {
        yes: '예',
        no: '아니요'
      },
      separators: {
        diagnostic: ';',
        list: ','
      },
      diagnostics: {
        rootResolvedFromLibrary: '가져온 자료에는 루트 인증서 {root} 가 포함되어 있지 않습니다. 프로젝트 루트 인증서 저장소에서 이미 해석되었으므로 배포 시 전체 체인을 보완할 수 있습니다.'
      },
      chain: {
        roles: {
          leaf: '잎사귀 인증서',
          root: '루트 인증서',
          intermediate: '중간 인증서'
        },
        title: '인증서 체인',
        empty: '인증서 없음',
        subject: '주체: {value}',
        issuer: '발급자: {value}'
      },
      errors: {
        loadFailedTitle: '인증서 정보를 불러오는 데 실패했습니다',
        code: '오류 코드: {code}'
      },
      actions: {
        retry: '재시도'
      },
      states: {
        loading: '로드 중...'
      },
      tabs: {
        ariaLabel: '인증서 정보 태그',
        detail: '상세 정보',
        usage: '관련 자산'
      },
      validity: {
        title: '인증서 유효기간',
        notBefore: '시작: {value}',
        notAfter: '만료: {value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'ID 버전',
        createdAt: '만든 시간',
        format: '형식',
        secretRef: 'Secret 참조',
        status: '상태'
      },
      create: '형식 설정 생성',
      createFailed: '형식 생성 실패',
      description: '인증서 {id}의 PEM/DER/PFX/JKS/P7B 형식 설정 입력.',
      empty: '현재 형식 설정이 없습니다',
      fields: {
        alias: 'Alias(선택 사항)',
        containsPrivateKey: '포함개인 키(PEM)',
        passwordSecretRef: 'passwordSecretRef(PFX/JKS)',
        targetFormat: '대상 형식',
        versionId: 'ID 버전'
      },
      hint: 'PFX/JKS는 반드시 시스템에 기존의 passwordSecretRef를 사용해야 한다.실제 배포는 인증서 버전과 포맷 구성에 따라 실시간으로 자료를 생성합니다.',
      loadFailed: '형식 설정을 로드하지 못했습니다',
      optionAvailable: '{label}-사용 가능',
      placeholders: {
        alias: '예를 들면 gcac-cert이다'
      },
      title: '인증서 형식 설정',
      toolbar: '형식 설정 목록',
      unsupported: '{format} 현재 기능을 생성할 수 없습니다.'
    },
    import: {
      addTitle: '인증서 추가',
      backList: '인증서 목록 반환하기',
      description: '현재 PEM + KEY와 PFX만 지원된다.PFX는 파일 가져오기만 지원합니다.가져오는 자료에는 서버 인증서, 전체 중간 인증서 체인, 개인 키가 포함되어야 합니다. 루트 인증서는 강제 항목이 아닙니다.',
      errors: {
        importFailed: '가져오기 실패',
        materialRequiredBeforeValidate: '검토를 시작하기 전에 자료 가져오기가 완료되어야 합니다.',
        needPassedValidation: '세 번째 검사를 완료하고, 검사가 통과되었는지 확인한 후에 가져오십시오.',
        validateFailed: '유효성 검사 실패'
      },
      formats: {
        pem: {
          hint: '서버 인증서와 전체 중간 인증서 체인, 개인 전용 키가 제공되어야 합니다.루트 인증서는 필수 항목이 아니며 누락될 경우 경고를 줍니다.'
        },
        pfx: {
          hint: '파일 가져오기만 지원되며 서버 인증서와 전체 중간 인증서 체인, 개인 키를 컨테이너에 포함해야 합니다.루트 인증서는 필수 항목이 아니며 누락될 경우 경고를 줍니다.'
        }
      },
      methods: {
        file: {
          hint: '기존 cert / key 또는.pfx 파일을 사용할 수 있다.',
          label: '선택파일'
        },
        text: {
          hint: 'PEM 텍스트를 직접 붙여넣고 임시 파일을 업로드하지 않는 것이 좋습니다.',
          label: '텍스트 붙여넣기'
        }
      },
      title: '인증서 가져오기'
    },
    importForm: {
      source: {
        title: '인증서 추가 방법 선택',
        description: '기존 인증서를 가져오거나 사용할 수 있을 때 ACME 자동 발급을 사용합니다.',
        manual: {
          title: '기존 인증서 가져오기',
          description: 'PEM, CRT 또는 PFX 인증서 파일과 개인 키를 업로드합니다.',
          recommended: '권장'
        },
        acme: {
          title: 'ACME로 인증서 요청',
          description: '인증 기관에서 인증서를 자동으로 요청하고 갱신합니다.',
          unavailable: '현재 사용할 수 없음'
        },
        unavailable: {
          title: 'ACME 발급 채널이 구성되지 않았습니다',
          description: '이 콘솔에는 사용할 수 있는 ACME 발급 진입점이 없습니다. 기존 인증서를 가져오거나 자동 발급 채널을 구성한 후 다시 시도하세요.'
        }
      },
      acme: {
        title: 'ACME 인증서 신청', loading: '발급 경로를 확인하는 중...', blocked: '신청 경로가 준비되지 않았습니다. 표시된 조건을 해결한 후 새로 고치세요.',
        status: { ready: '신청 가능', blocked: '설정 필요', unknown: '상태 알 수 없음' },
        fields: { issuer: '발급 기관', email: '연락처 이메일', domains: '도메인 이름', dnsCredential: 'DNS 자격 증명', keyType: '키 유형', autoRenew: '자동 갱신' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: '신청 제출', refresh: '상태 새로 고침' },
        errors: { requestFailed: 'ACME 요청 실패' }
      },
      hints: {
        pemChainCheck: '서버 인증서, 전체 중간 인증서 체인과 개인 키를 업로드하거나 붙여넣으십시오. 그러면 시스템이 인증서 체인과 개인 키 일치 관계를 검사합니다.',
        pfxChainCheck: 'PFX/P12 파일을 업로드하고 비밀번호를 기입하세요. 그러면 컨테이너 안에 있는 서버 인증서, 인증서 체인 및 개인 전용 키가 분석됩니다.',
        pfxFileOnly: 'PFX는 파일 가져오기만 지원합니다.'
      },
      roles: {
        leaf: '잎사귀 인증서',
        root: '루트 인증서',
        intermediate: '중간 인증서'
      },
      steps: {
        ariaLabel: '인증서 가져오기 단계',
        source: '추가 방법',
        formatAndMethod: '격식과 방법',
        materials: '자료 가져오기',
        validateAndImport: '체크하고 가져옵니다'
      },
      formatIntro: {
        title: '가져올 형식과 방법을 선택하세요',
        description: '재료 형식을 확인한 후, 파일을 업로드하거나 붙여넣을 파일을 선택합니다.PFX는 현재 파일 가져오기만을 지원한다.'
      },
      labels: {
        importType: '형식 가져오기',
        importMethod: '가져오는 방법',
        materialStatus: '재료 상태'
      },
      status: {
        supported: '지원됨',
        unsupported: '지원하지 않음',
        completed: '완료',
        incomplete: '완료하지 않음',
        matched: '일치',
        unmatched: '아니요일치'
      },
      fields: {
        certificateChainFile: '인증서 체인 파일',
        certificatePemText: '인증서 PEM 텍스트',
        privateKey: '개인 키({kind})',
        file: '파일',
        pemText: 'PEM 텍스트',
        pfxFile: 'PFX/P12 파일',
        certificateName: '인증서 이름',
        pfxPassword: 'PFX 패스워드'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----...\n-----END CERTIFICATE-----',
        certificateName: '례를 들면 example.com 생산인증서이다',
        required: '필수'
      },
      validation: {
        title: '가져온 파일을 검사합니다',
        description: '가져오기 전에 체인, 유효기간, 개인 키 일치, 재료 무결성을 체크합니다.',
        passed: '검사가 통과되었습니다. 가져올 수 있습니다',
        failed: '검증 미통과'
      },
      report: {
        certificateSummary: '인증서 요약',
        serialNumber: '일련번호',
        validity: '유효 기간',
        validityRange: '{start} ~ {end}',
        issuer: '발급자',
        issuerWithValue: '발급자: {value}',
        subject: '주체',
        chainValidation: '인증서 체인 확인',
        chainStatus: '체인 상태',
        certificateCount: '인증서 갯수',
        privateKeyMatch: '개인 키 일치',
        provided: '제공됨',
        matchResult: '일치 결과',
        privateKeySource: '개인 키 출처',
        blockers: '차단 항목',
        warnings: '경고'
      },
      selectedFile: '선택: {name}',
      upload: {
        choose: '파일 선택',
        noFile: '선택한 파일 없음'
      },
      importSuccess: '인증서 버전 ID:{id}를 성공적으로 가져왔습니다',
      actions: {
        validating: '체크하는 중...',
        validate: '시작검증',
        cancel: '취소',
        previous: '이전 단계',
        next: '다음',
        importing: '가져오는 중...',
        import: '인증서 가져오기'
      }
    },
    list: {
      filters: {
        keyword: '키워드',
        domain: '도메인',
        status: '상태'
      },
      placeholders: {
        assetKeyword: '도메인/SAN/지문',
        primaryDomain: 'example.com',
        versionKeyword: '이름/발행자/사용자/버전 ID'
      },
      columns: {
        notBefore: '시작 날짜',
        notAfter: '종료 날짜',
        associatedAsset: '관련 자산',
        sourceType: '추가 방식',
        status: '상태',
        certificateVersionId: '인증서 버전 ID'
      },
      sourceTypes: {
        manual: '수동 가져오기',
        internal_ca: '내부 CA',
        enterprise_ca: '엔터프라이즈 CA',
        external_api: '외부 API',
        acme: 'ACME',
        unknown: '알 수 없음'
      },
      lifecycle: {
        unknown: '알 수 없음',
        expired: '만료',
        expiringSoon: '기한이 곧 지나가다',
        valid: '유효'
      },
      fallbacks: {
        unselectedDomain: '도메인 이름이 선택되지 않았습니다.',
        unnamedDomain: '이름 없는 도메인',
        noSupplement: '잠시 추가 정보가 없습니다'
      },
      assets: {
        title: '도메인 목록',
        loadFailed: '도메인 목록을 불러올 수 없습니다',
        empty: '도메인 목록이 없습니다',
        unselectedTitle: '도메인 이름이 선택되지 않았습니다.',
        unselectedDescription: '먼저 왼쪽에서 하나의 논리 인증서 도메인을 선택하세요.'
      },
      versions: {
        title: 'SSL 인증서 목록',
        titleWithDomain: '{domain}의 SSL 인증서 목록',
        description: '오른쪽은 현재 도메인 이름, 시작 날짜, 종료 날짜, 발행자, 사용자 정보를 포함하는 SSL 인증서 목록을 보여준다.',
        loadFailed: 'SSL 인증서 목록을 불러오는 데 실패했습니다',
        emptyForDomain: '이 도메인 아래에 SSL 인증서가 없습니다',
        emptyForDomainDescription: '필터 오른쪽에 있는 인증서 가져오기 단추를 통해이 도메인의 인증서 버전을 추가할 수 있습니다.',
        empty: '인증서 없음',
        toolbar: '인증서 버전 목록',
        currentCount: '현재 {count} 개'
      },
      actions: {
        toggleFilters: '필터',
        clear: '비우기',
        deleteRisk: '삭제는 현재 인증서 버전을 바로 삭제합니다.버전이 계속 바인딩 또는 배포되면 시스템은이 동작을 거부합니다.'
      },
      errors: {
        deleteFailed: '삭제 실패',
        materialRequiredForFormat: '현재 형식에 해당하는 인증서 자료를 제공해야 합니다.',
        importFailedWithCheck: '가져오는데 실패했습니다. 입력 자료를 검사하세요.',
        validateFailedWithCheck: '검사가 실패했습니다. 입력 자료를 확인하세요.'
      },
      import: {
        description: '현재 PEM + KEY와 PFX만 지원된다.가져올 때마다 서버 인증서, 전체 중간 인증서 체인, 개인 키를 포함해야 합니다.루트 인증서는 필수 항목이 아닙니다. 루트 인증서가 없으면 경고를 표시합니다.개인 전용 키는 시스템 Secret 에만 저장되며 API 응답으로 반환되지 않는다.'
      }
    },
    trustRoots: {
      title: 'Root certificate management',
      description: 'View the project root certificate inventory, source observations, and leaf-version relations in a modal without leaving the certificate assets page.',
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
        relatedAssets: 'Related certificate assets',
        relatedVersions: 'Related certificate versions'
      },
      sections: {
        observations: 'Source observations',
        relatedAssets: 'Related certificate assets',
        versionRelations: 'Leaf certificate relations',
        managedCertificates: 'Managed certificate root status'
      },
      states: {
        loadFailed: 'Failed to load root certificate records',
        detailFailed: 'Failed to load root certificate details',
        assetLoadFailed: 'Failed to load related certificate assets',
        emptyTitle: 'No root certificate records',
        emptyDescription: 'The current project does not have any imported root certificates yet.',
        unselectedTitle: 'No root certificate selected',
        unselectedDescription: 'Select a root certificate record from the list on the left first.',
        rootNotInLibrary: 'This root certificate is not in the library yet. The related assets and statuses below are inferred from managed certificate chains.',
        emptyObservations: 'No source observations yet',
        emptyRelations: 'No related leaf certificate versions',
        emptyAssets: 'No certificate assets are currently related to this root'
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
      backDetail: '자세한 정보 반환',
      columns: {
        domainName: '도메인/대상',
        resourceId: '자원 ID',
        resourceType: '자원 형식',
        status: '상태',
        updatedAt: '업데이트 시간'
      },
      description: '인증서 {id}의 바인딩, 배포 대상 및 리소스 참조.',
      empty: '잠시 사용 관계가 없다',
      loadFailed: '관계형 로딩에 실패했습니다',
      title: '인증서 사용 관계',
      toolbar: '사용 관계'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: '사용자 이름 + 비밀번호',
        usernamePasswordWithUsername: '사용자명 + 비밀번호/{username}',
        sshKey: 'SSH 개인 키',
        sshKeyWithUsername: 'SSH 개인 키/{username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: '구조화된 HTTP 화면를 호출하여 분산된 curl 명령을 대체한다.'
        },
        browser: {
          displayName: '브라우저 단계',
          description: '로그인된 브라우저 세션에서 페이지를 탐색, 추출 또는 검증합니다.'
        },
        ssh: {
          displayName: 'SSH 명령',
          description: '실행될 SSH 명령어는 연결과 인증서 참조만 저장합니다.'
        },
        sftp: {
          displayName: 'qq 업로드/다운로드',
          description: 'SFTP step 업로드를 통해 파일 다운로드, 인증서 및 설치 설정에 적합합니다.'
        },
        scp: {
          displayName: 'qq 업로드/다운로드',
          description: 'SCP를 통해 파일을 복사하여 간단한 호스트 파일 배포에 적합합니다.'
        },
        verify: {
          displayName: '검증',
          description: 'HTTP 상태, 텍스트, 정규 또는 인증서 지문에 대한 예언을 합니다.'
        },
        condition: {
          displayName: '가지 판단',
          description: '변수의 존재나 값을 기준으로 후속 경로를 결정한다.'
        },
        transform: {
          displayName: '변환',
          description: 'JSONata로 상위 출력을 새 워크플로 컨텍스트 변수로 변환합니다.'
        },
        foreach: {
          displayName: '컬렉션 반복',
          description: '동적 컬렉션을 순서대로 반복하고 각 항목에 동일한 하위 단계를 실행합니다.'
        },
        checkpoint: {
          displayName: '복구 체크포인트',
          description: '장치 쓰기 작업 전에 검증 가능한 원격 상태 요약을 저장합니다.'
        },
        pluginAction: {
          displayName: '플러그인 원자 작업',
          description: 'DSL에 명시된 단일 플러그인 작업을 호출하며 순서나 롤백은 관리하지 않습니다.'
        },
        wait: {
          displayName: '대기',
          description: '몇 초 동안 기다린 후 계속 실행하세요.'
        },
        manual: {
          displayName: '수동 확인',
          description: '워크플로를 일시 중지하고 수동 확인 후 계속합니다.'
        }
      },
      fields: {
        command: '명령',
        connectionRef: '연결 변수',
        contentRef: '내용 변수',
        credential: '자격 증명',
        description: '설명',
        direction: '방향',
        expected: '기댓값',
        expectedHostKeyFingerprint: 'Host Key 지문',
        hostKeyPolicy: 'Host Key 전략',
        hostRef: '호스트 변수',
        inputRef: '변수 입력',
        instruction: '안내문을 확인하다',
        localPath: '로컬경로',
        mode: '파일 권한',
        operator: '연산자',
        remotePath: '원거리 경로',
        seconds: '초 대기',
        temporaryPath: '임시 경로',
        timeoutMs: '제한 시간(ms)',
        timeoutSeconds: '타임아웃 카운트',
        transformInput: '변환 입력',
        itemsPath: '컬렉션 경로',
        itemVariable: '항목 변수',
        indexVariable: '인덱스 변수',
        maxItems: '최대 항목 수',
        foreachSteps: '하위 단계 JSON',
        checkpointName: '체크포인트 이름',
        checkpointCapture: '캡처 경로 JSON',
        requiredForRollback: '롤백 필수',
        pluginId: '플러그인 ID',
        capability: 'Capability',
        actionId: '작업 ID',
        actionContractVersion: '작업 계약 버전',
        actionInput: '작업 입력 JSON',
        inputSchemaSha256: '입력 Schema 요약',
        outputSchemaSha256: '출력 Schema 요약',
        writeEffect: '쓰기 효과',
        idempotencyKeyRef: '멱등 키 참조',
        outputFormat: '출력 형식',
        usernameVariable: '사용자 이름 변수',
        variable: '변수',
        verifyType: '형식 인증',
        browserAction: '브라우저 동작',
        browserUrl: '페이지 URL',
        browserExtractions: '추출 JSON',
        browserVerification: '검증 JSON'
      },
      options: {
        boolean: { yes: '예', no: '아니요' },
        direction: {
          download: '다운로드',
          upload: '업로드'
        },
        hostKeyPolicy: {
          manualApproval: '인적 심사 허가',
          strict: '정밀 검사',
          trustOnFirstUse: '첫 번째 신뢰'
        },
        operator: {
          equals: '같음',
          exists: '존재',
          notEquals: '같지 않음',
          notExists: '존재하지 않음'
        },
        transformFormat: {
          raw: '원본 값',
          jsonString: 'JSON 문자열'
        },
        verifyType: {
          certificateFingerprint: '인증서 지문',
          httpStatus: 'HTTP 상태',
          regex: '정규 정합',
          textContains: '텍스트 포함'
        }
      },
      stages: {
        backup: {
          title: '백업',
          description: '되감을 수 있는 재료를 보존합니다.'
        },
        install: {
          title: '설치',
          description: '배포 인증서 또는 설정.'
        },
        prepare: {
          title: '준비',
          description: '연결, 변수, 자료를 준비합니다.'
        },
        refresh: {
          title: '새로고침',
          description: '서비스 오버로드 또는 대상 새로 고침.'
        },
        verify: {
          title: '검증',
          description: '결과가 예상한 바와 부합함을 확인하다.'
        }
      },
      defaults: {
        displayName: '{name} 워크플로',
        nodes: {
          backupExistingCertificate: '기존 인증서 백업',
          reloadService: '다시 로드서비스'
        },
        variables: {
          certificatePaths: {
            description: '대상 인증서 경로 설정입니다'
          },
          credential: {
            description: '연결 인증서'
          },
          deviceHost: {
            description: '대상 호스트'
          },
          serverCert: {
            description: '서버 인증서 자료 배포 대기 중',
            outputs: {
              certFile: {
                description: '서버 인증서 파일'
              },
              keyFile: {
                description: '개인 키 파일'
              }
            }
          },
          sshUsername: {
            description: 'SSH 로그인 사용자 이름'
          },
          verifyUrl: {
            description: '배포 후 주소 확인'
          }
        },
        config: {
          conditionDescription: '대상 호스트 변수가 존재하는지 확인합니다',
          manualInstruction: '대상 장치 인증서가 새 버전으로 변경되었는지 확인하세요.'
        }
      },
      variableFlow: {
        system: '시스템',
        variable: '변수'
      },
      errors: {
        unknownNodeType: '알 수 없음노드유형: {type}',
        missingWorkflowDsl: '백엔드에서 워크플로 DSL을 반환하지 않았습니다'
      }
    },
    canvasEditor: {
      summary: '노드 {nodes}, 연결 {edges}, 변수 {variables}',
      stageNodeCount: '{count} 노드',
      copyLabel: '{label} 부본',
      actions: {
        addVariable: '변수 추가',
        collapseBottomPanelAria: '하단 제어 패널 접기',
        collapseDown: '아래로 접기',
        copy: '복사',
        copyNode: '노드 복사',
        delete: '삭제',
        deleteNode: '노드 삭제',
        expandBottomPanelAria: '하단 제어판을 펼칩니다',
        expandPanel: '패널 펴기',
        layout: '배포를 정리하다.',
        mockCurrentNode: '현재 노드만 에뮬레이트합니다',
        mockRunning: '미리 보기...',
        paste: '붙여넣기',
        pasteNode: '노드 붙여넣기',
        realRun: '현재 노드를 실행합니다',
        realRunHttp: 'HTTP 현재 노드를 실행합니다',
        realRunRunning: '시험운행 중...',
        realRunSsh: '실제 SSH 가 현재 노드를 실행한다',
        realRunTransfer: '실제 파일 전송 시도입니다',
        redo: '다시 실행',
        saveDraft: '초안 저장',
        saving: '저장 중...',
        undo: '철회',
        zoomIn: '확대',
        zoomOut: '축소'
      },
      aria: {
        bottomPanel: '아래 패널',
        canvasArea: '캔버스 영역',
        dslPanel: 'DSL 패널',
        nodePalette: '노드 라이브러리',
        propertiesPanel: '속성 판넬',
        runtimePanel: '실행 패널',
        toolbar: '워크스트림 캔버스 도구막대',
        validationPanel: '패널 검사',
        variablesPanel: '변수 판넬'
      },
      credentialHints: {
        savedApiKey: 'API Key 저장됨',
        savedBearerToken: 'Bearer Token 저장됨',
        savedSshSftp: '저장된 SSH / SFTP 인증서',
        savedUsernamePassword: '저장된 사용자 이름 + 비밀번호'
      },
      credentials: {
        emptyCreateHint: '사용 가능한 자격 증명이 없습니다. 먼저 목록 페이지의 자격 증명 관리에서 생성하세요.',
        loading: '인증서 목록 불러오는 중...'
      },
      dsl: {
        title: 'DSL 가져오기 및 겹치기',
        hint: '직접 외부 DSL JSON를 붙이거나 로컬 DSL 파일을 선택할 수 있다.브라우저의 현재 캔버스만 덮어쓰도록 가져왔으며 새 워크플로 버전을 만들려면"초안 저장"을 클릭하세요.',
        selectFile: 'DSL 파일을 선택합니다',
        actions: {
          importOverwrite: 'DSL 덮어쓰기 캔버스 가져오기',
          resetToCanvas: '현재 캔버스 DSL을 다시 입력합니다',
          openStepEditor: '대화상자에서 현재 노드 DSL 편집',
          openStepEditorAria: '대화상자에서 현재 노드 DSL 편집',
          applyStepEditor: '변경 사항 적용',
          cancelStepEditor: '취소'
        },
        editor: {
          title: '현재 노드 DSL 편집',
          description: '전체 JSON을 수정한 뒤 적용하세요. 잘못된 JSON은 현재 노드를 덮어쓰지 않습니다.',
          ariaLabel: '현재 노드 DSL 내용'
        },
        messages: {
          fileLoaded: '로드파일: {fileName}',
          imported: 'DSL는 총 {count} 개의 노드를 가져와서 현재 캔버스를 덮어씁니다.',
          resetToCompiled: '컴파일 후 DSL로 다시 입력했다.'
        },
        errors: {
          importFailed: 'DSL 가져오기 실패했습니다',
          invalidTopLevel: 'DSL 최상위 구조는 유효하지 않으며, 객체여야 합니다.'
        }
      },
      empty: {
        selectNodeToEdit: '노드를 선택한 후 속성을 편집하세요.'
      },
      errors: {
        backendValidationFailed: '유효성 검사 실패',
        credentialsLoadFailed: '워크플로 자격 증명을 불러오는 데 실패했습니다',
        missingStepName: '단계 이름 누락',
        missingWorkflowDsl: '워크플로 DSL을 가져올 수 없습니다'
      },
      fields: {
        authType: '인증 형식',
        clientCertificate: '클라이언트 인증서',
        clientPrivateKey: '클라이언트 개인 전용 키',
        command: '명령',
        connectionVariable: '연결 변수',
        contentRef: '내용 인용',
        cookieName: 'Cookie 이름',
        credential: '자격 증명',
        credentialSelector: '인증서 선택기',
        defaultValue: '기본값',
        deliveryLocation: '위치 전송',
        description: '설명',
        direction: '방향',
        fileMode: '파일 권한',
        headerName: 'Header 이름',
        hostRefOrHostname: '호스트 변수/호스트 이름입니다',
        hostVariable: '호스트 변수',
        keyName: 'Key 이름',
        localPath: '로컬경로',
        newNodeStage: '새로운 노드 단계',
        nodeName: '노드 이름',
        remotePath: '원거리 경로',
        requestBody: '요청 본문',
        requestBodyStructuredHint: '이 요청은 구조화된 form 또는 multipart 필드를 사용합니다. DSL 편집기에서 수정하세요.',
        requestBodyEmptyHint: '이 요청에는 구성된 본문이 없습니다.',
        required: '필수',
        secretValue: '암호문값',
        sensitive: '민감',
        stage: '소속 단계',
        temporaryPath: '임시 경로',
        timeoutSeconds: '타임아웃 카운트',
        type: '유형',
        username: '사용자 이름',
        variableName: '변수 이름'
      },
      options: {
        download: '다운로드',
        manualInput: '수동으로 작성하다',
        notSelected: '선택되지 않음',
        upload: '업로드'
      },
      runtime: {
        noCredentialVariables: '현재 워크플로에 증명 변수가 없습니다.',
        noExtraVariables: '현재 노드에는 추가 런타임 변수가 없다.'
      },
      sections: {
        httpAuth: 'HTTP 인증',
        nodePalette: '노드 라이브러리',
        properties: '속성 판넬',
        referenceFlow: '인용 흐름',
        runtimeCredentialVariables: '런타임 증명 변수',
        runtimeVariables: '런타임 변수',
        singleNodeTest: '단일 노드 테스트 실행',
        variableConfig: '변수 설정'
      },
      tabs: {
        runtime: '운행 상태',
        validation: '검증',
        variables: '변수'
      },
      test: {
        cause: '원인',
        code: '코드',
        emptyHint: '노드 선택 후 시뮬레이션 또는 실제 실행을 실행할 수 있다.',
        error: '오류',
        executionPlan: '계획을 집행하다',
        exitCode: '종료 코드',
        failureDetails: '실패 정보',
        hint: '테스트 팁',
        logs: '로그',
        nodeOutput: '노드 출력',
        running: '실행 중',
        stage: '단계',
        stderr: '표준 오류',
        stdout: '표준 출력',
        suggestion: '제안',
        target: '대상',
        errors: {
          mockRunFailed: '시뮬레이션 실행 실패',
          realRunFailed: '실제 시도는 실패했다'
        },
        messages: {
          mockCompleted: '시뮬레이션 실행 완료.',
          mockFailed: '시뮬레이션 작업이 실패했습니다.',
          realCompleted: '리얼 테스트 완료.',
          realFailed: '실제 시도는 실패했다.'
        }
      },
      validation: {
        levels: {
          error: '오류',
          risk: '위험',
          warning: '경고'
        },
        location: {
          canvas: '캔버스',
          edge: '연결선',
          fieldSuffix: '필드',
          node: '노드'
        },
        noBlockingErrors: '오류 차단 없음.'
      },
      variables: {
        customRuntimeDescription: '실행 변수를 설정합니다',
        notUsed: '사용하지 않음',
        usedBy: '사용위치: {nodes}'
      }
    },
    templates: {
      title: '워크플로',
      resourceName: '워크플로',
      description: '캔버스 초안대로 CURL/SSH/SFTP 워크플로 버전, 배포 상태 및 변경 사항을 관리합니다.',
      pluginSources: {
        createTitle: '플러그인에서 만들기', applyTitle: '플러그인에서 초안 만들기', description: '활성화된 플러그인의 인증서 워크플로만 표시합니다. 먼저 워크플로를 선택한 다음 플러그인 버전을 선택하세요.',
        createAction: '워크플로 만들기', applyAction: '초안 만들기', currentTarget: '현재 워크플로: {name}', namePlaceholder: '워크플로 이름 입력', loading: '플러그인 소스 로딩 중...', empty: '사용 가능한 플러그인 소스가 없습니다.', version: '플러그인 버전', workflowVersion: '워크플로 버전', versionSource: '버전 출처: {plugin} / {version} / {capability}',
        capabilities: { deploy: '인증서 배포', rollback: '인증서 롤백' }, errors: { loadFailed: '플러그인 소스를 불러오지 못했습니다', nameRequired: '워크플로 이름을 입력하세요', missingApplyTarget: '대상 워크플로가 없습니다', actionFailed: '플러그인 워크플로 복사에 실패했습니다' }
      },
      origins: { user: '사용자 지정', plugin_internal: '플러그인 기본 제공' },
      actions: {
        addVersion: '새 버전',
        applyTemplate: '모형을 적용하다.',
        cancel: '취소',
        close: '닫기',
        createBlank: '빈 공간 새로 만들기',
        credentialManagement: '증빙 관리',
        delete: '삭제',
        detail: '상세 정보',
        edit: '편집',
        publishVersion: '릴리즈 버전',
        rename: '이름 변경',
        saveName: '이름 저장',
        saveNote: '설명 저장',
        switchVersion: '버전 바꾸기',
        templateManagement: '템플릿관리',
        versionManagement: '버전 관리'
      },
      states: {
        creating: '생성 중...',
        loading: '로드 중...',
        processing: '처리 중...',
        saving: '저장 중...'
      },
      fields: {
        actions: '작업',
        createdAt: '만든 시간',
        currentStatus: '현재 상태',
        currentVersion: '현재 버전',
        currentVersionId: '현재 버전은 ID이다',
        id: '워크플로 ID',
        name: '워크스트림 이름',
        origin: '출처',
        note: '비고',
        status: '상태',
        updatedAt: '업데이트 시간'
      },
      filters: {
        showNonDeployment: '배포 외 워크플로 표시'
      },
      empty: {
        description: '캔버스 스케치를 만든 다음, 버전에 따라 공식 링크에 게시합니다.',
        noChangeSummary: '변경 사항이 없습니다.',
        noChangeSummaryShort: '변경 사항 없음',
        noVersions: '버전 없음',
        title: '워크플로가 없습니다'
      },
      tabs: {
        summary: '개요',
        versions: '버전'
      },
      versionStatuses: {
        disabled: '비활성화됨',
        draft: '초안',
        published: '게시됨'
      },
      detail: {
        description: '워크플로 정보, 캔버스 초안 및 버전 목록을 참조하세요.',
        publishedVersion: '현재 배포버전은 {version}이다',
        title: '워크플로 정보',
        titleWithName: '워크플로 {name}'
      },
      rename: {
        title: '워크플로 이름',
        description: '이전 버전을 변경하지 않고 목록과 상세 화면에 표시되는 이름을 수정합니다.',
        placeholder: '워크플로 이름 입력',
        messages: { success: '워크플로 이름이 업데이트되었습니다.' },
        errors: { required: '워크플로 이름은 필수입니다.', failed: '워크플로 이름을 변경하지 못했습니다.' }
      },
      versionManager: {
        description: '캔버스의 내용을 변경하지 않고 새로 만들고 배포하는 워크플로 버전을 관리합니다.',
        titleWithName: '버전관리: {name}'
      },
      changeSummaries: {
        createFromPlugin: '플러그인 기능에서 워크플로 만들기',
        applyFromPlugin: '플러그인 기능에서 초안 만들기',
        applyFromFileTemplate: '파일 템플릿에서 워크스트림 초안을 덮어씁니다',
        createCanvasDraft: '프론트 엔드 캔버스 만들기 워크스트림 초안',
        createFromFileTemplate: '파일 템플릿에서 워크스트림 초안을 만듭니다',
        createVersionDraft: '버전 관리가 새 버전의 초안을 만듭니다',
        saveCanvasDraft: '캔버스 편집기 초안 버전 저장'
      },
      messages: {
        canvasDraftUpdated: '현재 초안 버전이 업데이트되었습니다.',
        switchedVersion: '{version}로 전환되었습니다.',
        versionDraftCreated: '새 버전의 초안을 만들었습니다.',
        versionNoteUpdated: '버전 설명이 업데이트되었습니다.'
      },
      errors: {
        createVersionFailed: '워크플로 버전을 만들 수 없습니다',
        loadVersionsFailed: '워크플로 버전을 불러오는 데 실패했습니다',
        missingWorkflowDsl: '워크플로 DSL을 가져올 수 없습니다',
        publishVersionFailed: '워크플로 버전을 배포하는 데 실패했습니다',
        saveCanvasDraftFailed: '캔버스 스케치를 저장할 수 없습니다',
        updateVersionNoteFailed: '업데이트 버전 설명이 실패했습니다'
      },
      delete: {
        riskText: '삭제하면 워크플로와 모든 버전이 비활성화되며 목록에 더 이상 표시되지 않습니다.역사 운행의 기록은 고쳐지지 않는다.'
      },
      loading: {
        versions: '버전 불러오는 중...'
      },
      fileTemplates: {
        applyAction: '현재 워크플로를 템플릿으로 덮어씁니다',
        applyTitle: '워크플로를 파일 템플릿으로 덮어씁니다',
        createAction: '템플릿별로 워크플로를 생성합니다',
        createTitle: '파일 템플릿에서 새 워크스트림을 만듭니다',
        currentTarget: '현재대상: {name}',
        description: '템플릿 파일은 내장된 템플릿 라이브러리나 사용자가 가져온 디렉터리에서 가져온 것이다.기존 워크플로를 덮어쓸 때 과거 기록 버전 대신 새 초안 버전이 만들어집니다.',
        empty: '워크플로가 없습니다',
        identifier: '"{name}"',
        invalid: '유효하지 않음',
        invalidFile: '파일이 올바르지 않음',
        loading: '파일 템플릿 스캔 중...',
        valid: '사용 가능',
        sources: {
          builtin: '내장',
          userImported: '사용자 가져오기'
        },
        errors: {
          actionFailed: '파일 템플릿 작업을 수행할 수 없습니다',
          loadFailed: '워크플로 파일 템플릿을 불러오는 데 실패했습니다',
          missingApplyTarget: '덮어쓸 워크스트림 대상이 없습니다'
        }
      },
      credentials: {
        actions: {
          create: '증명 만들기'
        },
        addTitle: '증빙 서류 추가',
        count: '{count} 개',
        description: '워크플로를 관리하는 데 필요한 로그인 인증서는 API 인증서이며, 캔버스나 노드에서 직접 선택하여 재사용할 수 있다.',
        empty: '자격 증명 없음',
        loading: '증명 정보 불러오는 중...',
        registeredTitle: '등기 증명서',
        title: '증빙 관리',
        fields: {
          deliveryLocation: '위치 전송',
          headerOrParam: 'Header/파라메터 이름',
          name: '증명 이름',
          referenceLocation: '참조 위치',
          storageType: '저장소 형식',
          type: '자격 증명 형식',
          username: '사용자 이름'
        },
        kinds: {
          common: {
            family: '공통'
          },
          sshKey: {
            title: 'SSH 개인 키'
          },
          usernamePassword: {
            title: '사용자 이름 + 비밀번호'
          }
        },
        secretLabels: {
          password: '비밀번호',
          sshKey: 'SSH 개인 키'
        },
        placeholders: {
          apiKey: 'API Key를 입력한다',
          bearer: 'Bearer Token를 입력한다',
          password: '로그인 비밀번호를 입력하다',
          sshKey: '개인 전용 키 PEM 형식 붙여넣기'
        },
        messages: {
          created: '워크플로 변수, SSH 노드, HTTP 노드 중에서 직접 선택할 수 있는 증명이 생성되었다.'
        },
        errors: {
          createFailed: '증명을 만들 수 없습니다',
          loadFailed: '인증서를 불러오는 데 실패했습니다',
          missingCreatedId: '만든 인증서가 올바른 번호를 반환하지 않았습니다'
        }
      }
    }
  },
  monitoring: {
    tls: monitoringTlsKoKR,
    actions: {
      add: '모니터링 추가',
      probe: '사이트 검사',
      probing: '검사 중...',
      refresh: '데이터 새로 고침',
      refreshing: '새로 고치는 중...',
      remove: '제거'
    },
    errors: {
      addFailed: '모니터링 대상을 추가하지 못했습니다',
      deleteFailed: '모니터링 대상을 삭제하지 못했습니다',
      invalidTarget: '모니터링 대상 데이터가 올바르지 않습니다',
      loadFailed: '모니터링 데이터를 불러오지 못했습니다',
      probeFailed: '사이트 검사 요청에 실패했습니다',
      updateIntervalFailed: '검사 주기를 업데이트하지 못했습니다'
    },
    empty: {
      actualCertificate: '아직 측정된 TLS 인증서가 없습니다. HTTPS 대상은 사이트 검사 중 인증서 정보를 자동으로 수집합니다.',
      description: '오른쪽 위에서 모니터링을 추가하세요. 시스템은 설정된 주기에 따라 사이트를 검사하고 인증서 정보를 수집합니다.',
      noAddableAssets: '추가할 수 있는 애플리케이션 자산이 없습니다. 기존 대상은 상세 화면에서 검사 주기를 조정할 수 있습니다.',
      observedCertificateHistory: '연결된 인증서 버전이 아직 없습니다. 사이트 검사에서 첫 인증서를 수집하면 자동으로 보존합니다.',
      probeHistory: '검사 기록이 없습니다.',
      riskEvents: '관련 이벤트가 없습니다.',
      title: '모니터링 대상이 없습니다'
    },
    sections: {
      actualCertificate: '현재 사이트에서 측정된 인증서',
      actualCertificateHint: '사이트 검사와 함께 자동으로 수집',
      observedCertificateHistory: '연결된 인증서 버전',
      observedCertificateHistoryHint: '측정된 TLS 인증서 변경에 따라 버전 기록을 보존',
      probeHistory: '검사 기록',
      probeHistoryHint: '최근 20개의 시스템 검사 결과',
      riskEvents: '리스크 이벤트',
      riskEventsHint: '인증서 체인, 도메인, 지문 및 실행 상태',
      targets: '모니터링 대상'
    },
    labels: {
      applicationAsset: '애플리케이션 자산',
      currentTarget: '현재 대상',
      probeInterval: '검사 주기',
      secondsUnit: '초',
      millisecondsUnit: 'ms'
    },
    metrics: {
      availability: '가용성',
      certificateStatus: '인증서 상태',
      latency: '접속 지연',
      observedCertificateChanges: '측정 인증서 변경'
    },
    probe: {
      completed: '검사가 완료되었습니다',
      emptyHistoryBlock: '{index}번째 검사: 결과 없음',
      latencyNotCollected: '지연 시간이 수집되지 않음',
      recentAria: '최근 10개 검사 결과',
      waiting: '사이트 검사를 기다리는 중'
    },
    status: {
      error: '오류',
      none: '실행 대기',
      ready: '정상',
      warning: '경고',
      removed: '제거됨'
    },
    warnings: {
      certificateNotApplied: '시스템 검사에서 도메인 인증서의 최신 버전이 적용되지 않은 것으로 확인되었습니다',
      chainVerificationFailed: '시스템 검사에서 인증서 체인 검증 실패가 감지되었습니다'
    },
    fallback: {
      noEndpoint: '접근 주소가 설정되지 않았습니다',
      noFingerprint: '지문 없음',
      notClosed: '종료되지 않음',
      noSummary: '요약 없음',
      notCollected: '수집되지 않음',
      notSelected: '선택되지 않음',
      unknownAsset: '알 수 없는 자산',
      removedAsset: '{name} (제거됨)',
      unknownCertificate: '알 수 없는 인증서',
      unknownIssuer: '알 수 없는 발급자',
      unnamedEvent: '이름 없는 이벤트'
    },
    certificate: {
      actualCertificate: '실측 인증서',
      chainUntrusted: '시스템 신뢰 체인 인증을 통과하지 못했습니다',
      chainVerification: '체인 인증',
      chainVerified: '체인 인증 통과',
      chainVerifyFailedWithReason: '체인검증실패: {reason}',
      collectedAt: '수집 시간',
      issuer: '발급자',
      serialNumber: '일련번호',
      sha256Fingerprint: 'SHA-256 지문',
      subject: '주체',
      validity: '유효 기간',
      validityRange: '{start} ~ {end}'
    },
    columns: {
      certificateName: '인증서 이름',
      changedAt: '시간을 바꾸다',
      closedAt: '경고 종료 시간',
      currentStatus: '현재 상태',
      expiresAt: '기한',
      issuerName: '발급자 이름',
      latency: '지연',
      occurredAt: '발생 시간',
      result: '결과',
      source: '출처',
      status: '상태',
      time: '시간',
      warningContent: '경고 내용'
    },
    dialog: {
      defaultMetricsHint: '기본 모니터링 접근 가능성, 접근 지연 시간, 인증서 정보 및 인증서 기록.',
      description: '애플리케이션 자산 목록에서 대상을 선택하면 시스템은 액세스 가능성, 액세스 지연 시간, 인증서 정보 및 인증서 기록을 고정적으로 수집한다.',
      loadingAssets: '자산 불러오는 중...',
      selectAsset: '적용 자산을 선택하세요',
      title: '모니터 추가'
    },
    source: {
      controlPlane: '플랫폼'
    },
    targets: {
      assetCount: '{count} 개 자산',
      lazyLoadHint: '{shown} / {total}개 로드됨, 스크롤하여 더 로드'
    }
  },
  login: {
    visualLabel: '제품 설명',
    brand: 'GCAC',
    brandSecondary: '중앙 인증서 관리 플랫폼',
    headlinePrefix: '인증서 관리 사용하기',
    headlineHighlight: '더 지능적이고,',
    headlineSuffix: ', 더 안전하게',
    intro: '원스톱 인증서 자산 관리, 자동화된 배포 및 레이아웃, 전체 링크 감사 추적, 인증서 운영을 번거로운 수동 작업에서 검증 가능하고 추적이 가능한 표준화 프로세스로 전환하여 기업의 디지털 인프라를 보호합니다.',
    capabilitiesLabel: '플랫폼 기능',
    featureLifecycle: '수명 주기 관리',
    featureLifecycleDesc: '가져오기, 갱신, 버전 추적부터 만료 알림까지 인증서 자산의 모든 단계를 포괄합니다.',
    featureAutomation: '자동화된 배포',
    featureAutomationDesc: 'Nginx, Tomcat, IIS와 같은 주요 환경을 위해 버튼 한 번으로 감사 배포 계획을 생성합니다.',
    featureRollback: '안전하게 실행하고 롤백합니다',
    featureRollbackDesc: '배포 전 자동 검증, 모든 과정에 흔적을 남기고, 실패시 롤백하여 안정적인 생산 환경을 보장합니다.',
    formLabel: '로그인 양식',
    secure: '보안 연결',
    welcome: '콘솔 로그인',
    hint: '기업 계정을 사용하여 GCAC 관리 데스크에 들어간다',
    username: '사용자 이름',
    usernamePlaceholder: '사용자 이름을 입력하세요',
    password: '비밀번호',
    passwordPlaceholder: '비밀번호를 입력하세요.',
    failed: '로그인 실패. 나중에 다시 시도하세요',
    submitting: '인증 중...',
    submit: '덩 씨',
    policy: 'RBAC 권한 보호',
    audit: '전체 작업 감사'
  },
  internalCa: internalCaEnglish,
  applicationOnboarding: {
    eyebrow: '애플리케이션 연결 마법사', title: '애플리케이션 자산 추가', description: '업무 플랫폼을 선택하고 장치, 사이트, 인증서를 설정합니다.', stepsAria: '애플리케이션 연결 단계',
    steps: { platform: '플랫폼', device: '장치', target: '사이트', certificate: '인증서', complete: '완료' },
    platforms: { customManual: '사용자 지정 수동 생성', manualHint: '기존 수동 흐름 사용', pluginHint: '플랫폼 플러그인의 고정 흐름 사용', capabilityVersion: '연결 기능 버전', compatibility: '지원 플랫폼 버전', requiredInformation: '사전 제공 정보', inReview: '기능 검증 중으로 현재 사용할 수 없습니다', searchLabel: '플랫폼 검색', searchPlaceholder: '애플리케이션 이름, 플랫폼 버전 또는 연결 정보로 검색', pluginCenterPrompt: '원하는 애플리케이션을 찾지 못했나요?', pluginCenterAction: '플러그인 센터 보기' },
    device: { title: '플랫폼 연결', existing: '기존 장치 사용', new: '장치 추가', deviceId: '장치 ID', selectPlaceholder: '장치 선택', noExisting: '이 플랫폼에 사용할 수 있는 정상 장치가 없습니다.', existingLoading: '호환 장치를 불러오는 중입니다.', refreshExisting: '장치 새로고침', newDescription: '통합 장치 온보딩 마법사를 열고 Agent 등록 또는 장치 온보딩 후 이 마법사로 돌아옵니다.', newAction: '장치 온보딩 열기', username: '사용자 이름', password: '비밀번호', host: '주소', port: '포트' },
    target: { title: '사이트 선택', siteName: '사이트 이름', selectedSite: '선택한 사이트', accessDomain: '액세스 도메인', verifyUrl: '검증 URL', accessDomainPlaceholder: '예: ikuai.jacksonz.cn', verifyUrlPlaceholder: '예: https://ikuai.jacksonz.cn:443', domainHint: '관리 엔드포인트는 IP일 수 있지만 액세스 도메인과 검증 URL은 동일한 DNS 이름을 사용해야 합니다.', invalidConfiguration: '유효한 DNS 액세스 도메인과 동일한 호스트의 검증 URL을 입력하세요.', listenAddress: '수신 주소', listenPort: '수신 포트', protocol: '프로토콜', selectable: '선택 가능한 관리 대상', notSelectable: '선택할 수 없음', unavailableReason: '선택할 수 없는 이유', missingValue: '제공되지 않음', reasons: { managedTargetInactive: '이 관리 대상은 비활성 상태입니다.', workflowCapabilityMissing: '이 대상에는 현재 플랫폼에 필요한 워크플로 실행 기능이 없습니다.', targetEndpointMissing: '이 대상에는 완전한 수신 주소, 포트 또는 프로토콜이 없습니다.', unknown: '이 대상은 현재 선택 조건을 충족하지 않습니다.' } }, certificate: { title: '인증서 버전 선택', asset: '인증서 자산', version: '인증서 버전', requiredFormat: '이 플랫폼에는 {formats} 형식 인증서가 필요합니다' },
    complete: { title: '연결 완료', description: '애플리케이션 자산과 배포 계획이 생성되었습니다.' },
    actions: { customManual: '수동 생성', openWizard: '연결 마법사', previous: '이전', continue: '계속', refresh: '사이트 새로 고침', review: '인증서 확인', complete: '연결 완료', cancel: '취소' },
    messages: { requestFailed: '연결 요청에 실패했습니다. 권한과 입력을 확인하세요.', noPlatforms: '사용 가능한 플랫폼이 없습니다.', noSearchResults: '일치하는 플랫폼이 없습니다.' }
  },
  tenantArchitecture: { nav: '그룹 구조', eyebrow: '멀티 테넌트 거버넌스', title: '그룹 구조', description: '그룹, 자회사 및 관리자 관계를 관리합니다.', mode: { aria: '그룹 구조 모드', label: '그룹 구조 모드', hierarchical: '사용', single: '사용 안 함', updated: '최근 업데이트: {time}' }, actions: { checking: '확인 중', preflight: '사전 점검', enabling: '활성화 중', enable: '활성화', rollingBack: '롤백 중', rollback: '비활성화', suspend: '중지', resume: '재개', revokeAdministrator: '관리자 해제' }, preflight: { title: '활성화 사전 점검', summary: '차단 항목: {blockers}', passed: { title: '조건 충족', summary: '{count}개 점검 통과' }, blocked: { title: '조치 필요', summary: '{count}개 차단 항목', description: '다음 문제를 해결한 후 사전 점검을 다시 실행하세요.' } }, confirm: { enable: '그룹 구조를 활성화할까요?', rollback: '단일 테넌트 모드로 되돌릴까요?', revokeAdministrator: '이 관리자 관계를 해제할까요?' }, messages: { preflightCompleted: '사전 점검을 완료했습니다.', enabled: '그룹 구조를 활성화했습니다.', rolledBack: '단일 테넌트 모드로 되돌렸습니다.', companyCreated: '자회사를 만들었습니다.', administratorAdded: '관리자를 설정했습니다.', administratorRevoked: '관리자 관계를 해제했습니다.', statusUpdated: '자회사 상태를 업데이트했습니다.' }, errors: { emptyMode: '상태가 반환되지 않았습니다.', loadFailed: '로드에 실패했습니다.', preflightFailed: '사전 점검에 실패했습니다.', enableFailed: '활성화에 실패했습니다.', rollbackFailed: '롤백에 실패했습니다.', companyCreateFailed: '자회사 생성에 실패했습니다.', administratorFailed: '관리자 설정에 실패했습니다.', administratorRevokeFailed: '관리자 해제에 실패했습니다.', statusFailed: '상태 업데이트에 실패했습니다.' }, company: { title: '자회사 추가', name: '이름', namePlaceholder: '자회사 이름 입력', code: '코드', codePlaceholder: '고유 코드 입력', submit: '자회사 생성' }, administrator: { title: '자회사 관리자', tenant: '자회사', tenantPlaceholder: '자회사 선택', subjectId: '사용자 ID', subjectPlaceholder: '사용자 ID 입력', submit: '관리자 추가', empty: '관리자 없음' }, tree: { aria: '그룹 구조도', empty: '현재 관리 범위에 표시할 테넌트가 없습니다.' }, history: { aria: '최근 모드 기록', title: '최근 모드 기록', kind: { PREFLIGHT: '사전 점검', ENABLE: '활성화', ROLLBACK: '롤백' }, status: { RUNNING: '진행 중', COMPLETED: '완료', FAILED: '실패' } }, types: { GROUP: '그룹', COMPANY: '자회사' }, status: { ACTIVE: '활성', SUSPENDED: '중지됨' }, membership: { owner: '소유자', admin: '관리자' } },
  tenantSwitcher: { title: '테넌트 전환', aria: '전환 가능한 테넌트', current: '현재', switching: '전환 중', confirm: '{tenant}(으)로 전환할까요?', success: '{tenant}(으)로 전환했습니다.', errors: { contextStale: '테넌트 컨텍스트가 만료되었습니다. 사용 가능한 테넌트를 새로 고쳤습니다.', membershipRequired: '대상 테넌트의 활성 멤버십이 없습니다.', modeConflict: '테넌트 모드가 변경 중입니다.', switchFailed: '전환에 실패했습니다. 기존 테넌트를 유지합니다.' } },
  errors: {
    forbiddenTitle: '403권한 없음',
    forbiddenMessage: '이 페이지에 접근할 수 있는 권한이 없습니다.',
    missingPermission: '누락권한: {permission}',
    notFoundTitle: '404 페이지가 존재하지 않습니다',
    notFoundMessage: '이 페이지가 존재하지 않습니다. 방문 주소가 올바른지 확인하세요.',
    backDashboard: '대시보드로 돌아가기',
    back: '뒤로',
    logout: '로그아웃'
  }
} as const
