// Auto-generated from messages.ts — do not edit manually.
// Edit messages.ts and re-run: npx tsx src/i18n/extract-locales.ts
export default {
  app: {
    brand: 'Console GCAC',
    platform: 'Plateforme de cycle de vie des certificats SSL',
    defaultBreadcrumb: 'Console',
    dashboard: 'Tableau de bord'
  },
  common: {
    refresh: 'Actualiser',
    logout: 'Déconnexion',
    enter: 'Ouvrir',
    loading: 'Chargement',
    userFallback: 'Utilisateur non connecté',
    tenantFallback: 'Tenant par défaut'
  },
  api: {
    errors: {
      requestFailed: 'Échec de la requête'
    }
  },
  auth: {
    errors: {
      missingSession: 'La connexion a échoué : l’API de connexion n’a pas retourné de session valide'
    },
    mock: {
      displayName: 'Utilisateur système (Mock)'
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
      unnamedCheck: 'Contrôle sans nom'
    },
    dryRunResult: {
      title: 'Résultat d’exécution dry-run',
      close: 'Fermer'
    },
    modal: {
      closeAria: 'Fermer la fenêtre modale'
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
      DRAFT: 'Brouillon',
      PUBLISHED: 'Publié',
      PENDING_APPROVAL: 'En attente d’approbation',
      READY: 'Prêt',
      RUNNING: 'En cours',
      SUCCESS: 'Succès',
      PARTIAL_SUCCESS: 'Succès partiel',
      FAILED: 'Échec',
      CANCELLED: 'Annulé',
      ROLLED_BACK: 'Rollback effectué',
      DISCOVERED: 'Découvert',
      MANAGED: 'Géré',
      DRIFTED: 'En dérive',
      EXPIRED: 'Expiré',
      ERROR: 'Erreur',
      IGNORED: 'Ignoré',
      ONLINE: 'En ligne',
      OFFLINE: 'Hors ligne',
      DISABLED: 'Désactivé',
      UPGRADING: 'Mise à niveau en cours',
      UPDATE_REQUIRED: 'Mise à jour requise',
      UP_TO_DATE: 'À jour',
      UNKNOWN: 'Inconnu'
    },
    risk: {
      LOW: {
        label: 'Faible',
        description: 'Nécessite une attention, mais ne bloque pas directement l’opération.'
      },
      MEDIUM: {
        label: 'Moyen',
        description: 'Peut affecter le déploiement ou les résultats de supervision et nécessite une confirmation.'
      },
      HIGH: {
        label: 'Élevé',
        description: 'Peut entraîner une interruption de service ou une exposition de sécurité.'
      },
      CRITICAL: {
        label: 'Critique',
        description: 'Doit être traité en priorité. Les opérations risquées nécessitent une seconde confirmation.'
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
        realtime: 'Mises à jour en temps réel',
        autoRefresh: 'Actualisation automatique'
      },
      search: {
        placeholder: 'Rechercher dans les journaux'
      },
      level: {
        aria: 'Niveau de journal',
        all: 'Tous'
      },
      hint: {
        streaming: 'L’état de la tâche et les journaux seront mis à jour en temps réel.',
        autoRefresh: 'L’état de la tâche et les journaux seront actualisés automatiquement.',
        pollingFallback: 'Mode de rafraîchissement périodique actuellement utilisé.'
      },
      steps: {
        aria: 'Étapes d’exécution',
        emptyDetail: 'Aucune description d’étape pour le moment'
      },
      empty: {
        logs: 'Aucun journal pour le moment.'
      }
    },
    executionProgress: {
      aria: {
        progressOverview: 'Vue d’ensemble de la progression',
        taskList: 'Liste des tâches',
        latestEvents: 'Derniers événements',
        executionLog: 'Journal d’exécution'
      },
      checklist: {
        title: 'Résultats des contrôles'
      },
      detail: {
        stepsCompleted: '{completed}/{total} étapes terminées',
        summaryFailed: '{total} résultats de contrôle retournés, {failed} en échec',
        summaryPassed: 'Les {passed} contrôles ont tous réussi',
        summaryReturned: '{total} résultats de contrôle retournés',
        summaryWarning: '{total} résultats de contrôle retournés, {warning} avertissements',
        waitingStart: 'En attente du démarrage de la tâche',
        waitingSteps: 'En attente des étapes d’exécution du backend'
      },
      empty: {
        activity: 'Les entrées du journal d’exécution apparaîtront après la fin de la tâche.',
        events: 'Aucun événement n’a encore été retourné.',
        tasks: 'La tâche n’a pas encore été créée. En attente des étapes d’exécution du backend.'
      },
      event: {
        collapse: 'Réduire les événements',
        defaultLabel: 'Événement',
        defaultTitle: 'Événement de tâche',
        expand: 'Développer les événements',
        waitingDetail: 'En attente des données d’événement'
      },
      feed: {
        completed: 'Exécution terminée',
        failed: 'Échec de l’exécution',
        warning: 'Terminé avec avertissements'
      },
      loading: {
        pollingFallback: 'Mode d’actualisation automatique de secours actif',
        refreshing: 'Actualisation'
      },
      log: {
        collapse: 'Réduire le journal complet',
        expand: 'Voir le journal complet'
      },
      metrics: {
        completed: 'Terminé',
        failed: 'Échec',
        passed: 'Réussi',
        queued: 'En file d’attente',
        running: 'En cours',
        totalTasks: 'Nombre total de tâches',
        unknown: 'Inconnu',
        warning: 'Avertissements'
      },
      process: {
        execution: 'Exécution'
      },
      progress: {
        completed: 'Tout est terminé',
        failed: 'Terminé avec des éléments en échec',
        pending: 'En attente de l’écriture des résultats',
        processFailed: 'Échec de {process}',
        queued: 'En attente de planification',
        running: 'Tâche en cours',
        warning: 'Terminé avec des alertes de risque'
      },
      section: {
        completedCount: '{completed}/{total} terminés',
        executionLog: 'Journal d’exécution',
        latestEvents: 'Derniers événements',
        taskProgress: 'Progression de la tâche'
      },
      status: {
        completed: 'Terminé',
        failed: 'Échec',
        queued: 'En attente',
        running: 'En cours',
        warning: 'Avertissement'
      },
      step: {
        backup: 'Sauvegarde préalable',
        discover: 'Détection de l’environnement',
        installDryRun: 'Préparation des éléments',
        installExecution: 'Installation du certificat',
        reload: 'Rechargement du service',
        verify: 'Vérification du résultat'
      },
      subtitle: {
        completed: 'La tâche est terminée.',
        failed: 'La tâche s’est terminée avec un résultat en échec.',
        failedChecks: '{total} contrôles, {failed} en échec',
        passedChecks: '{total} contrôles réussis',
        queued: 'La tâche a été créée et attend son exécution.',
        running: 'La tâche a démarré. En attente de résultats supplémentaires.',
        runningChecks: '{total} contrôles retournés',
        warningChecks: '{total} contrôles, {warning} avertissements'
      },
      time: {
        waitingStart: 'En attente du démarrage'
      }
    },
    deploymentWizard: {
      actions: {
        cancel: 'Annuler',
        dryRun: 'Exécuter d’abord un Dry-run',
        next: 'Suivant',
        previous: 'Précédent',
        save: 'Enregistrer le plan'
      },
      aria: {
        steps: 'Étapes de déploiement',
        wizard: 'Assistant de déploiement'
      },
      capability: {
        targetMissingDetail: 'Aucune cible de déploiement sélectionnée.',
        targetSelectedDetail: 'Cible de déploiement sélectionnée. Exécutez un Dry-run avant soumission.',
        targetSelection: 'Sélection de la cible de déploiement',
        targetSource: 'Cible de déploiement'
      },
      checks: {
        failed: 'Échec {count}',
        passed: 'Réussi {count}',
        unknown: 'Inconnu {count}',
        unnamed: 'Contrôle sans nom',
        warning: 'Avertissement {count}'
      },
      empty: {
        noTargets: 'Aucune cible d’actif applicatif disponible',
        selectTarget: 'Sélectionnez une cible de déploiement d’actif applicatif.'
      },
      fallback: {
        generatedByApplicationEntry: 'Généré depuis l’entrée applicative',
        missingBinding: 'Informations de liaison non fournies',
        unboundCertificateVariable: 'Variable de certificat non liée',
        unconfigured: 'Non configuré',
        unconfiguredRunner: 'Emplacement d’exécution non configuré',
        unknownEnd: 'Fin inconnue',
        unknownStart: 'Début inconnu',
        unnamedSite: 'Site sans nom',
        unnamedVersion: 'Version sans nom',
        unrecognizedManagedTarget: 'Cible gérée non reconnue',
        unselected: 'Non sélectionné',
        unselectedVersion: 'Version non sélectionnée',
        unselectedWorkflow: 'Workflow non sélectionné'
      },
      fields: {
        applicationTarget: 'Cible de déploiement d’actif applicatif',
        artifactConfig: 'Configuration des artefacts',
        binding: 'Liaison',
        certificateAsset: 'Actif de certificat',
        certificateVariable: 'Variable de certificat',
        certificateVersion: 'Version du certificat',
        deploymentTarget: 'Cible de déploiement',
        keyword: 'Recherche par mot-clé',
        managedTarget: 'Cible gérée',
        runner: 'Emplacement d’exécution',
        site: 'Site',
        verifyUrl: 'URL de vérification',
        version: 'Version',
        workflow: 'Workflow'
      },
      panels: {
        certificateTitle: '1. Matériel de certificat',
        submitTitle: '3. Précontrôle et soumission',
        targetTitle: '2. Cible de déploiement'
      },
      panelState: {
        needPrerequisites: 'Prérequis requis',
        operable: 'Prêt',
        pending: 'En attente',
        readyNext: 'Prêt pour l’étape suivante'
      },
      placeholders: {
        selectTarget: 'Sélectionner une cible d’actif applicatif',
        targetKeyword: 'Rechercher par domaine, site ou informations de liaison'
      },
      plan: {
        dryRunCompleted: 'Le dernier Dry-run est terminé.',
        submitCompleted: 'La dernière soumission est terminée.'
      },
      preview: {
        needCertificate: 'Sélectionnez d’abord le matériel de certificat.',
        needTarget: 'Après avoir sélectionné le matériel de certificat, choisissez les cibles d’actifs applicatifs.',
        ready: 'La version de certificat sélectionnée sera déployée sur {count} cibles d’actifs applicatifs.'
      },
      status: {
        checksReturned: 'Les résultats de précontrôle sont disponibles. Décidez s’il faut enregistrer, soumettre ou exécuter.',
        current: 'État actuel',
        default: 'Lancez un Dry-run avant de décider de soumettre.',
        dryRunStarted: 'Dry-run démarré. Consultez la progression dans le panneau des résultats d’exécution.',
        submitted: 'Plan soumis.'
      },
      steps: {
        certificate: {
          description: 'Actif de certificat et version',
          title: 'Sélectionner le matériel de certificat'
        },
        submit: {
          description: 'Dry-run, enregistrer, soumettre, exécuter',
          title: 'Précontrôler et soumettre'
        },
        target: {
          description: 'Actif applicatif, site et liaison',
          title: 'Sélectionner la cible de déploiement'
        }
      },
      stepState: {
        active: 'En cours',
        done: 'Terminé',
        pending: 'En attente'
      },
      target: {
        workflowMode: 'Mode workflow'
      },
      version: {
        autoLatest: 'Toujours sélectionner automatiquement la dernière version de certificat déployable (actuel : {current})',
        noDeployableVersion: 'Aucune version de certificat déployable disponible',
        range: '{id} ({notBefore} à {notAfter})'
      },
      currentStep: 'Étape {current} /{total}',
      selectedTargetCount: '{count} cibles sélectionné',
      subtitle: 'Configurez le plan de déploiement étape par étape',
      title: 'Assistant de déploiement'
    }
  },
  shell: {
    currentLocation: 'Emplacement actuel',
    breadcrumb: 'Fil d’Ariane',
    currentGroupNavigation: 'Navigation du groupe actuel',
    backDashboard: 'Retour au tableau de bord'
  },
  preferences: {
    theme: 'Thème',
    language: 'Langue',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    themeToggle: 'Basculer thème',
    languageSelect: 'Sélectionner langue',
    title: 'Préférences d’affichage',
    description: 'Thème et langue sont enregistré à votre backend utilisateur préférences.',
    errors: {
      loadFailed: 'Échec du chargement des préférences',
      saveFailed: 'Échec de l’enregistrement des préférences'
    }
  },
  userMenu: {
    currentUser: 'Utilisateur courant',
    changePassword: 'Modifier le mot de passe',
    logout: 'Déconnexion'
  },
  password: {
    title: 'Modifier le mot de passe',
    description: 'Modification le local mot de passe pour le-dans utilisateur.',
    current: 'Mot de passe actuel',
    new: 'Nouveau mot de passe',
    confirm: 'Confirmer le mot de passe',
    cancel: 'Annuler',
    submit: 'Enregistrer',
    submitting: 'Enregistrement...',
    success: 'Mot de passe mis à jour',
    failed: 'Échec de mot de passe modification',
    mismatch: 'Le nouveau faire non correspondre',
    tooShort: 'Le nouveau mot de passe doit être à 8 caractères'
  },
  nav: {
    dashboard: 'Vue d’ensemble',
    dashboardDesc: 'Vue d’ensemble de applications, certificats, Agents, passerelles, et audit état',
    certificates: 'Certificats',
    certificatesDesc: 'Certificat bibliothèque, liaisons, et expiration état',
    certificateAssets: 'Actifs de certificats',
    certificateAssetsDesc: 'Certificats, privée clé références, empreintes, et expiration',
    certificateFormats: 'Configuration des formats de certificat',
    certificateFormatsDesc: 'Définir les règles de format PFX, CER, CRT, PEM et autres pour les certificats enregistrés',
    assets: 'Actifs applicatifs',
    assetsDesc: 'Application entrée points et certificat déploiement cibles par domaine/IP',
    agents: 'Agents',
    agentsDesc: 'En ligne état, heartbeat, et capacité définir',
    gateways: 'Passerelles',
    gatewaysDesc: 'Passerelle, protocole, et joignable cible état pour',
    deployments: 'Certificat déploiement',
    deploymentsDesc: 'Plans de déploiement et enregistrements d’exécution',
    deploymentPlans: 'Plans de déploiement',
    deploymentPlansDesc: 'Certificat déploiement plans et approbation entrée points',
    executions: 'Enregistrements d’exécution',
    executionsDesc: 'Exécution étapes, journaux, échecs, et rollback',
    workflows: 'Workflows',
    workflowsDesc: 'Workflows et plugins',
    workflowTemplates: 'Workflows',
    workflowTemplatesDesc: 'Brouillons de canevas, variables, déclarations de capacités et publication',
    automations: 'Automatisations',
    automationsDesc: 'Plans de renouvellement de certificats planifiés, à la demande et par lot',
    plugins: 'Plugins',
    pluginsDesc: 'Provider, exécuteur, et sandbox état',
    monitoring: 'Supervision',
    monitoringDesc: 'Alertes, audit et état des certificats',
    monitorAlerts: 'Alertes de supervision',
    monitorAlertsDesc: 'Expiration,, et exécution échec événements',
    audits: 'Journaux d’audit',
    auditsDesc: 'Preuves d’opérations et exports de conformité',
    settings: 'Paramètres',
    settingsDesc: 'Tenants, utilisateurs, autorisations et configuration système',
    systemSettings: 'Paramètres système',
    systemSettingsDesc: 'Configuration système et métadonnées de sécurité',
    users: 'Utilisateurs',
    usersDesc: 'Utilisateurs de la console, états et rôles',
    roles: 'Rôles',
    rolesDesc: 'Rôles, autorisation objet portées, et membre affectations',
    identitySources: 'Sources d’identité',
    identitySourcesDesc: 'Configuration de AD/LDAP service',
    groupRoleMappings: 'Mappages groupes-rôles'
  },
  automations: {
    title: 'Automatisations',
    description: 'Gérez les exécutions planifiées, à la demande et par lot des plans de renouvellement de certificats.',
    empty: 'Aucune automatisation.',
    emptyDescription: 'Aucune description',
    common: { notAvailable: 'Indisponible' },
    fields: { name: 'Nom', description: 'Description', trigger: 'Déclencheur', cron: 'Expression Cron', timeZone: 'Fuseau horaire', expiresWithinDays: 'Fenêtre d’expiration en jours', environments: 'Environnements cibles (séparés par des virgules)', maxTargets: 'Nombre maximal de cibles par exécution', concurrency: 'Concurrence', failureCount: 'Seuil du nombre d’échecs', requireDryRun: 'Exiger un Dry Run avant l’exécution', requireApproval: 'Exiger une approbation avant l’exécution', startedAt: 'Début', finishedAt: 'Fin', failureStage: 'Étape d’échec', parentRun: 'Exécution parente' },
    actions: { create: 'Créer une automatisation', edit: 'Modifier', delete: 'Supprimer', cancel: 'Annuler', save: 'Enregistrer', copy: 'Copier', enable: 'Activer', disable: 'Désactiver', preview: 'Prévisualiser les cibles', history: 'Historique des exécutions', confirmRun: 'Confirmer l’exécution', stop: 'Arrêter l’exécution', retryFailed: 'Réessayer les cibles en échec', openPlan: 'Ouvrir le plan de déploiement', openExecution: 'Ouvrir l’exécution' },
    columns: { trigger: 'Déclencheur', targets: 'Limite de cibles', actions: 'Actions', nextRun: 'Prochaine exécution', lastRun: 'Dernière exécution' },
    triggers: { onDemand: 'À la demande', schedule: 'Planifiée' },
    triggerTypes: { on_demand: 'À la demande', schedule: 'Planifiée', retry: 'Nouvelle tentative des échecs' },
    actionTypes: { create_deployment_plan: 'Créer un plan de renouvellement de certificat', execute_deployment_plan: 'Exécuter le plan de renouvellement de certificat', send_notification: 'Envoyer une notification' },
    summaries: { targets: 'Jusqu’à {count} cibles' },
    preview: { title: 'Prévisualisation des cibles', description: 'Vérifiez l’instantané des cibles et les exclusions qui seront figés au démarrage.', matched: '{count} correspondances', executable: '{count} exécutables', excluded: '{count} exclues', ready: 'Prête' },
    exclusions: { permission_denied: 'Permission refusée sur la cible', missing_version: 'Version du certificat manquante', version_not_deployable: 'Version du certificat non déployable', binding_not_managed: 'Liaison non gérée', environment_not_allowed: 'Environnement non autorisé', unknown: 'Raison d’exclusion inconnue' },
    failureStages: { selection: 'Sélection des cibles', plan_creation: 'Création du plan', dry_run: 'Dry Run', approval: 'Approbation', execution: 'Exécution', verification: 'Vérification', rollback: 'Restauration', notification: 'Notification' },
    progress: { total: 'Total', pending: 'En attente', running: 'En cours', waitingApproval: 'En attente d’approbation', succeeded: 'Réussies', failed: 'Échouées', skipped: 'Ignorées', cancelled: 'Annulées' },
    editor: { createTitle: 'Créer une automatisation', editTitle: 'Modifier l’automatisation', description: 'Configurez les déclencheurs, la sélection des cibles, les actions et les garde-fous.' },
    runs: { title: 'Historique des automatisations', description: 'Consultez l’état de l’exécution, les instantanés immuables des cibles et les étapes d’échec.', progress: '{succeeded}/{total} réussies' },
    runDetail: { title: 'Détails de l’exécution automatisée', description: 'Version de configuration {version}', noFailure: 'Aucun échec' },
    aria: { preview: 'Prévisualisation des cibles de l’automatisation', runs: 'Liste des exécutions automatisées', progress: 'Progression de l’exécution automatisée' },
    errors: { loadFailed: 'Échec du chargement des automatisations' }
  },
  routes: {
    certificateImport: 'Importer un certificat',
    certificateDetail: 'Certificat détail',
    certificateUsages: 'Utilisations',
    certificateFormats: 'Artefacts de format'
  },
  businessPage: {
    request: {
      notRequested: 'Aucun requête pour le moment'
    },
    error: {
      unknown: 'Erreur inconnue'
    },
    primaryActionFailed: 'Échec de l’action principale',
    processing: 'Traitement...',
    metricsAria: 'Indicateurs métier',
    apiFailed: 'Échec de API requête',
    errorCode: 'Code d’erreur : {code}',
    retry: 'Réessayer',
    resourceList: 'Liste des {resource}',
    total: 'Total : {count}',
    dangerConfirmRequired: '-risque action requiert confirmation',
    all: 'Tous',
    clearFilters: 'Effacer les filtres',
    pagination: 'Page {page} / {pageSize} par page',
    resourceDetailAria: 'Détails de la ressource',
    resourceDetailTitle: 'Détails de {resource}',
    contextAria: 'Contexte liens',
    resourceActionsAria: 'Actions sur la ressource',
    resourceActionsTitle: 'Actions sur la ressource',
    resourceActionsHint: '-risque actions nécessiter secondaire autorisation est toujours par le backend.'
  },
  executionDetail: {
    error: {
      loadStepsFailed: 'Échec de l’opération : requête exécution étapes',
      streamConnectFailed: 'Échec de l’opération : connecter à le exécution détail flux'
    },
    step: {
      nameFallback: 'Étape {index}',
      dryRunCheckSummary: 'Précontrôle résultat: réussi {passed} /avertissements {warning} /échec {failed} /inconnu {unknown}. {topChecks}',
      dryRunPending: {
        queued: 'Toujours en file d’attente et non démarré encore.',
        running: 'Ce étape est en cours. en attente pour le Agent à retourner un résultat.',
        failed: 'Ce étape échec et aucun structuré précontrôle résultat a été reçu encore.',
        finished: 'Ce étape a terminé, mais aucun structuré précontrôle résultat a été reçu encore.'
      },
      dryRunDiscover: 'Lire-uniquement précontrôle: découvert déploiement cible et {providerLabel} site contexte. site {siteName}, liaison {binding}. {pendingText}',
      dryRunVerify: 'Lire-uniquement précontrôle: certificat matériel, cible liaison, et domaine correspondre. cible {providerLabel} liaison {binding}. {pendingText}',
      dryRunCreated: 'Le précontrôle en lecture seule a été créé. {pendingText}',
      failure: {
        emptyMessage: 'Le backend a non un concret erreur message'
      },
      running: {
        dispatched: 'La tâche Agent a été distribuée ({taskId}), en attente du résultat d’exécution.',
        waitingAgentResult: 'Le étape est en cours, mais aucun Agent taskId ou résultat a été reçu encore.'
      },
      pending: {
        waitingDependency: 'Le étape est en attente pour précédent étapes à.'
      },
      verifyRecovered: {
        detail: 'La détection TLS distante côté Agent a échoué, mais le plan de contrôle a effectué une vérification TLS réelle pour {remoteTarget} et confirmé que le certificat cible correspond. {originalError}',
        originalSuffix: 'Erreur Agent d’origine : {originalError}'
      },
      resultReturned: {
        withTask: '{executor} {mode} a retourné un résultat. Agent taskId={taskId}',
        withoutTask: '{executor} {mode} retourné.'
      },
      createdFallback: 'Détails de étape {index} a été créé. en attente pour le backend à ajouter'
    },
    dryRun: {
      failedNoChecks: {
        label: 'Échec de Dry-run',
        detail: '{failedStepCount} précontrôle étapes échec ou sortie, et le Agent a non retourner un structuré conclusion.'
      },
      queued: {
        label: 'Dry-run en file d’attente',
        detail: 'Le précontrôle tâche a été créé et est en attente à début.'
      },
      running: {
        label: 'Dry-run en cours',
        detail: 'Le précontrôle a démarré. en attente pour structuré résultats.'
      },
      pending: {
        label: 'Dry-run terminé sans conclusion',
        detail: '{finishedWithoutChecks} étapes ont terminé, mais aucun /a été retourné.'
      },
      receiving: {
        label: 'Dry-run en réception des résultats',
        detail: 'Partiel reçu: réussi {passed}, avertissements {warning}, échec {failed}, inconnu {unknown}.'
      },
      failed: {
        label: 'Échec de Dry-run',
        detail: 'Précontrôle échec {failed} éléments, avertissement {warning} éléments, réussi {passed} éléments.'
      },
      warning: {
        label: 'Dry-run a risque avertissements',
        detail: 'Précontrôle terminé: réussi {passed}, avertissements {warning}, inconnu {unknown}.'
      },
      passed: {
        label: 'Dry-run réussi',
        detail: 'Tous réussi, {passed} total.'
      }
    },
    agent: {
      taskSuffix: '(Agent taskId={taskId})'
    },
    log: {
      verifyRecovered: '[ControlPlane] La détection TLS distante côté Agent a échoué, mais le système a effectué une vérification TLS réelle et confirmé que le certificat cible correspond.'
    },
    workflowStep: {
      failedDefault: 'Échec de l’exécution du nœud de workflow {index}',
      skipped: 'Nœud de workflow ignoré car la condition n’était pas satisfaite.',
      successAssertions: 'Workflow nœud réussi, assertions réussi {passed}/{total}.',
      success: 'Nœud de workflow réussi.'
    },
    binding: {
      hostMissing: 'Hôte Header non fourni'
    },
    site: {
      unnamed: 'Site sans nom'
    },
    provider: {
      target: 'Cible'
    }
  },
  executions: {
    title: 'Enregistrements d’exécution',
    description: 'Voir déploiement exécution état, étape journaux, dry-run précontrôle résultats, échec raisons, et rollback entrée points.',
    resourceName: 'Exécution exécution',
    errors: {
      streamConnectFailed: 'Échec de l’opération : connecter à le exécution détail flux: HTTP {status}',
      loadFailed: 'Échec du chargement des exécutions'
    },
    actions: {
      refreshList: 'Actualiser la liste',
      refreshing: 'Actualisation',
      viewDetail: 'Voir détails',
      rollback: 'Début rollback',
      rollbackRisk: 'Rollback va le cible service certificat configuration à nouveau. confirmer sauvegarde références et impact portée en premier.'
    },
    columns: {
      name: 'Exécution ID',
      status: 'État',
      risk: 'Risque',
      planId: 'Déploiement plan',
      startedAt: 'Heure de début'
    },
    metrics: {
      total: {
        title: 'Total exécutions',
        description: 'Actuellement traçable exécution exécutions.'
      },
      risky: {
        title: '-risque en attente',
        description: 'Échec, réussi, ou rollback-nécessaire exécutions.'
      }
    },
    fields: {
      executionId: 'Exécution ID',
      deploymentPlan: 'Déploiement plan',
      runType: 'Exécution type',
      status: 'Exécution état',
      target: 'Exécution cible',
      externalRunId: 'Externe exécution ID',
      startedAt: 'Heure de début',
      finishedAt: 'Heure de fin',
      errorCode: 'Erreur code',
      failureReason: 'Échec raison'
    },
    links: {
      deploymentPlan: 'Voir déploiement plan',
      auditEvents: 'Voir audit événements'
    },
    empty: {
      title: 'Aucun exécution enregistrements',
      description: 'Journaux, état, et audit liens apparaître ici après un déploiement plan exécutions.'
    },
    list: {
      ariaLabel: 'Liste des exécutions', title: 'Exécutions', summary: '{total} exécutions, les plus récentes en premier.', range: 'Affichage {start}-{end} sur {total}',
      assetsLabel: 'Actifs', logLabel: 'Résumé du journal', runNumber: 'Exécution {number}', planUnknown: 'Aucun plan associé', assetUnknown: 'Aucun actif enregistré', timeUnknown: 'Heure de début non enregistrée',
      logRunning: 'L’exécution est en cours.', logPending: 'L’exécution est en attente.', logFailed: 'Échec de l’exécution, code {code}.', logSuccess: 'Exécution réussie en {duration}.', logCompleted: 'Exécution terminée.',
      errorCodeUnknown: 'non enregistré', durationUnknown: 'inconnue', durationSeconds: '{count} secondes', durationMinutes: '{count} minutes', viewDetailHint: 'Voir les détails', openDetailAria: 'Ouvrir l’exécution {id} du plan {plan}', previousPage: 'Précédent', nextPage: 'Suivant', pageSummary: 'Page {page} sur {pages}'
    },
    types: { dryRun: 'Précontrôle', apply: 'Exécution', rollback: 'Rollback', retry: 'Nouvel essai', unknown: 'Autre' },
    summary: {
      passed: 'Réussi',
      warning: 'Avertissements',
      failed: 'Échec',
      unknown: 'Inconnu'
    },
    detail: {
      title: 'Détails de exécution',
      titleWithId: 'Exécution détails {id}',
      description: 'Voir base informations, étape état, et journaux pour le exécution exécution.',
      eyebrow: 'Exécution',
      planLabel: 'Déploiement plan {plan}',
      loadingSteps: 'Chargement de étapes...',
      loadingLogs: 'Chargement de journaux...',
      noStepDetail: 'Aucun étape détails',
      notStarted: 'Non démarré',
      noSteps: 'Aucun étapes.',
      noLogs: 'Aucun journaux.'
    },
    tabs: {
      summary: 'Synthèse',
      steps: 'Étapes',
      logs: 'Journaux'
    }
  },
  plugins: {
    title: 'Plugins',
    description: 'Plugin, Providers, autorisation déclarations, signature validation, sandbox état, et isolation entrée points.',
    resourceName: 'Plugin',
    actions: {
      install: 'Installer plugin',
      detail: 'Détails',
      disable: 'Désactiver plugin',
      disableRisk: 'Désactivation un plugin Provider, modèle, et exécuteur capacités.'
    },
    columns: {
      name: 'Nom de plugin',
      status: 'État',
      risk: 'Risque',
      version: 'Version',
      signature: 'Signature'
    },
    metrics: {
      total: {
        title: 'Total des plugins',
        description: 'Installé et plugins.'
      },
      risky: {
        title: '-risque en attente',
        description: 'Plugins avec-risque autorisations, signature erreurs, ou sandbox isolation.'
      }
    },
    empty: {
      title: 'Aucun plugins',
      description: 'Revue autorisation,, et rollback avant plugins.'
    },
    detail: {
      title: 'Détails de plugin',
      titleWithName: 'Plugin {name}',
      description: 'Plugin détails sont affiché dans un fenêtre modale pendant le principal page conserve un compact liste.',
      versionLabel: 'Version {version}'
    },
    fields: {
      pluginId: 'ID du plugin',
      name: 'Nom de plugin',
      currentStatus: 'État actuel',
      version: 'Version',
      signatureStatus: 'Signature état',
      riskLevel: 'Risque niveau'
    }
  },
  deploymentPlans: {
    title: 'Plans de déploiement',
    description: 'Plan aperçu, impact portée, approbation, exécution, vérification, et rollback entrée points.',
    resourceName: 'Déploiement plan',
    apiActions: {
      submit: 'Soumettre déploiement plan',
      execute: 'Exécuter déploiement plan',
      cancel: 'Annuler déploiement plan',
      delete: 'Supprimer déploiement plan'
    },
    actions: {
      create: 'Créer déploiement plan',
      detail: 'Détails',
      edit: 'Modifier plan',
      dryRun: 'Dry-run impact aperçu',
      dryRunRisk: 'Uniquement un impact aperçu. il fait non exécuter le réel déploiement.',
      submit: 'Soumettre pour approbation',
      submitRisk: 'Après, le plan approbation ou en attente exécution état.',
      execute: 'Exécuter déploiement',
      executeRisk: 'Exécution modifie cible certificat configuration. terminé ou échec plans également utiliser ce entrée pour-exécution un dry-run impact aperçu en premier.',
      cancel: 'Annuler plan',
      cancelRisk: 'Uniquement déploiement plans. terminé déploiements sont non rollback retour.',
      rollback: 'Rollback exécution',
      rollbackRisk: 'Rollback modifie le cible service certificat configuration à nouveau et requiert un réel ID d’exécution.',
      delete: 'Supprimer plan',
      deleteRisk: '-le plan, déploiement cibles, exécution enregistrements, et associé audit historique. ce ne peut pas être.'
    },
    columns: {
      name: 'Nom de plan',
      status: 'État',
      currentAssetCertificateExpiresAt: 'certificat fin heure actuel',
      updateNeeded: 'Mettre à jour nécessaire',
      scheduledAt: 'Heure',
      actions: 'Actions'
    },
    metrics: {
      total: {
        title: 'Total des plans',
        description: 'Plans en attente pour approbation, en attente exécution, ou en cours.'
      },
      risky: {
        title: '-risque en attente',
        description: 'Plans production services ou rollback capacité.'
      }
    },
    fields: {
      planId: 'ID du plan',
      name: 'Nom de plan',
      status: 'Plan état',
      approvalStatus: 'Approbation état',
      certificateVersionId: 'Certificat version ID',
      certificateFormatId: 'Certificat format configuration ID',
      currentAssetCertificateExpiresAt: 'certificat fin heure actuel',
      updateNeeded: 'Mettre à jour nécessaire',
      targetSummary: 'Cible liaison synthèse',
      latestRun: 'Dernier exécution lot',
      approvalId: 'Approbation ID',
      snapshotHash: 'Instantané',
      failureReason: 'Échec raison',
      createdAt: 'Créé le',
      updatedAt: 'Mis à jour le'
    },
    links: {
      executions: 'Voir exécution enregistrements',
      bindings: 'Voir associé liaisons'
    },
    empty: {
      title: 'Aucun déploiement plans',
      description: 'Début depuis un certificat ou liaison, créer un impact aperçu dans le déploiement assistant, puis soumettre le plan.'
    },
    disabled: {
      missingApproval: 'Approbation informations est manquant, donc exécution est non autorisé.',
      needDryRun: 'Un réussi dry-run impact aperçu est requis avant réel exécution.',
      missingRunId: 'ID d’exécution est manquant, donc rollback est non autorisé.',
      missingSelection: 'Déploiement plan sélection est manquant'
    },
    common: {
      cancel: 'Annuler',
      close: 'Fermer',
      notConfigured: 'Non configuré',
      notProvided: 'Non fourni'
    },
    detail: {
      certificateVersionLabel: 'Version du certificat',
      description: 'Voir base plan informations, associé enregistrements, et le dernier exécution résultat.',
      emptyRelatedRecords: 'Aucun associé enregistrements.',
      loadingRelatedRecords: 'Chargement de associé enregistrements...',
      noExecutionRecords: 'Ce plan a aucun exécution enregistrements encore.',
      noTargetSummary: 'Cible synthèse non fourni',
      planIdLine: 'ID du plan {planId}',
      recordKinds: {
        certificateUpdate: 'Certificat mettre à jour',
        dryRun: 'Dry-run'
      },
      relatedPlan: 'Plan {planId}',
      relatedRun: 'Exécution {runId}',
      relatedSource: 'Source : {source}',
      tabs: {
        latestExecution: 'Dernier exécution',
        relatedRecords: 'Associé enregistrements',
        summary: 'Synthèse'
      },
      targetLabel: 'Cible',
      title: 'Détails de déploiement plan',
      titleWithName: 'Déploiement plan {name}',
      viewLogs: 'Voir journaux'
    },
    dryRunRequired: {
      copy: 'action: {action}. exécution un dry-run en premier, confirmer impact portée et contrôle résultats, puis avec réel exécution. actuel',
      description: 'Un réussi dry-run impact aperçu est requis avant réel exécution.',
      primaryAction: 'Exécuter d’abord un Dry-run',
      runningAction: 'Démarrage',
      title: 'Dry-run requis en premier'
    },
    execution: {
      applyName: 'Déploiement exécution {runId}',
      applyTitle: 'Certificat mettre à jour exécution',
      dryRunTitle: 'Dry-run résultat',
      fallbackName: 'Exécution {runId}',
      rollbackTitle: 'Certificat rollback exécution'
    },
    feedback: {
      cancelled: 'Déploiement plan annulé.',
      cancelledWithPlanId: 'Déploiement plan annulé. ID de plan: {planId}',
      deleted: 'Déploiement plan supprimé.',
      deletedWithPlanId: 'Déploiement plan supprimé. ID de plan: {planId}',
      dryRunStartedMissingRunId: 'dry-run démarré, mais le réponse est manquant ID d’exécution.',
      dryRunStartedWithRunId: 'dry-run démarré. exécution état est affiché dans le fenêtre modale. ID d’exécution: {runId}',
      dryRunTriggered: 'dry-run déclenché.',
      dryRunTriggeredWithPlanId: 'dry-run déclenché. ID de plan: {planId}',
      dryRunTriggeredWithRunId: 'dry-run déclenché. précontrôle progression est affiché dans le fenêtre modale. ID d’exécution: {runId}',
      executeTriggered: 'Déploiement exécution déclenché.',
      executeTriggeredWithPlanId: 'Déploiement exécution déclenché. ID de plan: {planId}',
      executeTriggeredWithRunId: 'Déploiement exécution déclenché. exécution progression est affiché dans le fenêtre modale. ID d’exécution: {runId}',
      loadedDraft: 'Brouillon plan chargé.',
      loadedDraftWithPlanId: 'Brouillon plan chargé. ID de plan: {planId}',
      savedWithPlanId: 'Déploiement plan enregistré. ID de plan: {planId}',
      submitted: 'Déploiement plan soumis.',
      submittedWithPlanId: 'Déploiement plan soumis. ID de plan: {planId}'
    },
    target: {
      controlPlane: 'Plateforme',
      noBindingInfo: 'Informations de liaison non fournies',
      noCertificateVariables: 'Certificat variables non lié',
      noHostHeader: 'Hôte Header non fourni',
      noOutputSelected: 'Aucun sortie sélectionné'
    },
    errors: {
      actionFailed: 'Échec de {action}',
      createReturnedMissingPlanId: 'Déploiement plan a été créé mais aucun ID de plan a été retourné',
      loadCreateDataFailed: 'Échec du chargement de déploiement plan création données',
      loadRelatedRecordsFailed: 'Échec du chargement de associé enregistrements',
      missingApplicationAssetIdForDryRun: 'Application actif ID est manquant, donc dry-run ne peut pas début.',
      missingApplicationAssetIdForSave: 'Application actif ID est manquant, donc le déploiement plan ne peut pas être enregistré.',
      missingPlanId: 'Déploiement plan ID est manquant. vide ID de plan requête bloqué.',
      missingPlanIdForAction: '{action} est manquant déploiement plan ID. vide ID de plan requête bloqué.',
      missingRunIdRequest: 'Exécution lot ID d’exécution est manquant. vide ID d’exécution requête bloqué.',
      saveFailed: 'Échec de l’enregistrement de déploiement plan',
      startDryRunFailed: 'Échec de l’opération : début dry-run'
    }
  },
  agents: {
    actions: {
      close: 'Fermer',
      delete: 'Supprimer',
      deleteRisk: 'Suppression supprime le Agent enregistrement directement et ne peut pas être.',
      detail: 'Détails',
      disable: 'Désactiver',
      disableRisk: 'Après désactivation, ce Agent réception nouveau tâches.',
      enable: 'Activer',
      enableRisk: 'Après, ce Agent planifiable à nouveau.'
    },
    app: {
      fallbackName: 'Application {index}'
    },
    certificate: {
      boundCertificate: 'Lié certificat',
      expiredDays: 'Expiré {days} jours il y a',
      expiresToday: 'Expire aujourd’hui',
      modalDescription: 'Affiche clé certificat informations utilisé par le actuel site liaison.',
      modalTitle: 'Détails du certificat',
      overviewDescription: 'Affiche certificat nom, émetteur, validité période, empreinte, et autre clé détails.',
      overviewTitle: 'Certificat vue d’ensemble',
      projectDetailDescription: 'Affiche projet certificat actif détails et associé utilisations dans le actuel Agent contexte.',
      projectDetailTitle: 'Détails de projet certificat',
      querying: '...',
      remainingDays: '{days} jours restant',
      remainingWithViewAction: '{remaining} /cliquer à voir certificat',
      statusExpired: 'Expiré',
      statusExpiring: 'Expire bientôt bientôt',
      statusLabel: 'État du certificat',
      statusUnknown: 'Validité inconnu',
      statusValid: 'Valide',
      view: 'Voir certificat',
      viewProjectDetail: 'Voir projet certificat détails'
    },
    certificateUsage: {
      iisSite: 'Site IIS de l’Agent',
      linuxSite: 'Site Linux de l’Agent',
      tomcatConnector: 'Agent Tomcat connecteur'
    },
    columns: {
      actions: 'Actions',
      hostname: 'Nom d’hôte',
      ipAddress: 'IP adresse',
      lastHeartbeat: 'Dernier heartbeat',
      onlineStatus: 'En ligne état',
      osType: 'Type d’OS',
      version: 'Version'
    },
    common: {
      defaultAddress: 'adresse par défaut',
      no: 'Aucun',
      noHostHeader: 'Aucun hôte Header',
      noListenAddress: 'Aucun écoute adresse',
      none: 'Aucun',
      notConfigured: 'Non configuré',
      notProvided: 'Non fourni',
      notWritable: 'Non inscriptible',
      unrecognized: 'Non reconnu',
      writable: 'Inscriptible',
      yes: 'Oui'
    },
    detail: {
      loading: 'Chargement de détails...',
      manualRescan: 'Manuel réanalyser',
      manualRescanCannotPullTasks: 'Ce Agent ne peut pas récupérer tâches, donc réanalyser ne peut pas exécution',
      manualRescanCreated: 'Manuel réanalyser tâche créé. en attente pour le Agent à récupérer il.',
      manualRescanSubmitting: 'Soumission réanalyser...',
      manualRescanUnsupportedType: 'Ce Agent type fait non manuel réanalyser',
      modalDescription: 'Affiche le Agent synthèse, exécution environnement, et IIS site données.',
      modalTitle: 'Détails de Agent',
      nodeEyebrow: 'Agent nœud',
      tabsAriaLabel: 'Agent détail onglets'
    },
    empty: {
      description: 'Cliquer installer Agent, choisir un plateforme et version, puis générer un unique-heure installer commande.',
      noFrameworkSites: 'Aucun {name} sites trouvé',
      noIisSites: 'Aucun IIS sites trouvé',
      noRuntimeLogs: 'Aucun exécution journaux',
      noTomcatApps: 'Aucun Tomcat applications trouvé',
      noTomcatConnectors: 'Aucun Tomcat connecteurs trouvé',
      title: 'Aucun Agents'
    },
    errors: {
      certificateAssetIncomplete: 'Certificat actif données est incomplet, donc détails ne peut pas être.',
      certificateAssetNotFound: 'Aucun certificat actif a été trouvé dans ce projet.',
      certificateAssetQueryFailed: 'Échec de l’opération : requête certificat actif.',
      detailDataMissing: 'Le détail API retourné aucun données.',
      generateInstallCommandFailed: 'Échec de l’opération : générer installer commande.',
      installCommandMissing: 'Le backend a non retourner un installer commande.',
      loadDetailFailed: 'Échec du chargement de détails.',
      manualRescanFailed: 'Échec de l’opération : début manuel réanalyser.'
    },
    fields: {
      agentVersion: 'Version de l’Agent',
      appCount: 'Nombre de application',
      appList: 'Liste de application',
      appPool: 'Application',
      arch: 'Architecture',
      binaryPath: 'Chemin',
      certificateFile: 'Certificat fichier',
      certificateName: 'Nom du certificat',
      certificateStore: 'Certificat enregistrer',
      certificateSubject: 'Certificat sujet',
      certificateThumbprint: 'Certificat empreinte',
      configFile: 'Configuration fichier',
      configPath: 'Configuration chemin',
      connectorCount: 'Nombre de connecteur',
      connectorList: 'Liste de connecteur',
      domain: 'Domaine',
      frameworkVersion: 'Version de {name}',
      healthStatus: 'Santé état',
      healthSummary: 'Santé synthèse',
      hostname: 'Nom d’hôte',
      httpsBinding: 'HTTPS liaison',
      httpsListen: 'HTTPS écoute',
      iisVersion: 'Version IIS',
      installPrefix: 'Installer préfixe',
      installStatus: 'Installer état',
      ipAddress: 'IP adresse',
      issuer: 'Émetteur',
      lastCapabilityReportAt: 'Dernier capacité rapport heure',
      lastHeartbeat: 'Dernier heartbeat',
      lastRecoveryAt: 'Dernier récupération heure',
      lastReportAt: 'Dernier rapport heure',
      linuxDistribution: 'Distribution Linux',
      listenAddress: 'Écoute adresse',
      notAfter: 'Non après',
      notBefore: 'Non avant',
      offlineDetected: 'Hors ligne',
      osType: 'Type d’OS',
      osVersion: 'Version de l’OS',
      patchVersion: 'Version',
      privateKeyOrKeystore: 'Privée clé /keystore',
      proxyTarget: 'Proxy cible',
      remainingDays: 'Restant jours',
      role: 'Rôle',
      runningStatus: 'En cours état',
      runtimeLog: 'Exécution journal',
      serviceName: 'Nom de service',
      sha256Fingerprint: 'Empreinte SHA-256',
      siteCount: 'Nombre de site',
      siteList: 'Liste de site',
      tlsConnector: 'TLS connecteur',
      tomcatVersion: 'Version Tomcat',
      zone: 'Zone'
    },
    health: {
      degraded: 'Dégradé',
      failed: 'Échec',
      healthy: 'Sain',
      unknown: 'Inconnu'
    },
    install: {
      bootstrapToken: 'Bootstrap Token',
      command: 'Installer commande',
      commandCopied: 'Installer commande copié',
      copyCommand: 'Copier installer commande',
      copyToken: 'Copier Token',
      expired: 'Expiré',
      generateCommand: 'Générer installer commande',
      generating: 'Génération...',
      modalDescription: 'Choisir plateforme et version à générer un unique-heure installer commande. le Token est valide pour 10 minutes et peut uniquement être utilisé une fois.',
      modalTitle: 'Installer Agent',
      platform: 'Plateforme',
      platformLinuxDescription: 'Pour,,,,, et autre Linux.',
      platformWindowsDescription: 'Pour Windows serveur et Windows 10/11. comme un système service après installation.',
      remainingTime: '{minutes} min {seconds} s',
      remainingValidity: 'Restant validité',
      singleUseHint: 'Une fois le bootstrap ce Token, il expire et ne peut pas être.',
      tokenCopied: 'Token copié',
      version: 'Version',
      versionLatest: 'Dernier ',
      zone: 'Zone'
    },
    labels: {
      certificatePath: 'Certificat: {value}',
      deployDirectory: 'Déployer répertoire: {value}',
      directory: 'Répertoire: {value}',
      keystorePath: 'Keystore : {value}',
      listenAddress: 'Écoute adresse: {value}',
      path: 'Chemin: {value}',
      privateKeyPath: 'Privée clé: {value}',
      reloadCommand: 'Rechargement commande: {value}',
      siteName: 'Site nom: {value}',
      taskType: 'Tâche type: {value}',
      testCommand: 'Test commande: {value}',
      thumbprint: 'Empreinte: {value}'
    },
    linux: {
      certDirectoryWritable: 'Certificat répertoire: {status}',
      helperRequired: 'Requis',
      keyDirectoryWritable: 'Privée clé répertoire: {status}',
      permissionMode: 'Autorisation mode: {mode}'
    },
    logs: {
      collapse: 'Réduire',
      expand: 'Développer',
      listAriaLabel: 'Liste de exécution journal'
    },
    metrics: {
      abnormalDescription: 'Hors ligne, échec, ou en dérive Agents nécessite priorité.',
      abnormalTitle: 'Anormal Agents',
      totalDescription: 'Numéro de Agents actuellement enregistré avec le contrôle plan.',
      totalTitle: 'Total des Agents'
    },
    page: {
      description: 'Voir Agents, générer installer pour, et détails dans un fenêtre modale.',
      installAgent: 'Installer Agent'
    },
    sections: {
      frameworkOverviewDescription: 'Affiche {name} installation état, en cours état, et configuration emplacement sur le hôte.',
      frameworkOverviewTitle: '{name} vue d’ensemble',
      frameworkSitesDescription: 'Affiche sites,, domaines, inverse proxy cibles, et certificat chemins découvert par {name}.',
      frameworkSitesTitle: 'Sites {name}',
      healthDescription: 'Affiche contrôle-plan hors ligne, dernier récupération heure, en attente résultat, et santé synthèse.',
      healthTitle: 'Santé et récupération',
      iisOverviewDescription: 'Affiche IIS installation état et version informations sur le hôte.',
      iisOverviewTitle: 'IIS vue d’ensemble',
      iisSitesDescription: 'Affiche IIS sites web, site chemins, liaison ports, et certificat sujets.',
      iisSitesTitle: 'Sites IIS',
      logOverviewDescription: 'Affiche le dernier capacité rapport heure à si détail données est.',
      logOverviewTitle: 'Journal vue d’ensemble',
      mainInfoDescription: 'Affiche Agent identité, rôle, et dernier heartbeat.',
      mainInfoTitle: 'Principal informations',
      runtimeDescription: 'Affiche exécution système et version informations rapporté par le Agent.',
      runtimeLogsDescription: 'Affiche exécution journaux pour manuel, heartbeat, et capacité rapport.',
      runtimeLogsTitle: 'Exécution journaux',
      runtimeTitle: 'Exécution environnement',
      tomcatAppsDescription: 'Affiche application chemins et déploiement découvert dans Tomcat hôte/contexte.',
      tomcatAppsTitle: 'Tomcat applications',
      tomcatConnectorsDescription: 'Affiche Tomcat connecteur écoute adresse, protocole, TLS basculer, et certificat chemin.',
      tomcatConnectorsTitle: 'Tomcat connecteurs',
      tomcatOverviewDescription: 'Affiche Tomcat installation état, en cours état, et chemin sur le hôte.',
      tomcatOverviewTitle: 'Tomcat vue d’ensemble'
    },
    site: {
      domainCount: '{count} domaines',
      fallbackName: 'Site {index}'
    },
    siteMode: {
      reverseProxy: 'Inverse proxy',
      staticRoot: 'Site'
    },
    status: {
      installed: 'Installé',
      notInstalled: 'Non installé',
      notRunning: 'Non en cours',
      running: 'En cours'
    },
    tabs: {
      logs: 'Journaux',
      overview: 'Vue d’ensemble'
    }
  },
  dashboard: {
    aria: {
      assetHeatmap: 'Application actif état',
      certificateStatusList: 'Liste de certificat état',
      metrics: 'Indicateurs',
      quickActions: 'Principal entrée points',
      statusHeatmap: 'Certificat, Agent, passerelle, et application actif état',
      statusLegend: 'État'
    },
    assets: {
      groupCount: '{summary} {total} éléments',
      title: 'Application actif état',
      updatedAt: 'Mis à jour à {time}'
    },
    audit: {
      description: 'Échecs, refus,-risque événements, et clé métier modifications.',
      title: 'Audit journaux'
    },
    certificateState: {
      critical: 'Proche expiration',
      expired: 'Expiré',
      expiring: 'Expire bientôt bientôt',
      unknown: 'Inconnu',
      valid: 'Normal'
    },
    days: {
      expired: 'Expiré {days} jours il y a',
      expiresToday: 'Expire aujourd’hui',
      notRecorded: 'Non enregistré',
      remaining: '{days} jours'
    },
    empty: {
      noAuditLogs: 'Aucun audit journaux',
      noCertificateStatus: 'Aucun certificat état données',
      noObjects: 'Aucun objets'
    },
    errors: {
      loadFailed: 'Échec du chargement de vue d’ensemble données',
      missingOverviewData: 'Vue d’ensemble API retourné aucun données'
    },
    legend: {
      disabled: 'Désactivé',
      error: 'Anormal',
      ok: 'Normal',
      unknown: 'Inconnu',
      warning: 'Attention'
    },
    loading: {
      description: 'Vue d’ensemble données.',
      title: 'Chargement'
    },
    metrics: {
      activeAgents: {
        title: 'Actif Agents',
        description: 'Agents actuellement en ligne et planifiable.'
      },
      activeGateways: {
        title: 'Actif passerelles',
        description: 'Isolation-zone passerelles actuellement en ligne.'
      },
      applications: {
        title: 'applications actuel',
        description: 'Géré application entrée actifs.'
      },
      expiringCertificates: {
        title: 'Certificats expire bientôt dans 15 jours',
        description: 'Certificats ce nécessite renouvellement ou.'
      },
      managedBindings: {
        title: 'Géré liaisons',
        description: 'Certificat liaisons déjà dans géré état.'
      },
      validCertificates: {
        title: 'Actif certificats',
        description: 'Certificat versions ce sont actif et non expiré.'
      }
    },
    quickActions: {
      agents: {
        title: 'Agent',
        description: 'Voir en ligne état et tâche capacités.'
      },
      assets: {
        title: 'Actifs applicatifs',
        description: 'Maintenir domaines, ports, et déploiement cibles.'
      },
      audits: {
        title: 'Journaux d’audit',
        description: 'Opérateurs et exécution résultats.'
      },
      certificates: {
        title: 'Certificat gestion',
        description: 'Importer, voir, et certificats.'
      },
      deploymentPlans: {
        title: 'Plans de déploiement',
        description: 'Créer et exécuter certificat mettre à jour plans.'
      },
      gateways: {
        title: 'Passerelle',
        description: 'Gérer isolation-zone exécution entrée points.'
      }
    },
    statusBlock: {
      detail: {
        certificateRemaining: '{name}, {days}'
      },
      status: {
        active: 'Actif',
        critical: 'Proche expiration',
        deleted: 'Supprimé',
        disabled: 'Désactivé',
        expired: 'Expiré',
        expiring: 'Expire bientôt bientôt',
        inactive: 'Inactif',
        offline: 'Hors ligne',
        online: 'En ligne',
        retired: 'Retiré',
        revoked: 'Révoqué',
        stale: 'Obsolète',
        unknown: 'Inconnu',
        unreachable: 'Injoignable',
        upgrading: 'Mise à niveau en cours',
        valid: 'Normal'
      }
    },
    statusGroups: {
      agents: {
        title: 'Agent'
      },
      applicationAssets: {
        title: 'Actifs applicatifs'
      },
      certificates: {
        title: 'Certificats'
      },
      gateways: {
        title: 'Passerelles'
      },
      summary: {
        allNormal: 'Tous normal',
        needsAttention: '{count} nécessite attention'
      }
    },
    table: {
      bindings: 'Liaisons',
      certificate: 'Certificat',
      domain: 'Domaine',
      notAfterMissing: 'Expiration heure non enregistré',
      remainingTime: 'Restant heure',
      status: 'État'
    }
  },
  gateways: {
    actions: {
      addGatewayAgent: 'Ajouter passerelle Agent',
      close: 'Fermer',
      copied: 'Copié',
      copyEnableCommand: 'Copier activer commande',
      copyInstallCommand: 'Copier installer commande',
      detail: 'Détails',
      enableExistingAgent: 'Activer passerelle sur existant Agent',
      generateEnableCommand: 'Générer activer commande',
      generateInstallCommand: 'Générer installer commande',
      generating: 'Génération...',
      probe: 'Test',
      probeRisk: 'Un test depuis ce passerelle région.'
    },
    columns: {
      actions: 'Actions',
      gateway: 'Passerelle',
      lastHeartbeat: 'Dernier heartbeat',
      load: 'Charger',
      region: 'Région',
      status: 'État'
    },
    detail: {
      abilities: {
        agentTask: {
          description: 'Transférer déploiement, contrôle, et autre tâches à Agents dans ce région.',
          title: 'Tâche transfert'
        },
        directControl: {
          description: 'Transférer opérations à Agents dans ce région sans contrôle-plan accès à interne ports.',
          title: 'Distant contrôle transfert'
        },
        probe: {
          description: 'Contrôle si hôtes, sites web, ou Agents sont joignable depuis ce région.',
          title: 'Contrôle'
        }
      },
      eyebrow: 'Régional passerelle',
      heroDescription: 'Test en cours et transfert dans région {region}',
      overview: {
        availableCapacity: 'Disponible',
        connectionStatus: 'Connexion état',
        lastContact: 'Dernier',
        processing: 'Traitement',
        serviceRegion: 'Service région',
        successRate: 'Succès'
      },
      sections: {
        overview: 'Exécution vue d’ensemble',
        services: 'Disponible services'
      }
    },
    empty: {
      description: 'Ajouter un passerelle Agent, ou activer le passerelle rôle sur un existant Agent.',
      title: 'Aucun passerelles'
    },
    errors: {
      generateEnableCommandFailed: 'Échec de l’opération : générer passerelle activer commande.',
      generateInstallCommandFailed: 'Échec de l’opération : générer passerelle Agent installer commande.',
      missingEnableCommand: 'Le backend a non retourner un passerelle activer commande.',
      missingInstallCommand: 'Le backend a non retourner un passerelle Agent installer commande.'
    },
    fields: {
      config: 'Configuration',
      enableCommand: 'Activer commande',
      expiresAt: 'Expire à',
      installCode: 'Installer code',
      installCommand: 'Installer commande',
      platform: 'Plateforme',
      region: 'Région',
      service: 'Service',
      unboundAgent: 'Faire non lier un Agent'
    },
    links: {
      assets: 'Voir actifs',
      executions: 'Voir exécution enregistrements'
    },
    modals: {
      detail: {
        title: 'Détails de passerelle'
      },
      enable: {
        title: 'Activer passerelle sur existant Agent'
      },
      install: {
        title: 'Ajouter passerelle Agent'
      }
    },
    page: {
      description: 'Gérer régional passerelle Agents.',
      title: 'Passerelles'
    },
    platforms: {
      linuxSystemd: {
        description: 'Installer passerelle Agent service sur un Linux hôte'
      },
      windowsService: {
        description: 'Installer passerelle Agent service sur un Windows hôte'
      }
    },
    resourceName: 'Passerelle',
    status: {
      disabled: 'Désactivé',
      offline: 'Hors ligne',
      online: 'En ligne',
      revoked: 'Révoqué',
      upgrading: 'Mise à niveau en cours'
    },
    values: {
      availableCapacity: 'Peut accepter {count} tâches',
      defaultRegion: 'région par défaut',
      regionGatewayName: '{region} passerelle',
      taskCount: '{count} tâches'
    }
  },
  auditFormat: {
    actions: {
      secretResolveService: 'Service lit Secret',
      secretResolve: 'Exécuteur lit Secret',
      secretCreate: 'Créer Secret',
      secretVersionCreate: 'Créer Secret version',
      secretRotate: 'Secret',
      certificateImport: 'Importer un certificat',
      certificateFormatUpdate: 'Mettre à jour certificat artefact',
      certificateFormatDelete: 'Supprimer certificat artefact',
      deploymentCreate: 'Créer déploiement plan',
      deploymentExecute: 'Exécuter déploiement plan',
      deploymentRollback: 'Requête rollback',
      approvalCreate: 'Créer approbation',
      approvalApprove: 'Requête',
      approvalReject: 'Refuser requête',
      authLogin: 'Utilisateur connexion',
      authLogout: 'Utilisateur déconnexion'
    },
    events: {
      authLoginSuccess: 'connexion réussi',
      authLoginFailure: 'Échec de connexion',
      authLoginFailed: 'Échec de connexion',
      authLogout: 'Connecté sortie',
      authExternalLoginSuccess: 'externe identité connexion réussi',
      authExternalLoginFailed: 'Échec de externe identité connexion',
      secretCreated: 'Créé Secret',
      secretVersionCreated: 'Créé Secret version',
      secretUsed: 'Lire Secret',
      secretRotated: 'Secret',
      permissionDenied: 'Autorisation refusé',
      approvalCreated: 'Créé approbation',
      approvalApproved: 'Approbation approuvé',
      approvalRejected: 'Approbation refusé',
      certificateImported: 'Certificat modifié',
      deploymentCreated: 'Créé déploiement',
      deploymentExecuted: 'Exécuté déploiement',
      deploymentRollbackRequested: 'Demandé déploiement rollback',
      pluginInstalled: 'Installé plugin',
      pluginPermissionDenied: 'Plugin autorisation refusé',
      workflowTemplateExecuted: 'Exécuté workflow modèle'
    },
    types: {
      audit: 'Audit',
      auth: 'Authentification',
      security: 'Sécurité',
      secret: 'Secret',
      certificate: 'Certificat',
      certificateVersion: 'Certificat',
      certificateVersionFormat: 'Certificat artefact',
      deployment: 'Déploiement',
      deploymentPlan: 'Déploiement plan',
      execution: 'Exécution',
      approval: 'Approbation',
      permission: 'Autorisation',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow',
      gateway: 'Passerelle',
      agent: 'Agent',
      serviceAsset: 'Application actif',
      binding: 'Liaison'
    },
    actors: {
      user: 'Utilisateur',
      system: 'Système',
      agent: 'Agent',
      plugin: 'Plugin',
      executor: 'Exécuteur'
    },
    resources: {
      secret: 'Secret',
      secretVersion: 'Version du Secret',
      certificate: 'Certificat',
      certificateVersion: 'Version du certificat',
      certificateVersionFormat: 'Certificat artefact',
      deployment: 'Déploiement',
      deploymentPlan: 'Déploiement plan',
      execution: 'Exécution tâche',
      executionRun: 'Exécution tâche',
      approval: 'Approbation',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow modèle',
      gateway: 'Passerelle',
      agent: 'Agent',
      serviceAsset: 'Application actif',
      binding: 'Certificat liaison',
      auditLog: 'Audit journal'
    },
    results: {
      success: 'Succès',
      failure: 'Échec',
      denied: 'Refusé'
    },
    verbs: {
      success: 'Terminé',
      failure: 'Échec',
      denied: 'Refusé'
    },
    tokens: {
      auth: 'Authentification',
      login: 'Connexion',
      logout: 'Déconnexion',
      external: 'Externe',
      secret: 'Secret',
      resolve: 'Lire',
      service: 'Service',
      used: 'Utilisé',
      created: 'Créé',
      create: 'Créer',
      updated: 'Mis à jour',
      update: 'Mettre à jour',
      deleted: 'Supprimé',
      delete: 'Supprimer',
      version: 'Version',
      certificate: 'Certificat',
      imported: 'Importé',
      import: 'Importer',
      format: 'Artefact',
      deployment: 'Déploiement',
      executed: 'Exécuté',
      execute: 'Exécuter',
      rollback: 'Rollback',
      requested: 'Demandé',
      approval: 'Approbation',
      approved: 'Approuvé',
      rejected: 'Refusé',
      permission: 'Autorisation',
      denied: 'Refusé',
      gateway: 'Passerelle',
      credential: 'Identifiant',
      issued: 'émission',
      revoked: 'Révoqué',
      task: 'Tâche',
      evidence: 'Preuve',
      recorded: 'Enregistré',
      result: 'Résultat',
      plugin: 'Plugin',
      workflow: 'Workflow',
      template: 'Modèle',
      synced: 'Synchronisé',
      tested: 'test',
      source: 'Source',
      identity: 'Identité source',
      group: 'Groupe',
      mapping: 'Mappage'
    },
    actorWithId: '{actorType} {actorId}',
    summary: '{actor}{verb} « {title} », objet : {resource}.',
    fallbacks: {
      unknown: 'Inconnu'
    }
  },
  audit: {
    page: {
      title: 'Journaux d’audit',
      description: 'Journaux par utilisateur actions, échecs/refus, et clé métier modifications pendant synthèses.'
    },
    actions: {
      exportEvidence: 'Exporter audit preuve',
      exporting: 'Exportation...',
      refreshing: 'Actualisation...'
    },
    errors: {
      exportFailed: 'Échec de l’opération : exporter audit preuve',
      loadFailed: 'Échec du chargement de audit journaux',
      withRequestId: '{message} ({requestId})'
    },
    metrics: {
      ariaLabel: 'Audit vue d’ensemble',
      total: {
        title: 'Total',
        description: 'Traçable opération enregistrements dans le actuel filtre portée.'
      },
      failed: {
        title: 'Échec /refusé',
        description: 'Échec exécutions et refusé accès ce nécessite priorité revue.'
      },
      userActions: {
        title: 'Utilisateur actions',
        description: 'Métier modifications et accès actions directement par utilisateurs.'
      }
    },
    list: {
      ariaLabel: 'Liste de audit journal',
      title: 'Liste de journal',
      summary: '{total} au total, triés par défaut du plus récent au plus ancien.',
      timeNotRecorded: 'Heure non enregistré'
    },
    empty: {
      title: 'Aucun audit événements',
      description: 'Clé opérations être traçable à opération enregistrements et tâche enregistrements.'
    }
  },
  securityAdmin: {
    emptyValue: '—',
    errors: {
      loadFailed: 'Échec de charger',
      submitFailed: 'Échec de soumettre'
    },
    actions: {
      createResource: 'Ajouter {resource}',
      submitting: 'Soumission...'
    },
    modal: {
      createDescription: 'Remplir dans le champs ci-dessous à créer {resource}'
    },
    placeholders: {
      selectField: 'Sélectionner {field}'
    },
    table: {
      ariaLabel: 'Liste de gestion',
      resourceList: 'Liste des {resource}',
      total: '{count} au total'
    }
  },
  settings: {
    securityLabel: 'Sécurité paramètres entrée',
    permissionPolicies: {
      resourceName: 'Autorisation politique',
      actions: {
        create: 'Créer politique'
      },
      columns: {
        id: 'Politique ID',
        subjectType: 'Sujet type',
        subjectId: 'Sujet ID',
        effect: 'Effet',
        actions: 'Actions',
        resourceTypes: 'Ressource types',
        scope: 'Portée'
      },
      fields: {
        subjectType: 'Sujet type',
        subjectId: 'Sujet ID',
        effect: 'Effet',
        actions: 'Actions',
        resourceTypes: 'Ressource types',
        tenantId: 'Tenant portée'
      },
      subjectTypes: {
        role: 'Rôle',
        user: 'Utilisateur',
        plugin: 'Plugin',
        executor: 'Exécuteur'
      },
      effects: {
        allow: 'Autoriser',
        deny: 'Refuser'
      }
    },
    groupRoleMappings: {
      resourceName: 'Groupe mappage',
      actions: {
        create: 'Créer mappage'
      },
      columns: {
        sourceId: 'Identité source ID',
        externalGroup: 'Externe groupe',
        roleId: 'Local rôle',
        enabled: 'Activé',
        updatedAt: 'Mis à jour le'
      },
      fields: {
        sourceId: 'Identité source ID',
        externalGroup: 'Externe groupe',
        roleId: 'Local rôle ID'
      }
    },
    users: {
      title: 'Compte',
      summary: {
        groups: '{count} au total',
        users: '{total} au total, {selected} sélectionnés'
      },
      actions: {
        createUser: 'Créer utilisateur',
        addGroup: 'Ajouter groupe',
        bulkDelete: 'Masse supprimer',
        edit: 'Modifier',
        delete: 'Supprimer',
        lookupLoading: 'À jour...',
        lookupUser: 'Aperçu à jour utilisateur',
        lookupGroup: 'Aperçu à jour groupe',
        creating: 'Création...',
        saving: 'Enregistrement...',
        saveChanges: 'Enregistrer les modifications',
        adding: '...'
      },
      risks: {
        bulkDelete: 'Masse supprimer supprime local identifiants et rôle liaisons pour sélectionné utilisateurs.',
        deleteUser: 'Suppression le utilisateur supprime ce local identifiants et rôle liaisons.'
      },
      tabs: {
        users: 'Utilisateurs',
        groups: 'Groupes'
      },
      empty: {
        users: 'Aucun utilisateurs',
        groups: 'Aucun groupes'
      },
      columns: {
        username: 'Nom d’utilisateur',
        displayName: 'Nom de affichage',
        email: 'E-mail',
        source: 'Source',
        identitySourceName: 'Nom de identité source',
        status: 'État',
        tenant: 'Tenant',
        roles: 'Rôles',
        lastSyncedAt: 'Dernier synchronisé',
        updatedAt: 'Mis à jour le',
        actions: 'Actions',
        groupName: 'Nom de groupe',
        code: 'Code',
        externalRef: 'Externe référence'
      },
      dialog: {
        userCreateTitle: 'Créer utilisateur',
        userEditTitle: 'Modifier utilisateur',
        userCreateDescription: 'Créer un local utilisateur, ou aperçu à jour un identité-source utilisateur par utilisateur nom et créer un lié utilisateur.',
        userEditDescription: 'Modifier affichage nom, e-mail, état, et rôles.',
        groupCreateTitle: 'Ajouter groupe',
        groupCreateDescription: 'Créer un local groupe, ou aperçu à jour un externe groupe depuis un identité source.'
      },
      aria: {
        principalType: 'Type',
        createMode: 'Création mode',
        externalUserProfile: 'Externe identité utilisateur profil',
        groupCreateMode: 'Groupe création mode',
        externalGroupProfile: 'Externe identité groupe profil'
      },
      modes: {
        localUser: 'Local utilisateur',
        externalUser: 'Identité source utilisateur',
        localGroup: 'Local groupe',
        externalGroup: 'Identité source groupe'
      },
      fields: {
        identitySource: 'Identité source',
        directoryUsername: 'Nom de répertoire utilisateur',
        username: 'Nom d’utilisateur',
        displayName: 'Nom de affichage',
        email: 'E-mail',
        role: 'Rôle',
        initialPassword: 'Initial mot de passe',
        status: 'État',
        directoryGroupName: 'Nom de répertoire groupe',
        groupName: 'Nom de groupe',
        groupCode: 'Groupe code',
        directoryDn: 'Répertoire DN'
      },
      placeholders: {
        selectIdentitySource: 'Sélectionner un identité source',
        directoryUsername: 'Pour exemple',
        displayName: 'Certificat opérateur',
        initialPassword: 'Saisir un initial mot de passe',
        directoryGroupName: 'Pour exemple GCAC-',
        groupName: 'Certificat opérations groupe'
      },
      options: {
        unset: 'Non définir'
      },
      status: {
        active: 'Activé',
        disabled: 'Désactivé'
      },
      labels: {
        identitySourceOption: '{name} ({type})'
      },
      errors: {
        loadUsersFailed: 'Échec du chargement de utilisateurs',
        loadGroupsFailed: 'Échec du chargement de groupes',
        createUserFailed: 'Échec de la création de utilisateur',
        updateUserFailed: 'Échec de la mise à jour de utilisateur',
        externalUserEmpty: 'Le identité source a non retourner un utilisateur profil',
        lookupExternalUserFailed: 'Échec de l’opération : aperçu à jour identité-source utilisateur',
        externalGroupEmpty: 'Le identité source a non retourner un groupe profil',
        lookupExternalGroupFailed: 'Échec de l’opération : aperçu à jour identité-source groupe',
        createGroupFailed: 'Échec de la création de groupe',
        deleteUsersFailed: 'Échec de la suppression de utilisateurs'
      }
    },
    roles: {
      page: {
        title: 'Rôle autorisations',
        description: 'Gérer autorisation objet portées par rôle, et affecter utilisateurs ou groupes à rôles.'
      },
      actions: {
        createRole: 'Créer rôle',
        refreshObjects: 'Actualiser objets',
        loading: 'Chargement...',
        creating: 'Création...',
        saving: 'Enregistrement...',
        detail: 'Détails',
        authorize: 'Autoriser',
        grantPermission: 'Accorder autorisation',
        assignMembers: 'Affecter membres',
        delete: 'Supprimer',
        deleteRole: 'Supprimer rôle',
        deleting: 'Suppression...',
        clearSelection: 'Effacer sélection'
      },
      columns: {
        roleId: 'Rôle ID',
        code: 'Code',
        name: 'Nom',
        builtin: 'Intégré',
        policyCount: 'Nombre de politique',
        permissions: 'Autorisations',
        actions: 'Actions',
        objectScope: 'Objet portée',
        accessLevel: 'Accès niveau',
        effect: 'Effet',
        memberType: 'Membre type',
        member: 'Membre'
      },
      table: {
        emptyRoles: 'Aucun rôles',
        roleRecords: 'Rôle enregistrements',
        emptyGrants: 'Ce rôle a aucun objet autorisations',
        currentPermissions: 'rôle autorisations actuel',
        emptyMembers: 'Ce rôle a aucun membre affectations',
        assignedMembers: 'Membres'
      },
      categories: {
        certificate: 'Certificat',
        gateway: 'Passerelle',
        agent: 'Agent',
        serviceAsset: 'Application actif',
        deploymentPlan: 'Déploiement plan',
        workflow: 'Workflow',
        auditLog: 'Journal',
        systemSetting: 'Système'
      },
      accessLevel: {
        read: 'Lire uniquement',
        edit: 'Modifier',
        control: 'Complet contrôle'
      },
      effect: {
        allow: 'Autoriser',
        deny: 'Refuser'
      },
      principal: {
        user: 'Utilisateur',
        group: 'Groupe',
        externalGroup: 'Identité source groupe'
      },
      summary: {
        selectedMembers: '{count} membres sélectionné',
        chooseMembers: 'Sélectionner utilisateurs ou groupes',
        selectedScopes: '{count} portées sélectionné',
        chooseObjectNode: 'Sélectionner un objet arborescence nœud',
        selectedScopeLabel: 'Sélectionné portées',
        selectedMemberLabel: 'Sélectionné membres'
      },
      tree: {
        rootLabel: 'Tous objets',
        rootDescription: 'Tous autorisable métier objets',
        typeDescription: 'Tous {category} enregistrements',
        allBusinessObjects: 'Tous métier objets',
        selectedScopeAria: 'Sélectionné autorisation portées',
        objectTreeAria: 'Autorisable objet arborescence',
        authorizableObjects: 'Autorisable objets',
        loading: 'Chargement de objet arborescence...',
        kind: {
          all: 'Tous',
          category: 'Catégorie',
          record: 'Enregistrement'
        }
      },
      format: {
        labelWithId: '{label} ({id})',
        recordFallback: '{category} {value}',
        unnamedRecord: 'enregistrement sans nom'
      },
      detail: {
        title: 'Détails de rôle',
        titleWithName: 'Rôle {name}',
        description: 'Maintenir objet portées, concret objets, accès, et membre affectations ici.'
      },
      create: {
        title: 'Créer rôle',
        description: 'Le rôle et accorder objet portées directement.',
        nameLabel: 'Nom de rôle',
        namePlaceholder: 'Certificat opérateur',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'Pour certificat opérations',
        authorizedRole: 'Autorisé rôle',
        newRole: 'Nouveau rôle'
      },
      grant: {
        title: 'Accorder rôle autorisation',
        description: 'Sélectionner portées depuis le objet arborescence et définir le accès niveau pour eux.',
        roleLabel: 'Rôle'
      },
      member: {
        title: 'Affecter membres',
        titleWithName: 'Affecter membres: {name}',
        description: 'Sélectionner utilisateurs ou groupes. le système eux à le existant autorisé objet portées.',
        targetRole: 'Cible rôle',
        authorizedScope: 'Autorisé portées',
        objectScopeCount: '{count} objet portées',
        selectedMembersAria: 'Sélectionné membres',
        assignableMembersAria: 'Affectable membres',
        emptyAssignable: 'Aucun affectable {type}'
      },
      errors: {
        loadObjectTreeFailed: 'Échec du chargement de objet arborescence',
        loadDataFailed: 'Échec du chargement de autorisation gestion données',
        missingRoleId: 'Le backend a non retourner un rôle ID',
        createRoleFailed: 'Échec de la création de rôle',
        grantRoleFailed: 'Échec de l’opération : accorder rôle autorisation',
        roleNoObjectScopes: 'Ce rôle a aucun autorisé objet portées encore. accorder autorisations à le rôle en premier.',
        assignMembersFailed: 'Échec de l’opération : affecter membres',
        deleteRoleFailed: 'Échec de la suppression de rôle',
        missingObjectSetId: 'Le backend a non retourner un objet portée ID'
      },
      confirm: {
        deleteRole: 'Confirmer la suppression du rôle « {name} » ? Les affectations utilisateur et autorisations d’objets liées à ce rôle seront supprimées en même temps.'
      },
      auditLogs: {
        auth: {
          name: 'Authentification connexion journaux',
          description: 'Connexion, déconnexion, et externe identité source connexion'
        },
        security: {
          name: 'Sécurité gestion journaux',
          description: 'Utilisateur, rôle, autorisation, et identité source modifications'
        },
        certificate: {
          name: 'Certificat journaux',
          description: 'Certificat importer, version, format, et liaison opérations'
        },
        asset: {
          name: 'Actif journaux',
          description: 'Application actif, hôte, service instance, et site actif opérations'
        },
        gateway: {
          name: 'Passerelle journaux',
          description: 'Passerelle route, test, et état modifications'
        },
        agent: {
          name: 'Agent journaux',
          description: 'Agent, heartbeat, tâche, et mise à niveau opérations'
        },
        deployment: {
          name: 'Déploiement plan journaux',
          description: 'Déploiement plans, exécution, rollback, et approbation'
        },
        workflow: {
          name: 'Workflow journaux',
          description: 'Workflow modèle et exécution opérations'
        },
        secret: {
          name: 'Secret journaux',
          description: 'Secret création, utiliser, et'
        },
        system: {
          name: 'Système journaux',
          description: 'Système paramètres et plateforme-niveau événements'
        }
      }
    },
    identitySources: {
      actions: {
        create: 'Créer identité source',
        edit: 'Modifier',
        delete: 'Supprimer',
        creating: 'Création...',
        saving: 'Enregistrement...',
        saveChanges: 'Enregistrer les modifications',
        expandAdvanced: 'Paramètres de développer avancé',
        collapseAdvanced: 'Paramètres de réduire avancé'
      },
      columns: {
        name: 'Nom',
        type: 'Répertoire type',
        server: 'Serveur',
        status: 'État',
        actions: 'Actions'
      },
      table: {
        title: 'Liste de identité source',
        total: '{count} au total'
      },
      empty: 'Aucun identité sources',
      dialog: {
        createTitle: 'Créer identité source',
        editTitle: 'Modifier identité source',
        createDescription: 'Remplir dans base connexion informations filtres et répertoire type sont dans avancé paramètres.',
        editDescription: 'Mettre à jour identité source configuration. à mettre à jour le service compte mot de passe, saisir un nouveau mot de passe.'
      },
      fields: {
        name: 'Nom',
        domain: 'Domaine',
        protocol: 'Protocole',
        serverAddress: 'Serveur adresse',
        bindDn: 'Service compte DN',
        bindPassword: 'Service compte mot de passe',
        directoryType: 'Répertoire type',
        defaultRole: 'rôle par défaut',
        enabled: 'Activé état',
        userDnTemplate: 'Utilisateur DN/UPN modèle',
        userFilter: 'Utilisateur filtre',
        groupFilter: 'Groupe filtre',
        syncUserFilter: 'Synchroniser utilisateur filtre',
        requireGroupMapping: 'Nécessiter connexion utilisateurs à correspondre un groupe mappage'
      },
      placeholders: {
        name: 'Pour exemple: entreprise AD',
        bindPasswordCreate: 'Saisir le service compte mot de passe',
        bindPasswordEdit: 'Laisser vide à conserver le existant mot de passe',
        autoByDirectoryType: 'Laisser vide à depuis répertoire type',
        userFilter: 'Exemple : (uid={{username}})',
        groupFilter: 'Exemple : (member={{userDn}})'
      },
      labels: {
        finalUrl: 'URL finale : {url}'
      },
      options: {
        unset: 'Non définir'
      },
      status: {
        enabled: 'Activé',
        disabled: 'Désactivé',
        disabledShort: 'Désactivé'
      },
      types: {
        ldap: 'LDAP standard'
      },
      risks: {
        delete: 'Suppression le identité source connexion, synchroniser, et groupe mappages pour ce répertoire.'
      },
      secret: {
        bindPasswordName: '{name} LDAP service compte mot de passe'
      },
      messages: {
        createSuccess: 'identité source créé',
        updateSuccess: 'identité source mis à jour'
      },
      errors: {
        loadFailed: 'Échec du chargement de identité sources',
        createBindPasswordSecretFailed: 'Échec de la création de service compte mot de passe Secret',
        createFailed: 'Échec de la création de identité source',
        updateFailed: 'Échec de la mise à jour de identité source',
        deleteFailed: 'Échec de la suppression de identité source'
      }
    }
  },
  bindings: {
    actions: {
      create: 'Nouveau configuration fichier',
      edit: 'Modifier',
      delete: 'Supprimer',
      deleting: 'Suppression...',
      applyTemplate: 'Appliquer intégré-dans modèle',
      saving: 'Enregistrement...',
      confirmSave: 'Enregistrer'
    },
    columns: {
      configName: 'Nom de configuration',
      targetSummary: 'Cible environnement',
      displayFormat: 'Contenu format',
      extension: 'Extension',
      encodingSummary: 'Encodage',
      exportSummary: 'Contenu /exporter options',
      actions: 'Actions'
    },
    dialog: {
      createTitle: 'Créer certificat format configuration',
      editTitle: 'Modifier certificat format configuration',
      description: 'Sélectionner le système et cible plateforme, appliquer un intégré-dans modèle, puis ajuster chaque option et définir quoi le unique artefact contient.'
    },
    list: {
      title: 'Liste de certificat format configuration',
      descriptionWithCount: 'Réutilisable certificat format modèles sont enregistré ici. {count} actuellement.'
    },
    empty: {
      text: 'Aucun certificat format configurations'
    },
    fields: {
      contentFormat: 'Contenu format',
      systemPlatform: 'Système plateforme',
      runtimePlatform: 'Cible plateforme',
      configName: 'Nom de configuration',
      backendFormat: 'Format backend',
      outputExtension: 'Sortie extension',
      expiresAt: 'Configuration expiration heure (facultatif)',
      certificateEncoding: 'Certificat encodage',
      certificateContentEncoding: 'Certificat contenu encodage',
      privateKeyEncoding: 'Privée clé encodage',
      includeLeafCertificate: 'Inclure feuille certificat',
      includeCertificateChain: 'Inclure certificat chaîne',
      includePrivateKey: 'Inclure privée clé',
      mainArtifactIncludesChain: 'Principal artefact certificat chaîne',
      generateChainFile: 'Générer supplémentaire chaîne fichier',
      generatePrivateKeyFile: 'Générer supplémentaire privée clé fichier',
      exportPassword: 'Exporter mot de passe'
    },
    formats: {
      pfx: '/PFX conteneur',
      jks: 'JKS conteneur',
      pemBundle: 'PEM unique-fichier bundle',
      pemCert: 'PEM certificat fichier',
      pemKey: 'Privée clé fichier',
      cer: 'Certificat fichier (.CER)',
      crt: 'Certificat fichier (.CRT)',
      p7b: '/P7B certificat chaîne',
      custom: 'Personnalisé'
    },
    sections: {
      templates: {
        title: 'Intégré-dans modèles',
        description: 'Modèles format, contenu, et exporter règles basé sur commun TLS déploiement et peut toujours être.'
      },
      basic: {
        title: 'Informations de base',
        description: 'Définir le configuration identité, réel contenu format, et final extension.'
      },
      encoding: {
        title: 'Encodage',
        description: 'Uniquement encodage options valide pour le actuel contenu format sont affiché.'
      },
      content: {
        title: 'Contenu',
        description: 'Quoi le principal artefact contient: publique certificat, certificat chaîne, et privée clé.'
      },
      export: {
        title: 'Exporter options',
        description: 'Définir si à générer supplémentaire chaîne/privée-clé fichiers et conteneur mot de passe options.'
      }
    },
    filters: {
      keywordPlaceholder: 'Configuration nom /cible environnement /alias /contenu format'
    },
    placeholders: {
      configName: 'Pour exemple: équipement-unique-fichier PEM',
      exportPassword: 'Saisir le PFX/JKS exporter mot de passe'
    },
    validation: {
      selectPlatformsFirst: 'Sélectionner le système plateforme et cible plateforme en premier.',
      configNameRequired: 'Configuration nom est requis',
      passwordRequired: 'PFX/JKS configurations nécessiter un exporter mot de passe'
    },
    errors: {
      loadFailed: 'Échec du chargement de certificat format configurations',
      saveFailed: 'Échec de l’enregistrement de certificat format configuration',
      deleteFailed: 'Échec de la suppression de certificat format configuration',
      createExportSecretFailed: 'Échec de la création de exporter mot de passe Secret',
      withCode: '{message} ({code})'
    },
    fallbacks: {
      unnamedConfig: 'configuration-{index} sans nom',
      unspecified: 'Non spécifié',
      aliasUnset: 'Alias non définir'
    },
    labels: {
      aliasWithValue: 'Alias : {alias}',
      requestId: 'Requête ID: {requestId}'
    },
    encoding: {
      pkcs12Container: 'Conteneur',
      jksContainer: 'JKS conteneur',
      privateKeyWithEncoding: 'Privée clé {encoding}',
      pkcs7Chain: 'Certificat chaîne',
      certificateWithEncoding: 'Certificat {encoding}',
      default: 'Par défaut'
    },
    export: {
      leafCertificate: 'Publique certificat',
      certificateChain: 'Certificat chaîne',
      privateKey: 'Privée clé',
      extraChainFile: 'Supplémentaire chaîne fichier',
      extraPrivateKeyFile: 'Supplémentaire privée clé fichier'
    },
    secret: {
      defaultConfigName: 'Configuration des formats de certificat',
      exportPasswordName: '{name} exporter mot de passe'
    },
    select: {
      placeholder: 'Sélectionner'
    },
    separators: {
      export: ' · '
    },
    hints: {
      savedPassword: 'Un exporter mot de passe est déjà configuré. saisir un nouveau mot de passe à il.'
    },
    templates: {
      windowsIis: {
        configName: 'Windows-IIS-PKCS12 standard modèle',
        description: 'IIS la plupart couramment utilise /PFX conteneurs. le principal artefact directement le serveur certificat, certificat chaîne, et privée clé.'
      },
      windowsNginx: {
        configName: 'Windows-Nginx-PEM standard modèle',
        description: 'Nginx couramment utilise un PEM unique fichier pour le serveur certificat et chaîne, plus un séparé privée clé fichier.'
      },
      windowsApache: {
        configName: 'Windows-Apache-PEM standard modèle',
        description: 'Apache est comme un PEM certificat fichier plus un séparé privée clé, avec un supplémentaire chaîne fichier pour compatibilité.'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12 standard modèle',
        description: 'Tomcat utilise JKS/. ce modèle valeurs par défaut à le plus portable format.'
      },
      windowsOther: {
        configName: 'Windows équipement-unique-fichier PEM modèle',
        description: 'Pour équipements ce nécessiter un unique fichier le publique certificat, certificat chaîne, et privée clé. le extension peut être à.CRT/.CER.'
      },
      linuxIis: {
        configName: 'Linux-IIS compatibilité modèle',
        description: 'Si le final cible est toujours IIS, /PFX le la plupart transmission artefact.'
      },
      linuxNginx: {
        configName: 'Linux-Nginx-PEM standard modèle',
        description: 'Nginx configuration un PEM unique-fichier certificat chaîne et un séparé privée clé.'
      },
      linuxApache: {
        configName: 'Linux-Apache-PEM standard modèle',
        description: 'Apache couramment utilise un PEM certificat fichier plus un séparé privée clé, avec un supplémentaire chaîne fichier pour déploiement.'
      },
      linuxTomcat: {
        configName: 'Linux-Tomcat-PKCS12 standard modèle',
        description: 'Tomcat valeurs par défaut à keystore transmission. ce modèle utilise le plus portable format.'
      },
      linuxOther: {
        configName: 'Linux équipement-unique-fichier PEM modèle',
        description: 'Pour Linux équipements ce accepter un unique PEM fichier, début avec un bundle et ajuster extension et contenu pour le cible équipement.'
      }
    }
  },
  assets: {
    title: 'Actifs applicatifs',
    description: 'Gérer application entrée points par domaine ou IP, sur adresse, port, protocole, site, et exécution ciblant.',
    resourceName: 'Application actif',
    actions: {
      add: 'Ajouter actif',
      edit: 'Modifier',
      detail: 'Détails',
      addVariable: 'Ajouter variable',
      delete: 'Supprimer',
      rollbackFromLatestSnapshot: 'Rollback depuis dernier instantané',
      rollingBack: 'Retour...',
      saving: 'Enregistrement...',
      creating: 'Création...',
      saveChanges: 'Enregistrer les modifications',
      confirmCreate: 'Créer'
    },
    columns: {
      domain: 'Domaine',
      port: 'Port',
      protocol: 'Protocole',
      platform: 'Plateforme',
      framework: 'Framework',
      site: 'Site',
      status: 'État',
      actions: 'Actions'
    },
    fields: {
      assetId: 'Application actif ID',
      domain: 'Domaine',
      addressType: 'Adresse type',
      port: 'Port',
      protocol: 'Protocole',
      verifyUrl: 'URL de vérification',
      platform: 'Plateforme',
      frameworkType: 'Type de framework',
      serviceInstanceId: 'ID d’instance de service',
      siteId: 'ID du site',
      managedTargetId: 'Géré cible ID',
      bindingKey: 'Liaison clé',
      hostId: 'Hôte ID',
      environment: 'Environnement',
      discoverySource: 'Détection source',
      lastDiscoveredAt: 'Dernier découvert à',
      tags: 'Tags',
      managedTarget: 'Cible gérée',
      siteName: 'Nom du site',
      bindingInformation: 'Liaison informations',
      hostHeader: 'Host Header',
      sniName: 'Nom SNI',
      currentCertificate: 'certificat actuel',
      targetCertificate: 'Cible certificat',
      expectedFingerprint: 'Attendu empreinte',
      certificateStore: 'Certificat enregistrer',
      snapshotType: 'Instantané type',
      time: 'Heure',
      executionRun: 'Exécution exécution',
      displayName: 'Nom de affichage',
      siteInstance: 'Instance de site',
      certificateFormat: 'Certificat artefact format',
      workflow: 'Workflow',
      workflowVersionSelection: 'Politique de version du workflow',
      publishedVersion: 'Publié version',
      runner: 'Emplacement d’exécution',
      artifactFormat: 'Artefact format'
    },
    links: {
      certificateBindings: 'Voir certificat liaisons',
      executions: 'Voir exécution enregistrements'
    },
    empty: {
      title: 'Aucun application actifs',
      description: 'En attente pour détection à écrire enregistrements, ou ajouter entrée points via backend.',
      noBindingInformation: 'Aucun liaison informations',
      notSet: 'Non définir',
      notSelected: 'Non sélectionné',
      noVariablePreset: 'Aucun variables peut être ajouté',
      basicEntryIncomplete: 'Base entrée incomplet'
    },
    detail: {
      title: 'Détails de application',
      description: 'Conserver actif détails, liaisons, déploiement entrée, et instantanés dans unique fenêtre modale.',
      tabsAriaLabel: 'Application détail onglets',
      tabs: {
        overview: 'Vue d’ensemble',
        snapshots: 'Instantanés'
      },
      loadingTargetBinding: 'Chargement de cible liaison détails...',
      loadingSnapshots: 'Chargement de instantanés...',
      emptyCertificateBindings: 'Aucun certificat liaisons.',
      emptySnapshots: 'Aucun instantanés.',
      rollbackSubmitted: 'Rollback requête soumis. contrôle exécutions pour le rollback exécution.',
      sections: {
        overview: {
          title: 'Vue d’ensemble',
          description: 'Le application actif est le principal objet. hôtes et sites uniquement exécution ciblant informations.'
        },
        targetBinding: {
          title: 'Cible liaison',
          description: 'Liaisons doit point à un site et géré cible à la place de par domaine.'
        },
        certificateBindings: {
          title: 'Certificat liaisons',
          description: 'Certificat relations sont à liaisons à la place de uniquement sur domaines.'
        },
        snapshots: {
          title: 'Instantanés',
          description: '-déployer,-déployer, et rollback état doit être directement, non uniquement comme tâche enregistrements.'
        }
      }
    },
    managementModes: {
      agent: 'Mode Agent',
      agentDescription: 'Lier Agent, site instance, et géré cible',
      workflow: 'Mode workflow',
      workflowDescription: 'Sélectionner workflow version et exécution variables'
    },
    workflowVersionSelection: {
      pinned: 'Figer la version sélectionnée',
      latestPublished: 'Toujours utiliser la dernière version publiée'
    },
    loading: {
      agents: 'Chargement de Agents...',
      sites: 'Chargement de sites...',
      managedTargets: 'Chargement de cibles...',
      certificateFormats: 'Chargement de format configurations...',
      workflows: 'Chargement de workflows...',
      versions: 'Chargement de versions...',
      gateways: 'Chargement de passerelles...',
      credentials: 'Chargement des identifiants...'
    },
    select: {
      agent: 'Sélectionner Agent',
      siteInstance: 'Sélectionner site instance',
      managedTarget: 'Sélectionner géré cible',
      certificateFormat: 'Sélectionner certificat artefact format',
      workflow: 'Sélectionner workflow',
      publishedVersion: 'Sélectionner publié version',
      gateway: 'Sélectionner passerelle',
      variablePreset: 'Sélectionner variable',
      credential: 'Sélectionner identifiant',
      generic: 'Sélectionner',
      artifactFormat: 'Sélectionner format configuration',
      output: 'Sélectionner sortie',
      optionalOutput: 'Facultatif'
    },
    validation: {
      variableNameRequired: 'Variable nom est requis',
      variableNameInvalid: 'Nom de variable {name} a un invalide',
      variableDuplicated: 'Variable {name} est',
      variableRequired: 'Variable {name} est requis',
      variableMustBeNumber: 'Variable {name} doit être un numéro',
      variableMustBeJsonObject: 'Variable {name} doit être un JSON objet',
      variableInvalidJson: 'Variable {name} est non valide JSON',
      variableCredentialInvalid: 'Variable {name} doit sélectionner un valide identifiant',
      certificateFormatRequired: 'Certificat variable {name} doit sélectionner un certificat format configuration',
      certificateOutputRequired: 'Certificat variable {name}.{slot} doit sélectionner un sortie',
      certificateOutputMissing: 'Sélectionné sortie pour certificat variable {name}.{slot} fait non exister'
    },
    workflowVariableTypes: {
      string: 'Chaîne',
      number: 'Numéro',
      boolean: 'Booléen',
      enum: 'Énumération',
      object: 'Objet',
      file: 'Fichier',
      credential: 'Identifiant',
      certificate: 'Certificat'
    },
    wizard: {
      ariaLabel: 'Application actif création étapes',
      steps: {
        basicEntry: 'Base entrée',
        deploymentMode: 'Déploiement mode',
        confirmSave: 'Confirmer et enregistrer'
      },
      stepState: {
        active: 'En cours',
        done: 'Terminé',
        pending: 'Non démarré',
        incomplete: 'Incomplet',
        readyNext: 'Prêt pour l’étape suivante',
        pendingSubmit: 'Prêt à soumettre'
      },
      panels: {
        basicEntryTitle: 'Base entrée',
        basicEntryDescription: 'Remplir dans domaine, port, protocole, et plateforme en premier à définir le application entrée identité.',
        agentTitle: 'Agent cible liaison',
        agentDescription: 'Sélectionner Agent, site instance, géré cible, et certificat artefact format.',
        workflowTitle: 'Workflow exécution configuration',
        workflowDescription: 'Sélectionner workflow version, emplacement d’exécution, et variables. certificat variables sont injecté à exécution.',
        confirmTitle: 'Confirmer et enregistrer',
        confirmDescription: 'Revue application entrée, déploiement mode, et exécution avant enregistrement le actif.'
      }
    },
    form: {
      createTitle: 'Ajouter application actif',
      editTitle: 'Modifier application actif',
      createDescription: 'Créer un application entrée et lier cible informations requis pour plus tard déploiement.',
      editDescription: 'Mettre à jour le application entrée et déploiement cible liaison.',
      createRequestCompleted: 'Créer requête terminé.',
      editRequestCompleted: 'Enregistrer requête terminé.',
      agentCertificateFormatHint: 'Agent mode utilise ce certificat artefact format à générer déploiement matériels.',
      placeholders: {
        displayName: 'Pour exemple: production site entrée',
        verifyUrl: 'Pour exemple:://exemple.com/santé',
        siteName: 'Par exemple : site de production',
        bindingInformation: 'Par exemple : *:443:example.com',
        hostHeader: 'Par exemple : example.com',
        sniName: 'Par exemple : example.com'
      }
    },
    review: {
      accessEntry: 'Accès entrée',
      deploymentMode: 'Déploiement mode',
      agentSiteTarget: 'Agent /site /cible',
      workflowVersion: 'Version du workflow',
      gatewayRunner: 'Passerelle: {gateway}',
      variableCount: '{count} variables',
      onlyBasicEntry: 'Base entrée uniquement',
      autoGeneratedByEntry: 'Généré depuis l’entrée applicative'
    },
    workflowTarget: {
      title: 'Informations de cible du workflow',
      description: 'Utilisé pour l’affichage des actifs workflow, la sonde post-déploiement et la synchronisation des variables cible DSL.',
      dslSyncHint: 'Synchronisé vers les variables cible DSL'
    },
    workflowVariables: {
      title: 'Variables du workflow',
      configuredCount: '{configured}/{total} configuré',
      name: 'Nom de variable',
      type: 'Type',
      value: 'Valeur',
      manual: 'Manuel',
      empty: 'Aucun workflow variables.',
      noPublishedVersion: 'Sélectionner un publié workflow version avant variables.',
      certificateAutoInjected: 'Le certificat version est sélectionné par le déploiement plan et injecté automatiquement à exécution.',
      certificateDescription: 'Le certificat version est sélectionné par le déploiement plan. lier format configuration et sorties {name}.sorties..contenu est injecté à exécution.',
      presets: {
        deviceHost: 'Cible hôte ou équipement adresse',
        sshUsername: 'Nom de SSH utilisateur',
        credential: 'Workflow identifiant',
        certificate: 'Certificat artefact',
        targetPlatform: 'Cible plateforme',
        verifyHost: 'Vérification hôte',
        verifyPort: 'Vérification port',
        verifyPath: 'Vérification chemin',
        apacheServiceName: 'Nom de Apache service',
        apacheSiteConfigPath: 'Apache site configuration chemin',
        certificateFilePath: 'Certificat destination chemin',
        certificateKeyFilePath: 'Privée clé destination chemin',
        backupRoot: 'Certificat sauvegarde racine',
        expectedResponseContains: 'Attendu réponse contient texte',
        virtualHostServerName: 'ServerName du virtual host'
      }
    },
    certificateBindings: {
      title: 'Certificat variable liaisons',
      description: 'Sélectionner certificat artefact format et sorties pour certificat variables dans le workflow.',
      variableCount: '{count} certificat variables',
      defaultVariableDescription: 'Certificat artefact variable',
      noArtifactOutputs: 'Aucun sorties pour le actuel format configuration.'
    },
    certificateOutputs: {
      publicCertificateWithChain: 'Publique certificat + certificat chaîne',
      publicCertificate: 'Publique certificat',
      certificateChain: 'Certificat chaîne',
      privateKey: 'Privée clé',
      pemBundle: 'PEM bundle artefact',
      container: '{format} conteneur',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (enregistré configuration, non retourné par actuel liste)',
      withPrivateKey: 'Avec privée clé',
      withoutPrivateKey: 'Sans privée clé'
    },
    snapshotTypes: {
      preDeploy: 'Pré-déploiement',
      postDeploy: 'Post-déploiement',
      postRollback: '-rollback',
      errorState: 'Erreur état',
      rollbackPoint: 'Point de rollback'
    },
    errors: {
      loadWorkflowListFailed: 'Échec du chargement de workflow liste',
      loadWorkflowVersionsFailed: 'Échec du chargement de workflow versions',
      loadGatewayListFailed: 'Échec du chargement de passerelle liste',
      loadCertificateFormatsFailed: 'Échec du chargement de certificat format configurations',
      loadAssetDetailFailed: 'Échec du chargement de application actif détails',
      rollbackFailed: 'Échec de l’opération : début rollback',
      loadTargetsFailed: 'Échec du chargement de sites et géré cibles',
      createAssetFailed: 'Échec de la création de application actif',
      loadWorkflowCredentialsFailed: 'Échec du chargement de workflow identifiants',
      noAvailableSiteInstance: 'Aucun disponible site instance trouvé. confirmer framework sites ont été rapporté avec succès dans Agent détails.'
    },
    platforms: {
      appliance: 'Équipement'
    },
    runners: {
      controlPlane: 'Plateforme'
    },
    status: {
      archived: 'Archivé',
      unknownStatus: 'état inconnu'
    },
    common: {
      required: 'Obligatoire',
      optional: 'Facultatif'
    }
  },
  certificates: {
    errors: {
      requestFailed: 'Échec de la requête'
    },
    detail: {
      backList: 'Liste de retour à',
      description: 'Affiche certificat version détails, format artefacts, et associé actifs.',
      title: 'Détails du certificat'
    },
    detailPanel: {
      sources: {
        agentContext: 'Agent contexte',
        platformBinding: 'Plateforme liaison enregistrement'
      },
      usage: {
        columns: {
          domainName: 'Domaine /cible',
          agentName: 'Nom de Agent',
          siteName: 'Nom de site',
          bindingType: 'Liaison type',
          usageSource: 'Source',
          status: 'État'
        },
        empty: 'Aucun associé actifs',
        toolbar: 'Associé actifs'
      },
      summary: {
        certificateName: 'Nom du certificat',
        logicalDomain: 'Logique domaine',
        issuer: 'Émetteur',
        subject: 'Sujet',
        serialNumber: 'Numéro de série',
        chainStatus: 'Chaîne état'
      },
      sections: {
        subjectInfo: 'Sujet informations',
        issuerInfo: 'Émetteur informations',
        certificateFields: 'Certificat champs',
        extensionFields: 'Extension champs'
      },
      fields: {
        commonName: 'Commun nom (CN)',
        organization: '()',
        organizationalUnit: '(OU)',
        countryRegion: '/région ()',
        stateProvince: 'État /(ST)',
        locality: '()',
        version: 'Version',
        signatureAlgorithm: 'Signature algorithme',
        publicKeyAlgorithm: 'Publique clé algorithme',
        fingerprintSha256: 'Empreinte SHA-256',
        san: 'SAN',
        deployable: 'Déployable',
        leafStorageRef: 'Feuille certificat référence',
        chainCertificateCount: 'Nombre de chaîne certificat',
        chainDiagnostics: 'Chaîne'
      },
      fallbacks: {
        unknownCertificate: 'certificat inconnu',
        unknownIssuer: 'émetteur inconnu',
        unnamedCertificate: 'certificat sans nom',
        unknownDomain: 'domaine inconnu',
        unknownSubject: 'sujet inconnu',
        unknown: 'Inconnu',
        notPartOfCertificate: 'Non de le certificat',
        none: 'Aucun',
        emptyValue: '—',
        unknownType: 'type inconnu',
        unknownResource: 'ressource inconnu',
        unknownTarget: 'cible inconnu'
      },
      values: {
        yes: 'Oui',
        no: 'Aucun'
      },
      separators: {
        diagnostic: ' ; ',
        list: ','
      },
      chain: {
        roles: {
          leaf: 'Feuille certificat',
          root: 'Racine certificat',
          intermediate: 'Intermédiaire certificat'
        },
        title: 'Certificat chaîne',
        empty: 'Aucun certificat chaîne informations',
        subject: 'Sujet: {value}',
        issuer: 'Émetteur: {value}'
      },
      errors: {
        loadFailedTitle: 'Échec du chargement de certificat détails',
        code: 'Code d’erreur : {code}'
      },
      actions: {
        retry: 'Réessayer'
      },
      states: {
        loading: 'Chargement...'
      },
      tabs: {
        ariaLabel: 'Certificat détail onglets',
        detail: 'Détails',
        usage: 'Associé actifs'
      },
      validity: {
        title: 'Certificat validité',
        notBefore: 'Valide depuis: {value}',
        notAfter: 'Expire à: {value}'
      }
    },
    formats: {
      columns: {
        certificateVersionId: 'ID de version',
        createdAt: 'Créé le',
        format: 'Format',
        secretRef: 'Secret référence',
        status: 'État'
      },
      create: 'Créer format configuration',
      createFailed: 'Échec de la création de format',
      description: 'PEM/DER/PFX/JKS/P7B format configuration entrée pour certificat {id}.',
      empty: 'Aucun format configurations',
      fields: {
        alias: 'Alias (facultatif)',
        containsPrivateKey: 'Contient privée clé (PEM)',
        passwordSecretRef: 'PasswordSecretRef (PFX/JKS)',
        targetFormat: 'Cible format',
        versionId: 'ID de version'
      },
      hint: 'PFX/JKS doit utiliser un existant backend passwordSecretRef. déploiement matériels sont généré sur depuis le certificat version et format configuration.',
      loadFailed: 'Échec du chargement de format configurations',
      optionAvailable: '{label}-disponible',
      placeholders: {
        alias: 'Pour exemple-certificat'
      },
      title: 'Configuration des formats de certificat',
      toolbar: 'Liste de format configuration',
      unsupported: '{format} ne peut pas être créé avec le actuel capacité.'
    },
    import: {
      backList: 'Liste de retour à certificat',
      description: 'Actuellement uniquement PEM + clé et PFX sont PFX uniquement prend en charge fichier importer. importé matériel doit inclure le serveur certificat, complet intermédiaire chaîne, et privée clé. racine certificats sont facultatif.',
      errors: {
        importFailed: 'Échec de importer',
        materialRequiredBeforeValidate: 'Complet le importer matériel avant démarrage validation.',
        needPassedValidation: 'Complet étape 3 validation et il réussi avant importation.',
        validateFailed: 'Échec de validation'
      },
      formats: {
        pem: {
          hint: 'Serveur certificat, complet intermédiaire chaîne, et privée clé doit tous être fourni. racine certificats sont facultatif et uniquement un avertissement lorsque manquant.'
        },
        pfx: {
          hint: 'Uniquement fichier importer est pris en charge. le conteneur doit inclure le serveur certificat, complet intermédiaire chaîne, et privée clé. racine certificats sont facultatif et uniquement un avertissement lorsque manquant.'
        }
      },
      methods: {
        file: {
          hint: 'Utiliser ce lorsque déjà ont certificat /clé ou.PFX fichiers.',
          label: 'Sélectionner fichier'
        },
        text: {
          hint: 'Coller PEM texte directement à temporaire fichiers.',
          label: 'Coller texte'
        }
      },
      title: 'Importer un certificat'
    },
    importForm: {
      hints: {
        pemChainCheck: 'Téléverser ou coller le serveur certificat, complet intermédiaire chaîne, et privée clé. le système va vérifier le chaîne et privée clé correspondre.',
        pfxChainCheck: 'Téléverser un PFX/P12 fichier et saisir son mot de passe. le système va le serveur certificat, chaîne, et privée clé depuis le conteneur.',
        pfxFileOnly: 'PFX uniquement prend en charge fichier importer.'
      },
      roles: {
        leaf: 'Feuille certificat',
        root: 'Racine certificat',
        intermediate: 'Intermédiaire certificat'
      },
      steps: {
        ariaLabel: 'Certificat importer étapes',
        formatAndMethod: 'Format et méthode',
        materials: 'Importer matériels',
        validateAndImport: 'Valider et importer'
      },
      formatIntro: {
        title: 'Choisir importer format et méthode',
        description: 'Confirmer le matériel format en premier, puis téléverser fichiers ou coller texte. PFX actuellement uniquement prend en charge fichier importer.'
      },
      labels: {
        importType: 'Importer type',
        importMethod: 'Importer méthode',
        materialStatus: 'Matériel état'
      },
      status: {
        supported: 'Pris en charge',
        unsupported: 'Non pris en charge',
        completed: 'Terminé',
        incomplete: 'Incomplet',
        matched: 'Correspond',
        unmatched: 'Ne correspond pas'
      },
      fields: {
        certificateChainFile: 'Certificat chaîne fichier',
        certificatePemText: 'Certificat PEM texte',
        privateKey: 'Privée clé ({kind})',
        file: 'Fichier',
        pemText: 'PEM texte',
        pfxFile: 'PFX/P12 fichier',
        certificateName: 'Nom du certificat',
        pfxPassword: 'PFX mot de passe'
      },
      placeholders: {
        certificatePem: '-----BEGIN certificat-----...-----fin certificat-----',
        certificateName: 'Pour exemple exemple.com production certificat',
        required: 'Obligatoire'
      },
      validation: {
        title: 'Valider importer matériels',
        description: 'Valider le certificat chaîne, validité période, privée clé correspondre, et matériel avant importation.',
        passed: 'Validation réussi. prêt à importer.',
        failed: 'Échec de validation'
      },
      report: {
        certificateSummary: 'Certificat synthèse',
        serialNumber: 'Numéro de série',
        validity: 'Validité',
        validityRange: '{start} à {end}',
        issuer: 'Émetteur',
        issuerWithValue: 'Émetteur: {value}',
        subject: 'Sujet',
        chainValidation: 'Chaîne validation',
        chainStatus: 'Chaîne état',
        certificateCount: 'Nombre de certificat',
        privateKeyMatch: 'Privée clé correspondre',
        provided: 'Fourni',
        matchResult: 'Correspondre résultat',
        privateKeySource: 'Privée clé source',
        blockers: 'Bloquants',
        warnings: 'Avertissements'
      },
      selectedFile: 'Sélectionné: {name}',
      importSuccess: 'Importé avec succès. certificat version ID: {id}',
      actions: {
        validating: '...',
        validate: 'Valider',
        cancel: 'Annuler',
        previous: 'Précédent',
        next: 'Suivant',
        importing: 'Importation...',
        import: 'Importer un certificat'
      }
    },
    list: {
      filters: {
        keyword: 'Mot-clé',
        domain: 'Domaine',
        status: 'État'
      },
      placeholders: {
        assetKeyword: 'Domaine /SAN /empreinte',
        versionKeyword: 'Nom /émetteur /sujet /version ID'
      },
      columns: {
        notBefore: 'Début date',
        notAfter: 'Fin date',
        associatedAsset: 'Associé actif',
        status: 'État',
        certificateVersionId: 'Certificat version ID'
      },
      lifecycle: {
        unknown: 'Inconnu',
        expired: 'Expiré',
        expiringSoon: 'Expire bientôt bientôt',
        valid: 'Valide'
      },
      fallbacks: {
        unselectedDomain: 'Aucun domaine sélectionné',
        unnamedDomain: 'domaine sans nom',
        noSupplement: 'Aucun informations'
      },
      assets: {
        title: 'Liste de domaine',
        loadFailed: 'Échec du chargement de domaine liste',
        empty: 'Aucun domaines',
        unselectedTitle: 'Aucun domaine sélectionné',
        unselectedDescription: 'Sélectionner un logique certificat domaine sur le en premier.'
      },
      versions: {
        title: 'Liste de SSL certificat',
        titleWithDomain: 'SSL certificats pour {domain}',
        description: 'Affiche SSL certificats le actuel domaine, certificat nom, début date, fin date, émetteur, et sujet.',
        loadFailed: 'Échec du chargement de SSL certificat liste',
        emptyForDomain: 'Aucun SSL certificats ce domaine',
        emptyForDomainDescription: 'Utiliser le importer certificat sur le de le filtres à ajouter certificat versions pour ce domaine.',
        empty: 'Aucun SSL certificats',
        toolbar: 'Liste de certificat version',
        currentCount: '{count} actuellement'
      },
      actions: {
        clear: 'Effacer',
        deleteRisk: 'Suppression supprime le actuel certificat version directement. si il est toujours par un liaison ou déploiement, le backend va refuser le opération.'
      },
      errors: {
        deleteFailed: 'Supprimer échec',
        materialRequiredForFormat: 'Certificat matériel pour le actuel format est requis.',
        importFailedWithCheck: 'Importer échec. contrôle le entrée matériel.',
        validateFailedWithCheck: 'Validation échec. contrôle le entrée matériel.'
      },
      import: {
        description: 'Actuellement uniquement PEM + clé et PFX sont chaque importer doit inclure le serveur certificat, complet intermédiaire chaîne, et privée clé. racine certificats sont facultatif et afficher un avertissement lorsque manquant. le privée clé est enregistré uniquement comme un backend Secret et est dans.'
      }
    },
    usages: {
      backDetail: 'Détails de retour à',
      columns: {
        domainName: 'Domaine /cible',
        resourceId: 'Ressource ID',
        resourceType: 'Ressource type',
        status: 'État',
        updatedAt: 'Mis à jour le'
      },
      description: 'Liaisons, déploiement cibles, et ressource références pour certificat {id}.',
      empty: 'Aucun utilisations',
      loadFailed: 'Échec du chargement de utilisations',
      title: 'Certificat utilisations',
      toolbar: 'Utilisations'
    }
  },
  workflows: {
    credentials: {
      summary: {
        usernamePassword: 'Nom d’utilisateur + mot de passe',
        usernamePasswordWithUsername: 'Nom d’utilisateur + mot de passe / {username}',
        sshKey: 'Clé privée SSH',
        sshKeyWithUsername: 'Clé privée SSH / {username}',
        apiKey: 'API clé /{name} /{location}',
        bearerToken: 'Bearer Token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: 'Un structuré HTTP API à la place de CURL.'
        },
        ssh: {
          displayName: 'SSH commande',
          description: 'Le SSH commande à exécution pendant uniquement connexion et identifiant références.'
        },
        sftp: {
          displayName: 'SFTP téléverser/télécharger',
          description: 'Téléverser ou télécharger fichiers via un SFTP étape, pour certificat et configuration installation.'
        },
        scp: {
          displayName: 'SCP téléverser/télécharger',
          description: 'Copier fichiers via SCP, pour hôte fichier distribution.'
        },
        verify: {
          displayName: 'Vérifier',
          description: 'HTTP état, texte,, ou certificat empreinte.'
        },
        condition: {
          displayName: 'Condition',
          description: 'Choisir le suivant chemin basé sur variable ou valeur.'
        },
        transform: {
          displayName: 'Transformation',
          description: 'Utiliser JSONata pour convertir la sortie amont en nouvelles variables de contexte du workflow.'
        },
        wait: {
          displayName: 'Attendre',
          description: 'Attendre pour un numéro de secondes avant.'
        },
        manual: {
          displayName: 'Manuel approbation',
          description: 'Le workflow manuel confirmation.'
        }
      },
      fields: {
        command: 'Commande',
        connectionRef: 'Connexion variable',
        contentRef: 'Contenu variable',
        credential: 'Identifiant',
        description: 'Description',
        direction: 'Direction',
        expected: 'Attendu valeur',
        expectedHostKeyFingerprint: 'Hôte clé empreinte',
        hostKeyPolicy: 'Hôte clé politique',
        hostRef: 'Hôte variable',
        inputRef: 'Entrée variable',
        instruction: 'Approbation',
        localPath: 'Local chemin',
        mode: 'Fichier mode',
        operator: 'Opérateur',
        remotePath: 'Distant chemin',
        seconds: 'Attendre secondes',
        temporaryPath: 'Temporaire chemin',
        timeoutMs: 'Délai ms',
        timeoutSeconds: 'Secondes',
        transformInput: 'Entrée de transformation',
        outputFormat: 'Format de sortie',
        usernameVariable: 'Nom d’utilisateur variable',
        variable: 'Variable',
        verifyType: 'Vérifier type'
      },
      options: {
        direction: {
          download: 'Télécharger',
          upload: 'Téléverser'
        },
        hostKeyPolicy: {
          manualApproval: 'Manuel approbation',
          strict: 'Vérification',
          trustOnFirstUse: 'Sur en premier utiliser'
        },
        operator: {
          equals: 'Égal à',
          exists: 'Existe',
          notEquals: 'Non',
          notExists: 'Fait non exister'
        },
        transformFormat: {
          raw: 'Valeur brute',
          jsonString: 'Chaîne JSON'
        },
        verifyType: {
          certificateFingerprint: 'Certificat empreinte',
          httpStatus: 'HTTP état',
          regex: 'Correspondre',
          textContains: 'Texte contient'
        }
      },
      stages: {
        backup: {
          title: 'Sauvegarde',
          description: 'Conserver rollback matériel.'
        },
        install: {
          title: 'Installer',
          description: 'Écrire certificats ou configuration.'
        },
        prepare: {
          title: 'Préparation',
          description: ', variables, et matériel.'
        },
        refresh: {
          title: 'Actualiser',
          description: 'Rechargement services ou actualiser cibles.'
        },
        verify: {
          title: 'Vérifier',
          description: 'Confirmer le résultat correspond.'
        }
      },
      defaults: {
        displayName: 'Workflow {name}',
        nodes: {
          backupExistingCertificate: 'Retour à jour existant certificat',
          reloadService: 'Rechargement service'
        },
        variables: {
          certificatePaths: {
            description: 'Configuration de cible certificat chemin'
          },
          credential: {
            description: 'Connexion identifiant'
          },
          deviceHost: {
            description: 'Cible hôte'
          },
          serverCert: {
            description: 'Serveur certificat matériel à déployer',
            outputs: {
              certFile: {
                description: 'Serveur certificat fichier'
              },
              keyFile: {
                description: 'Privée clé fichier'
              }
            }
          },
          sshUsername: {
            description: 'SSH connexion nom d’utilisateur'
          },
          verifyUrl: {
            description: '-déploiement vérification URL'
          }
        },
        config: {
          conditionDescription: 'Contrôle si le cible hôte variable',
          manualInstruction: 'Veuillez confirmer le cible équipement certificat a à le nouveau version.'
        }
      },
      variableFlow: {
        system: 'Système',
        variable: 'Variable'
      },
      errors: {
        unknownNodeType: 'nœud type: {type} inconnu'
      }
    },
    canvasEditor: {
      summary: '{nodes} nœuds, {edges} liaisons, {variables} variables',
      stageNodeCount: '{count} nœuds',
      copyLabel: '{label} copier',
      actions: {
        addVariable: 'Ajouter variable',
        collapseBottomPanelAria: 'Réduire inférieur contrôle panneau',
        collapseDown: 'Réduire',
        copy: 'Copier',
        copyNode: 'Copier nœud',
        delete: 'Supprimer',
        deleteNode: 'Supprimer nœud',
        expandBottomPanelAria: 'Développer inférieur contrôle panneau',
        expandPanel: 'Développer panneau',
        layout: 'Réorganiser la mise en page',
        mockCurrentNode: 'Actuel nœud uniquement',
        mockRunning: '...',
        paste: 'Coller',
        pasteNode: 'Coller nœud',
        realRun: 'Exécution actuel nœud pour réel',
        realRunHttp: 'Exécution actuel HTTP nœud',
        realRunRunning: 'En cours...',
        realRunSsh: 'Exécution actuel SSH nœud',
        realRunTransfer: 'Exécution réel fichier',
        redo: 'Rétablir',
        saveDraft: 'Enregistrer brouillon',
        saving: 'Enregistrement...',
        undo: 'Annuler',
        zoomIn: 'Dans',
        zoomOut: 'Sortie'
      },
      aria: {
        bottomPanel: 'Inférieur panneau',
        canvasArea: 'Canevas',
        dslPanel: 'DSL panneau',
        nodePalette: 'Nœud palette',
        propertiesPanel: 'Propriétés panneau',
        runtimePanel: 'Exécution panneau',
        toolbar: 'Workflow canevas',
        validationPanel: 'Validation panneau',
        variablesPanel: 'Variables panneau'
      },
      credentialHints: {
        savedApiKey: 'Enregistré API clé',
        savedBearerToken: 'Enregistré Bearer Token',
        savedSshSftp: 'Enregistré SSH /SFTP identifiants',
        savedUsernamePassword: 'Enregistré nom d’utilisateur + mot de passe'
      },
      credentials: {
        emptyCreateHint: 'Aucun disponible identifiants. créer unique depuis identifiant gestion sur le liste page.',
        loading: 'Chargement des identifiants depuis le backend...'
      },
      dsl: {
        title: 'DSL importer et écraser',
        hint: 'Coller externe DSL JSON ou choisir un local DSL fichier. importer uniquement le actuel canevas dans le un nouveau workflow version est créé uniquement après enregistrement le brouillon.',
        selectFile: 'Sélectionner DSL fichier',
        actions: {
          importOverwrite: 'Importer DSL et écraser canevas',
          resetToCanvas: 'Actuel canevas DSL'
        },
        messages: {
          fileLoaded: 'Chargé fichier: {fileName}',
          imported: 'DSL importé et actuel canevas, {count} nœuds total.',
          resetToCompiled: 'Backend-compilé DSL.'
        },
        errors: {
          importFailed: 'Échec de DSL importer',
          invalidTopLevel: 'Invalide DSL-niveau. il doit être un objet.'
        }
      },
      empty: {
        selectNodeToEdit: 'Sélectionner un nœud à modifier propriétés.'
      },
      errors: {
        backendValidationFailed: 'Échec de backend validation',
        credentialsLoadFailed: 'Échec du chargement de workflow identifiants',
        missingStepName: 'Étape nom est manquant',
        missingWorkflowDsl: 'Backend a non retourner workflow DSL'
      },
      fields: {
        authType: 'Type',
        clientCertificate: 'Certificat',
        clientPrivateKey: 'Privée clé',
        command: 'Commande',
        connectionVariable: 'Connexion variable',
        contentRef: 'Contenu référence',
        cookieName: 'Nom de Cookie',
        credential: 'Identifiant',
        credentialSelector: 'Identifiant sélecteur',
        defaultValue: 'valeur par défaut',
        deliveryLocation: 'Transmission emplacement',
        description: 'Description',
        direction: 'Direction',
        fileMode: 'Fichier mode',
        headerName: 'Nom de Header',
        hostRefOrHostname: 'Hôte variable /nom d’hôte',
        hostVariable: 'Hôte variable',
        keyName: 'Nom de clé',
        localPath: 'Local chemin',
        newNodeStage: 'Nouveau nœud phase',
        nodeName: 'Nom de nœud',
        remotePath: 'Distant chemin',
        required: 'Obligatoire',
        secretValue: 'Secret valeur',
        sensitive: 'Sensible',
        stage: 'Phase',
        temporaryPath: 'Temporaire chemin',
        timeoutSeconds: 'Secondes',
        type: 'Type',
        username: 'Nom d’utilisateur',
        variableName: 'Nom de variable'
      },
      options: {
        download: 'Télécharger',
        manualInput: 'Manuel entrée',
        notSelected: 'Non sélectionné',
        upload: 'Téléverser'
      },
      runtime: {
        noCredentialVariables: 'Ce workflow a aucun identifiant variables.',
        noExtraVariables: 'Le actuel nœud a aucun supplémentaire exécution variables.'
      },
      sections: {
        httpAuth: 'HTTP authentification',
        nodePalette: 'Nœud palette',
        properties: 'Propriétés',
        referenceFlow: 'Référence',
        runtimeCredentialVariables: 'Exécution identifiant variables',
        runtimeVariables: 'Exécution variables',
        singleNodeTest: 'Unique-nœud test exécution',
        variableConfig: 'Configuration de variable'
      },
      tabs: {
        runtime: 'Exécution',
        validation: 'Validation',
        variables: 'Variables'
      },
      test: {
        cause: 'Cause',
        code: 'Code',
        emptyHint: 'Sélectionner un nœud à exécution un simulation ou réel test.',
        error: 'Erreur',
        executionPlan: 'Exécution plan',
        exitCode: 'Sortie code',
        failureDetails: 'Détails de échec',
        hint: 'Test',
        logs: 'Journaux',
        nodeOutput: 'Nœud sortie',
        running: 'En cours',
        stage: 'Phase',
        stderr: 'Standard erreur',
        stdout: 'Standard sortie',
        suggestion: 'Suggestion',
        target: 'Cible',
        errors: {
          mockRunFailed: 'Échec de simulation',
          realRunFailed: 'Échec de réel test exécution'
        },
        messages: {
          mockCompleted: 'Simulation terminé.',
          mockFailed: 'Simulation échec.',
          realCompleted: 'Réel test exécution terminé.',
          realFailed: 'Réel test exécution échec.'
        }
      },
      validation: {
        levels: {
          error: 'Erreur',
          risk: 'Risque',
          warning: 'Avertissement'
        },
        location: {
          canvas: 'Canevas',
          edge: 'Connexion',
          fieldSuffix: 'Champ',
          node: 'Nœud'
        },
        noBlockingErrors: 'Aucun bloquant erreurs.'
      },
      variables: {
        customRuntimeDescription: 'Personnalisé exécution variable',
        notUsed: 'Non utilisé',
        usedBy: 'Utilisé par: {nodes}'
      }
    },
    templates: {
      title: 'Workflows',
      resourceName: 'Workflow',
      description: 'Gérer CURL/SSH/SFTP workflow versions, publication état, et modification historique depuis canevas brouillons.',
      actions: {
        addVersion: 'Ajouter version',
        applyTemplate: 'Appliquer modèle',
        cancel: 'Annuler',
        close: 'Fermer',
        createBlank: 'Créer ',
        credentialManagement: 'Gestion des identifiants',
        delete: 'Supprimer',
        detail: 'Détails',
        edit: 'Modifier',
        publishVersion: 'Publier version',
        saveNote: 'Enregistrer remarque',
        switchVersion: 'Basculer version',
        templateManagement: 'Modèle gestion',
        versionManagement: 'Version gestion'
      },
      states: {
        creating: 'Création...',
        loading: 'Chargement...',
        processing: 'Traitement...',
        saving: 'Enregistrement...'
      },
      fields: {
        actions: 'Actions',
        createdAt: 'Créé le',
        currentStatus: 'État actuel',
        currentVersion: 'version actuel',
        currentVersionId: 'version ID actuel',
        id: 'ID du workflow',
        name: 'Nom de workflow',
        note: 'Remarque',
        status: 'État',
        updatedAt: 'Mis à jour le'
      },
      empty: {
        description: 'Créer un canevas brouillon en premier, puis publier versions à le production.',
        noChangeSummary: 'Aucun modification synthèse.',
        noChangeSummaryShort: 'Aucun modification synthèse',
        noVersions: 'Aucun versions.',
        title: 'Aucun workflows'
      },
      tabs: {
        summary: 'Vue d’ensemble',
        versions: 'Versions'
      },
      versionStatuses: {
        disabled: 'Désactivé',
        draft: 'Brouillon',
        published: 'Publié'
      },
      detail: {
        description: 'Workflow détails, canevas brouillons, et versions sont conservé dans ce le principal page compact.',
        publishedVersion: 'Publié version {version}',
        title: 'Détails de workflow',
        titleWithName: 'Workflow {name}'
      },
      versionManager: {
        description: 'Gérer uniquement workflow version création et publication workflow canevas contenu est non modifié.',
        titleWithName: 'Version gestion: {name}'
      },
      changeSummaries: {
        applyFromFileTemplate: 'Appliquer fichier modèle à workflow brouillon',
        createCanvasDraft: 'Créer workflow brouillon depuis frontend canevas',
        createFromFileTemplate: 'Créer workflow brouillon depuis fichier modèle',
        createVersionDraft: 'Créer nouveau brouillon version depuis version gestion',
        saveCanvasDraft: 'Enregistrer brouillon version depuis canevas éditeur'
      },
      messages: {
        canvasDraftUpdated: 'brouillon version mis à jour. actuel',
        switchedVersion: 'À {version}.',
        versionDraftCreated: 'Nouveau brouillon version créé.',
        versionNoteUpdated: 'Version remarque mis à jour.'
      },
      errors: {
        createVersionFailed: 'Échec de la création de workflow version',
        loadVersionsFailed: 'Échec du chargement de workflow versions',
        missingWorkflowDsl: 'Backend a non retourner workflow DSL',
        publishVersionFailed: 'Échec de l’opération : publier workflow version',
        saveCanvasDraftFailed: 'Échec de l’enregistrement de canevas brouillon',
        updateVersionNoteFailed: 'Échec de la mise à jour de version remarque'
      },
      delete: {
        riskText: 'Suppression ce workflow et tous versions, eux depuis le exécution enregistrements va non être.'
      },
      loading: {
        versions: 'Chargement de versions...'
      },
      fileTemplates: {
        applyAction: 'Appliquer modèle à actuel workflow',
        applyTitle: 'Appliquer fichier modèle à workflow',
        createAction: 'Créer workflow depuis modèle',
        createTitle: 'Créer workflow depuis fichier modèle',
        currentTarget: 'cible: {name} actuel',
        description: 'Modèle fichiers depuis le intégré-dans modèle bibliothèque ou utilisateur importer répertoire. unique à un existant workflow un nouveau brouillon version et fait non historique.',
        empty: 'Aucun workflow modèle fichiers.',
        identifier: '{name}',
        invalid: 'Invalide',
        invalidFile: 'Invalide fichier',
        loading: 'Fichier modèles...',
        valid: 'Disponible',
        sources: {
          builtin: 'Intégré',
          userImported: 'Utilisateur importé'
        },
        errors: {
          actionFailed: 'Échec de l’opération : exécution fichier modèle action',
          loadFailed: 'Échec du chargement de workflow fichier modèles',
          missingApplyTarget: 'Manquant workflow cible à appliquer'
        }
      },
      credentials: {
        actions: {
          create: 'Créer un identifiant'
        },
        addTitle: 'Ajouter identifiant',
        count: '{count} élément(s)',
        description: 'Créer réutilisable connexion et API identifiants pour workflows dans unique. le frontend uniquement et eux, sans manuel interne référence.',
        empty: 'Aucun backend identifiant enregistrements. après création, peut être sélectionné directement dans variables, SSH nœuds, et HTTP nœuds.',
        loading: 'Chargement de identifiant métadonnées depuis backend...',
        registeredTitle: 'Enregistré identifiants',
        title: 'Gestion des identifiants',
        fields: {
          deliveryLocation: 'Transmission emplacement',
          headerOrParam: 'Nom de Header /',
          name: 'Nom de identifiant',
          referenceLocation: 'Référence emplacement',
          storageType: 'Type',
          type: 'Identifiant type',
          username: 'Nom d’utilisateur'
        },
        kinds: {
          common: {
            family: 'Général'
          },
          sshKey: {
            title: 'Clé privée SSH'
          },
          usernamePassword: {
            title: 'Nom d’utilisateur + mot de passe'
          }
        },
        secretLabels: {
          password: 'Mot de passe',
          sshKey: 'Clé privée SSH'
        },
        placeholders: {
          apiKey: 'Saisir l’API Key',
          bearer: 'Saisir le Bearer Token',
          password: 'Saisir connexion mot de passe',
          sshKey: 'Coller la clé privée au format PEM'
        },
        messages: {
          created: 'Identifiant créé. il peut être sélectionné dans workflow variables, SSH nœuds, et HTTP nœuds.'
        },
        errors: {
          createFailed: 'Échec de la création de identifiant',
          loadFailed: 'Échec du chargement de backend identifiants',
          missingCreatedId: 'Identifiant création a non retourner un valide ID'
        }
      }
    }
  },
  monitoring: {
    actions: {
      add: 'Ajouter une supervision',
      probe: 'Test sites',
      probing: 'Test en cours...',
      refresh: 'Actualiser les données',
      refreshing: 'Actualisation...',
      remove: 'Retirer'
    },
    errors: {
      addFailed: 'Échec de l’opération : ajouter supervision cible',
      deleteFailed: 'Échec de la suppression de supervision cible',
      invalidTarget: 'Le backend retourné un invalide supervision cible',
      loadFailed: 'Échec du chargement de supervision données',
      probeFailed: 'Échec de test requête',
      updateIntervalFailed: 'Échec de la mise à jour de test intervalle'
    },
    empty: {
      actualCertificate: 'Aucun observé TLS certificat encore. HTTPS cibles collecter certificat informations automatiquement pendant site.',
      description: 'Ajouter un supervision depuis le. le système va test le site sur et collecter certificat informations.',
      noAddableAssets: 'Aucun application actifs peut être ajouté. ajuster existant cible test dans le détail voir.',
      observedCertificateHistory: 'Aucun lié certificat versions encore. le en premier certificat collecté par un site test va être automatiquement.',
      probeHistory: 'Aucun test historique.',
      riskEvents: 'Aucun associé événements.',
      title: 'Aucun supervision cibles'
    },
    sections: {
      actualCertificate: 'observé site certificat actuel',
      actualCertificateHint: 'Collecté automatiquement pendant site',
      observedCertificateHistory: 'Lié certificat versions',
      observedCertificateHistoryHint: 'Conserve version enregistrements comme observé TLS certificats modification',
      probeHistory: 'Historique de test',
      probeHistoryHint: 'Dernier 20 backend test résultats',
      riskEvents: 'Risque événements',
      riskEventsHint: 'Certificat chaîne, domaine, empreinte, et exécution état',
      targets: 'Supervision cibles'
    },
    labels: {
      applicationAsset: 'Application actif',
      currentTarget: 'cible actuel',
      probeInterval: 'Test intervalle'
    },
    metrics: {
      availability: 'Disponibilité',
      certificateStatus: 'État du certificat',
      latency: 'Latence',
      observedCertificateChanges: 'Observé certificat modifications'
    },
    probe: {
      completed: 'Test terminé',
      emptyHistoryBlock: 'Test {index}: aucun test encore',
      latencyNotCollected: 'Latence non collecté',
      recentAria: 'Dernier 10 test résultats',
      waiting: 'En attente pour site test'
    },
    status: {
      error: 'Erreur',
      none: 'En attente',
      ready: 'Sain',
      warning: 'Avertissement'
    },
    fallback: {
      noEndpoint: 'Aucun adresse configuré',
      noFingerprint: 'Aucun empreinte',
      noSummary: 'Aucun synthèse',
      notCollected: 'Non collecté',
      notSelected: 'Non sélectionné',
      unknownAsset: 'actif inconnu',
      unknownCertificate: 'certificat inconnu',
      unknownIssuer: 'émetteur inconnu',
      unnamedEvent: 'événement sans nom'
    },
    certificate: {
      actualCertificate: 'Certificat observé',
      chainUntrusted: 'Non approuvé par la chaîne de confiance système',
      chainVerification: 'Vérification de chaîne',
      chainVerified: 'Chaîne vérifiée',
      chainVerifyFailedWithReason: 'Échec de la vérification de chaîne : {reason}',
      collectedAt: 'Collecté le',
      issuer: 'Émetteur',
      serialNumber: 'Numéro de série',
      sha256Fingerprint: 'Empreinte SHA-256',
      subject: 'Sujet',
      validity: 'Validité',
      validityRange: '{start} à {end}'
    },
    columns: {
      certificateName: 'Nom du certificat',
      changedAt: 'Modifié à',
      expiresAt: 'Expire à',
      issuerName: 'Nom de l’émetteur',
      latency: 'Latence',
      result: 'Résultat',
      source: 'Source',
      status: 'État',
      time: 'Heure'
    },
    dialog: {
      defaultMetricsHint: 'Disponibilité, latence, certificat informations, et certificat historique sont par par défaut.',
      description: 'Sélectionner un cible depuis application actifs. le système va collecter disponibilité, latence, certificat informations, et certificat historique.',
      loadingAssets: 'Chargement de actifs...',
      selectAsset: 'Sélectionner application actif',
      title: 'Ajouter une supervision'
    },
    source: {
      controlPlane: 'Plateforme'
    },
    targets: {
      assetCount: '{count} actifs'
    }
  },
  login: {
    visualLabel: 'Présentation du produit',
    brand: 'Console de certificats GCAC',
    brandSecondary: 'Plateforme centralisée de gestion des certificats',
    headlinePrefix: 'Rendre la gestion des certificats',
    headlineHighlight: 'plus intelligente',
    headlineSuffix: ' et plus sûre',
    intro: 'Gérez les actifs de certificats dans un espace unique, orchestrez les déploiements automatisés et tracez les audits de bout en bout afin de transformer l’exploitation manuelle des certificats en processus standardisés, vérifiables et traçables pour protéger l’infrastructure numérique de l’entreprise.',
    capabilitiesLabel: 'Capacités de la plateforme',
    featureLifecycle: 'Gestion du cycle de vie complet',
    featureLifecycleDesc: 'De l’import au renouvellement, du suivi des versions aux alertes d’expiration, chaque étape des actifs de certificats est couverte.',
    featureAutomation: 'Orchestration de déploiement automatisée',
    featureAutomationDesc: 'Pour les environnements courants comme Nginx, Tomcat et IIS, générez en un clic des plans de déploiement auditables.',
    featureRollback: 'Exécution sécurisée et rollback',
    featureRollbackDesc: 'Vérification automatique avant déploiement, traçabilité complète pendant l’exécution et rollback en cas d’échec pour préserver la stabilité de la production.',
    formLabel: 'Formulaire de connexion',
    secure: 'Connexion sécurisée',
    welcome: 'Connexion à la console',
    hint: 'Utilisez votre compte d’entreprise pour accéder à l’espace d’administration GCAC',
    username: 'Nom d’utilisateur',
    usernamePlaceholder: 'Saisissez le nom d’utilisateur',
    password: 'Mot de passe',
    passwordPlaceholder: 'Saisissez le mot de passe',
    failed: 'Échec de la connexion, veuillez réessayer plus tard',
    submitting: 'Vérification de l’identité…',
    submit: 'Connexion',
    policy: 'Protection des droits RBAC',
    audit: 'Audit complet des opérations'
  },
  compatibility: {
    title: 'Catalogue de compatibilité', description: 'Les niveaux, limites et preuves proviennent des profils de compatibilité.', generatedAt: 'Généré le : {time}', loading: 'Chargement du catalogue…', loadFailed: 'Échec du chargement du catalogue', none: 'Aucun',
    columns: { profile: 'Profil', version: 'Version', status: 'État', automation: 'Automatisation', evidence: 'Preuve', verifiedAt: 'Dernière vérification', limitations: 'Limites' },
    status: { certified: 'Certifié', supported: 'Pris en charge', compatible: 'Compatible', experimental: 'Expérimental', legacy: 'Ancien', unsupported: 'Non pris en charge' },
    evidence: { current: 'Valide', expired: 'Expirée', failed: 'Échec' }
  },
  errors: {
    forbiddenTitle: '403 Accès refusé',
    forbiddenMessage: 'Vous ne disposez pas des droits nécessaires pour accéder à cette page.',
    missingPermission: 'Autorisation manquante : {permission}',
    notFoundTitle: '404 Page introuvable',
    notFoundMessage: 'Cette route n’est pas enregistrée.',
    backDashboard: 'Retour au tableau de bord'
  }
} as const
