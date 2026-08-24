// Auto-generated from messages.ts — do not edit manually.
// Edit messages.ts and re-run: npx tsx src/i18n/extract-locales.ts
import { devicesEnUS } from './devices.locale'
export default {
  devices: devicesEnUS,
  app: {
    brand: 'GCAC Console',
    platform: 'Enterprise SSL Certificate Lifecycle Platform',
    defaultBreadcrumb: 'Console',
    dashboard: 'Dashboard'
  },
  common: {
    refresh: 'Refresh',
    logout: 'Sign out',
    enter: 'Open',
    loading: 'Loading',
    userFallback: 'Guest user',
    tenantFallback: 'Default tenant'
  },
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
    confirm: {
      title: 'Confirm {action}',
      impactCount: 'Affected resources: {count}',
      defaultRisk: 'This operation may trigger deployment, retry, rollback, or irreversible changes.',
      typeToConfirm: 'Type {text} to confirm',
      cancel: 'Cancel',
      confirm: 'Confirm'
    },
    dataTable: {
      empty: 'No data',
      loading: 'Loading...'
    },
    dryRunChecklist: {
      title: 'Dry-run precheck results',
      ariaLabel: 'dry-run precheck results',
      empty: 'No dry-run precheck results have been generated.',
      unnamedCheck: 'Unnamed check'
    },
    dryRunResult: {
      title: 'Dry-run execution result',
      close: 'Close'
    },
    modal: {
      closeAria: 'Close modal'
    },
    secretInput: {
      label: 'Secret reference',
      placeholder: 'Select or enter a SecretRef. Plain text is not saved.',
      hint: 'Sensitive fields only store references and are not kept as long-lived plain text in the browser.'
    },
    riskBadge: {
      levelPrefix: 'Level: '
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
      ERROR: 'Error',
      IGNORED: 'Ignored',
      ONLINE: 'Online',
      OFFLINE: 'Offline',
      DISABLED: 'Disabled',
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
      available: 'Available',
      missing: 'Missing',
      title: 'Capability compatibility',
      description: 'Only backend-confirmed capability results are shown; unknown items are not treated as successful.',
      matrixLabel: 'Capability compatibility matrix',
      satisfied: 'Satisfied',
      unknown: 'Unknown',
      manualRisk: 'Manual review',
      empty: 'No capability data. The frontend keeps a degraded display.'
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
        execution: 'Execution'
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
        warning: 'Warning'
      },
      step: {
        backup: 'Pre-backup',
        discover: 'Environment discovery',
        installDryRun: 'Material loading',
        installExecution: 'Certificate installation',
        reload: 'Service reload',
        verify: 'Result verification'
      },
      subtitle: {
        completed: 'The task has completed.',
        failed: 'The task ended with a failed result.',
        failedChecks: '{total} checks, {failed} failed',
        passedChecks: '{total} checks passed',
        queued: 'The task has been created and is waiting to run.',
        running: 'The task has started. Waiting for more results.',
        runningChecks: '{total} checks returned',
        warningChecks: '{total} checks, {warning} warnings'
      },
      time: {
        waitingStart: 'Waiting to start'
      }
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
  shell: {
    currentLocation: 'Current location',
    breadcrumb: 'Breadcrumb',
    currentGroupNavigation: 'Current group navigation',
    backDashboard: 'Back to dashboard'
  },
  preferences: {
    theme: 'Theme',
    language: 'Language',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeToggle: 'Switch theme',
    languageSelect: 'Select language',
    title: 'Display preferences',
    description: 'Theme and language are saved to your backend user preferences.',
    errors: {
      loadFailed: 'Failed to load preferences',
      saveFailed: 'Failed to save preferences'
    }
  },
  userMenu: {
    currentUser: 'Current user',
    changePassword: 'Change password',
    logout: 'Sign out'
  },
  password: {
    title: 'Change password',
    description: 'Change the local password for the signed-in user.',
    current: 'Current password',
    new: 'New password',
    confirm: 'Confirm new password',
    cancel: 'Cancel',
    submit: 'Save password',
    submitting: 'Saving…',
    success: 'Password updated',
    failed: 'Password change failed',
    mismatch: 'The new passwords do not match',
    tooShort: 'The new password must be at least 8 characters'
  },
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
    automations: 'Automations',
    automationsDesc: 'Scheduled, on-demand, and batch certificate renewal plans',
    plugins: 'Plugins',
    pluginsDesc: 'Provider, executor, and sandbox status',
    monitoring: 'Monitoring',
    monitoringDesc: 'Alerts, audit, and certificate status',
    monitorAlerts: 'Monitor alerts',
    monitorAlertsDesc: 'Expiry, drift, and execution failure events',
    audits: 'Audit logs',
    auditsDesc: 'Operation evidence and compliance exports',
    reports: 'Reports',
    reportsDesc: 'Certificate incident windows, risk response, and automation effectiveness',
    incidentWindowReport: 'Incident window',
    incidentWindowReportDesc: 'Prioritize expiring and expired certificates',
    riskResponseReport: 'Risk response',
    riskResponseReportDesc: 'Acknowledgement, resolution time, and SLA',
    automationEffectivenessReport: 'Automation effectiveness',
    automationEffectivenessReportDesc: 'Run and target success rates with failure stages',
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
  automations: {
    title: 'Automations',
    description: 'Manage scheduled, on-demand, and batch certificate renewal plan execution.',
    empty: 'No automations yet.',
    emptyDescription: 'No description',
    common: { notAvailable: 'Not available' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'The automation will process {domains} using: {version}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: 'Trigger through external API', apiHelp: 'An external system calls the automation run API. Target preview, Dry Run, and approval rules still apply to every request.', once: 'Run once at a fixed time', onceHelp: 'Choose a browser-local time. The task is not scheduled again after it runs.', recurring: 'Run periodically', scheduleHelp: 'Run on a recurring schedule. Use only when continuous polling is genuinely required.', recurringHelp: 'Run on a recurring schedule. Use only when continuous polling is genuinely required.', recurringWarningTitle: 'Periodic execution is not recommended for certificate updates', recurringWarning: 'Certificate replacement should normally be triggered after certificate issuance or scheduled once at a fixed time. Use periodic execution only for an explicit recurring-check requirement.', runAt: 'Execution time', frequency: 'Frequency', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', time: 'Time', weekday: 'Weekday', monthDay: 'Day of month', legacyCustom: 'Keep existing custom schedule', legacyCron: 'Existing Cron (read-only)', weekdays: { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' } },
    form: { existingAssetTitle: 'Update existing application assets only', existingAssetDescription: 'The automation only processes application assets with existing certificate bindings. It does not install certificates for the first time or add deployment targets.', certificateDomains: 'Certificate domains', certificateDomainsPlaceholder: 'Enter certificate domains separated by commas', certificateDomainsHelp: 'Only existing application-asset bindings for these certificate domains are updated.', versionSelection: 'Certificate version to deploy', versionSelectionLatest: 'Automatically use the latest certificate version', versionSelectionSpecific: 'Use specific certificate versions', versionSelectionHelp: 'The version is resolved and frozen when the run starts, so later versions cannot change an active run.', certificateVersionIds: 'Specific certificate versions', certificateVersionIdsPlaceholder: 'Enter certificate version IDs separated by commas', certificateVersionIdsHelp: 'Each version must belong to a certificate selected by the domains above.', versionLoading: 'Loading available certificate versions.', versionLoadFailed: 'Failed to load certificate versions. Try again later.', versionEmpty: 'No selectable certificate versions were found for these domains.', schedule: 'When to update', scheduleHelp: 'Administrators can start it on demand or run it periodically with Cron and a time zone.', execution: 'What happens during a run', executionHelp: 'The system creates a separate update plan for each existing asset binding and reuses DeploymentPlan, Dry Run, approval, and ExecutionRun.', snapshot: 'Freeze the domain, asset, and certificate-version snapshot' },
    fields: { name: 'Name', description: 'Description', trigger: 'Trigger', cron: 'Cron expression', timeZone: 'Time zone', expiresWithinDays: 'Expiry window in days', environments: 'Target environments (comma separated)', certificateIds: 'Specific certificates (optional)', certificateIdsPlaceholder: 'Enter certificate IDs separated by commas', certificateIdsHelp: 'When filled, only these certificates are processed; otherwise expiry and environment rules are used.', expiresWithinDaysHelp: 'Only match certificates expiring within this window.', environmentsHelp: 'Only process certificates in these environments, such as production or staging.', planType: 'Deployment plan type', planTypeHelp: 'A separate DeploymentPlan is created at runtime for each matched certificate target.', planTypeUpdate: 'Update an existing certificate binding', planTypeInstall: 'Install a certificate on the target', planTypeVerifyOnly: 'Verify only, make no certificate change', planMode: 'Run mode', planModeHelp: 'The automation does not bind an existing plan; it creates a new plan at runtime for each target.', planModeCreateAndExecute: 'Create and execute the plan', planModeCreateOnly: 'Create plans only, do not execute yet', maxTargets: 'Maximum targets per run', concurrency: 'Concurrency', failureCount: 'Failure count threshold', requireDryRun: 'Require Dry Run before execution', requireApproval: 'Require approval before execution', startedAt: 'Started at', finishedAt: 'Finished at', failureStage: 'Failure stage', parentRun: 'Parent run' },
    actions: { create: 'Create automation', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', save: 'Save', copy: 'Copy', enable: 'Enable', disable: 'Disable', preview: 'Preview targets', history: 'Run history', confirmRun: 'Confirm run', stop: 'Stop run', retryFailed: 'Retry failed targets', openPlan: 'Open deployment plan', openExecution: 'Open execution run' },
    columns: { trigger: 'Trigger', targets: 'Target limit', actions: 'Actions', nextRun: 'Next run', lastRun: 'Last run' },
    triggers: { onDemand: 'On demand', schedule: 'Scheduled' },
    triggerTypes: { on_demand: 'On demand', schedule: 'Scheduled', retry: 'Failed-target retry' },
    actionTypes: { create_deployment_plan: 'Create certificate renewal plan', execute_deployment_plan: 'Execute certificate renewal plan', send_notification: 'Send notification' },
    summaries: { targets: 'Up to {count} targets' },
    preview: { title: 'Target preview', description: 'Review the target snapshot and exclusions that will be frozen at startup.', matched: '{count} matched', executable: '{count} executable', excluded: '{count} excluded', ready: 'Ready' },
    exclusions: { permission_denied: 'Target permission denied', missing_version: 'Certificate version missing', version_not_deployable: 'Certificate version is not deployable', binding_not_managed: 'Binding is unmanaged', environment_not_allowed: 'Environment is not allowed', unknown: 'Unknown exclusion reason' },
    failureStages: { selection: 'Target selection', plan_creation: 'Plan creation', dry_run: 'Dry Run', approval: 'Approval', execution: 'Execution', verification: 'Verification', rollback: 'Rollback', notification: 'Notification' },
    progress: { total: 'Total', pending: 'Pending', running: 'Running', waitingApproval: 'Waiting approval', succeeded: 'Succeeded', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' },
    editor: { createTitle: 'Create automation', editTitle: 'Edit automation', description: 'Configure when it runs, which certificates it handles, how deployment plans are created, and what happens on failure.', sections: { basic: 'Basic information', basicHelp: 'Give the automation a recognizable name and explain which certificate changes it handles.', targets: 'Which certificates to process', targetsHelp: 'This selects certificate targets, not existing deployment plans; the target snapshot is frozen when the run starts.', plan: 'Certificate deployment plan', planRelationTitle: 'This does not bind an existing deployment plan', planRelationDescription: 'A deployment plan is created at runtime from the certificate filters above.', planRelationHelp: 'Each matched certificate target gets its own DeploymentPlan, and its plan ID appears in run details.', guardrails: 'Execution safety controls', guardrailsHelp: 'These limits control batch size, prechecks, approval, and when failures stop the run.' }, chain: { createPlan: 'Create a DeploymentPlan for each target', dryRun: 'Run the Dry Run precheck', approval: 'Wait for approval', executePlan: 'Execute that target DeploymentPlan' } },
    runs: { title: 'Automation run history', description: 'Review run-level status, immutable target snapshots, and failure stages.', progress: '{succeeded}/{total} succeeded' },
    runDetail: { title: 'Automation run details', description: 'Configuration version {version}', noFailure: 'No failure' },
    aria: { preview: 'Automation target preview', runs: 'Automation run list', progress: 'Automation run progress' },
    errors: { loadFailed: 'Failed to load automations' }
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
    description: 'Browse built-in and user-defined DSL templates as versioned plugins with logos and capability metadata.',
    resourceName: 'Plugin',
    actions: {
      install: 'Install plugin',
      detail: 'Details',
      create: 'Create',
      refresh: 'Refresh market',
      refreshing: 'Refreshing...',
      createWorkflow: 'Create workflow',
      creatingWorkflow: 'Creating...',
      enable: 'Enable',
      disabling: 'Disabling...',
      disable: 'Disable',
      disableRisk: 'Disabling a plugin affects provider, template, and executor capabilities.'
    },
    market: {
      eyebrow: 'DSL Plugin Market',
      title: 'Discover reusable automation capabilities',
      description: 'Built-in templates ship with the system, while user templates come from data/workflows. Each template can maintain its own logo, semantic version, and capability tags.'
    },
    sources: { builtin: 'Built-in', user: 'User plugin' },
    statuses: { valid: 'Available', invalid: 'Invalid', available: 'Ready to create', enabled: 'Enabled', disabled: 'Not enabled', pendingApproval: 'Pending approval', inUse: 'In use', notInUse: 'Not used' },
    filters: {
      searchLabel: 'Search plugins',
      searchPlaceholder: 'Search by name, tag, category, or path',
      allSources: 'All sources',
      allStatuses: 'All statuses',
      statusLabel: 'Plugin status'
    },
    card: {
      defaultDescription: 'This DSL plugin has no description yet.',
      unversioned: 'Unversioned',
      stepCount: '{count} execution steps'
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
      builtin: { title: 'Built-in plugins' },
      user: { title: 'User plugins' },
      using: { title: 'In use' },
      risky: {
        title: 'High-risk pending',
        description: 'Plugins with high-risk permissions, signature errors, or sandbox isolation.'
      }
    },
    empty: {
      title: 'No plugins',
      description: 'No matching DSL plugins were found. Adjust the filters or import a template into data/workflows.'
    },
    detail: {
      title: 'Plugin details',
      titleWithName: 'Plugin {name}',
      description: 'Review the DSL plugin source, version, logo, step counts, and file location.',
      versionLabel: 'Version {version}'
    },
    fields: {
      pluginId: 'Plugin ID',
      name: 'Plugin name',
      currentStatus: 'Current status',
      version: 'Version',
      source: 'Source',
      category: 'Category',
      steps: 'Execution steps',
      rollbackSteps: 'Rollback steps',
      updatedAt: 'Updated at',
      filePath: 'Template path',
      logoUrl: 'Logo URL',
      platforms: 'Target platforms',
      updateMethods: 'Update methods',
      maintainer: 'Maintainer',
      homepage: 'Homepage',
      usage: 'Usage status',
      validationError: 'Validation error',
      signatureStatus: 'Signature status',
      riskLevel: 'Risk level'
    },
    aria: {
      filters: 'Plugin market filters',
      list: 'DSL plugin list',
      logo: '{name} logo'
    },
    errors: {
      loadFailed: 'Failed to load the plugin market',
      createFailed: 'Failed to create a workflow from the plugin'
    },
    agentDeployment: {
      mount: 'Mount to Agent', mounting: 'Mounting...', selectAgent: 'Select target Agent', type: 'Plugin type', targetAgent: 'Target Agent', mountFailed: 'Failed to mount Agent plugin',
      executionMode: 'Agent execution mode', nativeHandler: 'Native handler', pluginMode: 'Agent plugin', mountedPlugin: 'Mounted plugin', selectMountedPlugin: 'Select a mounted plugin',
      plugin: 'Deployment plugin', selectPlugin: 'Select a deployment plugin', noCompatiblePlugin: 'No enabled plugin matches the current platform and framework', compatiblePluginHint: 'Only enabled plugins matching the asset platform and framework are shown.',
      secretRefPlaceholder: 'Enter a SecretRef identifier', artifactBinding: 'Certificate artifact {name}', artifactBindingPlaceholder: 'Example: value=fullchain,key=private', preview: 'Validate plugin settings', previewFailed: 'Failed to validate Agent plugin settings',
      approveAndEnable: 'Approve and enable', activating: 'Enabling...', activateFailed: 'Failed to approve or enable Agent plugin',
      types: { WORKFLOW_TEMPLATE: 'Workflow template', AGENT_DEPLOYMENT: 'Agent deployment plugin' }
    },
    changeSummaries: { createWorkflow: 'Create workflow from plugin market template' }
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
      commandStepTitle: 'Generate install command',
      commandCopied: 'Install command copied',
      copyCommand: 'Copy install command',
      copyToken: 'Copy token',
      expired: 'Expired',
      generateCommand: 'Generate install command',
      generating: 'Generating...',
      compatibilityInstallUnavailable: 'The one-time installer for Windows Compatibility Agent is not published yet. Do not substitute a Windows Modern Agent command.',
      installEntryPending: 'Installer pending',
      linuxGeneralTitle: 'General Linux Agent',
      linuxGroupTitle: 'Linux',
      modalDescription: 'Choose platform and version to generate a one-time install command. The token is valid for 10 minutes and can only be used once.',
      modalTitle: 'Install Agent',
      platform: 'Platform',
      platformLinuxDescription: 'For Ubuntu, Debian, CentOS, Rocky, AlmaLinux, and other Linux distributions.',
      platformWindowsDescription: 'For Windows Server and Windows 10/11. Registers as a system service after installation.',
      remainingTime: '{minutes}m {seconds}s',
      remainingValidity: 'Remaining validity',
      selectedAgent: 'Selected Agent',
      selectionStepTitle: 'Select Agent type',
      singleUseHint: 'Once the bootstrap script requests this token, it expires immediately and cannot be reused.',
      tokenCopied: 'Token copied',
      version: 'Version',
      versionLatest: 'Latest stable',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows Compatibility Agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 and later',
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
        title: 'Agent'
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
    title: 'Notification Management',
    description: 'Manage notification channels, routes, templates, silences, and reliable delivery records.',
    tabs: { channels: 'Channels', deliveries: 'Deliveries', rules: 'Rules and templates' },
    sections: { channels: 'Channel records', deliveries: 'Delivery records' },
    channels: { createTitle: 'Create notification channel' },
    settings: { privateOriginsTitle: 'Private deployment endpoints', privateOriginsDescription: 'Configure private HTTPS Origins that Notification Management may access for WeCom, Feishu, and DingTalk.' },
    channelTypes: { email: 'Email', wecom: 'WeCom', slack: 'Slack', feishu: 'Feishu', dingtalk: 'DingTalk', telegram: 'Telegram', webhook: 'Generic Webhook' },
    deploymentModes: { public: 'Public cloud', private: 'Private deployment' },
    fields: {
      name: 'Channel name', type: 'Channel type', deploymentMode: 'Deployment mode', smtpHost: 'SMTP host', smtpPort: 'SMTP port', from: 'From address',
      smtpSecurity: 'Connection security', smtpUsername: 'SMTP username', smtpPassword: 'SMTP password', secretValuePlaceholder: 'Enter the secret value',
      optionalSecretValuePlaceholder: 'Optional; enter the secret value', wecomWebhookUrl: 'WeCom group bot Webhook URL', slackWebhookUrl: 'Slack Incoming Webhook URL',
      feishuWebhookUrl: 'Feishu custom bot Webhook URL', dingtalkWebhookUrl: 'DingTalk custom bot Webhook URL', feishuSigningSecret: 'Feishu signing secret',
      dingtalkSigningSecret: 'DingTalk signing secret', telegramBotToken: 'Telegram Bot Token', telegramChatId: 'Telegram Chat ID', telegramMessageThreadId: 'Telegram Topic ID (optional)',
      webhookUrl: 'Webhook URL', webhookUrlPlaceholder: 'Enter the complete Webhook URL', webhookMethod: 'HTTP method', webhookHeaders: 'Fixed headers (JSON)',
      webhookHeadersPlaceholder: 'Example: x-source = gcac', signingSecret: 'HMAC-SHA256 signing secret', testTarget: 'Test recipient',
      testTargetPlaceholder: 'Email recipients can be comma-separated', lastSuccess: 'Last success', latency: 'Latency (ms)',
      createdAt: 'Created at', updatedAt: 'Updated at', failureCategory: 'Failure category', channel: 'Notification channel', selectChannel: 'Select a notification channel',
      source: 'Event source', priority: 'Route priority', dedupeWindow: 'Dedupe window (seconds)', templateKey: 'Template key', locale: 'Locale',
      titleTemplate: 'Title template', bodyTemplate: 'Body template', reason: 'Silence reason', startsAt: 'Starts at', endsAt: 'Ends at',
      wecomPrivateOrigins: 'WeCom private Origins', feishuPrivateOrigins: 'Feishu private Origins', dingtalkPrivateOrigins: 'DingTalk private Origins', privateOriginsPlaceholder: 'One per line, for example https://notify.example.internal'
    },
    actions: {
      createChannel: 'New channel', createRoute: 'New route', createTemplate: 'New template', createSilence: 'New silence',
      confirmCreate: 'Create', cancel: 'Cancel', saveSettings: 'Save settings', test: 'Send test', testChannel: 'Test channel: {name}', retry: 'Retry delivery', enable: 'Enable', disable: 'Disable'
    },
    rules: { createRoute: 'Create notification route', createTemplate: 'Create notification template', createSilence: 'Create silence rule' },
    summary: { routes: 'Notification routes', templates: 'Notification templates', silences: 'Silence rules', recordCount: '{count} records' },
    empty: { channels: 'No notification channels', deliveries: 'No delivery records', routes: 'No notification routes', templates: 'No notification templates', silences: 'No silence rules' },
    values: { notAvailable: '—' },
    secrets: { name: '{channel} - {field}', fields: { smtpUsername: 'SMTP username', smtpPassword: 'SMTP password', webhookUrl: 'Webhook URL', signingSecret: 'Signing secret', botToken: 'Bot Token' } },
    messages: {
      loadFailed: 'Failed to load notification management data', operationFailed: 'Notification management operation failed', testUsesChannelTarget: 'This channel will send the test notification to its configured target.',
      secretStoredHint: 'This value is encrypted and will not be shown again after creation.', createSecretFailed: 'Failed to save the encrypted value', invalidHeaders: 'Fixed headers must be a valid JSON object',
      smtpCredentialsPairRequired: 'SMTP username and password must be provided together', webhookUrlRequired: 'Webhook URL is required', botTokenRequired: 'Telegram Bot Token is required',
      chatIdRequired: 'Telegram Chat ID is required', feishuWebhookUrlInvalid: 'Enter an official Feishu custom bot Webhook URL', dingtalkWebhookUrlInvalid: 'Enter an official DingTalk custom bot Webhook URL',
      wecomWebhookUrlInvalid: 'Enter a valid WeCom bot HTTPS Webhook URL', telegramBotTokenInvalid: 'The Telegram Bot Token format is invalid', telegramMessageThreadIdInvalid: 'The Telegram Topic ID must be a positive integer',
      privateDeploymentAllowlistHint: 'Private endpoints must first be added to the trusted HTTPS Origin list above, otherwise testing and delivery are rejected.', privateOriginInvalid: 'A private endpoint must be an exact HTTPS Origin without a path, query, user information, or fragment.', privateOriginsSecurityHint: 'Enter only the scheme, host, and optional port. Full Webhook URLs, tokens, and signing secrets remain encrypted in the Secret service.', telegramUsesBotApi: 'Telegram notifications use the official Bot API sendMessage method, not the event-receiving Webhook.'
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
      accessLevel: {
        read: 'Read only',
        edit: 'Edit',
        control: 'Full control'
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
    actions: {
      create: 'New config file',
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
  assets: {
    title: 'Application assets',
    description: 'Manage application entry points by domain or IP, focusing on address, port, protocol, site, and execution targeting.',
    resourceName: 'Application asset',
    actions: {
      add: 'Add asset',
      edit: 'Edit',
      detail: 'Details',
      addVariable: 'Add variable',
      delete: 'Delete',
      rollbackFromLatestSnapshot: 'Rollback from latest snapshot',
      rollingBack: 'Rolling back...',
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
      artifactFormat: 'Artifact format'
    },
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
      optionalOutput: 'Optional'
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
      dslSyncHint: 'Synced to DSL target variables',
      advancedTitle: 'Advanced settings',
      advancedDescription: 'Change only when overriding the default listener, request host, or TLS certificate name.',
      expandAdvanced: 'Expand advanced settings',
      collapseAdvanced: 'Collapse advanced settings',
      bindingInformationLabel: 'Service listener rule',
      bindingInformationHelp: 'Describes the address, port, and host combination used by the service listener.',
      hostHeaderLabel: 'Request host name',
      hostHeaderHelp: 'Change only when the target service requires a specific HTTP Host header.',
      sniNameLabel: 'TLS certificate name',
      sniNameHelp: 'Change only when the TLS handshake name differs from the access host.'
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
        verifyHost: 'Verification host',
        verifyPort: 'Verification port',
        verifyPath: 'Verification path',
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
      createAssetFailed: 'Failed to create application asset',
      loadWorkflowCredentialsFailed: 'Failed to load workflow credentials',
      noAvailableSiteInstance: 'No available site instance found. Confirm framework sites have been reported successfully in Agent details.'
    },
    platforms: {
      appliance: 'Appliance'
    },
    runners: {
      controlPlane: 'Control plane'
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
        outputFormat: 'Output format',
        usernameVariable: 'Username variable',
        variable: 'Variable',
        verifyType: 'Verify type'
      },
      options: {
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
        rename: 'Rename',
        saveName: 'Save name',
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
        title: 'Workflow name',
        description: 'Changes the name shown in lists and details without rewriting historical versions.',
        placeholder: 'Enter workflow name',
        messages: { success: 'Workflow name updated.' },
        errors: { required: 'Workflow name is required.', failed: 'Failed to update workflow name.' }
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
  reports: {
    common: {
      loadFailed: 'Failed to load the report',
      dataAsOf: 'Data as of: {time}',
      rangeDays: 'Last {days} days',
      samples: 'Samples: {count}',
      secondsValue: '{value} seconds',
      emptyValue: '—',
      trend: 'Historical trend',
      date: 'Date',
      snapshotMetrics: 'Snapshot metrics',
      completeness: 'Completeness',
      complete: 'Complete',
      incomplete: 'Incomplete',
      noTrend: 'No historical snapshots in this range',
      groupBreakdown: 'Group breakdown',
      dimension: 'Dimension',
      groupValue: 'Group value',
      count: 'Count',
      noGroups: 'No group data',
      drilldown: 'Object drill-down',
      selectedMetric: 'Selected metric: {metric}',
      noItems: 'No matching objects'
    },
    incidentWindow: {
      title: 'Certificate incident window report',
      description: 'Find certificates entering the incident window and identify missing replacements, plans, approvals, or execution channels.'
    },
    riskResponse: {
      title: 'Risk response report',
      description: 'Review acknowledgement and resolution timeliness, incomplete samples, reopened risks, and SLA breaches.'
    },
    automationEffectiveness: {
      title: 'Automation effectiveness report',
      description: 'Compare run-level and target-level success rates and locate retries, rollbacks, manual intervention, and failure stages.'
    },
    export: {
      csv: 'Export CSV',
      generating: 'Generating…',
      failed: 'CSV generation failed',
      history: 'Export history',
      download: 'Download',
      noHistory: 'No export history',
      status: {
        queued: 'Queued',
        running: 'Generating',
        succeeded: 'Completed',
        failed: 'Failed',
        expired: 'Expired'
      }
    },
    aria: {
      reportPage: 'Operations report page',
      rangeFilter: 'Report date range',
      metrics: 'Core report metrics',
      filters: 'Report filters'
    },
    filters: {
      environment: 'Environment',
      ownerId: 'Owner ID',
      assetId: 'Object ID',
      tag: 'Tag',
      severity: 'Severity',
      riskType: 'Risk type',
      automationId: 'Automation ID',
      failureStage: 'Failure stage',
      all: 'All',
      apply: 'Apply filters',
      reset: 'Reset filters'
    },
    groups: {
      dimensions: {
        usage_status: 'Usage status',
        readiness_stage: 'Readiness stage',
        environment: 'Environment',
        owner_id: 'Owner',
        severity: 'Severity',
        risk_type: 'Risk type',
        action_type: 'Action type',
        failure_stage: 'Failure stage'
      },
      values: {
        in_use: 'In use',
        idle: 'Idle',
        unknown: 'Unknown',
        missing_replacement: 'Missing replacement',
        plan_missing: 'Plan not created',
        waiting_approval: 'Waiting approval',
        blocked: 'Execution channel blocked',
        ready: 'Ready',
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        create_deployment_plan: 'Create deployment plan',
        execute_deployment_plan: 'Execute deployment plan',
        send_notification: 'Send notification',
        selection: 'Selection',
        plan_creation: 'Plan creation',
        dry_run: 'Dry run',
        approval: 'Approval',
        execution: 'Execution',
        verification: 'Verification',
        rollback: 'Rollback',
        notification: 'Notification',
        none: 'No failure stage'
      }
    },
    columns: {
      certificateAssetId: 'Certificate asset ID',
      certificateVersionId: 'Certificate version ID',
      name: 'Name',
      primaryDomain: 'Primary domain',
      notAfter: 'Expires at',
      usageStatus: 'Usage status',
      readinessStage: 'Readiness stage',
      environment: 'Environment',
      ownerId: 'Owner',
      tags: 'Tags',
      publicExposure: 'Public exposure',
      bindingIds: 'Binding IDs',
      risk: 'Risk',
      history: 'Status history',
      slaPolicy: 'SLA policy',
      timing: 'Response timing',
      id: 'ID',
      automationId: 'Automation ID',
      automationVersion: 'Automation version',
      automationNameSnapshot: 'Automation name',
      triggerType: 'Trigger type',
      status: 'Status',
      failureStage: 'Failure stage',
      startedAt: 'Started at',
      finishedAt: 'Finished at',
      createdAt: 'Created at',
      runId: 'Run ID',
      targetSnapshot: 'Target snapshot',
      actionType: 'Action type',
      deploymentPlanId: 'Deployment plan ID',
      executionRunId: 'Execution run ID',
      notificationRequestIds: 'Notification request IDs',
      attemptCount: 'Attempt count',
      rollbackStatus: 'Rollback status',
      manualIntervention: 'Manual intervention',
      unknown: '{name}'
    },
    metrics: {
      certificates: {
        expiring: {
          '30d': 'Expires in 16–30 days',
          '15d': 'Expires in 8–15 days',
          '7d': 'Expires in 4–7 days',
          '3d': 'Expires in 2–3 days',
          '1d': 'Expires in 0–1 days'
        },
        expired: {
          in_use: 'Expired and in use'
        },
        missing_replacement: 'Missing replacement',
        missing_deployment_plan: 'Missing deployment plan',
        waiting_approval: 'Waiting for approval',
        execution_channel_blocked: 'Execution channel blocked'
      },
      risks: {
        created: 'Risks created',
        resolved: 'Risks resolved',
        reopened: 'Risks reopened',
        open_end_of_period: 'Open at period end',
        overdue_acknowledgement: 'Acknowledgement SLA overdue',
        overdue_resolution: 'Resolution SLA overdue',
        tta: {
          average_seconds: 'Average TTA'
        },
        ttr: {
          average_seconds: 'Average TTR'
        },
        ack_sla_rate: 'Acknowledgement SLA rate',
        resolve_sla_rate: 'Resolution SLA rate'
      },
      automations: {
        runs: {
          total: 'Automation runs',
          success_rate: 'Run-level success rate'
        },
        targets: {
          total: 'Automation targets',
          success_rate: 'Target-level success rate',
          failed: 'Failed targets',
          retried: 'Retried targets',
          rollback_succeeded: 'Rollback succeeded',
          rollback_failed: 'Rollback failed',
          manual_intervention: 'Manual intervention',
          waiting_approval: 'Targets waiting for approval'
        }
      }
    }
  },
  internalCa: {
    title: 'Internal CA', description: 'Manage internal certificate authorities, application certificate lifecycle, CA nodes, and certificate reuse risks.',
    tabs: { trustDomains: 'CA trust domains', authorities: 'Authorities', profiles: 'Profiles', requests: 'Requests', operations: 'Operations', risks: 'Reuse risks' },
    topology: { rootOnly: 'Root CA only', rootOnlyDescription: 'The root CA performs daily issuance and remains online.', rootOnlyRisk: 'High risk: root key compromise affects the entire trust domain.', intermediate: 'Root CA + intermediate CA', intermediateDescription: 'Keep the root offline and use an intermediate CA for daily issuance.', recommended: 'Recommended: isolate the root key and reduce the issuance blast radius.' },
    sections: { trustDomain: 'Create CA trust domain', provider: 'CA Provider', providerSettings: 'CA Provider settings', issuingBackends: 'Issuing backends and connections', authorityWizard: 'CA creation wizard', authorityOverview: 'Certificate authority hierarchy', authorityOverviewDescription: 'Each card represents one root trust anchor. Select a card to inspect its issuing hierarchy.', caArchitecture: 'CA hierarchy', riskSummary: 'Security decision summary', profile: 'Create certificate profile', request: 'Create application certificate request', revocation: 'Create revocation task', trust: 'Create trust distribution', remediation: 'Remediation preview' },
    fields: { name: 'Name', code: 'Code', purpose: 'Purpose', isolationLevel: 'Isolation level', defaultTrustDomain: 'Set as default trust domain', trustDomain: 'CA trust domain', parentAuthority: 'Parent root CA', authorityType: 'Authority type', providerType: 'External CA type', deploymentMode: 'Deployment mode', platform: 'Runtime platform', provider: 'CA Provider', backendName: 'Issuing backend name', availabilityMode: 'Availability mode', endpoint: 'Service endpoint', authMode: 'Authentication mode', profile: 'Issuance profile', template: 'Certificate template', crlUrl: 'CRL URL', ocspUrl: 'OCSP URL', issuingBackend: 'Issuing backend', entryMode: 'Creation mode', commonName: 'Common Name', securityDomain: 'Security domain', topology: 'CA topology', dnsSuffixes: 'Allowed DNS suffixes', validityDays: 'Maximum validity days', renewalDays: 'Renewal window days', requireApproval: 'Require approval before issuance', applicationAssetId: 'Application asset ID', authority: 'Certificate authority', profileVersionId: 'Profile version ID', sans: 'SAN list', custodyMode: 'Key custody mode', certificateVersionId: 'Certificate version ID', reason: 'Revocation reason', targetIds: 'Target ID list' },
    actions: { refresh: 'Refresh', addAuthority: 'Add CA', addIntermediate: 'Add intermediate CA', previous: 'Previous', next: 'Next', createTrustDomain: 'Create trust domain', createProvider: 'Create provider', previewRisk: 'Preview risk', createAuthority: 'Create CA', createProfile: 'Create profile', createRequest: 'Submit request', approve: 'Approve', retry: 'Retry', queryResult: 'Query result', scanRenewals: 'Scan renewals', createRevocation: 'Create revocation', createTrust: 'Create trust distribution', previewRemediation: 'Preview remediation' },
    placeholders: { dnsSuffixes: 'example.com, office.example.com', sans: 'oa.example.com, 10.0.0.10' },
    messages: { loadFailed: 'Failed to load internal CA data.', actionFailed: 'The operation failed. Check input, permissions, and approval status.', noIntermediate: 'This root CA has no intermediate authority yet.', noRootAuthority: 'No root CA configured', noRootAuthorityDescription: 'Add a root CA to establish the first independent trust hierarchy.', trustDomainCreated: 'CA trust domain created.', providerCreated: 'CA provider created.', authorityCreated: 'Certificate authority created.', profileCreated: 'Certificate profile created.', requestCreated: 'Certificate request submitted.', requestApproved: 'Certificate request approved.', requestRetried: 'Certificate issuance retried.', requestQueried: 'Remote issuance result refreshed.', renewalScanned: 'Renewal scan completed.', revocationCreated: 'Revocation task created and awaiting approval.', revocationApproved: 'Certificate revocation approved.', trustCreated: 'Trust distribution created and awaiting approval.', trustApproved: 'Trust distribution approved.' },
    metrics: { nodes: 'CA nodes', renewals: 'Renewals', revocations: 'Revocations', trust: 'Trust distributions', totalRisks: 'Total risks', critical: 'Critical risks', affectedAssets: 'Affected application assets' },
    labels: { rootAuthority: 'Root certificate authority', intermediateAuthority: 'Intermediate certificate authority', intermediateCount: '{count} intermediate authorities', expiresAt: 'Expires {time}', defaultTrustDomain: 'Default trust domain', independentTrustDomain: 'Independent root trust boundary', trustDomainCount: '{count} CA trust domains', versionCount: '{count} versions', assetCount: '{count} application assets', requestCount: '{count} independent certificate requests will be created', backendUsageCount: 'Used by {count} certificate authorities' },
    providerTypes: { gcac_builtin: 'GCAC built-in CA', gcac_managed_node: 'GCAC dedicated CA Node', microsoft_adcs: 'Microsoft AD CS', acme: 'ACME service', est: 'EST service', scep: 'SCEP service', product_adapter: 'Product adapter' },
    availability: { single: 'Single node', activeStandby: 'Active/standby', activeActive: 'Active/active' },
    authModes: { managedSecret: 'Managed credential', clientCertificate: 'Client certificate', none: 'No authentication' },
    wizard: { title: 'Add certificate authority', description: 'Choose an issuance model, then configure the backend, CA parameters, and security boundary.', stepsAria: 'CA creation steps', entryStep: 'Choose mode', backendStep: 'Configure backend', parentStep: 'Choose parent CA', authorityStep: 'Configure CA', reviewStep: 'Review', completed: 'Completed', inProgress: 'In progress', pending: 'Pending', entryEyebrow: 'Step one', entryTitle: 'Who should perform issuance for this CA?', entryDescription: 'Choose the deployment boundary that fits the environment. Built-in CAs do not require a manually created provider.', recommended: 'Recommended start', builtinTitle: 'Create CA directly', builtinDescription: 'Use OpenSSL and SecretService embedded in the current GCAC service.', builtinFeature1: 'No additional node deployment', builtinFeature2: 'Fits development and smaller internal environments', managedTitle: 'Deploy GCAC CA Node', managedDescription: 'Isolate CA keys and issuance on a dedicated Windows or Linux machine.', managedFeature1: 'Register with a one-time token', managedFeature2: 'Boundary for future HSM and redundancy', externalTitle: 'Connect external CA', externalDescription: 'Connect Microsoft AD CS, ACME, EST, SCEP, or an adapter service.', externalFeature1: 'Reuse an existing enterprise PKI', externalFeature2: 'CA keys remain managed externally', backendEyebrow: 'Issuing backend', builtinBackendTitle: 'Use the GCAC built-in backend', builtinBackendDescription: 'The system automatically creates or reuses the tenant built-in provider.', managed_nodeBackendTitle: 'Configure a dedicated GCAC CA Node', managed_nodeBackendDescription: 'Create the node backend and issue a short-lived one-time enrollment token.', externalBackendTitle: 'Configure an external CA connection', externalBackendDescription: 'Enter the adapter endpoint and issuance parameters. GCAC does not take custody of the external root key.', builtinAutomaticTitle: 'No separate provider required', builtinAutomaticDescription: 'GCAC ensures the built-in issuing backend exists and binds it when the CA is created.', authorityEyebrow: 'Certificate authority', rootConfigurationTitle: 'Configure root CA', rootConfigurationDescription: 'Define the new root trust boundary, identity, and intermediate CA topology.', intermediateConfigurationTitle: 'Configure intermediate CA', intermediateConfigurationDescription: 'Choose the parent root and configure the authority used for daily issuance.', builtinSecurityNote: 'The software key is held by GCAC SecretService and is not equivalent to a non-exportable HSM key.', managed_nodeSecurityNote: 'The key resides on a dedicated node; production use requires successful registration and capability verification.', externalSecurityNote: 'GCAC requests certificates through the connection and does not own the external root CA key.', reviewEyebrow: 'Final review', reviewTitle: 'Review the trust boundary and issuance model', reviewDescription: 'Verify the CA identity, trust domain, issuing backend, and security warnings before creation.', enrollmentTitle: 'One-time CA Node enrollment token', enrollmentDescription: 'Use this token only for initial node enrollment and transfer it through a secure channel.', enrollmentExpiresAt: 'Token expires at {time}', builtinProviderName: 'GCAC built-in issuing backend', managedProviderName: 'GCAC dedicated CA Node', externalProviderName: 'External CA connection', rootTitle: 'Root CA', rootDescription: 'Create a new independent root trust anchor, optionally with an initial intermediate CA.', intermediateTitle: 'Intermediate CA', intermediateDescription: 'Add an issuing authority below an existing root CA without creating another trust anchor.', noWarnings: 'No additional topology warnings were detected.' },
    riskTypes: { certificate_fingerprint_reuse: 'Same certificate reused across assets', public_key_reuse: 'Same public key reused across assets' },
    common: { unknown: 'Unknown' }, aria: { tabs: 'Internal CA navigation' }
  },
  errors: {
    forbiddenTitle: '403 Forbidden',
    forbiddenMessage: 'You do not have permission to access this page.',
    missingPermission: 'Missing permission: {permission}',
    notFoundTitle: '404 Not Found',
    notFoundMessage: 'This route is not registered.',
    backDashboard: 'Back to dashboard'
  }
} as const
