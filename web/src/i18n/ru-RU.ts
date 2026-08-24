// Auto-generated from messages.ts — do not edit manually.
// Edit messages.ts and re-run: npx tsx src/i18n/extract-locales.ts
export default {
  app: {
    brand: 'Консоль GCAC',
    platform: 'Корпоративная платформа управления жизненным циклом SSL-сертификатов',
    defaultBreadcrumb: 'Консоль',
    dashboard: 'Панель мониторинга'
  },
  common: {
    refresh: 'Обновить',
    logout: 'Выйти',
    enter: 'Войти',
    loading: 'Загрузка',
    userFallback: 'Пользователь не вошел',
    tenantFallback: 'Тенант по умолчанию'
  },
  api: {
    errors: {
      requestFailed: 'Запрос не выполнен'
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
    dryRunChecklist: {
      title: 'Итоги предварительной проверки Dry-run',
      ariaLabel: 'итоги предварительной проверки dry-run',
      empty: 'Результаты предварительной проверки dry-run еще не сформированы.',
      unnamedCheck: 'Безымянная проверка'
    },
    dryRunResult: {
      title: 'Результат выполнения Dry-run',
      close: 'Закрыть'
    },
    modal: {
      closeAria: 'Закрыть диалоговое окно'
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
      ERROR: 'Ошибка',
      IGNORED: 'Игнорируется',
      ONLINE: 'В сети',
      OFFLINE: 'Не в сети',
      DISABLED: 'Отключено',
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
      hint: {
        streaming: 'Статус задачи и журналы будут обновляться в реальном времени.',
        autoRefresh: 'Статус задачи и журналы будут обновляться автоматически.',
        pollingFallback: 'Сейчас используется периодическое обновление.'
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
        execution: 'Выполнение'
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
        warning: 'Есть предупреждения'
      },
      step: {
        backup: 'Предварительное резервное копирование',
        discover: 'Распознавание среды',
        installDryRun: 'Подготовка материалов',
        installExecution: 'Установка сертификата',
        reload: 'Обновление сервиса',
        verify: 'Проверка результата'
      },
      subtitle: {
        completed: 'Задача завершена.',
        failed: 'Задача завершена, но вернула ошибку.',
        failedChecks: 'Проверок: {total}, ошибок: {failed}',
        passedChecks: 'Проверок пройдено: {total}',
        queued: 'Задача создана и ожидает выполнения.',
        running: 'Задача запущена, ожидание результата.',
        runningChecks: 'Получено проверок: {total}',
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
        targetSelectedDetail: 'Цель развертывания выбрана; перед отправкой рекомендуется выполнить dry-run.',
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
        workflowMode: 'Режим рабочего процесса'
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
  shell: {
    currentLocation: 'Текущее местоположение',
    breadcrumb: 'Навигационная цепочка',
    currentGroupNavigation: 'Навигация текущей группы',
    backDashboard: 'Вернуться на панель мониторинга'
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
  userMenu: {
    currentUser: 'Текущий пользователь',
    changePassword: 'Изменить пароль',
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
  nav: {
    dashboard: 'Обзор',
    dashboardDesc: 'Обзор состояния приложений, сертификатов, Agent, шлюзов и аудита',
    certificates: 'Сертификаты',
    certificatesDesc: 'Хранилище сертификатов, привязки и срок действия',
    certificateAssets: 'Сертификатные активы',
    certificateAssetsDesc: 'Сертификаты, ссылки на закрытые ключи, отпечатки и сроки действия',
    certificateFormats: 'Конфигурации форматов сертификатов',
    certificateFormatsDesc: 'Правила форматов PFX, CER, CRT, PEM и других для сохраненных сертификатов',
    assets: 'Активы приложений',
    assetsDesc: 'Входы приложений и цели развертывания сертификатов по домену/IP',
    agents: 'Agent',
    agentsDesc: 'Онлайн-статус, heartbeat и набор возможностей',
    gateways: 'Шлюзы',
    gatewaysDesc: 'Шлюзы изолированных зон, протоколы и доступные цели',
    deployments: 'Развертывание сертификатов',
    deploymentsDesc: 'Планы развертывания и записи выполнения',
    deploymentPlans: 'Планы развертывания',
    deploymentPlansDesc: 'Планы развертывания сертификатов и входы согласования',
    executions: 'Записи выполнения',
    executionsDesc: 'Шаги выполнения, журналы, ошибки и откат',
    workflows: 'Рабочие процессы',
    workflowsDesc: 'Рабочие процессы и плагины',
    workflowTemplates: 'Рабочие процессы',
    workflowTemplatesDesc: 'Черновики canvas, переменные, декларации возможностей и публикация',
    automations: 'Автоматизация',
    automationsDesc: 'Плановые, ручные и пакетные планы обновления сертификатов',
    plugins: 'Плагины',
    pluginsDesc: 'Provider, исполнители и состояние песочницы',
    monitoring: 'Мониторинг',
    monitoringDesc: 'Оповещения, аудит и состояние сертификатов',
    monitorAlerts: 'Оповещения мониторинга',
    monitorAlertsDesc: 'События истечения, дрейфа и ошибок выполнения',
    audits: 'Журналы аудита',
    auditsDesc: 'Доказательства операций и экспорт для соответствия',
    settings: 'Настройки',
    settingsDesc: 'Тенанты, пользователи, права и системная конфигурация',
    systemSettings: 'Системные настройки',
    systemSettingsDesc: 'Системная конфигурация и метаданные безопасности',
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
    common: { notAvailable: 'Нет данных' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'The automation will process {domains} using: {version}. The target snapshot is frozen when the run starts.' },
    form: { existingAssetTitle: 'Обновлять только существующие активы приложений', existingAssetDescription: 'Автоматизация обрабатывает только активы с существующими привязками сертификатов. Первичная установка и добавление целей не выполняются.', certificateDomains: 'Домены сертификата', certificateDomainsPlaceholder: 'Введите домены через запятую', certificateDomainsHelp: 'Обновляются только существующие привязки активов для этих доменов.', versionSelection: 'Версия сертификата для развертывания', versionSelectionLatest: 'Автоматически использовать последнюю версию', versionSelectionSpecific: 'Использовать указанные версии', versionSelectionHelp: 'Версия определяется и фиксируется в начале запуска.', certificateVersionIds: 'Указанные версии сертификата', certificateVersionIdsPlaceholder: 'Введите ID версий через запятую', certificateVersionIdsHelp: 'Каждая версия должна принадлежать сертификату, выбранному по доменам.', versionLoading: 'Загрузка доступных версий сертификата.', versionLoadFailed: 'Не удалось загрузить версии. Повторите попытку позже.', versionEmpty: 'Для этих доменов нет доступных версий.', schedule: 'Когда обновлять', scheduleHelp: 'Запускайте по запросу или периодически по Cron и часовому поясу.', execution: 'Что происходит при запуске', executionHelp: 'Для каждой существующей привязки создается отдельный план с повторным использованием DeploymentPlan, Dry Run, согласования и ExecutionRun.', snapshot: 'Зафиксировать снимок домена, актива и версии сертификата' },
    fields: { name: 'Название', description: 'Описание', trigger: 'Триггер', cron: 'Выражение Cron', timeZone: 'Часовой пояс', expiresWithinDays: 'Срок истечения в днях', environments: 'Целевые среды (через запятую)', certificateIds: 'Конкретные сертификаты (необязательно)', certificateIdsPlaceholder: 'Введите ID сертификатов через запятую', certificateIdsHelp: 'Если указано, обрабатываются только эти сертификаты; иначе применяются правила срока и среды.', expiresWithinDaysHelp: 'Выбирать только сертификаты, истекающие в этот период.', environmentsHelp: 'Обрабатывать сертификаты только из указанных сред.', planType: 'Тип плана развертывания', planTypeHelp: 'При запуске для каждой подходящей цели создается отдельный DeploymentPlan.', planTypeUpdate: 'Обновить существующую привязку сертификата', planTypeInstall: 'Установить сертификат на цель', planTypeVerifyOnly: 'Только проверить, без изменения сертификата', planMode: 'Режим запуска', planModeHelp: 'Автоматизация не связывается с существующим планом; для каждой цели создается новый план.', planModeCreateAndExecute: 'Создать и выполнить план', planModeCreateOnly: 'Только создать планы, без выполнения', maxTargets: 'Максимум целей за запуск', concurrency: 'Параллельность', failureCount: 'Порог количества ошибок', requireDryRun: 'Требовать Dry Run перед выполнением', requireApproval: 'Требовать согласование перед выполнением', startedAt: 'Время начала', finishedAt: 'Время завершения', failureStage: 'Этап ошибки', parentRun: 'Родительский запуск' },
    actions: { create: 'Создать автоматизацию', edit: 'Изменить', delete: 'Удалить', cancel: 'Отмена', save: 'Сохранить', copy: 'Копировать', enable: 'Включить', disable: 'Отключить', preview: 'Предпросмотр целей', history: 'История запусков', confirmRun: 'Подтвердить запуск', stop: 'Остановить запуск', retryFailed: 'Повторить ошибки', openPlan: 'Открыть план развертывания', openExecution: 'Открыть выполнение' },
    columns: { trigger: 'Триггер', targets: 'Лимит целей', actions: 'Действия', nextRun: 'Следующий запуск', lastRun: 'Последний запуск' },
    triggers: { onDemand: 'По запросу', schedule: 'По расписанию' },
    triggerTypes: { on_demand: 'По запросу', schedule: 'По расписанию', retry: 'Повтор ошибок' },
    actionTypes: { create_deployment_plan: 'Создать план обновления сертификата', execute_deployment_plan: 'Выполнить план обновления сертификата', send_notification: 'Отправить уведомление' },
    summaries: { targets: 'До {count} целей' },
    preview: { title: 'Предпросмотр целей', description: 'Проверьте снимок целей и исключения, которые будут зафиксированы при запуске.', matched: 'Совпадений: {count}', executable: 'Можно выполнить: {count}', excluded: 'Исключено: {count}', ready: 'Готово' },
    exclusions: { permission_denied: 'Нет доступа к цели', missing_version: 'Версия сертификата отсутствует', version_not_deployable: 'Версия сертификата недоступна для развертывания', binding_not_managed: 'Привязка не управляется', environment_not_allowed: 'Среда не разрешена', unknown: 'Неизвестная причина исключения' },
    failureStages: { selection: 'Выбор целей', plan_creation: 'Создание плана', dry_run: 'Dry Run', approval: 'Согласование', execution: 'Выполнение', verification: 'Проверка', rollback: 'Откат', notification: 'Уведомление' },
    progress: { total: 'Всего', pending: 'Ожидание', running: 'Выполняется', waitingApproval: 'Ожидает согласования', succeeded: 'Успешно', failed: 'Ошибка', skipped: 'Пропущено', cancelled: 'Отменено' },
    editor: { createTitle: 'Создать автоматизацию', editTitle: 'Изменить автоматизацию', description: 'Настройте время запуска, сертификаты, создание планов и поведение при ошибке.', sections: { basic: 'Основная информация', basicHelp: 'Укажите понятное имя автоматизации и опишите изменения сертификатов.', targets: 'Обрабатываемые сертификаты', targetsHelp: 'Выбираются цели-сертификаты, а не существующие планы; снимок целей фиксируется при запуске.', plan: 'План развертывания сертификата', planRelationTitle: 'Существующий план развертывания не привязывается', planRelationDescription: 'План создается во время запуска по фильтрам сертификатов.', planRelationHelp: 'Для каждой цели создается собственный DeploymentPlan, его ID отображается в деталях запуска.', guardrails: 'Контроль безопасности', guardrailsHelp: 'Эти ограничения управляют размером пакета, проверкой, согласованием и остановкой при ошибках.' }, chain: { createPlan: 'Создать DeploymentPlan для каждой цели', dryRun: 'Выполнить предварительную проверку Dry Run', approval: 'Дождаться согласования', executePlan: 'Выполнить DeploymentPlan цели' } },
    runs: { title: 'История автоматизаций', description: 'Просмотр состояния запуска, неизменяемых снимков целей и этапов ошибок.', progress: 'Успешно {succeeded}/{total}' },
    runDetail: { title: 'Детали запуска автоматизации', description: 'Версия конфигурации {version}', noFailure: 'Ошибок нет' },
    aria: { preview: 'Предпросмотр целей автоматизации', runs: 'Список запусков автоматизации', progress: 'Ход выполнения автоматизации' },
    errors: { loadFailed: 'Не удалось загрузить автоматизации' }
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
    dangerConfirmRequired: 'Операция высокого риска требует подтверждения',
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
      failure: {
        emptyMessage: 'Конкретное сообщение об ошибке не получено'
      },
      running: {
        dispatched: 'Задача Agent отправлена ({taskId}), ожидание результата выполнения.',
        waitingAgentResult: 'Шаг выполняется, ожидание результата от Agent...'
      },
      pending: {
        waitingDependency: 'Шаг ожидает завершения предыдущего шага.'
      },
      verifyRecovered: {
        detail: 'Удаленная TLS-проверка на стороне Agent завершилась ошибкой, но система выполнила реальную TLS-проверку {remoteTarget} и подтвердила соответствие целевого сертификата. {originalError}',
        originalSuffix: 'Исходная ошибка Agent: {originalError}'
      },
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
      noLogs: 'Журналов пока нет.'
    },
    tabs: {
      summary: 'Обзор',
      steps: 'Шаги',
      logs: 'Журналы'
    }
  },
  plugins: {
    title: 'Плагины',
    description: 'Управление пакетами плагинов, исполнителями, декларациями прав и состоянием изоляции песочницы.',
    resourceName: 'Плагин',
    actions: {
      install: 'Установить плагин',
      detail: 'Детали',
      disable: 'Отключить плагин',
      disableRisk: 'Отключение плагина повлияет на возможности Provider, шаблонов и исполнителей.'
    },
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
    fields: {
      pluginId: 'ID плагина',
      name: 'Название плагина',
      currentStatus: 'Текущий статус',
      version: 'Версия',
      signatureStatus: 'Статус подписи',
      riskLevel: 'Уровень риска'
    }
  },
  deploymentPlans: {
    title: 'Планы развертывания',
    description: 'Предпросмотр плана, область влияния, согласование, партии выполнения, проверка и входы отката.',
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
      submit: 'Отправить на согласование',
      submitRisk: 'После отправки план перейдет в состояние согласования или ожидания выполнения.',
      execute: 'Выполнить развертывание',
      executeRisk: 'Выполнение изменит целевую конфигурацию сертификатов. Уже завершенные или ошибочные планы также используют этот вход для повторного выполнения; перед выполнением нужен Dry-run предпросмотр влияния.',
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
        description: 'Планы в ожидании согласования, выполнения или уже выполняющиеся.'
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
      approvalStatus: 'Статус согласования',
      certificateVersionId: 'ID версии сертификата',
      certificateFormatId: 'ID конфигурации формата сертификата',
      currentAssetCertificateExpiresAt: 'Окончание текущего сертификата',
      updateNeeded: 'Требует обновления',
      targetSummary: 'Сводка целевых привязок',
      latestRun: 'Последняя партия выполнения',
      approvalId: 'ID согласования',
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
      missingApproval: 'Нет сведений о пройденном согласовании, выполнение невозможно.',
      needDryRun: 'Перед реальным выполнением нужно завершить успешный Dry-run предпросмотр влияния.',
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
      noTargetSummary: 'Сводка целей не предоставлена',
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
      copy: 'Текущая операция: {action}. Сначала выполните Dry-run, подтвердите область влияния и итоги проверок, затем продолжайте реальное выполнение.',
      description: 'Перед реальным выполнением нужен успешный Dry-run предпросмотр влияния.',
      primaryAction: 'Сначала Dry-run',
      runningAction: 'Запуск Dry-run...',
      title: 'Сначала требуется Dry-run'
    },
    execution: {
      applyName: 'Выполнение развертывания {runId}',
      applyTitle: 'Выполнение обновления сертификата',
      dryRunTitle: 'Результат Dry-run',
      fallbackName: 'Выполнение {runId}',
      rollbackTitle: 'Выполнение отката сертификата'
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
      executeTriggered: 'Развертывание запущено.',
      executeTriggeredWithPlanId: 'Развертывание запущено (план {planId}).',
      executeTriggeredWithRunId: 'Развертывание запущено ({runId}), ход выполнения смотрите в диалоговом окне.',
      loadedDraft: 'Черновик плана загружен.',
      loadedDraftWithPlanId: 'Черновик загружен (план {planId}).',
      savedWithPlanId: 'План сохранен ({planId}).',
      submitted: 'План развертывания отправлен.',
      submittedWithPlanId: 'План развертывания отправлен (план {planId}).'
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
      startDryRunFailed: 'Не удалось запустить dry-run'
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
      commandCopied: 'Команда установки скопирована',
      copyCommand: 'Скопировать команду установки',
      copyToken: 'Скопировать код установки',
      expired: 'Истек',
      generateCommand: 'Сформировать команду установки',
      generating: 'Формирование...',
      modalDescription: 'Выберите платформу и версию, чтобы сформировать одноразовую команду установки. Код установки действует 10 минут и может быть использован только один раз.',
      modalTitle: 'Установка Agent',
      platform: 'Платформа',
      platformLinuxDescription: 'Подходит для Ubuntu, Debian, CentOS, Rocky, AlmaLinux и других дистрибутивов Linux.',
      platformWindowsDescription: 'Подходит для Windows Server и Windows 10/11; после установки регистрируется как системная служба.',
      remainingTime: '{minutes} мин {seconds} сек',
      remainingValidity: 'Оставшийся срок действия',
      singleUseHint: 'Как только bootstrap-скрипт запросит этот код установки, он сразу станет недействительным и не сможет быть использован повторно.',
      tokenCopied: 'Код установки скопирован',
      version: 'Версия',
      versionLatest: 'Последняя стабильная версия',
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
    aria: {
      assetHeatmap: 'Тепловая карта состояния активов приложений',
      certificateStatusList: 'Список статусов сертификатов',
      metrics: 'Ключевые метрики',
      quickActions: 'Основные функциональные входы',
      statusHeatmap: 'Состояние сертификатов, Agent, шлюзов и активов приложений',
      statusLegend: 'Легенда статусов'
    },
    assets: {
      groupCount: '{summary} · {total} шт.',
      title: 'Состояние активов приложений',
      updatedAt: 'Обновлено {time}'
    },
    audit: {
      description: 'В первую очередь показываются ошибки, отказы, высокие риски и ключевые бизнес-изменения.',
      title: 'Последние журналы аудита'
    },
    certificateState: {
      critical: 'Близко к истечению',
      expired: 'Истек',
      expiring: 'Скоро истекает',
      unknown: 'Неизвестно',
      valid: 'Норма'
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
      noObjects: 'Объектов пока нет'
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
    quickActions: {
      agents: {
        title: 'Agent',
        description: 'Посмотреть онлайн-статус и возможности задач.'
      },
      assets: {
        title: 'Активы приложений',
        description: 'Сопровождение доменов, портов и целей развертывания.'
      },
      audits: {
        title: 'Журналы аудита',
        description: 'Отследить оператора и результат выполнения.'
      },
      certificates: {
        title: 'Управление сертификатами',
        description: 'Импорт, просмотр и преобразование сертификатов.'
      },
      deploymentPlans: {
        title: 'Планы развертывания',
        description: 'Создание и выполнение планов обновления сертификатов.'
      },
      gateways: {
        title: 'Шлюзы',
        description: 'Управление входами выполнения в изолированных зонах.'
      }
    },
    statusBlock: {
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
      agents: {
        title: 'Agent'
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
      addGatewayAgent: 'Добавить Gateway Agent',
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
      description: 'Добавьте Gateway Agent или включите роль Gateway на существующем Agent.',
      title: 'Шлюзов пока нет'
    },
    errors: {
      generateEnableCommandFailed: 'Не удалось сформировать команду включения Gateway.',
      generateInstallCommandFailed: 'Не удалось сформировать команду установки Gateway Agent.',
      missingEnableCommand: 'Система не вернула команду включения Gateway.',
      missingInstallCommand: 'Система не вернула команду установки Gateway Agent.'
    },
    fields: {
      config: 'Конфигурация',
      enableCommand: 'Команда включения',
      expiresAt: 'Время истечения',
      installCode: 'Код установки',
      installCommand: 'Команда установки',
      platform: 'Платформа',
      region: 'Регион',
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
        title: 'Добавить Gateway Agent'
      }
    },
    page: {
      description: 'Управление Gateway Agent региональной маршрутизации.',
      title: 'Шлюзы'
    },
    platforms: {
      linuxSystemd: {
        description: 'Установить сервис Gateway Agent на Linux-хост'
      },
      windowsService: {
        description: 'Установить сервис Gateway Agent на Windows-хост'
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
    fallbacks: {
      unknown: 'Неизвестно'
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
    securityLabel: 'Вход в настройки безопасности',
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
        clearSelection: 'Очистить выбор'
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
        missingRoleId: 'Не получен ID роли',
        createRoleFailed: 'Не удалось создать роль',
        grantRoleFailed: 'Не удалось выдать права роли',
        roleNoObjectScopes: 'У этой роли пока нет авторизованных областей объектов; сначала выдайте права роли.',
        assignMembersFailed: 'Не удалось назначить участников',
        deleteRoleFailed: 'Не удалось удалить роль',
        missingObjectSetId: 'Не получен ID области объектов'
      },
      confirm: {
        deleteRole: 'Подтвердить удаление роли "{name}"? После удаления будут также удалены назначения пользователей и объектные авторизации этой роли.'
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
          description: 'Планы развертывания, выполнение, откат и согласование'
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
        bindPasswordCreate: 'Введите пароль сервисной учетной записи',
        bindPasswordEdit: 'Оставьте пустым, чтобы сохранить текущий пароль',
        autoByDirectoryType: 'Оставьте пустым для автоматического вывода по типу каталога',
        userFilter: 'Например: (uid={{username}})',
        groupFilter: 'Например: (member={{userDn}})'
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
        ldap: 'Стандартный LDAP'
      },
      risks: {
        delete: 'После удаления источника идентификации вход, синхронизация и сопоставление групп этого каталога станут недействительными.'
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
    actions: {
      create: 'Создать конфигурационный файл',
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
  assets: {
    title: 'Активы приложений',
    description: 'Управление входами приложений по домену или IP с фокусом на адрес, порт, протокол, сайт и позиционирование выполнения.',
    resourceName: 'Актив приложения',
    actions: {
      add: 'Добавить актив',
      edit: 'Редактировать',
      detail: 'Детали',
      addVariable: 'Добавить переменную',
      delete: 'Удалить',
      rollbackFromLatestSnapshot: 'Запустить откат из последнего снимка',
      rollingBack: 'Откат...',
      saving: 'Сохранение...',
      creating: 'Создание...',
      saveChanges: 'Сохранить изменения',
      confirmCreate: 'Подтвердить создание'
    },
    columns: {
      domain: 'Домен доступа',
      port: 'Порт',
      protocol: 'Протокол',
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
      verifyUrl: 'URL проверки',
      platform: 'Платформа',
      frameworkType: 'Тип фреймворка',
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
      artifactFormat: 'Конфигурация формата артефакта'
    },
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
      optionalOutput: 'Можно не выбирать'
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
      dslSyncHint: 'Синхронизировано с целевыми переменными DSL'
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
        verifyHost: 'Хост проверки',
        verifyPort: 'Порт проверки',
        verifyPath: 'Путь проверки',
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
      loadWorkflowCredentialsFailed: 'Не удалось загрузить учетные данные рабочего процесса',
      noAvailableSiteInstance: 'Доступный экземпляр сайта не найден; сначала убедитесь, что сайты фреймворка успешно отправлены в деталях Agent.'
    },
    platforms: {
      appliance: 'Устройство'
    },
    runners: {
      controlPlane: 'Платформа'
    },
    status: {
      archived: 'Архивировано',
      unknownStatus: 'Неизвестный статус'
    },
    common: {
      required: 'Обязательно',
      optional: 'Необязательно'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'Запрос не выполнен'
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
          agentName: 'Имя Agent',
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
        versionKeyword: 'Имя / издатель / субъект / ID версии'
      },
      columns: {
        notBefore: 'Дата начала',
        notAfter: 'Дата окончания',
        associatedAsset: 'Связанный актив',
        status: 'Статус',
        certificateVersionId: 'ID версии сертификата'
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
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: 'Вызов структурированного HTTP API вместо разрозненных curl-команд.'
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
        outputFormat: 'Формат вывода',
        usernameVariable: 'Переменная имени пользователя',
        variable: 'Переменная',
        verifyType: 'Тип проверки'
      },
      options: {
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
        unknownNodeType: 'Неизвестный тип узла: {type}'
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
        savedBearerToken: 'Сохраненный Bearer Token',
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
          resetToCanvas: 'Вернуть DSL текущего canvas'
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
        note: 'Примечание',
        status: 'Статус',
        updatedAt: 'Время обновления'
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
      versionManager: {
        description: 'Управление созданием и публикацией версий рабочего процесса без изменения содержимого canvas.',
        titleWithName: 'Управление версиями: {name}'
      },
      changeSummaries: {
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
          bearer: 'Введите Bearer Token',
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
      probeInterval: 'Частота проверки'
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
      warning: 'Предупреждение'
    },
    fallback: {
      noEndpoint: 'Адрес доступа не настроен',
      noFingerprint: 'Нет отпечатка',
      noSummary: 'Нет сводки',
      notCollected: 'Не собрано',
      notSelected: 'Не выбрано',
      unknownAsset: 'Неизвестный актив',
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
      expiresAt: 'Время истечения',
      issuerName: 'Имя издателя',
      latency: 'Задержка',
      result: 'Результат',
      source: 'Источник',
      status: 'Статус',
      time: 'Время'
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
      assetCount: 'Активов: {count}'
    }
  },
  login: {
    visualLabel: 'Описание продукта',
    brand: 'Консоль сертификатов GCAC',
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
  compatibility: {
    title: 'Каталог совместимости', description: 'Поддержка, ограничения и доказательства берутся из профилей совместимости.', generatedAt: 'Сформировано: {time}', loading: 'Загрузка каталога…', loadFailed: 'Не удалось загрузить каталог', none: 'Нет',
    columns: { profile: 'Профиль', version: 'Версия', status: 'Статус', automation: 'Автоматизация', evidence: 'Доказательство', verifiedAt: 'Последняя проверка', limitations: 'Ограничения' },
    status: { certified: 'Сертифицировано', supported: 'Поддерживается', compatible: 'Совместимо', experimental: 'Экспериментально', legacy: 'Устаревшее', unsupported: 'Не поддерживается' },
    evidence: { current: 'Актуально', expired: 'Просрочено', failed: 'Ошибка' }
  },
  errors: {
    forbiddenTitle: '403 Нет прав',
    forbiddenMessage: 'У вас нет прав, необходимых для доступа к этой странице.',
    missingPermission: 'Отсутствует право: {permission}',
    notFoundTitle: '404 Страница не найдена',
    notFoundMessage: 'Эта страница не существует, проверьте адрес.',
    backDashboard: 'Вернуться на панель мониторинга'
  }
} as const
