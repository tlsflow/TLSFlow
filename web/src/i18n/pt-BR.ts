// GCAC 国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { internalCaEnglish } from './internal-ca.locale'
import { devicesPtBR } from './devices.locale'
import { caOperationsPtBR } from './ca-operations.locale'
import { credentialsPtBR } from './credentials.locale'
import { providersPtBR } from './providers.locale'
import { monitoringTlsPtBR } from './monitoring-tls.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
export default {
  credentials: credentialsPtBR,
  devices: devicesPtBR,
  caOperations: caOperationsPtBR,
  providers: providersPtBR,
  app: {
    brand: 'Console GCAC',
    platform: 'Plataforma de ciclo de vida de certificados SSL corporativos',
    defaultBreadcrumb: 'Console',
    dashboard: 'Painel',
    versionLabel: 'Versão {version}'
  },
  common: {
    refresh: 'Atualizar',
    logout: 'Sair',
    enter: 'Abrir',
    loading: 'Carregando',
    actions: { done: 'Concluído' },
    cancel: 'Cancelar',
    save: 'Salvar',
    edit: 'Editar',
    delete: 'Excluir',
    notAvailable: 'Indisponível',
    close: 'Fechar',
    unknownError: 'Erro desconhecido',
    userFallback: 'Usuário não autenticado',
    tenantFallback: 'Tenant padrão'
  },
  api: {
    errors: {
      requestFailed: 'Falha na requisição'
    }
  },
  auth: {
    errors: {
      missingSession: 'Falha no login: nenhuma sessão válida foi obtida'
    },
    mock: {
      displayName: 'Usuário do sistema (Mock)'
    }
  },
  designSystem: {
    confirm: {
      title: 'Confirmar {action}',
      impactCount: 'Recursos afetados: {count}',
      defaultRisk: 'Esta operação pode acionar implantação, nova tentativa, rollback ou alterações irreversíveis.',
      typeToConfirm: 'Digite {text} para confirmar',
      cancel: 'Cancelar',
      confirm: 'Confirmar'
    },
    dataTable: {
      empty: 'Nenhum dado',
      loading: 'Carregando...'
    },
    dryRunChecklist: {
      title: 'Conclusão da pré-verificação Dry-run',
      ariaLabel: 'conclusão da pré-verificação dry-run',
      empty: 'Nenhum resultado de pré-verificação dry-run foi gerado ainda.',
      unnamedCheck: 'Item de verificação sem nome'
    },
    dryRunResult: {
      title: 'Resultado da execução Dry-run',
      close: 'Fechar'
    },
    modal: {
      closeAria: 'Fechar modal'
    },
    toast: {
      close: 'Fechar'
    },
    drawer: {
      closeAria: 'Fechar painel'
    },
    secretInput: {
      label: 'Referência de Secret',
      placeholder: 'Selecione ou informe uma referência de segredo (SecretRef); o conteúdo não será armazenado em texto claro',
      hint: 'Campos sensíveis armazenam apenas referências de segredo e não exibem valores em texto claro na interface.'
    },
    riskBadge: {
      levelPrefix: 'Nível: '
    },
    status: {
      DRAFT: 'Rascunho',
      PUBLISHED: 'Publicado',
      PENDING_APPROVAL: 'Pendente de aprovação',
      READY: 'Pronto para execução',
      RUNNING: 'Em execução',
      SUCCESS: 'Sucesso',
      PARTIAL_SUCCESS: 'Sucesso parcial',
      FAILED: 'Falha',
      CANCELLED: 'Cancelado',
      ROLLED_BACK: 'Revertido',
      DISCOVERED: 'Descoberto',
      MANAGED: 'Gerenciado',
      DRIFTED: 'Com desvio',
      EXPIRED: 'Expirado',
      REVOKED: 'Revogado',
      ERROR: 'Erro',
      IGNORED: 'Ignorado',
      ONLINE: 'Online',
      OFFLINE: 'Offline',
      ACTIVE: 'Ativo',
      DISABLED: 'Desabilitado',
      OPEN: 'Aberto',
      ACKED: 'Reconhecido',
      RESOLVED: 'Resolvido',
      UPGRADING: 'Atualizando',
      UPDATE_REQUIRED: 'Atualização necessária',
      UP_TO_DATE: 'Atualizado',
      UNKNOWN: 'Desconhecido'
    },
    risk: {
      LOW: {
        label: 'Baixo',
        description: 'Exige atenção, mas não bloqueia diretamente a operação.'
      },
      MEDIUM: {
        label: 'Médio',
        description: 'Pode afetar a implantação ou os resultados de monitoramento e exige confirmação.'
      },
      HIGH: {
        label: 'Alto',
        description: 'Pode causar interrupção de serviço ou exposição de segurança.'
      },
      CRITICAL: {
        label: 'Crítico',
        description: 'Deve ser tratado com prioridade. Operações de risco exigem confirmação secundária.'
      }
    },
    capability: {
      available: 'Disponível',
      missing: 'Ausente',
      title: 'Compatibilidade de capacidades',
      description: 'Exibe apenas resultados de compatibilidade de capacidades já confirmados; itens não confirmados não são considerados compatíveis.',
      matrixLabel: 'Matriz de compatibilidade de capacidades',
      satisfied: 'Atendido',
      unknown: 'Desconhecido',
      manualRisk: 'Confirmação manual',
      empty: 'Nenhum dado de compatibilidade de capacidades disponível.'
    },
    executionLogViewer: {
      mode: {
        realtime: 'Atualização em tempo real',
        autoRefresh: 'Atualização automática'
      },
      search: {
        placeholder: 'Pesquisar conteúdo dos logs'
      },
      level: {
        aria: 'Nível do log',
        all: 'Todos'
      },
      actions: {
        showAll: 'Mostrar todos os {count}',
        showRecent: 'Mostrar os últimos {count}'
      },
      hint: {
        streaming: 'O status da tarefa e os logs serão atualizados em tempo real.',
        autoRefresh: 'O status da tarefa e os logs serão atualizados automaticamente.',
        pollingFallback: 'Atualmente usando atualização periódica.',
        limited: 'Mostrando os últimos {visible} de {total} logs.'
      },
      steps: {
        aria: 'Etapas de execução',
        emptyDetail: 'Ainda não há descrição da etapa'
      },
      empty: {
        logs: 'Ainda não há logs.'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: 'Visão geral do progresso da execução',
        taskList: 'Lista de tarefas',
        latestEvents: 'Eventos mais recentes',
        executionLog: 'Log de execução'
      },
      checklist: {
        title: 'Conclusões das verificações'
      },
      detail: {
        stepsCompleted: '{completed}/{total} etapas concluídas',
        summaryFailed: '{total} resultados de verificação retornados, {failed} com falha',
        summaryPassed: 'Todas as {passed} verificações foram aprovadas',
        summaryReturned: '{total} resultados de verificação retornados',
        summaryWarning: '{total} resultados de verificação retornados, {warning} avisos',
        waitingStart: 'Aguardando o início da tarefa',
        waitingSteps: 'Aguardando as etapas de execução'
      },
      empty: {
        activity: 'Os logs de execução serão exibidos gradualmente após a conclusão da tarefa.',
        events: 'Nenhum evento registrado ainda.',
        tasks: 'A tarefa ainda não foi criada; aguardando as etapas de execução…'
      },
      event: {
        collapse: 'Recolher eventos',
        defaultLabel: 'Evento',
        defaultTitle: 'Evento da tarefa',
        expand: 'Expandir eventos',
        waitingDetail: 'Aguardando registro do evento'
      },
      feed: {
        completed: 'Execução concluída',
        failed: 'Execução com falha',
        skipped: 'Ignorada',
        warning: 'Concluída com avisos'
      },
      loading: {
        pollingFallback: 'Atualizando periodicamente…',
        refreshing: 'Atualizando'
      },
      log: {
        collapse: 'Recolher log completo',
        expand: 'Ver log completo'
      },
      metrics: {
        completed: 'Concluídas',
        failed: 'Falhas',
        passed: 'Aprovadas',
        queued: 'Na fila',
        running: 'Em execução',
        totalTasks: 'Total de tarefas',
        unknown: 'Desconhecidas',
        warning: 'Avisos'
      },
      process: {
        dryRun: 'Verificação da atualização',
        execution: 'Execução'
      },
      operation: {
        prepare: 'Verificar o certificado e o estado do destino antes da atualização.',
        backup: 'Salvar o estado atual para permitir uma restauração segura.',
        update: 'Aplicar o novo certificado ao serviço de destino.',
        reload: 'Carregar o novo certificado e aguardar a estabilização do serviço.',
        verify: 'Confirmar que o serviço está usando o novo certificado corretamente.',
        rollback: 'Restaurar o certificado e o estado do serviço anteriores.'
      },
      progress: {
        completed: 'Tudo concluído',
        failed: 'Concluído com itens com falha',
        pending: 'Aguardando gravação dos resultados',
        processFailed: '{process} falhou',
        queued: 'Aguardando agendamento',
        running: 'Tarefa em andamento',
        warning: 'Concluído com alertas de risco'
      },
      section: {
        completedCount: '{completed}/{total} concluídas',
        executionLog: 'Log de execução',
        latestEvents: 'Eventos mais recentes',
        taskProgress: 'Progresso da tarefa'
      },
      status: {
        completed: 'Concluída',
        failed: 'Falha',
        queued: 'Aguardando',
        running: 'Em execução',
        skipped: 'Ignorada',
        warning: 'Com aviso'
      },
      step: {
        backup: 'Backup prévio',
        discover: 'Identificação do ambiente',
        prepare: 'Preparação do certificado',
        installDryRun: 'Preparação dos materiais',
        installExecution: 'Instalação do certificado',
        updateDryRun: 'Verificação da atualização',
        updateExecution: 'Atualização do certificado',
        reload: 'Atualização do serviço',
        verify: 'Validação do resultado'
      },
      subtitle: {
        completed: 'A tarefa foi concluída.',
        failed: 'A tarefa terminou, mas retornou resultado de falha.',
        failedFriendly: 'Não foi possível concluir esta etapa. Abra os detalhes para ver o motivo.',
        failedChecks: '{total} verificações, {failed} com falha',
        passedChecks: '{total} verificações aprovadas',
        queued: 'A tarefa foi criada e aguarda execução.',
        running: 'A tarefa foi iniciada; aguardando resultados.',
        runningChecks: '{total} verificações retornadas',
        skipped: 'Esta etapa foi ignorada e não continuará aguardando.',
        warningChecks: '{total} verificações, {warning} avisos'
      },
      time: {
        waitingStart: 'Aguardando início'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: 'Cancelar',
        dryRun: 'Executar Dry-run primeiro',
        next: 'Próximo',
        previous: 'Anterior',
        save: 'Salvar plano'
      },
      aria: {
        steps: 'Etapas de implantação',
        wizard: 'Assistente de implantação'
      },
      capability: {
        targetMissingDetail: 'Nenhum alvo de implantação foi selecionado.',
        targetSelectedDetail: 'Alvo de implantação selecionado; é recomendável concluir o dry-run antes de enviar.',
        targetSelection: 'Seleção do alvo de implantação',
        targetSource: 'Alvo de implantação'
      },
      checks: {
        failed: 'Falha {count}',
        passed: 'Aprovado {count}',
        unknown: 'Desconhecido {count}',
        unnamed: 'Item de verificação sem nome',
        warning: 'Aviso {count}'
      },
      empty: {
        noTargets: 'Nenhum alvo de ativo de aplicação disponível',
        selectTarget: 'Selecione um alvo de implantação de ativo de aplicação.'
      },
      fallback: {
        generatedByApplicationEntry: 'Gerado pela entrada da aplicação',
        missingBinding: 'Informações de binding não fornecidas',
        unboundCertificateVariable: 'Variável de certificado não vinculada',
        unconfigured: 'Não configurado',
        unconfiguredRunner: 'Local de execução não configurado',
        unknownEnd: 'Término desconhecido',
        unknownStart: 'Início desconhecido',
        unnamedSite: 'Site sem nome',
        unnamedVersion: 'Versão sem nome',
        unrecognizedManagedTarget: 'Alvo gerenciado não reconhecido',
        unselected: 'Não selecionado',
        unselectedVersion: 'Versão não selecionada',
        unselectedWorkflow: 'Workflow não selecionado'
      },
      fields: {
        applicationTarget: 'Alvo de implantação do ativo de aplicação',
        artifactConfig: 'Configuração do artefato',
        binding: 'Vínculo',
        certificateAsset: 'Ativo de certificado',
        certificateVariable: 'Variável de certificado',
        certificateVersion: 'Versão do certificado',
        deploymentTarget: 'Alvo de implantação',
        keyword: 'Pesquisa por palavra-chave',
        managedTarget: 'Alvo gerenciado',
        runner: 'Local de execução',
        site: 'Site',
        verifyUrl: 'URL de verificação',
        version: 'Versão',
        workflow: 'Fluxo de trabalho'
      },
      panels: {
        certificateTitle: '1. Material do certificado',
        submitTitle: '3. Pré-verificação e envio',
        targetTitle: '2. Alvo de implantação'
      },
      panelState: {
        needPrerequisites: 'Seleções prévias pendentes',
        operable: 'Operável',
        pending: 'Pendente',
        readyNext: 'Pronto para a próxima etapa'
      },
      placeholders: {
        selectTarget: 'Selecione o alvo do ativo de aplicação',
        targetKeyword: 'Pesquisar por domínio, site ou informações de binding'
      },
      plan: {
        dryRunCompleted: 'O dry-run mais recente foi concluído.',
        submitCompleted: 'O envio mais recente foi concluído.'
      },
      preview: {
        needCertificate: 'Selecione primeiro o material do certificado.',
        needTarget: 'Depois de selecionar o material do certificado, indique os alvos de ativos de aplicação.',
        ready: 'A versão de certificado selecionada será implantada em {count} alvos de ativos de aplicação.'
      },
      status: {
        checksReturned: 'Os resultados da pré-verificação retornaram; decida se deseja salvar, enviar ou executar.',
        current: 'Status atual',
        default: 'É recomendável iniciar um dry-run antes de decidir se deve enviar a execução.',
        dryRunStarted: 'Pré-verificação iniciada; veja o progresso na área de resultados da execução.',
        submitted: 'Plano enviado.'
      },
      steps: {
        certificate: {
          description: 'Ativo e versão do certificado',
          title: 'Selecionar material do certificado'
        },
        submit: {
          description: 'Dry-run, salvar, enviar e executar',
          title: 'Pré-verificar e enviar'
        },
        target: {
          description: 'Ativo de aplicação, site e binding',
          title: 'Selecionar alvo de implantação'
        }
      },
      stepState: {
        active: 'Em andamento',
        done: 'Concluído',
        pending: 'Pendente'
      },
      target: {
        workflowMode: 'Modo de workflow',
        workflowModeWithName: 'Modo de workflow ({name})'
      },
      version: {
        autoLatest: 'Selecionar automaticamente a versão implantável mais recente (atual: {current})',
        noDeployableVersion: 'Não há versão de certificado implantável no momento',
        range: '{id} ({notBefore} ~ {notAfter})'
      },
      currentStep: 'Etapa {current} / {total}',
      selectedTargetCount: '{count} alvos selecionados',
      subtitle: 'Configure o plano de implantação passo a passo',
      title: 'Assistente de implantação'
    }
  },
  tasks: {
      title: 'Tarefas globais',
      description: 'Consulte tarefas em fila, em execução, de monitoramento e do sistema no tenant atual.',
      quick: { active: 'Tarefas ativas', recent: 'Conclusões recentes' },
      tabs: { all: 'Todas', execution: 'Tarefas de execução', monitoring: 'Tarefas de monitoramento', system: 'Tarefas do sistema', other: 'Outras tarefas' },
    aria: { openDrawer: 'Abrir tarefas globais', tabs: 'Categorias de tarefas' },
    filters: {
      includeAll: 'Mostrar todas as tarefas',
      keyword: 'Pesquisar tarefa, erro ou ID',
      taskType: 'Tipo de tarefa',
      status: 'Status',
      allStatuses: 'Todos os status',
      resourceType: 'Tipo de recurso',
      resourceId: 'ID do recurso',
      requestedBy: 'Usuário solicitante',
      taskId: 'ID da tarefa',
      createdFrom: 'Início',
      createdTo: 'Fim'
    },
    fields: { requestedBy: 'Usuário solicitante', triggerSource: 'Origem', createdAt: 'Criada em', startedAt: 'Iniciada em', finishedAt: 'Finalizada em', error: 'Último erro' },
    sections: { timeline: 'Linha do tempo do status', attempts: 'Tentativas', logs: 'Logs', children: 'Subtarefas', errors: 'Erros', audit: 'Eventos de auditoria', monitoringProbes: 'Registros de sondagem' },
    actions: { backToList: 'Voltar à lista', viewAll: 'Ver todas as tarefas', search: 'Pesquisar', reset: 'Redefinir', previousPage: 'Página anterior', nextPage: 'Próxima página' },
    messages: { loadFailed: 'Falha ao carregar tarefas.', detailFailed: 'Falha ao carregar detalhes da tarefa.' },
    values: { system: 'Sistema', empty: 'Nenhum registro', none: 'Nenhum' },
    relatedNames: { builtinCatalog: 'Catálogo interno de plugins', deploymentPlan: 'Plano de implantação' },
    typeLabels: {
      CERTIFICATE_DRY_RUN: 'Dry-run do certificado',
      CERTIFICATE_DEPLOY: 'Implantação do certificado',
      CERTIFICATE_VERIFY: 'Verificação do certificado',
      CERTIFICATE_ROLLBACK: 'Rollback do certificado',
      PROVIDER_OPERATION: 'Operação em nuvem',
      AGENT_INSTALL: 'Instalação do Agent',
      AGENT_UPDATE: 'Atualização do Agent',
      AGENT_CAPABILITY_RESCAN: 'Nova varredura de capacidades do Agent',
      PLUGIN_REFERENCE_REFRESH: 'Atualização de referências de plugin',
      DEPLOYMENT_PLAN_REFRESH: 'Atualização do plano de implantação',
      MONITORING_BATCH: 'Lote de monitoramento',
      MONITORING_PROBE: 'Sonda de monitoramento',
      CA_NODE_TASK: 'Tarefa do nó CA',
      CA_RECORD_SYNC: 'Sincronização de registros CA',
      CERTIFICATE_REVOCATION: 'Revogação do certificado',
      CRL_PUBLISH: 'Publicação de CRL',
      TRUST_DISTRIBUTION: 'Distribuição de confiança',
      GATEWAY_DELEGATION: 'Delegação de gateway',
      WORKFLOW_RUN: 'Execução de workflow',
      AUTOMATION_RUN: 'Execução de automação',
      REPORT_EXPORT: 'Exportação de relatório',
      NOTIFICATION_DELIVERY: 'Entrega de notificação',
      OTHER: 'Outra tarefa'
    },
    summaryTemplates: {
      QUEUED: '{task} entrou na fila',
      RUNNING: '{task} em execução',
      RETRY_WAITING: 'Nova tentativa pendente para {task}',
      CANCELLING: 'Cancelando {task}',
      SUCCEEDED: '{task} concluída',
      FAILED: '{task} falhou',
      CANCELLED: '{task} cancelada'
    },
    status: { QUEUED: 'Na fila', RUNNING: 'Em execução', RETRY_WAITING: 'Aguardando nova tentativa', WAITING_APPROVAL: 'Aguardando aprovação', CANCELLING: 'Cancelando', SUCCEEDED: 'Concluída', FAILED: 'Falhou', CANCELLED: 'Cancelada' }
  },
  shell: {
    currentLocation: 'Localização atual',
    breadcrumb: 'Trilha de navegação',
    currentGroupNavigation: 'Navegação do grupo atual',
    backDashboard: 'Voltar ao painel',
    sidebarCollapse: 'Recolher barra lateral',
    sidebarExpand: 'Expandir barra lateral'
  },
  preferences: {
    theme: 'Tema',
    language: 'Idioma',
    themeLight: 'Claro',
    themeDark: 'Escuro',
    themeToggle: 'Alternar modo do tema',
    languageSelect: 'Selecionar idioma da interface',
    title: 'Preferências de exibição',
    description: 'Tema e idioma são salvos nas preferências do usuário no backend.',
    errors: {
      loadFailed: 'Falha ao carregar preferências',
      saveFailed: 'Falha ao salvar preferências'
    }
  },
  userMenu: {
    currentUser: 'Usuário atual',
    changePassword: 'Alterar senha',
    logout: 'Sair'
  },
  password: {
    title: 'Alterar senha',
    description: 'Altere a senha local do usuário conectado.',
    current: 'Senha atual',
    new: 'Nova senha',
    confirm: 'Confirmar nova senha',
    cancel: 'Cancelar',
    submit: 'Salvar senha',
    submitting: 'Salvando…',
    success: 'Senha atualizada',
    failed: 'Falha ao alterar a senha',
    mismatch: 'As novas senhas não coincidem',
    tooShort: 'A nova senha deve ter pelo menos 8 caracteres'
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
    dashboard: 'Painel',
    dashboardDesc: 'Visão geral do status de aplicações, certificados, Agents, gateways e auditoria',
    certificates: 'Gerenciamento de certificados',
    certificatesDesc: 'Biblioteca de certificados, vínculos e status de expiração',
    certificateAssets: 'Ativos de certificado',
    certificateAssetsDesc: 'Certificados, referências de chave privada, impressões digitais e prazos de expiração',
    certificateFormats: 'Configuração de formatos de certificado',
    certificateFormatsDesc: 'Defina regras de formato como PFX, CER, CRT e PEM para certificados salvos',
    assetCenter: 'Asset Center',
    assetCenterDesc: 'Manage application, device, and cloud service assets',
    assetManagement: 'Gerenciamento de aplicativos',
    assets: 'Ativos de aplicação',
    assetsDesc: 'Entradas de aplicação e alvos de implantação de certificado por domínio/IP',
    devices: 'Dispositivos',
    agents: 'Agents',
    agentsDesc: 'Status online, heartbeat e conjunto de capacidades',
    gateways: 'Gateways',
    gatewaysDesc: 'Gateways de zona isolada, protocolos e alvos alcançáveis',
    deployments: 'Implantação de certificados',
    deploymentsDesc: 'Planos de implantação, workflows, automações e registros de execução',
    deploymentPlans: 'Planos de implantação',
    deploymentPlansDesc: 'Planos de implantação de certificados e entradas de aprovação',
    executions: 'Registros de execução',
    executionsDesc: 'Etapas de execução, logs, falhas e rollback',
    workflows: 'Fluxos de trabalho',
    workflowsDesc: 'Fluxos de trabalho e plugins',
    workflowTemplates: 'Fluxos de trabalho',
    workflowTemplatesDesc: 'Rascunhos do canvas, variáveis, declarações de capacidade e publicação',
    automations: 'Automações',
    automationsDesc: 'Planos de renovação de certificados agendados, sob demanda e em lote',
    plugins: 'Central de plugins',
    pluginsDesc: 'Provider, executores e status do sandbox',
    monitoring: 'Monitoramento e auditoria',
    monitoringDesc: 'Alertas, auditoria e status de certificados',
    monitorAlerts: 'Alertas de monitoramento',
    monitorAlertsDesc: 'Eventos de expiração, desvio e falha de execução',
    monitorTls: 'Monitoramento TLS profundo',
    monitorTlsDesc: 'Cadeias de confiança, suítes de protocolo, simulação de compatibilidade e detalhes do protocolo',
    audits: 'Logs de auditoria',
    auditsDesc: 'Evidências de operação e exportações de conformidade',
    settings: 'Configurações do sistema',
    settingsDesc: 'Tenants, usuários, permissões e configuração do sistema',
    systemSettings: 'Configurações do sistema',
    systemSettingsDesc: 'Configuração do sistema e metadados de segurança',
    users: 'Gerenciamento de usuários',
    usersDesc: 'Usuários do console, status e funções',
    roles: 'Gerenciamento de permissões',
    rolesDesc: 'Funções, escopos de objetos autorizados e atribuição de membros',
    identitySources: 'Fontes de identidade',
    identitySourcesDesc: 'Configuração de serviços AD/LDAP',
    groupRoleMappings: 'Mapeamentos de grupos para funções'
  },
  automations: {
    title: 'Automações',
    description: 'Gerencie execuções agendadas, sob demanda e em lote dos planos de renovação de certificados.',
    empty: 'Nenhuma automação.',
    emptyDescription: 'Sem descrição',
    common: { notAvailable: 'Indisponível', allRelated: 'All related targets' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: 'Acionar por API externa', apiHelp: 'Um sistema externo chama a API de execução. A prévia, o Dry Run e a aprovação continuam sendo aplicados.', once: 'Executar uma vez em horário fixo', onceHelp: 'Escolha o horário local do navegador. A tarefa não será agendada novamente após a execução.', recurring: 'Executar periodicamente', scheduleHelp: 'Use uma agenda recorrente apenas quando a verificação contínua for realmente necessária.', recurringHelp: 'Use uma agenda recorrente apenas quando a verificação contínua for realmente necessária.', recurringWarningTitle: 'Execução periódica não é recomendada para certificados', recurringWarning: 'Normalmente a troca deve ser acionada após a emissão do certificado ou agendada uma única vez.', certificateVersionCreated: 'Certificate new-version event', certificateVersionCreatedHelp: 'A automação começa quando uma fonte externa ou uma importação manual cria uma nova versão do certificado.', runAt: 'Horário de execução', frequency: 'Frequência', daily: 'Diariamente', weekly: 'Semanalmente', monthly: 'Mensalmente', time: 'Horário', weekday: 'Dia da semana', monthDay: 'Dia do mês', legacyCustom: 'Manter agenda personalizada existente', legacyCron: 'Cron existente (somente leitura)', weekdays: { 0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado' } },
    form: { existingAssetTitle: 'Atualizar apenas ativos de aplicativos existentes', existingAssetDescription: 'A automação processa apenas ativos com vínculos de certificado existentes. Ela não instala certificados pela primeira vez nem adiciona destinos.', certificateDomains: 'Domínios do certificado', certificateDomainsPlaceholder: 'Informe os domínios separados por vírgulas', certificateDomainsHelp: 'Atualiza apenas os vínculos existentes dos ativos para estes domínios.', versionSelection: 'Versão do certificado para implantar', versionSelectionLatest: 'Usar automaticamente a versão mais recente', versionSelectionSpecific: 'Usar versões específicas', versionSelectionHelp: 'A versão é resolvida e congelada quando a execução começa.', certificateVersionIds: 'Versões específicas do certificado', certificateVersionIdsPlaceholder: 'Informe os IDs das versões separados por vírgulas', certificateVersionIdsHelp: 'Cada versão deve pertencer a um certificado selecionado pelos domínios.', versionLoading: 'Carregando versões de certificado disponíveis.', versionLoadFailed: 'Falha ao carregar versões. Tente novamente mais tarde.', versionEmpty: 'Nenhuma versão selecionável foi encontrada para estes domínios.', schedule: 'Quando atualizar', scheduleHelp: 'Inicie sob demanda ou execute periodicamente usando Cron e fuso horário.', execution: 'O que acontece na execução', executionHelp: 'O sistema cria um plano separado para cada vínculo existente e reutiliza DeploymentPlan, Dry Run, aprovação e ExecutionRun.', snapshot: 'Congelar o domínio, o ativo e a versão do certificado' },
    fields: { name: 'Nome', description: 'Descrição', trigger: 'Acionador', eventSources: 'Event sources', eventSourcesHelp: 'Choose which certificate version events can start this automation.', targetScope: 'Update scope', selectedAssets: 'Selected application assets', selectedAssetsHelp: 'Select at least one managed application asset.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Expressão Cron', timeZone: 'Fuso horário', expiresWithinDays: 'Janela de expiração em dias', environments: 'Ambientes de destino (separados por vírgula)', certificateIds: 'Certificados específicos (opcional)', certificateIdsPlaceholder: 'Informe os IDs separados por vírgulas', certificateIdsHelp: 'Quando preenchido, apenas esses certificados serão processados; caso contrário, usam-se validade e ambiente.', expiresWithinDaysHelp: 'Correspondem apenas certificados que expiram nesta janela.', environmentsHelp: 'Processar apenas certificados desses ambientes.', planType: 'Tipo de plano de implantação', planTypeHelp: 'Um DeploymentPlan separado é criado em tempo de execução para cada destino.', planTypeUpdate: 'Atualizar um vínculo de certificado existente', planTypeInstall: 'Instalar certificado no destino', planTypeVerifyOnly: 'Apenas verificar, sem alterar o certificado', planMode: 'Modo de execução', planModeHelp: 'A automação não vincula um plano existente; cria um novo plano para cada destino.', planModeCreateAndExecute: 'Criar e executar o plano', planModeCreateOnly: 'Criar apenas os planos, sem executar', maxTargets: 'Máximo de destinos por execução', concurrency: 'Concorrência', failureCount: 'Limite de quantidade de falhas', requireDryRun: 'Exigir Dry Run antes da execução', requireApproval: 'Exigir aprovação antes da execução', startedAt: 'Início', finishedAt: 'Término', failureStage: 'Etapa da falha', parentRun: 'Execução pai' },
    actions: { create: 'Criar automação', detail: 'Details', edit: 'Editar', delete: 'Excluir', cancel: 'Cancelar', save: 'Salvar', copy: 'Copiar', enable: 'Ativar', disable: 'Desativar', runNow: 'Run now', preview: 'Visualizar destinos', history: 'Histórico de execuções', confirmRun: 'Confirmar execução', stop: 'Parar execução', retryFailed: 'Repetir destinos com falha', openPlan: 'Abrir plano de implantação', openExecution: 'Abrir execução' },
    manualRun: { title: 'Execução manual', description: 'Selecione uma versão do certificado antes de executar.', versionLabel: 'Versão do certificado', versionPlaceholder: 'Selecione uma versão do certificado', help: 'A execução vai resolver os ativos de aplicação relacionados a partir da versão selecionada.', empty: 'Não há versões de certificado disponíveis para execução manual.', stopOnError: 'Parar em erro', dryRun: 'Executar dry-run primeiro', start: 'Iniciar execução' },
    columns: { status: 'Status', trigger: 'Acionador', targets: 'Limite de destinos', actions: 'Ações', nextRun: 'Próxima execução', lastRun: 'Última execução' },
    triggers: { onDemand: 'Sob demanda', schedule: 'Agendada' },
    triggerTypes: { on_demand: 'Sob demanda', schedule: 'Agendada', certificate_version_created: 'Certificate new-version event', retry: 'Repetição de falhas' },
    eventSources: { external_source: 'Fonte externa', manual_import: 'Importação manual' },
    targetScopes: { allRelatedAssets: 'Update all related application assets', allRelatedAssetsHelp: 'Resolve every bound and deployable application asset automatically after the event or filters match.', selectedAssets: 'Update selected application assets only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for manually selected application assets.' },
    assetPicker: { available: 'Available assets', selected: 'Selected assets', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No application assets are available to add.', emptySelected: 'No application assets selected yet.' },
    actionTypes: { create_deployment_plan: 'Criar plano de renovação de certificado', execute_deployment_plan: 'Executar plano de renovação de certificado', send_notification: 'Enviar notificação' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: 'Até {count} destinos' },
    preview: { title: 'Visualização do impacto nos ativos', description: 'Compare a expiração atual do certificado em cada ativo selecionado com a expiração do certificado de destino.', matched: '{count} correspondências', executable: '{count} executáveis', excluded: '{count} excluídos', affected: '{count} afetados', upgrade: '{count} validade maior', same: '{count} mesma expiração', downgrade: '{count} precisam de atenção', version: 'Versão {version}', versionUnknown: 'Versão desconhecida', ready: 'Pronto', impact: { upgrade: 'Validade maior', same: 'Mesma expiração', downgrade: 'Risco de validade menor', missing_current: 'Certificado atual ausente', unknown: 'Impacto desconhecido' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} application assets involved', assetsResolvedAtRuntime: 'Target assets are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved assets', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: 'Permissão negada para o destino', missing_version: 'Versão do certificado ausente', version_not_deployable: 'Versão do certificado não pode ser implantada', binding_not_managed: 'Vínculo não gerenciado', environment_not_allowed: 'Ambiente não permitido', binding_missing: 'Binding is missing', asset_missing_deployment_capability: 'Target asset cannot deploy certificates', certificate_version_downgrade: 'A versão alvo é anterior à versão atual do ativo', filter_not_matched: 'Filter conditions did not match', runtime_context_required: 'Runtime context is required', unknown: 'Motivo de exclusão desconhecido' },
    failureStages: { selection: 'Seleção de destinos', plan_creation: 'Criação do plano', dry_run: 'Dry Run', approval: 'Aprovação', execution: 'Execução', verification: 'Verificação', rollback: 'Reversão', notification: 'Notificação' },
    progress: { total: 'Total', pending: 'Pendente', running: 'Em execução', waitingApproval: 'Aguardando aprovação', succeeded: 'Sucesso', failed: 'Falha', skipped: 'Ignorado', cancelled: 'Cancelado' },
    editor: { createTitle: 'Criar automação', editTitle: 'Editar automação', description: 'Configure quando executar, quais certificados tratar, como criar os planos e o que fazer em caso de falha.', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot.', sections: { basic: 'Informações básicas', basicHelp: 'Dê um nome claro à automação e descreva as alterações de certificados que ela trata.', trigger: 'Trigger', triggerHelp: 'Define what fact starts the automation before choosing execution and conditions.', targets: 'Certificados a processar', targetsHelp: 'Aqui são selecionados certificados, não planos existentes; o snapshot dos destinos é congelado no início.', execution: 'Execution', executionHelp: 'Decide how the automation updates assets first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters, approval, and concurrency guardrails together in this step.', plan: 'Plano de implantação do certificado', planRelationTitle: 'Não vincula um plano de implantação existente', planRelationDescription: 'Um plano é criado em tempo de execução a partir dos filtros de certificados.', planRelationHelp: 'Cada destino recebe seu próprio DeploymentPlan, cujo ID aparece nos detalhes da execução.', guardrails: 'Controles de segurança', guardrailsHelp: 'Esses limites controlam lote, pré-verificação, aprovação e parada por falha.' }, chain: { createPlan: 'Criar um DeploymentPlan por destino', dryRun: 'Executar a pré-verificação Dry Run', approval: 'Aguardar aprovação', executePlan: 'Executar o DeploymentPlan do destino' } },
    runs: { title: 'Histórico de automações', description: 'Veja o status da execução, snapshots imutáveis dos destinos e etapas de falha.', progress: '{succeeded}/{total} com sucesso' },
    runDetail: { title: 'Detalhes da execução automatizada', description: 'Versão da configuração {version}', noFailure: 'Sem falhas', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', approvalId: 'Approval ID', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: 'Visualização de destinos da automação', runs: 'Lista de execuções automatizadas', progress: 'Progresso da execução automatizada' },
    errors: { loadFailed: 'Falha ao carregar automações', applicationAssetsLoadFailed: 'Failed to load application assets. Try again later.' }
  },
  routes: {
    certificateImport: 'Importar certificado',
    certificateDetail: 'Detalhes do certificado',
    certificateUsages: 'Relações de uso',
    certificateFormats: 'Artefatos de formato'
  },
  businessPage: {
    request: {
      notRequested: 'Ainda não solicitado'
    },
    error: {
      unknown: 'Erro desconhecido'
    },
    primaryActionFailed: 'Falha ao executar a ação principal',
    processing: 'Processando…',
    metricsAria: 'Métricas de negócio',
    apiFailed: 'Falha na requisição ao serviço',
    errorCode: 'Código de erro: {code}',
    retry: 'Tentar novamente',
    resourceList: 'Lista de {resource}',
    total: 'Total {count}',
    toggleFilters: 'Filtrar',
    all: 'Todos',
    clearFilters: 'Limpar filtros',
    pagination: 'Página {page} / {pageSize} por página',
    resourceDetailAria: 'Detalhes do recurso',
    resourceDetailTitle: 'Detalhes de {resource}',
    contextAria: 'Entradas de contexto',
    resourceActionsAria: 'Ações do recurso',
    resourceActionsTitle: 'Ações do recurso',
    resourceActionsHint: 'Operações de alto risco exigem confirmação secundária; a validação final depende da autorização do sistema.'
  },
  executionDetail: {
    error: {
      loadStepsFailed: 'Falha ao consultar etapas de execução',
      streamConnectFailed: 'Falha na conexão de atualização dos detalhes da execução'
    },
    step: {
      nameFallback: 'Etapa {index}',
      dryRunCheckSummary: 'Conclusão da pré-verificação: aprovadas {passed} / avisos {warning} / falhas {failed} / desconhecidas {unknown}. {topChecks}',
      dryRunPending: {
        queued: 'Ainda está na fila e a execução não começou.',
        running: 'Esta etapa está em execução; aguardando o Agent retornar o resultado da pré-verificação.',
        failed: 'Esta etapa falhou e o resultado da pré-verificação ainda não foi obtido.',
        finished: 'Esta etapa terminou, mas o resultado da pré-verificação ainda não foi obtido.'
      },
      dryRunDiscover: 'Pré-verificação somente leitura: identificação do alvo de implantação e das informações de site de {providerLabel}. Site {siteName}, binding {binding}. {pendingText}',
      dryRunVerify: 'Pré-verificação somente leitura: validação do material do certificado, do binding do alvo e da correspondência de domínio. Alvo {providerLabel}, binding {binding}. {pendingText}',
      dryRunCreated: 'Pré-verificação somente leitura criada. {pendingText}',
      workflowIdentity: 'Versão de execução: plugin {plugin}; workflow {workflow}',
      failure: {
        emptyMessage: 'Nenhuma mensagem de erro específica foi recebida',
        issue: 'Categoria {category}, slot {slot}, caminho {path}, origem {source}, correção {remediation}'
      },
      skipped: 'Etapa ignorada: {reason}',
      running: {
        dispatched: 'Tarefa do Agent enviada ({taskId}); aguardando o resultado da execução.',
        waitingAgentResult: 'Etapa em execução; aguardando o Agent retornar o resultado…'
      },
      pending: {
        waitingDependency: 'A etapa aguarda a conclusão das etapas anteriores.'
      },
      verifyRecovered: {
        detail: 'A sondagem TLS remota no lado do Agent falhou, mas o sistema concluiu a verificação TLS real de {remoteTarget} e confirmou que o certificado de destino corresponde. {originalError}',
        originalSuffix: 'Erro original do Agent: {originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} retornou. Agent taskId={taskId}',
        withoutTask: '{executor} {mode} retornou.'
      },
      createdFallback: 'Etapa {index} criada; aguardando detalhes da execução…'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Dry-run falhou',
        detail: '{failedStepCount} etapas de pré-verificação falharam ou expiraram, e nenhuma conclusão estruturada de pré-verificação foi recebida.'
      },
      queued: {
        label: 'Dry-run na fila',
        detail: 'A tarefa de pré-verificação foi criada e aguarda início.'
      },
      running: {
        label: 'Dry-run em execução',
        detail: 'A pré-verificação foi iniciada; aguardando o retorno dos resultados.'
      },
      pending: {
        label: 'Dry-run encerrado sem conclusão',
        detail: '{finishedWithoutChecks} etapas terminaram, mas nenhuma conclusão de pré-verificação foi recebida.'
      },
      receiving: {
        label: 'Dry-run recebendo resultados',
        detail: 'Conclusões parciais recebidas: aprovadas {passed}, avisos {warning}, falhas {failed}, desconhecidas {unknown}.'
      },
      failed: {
        label: 'Dry-run falhou',
        detail: 'Pré-verificação com {failed} itens falhos, {warning} avisos e {passed} itens aprovados.'
      },
      tlsGrantRequired: {
        label: 'Dry-run concluído, autorização do host necessária',
        detail: 'As verificações estruturais e de segurança foram concluídas. O dry-run não emite um ExecutionGrant formal, portanto o bypass da verificação TLS foi rejeitado. Após a aprovação, o host emitirá um ExecutionGrant de curta duração para a execução formal.'
      },
      warning: {
        label: 'Dry-run com alertas de risco',
        detail: 'Pré-verificação concluída: {passed} aprovadas, {warning} avisos, {unknown} desconhecidas.'
      },
      passed: {
        label: 'Dry-run bem-sucedido',
        detail: 'Todas as pré-verificações foram aprovadas, total de {passed}.'
      }
    },
    agent: {
      taskSuffix: '(Agent taskId={taskId})'
    },
    log: {
      verifyRecovered: '[ControlPlane] A sondagem TLS remota no lado do Agent falhou, mas o sistema concluiu a verificação TLS real e confirmou que o certificado de destino corresponde.'
    },
    workflowStep: {
      failedDefault: 'Nó do workflow {index} falhou',
      skipped: 'Nó do workflow ignorado porque a condição não foi atendida.',
      successAssertions: 'Nó do workflow executado com sucesso; asserções aprovadas {passed}/{total}.',
      success: 'Nó do workflow executado com sucesso.'
    },
    binding: {
      hostMissing: 'Host Header não fornecido'
    },
    site: {
      unnamed: 'Site sem nome'
    },
    provider: {
      target: 'Alvo'
    }
  },
  executions: {
    title: 'Registros de execução',
    description: 'Veja o status da execução de implantação, logs das etapas, conclusões de pré-verificação dry-run, motivos de falha e entradas de rollback.',
    resourceName: 'Registro de execução',
    errors: {
      streamConnectFailed: 'Falha na conexão de atualização dos detalhes da execução: HTTP {status}',
      loadFailed: 'Falha ao carregar os registros de execução'
    },
    actions: {
      refreshList: 'Atualizar lista',
      refreshing: 'Atualizando',
      viewDetail: 'Ver detalhes',
      rollback: 'Iniciar rollback',
      rollbackRisk: 'O rollback alterará novamente a configuração do certificado no serviço de destino; confirme primeiro as referências de backup e o escopo de impacto.'
    },
    columns: {
      name: 'Identificador da execução',
      status: 'Status',
      risk: 'Risco',
      planId: 'Plano de implantação',
      startedAt: 'Hora de início'
    },
    metrics: {
      total: {
        title: 'Total de execuções',
        description: 'Registros de execução atualmente rastreáveis.'
      },
      risky: {
        title: 'Alto risco pendente',
        description: 'Execuções com falha, sucesso parcial ou necessidade de rollback.'
      }
    },
    fields: {
      executionId: 'ID da execução',
      deploymentPlan: 'Plano de implantação',
      runType: 'Tipo de execução',
      status: 'Status da execução',
      target: 'Alvo da execução',
      externalRunId: 'ID externo da execução',
      startedAt: 'Hora de início',
      finishedAt: 'Hora de término',
      errorCode: 'Código de erro',
      failureReason: 'Motivo da falha'
    },
    links: {
      deploymentPlan: 'Ver plano de implantação',
      auditEvents: 'Ver eventos de auditoria'
    },
    empty: {
      title: 'Nenhum registro de execução',
      description: 'Após a execução de um plano de implantação, logs, status e vínculos de auditoria aparecerão aqui.'
    },
    list: {
      ariaLabel: 'Lista de execuções', title: 'Registros de execução', summary: '{total} registros, mais recentes primeiro.', range: 'Exibindo {start}-{end} de {total}',
      assetsLabel: 'Ativos', logLabel: 'Resumo do log', runNumber: 'Execução {number}', planUnknown: 'Nenhum plano associado', assetUnknown: 'Nenhum ativo registrado', timeUnknown: 'Horário inicial não registrado',
      logRunning: 'A execução está em andamento.', logPending: 'A execução está na fila.', logFailed: 'A execução falhou com o código {code}.', logSuccess: 'A execução foi concluída em {duration}.', logCompleted: 'Execução encerrada.',
      errorCodeUnknown: 'não registrado', durationUnknown: 'desconhecida', durationSeconds: '{count} segundos', durationMinutes: '{count} minutos', viewDetailHint: 'Ver detalhes', openDetailAria: 'Abrir execução {id} do plano {plan}', previousPage: 'Anterior', nextPage: 'Próxima', pageSummary: 'Página {page} de {pages}'
    },
    types: { dryRun: 'Pré-verificação', apply: 'Executar', rollback: 'Rollback', retry: 'Repetir', unknown: 'Outro' },
    summary: {
      passed: 'Aprovado',
      warning: 'Aviso',
      failed: 'Falha',
      unknown: 'Desconhecido'
    },
    detail: {
      title: 'Detalhes da execução',
      titleWithId: 'Detalhes da execução {id}',
      description: 'Veja as informações básicas, o status das etapas e os logs do registro de execução.',
      eyebrow: 'Registro de execução',
      planLabel: 'Plano de implantação {plan}',
      loadingSteps: 'Carregando etapas...',
      loadingLogs: 'Carregando logs...',
      noStepDetail: 'Nenhum detalhe da etapa',
      notStarted: 'Não iniciado',
      noSteps: 'Nenhuma etapa.',
      noLogs: 'Nenhum log.'
    },
    tabs: {
      summary: 'Visão geral',
      steps: 'Etapas',
      logs: 'Logs'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: 'Endereço de conexão', connectionPort: 'Porta de conexão', basePath: 'Caminho base', timeoutSeconds: 'Tempo limite em segundos', gateway: 'Gateway de execução',
      authenticationMode: 'Modo de autenticação', credential: 'Credencial de gerenciamento do dispositivo', username: 'Nome de usuário', passwordSecret: 'SecretRef da senha', apiTokenSecret: 'SecretRef do token de API', clientCertificate: 'Certificado do cliente',
      tlsEnabled: 'Ativar TLS', tlsVerifyPeer: 'Verificar certificado do servidor', tlsServerName: 'Nome do servidor TLS', caSecret: 'SecretRef da CA', tlsMinimumVersion: 'Versão TLS mínima',
      deviceDisplayName: 'Nome de exibição do dispositivo', deviceDescription: 'Descrição do dispositivo', deviceTags: 'Tags do dispositivo', targetName: 'Nome do destino', targetLabels: 'Rótulos do destino'
    },
    forms: { loadOptions: 'Carregar opções', previewTitle: 'Formulário de configuração do plugin', loading: 'Carregando formulário do plugin...', loadFailed: 'Falha ao carregar o formulário do plugin', empty: 'Este plugin não declara um formulário de configuração.' },
    presentation: { previewTitle: 'Prévia padrão do dispositivo', sensitiveValue: 'Valor sensível oculto', tabsAriaLabel: 'Abas de informações do dispositivo' },
    title: 'Plugins',
    description: 'Gerencie pacotes de plugins, executores, declarações de permissão e estado de isolamento do sandbox.',
    resourceName: 'Plugin',
    actions: {
      install: 'Instalar plugin',
      detail: 'Detalhes',
      create: 'Criar',
      refresh: 'Atualizar mercado',
      refreshing: 'Atualizando...',
      createWorkflow: 'Criar fluxo de trabalho',
      creatingWorkflow: 'Criando...',
      enable: 'Habilitar',
      disabling: 'Desabilitando...',
      disable: 'Desativar',
      disableRisk: 'Desativar um plugin afeta capacidades de Provider, modelos e executores.'
    },
    market: { eyebrow: 'Mercado de plugins DSL', title: 'Descubra automações reutilizáveis', description: 'Os modelos integrados acompanham o sistema e os modelos do usuário vêm de data/workflows. Cada modelo pode manter logo, versão semântica e tags.' },
    sources: { builtin: 'Integrado', user: 'Plugin do usuário' },
    statuses: { valid: 'Disponível', invalid: 'Inválido', available: 'Pronto para criar', enabled: 'Habilitado', disabled: 'Não habilitado', pendingApproval: 'Aguardando aprovação', inUse: 'Em uso', notInUse: 'Não utilizado' },
    filters: { searchLabel: 'Pesquisar plugins', searchPlaceholder: 'Pesquisar por nome, tag, categoria ou caminho', allSources: 'Todas as origens', allStatuses: 'Todos os estados', statusLabel: 'Estado do plugin' },
    card: { defaultDescription: 'Este plugin DSL ainda não possui descrição.', unversioned: 'Sem versão', stepCount: '{count} etapas de execução', moreTags: '+{count} itens' },
    columns: {
      name: 'Nome do plugin',
      status: 'Status',
      risk: 'Risco',
      version: 'Versão',
      signature: 'Assinatura'
    },
    metrics: {
      total: {
        title: 'Total de plugins',
        description: 'Plugins instalados e com atualização disponível.'
      },
      builtin: { title: 'Plugins integrados' },
      user: { title: 'Plugins do usuário' },
      using: { title: 'Em uso' },
      risky: {
        title: 'Alto risco pendente',
        description: 'Plugins com permissões de alto risco, assinatura anormal ou isolamento em sandbox.'
      }
    },
    empty: {
      title: 'Nenhum plugin',
      description: 'Antes de instalar, confirme permissões, assinatura e estratégia de rollback do plugin.'
    },
    detail: {
      title: 'Detalhes do plugin',
      titleWithName: 'Plugin {name}',
      description: 'Veja detalhes do plugin, declarações de permissão e informações de isolamento do sandbox.',
      versionLabel: 'Versão {version}'
    },
    types: { provider: 'Plugin de provedor cloud', standard: 'Plugin padrão' },
    fields: {
      pluginId: 'Plugin ID',
      pluginType: 'Tipo de plugin',
      provider: 'Provedor cloud',
      name: 'Nome do plugin',
      currentStatus: 'Status atual',
      version: 'Versão',
      source: 'Origem', category: 'Categoria', steps: 'Etapas de execução', rollbackSteps: 'Etapas de rollback', updatedAt: 'Atualizado em', filePath: 'Caminho do modelo', logoUrl: 'URL do logo', platforms: 'Plataformas alvo', updateMethods: 'Métodos de atualização', maintainer: 'Mantenedor', homepage: 'Página do projeto', usage: 'Estado de uso', validationError: 'Erro de validação',
      signatureStatus: 'Status da assinatura',
      riskLevel: 'Nível de risco', runtime: 'Runtime', executionMode: 'Modelo de execução', scope: 'Escopo', support: 'Nível de suporte', capabilities: 'Capacidades', frameworks: 'Frameworks alvo', products: 'Produtos suportados', operations: 'Operações suportadas'
    },
    labels: { permissions: 'Permissões declaradas', runnerStatus: 'Status do Runner' },
    permissionKeys: { network_http: 'Solicitações de rede', secret_read: 'Leitura de segredos', artifact_read: 'Leitura de artefatos', device_write: 'Escrita em dispositivos' },
    runnerStatuses: { ready: 'Runner pronto', busy: 'Runner ocupado', unavailable: 'Runner indisponível', notObserved: 'Runner não observado' },
    capabilityKeys: { device_connection_test: 'Teste de conexão', device_identity_detect: 'Detecção de identidade do dispositivo', device_discover: 'Descoberta de dispositivo', device_logs_read: 'Leitura de logs do dispositivo', certificate_discover: 'Descoberta de certificados', certificate_deploy: 'Implantação de certificado', certificate_rollback: 'Rollback de certificado', certificate_verify: 'Verificação de certificado' },
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: 'Runtime personalizado', runtime_custom: 'Runtime personalizado', adc_load_balancer: 'Balanceador ADC', cloud_aliyun_cdn: 'Alibaba Cloud CDN', cloud_aliyun_alb: 'Alibaba Cloud ALB', cloud_aliyun_clb: 'Alibaba Cloud CLB', cloud_aliyun_oss: 'Alibaba Cloud OSS', cloud_aliyun_waf_cname: 'Alibaba Cloud WAF CNAME', cloud_aliyun_waf_cloud: 'Alibaba Cloud WAF Cloud', cloud_aliyun_live: 'Alibaba Cloud Live', cloud_aliyun_vod: 'Alibaba Cloud VOD', cloud_tencent_cdn: 'Tencent Cloud CDN', cloud_tencent_clb: 'Tencent Cloud CLB', cloud_tencent_live: 'Tencent Cloud Live', cloud_huawei_cdn: 'Huawei Cloud CDN', cloud_huawei_elb: 'Huawei Cloud ELB', cloud_volcengine_cdn: 'Volcengine CDN', cloud_volcengine_alb: 'Volcengine ALB', cloud_volcengine_clb: 'Volcengine CLB', cloud_volcengine_live: 'Volcengine Live', cloud_volcengine_vod: 'Volcengine VOD' },
    runtimeTypes: { agent_atomic: 'Execução atômica do Agent', workflow_dsl: 'Workflow DSL' },
    providerKeys: { cloud_aliyun: 'Alibaba Cloud', cloud_tencent: 'Tencent Cloud', cloud_huawei: 'Huawei Cloud', cloud_volcengine: 'Volcengine' },
    scopeTypes: { managed: 'Alvo gerenciado', standalone: 'Alvo independente', both: 'Gerenciado / independente' },
    supportTypes: { official: 'Suporte oficial', community: 'Suporte da comunidade', self_managed: 'Auto gerenciado' },
    aria: { filters: 'Filtros do mercado de plugins', list: 'Lista de plugins DSL', logo: 'Logo de {name}' },
    errors: { loadFailed: 'Falha ao carregar o mercado de plugins', createFailed: 'Falha ao criar o fluxo a partir do plugin' },
    agentDeployment: {
      mount: 'Montar no Agent', mounting: 'Montando...', selectAgent: 'Selecione o Agent de destino', type: 'Tipo de plugin', targetAgent: 'Agent de destino', mountFailed: 'Falha ao montar o plugin do Agent',
      executionMode: 'Modo de execução do Agent', nativeHandler: 'Manipulador nativo', pluginMode: 'Plugin do Agent', mountedPlugin: 'Plugin montado', selectMountedPlugin: 'Selecione um plugin montado',
      plugin: 'Plugin de implantação', selectPlugin: 'Selecione um plugin de implantação', noCompatiblePlugin: 'Nenhum plugin habilitado corresponde à plataforma e ao framework atuais', compatiblePluginHint: 'Somente plugins habilitados compatíveis com a plataforma e o framework do ativo são exibidos.',
      secretRefPlaceholder: 'Informe um identificador SecretRef', artifactBinding: 'Artefato de certificado {name}', artifactBindingPlaceholder: 'Exemplo: value=fullchain,key=private', preview: 'Validar configuração', previewFailed: 'Falha ao validar a configuração do plugin do Agent',
      approveAndEnable: 'Aprovar e habilitar', activating: 'Habilitando...', activateFailed: 'Falha ao aprovar ou habilitar o plugin do Agent',
      types: { WORKFLOW_TEMPLATE: 'Modelo de workflow', UNIFIED_PLUGIN: 'Plugin de capacidade unificado' }
    },
    changeSummaries: { createWorkflow: 'Criar fluxo a partir do modelo do mercado de plugins' }
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
    title: 'Planos de implantação',
    description: 'Prévia do plano, escopo de impacto, aprovação, lotes de execução, verificação e entradas de rollback.',
    resourceName: 'Plano de implantação',
    apiActions: {
      submit: 'Enviar plano de implantação',
      execute: 'Executar plano de implantação',
      cancel: 'Cancelar plano de implantação',
      delete: 'Excluir plano de implantação'
    },
    actions: {
      create: 'Criar plano de implantação',
      detail: 'Detalhes',
      edit: 'Editar plano',
      dryRun: 'Prévia de impacto Dry-run',
      dryRunRisk: 'Gera apenas a prévia de impacto, sem executar a implantação real.',
      submit: 'Enviar para aprovação',
      submitRisk: 'Após o envio, o plano entra em aprovação ou fica pendente de execução.',
      review: 'Revisar aprovação',
      approve: 'Aprovar solicitação',
      approveRisk: 'A aprovação torna o plano elegível para execução, mas o Dry-run e o ExecutionGrant emitido pelo host continuam obrigatórios.',
      reject: 'Rejeitar solicitação',
      rejectRisk: 'Um plano rejeitado não pode ser executado e precisa ser enviado para aprovação novamente.',
      execute: 'Executar implantação',
      executeRisk: 'A execução altera a configuração de certificados do alvo. Planos concluídos ou com falha também usam esta entrada para nova execução; antes de executar, rode a prévia de impacto Dry-run.',
      cancel: 'Cancelar plano',
      cancelRisk: 'Cancela apenas planos de implantação ainda não concluídos. Implantações já concluídas não são revertidas.',
      rollback: 'Executar rollback',
      rollbackRisk: 'O rollback altera novamente a configuração de certificado do serviço alvo e exige um runId real.',
      delete: 'Excluir plano',
      deleteRisk: 'Exclui permanentemente o plano, os alvos de implantação, os registros de execução e o histórico de auditoria correspondente. Não é possível recuperar.'
    },
    columns: {
      name: 'Nome do plano',
      status: 'Status',
      currentAssetCertificateExpiresAt: 'Fim do certificado atual',
      updateNeeded: 'Precisa atualizar',
      scheduledAt: 'Horário planejado',
      actions: 'Ações'
    },
    metrics: {
      total: {
        title: 'Total de planos',
        description: 'Planos aguardando aprovação, pendentes de execução ou em execução.'
      },
      risky: {
        title: 'Alto risco pendente',
        description: 'Planos que afetam serviços de produção ou não têm capacidade de rollback.'
      }
    },
    fields: {
      planId: 'ID do plano',
      name: 'Nome do plano',
      status: 'Status do plano',
      approvalStatus: 'Status da aprovação',
      certificateVersionId: 'ID da versão do certificado',
      certificateFormatId: 'ID da configuração de formato do certificado',
      workflowDslVersion: 'Versão do DSL do workflow',
      currentAssetCertificateExpiresAt: 'Fim do certificado atual',
      updateNeeded: 'Precisa atualizar',
      targetSummary: 'Resumo de vínculos do alvo',
      latestRun: 'Lote de execução mais recente',
      approvalId: 'ID da aprovação',
      snapshotHash: 'Hash do snapshot',
      failureReason: 'Motivo da falha',
      createdAt: 'Criado em',
      updatedAt: 'Atualizado em'
    },
    links: {
      executions: 'Ver registros de execução',
      bindings: 'Ver vínculos relacionados'
    },
    empty: {
      title: 'Nenhum plano de implantação',
      description: 'Comece por um certificado ou vínculo, gere a prévia de impacto no assistente de implantação e então envie o plano.'
    },
    disabled: {
      missingApproval: 'Faltam informações de aprovação, portanto a execução não é permitida.',
      approvalPending: 'A solicitação de aprovação foi enviada. Um aprovador precisa aprová-la antes da execução.',
      approvalRejected: 'A aprovação foi rejeitada. A execução está indisponível.',
      needDryRun: 'Antes da execução real, é obrigatório concluir uma prévia de impacto Dry-run com sucesso.',
      missingRunId: 'Falta runId, portanto o rollback não é permitido.',
      missingSelection: 'Falta selecionar um plano de implantação'
    },
    common: {
      cancel: 'Cancelar',
      close: 'Fechar',
      notConfigured: 'Não configurado',
      notProvided: 'Não informado'
    },
    approval: {
      title: 'Detalhes da aprovação',
      description: 'Revise o escopo do plano de implantação e aprove ou rejeite a solicitação diretamente.',
      requestedBy: 'Solicitado por',
      riskLevel: 'Nível de risco',
      decisionHint: 'A aprovação permite a execução real. Um plano rejeitado precisa ser enviado novamente.',
      processing: 'Processando...',
      missingApprovalId: 'O ID da aprovação está ausente; não é possível revisar esta solicitação.',
      decisionFailed: 'Falha na operação de aprovação.'
    },
    detail: {
      certificateVersionLabel: 'Versão do certificado',
      description: 'Veja informações básicas do plano, registros relacionados e o resultado da execução mais recente.',
      emptyRelatedRecords: 'Nenhum registro relacionado.',
      loadingRelatedRecords: 'Carregando registros relacionados...',
      noExecutionRecords: 'Este plano ainda não tem registros de execução.',
      inputSourcesLoadFailed: 'Falha ao carregar as origens das entradas de implantação',
      inputSourcesTitle: 'Origens das entradas de implantação',
      inputSource: 'Origem: {source}',
      inputSourceTarget: 'Alvo de implantação: {targetId}',
      noInputSources: 'Nenhuma origem de variável disponível para este plano.',
      noTargetSummary: 'Resumo do alvo não informado',
      workflowIdentityTitle: 'Identidade de execução do workflow',
      workflowMode: 'Workflow do usuário',
      workflowModePluginInternal: 'Workflow integrado do plugin',
      workflowDslVersion: 'Versão efetiva do DSL: {version}',
      workflowPluginVersion: 'Versão efetiva do plug-in: {version}',
      workflowPluginVersionId: 'ID da versão do plug-in: {versionId}',
      workflowVersionId: 'ID do snapshot da versão: {versionId}',
      workflowVersionSelectionPinned: 'Política de versão: fixada pelo plano',
      workflowVersionSelectionLatest: 'Política de versão: última publicada pelo ativo da aplicação',
      workflowIdentityUnavailable: 'Informações da versão do workflow indisponíveis',
      planIdLine: 'ID do plano {planId}',
      recordKinds: {
        certificateUpdate: 'Atualização de certificado',
        dryRun: 'Dry-run'
      },
      relatedPlan: 'Plano {planId}',
      relatedRun: 'Execução {runId}',
      relatedSource: 'Origem {source}',
      tabs: {
        latestExecution: 'Execução mais recente',
        relatedRecords: 'Registros relacionados',
        summary: 'Resumo'
      },
      targetLabel: 'Alvo',
      title: 'Detalhes do plano de implantação',
      titleWithName: 'Plano de implantação {name}',
      viewLogs: 'Ver logs'
    },
    dryRunRequired: {
      copy: 'Operação atual: {action}. Faça primeiro um Dry-run, confirme o escopo de impacto e as conclusões das verificações, e só então continue com a execução real.',
      description: 'Antes da execução real, é obrigatório concluir uma prévia de impacto Dry-run com sucesso.',
      primaryAction: 'Fazer Dry-run primeiro',
      runningAction: 'Iniciando Dry-run…',
      title: 'É necessário executar Dry-run primeiro'
    },
    execution: {
      applyName: 'Execução de implantação {runId}',
      applyTitle: 'Execução de atualização de certificado',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Resultado do Dry-run',
      fallbackName: 'Execução {runId}',
      rollbackTitle: 'Execução de rollback de certificado',
      startingName: 'Iniciando execução'
    },
    feedback: {
      cancelled: 'Plano de implantação cancelado.',
      cancelledWithPlanId: 'Plano de implantação cancelado (plano {planId}).',
      deleted: 'Plano de implantação excluído.',
      deletedWithPlanId: 'Plano de implantação excluído (plano {planId}).',
      dryRunStartedMissingRunId: 'Pré-verificação iniciada.',
      dryRunStartedWithRunId: 'Pré-verificação iniciada ({runId}); acompanhe o progresso na janela.',
      dryRunTriggered: 'Pré-verificação acionada.',
      dryRunTriggeredWithPlanId: 'Pré-verificação acionada (plano {planId}).',
      dryRunTriggeredWithRunId: 'Pré-verificação acionada ({runId}); acompanhe o progresso na janela.',
      dryRunTaskStarted: 'Dry-run iniciado. Acompanhe o progresso pela lista de tarefas no canto superior direito.',
      executeTriggered: 'Implantação acionada.',
      executeTriggeredWithPlanId: 'Implantação acionada (plano {planId}).',
      executeTriggeredWithRunId: 'Implantação acionada ({runId}); acompanhe o progresso na janela.',
      executionTaskStarted: 'Tarefa iniciada. Acompanhe o progresso pela lista de tarefas no canto superior direito.',
      executionTaskSucceeded: 'Tarefa concluída com sucesso. Consulte o resultado na lista de tarefas no canto superior direito.',
      executeTaskStarted: 'Implantação do certificado iniciada. Acompanhe o progresso pela lista de tarefas no canto superior direito.',
      rollbackTaskStarted: 'Rollback do certificado iniciado. Acompanhe o progresso pela lista de tarefas no canto superior direito.',
      loadedDraft: 'Rascunho do plano carregado.',
      loadedDraftWithPlanId: 'Rascunho carregado (plano {planId}).',
      savedWithPlanId: 'Plano salvo ({planId}).',
      submitted: 'Plano de implantação enviado.',
      submittedWithPlanId: 'Plano de implantação enviado (plano {planId}).',
      approvalApproved: 'Aprovação concluída. O plano pode ser executado.',
      approvalApprovedWithPlanId: 'Aprovação concluída. O plano {planId} pode ser executado.',
      approvalRejected: 'Aprovação rejeitada. O plano não pode ser executado.',
      approvalRejectedWithPlanId: 'Aprovação rejeitada. O plano {planId} não pode ser executado.'
    },
    target: {
      controlPlane: 'Plataforma',
      noBindingInfo: 'Informações de vínculo não informadas',
      noCertificateVariables: 'Variáveis de certificado não vinculadas',
      noHostHeader: 'Host Header não informado',
      noOutputSelected: 'Nenhuma saída selecionada'
    },
    errors: {
      actionFailed: '{action} falhou',
      createReturnedMissingPlanId: 'O plano foi criado, mas nenhum identificador foi retornado. Atualize a lista.',
      loadCreateDataFailed: 'Falha ao carregar dados de criação do plano de implantação',
      loadRelatedRecordsFailed: 'Falha ao carregar registros relacionados',
      missingApplicationAssetIdForDryRun: 'Falta o ativo de aplicação; não é possível iniciar a pré-verificação.',
      missingApplicationAssetIdForSave: 'Falta o ativo de aplicação; não é possível salvar o plano.',
      missingPlanId: 'Identificador do plano ausente. Selecione novamente.',
      missingPlanIdForAction: '{action} falhou: identificador do plano ausente. Selecione novamente.',
      missingRunIdRequest: 'Identificador da execução ausente. Selecione novamente.',
      saveFailed: 'Falha ao salvar o plano de implantação',
      startDryRunFailed: 'Falha ao iniciar dry-run'
    }
  },
  agents: {
    actions: {
      close: 'Fechar',
      delete: 'Excluir',
      deleteRisk: 'Excluir remove diretamente o registro do Agent, e esta operação não pode ser desfeita.',
      detail: 'Detalhes',
      disable: 'Desativar',
      disableRisk: 'Depois de desativado, este Agent deixará de receber novas tarefas.',
      enable: 'Ativar',
      enableRisk: 'Depois de ativado, este Agent voltará ao estado escalonável.'
    },
    app: {
      fallbackName: 'Aplicação {index}'
    },
    certificate: {
      boundCertificate: 'Certificado vinculado ao site',
      expiredDays: 'Expirado há {days} dias',
      expiresToday: 'Expira hoje',
      modalDescription: 'Exibe as principais informações do certificado usado pelo vínculo do site atual.',
      modalTitle: 'Detalhes do certificado',
      overviewDescription: 'Exibe nome do certificado, emissor, início da validade, expiração, impressão digital e outras informações principais.',
      overviewTitle: 'Visão geral do certificado',
      projectDetailDescription: 'Exibe detalhes do ativo de certificado no projeto atual e seus usos relacionados no contexto deste Agent.',
      projectDetailTitle: 'Detalhes do certificado neste projeto',
      querying: 'Consultando...',
      remainingDays: '{days} dias restantes',
      remainingWithViewAction: '{remaining} / clique para ver o certificado',
      statusExpired: 'Expirado',
      statusExpiring: 'Perto de expirar',
      statusLabel: 'Status do certificado',
      statusUnknown: 'Validade desconhecida',
      statusValid: 'Válido',
      view: 'Ver certificado',
      viewProjectDetail: 'Ver detalhes do certificado neste projeto'
    },
    certificateUsage: {
      iisSite: 'Site IIS do Agent',
      linuxSite: 'Site Linux do Agent',
      tomcatConnector: 'Conector Tomcat do Agent'
    },
    columns: {
      actions: 'Ações',
      hostname: 'Nome do host',
      ipAddress: 'Endereço IP',
      lastHeartbeat: 'Último heartbeat',
      onlineStatus: 'Status online',
      osType: 'Tipo de sistema',
      version: 'Versão'
    },
    common: {
      defaultAddress: 'Endereço padrão',
      no: 'Não',
      noHostHeader: 'Sem Host Header',
      noListenAddress: 'Sem endereço de escuta',
      none: 'Nenhum',
      notConfigured: 'Não configurado',
      notProvided: 'Não informado',
      notWritable: 'Não gravável',
      unrecognized: 'Não reconhecido',
      writable: 'Gravável',
      yes: 'Sim'
    },
    detail: {
      loading: 'Carregando detalhes...',
      manualRescan: 'Revarredura manual',
      manualRescanCannotPullTasks: 'Este Agent não pode buscar tarefas, portanto a revarredura não pode ser executada',
      manualRescanCreated: 'Tarefa de revarredura manual criada. Aguardando o Agent buscá-la para execução.',
      manualRescanSubmitting: 'Enviando revarredura...',
      manualRescanUnsupportedType: 'Este tipo de Agent não oferece suporte a revarredura manual',
      modalDescription: 'Veja as principais informações do Agent, o ambiente de execução e os dados de sites IIS.',
      modalTitle: 'Detalhes do Agent',
      nodeEyebrow: 'Nó do Agent',
      tabsAriaLabel: 'Abas de detalhes do Agent'
    },
    empty: {
      description: 'Clique em "Instalar Agent", escolha a plataforma e a versão e gere um comando de instalação de uso único.',
      noFrameworkSites: 'Nenhum site {name} encontrado',
      noIisSites: 'Nenhum site IIS encontrado',
      noRuntimeLogs: 'Nenhum log de execução',
      noTomcatApps: 'Nenhuma aplicação Tomcat encontrada',
      noTomcatConnectors: 'Nenhum conector Tomcat encontrado',
      title: 'Nenhum Agent'
    },
    errors: {
      certificateAssetIncomplete: 'Os dados do ativo de certificado estão incompletos; não é possível abrir os detalhes.',
      certificateAssetNotFound: 'Nenhum ativo de certificado correspondente foi encontrado neste projeto.',
      certificateAssetQueryFailed: 'Falha ao consultar o ativo de certificado.',
      detailDataMissing: 'Não foi possível obter as informações de detalhe.',
      generateInstallCommandFailed: 'Falha ao gerar o comando de instalação.',
      installCommandMissing: 'O sistema não retornou o comando de instalação.',
      loadDetailFailed: 'Falha ao carregar detalhes.',
      manualRescanFailed: 'Falha ao iniciar a revarredura manual.'
    },
    fields: {
      agentVersion: 'Versão do Agent',
      appCount: 'Quantidade de aplicações',
      appList: 'Lista de aplicações',
      appPool: 'Pool de aplicações',
      arch: 'Arquitetura do sistema',
      binaryPath: 'Caminho do binário',
      certificateFile: 'Arquivo do certificado',
      certificateName: 'Nome do certificado',
      certificateStore: 'Repositório de certificados',
      certificateSubject: 'Assunto do certificado',
      certificateThumbprint: 'Impressão digital do certificado',
      configFile: 'Arquivo de configuração',
      configPath: 'Caminho da configuração',
      connectorCount: 'Quantidade de conectores',
      connectorList: 'Lista de conectores',
      domain: 'Domínio',
      frameworkVersion: 'Versão do {name}',
      healthStatus: 'Status de saúde',
      healthSummary: 'Resumo de anomalias',
      hostname: 'Nome do host',
      httpsBinding: 'Binding HTTPS',
      httpsListen: 'Escuta HTTPS',
      iisVersion: 'Versão do IIS',
      installPrefix: 'Prefixo de instalação',
      installStatus: 'Status da instalação',
      ipAddress: 'Endereço IP',
      issuer: 'Emissor',
      lastCapabilityReportAt: 'Último envio de capacidades',
      lastHeartbeat: 'Último heartbeat',
      lastRecoveryAt: 'Última recuperação',
      lastReportAt: 'Último envio',
      linuxDistribution: 'Distribuição Linux',
      listenAddress: 'Endereço de escuta',
      notAfter: 'Expira em',
      notBefore: 'Início da validade',
      offlineDetected: 'Offline detectado',
      osType: 'Tipo de sistema',
      osVersion: 'Versão do sistema operacional',
      patchVersion: 'Versão do patch',
      privateKeyOrKeystore: 'Chave privada / Keystore',
      proxyTarget: 'Alvo do proxy',
      remainingDays: 'Dias restantes',
      role: 'Função',
      runningStatus: 'Status de execução',
      runtimeLog: 'Log de execução',
      serviceName: 'Nome do serviço',
      sha256Fingerprint: 'Impressão digital SHA-256',
      siteCount: 'Quantidade de sites',
      siteList: 'Lista de sites',
      tlsConnector: 'Conector TLS',
      tomcatVersion: 'Versão do Tomcat',
      zone: 'Zona'
    },
    health: {
      degraded: 'Degradado',
      failed: 'Falha',
      healthy: 'Saudável',
      unknown: 'Desconhecido'
    },
    install: {
      bootstrapToken: 'Código de instalação',
      command: 'Comando de instalação',
      commandStepTitle: 'Gerar comando de instalação',
      commandCopied: 'Comando de instalação copiado',
      copyCommand: 'Copiar comando de instalação',
      copyToken: 'Copiar código de instalação',
      expired: 'Expirado',
      generateCommand: 'Gerar comando de instalação',
      generating: 'Gerando...',
      compatibilityInstallUnavailable: 'O instalador de uso único do Windows Compatibility Agent ainda não foi publicado. Não use um comando do Windows Modern Agent como substituto.',
      installEntryPending: 'Instalador pendente',
      linuxGeneralTitle: 'Agent Linux genérico',
      linuxGroupTitle: 'Linux',
      modalDescription: 'Escolha a plataforma e a versão para gerar um comando de instalação de uso único. O código de instalação é válido por 10 minutos e só pode ser usado uma vez.',
      modalTitle: 'Instalar Agent',
      platform: 'Plataforma',
      platformLinuxDescription: 'Para Ubuntu, Debian, CentOS, Rocky, AlmaLinux e outras distribuições Linux.',
      platformWindowsDescription: 'Para Windows Server e Windows 10/11; após a instalação, registra-se como serviço do sistema.',
      remainingTime: '{minutes}min {seconds}s',
      remainingValidity: 'Validade restante',
      selectedAgent: 'Agent selecionado',
      selectionStepTitle: 'Selecionar tipo de Agent',
      singleUseHint: 'Assim que o mesmo código de instalação for solicitado pelo script bootstrap, ele expira imediatamente e não pode ser reutilizado.',
      tokenCopied: 'Código de instalação copiado',
      version: 'Versão',
      versionLatest: 'Última versão estável',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 ou posterior',
      windowsModernTitle: 'Windows Modern Agent',
      zone: 'Zona'
    },
    labels: {
      certificatePath: 'Certificado: {value}',
      deployDirectory: 'Diretório de implantação: {value}',
      directory: 'Diretório: {value}',
      keystorePath: 'Keystore: {value}',
      listenAddress: 'Endereço de escuta: {value}',
      path: 'Caminho: {value}',
      privateKeyPath: 'Chave privada: {value}',
      reloadCommand: 'Comando Reload: {value}',
      siteName: 'Nome do site: {value}',
      taskType: 'Tipo de tarefa: {value}',
      testCommand: 'Comando de teste: {value}',
      thumbprint: 'Impressão digital: {value}'
    },
    linux: {
      certDirectoryWritable: 'Diretório de certificados: {status}',
      helperRequired: 'Helper necessário',
      keyDirectoryWritable: 'Diretório de chaves privadas: {status}',
      permissionMode: 'Modo de permissão: {mode}'
    },
    logs: {
      collapse: 'Recolher',
      expand: 'Expandir',
      listAriaLabel: 'Lista de logs de execução'
    },
    metrics: {
      abnormalDescription: 'Agents offline, com falha ou com drift precisam de tratamento prioritário.',
      abnormalTitle: 'Agents anormais',
      totalDescription: 'Quantidade de Agents atualmente registrados no sistema.',
      totalTitle: 'Total de Agents'
    },
    page: {
      description: 'Veja a lista de Agents, gere comandos de instalação para diferentes plataformas e consulte detalhes na janela.',
      installAgent: 'Instalar Agent'
    },
    sections: {
      frameworkOverviewDescription: 'Status de instalação, status de execução e localização da configuração do {name} no host.',
      frameworkOverviewTitle: 'Visão geral do {name}',
      frameworkSitesDescription: 'Sites, diretórios raiz, domínios, alvos de proxy reverso e caminhos de certificados identificados pelo {name}.',
      frameworkSitesTitle: 'Sites {name}',
      healthDescription: 'Julgamento offline do sistema, horário de recuperação e resumo de saúde de execução do Agent.',
      healthTitle: 'Saúde e recuperação',
      iisOverviewDescription: 'Status de instalação e informações de versão do IIS no host.',
      iisOverviewTitle: 'Visão geral do IIS',
      iisSitesDescription: 'Lista de sites IIS, caminhos dos sites, portas de binding e nomes de assunto dos certificados.',
      iisSitesTitle: 'Sites IIS',
      logOverviewDescription: 'Horário do último envio de capacidades, usado para avaliar a atualidade das informações.',
      logOverviewTitle: 'Visão geral de logs',
      mainInfoDescription: 'Identidade, função e status de heartbeat do Agent.',
      mainInfoTitle: 'Informações principais',
      runtimeDescription: 'Sistema de execução e informações de versão reportados pelo Agent.',
      runtimeLogsDescription: 'Logs de execução de revarredura manual, anomalias de heartbeat e interrupções de envio de capacidades.',
      runtimeLogsTitle: 'Logs de execução',
      runtimeTitle: 'Ambiente de execução',
      tomcatAppsDescription: 'Caminhos de aplicações e diretórios de implantação identificados em Tomcat Host/Context.',
      tomcatAppsTitle: 'Aplicações Tomcat',
      tomcatConnectorsDescription: 'Endereço de escuta, protocolo, chave TLS e caminho de certificado do Tomcat Connector.',
      tomcatConnectorsTitle: 'Conectores Tomcat',
      tomcatOverviewDescription: 'Status de instalação, status de execução e caminho Catalina do Tomcat no host.',
      tomcatOverviewTitle: 'Visão geral do Tomcat'
    },
    site: {
      domainCount: '{count} domínios',
      fallbackName: 'Site {index}'
    },
    siteMode: {
      reverseProxy: 'Proxy reverso',
      staticRoot: 'Site estático'
    },
    status: {
      installed: 'Instalado',
      notInstalled: 'Não instalado',
      notRunning: 'Não está em execução',
      running: 'Em execução'
    },
    tabs: {
      logs: 'Logs',
      overview: 'Visão geral'
    }
  },
  dashboard: {
    aria: {
      assetHeatmap: 'Mapa de calor de status dos ativos de aplicação',
      certificateStatusList: 'Lista de status dos certificados',
      metrics: 'Indicadores principais',
      quickActions: 'Entradas principais de funcionalidades',
      statusHeatmap: 'Status de certificados, Agents, gateways e ativos de aplicação',
      statusLegend: 'Legenda de status'
    },
    assets: {
      groupCount: '{summary} · {total} itens',
      title: 'Status dos ativos de aplicação',
      updatedAt: 'Atualizado em {time}'
    },
    audit: {
      description: 'Exibe primeiro falhas, recusas, eventos de alto risco e mudanças críticas de negócio.',
      title: 'Logs de auditoria recentes'
    },
    certificateState: {
      critical: 'Perto de expirar',
      expired: 'Expirado',
      expiring: 'Expirando em breve',
      unknown: 'Desconhecido',
      valid: 'Normal'
    },
    days: {
      expired: 'Expirado há {days} dias',
      expiresToday: 'Expira hoje',
      notRecorded: 'Não registrado',
      remaining: '{days} dias'
    },
    empty: {
      noAuditLogs: 'Nenhum log de auditoria',
      noCertificateStatus: 'Nenhum dado de status de certificado',
      noObjects: 'Nenhum objeto'
    },
    errors: {
      loadFailed: 'Falha ao carregar dados da visão geral',
      missingOverviewData: 'Não foi possível obter as informações da visão geral.'
    },
    legend: {
      disabled: 'Desativado',
      error: 'Anormal',
      ok: 'Normal',
      unknown: 'Desconhecido',
      warning: 'Atenção'
    },
    loading: {
      description: 'Carregando informações da visão geral…',
      title: 'Carregando'
    },
    metrics: {
      activeAgents: {
        title: 'Quantidade de Agents ativos',
        description: 'Agents atualmente online e escalonáveis.'
      },
      activeGateways: {
        title: 'Quantidade de gateways ativos',
        description: 'Gateways de zonas isoladas atualmente online.'
      },
      applications: {
        title: 'Quantidade atual de aplicações',
        description: 'Ativos de entrada de aplicação já gerenciados.'
      },
      expiringCertificates: {
        title: 'Certificados que expiram em 15 dias',
        description: 'Certificados que exigem renovação ou substituição.'
      },
      managedBindings: {
        title: 'Quantidade de vínculos gerenciados',
        description: 'Vínculos de certificados que já estão em estado gerenciado.'
      },
      validCertificates: {
        title: 'Quantidade de certificados ativos',
        description: 'Versões de certificado ativas e ainda não expiradas.'
      }
    },
    quickActions: {
      agents: {
        title: 'Agent',
        description: 'Veja status online e capacidades de tarefa.'
      },
      assets: {
        title: 'Ativos de aplicação',
        description: 'Mantenha domínios, portas e alvos de implantação.'
      },
      audits: {
        title: 'Logs de auditoria',
        description: 'Rastreie operadores e resultados de execução.'
      },
      certificates: {
        title: 'Gestão de certificados',
        description: 'Importe, veja e converta certificados.'
      },
      deploymentPlans: {
        title: 'Planos de implantação',
        description: 'Crie e execute planos de atualização de certificados.'
      },
      gateways: {
        title: 'Gateway',
        description: 'Gerencie entradas de execução em zonas isoladas.'
      }
    },
    statusBlock: {
      detail: {
        certificateRemaining: '{name}, {days}'
      },
      status: {
        active: 'Ativo',
        critical: 'Perto de expirar',
        deleted: 'Excluído',
        disabled: 'Desativado',
        expired: 'Expirado',
        expiring: 'Expirando em breve',
        inactive: 'Inativo',
        offline: 'Offline',
        online: 'Online',
        retired: 'Retirado',
        revoked: 'Revogado',
        stale: 'Expirado sem atualização',
        unknown: 'Desconhecido',
        unreachable: 'Inacessível',
        upgrading: 'Atualizando',
        valid: 'Normal'
      }
    },
    statusGroups: {
      agents: {
        title: 'Agent'
      },
      applicationAssets: {
        title: 'Ativos de aplicação'
      },
      certificates: {
        title: 'Certificados'
      },
      gateways: {
        title: 'Gateways'
      },
      summary: {
        allNormal: 'Tudo normal',
        needsAttention: '{count} precisam de atenção'
      }
    },
    table: {
      bindings: 'Vínculos',
      certificate: 'Certificado',
      domain: 'Domínio',
      notAfterMissing: 'Expiração não registrada',
      remainingTime: 'Tempo restante',
      status: 'Status'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: 'Adicionar Gateway Agent',
      close: 'Fechar',
      copied: 'Copiado',
      copyEnableCommand: 'Copiar comando de ativação',
      copyInstallCommand: 'Copiar comando de instalação',
      detail: 'Detalhes',
      enableExistingAgent: 'Ativar Gateway em Agent existente',
      generateEnableCommand: 'Gerar comando de ativação',
      generateInstallCommand: 'Gerar comando de instalação',
      generating: 'Gerando...',
      probe: 'Sondar',
      probeRisk: 'Inicia uma sondagem de acessibilidade a partir da região deste Gateway.'
    },
    columns: {
      actions: 'Ações',
      gateway: 'Gateway',
      lastHeartbeat: 'Último heartbeat',
      load: 'Carga',
      region: 'Região',
      status: 'Status'
    },
    detail: {
      abilities: {
        agentTask: {
          description: 'Encaminha implantação, verificações e outras tarefas para Agents dentro da região.',
          title: 'Encaminhamento de tarefas'
        },
        directControl: {
          description: 'Encaminha operações controladas para Agents dentro da região, sem que o sistema precise acessar diretamente portas internas.',
          title: 'Encaminhamento de controle remoto'
        },
        probe: {
          description: 'Verifica, a partir desta região, se hosts, sites ou Agents estão acessíveis.',
          title: 'Verificação de conectividade'
        }
      },
      eyebrow: 'Gateway regional',
      heroDescription: 'Responsável por sondagem e encaminhamento na região {region}',
      overview: {
        availableCapacity: 'Capacidade disponível',
        connectionStatus: 'Status da conexão',
        lastContact: 'Último contato',
        processing: 'Processando',
        serviceRegion: 'Região de serviço',
        successRate: 'Taxa de sucesso'
      },
      sections: {
        overview: 'Visão geral de execução',
        services: 'Serviços disponíveis'
      }
    },
    empty: {
      description: 'Adicione um Gateway Agent ou ative a função Gateway em um Agent existente.',
      title: 'Nenhum gateway'
    },
    errors: {
      generateEnableCommandFailed: 'Falha ao gerar o comando de ativação do Gateway.',
      generateInstallCommandFailed: 'Falha ao gerar o comando de instalação do Gateway Agent.',
      missingEnableCommand: 'O sistema não retornou o comando de ativação do Gateway.',
      missingInstallCommand: 'O sistema não retornou o comando de instalação do Gateway Agent.'
    },
    fields: {
      config: 'Configuração',
      enableCommand: 'Comando de ativação',
      expiresAt: 'Expira em',
      installCode: 'Código de instalação',
      installCommand: 'Comando de instalação',
      platform: 'Plataforma',
      region: 'Região',
      service: 'Serviço',
      unboundAgent: 'Não vincular a um Agent específico'
    },
    links: {
      assets: 'Ver ativos',
      executions: 'Ver registros de execução'
    },
    modals: {
      detail: {
        title: 'Detalhes do gateway'
      },
      enable: {
        title: 'Ativar Gateway em Agent existente'
      },
      install: {
        title: 'Adicionar Gateway Agent'
      }
    },
    page: {
      description: 'Gerencie Gateway Agents de roteamento regional.',
      title: 'Gateways'
    },
    platforms: {
      linuxSystemd: {
        description: 'Instalar o serviço Gateway Agent em um host Linux'
      },
      windowsService: {
        description: 'Instalar o serviço Gateway Agent em um host Windows'
      }
    },
    resourceName: 'Gateway',
    status: {
      disabled: 'Desativado',
      offline: 'Offline',
      online: 'Online normal',
      revoked: 'Revogado',
      upgrading: 'Atualizando'
    },
    values: {
      availableCapacity: 'Pode receber {count} tarefas',
      defaultRegion: 'Região padrão',
      regionGatewayName: 'Gateway {region}',
      taskCount: '{count} tarefas'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'Serviço lê Secret',
      secretResolve: 'Executor lê Secret',
      secretCreate: 'Criar Secret',
      secretVersionCreate: 'Criar versão do Secret',
      secretRotate: 'Rotacionar Secret',
      certificateImport: 'Importar certificado',
      certificateFormatUpdate: 'Atualizar artefato do certificado',
      certificateFormatDelete: 'Excluir artefato do certificado',
      deploymentCreate: 'Criar plano de implantação',
      deploymentExecute: 'Executar plano de implantação',
      deploymentRollback: 'Solicitar rollback',
      approvalCreate: 'Criar aprovação',
      approvalApprove: 'Aprovar solicitação',
      approvalReject: 'Rejeitar solicitação',
      authLogin: 'Login do usuário',
      authLogout: 'Logout do usuário'
    },
    events: {
      authLoginSuccess: 'Login bem-sucedido',
      authLoginFailure: 'Falha no login',
      authLoginFailed: 'Falha no login',
      authLogout: 'Logout realizado',
      authExternalLoginSuccess: 'Login por identidade externa bem-sucedido',
      authExternalLoginFailed: 'Falha no login por identidade externa',
      secretCreated: 'Secret criado',
      secretVersionCreated: 'Versão do Secret criada',
      secretUsed: 'Secret lido',
      secretRotated: 'Secret rotacionado',
      permissionDenied: 'Permissão negada',
      approvalCreated: 'Aprovação criada',
      approvalApproved: 'Aprovação concedida',
      approvalRejected: 'Aprovação rejeitada',
      certificateImported: 'Certificado alterado',
      deploymentCreated: 'Implantação criada',
      deploymentExecuted: 'Implantação executada',
      deploymentRollbackRequested: 'Rollback da implantação solicitado',
      pluginInstalled: 'Plugin instalado',
      pluginPermissionDenied: 'Permissão do plugin negada',
      workflowTemplateExecuted: 'Template de workflow executado'
    },
    types: {
      audit: 'Auditoria',
      auth: 'Autenticação',
      security: 'Segurança',
      secret: 'Secret',
      certificate: 'Certificado',
      certificateVersion: 'Certificado',
      certificateVersionFormat: 'Artefato do certificado',
      deployment: 'Implantação',
      deploymentPlan: 'Plano de implantação',
      execution: 'Execução',
      approval: 'Aprovação',
      permission: 'Permissão',
      plugin: 'Plugin',
      workflowTemplate: 'Fluxo de trabalho',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Ativo de aplicação',
      binding: 'Vinculação'
    },
    actors: {
      user: 'Usuário',
      system: 'Sistema',
      agent: 'Agent',
      plugin: 'Plugin',
      executor: 'Executor'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Versão do Secret',
      certificate: 'Certificado',
      certificateVersion: 'Versão do certificado',
      certificateVersionFormat: 'Artefato do certificado',
      deployment: 'Implantação',
      deploymentPlan: 'Plano de implantação',
      execution: 'Tarefa de execução',
      executionRun: 'Tarefa de execução',
      approval: 'Solicitação de aprovação',
      plugin: 'Plugin',
      workflowTemplate: 'Template de workflow',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Ativo de aplicação',
      binding: 'Vinculação de certificado',
      auditLog: 'Log de auditoria'
    },
    results: {
      success: 'Sucesso',
      failure: 'Falha',
      denied: 'Negado'
    },
    verbs: {
      success: ' concluiu ',
      failure: ' falhou ',
      denied: ' negou '
    },
    tokens: {
      auth: 'autenticação',
      login: 'login',
      logout: 'logout',
      external: 'externo',
      secret: 'Secret',
      resolve: 'ler',
      service: 'serviço',
      used: 'usado',
      created: 'criado',
      create: 'criar',
      updated: 'atualizado',
      update: 'atualizar',
      deleted: 'excluído',
      delete: 'excluir',
      version: 'versão',
      certificate: 'certificado',
      imported: 'importado',
      import: 'importar',
      format: 'artefato',
      deployment: 'implantação',
      executed: 'executado',
      execute: 'executar',
      rollback: 'rollback',
      requested: 'solicitado',
      approval: 'aprovação',
      approved: 'aprovado',
      rejected: 'rejeitado',
      permission: 'permissão',
      denied: 'negado',
      gateway: 'gateway',
      credential: 'credencial',
      issued: 'emitido',
      revoked: 'revogado',
      task: 'tarefa',
      evidence: 'evidência',
      recorded: 'registrado',
      result: 'resultado',
      plugin: 'plugin',
      workflow: 'workflow',
      template: 'template',
      synced: 'sincronizado',
      tested: 'testado',
      source: 'origem',
      identity: 'fonte de identidade',
      group: 'grupo',
      mapping: 'mapeamento'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb}"{title}", objeto: {resource}.',
    fallbacks: {
      unknown: 'Desconhecido'
    }
  },
  audit: {
    page: {
      title: 'Logs de auditoria',
      description: 'Organiza logs por ações de usuários, falhas/negações e alterações críticas de negócio, mantendo resumos legíveis.'
    },
    actions: {
      exportEvidence: 'Exportar evidências de auditoria',
      exporting: 'Exportando…',
      refreshing: 'Atualizando…'
    },
    errors: {
      exportFailed: 'Falha ao exportar evidências de auditoria',
      loadFailed: 'Falha ao carregar logs de auditoria',
      withRequestId: '{message} ({requestId})'
    },
    metrics: {
      ariaLabel: 'Visão geral da auditoria',
      total: {
        title: 'Total de auditorias',
        description: 'Registros de operação rastreáveis no escopo de filtro atual.'
      },
      failed: {
        title: 'Falhas / negações',
        description: 'Execuções com falha e acessos negados que exigem revisão prioritária.'
      },
      userActions: {
        title: 'Ações de usuários',
        description: 'Alterações de negócio e ações de acesso iniciadas diretamente por usuários.'
      }
    },
    list: {
      ariaLabel: 'Lista de logs de auditoria',
      title: 'Lista de logs',
      summary: '{total} no total, ordenados por mais recentes primeiro.',
      timeNotRecorded: 'Horário não registrado'
    },
    empty: {
      title: 'Nenhum evento de auditoria',
      description: 'Operações críticas devem ser rastreáveis até os registros de operação e de tarefa correspondentes.'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: 'Falha ao carregar',
      submitFailed: 'Falha ao enviar'
    },
    actions: {
      createResource: 'Adicionar {resource}',
      submitting: 'Enviando…'
    },
    modal: {
      createDescription: 'Preencha os campos abaixo para criar {resource}'
    },
    placeholders: {
      selectField: 'Selecione {field}'
    },
    table: {
      ariaLabel: 'Lista de gerenciamento',
      resourceList: 'Lista de {resource}',
      total: '{count} no total'
    }
  },
  settings: {
    ...(licensingLocaleMessages['pt-BR'] ?? {}),
    securityLabel: 'Entrada de configurações de segurança',
    version: {
      title: 'Informações da versão',
      description: 'Visualize a versão do GCAC em execução.',
      currentVersion: 'Versão atual',
      product: 'Produto'
    },
    permissionPolicies: {
      resourceName: 'Política de permissão',
      actions: {
        create: 'Criar política'
      },
      columns: {
        id: 'ID da política',
        subjectType: 'Tipo de sujeito',
        subjectId: 'ID do sujeito',
        effect: 'Efeito',
        actions: 'Ações',
        resourceTypes: 'Tipos de recurso',
        scope: 'Escopo'
      },
      fields: {
        subjectType: 'Tipo de sujeito',
        subjectId: 'ID do sujeito',
        effect: 'Efeito',
        actions: 'Ações',
        resourceTypes: 'Tipos de recurso',
        tenantId: 'Escopo do tenant'
      },
      subjectTypes: {
        role: 'Função',
        user: 'Usuário',
        plugin: 'Plugin',
        executor: 'Executor'
      },
      effects: {
        allow: 'Permitir',
        deny: 'Negar'
      }
    },
    groupRoleMappings: {
      resourceName: 'Mapeamento de grupo',
      actions: {
        create: 'Criar mapeamento'
      },
      columns: {
        sourceId: 'ID da fonte de identidade',
        externalGroup: 'Grupo externo',
        roleId: 'Função local',
        enabled: 'Habilitado',
        updatedAt: 'Atualizado em'
      },
      fields: {
        sourceId: 'ID da fonte de identidade',
        externalGroup: 'Grupo externo',
        roleId: 'ID da função local'
      }
    },
    users: {
      title: 'Lista de sujeitos de conta',
      summary: {
        groups: '{count} no total',
        users: '{total} no total, {selected} selecionados'
      },
      actions: {
        createUser: 'Criar usuário',
        addGroup: 'Adicionar grupo',
        bulkDelete: 'Excluir em lote',
        edit: 'Editar',
        delete: 'Excluir',
        lookupLoading: 'Pesquisando...',
        lookupUser: 'Pesquisar usuário',
        lookupGroup: 'Pesquisar grupo',
        creating: 'Criando...',
        saving: 'Salvando...',
        saveChanges: 'Salvar alterações',
        adding: 'Adicionando...'
      },
      risks: {
        bulkDelete: 'A exclusão em lote remove as credenciais locais e vínculos de função dos usuários selecionados.',
        deleteUser: 'Excluir o usuário remove as credenciais locais e vínculos de função desta conta.'
      },
      tabs: {
        users: 'Usuários',
        groups: 'Grupos'
      },
      empty: {
        users: 'Nenhum usuário',
        groups: 'Nenhum grupo de usuários'
      },
      columns: {
        username: 'Nome de usuário',
        displayName: 'Nome de exibição',
        email: 'Email',
        source: 'Origem',
        identitySourceName: 'Nome da fonte de identidade',
        status: 'Status',
        tenant: 'Tenant',
        roles: 'Funções',
        lastSyncedAt: 'Última sincronização',
        updatedAt: 'Atualizado em',
        actions: 'Ações',
        groupName: 'Nome do grupo',
        code: 'Código',
        externalRef: 'Identificador externo'
      },
      dialog: {
        userCreateTitle: 'Criar usuário',
        userEditTitle: 'Editar usuário',
        userCreateDescription: 'Crie um usuário local ou pesquise um usuário da fonte de identidade pelo nome de usuário e crie um usuário vinculado.',
        userEditDescription: 'Edite o nome de exibição, email, status e funções.',
        groupCreateTitle: 'Adicionar grupo',
        groupCreateDescription: 'Crie um grupo local ou pesquise um grupo externo em uma fonte de identidade.'
      },
      aria: {
        principalType: 'Tipo de sujeito',
        createMode: 'Modo de criação',
        externalUserProfile: 'Perfil de usuário da identidade externa',
        groupCreateMode: 'Modo de criação de grupo',
        externalGroupProfile: 'Perfil do grupo da identidade externa'
      },
      modes: {
        localUser: 'Usuário local',
        externalUser: 'Usuário da fonte de identidade',
        localGroup: 'Grupo local',
        externalGroup: 'Grupo da fonte de identidade'
      },
      fields: {
        identitySource: 'Fonte de identidade',
        directoryUsername: 'Nome de usuário do diretório',
        username: 'Nome de usuário',
        displayName: 'Nome de exibição',
        email: 'Email',
        role: 'Função',
        initialPassword: 'Senha inicial',
        status: 'Status',
        directoryGroupName: 'Nome do grupo no diretório',
        groupName: 'Nome do grupo',
        groupCode: 'Código do grupo',
        directoryDn: 'Directory DN'
      },
      placeholders: {
        selectIdentitySource: 'Selecione uma fonte de identidade',
        directoryUsername: 'Por exemplo, jackson',
        displayName: 'Operador de certificados',
        initialPassword: 'Informe a senha inicial',
        directoryGroupName: 'Por exemplo, GCAC-Ops',
        groupName: 'Grupo de operações de certificados'
      },
      options: {
        unset: 'Não definido'
      },
      status: {
        active: 'Habilitado',
        disabled: 'Desabilitado'
      },
      labels: {
        identitySourceOption: '{name} ({type})'
      },
      errors: {
        loadUsersFailed: 'Falha ao carregar usuários',
        loadGroupsFailed: 'Falha ao carregar grupos de usuários',
        createUserFailed: 'Falha ao criar usuário',
        updateUserFailed: 'Falha ao atualizar usuário',
        externalUserEmpty: 'A fonte de identidade não retornou o perfil do usuário',
        lookupExternalUserFailed: 'Falha ao pesquisar usuário da fonte de identidade',
        externalGroupEmpty: 'A fonte de identidade não retornou o perfil do grupo',
        lookupExternalGroupFailed: 'Falha ao pesquisar grupo da fonte de identidade',
        createGroupFailed: 'Falha ao criar grupo de usuários',
        deleteUsersFailed: 'Falha ao excluir usuários'
      }
    },
    roles: {
      page: {
        title: 'Gerenciamento de permissões',
        description: 'Mantenha os escopos de objetos autorizados por função e atribua usuários ou grupos às funções.'
      },
      actions: {
        createRole: 'Criar função',
        refreshObjects: 'Atualizar objetos',
        loading: 'Carregando...',
        creating: 'Criando...',
        saving: 'Salvando...',
        detail: 'Detalhes',
        authorize: 'Autorizar',
        grantPermission: 'Conceder permissão',
        assignMembers: 'Atribuir membros',
        delete: 'Excluir',
        deleteRole: 'Excluir função',
        deleting: 'Excluindo...',
        clearSelection: 'Limpar seleção'
      },
      columns: {
        roleId: 'ID da função',
        code: 'Código',
        name: 'Nome',
        builtin: 'Integrada',
        policyCount: 'Quantidade de políticas',
        permissions: 'Pontos de permissão',
        actions: 'Ações',
        objectScope: 'Escopo do objeto',
        accessLevel: 'Nível de permissão',
        effect: 'Efeito',
        memberType: 'Tipo de membro',
        member: 'Membro'
      },
      table: {
        emptyRoles: 'Nenhuma função',
        roleRecords: 'Registros de função',
        emptyGrants: 'Esta função ainda não tem permissões de objeto',
        currentPermissions: 'Permissões atuais da função',
        emptyMembers: 'Esta função ainda não tem membros atribuídos',
        assignedMembers: 'Membros atribuídos'
      },
      categories: {
        certificate: 'Certificado',
        gateway: 'Gateway',
        agent: 'Agent',
        serviceAsset: 'Ativo de aplicação',
        deploymentPlan: 'Plano de atualização',
        workflow: 'Fluxo de trabalho',
        auditLog: 'Log',
        systemSetting: 'Configuração do sistema'
      },
      accessLevel: {
        read: 'Somente leitura',
        edit: 'Editar',
        control: 'Controle total'
      },
      effect: {
        allow: 'Permitir',
        deny: 'Negar'
      },
      principal: {
        user: 'Usuário',
        group: 'Grupo',
        externalGroup: 'Grupo da fonte de identidade'
      },
      summary: {
        selectedMembers: '{count} membros selecionados',
        chooseMembers: 'Selecione usuários ou grupos',
        selectedScopes: '{count} escopos selecionados',
        chooseObjectNode: 'Selecione um nó da árvore de objetos',
        selectedScopeLabel: 'Escopos selecionados',
        selectedMemberLabel: 'Membros selecionados'
      },
      tree: {
        rootLabel: 'Todos os objetos',
        rootDescription: 'Todos os objetos de negócio autorizáveis',
        typeDescription: 'Todos os registros de {category}',
        allBusinessObjects: 'Todos os objetos de negócio',
        selectedScopeAria: 'Escopos de autorização selecionados',
        objectTreeAria: 'Árvore de objetos autorizáveis',
        authorizableObjects: 'Objetos autorizáveis',
        loading: 'Carregando árvore de objetos...',
        kind: {
          all: 'Todos',
          category: 'Categoria',
          record: 'Registro'
        }
      },
      format: {
        labelWithId: '{label} ({id})',
        recordFallback: '{category} {value}',
        unnamedRecord: 'Registro sem nome'
      },
      detail: {
        title: 'Detalhes da função',
        titleWithName: 'Função {name}',
        description: 'Mantenha aqui escopos de objeto, objetos específicos, níveis de permissão e atribuições de membros.'
      },
      create: {
        title: 'Criar função',
        description: 'Preencha as responsabilidades da função e, se necessário, já autorize escopos de objeto.',
        nameLabel: 'Nome da função',
        namePlaceholder: 'Operador de certificados',
        descriptionLabel: 'Descrição',
        descriptionPlaceholder: 'Responsável pelas operações diárias de certificados',
        authorizedRole: 'Função autorizada',
        newRole: 'Nova função'
      },
      grant: {
        title: 'Conceder permissões à função',
        description: 'Selecione escopos na árvore de objetos e defina diretamente o nível de permissão desses escopos.',
        roleLabel: 'Função'
      },
      member: {
        title: 'Atribuir membros',
        titleWithName: 'Atribuir membros: {name}',
        description: 'Selecione usuários ou grupos. O sistema atribuirá os membros aos escopos de objeto já autorizados para esta função.',
        targetRole: 'Função de destino',
        authorizedScope: 'Escopo autorizado',
        objectScopeCount: '{count} escopos de objeto',
        selectedMembersAria: 'Membros selecionados',
        assignableMembersAria: 'Membros atribuíveis',
        emptyAssignable: 'Nenhum {type} atribuível'
      },
      errors: {
        loadObjectTreeFailed: 'Falha ao carregar a árvore de objetos',
        loadDataFailed: 'Falha ao carregar dados de gerenciamento de permissões',
        missingRoleId: 'ID da função não recebido',
        createRoleFailed: 'Falha ao criar função',
        grantRoleFailed: 'Falha ao conceder permissões à função',
        roleNoObjectScopes: 'Esta função ainda não tem escopos de objeto autorizados. Conceda permissões à função primeiro.',
        assignMembersFailed: 'Falha ao atribuir membros',
        deleteRoleFailed: 'Falha ao excluir função',
        missingObjectSetId: 'ID do escopo de objeto não recebido'
      },
      confirm: {
        deleteRole: 'Confirmar exclusão da função "{name}"? Após a exclusão, as atribuições de usuários e autorizações de objetos desta função também serão removidas.'
      },
      auditLogs: {
        auth: {
          name: 'Logs de login de autenticação',
          description: 'Login, logout e login por fonte de identidade externa'
        },
        security: {
          name: 'Logs de gerenciamento de segurança',
          description: 'Alterações de usuários, funções, permissões e fontes de identidade'
        },
        certificate: {
          name: 'Logs de certificados',
          description: 'Importação, versões, artefatos e vinculações de certificados'
        },
        asset: {
          name: 'Logs de ativos',
          description: 'Operações de ativos de aplicação, hosts, instâncias de serviço e ativos de site'
        },
        gateway: {
          name: 'Logs de gateway',
          description: 'Rotas, sondagens e alterações de status de gateway'
        },
        agent: {
          name: 'Logs de Agent',
          description: 'Registro, heartbeat, tarefas e operações de upgrade do Agent'
        },
        deployment: {
          name: 'Logs de planos de atualização',
          description: 'Planos de implantação, execuções, rollback e aprovações'
        },
        workflow: {
          name: 'Logs de workflow',
          description: 'Operações de templates de workflow e execuções'
        },
        secret: {
          name: 'Logs de Secret',
          description: 'Criação, uso e rotação de Secret'
        },
        system: {
          name: 'Logs do sistema',
          description: 'Configurações do sistema e eventos em nível de plataforma'
        }
      }
    },
    identitySources: {
      actions: {
        create: 'Criar fonte de identidade',
        edit: 'Editar',
        delete: 'Excluir',
        testConnection: 'Testar conectividade',
        testing: 'Testando...',
        creating: 'Criando...',
        saving: 'Salvando...',
        saveChanges: 'Salvar alterações',
        expandAdvanced: 'Expandir configurações avançadas',
        collapseAdvanced: 'Recolher configurações avançadas'
      },
      columns: {
        name: 'Nome',
        type: 'Tipo de diretório',
        server: 'Servidor',
        status: 'Status',
        actions: 'Ações'
      },
      table: {
        title: 'Lista de fontes de identidade',
        total: '{count} no total'
      },
      empty: 'Nenhuma fonte de identidade',
      dialog: {
        createTitle: 'Criar fonte de identidade',
        editTitle: 'Editar fonte de identidade',
        createDescription: 'Preencha primeiro as informações básicas de conexão; filtros e tipo de diretório ficam nas configurações avançadas.',
        editDescription: 'Altere a configuração da fonte de identidade; para atualizar a senha da conta de serviço, preencha uma nova senha.'
      },
      fields: {
        name: 'Nome',
        domain: 'Domínio',
        protocol: 'Protocolo',
        serverAddress: 'Endereço do servidor',
        baseDn: 'Base DN',
        bindDn: 'DN da conta de serviço',
        bindPassword: 'Senha da conta de serviço',
        directoryType: 'Tipo de diretório',
        defaultRole: 'Função padrão',
        enabled: 'Status de habilitação',
        userDnTemplate: 'Template de DN/UPN do usuário',
        userFilter: 'Filtro de usuários',
        groupFilter: 'Filtro de grupos',
        syncUserFilter: 'Filtro de sincronização de usuários',
        requireGroupMapping: 'Exigir que o usuário de login corresponda a um mapeamento de grupo'
      },
      placeholders: {
        name: 'Por exemplo: AD corporativo',
        domain: 'Por exemplo: example.com',
        serverAddress: 'Por exemplo: ad.example.com:636',
        baseDn: 'Por exemplo: DC=example,DC=com',
        bindDn: 'Por exemplo: CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: 'Informe a senha da conta de serviço',
        bindPasswordEdit: 'Deixe em branco para manter a senha atual',
        autoByDirectoryType: 'Deixe em branco para derivar automaticamente pelo tipo de diretório',
        userFilter: "Por exemplo: (uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "Por exemplo: (member={'{'}{'{'}userDn{'}'}{'}'})"
      },
      labels: {
        finalUrl: 'URL final: {url}'
      },
      options: {
        unset: 'Não definido'
      },
      status: {
        enabled: 'Habilitado',
        disabled: 'Desabilitado',
        disabledShort: 'Desabilitado'
      },
      types: {
        activeDirectory: 'Active Directory',
        ldap: 'LDAP padrão'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: 'Excluir a fonte de identidade invalidará o login, a sincronização e os mapeamentos de grupo deste diretório.'
      },
      test: {
        dialogTitle: 'Testar conectividade da fonte de identidade',
        dialogDescription: 'Verificando DNS, a porta de autenticação LDAP e o estado do BIND para {name} ({server}).',
        loading: 'Verificando DNS, a porta de autenticação LDAP e o estado do BIND em sequência...',
        checks: {
          dns: { title: 'Verificar resolução DNS' },
          port: { title: 'Verificar porta de autenticação LDAP' },
          bind: { title: 'Verificar LDAP BIND' }
        },
        status: {
          passed: 'Aprovado',
          failed: 'Falhou',
          skipped: 'Ignorado'
        },
        messages: {
          summaryPassed: 'Todos os testes de conectividade LDAP foram aprovados',
          summaryFailed: 'Os testes de conectividade LDAP não foram aprovados',
          dnsIp: 'O destino é um endereço IP; a consulta DNS não foi necessária',
          dnsResolved: 'DNS resolvido com sucesso: {addresses}',
          dnsFailed: 'Falha na resolução DNS',
          portReachable: 'A porta de autenticação {protocol} {port} está acessível',
          portFailed: 'A porta de autenticação LDAP está inacessível',
          bindServicePassed: 'O BIND da conta de serviço LDAP e a consulta Base DN foram concluídos',
          bindAnonymousPassed: 'O BIND LDAP anônimo e a consulta Base DN foram concluídos',
          bindFailed: 'Falha no BIND LDAP ou na consulta Base DN',
          skippedInvalidUrl: 'Ignorado porque o endereço LDAP é inválido',
          skippedDnsFailed: 'Ignorado porque a resolução DNS falhou',
          skippedPortFailed: 'Ignorado porque a porta de autenticação LDAP está inacessível',
          unknownCheck: 'O teste não foi aprovado ({code})',
          checkNotReturned: 'O servidor não retornou o resultado desta verificação.'
        },
        errors: {
          emptyResult: 'O servidor não retornou um resultado do teste de conectividade',
          requestFailed: 'Falha na solicitação de teste de conectividade'
        }
      },
      secret: {
        bindPasswordName: 'Senha da conta de serviço LDAP de {name}'
      },
      messages: {
        createSuccess: 'Fonte de identidade criada com sucesso',
        updateSuccess: 'Fonte de identidade atualizada com sucesso'
      },
      errors: {
        loadFailed: 'Falha ao carregar fontes de identidade',
        createBindPasswordSecretFailed: 'Falha ao criar Secret da senha da conta de serviço',
        createFailed: 'Falha ao criar fonte de identidade',
        updateFailed: 'Falha ao atualizar fonte de identidade',
        deleteFailed: 'Falha ao excluir fonte de identidade'
      }
    }
  },
  bindings: {
    actions: {
      create: 'Criar configuração',
      toggleFilters: 'Filtrar',
      edit: 'Editar',
      delete: 'Excluir',
      deleting: 'Excluindo...',
      applyTemplate: 'Aplicar modelo integrado',
      saving: 'Salvando...',
      confirmSave: 'Confirmar salvamento'
    },
    columns: {
      configName: 'Nome da configuração',
      targetSummary: 'Ambiente de destino',
      displayFormat: 'Formato do conteúdo',
      extension: 'Extensão',
      encodingSummary: 'Codificação',
      exportSummary: 'Conteúdo / opções de exportação',
      actions: 'Ações'
    },
    dialog: {
      createTitle: 'Criar configuração de formato de certificado',
      editTitle: 'Editar configuração de formato de certificado',
      description: 'Selecione a plataforma do sistema e a plataforma de destino; depois aplique um modelo integrado e ajuste item a item o conteúdo exportado.'
    },
    list: {
      title: 'Lista de configurações de formato de certificado',
      descriptionWithCount: 'Modelos reutilizáveis de formato de certificado. Atualmente {count} registro(s).'
    },
    empty: {
      text: 'Nenhuma configuração de formato de certificado'
    },
    fields: {
      contentFormat: 'Formato do conteúdo',
      systemPlatform: 'Plataforma do sistema',
      runtimePlatform: 'Plataforma de destino',
      configName: 'Nome da configuração',
      backendFormat: 'Formato base',
      outputExtension: 'Extensão de saída',
      expiresAt: 'Data de expiração da configuração (opcional)',
      certificateEncoding: 'Codificação do certificado',
      certificateContentEncoding: 'Codificação do conteúdo do certificado',
      privateKeyEncoding: 'Codificação da chave privada',
      includeLeafCertificate: 'Incluir certificado público',
      includeCertificateChain: 'Incluir cadeia de certificados',
      includePrivateKey: 'Incluir chave privada',
      mainArtifactIncludesChain: 'Artefato principal inclui a cadeia de certificados',
      generateChainFile: 'Gerar arquivo adicional da cadeia',
      generatePrivateKeyFile: 'Gerar arquivo adicional da chave privada',
      exportPassword: 'Senha de exportação'
    },
    formats: {
      pfx: 'Contêiner PKCS#12 / PFX',
      jks: 'Contêiner JKS',
      pemBundle: 'Bundle PEM em arquivo único',
      pemCert: 'Arquivo de certificado PEM',
      pemKey: 'Arquivo de chave privada',
      cer: 'Arquivo de certificado (.cer)',
      crt: 'Arquivo de certificado (.crt)',
      p7b: 'Cadeia de certificados PKCS#7 / P7B',
      custom: 'Personalizado'
    },
    sections: {
      templates: {
        title: 'Modelos integrados',
        description: 'Os modelos preenchem formato, conteúdo e regras de exportação com base em padrões comuns de implantação TLS, e ainda podem ser editados depois.'
      },
      basic: {
        title: 'Informações básicas',
        description: 'Defina a identidade da configuração, o formato real do conteúdo e a extensão final.'
      },
      encoding: {
        title: 'Seleção de codificação',
        description: 'Somente as opções de codificação compatíveis com o formato de conteúdo atual são exibidas.'
      },
      content: {
        title: 'Conteúdo incluído',
        description: 'Define o que o arquivo do artefato principal contém: certificado público, cadeia de certificados e chave privada.'
      },
      export: {
        title: 'Opções de exportação',
        description: 'Define se serão gerados arquivos adicionais de cadeia, arquivos de chave privada e opções de senha específicas do contêiner.'
      }
    },
    filters: {
      keywordPlaceholder: 'Nome da configuração / ambiente de destino / Alias / formato do conteúdo'
    },
    placeholders: {
      configName: 'Exemplo: PEM em arquivo único compatível com dispositivo',
      exportPassword: 'Informe a senha de exportação PFX/JKS'
    },
    validation: {
      selectPlatformsFirst: 'Selecione primeiro a plataforma do sistema e a plataforma de destino.',
      configNameRequired: 'O nome da configuração é obrigatório',
      passwordRequired: 'Configurações PFX/JKS exigem senha de exportação'
    },
    errors: {
      loadFailed: 'Falha ao carregar configurações de formato de certificado',
      saveFailed: 'Falha ao salvar a configuração de formato de certificado',
      deleteFailed: 'Falha ao excluir a configuração de formato de certificado',
      createExportSecretFailed: 'Falha ao criar o Secret da senha de exportação',
      withCode: '{message} ({code})'
    },
    fallbacks: {
      unnamedConfig: 'Configuração sem nome-{index}',
      unspecified: 'Não especificado',
      aliasUnset: 'Alias não definido'
    },
    labels: {
      aliasWithValue: 'Alias: {alias}',
      requestId: 'ID da solicitação: {requestId}'
    },
    encoding: {
      pkcs12Container: 'Contêiner PKCS#12',
      jksContainer: 'Contêiner JKS',
      privateKeyWithEncoding: 'Chave privada {encoding}',
      pkcs7Chain: 'Cadeia de certificados PKCS#7',
      certificateWithEncoding: 'Certificado {encoding}',
      default: 'Padrão'
    },
    export: {
      leafCertificate: 'Certificado público',
      certificateChain: 'Cadeia de certificados',
      privateKey: 'Chave privada',
      extraChainFile: 'Arquivo adicional da cadeia',
      extraPrivateKeyFile: 'Arquivo adicional da chave privada'
    },
    secret: {
      defaultConfigName: 'Configuração de formato de certificado',
      exportPasswordName: 'Senha de exportação de {name}'
    },
    select: {
      placeholder: 'Selecione'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: 'Já existe uma senha de exportação configurada; para substituí-la, informe diretamente uma nova senha.'
    },
    templates: {
      windowsIis: {
        configName: 'Modelo padrão Windows-IIS-PKCS12',
        description: 'O IIS normalmente usa contêiner PKCS#12/PFX; o artefato principal leva diretamente o certificado do servidor, a cadeia de certificados e a chave privada.'
      },
      windowsNginx: {
        configName: 'Modelo padrão Windows-NGINX-PEM',
        description: 'O NGINX geralmente usa um único arquivo PEM para o certificado do servidor e a cadeia, além de um arquivo separado de chave privada.'
      },
      windowsApache: {
        configName: 'Modelo padrão Windows-Apache-PEM',
        description: 'O Apache normalmente recebe um arquivo de certificado PEM e uma chave privada separada; o arquivo adicional da cadeia facilita a compatibilidade operacional.'
      },
      windowsTomcat: {
        configName: 'Modelo padrão Windows-Tomcat-PKCS12',
        description: 'O Tomcat usa principalmente keystores JKS/PKCS#12. Este modelo usa por padrão o formato PKCS#12, mais portátil.'
      },
      windowsOther: {
        configName: 'Modelo Windows de PEM em arquivo único compatível com dispositivos',
        description: 'Compatível com dispositivos que exigem um único arquivo contendo certificado público, cadeia de certificados e chave privada; a extensão pode ser ajustada para .crt/.cer.'
      },
      linuxIis: {
        configName: 'Modelo de compatibilidade Linux-IIS',
        description: 'Se o destino final ainda for IIS, o artefato de entrega mais razoável continua sendo o contêiner PKCS#12/PFX.'
      },
      linuxNginx: {
        configName: 'Modelo padrão Linux-NGINX-PEM',
        description: 'A configuração oficial do NGINX gira em torno de uma cadeia de certificados PEM em arquivo único e uma chave privada separada.'
      },
      linuxApache: {
        configName: 'Modelo padrão Linux-Apache-PEM',
        description: 'O Apache normalmente usa um arquivo de certificado PEM com chave privada separada; o arquivo adicional da cadeia facilita implantações separadas.'
      },
      linuxTomcat: {
        configName: 'Modelo padrão Linux-Tomcat-PKCS12',
        description: 'O Tomcat costuma receber um contêiner keystore. Este modelo usa o formato PKCS#12, mais portátil.'
      },
      linuxOther: {
        configName: 'Modelo Linux de PEM em arquivo único compatível com dispositivos',
        description: 'Para dispositivos Linux genéricos que aceitam um único arquivo PEM, comece com um bundle e ajuste a extensão e o conteúdo conforme o dispositivo de destino.'
      }
    }
  },
  deploymentInputs: {
    title: 'Entradas de implantação',
    description: 'Configure os valores de implantação pelo contrato de entrada unificado declarado pelo plugin ou fluxo de trabalho.',
    saveAssetFirst: 'Salve o ativo de aplicativo e a origem de execução antes de editar as entradas projetadas pelo backend.',
    contractVersion: 'Contrato {version}',
    groups: { required: 'Configuração obrigatória', advanced: 'Configuração avançada', readonly: 'Valores somente leitura e de execução' },
    actions: { expand: 'Expandir configuração avançada', collapse: 'Recolher configuração avançada' },
    placeholders: { select: 'Selecione', credential: 'Selecione uma credencial', artifact: 'Selecione um formato de artefato', output: 'Selecione uma saída' },
    artifacts: { format: 'Formato do artefato' },
    allowInsecureTls: {
      label: 'Permitir ignorar a verificação do certificado TLS',
      description: 'Autoriza explicitamente esta implantação a ignorar a verificação do certificado TLS quando o dispositivo usa um certificado autoassinado ou não confiável.',
      help: 'Isso registra apenas a intenção da implantação e não concede permissão de execução. A aprovação e uma autorização de execução emitida pelo host continuam sendo necessárias.'
    },
    runtimeValue: 'Fornecido por {source} durante a execução',
    source: 'Origem: {source}',
    sourceKinds: { asset: 'Ativo', binding: 'Vínculo', default: 'Valor padrão', derived: 'Valor derivado', system: 'Valor do sistema', step_output: 'Saída da etapa', unknown: 'Origem desconhecida' },
    issues: {
      title: 'Problemas de entrada',
      unknown: 'Falha na validação da entrada de implantação ({code})',
      DEPLOYMENT_INPUT_REQUIRED: 'Falta uma entrada de implantação obrigatória',
      DEPLOYMENT_CONNECTION_REQUIRED: 'Falta uma configuração de conexão obrigatória',
      DEPLOYMENT_CREDENTIAL_REQUIRED: 'Falta uma credencial obrigatória',
      DEPLOYMENT_ARTIFACT_REQUIRED: 'Falta um artefato de implantação obrigatório',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: 'Esta entrada de implantação não pode ser substituída',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: 'O slot da entrada de implantação não foi declarado',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: 'O campo da entrada de implantação não foi declarado',
      DEPLOYMENT_INPUT_TYPE_INVALID: 'O tipo da entrada de implantação é inválido',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: 'Uma entrada de implantação fixa não pode ser substituída',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: 'O snapshot da credencial está ausente',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: 'O snapshot da credencial não corresponde à seleção atual',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: 'O tipo de credencial não é compatível',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: 'O snapshot do artefato está ausente',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: 'Falta uma saída obrigatória do artefato'
    }
  },
  assets: {
    presentation: {
      cards: 'Visualização de cartões',
      list: 'Visualização de tabela',
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
    title: 'Ativos de aplicação',
    description: 'Gerencie entradas de aplicação por domínio ou IP, com foco em endereço, porta, protocolo, site e localização de execução.',
    resourceName: 'Ativo de aplicação',
    executionModes: {
      label: 'Modo de execução',
      plugin: { title: 'Execução por plugin', description: 'Use a capacidade de implantação de certificado habilitada para o destino gerenciado.' },
      workflowOverride: { title: 'Substituição por fluxo', description: 'Ignore o plugin e use um fluxo pertencente ao usuário.', notice: 'Este modo desativa a atribuição de plugin do ativo e mantém apenas o vínculo de execução do fluxo.' }
    },
    actions: {
      add: 'Adicionar ativo',
      edit: 'Editar',
      detail: 'Detalhes',
      addVariable: 'Adicionar variável',
      delete: 'Excluir',
      deleteRisk: 'A exclusão remove este ativo de aplicação e sua associação manual de destino da lista. Frameworks, sites, Virtual Servers e ManagedTargets descobertos são preservados.',
      rollbackFromLatestSnapshot: 'Iniciar reversão a partir do snapshot mais recente',
      rollingBack: 'Revertendo...',
      saving: 'Salvando...',
      creating: 'Criando...',
      saveChanges: 'Salvar alterações',
      confirmCreate: 'Confirmar criação'
    },
    columns: {
      domain: 'Domínio de acesso',
      port: 'Porta',
      protocol: 'Protocolo',
      platform: 'Plataforma',
      framework: 'Framework',
      site: 'Site',
      status: 'Status',
      actions: 'Ações'
    },
    fields: {
      assetId: 'ID do ativo de aplicação',
      domain: 'Domínio de acesso',
      addressType: 'Tipo de endereço',
      port: 'Porta',
      protocol: 'Protocolo',
      verifyUrl: 'URL de verificação',
      platform: 'Plataforma',
      frameworkType: 'Tipo de framework',
      deploymentStrategyCompatibility: 'Modo de compatibilidade da implantação',
      serviceInstanceId: 'ID da instância de serviço',
      siteId: 'ID do site',
      managedTargetId: 'ID do destino gerenciado',
      bindingKey: 'Chave de binding',
      hostId: 'ID do host',
      environment: 'Ambiente',
      discoverySource: 'Origem da descoberta',
      lastDiscoveredAt: 'Última descoberta em',
      tags: 'Tags',
      managedTarget: 'Destino gerenciado',
      siteName: 'Nome do site',
      bindingInformation: 'Informações de binding',
      hostHeader: 'Host Header',
      sniName: 'Nome SNI',
      currentCertificate: 'Certificado atual',
      targetCertificate: 'Certificado de destino',
      expectedFingerprint: 'Fingerprint esperado',
      certificateStore: 'Repositório de certificados',
      snapshotType: 'Tipo de snapshot',
      time: 'Hora',
      executionRun: 'Registro de execução',
      displayName: 'Nome de exibição',
      siteInstance: 'Instância do site',
      certificateFormat: 'Configuração do artefato de certificado',
      workflow: 'Fluxo de trabalho',
      workflowVersionSelection: 'Política de versão do workflow',
      publishedVersion: 'Versão publicada',
      runner: 'Local de execução',
      artifactFormat: 'Configuração de formato do artefato',
      updatePlugin: 'Plugin de atualização de certificado'
    },
    capability: { source: 'Origem da capacidade', plugin: 'Versão do plugin', runtime: 'Runtime', executionLocation: 'Local de execução', pendingAssignment: 'Ao salvar, será criada uma atribuição de capacidade de implantação no nível do ativo de aplicativo.' },
    links: {
      certificateBindings: 'Ver bindings de certificado',
      executions: 'Ver registros de execução'
    },
    empty: {
      title: 'Nenhum ativo de aplicação',
      description: 'Aguardando descoberta automática do sistema ou cadastro manual da entrada da aplicação.',
      noBindingInformation: 'Nenhuma informação de binding',
      notSet: 'Não definido',
      notSelected: 'Não selecionado',
      noVariablePreset: 'Nenhuma variável disponível para adicionar',
      basicEntryIncomplete: 'Entrada básica incompleta'
    },
    detail: {
      title: 'Detalhes da aplicação',
      description: 'Veja detalhes do ativo, relações de binding, entrada de implantação e registros de snapshot.',
      tabsAriaLabel: 'Abas de detalhes da aplicação',
      tabs: {
        overview: 'Informações básicas',
        snapshots: 'Snapshots'
      },
      loadingTargetBinding: 'Carregando detalhes do binding de destino...',
      loadingSnapshots: 'Carregando snapshots...',
      emptyCertificateBindings: 'Nenhuma relação de binding de certificado.',
      emptySnapshots: 'Nenhum snapshot.',
      rollbackSubmitted: 'Solicitação de reversão enviada. Consulte o registro de execução da reversão em "Registros de execução".',
      sections: {
        overview: {
          title: 'Informações básicas',
          description: 'O ativo de aplicação é o objeto principal; host e site aparecem apenas como informações de localização da execução.'
        },
        targetBinding: {
          title: 'Binding de destino',
          description: 'O binding deve apontar claramente para um site e um destino gerenciado, em vez de continuar tentando inferir pelo domínio.'
        },
        certificateBindings: {
          title: 'Relações de binding de certificado',
          description: 'As relações de certificado são explicitadas no binding, em vez de depender apenas do domínio.'
        },
        snapshots: {
          title: 'Snapshots',
          description: 'O estado antes da implantação, depois da implantação e após a reversão deve ser visível diretamente, não apenas como registro de tarefa.'
        }
      }
    },
    compatibilityModes: {
      unified: 'Binding unificado de plugin',
      legacy: 'Compatibilidade legada',
      legacyAdapted: 'Leitura dupla unificada e legada'
    },
    managementModes: {
      agent: 'Modo Agent',
      agentDescription: 'Vincular Agent, instância do site e destino gerenciado',
      workflow: 'Modo workflow',
      workflowDescription: 'Selecionar versão do workflow e variáveis de execução'
    },
    workflowVersionSelection: {
      pinned: 'Fixar versão selecionada',
      latestPublished: 'Sempre usar a versão publicada mais recente'
    },
    loading: {
      agents: 'Carregando Agents...',
      sites: 'Carregando sites...',
      managedTargets: 'Carregando destinos...',
      certificateFormats: 'Carregando configurações de formato...',
      workflows: 'Carregando workflows...',
      versions: 'Carregando versões...',
      gateways: 'Carregando Gateways...',
      credentials: 'Carregando credenciais...'
    },
    select: {
      agent: 'Selecione o Agent',
      siteInstance: 'Selecione a instância do site',
      managedTarget: 'Selecione o destino gerenciado',
      certificateFormat: 'Selecione a configuração do artefato de certificado',
      workflow: 'Selecione o workflow',
      publishedVersion: 'Selecione a versão publicada',
      gateway: 'Selecione o Gateway',
      variablePreset: 'Selecionar variável predefinida',
      credential: 'Selecione a credencial',
      generic: 'Selecione',
      artifactFormat: 'Selecione a configuração de formato',
      output: 'Selecione a saída',
      optionalOutput: 'Opcional',
      updatePluginOptional: 'Opcional; manter o plugin atualmente efetivo'
    },
    validation: {
      variableNameRequired: 'O nome da variável não pode ficar vazio',
      variableNameInvalid: 'O nome da variável {name} é inválido',
      variableDuplicated: 'A variável {name} está duplicada',
      variableRequired: 'A variável {name} é obrigatória',
      variableMustBeNumber: 'A variável {name} deve ser numérica',
      variableMustBeJsonObject: 'A variável {name} deve ser um objeto JSON',
      variableInvalidJson: 'A variável {name} não é um JSON válido',
      variableCredentialInvalid: 'A variável {name} deve selecionar uma credencial válida',
      certificateFormatRequired: 'A variável de certificado {name} deve selecionar uma configuração de formato de certificado',
      certificateOutputRequired: 'A variável de certificado {name}.{slot} deve selecionar uma saída',
      certificateOutputMissing: 'A saída selecionada para a variável de certificado {name}.{slot} não existe'
    },
    workflowVariableTypes: {
      string: 'Texto',
      number: 'Número',
      boolean: 'Booleano',
      enum: 'Enum',
      object: 'Objeto',
      file: 'Arquivo',
      credential: 'Credencial',
      certificate: 'Certificado'
    },
    wizard: {
      ariaLabel: 'Etapas de criação do ativo de aplicação',
      steps: {
        basicEntry: 'Entrada básica',
        deploymentMode: 'Modo de implantação',
        confirmSave: 'Confirmar salvamento'
      },
      stepState: {
        active: 'Em andamento',
        done: 'Concluído',
        pending: 'A iniciar',
        incomplete: 'Pendente',
        readyNext: 'Pronto para avançar',
        pendingSubmit: 'Aguardando envio'
      },
      panels: {
        basicEntryTitle: 'Entrada básica',
        basicEntryDescription: 'Preencha primeiro domínio, porta, protocolo e plataforma para definir a identidade da entrada de aplicação.',
        agentTitle: 'Binding de destino do Agent',
        agentDescription: 'Selecione Agent, instância do site, destino gerenciado e configuração do artefato de certificado.',
        workflowTitle: 'Configuração de execução do workflow',
        workflowDescription: 'Selecione a versão do workflow, o local de execução e as variáveis; variáveis de certificado serão injetadas em tempo de execução.',
        confirmTitle: 'Confirmar salvamento',
        confirmDescription: 'Revise a entrada da aplicação, o modo de implantação e os parâmetros de execução antes de gravar o ativo.'
      }
    },
    form: {
      createTitle: 'Adicionar ativo de aplicação manualmente',
      editTitle: 'Editar ativo de aplicação',
      createDescription: 'Crie uma entrada de aplicação e vincule as informações de destino exigidas para implantações posteriores.',
      editDescription: 'Altere a entrada da aplicação e o binding do destino de implantação.',
      createRequestCompleted: 'Solicitação de criação concluída.',
      editRequestCompleted: 'Solicitação de salvamento concluída.',
      agentCertificateFormatHint: 'No modo Agent, esta configuração de artefato de certificado será usada para gerar materiais de implantação.',
      placeholders: {
        displayName: 'Exemplo: entrada do site de produção',
        verifyUrl: 'Exemplo: https://example.com/health',
        siteName: 'Exemplo: site de produção',
        bindingInformation: 'Exemplo: *:443:example.com',
        hostHeader: 'Exemplo: example.com',
        sniName: 'Exemplo: example.com'
      }
    },
    review: {
      accessEntry: 'Entrada de acesso',
      deploymentMode: 'Modo de implantação',
      agentSiteTarget: 'Agent / site / destino',
      workflowVersion: 'Versão do workflow',
      gatewayRunner: 'Gateway: {gateway}',
      variableCount: '{count} variável(is)',
      onlyBasicEntry: 'Somente entrada básica',
      autoGeneratedByEntry: 'Gerado a partir da entrada da aplicação'
    },
    workflowTarget: {
      title: 'Informações do destino do workflow',
      description: 'Usado para exibição do ativo de workflow, sondagem pós-implantação e sincronização de variáveis de destino DSL.',
      dslSyncHint: 'Sincronizado para variáveis de destino DSL',
      advancedTitle: 'Configurações avançadas',
      advancedDescription: 'Altere apenas para substituir o listener, o domínio da requisição ou o nome do certificado TLS padrão.',
      expandAdvanced: 'Expandir configurações avançadas',
      collapseAdvanced: 'Recolher configurações avançadas',
      bindingInformationLabel: 'Regra de escuta do serviço',
      bindingInformationHelp: 'Descreve a combinação de endereço, porta e domínio usada pelo serviço.',
      hostHeaderLabel: 'Domínio da requisição',
      hostHeaderHelp: 'Altere apenas quando o serviço exigir um cabeçalho HTTP Host específico.',
      sniNameLabel: 'Domínio do certificado TLS',
      sniNameHelp: 'Altere apenas quando o nome do handshake TLS for diferente do domínio de acesso.'
    },
    workflowVariables: {
      title: 'Variáveis do workflow',
      configuredCount: '{configured}/{total} configurada(s)',
      name: 'Nome da variável',
      type: 'Tipo',
      value: 'Valor',
      manual: 'Manual',
      empty: 'Nenhuma variável de workflow.',
      noPublishedVersion: 'Selecione uma versão publicada do workflow antes de configurar variáveis.',
      certificateAutoInjected: 'A versão do certificado é selecionada pelo plano de implantação e injetada automaticamente em tempo de execução.',
      certificateDescription: 'A versão do certificado é selecionada pelo plano de implantação; vincule abaixo a configuração de formato e as saídas, e {name}.outputs.*.content será injetado em tempo de execução.',
      presets: {
        deviceHost: 'Host de destino ou endereço do dispositivo',
        sshUsername: 'Nome de usuário SSH',
        credential: 'Credencial do workflow',
        certificate: 'Artefato de certificado',
        targetPlatform: 'Plataforma de destino',
        apacheServiceName: 'Nome do serviço systemd do Apache',
        apacheSiteConfigPath: 'Caminho da configuração do site Apache',
        certificateFilePath: 'Caminho de destino do certificado',
        certificateKeyFilePath: 'Caminho de destino da chave privada',
        backupRoot: 'Diretório raiz de backup do certificado',
        expectedResponseContains: 'Texto esperado na resposta de verificação',
        virtualHostServerName: 'ServerName do VirtualHost'
      }
    },
    certificateBindings: {
      title: 'Bindings de variáveis de certificado',
      description: 'Selecione a configuração de artefato de certificado e as saídas para variáveis de certificado no workflow.',
      variableCount: '{count} variável(is) de certificado',
      defaultVariableDescription: 'Variável de artefato de certificado',
      noArtifactOutputs: 'A configuração de formato atual não possui saídas selecionáveis.'
    },
    certificateOutputs: {
      publicCertificateWithChain: 'Certificado público + cadeia de certificados',
      publicCertificate: 'Certificado público',
      certificateChain: 'Cadeia de certificados',
      privateKey: 'Chave privada',
      pemBundle: 'Artefato bundle PEM',
      container: 'Contêiner {format}',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (configuração salva, não retornada pela lista atual)',
      withPrivateKey: 'Com chave privada',
      withoutPrivateKey: 'Sem chave privada'
    },
    snapshotTypes: {
      preDeploy: 'Antes da implantação',
      postDeploy: 'Após a implantação',
      postRollback: 'Após a reversão',
      errorState: 'Estado de erro',
      rollbackPoint: 'Ponto de reversão'
    },
    errors: {
      loadWorkflowListFailed: 'Falha ao carregar a lista de workflows',
      loadWorkflowVersionsFailed: 'Falha ao carregar versões do workflow',
      loadGatewayListFailed: 'Falha ao carregar a lista de gateways',
      loadCertificateFormatsFailed: 'Falha ao carregar configurações de formato de certificado',
      loadAssetDetailFailed: 'Falha ao carregar detalhes do ativo de aplicação',
      rollbackFailed: 'Falha ao iniciar reversão',
      loadTargetsFailed: 'Falha ao carregar sites e destinos gerenciados',
      createAssetFailed: 'Falha ao criar ativo de aplicação',
      pluginFormLoadFailed: 'Falha ao carregar o formulário de configuração do plugin',
      pluginBindingCreateFailed: 'Falha ao salvar a vinculação do plugin',
      loadWorkflowCredentialsFailed: 'Falha ao carregar credenciais do workflow',
      noAvailableSiteInstance: 'Nenhuma instância de site disponível. Confirme se a descoberta do dispositivo informou frameworks e sites.',
      managedTargetRediscoveryRequired: 'Este site não possui alvos gerenciados. Execute novamente a descoberta do dispositivo.',
      noCompatibleManagedPlugin: 'Nenhum plugin habilitado é compatível com este alvo gerenciado.',
      capabilityAssignmentMissing: 'Este alvo não possui uma atribuição efetiva de capacidade de implantação.'
    },
    platforms: {
      appliance: 'Dispositivo',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: 'Plataforma',
      gateway: 'Gateway'
    },
    status: {
      archived: 'Arquivado',
      unknownStatus: 'Status desconhecido'
    },
    common: {
      required: 'Obrigatório',
      optional: 'Opcional'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'Falha na solicitação'
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
        title: 'Gerenciamento de certificados e aplicações',
        subtitle: 'Gerencie certificados e veja quais aplicações os utilizam',
        sections: {
          certificates: {
            title: 'Gerenciamento de certificados',
            help: 'Consulte e gerencie todos os certificados, incluindo validade e status.'
          },
          applications: {
            title: 'Aplicações vinculadas',
            help: 'Veja onde os certificados são usados e com que frequência são atualizados.'
          }
        },
        stats: {
          total: 'Certificados',
          expiring: 'Expirando em breve',
          expired: 'Expirados'
        },
        versionCount: '{count} versões',
        versionCountShort: '{count}',
        sourceLabels: {
          manual: 'Manual',
          acme: 'ACME',
          unknown: 'Desconhecida'
        },
        fields: {
          expires: 'Expira em',
          source: 'Origem'
        },
        empty: {
          title: 'Ainda não há certificados',
          description: 'Importe o primeiro certificado para começar a gerenciá-lo.'
        },
        applications: {
          description: 'Veja quais aplicações usam o certificado selecionado e configure atualizações automáticas.',
          selectPrompt: 'Selecione primeiro um certificado à esquerda',
          selectedCertificate: 'Certificado selecionado',
          connectedApps: 'Aplicações vinculadas ({count})',
          noApps: 'Ainda não há aplicações vinculadas a este certificado.',
          addApp: 'Adicionar aplicação',
          automationTitle: 'Configuração de atualização automática',
          activeAutomations: 'Atualizações automáticas ativas',
          totalAutomations: 'Total de planos de atualização',
          automationDescription: 'Os planos de atualização verificam regularmente o status dos certificados e implantam atualizações nas aplicações vinculadas quando necessário.'
        }
      }
    },
    detail: {
      backList: 'Voltar à lista',
      description: 'Exibe detalhes da versão do certificado, artefatos de formato e ativos relacionados.',
      title: 'Detalhes do certificado'
    },
    detailPanel: {
      sources: {
        agentContext: 'Contexto do Agent',
        platformBinding: 'Registro de binding da plataforma'
      },
      usage: {
        columns: {
          domainName: 'Domínio / destino',
          agentName: 'Nome do Agent',
          siteName: 'Nome do site',
          bindingType: 'Tipo de binding',
          usageSource: 'Origem',
          status: 'Status'
        },
        empty: 'Nenhum ativo relacionado',
        toolbar: 'Ativos relacionados'
      },
      summary: {
        certificateName: 'Nome do certificado',
        logicalDomain: 'Domínio lógico',
        issuer: 'Emissor',
        subject: 'Titular',
        serialNumber: 'Número de série',
        chainStatus: 'Status da cadeia'
      },
      sections: {
        subjectInfo: 'Informações do titular',
        issuerInfo: 'Informações do emissor',
        certificateFields: 'Campos do certificado',
        extensionFields: 'Campos de extensão'
      },
      fields: {
        commonName: 'Nome comum (CN)',
        organization: 'Organização (O)',
        organizationalUnit: 'Unidade organizacional (OU)',
        countryRegion: 'País / região (C)',
        stateProvince: 'Estado / província (ST)',
        locality: 'Localidade (L)',
        version: 'Versão',
        signatureAlgorithm: 'Algoritmo de assinatura',
        publicKeyAlgorithm: 'Algoritmo da chave pública',
        fingerprintSha256: 'Fingerprint SHA-256',
        san: 'SAN',
        deployable: 'Implantável',
        leafStorageRef: 'Referência do certificado folha',
        chainCertificateCount: 'Quantidade de certificados da cadeia',
        trustRootCertificate: 'Certificado raiz de destino',
        trustRootStatus: 'Estado do certificado raiz',
        chainDiagnostics: 'Diagnóstico da cadeia'
      },
      fallbacks: {
        unknownCertificate: 'Certificado desconhecido',
        unknownIssuer: 'Emissor desconhecido',
        unnamedCertificate: 'Certificado sem nome',
        unknownDomain: 'Domínio desconhecido',
        unknownSubject: 'Titular desconhecido',
        unknown: 'Desconhecido',
        notPartOfCertificate: 'Não faz parte do certificado',
        none: 'Nenhum',
        emptyValue: '—',
        unknownType: 'Tipo desconhecido',
        unknownResource: 'Recurso desconhecido',
        unknownTarget: 'Destino desconhecido'
      },
      values: {
        yes: 'Sim',
        no: 'Não'
      },
      separators: {
        diagnostic: '; ',
        list: ', '
      },
      diagnostics: {
        rootResolvedFromLibrary: 'O material importado não inclui o certificado raiz: {root}. O repositório de raízes do projeto já o resolveu e pode completar a cadeia inteira durante a implantação.'
      },
      chain: {
        roles: {
          leaf: 'Certificado folha',
          root: 'Certificado raiz',
          intermediate: 'Certificado intermediário'
        },
        title: 'Cadeia de certificados',
        empty: 'Nenhuma informação de cadeia de certificados',
        subject: 'Titular: {value}',
        issuer: 'Emissor: {value}'
      },
      errors: {
        loadFailedTitle: 'Falha ao carregar detalhes do certificado',
        code: 'Código de erro: {code}'
      },
      actions: {
        retry: 'Tentar novamente'
      },
      states: {
        loading: 'Carregando...'
      },
      tabs: {
        ariaLabel: 'Abas de detalhes do certificado',
        detail: 'Detalhes',
        usage: 'Ativos relacionados'
      },
      validity: {
        title: 'Validade do certificado',
        notBefore: 'Válido a partir de: {value}',
        notAfter: 'Expira em: {value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'ID da versão',
        createdAt: 'Criado em',
        format: 'Formato',
        secretRef: 'Referência Secret',
        status: 'Status'
      },
      create: 'Criar configuração de formato',
      createFailed: 'Falha ao criar formato',
      description: 'Entrada de configuração de formatos PEM/DER/PFX/JKS/P7B do certificado {id}.',
      empty: 'Nenhuma configuração de formato',
      fields: {
        alias: 'Alias (opcional)',
        containsPrivateKey: 'Contém chave privada (PEM)',
        passwordSecretRef: 'passwordSecretRef (PFX/JKS)',
        targetFormat: 'Formato de destino',
        versionId: 'ID da versão'
      },
      hint: 'PFX/JKS deve usar um passwordSecretRef já existente no sistema; os materiais de implantação são gerados sob demanda com base na versão do certificado e na configuração de formato.',
      loadFailed: 'Falha ao carregar configurações de formato',
      optionAvailable: '{label} - disponível',
      placeholders: {
        alias: 'Exemplo: gcac-cert'
      },
      title: 'Configuração de formato de certificado',
      toolbar: 'Lista de configurações de formato',
      unsupported: '{format} não pode ser criado pela declaração de capacidade atual.'
    },
    import: {
      backList: 'Voltar à lista de certificados',
      description: 'Atualmente, apenas PEM + KEY e PFX são suportados; PFX só permite importação por arquivo. Os materiais importados devem incluir certificado do servidor, cadeia intermediária completa e chave privada. O certificado raiz não é obrigatório.',
      errors: {
        importFailed: 'Falha na importação',
        materialRequiredBeforeValidate: 'É necessário preencher os materiais de importação antes de iniciar a validação.',
        needPassedValidation: 'Conclua a validação da etapa 3 e confirme que ela foi aprovada antes de importar.',
        validateFailed: 'Falha na validação'
      },
      formats: {
        pem: {
          hint: 'É obrigatório fornecer certificado do servidor, cadeia intermediária completa e chave privada. O certificado raiz não é obrigatório; se faltar, apenas um alerta será exibido.'
        },
        pfx: {
          hint: 'Somente importação por arquivo é suportada. O contêiner deve conter certificado do servidor, cadeia intermediária completa e chave privada. O certificado raiz não é obrigatório; se faltar, apenas um alerta será exibido.'
        }
      },
      methods: {
        file: {
          hint: 'Indicado para cenários em que você já possui arquivos cert / key ou .pfx.',
          label: 'Selecionar arquivo'
        },
        text: {
          hint: 'Indicado para colar diretamente texto PEM e evitar upload de arquivos temporários.',
          label: 'Colar texto'
        }
      },
      title: 'Importar certificado'
    },
    importForm: {
      source: {
        title: 'Escolha como adicionar o certificado',
        description: 'Importe um certificado existente ou use a emissão automática ACME quando ela estiver disponível.',
        manual: {
          title: 'Importar um certificado existente',
          description: 'Envie um arquivo de certificado PEM, CRT ou PFX e sua chave privada.',
          recommended: 'Recomendado'
        },
        acme: {
          title: 'Solicitar um certificado via ACME',
          description: 'Solicite e renove certificados automaticamente com uma autoridade certificadora.',
          unavailable: 'Indisponível'
        },
        unavailable: {
          title: 'Nenhum canal de emissão ACME está configurado',
          description: 'Este console não possui um ponto de entrada ACME disponível. Importe um certificado existente ou tente novamente após configurar um canal de emissão automatizada.'
        }
      },
      hints: {
        pemChainCheck: 'Envie ou cole o certificado do servidor, a cadeia intermediária completa e a chave privada; o sistema validará a cadeia de certificados e a correspondência da chave privada.',
        pfxChainCheck: 'Envie um arquivo PFX/P12 e informe a senha; o sistema analisará o certificado do servidor, a cadeia de certificados e a chave privada dentro do contêiner.',
        pfxFileOnly: 'PFX só suporta importação por arquivo.'
      },
      roles: {
        leaf: 'Certificado folha',
        root: 'Certificado raiz',
        intermediate: 'Certificado intermediário'
      },
      steps: {
        ariaLabel: 'Etapas de importação do certificado',
        source: 'Método de adição',
        formatAndMethod: 'Formato e método',
        materials: 'Materiais de importação',
        validateAndImport: 'Validar e importar'
      },
      formatIntro: {
        title: 'Escolha o formato e o método de importação',
        description: 'Confirme primeiro o formato dos materiais e depois escolha entre enviar arquivos ou colar texto. Atualmente, PFX só suporta importação por arquivo.'
      },
      labels: {
        importType: 'Tipo de importação',
        importMethod: 'Método de importação',
        materialStatus: 'Status dos materiais'
      },
      status: {
        supported: 'Suportado',
        unsupported: 'Não suportado',
        completed: 'Concluído',
        incomplete: 'Incompleto',
        matched: 'Compatível',
        unmatched: 'Não compatível'
      },
      fields: {
        certificateChainFile: 'Arquivo da cadeia de certificados',
        certificatePemText: 'Texto PEM do certificado',
        privateKey: 'Chave privada ({kind})',
        file: 'Arquivo',
        pemText: 'Texto PEM',
        pfxFile: 'Arquivo PFX/P12',
        certificateName: 'Nome do certificado',
        pfxPassword: 'Senha do PFX'
      },
      placeholders: {
        certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
        certificateName: 'Exemplo: certificado de produção example.com',
        required: 'Obrigatório'
      },
      validation: {
        title: 'Validar materiais de importação',
        description: 'Antes de importar, valide a cadeia de certificados, o período de validade, a correspondência da chave privada e a completude dos materiais.',
        passed: 'Validação aprovada; pronto para importar',
        failed: 'Validação reprovada'
      },
      report: {
        certificateSummary: 'Resumo do certificado',
        serialNumber: 'Número de série',
        validity: 'Validade',
        validityRange: '{start} até {end}',
        issuer: 'Emissor',
        issuerWithValue: 'Emissor: {value}',
        subject: 'Titular',
        chainValidation: 'Validação da cadeia de certificados',
        chainStatus: 'Status da cadeia',
        certificateCount: 'Quantidade de certificados',
        privateKeyMatch: 'Correspondência da chave privada',
        provided: 'Fornecido',
        matchResult: 'Resultado da correspondência',
        privateKeySource: 'Origem da chave privada',
        blockers: 'Bloqueios',
        warnings: 'Alertas'
      },
      selectedFile: 'Selecionado: {name}',
      importSuccess: 'Importação concluída. ID da versão do certificado: {id}',
      actions: {
        validating: 'Validando...',
        validate: 'Iniciar validação',
        cancel: 'Cancelar',
        previous: 'Anterior',
        next: 'Próximo',
        importing: 'Importando...',
        import: 'Importar certificado'
      }
    },
    list: {
      filters: {
        keyword: 'Palavra-chave',
        domain: 'Domínio',
        status: 'Status'
      },
      placeholders: {
        assetKeyword: 'Domínio / SAN / fingerprint',
        primaryDomain: 'example.com',
        versionKeyword: 'Nome / emissor / titular / ID da versão'
      },
      columns: {
        notBefore: 'Data inicial',
        notAfter: 'Data final',
        associatedAsset: 'Ativo relacionado',
        sourceType: 'Adicionado por',
        status: 'Status',
        certificateVersionId: 'ID da versão do certificado'
      },
      sourceTypes: {
        manual: 'Importação manual',
        internal_ca: 'CA interno',
        enterprise_ca: 'CA empresarial',
        external_api: 'API externa',
        unknown: 'Desconhecido'
      },
      lifecycle: {
        unknown: 'Desconhecido',
        expired: 'Expirado',
        expiringSoon: 'Expira em breve',
        valid: 'Válido'
      },
      fallbacks: {
        unselectedDomain: 'Nenhum domínio selecionado',
        unnamedDomain: 'Domínio sem nome',
        noSupplement: 'Nenhuma informação complementar'
      },
      assets: {
        title: 'Lista de domínios',
        loadFailed: 'Falha ao carregar a lista de domínios',
        empty: 'Nenhuma lista de domínios',
        unselectedTitle: 'Nenhum domínio selecionado',
        unselectedDescription: 'Selecione primeiro um domínio lógico de certificado à esquerda.'
      },
      versions: {
        title: 'Lista de certificados SSL',
        titleWithDomain: 'Lista de certificados SSL de {domain}',
        description: 'À direita são exibidos os certificados SSL do domínio atual, incluindo nome do certificado, data inicial, data final, emissor e titular.',
        loadFailed: 'Falha ao carregar a lista de certificados SSL',
        emptyForDomain: 'Nenhum certificado SSL neste domínio',
        emptyForDomainDescription: 'Use o botão de importação de certificado à direita da barra de filtros para adicionar versões de certificado a este domínio.',
        empty: 'Nenhum certificado SSL',
        toolbar: 'Lista de versões de certificado',
        currentCount: 'Atualmente {count} registro(s)'
      },
      actions: {
        toggleFilters: 'Filtrar',
        clear: 'Limpar',
        deleteRisk: 'Excluir removerá diretamente a versão atual do certificado; se ela ainda estiver referenciada por um binding ou implantação, o sistema recusará a operação.'
      },
      errors: {
        deleteFailed: 'Falha ao excluir',
        materialRequiredForFormat: 'É necessário fornecer o material de certificado correspondente ao formato atual.',
        importFailedWithCheck: 'Falha na importação. Verifique os materiais informados.',
        validateFailedWithCheck: 'Falha na validação. Verifique os materiais informados.'
      },
      import: {
        description: 'Atualmente, apenas PEM + KEY e PFX são suportados; cada importação deve incluir certificado do servidor, cadeia intermediária completa e chave privada. O certificado raiz não é obrigatório e, se faltar, será exibido um alerta. A chave privada é armazenada somente no Secret do sistema e nunca retorna nas respostas da API.'
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
      backDetail: 'Voltar aos detalhes',
      columns: {
        domainName: 'Domínio / destino',
        resourceId: 'ID do recurso',
        resourceType: 'Tipo de recurso',
        status: 'Status',
        updatedAt: 'Atualizado em'
      },
      description: 'Bindings, destinos de implantação e referências de recurso do certificado {id}.',
      empty: 'Nenhuma relação de uso',
      loadFailed: 'Falha ao carregar relações de uso',
      title: 'Relações de uso do certificado',
      toolbar: 'Relações de uso'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: 'Nome de usuário + senha',
        usernamePasswordWithUsername: 'Nome de usuário + senha / {username}',
        sshKey: 'Chave privada SSH',
        sshKeyWithUsername: 'Chave privada SSH / {username}',
        apiKey: 'API Key / {name} / {location}',
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: 'Chama uma API HTTP estruturada em vez de comandos curl dispersos.'
        },
        ssh: {
          displayName: 'Comando SSH',
          description: 'Declara o comando SSH a executar, mantendo apenas referências de conexão e credenciais.'
        },
        sftp: {
          displayName: 'Upload/download SFTP',
          description: 'Faz upload ou download de arquivos por uma etapa SFTP formal, adequada para instalar certificados e configurações.'
        },
        scp: {
          displayName: 'Upload/download SCP',
          description: 'Copia arquivos por SCP, adequado para distribuição simples de arquivos em hosts.'
        },
        verify: {
          displayName: 'Verificação',
          description: 'Valida status HTTP, texto, regex ou fingerprint do certificado.'
        },
        condition: {
          displayName: 'Condição',
          description: 'Escolhe o próximo caminho com base na existência ou no valor da variável.'
        },
        transform: {
          displayName: 'Transformação',
          description: 'Usa JSONata para converter a saída anterior em novas variáveis de contexto do workflow.'
        },
        foreach: {
          displayName: 'Percorrer coleção',
          description: 'Percorre uma coleção dinâmica em ordem e executa as mesmas etapas filhas para cada item.'
        },
        checkpoint: {
          displayName: 'Checkpoint de recuperação',
          description: 'Salva um resumo verificável do estado remoto antes de gravar no dispositivo.'
        },
        wait: {
          displayName: 'Espera',
          description: 'Aguarda um número fixo de segundos antes de continuar.'
        },
        manual: {
          displayName: 'Confirmação manual',
          description: 'Pausa o fluxo de trabalho até a confirmação manual.'
        }
      },
      fields: {
        command: 'Comando',
        connectionRef: 'Variável de conexão',
        contentRef: 'Variável de conteúdo',
        credential: 'Credencial',
        description: 'Descrição',
        direction: 'Direção',
        expected: 'Valor esperado',
        expectedHostKeyFingerprint: 'Fingerprint da Host Key',
        hostKeyPolicy: 'Política de Host Key',
        hostRef: 'Variável de host',
        inputRef: 'Variável de entrada',
        instruction: 'Instrução de aprovação',
        localPath: 'Caminho local',
        mode: 'Permissão do arquivo',
        operator: 'Operador',
        remotePath: 'Caminho remoto',
        seconds: 'Segundos de espera',
        temporaryPath: 'Caminho temporário',
        timeoutMs: 'Timeout ms',
        timeoutSeconds: 'Segundos de timeout',
        transformInput: 'Entrada da transformação',
        itemsPath: 'Caminho da coleção',
        itemVariable: 'Variável do item',
        indexVariable: 'Variável do índice',
        maxItems: 'Máximo de itens',
        foreachSteps: 'JSON das etapas filhas',
        checkpointName: 'Nome do checkpoint',
        checkpointCapture: 'JSON dos caminhos capturados',
        requiredForRollback: 'Obrigatório para rollback',
        outputFormat: 'Formato de saída',
        usernameVariable: 'Variável de nome de usuário',
        variable: 'Variável',
        verifyType: 'Tipo de verificação'
      },
      options: {
        boolean: { yes: 'Sim', no: 'Não' },
        direction: {
          download: 'Baixar',
          upload: 'Enviar'
        },
        hostKeyPolicy: {
          manualApproval: 'Aprovação manual',
          strict: 'Verificação estrita',
          trustOnFirstUse: 'Confiar no primeiro uso'
        },
        operator: {
          equals: 'Igual a',
          exists: 'Existe',
          notEquals: 'Diferente de',
          notExists: 'Não existe'
        },
        transformFormat: {
          raw: 'Valor bruto',
          jsonString: 'String JSON'
        },
        verifyType: {
          certificateFingerprint: 'Fingerprint do certificado',
          httpStatus: 'HTTP status',
          regex: 'Correspondência regex',
          textContains: 'Texto contem'
        }
      },
      stages: {
        backup: {
          title: 'Cópia de segurança',
          description: 'Mantém materiais para rollback.'
        },
        install: {
          title: 'Instalação',
          description: 'Implanta certificados ou configurações.'
        },
        prepare: {
          title: 'Preparação',
          description: 'Prepara conexões, variáveis e materiais.'
        },
        refresh: {
          title: 'Atualização',
          description: 'Recarrega serviços ou atualiza alvos.'
        },
        verify: {
          title: 'Verificação',
          description: 'Confirma que o resultado atende ao esperado.'
        }
      },
      defaults: {
        displayName: 'Fluxo de trabalho {name}',
        nodes: {
          backupExistingCertificate: 'Fazer backup do certificado existente',
          reloadService: 'Recarregar servico'
        },
        variables: {
          certificatePaths: {
            description: 'Configuração de caminhos do certificado de destino'
          },
          credential: {
            description: 'Credencial de conexão'
          },
          deviceHost: {
            description: 'Host de destino'
          },
          serverCert: {
            description: 'Material do certificado do servidor a implantar',
            outputs: {
              certFile: {
                description: 'Arquivo do certificado do servidor'
              },
              keyFile: {
                description: 'Arquivo da chave privada'
              }
            }
          },
          sshUsername: {
            description: 'Nome de usuário para login SSH'
          },
          verifyUrl: {
            description: 'URL de verificação pós-implantação'
          }
        },
        config: {
          conditionDescription: 'Verifica se a variável do host de destino existe',
          manualInstruction: 'Confirme se o certificado do dispositivo de destino foi alternado para a nova versão.'
        }
      },
      variableFlow: {
        system: 'Sistema',
        variable: 'Variável'
      },
      errors: {
        unknownNodeType: 'Tipo de nó desconhecido: {type}'
      }
    },
    canvasEditor: {
      summary: '{nodes} nós, {edges} conexões, {variables} variáveis',
      stageNodeCount: '{count} nós',
      copyLabel: 'Cópia de {label}',
      actions: {
        addVariable: 'Adicionar variável',
        collapseBottomPanelAria: 'Recolher painel de controle inferior',
        collapseDown: 'Recolher para baixo',
        copy: 'Copiar',
        copyNode: 'Copiar nó',
        delete: 'Excluir',
        deleteNode: 'Excluir nó',
        expandBottomPanelAria: 'Expandir painel de controle inferior',
        expandPanel: 'Expandir painel',
        layout: 'Organizar layout',
        mockCurrentNode: 'Simular apenas o nó atual',
        mockRunning: 'Simulando...',
        paste: 'Colar',
        pasteNode: 'Colar nó',
        realRun: 'Executar teste real do nó atual',
        realRunHttp: 'Executar teste real do nó HTTP atual',
        realRunRunning: 'Executando...',
        realRunSsh: 'Executar o nó SSH atual',
        realRunTransfer: 'Executar teste real de transferência de arquivo',
        redo: 'Refazer',
        saveDraft: 'Salvar rascunho',
        saving: 'Salvando...',
        undo: 'Desfazer',
        zoomIn: 'Aumentar zoom',
        zoomOut: 'Diminuir zoom'
      },
      aria: {
        bottomPanel: 'Painel inferior',
        canvasArea: 'Área do canvas',
        dslPanel: 'Painel DSL',
        nodePalette: 'Paleta de nós',
        propertiesPanel: 'Painel de propriedades',
        runtimePanel: 'Painel de runtime',
        toolbar: 'Barra de ferramentas do canvas do fluxo de trabalho',
        validationPanel: 'Painel de validação',
        variablesPanel: 'Painel de variáveis'
      },
      credentialHints: {
        savedApiKey: 'API Key salva',
        savedBearerToken: 'Bearer Token salvo',
        savedSshSftp: 'Credenciais SSH / SFTP salvas',
        savedUsernamePassword: 'Nome de usuário + senha salvos'
      },
      credentials: {
        emptyCreateHint: 'Não há credenciais disponíveis. Crie uma em Gerenciamento de credenciais na página de lista.',
        loading: 'Carregando lista de credenciais...'
      },
      dsl: {
        title: 'Importação e substituição de DSL',
        hint: 'Cole um DSL JSON externo ou selecione um arquivo DSL local. A importação substitui apenas o canvas atual no navegador; uma nova versão do fluxo de trabalho só será criada após salvar o rascunho.',
        selectFile: 'Selecionar arquivo DSL',
        actions: {
          importOverwrite: 'Importar DSL e substituir canvas',
          resetToCanvas: 'Preencher novamente com o DSL do canvas atual'
        },
        messages: {
          fileLoaded: 'Arquivo carregado: {fileName}',
          imported: 'DSL importado e canvas atual substituído, total de {count} nós.',
          resetToCompiled: 'DSL compilado pelo backend preenchido novamente.'
        },
        errors: {
          importFailed: 'Falha ao importar DSL',
          invalidTopLevel: 'Estrutura de nível superior do DSL inválida. Deve ser um objeto.'
        }
      },
      empty: {
        selectNodeToEdit: 'Selecione um nó para editar as propriedades.'
      },
      errors: {
        backendValidationFailed: 'Falha na validação do backend',
        credentialsLoadFailed: 'Falha ao carregar credenciais do fluxo de trabalho',
        missingStepName: 'Nome da etapa ausente',
        missingWorkflowDsl: 'Não foi possível obter o DSL do fluxo de trabalho'
      },
      fields: {
        authType: 'Tipo de autenticação',
        clientCertificate: 'Certificado do cliente',
        clientPrivateKey: 'Chave privada do cliente',
        command: 'Comando',
        connectionVariable: 'Variável de conexão',
        contentRef: 'Referência de conteúdo',
        cookieName: 'Nome do Cookie',
        credential: 'Credencial',
        credentialSelector: 'Seletor de credencial',
        defaultValue: 'Valor padrão',
        deliveryLocation: 'Local de envio',
        description: 'Descrição',
        direction: 'Direção',
        fileMode: 'Permissão do arquivo',
        headerName: 'Nome do Header',
        hostRefOrHostname: 'Variável de host / hostname',
        hostVariable: 'Variável de host',
        keyName: 'Nome da Key',
        localPath: 'Caminho local',
        newNodeStage: 'Estágio do novo nó',
        nodeName: 'Nome do nó',
        remotePath: 'Caminho remoto',
        required: 'Obrigatório',
        secretValue: 'Valor sigiloso',
        sensitive: 'Sensível',
        stage: 'Estágio',
        temporaryPath: 'Caminho temporário',
        timeoutSeconds: 'Segundos de timeout',
        type: 'Tipo',
        username: 'Nome de usuário',
        variableName: 'Nome da variável'
      },
      options: {
        download: 'Baixar',
        manualInput: 'Preenchimento manual',
        notSelected: 'Não selecionado',
        upload: 'Enviar'
      },
      runtime: {
        noCredentialVariables: 'Este fluxo de trabalho não tem variáveis de credencial.',
        noExtraVariables: 'O nó atual não tem variáveis extras de runtime.'
      },
      sections: {
        httpAuth: 'Autenticação HTTP',
        nodePalette: 'Paleta de nós',
        properties: 'Propriedades',
        referenceFlow: 'Fluxo de referências',
        runtimeCredentialVariables: 'Variáveis de credencial em runtime',
        runtimeVariables: 'Variáveis de runtime',
        singleNodeTest: 'Teste de nó único',
        variableConfig: 'Configuração de variáveis'
      },
      tabs: {
        runtime: 'Runtime',
        validation: 'Validação',
        variables: 'Variáveis'
      },
      test: {
        cause: 'Causa',
        code: 'Código',
        emptyHint: 'Selecione um nó para executar uma simulação ou um teste real.',
        error: 'Erro',
        executionPlan: 'Plano de execução',
        exitCode: 'Código de saída',
        failureDetails: 'Detalhes da falha',
        hint: 'Dica de teste',
        logs: 'Logs',
        nodeOutput: 'Saída do nó',
        running: 'Em execução',
        stage: 'Estágio',
        stderr: 'Erro padrão',
        stdout: 'Saída padrão',
        suggestion: 'Sugestão',
        target: 'Destino',
        errors: {
          mockRunFailed: 'Falha na simulação',
          realRunFailed: 'Falha no teste real'
        },
        messages: {
          mockCompleted: 'Simulação concluída.',
          mockFailed: 'Falha na simulação.',
          realCompleted: 'Teste real concluído.',
          realFailed: 'Falha no teste real.'
        }
      },
      validation: {
        levels: {
          error: 'Erro',
          risk: 'Risco',
          warning: 'Aviso'
        },
        location: {
          canvas: 'Canvas',
          edge: 'Conexão',
          fieldSuffix: 'campo',
          node: 'Nó'
        },
        noBlockingErrors: 'Nenhum erro bloqueante.'
      },
      variables: {
        customRuntimeDescription: 'Variável de runtime personalizada',
        notUsed: 'Não utilizada',
        usedBy: 'Usada por: {nodes}'
      }
    },
    templates: {
      title: 'Fluxos de trabalho',
      resourceName: 'Fluxo de trabalho',
      description: 'Gerencie versões de fluxos CURL/SSH/SFTP, status de publicação e histórico de alterações a partir dos rascunhos do canvas.',
      pluginSources: {
        createTitle: 'Criar a partir do plugin', applyTitle: 'Criar rascunho do plugin', description: 'Lista apenas fluxos de certificados de plugins habilitados. Primeiro escolha o fluxo e depois a versão do plugin.',
        createAction: 'Criar fluxo', applyAction: 'Criar rascunho', currentTarget: 'Fluxo atual: {name}', namePlaceholder: 'Nome do fluxo', loading: 'Carregando fontes de plugin...', empty: 'Nenhuma fonte de plugin disponível.', version: 'Versão do plugin', workflowVersion: 'Versão do fluxo de trabalho', versionSource: 'Origem da versão: {plugin} / {version} / {capability}',
        capabilities: { deploy: 'Implantação de certificado', rollback: 'Reversão de certificado' }, errors: { loadFailed: 'Falha ao carregar fontes de plugin', nameRequired: 'Informe um nome de fluxo', missingApplyTarget: 'O fluxo de destino está ausente', actionFailed: 'Falha ao copiar o fluxo do plugin' }
      },
      origins: { user: 'Personalizado', plugin_internal: 'Integrado ao plugin' },
      actions: {
        addVersion: 'Adicionar versão',
        applyTemplate: 'Aplicar modelo',
        cancel: 'Cancelar',
        close: 'Fechar',
        createBlank: 'Criar em branco',
        credentialManagement: 'Gerenciamento de credenciais',
        delete: 'Excluir',
        detail: 'Detalhes',
        edit: 'Editar',
        publishVersion: 'Publicar versão',
        rename: 'Renomear',
        saveName: 'Salvar nome',
        saveNote: 'Salvar observação',
        switchVersion: 'Alternar versão',
        templateManagement: 'Gerenciamento de modelos',
        versionManagement: 'Gerenciamento de versões'
      },
      states: {
        creating: 'Criando...',
        loading: 'Carregando...',
        processing: 'Processando...',
        saving: 'Salvando...'
      },
      fields: {
        actions: 'Ações',
        createdAt: 'Criado em',
        currentStatus: 'Status atual',
        currentVersion: 'Versão atual',
        currentVersionId: 'ID da versão atual',
        id: 'ID do fluxo de trabalho',
        name: 'Nome do fluxo de trabalho',
        origin: 'Origem',
        note: 'Observação',
        status: 'Status',
        updatedAt: 'Atualizado em'
      },
      filters: {
        showNonDeployment: 'Mostrar workflows que não são de implantação'
      },
      empty: {
        description: 'Crie primeiro um rascunho no canvas e depois publique versões para o fluxo oficial.',
        noChangeSummary: 'Sem resumo de alterações.',
        noChangeSummaryShort: 'Sem resumo de alterações',
        noVersions: 'Nenhuma versão.',
        title: 'Nenhum fluxo de trabalho'
      },
      tabs: {
        summary: 'Visão geral',
        versions: 'Versões'
      },
      versionStatuses: {
        disabled: 'Desativado',
        draft: 'Rascunho',
        published: 'Publicado'
      },
      detail: {
        description: 'Veja detalhes do fluxo de trabalho, rascunho do canvas e lista de versoes.',
        publishedVersion: 'Versão publicada atual {version}',
        title: 'Detalhes do fluxo de trabalho',
        titleWithName: 'Fluxo de trabalho {name}'
      },
      rename: {
        title: 'Nome do fluxo de trabalho',
        description: 'Altera o nome exibido nas listas e nos detalhes sem reescrever versões históricas.',
        placeholder: 'Digite o nome do fluxo de trabalho',
        messages: { success: 'Nome do fluxo de trabalho atualizado.' },
        errors: { required: 'O nome do fluxo de trabalho é obrigatório.', failed: 'Falha ao alterar o nome do fluxo de trabalho.' }
      },
      versionManager: {
        description: 'Gerencie aqui a criação e publicação de versões do fluxo de trabalho, sem alterar o conteúdo do canvas.',
        titleWithName: 'Gerenciamento de versões: {name}'
      },
      changeSummaries: {
        createFromPlugin: 'Criar fluxo a partir da capacidade do plugin',
        applyFromPlugin: 'Criar rascunho a partir da capacidade do plugin',
        applyFromFileTemplate: 'Substituir rascunho do fluxo a partir de modelo de arquivo',
        createCanvasDraft: 'Criar rascunho de fluxo de trabalho pelo canvas do frontend',
        createFromFileTemplate: 'Criar rascunho de fluxo de trabalho a partir de modelo de arquivo',
        createVersionDraft: 'Criar nova versão rascunho pelo gerenciamento de versões',
        saveCanvasDraft: 'Salvar versão rascunho pelo editor de canvas'
      },
      messages: {
        canvasDraftUpdated: 'Versão rascunho atual atualizada.',
        switchedVersion: 'Alternado para {version}.',
        versionDraftCreated: 'Nova versão rascunho criada.',
        versionNoteUpdated: 'Observação da versão atualizada.'
      },
      errors: {
        createVersionFailed: 'Falha ao criar versão do fluxo de trabalho',
        loadVersionsFailed: 'Falha ao carregar versões do fluxo de trabalho',
        missingWorkflowDsl: 'Não foi possível obter o DSL do fluxo de trabalho',
        publishVersionFailed: 'Falha ao publicar versão do fluxo de trabalho',
        saveCanvasDraftFailed: 'Falha ao salvar rascunho do canvas',
        updateVersionNoteFailed: 'Falha ao atualizar observação da versão'
      },
      delete: {
        riskText: 'A exclusão desativa este fluxo de trabalho e todas as suas versões, removendo-os da lista; os registros históricos de execução não serão regravados.'
      },
      loading: {
        versions: 'Carregando versões...'
      },
      fileTemplates: {
        applyAction: 'Aplicar modelo ao fluxo de trabalho atual',
        applyTitle: 'Aplicar modelo de arquivo ao fluxo de trabalho',
        createAction: 'Criar fluxo de trabalho a partir do modelo',
        createTitle: 'Novo fluxo de trabalho a partir de modelo de arquivo',
        currentTarget: 'Destino atual: {name}',
        description: 'Os arquivos de modelo vêm da biblioteca interna de modelos ou do diretório de importação do usuário. Ao substituir um fluxo existente, uma nova versão rascunho será criada sem regravar versões históricas.',
        empty: 'Nenhum arquivo de modelo de fluxo de trabalho reconhecível.',
        identifier: 'Identificador {name}',
        invalid: 'Inválido',
        invalidFile: 'Arquivo inválido',
        loading: 'Escaneando modelos de arquivo...',
        valid: 'Disponível',
        sources: {
          builtin: 'Interno',
          userImported: 'Importado pelo usuário'
        },
        errors: {
          actionFailed: 'Falha ao executar ação de modelo de arquivo',
          loadFailed: 'Falha ao carregar modelos de arquivo de fluxo de trabalho',
          missingApplyTarget: 'Destino de fluxo de trabalho ausente para aplicação'
        }
      },
      credentials: {
        actions: {
          create: 'Criar credencial'
        },
        addTitle: 'Adicionar credencial',
        count: '{count} itens',
        description: 'Gerencie em um único lugar as credenciais de login e API necessárias para fluxos de trabalho, com suporte a seleção e reuso direto no canvas e nos nós.',
        empty: 'Nenhum registro de credencial. Depois de criadas, elas podem ser selecionadas diretamente em variáveis, nós SSH e nós HTTP.',
        loading: 'Carregando informações de credenciais...',
        registeredTitle: 'Credenciais registradas',
        title: 'Gerenciamento de credenciais',
        fields: {
          deliveryLocation: 'Local de envio',
          headerOrParam: 'Nome do Header / parâmetro',
          name: 'Nome da credencial',
          referenceLocation: 'Local de referencia',
          storageType: 'Tipo de armazenamento',
          type: 'Tipo de credencial',
          username: 'Nome de usuário'
        },
        kinds: {
          common: {
            family: 'Geral'
          },
          sshKey: {
            title: 'Chave privada SSH'
          },
          usernamePassword: {
            title: 'Nome de usuário + senha'
          }
        },
        secretLabels: {
          password: 'Senha',
          sshKey: 'Chave privada SSH'
        },
        placeholders: {
          apiKey: 'Informe a API Key',
          bearer: 'Informe o Bearer Token',
          password: 'Informe a senha de login',
          sshKey: 'Cole a chave privada em formato PEM'
        },
        messages: {
          created: 'Credencial criada. Ela já pode ser selecionada em variáveis do fluxo de trabalho, nós SSH e nós HTTP.'
        },
        errors: {
          createFailed: 'Falha ao criar credencial',
          loadFailed: 'Falha ao carregar credenciais',
          missingCreatedId: 'A criação da credencial não retornou um ID válido'
        }
      }
    }
  },
  monitoring: {
    tls: monitoringTlsPtBR,
    actions: {
      add: 'Adicionar monitoramento',
      probe: 'Verificar sites',
      probing: 'Verificando...',
      refresh: 'Atualizar dados',
      refreshing: 'Atualizando...',
      remove: 'Remover'
    },
    errors: {
      addFailed: 'Falha ao adicionar alvo de monitoramento',
      deleteFailed: 'Falha ao excluir alvo de monitoramento',
      invalidTarget: 'Dados inválidos do alvo de monitoramento',
      loadFailed: 'Falha ao carregar dados de monitoramento',
      probeFailed: 'Falha na requisição de verificação',
      updateIntervalFailed: 'Falha ao atualizar frequência de verificação'
    },
    empty: {
      actualCertificate: 'Ainda não há certificado TLS observado. Alvos HTTPS coletam informações de certificado automaticamente durante a verificação do site.',
      description: 'Clique em adicionar monitoramento no canto superior direito. O sistema verificará o site conforme a frequência definida e coletará informações de certificado.',
      noAddableAssets: 'Não há ativos de aplicação que possam ser adicionados. Para alvos existentes, ajuste a frequência de verificação nos detalhes.',
      observedCertificateHistory: 'Ainda não há versões de certificado vinculadas. O primeiro certificado coletado pela verificação do site será preservado automaticamente.',
      probeHistory: 'Nenhum histórico de verificação.',
      riskEvents: 'Nenhum evento relacionado.',
      title: 'Nenhum alvo de monitoramento'
    },
    sections: {
      actualCertificate: 'Certificado observado atualmente no site',
      actualCertificateHint: 'Coletado automaticamente durante a verificação do site',
      observedCertificateHistory: 'Versões de certificado vinculadas',
      observedCertificateHistoryHint: 'Mantém registros de versão conforme mudanças no certificado TLS observado',
      probeHistory: 'Histórico de verificação',
      probeHistoryHint: 'Últimos 20 resultados de verificação do sistema',
      riskEvents: 'Eventos de risco',
      riskEventsHint: 'Cadeia de certificados, domínio, fingerprint e status de execução',
      targets: 'Alvos de monitoramento'
    },
    labels: {
      applicationAsset: 'Ativo de aplicação',
      currentTarget: 'Alvo atual',
      probeInterval: 'Frequência de verificação',
      secondsUnit: 'segundos'
    },
    metrics: {
      availability: 'Disponibilidade',
      certificateStatus: 'Status do certificado',
      latency: 'Latência',
      observedCertificateChanges: 'Mudanças no certificado observado'
    },
    probe: {
      completed: 'Verificação concluída',
      emptyHistoryBlock: 'Verificação {index}: ainda sem verificação',
      latencyNotCollected: 'Latência não coletada',
      recentAria: 'Últimos 10 resultados de verificação',
      waiting: 'Aguardando verificação do site'
    },
    status: {
      error: 'Erro',
      none: 'Pendente',
      ready: 'Normal',
      warning: 'Aviso'
    },
    warnings: {
      certificateNotApplied: 'A versão mais recente do certificado de domínio ainda não foi aplicada segundo a sondagem do sistema',
      chainVerificationFailed: 'A sondagem do sistema detectou falha na verificação da cadeia do certificado'
    },
    fallback: {
      noEndpoint: 'Nenhum endpoint configurado',
      noFingerprint: 'Sem fingerprint',
      notClosed: 'Não encerrado',
      noSummary: 'Sem resumo',
      notCollected: 'Não coletado',
      notSelected: 'Não selecionado',
      unknownAsset: 'Ativo desconhecido',
      unknownCertificate: 'Certificado desconhecido',
      unknownIssuer: 'Emissor desconhecido',
      unnamedEvent: 'Evento sem nome'
    },
    certificate: {
      actualCertificate: 'Certificado observado',
      chainUntrusted: 'Não aprovado pela cadeia de confiança do sistema',
      chainVerification: 'Verificação da cadeia',
      chainVerified: 'Cadeia verificada',
      chainVerifyFailedWithReason: 'Falha na verificação da cadeia: {reason}',
      collectedAt: 'Coletado em',
      issuer: 'Emissor',
      serialNumber: 'Número de série',
      sha256Fingerprint: 'Fingerprint SHA-256',
      subject: 'Assunto',
      validity: 'Validade',
      validityRange: '{start} até {end}'
    },
    columns: {
      certificateName: 'Nome do certificado',
      changedAt: 'Alterado em',
      closedAt: 'Encerramento do alerta',
      currentStatus: 'Status atual',
      expiresAt: 'Expira em',
      issuerName: 'Nome do emissor',
      latency: 'Latência',
      occurredAt: 'Ocorrido em',
      result: 'Resultado',
      source: 'Origem',
      status: 'Status',
      time: 'Hora',
      warningContent: 'Conteúdo do alerta'
    },
    dialog: {
      defaultMetricsHint: 'Disponibilidade, latência, informações do certificado e histórico de certificados são monitorados por padrão.',
      description: 'Selecione um alvo na lista de ativos de aplicação. O sistema coletará disponibilidade, latência, informações do certificado e histórico de certificados.',
      loadingAssets: 'Carregando ativos...',
      selectAsset: 'Selecione o ativo de aplicação',
      title: 'Adicionar monitoramento'
    },
    source: {
      controlPlane: 'Plataforma'
    },
    targets: {
      assetCount: '{count} ativos'
    }
  },
  login: {
    visualLabel: 'Descrição do produto',
    brand: 'Console de Certificados GCAC',
    brandSecondary: 'Plataforma centralizada de gerenciamento de certificados',
    headlinePrefix: 'Torne o gerenciamento de certificados',
    headlineHighlight: 'mais inteligente',
    headlineSuffix: ' e mais seguro',
    intro: 'Gerencie ativos de certificados em um só lugar, orquestre implantações automatizadas e acompanhe auditoria ponta a ponta, transformando a operação manual de certificados em um processo padronizado, verificável e rastreável para proteger a infraestrutura digital da empresa.',
    capabilitiesLabel: 'Capacidades da plataforma',
    featureLifecycle: 'Gerenciamento de ciclo de vida completo',
    featureLifecycleDesc: 'Da importação, renovação e rastreamento de versões aos alertas de expiração, cobre cada etapa dos ativos de certificados.',
    featureAutomation: 'Orquestração automatizada de implantação',
    featureAutomationDesc: 'Para ambientes comuns como Nginx, Tomcat e IIS, gera planos de implantação auditáveis com um clique.',
    featureRollback: 'Execução segura e rollback',
    featureRollbackDesc: 'Valida automaticamente antes da implantação, registra toda a execução e faz rollback em caso de falha, mantendo o ambiente de produção estável.',
    formLabel: 'Formulário de login',
    secure: 'Conexão segura',
    welcome: 'Entrar no console',
    hint: 'Use a conta corporativa para acessar o workspace de gerenciamento do GCAC',
    username: 'Nome de usuário',
    usernamePlaceholder: 'Digite o nome de usuário',
    password: 'Senha',
    passwordPlaceholder: 'Digite a senha',
    failed: 'Falha no login. Tente novamente mais tarde',
    submitting: 'Verificando identidade...',
    submit: 'Entrar',
    policy: 'Proteção por permissões RBAC',
    audit: 'Auditoria completa das operações'
  },
  internalCa: internalCaEnglish,
  errors: {
    forbiddenTitle: '403 Sem permissão',
    forbiddenMessage: 'Você não tem a permissão necessária para acessar esta página.',
    missingPermission: 'Permissão ausente: {permission}',
    notFoundTitle: '404 Página não encontrada',
    notFoundMessage: 'Esta página não existe. Verifique se o endereço acessado está correto.',
    backDashboard: 'Voltar ao painel',
    back: 'Voltar',
    logout: 'Sair'
  }
} as const
