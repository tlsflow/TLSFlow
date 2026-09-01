// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { internalCaEnglish } from './internal-ca.locale'
import { devicesRuRU } from './devices.locale'
import { caOperationsRuRU } from './ca-operations.locale'
import { credentialsRuRU } from './credentials.locale'
import { providersRuRU } from './providers.locale'
import { monitoringTlsRuRU } from './monitoring-tls.locale'
import { acmeAutomationRuRU } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
import { certificateFormatDefaultsRuRU } from './certificate-format.locale'
import { notificationsEnglish } from './notifications.locale'
import { reportsEnglish } from './reports.locale'
export default {
  credentials: credentialsRuRU,
  devices: devicesRuRU,
  caOperations: caOperationsRuRU,
  providers: providersRuRU,
  acme: acmeAutomationRuRU,
  notifications: notificationsEnglish,
  reports: reportsEnglish,
  app: {
    brand: 'GCAC',
    platform: 'Корпоративная платформа управления жизненным циклом SSL-сертификатов',
    defaultBreadcrumb: 'Консоль',
    dashboard: 'Панель мониторинга',
    versionLabel: 'Версия {version}'
  },
  common: {
    refresh: 'Обновить',
    logout: 'Выйти',
    enter: 'Войти',
    loading: 'Загрузка',
    actions: { done: 'Готово' },
    cancel: 'Отмена',
    save: 'Сохранить',
    edit: 'Изменить',
    delete: 'Удалить',
    notAvailable: 'Недоступно',
    yes: 'Да',
    no: 'Нет',
    close: 'Закрыть',
    unknownError: 'Неизвестная ошибка',
    unknownValue: 'Неизвестное значение: {value}',
    saving: 'Сохранение…',
    userFallback: 'Пользователь не вошел',
    tenantFallback: 'Тенант по умолчанию'
  },
  api: {
    errors: {
      requestFailed: 'Запрос не выполнен',
      timeout: 'Запрос превысил {seconds} секунд и был отменен.'
    }
  },
  auth: {
    errors: {
      missingSession: 'Ошибка входа: действительный сеанс не получен'
    },
    mock: {
      displayName: 'Системный пользователь (Mock)'
    }
  },
  designSystem: {
    confirm: {
      title: 'Подтвердить {action}',
      impactCount: 'Затронуто ресурсов: {count}',
      defaultRisk: 'Эта операция может запустить развертывание, повтор, откат или необратимые изменения.',
      typeToConfirm: 'Введите {text} для повторного подтверждения',
      cancel: 'Отмена',
      confirm: 'Подтвердить'
    },
    dataTable: {
      empty: 'Нет данных',
      loading: 'Загрузка...'
    },
    pagination: {
      total: 'Всего: {count}',
      pageSize: '{size} на странице',
      previous: 'Назад',
      next: 'Вперед',
      goToPage: 'Перейти на страницу {page}',
      pager: 'Пагинация'
    },
    dryRunChecklist: {
      title: 'Итоги предварительной проверки Dry-run',
      ariaLabel: 'итоги предварительной проверки dry-run',
      empty: 'Результаты предварительной проверки dry-run еще не сформированы.',
      unnamedCheck: 'Безымянная проверка',
      evidence: 'Данные проверки',
      status: { passed: 'Пройдено', failed: 'Сбой', warning: 'Предупреждение', unknown: 'Неизвестно' }
    },
    dryRunResult: {
      title: 'Результат выполнения Dry-run',
      close: 'Закрыть'
    },
    modal: {
      closeAria: 'Закрыть диалоговое окно'
    },
    toast: {
      close: 'Закрыть'
    },
    drawer: {
      closeAria: 'Закрыть панель'
    },
    secretInput: {
      label: 'Ссылка Secret',
      placeholder: 'Выберите или введите ссылку на секрет (SecretRef), значение не будет храниться в открытом виде',
      hint: 'Для чувствительных полей хранится только ссылка на секрет; открытое значение не показывается в интерфейсе.'
    },
    riskBadge: {
      levelPrefix: 'Уровень: '
    },
    status: {
      DRAFT: 'Черновик',
      PUBLISHED: 'Опубликовано',
      PENDING_APPROVAL: 'Ожидает согласования',
      READY: 'Готово к выполнению',
      RUNNING: 'Выполняется',
      SUCCESS: 'Успешно',
      PARTIAL_SUCCESS: 'Частично успешно',
      FAILED: 'Ошибка',
      CANCELLED: 'Отменено',
      ROLLED_BACK: 'Откат выполнен',
      DISCOVERED: 'Обнаружено',
      MANAGED: 'Под управлением',
      DRIFTED: 'Есть дрейф',
      EXPIRED: 'Истекло',
      REVOKED: 'Отозван',
      ERROR: 'Ошибка',
      IGNORED: 'Игнорируется',
      ONLINE: 'В сети',
      OFFLINE: 'Не в сети',
      ACTIVE: 'Включено',
      DISABLED: 'Отключено',
      OPEN: 'Открыт',
      ACKED: 'Подтвержден',
      RESOLVED: 'Решен',
      UPGRADING: 'Обновляется',
      UPDATE_REQUIRED: 'Требует обновления',
      UP_TO_DATE: 'Актуально',
      UNKNOWN: 'Неизвестно'
    },
    risk: {
      LOW: {
        label: 'Низкий',
        description: 'Требует внимания, но не блокирует операцию напрямую.'
      },
      MEDIUM: {
        label: 'Средний',
        description: 'Может повлиять на развертывание или мониторинг, требуется подтверждение.'
      },
      HIGH: {
        label: 'Высокий',
        description: 'Может привести к прерыванию сервиса или раскрытию безопасности.'
      },
      CRITICAL: {
        label: 'Критический',
        description: 'Нужно обработать в первую очередь; опасные операции требуют повторного подтверждения.'
      }
    },
    capability: {
      available: 'Есть',
      missing: 'Отсутствует',
      title: 'Совместимость возможностей',
      description: 'Показываются только подтвержденные результаты совместимости; неподтвержденные пункты не считаются поддерживаемыми.',
      matrixLabel: 'Матрица совместимости возможностей',
      satisfied: 'Выполнено',
      unknown: 'Неизвестно',
      manualRisk: 'Ручное подтверждение',
      empty: 'Нет данных о совместимости возможностей.'
    },
    executionLogViewer: {
      mode: {
        realtime: 'Обновление в реальном времени',
        autoRefresh: 'Автообновление'
      },
      search: {
        placeholder: 'Поиск по журналу'
      },
      level: {
        aria: 'Уровень журнала',
        all: 'Все'
      },
      actions: {
        showAll: 'Показать все {count}',
        showRecent: 'Показать последние {count}'
      },
      hint: {
        streaming: 'Статус задачи и журналы будут обновляться в реальном времени.',
        autoRefresh: 'Статус задачи и журналы будут обновляться автоматически.',
        pollingFallback: 'Сейчас используется периодическое обновление.',
        limited: 'Показаны последние {visible} из {total} строк журнала.'
      },
      steps: {
        aria: 'Шаги выполнения',
        emptyDetail: 'Описание шага пока отсутствует'
      },
      empty: {
        logs: 'Журналов пока нет.'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: 'Сводка прогресса выполнения',
        taskList: 'Список задач',
        latestEvents: 'Последние события',
        executionLog: 'Журнал выполнения'
      },
      checklist: {
        title: 'Итоги проверок'
      },
      detail: {
        stepsCompleted: 'Выполнено шагов: {completed}/{total}',
        summaryFailed: 'Получено результатов проверок: {total}, ошибок: {failed}',
        summaryPassed: 'Все проверки пройдены: {passed}',
        summaryReturned: 'Получено результатов проверок: {total}',
        summaryWarning: 'Получено результатов проверок: {total}, предупреждений: {warning}',
        waitingStart: 'Ожидание запуска задачи',
        waitingSteps: 'Ожидание шагов выполнения...'
      },
      empty: {
        activity: 'Журнал выполнения будет постепенно отображаться после завершения задачи.',
        events: 'Событий пока нет.',
        tasks: 'Задача еще не создана, ожидание шагов выполнения...'
      },
      event: {
        collapse: 'Свернуть события',
        defaultLabel: 'Событие',
        defaultTitle: 'Событие задачи',
        expand: 'Развернуть события',
        waitingDetail: 'Ожидание записей событий'
      },
      feed: {
        completed: 'Выполнение завершено',
        failed: 'Выполнение завершилось ошибкой',
        skipped: 'Пропущено',
        warning: 'Завершено с предупреждениями'
      },
      loading: {
        pollingFallback: 'Идет периодическое обновление...',
        refreshing: 'Обновление'
      },
      log: {
        collapse: 'Свернуть полный журнал',
        expand: 'Показать полный журнал'
      },
      metrics: {
        completed: 'Завершено',
        failed: 'Ошибки',
        passed: 'Пройдено',
        queued: 'В очереди',
        running: 'Выполняется',
        totalTasks: 'Всего задач',
        unknown: 'Неизвестно',
        warning: 'Предупреждения'
      },
      process: {
        dryRun: 'Проверка обновления',
        execution: 'Выполнение'
      },
      operation: {
        prepare: 'Проверить сертификат и состояние цели перед обновлением.',
        backup: 'Сохранить текущее состояние для безопасного восстановления.',
        update: 'Применить новый сертификат к целевому сервису.',
        reload: 'Загрузить новый сертификат и дождаться стабилизации сервиса.',
        verify: 'Убедиться, что сервис использует новый сертификат.',
        rollback: 'Восстановить сертификат и состояние сервиса до обновления.'
      },
      progress: {
        completed: 'Все завершено',
        failed: 'Завершено, есть ошибки',
        pending: 'Ожидание записи результата',
        processFailed: '{process} завершился ошибкой',
        queued: 'Ожидание планирования',
        running: 'Задача выполняется',
        warning: 'Завершено, есть предупреждения о рисках'
      },
      section: {
        completedCount: '{completed}/{total} завершено',
        executionLog: 'Журнал выполнения',
        latestEvents: 'Последние события',
        taskProgress: 'Прогресс задачи'
      },
      status: {
        completed: 'Завершено',
        failed: 'Ошибка',
        queued: 'Ожидание',
        running: 'Выполняется',
        skipped: 'Пропущено',
        warning: 'Есть предупреждения'
      },
      step: {
        backup: 'Предварительное резервное копирование',
        discover: 'Распознавание среды',
        prepare: 'Подготовка сертификата',
        installDryRun: 'Подготовка материалов',
        installExecution: 'Установка сертификата',
        updateDryRun: 'Проверка обновления',
        updateExecution: 'Обновление сертификата',
        reload: 'Обновление сервиса',
        verify: 'Проверка результата'
      },
      subtitle: {
        completed: 'Задача завершена.',
        failed: 'Задача завершена, но вернула ошибку.',
        failedFriendly: 'Этот шаг не удалось завершить. Откройте подробности, чтобы узнать причину.',
        failedChecks: 'Проверок: {total}, ошибок: {failed}',
        passedChecks: 'Проверок пройдено: {total}',
        queued: 'Задача создана и ожидает выполнения.',
        running: 'Задача запущена, ожидание результата.',
        runningChecks: 'Получено проверок: {total}',
        skipped: 'Этот шаг пропущен и больше не ожидает выполнения.',
        warningChecks: 'Проверок: {total}, предупреждений: {warning}'
      },
      time: {
        waitingStart: 'Ожидание запуска'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: 'Отмена',
        dryRun: 'Сначала Dry-run',
        next: 'Далее',
        previous: 'Назад',
        save: 'Сохранить план'
      },
      aria: {
        steps: 'Шаги развертывания',
        wizard: 'Мастер развертывания'
      },
      capability: {
        targetMissingDetail: 'Цель развертывания еще не выбрана.',
        targetSelectedDetail: 'Цель выбрана. Можно отправить напрямую; dry-run можно запустить вручную в сведениях об активе.',
        targetSelection: 'Выбор цели развертывания',
        targetSource: 'Цель развертывания'
      },
      checks: {
        failed: 'Ошибок {count}',
        passed: 'Пройдено {count}',
        unknown: 'Неизвестно {count}',
        unnamed: 'Безымянная проверка',
        warning: 'Предупреждений {count}'
      },
      empty: {
        noTargets: 'Нет доступных целей приложений',
        selectTarget: 'Выберите цель развертывания приложения.'
      },
      fallback: {
        generatedByApplicationEntry: 'Сформировано по входу приложения',
        missingBinding: 'Сведения о привязке не предоставлены',
        unboundCertificateVariable: 'Переменная сертификата не привязана',
        unconfigured: 'Не настроено',
        unconfiguredRunner: 'Место запуска не настроено',
        unknownEnd: 'Неизвестное окончание',
        unknownStart: 'Неизвестное начало',
        unnamedSite: 'Безымянный сайт',
        unnamedVersion: 'Безымянная версия',
        unrecognizedManagedTarget: 'Нераспознанная управляемая цель',
        unselected: 'Не выбрано',
        unselectedVersion: 'Версия не выбрана',
        unselectedWorkflow: 'Рабочий процесс не выбран'
      },
      fields: {
        applicationTarget: 'Цель развертывания приложения',
        artifactConfig: 'Конфигурация артефакта',
        binding: 'Привязка',
        certificateAsset: 'Сертификатный актив',
        certificateVariable: 'Переменная сертификата',
        certificateVersion: 'Версия сертификата',
        deploymentTarget: 'Цель развертывания',
        keyword: 'Поиск по ключевым словам',
        managedTarget: 'Управляемая цель',
        runner: 'Место запуска',
        site: 'Сайт',
        verifyUrl: 'URL проверки',
        version: 'Версия',
        workflow: 'Рабочий процесс'
      },
      panels: {
        certificateTitle: '1. Материалы сертификата',
        submitTitle: '3. Предпроверка и отправка',
        targetTitle: '2. Цель развертывания'
      },
      panelState: {
        needPrerequisites: 'Нужно завершить предварительный выбор',
        operable: 'Доступно',
        pending: 'Ожидает завершения',
        readyNext: 'Можно перейти дальше'
      },
      placeholders: {
        selectTarget: 'Выберите цель приложения',
        targetKeyword: 'Поиск по домену, сайту или сведениям о привязке'
      },
      plan: {
        dryRunCompleted: 'Последний dry-run завершен.',
        submitCompleted: 'Последняя отправка завершена.'
      },
      preview: {
        needCertificate: 'Сначала выберите материалы сертификата.',
        needTarget: 'После выбора материалов сертификата укажите цели приложения для доставки.',
        ready: 'Выбранная версия сертификата будет развернута на целях приложения: {count}.'
      },
      status: {
        checksReturned: 'Результаты предпроверки получены; по ним можно сохранить, отправить или выполнить план.',
        current: 'Текущий статус',
        default: 'Рекомендуется сначала выполнить dry-run, затем решать, отправлять ли выполнение.',
        dryRunStarted: 'Предпроверка запущена, ход выполнения смотрите в области результата.',
        submitted: 'План отправлен.'
      },
      steps: {
        certificate: {
          description: 'Сертификатный актив и версия',
          title: 'Выберите материалы сертификата'
        },
        submit: {
          description: 'Dry-run, сохранение, отправка, выполнение',
          title: 'Предпроверка и отправка'
        },
        target: {
          description: 'Актив приложения, сайт и привязка',
          title: 'Выберите цель развертывания'
        }
      },
      stepState: {
        active: 'В процессе',
        done: 'Завершено',
        pending: 'Ожидает начала'
      },
      target: {
        workflowMode: 'Режим рабочего процесса',
        workflowModeWithName: 'Режим рабочего процесса ({name})'
      },
      version: {
        autoLatest: 'Автоматически выбирать последнюю доступную для развертывания версию (текущая: {current})',
        noDeployableVersion: 'Сейчас нет версии сертификата, доступной для развертывания',
        range: '{id} ({notBefore} ~ {notAfter})'
      },
      currentStep: 'Шаг {current} / {total}',
      selectedTargetCount: 'Выбрано целей: {count}',
      subtitle: 'Пошаговая настройка плана развертывания',
      title: 'Мастер развертывания'
    }
  },
  tasks: {
      title: 'Глобальные задачи',
      quick: { active: 'Активные задачи', recent: 'Недавние завершения' },
      tabs: { all: 'Все задачи', execution: 'Задачи выполнения', monitoring: 'Задачи мониторинга', system: 'Системные задачи', other: 'Другие задачи' },
    aria: { openDrawer: 'Открыть глобальные задачи', tabs: 'Категории задач' },
    filters: {
      includeAll: 'Показывать все задачи',
      keyword: 'Поиск задачи, ошибки или ID',
      taskType: 'Тип задачи',
      status: 'Статус',
      allStatuses: 'Все статусы',
      resourceType: 'Тип ресурса',
      resourceId: 'ID ресурса',
      requestedBy: 'Инициатор',
      taskId: 'ID задачи',
      createdFrom: 'Начало',
      createdTo: 'Конец'
    },
    fields: { requestedBy: 'Инициатор', triggerSource: 'Источник', createdAt: 'Создано', startedAt: 'Начато', finishedAt: 'Завершено', error: 'Последняя ошибка' },
    sections: { timeline: 'Хронология статуса', attempts: 'Попытки', acmeHistory: 'Ход продления', logs: 'Исходные журналы', children: 'Дочерние задачи', errors: 'Ошибки', audit: 'События аудита', monitoringProbes: 'Записи проверок' },
    actions: { backToList: 'Вернуться к списку', viewAll: 'Посмотреть все задачи', viewRawLogs: 'Показать исходные журналы', search: 'Поиск', reset: 'Сбросить', previousPage: 'Предыдущая страница', nextPage: 'Следующая страница', forceCancel: 'Принудительно остановить', forceCancelConfirm: 'Принудительно остановить эту задачу? Для уже выполняющегося удалённого действия может потребоваться ручная проверка.', forceCancelReason: 'Принудительно остановлено оператором из глобальных задач' },
    messages: { loadFailed: 'Не удалось загрузить задачи.', detailFailed: 'Не удалось загрузить сведения о задаче.', forceCancelFailed: 'Не удалось принудительно остановить задачу.' },
    values: { system: 'Система', externalApi: 'Внешний API', empty: 'Нет записей', none: 'Нет' },
    agentUpdate: {
      title: 'Прогресс обновления Agent', timelineTitle: 'Ход обновления',
      fields: { target: 'Целевой хост', currentVersion: 'Текущая версия', targetVersion: 'Целевая версия', phase: 'Текущий этап', planId: 'План обновления', transactionId: 'Транзакция обновления' },
      values: { unknown: 'Неизвестно' },
      phases: { queued: 'В очереди', dispatching: 'Отправка авторизации', accepted: 'Agent принял запрос', upgrading: 'Обновление', status_checking: 'Проверка результата', succeeded: 'Завершено', failed: 'Не завершено', rolled_back: 'Откат выполнен', manual_required: 'Требуется ручное действие', unknown: 'Неизвестно' },
      summary: { queued: 'Задача обновления поставлена в очередь.', dispatching: 'Отправляется авторизация обновления.', accepted: 'Agent принял обновление и ожидает локального запуска.', upgrading: 'Agent загружает и заменяет новую версию.', waiting: 'Ожидание результата от Agent.', succeeded: 'Agent обновлён с {currentVersion} до {targetVersion}.', failed: 'Обновление Agent не завершено.' },
      events: { created: 'Задача создана', claimed: 'Задача назначена', started: 'Проверка статуса обновления начата', progress: 'Статус обновления изменён', waiting_result: 'Ожидание результата обновления', succeeded: 'Обновление успешно', failed: 'Ошибка обновления', retry_scheduled: 'Ожидание следующей проверки', cancelled: 'Задача отменена' },
    },
    pluginRefresh: {
      subtitle: 'Задача обслуживания каталога плагинов',
      overview: { kicker: 'Результат обновления', description: '{scope} обновлён, а последние ссылки на плагины синхронизированы с доступными узлами.' },
      metrics: { catalogVersions: 'Версии каталога', enabledVersions: 'Включённые версии', agentsProjected: 'Синхронизированные узлы', agentsFailed: 'Ошибки синхронизации' },
      sections: { timeline: 'История обработки', catalogVersions: 'Текущие версии плагинов', failures: 'Проблемы синхронизации' },
      actions: { showTechnicalDetails: 'Показать технические сведения' },
      fields: { taskId: 'ID задачи' },
      values: { unavailable: 'Нет данных', noVersions: 'Версии плагинов не возвращены', triggerSource: 'Обновление каталога плагинов' },
      summary: { succeeded: 'Обновление завершено: обновлено версий плагинов — {versions}, синхронизировано узлов — {projected}.', failed: 'Не удалось обновить каталог плагинов.', cancelled: 'Обновление каталога плагинов отменено.', retryWaiting: 'Позже будет выполнена автоматическая повторная попытка.', waitingResult: 'Ожидание результата обновления каталога.', awaitingConfirmation: 'Результат обновления требует подтверждения.', cancelling: 'Отмена обновления каталога.', queued: 'Обновление добавлено в очередь.', running: 'Каталог плагинов обновляется.' },
      events: { created: 'Задача создана и ожидает обработки.', claimed: 'Задача назначена фоновой обработке.', started: 'Начато чтение каталога плагинов.', progress: 'Подготовка версий и синхронизация узлов.', retryScheduled: 'Обработка не завершена, назначена автоматическая повторная попытка.', waitingResult: 'Ожидание результатов узлов.', awaitingConfirmation: 'Результат обновления ожидает подтверждения.', cancelRequested: 'Получен запрос на отмену.', expired: 'Время задачи истекло.', cancelled: 'Задача обновления отменена.', succeeded: 'Обновление завершено: версий — {versions}, узлов — {projected}.', failed: 'Ошибка обновления: {reason}' },
      versionStatus: { added: 'Добавлена', enabled: 'Включена', disabled: 'Отключена', other: 'Другой статус' }
    },
    approval: {
      title: 'Сведения о задаче согласования',
      description: 'Просмотрите содержание согласования, историю статуса и доступные действия.',
      contentTitle: 'Содержание согласования',
      fields: { operation: 'Операция', target: 'Цель', approvalId: 'ID согласования', requestedBy: 'Инициатор', riskLevel: 'Уровень риска', createdAt: 'Отправлено', decision: 'Решение', summary: 'Описание операции' },
      content: { deployment: 'Развертывание сертификата', automation: 'Автоматический запуск', defaultSummary: 'Эта задача ожидает решения по согласованию.' },
      values: { approved: 'Согласовано', rejected: 'Отклонено', pending: 'Ожидает согласования' },
      timelineTitle: 'Хронология статуса',
      timeline: { created: 'Согласование отправлено', createdDescription: 'Задача создана и ожидает обработки согласующим.', approved: 'Согласование выдано', approvedDescription: 'Согласующий разрешил продолжить операцию.', rejected: 'Согласование отклонено', rejectedDescription: 'Согласующий отклонил эту операцию.', forceEnded: 'Задача завершена принудительно', forceEndedDescription: 'Оператор принудительно завершил эту задачу.', pending: 'Согласование выполняется', pendingDescription: 'Система ожидает результата согласования.' }
    },
    relatedNames: { pluginCatalog: 'Каталог плагинов', deploymentPlan: 'План развёртывания', acmeRenewal: 'ACME Provider ({provider}) - продление сертификата {certificate}' },
    acmeHistory: {
      queued: { title: 'Ожидание продления', description: 'Система ожидает обработки этого продления сертификата.' },
      running: { title: 'Продление выполняется', description: 'Система запрашивает продление у центра сертификации.' },
      retryWaiting: { title: 'Ожидание автоматической попытки', description: 'Выпуск не завершён. Система повторит попытку позже.' },
      succeeded: { title: 'Продление успешно', description: 'Новый сертификат выпущен и сохранён.' },
      failed: { title: 'Ошибка продления', description: 'Системе не удалось продлить сертификат. Смотрите исходные журналы.' },
      cancelled: { title: 'Продление отменено', description: 'Это продление сертификата отменено.' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: 'Dry-run сертификата',
      CERTIFICATE_DEPLOY: 'Развёртывание сертификата',
      DEPLOYMENT_APPROVAL: 'Согласование развёртывания',
      CERTIFICATE_VERIFY: 'Проверка сертификата',
      CERTIFICATE_ROLLBACK: 'Откат сертификата',
      AGENT_INSTALL: 'Установка Agent',
      AGENT_UPDATE: 'Обновление Agent',
      PLUGIN_REFERENCE_REFRESH: 'Обновление ссылок плагинов',
      DEPLOYMENT_PLAN_REFRESH: 'Обновление плана развёртывания',
      MONITORING_BATCH: 'Пакет мониторинга',
      MONITORING_PROBE: 'Проверка мониторинга',
      CREDENTIAL_HEALTH_CHECK: 'Проверка действительности учетных данных',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CERTIFICATE_REVOCATION: 'Отзыв сертификата',
      CRL_PUBLISH: 'Публикация CRL',
      TRUST_DISTRIBUTION: 'Распределение доверия',
      GATEWAY_DELEGATION: 'Делегирование шлюза',
      WORKFLOW_RUN: 'Запуск workflow',
      AUTOMATION_RUN: 'Автоматический запуск',
      REPORT_EXPORT: 'Экспорт отчёта',
      NOTIFICATION_DELIVERY: 'Доставка уведомления',
      OTHER: 'Другая задача'
    },
    summaryTemplates: {
      QUEUED: '{task} поставлена в очередь',
      RUNNING: '{task} выполняется',
      RETRY_WAITING: 'Ожидается повтор для {task}',
      WAITING_RESULT: 'Ожидание результата {task}',
      AWAITING_CONFIRMATION: 'Результат {task} требует подтверждения',
      CANCELLING: 'Отмена {task}',
      SUCCEEDED: '{task} завершена',
      FAILED: '{task} завершилась ошибкой',
      CANCELLED: '{task} отменена'
    },
    status: { QUEUED: 'В очереди', RUNNING: 'Выполняется', RETRY_WAITING: 'Ожидание повтора', WAITING_RESULT: 'Ожидание результата', AWAITING_CONFIRMATION: 'Результат требует подтверждения', WAITING_APPROVAL: 'Ожидание согласования', CANCELLING: 'Отмена', SUCCEEDED: 'Успешно', FAILED: 'Ошибка', CANCELLED: 'Отменено' }
  },
  shell: {
    currentLocation: 'Текущее местоположение',
    breadcrumb: 'Навигационная цепочка',
    currentGroupNavigation: 'Навигация текущей группы',
    backDashboard: 'Вернуться на панель мониторинга',
    sidebarCollapse: 'Свернуть боковую панель',
    sidebarExpand: 'Развернуть боковую панель',
    authorizationWarning: 'Действующая лицензия продукта не обнаружена. Откройте страницу лицензирования продукта для настройки.',
    authorizationWarningAction: 'Открыть лицензирование',
    authorizationWarningClose: 'Закрыть предупреждение о лицензии'
  },
  globalSearch: {
    title: 'Глобальный поиск',
    description: 'Поиск сертификатов, активов устройств, системных настроек и плагинов.',
    inputLabel: 'Поиск глобальных ресурсов',
    inputPlaceholder: 'Введите имя, домен, отпечаток или путь',
    hint: 'Введите ключевое слово, чтобы начать поиск.',
    aria: {
      open: 'Открыть глобальный поиск'
    },
    categories: {
      certificates: 'Сертификаты',
      assets: 'Активы устройств',
      settings: 'Системные настройки',
      plugins: 'Плагины'
    },
    types: {
      serverCertificate: 'Серверный сертификат',
      intermediateCertificate: 'Промежуточный сертификат',
      rootCertificate: 'Корневой сертификат',
      application: 'Приложение',
      device: 'Устройство',
      cloudService: 'Облачный сервис',
      systemSetting: 'Системная настройка',
      plugin: 'Плагин'
    },
    empty: {
      title: 'Совпадений не найдено',
      description: 'Попробуйте другое имя, домен, отпечаток или путь.'
    },
    messages: {
      loadFailed: 'Не удалось загрузить глобальный поиск.'
    }
  },
  preferences: {
    theme: 'Тема',
    language: 'Язык',
    themeLight: 'Светлый режим',
    themeDark: 'Темный режим',
    themeToggle: 'Переключить тему',
    languageSelect: 'Выбрать язык интерфейса',
    title: 'Параметры отображения',
    description: 'Тема и язык сохраняются в серверных предпочтениях текущего пользователя.',
    errors: {
      loadFailed: 'Не удалось загрузить предпочтения',
      saveFailed: 'Не удалось сохранить предпочтения'
    }
  },
  systemInitialization: {
    intro: { ariaLabel: 'Вступительная анимация', progressAriaLabel: 'Прогресс загрузки', start: 'Начать работу', slogan: 'Для непрерывных сервисов безопасности' },
    preview: { title: 'Предпросмотр первой настройки' },
    title: 'Первая настройка', description: 'Создайте учетную запись администратора и выберите параметры интерфейса.', help: 'Пройдите шаги, чтобы завершить настройку.', stepsLabel: 'Шаги настройки',
    steps: { account: 'Учетная запись администратора', accountHelp: 'Задайте имя пользователя и пароль для входа.', license: 'Лицензия', licenseHelp: 'Импортируйте файл лицензии или сделайте это позже.', confirm: 'Проверка', confirmHelp: 'Проверьте только что введенные данные.', complete: 'Готово', completeHelp: 'Настройка завершена, можно войти.' },
    stage: { account: { title: 'Учетная запись администратора', help: 'С этой учетной записью вы входите в систему и управляете ею.' }, license: { title: 'Лицензия (необязательно)', help: 'Можно пропустить сейчас и добавить лицензию позже на странице «Лицензия».' }, confirm: { title: 'Проверка', help: 'Пароль здесь не показывается.' }, complete: { title: 'Настройка завершена', help: 'Теперь можно войти.' } },
    account: { username: 'Имя пользователя', usernamePlaceholder: 'Например admin', displayName: 'Отображаемое имя', displayNamePlaceholder: 'Например Системный администратор', password: 'Пароль', passwordPlaceholder: 'Не менее 8 символов', passwordConfirmation: 'Подтверждение пароля', passwordConfirmationPlaceholder: 'Введите пароль еще раз', locale: 'Язык интерфейса', theme: 'Тема' },
    license: { description: 'Сначала экспортируйте файл запроса и отправьте его поставщику, затем импортируйте полученный файл лицензии.', createRequest: 'Экспортировать файл запроса', copyRequest: 'Копировать запрос', requestCopied: 'Скопировано', importFile: 'Импортировать файл лицензии', activationResponse: 'Содержимое лицензии', activationResponsePlaceholder: 'Импортируйте файл лицензии или вставьте его содержимое', importResponse: 'Импортировать лицензию', configured: 'Лицензия активна.', skip: 'Настроить позже' },
    confirm: { username: 'Имя пользователя', locale: 'Язык интерфейса', theme: 'Тема', kekTitle: 'Храните GCAC_SECRET_KEK в безопасности', kekWarning: 'Это корневой ключ, которым система расшифровывает ваши данные. Храните его офлайн и никогда не записывайте в код, журналы или мессенджеры. Если ключ потерян, данные восстановить не удастся; если он утек, данные смогут прочитать посторонние.' },
    complete: { licenseConfigured: 'Лицензия активна, можно войти в систему.', licenseSkipped: 'Лицензия пока не добавлена. Ее можно добавить позже на странице «Лицензия».' },
    actions: { previous: 'Назад', continue: 'Продолжить', createAdmin: 'Создать учетную запись и продолжить', finish: 'Завершить настройку', login: 'Перейти ко входу' },
    errors: { passwordMismatch: 'Введенные пароли не совпадают.', missingSession: 'Учетная запись создана, но автоматический вход не выполнен. Войдите вручную.', createFailed: 'Не удалось создать учетную запись. Попробуйте снова.', licenseFailed: 'Не удалось обработать лицензию. Проверьте, верный ли файл.', activationRequestMissing: 'Содержимое запроса не получено. Экспортируйте его снова.', jsonObjectRequired: 'Формат файла неверный. Проверьте, что это полный файл лицензии.' }
  },
  userMenu: {
    currentUser: 'Текущий пользователь',
    changePassword: 'Изменить пароль',
    userGuide: 'Руководство пользователя',
    logout: 'Выйти'
  },
  password: {
    title: 'Изменить пароль',
    description: 'Изменение локального пароля текущего вошедшего пользователя.',
    current: 'Текущий пароль',
    new: 'Новый пароль',
    confirm: 'Подтвердите новый пароль',
    cancel: 'Отмена',
    submit: 'Сохранить пароль',
    submitting: 'Сохранение...',
    success: 'Пароль обновлен',
    failed: 'Не удалось изменить пароль',
    mismatch: 'Введенные новые пароли не совпадают',
    tooShort: 'Новый пароль должен быть не короче 8 символов'
  },
  viewMode: {
    switchLabel: 'Режим отображения приложения',
    user: 'Пользовательский вид',
    professional: 'Профессиональный вид',
    steps: {
      certificates: 'Сертификаты',
      applications: 'Приложения',
      deployments: 'Развертывания'
    }
  },
  nav: {
    dashboard: 'Панель управления',
    dashboardDesc: 'Обзор состояния приложений, сертификатов, Agent, шлюзов и аудита',
    certificates: 'Управление сертификатами',
    certificatesDesc: 'Хранилище сертификатов, привязки и срок действия',
    certificateAssets: 'Сертификатные активы',
    certificateInventoryShort: 'Реестр',
    certificateAssetsDesc: 'Сертификаты, ссылки на закрытые ключи, отпечатки и сроки действия',
    acmeAutomation: 'Автоматизация сертификатов ACME',
    acmeAutomationShort: 'Автоматизация ACME',
    acmeAutomationDesc: 'Выпуск, продление и отслеживание сертификатов ACME',
    caOperationsShort: 'Операции CA',
    certificateFormats: 'Конфигурации форматов сертификатов',
    certificateFormatsShort: 'Форматы доставки',
    certificateFormatsDesc: 'Правила форматов PFX, CER, CRT, PEM и других для сохраненных сертификатов',
    assetCenter: 'Asset inventory',
    assetCenterDesc: 'Manage application, device, and cloud service assets',
    assetManagement: 'Управление приложениями',
    assets: 'Приложения',
    assetsDesc: 'Входы приложений и цели развертывания сертификатов по домену/IP',
    applications: 'Приложения',
    applicationsDesc: 'Управление конечными точками бизнес-приложений, которым нужны защита и развертывание сертификатов',
    devices: 'Устройства',
    agents: 'Agent',
    agentsDesc: 'Онлайн-статус, heartbeat и набор возможностей',
    gateways: 'Шлюзы',
    gatewaysDesc: 'Шлюзы изолированных зон, протоколы и доступные цели',
    deployments: 'Развертывание сертификатов',
    deploymentsDesc: 'Планы развертывания, workflow, автоматизации и записи выполнения',
    deploymentPlans: 'Планы развертывания',
    deploymentPlansDesc: 'Планы развертывания сертификатов',
    executions: 'Записи выполнения',
    executionsDesc: 'Шаги выполнения, журналы, ошибки и откат',
    reports: 'Отчеты',
    reportsDesc: 'Окна инцидентов сертификатов, реагирование на риски и эффективность автоматизации',
    incidentWindowReport: 'Отчет об окне инцидента',
    incidentWindowReportDesc: 'Приоритизация истекающих и просроченных сертификатов',
    riskResponseReport: 'Отчет по реагированию на риски',
    riskResponseReportDesc: 'Подтверждение, время решения и SLA',
    automationEffectivenessReport: 'Отчет об эффективности автоматизации',
    automationEffectivenessReportDesc: 'Успешность запусков и целей, а также этапы ошибок',
    workflows: 'Рабочие процессы',
    workflowsDesc: 'Рабочие процессы и плагины',
    workflowTemplates: 'Рабочие процессы',
    workflowTemplatesDesc: 'Черновики canvas, переменные, декларации возможностей и публикация',
    automations: 'Автоматизация',
    automationsDesc: 'Плановые, ручные и пакетные планы обновления сертификатов',
    plugins: 'Центр плагинов',
    pluginsDesc: 'Provider, исполнители и состояние песочницы',
    monitoring: 'Мониторинг и аудит',
    monitoringDesc: 'Оповещения, аудит и состояние сертификатов',
    monitoringAnalysis: 'Анализ мониторинга',
    monitoringAnalysisDesc: 'Анализ целей мониторинга, результатов проверок и рисков сертификатов',
    monitorAlerts: 'Оповещения мониторинга',
    monitorAlertsDesc: 'События истечения, дрейфа и ошибок выполнения',
    monitorTls: 'Глубокий TLS-мониторинг',
    monitorTlsDesc: 'Цепочки доверия, наборы протоколов, симуляция совместимости и детали протокола',
    audits: 'Журналы аудита',
    auditsDesc: 'Доказательства операций и экспорт для соответствия',
    logAudit: 'Аудит журналов',
    logAuditDesc: 'Просмотр событий аудита и экспорт доказательств операций',
    settings: 'Системные настройки',
    settingsDesc: 'Тенанты, пользователи, права и системная конфигурация',
    settingsOverview: 'Настройки',
    systemSettings: 'Системные настройки',
    systemSettingsDesc: 'Системная конфигурация и метаданные безопасности',
    credentials: 'Учетные данные',
    notifications: 'Уведомления',
    licensing: 'Лицензирование',
    users: 'Управление пользователями',
    usersDesc: 'Пользователи консоли, статус и роли',
    roles: 'Управление правами',
    rolesDesc: 'Роли, области объектов авторизации и назначение участников',
    identitySources: 'Источники идентификации',
    identitySourcesDesc: 'Конфигурация служб AD/LDAP',
    groupRoleMappings: 'Сопоставления групп и ролей'
  },
  automations: {
    title: 'Автоматизация',
    description: 'Управление плановыми, ручными и пакетными запусками обновления сертификатов.',
    empty: 'Автоматизации отсутствуют.',
    emptyDescription: 'Нет описания',
    common: { notAvailable: 'Нет данных', allRelated: 'All related targets' },
    externalApi: { executionModeLabel: 'Режим внешнего запуска', executionModeAria: 'Режим внешнего запуска', keyTitle: 'Внешний API Key', keyDescription: 'Этот ключ постоянно отображается на странице автоматизации, и его можно копировать в любое время.', keyNotice: 'Передавайте его в заголовке X-Automation-API-Key.', keyStatusPending: 'Создаётся после сохранения и включения', keyStatusActive: 'Создан', keyStatusUnavailable: 'Создан (полный ключ не отображается на этой странице)', keyEditorDescription: 'Полный ключ постоянно отображается на текущей странице, и его можно копировать в любое время. После обновления старый ключ немедленно перестаёт действовать.', keyValueLabel: 'API Key', keyValueAria: 'Внешний API Key', keyUnavailableValue: 'Полный ключ не отображается на этой странице', keyUnavailable: 'На этой странице нет полного ключа. Нажмите «Обновить Key», чтобы создать новый.', rotate: 'Обновить Key', rotating: 'Обновление', rotateNotice: 'После обновления старый Key немедленно перестаёт действовать.', mode: 'Режим запуска: {mode}', copy: 'Копировать Key', copied: 'Скопировано', copyAria: 'Копировать API Key', copyCurlAria: 'Копировать команду CURL', rotateAria: 'Обновить API Key', apiManualButton: 'Руководство API', apiManualAutomationId: 'ID текущей автоматизации', apiManualAutomationIdUnavailable: 'Создаётся после сохранения', apiManualTitle: 'Руководство внешнего API', apiManualDescription: 'Используйте ID автоматизации и API Key для вызова интерфейсов. Домены сертификатов заранее заданы в автоматизации.', apiManualCertificateVersion: 'Для запуска и проверки совместимости требуется точный certificateVersionId.', apiManualRunTitle: 'Запустить автоматизацию', apiManualRunDescription: 'Передайте версию сертификата для одного запуска. Запуск помещается в текущую очередь выполнения.', apiManualRunCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/run' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -H Idempotency-Key:automation-run-$(date +%s) \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualPreviewTitle: 'Проверить совместимость приложений', apiManualPreviewDescription: 'Передайте версию сертификата, чтобы получить соответствующие приложения, возможность запуска и причины исключений.', apiManualPreviewCurl: "curl -X POST 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/preview' \\\n  -H 'X-Automation-API-Key: ak_xxx' \\\n  -H 'Content-Type: application/json' \\\n  -d '{'{'}\"certificateVersionId\":\"CERTIFICATE_VERSION_ID\"{'}'}'", apiManualVersionsTitle: 'Получить доступные версии сертификата', apiManualVersionsDescription: 'Возвращает выбираемые версии для доменов сертификатов, заданных в этой автоматизации.', apiManualVersionsCurl: "curl 'https://gcac.example.com/api/v1/automation-external/AUTOMATION_ID/certificate-versions' \\\n  -H 'X-Automation-API-Key: ak_xxx'" },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: 'Запуск через внешний API', once: 'Однократный запуск в заданное время', onceHelp: 'Выберите локальное время браузера. После выполнения задача не планируется повторно.', recurring: 'Периодический запуск', scheduleHelp: 'Используйте периодический график только при реальной необходимости постоянной проверки.', recurringHelp: 'Используйте периодический график только при реальной необходимости постоянной проверки.', recurringWarningTitle: 'Периодический запуск не рекомендуется для сертификатов', recurringWarning: 'Обычно замену следует запускать после выпуска сертификата или назначать один фиксированный запуск.', certificateVersionCreated: 'Certificate new-version event', runAt: 'Время запуска', frequency: 'Периодичность', daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', time: 'Время', weekday: 'День недели', monthDay: 'День месяца', legacyCustom: 'Сохранить существующий пользовательский график', legacyCron: 'Существующий Cron (только чтение)', weekdays: { 0: 'Воскресенье', 1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг', 5: 'Пятница', 6: 'Суббота' } },
    form: { existingAssetTitle: 'Обновлять только существующие активы приложений', existingAssetDescription: 'Автоматизация обрабатывает только активы с существующими привязками сертификатов. Первичная установка и добавление целей не выполняются.', certificateDomains: 'Домены сертификата', certificateDomainsPlaceholder: 'Введите домены через запятую', certificateDomainsHelp: 'Обновляются только существующие привязки активов для этих доменов.', versionSelection: 'Версия сертификата для развертывания', versionSelectionLatest: 'Автоматически использовать последнюю версию', versionSelectionSpecific: 'Использовать указанные версии', versionSelectionHelp: 'Версия определяется и фиксируется в начале запуска.', certificateVersionIds: 'Указанные версии сертификата', certificateVersionIdsPlaceholder: 'Введите ID версий через запятую', certificateVersionIdsHelp: 'Каждая версия должна принадлежать сертификату, выбранному по доменам.', versionLoading: 'Загрузка доступных версий сертификата.', versionLoadFailed: 'Не удалось загрузить версии. Повторите попытку позже.', versionEmpty: 'Для этих доменов нет доступных версий.', schedule: 'Когда обновлять', scheduleHelp: 'Запускайте по запросу или периодически по Cron и часовому поясу.', execution: 'Что происходит при запуске', executionHelp: 'Для каждой существующей привязки создается отдельный план с повторным использованием DeploymentPlan и ExecutionRun.', snapshot: 'Зафиксировать снимок домена, актива и версии сертификата' },
    fields: { name: 'Название', description: 'Описание', trigger: 'Триггер', eventSources: 'Event sources', targetScope: 'Update scope', selectedAssets: 'Selected managed applications', selectedAssetsHelp: 'Select at least one managed application.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Выражение Cron', timeZone: 'Часовой пояс', expiresWithinDays: 'Срок истечения в днях', environments: 'Целевые среды (через запятую)', certificateIds: 'Конкретные сертификаты (необязательно)', certificateIdsPlaceholder: 'Введите ID сертификатов через запятую', certificateIdsHelp: 'Если указано, обрабатываются только эти сертификаты; иначе применяются правила срока и среды.', expiresWithinDaysHelp: 'Выбирать только сертификаты, истекающие в этот период.', environmentsHelp: 'Обрабатывать сертификаты только из указанных сред.', planType: 'Тип плана развертывания', planTypeHelp: 'При запуске для каждой подходящей цели создается отдельный DeploymentPlan.', planTypeUpdate: 'Обновить существующую привязку сертификата', planTypeInstall: 'Установить сертификат на цель', planTypeVerifyOnly: 'Только проверить, без изменения сертификата', planMode: 'Режим запуска', planModeHelp: 'Автоматизация не связывается с существующим планом; для каждой цели создается новый план.', planModeCreateAndExecute: 'Создать и выполнить план', planModeCreateOnly: 'Только создать планы, без выполнения', maxTargets: 'Максимум целей за запуск', concurrency: 'Параллельность', failureCount: 'Порог количества ошибок', requireDryRun: 'Историческая настройка Dry run (не блокирует запуск)', startedAt: 'Время начала', finishedAt: 'Время завершения', failureStage: 'Этап ошибки', parentRun: 'Родительский запуск' },
    actions: { create: 'Создать автоматизацию', detail: 'Details', edit: 'Изменить', delete: 'Удалить', cancel: 'Отмена', save: 'Сохранить', copy: 'Копировать', enable: 'Включить', disable: 'Отключить', runNow: 'Run now', preview: 'Предпросмотр целей', history: 'История запусков', confirmRun: 'Подтвердить запуск', stop: 'Остановить запуск', retryFailed: 'Повторить ошибки', openPlan: 'Открыть план развертывания', openExecution: 'Открыть выполнение' },
    manualRun: { title: 'Ручной запуск', description: 'Выберите версию сертификата перед запуском.', versionLabel: 'Версия сертификата', versionPlaceholder: 'Выберите версию сертификата', help: 'Запуск разрешит связанные активы приложений по выбранной версии.', empty: 'Нет доступных версий сертификата для ручного запуска.', stopOnError: 'Останавливать при ошибке', dryRun: 'Выполнить необязательный предпросмотр dry-run', start: 'Запустить', downgradeNotice: 'Для {count} активов приложений срок действия целевого сертификата короче текущего. Выполнение продолжится после подтверждения.', downgradeConfirmTitle: 'Подтвердите сокращение срока действия', downgradeConfirmDescription: 'Это ручная операция. После подтверждения {count} активов приложений будут обновлены сертификатом с более коротким сроком действия.', downgradeConfirmAction: 'Подтвердить и запустить' },
    columns: { status: 'Status', trigger: 'Триггер', targets: 'Лимит целей', actions: 'Действия', nextRun: 'Следующий запуск', lastRun: 'Последний запуск' },
    triggers: { onDemand: 'По запросу', onDemandDescription: 'Запускается только действием запуска внутри платформы. Внешний API-ключ не создаётся.', schedule: 'По расписанию' },
    triggerTypes: { on_demand: 'По запросу', schedule: 'По расписанию', certificate_version_created: 'Certificate new-version event', retry: 'Повтор ошибок' },
    eventSources: { acme_issue: 'Автоматическое продление ACME', manual_import: 'Ручной импорт' },
    targetScopes: { allRelatedAssets: 'Update all related managed applications', allRelatedAssetsHelp: 'Resolve every bound and deployable managed application automatically after the event or filters match.', selectedAssets: 'Update selected managed applications only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for manually selected managed applications.' },
    assetPicker: { available: 'Available assets', selected: 'Selected assets', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No managed applications are available to add.', emptySelected: 'No managed applications selected yet.' },
    actionTypes: { create_deployment_plan: 'Создать план обновления сертификата', execute_deployment_plan: 'Выполнить план обновления сертификата', send_notification: 'Отправить уведомление' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: 'До {count} целей' },
    preview: { title: 'Предпросмотр влияния на активы', description: 'Каждая строка представляет одно управляемое приложение: в центре показано изменение срока действия от текущего сертификата к выбранному, справа указана возможность выполнения обновления.', explanation: 'Анализ показывает для каждого приложения текущий срок действия сертификата, целевой срок действия и результат выполнения.', applicationAsset: 'Актив приложения', certificate: 'Сертификат', applicationAssetId: 'ID актива приложения', bindingId: 'ID привязки', missingCurrentExplanation: '«Нет даты → целевая дата» означает, что платформа не смогла прочитать срок действия текущего привязанного сертификата; обновление этой цели не выполняется до исправления привязки или сведений о сертификате.', matched: 'Совпадений: {count}', executable: 'Можно выполнить: {count}', excluded: 'Исключено: {count}', affected: 'Затронуто: {count}', upgrade: 'Срок длиннее: {count}', same: 'Срок одинаковый: {count}', skip: 'Пропущено обновлений: {count}', downgrade: 'Требуют внимания: {count}', version: 'Версия {version}', versionUnknown: 'Версия неизвестна', ready: 'Готово', skipUpdate: 'Пропустить обновление', expiryLabel: 'Срок действия', impact: { upgrade: 'Срок действия длиннее', same: 'Срок действия одинаковый', downgrade: 'Риск сокращения срока действия', missing_current: 'Текущий сертификат отсутствует', unknown: 'Влияние неизвестно' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} managed applications involved', assetsResolvedAtRuntime: 'Target managed applications are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved assets', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: 'Нет доступа к цели', missing_version: 'Версия сертификата отсутствует', version_not_deployable: 'Версия сертификата недоступна для развертывания', binding_not_managed: 'Привязка не управляется', environment_not_allowed: 'Среда не разрешена', binding_missing: 'Привязка отсутствует', asset_missing_deployment_capability: 'Цель не может развернуть сертификаты', certificate_version_downgrade: 'Целевая версия старше текущей версии актива', certificate_already_up_to_date: 'Срок действия цели уже совпадает с текущим сертификатом, обновление пропущено', filter_not_matched: 'Условия фильтра не совпали', runtime_context_required: 'Требуется контекст выполнения', unknown: 'Неизвестная причина исключения' },
    failureStages: { selection: 'Выбор целей', plan_creation: 'Создание плана', dry_run: 'Dry run', approval: 'Согласование', execution: 'Выполнение', verification: 'Проверка', rollback: 'Откат', notification: 'Уведомление' },
    progress: { total: 'Всего', pending: 'Ожидание', running: 'Выполняется', waitingApproval: 'Ожидает согласования', succeeded: 'Успешно', failed: 'Ошибка', skipped: 'Пропущено', cancelled: 'Отменено' },
    editor: { createTitle: 'Создать автоматизацию', editTitle: 'Изменить автоматизацию', description: 'Настройте время запуска, сертификаты, создание планов и поведение при ошибке.', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot.', sections: { basic: 'Основная информация', basicHelp: 'Укажите понятное имя автоматизации и опишите изменения сертификатов.', trigger: 'Trigger', triggerHelp: 'Define what fact starts the automation before choosing execution and conditions.', targets: 'Обрабатываемые сертификаты', targetsHelp: 'Выбираются цели-сертификаты, а не существующие планы; снимок целей фиксируется при запуске.', execution: 'Execution', executionHelp: 'Decide how the automation updates assets first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters and concurrency guardrails together in this step.', plan: 'План развертывания сертификата', planRelationTitle: 'Существующий план развертывания не привязывается', planRelationDescription: 'План создается во время запуска по фильтрам сертификатов.', planRelationHelp: 'Для каждой цели создается собственный DeploymentPlan, его ID отображается в деталях запуска.', guardrails: 'Контроль безопасности', guardrailsHelp: 'Эти ограничения управляют размером пакета, проверкой и остановкой при ошибках.' }, chain: { createPlan: 'Создать DeploymentPlan для каждой цели', dryRun: 'Выполнить необязательный предпросмотр Dry run', executePlan: 'Выполнить DeploymentPlan цели' } },
    runs: { title: 'История автоматизаций', description: 'Просмотр состояния запуска, неизменяемых снимков целей и этапов ошибок.', progress: 'Успешно {succeeded}/{total}' },
    runDetail: { title: 'Детали запуска автоматизации', description: 'Версия конфигурации {version}', noFailure: 'Ошибок нет', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: 'Предпросмотр целей автоматизации', runs: 'Список запусков автоматизации', progress: 'Ход выполнения автоматизации' },
    errors: { loadFailed: 'Не удалось загрузить автоматизации', applicationAssetsLoadFailed: 'Failed to load managed applications. Try again later.' }
  },
  routes: {
    certificateImport: 'Импорт сертификата',
    certificateDetail: 'Детали сертификата',
    certificateUsages: 'Связи использования',
    certificateFormats: 'Форматные артефакты'
  },
  businessPage: {
    request: {
      notRequested: 'Запрос еще не отправлялся'
    },
    error: {
      unknown: 'Неизвестная ошибка'
    },
    primaryActionFailed: 'Основная операция не выполнена',
    processing: 'Обработка...',
    metricsAria: 'Бизнес-метрики',
    apiFailed: 'Сервисный запрос не выполнен',
    errorCode: 'Код ошибки: {code}',
    retry: 'Повторить',
    resourceList: 'Список {resource}',
    total: 'Всего {count}',
    toggleFilters: 'Фильтры',
    all: 'Все',
    clearFilters: 'Очистить фильтры',
    pagination: 'Страница {page} / по {pageSize} на странице',
    resourceDetailAria: 'Детали ресурса',
    resourceDetailTitle: 'Детали {resource}',
    contextAria: 'Контекстные входы',
    resourceActionsAria: 'Операции с ресурсом',
    resourceActionsTitle: 'Операции с ресурсом',
    resourceActionsHint: 'Операции высокого риска требуют повторного подтверждения; окончательное решение принимает системная проверка авторизации.'
  },
  executionDetail: {
    error: {
      loadStepsFailed: 'Не удалось запросить шаги выполнения',
      streamConnectFailed: 'Не удалось подключиться к обновлению деталей выполнения'
    },
    step: {
      nameFallback: 'Шаг {index}',
      labels: {
        discover: 'Обнаружить цель развертывания',
        backup: 'Создать резервную копию текущего сертификата',
        install: 'Установить новый сертификат',
        reload: 'Перезагрузить службу',
        verify: 'Проверить сертификат',
        rollback: 'Откатить сертификат'
      },
      dryRunCheckSummary: 'Итог предпроверки: пройдено {passed} / предупреждений {warning} / ошибок {failed} / неизвестно {unknown}. {topChecks}',
      dryRunPending: {
        queued: 'Задача все еще в очереди и еще не началась.',
        running: 'Текущий шаг выполняется, ожидание результатов предпроверки от Agent.',
        failed: 'Текущий шаг завершился ошибкой, результат предпроверки еще не получен.',
        finished: 'Текущий шаг завершен, результат предпроверки еще не получен.'
      },
      dryRunDiscover: 'Предпроверка только для чтения: распознаны цель развертывания и сведения сайта {providerLabel}. Сайт {siteName}, привязка {binding}. {pendingText}',
      dryRunVerify: 'Предпроверка только для чтения: проверены материалы сертификата, целевая привязка и соответствие домена. Цель {providerLabel}, привязка {binding}. {pendingText}',
      dryRunCreated: 'Предпроверка только для чтения создана. {pendingText}',
      workflowIdentity: 'Версия выполнения: плагин {plugin}; рабочий процесс {workflow}',
      failure: {
        emptyMessage: 'Конкретное сообщение об ошибке не получено',
        issue: 'Категория {category}, слот {slot}, путь {path}, источник {source}, исправление {remediation}'
      },
      skipped: 'Шаг пропущен: {reason}',
      running: {
        dispatched: 'Задача Agent отправлена ({taskId}); плоскость управления активно запрашивает результат.',
        waitingAgentResult: 'Шаг выполняется; плоскость управления активно запрашивает результат Agent…',
        waitingExternalResult: 'Шаг выполняется, ожидание внешнего результата выполнения...',
        resultUnconfirmed: 'Требуется подтвердить результат записи: {code}: {message}. Этот шаг не будет автоматически повторен.'
      },
      pending: {
        waitingDependency: 'Шаг ожидает завершения предыдущего шага.'
      },
      verifyRecovered: {
        detail: 'Удаленная TLS-проверка на стороне Agent завершилась ошибкой, но система выполнила реальную TLS-проверку {remoteTarget} и подтвердила соответствие целевого сертификата. {originalError}',
        originalSuffix: 'Исходная ошибка Agent: {originalError}'
      },
      unknownResult: 'Результат записи неизвестен; автоматический повтор приостановлен.',
      diagnosticsTitle: 'Подробный журнал проверки',
      structuredDetail: 'Показать структурированные сведения',
      resultReturned: {
        withTask: '{executor} {mode} вернул результат. Agent taskId={taskId}',
        withoutTask: '{executor} {mode} вернул результат.'
      },
      createdFallback: 'Шаг {index} создан, ожидание деталей выполнения...'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run завершился ошибкой',
        detail: 'Шагов предпроверки с ошибкой или таймаутом: {failedStepCount}; структурированные итоги предпроверки не получены.'
      },
      queued: {
        label: 'Dry-run в очереди',
        detail: 'Задача предпроверки создана и ожидает запуска.'
      },
      running: {
        label: 'Dry-run выполняется',
        detail: 'Предпроверка началась, ожидание результата.'
      },
      pending: {
        label: 'Dry-run завершен без заключения',
        detail: 'Завершено шагов без заключения: {finishedWithoutChecks}; итоги предпроверки не получены.'
      },
      receiving: {
        label: 'Dry-run принимает результаты',
        detail: 'Получены частичные заключения: пройдено {passed}, предупреждений {warning}, ошибок {failed}, неизвестно {unknown}.'
      },
      failed: {
        label: 'Dry-run не пройден',
        detail: 'Предпроверка: ошибок {failed}, предупреждений {warning}, пройдено {passed}.'
      },
      tlsGrantRequired: {
        label: 'Dry-run завершен, требуется авторизация хоста',
        detail: 'Структурные проверки и проверки безопасности завершены. Dry-run не выдает формальный ExecutionGrant, поэтому обход проверки TLS отклонен. При формальном выполнении хост выдаст краткосрочный ExecutionGrant.'
      },
      warning: {
        label: 'Dry-run содержит предупреждения о рисках',
        detail: 'Предпроверка завершена: пройдено {passed}, предупреждений {warning}, неизвестно {unknown}.'
      },
      passed: {
        label: 'Dry-run успешен',
        detail: 'Все предпроверки пройдены, всего {passed}.'
      }
    },
    agent: {
      taskSuffix: '(Agent taskId={taskId})'
    },
    log: {
      verifyRecovered: '[ControlPlane] Удаленная TLS-проверка на стороне Agent завершилась ошибкой, но система выполнила реальную TLS-проверку и подтвердила соответствие целевого сертификата.'
    },
    workflowStep: {
      failedDefault: 'Узел рабочего процесса {index} завершился ошибкой',
      skipped: 'Узел рабочего процесса пропущен: условие не выполнено.',
      successAssertions: 'Узел рабочего процесса выполнен успешно, утверждения пройдены {passed}/{total}.',
      success: 'Узел рабочего процесса выполнен успешно.'
    },
    binding: {
      hostMissing: 'Host Header не предоставлен'
    },
    site: {
      unnamed: 'Безымянный сайт'
    },
    provider: {
      target: 'Цель'
    },
    recovery: {
      confirm: 'Проверить состояние сертификата и продолжить',
      running: 'Проверка состояния сертификата…',
      confirmed: 'Состояние целевого сертификата подтверждено; выполнение продолжится.',
      failed: 'Проверка состояния сертификата не пройдена; выполнение остановлено.',
      pending: 'Состояние целевого сертификата пока не подтверждено. Повторите попытку позже.'
    }
  },
  executions: {
    title: 'Записи выполнения',
    description: 'Просмотр статуса выполнения развертывания, журналов шагов, итогов dry-run, причин ошибок и входов отката.',
    resourceName: 'Запись выполнения',
    errors: {
      streamConnectFailed: 'Не удалось подключиться к обновлению деталей выполнения: HTTP {status}',
      loadFailed: 'Не удалось загрузить записи выполнения'
    },
    actions: {
      refreshList: 'Обновить список',
      refreshing: 'Обновление',
      viewDetail: 'Детали',
      rollback: 'Запустить откат',
      rollbackRisk: 'Откат снова изменит конфигурацию сертификата целевого сервиса; нужно подтвердить ссылки на резервные копии и область влияния.'
    },
    messages: {
      recoveryConfirmed: 'Состояние целевого сертификата подтверждено; выполнение продолжится. Следите за прогрессом в общем списке задач.',
      recoveryFailed: 'Проверка состояния сертификата не пройдена. Подробная причина записана в журнале выполнения.',
      recoveryPending: 'Состояние целевого сертификата пока не подтверждено. Задача ожидает подтверждения; повторите попытку позже.'
    },
    columns: {
      name: 'Номер выполнения',
      status: 'Статус',
      risk: 'Риск',
      planId: 'План развертывания',
      startedAt: 'Время начала'
    },
    metrics: {
      total: {
        title: 'Всего выполнений',
        description: 'Текущие отслеживаемые записи выполнения.'
      },
      risky: {
        title: 'Высокий риск к обработке',
        description: 'Выполнения с ошибкой, частичным успехом или требованием отката.'
      }
    },
    fields: {
      executionId: 'ID выполнения',
      deploymentPlan: 'План развертывания',
      runType: 'Тип запуска',
      status: 'Статус выполнения',
      target: 'Цель выполнения',
      externalRunId: 'Внешний ID запуска',
      startedAt: 'Время начала',
      finishedAt: 'Время окончания',
      errorCode: 'Код ошибки',
      failureReason: 'Причина ошибки'
    },
    links: {
      deploymentPlan: 'Посмотреть план развертывания',
      auditEvents: 'Посмотреть события аудита'
    },
    empty: {
      title: 'Нет записей выполнения',
      description: 'После выполнения плана развертывания здесь появятся журналы, статус и связи аудита.'
    },
    list: {
      ariaLabel: 'Список выполнений', title: 'Записи выполнения', summary: 'Всего записей: {total}, новые сверху.', range: 'Показано {start}-{end} из {total}',
      assetsLabel: 'Ресурсы', logLabel: 'Сводка журнала', runNumber: 'Запуск {number}', planUnknown: 'План не связан', assetUnknown: 'Ресурс не указан', timeUnknown: 'Время начала не указано',
      logRunning: 'Выполнение продолжается.', logPending: 'Выполнение ожидает запуска.', logFailed: 'Ошибка выполнения, код {code}.', logSuccess: 'Выполнение успешно за {duration}.', logCompleted: 'Выполнение завершено.',
      errorCodeUnknown: 'не указан', durationUnknown: 'неизвестно', durationSeconds: '{count} сек.', durationMinutes: '{count} мин.', viewDetailHint: 'Открыть детали', openDetailAria: 'Открыть выполнение {id} плана {plan}', previousPage: 'Назад', nextPage: 'Вперед', pageSummary: 'Страница {page} из {pages}'
    },
    types: { dryRun: 'Проверка', apply: 'Выполнение', rollback: 'Откат', retry: 'Повтор', unknown: 'Другое' },
    summary: {
      passed: 'Пройдено',
      warning: 'Предупреждение',
      failed: 'Ошибка',
      unknown: 'Неизвестно'
    },
    detail: {
      title: 'Детали выполнения',
      titleWithId: 'Детали выполнения {id}',
      description: 'Просмотр основной информации записи выполнения, статуса шагов и журналов.',
      eyebrow: 'Запись выполнения',
      planLabel: 'План развертывания {plan}',
      loadingSteps: 'Загрузка шагов...',
      loadingLogs: 'Загрузка журналов...',
      noStepDetail: 'Описание шага отсутствует',
      notStarted: 'Не начато',
      noSteps: 'Шагов пока нет.',
      noLogs: 'Журналов пока нет.',
      unknownResultDescription: 'Исходная операция установки не будет повторена. Будет выполнена только проверка отпечатка TLS-сертификата в режиме чтения.'
    },
    tabs: {
      summary: 'Обзор',
      steps: 'Шаги',
      logs: 'Журналы'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: 'Адрес подключения', connectionPort: 'Порт подключения', basePath: 'Базовый путь', timeoutSeconds: 'Тайм-аут в секундах', gateway: 'Gateway выполнения',
      authenticationMode: 'Способ аутентификации', credential: 'Учетные данные управления устройством', username: 'Имя пользователя', passwordSecret: 'SecretRef пароля', apiTokenSecret: 'SecretRef API-токена', clientCertificate: 'Клиентский сертификат',
      tlsEnabled: 'Включить HTTPS', tlsVerifyPeer: 'Проверять сертификат сервера', tlsIgnoreCertificateErrors: 'Игнорировать ошибки сертификата', tlsServerName: 'Имя сервера TLS', caSecret: 'SecretRef центра сертификации', tlsMinimumVersion: 'Минимальная версия TLS',
      deviceDisplayName: 'Отображаемое имя устройства', deviceDescription: 'Описание устройства', deviceTags: 'Теги устройства', targetName: 'Имя цели', targetLabels: 'Метки цели'
    },
    forms: { loadOptions: 'Загрузить варианты', previewTitle: 'Форма настройки плагина', loading: 'Загрузка формы плагина...', loadFailed: 'Не удалось загрузить форму плагина', empty: 'Плагин не объявляет форму настройки.' },
    presentation: { previewTitle: 'Предпросмотр стандартного представления устройства', sensitiveValue: 'Секретное значение скрыто', tabsAriaLabel: 'Вкладки сведений об устройстве' },
    title: 'Плагины',
    description: 'Управление пакетами плагинов, исполнителями, декларациями прав и состоянием изоляции песочницы.',
    resourceName: 'Плагин',
    actions: {
      install: 'Установить плагин',
      detail: 'Детали',
      create: 'Создать',
      refresh: 'Обновить каталог',
      refreshing: 'Обновление...',
      createWorkflow: 'Создать процесс',
      creatingWorkflow: 'Создание...',
      enable: 'Включить',
      disabling: 'Отключение...',
      disable: 'Отключить',
      disableRisk: 'Отключение плагина повлияет на возможности Provider, шаблонов и исполнителей.'
    },
    market: { eyebrow: 'Каталог DSL-плагинов', title: 'Повторно используемые возможности автоматизации', description: 'Встроенные шаблоны поставляются с системой, пользовательские загружаются из data/workflows. Для каждого шаблона можно задать логотип, семантическую версию и теги.' },
    sources: { builtin: 'Встроенный', user: 'Пользовательский' },
    statuses: { valid: 'Доступен', invalid: 'Недействителен', available: 'Можно создать', enabled: 'Включен', disabled: 'Не включен', pendingApproval: 'Ожидает одобрения', inUse: 'Используется', notInUse: 'Не используется' },
    filters: { searchLabel: 'Поиск плагинов', searchPlaceholder: 'Поиск по имени, тегу, категории или пути', allSources: 'Все источники', allStatuses: 'Все статусы', statusLabel: 'Статус плагина' },
    card: { defaultDescription: 'Для этого DSL-плагина пока нет описания.', unversioned: 'Без версии', stepCount: 'Шагов выполнения: {count}', moreTags: 'Еще {count}' },
    columns: {
      name: 'Название плагина',
      status: 'Статус',
      risk: 'Риск',
      version: 'Версия',
      signature: 'Подпись'
    },
    metrics: {
      total: {
        title: 'Всего плагинов',
        description: 'Установленные и доступные к обновлению плагины.'
      },
      builtin: { title: 'Встроенные плагины' },
      user: { title: 'Пользовательские плагины' },
      enabled: { title: 'Включенные плагины' },
      using: { title: 'Используются' },
      risky: {
        title: 'Высокий риск к обработке',
        description: 'Плагины с опасными правами, ошибками подписи или изоляцией песочницы.'
      }
    },
    empty: {
      title: 'Плагинов пока нет',
      description: 'Перед установкой подтвердите права плагина, подпись и стратегию отката.'
    },
    detail: {
      title: 'Детали плагина',
      titleWithName: 'Плагин {name}',
      description: 'Просмотр деталей плагина, деклараций прав и сведений об изоляции песочницы.',
      versionLabel: 'Версия {version}'
    },
    types: { provider: 'Плагин облачного провайдера', standard: 'Стандартный плагин' },
    fields: {
      pluginId: 'ID плагина',
      pluginType: 'Тип плагина',
      provider: 'Облачный провайдер',
      name: 'Название плагина',
      currentStatus: 'Текущий статус',
      version: 'Версия',
      source: 'Источник', category: 'Категория', steps: 'Шаги выполнения', rollbackSteps: 'Шаги отката', updatedAt: 'Обновлено', filePath: 'Путь шаблона', logoUrl: 'URL логотипа', platforms: 'Целевые платформы', updateMethods: 'Способы обновления', maintainer: 'Сопровождающий', homepage: 'Страница проекта', usage: 'Статус использования', validationError: 'Ошибка проверки',
      signatureStatus: 'Статус подписи',
      riskLevel: 'Уровень риска', runtime: 'Среда выполнения', executionMode: 'Модель выполнения', scope: 'Область применения', support: 'Уровень поддержки', capabilities: 'Возможности', frameworks: 'Целевые фреймворки', products: 'Поддерживаемые продукты', operations: 'Поддерживаемые операции'
    },
    labels: { permissions: 'Заявленные разрешения', runnerStatus: 'Состояние Runner' },
    permissionKeys: {
      network_http: 'Сетевые запросы', secret_read: 'Чтение секретов', artifact_read: 'Чтение артефактов', device_write: 'Запись на устройства',
      agent_execution_receipt: 'Квитанции выполнения Agent', agent_fact_collect: 'Сбор фактов Agent', agent_plan_execute: 'Выполнение плана Agent', agent_plan_validate: 'Проверка плана Agent',
      audit_append: 'Добавление записей аудита', cloud_service_get: 'Чтение облачных сервисов', execution_cancel_read: 'Чтение состояния отмены выполнения', execution_checkpoint: 'Контрольные точки выполнения',
      execution_checkpoint_read: 'Чтение контрольных точек', execution_checkpoint_write: 'Запись контрольных точек', execution_progress: 'Ход выполнения', execution_progress_write: 'Запись хода выполнения',
      resource_lock: 'Блокировки ресурсов', secret_resolve: 'Разрешение секретов'
    },
    runnerStatuses: { ready: 'Runner готов', busy: 'Runner занят', unavailable: 'Runner недоступен', notObserved: 'Runner не наблюдался' },
    capabilityKeys: {
      device_connection_test: 'Проверка подключения', device_identity_detect: 'Определение устройства', device_discover: 'Обнаружение устройства', device_logs_read: 'Чтение журналов устройства',
      certificate_discover: 'Обнаружение сертификатов', certificate_deploy: 'Развертывание сертификата', certificate_rollback: 'Откат сертификата', certificate_verify: 'Проверка сертификата',
      application_discover: 'Обнаружение приложений', ca_account_manage: 'Управление учетной записью CA', ca_order_manage: 'Управление заказами CA', ca_challenge_orchestrate: 'Оркестрация проверок CA',
      ca_challenge_dns_solver: 'Решение DNS-проверок CA', ca_certificate_issue: 'Выпуск сертификата CA', ca_certificate_renew: 'Продление сертификата CA', ca_certificate_revoke: 'Отзыв сертификата CA',
      cloud_service_connection_test: 'Проверка подключения к облачному сервису', cloud_service_discover: 'Обнаружение облачных сервисов', credential_health_check: 'Проверка действительности учетных данных'
    },
    unknownCatalogValue: 'Неизвестное значение каталога: {value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: 'Пользовательская среда', runtime_custom: 'Пользовательская среда', adc_load_balancer: 'ADC-балансировщик', cloud_aliyun_cdn: 'Alibaba Cloud CDN', cloud_aliyun_alb: 'Alibaba Cloud ALB', cloud_aliyun_clb: 'Alibaba Cloud CLB', cloud_aliyun_oss: 'Alibaba Cloud OSS', cloud_aliyun_waf_cname: 'Alibaba Cloud WAF CNAME', cloud_aliyun_waf_cloud: 'Alibaba Cloud WAF Cloud', cloud_aliyun_live: 'Alibaba Cloud Live', cloud_aliyun_vod: 'Alibaba Cloud VOD', cloud_tencent_cdn: 'Tencent Cloud CDN', cloud_tencent_clb: 'Tencent Cloud CLB', cloud_tencent_live: 'Tencent Cloud Live', cloud_huawei_cdn: 'Huawei Cloud CDN', cloud_huawei_elb: 'Huawei Cloud ELB', cloud_volcengine_cdn: 'Volcengine CDN', cloud_volcengine_alb: 'Volcengine ALB', cloud_volcengine_clb: 'Volcengine CLB', cloud_volcengine_live: 'Volcengine Live', cloud_volcengine_vod: 'Volcengine VOD' },
    runtimeTypes: { agent_atomic: 'Атомарное выполнение Agent', workflow_dsl: 'Workflow DSL' },
    scopeTypes: { managed: 'Управляемая цель', standalone: 'Автономная цель', both: 'Управляемая / автономная' },
    supportTypes: { official: 'Официальная поддержка', community: 'Поддержка сообщества', self_managed: 'Самостоятельное сопровождение' },
    aria: { filters: 'Фильтры каталога плагинов', list: 'Список DSL-плагинов', logo: 'Логотип {name}' },
    errors: { loadFailed: 'Не удалось загрузить каталог плагинов', createFailed: 'Не удалось создать процесс из плагина' },
    agentDeployment: {
      mount: 'Подключить к Agent', mounting: 'Подключение...', selectAgent: 'Выберите целевой Agent', type: 'Тип плагина', targetAgent: 'Целевой Agent', mountFailed: 'Не удалось подключить плагин Agent',
      executionMode: 'Режим выполнения Agent', nativeHandler: 'Встроенный обработчик', pluginMode: 'Плагин Agent', mountedPlugin: 'Подключенный плагин', selectMountedPlugin: 'Выберите подключенный плагин',
      plugin: 'Плагин развертывания', selectPlugin: 'Выберите плагин развертывания', noCompatiblePlugin: 'Нет включенного плагина для текущей платформы и фреймворка', compatiblePluginHint: 'Показываются только включенные плагины, совместимые с платформой и фреймворком ресурса.',
      secretRefPlaceholder: 'Введите идентификатор SecretRef', artifactBinding: 'Артефакт сертификата {name}', artifactBindingPlaceholder: 'Пример: value=fullchain,key=private', preview: 'Проверить настройки', previewFailed: 'Не удалось проверить настройки плагина Agent',
      approveAndEnable: 'Одобрить и включить', activating: 'Включение...', activateFailed: 'Не удалось одобрить или включить плагин Agent', disableFailed: 'Не удалось отключить плагин Agent',
      types: { WORKFLOW_TEMPLATE: 'Шаблон workflow', UNIFIED_PLUGIN: 'Унифицированный плагин возможностей' }
    },
    changeSummaries: { createWorkflow: 'Создать процесс из шаблона каталога плагинов' }
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
    title: 'Планы развертывания',
    description: 'Предпросмотр плана, область влияния, партии выполнения, проверка и входы отката.',
    resourceName: 'План развертывания',
    apiActions: {
      submit: 'Отправить план развертывания',
      execute: 'Выполнить план развертывания',
      cancel: 'Отменить план развертывания',
      delete: 'Удалить план развертывания'
    },
    actions: {
      create: 'Создать план развертывания',
      detail: 'Детали',
      edit: 'Редактировать план',
      dryRun: 'Dry-run предпросмотр влияния',
      dryRunRisk: 'Формирует только предпросмотр влияния и не выполняет реальное развертывание.',
      submit: 'Отправить план',
      submitRisk: 'После отправки план перейдет в состояние ожидания выполнения.',
      execute: 'Выполнить развертывание',
      executeRisk: 'Выполнение изменит целевую конфигурацию сертификатов. Завершенные и ошибочные планы также используют этот вход для повторного запуска; выполнение синхронно проводит обязательные проверки, а необязательный Dry-run доступен в развертывании из карточки актива.',
      cancel: 'Отменить план',
      cancelRisk: 'Отменяет только незавершенные планы развертывания; уже завершенные развертывания не откатываются.',
      rollback: 'Откатить выполнение',
      rollbackRisk: 'Откат снова изменит конфигурацию сертификата целевого сервиса, требуется настоящий runId.',
      delete: 'Удалить план',
      deleteRisk: 'План, цели развертывания, записи выполнения и соответствующая история аудита будут удалены безвозвратно.'
    },
    columns: {
      name: 'Название плана',
      status: 'Статус',
      currentAssetCertificateExpiresAt: 'Окончание текущего сертификата',
      updateNeeded: 'Требует обновления',
      scheduledAt: 'Плановое время',
      actions: 'Операции'
    },
    metrics: {
      total: {
        title: 'Всего планов',
        description: 'Планы в ожидании выполнения или уже выполняющиеся.'
      },
      risky: {
        title: 'Высокий риск к обработке',
        description: 'Планы, влияющие на продуктивные сервисы или не имеющие возможности отката.'
      }
    },
    fields: {
      planId: 'ID плана',
      name: 'Название плана',
      status: 'Статус плана',
      certificateVersionId: 'ID версии сертификата',
      certificateFormatId: 'ID конфигурации формата сертификата',
      workflowDslVersion: 'Версия DSL рабочего процесса',
      currentAssetCertificateExpiresAt: 'Окончание текущего сертификата',
      updateNeeded: 'Требует обновления',
      targetSummary: 'Сводка целевых привязок',
      latestRun: 'Последняя партия выполнения',
      snapshotHash: 'Hash снимка',
      failureReason: 'Причина ошибки',
      createdAt: 'Время создания',
      updatedAt: 'Время обновления'
    },
    links: {
      executions: 'Посмотреть записи выполнения',
      bindings: 'Посмотреть связанные привязки'
    },
    empty: {
      title: 'Планов развертывания пока нет',
      description: 'Сначала перейдите из сертификата или привязки в мастер развертывания, сформируйте предпросмотр влияния и затем отправьте план.'
    },
    disabled: {
      needDryRun: 'Dry-run — необязательный предпросмотр влияния для проверки сертификата, домена и совместимости цели.',
      missingRunId: 'Нет runId, откат невозможен.',
      missingSelection: 'Не выбран план развертывания'
    },
    common: {
      cancel: 'Отмена',
      close: 'Закрыть',
      notConfigured: 'Не настроено',
      notProvided: 'Не предоставлено'
    },
    detail: {
      certificateVersionLabel: 'Версия сертификата',
      description: 'Просмотр базовой информации плана, связанных записей и результата последнего выполнения.',
      emptyRelatedRecords: 'Связанных записей нет.',
      loadingRelatedRecords: 'Загрузка связанных записей...',
      noExecutionRecords: 'У этого плана пока нет записей выполнения.',
      inputSourcesLoadFailed: 'Не удалось загрузить источники входных данных развертывания',
      inputSourcesTitle: 'Источники входных данных развертывания',
      inputSource: 'Источник: {source}',
      inputSourceTarget: 'Цель развертывания: {targetId}',
      noInputSources: 'Для этого плана нет доступных источников переменных.',
      noTargetSummary: 'Сводка целей не предоставлена',
      workflowIdentityTitle: 'Идентификатор выполнения рабочего процесса',
      workflowMode: 'Пользовательский рабочий процесс',
      workflowModePluginInternal: 'Встроенный рабочий процесс плагина',
      workflowDslVersion: 'Фактическая версия DSL: {version}',
      workflowPluginVersion: 'Фактическая версия плагина: {version}',
      workflowPluginVersionId: 'ID версии плагина: {versionId}',
      workflowVersionId: 'ID снимка версии: {versionId}',
      workflowVersionSelectionPinned: 'Стратегия версии: зафиксирована планом',
      workflowVersionSelectionLatest: 'Стратегия версии: последняя опубликованная из ресурса приложения',
      workflowIdentityUnavailable: 'Информация о версии рабочего процесса недоступна',
      planIdLine: 'ID плана {planId}',
      recordKinds: {
        certificateUpdate: 'Обновление сертификата',
        dryRun: 'Dry-run'
      },
      relatedPlan: 'План {planId}',
      relatedRun: 'Запуск {runId}',
      relatedSource: 'Источник {source}',
      tabs: {
        latestExecution: 'Последнее выполнение',
        relatedRecords: 'Связанные записи',
        summary: 'Обзор'
      },
      targetLabel: 'Цель',
      title: 'Детали плана развертывания',
      titleWithName: 'План развертывания {name}',
      viewLogs: 'Посмотреть журналы'
    },
    dryRunRequired: {
      copy: 'Текущая операция: {action}. Dry-run — необязательный предпросмотр и не блокирует реальное выполнение.',
      description: 'Запустите синхронный Dry-run для просмотра статических проверок; при выполнении обязательный preflight повторяется.',
      primaryAction: 'Выполнить Dry-run',
      runningAction: 'Выполняется Dry-run...',
      title: 'Необязательный предпросмотр Dry-run'
    },
    execution: {
      applyName: 'Выполнение развертывания {runId}',
      applyTitle: 'Выполнение обновления сертификата',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Результат Dry-run',
      fallbackName: 'Выполнение {runId}',
      rollbackTitle: 'Выполнение отката сертификата',
      startingName: 'Запуск выполнения'
    },
    feedback: {
      cancelled: 'План развертывания отменен.',
      cancelledWithPlanId: 'План развертывания отменен (план {planId}).',
      deleted: 'План развертывания удален.',
      deletedWithPlanId: 'План развертывания удален (план {planId}).',
      dryRunStartedMissingRunId: 'Предпроверка запущена.',
      dryRunStartedWithRunId: 'Предпроверка запущена ({runId}), ход выполнения смотрите в диалоговом окне.',
      dryRunTriggered: 'Предпроверка запущена.',
      dryRunTriggeredWithPlanId: 'Предпроверка запущена (план {planId}).',
      dryRunTriggeredWithRunId: 'Предпроверка запущена ({runId}), ход выполнения смотрите в диалоговом окне.',
      dryRunTaskStarted: 'Dry-run запущен. Ход выполнения доступен в списке задач справа вверху.',
      executeTriggered: 'Развертывание запущено.',
      executeTriggeredWithPlanId: 'Развертывание запущено (план {planId}).',
      executeTriggeredWithRunId: 'Развертывание запущено ({runId}), ход выполнения смотрите в диалоговом окне.',
      executionTaskStarted: 'Задача запущена. Ход выполнения доступен в списке задач справа вверху.',
      executionTaskSucceeded: 'Задача успешно завершена. Результат доступен в списке задач справа вверху.',
      executeTaskStarted: 'Развертывание сертификата запущено. Ход выполнения доступен в списке задач справа вверху.',
      rollbackTaskStarted: 'Откат сертификата запущен. Ход выполнения доступен в списке задач справа вверху.',
      loadedDraft: 'Черновик плана загружен.',
      loadedDraftWithPlanId: 'Черновик загружен (план {planId}).',
      savedWithPlanId: 'План сохранен ({planId}).',
      submitted: 'План развертывания отправлен.',
      submittedWithPlanId: 'План развертывания отправлен (план {planId}).',
    },
    target: {
      controlPlane: 'Платформа',
      noBindingInfo: 'Сведения о привязке не предоставлены',
      noCertificateVariables: 'Переменные сертификата не привязаны',
      noHostHeader: 'Host Header не предоставлен',
      noOutputSelected: 'Выходной элемент не выбран'
    },
    errors: {
      actionFailed: '{action} не выполнено',
      createReturnedMissingPlanId: 'План создан, но номер не получен; обновите список.',
      loadCreateDataFailed: 'Не удалось загрузить данные для создания плана развертывания',
      loadRelatedRecordsFailed: 'Не удалось загрузить связанные записи',
      missingApplicationAssetIdForDryRun: 'Не хватает актива приложения, невозможно запустить предпроверку.',
      missingApplicationAssetIdForSave: 'Не хватает актива приложения, невозможно сохранить план.',
      missingPlanId: 'Номер плана отсутствует, выберите заново.',
      missingPlanIdForAction: '{action} не выполнено: номер плана отсутствует, выберите заново.',
      missingRunIdRequest: 'Номер выполнения отсутствует, выберите заново.',
      saveFailed: 'Не удалось сохранить план развертывания',
      startDryRunFailed: 'Не удалось запустить dry-run',
      inputIssuesHint: 'Исправьте входные данные в указанном слоте и слое привязки, затем повторите попытку.'
    }
  },
  agents: {
    actions: {
      close: 'Закрыть',
      delete: 'Удалить',
      deleteRisk: 'Удаление напрямую удалит запись Agent; операция необратима.',
      detail: 'Детали',
      disable: 'Отключить',
      disableRisk: 'После отключения этот Agent перестанет получать новые задачи.',
      enable: 'Включить',
      enableRisk: 'После включения этот Agent снова станет доступен для планирования.'
    },
    app: {
      fallbackName: 'Приложение {index}'
    },
    certificate: {
      boundCertificate: 'Сертификат, привязанный к сайту',
      expiredDays: 'Истек {days} дн. назад',
      expiresToday: 'Истекает сегодня',
      modalDescription: 'Показывает ключевые сведения о сертификате, используемом текущей привязкой сайта.',
      modalTitle: 'Детали сертификата',
      overviewDescription: 'Показывает имя сертификата, издателя, время начала, время окончания, отпечаток и другие ключевые сведения.',
      overviewTitle: 'Обзор сертификата',
      projectDetailDescription: 'В контексте текущих деталей Agent показывает сведения о сертификатном активе проекта и связанные использования.',
      projectDetailTitle: 'Детали сертификата проекта',
      querying: 'Запрос...',
      remainingDays: 'Осталось {days} дн.',
      remainingWithViewAction: '{remaining} / нажмите, чтобы посмотреть сертификат',
      statusExpired: 'Истек',
      statusExpiring: 'Скоро истекает',
      statusLabel: 'Статус сертификата',
      statusUnknown: 'Срок действия неизвестен',
      statusValid: 'Действителен',
      view: 'Посмотреть сертификат',
      viewProjectDetail: 'Посмотреть детали сертификата проекта'
    },
    // 兼容旧版本证书卡片的翻译 key，避免已缓存 bundle 在升级后产生缺失告警。
    statusBlock: {
      tooltip: { name: 'Имя', issuer: 'Издатель', startTime: 'Начало', endTime: 'Окончание', daysRemaining: 'Осталось дней', connectionStatus: 'Состояние подключения', version: 'Версия', managementAddress: 'Адрес управления', lastCommunicationTime: 'Последняя связь', platform: 'Платформа', protocolPort: 'Протокол и порт', certificateDaysRemaining: 'Дней сертификата осталось', region: 'Регион', latency: 'Задержка' },
      detail: {
        certificateRemaining: '{name}, {days}'
      }
    },
    certificateUsage: {
      iisSite: 'Сайт IIS Agent',
      linuxSite: 'Сайт Linux Agent',
      tomcatConnector: 'Коннектор Tomcat Agent'
    },
    columns: {
      actions: 'Операции',
      hostname: 'Имя хоста',
      ipAddress: 'IP-адрес',
      lastHeartbeat: 'Последний heartbeat',
      onlineStatus: 'Онлайн-статус',
      osType: 'Тип системы',
      version: 'Версия'
    },
    common: {
      defaultAddress: 'Адрес по умолчанию',
      no: 'Нет',
      noHostHeader: 'Нет Host Header',
      noListenAddress: 'Нет адреса прослушивания',
      none: 'Нет',
      notConfigured: 'Не настроено',
      notProvided: 'Не предоставлено',
      notWritable: 'Нет прав записи',
      unrecognized: 'Не распознано',
      writable: 'Доступно для записи',
      yes: 'Да'
    },
    detail: {
      loading: 'Загрузка деталей...',
      manualRescan: 'Ручное повторное сканирование',
      manualRescanCannotPullTasks: 'Текущий Agent не может получать задачи, повторное сканирование невозможно',
      manualRescanCreated: 'Задача ручного повторного сканирования создана, ожидание выполнения Agent.',
      manualRescanSubmitting: 'Отправка повторного сканирования...',
      manualRescanUnsupportedType: 'Текущий тип Agent не поддерживает ручное повторное сканирование',
      modalDescription: 'Просмотр основных сведений Agent, среды выполнения и сведений о сайтах IIS.',
      modalTitle: 'Детали Agent',
      nodeEyebrow: 'Узел Agent',
      tabsAriaLabel: 'Вкладки деталей Agent'
    },
    empty: {
      description: 'Нажмите "Установить Agent" в правом верхнем углу, выберите платформу и версию, затем сформируйте одноразовую команду установки.',
      noFrameworkSites: 'Сайты {name} не обнаружены',
      noIisSites: 'Сайты IIS не обнаружены',
      noRuntimeLogs: 'Журналов выполнения пока нет',
      noTomcatApps: 'Приложения Tomcat не обнаружены',
      noTomcatConnectors: 'Коннекторы Tomcat не обнаружены',
      title: 'Agent пока нет'
    },
    errors: {
      certificateAssetIncomplete: 'Данные сертификатного актива неполные, перейти к деталям невозможно.',
      certificateAssetNotFound: 'Соответствующий сертификатный актив в проекте не найден.',
      certificateAssetQueryFailed: 'Не удалось запросить сертификатный актив.',
      detailDataMissing: 'Не удалось получить сведения.',
      generateInstallCommandFailed: 'Не удалось сформировать команду установки.',
      installCommandMissing: 'Система не вернула команду установки.',
      loadDetailFailed: 'Не удалось загрузить детали.',
      manualRescanFailed: 'Не удалось запустить ручное повторное сканирование.'
    },
    fields: {
      agentVersion: 'Версия Agent',
      appCount: 'Количество приложений',
      appList: 'Список приложений',
      appPool: 'Пул приложений',
      arch: 'Архитектура системы',
      binaryPath: 'Путь к бинарному файлу',
      certificateFile: 'Файл сертификата',
      certificateName: 'Имя сертификата',
      certificateStore: 'Хранилище сертификатов',
      certificateSubject: 'Субъект сертификата',
      certificateThumbprint: 'Отпечаток сертификата',
      configFile: 'Файл конфигурации',
      configPath: 'Путь конфигурации',
      connectorCount: 'Количество коннекторов',
      connectorList: 'Список коннекторов',
      domain: 'Домен',
      frameworkVersion: 'Версия {name}',
      healthStatus: 'Статус здоровья',
      healthSummary: 'Сводка отклонений',
      hostname: 'Имя хоста',
      httpsBinding: 'HTTPS-привязка',
      httpsListen: 'HTTPS-прослушивание',
      iisVersion: 'Версия IIS',
      installPrefix: 'Префикс установки',
      installStatus: 'Статус установки',
      ipAddress: 'IP-адрес',
      issuer: 'Издатель',
      lastCapabilityReportAt: 'Время последней отправки возможностей',
      lastHeartbeat: 'Последний heartbeat',
      lastRecoveryAt: 'Время последнего восстановления',
      lastReportAt: 'Время последнего отчета',
      linuxDistribution: 'Дистрибутив Linux',
      listenAddress: 'Адрес прослушивания',
      notAfter: 'Время окончания',
      notBefore: 'Время начала',
      offlineDetected: 'Определен как офлайн',
      osType: 'Тип системы',
      osVersion: 'Версия ОС',
      patchVersion: 'Версия патча',
      privateKeyOrKeystore: 'Закрытый ключ / Keystore',
      proxyTarget: 'Цель прокси',
      remainingDays: 'Оставшиеся дни',
      role: 'Роль',
      runningStatus: 'Статус выполнения',
      runtimeLog: 'Журнал выполнения',
      serviceName: 'Имя сервиса',
      sha256Fingerprint: 'Отпечаток SHA-256',
      siteCount: 'Количество сайтов',
      siteList: 'Список сайтов',
      tlsConnector: 'TLS-коннектор',
      tomcatVersion: 'Версия Tomcat',
      zone: 'Зона'
    },
    health: {
      degraded: 'Деградировано',
      failed: 'Ошибка',
      healthy: 'Здоров',
      unknown: 'Неизвестно'
    },
    install: {
      bootstrapToken: 'Код установки',
      command: 'Команда установки',
      commandStepTitle: 'Сформировать команду установки',
      commandCopied: 'Команда установки скопирована',
      copyCommand: 'Скопировать команду установки',
      copyToken: 'Скопировать код установки',
      expired: 'Истек',
      generateCommand: 'Сформировать команду установки',
      generating: 'Формирование...',
      compatibilityInstallUnavailable: 'Одноразовый установщик Windows Compatibility Agent еще не опубликован. Не используйте вместо него команду Windows Modern Agent.',
      installEntryPending: 'Установщик готовится',
      linuxGeneralTitle: 'Универсальный Linux Agent',
      linuxGroupTitle: 'Linux',
      modalDescription: 'Выберите платформу и версию, чтобы сформировать одноразовую команду установки. Код установки действует 10 минут и может быть использован только один раз.',
      modalTitle: 'Установка Agent',
      platform: 'Платформа',
      platformLinuxDescription: 'Подходит для Ubuntu, Debian, CentOS, Rocky, AlmaLinux и других дистрибутивов Linux.',
      platformWindowsDescription: 'Подходит для Windows Server и Windows 10/11; после установки регистрируется как системная служба.',
      remainingTime: '{minutes} мин {seconds} сек',
      remainingValidity: 'Оставшийся срок действия',
      selectedAgent: 'Выбранный Agent',
      selectionStepTitle: 'Выбор типа Agent',
      singleUseHint: 'Как только bootstrap-скрипт запросит этот код установки, он сразу станет недействительным и не сможет быть использован повторно.',
      tokenCopied: 'Код установки скопирован',
      version: 'Версия',
      versionLatest: 'Последняя стабильная версия',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 и новее',
      windowsModernTitle: 'Windows Modern Agent',
      zone: 'Зона'
    },
    labels: {
      certificatePath: 'Сертификат: {value}',
      deployDirectory: 'Каталог развертывания: {value}',
      directory: 'Каталог: {value}',
      keystorePath: 'Keystore: {value}',
      listenAddress: 'Адрес прослушивания: {value}',
      path: 'Путь: {value}',
      privateKeyPath: 'Закрытый ключ: {value}',
      reloadCommand: 'Команда Reload: {value}',
      siteName: 'Имя сайта: {value}',
      taskType: 'Тип задачи: {value}',
      testCommand: 'Тестовая команда: {value}',
      thumbprint: 'Отпечаток: {value}'
    },
    linux: {
      certDirectoryWritable: 'Каталог сертификатов: {status}',
      helperRequired: 'Требуется helper',
      keyDirectoryWritable: 'Каталог закрытых ключей: {status}',
      permissionMode: 'Режим прав: {mode}'
    },
    logs: {
      collapse: 'Свернуть',
      expand: 'Развернуть',
      listAriaLabel: 'Список журналов выполнения'
    },
    metrics: {
      abnormalDescription: 'Agent в офлайн-, ошибочном или дрейфующем состоянии требуют приоритетной обработки.',
      abnormalTitle: 'Проблемные Agent',
      totalDescription: 'Количество Agent, зарегистрированных в системе.',
      totalTitle: 'Всего Agent'
    },
    page: {
      description: 'Просмотр списка Agent, формирование команд установки для разных платформ и просмотр деталей в диалоговом окне.',
      installAgent: 'Установить Agent'
    },
    sections: {
      frameworkOverviewDescription: 'Состояние установки, выполнения и расположение конфигурации {name} на хосте.',
      frameworkOverviewTitle: 'Обзор {name}',
      frameworkSitesDescription: 'Сайты, корневые каталоги, домены, цели обратного прокси и пути сертификатов, распознанные {name}.',
      frameworkSitesTitle: 'Сайты {name}',
      healthDescription: 'Офлайн-определение Agent, время восстановления и сводка здоровья.',
      healthTitle: 'Здоровье и восстановление',
      iisOverviewDescription: 'Состояние установки IIS и сведения о версии на хосте.',
      iisOverviewTitle: 'Обзор IIS',
      iisSitesDescription: 'Список сайтов IIS, пути сайтов, порты привязок и имена субъектов сертификатов.',
      iisSitesTitle: 'Сайты IIS',
      logOverviewDescription: 'Время последней отправки возможностей для оценки актуальности сведений.',
      logOverviewTitle: 'Обзор журналов',
      mainInfoDescription: 'Идентификатор Agent, роль и статус heartbeat.',
      mainInfoTitle: 'Основная информация',
      runtimeDescription: 'Система выполнения и сведения о версии, отправленные Agent.',
      runtimeLogsDescription: 'Журналы ручного повторного сканирования, аномалий heartbeat и прерываний отправки возможностей.',
      runtimeLogsTitle: 'Журналы выполнения',
      runtimeTitle: 'Среда выполнения',
      tomcatAppsDescription: 'Пути приложений и каталоги развертывания, распознанные в Tomcat Host/Context.',
      tomcatAppsTitle: 'Приложения Tomcat',
      tomcatConnectorsDescription: 'Адреса прослушивания, протоколы, переключатель TLS и пути сертификатов Tomcat Connector.',
      tomcatConnectorsTitle: 'Коннекторы Tomcat',
      tomcatOverviewDescription: 'Состояние установки и выполнения Tomcat, а также путь Catalina на хосте.',
      tomcatOverviewTitle: 'Обзор Tomcat'
    },
    site: {
      domainCount: 'Доменов: {count}',
      fallbackName: 'Сайт {index}'
    },
    siteMode: {
      reverseProxy: 'Обратный прокси',
      staticRoot: 'Статический сайт'
    },
    status: {
      installed: 'Установлено',
      notInstalled: 'Не установлено',
      notRunning: 'Не запущено',
      running: 'Работает'
    },
    tabs: {
      logs: 'Журналы',
      overview: 'Обзор'
    }
  },
  dashboard: {
    overview: {
      eyebrow: 'Операционный обзор'
    },
    resources: {
      title: 'Системные ресурсы', description: 'Текущее использование CPU и памяти хоста панели мониторинга.', cpu: 'Использование CPU', memory: 'Использование памяти', host: 'Хост', abnormal: 'Внимание', usageAria: 'Использование {metric}: {value}%', unavailableAria: '{metric} недоступен'
    },
    quickStart: {
      title: 'Быстрый старт отсюда', description: 'Поможет быстро подготовить сертификат и развернуть его в вашем приложении.', addCertificate: 'Импортировать или запросить новый сертификат', deployExistingApplication: 'Развернуть на сайте или в приложении', unavailable: 'Нет доступного входа', safeExecution: 'Безопасное выполнение', guidedFlow: 'Пошаговый процесс'
    },
    trends: {
      title: 'Тренды выполнения', noDelta: '--', auditSuccess: { title: 'Успешность аудита', suffix: 'успешность' }, managedObjects: { title: 'Состояние объектов', suffix: 'объектов в норме' }, certificateAttention: { title: 'Внимание к сертификатам', suffix: 'на проверку' }
    },
    statusPanel: { description: 'Текущее видимое состояние сертификатов, Agent, шлюзов и активов приложений.', objects: 'объектов' },
    recentLog: { title: 'Последние журналы', live: 'Онлайн' },
    aria: {
      assetHeatmap: 'Тепловая карта состояния активов',
      certificateStatusList: 'Список статусов сертификатов',
      metrics: 'Ключевые метрики',
      quickActions: 'Основные функциональные входы',
      statusHeatmap: 'Состояние активов',
      statusLegend: 'Легенда статусов'
    },
    assets: {
      groupCount: '{summary} · {total} шт.',
      title: 'Состояние активов',
      updatedAt: 'Обновлено {time}'
    },
    audit: {
      description: 'В первую очередь показываются ошибки, отказы, высокие риски и ключевые бизнес-изменения.',
      title: 'Последние журналы аудита',
      activityTitle: 'Активность аудита'
    },
    certificateState: {
      critical: 'Близко к истечению',
      expired: 'Истек',
      expiring: 'Скоро истекает',
      unknown: 'Неизвестно',
      valid: 'Норма',
      updateAvailable: 'Доступно обновление'
    },
    days: {
      expired: 'Истек {days} дн. назад',
      expiresToday: 'Истекает сегодня',
      notRecorded: 'Не записано',
      remaining: '{days} дн.'
    },
    empty: {
      noAuditLogs: 'Журналов аудита пока нет',
      noCertificateStatus: 'Нет данных о статусе сертификатов',
      noObjects: 'Объектов пока нет',
      noTrend: 'Нет данных о тренде',
      noQuickActions: 'Нет доступных быстрых входов'
    },
    errors: {
      loadFailed: 'Не удалось загрузить обзорные данные',
      missingOverviewData: 'Не удалось получить обзорные сведения.'
    },
    legend: {
      disabled: 'Отключено',
      error: 'Ошибка',
      ok: 'Норма',
      unknown: 'Неизвестно',
      warning: 'Требует внимания'
    },
    loading: {
      description: 'Загрузка обзорной информации...',
      title: 'Загрузка'
    },
    metrics: {
      attention: 'Внимание',
      sparklineLabel: 'Тренд: {metric}',
      stable: 'Стабильно',
      tracked: 'Отслеживается',
      activeAgents: {
        title: 'Активные Agent',
        description: 'Agent, которые сейчас онлайн и доступны для планирования.'
      },
      activeGateways: {
        title: 'Активные шлюзы',
        description: 'Шлюзы изолированных зон, которые сейчас онлайн.'
      },
      applications: {
        title: 'Текущее число приложений',
        description: 'Управляемые активы входов приложений.'
      },
      expiringCertificates: {
        title: 'Сертификаты, истекающие за 15 дней',
        description: 'Сертификаты, которым нужно продление или замена.'
      },
      managedBindings: {
        title: 'Управляемые привязки',
        description: 'Привязки сертификатов, уже переведенные в управляемое состояние.'
      },
      validCertificates: {
        title: 'Активные сертификаты',
        description: 'Версии сертификатов, активные и еще не истекшие.'
      }
    },
    health: {
      title: 'Состояние системы',
      description: 'Сводка по сертификатам, Agent, шлюзам и активам приложений.',
      healthy: 'Норма',
      attention: 'Внимание',
      abnormal: 'Ошибка',
      noData: 'Нет данных',
      score: 'здоровых объектов',
      progressAria: 'Доля здоровых объектов системы',
      normalObjects: 'объектов в норме',
      attentionObjects: 'объектов для проверки'
    },
    quickWizard: {
      title: 'Быстрый доступ'
    },
    typeStats: {
      title: 'Распределение по типам',
      description: 'Текущие видимые объекты по типу.'
    },
    quickActions: {
      agents: {
        title: 'Активы',
        description: 'Просмотр активов, управляемых Agent, и состояния развертывания.'
      },
      assets: {
        title: 'Приложения',
        description: 'Сопровождение доменов, портов и целей развертывания.'
      },
      audits: {
        title: 'Журналы',
        description: 'Отследить оператора и результат выполнения.'
      },
      certificates: {
        title: 'Сертификаты',
        description: 'Импорт, просмотр и преобразование сертификатов.'
      },
      deploymentPlans: {
        title: 'Автоматизация',
        description: 'Создание и выполнение планов обновления сертификатов.'
      },
      gateways: {
        title: 'Шлюзы',
        description: 'Управление входами выполнения в изолированных зонах.'
      }
    },
    statusBlock: {
      tooltip: { name: 'Имя', issuer: 'Издатель', startTime: 'Начало', endTime: 'Окончание', daysRemaining: 'Осталось дней', connectionStatus: 'Состояние подключения', version: 'Версия', managementAddress: 'Адрес управления', lastCommunicationTime: 'Последняя связь', platform: 'Платформа', protocolPort: 'Протокол и порт', certificateDaysRemaining: 'Дней сертификата осталось', region: 'Регион', latency: 'Задержка' },
      detail: {
        certificateRemaining: '{name}, {days}'
      },
      status: {
        active: 'Активно',
        critical: 'Близко к истечению',
        deleted: 'Удалено',
        disabled: 'Отключено',
        expired: 'Истекло',
        expiring: 'Скоро истекает',
        inactive: 'Неактивно',
        offline: 'Не в сети',
        online: 'В сети',
        retired: 'Выведено',
        revoked: 'Отозвано',
        stale: 'Просрочено и не обновлено',
        unknown: 'Неизвестно',
        unreachable: 'Недоступно',
        upgrading: 'Обновляется',
        valid: 'Норма'
      }
    },
    statusGroups: {
      assets: {
        title: 'Активы'
      },
      agents: {
        title: 'Устройства'
      },
      applicationAssets: {
        title: 'Активы приложений'
      },
      certificates: {
        title: 'Сертификаты'
      },
      gateways: {
        title: 'Шлюзы'
      },
      summary: {
        allNormal: 'Все в норме',
        needsAttention: 'Требуют внимания: {count}'
      }
    },
    table: {
      bindings: 'Привязки',
      certificate: 'Сертификат',
      domain: 'Домен',
      notAfterMissing: 'Время истечения не записано',
      remainingTime: 'Оставшееся время',
      status: 'Статус'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: 'Добавить Gateway agent',
      close: 'Закрыть',
      copied: 'Скопировано',
      copyEnableCommand: 'Скопировать команду включения',
      copyInstallCommand: 'Скопировать команду установки',
      detail: 'Детали',
      enableExistingAgent: 'Включить Gateway на существующем Agent',
      generateEnableCommand: 'Сформировать команду включения',
      generateInstallCommand: 'Сформировать команду установки',
      generating: 'Формирование...',
      probe: 'Проверить',
      probeRisk: 'Из зоны этого Gateway будет запущена проверка доступности.'
    },
    columns: {
      actions: 'Операции',
      gateway: 'Шлюз',
      lastHeartbeat: 'Последний heartbeat',
      load: 'Нагрузка',
      region: 'Регион',
      status: 'Статус'
    },
    detail: {
      abilities: {
        agentTask: {
          description: 'Передает задачи развертывания, проверки и другие задачи Agent внутри региона.',
          title: 'Пересылка задач'
        },
        directControl: {
          description: 'Передает управляемые операции Agent внутри региона, чтобы системе не требовалось прямое подключение к внутренним портам.',
          title: 'Пересылка удаленного управления'
        },
        probe: {
          description: 'Проверяет из этого региона доступность хоста, сайта или Agent.',
          title: 'Проверка связности'
        },
        relay: {
          description: 'После узкой авторизации прозрачно передает только TCP-байты к разрешенной цели и порту.',
          title: 'Прямой TCP Relay'
        }
      },
      eyebrow: 'Региональный шлюз',
      heroDescription: 'Отвечает за проверки и пересылку в регионе {region}',
      overview: {
        availableCapacity: 'Доступная емкость',
        connectionStatus: 'Статус соединения',
        lastContact: 'Последний контакт',
        processing: 'Обработка',
        serviceRegion: 'Регион обслуживания',
        successRate: 'Доля успеха'
      },
      sections: {
        overview: 'Обзор выполнения',
        services: 'Доступные сервисы'
      }
    },
    empty: {
      description: 'Добавьте Gateway agent или включите роль Gateway на существующем Agent.',
      title: 'Шлюзов пока нет'
    },
    errors: {
      generateEnableCommandFailed: 'Не удалось сформировать команду включения Gateway.',
      generateInstallCommandFailed: 'Не удалось сформировать команду установки Gateway agent.',
      missingEnableCommand: 'Система не вернула команду включения Gateway.',
      missingInstallCommand: 'Система не вернула команду установки Gateway agent.',
      relayPolicyRequired: 'Укажите хотя бы одну цель и один порт Relay.'
    },
    fields: {
      config: 'Конфигурация',
      defaultRegion: 'default',
      enableCommand: 'Команда включения',
      expiresAt: 'Время истечения',
      installCode: 'Код установки',
      installCommand: 'Команда установки',
      platform: 'Платформа',
      region: 'Регион',
      relayPorts: 'Белый список портов Relay',
      relayPortsPlaceholder: 'Например: 443, 8443',
      relayTargets: 'Белый список целей Relay',
      relayTargetsPlaceholder: 'По одной в строке или через запятую, например app.internal.example, 10.20.0.0/16',
      service: 'Сервис',
      unboundAgent: 'Не привязывать конкретный Agent'
    },
    links: {
      assets: 'Посмотреть активы',
      executions: 'Посмотреть записи выполнения'
    },
    modals: {
      detail: {
        title: 'Детали шлюза'
      },
      enable: {
        title: 'Включить Gateway на существующем Agent'
      },
      install: {
        title: 'Добавить Gateway agent'
      }
    },
    page: {
      description: 'Управление Gateway agent региональной маршрутизации.',
      title: 'Шлюзы'
    },
    platforms: {
      linuxSystemd: {
        description: 'Установить сервис Gateway agent на Linux-хост'
      },
      windowsService: {
        description: 'Установить сервис Gateway agent на Windows-хост'
      }
    },
    resourceName: 'Шлюз',
    status: {
      disabled: 'Остановлен',
      offline: 'Не в сети',
      online: 'В сети',
      revoked: 'Отозван',
      upgrading: 'Обновляется'
    },
    values: {
      availableCapacity: 'Может принять задач: {count}',
      defaultRegion: 'Регион по умолчанию',
      regionGatewayName: 'Шлюз {region}',
      taskCount: 'Задач: {count}'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'Сервис читает Secret',
      secretResolve: 'Исполнитель читает Secret',
      secretCreate: 'Создать Secret',
      secretVersionCreate: 'Создать версию Secret',
      secretRotate: 'Ротировать Secret',
      certificateImport: 'Импортировать сертификат',
      certificateFormatUpdate: 'Обновить артефакт сертификата',
      certificateFormatDelete: 'Удалить артефакт сертификата',
      deploymentCreate: 'Создать план развертывания',
      deploymentExecute: 'Выполнить план развертывания',
      deploymentRollback: 'Запросить откат',
      approvalCreate: 'Создать согласование',
      approvalApprove: 'Утвердить согласование',
      approvalReject: 'Отклонить согласование',
      authLogin: 'Вход пользователя',
      authLogout: 'Выход пользователя'
    },
    events: {
      authLoginSuccess: 'Вход успешен',
      authLoginFailure: 'Вход не выполнен',
      authLoginFailed: 'Вход не выполнен',
      authLogout: 'Выход из системы',
      authExternalLoginSuccess: 'Вход через внешний источник идентификации успешен',
      authExternalLoginFailed: 'Вход через внешний источник идентификации не выполнен',
      secretCreated: 'Создан Secret',
      secretVersionCreated: 'Создана версия Secret',
      secretUsed: 'Secret прочитан',
      secretRotated: 'Secret ротирован',
      permissionDenied: 'Доступ запрещен',
      approvalCreated: 'Создано согласование',
      approvalApproved: 'Согласование утверждено',
      approvalRejected: 'Согласование отклонено',
      certificateImported: 'Изменение сертификата',
      deploymentCreated: 'Создано развертывание',
      deploymentExecuted: 'Развертывание выполнено',
      deploymentRollbackRequested: 'Запрошен откат развертывания',
      pluginInstalled: 'Плагин установлен',
      pluginPermissionDenied: 'Права плагина отклонены',
      workflowTemplateExecuted: 'Шаблон рабочего процесса выполнен'
    },
    types: {
      audit: 'Аудит',
      auth: 'Аутентификация',
      security: 'Безопасность',
      secret: 'Secret',
      certificate: 'Сертификат',
      certificateVersion: 'Сертификат',
      certificateVersionFormat: 'Артефакт сертификата',
      deployment: 'Развертывание',
      deploymentPlan: 'План развертывания',
      execution: 'Выполнение',
      approval: 'Согласование',
      permission: 'Права',
      plugin: 'Плагин',
      workflowTemplate: 'Рабочий процесс',
      gateway: 'Шлюз',
      agent: 'Agent',
      serviceAsset: 'Актив приложения',
      binding: 'Привязка'
    },
    actors: {
      user: 'Пользователь',
      admin: 'Администратор',
      system: 'Система',
      agent: 'Agent',
      plugin: 'Плагин',
      executor: 'Исполнитель'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Версия Secret',
      certificate: 'Сертификат',
      certificateVersion: 'Версия сертификата',
      certificateVersionFormat: 'Артефакт сертификата',
      deployment: 'Развертывание',
      deploymentPlan: 'План развертывания',
      execution: 'Задача выполнения',
      executionRun: 'Задача выполнения',
      approval: 'Заявка согласования',
      plugin: 'Плагин',
      workflowTemplate: 'Шаблон рабочего процесса',
      gateway: 'Шлюз',
      agent: 'Agent',
      serviceAsset: 'Актив приложения',
      binding: 'Привязка сертификата',
      auditLog: 'Журнал аудита'
    },
    results: {
      success: 'Успех',
      failure: 'Ошибка',
      denied: 'Отказ'
    },
    verbs: {
      success: 'завершил',
      failure: 'завершил с ошибкой',
      denied: 'отклонил'
    },
    tokens: {
      auth: 'аутентификация',
      login: 'вход',
      logout: 'выход',
      external: 'внешний',
      secret: 'Secret',
      resolve: 'чтение',
      service: 'сервис',
      used: 'использовано',
      created: 'создано',
      create: 'создать',
      updated: 'обновлено',
      update: 'обновить',
      deleted: 'удалено',
      delete: 'удалить',
      version: 'версия',
      certificate: 'сертификат',
      imported: 'импортировано',
      import: 'импорт',
      format: 'артефакт',
      deployment: 'развертывание',
      executed: 'выполнено',
      execute: 'выполнить',
      rollback: 'откат',
      requested: 'запрошено',
      approval: 'согласование',
      approved: 'утверждено',
      rejected: 'отклонено',
      permission: 'права',
      denied: 'отказано',
      gateway: 'шлюз',
      credential: 'учетные данные',
      issued: 'выдано',
      revoked: 'отозвано',
      task: 'задача',
      evidence: 'доказательство',
      recorded: 'записано',
      result: 'результат',
      plugin: 'плагин',
      workflow: 'рабочий процесс',
      template: 'шаблон',
      synced: 'синхронизировано',
      tested: 'проверено',
      source: 'источник',
      identity: 'источник идентификации',
      group: 'группа',
      mapping: 'сопоставление'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb} "{title}", объект: {resource}.',
    summaries: {
      deployment: '{actor}{verb} «{action}», план развертывания: {planName}, активы: {targetNames}.',
      permissionDenied: '{actor} отказано в операции «{action}» над {resource}, причина: {reason}.',
      taskCreated: '{actor} создал «{taskType}».',
      secretUsed: '{actor} прочитал {purpose}.',
      authExternalLoginSuccess: '{actor} вошел через источник идентификации {sourceType}.',
      authExternalLoginFailed: '{actor} не смог войти через источник идентификации {sourceType}.',
      authLoginSuccess: '{actor} успешно вошел.',
      authLoginFailed: '{actor} не смог войти: {reason}.',
      authPasswordChanged: '{actor} изменил пароль входа.',
      authLogout: '{actor} вышел из системы.',
      securityIdentitySourceSynced: '{actor} синхронизировал {resource}{counts}.',
      securityIdentitySourceTested: '{actor} успешно проверил соединение {resource}.',
      securityUserCreated: '{actor} создал пользователя «{username}».'
    },
    deploymentActions: { execute: 'выполнить развертывание', dryRun: 'выполнить пробный план', rollback: 'откатить развертывание' },
    taskTypes: { certificateDryRun: 'пробная задача развертывания сертификата', certificateDeploy: 'задача развертывания сертификата', applicationCertificateDeploy: 'задача развертывания выделенного сертификата приложения', certificateIssue: 'задача выдачи сертификата', acmeCertificateIssue: 'задача выдачи сертификата ACME', acmeRenewal: 'задача продления сертификата ACME', agentInstall: 'задача установки Agent', agentCapabilityRescan: 'задача повторного сканирования Agent', pluginReferenceRefresh: 'задача обновления каталога плагинов', automationRun: 'задача запуска автоматизации', automationTriggerDelivery: 'задача доставки триггера автоматизации', monitoring: 'задача мониторинга сертификатов', backgroundTask: 'фоновая задача' },
    secretPurposes: { httpHeader: 'учетные данные HTTP-заголовка', deploymentPrivateKey: 'закрытый ключ развертывания сертификата', deploymentPassword: 'пароль развертывания сертификата', exportPrivateKey: 'закрытый ключ экспорта сертификата', exportPassword: 'пароль экспорта сертификата', sshAuthentication: 'учетные данные SSH', providerOperation: 'учетные данные провайдера Secret', ldapBind: 'учетные данные привязки LDAP', httpFormPassword: 'пароль HTTP-формы', debugCheck: 'учетные данные проверки Secret', credential: 'учетные данные' },
    permissionActions: { taskRead: 'читать задачи', auditRead: 'читать журналы аудита', serviceAssetRead: 'читать управляемые приложения', certificateRead: 'читать сертификаты', certificateAssetRead: 'читать активы сертификатов', bindingRead: 'читать привязки сертификатов', pluginVersionRead: 'читать версии плагинов', caOperationsRead: 'читать операции CA', approvalDecide: 'принимать решения по согласованиям', providerRead: 'читать провайдеров', executionRead: 'читать выполнения', cloudAssetRead: 'читать активы облачных аккаунтов', managedTargetRead: 'читать управляемые цели', hostRead: 'читать хосты', resourceAccess: 'получить доступ к ресурсу' },
    permissionReasons: { noAllowPolicy: 'нет подходящей разрешающей политики', noObjectGrant: 'нет подходящего разрешения объекта', explicitDeny: 'явный запрет', explicitBusinessDeny: 'явный запрет бизнес-правилом', tenantScopeDenied: 'область арендатора не разрешает операцию', resourceScopeDenied: 'область ресурса не разрешает операцию', missing: 'не хватает прав доступа' },
    identitySources: { activeDirectory: 'Active Directory', ldap: 'LDAP', oidc: 'OIDC', saml: 'SAML', external: 'внешний' },
    authFailureReasons: { badCredentials: 'неверное имя пользователя или пароль', invalid: 'недействительные данные аутентификации' },
    identitySyncCounts: ', всего аккаунтов: {total}, создано: {created}, обновлено: {updated}, ошибок: {failed}',
    moreTargets: '{names} и всего активов: {count}',
    listSeparator: ', ',
    fallbacks: {
      unknown: 'Неизвестно',
      unnamedDeploymentPlan: 'план развертывания без имени',
      noTargetAssets: 'целевые активы не записаны'
    }
  },
  audit: {
    page: {
      title: 'Журналы аудита',
      description: 'Журналы организованы по действиям пользователей, ошибкам/отказам и ключевым бизнес-изменениям, с читаемыми сводками.'
    },
    actions: {
      exportEvidence: 'Экспортировать доказательства аудита',
      exporting: 'Экспорт...',
      refreshing: 'Обновление...'
    },
    errors: {
      exportFailed: 'Не удалось экспортировать доказательства аудита',
      loadFailed: 'Не удалось загрузить журналы аудита',
      withRequestId: '{message} ({requestId})'
    },
    metrics: {
      ariaLabel: 'Обзор аудита',
      total: {
        title: 'Всего записей аудита',
        description: 'Отслеживаемые записи операций в текущей области фильтрации.'
      },
      failed: {
        title: 'Ошибки / отказы',
        description: 'Ошибочные выполнения и отказы доступа, требующие приоритетной проверки.'
      },
      userActions: {
        title: 'Действия пользователей',
        description: 'Бизнес-изменения и действия доступа, напрямую инициированные пользователями.'
      }
    },
    list: {
      ariaLabel: 'Список журналов аудита',
      title: 'Список журналов',
      summary: 'Всего {total}, по умолчанию сортировка от новых к старым.',
      timeNotRecorded: 'Время не записано'
    },
    empty: {
      title: 'Событий аудита пока нет',
      description: 'Ключевые операции должны прослеживаться до соответствующих записей операций и задач.'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: 'Не удалось загрузить',
      submitFailed: 'Не удалось отправить'
    },
    actions: {
      createResource: 'Добавить {resource}',
      submitting: 'Отправка...'
    },
    modal: {
      createDescription: 'Заполните поля ниже, чтобы создать {resource}'
    },
    placeholders: {
      selectField: 'Выберите {field}'
    },
    table: {
      ariaLabel: 'Список управления',
      resourceList: 'Список {resource}',
      total: 'Всего {count}'
    }
  },
  settings: {
    ...(licensingLocaleMessages['ru-RU'] ?? {}),
    securityLabel: 'Вход в настройки системы',
    deploymentTasks: {
      eyebrow: 'Задачи развертывания',
      title: 'Параметры задач развертывания',
      description: 'Настройте, выполнять ли для арендатора Dry-run перед развертыванием сертификата.',
      readonly: 'У этой учетной записи доступ только для чтения.',
      fields: {
        dryRun: { title: 'Включить Dry-run', description: 'Выполнять предварительную проверку только для чтения перед развертыванием; результаты носят справочный характер и не блокируют выполнение.', aria: 'Включить Dry-run развертывания сертификата' }
      },
      actions: { save: 'Сохранить настройки', saving: 'Сохранение...' },
      messages: { saved: 'Параметры задач развертывания сохранены.' },
      errors: { loadFailed: 'Не удалось загрузить параметры задач развертывания.', saveFailed: 'Не удалось сохранить параметры задач развертывания.' }
    },
    version: {
      title: 'Информация о версии',
      description: 'Просмотр текущей запущенной версии GCAC.',
      currentVersion: 'Текущая версия',
      product: 'Продукт'
    },
    permissionPolicies: {
      resourceName: 'Политика прав',
      actions: {
        create: 'Создать политику'
      },
      columns: {
        id: 'ID политики',
        subjectType: 'Тип субъекта',
        subjectId: 'ID субъекта',
        effect: 'Эффект',
        actions: 'Действия',
        resourceTypes: 'Типы ресурсов',
        scope: 'Область'
      },
      fields: {
        subjectType: 'Тип субъекта',
        subjectId: 'ID субъекта',
        effect: 'Эффект',
        actions: 'Действия',
        resourceTypes: 'Типы ресурсов',
        tenantId: 'Область тенанта'
      },
      subjectTypes: {
        role: 'Роль',
        user: 'Пользователь',
        plugin: 'Плагин',
        executor: 'Исполнитель'
      },
      effects: {
        allow: 'Разрешить',
        deny: 'Запретить'
      }
    },
    groupRoleMappings: {
      resourceName: 'Сопоставление групп',
      actions: {
        create: 'Создать сопоставление'
      },
      columns: {
        sourceId: 'ID источника идентификации',
        externalGroup: 'Внешняя группа',
        roleId: 'Локальная роль',
        enabled: 'Включено',
        updatedAt: 'Время обновления'
      },
      fields: {
        sourceId: 'ID источника идентификации',
        externalGroup: 'Внешняя группа',
        externalGroupPlaceholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com',
        roleId: 'ID локальной роли'
      }
    },
    users: {
      title: 'Список учетных субъектов',
      summary: {
        groups: 'Всего {count}',
        users: 'Всего {total}, выбрано {selected}'
      },
      actions: {
        createUser: 'Создать пользователя',
        addGroup: 'Добавить группу',
        bulkDelete: 'Массовое удаление',
        edit: 'Редактировать',
        delete: 'Удалить',
        lookupLoading: 'Поиск...',
        lookupUser: 'Найти пользователя',
        lookupGroup: 'Найти группу',
        creating: 'Создание...',
        saving: 'Сохранение...',
        saveChanges: 'Сохранить изменения',
        adding: 'Добавление...'
      },
      risks: {
        bulkDelete: 'Массовое удаление удалит локальные учетные данные и связи ролей выбранных пользователей.',
        deleteUser: 'Удаление пользователя удалит локальные учетные данные и связи ролей этой учетной записи.'
      },
      tabs: {
        users: 'Пользователи',
        groups: 'Группы'
      },
      empty: {
        users: 'Пользователей пока нет',
        groups: 'Групп пользователей пока нет'
      },
      columns: {
        username: 'Имя пользователя',
        displayName: 'Отображаемое имя',
        email: 'Email',
        source: 'Источник',
        identitySourceName: 'Имя источника идентификации',
        status: 'Статус',
        tenant: 'Тенант',
        roles: 'Роли',
        lastSyncedAt: 'Последняя синхронизация',
        updatedAt: 'Время обновления',
        actions: 'Операции',
        groupName: 'Имя группы',
        code: 'Код',
        externalRef: 'Внешний идентификатор'
      },
      dialog: {
        userCreateTitle: 'Создать пользователя',
        userEditTitle: 'Редактировать пользователя',
        userCreateDescription: 'Создайте локального пользователя или найдите пользователя по имени в источнике идентификации и создайте связанную учетную запись.',
        userEditDescription: 'Редактирование отображаемого имени, email, статуса и ролей пользователя.',
        groupCreateTitle: 'Добавить группу',
        groupCreateDescription: 'Создайте локальную группу или найдите группу в источнике идентификации и добавьте внешнюю группу.'
      },
      aria: {
        principalType: 'Тип субъекта',
        createMode: 'Способ создания',
        externalUserProfile: 'Профиль пользователя источника идентификации',
        groupCreateMode: 'Способ создания группы',
        externalGroupProfile: 'Профиль группы источника идентификации'
      },
      modes: {
        localUser: 'Локальный пользователь',
        externalUser: 'Пользователь источника идентификации',
        localGroup: 'Локальная группа',
        externalGroup: 'Группа источника идентификации'
      },
      fields: {
        identitySource: 'Источник идентификации',
        directoryUsername: 'Имя пользователя каталога',
        username: 'Имя пользователя',
        displayName: 'Отображаемое имя',
        email: 'Email',
        role: 'Роль',
        initialPassword: 'Начальный пароль',
        status: 'Статус',
        directoryGroupName: 'Имя группы каталога',
        groupName: 'Имя группы',
        groupCode: 'Код группы',
        directoryDn: 'DN каталога'
      },
      placeholders: {
        selectIdentitySource: 'Выберите источник идентификации',
        directoryUsername: 'Например, jackson',
        displayName: 'Оператор сертификатов',
        initialPassword: 'Введите начальный пароль',
        directoryGroupName: 'Например, GCAC-Ops',
        groupName: 'Группа эксплуатации сертификатов'
      },
      options: {
        unset: 'Не задавать'
      },
      status: {
        active: 'Включен',
        disabled: 'Отключен'
      },
      labels: {
        identitySourceOption: '{name} ({type})'
      },
      errors: {
        loadUsersFailed: 'Не удалось загрузить пользователей',
        loadGroupsFailed: 'Не удалось загрузить группы пользователей',
        createUserFailed: 'Не удалось создать пользователя',
        updateUserFailed: 'Не удалось обновить пользователя',
        externalUserEmpty: 'Источник идентификации не вернул профиль пользователя',
        lookupExternalUserFailed: 'Не удалось найти пользователя в источнике идентификации',
        externalGroupEmpty: 'Источник идентификации не вернул профиль группы',
        lookupExternalGroupFailed: 'Не удалось найти группу в источнике идентификации',
        createGroupFailed: 'Не удалось создать группу пользователей',
        deleteUsersFailed: 'Не удалось удалить пользователей'
      }
    },
    roles: {
      page: {
        title: 'Управление правами',
        description: 'Поддержка областей объектов авторизации вокруг ролей и назначение пользователей или групп на роли.'
      },
      actions: {
        createRole: 'Создать роль',
        refreshObjects: 'Обновить объекты',
        loading: 'Загрузка...',
        creating: 'Создание...',
        saving: 'Сохранение...',
        detail: 'Детали',
        authorize: 'Авторизовать',
        grantPermission: 'Выдать права',
        assignMembers: 'Назначить участников',
        delete: 'Удалить',
        deleteRole: 'Удалить роль',
        deleting: 'Удаление...',
        clearSelection: 'Очистить выбор', revokePermission: 'Отозвать разрешение', revoking: 'Отзыв...'
      },
      columns: {
        roleId: 'ID роли',
        code: 'Код',
        name: 'Имя',
        builtin: 'Встроенная',
        policyCount: 'Число политик',
        permissions: 'Точки прав',
        actions: 'Операции',
        objectScope: 'Область объектов',
        accessLevel: 'Уровень доступа',
        businessLevel: 'Уровень бизнес-прав',
        effect: 'Эффект',
        memberType: 'Тип участника',
        member: 'Участник'
      },
      table: {
        emptyRoles: 'Ролей пока нет',
        roleRecords: 'Записи ролей',
        emptyGrants: 'У текущей роли пока нет объектных прав',
        currentPermissions: 'Текущие права роли',
        emptyMembers: 'У текущей роли пока нет назначенных участников',
        assignedMembers: 'Назначенные участники'
      },
      categories: {
        certificate: 'Сертификат',
        application: 'Приложение',
        gateway: 'Шлюз',
        agent: 'Agent',
        serviceAsset: 'Актив приложения',
        deploymentPlan: 'План обновления',
        workflow: 'Рабочий процесс',
        auditLog: 'Журнал',
        systemSetting: 'Системные настройки'
      },
      accessLevel: {
        read: 'Только чтение',
        edit: 'Редактирование',
        control: 'Полный контроль'
      },
      levels: {
        user: 'Пользователь',
        manager: 'Менеджер'
      },
      presets: { label: 'Предустановленный шаблон авторизации', custom: 'Пользовательская бизнес-авторизация', certificateViewer: 'Просмотр сертификатов', certificateManager: 'Управление сертификатами', applicationViewer: 'Просмотр приложений', applicationManager: 'Управление приложениями' },
      effect: {
        allow: 'Разрешить',
        deny: 'Запретить'
      },
      principal: {
        user: 'Пользователь',
        group: 'Группа',
        externalGroup: 'Группа источника идентификации'
      },
      summary: {
        selectedMembers: 'Выбрано участников: {count}',
        chooseMembers: 'Выберите пользователей или группы',
        selectedScopes: 'Выбрано областей: {count}',
        chooseObjectNode: 'Выберите узел дерева объектов',
        selectedScopeLabel: 'Выбранные области',
        selectedMemberLabel: 'Выбранные участники'
      },
      tree: {
        rootLabel: 'Все объекты',
        rootDescription: 'Все бизнес-объекты, доступные для авторизации',
        typeDescription: 'Все записи категории {category}',
        allBusinessObjects: 'Все бизнес-объекты',
        selectedScopeAria: 'Выбранная область авторизации',
        objectTreeAria: 'Дерево авторизуемых объектов',
        authorizableObjects: 'Авторизуемые объекты',
        loading: 'Загрузка дерева объектов...',
        kind: {
          all: 'Все',
          category: 'Категория',
          record: 'Запись'
        }
      },
      format: {
        labelWithId: '{label} ({id})',
        recordFallback: '{category} {value}',
        unnamedRecord: 'Безымянная запись'
      },
      detail: {
        title: 'Детали роли',
        titleWithName: 'Роль {name}',
        description: 'Здесь поддерживаются области объектов, конкретные объекты, уровни доступа и назначения участников.'
      },
      create: {
        title: 'Создать роль',
        description: 'Заполните обязанности роли и при необходимости сразу выдайте ей область объектов.',
        nameLabel: 'Имя роли',
        namePlaceholder: 'Оператор сертификатов',
        descriptionLabel: 'Описание',
        descriptionPlaceholder: 'Отвечает за ежедневные операции с сертификатами',
        authorizedRole: 'Авторизуемая роль',
        newRole: 'Новая роль'
      },
      grant: {
        title: 'Выдать права роли',
        description: 'Выберите область из дерева объектов и задайте уровень доступа для этой области.',
        roleLabel: 'Роль'
      },
      member: {
        title: 'Назначить участников',
        titleWithName: 'Назначить участников: {name}',
        description: 'Выберите пользователей или группы; система назначит их на уже авторизованные области объектов этой роли.',
        targetRole: 'Целевая роль',
        authorizedScope: 'Область авторизации',
        objectScopeCount: 'Областей объектов: {count}',
        selectedMembersAria: 'Выбранные участники',
        assignableMembersAria: 'Доступные для назначения участники',
        emptyAssignable: 'Нет доступных для назначения {type}'
      },
      errors: {
        loadObjectTreeFailed: 'Не удалось загрузить дерево объектов',
        loadDataFailed: 'Не удалось загрузить данные управления правами',
        invalidBusinessScope: 'Соответствующая область бизнес-разрешений не найдена.',
        missingRoleId: 'Не получен ID роли',
        createRoleFailed: 'Не удалось создать роль',
        grantRoleFailed: 'Не удалось выдать права роли',
        roleNoObjectScopes: 'У этой роли пока нет авторизованных областей объектов; сначала выдайте права роли.',
        assignMembersFailed: 'Не удалось назначить участников',
        deleteRoleFailed: 'Не удалось удалить роль',
        missingObjectSetId: 'Не получен ID области объектов', presetScopeMismatch: 'Шаблон не соответствует выбранной области объектов', revokePermissionFailed: 'Не удалось отозвать разрешение'
      },
      confirm: {
        deleteRole: 'Подтвердить удаление роли "{name}"? После удаления будут также удалены назначения пользователей и объектные авторизации этой роли.', revokePermission: 'Отозвать это бизнес-разрешение? Совместимое разрешение объекта также будет удалено.'
      },
      auditLogs: {
        auth: {
          name: 'Журналы входа аутентификации',
          description: 'Вход, выход и вход через внешний источник идентификации'
        },
        security: {
          name: 'Журналы управления безопасностью',
          description: 'Изменения пользователей, ролей, прав и источников идентификации'
        },
        certificate: {
          name: 'Журналы сертификатов',
          description: 'Импорт сертификатов, версии, артефакты и операции привязки'
        },
        asset: {
          name: 'Журналы активов',
          description: 'Операции с активами приложений, хостами, экземплярами сервисов и сайтами'
        },
        gateway: {
          name: 'Журналы шлюзов',
          description: 'Маршрутизация шлюзов, проверки и изменения статуса'
        },
        agent: {
          name: 'Журналы Agent',
          description: 'Регистрация Agent, heartbeat, задачи и операции обновления'
        },
        deployment: {
          name: 'Журналы планов обновления',
          description: 'Планы развертывания, выполнение и откат'
        },
        workflow: {
          name: 'Журналы рабочих процессов',
          description: 'Операции шаблонов рабочих процессов и выполнения'
        },
        secret: {
          name: 'Журналы секретов',
          description: 'Создание, использование и ротация Secret'
        },
        system: {
          name: 'Системные журналы',
          description: 'Системные настройки и события уровня платформы'
        }
      }
    },
    identitySources: {
      actions: {
        create: 'Создать источник идентификации',
        edit: 'Редактировать',
        delete: 'Удалить',
        testConnection: 'Проверить подключение',
        testing: 'Проверка...',
        creating: 'Создание...',
        saving: 'Сохранение...',
        saveChanges: 'Сохранить изменения',
        expandAdvanced: 'Развернуть расширенные настройки',
        collapseAdvanced: 'Свернуть расширенные настройки'
      },
      columns: {
        name: 'Имя',
        type: 'Тип каталога',
        server: 'Сервер',
        status: 'Статус',
        actions: 'Операции'
      },
      table: {
        title: 'Список источников идентификации',
        total: 'Всего {count}'
      },
      empty: 'Источников идентификации пока нет',
      dialog: {
        createTitle: 'Создать источник идентификации',
        editTitle: 'Редактировать источник идентификации',
        createDescription: 'Сначала заполните базовые сведения подключения; фильтры и тип каталога находятся в расширенных настройках.',
        editDescription: 'Измените конфигурацию источника идентификации; чтобы обновить пароль сервисной учетной записи, введите пароль заново.'
      },
      fields: {
        name: 'Имя',
        domain: 'Домен',
        protocol: 'Протокол',
        serverAddress: 'Адрес сервера',
        baseDn: 'Base DN',
        bindDn: 'DN сервисной учетной записи',
        bindPassword: 'Пароль сервисной учетной записи',
        directoryType: 'Тип каталога',
        defaultRole: 'Роль по умолчанию',
        enabled: 'Статус включения',
        userDnTemplate: 'Шаблон DN/UPN пользователя',
        userFilter: 'Фильтр пользователей',
        groupFilter: 'Фильтр групп',
        syncUserFilter: 'Фильтр синхронизации пользователей',
        requireGroupMapping: 'Требовать попадания входящего пользователя в сопоставление групп'
      },
      placeholders: {
        name: 'Например: корпоративный AD',
        domain: 'Например: example.com',
        serverAddress: 'Например: ad.example.com:636',
        baseDn: 'Например: DC=example,DC=com',
        bindDn: 'Например: CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: 'Введите пароль сервисной учетной записи',
        bindPasswordEdit: 'Оставьте пустым, чтобы сохранить текущий пароль',
        autoByDirectoryType: 'Оставьте пустым для автоматического вывода по типу каталога',
        userFilter: "Например: (uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "Например: (member={'{'}{'{'}userDn{'}'}{'}'})"
      },
      labels: {
        finalUrl: 'Итоговый адрес: {url}'
      },
      options: {
        unset: 'Не задавать'
      },
      status: {
        enabled: 'Включен',
        disabled: 'Остановлен',
        disabledShort: 'Отключен'
      },
      types: {
        activeDirectory: 'Active Directory',
        ldap: 'Стандартный LDAP'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: 'После удаления источника идентификации вход, синхронизация и сопоставление групп этого каталога станут недействительными.'
      },
      test: {
        dialogTitle: 'Проверка подключения источника идентификации',
        dialogDescription: 'Проверка DNS, LDAP-порта аутентификации и состояния BIND для {name} ({server}).',
        loading: 'Последовательно проверяются DNS, LDAP-порт аутентификации и состояние BIND...',
        checks: {
          dns: { title: 'Проверка DNS-разрешения' },
          port: { title: 'Проверка LDAP-порта аутентификации' },
          bind: { title: 'Проверка LDAP BIND' }
        },
        status: {
          passed: 'Успешно',
          failed: 'Ошибка',
          skipped: 'Пропущено'
        },
        messages: {
          summaryPassed: 'Все проверки подключения LDAP пройдены',
          summaryFailed: 'Проверки подключения LDAP не пройдены',
          dnsIp: 'Цель является IP-адресом, DNS-разрешение не требуется',
          dnsResolved: 'DNS-разрешение выполнено успешно: {addresses}',
          dnsFailed: 'Не удалось выполнить DNS-разрешение',
          portReachable: 'Порт аутентификации {protocol} {port} доступен',
          portFailed: 'Порт аутентификации LDAP недоступен',
          bindServicePassed: 'BIND сервисной учетной записи LDAP и запрос Base DN выполнены успешно',
          bindAnonymousPassed: 'Анонимный LDAP BIND и запрос Base DN выполнены успешно',
          bindFailed: 'LDAP BIND или запрос Base DN завершился ошибкой',
          skippedInvalidUrl: 'Пропущено: адрес LDAP недействителен',
          skippedDnsFailed: 'Пропущено: DNS-разрешение завершилось ошибкой',
          skippedPortFailed: 'Пропущено: порт аутентификации LDAP недоступен',
          unknownCheck: 'Проверка не пройдена ({code})',
          checkNotReturned: 'Сервер не вернул результат этой проверки.'
        },
        errors: {
          emptyResult: 'Сервер не вернул результат проверки подключения',
          requestFailed: 'Не удалось выполнить проверку подключения'
        }
      },
      secret: {
        bindPasswordName: 'Пароль сервисной учетной записи LDAP {name}'
      },
      messages: {
        createSuccess: 'Источник идентификации создан',
        updateSuccess: 'Источник идентификации обновлен'
      },
      errors: {
        loadFailed: 'Не удалось загрузить источники идентификации',
        createBindPasswordSecretFailed: 'Не удалось создать Secret пароля сервисной учетной записи',
        createFailed: 'Не удалось создать источник идентификации',
        updateFailed: 'Не удалось обновить источник идентификации',
        deleteFailed: 'Не удалось удалить источник идентификации'
      }
    }
  },
  bindings: {
    defaults: certificateFormatDefaultsRuRU,
    actions: {
      create: 'Создать конфигурационный файл',
      toggleFilters: 'Фильтры',
      export: 'Экспортировать',
      exporting: 'Экспорт...',
      edit: 'Редактировать',
      delete: 'Удалить',
      deleting: 'Удаление...',
      applyTemplate: 'Применить встроенный шаблон',
      saving: 'Сохранение...',
      confirmSave: 'Подтвердить сохранение'
    },
    columns: {
      configName: 'Имя конфигурации',
      targetSummary: 'Целевая среда',
      displayFormat: 'Формат содержимого',
      extension: 'Расширение',
      encodingSummary: 'Кодировка',
      exportSummary: 'Содержимое / параметры экспорта',
      actions: 'Операции'
    },
    dialog: {
      createTitle: 'Создать конфигурацию формата сертификата',
      editTitle: 'Редактировать конфигурацию формата сертификата',
      description: 'После выбора системной и целевой платформы можно применить встроенный шаблон и по пунктам настроить экспорт.'
    },
    exportModal: {
      title: 'Экспорт артефакта сертификата',
      description: 'Выберите версию сертификата, чтобы создать и скачать этот профиль доставки.',
      certificateVersion: 'Версия сертификата',
      loadingVersions: 'Загрузка версий сертификата...',
      versionRequired: 'Выберите версию сертификата',
      loadVersionsFailed: 'Не удалось загрузить версии сертификата',
      artifactUnavailable: 'Сервис не вернул артефакт сертификата для скачивания',
      exportFailed: 'Не удалось экспортировать артефакт сертификата',
      passwordRequired: 'Введите пароль для экспорта PFX/JKS',
      passwordPlaceholder: 'Введите пароль для этого экспорта',
      passwordHint: 'Используется только для этого экспорта. Профиль доставки не изменяется.',
      confirm: 'Создать и скачать',
      unnamedCertificate: 'Безымянный сертификат',
      versionLabel: 'v{version}',
      expiresOn: 'Истекает {date}'
    },
    list: {
      title: 'Список конфигураций форматов сертификатов',
      descriptionWithCount: 'Переиспользуемые шаблоны форматов сертификатов. Сейчас: {count}'
    },
    empty: {
      text: 'Конфигураций форматов сертификатов пока нет'
    },
    fields: {
      contentFormat: 'Формат содержимого',
      systemPlatform: 'Системная платформа',
      runtimePlatform: 'Целевая платформа',
      configName: 'Имя конфигурации',
      backendFormat: 'Нижележащий формат',
      outputExtension: 'Расширение вывода',
      expiresAt: 'Время истечения конфигурации (необязательно)',
      certificateEncoding: 'Кодировка сертификата',
      certificateContentEncoding: 'Кодировка содержимого сертификата',
      privateKeyEncoding: 'Кодировка закрытого ключа',
      includeLeafCertificate: 'Включить публичный сертификат',
      includeCertificateChain: 'Включить цепочку сертификатов',
      includePrivateKey: 'Включить закрытый ключ',
      mainArtifactIncludesChain: 'Основной артефакт содержит цепочку сертификатов',
      generateChainFile: 'Дополнительно создать файл цепочки сертификатов',
      generatePrivateKeyFile: 'Дополнительно создать файл закрытого ключа',
      exportPassword: 'Пароль экспорта'
    },
    formats: {
      pfx: 'Контейнер PKCS#12 / PFX',
      jks: 'Контейнер JKS',
      pemBundle: 'PEM Bundle в одном файле',
      pemCert: 'Файл сертификата PEM',
      pemKey: 'Файл закрытого ключа',
      cer: 'Файл сертификата (.cer)',
      crt: 'Файл сертификата (.crt)',
      p7b: 'Цепочка сертификатов PKCS#7 / P7B',
      custom: 'Пользовательский'
    },
    sections: {
      templates: {
        title: 'Встроенные шаблоны',
        description: 'Шаблоны предварительно заполняют формат содержимого, состав и правила экспорта по типовым способам размещения TLS на платформах; после применения их можно изменять.'
      },
      basic: {
        title: 'Основная информация',
        description: 'Сначала задайте идентичность конфигурации, фактический формат содержимого и итоговое расширение.'
      },
      encoding: {
        title: 'Выбор кодировки',
        description: 'Показываются только варианты кодировки, поддерживаемые текущим форматом содержимого.'
      },
      content: {
        title: 'Содержимое',
        description: 'Определяет, что входит в основной файл артефакта: публичный сертификат, цепочка сертификатов, закрытый ключ.'
      },
      export: {
        title: 'Параметры экспорта',
        description: 'Определяет, создавать ли дополнительные файлы цепочки и закрытого ключа, а также параметры пароля контейнера.'
      }
    },
    filters: {
      keywordPlaceholder: 'Имя конфигурации / целевая среда / Alias / формат содержимого'
    },
    placeholders: {
      configName: 'Например: совместимый с устройством PEM в одном файле',
      exportPassword: 'Введите пароль экспорта PFX/JKS'
    },
    validation: {
      selectPlatformsFirst: 'Сначала выберите системную и целевую платформу.',
      configNameRequired: 'Имя конфигурации обязательно',
      passwordRequired: 'Для конфигурации PFX/JKS обязателен пароль экспорта'
    },
    errors: {
      loadFailed: 'Не удалось загрузить конфигурации форматов сертификатов',
      saveFailed: 'Не удалось сохранить конфигурацию формата сертификата',
      deleteFailed: 'Не удалось удалить конфигурацию формата сертификата',
      createExportSecretFailed: 'Не удалось создать Secret пароля экспорта',
      withCode: '{message} ({code})'
    },
    fallbacks: {
      unnamedConfig: 'Безымянная конфигурация-{index}',
      unspecified: 'Не указано',
      aliasUnset: 'Alias не задан'
    },
    labels: {
      aliasWithValue: 'Alias: {alias}',
      requestId: 'ID запроса: {requestId}'
    },
    encoding: {
      pkcs12Container: 'Контейнер PKCS#12',
      jksContainer: 'Контейнер JKS',
      privateKeyWithEncoding: 'Закрытый ключ {encoding}',
      pkcs7Chain: 'Цепочка сертификатов PKCS#7',
      certificateWithEncoding: 'Сертификат {encoding}',
      default: 'По умолчанию'
    },
    export: {
      leafCertificate: 'Публичный сертификат',
      certificateChain: 'Цепочка сертификатов',
      privateKey: 'Закрытый ключ',
      extraChainFile: 'Дополнительный файл цепочки',
      extraPrivateKeyFile: 'Дополнительный файл закрытого ключа'
    },
    secret: {
      defaultConfigName: 'Конфигурация формата сертификата',
      exportPasswordName: 'Пароль экспорта {name}'
    },
    select: {
      placeholder: 'Выберите'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: 'Пароль экспорта уже настроен; чтобы заменить его, введите новый пароль.'
    },
    templates: {
      windowsIis: {
        configName: 'Стандартный шаблон Windows-IIS-PKCS12',
        description: 'IIS чаще всего использует контейнер PKCS#12/PFX; основной артефакт сразу содержит серверный сертификат, цепочку и закрытый ключ.'
      },
      windowsNginx: {
        configName: 'Стандартный шаблон Windows-NGINX-PEM',
        description: 'NGINX обычно использует один PEM-файл для серверного сертификата и цепочки, плюс отдельный файл закрытого ключа.'
      },
      windowsApache: {
        configName: 'Стандартный шаблон Windows-Apache-PEM',
        description: 'Apache обычно получает PEM-файл сертификата и отдельный закрытый ключ; цепочка дополнительно экспортируется для совместимости с разными практиками эксплуатации.'
      },
      windowsTomcat: {
        configName: 'Стандартный шаблон Windows-Tomcat-PKCS12',
        description: 'Tomcat в основном использует JKS/PKCS#12 keystore; здесь по умолчанию выбран более универсальный PKCS#12.'
      },
      windowsOther: {
        configName: 'Windows-шаблон PEM одним файлом для совместимости с устройствами',
        description: 'Для устройств, требующих один файл с публичным сертификатом, цепочкой и закрытым ключом; расширение можно изменить на .crt/.cer.'
      },
      linuxIis: {
        configName: 'Шаблон совместимости Linux-IIS',
        description: 'Если конечная цель все равно IIS, наиболее разумным артефактом остается контейнер PKCS#12/PFX.'
      },
      linuxNginx: {
        configName: 'Стандартный шаблон Linux-NGINX-PEM',
        description: 'Официальная конфигурация NGINX строится вокруг PEM-файла цепочки сертификатов и отдельного закрытого ключа.'
      },
      linuxApache: {
        configName: 'Стандартный шаблон Linux-Apache-PEM',
        description: 'Apache обычно использует PEM-файл сертификата с отдельным закрытым ключом; файл цепочки дополнительно экспортируется для раздельного развертывания.'
      },
      linuxTomcat: {
        configName: 'Стандартный шаблон Linux-Tomcat-PKCS12',
        description: 'Tomcat обычно требует контейнер keystore; здесь используется более универсальный PKCS#12.'
      },
      linuxOther: {
        configName: 'Linux-шаблон PEM одним файлом для совместимости с устройствами',
        description: 'Для универсальных Linux-устройств, принимающих один PEM-файл: сначала используйте bundle, затем настройте расширение и состав под целевое устройство.'
      }
    }
  },
  deploymentInputs: {
    title: 'Входные данные развертывания',
    description: 'Настройте значения развертывания по единому контракту ввода, объявленному плагином или рабочим процессом.',
    saveAssetFirst: 'Сохраните ресурс приложения и источник выполнения перед редактированием входных данных, спроецированных сервером.',
    contractVersion: 'Контракт {version}',
    groups: { required: 'Обязательные параметры', advanced: 'Расширенные параметры', readonly: 'Значения только для чтения и времени выполнения' },
    actions: { expand: 'Показать расширенные параметры', collapse: 'Скрыть расширенные параметры' },
    placeholders: { select: 'Выберите значение', credential: 'Выберите учетные данные', artifact: 'Выберите формат артефакта', output: 'Выберите выход' },
    artifacts: { format: 'Формат артефакта' },
    allowInsecureTls: {
      label: 'Разрешить пропуск проверки TLS-сертификата',
      description: 'Явно разрешает этому развертыванию пропустить проверку TLS-сертификата, если устройство использует самоподписанный или недоверенный сертификат.',
      help: 'Это только фиксирует намерение развертывания и не выдает право на выполнение. По-прежнему требуется разрешение на выполнение, выданное хостом.'
    },
    runtimeValue: 'Предоставляется источником {source} во время выполнения',
    source: 'Источник: {source}',
    sourceKinds: { asset: 'Ресурс', binding: 'Привязка', default: 'Значение по умолчанию', derived: 'Производное значение', system: 'Системное значение', step_output: 'Выход шага', unknown: 'Неизвестный источник' },
    issues: {
      title: 'Проблемы входных данных',
      unknown: 'Ошибка проверки входных данных развертывания ({code})',
      DEPLOYMENT_INPUT_REQUIRED: 'Отсутствуют обязательные входные данные развертывания',
      DEPLOYMENT_CONNECTION_REQUIRED: 'Отсутствует обязательный параметр подключения',
      DEPLOYMENT_CREDENTIAL_REQUIRED: 'Отсутствуют обязательные учетные данные',
      DEPLOYMENT_ARTIFACT_REQUIRED: 'Отсутствует обязательный артефакт развертывания',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: 'Эти входные данные развертывания нельзя переопределить',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: 'Слот входных данных развертывания не объявлен',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: 'Поле входных данных развертывания не объявлено',
      DEPLOYMENT_INPUT_TYPE_INVALID: 'Недопустимый тип входных данных развертывания',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: 'Фиксированные входные данные развертывания нельзя переопределить',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: 'Отсутствует снимок учетных данных',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: 'Снимок учетных данных не соответствует текущему выбору',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: 'Тип учетных данных не поддерживается',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: 'Отсутствует снимок артефакта',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: 'Отсутствует обязательный выход артефакта'
    }
  },
  assets: {
    presentation: {
      cards: 'Карточки',
      list: 'Таблица',
    },
    card: {
      presentation: { cards: 'Карточки', list: 'Таблица' },
      total: 'Всего: {count}',
      status: { valid: 'Действителен', attention: 'Внимание', unknown: 'Неизвестно', executable: 'Можно выполнить', needsConfiguration: 'Требуется настройка' },
      days: { expired: 'Истёк {days} дн. назад', expiresToday: 'Истекает сегодня', notRecorded: 'Не записано', remaining: '{days} дн.' },
      fields: { certificate: 'Сертификат', validity: 'Срок действия', device: 'Устройство' },
      actions: { add: 'Добавить', upToDate: 'Актуален', deployUpdate: 'Развернуть обновление' }
    },
    selection: {
      selectedCount: 'Выбрано активов: {count} / {total}',
      actions: {
        bulkDelete: 'Удалить выбранные',
        bulkUpdateCertificate: 'Массово обновить сертификат'
      },
      bulkDeleteRisk: 'Выбранные активы приложений и их ручные связи с целями будут удалены. Обнаруженные фреймворки, сайты и управляемые цели сохранятся.',
      bulkDeleteSuccess: 'Удалено активов приложений: {count}.',
      bulkDeletePartialSuccess: 'Удалено: {succeeded}; ошибок: {failed}.',
      bulkUpdateDescription: 'Выберите и отправьте новую версию сертификата для {count} активов, связанных с одним доменом сертификата «{domain}».',
      bulkUpdateFailed: 'Массовое обновление не выполнено: ни один из {count} активов не отправлен.',
      bulkUpdateSuccess: 'Обновление сертификата отправлено для активов: {count}.',
      bulkUpdatePartialSuccess: 'Отправлено: {succeeded}; ошибок: {failed}.'
    },
    aria: {
      selectCard: 'Выбрать актив {name}',
      detailCard: 'Открыть сведения об активе {name}',
      editCard: 'Изменить актив {name}',
      deleteCard: 'Удалить актив {name}'
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
    title: 'Активы приложений',
    description: 'Управление входами приложений по домену или IP с фокусом на адрес, порт, протокол, сайт и позиционирование выполнения.',
    resourceName: 'Актив приложения',
    linkage: { title: 'Связь плагина и Agent', description: 'Проверьте версии и локальную политику выполнения.', status: 'Статус', agent: 'Версия Agent', plugin: 'Версия плагина', policy: 'Совпадение политики', repair: 'Исправить' },
    executionModes: {
      label: 'Режим выполнения',
      plugin: { title: 'Выполнение плагином', description: 'Использовать включенную для управляемой цели возможность развертывания сертификата.' },
      workflowOverride: { title: 'Переопределение процессом', description: 'Обойти плагин и использовать пользовательский рабочий процесс.', notice: 'Этот режим отключает назначение плагина актива и сохраняет только привязку рабочего процесса.' }
    },
    actions: {
      add: 'Добавить актив',
      edit: 'Редактировать',
      detail: 'Детали',
      addVariable: 'Добавить переменную',
      delete: 'Удалить',
      deleteRisk: 'Удаление уберет этот актив приложения и его ручную связь с целью из списка. Обнаруженные фреймворки, сайты, Virtual Server и ManagedTarget сохраняются.',
      rollbackFromLatestSnapshot: 'Запустить откат из последнего снимка',
      rollingBack: 'Откат...',
      deployCertificate: 'Развернуть сертификат',
      latestCertificate: 'Актуальный сертификат',
      updateCertificate: 'Обновить сертификат',
      saving: 'Сохранение...',
      creating: 'Создание...',
      saveChanges: 'Сохранить изменения',
      confirmCreate: 'Подтвердить создание'
    },
    columns: {
      domain: 'Домен доступа',
      port: 'Порт',
      protocol: 'Протокол',
      device: 'Устройство',
      platform: 'Платформа',
      framework: 'Фреймворк',
      site: 'Сайт',
      status: 'Статус',
      actions: 'Операции'
    },
    fields: {
      assetId: 'ID актива приложения',
      domain: 'Домен доступа',
      addressType: 'Тип адреса',
      port: 'Порт',
      protocol: 'Протокол',
      device: 'Устройство',
      verifyUrl: 'URL проверки',
      platform: 'Платформа',
      frameworkType: 'Тип фреймворка',
      deploymentStrategyCompatibility: 'Режим совместимости стратегии развертывания',
      selectWorkflow: 'Выберите рабочий процесс',
      serviceInstanceId: 'ID экземпляра сервиса',
      siteId: 'ID сайта',
      managedTargetId: 'ID управляемой цели',
      bindingKey: 'Ключ привязки',
      hostId: 'ID хоста',
      environment: 'Среда',
      discoverySource: 'Источник обнаружения',
      lastDiscoveredAt: 'Последнее обнаружение',
      tags: 'Теги',
      managedTarget: 'Управляемая цель',
      siteName: 'Имя сайта',
      bindingInformation: 'Сведения о привязке',
      hostHeader: 'Host Header',
      sniName: 'Имя SNI',
      currentCertificate: 'Текущий сертификат',
      remainingValidity: 'Оставшийся срок действия',
      targetCertificate: 'Целевой сертификат',
      expectedFingerprint: 'Ожидаемый отпечаток',
      certificateStore: 'Хранилище сертификатов',
      snapshotType: 'Тип снимка',
      time: 'Время',
      executionRun: 'Запись выполнения',
      displayName: 'Отображаемое имя',
      siteInstance: 'Экземпляр сайта',
      certificateFormat: 'Конфигурация артефакта сертификата',
      workflow: 'Рабочий процесс',
      workflowVersionSelection: 'Политика версии рабочего процесса',
      publishedVersion: 'Опубликованная версия',
      runner: 'Место запуска',
      artifactFormat: 'Конфигурация формата артефакта',
      updatePlugin: 'Плагин обновления сертификата'
    },
    capability: { source: 'Источник возможности', plugin: 'Версия плагина', runtime: 'Среда выполнения', executionLocation: 'Место выполнения', pendingAssignment: 'После сохранения будет создано назначение возможности развертывания на уровне ресурса приложения.' },
    links: {
      certificateBindings: 'Посмотреть привязки сертификатов',
      executions: 'Посмотреть записи выполнения'
    },
    empty: {
      title: 'Активов приложений пока нет',
      description: 'Ожидание автоматического обнаружения системой или ручного добавления входа приложения.',
      noBindingInformation: 'Сведения о привязке не предоставлены',
      notSet: 'Не задано',
      notSelected: 'Не выбрано',
      noVariablePreset: 'Нет переменных для добавления',
      basicEntryIncomplete: 'Базовый вход не заполнен'
    },
    detail: {
      title: 'Детали приложения',
      description: 'Просмотр деталей актива, связей привязки, входа развертывания и записей снимков.',
      tabsAriaLabel: 'Вкладки деталей приложения',
      tabs: {
        overview: 'Основная информация',
        snapshots: 'Снимки'
      },
      loadingTargetBinding: 'Загрузка деталей целевой привязки...',
      loadingSnapshots: 'Загрузка снимков...',
      emptyCertificateBindings: 'Привязок сертификатов пока нет.',
      emptySnapshots: 'Снимков пока нет.',
      rollbackSubmitted: 'Запрос отката отправлен; смотрите запуск отката в "Записях выполнения".',
      sections: {
        overview: {
          title: 'Основная информация',
          description: 'Актив приложения является основным объектом; хост и сайт используются только как сведения для позиционирования выполнения.'
        },
        targetBinding: {
          title: 'Целевая привязка',
          description: 'Привязка должна явно указывать сайт и управляемую цель, а не продолжать угадывать по домену.'
        },
        certificateBindings: {
          title: 'Связи привязки сертификатов',
          description: 'Связь сертификата фиксируется на binding, а не только по домену.'
        },
        snapshots: {
          title: 'Снимки',
          description: 'Состояние до развертывания, после развертывания и после отката должно быть видно напрямую, а не только через записи задач.'
        }
      }
    },
    deployment: {
      title: 'Развертывание сертификата',
      noCertificateAsset: 'Нет доступного для развертывания актива сертификата',
      description: 'Выберите версию сертификата для этого актива приложения. Система создаст снимок, выполнит необходимую предпроверку и запустит развертывание.',
      dialogTitle: 'Развертывание сертификата',
      dialogDescription: 'Операция относится только к текущему активу приложения. План остается серверной границей снимка, и выполнения.',
      targetLocked: 'Цель обновления зафиксирована',
      latestVersionPointer: 'Автоматически применять последнюю версию текущего сертификата',
      deployThisVersion: 'Развернуть эту версию сертификата',
      loadingRecords: 'Загрузка записей развертывания...',
      emptyRecords: 'Для этого актива приложения записей развертывания пока нет.',
      preflightAvailable: 'Получено проверок предпроверки: {count}',
      preflightUnavailable: 'Предпроверка еще не запускалась',
      rollbackUnavailable: 'Откат не запрашивался',
      fields: { status: 'Статус развертывания', latestRun: 'Последний запуск', preflight: 'Предпроверка', rollback: 'Откат', updatedAt: 'Обновлено' },
      feedback: { preflightRunning: 'Ожидание завершения предпроверки.', executionStarted: 'Предпроверка завершена; выполнение запущено.' },
      errors: { missingApplicationAssetId: 'Требуется идентификатор актива приложения.', missingCertificateVersion: 'В текущей политике нет доступной версии сертификата.', loadOptionsFailed: 'Не удалось загрузить доступные версии сертификата.', createPlanMissingId: 'Созданный снимок не вернул идентификатор плана.', deployFailed: 'Не удалось развернуть сертификат.', preflightFailed: 'Предпроверка развертывания не пройдена.', preflightTimeout: 'Предпроверка развертывания завершилась по тайм-ауту.', loadRecordsFailed: 'Не удалось загрузить записи развертывания.' },
      dedicated: { kicker: 'Выделенный сертификат', title: 'Выделенный сертификат приложения', providerTypes: { acme: 'ACME', internalCa: 'Управляемый CA' }, fields: { providerType: 'Способ выпуска', ca: 'Выбранный CA', caStatus: 'Статус CA', custodyMode: 'Управление закрытым ключом', certificate: 'Статус сертификата', issuedAt: 'Запрошен', expiresAt: 'Истекает', remainingDays: 'Осталось дней' }, status: { available: 'Доступен', unavailable: 'Недоступен', unknown: 'Неизвестно' }, custody: { agentLocal: 'Управляется Agent', managedSecret: 'Управляется платформой' }, certificate: { exists: 'Выпущен', missing: 'Не выпущен' }, remainingDays: 'Осталось {days} дн.', reapply: 'Запросить новый сертификат', reapplyHint: 'Перед развертыванием будет запрошен новый выделенный сертификат.', deployCurrentHint: 'Развернуть текущий выделенный сертификат.', issuancePending: 'Запрос выделенного сертификата отправлен. Разверните после выпуска.' }
    },
    compatibilityModes: {
      unified: 'Единая привязка плагина',
      legacy: 'Историческая совместимость',
      legacyAdapted: 'Двойное чтение единой и исторической конфигурации'
    },
    managementModes: {
      agent: 'Режим Agent',
      agentDescription: 'Привязать Agent, экземпляр сайта и управляемую цель',
      workflow: 'Режим рабочего процесса',
      workflowDescription: 'Выбрать версию рабочего процесса и переменные запуска'
    },
    workflowVersionSelection: {
      pinned: 'Закрепить выбранную версию',
      latestPublished: 'Всегда использовать последнюю опубликованную версию'
    },
    loading: {
      agents: 'Загрузка Agent...',
      sites: 'Загрузка сайтов...',
      managedTargets: 'Загрузка целей...',
      certificateFormats: 'Загрузка конфигураций форматов...',
      workflows: 'Загрузка рабочих процессов...',
      versions: 'Загрузка версий...',
      gateways: 'Загрузка Gateway...',
      credentials: 'Загрузка учетных данных...'
    },
    select: {
      agent: 'Выберите Agent',
      siteInstance: 'Выберите экземпляр сайта',
      managedTarget: 'Выберите управляемую цель',
      certificateFormat: 'Выберите конфигурацию артефакта сертификата',
      workflow: 'Выберите рабочий процесс',
      publishedVersion: 'Выберите опубликованную версию',
      gateway: 'Выберите Gateway',
      variablePreset: 'Выберите предустановленную переменную',
      credential: 'Выберите учетные данные',
      generic: 'Выберите',
      artifactFormat: 'Выберите конфигурацию формата',
      output: 'Выберите выход',
      optionalOutput: 'Можно не выбирать',
      updatePluginOptional: 'Необязательно; использовать текущий активный плагин'
    },
    validation: {
      variableNameRequired: 'Имя переменной не может быть пустым',
      variableNameInvalid: 'Имя переменной {name} недопустимо',
      variableDuplicated: 'Переменная {name} повторяется',
      variableRequired: 'Переменная {name} обязательна',
      variableMustBeNumber: 'Переменная {name} должна быть числом',
      variableMustBeJsonObject: 'Переменная {name} должна быть JSON-объектом',
      variableInvalidJson: 'Переменная {name} не является допустимым JSON',
      variableCredentialInvalid: 'Для переменной {name} нужно выбрать действительные учетные данные',
      certificateFormatRequired: 'Для переменной сертификата {name} нужно выбрать конфигурацию формата сертификата',
      certificateOutputRequired: 'Для переменной сертификата {name}.{slot} нужно выбрать выход',
      certificateOutputMissing: 'Выбранный выход переменной сертификата {name}.{slot} не существует'
    },
    workflowVariableTypes: {
      string: 'Строка',
      number: 'Число',
      boolean: 'Булево',
      enum: 'Перечисление',
      object: 'Объект',
      file: 'Файл',
      credential: 'Учетные данные',
      certificate: 'Сертификат'
    },
    wizard: {
      ariaLabel: 'Шаги создания актива приложения',
      steps: {
        basicEntry: 'Базовый вход',
        deploymentMode: 'Режим развертывания',
        confirmSave: 'Подтвердить сохранение'
      },
      stepState: {
        active: 'В процессе',
        done: 'Завершено',
        pending: 'Ожидает начала',
        incomplete: 'Нужно завершить',
        readyNext: 'Можно перейти дальше',
        pendingSubmit: 'Ожидает отправки'
      },
      panels: {
        basicEntryTitle: 'Базовый вход',
        basicEntryDescription: 'Сначала заполните домен, порт, протокол и платформу; они определяют идентичность входа приложения.',
        agentTitle: 'Целевая привязка Agent',
        agentDescription: 'Выберите Agent, экземпляр сайта, управляемую цель и конфигурацию артефакта сертификата.',
        workflowTitle: 'Конфигурация запуска рабочего процесса',
        workflowDescription: 'Выберите версию рабочего процесса, место запуска и переменные; переменные сертификата будут внедрены во время выполнения.',
        confirmTitle: 'Подтвердить сохранение',
        confirmDescription: 'Проверьте вход приложения, режим развертывания и параметры запуска; после подтверждения актив приложения будет записан.'
      }
    },
    form: {
      createTitle: 'Ручное добавление актива приложения',
      editTitle: 'Редактирование актива приложения',
      createDescription: 'Создайте вход приложения и привяжите целевые сведения, необходимые для последующего развертывания.',
      editDescription: 'Измените вход приложения и целевую привязку развертывания.',
      createRequestCompleted: 'Запрос создания завершен.',
      editRequestCompleted: 'Запрос сохранения завершен.',
      agentCertificateFormatHint: 'В режиме Agent эта конфигурация артефакта сертификата будет использоваться для формирования материалов развертывания.',
      placeholders: {
        displayName: 'Например: вход продуктивного сайта',
        verifyUrl: 'Например: https://example.com/health',
        siteName: 'Например: продуктивный сайт',
        bindingInformation: 'Например: *:443:example.com',
        hostHeader: 'Например: example.com',
        sniName: 'Например: example.com'
      }
    },
    review: {
      accessEntry: 'Вход доступа',
      deploymentMode: 'Режим развертывания',
      agentSiteTarget: 'Agent / сайт / цель',
      workflowVersion: 'Версия рабочего процесса',
      gatewayRunner: 'Gateway: {gateway}',
      variableCount: 'Переменных: {count}',
      onlyBasicEntry: 'Только базовый вход',
      autoGeneratedByEntry: 'Сформировано по входу приложения'
    },
    workflowTarget: {
      title: 'Сведения о цели рабочего процесса',
      description: 'Используются для отображения актива рабочего процесса, проверки после развертывания и синхронизации целевых переменных DSL.',
      dslSyncHint: 'Синхронизировано с целевыми переменными DSL',
      advancedTitle: 'Расширенные настройки',
      advancedDescription: 'Изменяйте только для переопределения правила прослушивания, домена запроса или имени TLS-сертификата.',
      expandAdvanced: 'Развернуть расширенные настройки',
      collapseAdvanced: 'Свернуть расширенные настройки',
      bindingInformationLabel: 'Правило прослушивания сервиса',
      bindingInformationHelp: 'Описывает сочетание адреса, порта и домена, используемое сервисом.',
      hostHeaderLabel: 'Домен запроса',
      hostHeaderHelp: 'Изменяйте только если сервис требует определённый HTTP-заголовок Host.',
      sniNameLabel: 'Домен TLS-сертификата',
      sniNameHelp: 'Изменяйте только если имя TLS отличается от домена доступа.'
    },
    workflowVariables: {
      title: 'Переменные рабочего процесса',
      configuredCount: 'Настроено {configured}/{total}',
      name: 'Имя переменной',
      type: 'Тип',
      value: 'Значение',
      manual: 'Вручную',
      empty: 'Переменных рабочего процесса пока нет.',
      noPublishedVersion: 'Выберите опубликованную версию рабочего процесса, затем настройте переменные.',
      certificateAutoInjected: 'Версия сертификата выбирается планом развертывания и автоматически внедряется во время выполнения.',
      certificateDescription: 'Версия сертификата выбирается планом развертывания; ниже актив приложения привязывает конфигурацию формата и выходы, а во время выполнения внедряется {name}.outputs.*.content.',
      presets: {
        deviceHost: 'Адрес целевого хоста или устройства',
        sshUsername: 'Имя пользователя SSH',
        credential: 'Учетные данные рабочего процесса',
        certificate: 'Артефакт сертификата',
        targetPlatform: 'Целевая платформа',
        apacheServiceName: 'Имя службы Apache systemd',
        apacheSiteConfigPath: 'Путь конфигурации сайта Apache',
        certificateFilePath: 'Целевой путь сертификата',
        certificateKeyFilePath: 'Целевой путь закрытого ключа',
        backupRoot: 'Корневой каталог резервных копий сертификатов',
        expectedResponseContains: 'Ожидаемый текст в ответе',
        virtualHostServerName: 'ServerName виртуального хоста'
      }
    },
    certificateBindings: {
      title: 'Привязки переменных сертификата',
      description: 'Выберите конфигурацию артефакта сертификата и выходы для переменных сертификата в рабочем процессе.',
      variableCount: 'Переменных сертификата: {count}',
      defaultVariableDescription: 'Переменная артефакта сертификата',
      noArtifactOutputs: 'В текущей конфигурации формата нет доступных выходов.'
    },
    certificateOutputs: {
      publicCertificateWithChain: 'Публичный сертификат + цепочка сертификатов',
      publicCertificate: 'Публичный сертификат',
      certificateChain: 'Цепочка сертификатов',
      privateKey: 'Закрытый ключ',
      pemBundle: 'PEM-артефакт Bundle',
      container: 'Контейнер {format}',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (сохраненная конфигурация, текущий список ее не вернул)',
      withPrivateKey: 'С закрытым ключом',
      withoutPrivateKey: 'Без закрытого ключа'
    },
    snapshotTypes: {
      preDeploy: 'До развертывания',
      postDeploy: 'После развертывания',
      postRollback: 'После отката',
      errorState: 'Состояние ошибки',
      rollbackPoint: 'Точка отката'
    },
    errors: {
      loadWorkflowListFailed: 'Не удалось загрузить список рабочих процессов',
      loadWorkflowVersionsFailed: 'Не удалось загрузить версии рабочих процессов',
      loadGatewayListFailed: 'Не удалось загрузить список шлюзов',
      loadCertificateFormatsFailed: 'Не удалось загрузить конфигурации форматов сертификатов',
      loadAssetDetailFailed: 'Не удалось загрузить детали актива приложения',
      rollbackFailed: 'Не удалось запустить откат',
      loadTargetsFailed: 'Не удалось загрузить сайты и управляемые цели',
      createAssetFailed: 'Не удалось создать актив приложения',
      pluginFormLoadFailed: 'Не удалось загрузить форму настройки плагина',
      pluginBindingCreateFailed: 'Не удалось сохранить привязку плагина',
      loadWorkflowCredentialsFailed: 'Не удалось загрузить учетные данные рабочего процесса',
      loadCredentialProfilesFailed: 'Не удалось загрузить профили учетных данных',
      noAvailableSiteInstance: 'Нет доступного экземпляра сайта. Убедитесь, что обнаружение устройства передало фреймворки и сайты.',
      managedTargetRediscoveryRequired: 'У этого сайта нет управляемых целей. Повторите обнаружение устройства.',
      noCompatibleManagedPlugin: 'Нет включённого плагина, совместимого с этой управляемой целью.',
      capabilityAssignmentMissing: 'Для этой цели нет действующего назначения возможности развёртывания.'
    },
    platforms: {
      appliance: 'Устройство',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: 'Платформа',
      gateway: 'Шлюз'
    },
    status: {
      archived: 'Архивировано',
      unknownStatus: 'Неизвестный статус'
    },
    certificateSupply: { title: 'Политика предоставления сертификата', description: 'Настройте ручной или выделенный сертификат приложения. Версии политики сохраняются.', modeLabel: 'Режим предоставления', manual: 'Выбрать сертификат', dedicated: 'Использовать выделенный сертификат', certificateVersion: 'Версия сертификата', selectCertificate: 'Выберите сертификат для текущего домена', domainMatch: 'Показаны только сертификаты, чей CN или SAN покрывает {domain}.', provider: 'Provider выпуска', internalCa: 'Internal CA', acme: 'ACME', ca: 'Центр сертификации', selectCa: 'Выберите CA', profile: 'Certificate Profile', selectProfile: 'Выберите версию профиля', acmeProvider: 'ACME Provider', acmeProfile: 'ACME Profile', selectAcmeProfile: 'Выберите профиль ACME', selectProvider: 'Выберите Provider', dnsProvider: 'DNS Provider', selectDnsProvider: 'Выберите DNS Provider', secretRef: 'SecretRef учетных данных', secretRefPlaceholder: 'secret://tenant/path', custodyMode: 'Хранение ключа', artifactMode: 'Режим артефакта', canSave: 'Можно сохранить', canIssue: 'Можно выпустить', canDeploy: 'Можно развернуть', lifecycle: 'Состояние жизненного цикла', errors: { loadFailed: 'Не удалось загрузить политику сертификата.', previewFailed: 'Не удалось просмотреть политику сертификата.' } },
    common: {
      required: 'Обязательно',
      optional: 'Необязательно'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'Запрос не выполнен'
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
        title: 'Управление сертификатами и приложениями',
        subtitle: 'Управляйте сертификатами и просматривайте приложения, которые их используют',
        sections: {
          certificates: {
            title: 'Управление сертификатами',
            help: 'Просматривайте и управляйте всеми сертификатами, сроками действия и состояниями.'
          },
          applications: {
            title: 'Связанные приложения',
            help: 'Просматривайте места использования сертификатов и частоту обновлений.'
          }
        },
        stats: {
          total: 'Всего сертификатов',
          expiring: 'Скоро истекают',
          expired: 'Истекшие'
        },
        versionCount: 'Версий: {count}',
        versionCountShort: '{count}',
        sourceLabels: {
          manual: 'Вручную',
          acme: 'ACME',
          unknown: 'Неизвестно'
        },
        fields: {
          expires: 'Срок действия',
          source: 'Источник',
          versions: 'Версии'
        },
        empty: {
          title: 'Сертификатов пока нет',
          description: 'Импортируйте первый сертификат, чтобы начать управление.'
        },
        applications: {
          description: 'Просматривайте приложения, использующие выбранный сертификат, и настройте автоматические обновления.',
          selectPrompt: 'Сначала выберите сертификат слева',
          selectedCertificate: 'Выбранный сертификат',
          connectedApps: 'Связанные приложения ({count})',
          noApps: 'С этим сертификатом пока нет связанных приложений.',
          addApp: 'Добавить приложение',
          automationTitle: 'Настройка автоматического обновления',
          activeAutomations: 'Активные автоматические обновления',
          totalAutomations: 'Всего планов обновления',
          automationDescription: 'Планы обновления регулярно проверяют состояние сертификатов и при необходимости развертывают обновления в связанных приложениях.'
        }
      }
    },
    detail: {
      backList: 'Вернуться к списку',
      description: 'Показывает детали версии сертификата, форматные артефакты и связанные активы.',
      title: 'Детали сертификата'
    },
    detailPanel: {
      sources: {
        agentContext: 'Контекст Agent',
        platformBinding: 'Запись привязки платформы'
      },
      usage: {
        columns: {
          domainName: 'Домен/цель',
          assetName: 'Актив',
          frameworkName: 'Фреймворк',
          siteName: 'Имя сайта',
          bindingType: 'Тип привязки',
          usageSource: 'Источник',
          status: 'Статус'
        },
        empty: 'Связанных активов пока нет',
        toolbar: 'Связанные активы'
      },
      summary: {
        certificateName: 'Имя сертификата',
        logicalDomain: 'Логический домен',
        issuer: 'Издатель',
        subject: 'Субъект',
        serialNumber: 'Серийный номер',
        chainStatus: 'Статус цепочки'
      },
      sections: {
        subjectInfo: 'Сведения о субъекте',
        issuerInfo: 'Сведения об издателе',
        certificateFields: 'Поля сертификата',
        extensionFields: 'Поля расширений'
      },
      fields: {
        commonName: 'Common Name (CN)',
        organization: 'Организация (O)',
        organizationalUnit: 'Подразделение (OU)',
        countryRegion: 'Страна/регион (C)',
        stateProvince: 'Штат/провинция (ST)',
        locality: 'Город (L)',
        version: 'Версия',
        signatureAlgorithm: 'Алгоритм подписи',
        publicKeyAlgorithm: 'Алгоритм публичного ключа',
        fingerprintSha256: 'Отпечаток SHA-256',
        san: 'SAN',
        deployable: 'Можно развернуть',
        leafStorageRef: 'Ссылка на leaf-сертификат',
        chainCertificateCount: 'Количество сертификатов в цепочке',
        trustRootCertificate: 'Целевой корневой сертификат',
        trustRootStatus: 'Состояние корневого сертификата',
        chainDiagnostics: 'Диагностика цепочки'
      },
      fallbacks: {
        unknownCertificate: 'Неизвестный сертификат',
        unknownIssuer: 'Неизвестный издатель',
        unnamedCertificate: 'Безымянный сертификат',
        unknownDomain: 'Неизвестный домен',
        unknownSubject: 'Неизвестный субъект',
        unknown: 'Неизвестно',
        notPartOfCertificate: 'Не является частью сертификата',
        none: 'Нет',
        emptyValue: '—',
        unknownType: 'Неизвестный тип',
        unknownResource: 'Неизвестный ресурс',
        unknownTarget: 'Неизвестная цель'
      },
      values: {
        yes: 'Да',
        no: 'Нет'
      },
      separators: {
        diagnostic: '; ',
        list: ', '
      },
      diagnostics: {
        rootResolvedFromLibrary: 'Импортированный материал не содержит корневой сертификат: {root}. Хранилище корневых сертификатов проекта уже разрешило его и сможет дополнить полную цепочку при развёртывании.'
      },
      chain: {
        roles: {
          leaf: 'Leaf-сертификат',
          root: 'Корневой сертификат',
          intermediate: 'Промежуточный сертификат'
        },
        title: 'Цепочка сертификатов',
        empty: 'Сведения о цепочке сертификатов отсутствуют',
        subject: 'Субъект: {value}',
        issuer: 'Издатель: {value}'
      },
      errors: {
        loadFailedTitle: 'Не удалось загрузить детали сертификата',
        code: 'Код ошибки: {code}'
      },
      actions: {
        retry: 'Повторить'
      },
      states: {
        loading: 'Загрузка...'
      },
      tabs: {
        ariaLabel: 'Вкладки деталей сертификата',
        detail: 'Детали',
        usage: 'Связанные активы'
      },
      validity: {
        title: 'Срок действия сертификата',
        notBefore: 'Действует с: {value}',
        notAfter: 'Истекает: {value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'ID версии',
        createdAt: 'Время создания',
        format: 'Формат',
        secretRef: 'Ссылка Secret',
        status: 'Статус'
      },
      create: 'Создать конфигурацию формата',
      createFailed: 'Не удалось создать формат',
      description: 'Вход конфигураций форматов PEM/DER/PFX/JKS/P7B для сертификата {id}.',
      empty: 'Конфигураций форматов пока нет',
      fields: {
        alias: 'Alias (необязательно)',
        containsPrivateKey: 'Содержит закрытый ключ (PEM)',
        passwordSecretRef: 'passwordSecretRef (PFX/JKS)',
        targetFormat: 'Целевой формат',
        versionId: 'ID версии'
      },
      hint: 'PFX/JKS должны использовать существующий в системе passwordSecretRef; при реальном развертывании материалы создаются на лету из версии сертификата и конфигурации формата.',
      loadFailed: 'Не удалось загрузить конфигурации форматов',
      optionAvailable: '{label} - доступно',
      placeholders: {
        alias: 'Например gcac-cert'
      },
      title: 'Конфигурация формата сертификата',
      toolbar: 'Список конфигураций форматов',
      unsupported: '{format} нельзя создать при текущей декларации возможностей.'
    },
    import: {
      addTitle: 'Добавить сертификат',
      backList: 'Вернуться к списку сертификатов',
      description: 'Сейчас поддерживаются только PEM + KEY и PFX; PFX поддерживает только импорт файла. Импортируемые материалы должны содержать серверный сертификат, полную цепочку промежуточных сертификатов и закрытый ключ; корневой сертификат не обязателен.',
      errors: {
        importFailed: 'Импорт не выполнен',
        materialRequiredBeforeValidate: 'Сначала заполните материалы импорта, затем запускайте проверку.',
        needPassedValidation: 'Сначала завершите проверку на шаге 3 и убедитесь, что она пройдена, затем импортируйте.',
        validateFailed: 'Проверка не выполнена'
      },
      formats: {
        pem: {
          hint: 'Нужно одновременно предоставить серверный сертификат, полную цепочку промежуточных сертификатов и закрытый ключ. Корневой сертификат не обязателен; при отсутствии будет предупреждение.'
        },
        pfx: {
          hint: 'Поддерживается только импорт файла, контейнер должен содержать серверный сертификат, полную цепочку промежуточных сертификатов и закрытый ключ. Корневой сертификат не обязателен; при отсутствии будет предупреждение.'
        }
      },
      methods: {
        file: {
          hint: 'Подходит для уже имеющихся файлов cert / key или .pfx.',
          label: 'Выбрать файл'
        },
        text: {
          hint: 'Подходит для прямой вставки PEM-текста без загрузки временного файла.',
          label: 'Вставить текст'
        }
      },
      title: 'Импорт сертификата'
    },
    importForm: {
      source: {
        title: 'Выберите способ добавления сертификата',
        description: 'Импортируйте существующий сертификат или используйте автоматическую выдачу ACME, когда она доступна.',
        manual: {
          title: 'Импортировать существующий сертификат',
          description: 'Загрузите файл сертификата PEM, CRT или PFX и его закрытый ключ.',
          recommended: 'Рекомендуется'
        },
        acme: {
          title: 'Запросить сертификат через ACME',
          description: 'Автоматически запрашивайте и продлевайте сертификаты у центра сертификации.',
          unavailable: 'Недоступно'
        },
        unavailable: {
          title: 'Канал выдачи ACME не настроен',
          description: 'В этой консоли нет доступной точки входа ACME. Импортируйте существующий сертификат или повторите попытку после настройки канала автоматической выдачи.'
        }
      },
      acme: {
        title: 'Запросить сертификат ACME', loading: 'Проверка канала выпуска...', blocked: 'Канал выпуска не готов. Устраните указанные условия и обновите страницу.',
        status: { ready: 'Можно запросить', blocked: 'Требуется настройка', unknown: 'Состояние неизвестно' },
        fields: { issuer: 'Центр сертификации', email: 'Контактный e-mail', domains: 'Доменные имена', dnsCredential: 'DNS-учетные данные', keyType: 'Тип ключа', autoRenew: 'Автопродление' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: 'Отправить запрос', refresh: 'Обновить состояние' },
        errors: { requestFailed: 'Сбой запроса ACME' }
      },
      hints: {
        pemChainCheck: 'Загрузите или вставьте серверный сертификат, полную цепочку промежуточных сертификатов и закрытый ключ; система проверит цепочку сертификатов и соответствие закрытого ключа.',
        pfxChainCheck: 'Загрузите файл PFX/P12 и введите пароль; система разберет из контейнера серверный сертификат, цепочку и закрытый ключ.',
        pfxFileOnly: 'PFX поддерживает только импорт файла.'
      },
      roles: {
        leaf: 'Leaf-сертификат',
        root: 'Корневой сертификат',
        intermediate: 'Промежуточный сертификат'
      },
      steps: {
        ariaLabel: 'Шаги импорта сертификата',
        source: 'Способ добавления',
        formatAndMethod: 'Формат и способ',
        materials: 'Материалы импорта',
        validateAndImport: 'Проверка и импорт'
      },
      formatIntro: {
        title: 'Выберите формат и способ импорта',
        description: 'Сначала подтвердите формат материалов, затем выберите загрузку файла или вставку текста. PFX сейчас поддерживает только импорт файла.'
      },
      labels: {
        importType: 'Тип импорта',
        importMethod: 'Способ импорта',
        materialStatus: 'Статус материалов'
      },
      status: {
        supported: 'Поддерживается',
        unsupported: 'Пока не поддерживается',
        completed: 'Завершено',
        incomplete: 'Не завершено',
        matched: 'Совпадает',
        unmatched: 'Не совпадает'
      },
      fields: {
        certificateChainFile: 'Файл цепочки сертификатов',
        certificatePemText: 'PEM-текст сертификата',
        privateKey: 'Закрытый ключ ({kind})',
        file: 'Файл',
        pemText: 'PEM-текст',
        pfxFile: 'Файл PFX/P12',
        certificateName: 'Имя сертификата',
        pfxPassword: 'Пароль PFX'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
        certificateName: 'Например: продуктивный сертификат example.com',
        required: 'Обязательно'
      },
      validation: {
        title: 'Проверить материалы импорта',
        description: 'Перед отправкой импорта проверьте цепочку сертификатов, срок действия, соответствие закрытого ключа и полноту материалов.',
        passed: 'Проверка пройдена, можно импортировать',
        failed: 'Проверка не пройдена'
      },
      report: {
        certificateSummary: 'Сводка сертификата',
        serialNumber: 'Серийный номер',
        validity: 'Срок действия',
        validityRange: '{start} до {end}',
        issuer: 'Издатель',
        issuerWithValue: 'Издатель: {value}',
        subject: 'Субъект',
        chainValidation: 'Проверка цепочки сертификатов',
        chainStatus: 'Статус цепочки',
        certificateCount: 'Количество сертификатов',
        privateKeyMatch: 'Соответствие закрытого ключа',
        provided: 'Предоставлено',
        matchResult: 'Результат совпадения',
        privateKeySource: 'Источник закрытого ключа',
        blockers: 'Блокирующие проблемы',
        warnings: 'Предупреждения'
      },
      selectedFile: 'Выбрано: {name}',
      upload: {
        choose: 'Выбрать файл',
        noFile: 'Файл не выбран'
      },
      importSuccess: 'Импорт успешен, ID версии сертификата: {id}',
      actions: {
        validating: 'Проверка...',
        validate: 'Начать проверку',
        cancel: 'Отмена',
        previous: 'Назад',
        next: 'Далее',
        importing: 'Импорт...',
        import: 'Импортировать сертификат'
      }
    },
    list: {
      filters: {
        keyword: 'Ключевое слово',
        domain: 'Домен',
        status: 'Статус'
      },
      placeholders: {
        assetKeyword: 'Домен / SAN / отпечаток',
        primaryDomain: 'example.com',
        versionKeyword: 'Имя / издатель / субъект / ID версии'
      },
      columns: {
        notBefore: 'Дата начала',
        notAfter: 'Дата окончания',
        associatedAsset: 'Связанный актив',
        applicationCount: 'Приложения',
        sourceType: 'Способ добавления',
        status: 'Статус',
        certificateVersionId: 'ID версии сертификата'
      },
      sourceTypes: {
        manual: 'Ручной импорт',
        internal_ca: 'Внутренний CA',
        enterprise_ca: 'Корпоративный CA',
        external_api: 'Внешний API',
        acme: 'ACME',
        unknown: 'Неизвестно'
      },
      lifecycle: {
        unknown: 'Неизвестно',
        expired: 'Истек',
        expiringSoon: 'Скоро истекает',
        valid: 'Действителен'
      },
      fallbacks: {
        unselectedDomain: 'Домен не выбран',
        unnamedDomain: 'Безымянный домен',
        noSupplement: 'Дополнительных сведений нет'
      },
      assets: {
        title: 'Список доменов',
        loadFailed: 'Не удалось загрузить список доменов',
        empty: 'Список доменов пуст',
        unselectedTitle: 'Домен не выбран',
        unselectedDescription: 'Сначала выберите логический домен сертификата слева.'
      },
      versions: {
        title: 'Список SSL-сертификатов',
        titleWithDomain: 'Список SSL-сертификатов для {domain}',
        description: 'Справа отображается список SSL-сертификатов текущего домена, включая имя сертификата, даты начала и окончания, издателя и субъекта.',
        loadFailed: 'Не удалось загрузить список SSL-сертификатов',
        emptyForDomain: 'В этом домене нет SSL-сертификатов',
        emptyForDomainDescription: 'Можно добавить версию сертификата этого домена кнопкой импорта справа от фильтров.',
        empty: 'SSL-сертификатов пока нет',
        toolbar: 'Список версий сертификатов',
        currentCount: 'Сейчас {count}'
      },
      actions: {
        toggleFilters: 'Фильтры',
        clear: 'Очистить',
        deleteRisk: 'Удаление напрямую удалит текущую версию сертификата; если она еще используется привязкой или развертыванием, система отклонит операцию.'
      },
      errors: {
        deleteFailed: 'Удаление не выполнено',
        materialRequiredForFormat: 'Необходимо предоставить материалы сертификата для текущего формата.',
        importFailedWithCheck: 'Импорт не выполнен, проверьте введенные материалы.',
        validateFailedWithCheck: 'Проверка не выполнена, проверьте введенные материалы.'
      },
      import: {
        description: 'Сейчас поддерживаются только PEM + KEY и PFX; каждый импорт должен включать серверный сертификат, полную цепочку промежуточных сертификатов и закрытый ключ. Корневой сертификат не обязателен, при отсутствии будет предупреждение. Закрытый ключ сохраняется только в системном хранилище Secret и не возвращается в API-ответах.'
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
      backDetail: 'Вернуться к деталям',
      columns: {
        domainName: 'Домен/цель',
        resourceId: 'ID ресурса',
        resourceType: 'Тип ресурса',
        status: 'Статус',
        updatedAt: 'Время обновления'
      },
      description: 'Привязки, цели развертывания и ссылки ресурсов сертификата {id}.',
      empty: 'Связей использования пока нет',
      loadFailed: 'Не удалось загрузить связи использования',
      title: 'Связи использования сертификата',
      toolbar: 'Связи использования'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: 'Имя пользователя + пароль',
        usernamePasswordWithUsername: 'Имя пользователя + пароль / {username}',
        sshKey: 'Закрытый ключ SSH',
        sshKeyWithUsername: 'Закрытый ключ SSH / {username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: 'Вызов структурированного HTTP API вместо разрозненных curl-команд.'
        },
        browser: {
          displayName: 'Шаг браузера',
          description: 'Переход, извлечение или проверка данных страницы в авторизованной сессии браузера.'
        },
        ssh: {
          displayName: 'Команда SSH',
          description: 'Объявляет выполняемую SSH-команду, сохраняя только ссылки на подключение и учетные данные.'
        },
        sftp: {
          displayName: 'Загрузка/скачивание SFTP',
          description: 'Загрузка или скачивание файлов через официальный SFTP step, подходит для установки сертификатов и конфигураций.'
        },
        scp: {
          displayName: 'Загрузка/скачивание SCP',
          description: 'Копирование файлов через SCP, подходит для простой доставки файлов на хост.'
        },
        verify: {
          displayName: 'Проверка',
          description: 'Проверяет HTTP-статус, текст, регулярное выражение или отпечаток сертификата.'
        },
        condition: {
          displayName: 'Ветвление',
          description: 'Выбирает дальнейший путь по наличию переменной или ее значению.'
        },
        transform: {
          displayName: 'Преобразование',
          description: 'Использует JSONata, чтобы преобразовать выходные данные в новые переменные контекста workflow.'
        },
        foreach: {
          displayName: 'Обход коллекции',
          description: 'Последовательно обходит динамическую коллекцию и выполняет одинаковые дочерние шаги для каждого элемента.'
        },
        checkpoint: {
          displayName: 'Точка восстановления',
          description: 'Сохраняет проверяемую сводку удалённого состояния перед записью на устройство.'
        },
        pluginAction: {
          displayName: 'Атомарное действие плагина',
          description: 'Вызывает одно действие плагина, явно объявленное DSL, не управляя порядком или откатом.'
        },
        wait: {
          displayName: 'Ожидание',
          description: 'Ожидает фиксированное число секунд и продолжает выполнение.'
        },
        manual: {
          displayName: 'Ручное подтверждение',
          description: 'Приостанавливает рабочий процесс до ручного подтверждения.'
        }
      },
      fields: {
        command: 'Команда',
        connectionRef: 'Переменная подключения',
        contentRef: 'Переменная содержимого',
        credential: 'Учетные данные',
        description: 'Описание',
        direction: 'Направление',
        expected: 'Ожидаемое значение',
        expectedHostKeyFingerprint: 'Отпечаток Host Key',
        hostKeyPolicy: 'Политика Host Key',
        hostRef: 'Переменная хоста',
        inputRef: 'Входная переменная',
        instruction: 'Инструкция подтверждения',
        localPath: 'Локальный путь',
        mode: 'Права файла',
        operator: 'Оператор',
        remotePath: 'Удаленный путь',
        seconds: 'Секунды ожидания',
        temporaryPath: 'Временный путь',
        timeoutMs: 'Таймаут, мс',
        timeoutSeconds: 'Таймаут, секунд',
        transformInput: 'Вход преобразования',
        itemsPath: 'Путь к коллекции',
        itemVariable: 'Переменная элемента',
        indexVariable: 'Переменная индекса',
        maxItems: 'Максимум элементов',
        foreachSteps: 'JSON дочерних шагов',
        checkpointName: 'Имя точки восстановления',
        checkpointCapture: 'JSON путей захвата',
        requiredForRollback: 'Требуется для отката',
        pluginId: 'ID плагина',
        capability: 'Возможность',
        actionId: 'ID действия',
        actionContractVersion: 'Версия контракта действия',
        actionInput: 'JSON входа действия',
        inputSchemaSha256: 'Дайджест входной схемы',
        outputSchemaSha256: 'Дайджест выходной схемы',
        writeEffect: 'Эффект записи',
        idempotencyKeyRef: 'Ссылка на ключ идемпотентности',
        outputFormat: 'Формат вывода',
        usernameVariable: 'Переменная имени пользователя',
        variable: 'Переменная',
        verifyType: 'Тип проверки',
        browserAction: 'Действие браузера',
        browserUrl: 'URL страницы',
        browserExtractions: 'JSON извлечений',
        browserVerification: 'JSON проверки'
      },
      options: {
        boolean: { yes: 'Да', no: 'Нет' },
        direction: {
          download: 'Скачать',
          upload: 'Загрузить'
        },
        hostKeyPolicy: {
          manualApproval: 'Ручное согласование',
          strict: 'Строгая проверка',
          trustOnFirstUse: 'Доверять при первом использовании'
        },
        operator: {
          equals: 'Равно',
          exists: 'Существует',
          notEquals: 'Не равно',
          notExists: 'Не существует'
        },
        transformFormat: {
          raw: 'Исходное значение',
          jsonString: 'JSON-строка'
        },
        verifyType: {
          certificateFingerprint: 'Отпечаток сертификата',
          httpStatus: 'HTTP-статус',
          regex: 'Регулярное выражение',
          textContains: 'Текст содержит'
        }
      },
      stages: {
        backup: {
          title: 'Резервное копирование',
          description: 'Сохраняет материалы для отката.'
        },
        install: {
          title: 'Установка',
          description: 'Развертывает сертификаты или конфигурацию.'
        },
        prepare: {
          title: 'Подготовка',
          description: 'Готовит подключения, переменные и материалы.'
        },
        refresh: {
          title: 'Обновление',
          description: 'Перезагружает сервис или обновляет цель.'
        },
        verify: {
          title: 'Проверка',
          description: 'Подтверждает соответствие результата ожиданиям.'
        }
      },
      defaults: {
        displayName: 'Рабочий процесс {name}',
        nodes: {
          backupExistingCertificate: 'Резервное копирование текущего сертификата',
          reloadService: 'Перезагрузка сервиса'
        },
        variables: {
          certificatePaths: {
            description: 'Конфигурация путей целевого сертификата'
          },
          credential: {
            description: 'Учетные данные подключения'
          },
          deviceHost: {
            description: 'Целевой хост'
          },
          serverCert: {
            description: 'Материалы серверного сертификата для развертывания',
            outputs: {
              certFile: {
                description: 'Файл серверного сертификата'
              },
              keyFile: {
                description: 'Файл закрытого ключа'
              }
            }
          },
          sshUsername: {
            description: 'Имя пользователя для входа по SSH'
          },
          verifyUrl: {
            description: 'Адрес проверки после развертывания'
          }
        },
        config: {
          conditionDescription: 'Проверить наличие переменной целевого хоста',
          manualInstruction: 'Подтвердите, что сертификат целевого устройства переключен на новую версию.'
        }
      },
      variableFlow: {
        system: 'Система',
        variable: 'Переменная'
      },
      errors: {
        unknownNodeType: 'Неизвестный тип узла: {type}',
        missingWorkflowDsl: 'Сервер не вернул DSL рабочего процесса'
      }
    },
    canvasEditor: {
      summary: 'Узлов {nodes}, связей {edges}, переменных {variables}',
      stageNodeCount: 'Узлов: {count}',
      copyLabel: 'Копия {label}',
      actions: {
        addVariable: 'Добавить переменную',
        collapseBottomPanelAria: 'Свернуть нижнюю панель управления',
        collapseDown: 'Свернуть вниз',
        copy: 'Копировать',
        copyNode: 'Копировать узел',
        delete: 'Удалить',
        deleteNode: 'Удалить узел',
        expandBottomPanelAria: 'Развернуть нижнюю панель управления',
        expandPanel: 'Развернуть панель',
        layout: 'Упорядочить макет',
        mockCurrentNode: 'Симулировать только текущий узел',
        mockRunning: 'Симуляция...',
        paste: 'Вставить',
        pasteNode: 'Вставить узел',
        realRun: 'Реальный пробный запуск текущего узла',
        realRunHttp: 'Реальный пробный запуск текущего HTTP-узла',
        realRunRunning: 'Пробный запуск...',
        realRunSsh: 'Реальное выполнение текущего SSH-узла',
        realRunTransfer: 'Реальный пробный запуск передачи файлов',
        redo: 'Повторить',
        saveDraft: 'Сохранить черновик',
        saving: 'Сохранение...',
        undo: 'Отменить',
        zoomIn: 'Увеличить',
        zoomOut: 'Уменьшить'
      },
      aria: {
        bottomPanel: 'Нижняя панель',
        canvasArea: 'Область canvas',
        dslPanel: 'Панель DSL',
        nodePalette: 'Библиотека узлов',
        propertiesPanel: 'Панель свойств',
        runtimePanel: 'Панель выполнения',
        toolbar: 'Панель инструментов canvas рабочего процесса',
        validationPanel: 'Панель проверки',
        variablesPanel: 'Панель переменных'
      },
      credentialHints: {
        savedApiKey: 'Сохраненный API Key',
        savedBearerToken: 'Сохраненный Bearer token',
        savedSshSftp: 'Сохраненные учетные данные SSH / SFTP',
        savedUsernamePassword: 'Сохраненные имя пользователя + пароль'
      },
      credentials: {
        emptyCreateHint: 'Доступных учетных данных пока нет. Сначала создайте их в управлении учетными данными на странице списка.',
        loading: 'Загрузка списка учетных данных...'
      },
      dsl: {
        title: 'Импорт и перезапись DSL',
        hint: 'Можно вставить внешний DSL JSON напрямую или выбрать локальный файл DSL. Импорт перезаписывает только текущий canvas в браузере; новая версия рабочего процесса появится только после нажатия "Сохранить черновик".',
        selectFile: 'Выбрать DSL-файл',
        actions: {
          importOverwrite: 'Импортировать DSL и перезаписать canvas',
          resetToCanvas: 'Вернуть DSL текущего canvas',
          openStepEditor: 'Редактировать DSL текущего узла в окне',
          openStepEditorAria: 'Редактировать DSL текущего узла в окне',
          applyStepEditor: 'Применить изменения',
          cancelStepEditor: 'Отмена'
        },
        editor: {
          title: 'Редактирование DSL текущего узла',
          description: 'Измените полный JSON и примените его. Некорректный JSON не перезапишет текущий узел.',
          ariaLabel: 'Содержимое DSL текущего узла'
        },
        messages: {
          fileLoaded: 'Файл загружен: {fileName}',
          imported: 'DSL импортирован и перезаписал текущий canvas, узлов: {count}.',
          resetToCompiled: 'Скомпилированный DSL возвращен.'
        },
        errors: {
          importFailed: 'Импорт DSL не выполнен',
          invalidTopLevel: 'Неверная верхнеуровневая структура DSL, должен быть объект.'
        }
      },
      empty: {
        selectNodeToEdit: 'Выберите узел, чтобы редактировать свойства.'
      },
      errors: {
        backendValidationFailed: 'Проверка не пройдена',
        credentialsLoadFailed: 'Не удалось загрузить учетные данные рабочего процесса',
        missingStepName: 'Отсутствует имя шага',
        missingWorkflowDsl: 'Не удалось получить DSL рабочего процесса'
      },
      fields: {
        authType: 'Тип аутентификации',
        clientCertificate: 'Клиентский сертификат',
        clientPrivateKey: 'Клиентский закрытый ключ',
        command: 'Команда',
        connectionVariable: 'Переменная подключения',
        contentRef: 'Ссылка на содержимое',
        cookieName: 'Имя Cookie',
        credential: 'Учетные данные',
        credentialSelector: 'Выбор учетных данных',
        defaultValue: 'Значение по умолчанию',
        deliveryLocation: 'Место передачи',
        description: 'Описание',
        direction: 'Направление',
        fileMode: 'Права файла',
        headerName: 'Имя Header',
        hostRefOrHostname: 'Переменная хоста / имя хоста',
        hostVariable: 'Переменная хоста',
        keyName: 'Имя Key',
        localPath: 'Локальный путь',
        newNodeStage: 'Этап нового узла',
        nodeName: 'Имя узла',
        remotePath: 'Удаленный путь',
        requestBody: 'Тело запроса',
        requestBodyStructuredHint: 'Запрос использует структурированные поля form или multipart. Изменяйте их в редакторе DSL.',
        requestBodyEmptyHint: 'Для этого запроса тело не настроено.',
        required: 'Обязательно',
        secretValue: 'Секретное значение',
        sensitive: 'Чувствительное',
        stage: 'Этап',
        temporaryPath: 'Временный путь',
        timeoutSeconds: 'Таймаут, секунд',
        type: 'Тип',
        username: 'Имя пользователя',
        variableName: 'Имя переменной'
      },
      options: {
        download: 'Скачать',
        manualInput: 'Ввести вручную',
        notSelected: 'Не выбрано',
        upload: 'Загрузить'
      },
      runtime: {
        noCredentialVariables: 'В текущем рабочем процессе нет переменных учетных данных.',
        noExtraVariables: 'У текущего узла нет дополнительных переменных выполнения.'
      },
      sections: {
        httpAuth: 'HTTP-аутентификация',
        nodePalette: 'Библиотека узлов',
        properties: 'Панель свойств',
        referenceFlow: 'Поток ссылок',
        runtimeCredentialVariables: 'Переменные учетных данных выполнения',
        runtimeVariables: 'Переменные выполнения',
        singleNodeTest: 'Тестовый запуск одного узла',
        variableConfig: 'Конфигурация переменных'
      },
      tabs: {
        runtime: 'Выполнение',
        validation: 'Проверка',
        variables: 'Переменные'
      },
      test: {
        cause: 'Причина',
        code: 'Код',
        emptyHint: 'Выберите узел, затем можно выполнить симуляцию или реальный пробный запуск.',
        error: 'Ошибка',
        executionPlan: 'План выполнения',
        exitCode: 'Код выхода',
        failureDetails: 'Детали ошибки',
        hint: 'Подсказка теста',
        logs: 'Журналы',
        nodeOutput: 'Вывод узла',
        running: 'Выполняется',
        stage: 'Этап',
        stderr: 'Стандартная ошибка',
        stdout: 'Стандартный вывод',
        suggestion: 'Рекомендация',
        target: 'Цель',
        errors: {
          mockRunFailed: 'Симуляция не выполнена',
          realRunFailed: 'Реальный пробный запуск не выполнен'
        },
        messages: {
          mockCompleted: 'Симуляция завершена.',
          mockFailed: 'Симуляция не выполнена.',
          realCompleted: 'Реальный пробный запуск завершен.',
          realFailed: 'Реальный пробный запуск не выполнен.'
        }
      },
      validation: {
        levels: {
          error: 'Ошибка',
          risk: 'Риск',
          warning: 'Предупреждение'
        },
        location: {
          canvas: 'Canvas',
          edge: 'Связь',
          fieldSuffix: 'поле',
          node: 'Узел'
        },
        noBlockingErrors: 'Блокирующих ошибок нет.'
      },
      variables: {
        customRuntimeDescription: 'Пользовательская переменная выполнения',
        notUsed: 'Не используется',
        usedBy: 'Используется в: {nodes}'
      }
    },
    templates: {
      title: 'Рабочие процессы',
      resourceName: 'Рабочий процесс',
      description: 'Управление версиями CURL/SSH/SFTP рабочих процессов, статусом публикации и историей изменений по черновикам canvas.',
      pluginSources: {
        createTitle: 'Создать из плагина', applyTitle: 'Создать черновик из плагина', description: 'Показаны только сертификатные процессы из включенных плагинов. Сначала выберите процесс, затем версию плагина.',
        createAction: 'Создать процесс', applyAction: 'Создать черновик', currentTarget: 'Текущий процесс: {name}', namePlaceholder: 'Введите имя процесса', loading: 'Загрузка источников плагина...', empty: 'Нет доступных источников плагина.', version: 'Версия плагина', workflowVersion: 'Версия рабочего процесса', versionSource: 'Источник версии: {plugin} / {version} / {capability}',
        capabilities: { deploy: 'Развертывание сертификата', rollback: 'Откат сертификата' }, errors: { loadFailed: 'Не удалось загрузить источники плагина', nameRequired: 'Введите имя процесса', missingApplyTarget: 'Целевой процесс отсутствует', actionFailed: 'Не удалось скопировать процесс плагина' }
      },
      origins: { user: 'Пользовательский', plugin_internal: 'Встроенный в плагин' },
      actions: {
        addVersion: 'Добавить версию',
        applyTemplate: 'Применить шаблон',
        cancel: 'Отмена',
        close: 'Закрыть',
        createBlank: 'Создать пустой',
        credentialManagement: 'Управление учетными данными',
        delete: 'Удалить',
        detail: 'Детали',
        edit: 'Редактировать',
        publishVersion: 'Опубликовать версию',
        rename: 'Переименовать',
        saveName: 'Сохранить имя',
        saveNote: 'Сохранить примечание',
        switchVersion: 'Переключить версию',
        templateManagement: 'Управление шаблонами',
        versionManagement: 'Управление версиями'
      },
      states: {
        creating: 'Создание...',
        loading: 'Загрузка...',
        processing: 'Обработка...',
        saving: 'Сохранение...'
      },
      fields: {
        actions: 'Операции',
        createdAt: 'Время создания',
        currentStatus: 'Текущий статус',
        currentVersion: 'Текущая версия',
        currentVersionId: 'ID текущей версии',
        id: 'ID рабочего процесса',
        name: 'Имя рабочего процесса',
        origin: 'Источник',
        note: 'Примечание',
        status: 'Статус',
        updatedAt: 'Время обновления'
      },
      filters: {
        showNonDeployment: 'Показать рабочие процессы не для развертывания'
      },
      empty: {
        description: 'Сначала создайте черновик canvas, затем публикуйте версии в рабочий контур.',
        noChangeSummary: 'Описание изменений отсутствует.',
        noChangeSummaryShort: 'Нет описания изменений',
        noVersions: 'Версий пока нет.',
        title: 'Рабочих процессов пока нет'
      },
      tabs: {
        summary: 'Обзор',
        versions: 'Версии'
      },
      versionStatuses: {
        disabled: 'Отключено',
        draft: 'Черновик',
        published: 'Опубликовано'
      },
      detail: {
        description: 'Просмотр деталей рабочего процесса, черновика canvas и списка версий.',
        publishedVersion: 'Текущая опубликованная версия {version}',
        title: 'Детали рабочего процесса',
        titleWithName: 'Рабочий процесс {name}'
      },
      rename: {
        title: 'Имя рабочего процесса',
        description: 'Изменяет имя в списках и подробностях без перезаписи исторических версий.',
        placeholder: 'Введите имя рабочего процесса',
        messages: { success: 'Имя рабочего процесса обновлено.' },
        errors: { required: 'Имя рабочего процесса обязательно.', failed: 'Не удалось изменить имя рабочего процесса.' }
      },
      versionManager: {
        description: 'Управление созданием и публикацией версий рабочего процесса без изменения содержимого canvas.',
        titleWithName: 'Управление версиями: {name}'
      },
      changeSummaries: {
        createFromPlugin: 'Создать процесс из возможности плагина',
        applyFromPlugin: 'Создать черновик из возможности плагина',
        applyFromFileTemplate: 'Черновик рабочего процесса перезаписан из файлового шаблона',
        createCanvasDraft: 'Черновик рабочего процесса создан из frontend canvas',
        createFromFileTemplate: 'Черновик рабочего процесса создан из файлового шаблона',
        createVersionDraft: 'Новая черновая версия создана из управления версиями',
        saveCanvasDraft: 'Черновая версия сохранена из редактора canvas'
      },
      messages: {
        canvasDraftUpdated: 'Текущая черновая версия обновлена.',
        switchedVersion: 'Переключено на {version}.',
        versionDraftCreated: 'Новая черновая версия создана.',
        versionNoteUpdated: 'Примечание версии обновлено.'
      },
      errors: {
        createVersionFailed: 'Не удалось создать версию рабочего процесса',
        loadVersionsFailed: 'Не удалось загрузить версии рабочего процесса',
        missingWorkflowDsl: 'Не удалось получить DSL рабочего процесса',
        publishVersionFailed: 'Не удалось опубликовать версию рабочего процесса',
        saveCanvasDraftFailed: 'Не удалось сохранить черновик canvas',
        updateVersionNoteFailed: 'Не удалось обновить примечание версии'
      },
      delete: {
        riskText: 'Удаление отключит этот рабочий процесс и все его версии, они больше не будут отображаться в списке; исторические записи выполнения не изменяются.'
      },
      loading: {
        versions: 'Загрузка версий...'
      },
      fileTemplates: {
        applyAction: 'Перезаписать текущий рабочий процесс шаблоном',
        applyTitle: 'Перезаписать рабочий процесс файловым шаблоном',
        createAction: 'Создать рабочий процесс по шаблону',
        createTitle: 'Создать рабочий процесс из файлового шаблона',
        currentTarget: 'Текущая цель: {name}',
        description: 'Файлы шаблонов берутся из встроенной библиотеки шаблонов или каталога пользовательского импорта. При перезаписи существующего рабочего процесса создается новая черновая версия, история не переписывается.',
        empty: 'Распознаваемых файлов шаблонов рабочих процессов пока нет.',
        identifier: 'Идентификатор {name}',
        invalid: 'Недействителен',
        invalidFile: 'Файл недействителен',
        loading: 'Сканирование файловых шаблонов...',
        valid: 'Доступен',
        sources: {
          builtin: 'Встроенный',
          userImported: 'Импортирован пользователем'
        },
        errors: {
          actionFailed: 'Не удалось выполнить действие файлового шаблона',
          loadFailed: 'Не удалось загрузить файловые шаблоны рабочих процессов',
          missingApplyTarget: 'Не указана цель рабочего процесса для перезаписи'
        }
      },
      credentials: {
        actions: {
          create: 'Создать учетные данные'
        },
        addTitle: 'Добавить учетные данные',
        count: '{count} шт.',
        description: 'Централизованное управление логинными и API-учетными данными для рабочих процессов с возможностью выбора и переиспользования в canvas и узлах.',
        empty: 'Записей учетных данных пока нет. После создания их можно выбирать в переменных, SSH-узлах и HTTP-узлах.',
        loading: 'Загрузка сведений учетных данных...',
        registeredTitle: 'Зарегистрированные учетные данные',
        title: 'Управление учетными данными',
        fields: {
          deliveryLocation: 'Место передачи',
          headerOrParam: 'Header / имя параметра',
          name: 'Имя учетных данных',
          referenceLocation: 'Место ссылки',
          storageType: 'Тип хранения',
          type: 'Тип учетных данных',
          username: 'Имя пользователя'
        },
        kinds: {
          common: {
            family: 'Общие'
          },
          sshKey: {
            title: 'Закрытый ключ SSH'
          },
          usernamePassword: {
            title: 'Имя пользователя + пароль'
          }
        },
        secretLabels: {
          password: 'Пароль',
          sshKey: 'Закрытый ключ SSH'
        },
        placeholders: {
          apiKey: 'Введите API Key',
          bearer: 'Введите Bearer token',
          password: 'Введите пароль входа',
          sshKey: 'Вставьте закрытый ключ в формате PEM'
        },
        messages: {
          created: 'Учетные данные созданы; их можно выбирать в переменных рабочего процесса, SSH-узлах и HTTP-узлах.'
        },
        errors: {
          createFailed: 'Не удалось создать учетные данные',
          loadFailed: 'Не удалось загрузить учетные данные',
          missingCreatedId: 'Создание учетных данных не вернуло действительный номер'
        }
      }
    }
  },
  monitoring: {
    tls: monitoringTlsRuRU,
    actions: {
      add: 'Добавить мониторинг',
      probe: 'Проверить сайт',
      probing: 'Проверка...',
      refresh: 'Обновить данные',
      refreshing: 'Обновление...',
      remove: 'Удалить'
    },
    errors: {
      addFailed: 'Не удалось добавить цель мониторинга',
      deleteFailed: 'Не удалось удалить цель мониторинга',
      invalidTarget: 'Данные цели мониторинга недействительны',
      loadFailed: 'Не удалось загрузить данные мониторинга',
      probeFailed: 'Запрос проверки не выполнен',
      updateIntervalFailed: 'Не удалось обновить частоту проверки'
    },
    empty: {
      actualCertificate: 'Фактически измеренного TLS-сертификата пока нет. HTTPS-цели автоматически собирают сведения о сертификате при проверке сайта.',
      description: 'Нажмите "Добавить мониторинг" справа вверху; система будет проверять сайт с заданной частотой и синхронно собирать сведения о сертификате.',
      noAddableAssets: 'Нет доступных для добавления активов приложений; для существующих целей измените частоту проверки в деталях.',
      observedCertificateHistory: 'Привязанных версий сертификатов пока нет. После получения первого сертификата проверкой сайта он будет сохранен автоматически.',
      probeHistory: 'Истории проверок пока нет.',
      riskEvents: 'Связанных событий пока нет.',
      title: 'Целей мониторинга пока нет'
    },
    sections: {
      actualCertificate: 'Текущий фактически измеренный сертификат сайта',
      actualCertificateHint: 'Автоматически собирается при проверке сайта',
      observedCertificateHistory: 'Привязанные версии сертификатов',
      observedCertificateHistoryHint: 'Хранит версии по изменениям фактически измеренных TLS-сертификатов',
      probeHistory: 'История проверок',
      probeHistoryHint: 'Последние 20 результатов системных проверок',
      riskEvents: 'События риска',
      riskEventsHint: 'Цепочка сертификатов, домен, отпечаток и статус выполнения',
      targets: 'Цели мониторинга'
    },
    labels: {
      applicationAsset: 'Актив приложения',
      currentTarget: 'Текущая цель',
      probeInterval: 'Частота проверки',
      secondsUnit: 'секунд',
      millisecondsUnit: 'ms'
    },
    metrics: {
      availability: 'Доступность',
      certificateStatus: 'Статус сертификата',
      latency: 'Задержка доступа',
      observedCertificateChanges: 'Изменения измеренного сертификата'
    },
    probe: {
      completed: 'Проверка завершена',
      emptyHistoryBlock: 'Проверка {index}: пока нет данных',
      latencyNotCollected: 'Задержка не собрана',
      recentAria: 'Последние 10 результатов проверки',
      waiting: 'Ожидание проверки сайта'
    },
    status: {
      error: 'Ошибка',
      none: 'Ожидает выполнения',
      ready: 'Норма',
      warning: 'Предупреждение',
      removed: 'Удалено'
    },
    warnings: {
      certificateNotApplied: 'По данным системной проверки последняя версия сертификата домена ещё не применена',
      chainVerificationFailed: 'Системная проверка обнаружила ошибку проверки цепочки сертификата'
    },
    fallback: {
      noEndpoint: 'Адрес доступа не настроен',
      noFingerprint: 'Нет отпечатка',
      notClosed: 'Не закрыто',
      noSummary: 'Нет сводки',
      notCollected: 'Не собрано',
      notSelected: 'Не выбрано',
      unknownAsset: 'Неизвестный актив',
      removedAsset: '{name} (удалено)',
      unknownCertificate: 'Неизвестный сертификат',
      unknownIssuer: 'Неизвестный издатель',
      unnamedEvent: 'Безымянное событие'
    },
    certificate: {
      actualCertificate: 'Фактически измеренный сертификат',
      chainUntrusted: 'Не прошел проверку системной цепочкой доверия',
      chainVerification: 'Проверка цепочки',
      chainVerified: 'Цепочка проверена',
      chainVerifyFailedWithReason: 'Проверка цепочки не пройдена: {reason}',
      collectedAt: 'Время сбора',
      issuer: 'Издатель',
      serialNumber: 'Серийный номер',
      sha256Fingerprint: 'Отпечаток SHA-256',
      subject: 'Субъект',
      validity: 'Срок действия',
      validityRange: '{start} до {end}'
    },
    columns: {
      certificateName: 'Имя сертификата',
      changedAt: 'Время замены',
      closedAt: 'Время закрытия предупреждения',
      currentStatus: 'Текущий статус',
      expiresAt: 'Время истечения',
      issuerName: 'Имя издателя',
      latency: 'Задержка',
      occurredAt: 'Время возникновения',
      result: 'Результат',
      source: 'Источник',
      status: 'Статус',
      time: 'Время',
      warningContent: 'Содержание предупреждения'
    },
    dialog: {
      defaultMetricsHint: 'По умолчанию мониторятся доступность, задержка доступа, сведения о сертификате и история сертификатов.',
      description: 'Выберите цель из списка активов приложений; система будет фиксированно собирать доступность, задержку, сведения о сертификате и историю сертификатов.',
      loadingAssets: 'Загрузка активов...',
      selectAsset: 'Выберите актив приложения',
      title: 'Добавить мониторинг'
    },
    source: {
      controlPlane: 'Платформа'
    },
    targets: {
      assetCount: 'Активов: {count}',
      lazyLoadHint: 'Загружено {shown} / {total}, прокрутите для загрузки'
    }
  },
  login: {
    visualLabel: 'Описание продукта',
    brand: 'GCAC',
    brandSecondary: 'Платформа централизованного управления сертификатами',
    headlinePrefix: 'Сделайте управление сертификатами',
    headlineHighlight: 'умнее',
    headlineSuffix: ' и безопаснее',
    intro: 'Единое управление сертификатными активами, автоматизированная оркестрация развертывания и сквозной аудит превращают эксплуатацию сертификатов из ручной рутины в проверяемый и прослеживаемый стандартизованный процесс, защищающий цифровую инфраструктуру предприятия.',
    capabilitiesLabel: 'Возможности платформы',
    featureLifecycle: 'Управление полным жизненным циклом',
    featureLifecycleDesc: 'От импорта, продления и отслеживания версий до предупреждений об истечении: покрыт каждый этап работы с сертификатными активами.',
    featureAutomation: 'Автоматизированная оркестрация развертывания',
    featureAutomationDesc: 'Для Nginx, Tomcat, IIS и других распространенных сред одним действием формируются аудируемые планы развертывания.',
    featureRollback: 'Безопасное выполнение и откат',
    featureRollbackDesc: 'Автоматическая проверка перед развертыванием, полный след выполнения и откат при ошибке обеспечивают стабильность продуктивной среды.',
    formLabel: 'Форма входа',
    secure: 'Защищенное соединение',
    welcome: 'Вход в консоль',
    hint: 'Используйте корпоративную учетную запись для входа в рабочую область GCAC',
    username: 'Имя пользователя',
    usernamePlaceholder: 'Введите имя пользователя',
    password: 'Пароль',
    passwordPlaceholder: 'Введите пароль',
    failed: 'Вход не выполнен, повторите позже',
    submitting: 'Проверка личности...',
    submit: 'Войти',
    policy: 'Защита прав RBAC',
    audit: 'Полный аудит операций'
  },
  internalCa: internalCaEnglish,
  applicationOnboarding: {
    eyebrow: 'Мастер подключения приложения', title: 'Добавить актив приложения', description: 'Выберите платформу и настройте устройство, сайт и сертификат.', stepsAria: 'Шаги подключения приложения',
    steps: { platform: 'Платформа', device: 'Устройство', target: 'Сайт', certificate: 'Сертификат', complete: 'Готово' },
    platforms: { customManual: 'Пользовательское ручное создание', manualHint: 'Использовать ручной сценарий', pluginHint: 'Фиксированный сценарий плагина платформы', capabilityVersion: 'Версия возможности подключения', compatibility: 'Поддерживаемые версии', requiredInformation: 'Необходимые сведения', inReview: 'Проверка возможностей выполняется', searchLabel: 'Поиск платформ', searchPlaceholder: 'Поиск по названию приложения, версии платформы или данным подключения', pluginCenterPrompt: 'Не нашли нужное приложение?', pluginCenterAction: 'Открыть центр плагинов' },
    device: { title: 'Подключение платформы', existing: 'Использовать устройство', new: 'Добавить устройство', deviceId: 'ID устройства', selectPlaceholder: 'Выберите устройство', noExisting: 'Нет доступных работоспособных устройств для этой платформы.', existingLoading: 'Загрузка совместимых устройств.', refreshExisting: 'Обновить устройства', newDescription: 'Открывает единый мастер подключения устройств и возвращает сюда после регистрации Agent или подключения устройства.', newAction: 'Открыть подключение устройства', username: 'Имя пользователя', password: 'Пароль', host: 'Адрес', port: 'Порт' },
    resource: { title: 'Выберите ресурс платформы', refresh: 'Обновить ресурсы', loading: 'Загрузка доступных ресурсов.', empty: 'Ресурсы платформы отсутствуют.' },
    target: { title: 'Выберите сайт', siteName: 'Название сайта', selectedSite: 'Выбранный сайт', accessDomain: 'Домен доступа', verifyUrl: 'URL проверки', accessDomainPlaceholder: 'например, ikuai.jacksonz.cn', verifyUrlPlaceholder: 'например, https://ikuai.jacksonz.cn:443', domainHint: 'Точка управления может быть IP-адресом, но домен доступа и URL проверки должны использовать одно DNS-имя.', invalidConfiguration: 'Введите корректный DNS-домен доступа и URL проверки для того же узла.', listenAddress: 'Адрес прослушивания', listenPort: 'Порт прослушивания', protocol: 'Протокол', selectable: 'Доступная управляемая цель', notSelectable: 'Недоступно для выбора', unavailableReason: 'Причина недоступности', missingValue: 'Не указано', reasons: { managedTargetInactive: 'Эта управляемая цель неактивна.', workflowCapabilityMissing: 'Эта цель не поддерживает выполнение рабочего процесса, необходимого платформе.', targetEndpointMissing: 'Для этой цели не указан полный адрес, порт или протокол прослушивания.', unknown: 'Эта цель сейчас не соответствует условиям выбора.' } }, certificate: { title: 'Выберите версию сертификата', asset: 'Актив сертификата', version: 'Версия сертификата', requiredFormat: 'Платформа требует сертификат в формате {formats}' },
    complete: { title: 'Подключение завершено', description: 'Актив приложения и план развертывания созданы.' },
    actions: { customManual: 'Ручное создание', openWizard: 'Мастер подключения', previous: 'Назад', continue: 'Продолжить', refresh: 'Обновить сайты', review: 'Проверить сертификат', complete: 'Завершить', cancel: 'Отмена' },
    messages: { requestFailed: 'Ошибка запроса. Проверьте права и данные.', noPlatforms: 'Нет доступных платформ.', noSearchResults: 'Подходящие платформы не найдены.' }
  },
  tenantArchitecture: { nav: 'Структура группы', eyebrow: 'Мультитенантное управление', title: 'Структура группы', description: 'Управление группами, дочерними компаниями и администраторами.', mode: { aria: 'Режим структуры группы', label: 'Режим структуры группы', hierarchical: 'Включен', single: 'Выключен', updated: 'Последнее обновление: {time}' }, actions: { checking: 'Проверка', preflight: 'Предпроверка', enabling: 'Включение', enable: 'Включить', rollingBack: 'Откат', rollback: 'Выключить', suspend: 'Приостановить', resume: 'Возобновить', revokeAdministrator: 'Отозвать администратора' }, preflight: { title: 'Предпроверка включения', summary: 'Блокировки: {blockers}', passed: { title: 'Условия выполнены', summary: 'Проверок пройдено: {count}' }, blocked: { title: 'Требуется действие', summary: 'Блокировок: {count}', description: 'Устраните следующие проблемы перед повторным запуском предпроверки.' } }, confirm: { enable: 'Включить структуру группы?', rollback: 'Вернуться к одному tenant?', revokeAdministrator: 'Отозвать эту связь администратора?' }, messages: { preflightCompleted: 'Предпроверка завершена.', enabled: 'Структура включена.', rolledBack: 'Возвращен режим одного tenant.', companyCreated: 'Дочерняя компания создана.', administratorAdded: 'Администратор настроен.', administratorRevoked: 'Связь администратора отозвана.', statusUpdated: 'Статус обновлен.' }, errors: { emptyMode: 'Состояние не возвращено.', loadFailed: 'Не удалось загрузить структуру.', preflightFailed: 'Предпроверка не удалась.', enableFailed: 'Не удалось включить структуру.', rollbackFailed: 'Откат не удался.', companyCreateFailed: 'Не удалось создать дочернюю компанию.', administratorFailed: 'Не удалось настроить администратора.', administratorRevokeFailed: 'Не удалось отозвать администратора.', statusFailed: 'Не удалось обновить статус.' }, company: { title: 'Добавить дочернюю компанию', name: 'Название', namePlaceholder: 'Введите название', code: 'Код', codePlaceholder: 'Введите уникальный код', submit: 'Создать' }, administrator: { title: 'Администратор дочерней компании', tenant: 'Дочерняя компания', tenantPlaceholder: 'Выберите компанию', subjectId: 'ID пользователя', subjectPlaceholder: 'Введите ID пользователя', submit: 'Добавить администратора', empty: 'Администратор не настроен' }, tree: { aria: 'Схема структуры группы', empty: 'В текущей области управления нет доступных tenant.' }, history: { aria: 'Последние записи режима', title: 'Последние записи режима', kind: { PREFLIGHT: 'Предпроверка', ENABLE: 'Включение', ROLLBACK: 'Откат' }, status: { RUNNING: 'Выполняется', COMPLETED: 'Завершено', FAILED: 'Ошибка' } }, types: { GROUP: 'Группа', COMPANY: 'Дочерняя компания' }, status: { ACTIVE: 'Активен', SUSPENDED: 'Приостановлен' }, membership: { owner: 'Владелец', admin: 'Администратор' } },
  tenantSwitcher: { title: 'Сменить tenant', aria: 'Доступные tenant', current: 'Текущий', switching: 'Переключение', confirm: 'Перейти к {tenant}?', success: 'Выполнен переход к {tenant}.', errors: { contextStale: 'Контекст tenant устарел. Список обновлен.', membershipRequired: 'Нет активного членства в целевом tenant.', modeConflict: 'Режим tenant сейчас меняется.', switchFailed: 'Переключение не удалось. Сохранен прежний tenant.' } },
  errors: {
    forbiddenTitle: '403 Нет прав',
    forbiddenMessage: 'У вас нет прав, необходимых для доступа к этой странице.',
    missingPermission: 'Отсутствует право: {permission}',
    notFoundTitle: '404 Страница не найдена',
    notFoundMessage: 'Эта страница не существует, проверьте адрес.',
    backDashboard: 'Вернуться на панель мониторинга',
    back: 'Назад',
    logout: 'Выйти'
  }
} as const
