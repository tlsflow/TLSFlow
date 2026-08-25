// 产品国际化语言文件：直接编辑此文件。
// 新增翻译 key 时，先更新 zh-CN.ts，再同步到其他语言文件。
import { devicesEnUS } from './devices.locale'
import { caOperationsEnUS } from './ca-operations.locale'
import { credentialsEnUS } from './credentials.locale'
import { providersEnUS } from './providers.locale'
import { monitoringTlsEnUS } from './monitoring-tls.locale'
import { acmeAutomationEnUS } from './acme.locale'
import { licensingLocaleMessages } from '@/edition/licensing-messages'
export default {
  credentials: credentialsEnUS,
  devices: devicesEnUS,
  caOperations: caOperationsEnUS,
  providers: providersEnUS,
  acme: acmeAutomationEnUS,
  app: {
    brand: 'GCAC',
    platform: 'Certificate lifecycle management platform',
    defaultBreadcrumb: 'Console',
    dashboard: 'Dashboard',
    versionLabel: 'Version {version}'
  },
  common: {
    refresh: 'Refresh',
    logout: 'Sign out',
    enter: 'Open',
    loading: 'Loading',
    actions: { done: 'Done' },
    cancel: 'Cancel',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    notAvailable: 'Not available',
    close: 'Close',
    unknownError: 'Unknown error',
    unknownValue: 'Unknown value: {value}',
    saving: 'Saving…',
    userFallback: 'Guest user',
    tenantFallback: 'Default tenant'
  },
  api: {
    errors: {
      requestFailed: 'Request failed',
      timeout: 'The request exceeded {seconds} seconds and was cancelled.'
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
    pagination: {
      total: 'Total {count}',
      pageSize: '{size} per page',
      previous: 'Previous',
      next: 'Next',
      goToPage: 'Go to page {page}',
      pager: 'Pagination'
    },
    dryRunChecklist: {
      title: 'Dry-run precheck results',
      ariaLabel: 'dry-run precheck results',
      empty: 'No dry-run precheck results have been generated.',
      unnamedCheck: 'Unnamed check',
      evidence: 'Check evidence',
      status: { passed: 'Passed', failed: 'Failed', warning: 'Warning', unknown: 'Unknown' }
    },
    dryRunResult: {
      title: 'Dry-run execution result',
      close: 'Close'
    },
    modal: {
      closeAria: 'Close modal'
    },
    toast: {
      close: 'Close'
    },
    drawer: {
      closeAria: 'Close drawer'
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
      REVOKED: 'Revoked',
      ERROR: 'Error',
      IGNORED: 'Ignored',
      ONLINE: 'Online',
      OFFLINE: 'Offline',
      ACTIVE: 'Active',
      DISABLED: 'Disabled',
      OPEN: 'Open',
      ACKED: 'Acknowledged',
      RESOLVED: 'Resolved',
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
        dryRun: 'Update check',
        execution: 'Execution'
      },
      operation: {
        prepare: 'Check the certificate files and target status before the update.',
        backup: 'Save the current state so it can be restored if needed.',
        update: 'Apply the new certificate to the target service.',
        reload: 'Load the new certificate and wait for the service to stabilize.',
        verify: 'Confirm that the service is using the new certificate correctly.',
        rollback: 'Restore the certificate and service state from before the update.'
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
        prepare: 'Certificate preparation',
        installDryRun: 'Material loading',
        installExecution: 'Certificate installation',
        updateDryRun: 'Update check',
        updateExecution: 'Certificate update',
        reload: 'Service reload',
        verify: 'Result verification'
      },
      subtitle: {
        completed: 'The task has completed.',
        failed: 'The task ended with a failed result.',
        failedFriendly: 'This step could not be completed. Open the details to see why.',
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
        dryRun: 'Run dry-run preview',
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
        targetSelectedDetail: 'Deployment target selected. Submit directly; run a dry-run preview manually from managed application details when needed.',
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
        noTargets: 'No managed application targets available',
        selectTarget: 'Select a managed application deployment target.'
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
        applicationTarget: 'Managed application deployment target',
        artifactConfig: 'Certificate package configuration',
        binding: 'Binding',
      certificateAsset: 'Certificate inventory item',
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
        selectTarget: 'Select managed application target',
        targetKeyword: 'Search by domain, site, or binding information'
      },
      plan: {
        dryRunCompleted: 'The latest dry-run has completed.',
        submitCompleted: 'The latest submit has completed.'
      },
      preview: {
        needCertificate: 'Select certificate material first.',
        needTarget: 'After selecting certificate material, choose managed application targets.',
        ready: 'The selected certificate version will be deployed to {count} managed application targets.'
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
          description: 'Certificate and version',
          title: 'Select certificate material'
        },
        submit: {
          description: 'Dry-run, save, submit, execute',
          title: 'Precheck and submit'
        },
        target: {
          description: 'Managed application, site, and binding',
          title: 'Select deployment target'
        }
      },
      stepState: {
        active: 'In progress',
        done: 'Done',
        pending: 'Pending'
      },
      target: {
        workflowMode: 'Workflow mode',
        workflowModeWithName: 'Workflow mode ({name})'
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
    title: 'Global tasks',
    quick: { active: 'Active tasks', recent: 'Recent completions' },
    tabs: { all: 'All tasks', execution: 'Execution tasks', monitoring: 'Monitoring tasks', system: 'System tasks', other: 'Other tasks' },
    aria: { openDrawer: 'Open global tasks', tabs: 'Task categories' },
    filters: {
      includeAll: 'Show all tasks',
      keyword: 'Search tasks, errors, or IDs',
      taskType: 'Task type',
      status: 'Status',
      allStatuses: 'All statuses',
      resourceType: 'Resource type',
      resourceId: 'Resource ID',
      requestedBy: 'Requested by',
      taskId: 'Task ID',
      createdFrom: 'Start time',
      createdTo: 'End time'
    },
    fields: { requestedBy: 'Requested by', triggerSource: 'Trigger source', createdAt: 'Created at', startedAt: 'Started at', finishedAt: 'Finished at', error: 'Last error' },
    sections: { timeline: 'Status timeline', attempts: 'Attempts', acmeHistory: 'Renewal progress', logs: 'Raw logs', children: 'Child tasks', errors: 'Errors', audit: 'Audit events', monitoringProbes: 'Probe records' },
    actions: { backToList: 'Back to task list', viewAll: 'View all tasks', viewRawLogs: 'View raw logs', search: 'Search', reset: 'Reset', previousPage: 'Previous page', nextPage: 'Next page', forceCancel: 'Force stop', forceCancelConfirm: 'Force stop this task? A remote action already in progress may still require manual verification.', forceCancelReason: 'Force stopped by an operator from global tasks' },
    messages: { loadFailed: 'Failed to load tasks.', detailFailed: 'Failed to load task details.', forceCancelFailed: 'Failed to force stop the task.' },
    values: { system: 'System', empty: 'No records', none: 'None' },
    agentUpdate: {
      title: 'Agent upgrade progress', timelineTitle: 'Upgrade progress',
      fields: { target: 'Target host', currentVersion: 'Current version', targetVersion: 'Target version', phase: 'Current phase', planId: 'Upgrade plan', transactionId: 'Upgrade transaction' },
      values: { unknown: 'Unknown' },
      phases: { queued: 'Queued', dispatching: 'Sending authorization', accepted: 'Agent accepted', upgrading: 'Upgrading', status_checking: 'Reading result', succeeded: 'Completed', failed: 'Not completed', rolled_back: 'Rolled back', manual_required: 'Manual action required', unknown: 'Unknown' },
      summary: { queued: 'The upgrade task is queued.', dispatching: 'Sending the upgrade authorization.', accepted: 'The agent accepted the upgrade and is waiting for local execution.', upgrading: 'The agent is downloading, replacing, and checking the new version.', waiting: 'Waiting for the agent to return the result.', succeeded: 'The agent upgraded from {currentVersion} to {targetVersion}.', failed: 'The agent upgrade did not complete.' },
      events: { created: 'Task created', claimed: 'Task assigned', started: 'Started reading upgrade status', progress: 'Upgrade status updated', waiting_result: 'Waiting for upgrade result', succeeded: 'Upgrade succeeded', failed: 'Upgrade failed', retry_scheduled: 'Waiting for the next status check', cancelled: 'Task cancelled' },
    },
    pluginRefresh: {
      subtitle: 'Plugin catalog maintenance task',
      overview: { kicker: 'Refresh result', description: 'This operation refreshed {scope} and synchronized the latest plugin references to available runtime nodes.' },
      metrics: { catalogVersions: 'Catalog versions', enabledVersions: 'Enabled versions', agentsProjected: 'Nodes synchronized', agentsFailed: 'Sync failures' },
      sections: { timeline: 'Processing history', catalogVersions: 'Current plugin versions', failures: 'Sync issues' },
      actions: { showTechnicalDetails: 'Show technical details' },
      fields: { taskId: 'Task ID' },
      values: { unavailable: 'Unavailable', noVersions: 'No plugin versions were returned', triggerSource: 'Plugin catalog refresh' },
      summary: {
        succeeded: 'Refresh completed: {versions} plugin versions updated and {projected} runtime nodes synchronized.',
        failed: 'Plugin catalog refresh failed.',
        cancelled: 'Plugin catalog refresh was cancelled.',
        retryWaiting: 'Plugin catalog refresh will retry automatically later.',
        waitingResult: 'Waiting for the plugin catalog refresh result.',
        awaitingConfirmation: 'The plugin catalog refresh result needs confirmation.',
        cancelling: 'Cancelling the plugin catalog refresh.',
        queued: 'Plugin catalog refresh is queued.',
        running: 'Refreshing the plugin catalog.'
      },
      events: {
        created: 'The refresh task was created and is waiting to be processed.',
        claimed: 'The task was assigned to a background processor.',
        started: 'Started reading the built-in plugin catalog.',
        progress: 'Preparing plugin versions and synchronizing runtime nodes.',
        retryScheduled: 'Processing did not finish; an automatic retry was scheduled.',
        waitingResult: 'Waiting for runtime nodes to return their results.',
        awaitingConfirmation: 'The refresh result is ready and needs confirmation.',
        cancelRequested: 'A cancellation request was received.',
        expired: 'The task timed out.',
        cancelled: 'The refresh task was cancelled.',
        succeeded: 'Refresh completed: {versions} plugin versions and {projected} runtime nodes synchronized.',
        failed: 'Refresh failed: {reason}'
      },
      versionStatus: { added: 'Added', enabled: 'Enabled', disabled: 'Not enabled', other: 'Other status' }
    },
    approval: {
      title: 'Approval task details',
      description: 'Review the approval content, status history, and available actions.',
      contentTitle: 'Approval content',
      fields: { operation: 'Operation', target: 'Target', approvalId: 'Approval ID', requestedBy: 'Requested by', riskLevel: 'Risk level', createdAt: 'Submitted at', decision: 'Decision', summary: 'Operation summary' },
      content: { deployment: 'Certificate deployment', automation: 'Automation run', defaultSummary: 'This task is waiting for an approval decision.' },
      values: { approved: 'Approved', rejected: 'Rejected', pending: 'Pending approval' },
      timelineTitle: 'Status timeline',
      timeline: { created: 'Approval submitted', createdDescription: 'The task was created and is waiting for an approver.', approved: 'Approval granted', approvedDescription: 'The approver allowed the operation to continue.', rejected: 'Approval rejected', rejectedDescription: 'The approver rejected this operation.', forceEnded: 'Task force-stopped', forceEndedDescription: 'An operator force-stopped this task.', pending: 'Approval in progress', pendingDescription: 'The system is waiting for the approval result.' }
    },
    relatedNames: { builtinCatalog: 'Built-in plugin catalog', deploymentPlan: 'Deployment plan', acmeRenewal: 'ACME Provider ({provider}) - {certificate} certificate renewal' },
    acmeHistory: {
      queued: { title: 'Waiting for renewal', description: 'The system is waiting to process this certificate renewal.' },
      running: { title: 'Renewing certificate', description: 'The system is requesting renewal from the certificate authority.' },
      retryWaiting: { title: 'Waiting for automatic retry', description: 'This issuance did not finish. The system will retry later.' },
      succeeded: { title: 'Renewal succeeded', description: 'The new certificate has been issued and stored.' },
      failed: { title: 'Renewal failed', description: 'The system could not renew the certificate. See raw logs for details.' },
      cancelled: { title: 'Renewal cancelled', description: 'This certificate renewal was cancelled.' }
    },
    typeLabels: {
      CERTIFICATE_DRY_RUN: 'Certificate dry-run',
      CERTIFICATE_DEPLOY: 'Certificate deploy',
      DEPLOYMENT_APPROVAL: 'Deployment approval',
      CERTIFICATE_VERIFY: 'Certificate verify',
      CERTIFICATE_ROLLBACK: 'Certificate rollback',
      AGENT_INSTALL: 'Agent install',
      AGENT_UPDATE: 'Agent update',
      PLUGIN_REFERENCE_REFRESH: 'Plugin reference refresh',
      DEPLOYMENT_PLAN_REFRESH: 'Deployment plan refresh',
      MONITORING_BATCH: 'Monitoring batch',
      MONITORING_PROBE: 'Monitoring probe',
      CREDENTIAL_HEALTH_CHECK: 'Credential validity check',
      ACME_CERTIFICATE_RENEWAL: 'ACME',
      CA_RECORD_SYNC: 'CA record sync',
      CERTIFICATE_REVOCATION: 'Certificate revocation',
      CRL_PUBLISH: 'CRL publish',
      TRUST_DISTRIBUTION: 'Trust-store distribution',
      GATEWAY_DELEGATION: 'Gateway delegation',
      WORKFLOW_RUN: 'Workflow run',
      AUTOMATION_RUN: 'Automation run',
      REPORT_EXPORT: 'Report export',
      NOTIFICATION_DELIVERY: 'Notification delivery',
      OTHER: 'Other task'
    },
    summaryTemplates: {
      QUEUED: '{task} queued',
      RUNNING: '{task} running',
      RETRY_WAITING: 'Retry pending for {task}',
      WAITING_RESULT: 'Waiting for the {task} result',
      AWAITING_CONFIRMATION: 'The {task} result needs confirmation',
      CANCELLING: 'Cancelling {task}',
      SUCCEEDED: 'Completed {task}',
      FAILED: '{task} failed',
      CANCELLED: '{task} cancelled'
    },
    status: { QUEUED: 'Queued', RUNNING: 'Running', RETRY_WAITING: 'Waiting for retry', WAITING_RESULT: 'Waiting for result', AWAITING_CONFIRMATION: 'Result needs confirmation', WAITING_APPROVAL: 'Waiting for approval', CANCELLING: 'Cancelling', SUCCEEDED: 'Succeeded', FAILED: 'Failed', CANCELLED: 'Cancelled' }
  },
  shell: {
    currentLocation: 'Current location',
    breadcrumb: 'Breadcrumb',
    currentGroupNavigation: 'Current group navigation',
    backDashboard: 'Back to dashboard',
    sidebarCollapse: 'Collapse sidebar',
    sidebarExpand: 'Expand sidebar'
  },
  globalSearch: {
    title: 'Global search',
    description: 'Search certificates, device inventory, system settings, and plugins.',
    inputLabel: 'Search global resources',
    inputPlaceholder: 'Enter a name, domain, fingerprint, or path',
    hint: 'Enter a keyword to start searching.',
    aria: {
      open: 'Open global search'
    },
    categories: {
      certificates: 'Certificates',
      assets: 'Device inventory',
      settings: 'System settings',
      plugins: 'Plugins'
    },
    types: {
      serverCertificate: 'Server certificate',
      intermediateCertificate: 'Intermediate certificate',
      rootCertificate: 'Root certificate',
      application: 'Application',
      device: 'Device',
      cloudService: 'Cloud service',
      systemSetting: 'System setting',
      plugin: 'Plugin'
    },
    empty: {
      title: 'No matching results',
      description: 'Try another name, domain, fingerprint, or path.'
    },
    messages: {
      loadFailed: 'Global search failed to load.'
    }
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
  systemInitialization: {
    intro: { ariaLabel: 'System initialization animation', eyebrow: 'First launch', title: 'Preparing your console', description: 'The system initialization wizard will open next.', loading: 'Loading the initialization wizard…', progressAriaLabel: 'Initialization loading progress', start: 'Start using', skip: 'Skip animation', slogan: 'For security services that never stop' },
    preview: { title: 'System initialization preview', notice: 'Development preview: no user or license data will be written.' },
    title: 'System initialization', description: 'Create the first Admin account and set console preferences.', help: 'Complete the first-run setup step by step.', stepsLabel: 'Initialization steps',
    steps: { account: 'Admin account and preferences', accountHelp: 'Create the first local administrator and choose language and theme.', license: 'License setup', licenseHelp: 'Export an offline request and import an authorization file, or do this later.', confirm: 'Confirm write', confirmHelp: 'Review the non-sensitive account summary and security warning.', complete: 'Complete', completeHelp: 'Initialization is complete and login is available.' },
    stage: { account: { title: 'Admin account and display preferences', help: 'These values are stored on the first Admin user.' }, license: { title: 'License setup (optional)', help: 'A license failure does not roll back Admin initialization.' }, confirm: { title: 'Confirm write', help: 'Only a non-sensitive summary is shown here.' }, complete: { title: 'Initialization complete', help: 'The system is ready for login.' } },
    account: { heading: 'Create the first Admin user', description: 'Set the local administrator account used to sign in to the console.', username: 'Admin username', usernamePlaceholder: 'For example, admin', displayName: 'Admin display name', displayNamePlaceholder: 'For example, System administrator', password: 'Admin password', passwordPlaceholder: 'At least 8 characters', passwordConfirmation: 'Confirm password', passwordConfirmationPlaceholder: 'Enter the password again', locale: 'Preferred language', theme: 'Theme' },
    license: { description: 'First export an offline activation request file, then import an authorization file or paste its JSON.', createRequest: 'Export offline request file', copyRequest: 'Copy activation request', requestCopied: 'Activation request copied', importFile: 'Import authorization file', activationResponse: 'Authorization file or activation response JSON', activationResponsePlaceholder: 'Import an authorization file or paste its JSON', importResponse: 'Import authorization', configured: 'License configured.', skip: 'Skip and configure later' },
    confirm: { username: 'Admin username', locale: 'Language', theme: 'Theme', kekTitle: 'Keep GCAC_SECRET_KEK safe', kekWarning: 'GCAC_SECRET_KEK is the root key for decrypting runtime security materials. Never put it in code, logs, public documentation, or the browser. Disclosure can create a serious security risk.' },
    complete: { heading: 'System initialization is complete', licenseConfigured: 'The license is configured.', licenseSkipped: 'License setup was skipped and can be completed later from the Licensing page.' },
    actions: { previous: 'Previous', continue: 'Continue', createAdmin: 'Create admin and continue', finish: 'Finish initialization', login: 'Go to login' },
    errors: { passwordMismatch: 'The passwords do not match.', missingSession: 'Initialization succeeded but no session was returned.', createFailed: 'Admin creation failed.', licenseFailed: 'License operation failed.', activationRequestMissing: 'No offline activation request was returned.', jsonObjectRequired: 'Enter a valid JSON object.' }
  },
  userMenu: {
    currentUser: 'Current user',
    changePassword: 'Change password',
    userGuide: 'User guide',
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
  nav: {
    dashboard: 'Dashboard',
    dashboardDesc: 'Overview of applications, certificates, agents, gateways, and audit status',
    certificates: 'Certificate lifecycle',
    certificatesDesc: 'Certificate inventory, bindings, and expiry status',
    certificateAssets: 'Certificate inventory',
    certificateAssetsDesc: 'Certificates, private key references, fingerprints, and expiry times',
    acmeAutomation: 'ACME issuance and renewal',
    acmeAutomationDesc: 'Issue, renew, and track ACME certificates',
    certificateFormats: 'Certificate delivery formats',
    certificateFormatsDesc: 'Define PFX, CER, CRT, PEM, and other delivery rules for saved certificates',
    assetCenter: 'Asset inventory',
    assetCenterDesc: 'Manage applications, devices, and cloud services',
    assetManagement: 'Application management',
    assets: 'Applications',
    assetsDesc: 'Application entry points and certificate deployment targets by domain or IP',
    devices: 'Devices',
    agents: 'Agents',
    agentsDesc: 'Online status, heartbeat, and capability set',
    gateways: 'Gateways',
    gatewaysDesc: 'Gateway, protocol, and reachable target status for isolated zones',
    deployments: 'Certificate deployment',
    deploymentsDesc: 'Deployment plans, workflows, automations, and execution records',
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
    plugins: 'Plugin center',
    pluginsDesc: 'Provider, executor, and sandbox status',
    monitoring: 'Monitoring & audit',
    monitoringDesc: 'Alerts, audit, and certificate status',
    monitoringAnalysis: 'Monitoring analytics',
    monitoringAnalysisDesc: 'Analyze monitoring targets, probe results, and certificate risks',
    monitorAlerts: 'Monitor alerts',
    monitorAlertsDesc: 'Expiry, drift, and execution failure events',
    monitorTls: 'TLS deep monitoring',
    monitorTlsDesc: 'Trust paths, protocol suites, compatibility simulation, and protocol details',
    audits: 'Audit logs',
    auditsDesc: 'Operation evidence and compliance exports',
    logAudit: 'Audit logs',
    logAuditDesc: 'Review audit events and export operation evidence',
    reports: 'Reports',
    reportsDesc: 'Certificate incident windows, risk response, and automation effectiveness',
    incidentWindowReport: 'Incident window',
    incidentWindowReportDesc: 'Prioritize expiring and expired certificates',
    riskResponseReport: 'Risk response',
    riskResponseReportDesc: 'Acknowledgement, resolution time, and SLA',
    automationEffectivenessReport: 'Automation effectiveness',
    automationEffectivenessReportDesc: 'Run and target success rates with failure stages',
    settings: 'System settings',
    settingsDesc: 'Tenants, users, permissions, and system configuration',
    settingsOverview: 'Setting',
    systemSettings: 'System settings',
    systemSettingsDesc: 'System configuration and security metadata',
    credentials: 'Credential',
    notifications: 'Notification',
    licensing: 'Licensing',
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
    common: { notAvailable: 'Not available', allRelated: 'All related targets' },
    formStep: { stepProgress: 'Step {current} of {total}', previous: 'Back', next: 'Next', reviewTitle: 'Configuration summary', reviewText: 'Trigger: {trigger}; execution scope: {scope}; certificate domains: {domains}. The target snapshot is frozen when the run starts.' },
    scheduleBuilder: { api: 'Trigger through external API', apiHelp: 'An external system calls the automation run API. Target preview and approval rules still apply to every request.', once: 'Run once at a fixed time', onceHelp: 'Choose a browser-local time. The task is not scheduled again after it runs.', recurring: 'Run periodically', scheduleHelp: 'Run on a recurring schedule. Use only when continuous polling is genuinely required.', recurringHelp: 'Run on a recurring schedule. Use only when continuous polling is genuinely required.', recurringWarningTitle: 'Periodic execution is not recommended for certificate updates', recurringWarning: 'Certificate replacement should normally be triggered after certificate issuance or scheduled once at a fixed time. Use periodic execution only for an explicit recurring-check requirement.', certificateVersionCreated: 'Certificate new-version event', certificateVersionCreatedHelp: 'The automation starts after an external source or a manual import creates a new certificate version.', runAt: 'Execution time', frequency: 'Frequency', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', time: 'Time', weekday: 'Weekday', monthDay: 'Day of month', legacyCustom: 'Keep existing custom schedule', legacyCron: 'Existing cron (read-only)', weekdays: { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' } },
    form: { existingAssetTitle: 'Update existing managed applications only', existingAssetDescription: 'The automation only processes managed applications with existing certificate bindings. It does not install certificates for the first time or add deployment targets.', certificateDomains: 'Certificate domains', certificateDomainsPlaceholder: 'Enter certificate domains separated by commas', certificateDomainsHelp: 'Only existing managed application bindings for these certificate domains are updated.', versionSelection: 'Certificate version to deploy', versionSelectionLatest: 'Automatically use the latest certificate version', versionSelectionSpecific: 'Use specific certificate versions', versionSelectionHelp: 'The version is resolved and frozen when the run starts, so later versions cannot change an active run.', certificateVersionIds: 'Specific certificate versions', certificateVersionIdsPlaceholder: 'Enter certificate version IDs separated by commas', certificateVersionIdsHelp: 'Each version must belong to a certificate selected by the domains above.', versionLoading: 'Loading available certificate versions.', versionLoadFailed: 'Failed to load certificate versions. Try again later.', versionEmpty: 'No selectable certificate versions were found for these domains.', schedule: 'When to update', scheduleHelp: 'Administrators can start it on demand or run it periodically with Cron and a time zone.', execution: 'What happens during a run', executionHelp: 'The system creates a separate update plan for each existing managed application binding and reuses DeploymentPlan, approval, and ExecutionRun.', snapshot: 'Freeze the domain, managed application, and certificate-version snapshot' },
    fields: { name: 'Name', description: 'Description', trigger: 'Trigger', eventSources: 'Event sources', eventSourcesHelp: 'Choose which certificate version events can start this automation.', targetScope: 'Update scope', selectedAssets: 'Selected managed applications', selectedAssetsHelp: 'Select at least one managed application.', certificateTags: 'Certificate tags (comma separated)', certificateTagsHelp: 'Filter the event or polling scope by certificate tags.', targetEnvironments: 'Target environments (comma separated)', targetEnvironmentsHelp: 'Filter by target application environment.', targetOwners: 'Target owners (comma separated)', targetOwnersHelp: 'Filter by target owner.', cron: 'Cron expression', timeZone: 'Time zone', expiresWithinDays: 'Expiry window in days', environments: 'Target environments (comma separated)', certificateIds: 'Specific certificates (optional)', certificateIdsPlaceholder: 'Enter certificate IDs separated by commas', certificateIdsHelp: 'When filled, only these certificates are processed; otherwise expiry and environment rules are used.', expiresWithinDaysHelp: 'Only match certificates expiring within this window.', environmentsHelp: 'Only process certificates in these environments, such as production or staging.', planType: 'Deployment plan type', planTypeHelp: 'A separate DeploymentPlan is created at runtime for each matched certificate target.', planTypeUpdate: 'Update an existing certificate binding', planTypeInstall: 'Install a certificate on the target', planTypeVerifyOnly: 'Verify only, make no certificate change', planMode: 'Run mode', planModeHelp: 'The automation does not bind an existing plan; it creates a new plan at runtime for each target.', planModeCreateAndExecute: 'Create and execute the plan', planModeCreateOnly: 'Create plans only, do not execute yet', maxTargets: 'Maximum targets per run', concurrency: 'Concurrency', failureCount: 'Failure count threshold', requireDryRun: 'Historical dry-run setting (not an execution gate)', requireApproval: 'Require approval before execution', startedAt: 'Started at', finishedAt: 'Finished at', failureStage: 'Failure stage', parentRun: 'Parent run' },
    actions: { create: 'Create automation', detail: 'Details', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', save: 'Save', copy: 'Copy', enable: 'Enable', disable: 'Disable', runNow: 'Run now', preview: 'Preview targets', history: 'Run history', confirmRun: 'Confirm run', stop: 'Stop run', retryFailed: 'Retry failed targets', openPlan: 'Open deployment plan', openExecution: 'Open execution run' },
    manualRun: { title: 'Manual run', description: 'Select a certificate version before running.', versionLabel: 'Certificate version', versionPlaceholder: 'Select a certificate version', help: 'The run will resolve related managed applications from the selected version.', empty: 'No certificate versions are available for manual run.', stopOnError: 'Stop on error', dryRun: 'Run optional dry-run preview', start: 'Start run' },
    columns: { status: 'Status', trigger: 'Trigger', targets: 'Target limit', actions: 'Actions', nextRun: 'Next run', lastRun: 'Last run' },
    triggers: { onDemand: 'On demand', schedule: 'Scheduled' },
    triggerTypes: { on_demand: 'On demand', schedule: 'Scheduled', certificate_version_created: 'Certificate new-version event', retry: 'Failed-target retry' },
    eventSources: { external_source: 'External source', manual_import: 'Manual import' },
    targetScopes: { allRelatedAssets: 'Update all related managed applications', allRelatedAssetsHelp: 'After the event or conditions match, the system resolves every bound and deployable managed application automatically.', selectedAssets: 'Update selected managed applications only', selectedAssetsHelp: 'Create and execute DeploymentPlans only for the manually selected managed applications.' },
    assetPicker: { available: 'Available applications', selected: 'Selected applications', add: 'Add', remove: 'Remove', clear: 'Clear selection', emptyAvailable: 'No managed applications are available to add.', emptySelected: 'No managed applications selected yet.' },
    actionTypes: { create_deployment_plan: 'Create certificate renewal plan', execute_deployment_plan: 'Execute certificate renewal plan', send_notification: 'Send notification' },
    values: { enabled: 'Enabled', disabled: 'Disabled', latest: 'Use the latest version', specific: 'Use specific certificate versions', fixedByEvent: 'Pinned by the certificate new-version event' },
    summaries: { targets: 'Up to {count} targets' },
    preview: { title: 'Application impact preview', description: 'Compare the current certificate expiry on each selected managed application with the target certificate expiry.', matched: '{count} matched', executable: '{count} executable', excluded: '{count} excluded', affected: '{count} affected', upgrade: '{count} longer validity', same: '{count} same expiry', skip: '{count} skipped', downgrade: '{count} need attention', version: 'Version {version}', versionUnknown: 'Version unknown', ready: 'Ready', skipUpdate: 'Skip update', expiryLabel: 'Expiry', impact: { upgrade: 'Longer validity', same: 'Same expiry', downgrade: 'Shorter validity risk', missing_current: 'Current certificate missing', unknown: 'Unknown impact' } },
    detail: { title: 'Automation details', description: 'Review the current automation configuration, triggers, and execution guardrails.', assetCount: '{count} managed applications involved', assetsResolvedAtRuntime: 'Target applications are resolved at runtime from certificate domains and bindings.', sections: { summary: 'Summary', execution: 'Execution chain', guardrails: 'Execution guardrails' }, fields: { automationId: 'Automation ID', currentVersion: 'Current configuration version', recordVersion: 'Record version', eventSources: 'Event sources', certificateDomains: 'Certificate domains', versionSelection: 'Certificate version strategy', actionChain: 'Action chain', involvedAssets: 'Involved applications', nextRun: 'Next run', lastRun: 'Last run' } },
    history: { title: 'Run history', description: 'Review the latest runs for this automation.', summary: '{count} runs', latestTarget: 'Automation: {name}', empty: 'No runs yet.' },
    exclusions: { permission_denied: 'Target permission denied', missing_version: 'Certificate version missing', version_not_deployable: 'Certificate version is not deployable', binding_not_managed: 'Binding is unmanaged', environment_not_allowed: 'Environment is not allowed', binding_missing: 'Binding is missing', asset_missing_deployment_capability: 'Managed application cannot deploy certificates', certificate_version_downgrade: 'Target certificate version is older than the current managed application version', certificate_already_up_to_date: 'The target expiry already matches the current managed application certificate, so the update is skipped', filter_not_matched: 'Filter conditions did not match', runtime_context_required: 'Runtime context is required', unknown: 'Unknown exclusion reason' },
    failureStages: { selection: 'Target selection', plan_creation: 'Plan creation', dry_run: 'Dry run', approval: 'Approval', execution: 'Execution', verification: 'Verification', rollback: 'Rollback', notification: 'Notification' },
    progress: { total: 'Total', pending: 'Pending', running: 'Running', waitingApproval: 'Waiting approval', succeeded: 'Succeeded', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' },
    editor: { createTitle: 'Create automation', editTitle: 'Edit automation', description: 'Configure when it runs, which certificates it handles, how deployment plans are created, and what happens on failure.', exactVersionFromEvent: 'The certificate new-version event freezes the exact certificate version into the run snapshot, and approval recovery must keep using that exact version.', sections: { basic: 'Basic information', basicHelp: 'Give the automation a recognizable name and explain which certificate changes it handles.', trigger: 'Trigger', triggerHelp: 'Define which fact starts the automation before choosing the execution scope and matching conditions.', targets: 'Which certificates to process', targetsHelp: 'This selects certificate targets, not existing deployment plans; the target snapshot is frozen when the run starts.', execution: 'Execution', executionHelp: 'Decide how the automation updates managed applications first, then add matching conditions and safety guardrails.', conditions: 'Conditions and safety', conditionsHelp: 'Define matching conditions, target filters, approval, and concurrency guardrails together in this step.', plan: 'Certificate deployment plan', planRelationTitle: 'This does not bind an existing deployment plan', planRelationDescription: 'A deployment plan is created at runtime from the certificate filters above.', planRelationHelp: 'Each matched certificate target gets its own DeploymentPlan, and its plan ID appears in run details.', guardrails: 'Execution safety controls', guardrailsHelp: 'These limits control batch size, prechecks, approval, and when failures stop the run.' }, chain: { createPlan: 'Create a DeploymentPlan for each target', dryRun: 'Run the optional dry-run preview', approval: 'Wait for approval', executePlan: 'Execute that target DeploymentPlan' } },
    runs: { title: 'Automation run history', description: 'Review run-level status, immutable target snapshots, and failure stages.', progress: '{succeeded}/{total} succeeded' },
    runDetail: { title: 'Automation run details', description: 'Configuration version {version}', noFailure: 'No failure', triggerContext: 'Trigger context', sourceType: 'Source type', certificateVersion: 'Exact certificate version', approvalId: 'Approval ID', deliveryId: 'Delivery ID', excludedReasons: 'Excluded reasons' },
    aria: { preview: 'Automation target preview', runs: 'Automation run list', progress: 'Automation run progress' },
    errors: { loadFailed: 'Failed to load automations', applicationAssetsLoadFailed: 'Failed to load managed applications. Try again later.' }
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
    toggleFilters: 'Filter',
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
      labels: {
        discover: 'Discover deployment target',
        backup: 'Back up current certificate',
        install: 'Install new certificate',
        reload: 'Reload service',
        verify: 'Verify certificate',
        rollback: 'Roll back certificate'
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
      workflowIdentity: 'Execution version: plugin {plugin}; workflow {workflow}',
      failure: {
        emptyMessage: 'The backend did not receive a concrete error message',
        issue: 'Category {category}, slot {slot}, path {path}, source {source}, remediation {remediation}'
      },
      skipped: 'Step skipped: {reason}',
      running: {
        dispatched: 'Agent task taskId={taskId} has been dispatched. The control plane is actively querying the result.',
        waitingAgentResult: 'The step is running; the control plane is actively querying the Agent result…',
        waitingExternalResult: 'The step is running and waiting for an external execution result.',
        resultUnconfirmed: 'The write result needs confirmation: {code}: {message}. This step will not be replayed automatically.'
      },
      unknownResult: 'The write result is unknown; automatic replay is paused.',
      diagnosticsTitle: 'Detailed verification log',
      structuredDetail: 'View structured details',
      pending: {
        waitingDependency: 'The step is waiting for previous steps to finish.'
      },
      verifyRecovered: {
        detail: 'Agent-side remote TLS probing failed, but the control plane completed real TLS verification for {remoteTarget} and confirmed the target certificate matches. {originalError}',
    originalSuffix: 'Original agent error: {originalError}'
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
        label: 'Dry-run completed, host authorization required',
        detail: 'Structural and security checks completed. Dry-run does not issue a formal ExecutionGrant, so the TLS verification bypass was rejected. After approval, the host will issue a short-lived ExecutionGrant for the formal execution.'
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
      confirm: 'Verify certificate state and continue',
      running: 'Verifying certificate state…',
      confirmed: 'The target certificate is confirmed active; execution will continue.',
      failed: 'Certificate verification did not pass; execution has stopped.',
      pending: 'The target certificate state could not be confirmed yet. Try again later.'
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
      recoveryConfirmed: 'The target certificate state is confirmed; execution will continue. Track progress in the global task list.',
      recoveryFailed: 'Certificate verification did not pass. Detailed reasons were recorded in the execution log.',
      recoveryPending: 'The target certificate state is still unconfirmed. The task remains pending confirmation; try again later.'
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
      assetUnknown: 'No managed application recorded',
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
      unknownResultDescription: 'The original install operation will not be replayed. Only a read-only TLS certificate fingerprint check will be performed.'
    },
    tabs: {
      summary: 'Summary',
      steps: 'Steps',
      logs: 'Logs'
    }
  },
  plugins: {
    standardFields: {
      connectionAddress: 'Connection address', connectionPort: 'Connection port', basePath: 'Base path', timeoutSeconds: 'Timeout seconds', gateway: 'Execution gateway',
      authenticationMode: 'Authentication mode', credential: 'Credential', username: 'Username', passwordSecret: 'Password SecretRef', apiTokenSecret: 'API token SecretRef', clientCertificate: 'Client certificate',
      tlsEnabled: 'Enable HTTPS', tlsVerifyPeer: 'Verify server certificate', tlsIgnoreCertificateErrors: 'Ignore certificate errors', tlsServerName: 'TLS server name', caSecret: 'CA SecretRef', tlsMinimumVersion: 'Minimum TLS version',
      deviceDisplayName: 'Device display name', deviceDescription: 'Device description', deviceTags: 'Device tags', targetName: 'Target name', targetLabels: 'Target labels'
    },
    forms: { loadOptions: 'Load options', previewTitle: 'Plugin configuration form', loading: 'Loading plugin form...', loadFailed: 'Failed to load plugin form', empty: 'This plugin does not declare a configuration form.' },
    presentation: { previewTitle: 'Standard device presentation preview', sensitiveValue: 'Sensitive value hidden', tabsAriaLabel: 'Device information tabs' },
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
      eyebrow: 'DSL plugin market',
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
      stepCount: '{count} execution steps',
      moreTags: '+{count} more'
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
      enabled: { title: 'Enabled plugins' },
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
    types: { provider: 'Cloud provider plugin', standard: 'Standard plugin' },
    fields: {
      pluginId: 'Plugin ID',
      pluginType: 'Plugin type',
      provider: 'Cloud provider',
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
      riskLevel: 'Risk level', runtime: 'Runtime', executionMode: 'Execution model', scope: 'Scope', support: 'Support level', capabilities: 'Capabilities', frameworks: 'Target frameworks', products: 'Supported products', operations: 'Supported operations'
    },
    labels: { permissions: 'Declared permissions', runnerStatus: 'Runner status' },
    permissionKeys: {
      network_http: 'Network requests', secret_read: 'Read secrets', artifact_read: 'Read artifacts', device_write: 'Write devices',
      agent_execution_receipt: 'Agent execution receipts', agent_fact_collect: 'Agent fact collection', agent_plan_execute: 'Agent plan execution', agent_plan_validate: 'Agent plan validation',
      audit_append: 'Append audit records', cloud_service_get: 'Read cloud services', execution_cancel_read: 'Read execution cancellation state', execution_checkpoint: 'Execution checkpoints',
      execution_checkpoint_read: 'Read execution checkpoints', execution_checkpoint_write: 'Write execution checkpoints', execution_progress: 'Execution progress', execution_progress_write: 'Write execution progress',
      resource_lock: 'Resource locks', secret_resolve: 'Resolve secrets'
    },
    runnerStatuses: { ready: 'Runner ready', busy: 'Runner busy', unavailable: 'Runner unavailable', notObserved: 'Runner not observed' },
    capabilityKeys: {
      device_connection_test: 'Connection test', device_identity_detect: 'Device identity detection', device_discover: 'Device discovery', device_logs_read: 'Device log reading',
      certificate_discover: 'Certificate discovery', certificate_deploy: 'Certificate deployment', certificate_rollback: 'Certificate rollback', certificate_verify: 'Certificate verification',
      application_discover: 'Application discovery', ca_account_manage: 'CA account management', ca_order_manage: 'CA order management', ca_challenge_orchestrate: 'CA challenge orchestration',
      ca_challenge_dns_solver: 'CA DNS challenge solver', ca_certificate_issue: 'CA certificate issuance', ca_certificate_renew: 'CA certificate renewal', ca_certificate_revoke: 'CA certificate revocation',
      cloud_service_connection_test: 'Cloud service connection test', cloud_service_discover: 'Cloud service discovery', credential_health_check: 'Credential health check'
    },
    unknownCatalogValue: 'Unknown catalog value: {value}',
    frameworkTypes: { web_iis: 'IIS', web_nginx: 'NGINX', web_apache: 'Apache', app_tomcat: 'Tomcat', custom_runtime: 'Custom runtime', runtime_custom: 'Custom runtime', adc_load_balancer: 'ADC load balancer', cloud_aliyun_cdn: 'Alibaba Cloud CDN', cloud_aliyun_alb: 'Alibaba Cloud ALB', cloud_aliyun_clb: 'Alibaba Cloud CLB', cloud_aliyun_oss: 'Alibaba Cloud OSS', cloud_aliyun_waf_cname: 'Alibaba Cloud WAF CNAME', cloud_aliyun_waf_cloud: 'Alibaba Cloud WAF Cloud', cloud_aliyun_live: 'Alibaba Cloud Live', cloud_aliyun_vod: 'Alibaba Cloud VOD', cloud_tencent_cdn: 'Tencent Cloud CDN', cloud_tencent_clb: 'Tencent Cloud CLB', cloud_tencent_live: 'Tencent Cloud Live', cloud_huawei_cdn: 'Huawei Cloud CDN', cloud_huawei_elb: 'Huawei Cloud ELB', cloud_volcengine_cdn: 'Volcengine CDN', cloud_volcengine_alb: 'Volcengine ALB', cloud_volcengine_clb: 'Volcengine CLB', cloud_volcengine_live: 'Volcengine Live', cloud_volcengine_vod: 'Volcengine VOD' },
    runtimeTypes: { agent_atomic: 'Agent atomic execution', workflow_dsl: 'Workflow DSL' },
    scopeTypes: { managed: 'Managed target', standalone: 'Standalone target', both: 'Managed / standalone' },
    supportTypes: { official: 'Official support', community: 'Community support', self_managed: 'Self managed' },
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
      mount: 'Mount to agent', mounting: 'Mounting...', selectAgent: 'Select target agent', type: 'Plugin type', targetAgent: 'Target agent', mountFailed: 'Failed to mount agent plugin',
      executionMode: 'Agent execution mode', nativeHandler: 'Native handler', pluginMode: 'Agent plugin', mountedPlugin: 'Mounted plugin', selectMountedPlugin: 'Select a mounted plugin',
      plugin: 'Deployment plugin', selectPlugin: 'Select a deployment plugin', noCompatiblePlugin: 'No enabled plugin matches the current platform and framework', compatiblePluginHint: 'Only enabled plugins matching the managed application platform and framework are shown.',
      secretRefPlaceholder: 'Enter a SecretRef identifier', artifactBinding: 'Certificate delivery format {name}', artifactBindingPlaceholder: 'Example: value=fullchain,key=private', preview: 'Validate plugin settings', previewFailed: 'Failed to validate agent plugin settings',
      approveAndEnable: 'Approve and enable', activating: 'Enabling...', activateFailed: 'Failed to approve or enable agent plugin', disableFailed: 'Failed to disable agent plugin',
      types: { WORKFLOW_TEMPLATE: 'Workflow template', UNIFIED_PLUGIN: 'Unified capability plugin' }
    },
    changeSummaries: { createWorkflow: 'Create workflow from plugin market template' }
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
      executeRisk: 'Execution modifies target certificate configuration. Completed or failed plans also use this entry for re-execution; execution performs the required synchronous checks, while an optional dry-run preview is available from the managed application detail deployment flow.',
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
      certificateFormatId: 'Certificate format configuration ID',
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
      inputSourcesLoadFailed: 'Failed to load deployment input sources',
      inputSourcesTitle: 'Deployment input sources',
      inputSource: 'Source: {source}',
      inputSourceTarget: 'Deployment target: {targetId}',
      noInputSources: 'No variable sources are available for this plan.',
      noTargetSummary: 'Target summary not provided',
      workflowIdentityTitle: 'Workflow execution identity',
      workflowMode: 'User workflow',
      workflowModePluginInternal: 'Built-in plugin workflow',
      workflowDslVersion: 'Effective DSL version: {version}',
      workflowPluginVersion: 'Effective plugin version: {version}',
      workflowPluginVersionId: 'Plugin version ID: {versionId}',
      workflowVersionId: 'Version snapshot ID: {versionId}',
      workflowVersionSelectionPinned: 'Version policy: pinned by the plan',
      workflowVersionSelectionLatest: 'Version policy: latest published from the managed application',
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
      missingApplicationAssetIdForDryRun: 'Managed application ID is missing, so dry-run cannot start.',
      missingApplicationAssetIdForSave: 'Managed application ID is missing, so the deployment plan cannot be saved.',
      missingPlanId: 'Deployment plan ID is missing. Empty planId request blocked.',
      missingPlanIdForAction: '{action} is missing deployment plan ID. Empty planId request blocked.',
      missingRunIdRequest: 'Execution batch runId is missing. Empty runId request blocked.',
      saveFailed: 'Failed to save deployment plan',
      startDryRunFailed: 'Failed to start dry-run',
      inputIssuesHint: 'Repair the deployment inputs at the listed slot and binding layer, then retry.'
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
      projectDetailDescription: 'Shows project certificate inventory item details and related usages in the current agent context.',
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
      tooltip: {
        name: 'Name', issuer: 'Issuer', startTime: 'Start time', endTime: 'End time', daysRemaining: 'Days remaining', connectionStatus: 'Connection status', version: 'Version', managementAddress: 'Management address', lastCommunicationTime: 'Last communication', platform: 'Platform', protocolPort: 'Protocol and port', certificateDaysRemaining: 'Certificate days remaining', region: 'Region', latency: 'Latency'
      },
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
      noHostHeader: 'No host header',
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
      manualRescanCannotPullTasks: 'This agent cannot pull tasks, so rescan cannot run',
      manualRescanCreated: 'Manual rescan task created. Waiting for the Agent to pull it.',
      manualRescanSubmitting: 'Submitting rescan...',
      manualRescanUnsupportedType: 'This agent type does not support manual rescan',
      modalDescription: 'Shows the Agent summary, runtime environment, and IIS site data.',
      modalTitle: 'Agent details',
      nodeEyebrow: 'Agent node',
      tabsAriaLabel: 'Agent detail tabs'
    },
    empty: {
      description: 'Click Install agent, choose a platform and version, then generate a one-time install command.',
      noFrameworkSites: 'No {name} sites found',
      noIisSites: 'No IIS sites found',
      noRuntimeLogs: 'No runtime logs',
      noTomcatApps: 'No Tomcat apps found',
      noTomcatConnectors: 'No Tomcat connectors found',
      title: 'No agents'
    },
    errors: {
      certificateAssetIncomplete: 'Certificate inventory item data is incomplete, so details cannot be opened.',
      certificateAssetNotFound: 'No matching certificate inventory item was found in this project.',
      certificateAssetQueryFailed: 'Failed to query certificate inventory item.',
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
      configFile: 'Configuration file',
      configPath: 'Configuration path',
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
      compatibilityInstallUnavailable: 'The one-time installer for the Windows compatibility agent is not published yet. Do not substitute a Windows modern agent command.',
      installEntryPending: 'Installer pending',
      linuxGeneralTitle: 'General Linux agent',
      linuxGroupTitle: 'Linux',
      modalDescription: 'Choose platform and version to generate a one-time install command. The token is valid for 10 minutes and can only be used once.',
      modalTitle: 'Install agent',
      platform: 'Platform',
      platformLinuxDescription: 'For Ubuntu, Debian, CentOS, Rocky, AlmaLinux, and other Linux distributions.',
      platformWindowsDescription: 'For Windows Server and Windows 10/11. Registers as a system service after installation.',
      remainingTime: '{minutes}m {seconds}s',
      remainingValidity: 'Remaining validity',
      selectedAgent: 'Selected agent',
      selectionStepTitle: 'Select agent type',
      singleUseHint: 'Once the bootstrap script requests this token, it expires immediately and cannot be reused.',
      tokenCopied: 'Token copied',
      version: 'Version',
      versionLatest: 'Latest stable',
      windowsCompatibility2008: 'Windows Server 2008 R2 SP1',
      windowsCompatibility2012: 'Windows Server 2012 / 2012 R2',
      windowsCompatibilityTitle: 'Windows compatibility agent',
      windowsGroupTitle: 'Windows',
      windowsModernDesktop: 'Windows 10/11',
      windowsModernServer: 'Windows Server 2016 and later',
      windowsModernTitle: 'Windows modern agent',
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
      abnormalTitle: 'Abnormal agents',
      totalDescription: 'Number of agents currently registered with the control plane.',
      totalTitle: 'Total agents'
    },
    page: {
      description: 'View agents, generate install commands for different platforms, and inspect details in a dedicated modal.',
      installAgent: 'Install agent'
    },
    sections: {
      frameworkOverviewDescription: 'Shows {name} installation status, running status, and configuration location on the host.',
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
      mainInfoDescription: 'Shows agent identity, role, and latest heartbeat.',
      mainInfoTitle: 'Main information',
      runtimeDescription: 'Shows runtime system and version information reported by the Agent.',
      runtimeLogsDescription: 'Shows persisted runtime logs for manual rescans, heartbeat anomalies, and capability report interruptions.',
      runtimeLogsTitle: 'Runtime logs',
      runtimeTitle: 'Runtime environment',
      tomcatAppsDescription: 'Shows application paths and deployment directories discovered in Tomcat Host/Context.',
      tomcatAppsTitle: 'Tomcat apps',
      tomcatConnectorsDescription: 'Shows the Tomcat connector listen address, protocol, TLS switch, and certificate path.',
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
      eyebrow: 'Operations overview'
    },
    resources: {
      title: 'System resources',
      description: 'Live CPU and memory usage from the dashboard host.',
      cpu: 'CPU usage',
      memory: 'Memory usage',
      host: 'Host',
      abnormal: 'Attention',
      usageAria: '{metric} usage {value}%',
      unavailableAria: '{metric} is unavailable'
    },
    quickStart: {
      title: 'Quick start from here',
      description: 'Helps you quickly prepare certificates and deploy them to your applications',
      addCertificate: 'Import or request a new certificate',
      deployExistingApplication: 'Deploy to a website or application',
      unavailable: 'No entry available',
      safeExecution: 'Safe execution',
      guidedFlow: 'Guided flow'
    },
    trends: {
      title: 'Runtime trends',
      noDelta: '--',
      auditSuccess: { title: 'Audit success rate', suffix: 'success rate' },
      managedObjects: { title: 'Object health', suffix: 'healthy objects' },
      certificateAttention: { title: 'Certificate attention', suffix: 'to review' }
    },
      statusPanel: {
      description: 'Current visible status across certificates, Agents, gateways, and managed applications.',
      objects: 'objects'
    },
    recentLog: {
      title: 'Recent logs',
      live: 'Live'
    },
    aria: {
      assetHeatmap: 'Managed application status heatmap',
      certificateStatusList: 'Certificate status list',
      metrics: 'Core metrics',
      quickActions: 'Primary feature entry points',
      statusHeatmap: 'Certificate, Agent, gateway, and managed application status',
      statusLegend: 'Status legend'
    },
    assets: {
      groupCount: '{summary} · {total} items',
      title: 'Managed application status',
      updatedAt: 'Updated at {time}'
    },
    audit: {
      description: 'Prioritizes failures, denials, high-risk events, and key business changes.',
      title: 'Recent audit logs',
      activityTitle: 'Audit activity'
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
      noQuickActions: 'No quick entries available'
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
      sparklineLabel: '{metric} trend',
      stable: 'Stable',
      tracked: 'Tracked',
      activeAgents: {
        title: 'Active agents',
        description: 'Agents currently online and schedulable.'
      },
      activeGateways: {
        title: 'Active gateways',
        description: 'Isolation-zone gateways currently online.'
      },
      applications: {
        title: 'Current applications',
        description: 'Managed application entries.'
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
      title: 'System health',
      description: 'Summary across certificates, Agents, gateways, and managed applications.',
      healthy: 'Healthy',
      attention: 'Attention',
      abnormal: 'Abnormal',
      noData: 'No data',
      score: 'healthy objects',
      progressAria: 'Share of healthy system objects',
      normalObjects: 'normal objects',
      attentionObjects: 'objects to review'
    },
    quickWizard: {
      title: 'Quick access'
    },
    typeStats: {
      title: 'Object type distribution',
      description: 'Current visible objects by type.'
    },
    quickActions: {
      agents: {
        title: 'Assets',
        description: 'View Agent-managed assets and their deployment status.'
      },
      assets: {
        title: 'Managed applications',
        description: 'Maintain domains, ports, and deployment targets.'
      },
      audits: {
        title: 'Audit logs',
        description: 'Trace operators and execution results.'
      },
      certificates: {
        title: 'Certificate lifecycle',
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
      tooltip: {
        name: 'Name', issuer: 'Issuer', startTime: 'Start time', endTime: 'End time', daysRemaining: 'Days remaining', connectionStatus: 'Connection status', version: 'Version', managementAddress: 'Management address', lastCommunicationTime: 'Last communication', platform: 'Platform', protocolPort: 'Protocol and port', certificateDaysRemaining: 'Certificate days remaining', region: 'Region', latency: 'Latency'
      },
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
        title: 'Devices'
      },
      applicationAssets: {
        title: 'Managed applications'
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
      addGatewayAgent: 'Add gateway agent',
      close: 'Close',
      copied: 'Copied',
      copyEnableCommand: 'Copy enable command',
      copyInstallCommand: 'Copy install command',
      detail: 'Details',
      enableExistingAgent: 'Enable the gateway role on an existing agent',
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
          description: 'Forward deployment, check, and other tasks to agents in this region.',
          title: 'Task forwarding'
        },
        directControl: {
          description: 'Forward controlled operations to agents in this region without direct control-plane access to internal ports.',
          title: 'Remote control forwarding'
        },
        probe: {
          description: 'Check whether hosts, websites, or agents are reachable from this region.',
          title: 'Connectivity check'
        },
        relay: {
          description: 'After narrow authorization, transparently relay TCP bytes only to the approved target and port.',
          title: 'Direct TCP relay'
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
      description: 'Add a gateway agent, or enable the gateway role on an existing agent.',
      title: 'No gateways'
    },
    errors: {
      generateEnableCommandFailed: 'Failed to generate the gateway enable command.',
      generateInstallCommandFailed: 'Failed to generate the gateway agent install command.',
      missingEnableCommand: 'The backend did not return a gateway enable command.',
      missingInstallCommand: 'The backend did not return a gateway agent install command.',
      relayPolicyRequired: 'Enter at least one relay target and port.'
    },
    fields: {
      config: 'Configuration',
      defaultRegion: 'default',
      enableCommand: 'Enable command',
      expiresAt: 'Expires at',
      installCode: 'Install code',
      installCommand: 'Install command',
      platform: 'Platform',
      region: 'Region',
      relayPorts: 'Relay port allowlist',
      relayPortsPlaceholder: 'Example: 443, 8443',
      relayTargets: 'Relay target allowlist',
      relayTargetsPlaceholder: 'One per line or comma-separated, e.g. app.internal.example, 10.20.0.0/16',
      service: 'Service',
      unboundAgent: 'Do not bind a specific Agent'
    },
    links: {
      assets: 'View managed applications',
      executions: 'View execution records'
    },
    modals: {
      detail: {
        title: 'Gateway details'
      },
      enable: {
        title: 'Enable the gateway role on an existing agent'
      },
      install: {
        title: 'Add gateway agent'
      }
    },
    page: {
        description: 'Manage regional routing gateway agents.',
      title: 'Gateways'
    },
    platforms: {
      linuxSystemd: {
        description: 'Install the gateway agent service on a Linux host'
      },
      windowsService: {
        description: 'Install the gateway agent service on a Windows host'
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
      secretCreate: 'Create secret',
      secretVersionCreate: 'Create secret version',
      secretRotate: 'Rotate secret',
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
      secretCreated: 'Created secret',
      secretVersionCreated: 'Created secret version',
      secretUsed: 'Read secret',
      secretRotated: 'Rotated secret',
      permissionDenied: 'Permission denied',
      approvalCreated: 'Created approval',
      approvalApproved: 'Approval approved',
      approvalRejected: 'Approval rejected',
      certificateImported: 'Certificate imported',
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
      certificateVersionFormat: 'Certificate delivery format',
      deployment: 'Deployment',
      deploymentPlan: 'Deployment plan',
      execution: 'Execution',
      approval: 'Approval',
      permission: 'Permission',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Managed application',
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
      certificateVersionFormat: 'Certificate delivery format',
      deployment: 'Deployment',
      deploymentPlan: 'Deployment plan',
      execution: 'Execution task',
      executionRun: 'Execution task',
      approval: 'Approval',
      plugin: 'Plugin',
      workflowTemplate: 'Workflow template',
      gateway: 'Gateway',
      agent: 'Agent',
      serviceAsset: 'Managed application',
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
        title: 'Total audit events',
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
      ariaLabel: 'Audit event list',
      title: 'Audit event list',
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
    title: 'Notification management',
    description: 'Manage notification channels, routes, templates, silences, and reliable delivery records.',
    tabs: { channels: 'Channels', deliveries: 'Deliveries', rules: 'Rules and templates' },
    sections: { channels: 'Channel records', deliveries: 'Delivery records' },
    channels: { createTitle: 'Create notification channel' },
    settings: { privateOriginsTitle: 'Private deployment endpoints', privateOriginsDescription: 'Configure private HTTPS origins that notification management may access for WeCom, Feishu, and DingTalk.' },
    channelTypes: { email: 'Email', wecom: 'WeCom', slack: 'Slack', feishu: 'Feishu', dingtalk: 'DingTalk', telegram: 'Telegram', webhook: 'Generic webhook' },
    deploymentModes: { public: 'Public cloud', private: 'Private deployment' },
    fields: {
      name: 'Channel name', type: 'Channel type', deploymentMode: 'Deployment mode', smtpHost: 'SMTP host', smtpPort: 'SMTP port', from: 'From address',
      smtpSecurity: 'Connection security', smtpUsername: 'SMTP username', smtpPassword: 'SMTP password', secretValuePlaceholder: 'Enter the secret value',
      optionalSecretValuePlaceholder: 'Optional; enter the secret value', wecomWebhookUrl: 'WeCom group bot webhook URL', slackWebhookUrl: 'Slack incoming webhook URL',
      feishuWebhookUrl: 'Feishu custom bot webhook URL', dingtalkWebhookUrl: 'DingTalk custom bot webhook URL', feishuSigningSecret: 'Feishu signing secret',
      dingtalkSigningSecret: 'DingTalk signing secret', telegramBotToken: 'Telegram bot token', telegramChatId: 'Telegram chat ID', telegramMessageThreadId: 'Telegram topic ID (optional)',
      webhookUrl: 'Webhook URL', webhookUrlPlaceholder: 'Enter the complete webhook URL', webhookMethod: 'HTTP method', webhookHeaders: 'Fixed headers (JSON)',
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
    secrets: { name: '{channel} - {field}', fields: { smtpUsername: 'SMTP username', smtpPassword: 'SMTP password', webhookUrl: 'Webhook URL', signingSecret: 'Signing secret', botToken: 'Bot token' } },
    messages: {
      loadFailed: 'Failed to load notification management data', operationFailed: 'Notification management operation failed', testUsesChannelTarget: 'This channel will send the test notification to its configured target.',
      secretStoredHint: 'This value is encrypted and will not be shown again after creation.', createSecretFailed: 'Failed to save the encrypted value', invalidHeaders: 'Fixed headers must be a valid JSON object',
      smtpCredentialsPairRequired: 'SMTP username and password must be provided together', webhookUrlRequired: 'Webhook URL is required', botTokenRequired: 'Telegram bot token is required',
      chatIdRequired: 'Telegram chat ID is required', feishuWebhookUrlInvalid: 'Enter an official Feishu custom bot webhook URL', dingtalkWebhookUrlInvalid: 'Enter an official DingTalk custom bot webhook URL',
      wecomWebhookUrlInvalid: 'Enter a valid WeCom bot HTTPS webhook URL', telegramBotTokenInvalid: 'The Telegram bot token format is invalid', telegramMessageThreadIdInvalid: 'The Telegram topic ID must be a positive integer',
      privateDeploymentAllowlistHint: 'Private endpoints must first be added to the trusted HTTPS origin list above, otherwise testing and delivery are rejected.', privateOriginInvalid: 'A private endpoint must be an exact HTTPS origin without a path, query, user information, or fragment.', privateOriginsSecurityHint: 'Enter only the scheme, host, and optional port. Full webhook URLs, tokens, and signing secrets remain encrypted in the secret service.', telegramUsesBotApi: 'Telegram notifications use the official Bot API sendMessage method, not the event-receiving webhook.'
    }
  },
  settings: {
    ...(licensingLocaleMessages['en-US'] ?? {}),
    securityLabel: 'System settings entry',
    deploymentTasks: {
      eyebrow: 'Deployment tasks',
      title: 'Deployment task parameters',
      description: 'Control the tenant-wide Dry-run setting and whether applications without an explicit approval requirement must be approved before certificate deployment.',
      readonly: 'This account has read-only access.',
      fields: {
        dryRun: { title: 'Enable dry-run', description: 'Run a read-only precheck before deployment; results are advisory and do not block execution.', aria: 'Enable certificate deployment dry-run' },
        approval: { title: 'Enable approval flow', description: 'For applications without an explicit approval requirement, this tenant-wide setting controls whether certificate deployments require approval.', aria: 'Enable certificate deployment approval flow' }
      },
      actions: { save: 'Save settings', saving: 'Saving...' },
      messages: { saved: 'Deployment task parameters saved.' },
      errors: { loadFailed: 'Failed to load deployment task parameters.', saveFailed: 'Failed to save deployment task parameters.' }
    },
    version: {
      title: 'Version information',
      description: 'View the currently running GCAC version.',
      currentVersion: 'Current version',
      product: 'Product'
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
        serviceAsset: 'Managed application',
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
          name: 'Managed application logs',
          description: 'Managed application, host, service instance, and site operations'
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
        testConnection: 'Test connectivity',
        testing: 'Testing...',
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
        dialogTitle: 'Test identity source connectivity',
        dialogDescription: 'Checking DNS, the LDAP authentication port, and BIND status for {name} ({server}).',
        loading: 'Checking DNS, the LDAP authentication port, and BIND status in sequence...',
        checks: {
          dns: { title: 'Check DNS resolution' },
          port: { title: 'Check LDAP authentication port' },
          bind: { title: 'Check LDAP BIND' }
        },
        status: {
          passed: 'Passed',
          failed: 'Failed',
          skipped: 'Skipped'
        },
        messages: {
          summaryPassed: 'All LDAP connectivity checks passed',
          summaryFailed: 'LDAP connectivity checks did not pass',
          dnsIp: 'The target is an IP address; DNS lookup was not required',
          dnsResolved: 'DNS resolved successfully: {addresses}',
          dnsFailed: 'DNS resolution failed',
          portReachable: '{protocol} authentication port {port} is reachable',
          portFailed: 'The LDAP authentication port is unreachable',
          bindServicePassed: 'LDAP service account BIND and Base DN query succeeded',
          bindAnonymousPassed: 'Anonymous LDAP BIND and Base DN query succeeded',
          bindFailed: 'LDAP BIND or Base DN query failed',
          skippedInvalidUrl: 'Skipped because the LDAP address is invalid',
          skippedDnsFailed: 'Skipped because DNS resolution failed',
          skippedPortFailed: 'Skipped because the LDAP authentication port is unreachable',
          unknownCheck: 'The check did not pass ({code})',
          checkNotReturned: 'The server did not return this check result.'
        },
        errors: {
          emptyResult: 'The server did not return a connectivity test result',
          requestFailed: 'Connectivity test request failed'
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
      create: 'New configuration file',
      toggleFilters: 'Filter',
      edit: 'Edit',
      delete: 'Delete',
      deleting: 'Deleting...',
      applyTemplate: 'Apply built-in template',
      saving: 'Saving...',
      confirmSave: 'Save'
    },
    columns: {
      configName: 'Configuration name',
      targetSummary: 'Target environment',
      displayFormat: 'Content format',
      extension: 'Extension',
      encodingSummary: 'Encoding',
      exportSummary: 'Contents / export options',
      actions: 'Actions'
    },
    dialog: {
      createTitle: 'Create certificate format configuration',
      editTitle: 'Edit certificate format configuration',
      description: 'Select the system and target platform, apply a built-in template, then adjust each option and define what the single artifact contains.'
    },
    list: {
      title: 'Certificate format configuration list',
      descriptionWithCount: '{count} certificate format configurations are available.'
    },
    empty: {
      text: 'No certificate format configurations'
    },
    fields: {
      contentFormat: 'Content format',
      systemPlatform: 'System platform',
      runtimePlatform: 'Target platform',
      configName: 'Configuration name',
      backendFormat: 'Backend format',
      outputExtension: 'Output extension',
      expiresAt: 'Configuration expiry time (optional)',
      certificateEncoding: 'Certificate encoding',
      certificateContentEncoding: 'Certificate content encoding',
      privateKeyEncoding: 'Private key encoding',
      includeLeafCertificate: 'Include leaf certificate',
      includeCertificateChain: 'Include certificate chain',
      includePrivateKey: 'Include private key',
      mainArtifactIncludesChain: 'Main artifact includes certificate chain',
      generateChainFile: 'Generate additional chain file',
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
        description: 'Define the configuration identity, content format, and final extension.'
      },
      encoding: {
        title: 'Encoding',
        description: 'Only encoding options valid for the current content format are shown.'
      },
      content: {
        title: 'Contents',
        description: 'Defines what the main artifact contains: leaf certificate, certificate chain, and private key.'
      },
      export: {
        title: 'Export options',
        description: 'Define whether to generate extra chain/private-key files and container password options.'
      }
    },
    filters: {
      keywordPlaceholder: 'Configuration name / target environment / alias / content format'
    },
    placeholders: {
      configName: 'For example: device-compatible single-file PEM',
      exportPassword: 'Enter the PFX/JKS export password'
    },
    validation: {
      selectPlatformsFirst: 'Select the system platform and target platform first.',
      configNameRequired: 'Configuration name is required',
      passwordRequired: 'PFX/JKS configurations require an export password'
    },
    errors: {
      loadFailed: 'Failed to load certificate format configurations',
      saveFailed: 'Failed to save certificate format configuration',
      deleteFailed: 'Failed to delete certificate format configuration',
      createExportSecretFailed: 'Failed to create export password Secret',
      withCode: '{message} ({code})'
    },
    fallbacks: {
      unnamedConfig: 'Unnamed configuration {index}',
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
      leafCertificate: 'Leaf certificate',
      certificateChain: 'Certificate chain',
      privateKey: 'Private key',
      extraChainFile: 'Additional chain file',
      extraPrivateKeyFile: 'Extra private key file'
    },
    secret: {
      defaultConfigName: 'Certificate format configuration',
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
        description: 'Apache is usually delivered as a PEM certificate file plus a separate private key, with an additional chain file for operational compatibility.'
      },
      windowsTomcat: {
        configName: 'Windows-Tomcat-PKCS12 standard template',
        description: 'Tomcat mainly uses JKS/PKCS#12 keystores. This template defaults to the more portable PKCS#12 format.'
      },
      windowsOther: {
        configName: 'Windows device-compatible single-file PEM template',
        description: 'For devices that require a single file containing the leaf certificate, certificate chain, and private key. The extension can be adjusted to .crt or .cer.'
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
        description: 'Apache commonly uses a PEM certificate file plus a separate private key, with an additional chain file for split deployment.'
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
    title: 'Deployment inputs',
    description: 'Configure deployment values from the unified input contract declared by the plugin or workflow.',
    saveAssetFirst: 'Save the managed application and execution source before editing deployment inputs projected by the backend.',
    contractVersion: 'Contract {version}',
    groups: { required: 'Required configuration', advanced: 'Advanced configuration', readonly: 'Read-only and runtime values' },
    actions: { expand: 'Expand advanced configuration', collapse: 'Collapse advanced configuration' },
    placeholders: { select: 'Select an option', credential: 'Select a credential', artifact: 'Select a certificate delivery format', output: 'Select an output' },
    artifacts: { format: 'Artifact format' },
    allowInsecureTls: {
      label: 'Allow skipping TLS certificate verification',
      description: 'Explicitly authorize this deployment to skip TLS certificate verification when the device uses a self-signed or untrusted certificate.',
      help: 'This records deployment intent only; it does not grant execution permission. Approval and a host-issued execution grant are still required.'
    },
    runtimeValue: 'Provided by {source} at runtime',
    source: 'Source: {source}',
    sourceKinds: {
      asset: 'Managed application',
      binding: 'Binding',
      default: 'Default value',
      derived: 'Derived value',
      system: 'System value',
      step_output: 'Step output',
      unknown: 'Unknown source'
    },
    issues: {
      title: 'Input issues',
      unknown: 'Deployment input validation failed ({code})',
      DEPLOYMENT_INPUT_REQUIRED: 'A required deployment input is missing',
      DEPLOYMENT_CONNECTION_REQUIRED: 'A required connection setting is missing',
      DEPLOYMENT_CREDENTIAL_REQUIRED: 'A required credential is missing',
      DEPLOYMENT_ARTIFACT_REQUIRED: 'A required deployment artifact is missing',
      DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN: 'This deployment input cannot be overridden',
      DEPLOYMENT_INPUT_SLOT_UNDECLARED: 'The deployment input slot is not declared',
      DEPLOYMENT_INPUT_FIELD_UNDECLARED: 'The deployment input field is not declared',
      DEPLOYMENT_INPUT_TYPE_INVALID: 'The deployment input has an invalid type',
      DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN: 'A fixed deployment input cannot be overridden',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED: 'The credential snapshot is missing',
      DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH: 'The credential snapshot does not match the current selection',
      DEPLOYMENT_CREDENTIAL_KIND_INVALID: 'The credential type is not supported',
      DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED: 'The artifact snapshot is missing',
      DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED: 'A required artifact output is missing'
    }
  },
  assets: {
    presentation: {
      cards: 'Card view',
      list: 'Table view',
    },
    selection: {
      selectedCount: 'Selected {count} / {total} managed applications',
      actions: {
        bulkDelete: 'Bulk delete',
        bulkUpdateCertificate: 'Bulk update certificate'
      },
      bulkDeleteRisk: 'This removes the selected managed applications and their manual target associations. Discovered frameworks, sites, and managed targets are preserved.',
      bulkDeleteSuccess: 'Deleted {count} managed applications.',
      bulkDeletePartialSuccess: 'Deleted {succeeded} managed applications; {failed} failed.',
      bulkUpdateDescription: 'Choose and submit a new certificate version for {count} managed applications bound to the same certificate domain “{domain}”.',
      bulkUpdateFailed: 'Certificate update failed; none of the {count} managed applications were submitted.',
      bulkUpdateSuccess: 'Certificate update submitted for {count} managed applications.',
      bulkUpdatePartialSuccess: 'Certificate update submitted for {succeeded} managed applications; {failed} failed.'
    },
    aria: {
      selectCard: 'Select managed application {name}',
      detailCard: 'View managed application details {name}',
      editCard: 'Edit managed application {name}',
      deleteCard: 'Delete managed application {name}'
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
    title: 'Managed applications',
    description: 'Manage application entry points by domain or IP, focusing on address, port, protocol, site, and execution targeting.',
    resourceName: 'Managed application',
    linkage: { title: 'Plugin and agent linkage', description: 'Check plugin version, agent version, and local execution policy.', status: 'Status', agent: 'Agent version', plugin: 'Plugin version', policy: 'Policy match', repair: 'Repair' },
    executionModes: {
      label: 'Execution mode',
      plugin: { title: 'Plugin execution', description: 'Use the certificate deployment capability enabled for the managed target.' },
      workflowOverride: { title: 'Workflow override', description: 'Bypass plugin execution and use a user-owned workflow.', notice: 'Workflow override disables this managed application plugin assignment and keeps only the workflow execution binding.' }
    },
    actions: {
      add: 'Add managed application',
      edit: 'Edit',
      detail: 'Details',
      addVariable: 'Add variable',
      delete: 'Delete',
      deleteRisk: 'Deleting removes this managed application and its manual target association from the application list. Discovered frameworks, sites, virtual servers, and managed targets are preserved.',
      rollbackFromLatestSnapshot: 'Rollback from latest snapshot',
      rollingBack: 'Rolling back...',
      deployCertificate: 'Deploy certificate',
      latestCertificate: 'Latest certificate',
      updateCertificate: 'Update certificate',
      saving: 'Saving...',
      creating: 'Creating...',
      saveChanges: 'Save changes',
      confirmCreate: 'Create'
    },
    columns: {
      domain: 'Domain',
      port: 'Port',
      protocol: 'Protocol',
      device: 'Device',
      platform: 'Platform',
      framework: 'Framework',
      site: 'Site',
      status: 'Status',
      actions: 'Actions'
    },
    fields: {
      assetId: 'Managed application ID',
      domain: 'Domain',
      addressType: 'Address type',
      port: 'Port',
      protocol: 'Protocol',
      device: 'Device',
      verifyUrl: 'Verify URL',
      platform: 'Platform',
      frameworkType: 'Framework type',
      deploymentStrategyCompatibility: 'Deployment strategy compatibility',
      selectWorkflow: 'Select workflow',
      workflowVersionSelection: 'Workflow version strategy',
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
      hostHeader: 'Host header',
      sniName: 'SNI name',
      currentCertificate: 'Current certificate',
      remainingValidity: 'Remaining validity',
      targetCertificate: 'Target certificate',
      expectedFingerprint: 'Expected fingerprint',
      certificateStore: 'Certificate store',
      snapshotType: 'Snapshot type',
      time: 'Time',
      executionRun: 'Execution run',
      displayName: 'Display name',
      siteInstance: 'Site instance',
      certificateFormat: 'Certificate delivery format',
      workflow: 'Workflow',
      publishedVersion: 'Published version',
      runner: 'Runner',
      artifactFormat: 'Artifact format',
      updatePlugin: 'Certificate update plugin',
      approvalRequired: 'Require approval for certificate deployment'
    },
    capability: { source: 'Capability source', plugin: 'Plugin version', runtime: 'Runtime', executionLocation: 'Execution location', pendingAssignment: 'Saving will create a managed application deployment capability assignment.' },
    links: {
      certificateBindings: 'View certificate bindings',
      executions: 'View execution records'
    },
    empty: {
      title: 'No managed applications',
      description: 'Waiting for discovery to write ServiceAsset records, or add entry points through backend APIs.',
      noBindingInformation: 'No binding information',
      notSet: 'Not set',
      notSelected: 'Not selected',
      noVariablePreset: 'No variables can be added',
      basicEntryIncomplete: 'Basic entry incomplete'
    },
    detail: {
      title: 'Application details',
      description: 'Keep managed application details, bindings, deployment entry, and snapshots in one modal.',
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
          description: 'The managed application is the primary object. Hosts and sites only provide execution targeting information.'
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
      title: 'Certificate deployment',
      description: 'Choose a certificate version for this managed application. The system creates a deployment snapshot, runs preflight, submits approval, and executes when authorized.',
      dialogTitle: 'Certificate deployment',
      dialogDescription: 'This applies only to the current managed application. The deployment plan remains the backend snapshot, approval, and execution boundary.',
      noCertificateAsset: 'No deployable certificate',
      targetLocked: 'Update target locked',
      latestVersionPointer: 'Automatically apply the latest version of the current certificate',
      deployThisVersion: 'Deploy this certificate version',
      loadingRecords: 'Loading deployment records...',
      emptyRecords: 'This managed application has no deployment records.',
      preflightAvailable: '{count} preflight checks returned',
      preflightUnavailable: 'No preflight run yet',
      rollbackUnavailable: 'No rollback requested',
      fields: { status: 'Deployment status', approval: 'Approval', latestRun: 'Latest run', preflight: 'Preflight', rollback: 'Rollback', updatedAt: 'Updated at' },
      feedback: { preflightRunning: 'Waiting for the preflight run to finish.', pendingApproval: 'Preflight completed. The deployment is awaiting approval.', executionStarted: 'Preflight and approval passed. The deployment run has started.' },
      errors: { missingApplicationAssetId: 'Managed application ID is required to create a certificate deployment.', loadOptionsFailed: 'Failed to load deployable certificate versions.', createPlanMissingId: 'The deployment snapshot was created without a plan ID.', deployFailed: 'Certificate deployment failed.', preflightFailed: 'The certificate deployment preflight did not pass.', preflightTimeout: 'The certificate deployment preflight timed out.', loadRecordsFailed: 'Failed to load managed application deployment records.' }
    },
    compatibilityModes: {
      unified: 'Unified plugin binding',
      legacy: 'Legacy compatibility',
      legacyAdapted: 'Unified binding with legacy dual-read'
    },
    managementModes: {
      agent: 'Agent mode',
      agentDescription: 'Bind agent, site instance, and managed target',
      workflow: 'Workflow mode',
      workflowDescription: 'Select workflow version and runtime variables'
    },
    loading: {
      agents: 'Loading agents...',
      sites: 'Loading sites...',
      managedTargets: 'Loading targets...',
      certificateFormats: 'Loading format configurations...',
      workflows: 'Loading workflows...',
      versions: 'Loading versions...',
      gateways: 'Loading gateways...',
      credentials: 'Loading credentials...'
    },
    select: {
      agent: 'Select agent',
      siteInstance: 'Select site instance',
      managedTarget: 'Select managed target',
      certificateFormat: 'Select certificate delivery format',
      workflow: 'Select workflow',
      publishedVersion: 'Select published version',
      gateway: 'Select gateway',
      variablePreset: 'Select preset variable',
      credential: 'Select credential',
      generic: 'Select',
      artifactFormat: 'Select format configuration',
      output: 'Select output',
      optionalOutput: 'Optional',
      updatePluginOptional: 'Optional; keep the currently effective plugin'
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
      certificateFormatRequired: 'Certificate variable {name} must select a certificate format configuration',
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
      ariaLabel: 'Managed application creation steps',
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
        agentDescription: 'Select agent, site instance, managed target, and certificate delivery format.',
        workflowTitle: 'Workflow runtime configuration',
        workflowDescription: 'Select workflow version, runner, and variables. Certificate variables are injected at runtime.',
        confirmTitle: 'Confirm and save',
        confirmDescription: 'Review application entry, deployment mode, and runtime parameters before saving the managed application.'
      }
    },
    form: {
        createTitle: 'Add managed application manually',
        editTitle: 'Edit managed application',
      createDescription: 'Create an application entry and bind target information required for later deployment.',
      editDescription: 'Update the application entry and deployment target binding.',
      createRequestCompleted: 'Create request completed.',
      editRequestCompleted: 'Save request completed.',
      agentCertificateFormatHint: 'Agent mode uses this certificate delivery format to generate deployment materials.',
      approvalRequiredHint: 'When checked, deployments for this application always require approval; otherwise the tenant-wide deployment setting is used.',
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
      description: 'Used to display managed applications in workflows, run post-deployment probes, and synchronize DSL target variables.',
      dslSyncHint: 'Synced to DSL target variables',
      advancedTitle: 'Advanced settings',
      advancedDescription: 'Change only when overriding the default listener, request host, or TLS certificate name.',
      expandAdvanced: 'Expand advanced settings',
      collapseAdvanced: 'Collapse advanced settings',
      bindingInformationLabel: 'Service listener rule',
      bindingInformationHelp: 'Describes the address, port, and host combination used by the service listener.',
      hostHeaderLabel: 'Request host name',
      hostHeaderHelp: 'Change only when the target service requires a specific HTTP Host header.',
      sniNameLabel: 'SNI server name',
      sniNameHelp: 'Change only when the TLS handshake name differs from the access host.'
    },
    workflowVersionSelection: {
      pinned: 'Pin the current version',
      latestPublished: 'Always use the latest published version'
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
      certificateDescription: 'The certificate version is selected by the deployment plan. Bind format configuration and outputs below; {name}.outputs.*.content is injected at runtime.',
      presets: {
        deviceHost: 'Target host or device address',
        sshUsername: 'SSH user name',
        credential: 'Workflow credential',
        certificate: 'Certificate delivery format',
        targetPlatform: 'Target platform',
        apacheServiceName: 'Apache systemd service name',
        apacheSiteConfigPath: 'Apache site configuration path',
        certificateFilePath: 'Certificate destination path',
        certificateKeyFilePath: 'Private key destination path',
        backupRoot: 'Certificate backup root',
        expectedResponseContains: 'Expected response contains text',
        virtualHostServerName: 'VirtualHost ServerName'
      }
    },
    certificateBindings: {
      title: 'Certificate variable bindings',
      description: 'Select the certificate delivery format and outputs for certificate variables in the workflow.',
      variableCount: '{count} certificate variables',
      defaultVariableDescription: 'Certificate delivery format variable',
      noArtifactOutputs: 'No selectable outputs for the current format configuration.'
    },
    certificateOutputs: {
      publicCertificateWithChain: 'Leaf certificate + certificate chain',
      publicCertificate: 'Leaf certificate',
      certificateChain: 'Certificate chain',
      privateKey: 'Private key',
      pemBundle: 'PEM bundle artifact',
      container: '{format} container',
      bundle: 'Bundle'
    },
    certificateFormats: {
      savedConfigMissingWithId: '{id} (saved configuration, not returned by current list)',
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
      loadCertificateFormatsFailed: 'Failed to load certificate format configurations',
      loadAssetDetailFailed: 'Failed to load managed application details',
      rollbackFailed: 'Failed to start rollback',
      loadTargetsFailed: 'Failed to load sites and managed targets',
      createAssetFailed: 'Failed to create managed application',
      pluginFormLoadFailed: 'Failed to load the plugin configuration form',
      pluginBindingCreateFailed: 'Failed to save the plugin binding',
      loadWorkflowCredentialsFailed: 'Failed to load workflow credentials',
      loadCredentialProfilesFailed: 'Failed to load credential profiles',
      noAvailableSiteInstance: 'No available site instance was found. Confirm device discovery reported frameworks and sites.',
      managedTargetRediscoveryRequired: 'This site has no managed targets. Run device discovery again.',
      noCompatibleManagedPlugin: 'No enabled plugin is compatible with this managed target.',
      capabilityAssignmentMissing: 'This target has no effective deployment capability assignment.'
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
          description: 'Bring the new certificate material into the system. Application associations and update plans continue from this certificate.',
          helperCompleted: '{count} certificate domains are already managed. You can keep replacing or adding certificate versions.',
          helperEmpty: 'Import the current certificate first. Application associations and automatic plans depend on this step.',
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
        attentionDescription: 'Resolve expired or soon-to-expire certificates first, then finish application associations and automatic plans.',
        assetAction: 'Open professional details',
        emptyTitle: 'No urgent certificate right now',
        emptyDescription: 'All imported certificates are currently still within their validity period.'
      },
      simple: {
        title: 'Certificate and application management',
        subtitle: 'Manage certificates and see which applications use them',
        sections: {
          certificates: {
            title: 'Certificate lifecycle',
            help: 'View and manage all certificates, including expiry and status.'
          },
          applications: {
            title: 'Connected applications',
            help: 'See where certificates are used and how often they are updated.'
          }
        },
        stats: {
          total: 'Certificates',
          expiring: 'Expiring soon',
          expired: 'Expired'
        },
        versionCount: '{count} versions',
        versionCountShort: '{count}',
        sourceLabels: {
          manual: 'Manual',
          acme: 'ACME',
          unknown: 'Unknown'
        },
        fields: {
          expires: 'Expires at',
          source: 'Source'
        },
        empty: {
          title: 'No certificates yet',
          description: 'Import your first certificate to start managing it.'
        },
        applications: {
          description: 'See which applications use the selected certificate and configure automatic updates.',
          selectPrompt: 'Select a certificate on the left first',
          selectedCertificate: 'Selected certificate',
          connectedApps: 'Connected applications ({count})',
          noApps: 'No applications are connected to this certificate yet.',
          addApp: 'Add application',
          automationTitle: 'Automatic update configuration',
          activeAutomations: 'Active automatic updates',
          totalAutomations: 'Total automatic update plans',
          automationDescription: 'Automatic update plans check certificate status regularly and deploy updates to connected applications when needed.'
        }
      }
    },
    detail: {
      backList: 'Back to list',
      description: 'Shows certificate version details, delivery formats, and related applications.',
      title: 'Certificate details'
    },
    detailPanel: {
      sources: {
        agentContext: 'agent context',
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
        empty: 'No connected applications',
        toolbar: 'Connected applications'
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
        usage: 'Connected applications'
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
      create: 'Create format configuration',
      createFailed: 'Failed to create format',
      description: 'PEM/DER/PFX/JKS/P7B format configuration entry for certificate {id}.',
      empty: 'No format configurations',
      fields: {
        alias: 'Alias (optional)',
        containsPrivateKey: 'Contains private key (PEM)',
        passwordSecretRef: 'passwordSecretRef (PFX/JKS)',
        targetFormat: 'Target format',
        versionId: 'Version ID'
      },
      hint: 'PFX/JKS must use an existing backend passwordSecretRef. Deployment materials are generated on demand from the certificate version and format configuration.',
      loadFailed: 'Failed to load format configurations',
      optionAvailable: '{label} - available',
      placeholders: {
        alias: 'For example gcac-cert'
      },
      title: 'Certificate format configuration',
      toolbar: 'Format configuration list',
      unsupported: '{format} cannot be created with the current capability declaration.'
    },
    import: {
      addTitle: 'Add certificate',
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
        title: 'Choose how to add a certificate',
        description: 'Import an existing certificate or use ACME automatic issuance when it is available.',
        manual: {
          title: 'Import an existing certificate',
          description: 'Upload a PEM, CRT, or PFX certificate file and its private key.',
          recommended: 'Recommended'
        },
        acme: {
          title: 'Request a certificate through ACME',
          description: 'Automatically request and renew certificates from a certificate authority.',
          unavailable: 'Unavailable'
        },
        unavailable: {
          title: 'No ACME issuance channel is configured',
          description: 'This console does not have an available ACME issuance entry point. Import an existing certificate, or retry after an automated issuance channel is configured.'
        }
      },
      acme: {
        title: 'Request an ACME certificate', loading: 'Checking issuance availability...', blocked: 'The issuance path is not ready. Resolve the listed conditions and refresh.',
        status: { ready: 'Ready to request', blocked: 'Setup required', unknown: 'Status unknown' },
        fields: { issuer: 'Issuer', email: 'Contact email', domains: 'Domain names', dnsCredential: 'DNS credential', keyType: 'Key type', autoRenew: 'Auto-renew' },
        keyTypes: { rsa: 'RSA', ecdsa: 'ECDSA' },
        actions: { create: 'Submit request', refresh: 'Refresh status' },
        errors: { requestFailed: 'ACME request failed' }
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
        source: 'Add method',
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
        notBefore: 'Valid from',
        notAfter: 'Expires on',
        associatedAsset: 'Connected application',
        sourceType: 'Source',
        status: 'Status',
        certificateVersionId: 'Certificate version ID'
      },
      sourceTypes: {
        manual: 'Manual import',
        internal_ca: 'Internal CA',
        enterprise_ca: 'Enterprise CA',
        external_api: 'External API',
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
        title: 'Certificate identity list',
        loadFailed: 'Failed to load certificate identities',
        empty: 'No certificate identities',
        unselectedTitle: 'No domain selected',
        unselectedDescription: 'Select a logical certificate domain on the left first.'
      },
      versions: {
        title: 'Certificate list',
        titleWithDomain: 'Certificates for {domain}',
        description: 'Shows certificates under the current identity, including certificate name, validity, issuer, and subject.',
        loadFailed: 'Failed to load certificate list',
        emptyForDomain: 'No certificates under this identity',
        emptyForDomainDescription: 'Use the import certificate button on the right of the filters to add certificate versions for this domain.',
        empty: 'No certificates',
        toolbar: 'Certificate version list',
        currentCount: '{count} certificate versions'
      },
      actions: {
        toggleFilters: 'Filter',
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
        relatedAssetCount: '{count} related certificate inventory items'
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
        relatedAssets: 'Related certificate inventory items',
        relatedVersions: 'Related certificate versions'
      },
      sections: {
        observations: 'Source observations',
        relatedAssets: 'Related certificate inventory items',
        versionRelations: 'Leaf certificate relations',
        managedCertificates: 'Managed certificate root status'
      },
      states: {
        loadFailed: 'Failed to load root certificate records',
        detailFailed: 'Failed to load root certificate details',
        assetLoadFailed: 'Failed to load related certificate inventory items',
        emptyTitle: 'No root certificate records',
        emptyDescription: 'The current project does not have any imported root certificates yet.',
        unselectedTitle: 'No root certificate selected',
        unselectedDescription: 'Select a root certificate record from the list on the left first.',
        rootNotInLibrary: 'This root certificate is not in the library yet. The related certificate inventory items and statuses below are inferred from managed certificate chains.',
        emptyObservations: 'No source observations yet',
        emptyRelations: 'No related leaf certificate versions',
        emptyAssets: 'No certificate inventory items are currently related to this root'
      },
      validationStatus: {
        pending: 'Pending',
        verified: 'Verified',
        rejected: 'Rejected',
        expired: 'Expired'
      },
      sourceTypes: {
        control_plane_node: 'Control plane node root store',
        openssl: 'Control plane OpenSSL store',
        windows: 'Control plane Windows root store',
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
        bearerToken: 'Bearer token'
      }
    },
    canvasModel: {
      nodeTypes: {
        http: {
          description: 'Call a structured HTTP API instead of scattered curl strings.'
        },
        browser: {
          displayName: 'Browser step',
          description: 'Navigate, extract, or verify page information in a logged-in browser session.'
        },
        ssh: {
          displayName: 'SSH command',
          description: 'Declare the SSH command to run while storing only connection and credential references.'
        },
        sftp: {
          displayName: 'SFTP upload/download',
          description: 'Upload or download files through a formal SFTP step, suitable for certificate and configuration installation.'
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
          displayName: 'For each',
          description: 'Iterate a dynamic collection sequentially and run the same child steps for every item.'
        },
        checkpoint: {
          displayName: 'Recovery checkpoint',
          description: 'Save a verifiable remote-state summary before a device write operation.'
        },
        pluginAction: {
          displayName: 'Plugin atomic action',
          description: 'Invoke one explicitly declared plugin action without taking over workflow order or rollback.'
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
        expectedHostKeyFingerprint: 'Host key fingerprint',
        hostKeyPolicy: 'Host key policy',
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
        itemsPath: 'Items path',
        itemVariable: 'Item variable',
        indexVariable: 'Index variable',
        maxItems: 'Maximum items',
        foreachSteps: 'Child steps JSON',
        checkpointName: 'Checkpoint name',
        checkpointCapture: 'Capture paths JSON',
        requiredForRollback: 'Required for rollback',
        pluginId: 'Plugin ID',
        capability: 'Capability',
        actionId: 'Action ID',
        actionContractVersion: 'Action contract version',
        actionInput: 'Action input JSON',
        inputSchemaSha256: 'Input schema digest',
        outputSchemaSha256: 'Output schema digest',
        writeEffect: 'Write effect',
        idempotencyKeyRef: 'Idempotency key reference',
        outputFormat: 'Output format',
        usernameVariable: 'Username variable',
        variable: 'Variable',
        verifyType: 'Verify type',
        browserAction: 'Browser action',
        browserUrl: 'Page URL',
        browserExtractions: 'Extraction JSON',
        browserVerification: 'Verification JSON'
      },
      options: {
        boolean: { yes: 'Yes', no: 'No' },
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
        missingWorkflowDsl: 'Backend did not return workflow DSL'
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
        savedBearerToken: 'Saved bearer token',
        savedSshSftp: 'Saved SSH / SFTP credentials',
        savedUsernamePassword: 'Saved username + password'
      },
      credentials: {
        emptyCreateHint: 'No available credentials. Create one from credential management on the list page.',
        loading: 'Loading credentials from backend...'
      },
      dsl: {
        title: 'DSL import and overwrite',
        hint: 'Paste external DSL JSON or choose a local DSL file. Import only overwrites the current canvas in the browser; a new workflow version is created only after saving the draft.',
        selectFile: 'Select DSL file',
        actions: {
          importOverwrite: 'Import DSL and overwrite canvas',
          resetToCanvas: 'Refill current canvas DSL',
          openStepEditor: 'Edit current node DSL in a dialog',
          openStepEditorAria: 'Edit current node DSL in a dialog',
          applyStepEditor: 'Apply changes',
          cancelStepEditor: 'Cancel'
        },
        editor: {
          title: 'Edit current node DSL',
          description: 'Edit the complete JSON and apply it. Invalid JSON will not overwrite the current node.',
          ariaLabel: 'Current node DSL content'
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
        requestBody: 'Request body',
        requestBodyStructuredHint: 'This request uses structured form or multipart fields. Edit them in the DSL editor.',
        requestBodyEmptyHint: 'This request has no configured body.',
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
        createTitle: 'Create from plugin', applyTitle: 'Create draft from plugin', description: 'Only certificate workflows from enabled plugins are listed. Choose a workflow first, then choose the plugin version. The copied workflow is user-owned and editable.',
        createAction: 'Create workflow', applyAction: 'Create draft', currentTarget: 'Current workflow: {name}', namePlaceholder: 'Enter workflow name', loading: 'Loading plugin workflow sources...', empty: 'No plugin workflow source is available.', version: 'Plugin version', workflowVersion: 'Workflow version', versionSource: 'Version source: {plugin} / {version} / {capability}',
        capabilities: { deploy: 'Certificate deployment', rollback: 'Certificate rollback' }, errors: { loadFailed: 'Failed to load plugin workflow sources', nameRequired: 'Enter a workflow name', missingApplyTarget: 'The target workflow is missing', actionFailed: 'Failed to copy the plugin workflow' }
      },
      origins: { user: 'Custom', plugin_internal: 'Plugin built-in' },
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
        origin: 'Origin',
        note: 'Note',
        status: 'Status',
        updatedAt: 'Updated at'
      },
      filters: {
        showNonDeployment: 'Show non-deployment workflows'
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
        createFromPlugin: 'Create workflow from plugin capability',
        applyFromPlugin: 'Create draft from plugin capability',
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
      bearer: 'Enter bearer token',
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
    tls: monitoringTlsEnUS,
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
      noAddableAssets: 'No managed applications can be added. Adjust existing target probe intervals in the detail view.',
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
      applicationAsset: 'Managed application',
      currentTarget: 'Current target',
      probeInterval: 'Probe interval',
      secondsUnit: 'seconds',
      millisecondsUnit: 'ms'
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
      warning: 'Warning',
      removed: 'Removed'
    },
    warnings: {
      certificateNotApplied: 'The latest domain certificate version is not yet applied according to the system probe',
      chainVerificationFailed: 'The system probe detected that certificate chain verification failed'
    },
    fallback: {
      noEndpoint: 'No endpoint configured',
      noFingerprint: 'No fingerprint',
      notClosed: 'Not closed',
      noSummary: 'No summary',
      notCollected: 'Not collected',
      notSelected: 'Not selected',
      unknownAsset: 'Unknown managed application',
      removedAsset: '{name} (managed application removed)',
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
      closedAt: 'Warning closed at',
      currentStatus: 'Current status',
      expiresAt: 'Expires at',
      issuerName: 'Issuer name',
      latency: 'Latency',
      occurredAt: 'Occurred at',
      result: 'Result',
      source: 'Source',
      status: 'Status',
      time: 'Time',
      warningContent: 'Warning details'
    },
    dialog: {
      defaultMetricsHint: 'Availability, latency, certificate information, and certificate history are monitored by default.',
      description: 'Select a target from managed applications. The system will collect availability, latency, certificate information, and certificate history.',
      loadingAssets: 'Loading managed applications...',
      selectAsset: 'Select managed application',
      title: 'Add monitor'
    },
    source: {
      controlPlane: 'Control plane'
    },
    targets: {
      assetCount: '{count} managed applications',
      lazyLoadHint: '{shown} / {total} loaded, scroll to load more'
    }
  },
  login: {
    visualLabel: 'Product overview',
    brand: 'GCAC',
    brandSecondary: 'Certificate lifecycle management platform',
    headlinePrefix: 'Certificate ',
    headlineHighlight: 'lifecycle',
    headlineSuffix: ' management console',
    intro: 'Manage certificate inventory, deployment targets, and execution records in one verifiable workflow for import, renewal, rollout, audit, and rollback.',
    capabilitiesLabel: 'Platform capabilities',
    featureLifecycle: 'Lifecycle management',
    featureLifecycleDesc: 'Track import, renewal, versions, and expiry warnings across the certificate inventory.',
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
      certificateAssetId: 'Certificate inventory ID',
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
    title: 'Internal CA', description: 'Manage internal certificate authorities, the certificate lifecycle for managed applications, CA nodes, and certificate reuse risks.',
    tabs: { trustDomains: 'CA trust domains', authorities: 'Authorities', profiles: 'Profiles', requests: 'Requests', operations: 'Operations', risks: 'Reuse risks' },
    trustDomains: { recordsTitle: 'Trust domain records', columns: { name: 'Name', purpose: 'Purpose', isolationLevel: 'Isolation level', status: 'Status', default: 'Default', createdAt: 'Created at' }, empty: 'No CA trust domains yet.', modalTitle: 'Add CA trust domain', modalDescription: 'Enter the trust domain basics. The unique code is generated automatically.', generatedCodeHint: 'The unique code is generated automatically and does not need to be entered manually.', notDefault: 'Not default' },
    requests: { recordsTitle: 'Certificate request records', columns: { commonName: 'Common name', applicationAssetId: 'Managed application ID', updatedAt: 'Updated at', actions: 'Actions' }, empty: 'No certificate requests.', modalTitle: 'New certificate request', modalDescription: 'Fill in the certificate request details. It will enter the approval and issuance flow after submission.' },
    profiles: { recordsTitle: 'Certificate profile records', columns: { securityDomain: 'Security domain', versionCount: 'Version count' }, empty: 'No certificate profiles.', modalTitle: 'New certificate profile', modalDescription: 'Define certificate issuance rules and constraints, including validity period, DNS suffixes, and approval requirements.' },
    topology: { rootOnly: 'Root CA only', rootOnlyDescription: 'The root CA performs daily issuance and remains online.', rootOnlyRisk: 'High risk: root key compromise affects the entire trust domain.', intermediate: 'Root CA + intermediate CA', intermediateDescription: 'Keep the root offline and use an intermediate CA for daily issuance.', recommended: 'Recommended: isolate the root key and reduce the issuance blast radius.' },
    sections: { trustDomain: 'Create CA trust domain', issuingBackends: 'Issuing backends and connections', authorityWizard: 'CA creation wizard', authorityOverview: 'Certificate authority hierarchy', authorityOverviewDescription: 'Each card represents one root trust anchor. Select a card to inspect its issuing hierarchy.', caArchitecture: 'CA hierarchy', riskSummary: 'Security decision summary', profile: 'Create certificate profile', request: 'Create managed application certificate request', revocation: 'Create revocation task', trust: 'Create trust-store distribution', remediation: 'Remediation preview' },
    fields: { name: 'Name', code: 'Code', purpose: 'Purpose', isolationLevel: 'Isolation level', defaultTrustDomain: 'Set as default trust domain', trustDomain: 'CA trust domain', parentAuthority: 'Parent root CA', authorityType: 'Authority type', deploymentMode: 'Deployment mode', platform: 'Runtime platform', backendName: 'Issuing backend name', availabilityMode: 'Availability mode', endpoint: 'Service endpoint', authMode: 'Authentication mode', profile: 'Issuance profile', template: 'Certificate template', crlUrl: 'CRL URL', ocspUrl: 'OCSP URL', issuingBackend: 'Issuing backend', entryMode: 'Creation mode', commonName: 'Common name', certificateSubjectCommonName: 'Certificate subject common name', securityDomain: 'Security domain', topology: 'CA topology', dnsSuffixes: 'Allowed DNS suffixes', validityDays: 'Maximum validity days', renewalDays: 'Renewal window days', requireApproval: 'Require approval before issuance', applicationAssetId: 'Managed application ID', authority: 'Certificate authority', profileVersionId: 'Profile version ID', sans: 'SAN list', custodyMode: 'Key custody mode', certificateVersionId: 'Certificate version ID', reason: 'Revocation reason', targetIds: 'Target ID list' },
    actions: { refresh: 'Refresh', addTrustDomain: 'Add trust domain', addAuthority: 'Add CA', addIntermediate: 'Add intermediate CA', previous: 'Previous', next: 'Next', createTrustDomain: 'Create trust domain', previewRisk: 'Preview risk', createAuthority: 'Create CA', createProfile: 'Create profile', createRequest: 'Submit request', approve: 'Approve', retry: 'Retry', queryResult: 'Query result', scanRenewals: 'Scan renewals', createRevocation: 'Create revocation', createTrust: 'Create trust-store distribution', previewRemediation: 'Preview remediation' },
    placeholders: { dnsSuffixes: 'example.com, office.example.com', sans: 'oa.example.com, 10.0.0.10' },
    messages: { loadFailed: 'Failed to load internal CA data.', actionFailed: 'The operation failed. Check input, permissions, and approval status.', noIntermediate: 'This root CA has no intermediate authority yet.', noRootAuthority: 'No root CA configured', noRootAuthorityDescription: 'Add a root CA to establish the first independent trust hierarchy.', trustDomainCreated: 'CA trust domain created.', authorityCreated: 'Certificate authority created.', profileCreated: 'Certificate profile created.', requestCreated: 'Certificate request submitted.', requestApproved: 'Certificate request approved.', requestRetried: 'Certificate issuance retried.', requestQueried: 'Remote issuance result refreshed.', renewalScanned: 'Renewal scan completed.', revocationCreated: 'Revocation task created and awaiting approval.', revocationApproved: 'Certificate revocation approved.', trustCreated: 'Trust-store distribution created and awaiting approval.', trustApproved: 'Trust-store distribution approved.' },
    metrics: { nodes: 'CA nodes', renewals: 'Renewals', revocations: 'Revocations', trust: 'Trust-store distributions', totalRisks: 'Total risks', critical: 'Critical risks', affectedAssets: 'Affected managed applications' },
    labels: { rootAuthority: 'Root certificate authority', intermediateAuthority: 'Intermediate certificate authority', intermediateCount: '{count} intermediate authorities', expiresAt: 'Expires {time}', defaultTrustDomain: 'Default trust domain', independentTrustDomain: 'Independent root trust boundary', trustDomainCount: '{count} CA trust domains', versionCount: '{count} versions', assetCount: '{count} managed applications', requestCount: '{count} independent certificate requests will be created', backendUsageCount: 'Used by {count} certificate authorities', unverifiedCapabilityCount: '{count} capabilities are not verified' },
    backendTypes: { builtin: 'Built-in backend', acme: 'Public ACME CA', external: 'External backend' },
    backendSummary: { createAndIssue: 'Can create and issue certificates', requestPublicCertificates: 'Can request public certificates', external: 'Requires an external integration', localVerified: 'Local verification passed', remoteVerified: 'Connection verification passed', unverified: 'Not verified' },
    adcs: { actions: { add: 'Add AD CS agent', edit: 'Edit', delete: 'Delete' }, modal: { addTitle: 'Add Microsoft AD CS agent', editTitle: 'Edit Microsoft AD CS agent', description: 'Maintain the Windows agent connection used to generate AD CS certificate operation plans.' }, fields: { name: 'Instance name', agentKey: 'Agent key', caConfig: 'AD CS CA configuration', templateId: 'Certificate template', endpoint: 'AD CS endpoint', secretRef: 'Credential SecretRef', commonName: 'CA display name', securityDomain: 'Security domain', trustDomain: 'Trust domain' }, install: { title: 'Install Windows AD CS agent', description: 'Generate a one-time PowerShell command, run it on the target Windows server, then associate the registered agent.', displayName: 'GCAC AD CS agent - {name}', generate: 'Generate install command', regenerate: 'Regenerate command', copy: 'Copy command', notGenerated: 'No install command has been generated.', expiresAt: 'Command expires at {time}', associated: 'Associated agent: {agentId}', waitingAssociation: 'The agent is not associated yet.', associate: 'Detect and associate' }, placeholders: { caConfig: 'CA-SERVER\\IssuingCA', endpoint: 'https://ca-server.example.com', secretRef: 'secret://...' }, options: { createTrustDomain: 'Create a new trust domain automatically' }, defaultTrustDomainName: '{name} trust domain', messages: { created: 'Microsoft AD CS agent added and linked to CA management.', updated: 'Microsoft AD CS agent updated.', deleted: 'Microsoft AD CS agent deleted.', deleteInUse: 'This agent is linked to a CA and cannot be deleted.', pluginUnavailable: 'The Microsoft AD CS plugin is not enabled. Enable the built-in plugin first.', authorityRegistrationFailed: 'The agent was saved, but its CA registration failed. Complete the CA registration before issuing certificates.', agentPlanHint: 'The control plane generates a fixed agent plan; the Windows agent performs the local AD CS operation and returns the result.', nameRequired: 'Enter an instance name before generating the install command.', installCommandGenerated: 'The Windows agent install command was generated.', installCommandCopied: 'The install command was copied.', copyFailed: 'The browser did not allow copying. Copy the command manually.', installCommandFailed: 'Failed to generate the Windows agent install command.', saveBeforeAssociation: 'Save the AD CS agent first, then detect and associate it.', agentKeyMissing: 'Generate an install command before associating the agent.', agentNotFound: 'No registered agent with this agent key was found. Run the command on the target server first.', agentAssociated: 'The registered Windows agent was associated.', associationFailed: 'Failed to associate the Windows agent.', autoRegistrationFailed: 'A registered AD CS Agent could not be added to issuing backends.' } },
    availability: { single: 'Single node', activeStandby: 'Active/standby', activeActive: 'Active/active' },
    authModes: { managedSecret: 'Managed credential', clientCertificate: 'Client certificate', none: 'No authentication' },
    isolationLevels: { standard: 'Standard isolation', strict: 'Strict isolation', regulated: 'Regulated isolation' },
    custodyModes: { managedSecret: 'Managed secret', localAgent: 'Local agent', deviceLocal: 'Device local', externalKey: 'External key' },
    wizard: { title: 'Add certificate authority', description: 'Choose a built-in or maintained external issuance backend, then configure the CA parameters and security boundary.', stepsAria: 'CA creation steps', entryStep: 'Choose mode', backendStep: 'Configure backend', parentStep: 'Choose parent CA', authorityStep: 'Configure CA', reviewStep: 'Review', completed: 'Completed', inProgress: 'In progress', pending: 'Pending', entryEyebrow: 'Step one', entryTitle: 'Who should perform issuance for this CA?', entryDescription: 'Use the GCAC built-in backend or a registered Windows AD CS agent.', recommended: 'Recommended start', builtinTitle: 'Create CA directly', builtinDescription: 'Use the built-in certificate issuance execution plane in the current GCAC service.', builtinFeature1: 'No additional node deployment', builtinFeature2: 'Fits development and smaller internal environments', externalTitle: 'Connect Microsoft AD CS', externalDescription: 'Register an external AD CS CA through a maintained Windows agent.', externalFeature1: 'Reuse an installed AD CS agent', externalFeature2: 'Keep CA parameters on the specific CA record', externalUnavailable: 'Add and register an AD CS agent in issuing backends first.', backendEyebrow: 'Issuing backend', builtinBackendTitle: 'Use the GCAC built-in backend', builtinBackendDescription: 'The system automatically creates or reuses the tenant built-in execution backend.', externalBackendTitle: 'Use a maintained AD CS agent', externalBackendDescription: 'Select the agent provider that will execute this CA operation locally on Windows.', builtinAutomaticTitle: 'No separate execution backend required', builtinAutomaticDescription: 'GCAC ensures the built-in issuing execution backend exists and binds it when the CA is created.', externalAgentTitle: 'Agent is already maintained', externalAgentDescription: 'This step only selects the registered agent. The CA name defaults from the selected Microsoft CA.', externalTrustDomainHint: 'A trust domain will be generated automatically for this Microsoft CA.', externalTrustDomainAuto: 'Generated automatically', authorityEyebrow: 'Certificate authority', rootConfigurationTitle: 'Configure root CA', rootConfigurationDescription: 'Define the new root trust boundary, identity, and intermediate CA topology.', intermediateConfigurationTitle: 'Configure intermediate CA', intermediateConfigurationDescription: 'Choose the parent root and configure the authority used for daily issuance.', advancedSubjectTitle: 'Advanced certificate subject settings', commonNameHelp: 'Written to the CA certificate subject for certificate-chain identification. This is not a domain name.', builtinSecurityNote: 'The software key is held by GCAC SecretService and is not equivalent to a non-exportable HSM key.', externalSecurityNote: 'The CA private key and issuance operation remain on the Windows AD CS agent.', reviewEyebrow: 'Final review', reviewTitle: 'Review the trust boundary and issuance model', reviewDescription: 'Verify the CA identity, trust domain, issuing backend, and CA-specific parameters before creation.', builtinProviderName: 'GCAC built-in issuing backend', rootTitle: 'Root CA', rootDescription: 'Create a new independent root trust anchor, optionally with an initial intermediate CA.', intermediateTitle: 'Intermediate CA', intermediateDescription: 'Add an issuing authority below an existing root CA without creating another trust anchor.', noWarnings: 'No additional topology warnings were detected.' },
    riskTypes: { certificate_fingerprint_reuse: 'Same certificate reused across managed applications', public_key_reuse: 'Same public key reused across managed applications' },
    common: { unknown: 'Unknown' }, aria: { tabs: 'Internal CA navigation' }
  },
  applicationOnboarding: {
    eyebrow: 'Application onboarding', title: 'Add managed application', description: 'Choose a platform and complete device, site, and certificate setup.', stepsAria: 'Application onboarding steps',
    steps: { platform: 'Platform', device: 'Device', target: 'Site', certificate: 'Certificate', complete: 'Complete' },
    platforms: { customManual: 'Custom manual setup', manualHint: 'Use the traditional manual flow', pluginHint: 'Fixed flow supplied by the platform plugin', capabilityVersion: 'Onboarding capability', compatibility: 'Supported versions', requiredInformation: 'Required information', inReview: 'Capability validation is in progress', searchLabel: 'Search platforms', searchPlaceholder: 'Search by application name, platform version, or onboarding information', pluginCenterPrompt: "Can't find the application you need?", pluginCenterAction: 'Browse the plugin center' },
    device: { title: 'Connect platform', existing: 'Use existing device', new: 'Add device', deviceId: 'Device ID', selectPlaceholder: 'Select a device', noExisting: 'No healthy device is available for this platform.', existingLoading: 'Loading compatible devices.', refreshExisting: 'Refresh devices', newDescription: 'Open the unified device onboarding wizard, then return here after Agent registration or device onboarding.', newAction: 'Open device onboarding', username: 'Username', password: 'Password', host: 'Address', port: 'Port' },
    target: { title: 'Choose site', siteName: 'Site name', selectedSite: 'Selected site', accessDomain: 'Access domain', verifyUrl: 'Verification URL', accessDomainPlaceholder: 'e.g. ikuai.jacksonz.cn', verifyUrlPlaceholder: 'e.g. https://ikuai.jacksonz.cn:443', domainHint: 'The management endpoint may be an IP, but the access domain and verification URL must use the same DNS name.', invalidConfiguration: 'Enter a valid DNS access domain and a verification URL on the same host.', listenAddress: 'Listen address', listenPort: 'Listen port', protocol: 'Protocol', selectable: 'Selectable managed target', notSelectable: 'Not selectable', unavailableReason: 'Why it cannot be selected', missingValue: 'Not provided', reasons: { managedTargetInactive: 'This managed target is inactive.', workflowCapabilityMissing: 'This target does not provide the workflow capability required by this platform.', targetEndpointMissing: 'This target is missing a complete listen address, port, or protocol.', unknown: 'This target does not currently meet the selection requirements.' } }, certificate: { title: 'Choose certificate version', asset: 'Certificate inventory item', version: 'Certificate version', requiredFormat: 'This platform requires a certificate in {formats} format' },
    complete: { title: 'Onboarding complete', description: 'The managed application and deployment plan are ready.' },
    actions: { customManual: 'Manual setup', openWizard: 'Use onboarding wizard', previous: 'Previous', continue: 'Continue', refresh: 'Refresh sites', review: 'Review certificate', complete: 'Complete onboarding', cancel: 'Cancel wizard' },
    messages: { requestFailed: 'Onboarding request failed. Check permissions and input.', noPlatforms: 'No business platforms are available.', noSearchResults: 'No matching platforms found.' }
  },
  tenantArchitecture: {
    nav: 'Group architecture', eyebrow: 'Multi-tenant governance', title: 'Group architecture', description: 'Manage group, subsidiary, and administrator relationships.',
    mode: { aria: 'Group architecture mode', label: 'Group architecture mode', hierarchical: 'Enabled', single: 'Disabled', updated: 'Last updated: {time}' },
    actions: { checking: 'Checking', preflight: 'Run preflight', enabling: 'Enabling', enable: 'Enable group architecture', rollingBack: 'Rolling back', rollback: 'Disable group architecture', suspend: 'Suspend', resume: 'Resume', revokeAdministrator: 'Revoke administrator' },
    preflight: { title: 'Enablement preflight', summary: 'Blockers: {blockers}', passed: { title: 'Satisfied', summary: '{count} checks passed' }, blocked: { title: 'Action required', summary: '{count} blockers', description: 'Resolve the following issues before running preflight again.' } },
    confirm: { enable: 'Enable group architecture?', rollback: 'Disable group architecture and return to single-tenant mode?', revokeAdministrator: 'Revoke this administrator relationship?' },
    messages: { preflightCompleted: 'Preflight completed.', enabled: 'Group architecture enabled.', rolledBack: 'Returned to single-tenant mode.', companyCreated: 'Subsidiary created.', administratorAdded: 'Administrator configured.', administratorRevoked: 'Administrator relationship revoked.', statusUpdated: 'Subsidiary status updated.' },
    errors: { emptyMode: 'Group architecture state was not returned.', loadFailed: 'Failed to load group architecture.', preflightFailed: 'Preflight failed.', enableFailed: 'Failed to enable group architecture.', rollbackFailed: 'Failed to roll back group architecture.', companyCreateFailed: 'Failed to create subsidiary.', administratorFailed: 'Failed to configure administrator.', administratorRevokeFailed: 'Failed to revoke administrator.', statusFailed: 'Failed to update subsidiary status.' },
    company: { title: 'Add subsidiary', name: 'Name', namePlaceholder: 'Enter subsidiary name', code: 'Code', codePlaceholder: 'Enter unique code', submit: 'Create subsidiary' },
    administrator: { title: 'Configure subsidiary administrator', tenant: 'Subsidiary', tenantPlaceholder: 'Select subsidiary', subjectId: 'User ID', subjectPlaceholder: 'Enter user ID', submit: 'Add administrator', empty: 'No administrator configured' },
    tree: { aria: 'Group architecture diagram', empty: 'No tenant is visible in the current management scope.' },
    history: { aria: 'Recent mode records', title: 'Recent mode records', kind: { PREFLIGHT: 'Preflight', ENABLE: 'Enable', ROLLBACK: 'Rollback' }, status: { RUNNING: 'Running', COMPLETED: 'Completed', FAILED: 'Failed' } },
    types: { GROUP: 'Group', COMPANY: 'Subsidiary' }, status: { ACTIVE: 'Active', SUSPENDED: 'Suspended' }, membership: { owner: 'Owner', admin: 'Administrator' }
  },
  tenantSwitcher: { title: 'Switch tenant', aria: 'Switchable tenants', current: 'Current', switching: 'Switching', confirm: 'Switch to {tenant}?', success: 'Switched to {tenant}.', errors: { contextStale: 'Tenant context has expired. Available tenants were refreshed; select the target again.', membershipRequired: 'The current user no longer has an active membership in the target tenant.', modeConflict: 'Tenant mode is changing. Switching is temporarily unavailable.', switchFailed: 'Tenant switch failed. The original tenant remains active.' } },
  errors: {
    forbiddenTitle: '403 Forbidden',
    forbiddenMessage: 'You do not have permission to access this page.',
    missingPermission: 'Missing permission: {permission}',
    notFoundTitle: '404 Not Found',
    notFoundMessage: 'This route is not registered.',
    backDashboard: 'Back to dashboard',
    back: 'Back',
    logout: 'Sign out'
  }
} as const
