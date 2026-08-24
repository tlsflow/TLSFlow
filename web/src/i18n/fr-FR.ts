// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { internalCaEnglish } from './internal-ca.locale'
import { devicesFrFR } from './devices.locale'
import { caOperationsFrFR } from './ca-operations.locale'
import { credentialsFrFR } from './credentials.locale'
import { providersFrFR } from './providers.locale'
import { monitoringTlsFrFR } from './monitoring-tls.locale'
import { acmeAutomationFrFR } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
export default {
  credentials: credentialsFrFR,
  devices: devicesFrFR,
  caOperations: caOperationsFrFR,
  providers: providersFrFR,
  acme: acmeAutomationFrFR,
  app: {
    brand: 'GCAC',
    platform: 'Plateforme de cycle de vie des certificats SSL',
    defaultBreadcrumb: 'Console',
    dashboard: 'Tableau de bord',
    versionLabel: 'Version {version}'
  },
  common: {
    refresh: 'Actualiser',
    logout: 'Déconnexion',
    enter: 'Ouvrir',
    loading: 'Loading',
    actions: { done: 'Terminé' },
    cancel: 'Annuler',
    save: 'Enregistrer',
    edit: 'Modifier',
    delete: 'Supprimer',
    notAvailable: 'Indisponible',
    close: 'Fermer',
    unknownError: 'Erreur inconnue',
    unknownValue: 'Valeur inconnue : {value}',
    saving: 'Enregistrement…',
    userFallback: 'Guest user',
    tenantFallback: 'Default tenant'
  },
  api: {
    errors: {
      requestFailed: 'Request failed',
      timeout: 'La requête a dépassé {seconds} secondes et a été annulée.'
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
    confirm: {
      title: 'Confirmer {action}',
      impactCount: 'Ressources affectées : {count}',
      defaultRisk: 'Cette opération peut déclencher un déploiement, une nouvelle tentative, un retour arrière ou des changements irréversibles.',
      typeToConfirm: 'Saisissez {text} pour confirmer',
      cancel: 'Annuler',
      confirm: 'Confirmer'
    },
    dataTable: {
      empty: 'Aucune donnée',
      loading: 'Chargement...'
    },
    dryRunChecklist: {
      title: 'Résultats de précontrôle dry-run',
      ariaLabel: 'résultats de précontrôle dry-run',
      empty: 'Aucun résultat de précontrôle dry-run n’a encore été généré.',
      unnamedCheck: 'Contrôle sans nom',
      evidence: 'Éléments de preuve',
      status: { passed: 'Réussi', failed: 'Échec', warning: 'Avertissement', unknown: 'Inconnu' }
    },
    dryRunResult: {
      title: 'Résultat d’exécution dry-run',
      close: 'Fermer'
    },
    modal: {
      closeAria: 'Fermer la fenêtre modale'
    },
    toast: {
      close: 'Fermer'
    },
    drawer: {
      closeAria: 'Fermer le panneau'
    },
    secretInput: {
      label: 'Référence Secret',
      placeholder: 'Sélectionnez ou saisissez un SecretRef. Le texte clair n’est pas enregistré',
      hint: 'Les champs sensibles ne stockent que des références et ne conservent pas de texte clair durable dans le navigateur.'
    },
    riskBadge: {
      levelPrefix: 'Niveau : '
    },
    status: {
      DRAFT: 'Draft',
      PUBLISHED: 'Published',
      PENDING_APPROVAL: 'Pending approval',
      READY: 'Ready',
      RUNNING: 'Running',
      SUCCESS: 'Success',
      PARTIAL_SUCCESS: 'Partial success',
      FAILED: 'Failed',
      CANCELLED: 'Cancelled',
      ROLLED_BACK: 'Rolled back',
      DISCOVERED: 'Discovered',
      MANAGED: 'Managed',
      DRIFTED: 'Drifted',
      EXPIRED: 'Expired',
      REVOKED: 'Revoked',
      ERROR: 'Error',
      IGNORED: 'Ignored',
      ONLINE: 'Online',
      OFFLINE: 'Offline',
      ACTIVE: 'Actif',
      DISABLED: 'Disabled',
      OPEN: 'Ouvert',
      ACKED: 'Pris en compte',
      RESOLVED: 'Résolu',
      UPGRADING: 'Upgrading',
      UPDATE_REQUIRED: 'Update required',
      UP_TO_DATE: 'Up to date',
      UNKNOWN: 'Unknown'
    },
    risk: {
      LOW: {
        label: 'Low',
        description: 'Needs attention, but does not directly block the operation.'
      },
      MEDIUM: {
        label: 'Medium',
        description: 'May affect deployment or monitoring results and needs confirmation.'
      },
      HIGH: {
        label: 'High',
        description: 'May cause service interruption or security exposure.'
      },
      CRITICAL: {
        label: 'Critical',
        description: 'Must be handled first. Risky operations require secondary confirmation.'
      }
    },
    capability: {
      available: 'Disponible',
      missing: 'Manquant',
      title: 'Compatibilité des capacités',
      description: 'Seuls les résultats confirmés par l’API capability du backend sont affichés ; les éléments inconnus ne sont pas considérés comme réussis.',
      matrixLabel: 'Matrice de compatibilité des capacités',
      satisfied: 'Satisfait',
      unknown: 'Inconnu',
      manualRisk: 'Vérification manuelle',
      empty: 'Aucune donnée capability. Le frontend conserve un affichage dégradé.'
    },
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
      actions: {
        showAll: 'Show all {count}',
        showRecent: 'Show latest {count}'
      },
      hint: {
        streaming: 'Task status and logs will update live.',
        autoRefresh: 'Task status and logs will refresh automatically.',
        pollingFallback: 'Currently using polling fallback.',
        limited: 'Showing latest {visible} of {total} log lines.'
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
      aria: {
        progressOverview: 'Execution progress overview',
        taskList: 'Task list',
        latestEvents: 'Latest events',
        executionLog: 'Execution log'
      },
      checklist: {
        title: 'Check results'
      },
      detail: {
        stepsCompleted: '{completed}/{total} steps completed',
        summaryFailed: '{total} check results returned, {failed} failed',
        summaryPassed: 'All {passed} checks passed',
        summaryReturned: '{total} check results returned',
        summaryWarning: '{total} check results returned, {warning} warnings',
        waitingStart: 'Waiting for the task to start',
        waitingSteps: 'Waiting for execution steps from the backend'
      },
      empty: {
        activity: 'Execution log entries will appear after the task completes.',
        events: 'No events have been returned yet.',
        tasks: 'The task has not been created yet. Waiting for execution steps from the backend.'
      },
      event: {
        collapse: 'Collapse events',
        defaultLabel: 'Event',
        defaultTitle: 'Task event',
        expand: 'Expand events',
        waitingDetail: 'Waiting for event data'
      },
      feed: {
        completed: 'Execution completed',
        failed: 'Execution failed',
        skipped: 'Skipped',
        warning: 'Completed with warnings'
      },
      loading: {
        pollingFallback: 'Auto-refresh fallback active',
        refreshing: 'Refreshing'
      },
      log: {
        collapse: 'Collapse full log',
        expand: 'View full log'
      },
      metrics: {
        completed: 'Completed',
        failed: 'Failed',
        passed: 'Passed',
        queued: 'Queued',
        running: 'Running',
        totalTasks: 'Total tasks',
        unknown: 'Unknown',
        warning: 'Warnings'
      },
      process: {
        dryRun: 'Vérification de la mise à jour',
        execution: 'Execution'
      },
      operation: {
        prepare: 'Vérifier le certificat et l’état de la cible avant la mise à jour.',
        backup: 'Enregistrer l’état actuel afin de pouvoir le restaurer si nécessaire.',
        update: 'Appliquer le nouveau certificat au service cible.',
        reload: 'Charger le nouveau certificat et attendre la stabilisation du service.',
        verify: 'Confirmer que le service utilise correctement le nouveau certificat.',
        rollback: 'Restaurer le certificat et l’état du service précédents.'
      },
      progress: {
        completed: 'All complete',
        failed: 'Completed with failed items',
        pending: 'Waiting for result writeback',
        processFailed: '{process} failed',
        queued: 'Waiting for scheduling',
        running: 'Task in progress',
        warning: 'Completed with risk warnings'
      },
      section: {
        completedCount: '{completed}/{total} completed',
        executionLog: 'Execution log',
        latestEvents: 'Latest events',
        taskProgress: 'Task progress'
      },
      status: {
        completed: 'Completed',
        failed: 'Failed',
        queued: 'Waiting',
        running: 'Running',
        skipped: 'Skipped',
        warning: 'Warning'
      },
      step: {
        backup: 'Pre-backup',
        discover: 'Environment discovery',
        prepare: 'Préparation du certificat',
        installDryRun: 'Material loading',
        installExecution: 'Certificate installation',
        updateDryRun: 'Vérification de la mise à jour',
        updateExecution: 'Mise à jour du certificat',
        reload: 'Service reload',
        verify: 'Result verification'
      },
      subtitle: {
        completed: 'The task has completed.',
        failed: 'The task ended with a failed result.',
        failedFriendly: 'Cette étape n’a pas pu être terminée. Ouvrez les détails pour connaître la cause.',
        failedChecks: '{total} checks, {failed} failed',
        passedChecks: '{total} checks passed',
        queued: 'The task has been created and is waiting to run.',
        running: 'The task has started. Waiting for more results.',
        runningChecks: '{total} checks returned',
        skipped: 'This step was skipped and will not continue waiting.',
        warningChecks: '{total} checks, {warning} warnings'
      },
      time: {
        waitingStart: 'Waiting to start'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: 'Cancel',
        dryRun: 'Run optional dry-run preview',
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
        targetSelectedDetail: 'Deployment target selected. Submit directly; run a dry-run preview manually from asset details when needed.',
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
        workflowMode: 'Mode workflow',
        workflowModeWithName: 'Mode workflow ({name})'
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
  tasks: {
    title: 'Tâches globales',
    description: 'Consultez les tâches en file, en cours, de surveillance et système du locataire actuel.',
    quick: { active: 'Tâches actives', recent: 'Achèvements récents' },
    tabs: { all: 'Toutes', execution: "Tâches d'exécution", monitoring: 'Tâches de surveillance', system: 'Tâches système', other: 'Autres tâches' },
    aria: { openDrawer: 'Ouvrir les tâches globales', tabs: 'Catégories de tâches' },
    filters: {
      includeAll: 'Afficher toutes les tâches',
      keyword: 'Rechercher une tâche, une erreur ou un ID',
      taskType: 'Type de tâche',
      status: 'Statut',
      allStatuses: 'Tous les statuts',
      resourceType: 'Type de ressource',
      resourceId: 'ID de ressource',
      requestedBy: 'Utilisateur demandeur',
      taskId: 'ID de tâche',
      createdFrom: 'Début',
      createdTo: 'Fin'
    },
    fields: { requestedBy: 'Utilisateur demandeur', triggerSource: 'Source', createdAt: 'Créée le', startedAt: 'Démarrée le', finishedAt: 'Terminée le', error: 'Dernière erreur' },
    sections: { timeline: 'Chronologie du statut', attempts: 'Tentatives', acmeHistory: 'Progression du renouvellement', logs: 'Journaux bruts', children: 'Sous-tâches', errors: 'Erreurs', audit: "Événements d'audit", monitoringProbes: 'Enregistrements de sondage' },
    actions: { backToList: 'Retour à la liste', viewAll: 'Voir toutes les tâches', viewRawLogs: 'Voir les journaux bruts', search: 'Rechercher', reset: 'Réinitialiser', previousPage: 'Page précédente', nextPage: 'Page suivante', forceCancel: 'Arrêt forcé', forceCancelConfirm: 'Forcer l’arrêt de cette tâche ? Une action distante en cours peut nécessiter une vérification manuelle.', forceCancelReason: 'Arrêt forcé par un opérateur depuis les tâches globales' },
    messages: { loadFailed: 'Impossible de charger les tâches.', detailFailed: 'Impossible de charger le détail de la tâche.', forceCancelFailed: 'Impossible d’arrêter la tâche.' },
    values: { system: 'Système', empty: 'Aucun enregistrement', none: 'Aucune' },
    approval: {
      title: 'Détail de la tâche d’approbation',
      description: 'Consultez le contenu, l’historique du statut et les actions disponibles.',
      contentTitle: 'Contenu de l’approbation',
      fields: { operation: 'Opération', target: 'Cible', approvalId: 'ID d’approbation', requestedBy: 'Demandeur', riskLevel: 'Niveau de risque', createdAt: 'Soumise le', decision: 'Décision', summary: 'Résumé de l’opération' },
      content: { deployment: 'Déploiement du certificat', automation: 'Exécution automatisée', defaultSummary: 'Cette tâche attend une décision d’approbation.' },
      values: { approved: 'Approuvée', rejected: 'Rejetée', pending: 'En attente d’approbation' },
      timelineTitle: 'Chronologie du statut',
      timeline: { created: 'Approbation soumise', createdDescription: 'La tâche a été créée et attend un approbateur.', approved: 'Approbation accordée', approvedDescription: 'L’approbateur a autorisé la poursuite de l’opération.', rejected: 'Approbation rejetée', rejectedDescription: 'L’approbateur a rejeté cette opération.', forceEnded: 'Tâche arrêtée de force', forceEndedDescription: 'Un opérateur a arrêté cette tâche de force.', pending: 'Approbation en cours', pendingDescription: 'Le système attend le résultat de l’approbation.' }
    },
    relatedNames: { builtinCatalog: 'Catalogue de plugins intégré', deploymentPlan: 'Plan de déploiement', acmeRenewal: 'Fournisseur ACME ({provider}) - renouvellement du certificat {certificate}' },
    acmeHistory: {
      queued: { title: 'En attente de renouvellement', description: 'Le système attend de traiter ce renouvellement de certificat.' },
      running: { title: 'Renouvellement en cours', description: 'Le système demande le renouvellement à l’autorité de certification.' },
      retryWaiting: { title: 'En attente de nouvelle tentative', description: 'Cette émission n’est pas terminée. Le système réessaiera plus tard.' },
      succeeded: { title: 'Renouvellement réussi', description: 'Le nouveau certificat a été émis et enregistré.' },
      failed: { title: 'Échec du renouvellement', description: 'Le système n’a pas pu renouveler le certificat. Consultez les journaux bruts.' },
      cancelled: { title: 'Renouvellement annulé', description: 'Ce renouvellement de certificat a été annulé.' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: 'Dry-run du certificat',
      CERTIFICATE_DEPLOY: 'Déploiement du certificat',
      DEPLOYMENT_APPROVAL: 'Approbation du déploiement',
      CERTIFICATE_VERIFY: 'Vérification du certificat',
      CERTIFICATE_ROLLBACK: 'Restauration du certificat',
      AGENT_INSTALL: 'Installation Agent',
      AGENT_UPDATE: 'Mise à jour Agent',
      PLUGIN_REFERENCE_REFRESH: 'Rafraîchissement des références plugin',
      DEPLOYMENT_PLAN_REFRESH: 'Rafraîchissement du plan de déploiement',
      MONITORING_BATCH: 'Lot de supervision',
      MONITORING_PROBE: 'Sonde de supervision',
      CA_NODE_TASK: 'Tâche de nœud CA',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CA_RECORD_SYNC: 'Synchronisation des enregistrements CA',
      CERTIFICATE_REVOCATION: 'Révocation du certificat',
      CRL_PUBLISH: 'Publication CRL',
      TRUST_DISTRIBUTION: 'Distribution de confiance',
      GATEWAY_DELEGATION: 'Délégation passerelle',
      WORKFLOW_RUN: 'Exécution du workflow',
      AUTOMATION_RUN: 'Exécution automatisée',
      REPORT_EXPORT: 'Export de rapport',
      NOTIFICATION_DELIVERY: 'Livraison de notification',
      OTHER: 'Autre tâche'
    },
    summaryTemplates: {
      QUEUED: '{task} mis en file d’attente',
      RUNNING: '{task} en cours',
      RETRY_WAITING: 'Nouvelle tentative en attente pour {task}',
      WAITING_RESULT: 'En attente du résultat de {task}',
      AWAITING_CONFIRMATION: 'Résultat de {task} à confirmer',
      CANCELLING: 'Annulation de {task}',
      SUCCEEDED: '{task} terminé',
      FAILED: 'Échec de {task}',
      CANCELLED: '{task} annulé'
    },
    status: { QUEUED: 'En file', RUNNING: 'En cours', RETRY_WAITING: 'En attente de nouvelle tentative', WAITING_RESULT: 'En attente du résultat', AWAITING_CONFIRMATION: 'Résultat à confirmer', WAITING_APPROVAL: 'En attente d’approbation', CANCELLING: 'Annulation', SUCCEEDED: 'Réussie', FAILED: 'Échec', CANCELLED: 'Annulée' }
  },
  shell: {
    currentLocation: 'Current location',
    breadcrumb: 'Breadcrumb',
    currentGroupNavigation: 'Current group navigation',
    backDashboard: 'Back to dashboard',
    sidebarCollapse: 'Réduire la barre latérale',
    sidebarExpand: 'Développer la barre latérale'
  },
  globalSearch: {
    title: 'Recherche globale',
    description: 'Rechercher des certificats, actifs d’appareils, paramètres système et plugins.',
    inputLabel: 'Rechercher des ressources globales',
    inputPlaceholder: 'Saisissez un nom, domaine, empreinte ou chemin',
    hint: 'Saisissez un mot-clé pour commencer la recherche.',
    aria: {
      open: 'Ouvrir la recherche globale'
    },
    categories: {
      certificates: 'Certificats',
      assets: 'Actifs d’appareils',
      settings: 'Paramètres système',
      plugins: 'Plugins'
    },
    types: {
      serverCertificate: 'Certificat serveur',
      intermediateCertificate: 'Certificat intermédiaire',
      rootCertificate: 'Certificat racine',
      application: 'Application',
      device: 'Appareil',
      cloudService: 'Service cloud',
      systemSetting: 'Paramètre système',
      plugin: 'Plugin'
    },
    empty: {
      title: 'Aucun résultat correspondant',
      description: 'Essayez un autre nom, domaine, empreinte ou chemin.'
    },
    messages: {
      loadFailed: 'Échec du chargement de la recherche globale.'
    }
  },
  preferences: {
    theme: 'Thème',
    language: 'Langue',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    themeToggle: 'Switch theme',
    languageSelect: 'Select language',
    title: 'Préférences d’affichage',
    description: 'Theme and language are saved to your backend user preferences.',
    errors: {
      loadFailed: 'Failed to load preferences',
      saveFailed: 'Failed to save preferences'
    }
  },
  userMenu: {
    currentUser: 'Utilisateur courant',
    changePassword: 'Modifier le mot de passe',
    logout: 'Déconnexion'
  },
  password: {
    title: 'Modifier le mot de passe',
    description: 'Change the local password for the signed-in user.',
    current: 'Mot de passe actuel',
    new: 'Nouveau mot de passe',
    confirm: 'Confirmer le mot de passe',
    cancel: 'Annuler',
    submit: 'Enregistrer',
    submitting: 'Saving…',
    success: 'Password updated',
    failed: 'Password change failed',
    mismatch: 'The new passwords do not match',
    tooShort: 'The new password must be at least 8 characters'
  },
  viewMode: {
    switchLabel: 'Mode d’affichage de l’application',
    user: 'Vue utilisateur',
    professional: 'Vue professionnelle',
    steps: {
      certificates: 'Certificats',
      applications: 'Applications',
      deployments: 'Déploiements'
    }
  },
  nav: {
    dashboard: 'Tableau de bord',
    dashboardDesc: 'Overview of applications, certificates, agents, gateways, and audit status',
    certificates: 'Gestion des certificats',
    certificatesDesc: 'Certificate library, bindings, and expiry status',
    certificateAssets: 'Certificate assets',
    certificateAssetsDesc: 'Certificates, private key references, fingerprints, and expiry times',
    acmeAutomation: 'Automatisation des certificats ACME',
    acmeAutomationDesc: 'Émettre, renouveler et suivre les certificats ACME',
    certificateFormats: 'Certificate format config',
    certificateFormatsDesc: 'Define PFX, CER, CRT, PEM, and other format rules for saved certificates',
    assetCenter: 'Asset Center',
    assetCenterDesc: 'Manage application, device, and cloud service assets',
    assetManagement: 'Gestion des applications',
    assets: 'Application assets',
    assetsDesc: 'Application entry points and certificate deployment targets by domain/IP',
    devices: 'Devices',
    agents: 'Agents',
    agentsDesc: 'Online status, heartbeat, and capability set',
    gateways: 'Gateways',
    gatewaysDesc: 'Gateway, protocol, and reachable target status for isolated zones',
    deployments: 'Certificate deployment',
    deploymentsDesc: 'Plans de déploiement, workflows, automatisations et enregistrements d’exécution',
    deploymentPlans: 'Deployment plans',
    deploymentPlansDesc: 'Certificate deployment plans and approval entry points',
    executions: 'Execution records',
    executionsDesc: 'Execution steps, logs, failures, and rollback',
    workflows: 'Workflows',
    workflowsDesc: 'Workflows and plugins',
    workflowTemplates: 'Workflows',
    workflowTemplatesDesc: 'Canvas drafts, variables, capability declarations, and publishing',
    automations: 'Automatisations',
    automationsDesc: 'Plans de renouvellement de certificats planifiés, à la demande et par lot',
    plugins: 'Centre des plugins',
    pluginsDesc: 'Provider, executor, and sandbox status',
    monitoring: 'Surveillance et audit',
    monitoringDesc: 'Alertes, audit et état des certificats',
    monitoringAnalysis: 'Analyse de la surveillance',
    monitoringAnalysisDesc: 'Analyser les cibles, les sondes et les risques liés aux certificats',
    monitorAlerts: 'Alertes de surveillance',
    monitorAlertsDesc: 'Événements d’expiration, de dérive et d’échec d’exécution',
    monitorTls: 'Surveillance TLS approfondie',
    monitorTlsDesc: 'Chaînes de confiance, suites de protocoles, simulation de poignée de main et détails des protocoles',
    audits: 'Journaux d’audit',
    auditsDesc: 'Éléments probants des opérations et exports de conformité',
    logAudit: 'Audit des journaux',
    logAuditDesc: 'Consulter les événements d’audit et exporter les preuves opérationnelles',
    reports: 'Reports',
    reportsDesc: 'Certificate incident windows, risk response, and automation effectiveness',
    incidentWindowReport: 'Incident window',
    incidentWindowReportDesc: 'Prioritize expiring and expired certificates',
    riskResponseReport: 'Risk response',
    riskResponseReportDesc: 'Acknowledgement, resolution time, and SLA',
    automationEffectivenessReport: 'Automation effectiveness',
    automationEffectivenessReportDesc: 'Run and target success rates with failure stages',
    settings: 'Paramètres système',
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
  automations: {
    title: 'Automatisations',
    description: 'Gérez les exécutions planifiées, à la demande et par lot des plans de renouvellement de certificats.',
    empty: 'Aucune automatisation.',
    emptyDescription: 'Aucune description',
    common: { notAvailable: 'Indisponible', allRelated: 'All related targets' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: 'Déclencher via une API externe', apiHelp: 'Un système externe appelle l’API d’exécution. L’aperçu et l’approbation restent appliqués.', once: 'Exécuter une fois à une heure fixe', onceHelp: 'Choisissez une heure locale du navigateur. La tâche ne sera pas replanifiée après son exécution.', recurring: 'Exécuter périodiquement', scheduleHelp: 'Exécution selon un planning récurrent, uniquement si un contrôle continu est réellement nécessaire.', recurringHelp: 'Exécution selon un planning récurrent, uniquement si un contrôle continu est réellement nécessaire.', recurringWarningTitle: 'L’exécution périodique est déconseillée pour les certificats', recurringWarning: 'Le remplacement doit normalement être déclenché après l’émission du certificat ou planifié une seule fois.', certificateVersionCreated: 'Certificate new-version event', certificateVersionCreatedHelp: 'L’automatisation démarre lorsqu’une source externe ou une importation manuelle crée une nouvelle version de certificat.', runAt: 'Heure d’exécution', frequency: 'Fréquence', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', time: 'Heure', weekday: 'Jour de la semaine', monthDay: 'Jour du mois', legacyCustom: 'Conserver le planning personnalisé', legacyCron: 'Cron existant (lecture seule)', weekdays: { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' } },
    form: { existingAssetTitle: 'Mettre à jour uniquement les actifs applicatifs existants', existingAssetDescription: 'L’automatisation traite uniquement les actifs ayant déjà une liaison de certificat. Elle ne réalise pas la première installation et n’ajoute pas de cible.', certificateDomains: 'Domaines du certificat', certificateDomainsPlaceholder: 'Saisissez les domaines séparés par des virgules', certificateDomainsHelp: 'Seules les liaisons existantes de ces domaines sont mises à jour.', versionSelection: 'Version du certificat à déployer', versionSelectionLatest: 'Utiliser automatiquement la dernière version', versionSelectionSpecific: 'Utiliser des versions précises', versionSelectionHelp: 'La version est résolue et figée au démarrage de l’exécution.', certificateVersionIds: 'Versions précises du certificat', certificateVersionIdsPlaceholder: 'Saisissez les ID de version séparés par des virgules', certificateVersionIdsHelp: 'Chaque version doit appartenir à un certificat sélectionné par les domaines.', versionLoading: 'Chargement des versions disponibles.', versionLoadFailed: 'Échec du chargement des versions. Réessayez plus tard.', versionEmpty: 'Aucune version sélectionnable pour ces domaines.', schedule: 'Quand mettre à jour', scheduleHelp: 'Lancez à la demande ou exécutez périodiquement avec Cron et un fuseau horaire.', execution: 'Ce qui se passe pendant l’exécution', executionHelp: 'Un plan distinct est créé pour chaque liaison existante en réutilisant DeploymentPlan, approbation et ExecutionRun.', snapshot: 'Figer le domaine, l’actif et la version du certificat' },
    fields: { name: 'Nom', description: 'Description', trigger: 'Déclencheur', eventSources: 'Event sources', eventSourcesHelp: 'Choose which certificate version events can start this automation.', targetScope: 'Update scope', selectedAssets: 'Selected application assets', selectedAssetsHelp: 'Select at least one managed application asset.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Expression Cron', timeZone: 'Fuseau horaire', expiresWithinDays: 'Fenêtre d’expiration en jours', environments: 'Environnements cibles (séparés par des virgules)', certificateIds: 'Certificats spécifiques (facultatif)', certificateIdsPlaceholder: 'Saisissez les ID séparés par des virgules', certificateIdsHelp: 'Si renseigné, seuls ces certificats sont traités ; sinon les règles d’expiration et d’environnement s’appliquent.', expiresWithinDaysHelp: 'Ne faire correspondre que les certificats arrivant à expiration dans cette fenêtre.', environmentsHelp: 'Traiter uniquement les certificats de ces environnements.', planType: 'Type de plan de déploiement', planTypeHelp: 'Un DeploymentPlan distinct est créé à l’exécution pour chaque cible correspondante.', planTypeUpdate: 'Mettre à jour une liaison existante', planTypeInstall: 'Installer un certificat sur la cible', planTypeVerifyOnly: 'Vérifier uniquement, sans modifier le certificat', planMode: 'Mode d’exécution', planModeHelp: 'L’automatisation ne lie pas un plan existant ; elle en crée un pour chaque cible.', planModeCreateAndExecute: 'Créer et exécuter le plan', planModeCreateOnly: 'Créer les plans sans les exécuter', maxTargets: 'Nombre maximal de cibles par exécution', concurrency: 'Concurrence', failureCount: 'Seuil du nombre d’échecs', requireDryRun: 'Paramètre Dry Run historique (pas une condition d’exécution)', requireApproval: 'Exiger une approbation avant l’exécution', startedAt: 'Début', finishedAt: 'Fin', failureStage: 'Étape d’échec', parentRun: 'Exécution parente' },
    actions: { create: 'Créer une automatisation', detail: 'Details', edit: 'Modifier', delete: 'Supprimer', cancel: 'Annuler', save: 'Enregistrer', copy: 'Copier', enable: 'Activer', disable: 'Désactiver', runNow: 'Run now', preview: 'Prévisualiser les cibles', history: 'Historique des exécutions', confirmRun: 'Confirmer l’exécution', stop: 'Arrêter l’exécution', retryFailed: 'Réessayer les cibles en échec', openPlan: 'Ouvrir le plan de déploiement', openExecution: 'Ouvrir l’exécution' },
    manualRun: { title: 'Exécution manuelle', description: 'Sélectionnez une version de certificat avant d’exécuter.', versionLabel: 'Version du certificat', versionPlaceholder: 'Sélectionnez une version de certificat', help: 'L’exécution résout les actifs applicatifs liés à partir de la version sélectionnée.', empty: 'Aucune version de certificat n’est disponible pour une exécution manuelle.', stopOnError: 'Arrêter sur erreur', dryRun: 'Lancer une prévisualisation dry-run optionnelle', start: 'Démarrer' },
    columns: { status: 'Status', trigger: 'Déclencheur', targets: 'Limite de cibles', actions: 'Actions', nextRun: 'Prochaine exécution', lastRun: 'Dernière exécution' },
    triggers: { onDemand: 'À la demande', schedule: 'Planifiée' },
    triggerTypes: { on_demand: 'À la demande', schedule: 'Planifiée', certificate_version_created: 'Certificate new-version event', retry: 'Nouvelle tentative des échecs' },
    eventSources: { external_source: 'Source externe', manual_import: 'Importation manuelle' },
    targetScopes: { allRelatedAssets: 'Update all related application assets', allRelatedAssetsHelp: 'Resolve every bound and deployable application asset automatically after the event or filters match.', selectedAssets: 'Update selected application assets only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for manually selected application assets.' },
    assetPicker: { available: 'Available assets', selected: 'Selected assets', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No application assets are available to add.', emptySelected: 'No application assets selected yet.' },
    actionTypes: { create_deployment_plan: 'Créer un plan de renouvellement de certificat', execute_deployment_plan: 'Exécuter le plan de renouvellement de certificat', send_notification: 'Envoyer une notification' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: 'Jusqu’à {count} cibles' },
    preview: { title: 'Impact sur les actifs', description: "Comparez l'échéance actuelle du certificat de chaque actif sélectionné avec l'échéance du certificat cible.", matched: '{count} correspondances', executable: '{count} exécutables', excluded: '{count} exclues', affected: '{count} actifs concernés', upgrade: '{count} validités prolongées', same: '{count} même échéance', skip: '{count} mises à jour ignorées', downgrade: '{count} à vérifier', version: 'Version {version}', versionUnknown: 'Version inconnue', ready: 'Prête', skipUpdate: 'Ignorer la mise à jour', expiryLabel: 'Expiration', impact: { upgrade: 'Validité prolongée', same: 'Même échéance', downgrade: 'Risque de validité réduite', missing_current: 'Certificat actuel absent', unknown: 'Impact inconnu' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} application assets involved', assetsResolvedAtRuntime: 'Target assets are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved assets', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: 'Permission refusée sur la cible', missing_version: 'Version du certificat manquante', version_not_deployable: 'Version du certificat non déployable', binding_not_managed: 'Liaison non gérée', environment_not_allowed: 'Environnement non autorisé', binding_missing: 'Liaison absente', asset_missing_deployment_capability: 'La cible ne peut pas déployer de certificats', certificate_version_downgrade: 'La version cible est antérieure à la version actuelle', certificate_already_up_to_date: 'L’expiration cible correspond déjà au certificat actuel ; mise à jour ignorée', filter_not_matched: 'Les conditions de filtrage ne correspondent pas', runtime_context_required: 'Le contexte d’exécution est requis', unknown: 'Raison d’exclusion inconnue' },
    failureStages: { selection: 'Sélection des cibles', plan_creation: 'Création du plan', dry_run: 'Dry Run', approval: 'Approbation', execution: 'Exécution', verification: 'Vérification', rollback: 'Restauration', notification: 'Notification' },
    progress: { total: 'Total', pending: 'En attente', running: 'En cours', waitingApproval: 'En attente d’approbation', succeeded: 'Réussies', failed: 'Échouées', skipped: 'Ignorées', cancelled: 'Annulées' },
    editor: { createTitle: 'Créer une automatisation', editTitle: 'Modifier l’automatisation', description: 'Configurez quand elle s’exécute, les certificats concernés, la création des plans et le comportement en cas d’échec.', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot.', sections: { basic: 'Informations générales', basicHelp: 'Donnez un nom clair à l’automatisation et décrivez les changements de certificats concernés.', trigger: 'Trigger', triggerHelp: 'Define what fact starts the automation before choosing execution and conditions.', targets: 'Certificats à traiter', targetsHelp: 'Ce sont des cibles de certificats, pas des plans existants ; leur instantané est figé au démarrage.', execution: 'Execution', executionHelp: 'Decide how the automation updates assets first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters, approval, and concurrency guardrails together in this step.', plan: 'Plan de déploiement du certificat', planRelationTitle: 'Aucun plan de déploiement existant n’est lié', planRelationDescription: 'Un plan est créé à l’exécution à partir des filtres de certificats.', planRelationHelp: 'Chaque cible reçoit son propre DeploymentPlan ; son ID apparaît dans les détails de l’exécution.', guardrails: 'Contrôles de sécurité', guardrailsHelp: 'Ces limites contrôlent le lot, les précontrôles, l’approbation et l’arrêt sur échec.' }, chain: { createPlan: 'Créer un DeploymentPlan par cible', dryRun: 'Exécuter la prévisualisation Dry Run facultative', approval: 'Attendre l’approbation', executePlan: 'Exécuter le DeploymentPlan de la cible' } },
    runs: { title: 'Historique des automatisations', description: 'Consultez l’état de l’exécution, les instantanés immuables des cibles et les étapes d’échec.', progress: '{succeeded}/{total} réussies' },
    runDetail: { title: 'Détails de l’exécution automatisée', description: 'Version de configuration {version}', noFailure: 'Aucun échec', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', approvalId: 'Approval ID', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: 'Prévisualisation des cibles de l’automatisation', runs: 'Liste des exécutions automatisées', progress: 'Progression de l’exécution automatisée' },
    errors: { loadFailed: 'Échec du chargement des automatisations', applicationAssetsLoadFailed: 'Failed to load application assets. Try again later.' }
  },
  routes: {
    certificateImport: 'Import certificate',
    certificateDetail: 'Certificate detail',
    certificateUsages: 'Usages',
    certificateFormats: 'Format artifacts'
  },
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
    toggleFilters: 'Filtrer',
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
      nameFallback: 'Étape {index}',
      labels: {
        discover: 'Découvrir la cible de déploiement',
        backup: 'Sauvegarder le certificat actuel',
        install: 'Installer le nouveau certificat',
        reload: 'Recharger le service',
        verify: 'Vérifier le certificat',
        rollback: 'Restaurer le certificat'
      },
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
      workflowIdentity: 'Version d’exécution : plugin {plugin} ; workflow {workflow}',
      failure: {
        emptyMessage: 'The backend did not receive a concrete error message',
        issue: 'Catégorie {category}, emplacement {slot}, chemin {path}, source {source}, correction {remediation}'
      },
      skipped: 'Step skipped: {reason}',
      running: {
        dispatched: 'Agent task taskId={taskId} envoyé. Le plan de contrôle interroge activement le résultat.',
        waitingAgentResult: 'Étape en cours ; le plan de contrôle interroge activement le résultat de l’Agent…',
        waitingExternalResult: 'The step is running and waiting for an external execution result.',
        resultUnconfirmed: 'The write result needs confirmation: {code}: {message}. This step will not be replayed automatically.'
      },
      unknownResult: 'Le résultat de l’écriture est inconnu ; la relance automatique est suspendue.',
      diagnosticsTitle: 'Journal de vérification détaillé',
      structuredDetail: 'Voir les détails structurés',
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
      tlsGrantRequired: {
        label: 'Dry-run terminé, autorisation de l’hôte requise',
        detail: 'Les contrôles structurels et de sécurité sont terminés. Le dry-run ne délivre pas d’ExecutionGrant formel ; le contournement de la vérification TLS a donc été refusé. Après approbation, l’hôte délivrera un ExecutionGrant temporaire pour l’exécution réelle.'
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
    },
    recovery: {
      confirm: 'Vérifier le certificat et continuer',
      running: 'Vérification du certificat…',
      confirmed: 'Le certificat cible est actif ; l’exécution va continuer.',
      failed: 'La vérification du certificat a échoué ; l’exécution est arrêtée.',
      pending: 'L’état du certificat cible ne peut pas encore être confirmé. Réessayez plus tard.'
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
    messages: {
      recoveryConfirmed: 'L’état du certificat cible est confirmé ; l’exécution va continuer. Suivez la progression dans la liste globale des tâches.',
      recoveryFailed: 'La vérification du certificat a échoué. Les détails sont enregistrés dans le journal d’exécution.',
      recoveryPending: 'L’état du certificat cible reste inconnu. La tâche attend une confirmation ; réessayez plus tard.'
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
      noLogs: 'No logs.',
      unknownResultDescription: 'L’opération d’installation d’origine ne sera pas rejouée. Seule une vérification TLS en lecture seule de l’empreinte du certificat sera effectuée.'
    },
    tabs: {
      summary: 'Summary',
      steps: 'Steps',
      logs: 'Logs'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: 'Adresse de connexion', connectionPort: 'Port de connexion', basePath: 'Chemin de base', timeoutSeconds: 'Délai en secondes', gateway: 'Gateway d’exécution',
      authenticationMode: 'Mode d’authentification', credential: 'Identifiant de gestion de l’appareil', username: 'Nom d’utilisateur', passwordSecret: 'SecretRef du mot de passe', apiTokenSecret: 'SecretRef du jeton API', clientCertificate: 'Certificat client',
      tlsEnabled: 'Activer TLS', tlsVerifyPeer: 'Vérifier le certificat serveur', tlsServerName: 'Nom du serveur TLS', caSecret: 'SecretRef de l’AC', tlsMinimumVersion: 'Version TLS minimale',
      deviceDisplayName: 'Nom d’affichage de l’appareil', deviceDescription: 'Description de l’appareil', deviceTags: 'Étiquettes de l’appareil', targetName: 'Nom de la cible', targetLabels: 'Étiquettes de la cible'
    },
    forms: { loadOptions: 'Charger les options', previewTitle: 'Formulaire de configuration du plug-in', loading: 'Chargement du formulaire...', loadFailed: 'Échec du chargement du formulaire', empty: 'Ce plug-in ne déclare aucun formulaire de configuration.' },
    presentation: { previewTitle: 'Aperçu standard de l’appareil', sensitiveValue: 'Valeur sensible masquée', tabsAriaLabel: 'Onglets d’informations de l’appareil' },
    title: 'Plugins',
    description: 'Plugin packages, providers, permission declarations, signature validation, sandbox status, and isolation entry points.',
    resourceName: 'Plugin',
    actions: {
      install: 'Install plugin',
      detail: 'Details',
      create: 'Créer',
      refresh: 'Refresh market',
      refreshing: 'Refreshing...',
      createWorkflow: 'Créer un workflow',
      creatingWorkflow: 'Création...',
      enable: 'Activer',
      disabling: 'Désactivation...',
      disable: 'Désactiver',
      disableRisk: 'Disabling a plugin affects provider, template, and executor capabilities.'
    },
    market: { eyebrow: 'Marché des plugins DSL', title: 'Découvrir des automatisations réutilisables', description: 'Les modèles intégrés sont livrés avec le système et les modèles utilisateur proviennent de data/workflows. Chaque modèle gère son logo, sa version sémantique et ses tags.' },
    sources: { builtin: 'Intégré', user: 'Plugin utilisateur' },
    statuses: { valid: 'Disponible', invalid: 'Invalide', available: 'Prêt à créer', enabled: 'Activé', disabled: 'Non activé', pendingApproval: 'En attente d’approbation', inUse: 'Utilisé', notInUse: 'Non utilisé' },
    filters: { searchLabel: 'Rechercher des plugins', searchPlaceholder: 'Rechercher par nom, tag, catégorie ou chemin', allSources: 'Toutes les sources', allStatuses: 'Tous les états', statusLabel: 'État du plugin' },
    card: { defaultDescription: 'Ce plugin DSL ne possède pas encore de description.', unversioned: 'Sans version', stepCount: '{count} étapes d’exécution', moreTags: '+{count} autres' },
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
      builtin: { title: 'Plugins intégrés' },
      user: { title: 'Plugins utilisateur' },
      enabled: { title: 'Plugins activés' },
      using: { title: 'Utilisés' },
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
    types: { provider: 'Plugin fournisseur cloud', standard: 'Plugin standard' },
    fields: {
      pluginId: 'Plugin ID',
      pluginType: 'Plugin type',
      provider: 'Cloud provider',
      name: 'Plugin name',
      currentStatus: 'Current status',
      version: 'Version',
      source: 'Source', category: 'Catégorie', steps: 'Étapes d’exécution', rollbackSteps: 'Étapes de restauration', updatedAt: 'Mis à jour le', filePath: 'Chemin du modèle', logoUrl: 'URL du logo', platforms: 'Plateformes cibles', updateMethods: 'Méthodes de mise à jour', maintainer: 'Mainteneur', homepage: 'Page du projet', usage: 'État d’utilisation', validationError: 'Erreur de validation',
      signatureStatus: 'Signature status',
      riskLevel: 'Risk level', runtime: 'Runtime', executionMode: 'Modèle d’exécution', scope: 'Portée', support: 'Niveau de support', capabilities: 'Capacités', frameworks: 'Frameworks cibles', products: 'Produits pris en charge', operations: 'Opérations prises en charge'
    },
    labels: { permissions: 'Autorisations déclarées', runnerStatus: 'État du Runner' },
    permissionKeys: {
      network_http: 'Requêtes réseau', secret_read: 'Lecture des secrets', artifact_read: 'Lecture des artefacts', device_write: 'Écriture sur les appareils',
      agent_execution_receipt: 'Reçus d’exécution de l’Agent', agent_fact_collect: 'Collecte des faits de l’Agent', agent_plan_execute: 'Exécution du plan de l’Agent', agent_plan_validate: 'Validation du plan de l’Agent',
      audit_append: 'Ajout de journaux d’audit', cloud_service_get: 'Lecture des services cloud', execution_cancel_read: 'Lecture de l’annulation d’exécution', execution_checkpoint: 'Points de contrôle d’exécution',
      execution_checkpoint_read: 'Lecture des points de contrôle', execution_checkpoint_write: 'Écriture des points de contrôle', execution_progress: 'Progression de l’exécution', execution_progress_write: 'Écriture de la progression',
      resource_lock: 'Verrous de ressources', secret_resolve: 'Résolution des secrets'
    },
    runnerStatuses: { ready: 'Runner prêt', busy: 'Runner occupé', unavailable: 'Runner indisponible', notObserved: 'Runner non observé' },
    capabilityKeys: {
      device_connection_test: 'Test de connexion', device_identity_detect: 'Détection d’identité appareil', device_discover: 'Découverte appareil', device_logs_read: 'Lecture des journaux appareil',
      certificate_discover: 'Découverte de certificats', certificate_deploy: 'Déploiement de certificat', certificate_rollback: 'Restauration de certificat', certificate_verify: 'Vérification de certificat',
      application_discover: 'Découverte d’application', ca_account_manage: 'Gestion de compte AC', ca_order_manage: 'Gestion des commandes AC', ca_challenge_orchestrate: 'Orchestration des défis AC',
      ca_challenge_dns_solver: 'Résolution des défis DNS AC', ca_certificate_issue: 'Émission de certificat AC', ca_certificate_renew: 'Renouvellement de certificat AC', ca_certificate_revoke: 'Révocation de certificat AC',
      cloud_service_connection_test: 'Test de connexion au service cloud', cloud_service_discover: 'Découverte des services cloud'
    },
    unknownCatalogValue: 'Valeur de catalogue inconnue : {value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: 'Runtime personnalisé', runtime_custom: 'Runtime personnalisé', adc_load_balancer: 'Répartiteur de charge ADC', cloud_aliyun_cdn: 'CDN Alibaba Cloud', cloud_aliyun_alb: 'ALB Alibaba Cloud', cloud_aliyun_clb: 'CLB Alibaba Cloud', cloud_aliyun_oss: 'OSS Alibaba Cloud', cloud_aliyun_waf_cname: 'WAF CNAME Alibaba Cloud', cloud_aliyun_waf_cloud: 'WAF Cloud Alibaba Cloud', cloud_aliyun_live: 'Live Alibaba Cloud', cloud_aliyun_vod: 'VOD Alibaba Cloud', cloud_tencent_cdn: 'CDN Tencent Cloud', cloud_tencent_clb: 'CLB Tencent Cloud', cloud_tencent_live: 'Live Tencent Cloud', cloud_huawei_cdn: 'CDN Huawei Cloud', cloud_huawei_elb: 'ELB Huawei Cloud', cloud_volcengine_cdn: 'CDN Volcengine', cloud_volcengine_alb: 'ALB Volcengine', cloud_volcengine_clb: 'CLB Volcengine', cloud_volcengine_live: 'Live Volcengine', cloud_volcengine_vod: 'VOD Volcengine' },
    runtimeTypes: { agent_atomic: 'Exécution atomique Agent', workflow_dsl: 'Workflow DSL' },
    scopeTypes: { managed: 'Cible gérée', standalone: 'Cible autonome', both: 'Gérée / autonome' },
    supportTypes: { official: 'Support officiel', community: 'Support communautaire', self_managed: 'Auto-maintenu' },
    aria: { filters: 'Plugin market filters', list: 'DSL plugin list', logo: '{name} logo' },
    errors: { loadFailed: 'Échec du chargement du marché des plugins', createFailed: 'Échec de la création du workflow depuis le plugin' },
    agentDeployment: {
      mount: 'Monter sur l’Agent', mounting: 'Montage...', selectAgent: 'Sélectionner l’Agent cible', type: 'Type de plugin', targetAgent: 'Agent cible', mountFailed: 'Échec du montage du plugin Agent',
      executionMode: 'Mode d’exécution Agent', nativeHandler: 'Gestionnaire natif', pluginMode: 'Plugin Agent', mountedPlugin: 'Plugin monté', selectMountedPlugin: 'Sélectionner un plugin monté',
      plugin: 'Plugin de déploiement', selectPlugin: 'Sélectionner un plugin de déploiement', noCompatiblePlugin: 'Aucun plugin activé ne correspond à la plateforme et au framework actuels', compatiblePluginHint: 'Seuls les plugins activés correspondant à la plateforme et au framework de l’actif sont affichés.',
      secretRefPlaceholder: 'Saisir un identifiant SecretRef', artifactBinding: 'Artefact de certificat {name}', artifactBindingPlaceholder: 'Exemple : value=fullchain,key=private', preview: 'Valider la configuration', previewFailed: 'Échec de validation de la configuration du plugin Agent',
      approveAndEnable: 'Approuver et activer', activating: 'Activation...', activateFailed: 'Échec de l’approbation ou de l’activation du plugin Agent', disableFailed: 'Échec de la désactivation du plugin Agent',
      types: { WORKFLOW_TEMPLATE: 'Modèle de workflow', UNIFIED_PLUGIN: 'Plugin de capacité unifié' }
    },
    changeSummaries: { createWorkflow: 'Créer un workflow depuis un modèle du marché' }
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
      review: 'Review approval',
      approve: 'Approve request',
      approveRisk: 'Approval makes the plan eligible for execution; the host-issued ExecutionGrant is still required at execution time.',
      reject: 'Reject request',
      rejectRisk: 'A rejected plan cannot execute and must be submitted for approval again.',
      execute: 'Execute deployment',
      executeRisk: 'Execution modifies target certificate configuration. Completed or failed plans also use this entry for re-execution; execution performs the required synchronous checks, while an optional dry-run preview is available from the asset detail deployment flow.',
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
      workflowDslVersion: 'Workflow DSL version',
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
      approvalPending: 'The approval request was submitted. An approver must approve it before execution.',
      approvalRejected: 'The approval was rejected. Execution is unavailable.',
      needDryRun: 'Dry-run is an optional impact preview for reviewing certificate, domain, and target compatibility checks.',
      missingRunId: 'runId is missing, so rollback is not allowed.',
      missingSelection: 'Deployment plan selection is missing'
    },
    common: {
      cancel: 'Cancel',
      close: 'Close',
      notConfigured: 'Not configured',
      notProvided: 'Not provided'
    },
    approval: {
      title: 'Approval details',
      description: 'Review the deployment plan scope, then approve or reject the request directly.',
      requestedBy: 'Requested by',
      riskLevel: 'Risk level',
      decisionHint: 'Approval makes the plan eligible for real execution. A rejected plan must be submitted again.',
      processing: 'Processing...',
      missingApprovalId: 'Approval ID is missing, so this request cannot be reviewed.',
      decisionFailed: 'Approval action failed.'
    },
    detail: {
      certificateVersionLabel: 'Certificate version',
      description: 'View basic plan information, related records, and the latest execution result.',
      emptyRelatedRecords: 'No related records.',
      loadingRelatedRecords: 'Loading related records...',
      noExecutionRecords: 'This plan has no execution records yet.',
      inputSourcesLoadFailed: 'Échec du chargement des sources des entrées de déploiement',
      inputSourcesTitle: 'Sources des entrées de déploiement',
      inputSource: 'Source : {source}',
      inputSourceTarget: 'Cible de déploiement : {targetId}',
      noInputSources: 'Aucune source de variable disponible pour ce plan.',
      noTargetSummary: 'Target summary not provided',
      workflowIdentityTitle: 'Workflow execution identity',
      workflowMode: 'User workflow',
      workflowModePluginInternal: 'Built-in plugin workflow',
      workflowDslVersion: 'Effective DSL version: {version}',
      workflowPluginVersion: 'Effective plugin version: {version}',
      workflowPluginVersionId: 'Plugin version ID: {versionId}',
      workflowVersionId: 'Version snapshot ID: {versionId}',
      workflowVersionSelectionPinned: 'Version policy: pinned by the plan',
      workflowVersionSelectionLatest: 'Version policy: latest published from the application asset',
      workflowIdentityUnavailable: 'Workflow version information is unavailable',
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
      copy: 'Current action: {action}. Dry-run is an optional impact preview and does not block real execution.',
      description: 'Run the synchronous dry-run to inspect static checks; execution performs the required preflight again.',
      primaryAction: 'Run dry-run',
      runningAction: 'Running dry-run…',
      title: 'Optional dry-run preview'
    },
    execution: {
      applyName: 'Deployment execution {runId}',
      applyTitle: 'Certificate update execution',
      dryRunName: 'Dry-run {runId}',
      dryRunTitle: 'Dry-run result',
      fallbackName: 'Execution {runId}',
      rollbackTitle: 'Certificate rollback execution',
      startingName: 'Starting execution'
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
      dryRunTaskStarted: 'Dry-run started. Track progress from the task list in the top-right corner.',
      executeTriggered: 'Deployment execution triggered.',
      executeTriggeredWithPlanId: 'Deployment execution triggered. planId: {planId}',
      executeTriggeredWithRunId: 'Deployment execution triggered. Execution progress is shown in the modal. runId: {runId}',
      executionTaskStarted: 'Task started. Track progress from the task list in the top-right corner.',
      executionTaskSucceeded: 'Task completed successfully. View the result from the task list in the top-right corner.',
      executeTaskStarted: 'Certificate deployment started. Track progress from the task list in the top-right corner.',
      executeTaskPendingApproval: 'Certificate deployment submitted and awaiting approval. Track it from the task list in the top-right corner.',
      rollbackTaskStarted: 'Certificate rollback started. Track progress from the task list in the top-right corner.',
      loadedDraft: 'Draft plan loaded.',
      loadedDraftWithPlanId: 'Draft plan loaded. planId: {planId}',
      savedWithPlanId: 'Deployment plan saved. planId: {planId}',
      submitted: 'Deployment plan submitted.',
      submittedWithPlanId: 'Deployment plan submitted. planId: {planId}',
      approvalApproved: 'Approval approved. The plan can now be executed.',
      approvalApprovedWithPlanId: 'Approval approved. Plan {planId} can now be executed.',
      approvalRejected: 'Approval rejected. The plan cannot be executed.',
      approvalRejectedWithPlanId: 'Approval rejected. Plan {planId} cannot be executed.'
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
    app: {
      fallbackName: 'App {index}'
    },
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
    // 兼容旧版本证书卡片的翻译 key，避免已缓存 bundle 在升级后产生缺失告警。
    statusBlock: {
      tooltip: { name: 'Nom', issuer: 'Émetteur', startTime: 'Début', endTime: 'Fin', daysRemaining: 'Jours restants', connectionStatus: 'État de connexion', version: 'Version', managementAddress: 'Adresse de gestion', lastCommunicationTime: 'Dernière communication', platform: 'Plateforme', protocolPort: 'Protocole et port', certificateDaysRemaining: 'Jours de certificat restants', region: 'Région', latency: 'Latence' },
      detail: {
        certificateRemaining: '{name}, {days}'
      }
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
      commandStepTitle: 'Générer la commande',
      commandCopied: 'Install command copied',
      copyCommand: 'Copy install command',
      copyToken: 'Copy token',
      expired: 'Expired',
      generateCommand: 'Generate install command',
      generating: 'Generating...',
      compatibilityInstallUnavailable: 'Le programme d’installation à usage unique de Windows Compatibility Agent n’est pas encore publié. N’utilisez pas une commande Windows Modern Agent à la place.',
      installEntryPending: 'Programme à venir',
      linuxGeneralTitle: 'Agent Linux générique',
      linuxGroupTitle: 'Linux',
      modalDescription: 'Choose platform and version to generate a one-time install command. The token is valid for 10 minutes and can only be used once.',
      modalTitle: 'Install Agent',
      platform: 'Platform',
      platformLinuxDescription: 'For Ubuntu, Debian, CentOS, Rocky, AlmaLinux, and other Linux distributions.',
      platformWindowsDescription: 'For Windows Server and Windows 10/11. Registers as a system service after installation.',
      remainingTime: '{minutes}m {seconds}s',
      remainingValidity: 'Remaining validity',
      selectedAgent: 'Agent sélectionné',
      selectionStepTitle: 'Sélectionner le type d’Agent',
      singleUseHint: 'Once the bootstrap script requests this token, it expires immediately and cannot be reused.',
      tokenCopied: 'Token copied',
      version: 'Version',
      versionLatest: 'Latest stable',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 et versions ultérieures',
      windowsModernTitle: 'Windows Modern Agent',
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
    overview: {
      eyebrow: 'Vue des opérations'
    },
    resources: {
      title: 'Ressources système', description: 'Utilisation en temps réel du CPU et de la mémoire de l’hôte du tableau de bord.', cpu: 'Utilisation CPU', memory: 'Utilisation mémoire', host: 'Hôte', abnormal: 'Attention', usageAria: 'Utilisation de {metric} : {value} %', unavailableAria: '{metric} indisponible'
    },
    quickStart: {
      title: 'Automatisez votre prochain déploiement de certificat', description: 'Préparez, validez et déployez depuis un point d’entrée guidé.', addCertificate: 'Importer ou demander un nouveau certificat', deployExistingApplication: 'Déployer vers un site ou une application', unavailable: 'Aucune entrée disponible', safeExecution: 'Exécution sûre', guidedFlow: 'Parcours guidé'
    },
    trends: {
      title: 'Tendances d’exécution', noDelta: '--', auditSuccess: { title: 'Taux de réussite des audits', suffix: 'taux de réussite' }, managedObjects: { title: 'Santé des objets', suffix: 'objets sains' }, certificateAttention: { title: 'Certificats à surveiller', suffix: 'à examiner' }
    },
    statusPanel: { description: 'État visible actuel des certificats, Agents, passerelles et actifs applicatifs.', objects: 'objets' },
    recentLog: { title: 'Journaux récents', live: 'En direct' },
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
      title: 'Recent audit logs',
      activityTitle: 'Activité des audits'
    },
    certificateState: {
      critical: 'Near expiry',
      expired: 'Expired',
      expiring: 'Expiring soon',
      unknown: 'Unknown',
      valid: 'Normal',
      updateAvailable: 'Update available'
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
      noObjects: 'No objects',
      noTrend: 'No trend data',
      noQuickActions: 'Aucune entrée rapide disponible'
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
      attention: 'Attention',
      sparklineLabel: 'Tendance de {metric}',
      stable: 'Stable',
      tracked: 'Suivi',
      activeAgents: {
        title: 'Active Agents',
        description: 'Agents currently online and schedulable.'
      },
      activeGateways: {
        title: 'Active gateways',
        description: 'Isolation-zone gateways currently online.'
      },
      applications: {
        title: 'Current applications',
        description: 'Managed application entry assets.'
      },
      expiringCertificates: {
        title: 'Certificates expiring in 15 days',
        description: 'Certificates that need renewal or replacement.'
      },
      managedBindings: {
        title: 'Managed bindings',
        description: 'Certificate bindings already in managed status.'
      },
      validCertificates: {
        title: 'Active certificates',
        description: 'Certificate versions that are active and not expired.'
      }
    },
    health: {
      title: 'Santé du système',
      description: 'Synthèse des certificats, Agents, passerelles et actifs applicatifs.',
      healthy: 'Sain',
      attention: 'Attention',
      abnormal: 'Anormal',
      noData: 'Aucune donnée',
      score: 'objets sains',
      progressAria: 'Part des objets système sains',
      normalObjects: 'objets normaux',
      attentionObjects: 'objets à examiner'
    },
    quickWizard: {
      title: 'Guide rapide'
    },
    typeStats: {
      title: 'Répartition par type',
      description: 'Objets visibles actuellement par type.'
    },
    quickActions: {
      agents: {
        title: 'Agent',
        description: 'View online status and task capabilities.'
      },
      assets: {
        title: 'Application assets',
        description: 'Maintain domains, ports, and deployment targets.'
      },
      audits: {
        title: 'Audit logs',
        description: 'Trace operators and execution results.'
      },
      certificates: {
        title: 'Certificate management',
        description: 'Import, view, and convert certificates.'
      },
      deploymentPlans: {
        title: 'Deployment plans',
        description: 'Create and execute certificate update plans.'
      },
      gateways: {
        title: 'Gateway',
        description: 'Manage isolation-zone execution entry points.'
      }
    },
    statusBlock: {
      tooltip: { name: 'Nom', issuer: 'Émetteur', startTime: 'Début', endTime: 'Fin', daysRemaining: 'Jours restants', connectionStatus: 'État de connexion', version: 'Version', managementAddress: 'Adresse de gestion', lastCommunicationTime: 'Dernière communication', platform: 'Plateforme', protocolPort: 'Protocole et port', certificateDaysRemaining: 'Jours de certificat restants', region: 'Région', latency: 'Latence' },
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
      agents: {
        title: 'Appareils'
      },
      applicationAssets: {
        title: 'Application assets'
      },
      certificates: {
        title: 'Certificates'
      },
      gateways: {
        title: 'Gateways'
      },
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
  notifications: {
    title: 'Gestion des notifications',
    description: 'Gérez les canaux, routes, modèles, silences et historiques de livraison fiables.',
    tabs: { channels: 'Canaux', deliveries: 'Livraisons', rules: 'Règles et modèles' },
    sections: { channels: 'Canaux enregistrés', deliveries: 'Historique des livraisons' },
    channels: { createTitle: 'Créer un canal de notification' },
    settings: { privateOriginsTitle: 'Adresses de déploiement privé', privateOriginsDescription: 'Configurez les Origins HTTPS privées autorisées pour WeCom, Feishu et DingTalk.' },
    channelTypes: { email: 'Email', wecom: 'WeCom', slack: 'Slack', feishu: 'Feishu', dingtalk: 'DingTalk', telegram: 'Telegram', webhook: 'Webhook générique' },
    deploymentModes: { public: 'Cloud public', private: 'Déploiement privé' },
    fields: {
      name: 'Nom du canal', type: 'Type de canal', deploymentMode: 'Mode de déploiement', smtpHost: 'Hôte SMTP', smtpPort: 'Port SMTP', from: 'Adresse expéditeur',
      smtpSecurity: 'Sécurité de connexion', smtpUsername: 'Nom d’utilisateur SMTP', smtpPassword: 'Mot de passe SMTP', secretValuePlaceholder: 'Saisissez la valeur secrète',
      optionalSecretValuePlaceholder: 'Facultatif ; saisissez la valeur secrète', wecomWebhookUrl: 'URL Webhook du robot de groupe WeCom', slackWebhookUrl: 'URL Slack Incoming Webhook',
      feishuWebhookUrl: 'URL Webhook du robot personnalisé Feishu', dingtalkWebhookUrl: 'URL Webhook du robot personnalisé DingTalk', feishuSigningSecret: 'Secret de signature Feishu',
      dingtalkSigningSecret: 'Secret de signature DingTalk', telegramBotToken: 'Telegram Bot Token', telegramChatId: 'Telegram Chat ID', telegramMessageThreadId: 'Telegram Topic ID (facultatif)',
      webhookUrl: 'URL Webhook', webhookUrlPlaceholder: 'Saisissez l’URL Webhook complète', webhookMethod: 'Méthode HTTP', webhookHeaders: 'Headers fixes (JSON)',
      webhookHeadersPlaceholder: 'Exemple : x-source = gcac', signingSecret: 'Secret de signature HMAC-SHA256', testTarget: 'Destinataire de test',
      testTargetPlaceholder: 'Séparez les adresses Email par des virgules', lastSuccess: 'Dernier succès', latency: 'Latence (ms)',
      createdAt: 'Créé le', updatedAt: 'Mis à jour le', failureCategory: 'Catégorie d’échec', channel: 'Canal de notification', selectChannel: 'Sélectionnez un canal',
      source: 'Source de l’événement', priority: 'Priorité de route', dedupeWindow: 'Fenêtre de déduplication (secondes)', templateKey: 'Clé du modèle', locale: 'Langue',
      titleTemplate: 'Modèle de titre', bodyTemplate: 'Modèle de corps', reason: 'Motif du silence', startsAt: 'Début', endsAt: 'Fin',
      wecomPrivateOrigins: 'Origins privées WeCom', feishuPrivateOrigins: 'Origins privées Feishu', dingtalkPrivateOrigins: 'Origins privées DingTalk', privateOriginsPlaceholder: 'Une par ligne, par exemple https://notify.example.internal'
    },
    actions: {
      createChannel: 'Nouveau canal', createRoute: 'Nouvelle route', createTemplate: 'Nouveau modèle', createSilence: 'Nouveau silence',
      confirmCreate: 'Créer', cancel: 'Annuler', saveSettings: 'Enregistrer', test: 'Envoyer un test', testChannel: 'Tester le canal : {name}', retry: 'Relancer la livraison', enable: 'Activer', disable: 'Désactiver'
    },
    rules: { createRoute: 'Créer une route de notification', createTemplate: 'Créer un modèle de notification', createSilence: 'Créer une règle de silence' },
    summary: { routes: 'Routes de notification', templates: 'Modèles de notification', silences: 'Règles de silence', recordCount: '{count} enregistrements' },
    empty: { channels: 'Aucun canal de notification', deliveries: 'Aucun historique de livraison', routes: 'Aucune route de notification', templates: 'Aucun modèle de notification', silences: 'Aucune règle de silence' },
    values: { notAvailable: '—' },
    secrets: { name: '{channel} - {field}', fields: { smtpUsername: 'Nom d’utilisateur SMTP', smtpPassword: 'Mot de passe SMTP', webhookUrl: 'URL Webhook', signingSecret: 'Secret de signature', botToken: 'Bot Token' } },
    messages: {
      loadFailed: 'Échec du chargement des données de gestion des notifications', operationFailed: 'Échec de l’opération de gestion des notifications', testUsesChannelTarget: 'Ce canal enverra la notification de test à sa destination configurée.',
      secretStoredHint: 'Cette valeur est chiffrée et ne sera plus affichée après la création.', createSecretFailed: 'Échec de l’enregistrement de la valeur chiffrée', invalidHeaders: 'Les Headers fixes doivent former un objet JSON valide',
      smtpCredentialsPairRequired: 'Le nom d’utilisateur et le mot de passe SMTP doivent être fournis ensemble', webhookUrlRequired: 'L’URL Webhook est obligatoire', botTokenRequired: 'Le Telegram Bot Token est obligatoire',
      chatIdRequired: 'Le Telegram Chat ID est obligatoire', feishuWebhookUrlInvalid: 'Saisissez une URL Webhook officielle de robot personnalisé Feishu', dingtalkWebhookUrlInvalid: 'Saisissez une URL Webhook officielle de robot personnalisé DingTalk',
      wecomWebhookUrlInvalid: 'Saisissez une URL Webhook HTTPS valide de robot WeCom', telegramBotTokenInvalid: 'Le format du Telegram Bot Token est invalide', telegramMessageThreadIdInvalid: 'Le Telegram Topic ID doit être un entier positif',
      privateDeploymentAllowlistHint: 'Les adresses privées doivent d’abord être ajoutées à la liste des Origins HTTPS approuvées ci-dessus.', privateOriginInvalid: 'Une adresse privée doit être une Origin HTTPS exacte, sans chemin, requête, informations utilisateur ni fragment.', privateOriginsSecurityHint: 'Saisissez uniquement le schéma, l’hôte et le port facultatif. Les URL Webhook complètes, tokens et secrets de signature restent chiffrés dans le service Secret.', telegramUsesBotApi: 'Les notifications Telegram utilisent la méthode sendMessage de la Bot API officielle, et non le Webhook de réception des événements.'
    }
  },
  settings: {
    ...(licensingLocaleMessages['fr-FR'] ?? {}),
    securityLabel: 'Entrée des paramètres système',
    deploymentTasks: {
      eyebrow: 'Tâches de déploiement',
      title: 'Paramètres des tâches de déploiement',
      description: 'Contrôlez pour ce tenant le Dry-run avant déploiement et l’approbation des déploiements à haut risque.',
      readonly: 'Ce compte dispose d’un accès en lecture seule.',
      fields: {
        dryRun: { title: 'Activer le Dry-run', description: 'Exécuter un contrôle en lecture seule avant le déploiement ; les résultats sont indicatifs et ne bloquent pas l’exécution.', aria: 'Activer le Dry-run des déploiements de certificats' },
        approval: { title: 'Activer le circuit d’approbation', description: 'Soumettre les déploiements de certificats à haut risque à approbation avant exécution.', aria: 'Activer le circuit d’approbation des déploiements de certificats' }
      },
      actions: { save: 'Enregistrer', saving: 'Enregistrement...' },
      messages: { saved: 'Les paramètres des tâches de déploiement sont enregistrés.' },
      errors: { loadFailed: 'Impossible de charger les paramètres des tâches de déploiement.', saveFailed: 'Impossible d’enregistrer les paramètres des tâches de déploiement.' }
    },
    version: {
      title: 'Informations de version',
      description: 'Afficher la version de GCAC actuellement exécutée.',
      currentVersion: 'Version actuelle',
      product: 'Produit'
    },
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
        externalGroupPlaceholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com',
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
      page: {
        title: 'Role permissions',
        description: 'Manage authorization object scopes by role, and assign users or groups to roles.'
      },
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
        businessLevel: 'Business permission level',
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
        application: 'Application',
        gateway: 'Gateway',
        agent: 'Agent',
        serviceAsset: 'Application asset',
        deploymentPlan: 'Deployment plan',
        workflow: 'Workflow',
        auditLog: 'Log',
        systemSetting: 'System setting'
      },
      accessLevel: {
        read: 'Read only',
        edit: 'Edit',
        control: 'Full control'
      },
      levels: {
        user: 'User',
        manager: 'Manager'
      },
      effect: {
        allow: 'Allow',
        deny: 'Deny'
      },
      principal: {
        user: 'User',
        group: 'Group',
        externalGroup: 'Identity source group'
      },
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
        kind: {
          all: 'All',
          category: 'Category',
          record: 'Record'
        }
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
        invalidBusinessScope: 'The corresponding business permission scope was not found.',
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
        auth: {
          name: 'Authentication login logs',
          description: 'Login, logout, and external identity source login'
        },
        security: {
          name: 'Security management logs',
          description: 'User, role, permission, and identity source changes'
        },
        certificate: {
          name: 'Certificate logs',
          description: 'Certificate import, version, format, and binding operations'
        },
        asset: {
          name: 'Asset logs',
          description: 'Application asset, host, service instance, and site asset operations'
        },
        gateway: {
          name: 'Gateway logs',
          description: 'Gateway route, probe, and status changes'
        },
        agent: {
          name: 'Agent logs',
          description: 'Agent registration, heartbeat, task, and upgrade operations'
        },
        deployment: {
          name: 'Deployment plan logs',
          description: 'Deployment plans, execution, rollback, and approval'
        },
        workflow: {
          name: 'Workflow logs',
          description: 'Workflow template and execution operations'
        },
        secret: {
          name: 'Secret logs',
          description: 'Secret creation, use, and rotation'
        },
        system: {
          name: 'System logs',
          description: 'System settings and platform-level events'
        }
      }
    },
    identitySources: {
      actions: {
        create: 'Create identity source',
        edit: 'Edit',
        delete: 'Delete',
        testConnection: 'Tester la connectivité',
        testing: 'Test en cours...',
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
        baseDn: 'Base DN',
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
        domain: 'For example: example.com',
        serverAddress: 'For example: ad.example.com:636',
        baseDn: 'For example: DC=example,DC=com',
        bindDn: 'For example: CN=svc-gcac,OU=Users,DC=example,DC=com',
        bindPasswordCreate: 'Enter the service account password',
        bindPasswordEdit: 'Leave empty to keep the existing password',
        autoByDirectoryType: 'Leave empty to derive from directory type',
        userFilter: "For example: (uid={'{'}{'{'}username{'}'}{'}'})",
        groupFilter: "For example: (member={'{'}{'{'}userDn{'}'}{'}'})"
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
        activeDirectory: 'Active Directory',
        ldap: 'Standard LDAP'
      },
      protocols: {
        ldap: 'LDAP',
        ldaps: 'LDAPS'
      },
      risks: {
        delete: 'Deleting the identity source invalidates login, sync, and group mappings for this directory.'
      },
      test: {
        dialogTitle: 'Tester la connectivité de la source d’identité',
        dialogDescription: 'Vérification du DNS, du port d’authentification LDAP et de l’état BIND pour {name} ({server}).',
        loading: 'Vérification séquentielle du DNS, du port d’authentification LDAP et de l’état BIND...',
        checks: {
          dns: { title: 'Vérifier la résolution DNS' },
          port: { title: 'Vérifier le port d’authentification LDAP' },
          bind: { title: 'Vérifier LDAP BIND' }
        },
        status: {
          passed: 'Réussi',
          failed: 'Échec',
          skipped: 'Ignoré'
        },
        messages: {
          summaryPassed: 'Tous les contrôles de connectivité LDAP ont réussi',
          summaryFailed: 'Les contrôles de connectivité LDAP ont échoué',
          dnsIp: 'La cible est une adresse IP ; la résolution DNS était inutile',
          dnsResolved: 'Résolution DNS réussie : {addresses}',
          dnsFailed: 'Échec de la résolution DNS',
          portReachable: 'Le port d’authentification {protocol} {port} est accessible',
          portFailed: 'Le port d’authentification LDAP est inaccessible',
          bindServicePassed: 'Le BIND du compte de service LDAP et la requête Base DN ont réussi',
          bindAnonymousPassed: 'Le BIND LDAP anonyme et la requête Base DN ont réussi',
          bindFailed: 'Le BIND LDAP ou la requête Base DN a échoué',
          skippedInvalidUrl: 'Ignoré car l’adresse LDAP est invalide',
          skippedDnsFailed: 'Ignoré car la résolution DNS a échoué',
          skippedPortFailed: 'Ignoré car le port d’authentification LDAP est inaccessible',
          unknownCheck: 'Le contrôle a échoué ({code})',
          checkNotReturned: 'Le serveur n’a pas renvoyé le résultat de ce contrôle.'
        },
        errors: {
          emptyResult: 'Le serveur n’a pas renvoyé de résultat de test de connectivité',
          requestFailed: 'La demande de test de connectivité a échoué'
        }
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
    actions: {
      create: 'New config file',
      toggleFilters: 'Filtrer',
      edit: 'Edit',
      delete: 'Delete',
      deleting: 'Deleting...',
      applyTemplate: 'Apply built-in template',
      saving: 'Saving...',
      confirmSave: 'Save'
    },
    columns: {
      configName: 'Config name',
      targetSummary: 'Target environment',
      displayFormat: 'Content format',
      extension: 'Extension',
      encodingSummary: 'Encoding',
      exportSummary: 'Contents / export options',
      actions: 'Actions'
    },
    dialog: {
      createTitle: 'Create certificate format config',
      editTitle: 'Edit certificate format config',
      description: 'Select the system and target platform, apply a built-in template, then adjust each option and define what the single artifact contains.'
    },
    list: {
      title: 'Certificate format config list',
      descriptionWithCount: 'Reusable certificate format templates are saved here. {count} currently.'
    },
    empty: {
      text: 'No certificate format configs'
    },
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
    formats: {
      pfx: 'PKCS#12 / PFX container',
      jks: 'JKS container',
      pemBundle: 'PEM single-file bundle',
      pemCert: 'PEM certificate file',
      pemKey: 'Private key file',
      cer: 'Certificate file (.cer)',
      crt: 'Certificate file (.crt)',
      p7b: 'PKCS#7 / P7B certificate chain',
      custom: 'Custom'
    },
    sections: {
      templates: {
        title: 'Built-in templates',
        description: 'Templates prefill format, contents, and export rules based on common TLS deployment patterns and can still be edited.'
      },
      basic: {
        title: 'Basic information',
        description: 'Define the config identity, real content format, and final extension.'
      },
      encoding: {
        title: 'Encoding',
        description: 'Only encoding options valid for the current content format are shown.'
      },
      content: {
        title: 'Contents',
        description: 'Defines what the main artifact contains: public certificate, certificate chain, and private key.'
      },
      export: {
        title: 'Export options',
        description: 'Define whether to generate extra chain/private-key files and container password options.'
      }
    },
    filters: {
      keywordPlaceholder: 'Config name / target environment / Alias / content format'
    },
    placeholders: {
      configName: 'For example: device-compatible single-file PEM',
      exportPassword: 'Enter the PFX/JKS export password'
    },
    validation: {
      selectPlatformsFirst: 'Select the system platform and target platform first.',
      configNameRequired: 'Config name is required',
      passwordRequired: 'PFX/JKS configs require an export password'
    },
    errors: {
      loadFailed: 'Failed to load certificate format configs',
      saveFailed: 'Failed to save certificate format config',
      deleteFailed: 'Failed to delete certificate format config',
      createExportSecretFailed: 'Failed to create export password Secret',
      withCode: '{message} ({code})'
    },
    fallbacks: {
      unnamedConfig: 'Unnamed config-{index}',
      unspecified: 'Unspecified',
      aliasUnset: 'Alias not set'
    },
    labels: {
      aliasWithValue: 'Alias: {alias}',
      requestId: 'Request ID: {requestId}'
    },
    encoding: {
      pkcs12Container: 'PKCS#12 container',
      jksContainer: 'JKS container',
      privateKeyWithEncoding: 'Private key {encoding}',
      pkcs7Chain: 'PKCS#7 certificate chain',
      certificateWithEncoding: 'Certificate {encoding}',
      default: 'Default'
    },
    export: {
      leafCertificate: 'Public certificate',
      certificateChain: 'Certificate chain',
      privateKey: 'Private key',
      extraChainFile: 'Extra chain file',
      extraPrivateKeyFile: 'Extra private key file'
    },
    secret: {
      defaultConfigName: 'Certificate format config',
      exportPasswordName: '{name} export password'
    },
    select: {
      placeholder: 'Select'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: 'An export password is already configured. Enter a new password to replace it.'
    },
    templates: {
      windowsIis: {
        configName: 'Windows-IIS-PKCS12 standard template',
        description: 'IIS most commonly uses PKCS#12/PFX containers. The main artifact directly carries the server certificate, certificate chain, and private key.'
      },
      windowsNginx: {
        configName: 'Windows-NGINX-PEM standard template',
        description: 'NGINX commonly uses a PEM single file for the server certificate and chain, plus a separate private key file.'
      },
      windowsApache: {
        configName: 'Windows-Apache-PEM standard template',
        description: 'Apache is usually delivered as a PEM certificate file plus a separate private key, with an extra chain file for operational compatibility.'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12 standard template',
        description: 'Tomcat mainly uses JKS/PKCS#12 keystores. This template defaults to the more portable PKCS#12 format.'
      },
      windowsOther: {
        configName: 'Windows device-compatible single-file PEM template',
        description: 'For devices that require a single file containing the public certificate, certificate chain, and private key. The extension can be adjusted to .crt/.cer.'
      },
      linuxIis: {
        configName: 'Linux-IIS compatibility template',
        description: 'If the final target is still IIS, PKCS#12/PFX remains the most reasonable delivery artifact.'
      },
      linuxNginx: {
        configName: 'Linux-NGINX-PEM standard template',
        description: 'Official NGINX configuration revolves around a PEM single-file certificate chain and a separate private key.'
      },
      linuxApache: {
        configName: 'Linux-Apache-PEM standard template',
        description: 'Apache commonly uses a PEM certificate file plus a separate private key, with an extra chain file for split deployment.'
      },
      linuxTomcat: {
        configName: 'Linux-Tomcat-PKCS12 standard template',
        description: 'Tomcat defaults to keystore delivery. This template uses the more portable PKCS#12 format.'
      },
      linuxOther: {
        configName: 'Linux device-compatible single-file PEM template',
        description: 'For generic Linux devices that accept a single PEM file, start with a bundle and adjust extension and contents for the target device.'
      }
    }
  },
  deploymentInputs: {
    title: 'Entrées de déploiement',
    description: "Configurez les valeurs de déploiement selon le contrat d'entrée unifié déclaré par le plugin ou le workflow.",
    saveAssetFirst: "Enregistrez l'actif applicatif et la source d'exécution avant de modifier les entrées projetées par le backend.",
    contractVersion: 'Contrat {version}',
    groups: { required: 'Configuration obligatoire', advanced: 'Configuration avancée', readonly: "Valeurs en lecture seule et d'exécution" },
    actions: { expand: 'Développer la configuration avancée', collapse: 'Réduire la configuration avancée' },
    placeholders: { select: 'Sélectionner', credential: 'Sélectionner un identifiant', artifact: "Sélectionner un format d'artefact", output: 'Sélectionner une sortie' },
    artifacts: { format: "Format d'artefact" },
    allowInsecureTls: {
      label: 'Autoriser l’ignorance de la vérification TLS',
      description: 'Autorise explicitement ce déploiement à ignorer la vérification du certificat TLS lorsque l’appareil utilise un certificat autosigné ou non approuvé.',
      help: 'Cela enregistre uniquement l’intention de déploiement et n’accorde pas le droit d’exécution. Une approbation et une autorisation d’exécution émise par l’hôte restent nécessaires.'
    },
    runtimeValue: "Fourni par {source} lors de l'exécution",
    source: 'Source : {source}',
    sourceKinds: { asset: 'Actif', binding: 'Liaison', default: 'Valeur par défaut', derived: 'Valeur dérivée', system: 'Valeur système', step_output: 'Sortie de l’étape', unknown: 'Source inconnue' },
    issues: {
      title: "Problèmes d'entrée",
      unknown: 'Échec de validation de l’entrée de déploiement ({code})',
      DEPLOYMENT_INPUT_REQUIRED: 'Une entrée de déploiement obligatoire est manquante',
      DEPLOYMENT_CONNECTION_REQUIRED: 'Un paramètre de connexion obligatoire est manquant',
      DEPLOYMENT_CREDENTIAL_REQUIRED: 'Un identifiant obligatoire est manquant',
      DEPLOYMENT_ARTIFACT_REQUIRED: 'Un artefact de déploiement obligatoire est manquant',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: 'Cette entrée de déploiement ne peut pas être remplacée',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: 'Le slot d’entrée de déploiement n’est pas déclaré',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: 'Le champ d’entrée de déploiement n’est pas déclaré',
      DEPLOYMENT_INPUT_TYPE_INVALID: 'Le type de l’entrée de déploiement est incorrect',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: 'Une entrée de déploiement fixe ne peut pas être remplacée',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: 'L’instantané de l’identifiant est manquant',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: 'L’instantané de l’identifiant ne correspond pas à la sélection actuelle',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: 'Le type d’identifiant n’est pas pris en charge',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: 'L’instantané de l’artefact est manquant',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: 'Une sortie d’artefact obligatoire est manquante'
    }
  },
  assets: {
    presentation: {
      cards: 'Vue cartes',
      list: 'Vue tableau',
    },
    selection: {
      selectedCount: '{count} / {total} actifs sélectionnés',
      actions: {
        bulkDelete: 'Suppression groupée',
        bulkUpdateCertificate: 'Mettre à jour les certificats'
      },
      bulkDeleteRisk: 'Les actifs sélectionnés et leurs associations de cibles manuelles seront supprimés. Les frameworks, sites et cibles gérées découverts sont conservés.',
      bulkDeleteSuccess: '{count} actifs ont été supprimés.',
      bulkDeletePartialSuccess: '{succeeded} actifs ont été supprimés ; {failed} échecs.',
      bulkUpdateDescription: 'Choisissez et envoyez une nouvelle version du certificat pour {count} actifs liés au même domaine de certificat « {domain} ».',
      bulkUpdateFailed: 'La mise à jour a échoué ; aucun des {count} actifs n’a été envoyé.',
      bulkUpdateSuccess: 'Mise à jour du certificat envoyée pour {count} actifs.',
      bulkUpdatePartialSuccess: 'Mise à jour envoyée pour {succeeded} actifs ; {failed} échecs.'
    },
    aria: {
      selectCard: 'Sélectionner l’actif {name}',
      detailCard: 'Afficher les détails de l’actif {name}',
      editCard: 'Modifier l’actif {name}',
      deleteCard: 'Supprimer l’actif {name}'
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
    title: 'Application assets',
    description: 'Manage application entry points by domain or IP, focusing on address, port, protocol, site, and execution targeting.',
    resourceName: 'Application asset',
    executionModes: {
      label: 'Mode d’exécution',
      plugin: { title: 'Exécution par plugin', description: 'Utiliser la capacité de déploiement de certificat activée pour la cible gérée.' },
      workflowOverride: { title: 'Remplacement par workflow', description: 'Contourner le plugin et utiliser un workflow appartenant à l’utilisateur.', notice: 'Ce mode désactive l’affectation du plugin pour cet actif et conserve uniquement la liaison du workflow.' }
    },
    actions: {
      add: 'Add asset',
      edit: 'Edit',
      detail: 'Details',
      addVariable: 'Add variable',
      delete: 'Delete',
      deleteRisk: 'Deleting removes this application asset and its manual target association from the asset list. Discovered frameworks, sites, virtual servers, and managed targets are preserved.',
      rollbackFromLatestSnapshot: 'Rollback from latest snapshot',
      rollingBack: 'Rolling back...',
      deployCertificate: 'Déployer le certificat',
      latestCertificate: 'Certificat à jour',
      updateCertificate: 'Mettre à jour le certificat',
      saving: 'Saving...',
      creating: 'Creating...',
      saveChanges: 'Save changes',
      confirmCreate: 'Create'
    },
    columns: {
      domain: 'Domain',
      port: 'Port',
      protocol: 'Protocol',
      platform: 'Platform',
      framework: 'Framework',
      site: 'Site',
      status: 'Status',
      actions: 'Actions'
    },
    fields: {
      assetId: 'Application asset ID',
      domain: 'Domain',
      addressType: 'Address type',
      port: 'Port',
      protocol: 'Protocol',
      verifyUrl: 'Verify URL',
      platform: 'Platform',
      frameworkType: 'Framework type',
      deploymentStrategyCompatibility: 'Mode de compatibilité du déploiement',
      selectWorkflow: 'Sélectionner un workflow',
      workflowVersionSelection: 'Politique de version du workflow',
      serviceInstanceId: 'Service instance ID',
      siteId: 'Site ID',
      managedTargetId: 'Managed target ID',
      bindingKey: 'Binding key',
      hostId: 'Host ID',
      environment: 'Environment',
      discoverySource: 'Discovery source',
      lastDiscoveredAt: 'Last discovered at',
      tags: 'Tags',
      managedTarget: 'Managed target',
      siteName: 'Site name',
      bindingInformation: 'Binding information',
      hostHeader: 'Host Header',
      sniName: 'SNI name',
      currentCertificate: 'Current certificate',
      remainingValidity: 'Validité restante',
      targetCertificate: 'Target certificate',
      expectedFingerprint: 'Expected fingerprint',
      certificateStore: 'Certificate store',
      snapshotType: 'Snapshot type',
      time: 'Time',
      executionRun: 'Execution run',
      displayName: 'Display name',
      siteInstance: 'Site instance',
      certificateFormat: 'Certificate artifact format',
      workflow: 'Workflow',
      publishedVersion: 'Published version',
      runner: 'Runner',
      artifactFormat: 'Format de l’artéfact',
      updatePlugin: 'Plugin de mise à jour du certificat'
    },
    capability: { source: 'Source de la capacité', plugin: 'Version du plugin', runtime: 'Runtime', executionLocation: "Emplacement d’exécution", pendingAssignment: "L’enregistrement créera une affectation de capacité de déploiement au niveau de l’actif applicatif." },
    links: {
      certificateBindings: 'View certificate bindings',
      executions: 'View execution records'
    },
    empty: {
      title: 'No application assets',
      description: 'Waiting for discovery to write ServiceAsset records, or add entry points through backend APIs.',
      noBindingInformation: 'No binding information',
      notSet: 'Not set',
      notSelected: 'Not selected',
      noVariablePreset: 'No variables can be added',
      basicEntryIncomplete: 'Basic entry incomplete'
    },
    detail: {
      title: 'Application details',
      description: 'Keep asset details, bindings, deployment entry, and snapshots in one modal.',
      tabsAriaLabel: 'Application detail tabs',
      tabs: {
        overview: 'Overview',
        snapshots: 'Snapshots'
      },
      loadingTargetBinding: 'Loading target binding details...',
      loadingSnapshots: 'Loading snapshots...',
      emptyCertificateBindings: 'No certificate bindings.',
      emptySnapshots: 'No snapshots.',
      rollbackSubmitted: 'Rollback request submitted. Check executions for the rollback run.',
      sections: {
        overview: {
          title: 'Overview',
          description: 'The application asset is the primary object. Hosts and sites only provide execution targeting information.'
        },
        targetBinding: {
          title: 'Target binding',
          description: 'Bindings must point to a site and managed target instead of guessing by domain.'
        },
        certificateBindings: {
          title: 'Certificate bindings',
          description: 'Certificate relationships are tied to bindings instead of only relying on domains.'
        },
        snapshots: {
          title: 'Snapshots',
          description: 'Pre-deploy, post-deploy, and rollback state must be visible directly, not only as task records.'
        }
      }
    },
    deployment: {
      title: 'Déploiement du certificat',
      description: 'Choisissez une version de certificat pour cet actif applicatif. Le système crée un instantané, lance la pré-vérification, demande l’approbation puis exécute si elle est autorisée.',
      dialogTitle: 'Déploiement du certificat',
      dialogDescription: 'Cette action concerne uniquement l’actif applicatif actuel. Le plan reste la limite de snapshot, d’approbation et d’exécution côté serveur.',
      targetLocked: 'Cible de mise à jour verrouillée',
      latestVersionPointer: 'Appliquer automatiquement la dernière version du certificat actuel',
      deployThisVersion: 'Déployer cette version du certificat',
      loadingRecords: 'Chargement des enregistrements de déploiement...',
      emptyRecords: 'Aucun enregistrement de déploiement pour cet actif applicatif.',
      preflightAvailable: '{count} contrôles de pré-vérification reçus',
      preflightUnavailable: 'Aucune pré-vérification exécutée',
      rollbackUnavailable: 'Aucun retour arrière demandé',
      fields: { status: 'État du déploiement', approval: 'Approbation', latestRun: 'Dernière exécution', preflight: 'Pré-vérification', rollback: 'Retour arrière', updatedAt: 'Mis à jour' },
      feedback: { preflightRunning: 'Attente de la fin de la pré-vérification.', pendingApproval: 'Pré-vérification terminée ; le déploiement attend une approbation.', executionStarted: 'Pré-vérification et approbation terminées ; l’exécution a démarré.' },
      errors: { missingApplicationAssetId: 'L’identifiant de l’actif applicatif est requis.', loadOptionsFailed: 'Impossible de charger les versions déployables.', createPlanMissingId: 'Le snapshot créé ne contient aucun identifiant de plan.', deployFailed: 'Échec du déploiement du certificat.', preflightFailed: 'La pré-vérification du déploiement a échoué.', preflightTimeout: 'La pré-vérification du déploiement a expiré.', loadRecordsFailed: 'Impossible de charger les enregistrements de déploiement.' }
    },
    compatibilityModes: {
      unified: 'Liaison de plug-in unifiée',
      legacy: 'Compatibilité historique',
      legacyAdapted: 'Double lecture unifiée et historique'
    },
    managementModes: {
      agent: 'Agent mode',
      agentDescription: 'Bind Agent, site instance, and managed target',
      workflow: 'Workflow mode',
      workflowDescription: 'Select workflow version and runtime variables'
    },
    loading: {
      agents: 'Loading Agents...',
      sites: 'Loading sites...',
      managedTargets: 'Loading targets...',
      certificateFormats: 'Loading format configs...',
      workflows: 'Loading workflows...',
      versions: 'Loading versions...',
      gateways: 'Loading Gateways...',
      credentials: 'Loading credentials...'
    },
    select: {
      agent: 'Select Agent',
      siteInstance: 'Select site instance',
      managedTarget: 'Select managed target',
      certificateFormat: 'Select certificate artifact format',
      workflow: 'Select workflow',
      publishedVersion: 'Select published version',
      gateway: 'Select Gateway',
      variablePreset: 'Select preset variable',
      credential: 'Select credential',
      generic: 'Select',
      artifactFormat: 'Select format config',
      output: 'Select output',
      optionalOutput: 'Facultatif',
      updatePluginOptional: 'Facultatif ; conserver le plugin actuellement actif'
    },
    validation: {
      variableNameRequired: 'Variable name is required',
      variableNameInvalid: 'Variable {name} has an invalid name',
      variableDuplicated: 'Variable {name} is duplicated',
      variableRequired: 'Variable {name} is required',
      variableMustBeNumber: 'Variable {name} must be a number',
      variableMustBeJsonObject: 'Variable {name} must be a JSON object',
      variableInvalidJson: 'Variable {name} is not valid JSON',
      variableCredentialInvalid: 'Variable {name} must select a valid credential',
      certificateFormatRequired: 'Certificate variable {name} must select a certificate format config',
      certificateOutputRequired: 'Certificate variable {name}.{slot} must select an output',
      certificateOutputMissing: 'Selected output for certificate variable {name}.{slot} does not exist'
    },
    workflowVariableTypes: {
      string: 'String',
      number: 'Number',
      boolean: 'Boolean',
      enum: 'Enum',
      object: 'Object',
      file: 'File',
      credential: 'Credential',
      certificate: 'Certificate'
    },
    wizard: {
      ariaLabel: 'Application asset creation steps',
      steps: {
        basicEntry: 'Basic entry',
        deploymentMode: 'Deployment mode',
        confirmSave: 'Confirm and save'
      },
      stepState: {
        active: 'In progress',
        done: 'Completed',
        pending: 'Not started',
        incomplete: 'Incomplete',
        readyNext: 'Ready for next step',
        pendingSubmit: 'Ready to submit'
      },
      panels: {
        basicEntryTitle: 'Basic entry',
        basicEntryDescription: 'Fill in domain, port, protocol, and platform first to define the application entry identity.',
        agentTitle: 'Agent target binding',
        agentDescription: 'Select Agent, site instance, managed target, and certificate artifact format.',
        workflowTitle: 'Workflow runtime config',
        workflowDescription: 'Select workflow version, runner, and variables. Certificate variables are injected at runtime.',
        confirmTitle: 'Confirm and save',
        confirmDescription: 'Review application entry, deployment mode, and runtime parameters before saving the asset.'
      }
    },
    form: {
      createTitle: 'Add application asset manually',
      editTitle: 'Edit application asset',
      createDescription: 'Create an application entry and bind target information required for later deployment.',
      editDescription: 'Update the application entry and deployment target binding.',
      createRequestCompleted: 'Create request completed.',
      editRequestCompleted: 'Save request completed.',
      agentCertificateFormatHint: 'Agent mode uses this certificate artifact format to generate deployment materials.',
      placeholders: {
        displayName: 'For example: production site entry',
        verifyUrl: 'For example: https://example.com/health',
        siteName: 'For example: production site',
        bindingInformation: 'For example: *:443:example.com',
        hostHeader: 'For example: example.com',
        sniName: 'For example: example.com'
      }
    },
    review: {
      accessEntry: 'Access entry',
      deploymentMode: 'Deployment mode',
      agentSiteTarget: 'Agent / site / target',
      workflowVersion: 'Workflow version',
      gatewayRunner: 'Gateway: {gateway}',
      variableCount: '{count} variables',
      onlyBasicEntry: 'Basic entry only',
      autoGeneratedByEntry: 'Generated from application entry'
    },
    workflowTarget: {
      title: 'Workflow target information',
      description: 'Used for workflow asset display, post-deploy probing, and DSL target variable synchronization.',
      dslSyncHint: 'Synchronisé avec les variables de cible DSL',
      advancedTitle: 'Paramètres avancés',
      advancedDescription: 'À modifier uniquement pour remplacer l’écoute, le domaine de requête ou le nom du certificat TLS par défaut.',
      expandAdvanced: 'Afficher les paramètres avancés',
      collapseAdvanced: 'Masquer les paramètres avancés',
      bindingInformationLabel: 'Règle d’écoute du service',
      bindingInformationHelp: 'Décrit la combinaison adresse, port et domaine utilisée par le service.',
      hostHeaderLabel: 'Domaine de la requête',
      hostHeaderHelp: 'À modifier uniquement si le service exige un en-tête HTTP Host spécifique.',
      sniNameLabel: 'Domaine du certificat TLS',
      sniNameHelp: 'À modifier uniquement si le nom TLS diffère du domaine d’accès.'
    },
    workflowVersionSelection: {
      pinned: 'Figer la version actuelle',
      latestPublished: 'Toujours utiliser la dernière version publiée'
    },
    workflowVariables: {
      title: 'Workflow variables',
      configuredCount: '{configured}/{total} configured',
      name: 'Variable name',
      type: 'Type',
      value: 'Value',
      manual: 'Manual',
      empty: 'No workflow variables.',
      noPublishedVersion: 'Select a published workflow version before configuring variables.',
      certificateAutoInjected: 'The certificate version is selected by the deployment plan and injected automatically at runtime.',
      certificateDescription: 'The certificate version is selected by the deployment plan. Bind format config and outputs below; {name}.outputs.*.content is injected at runtime.',
      presets: {
        deviceHost: 'Target host or device address',
        sshUsername: 'SSH user name',
        credential: 'Workflow credential',
        certificate: 'Certificate artifact',
        targetPlatform: 'Target platform',
        apacheServiceName: 'Apache systemd service name',
        apacheSiteConfigPath: 'Apache site config path',
        certificateFilePath: 'Certificate destination path',
        certificateKeyFilePath: 'Private key destination path',
        backupRoot: 'Certificate backup root',
        expectedResponseContains: 'Expected response contains text',
        virtualHostServerName: 'VirtualHost ServerName'
      }
    },
    certificateBindings: {
      title: 'Certificate variable bindings',
      description: 'Select certificate artifact format and outputs for certificate variables in the workflow.',
      variableCount: '{count} certificate variables',
      defaultVariableDescription: 'Certificate artifact variable',
      noArtifactOutputs: 'No selectable outputs for the current format config.'
    },
    certificateOutputs: {
      publicCertificateWithChain: 'Public certificate + certificate chain',
      publicCertificate: 'Public certificate',
      certificateChain: 'Certificate chain',
      privateKey: 'Private key',
      pemBundle: 'PEM bundle artifact',
      container: '{format} container',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (saved config, not returned by current list)',
      withPrivateKey: 'With private key',
      withoutPrivateKey: 'Without private key'
    },
    snapshotTypes: {
      preDeploy: 'Pre-deploy',
      postDeploy: 'Post-deploy',
      postRollback: 'Post-rollback',
      errorState: 'Error state',
      rollbackPoint: 'Rollback point'
    },
    errors: {
      loadWorkflowListFailed: 'Failed to load workflow list',
      loadWorkflowVersionsFailed: 'Failed to load workflow versions',
      loadGatewayListFailed: 'Failed to load gateway list',
      loadCertificateFormatsFailed: 'Failed to load certificate format configs',
      loadAssetDetailFailed: 'Failed to load application asset details',
      rollbackFailed: 'Failed to start rollback',
      loadTargetsFailed: 'Failed to load sites and managed targets',
      createAssetFailed: 'Échec de la création de l’actif applicatif',
      pluginFormLoadFailed: 'Échec du chargement du formulaire de configuration du plugin',
      pluginBindingCreateFailed: 'Échec de l’enregistrement de la liaison du plugin',
      loadWorkflowCredentialsFailed: 'Failed to load workflow credentials',
      loadCredentialProfilesFailed: 'Échec du chargement des profils d’identifiants',
      noAvailableSiteInstance: 'Aucune instance de site disponible. Vérifiez que la découverte du périphérique a remonté les frameworks et les sites.',
      managedTargetRediscoveryRequired: 'Ce site ne contient aucune cible gérée. Relancez la découverte du périphérique.',
      noCompatibleManagedPlugin: 'Aucun plugin activé n’est compatible avec cette cible gérée.',
      capabilityAssignmentMissing: 'Cette cible ne possède aucune affectation de capacité de déploiement effective.'
    },
    platforms: {
      appliance: 'Appliance',
      linux: 'Linux',
      windows: 'Windows'
    },
    runners: {
      controlPlane: 'Control plane',
      gateway: 'Gateway'
    },
    status: {
      archived: 'Archived',
      unknownStatus: 'Unknown status'
    },
    common: {
      required: 'Required',
      optional: 'Optional'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'Request failed'
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
        title: 'Gestion des certificats et des applications',
        subtitle: 'Gérez les certificats et voyez quelles applications les utilisent',
        sections: {
          certificates: {
            title: 'Gestion des certificats',
            help: 'Consultez et gérez tous les certificats, leur expiration et leur état.'
          },
          applications: {
            title: 'Applications associées',
            help: 'Voyez où les certificats sont utilisés et à quelle fréquence ils sont mis à jour.'
          }
        },
        stats: {
          total: 'Certificats',
          expiring: 'Bientôt expirés',
          expired: 'Expirés'
        },
        versionCount: '{count} versions',
        versionCountShort: '{count}',
        sourceLabels: {
          manual: 'Manuel',
          acme: 'ACME',
          unknown: 'Inconnu'
        },
        fields: {
          expires: 'Expire le',
          source: 'Source'
        },
        empty: {
          title: 'Aucun certificat',
          description: 'Importez votre premier certificat pour commencer la gestion.'
        },
        applications: {
          description: 'Voyez quelles applications utilisent le certificat sélectionné et configurez les mises à jour automatiques.',
          selectPrompt: 'Sélectionnez d’abord un certificat à gauche',
          selectedCertificate: 'Certificat sélectionné',
          connectedApps: 'Applications associées ({count})',
          noApps: 'Aucune application n’est encore associée à ce certificat.',
          addApp: 'Ajouter une application',
          automationTitle: 'Configuration des mises à jour automatiques',
          activeAutomations: 'Mises à jour automatiques actives',
          totalAutomations: 'Plans de mise à jour au total',
          automationDescription: 'Les plans de mise à jour vérifient régulièrement l’état des certificats et déploient les mises à jour vers les applications associées si nécessaire.'
        }
      }
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
        trustRootCertificate: 'Target root certificate',
        trustRootStatus: 'Root certificate status',
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
      diagnostics: {
        rootResolvedFromLibrary: 'The imported material does not include the root certificate: {root}. The project root store has already resolved it and can complete the full chain during deployment.'
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
      addTitle: 'Ajouter un certificat',
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
      source: {
        title: 'Choisir le mode d’ajout du certificat',
        description: 'Importez un certificat existant ou utilisez l’émission automatique ACME lorsqu’elle est disponible.',
        manual: {
          title: 'Importer un certificat existant',
          description: 'Téléversez un fichier de certificat PEM, CRT ou PFX et sa clé privée.',
          recommended: 'Recommandé'
        },
        acme: {
          title: 'Demander un certificat via ACME',
          description: 'Demandez et renouvelez automatiquement des certificats auprès d’une autorité de certification.',
          unavailable: 'Indisponible'
        },
        unavailable: {
          title: 'Aucun canal d’émission ACME n’est configuré',
          description: 'Cette console ne possède pas de point d’entrée ACME disponible. Importez un certificat existant ou réessayez après avoir configuré un canal d’émission automatisé.'
        }
      },
      acme: {
        title: 'Demander un certificat ACME', loading: 'Verification du canal de demande...', blocked: 'Le canal de demande n est pas pret. Corrigez les conditions indiquees puis actualisez.',
        status: { ready: 'Pret a demander', blocked: 'Configuration requise', unknown: 'Etat inconnu' },
        fields: { issuer: 'Autorite de certification', email: 'E-mail de contact', domains: 'Noms de domaine', dnsCredential: 'Identifiant DNS', keyType: 'Type de cle', autoRenew: 'Renouvellement automatique' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: 'Envoyer la demande', refresh: 'Actualiser l etat' },
        errors: { requestFailed: 'Echec de la demande ACME' }
      },
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
        source: 'Méthode d’ajout',
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
      upload: {
        choose: 'Choose file',
        noFile: 'No file selected'
      },
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
        primaryDomain: 'example.com',
        versionKeyword: 'Name / issuer / subject / version ID'
      },
      columns: {
        notBefore: 'Start date',
        notAfter: 'End date',
        associatedAsset: 'Related asset',
        sourceType: 'Added by',
        status: 'Status',
        certificateVersionId: 'Certificate version ID'
      },
      sourceTypes: {
        manual: 'Manual import',
        internal_ca: 'CA interne',
        enterprise_ca: 'CA d’entreprise',
        external_api: 'API externe',
        acme: 'ACME',
        unknown: 'Unknown'
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
        toggleFilters: 'Filtrer',
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
        http: {
          description: 'Call a structured HTTP API instead of scattered curl strings.'
        },
        ssh: {
          displayName: 'SSH command',
          description: 'Declare the SSH command to run while storing only connection and credential references.'
        },
        sftp: {
          displayName: 'SFTP upload/download',
          description: 'Upload or download files through a formal SFTP step, suitable for certificate and config installation.'
        },
        scp: {
          displayName: 'SCP upload/download',
          description: 'Copy files through SCP, suitable for simple host file distribution.'
        },
        verify: {
          displayName: 'Verify',
          description: 'Assert HTTP status, text, regex, or certificate fingerprint.'
        },
        condition: {
          displayName: 'Condition',
          description: 'Choose the next path based on variable existence or value.'
        },
        transform: {
          displayName: 'Transform',
          description: 'Use JSONata to convert upstream output into new workflow context variables.'
        },
        foreach: {
          displayName: 'Parcourir la collection',
          description: 'Parcourt une collection dynamique dans l’ordre et exécute les mêmes sous-étapes pour chaque élément.'
        },
        checkpoint: {
          displayName: 'Point de reprise',
          description: 'Enregistre un résumé vérifiable de l’état distant avant une écriture sur l’équipement.'
        },
        pluginAction: {
          displayName: 'Action atomique du plugin',
          description: 'Appelle une seule action de plugin déclarée par le DSL, sans gérer l’ordre ni le retour arrière.'
        },
        wait: {
          displayName: 'Wait',
          description: 'Wait for a fixed number of seconds before continuing.'
        },
        manual: {
          displayName: 'Manual approval',
          description: 'Pause the workflow until manual confirmation.'
        }
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
        itemsPath: 'Chemin de la collection',
        itemVariable: 'Variable de l’élément',
        indexVariable: 'Variable d’index',
        maxItems: 'Nombre maximal d’éléments',
        foreachSteps: 'JSON des sous-étapes',
        checkpointName: 'Nom du point de reprise',
        checkpointCapture: 'JSON des chemins capturés',
        requiredForRollback: 'Requis pour le retour arrière',
        pluginId: 'ID du plugin',
        capability: 'Capacité',
        actionId: 'ID de l’action',
        actionContractVersion: 'Version du contrat d’action',
        actionInput: 'JSON d’entrée de l’action',
        inputSchemaSha256: 'Empreinte du schéma d’entrée',
        outputSchemaSha256: 'Empreinte du schéma de sortie',
        writeEffect: 'Effet d’écriture',
        idempotencyKeyRef: 'Référence de clé d’idempotence',
        outputFormat: 'Output format',
        usernameVariable: 'Username variable',
        variable: 'Variable',
        verifyType: 'Verify type'
      },
      options: {
        boolean: { yes: 'Oui', no: 'Non' },
        direction: {
          download: 'Download',
          upload: 'Upload'
        },
        hostKeyPolicy: {
          manualApproval: 'Manual approval',
          strict: 'Strict verification',
          trustOnFirstUse: 'Trust on first use'
        },
        operator: {
          equals: 'Equals',
          exists: 'Exists',
          notEquals: 'Not equals',
          notExists: 'Does not exist'
        },
        transformFormat: {
          raw: 'Raw value',
          jsonString: 'JSON string'
        },
        verifyType: {
          certificateFingerprint: 'Certificate fingerprint',
          httpStatus: 'HTTP status',
          regex: 'Regex match',
          textContains: 'Text contains'
        }
      },
      stages: {
        backup: {
          title: 'Backup',
          description: 'Keep rollback material.'
        },
        install: {
          title: 'Install',
          description: 'Write certificates or configuration.'
        },
        prepare: {
          title: 'Prepare',
          description: 'Prepare connections, variables, and material.'
        },
        refresh: {
          title: 'Refresh',
          description: 'Reload services or refresh targets.'
        },
        verify: {
          title: 'Verify',
          description: 'Confirm the result matches expectations.'
        }
      },
      defaults: {
        displayName: '{name} workflow',
        nodes: {
          backupExistingCertificate: 'Back up existing certificate',
          reloadService: 'Reload service'
        },
        variables: {
          certificatePaths: {
            description: 'Target certificate path configuration'
          },
          credential: {
            description: 'Connection credential'
          },
          deviceHost: {
            description: 'Target host'
          },
          serverCert: {
            description: 'Server certificate material to deploy',
            outputs: {
              certFile: {
                description: 'Server certificate file'
              },
              keyFile: {
                description: 'Private key file'
              }
            }
          },
          sshUsername: {
            description: 'SSH login username'
          },
          verifyUrl: {
            description: 'Post-deployment verification URL'
          }
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
        unknownNodeType: 'Unknown node type: {type}',
        missingWorkflowDsl: 'Le backend n’a pas renvoyé le DSL du workflow'
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
      pluginSources: {
        createTitle: 'Créer depuis un plugin', applyTitle: 'Créer un brouillon depuis un plugin', description: 'Seuls les workflows de certificats des plugins activés sont proposés. Choisissez d’abord le workflow, puis la version du plugin.',
        createAction: 'Créer le workflow', applyAction: 'Créer le brouillon', currentTarget: 'Workflow actuel : {name}', namePlaceholder: 'Nom du workflow', loading: 'Chargement des sources plugin...', empty: 'Aucune source plugin disponible.', version: 'Version du plugin', workflowVersion: 'Version du workflow', versionSource: 'Source de version : {plugin} / {version} / {capability}',
        capabilities: { deploy: 'Déploiement du certificat', rollback: 'Restauration du certificat' }, errors: { loadFailed: 'Échec du chargement des sources plugin', nameRequired: 'Saisissez un nom de workflow', missingApplyTarget: 'Le workflow cible est absent', actionFailed: 'Échec de la copie du workflow plugin' }
      },
      origins: { user: 'Personnalisé', plugin_internal: 'Intégré au plugin' },
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
        rename: 'Renommer',
        saveName: 'Enregistrer le nom',
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
        origin: 'Origine',
        note: 'Note',
        status: 'Status',
        updatedAt: 'Updated at'
      },
      filters: {
        showNonDeployment: 'Afficher les workflows hors déploiement'
      },
      empty: {
        description: 'Create a canvas draft first, then publish versions to the production flow.',
        noChangeSummary: 'No change summary.',
        noChangeSummaryShort: 'No change summary',
        noVersions: 'No versions.',
        title: 'No workflows'
      },
      tabs: {
        summary: 'Overview',
        versions: 'Versions'
      },
      versionStatuses: {
        disabled: 'Disabled',
        draft: 'Draft',
        published: 'Published'
      },
      detail: {
        description: 'Workflow details, canvas drafts, and versions are kept in this modal; the main page stays compact.',
        publishedVersion: 'Published version {version}',
        title: 'Workflow details',
        titleWithName: 'Workflow {name}'
      },
      rename: {
        title: 'Nom du workflow',
        description: 'Modifie le nom affiché dans les listes et les détails sans réécrire les versions historiques.',
        placeholder: 'Saisissez le nom du workflow',
        messages: { success: 'Le nom du workflow a été mis à jour.' },
        errors: { required: 'Le nom du workflow est obligatoire.', failed: 'Échec de la modification du nom du workflow.' }
      },
      versionManager: {
        description: 'Manage only workflow version creation and publishing here; workflow canvas content is not changed.',
        titleWithName: 'Version management: {name}'
      },
      changeSummaries: {
        createFromPlugin: 'Créer un workflow depuis une capacité plugin',
        applyFromPlugin: 'Créer un brouillon depuis une capacité plugin',
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
        sources: {
          builtin: 'Built-in',
          userImported: 'User imported'
        },
        errors: {
          actionFailed: 'Failed to run file template action',
          loadFailed: 'Failed to load workflow file templates',
          missingApplyTarget: 'Missing workflow target to apply'
        }
      },
      credentials: {
        actions: {
          create: 'Create credential'
        },
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
          common: {
            family: 'General'
          },
          sshKey: {
            title: 'SSH private key'
          },
          usernamePassword: {
            title: 'Username + password'
          }
        },
        secretLabels: {
          password: 'Password',
          sshKey: 'SSH private key'
        },
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
    tls: monitoringTlsFrFR,
    actions: {
      add: 'Ajouter une surveillance',
      probe: 'Inspecter les sites',
      probing: 'Inspection en cours...',
      refresh: 'Actualiser les données',
      refreshing: 'Actualisation...',
      remove: 'Supprimer'
    },
    errors: {
      addFailed: 'Échec de l’ajout de la cible surveillée',
      deleteFailed: 'Échec de la suppression de la cible surveillée',
      invalidTarget: 'Les données de la cible surveillée sont invalides',
      loadFailed: 'Échec du chargement des données de surveillance',
      probeFailed: 'Échec de la requête d’inspection',
      updateIntervalFailed: 'Échec de la mise à jour de la fréquence d’inspection'
    },
    empty: {
      actualCertificate: 'Aucun certificat TLS mesuré pour le moment. Les cibles HTTPS collectent automatiquement les informations du certificat lors de l’inspection du site.',
      description: 'Ajoutez une surveillance en haut à droite. Le système inspectera le site selon la fréquence définie et collectera les informations du certificat.',
      noAddableAssets: 'Aucun actif applicatif ne peut être ajouté. Ajustez la fréquence d’inspection des cibles existantes dans la vue détaillée.',
      observedCertificateHistory: 'Aucune version de certificat liée pour le moment. Le premier certificat collecté par une inspection sera conservé automatiquement.',
      probeHistory: 'Aucun historique d’inspection.',
      riskEvents: 'Aucun événement associé.',
      title: 'Aucune cible surveillée'
    },
    sections: {
      actualCertificate: 'Certificat actuellement mesuré sur le site',
      actualCertificateHint: 'Collecté automatiquement lors de l’inspection du site',
      observedCertificateHistory: 'Versions de certificats liés',
      observedCertificateHistoryHint: 'Conserve les versions lorsque le certificat TLS mesuré change',
      probeHistory: 'Historique des inspections',
      probeHistoryHint: 'Les 20 derniers résultats d’inspection du système',
      riskEvents: 'Événements de risque',
      riskEventsHint: 'Chaîne de certificats, domaine, empreinte et état d’exécution',
      targets: 'Cibles surveillées'
    },
    labels: {
      applicationAsset: 'Actif applicatif',
      currentTarget: 'Cible actuelle',
      probeInterval: 'Fréquence d’inspection',
      secondsUnit: 'secondes',
      millisecondsUnit: 'ms'
    },
    metrics: {
      availability: 'Disponibilité',
      certificateStatus: 'État du certificat',
      latency: 'Latence',
      observedCertificateChanges: 'Changements du certificat mesuré'
    },
    probe: {
      completed: 'Inspection terminée',
      emptyHistoryBlock: 'Inspection {index} : aucun résultat',
      latencyNotCollected: 'Latence non collectée',
      recentAria: 'Dix derniers résultats d’inspection',
      waiting: 'En attente de l’inspection du site'
    },
    status: {
      error: 'Error',
      none: 'Pending',
      ready: 'Healthy',
      warning: 'Warning'
    },
    warnings: {
      certificateNotApplied: 'La dernière version du certificat de domaine n’est pas encore appliquée selon la sonde système',
      chainVerificationFailed: 'La sonde système a détecté l’échec de la vérification de la chaîne du certificat'
    },
    fallback: {
      noEndpoint: 'Aucun point d’accès configuré',
      noFingerprint: 'Aucune empreinte',
      notClosed: 'Non clôturé',
      noSummary: 'Aucun résumé',
      notCollected: 'Non collecté',
      notSelected: 'Non sélectionné',
      unknownAsset: 'Actif inconnu',
      unknownCertificate: 'Certificat inconnu',
      unknownIssuer: 'Émetteur inconnu',
      unnamedEvent: 'Événement sans nom'
    },
    certificate: {
      actualCertificate: 'Certificat mesuré',
      chainUntrusted: 'Non approuvé par la chaîne de confiance du système',
      chainVerification: 'Vérification de la chaîne',
      chainVerified: 'Chaîne vérifiée',
      chainVerifyFailedWithReason: 'Échec de la vérification de la chaîne : {reason}',
      collectedAt: 'Collecté le',
      issuer: 'Émetteur',
      serialNumber: 'Numéro de série',
      sha256Fingerprint: 'Empreinte SHA-256',
      subject: 'Sujet',
      validity: 'Validité',
      validityRange: '{start} au {end}'
    },
    columns: {
      certificateName: 'Nom du certificat',
      changedAt: 'Modifié le',
      closedAt: 'Clôture de l’alerte',
      currentStatus: 'État actuel',
      expiresAt: 'Expire le',
      issuerName: 'Nom de l’émetteur',
      latency: 'Latence',
      occurredAt: 'Date de survenue',
      result: 'Résultat',
      source: 'Source',
      status: 'État',
      time: 'Heure',
      warningContent: 'Contenu de l’alerte'
    },
    dialog: {
      defaultMetricsHint: 'La disponibilité, la latence, les informations du certificat et son historique sont surveillés par défaut.',
      description: 'Sélectionnez une cible parmi les actifs applicatifs. Le système collectera sa disponibilité, sa latence, les informations du certificat et son historique.',
      loadingAssets: 'Chargement des actifs...',
      selectAsset: 'Sélectionner un actif applicatif',
      title: 'Ajouter une surveillance'
    },
    source: {
      controlPlane: 'Plan de contrôle'
    },
    targets: {
      assetCount: '{count} actifs',
      lazyLoadHint: '{shown} / {total} chargés, faites défiler pour charger plus'
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
  internalCa: internalCaEnglish,
  applicationOnboarding: {
    eyebrow: 'Assistant d’intégration', title: 'Ajouter un actif applicatif', description: 'Choisissez une plateforme et configurez l’équipement, le site et le certificat.', stepsAria: 'Étapes d’intégration',
    steps: { platform: 'Plateforme', device: 'Équipement', target: 'Site', certificate: 'Certificat', complete: 'Terminer' },
    platforms: { customManual: 'Creation manuelle personnalisee', manualHint: 'Utiliser le parcours manuel', pluginHint: 'Parcours fourni par le module de plateforme', capabilityVersion: 'Version de capacite', compatibility: 'Versions compatibles', requiredInformation: 'Informations requises', inReview: 'Validation des capacites en cours' },
    device: { title: 'Connecter la plateforme', existing: 'Utiliser un équipement existant', new: 'Ajouter un équipement', deviceId: 'ID équipement', selectPlaceholder: 'Selectionner un équipement', noExisting: 'Aucun équipement sain n est disponible pour cette plateforme.', existingLoading: 'Chargement des équipements compatibles.', refreshExisting: 'Actualiser les équipements', newDescription: 'Ouvre l assistant unifie d integration des équipements, puis revient ici apres l enregistrement de l Agent ou de l équipement.', newHint: 'Au retour, l assistant recharge les équipements découverts disponibles pour cette plateforme.', newAction: 'Ouvrir l integration équipement', username: 'Nom utilisateur', password: 'Mot de passe', host: 'Adresse', port: 'Port' },
    target: { title: 'Choisir le site', siteName: 'Nom du site', listenAddress: 'Adresse d’écoute', listenPort: 'Port d’écoute', protocol: 'Protocole', selectable: 'Cible gérée sélectionnable', notSelectable: 'Non sélectionnable', unavailableReason: 'Motif de non-sélection', missingValue: 'Non fourni', reasons: { managedTargetInactive: 'Cette cible gérée est inactive.', workflowCapabilityMissing: 'Cette cible ne fournit pas la capacité de workflow requise par cette plateforme.', targetEndpointMissing: 'Il manque à cette cible une adresse, un port ou un protocole d’écoute complet.', unknown: 'Cette cible ne remplit pas actuellement les conditions de sélection.' } }, certificate: { title: 'Choisir la version du certificat', asset: 'Actif de certificat', version: 'Version du certificat', requiredFormat: 'Cette plateforme nécessite un certificat au format {formats}' },
    complete: { title: 'Intégration terminée', description: 'L’actif applicatif et le plan de déploiement sont prêts.' },
    actions: { customManual: 'Création manuelle', openWizard: 'Assistant d’intégration', previous: 'Précédent', continue: 'Continuer', refresh: 'Actualiser les sites', review: 'Vérifier le certificat', complete: 'Terminer', cancel: 'Annuler' },
    messages: { requestFailed: 'Échec de la requête. Vérifiez les droits et les données.', noPlatforms: 'Aucune plateforme disponible.' }
  },
  tenantArchitecture: { nav: 'Architecture de groupe', eyebrow: 'Gouvernance multi-tenant', title: 'Architecture de groupe', description: 'Gérez les groupes, filiales et administrateurs.', mode: { aria: 'Mode architecture de groupe', label: 'Mode architecture de groupe', hierarchical: 'Activé', single: 'Désactivé', updated: 'Dernière mise à jour : {time}' }, actions: { checking: 'Vérification', preflight: 'Exécuter le précontrôle', enabling: 'Activation', enable: 'Activer', rollingBack: 'Retour en arrière', rollback: 'Désactiver', suspend: 'Suspendre', resume: 'Reprendre', revokeAdministrator: 'Révoquer' }, preflight: { title: 'Précontrôle', summary: 'Blocages : {blockers}', passed: { title: 'Conditions remplies', summary: '{count} vérifications réussies' }, blocked: { title: 'Action requise', summary: '{count} blocages', description: 'Résolvez les problèmes suivants avant de relancer le précontrôle.' } }, confirm: { enable: 'Activer l’architecture de groupe ?', rollback: 'Revenir au mode mono-tenant ?', revokeAdministrator: 'Révoquer cette relation administrateur ?' }, messages: { preflightCompleted: 'Précontrôle terminé.', enabled: 'Architecture activée.', rolledBack: 'Retour au mode mono-tenant.', companyCreated: 'Filiale créée.', administratorAdded: 'Administrateur configuré.', administratorRevoked: 'Relation administrateur révoquée.', statusUpdated: 'État de la filiale mis à jour.' }, errors: { emptyMode: 'État non retourné.', loadFailed: 'Échec du chargement.', preflightFailed: 'Précontrôle échoué.', enableFailed: 'Activation échouée.', rollbackFailed: 'Retour échoué.', companyCreateFailed: 'Création de filiale échouée.', administratorFailed: 'Configuration de l’administrateur échouée.', administratorRevokeFailed: 'Révocation échouée.', statusFailed: 'Mise à jour échouée.' }, company: { title: 'Ajouter une filiale', name: 'Nom', namePlaceholder: 'Saisir le nom', code: 'Code', codePlaceholder: 'Saisir le code unique', submit: 'Créer la filiale' }, administrator: { title: 'Administrateur de filiale', tenant: 'Filiale', tenantPlaceholder: 'Sélectionner une filiale', subjectId: 'ID utilisateur', subjectPlaceholder: 'Saisir l’ID utilisateur', submit: 'Ajouter', empty: 'Aucun administrateur' }, tree: { aria: 'Diagramme d’architecture', empty: 'Aucun tenant visible dans ce périmètre.' }, history: { aria: 'Historique récent du mode', title: 'Historique récent du mode', kind: { PREFLIGHT: 'Précontrôle', ENABLE: 'Activation', ROLLBACK: 'Retour' }, status: { RUNNING: 'En cours', COMPLETED: 'Terminé', FAILED: 'Échec' } }, types: { GROUP: 'Groupe', COMPANY: 'Filiale' }, status: { ACTIVE: 'Actif', SUSPENDED: 'Suspendu' }, membership: { owner: 'Propriétaire', admin: 'Administrateur' } },
  tenantSwitcher: { title: 'Changer de tenant', aria: 'Tenants disponibles', current: 'Actuel', switching: 'Changement', confirm: 'Changer vers {tenant} ?', success: 'Changé vers {tenant}.', errors: { contextStale: 'Le contexte a expiré. Les tenants ont été actualisés.', membershipRequired: 'Aucune relation active avec le tenant cible.', modeConflict: 'Le mode tenant change actuellement.', switchFailed: 'Le changement a échoué. Le tenant précédent reste actif.' } },
  errors: {
    forbiddenTitle: '403 Accès refusé',
    forbiddenMessage: 'You do not have permission to access this page.',
    missingPermission: 'Missing permission: {permission}',
    notFoundTitle: '404 Page introuvable',
    notFoundMessage: 'This route is not registered.',
    backDashboard: 'Retour au tableau de bord',
    back: 'Retour',
    logout: 'Déconnexion'
  }
} as const
