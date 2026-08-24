import { App } from './common/http/app.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import type { RouteContract } from './common/openapi/route-contract.js';
import { generateOpenApiDocument } from './common/openapi/openapi-generator.js';
import type { DatabasePort } from './database/database-port.js';
import { PgliteDatabase } from './database/pglite-database.js';
import { getHealthRouteContracts, HealthController } from './modules/health/controller/health.controller.js';
import { DeploymentPlansApplicationService } from './modules/deployment-plans/application/deployment-plans.application-service.js';
import { DeploymentPlansController, getDeploymentPlanRouteContracts } from './modules/deployment-plans/controller/deployment-plans.controller.js';
import { DeploymentInputProjectionController, getDeploymentInputRouteContracts } from './modules/deployment-inputs/controller/deployment-input-projection.controller.js';
import { ExecutionsApplicationService } from './modules/executions/application/executions.application-service.js';
import { ExecutionDetailStreamService } from './modules/executions/application/execution-detail-stream.service.js';
import { ExecutionResultSyncService } from './modules/executions/application/execution-result-sync.service.js';
import { createDefaultExecutorRegistryWithDependencies } from './modules/executions/application/executors.js';
import { DeploymentInputSnapshotsRepository } from './modules/deployment-inputs/repository/deployment-input-snapshots.repository.js';
import { WorkflowRecoveryLedgerService } from './modules/executions/application/workflow-recovery-ledger.service.js';
import { PluginResourceLockService } from './modules/executions/application/plugin-resource-lock.service.js';
import { ExecutionsController, getExecutionRouteContracts } from './modules/executions/controller/executions.controller.js';
import { createSecurityServices, getSecurityRouteContracts, SecurityController, type SecurityServices } from './modules/security/security.controller.js';
import { CredentialsApplicationService, CredentialsController, CredentialsRepository } from './modules/credentials/index.js';
import { createPersistedSecurityServices } from './modules/security/security-services.persistence.js';
import { AssetsApplicationService } from './modules/assets/application/assets.application-service.js';
import { ApplicationAssetExecutionService } from './modules/assets/application/application-asset-execution.service.js';
import { AssetsController, getAssetsRouteContracts } from './modules/assets/controller/assets.controller.js';
import { PgAssetsRepository } from './modules/assets/repository/assets.repository.js';
import { DeviceAssetsApplicationService, DeviceAssetsController, getDeviceAssetRouteContracts, PgDeviceAssetsRepository, SecurityServicesDeviceAssetPort } from './modules/device-assets/index.js';
import { DevicesApplicationService, DevicesController, getDeviceRouteContracts, PgDevicesRepository } from './modules/devices/index.js';
import { BindingsApplicationService } from './modules/bindings/application/bindings.application-service.js';
import { BindingsController, getBindingsRouteContracts } from './modules/bindings/controller/bindings.controller.js';
import { PgBindingsRepository } from './modules/bindings/repository/bindings.repository.js';
import { CertificatesController, createCertificateServices, getCertificateRouteContracts, type CertificateServices } from './modules/certificates/index.js';
import {
  AcmeAccountService,
  AcmeCertificateService,
  AcmeChallengeService,
  AcmeOrderService,
  AcmeProviderAdapter,
  AcmeRenewalPolicyService,
  AcmeRenewalScheduler,
  AcmeRenewalWorker,
  AcmeRepository,
  CaAutoSyncScheduler,
  CaOperationsRepository,
  CaSyncWorker,
  getInternalCaRouteContracts,
  InternalCaApplicationService,
  InternalCaController,
} from './modules/internal-ca/index.js';
import { AuditPresentationService } from './modules/audits/audit-presentation.service.js';
import { CapabilitiesApplicationService, CapabilitiesController, getCapabilitiesRouteContracts, PgCapabilitiesRepository } from './modules/capabilities/index.js';
import { CompatibilityCatalogController, getCompatibilityCatalogRouteContracts } from './modules/compatibility-catalog/index.js';
import { MonitorsApplicationService, MonitorsController, getMonitorRouteContracts } from './modules/monitors/index.js';
import { PgMonitorsRepository } from './modules/monitors/repository/monitors.repository.js';
import {
  ChannelAdapterRegistry,
  EmailNotificationAdapter,
  FeishuNotificationAdapter,
  getNotificationRouteContracts,
  NotificationWorker,
  NotificationsApplicationService,
  NotificationsController,
  PgNotificationsRepository,
  ServiceNotificationSecretResolver,
  DingTalkNotificationAdapter,
  SlackNotificationAdapter,
  TelegramNotificationAdapter,
  WeComNotificationAdapter,
  WebhookNotificationAdapter,
} from './modules/notifications/index.js';
import { DashboardApplicationService, DashboardController, getDashboardRouteContracts } from './modules/dashboard/index.js';
import { getReportRouteContracts, PgReportDataPort, ReportExportService, ReportScopeResolver, ReportsApplicationService, ReportsController, ReportsRepository } from './modules/reports/index.js';
import { AgentsApplicationService, AgentsController, getAgentsRouteContracts } from './modules/agents/index.js';
import { PgAgentsRepository } from './modules/agents/repository/agents.repository.js';
import { createGatewayPersistenceRepositories, GatewaysApplicationService, GatewaysController, getGatewayRouteContracts, type GatewayPersistenceOptions } from './modules/gateways/index.js';
import { GatewayTaskAuditWriter, GatewayTaskService } from './modules/gateway-agents/index.js';
import { PluginPromotionService, PluginsController, getPluginsRouteContracts } from './modules/plugins/index.js';
import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { PluginWorkflowBindingsRepository } from './modules/plugins/repository/plugin-workflow-bindings.repository.js';
import { BuiltinPluginCompatibilityUpgradeService } from './modules/plugins/application/builtin-plugin-compatibility-upgrade.service.js';
import { UnifiedAgentPlanCompilerService } from './modules/plugins/application/unified-agent-plan-compiler.service.js';
import { PgUnifiedPluginsRepository } from './modules/plugins/repository/unified-plugins.repository.js';
import { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import { PluginBindingsApplicationService } from './modules/plugins/application/plugin-bindings.application-service.js';
import { ManagedTargetPluginQueryService } from './modules/plugins/application/managed-target-plugin-query.service.js';
import { PluginBindingsRepository } from './modules/plugins/repository/plugin-bindings.repository.js';
import { StandardDeviceDiscoveryProjector } from './modules/plugins/discovery/standard-device-discovery.projector.js';
import { AgentCapabilityDiscoveryProjector } from './modules/agents/discovery/agent-capability-discovery.projector.js';
import { ManagedTargetContextResolver } from './modules/assets/application/managed-target-context.resolver.js';
import { LivenessApplicationService } from './modules/liveness/index.js';
import { PluginCertificateResultService } from './modules/plugins/results/plugin-certificate-result.service.js';
import { createWorkflowStepDispatcher } from './modules/workflow-templates/application/workflow-step-dispatcher.js';
import { PluginWorkflowSourceService, WorkflowExecutionBindingsRepository, WorkflowExecutionBindingsService, WorkflowTemplatesController, WorkflowTemplatesApplicationService, WorkflowTemplatesDomainService, getWorkflowTemplateRouteContracts } from './modules/workflow-templates/index.js';
import {
  buildCorePersistenceErrorMessage,
  collectMissingCorePersistence,
  type CorePersistenceProfile,
} from './persistence/core-persistence.js';
import { PgDocumentRepository } from './persistence/repositories/pg-document-repository.js';
import { createDeploymentPersistenceRepositories, type DeploymentPersistenceOptions } from './persistence/repositories/deployment-persistence-factory.js';
import { AutomationsApplicationService, AutomationConfiguredActionExecutor, AutomationDeploymentActionService, AutomationNotificationActionService, AutomationRunCoordinator, AutomationScheduler, AutomationTargetSelector, AutomationsController, AutomationsRepository, DeploymentPlansAutomationAdapter, FakeNotificationPort, getAutomationRouteContracts } from './modules/automations/index.js';
import { getEditionLicensingRouteContracts, registerEditionLicensing } from './edition/licensing.js';
import { PostgresHttp01Responder } from './modules/internal-ca/challenges/postgres-http-01.responder.js';
import { Http01ChallengeAdapter } from './modules/internal-ca/challenges/http-01.adapter.js';
import { LegoDnsIssuer } from './modules/internal-ca/providers/lego-dns-issuer.js';
import { BrowserRuntimeClient } from './modules/browser-runtime/browser-runtime.client.js';
import { BrowserCredentialSessionRepository } from './modules/browser-runtime/browser-credential-session.repository.js';
import { BrowserCredentialSessionService } from './modules/browser-runtime/browser-credential-session.service.js';
import { BrowserCredentialSessionController } from './modules/browser-runtime/browser-credential-session.controller.js';
import {
  resolveDeploymentArchitecture,
  type DeploymentArchitecture,
} from './config/deployment-architecture.js';
import { HealthApplicationService } from './modules/health/application/health.application-service.js';
import {
  createTaskExecutorRegistry,
  getTaskRouteContracts,
  TaskRepository,
  TaskRealtimeStreamService,
  TaskWorkerSupervisor,
  TasksApplicationService,
  TasksController,
} from './modules/tasks/index.js';
import {
  CloudAccountAssetsApplicationService,
  CloudProviderDiscoveryApplicationService,
  ProviderOperationLedgerService,
  ProviderCatalogApplicationService,
  ProvidersController,
  getProvidersRouteContracts,
} from './modules/providers/index.js';
import { SecretProviderCertificateMaterialResolver } from './modules/providers/runtime/provider-runtime.js';
import { TrustedJsPluginExecutionService } from './modules/plugins/runtime/trusted-js-plugin-execution.service.js';

export interface AppDependencies {
  db?: DatabasePort;
  corePersistence?: CorePersistenceProfile;
  /**
   * 仅供旧测试入口显式开启；生产 HTTP Server 不启用请求头身份兼容。
   */
  allowLegacyHeaderContext?: boolean;
  security?: SecurityServices;
  deploymentPlans?: DeploymentPlansController;
  deploymentPersistence?: DeploymentPersistenceOptions;
  gatewayPersistence?: GatewayPersistenceOptions;
  assets?: AssetsApplicationService;
  bindings?: BindingsApplicationService;
  certificates?: CertificateServices;
  deploymentArchitecture?: DeploymentArchitecture;
}

export function createApp(dependencies: AppDependencies = {}): App {
  const deploymentArchitecture = dependencies.deploymentArchitecture ?? resolveDeploymentArchitecture();
  const corePersistence = dependencies.corePersistence ?? { mode: 'postgres' as const, strict: true };
  const missingPersistence = collectMissingCorePersistence(corePersistence, []);
  if (corePersistence.strict === true && missingPersistence.length > 0) {
    throw new Error(buildCorePersistenceErrorMessage(missingPersistence));
  }

  const app = new App({ allowLegacyHeaderContext: dependencies.allowLegacyHeaderContext });
  const appDb = dependencies.db ?? new PgliteDatabase();
  app.setResource('database', appDb);
  app.setResource('deploymentArchitecture', deploymentArchitecture);
  const security = dependencies.security ?? createPersistedSecurityServices(appDb).services;
  app.setResource('securityServices', security);
  const taskRealtimeStream = new TaskRealtimeStreamService();
  const tasksService = new TasksApplicationService(new TaskRepository(appDb), security.audit, undefined, taskRealtimeStream);
  void tasksService.initialize().catch((error: unknown) => {
    structuredLogger.warn('统一任务控制面初始化失败，等待数据库迁移后重试', {
      error: error instanceof Error ? error.message : String(error),
    }, { module: 'task-control-plane' });
  });
  app.setResource('tasksService', tasksService);
  app.setResource('taskRealtimeStream', taskRealtimeStream);
  const credentialsService = new CredentialsApplicationService(
    new CredentialsRepository(appDb),
    undefined,
    appDb,
    security.secrets,
  );
  registerEditionLicensing(app, appDb, security.audit);
  const gatewayPersistence = createGatewayPersistenceRepositories({
    ...(dependencies.gatewayPersistence ?? {}),
    db: appDb,
  });
  const certificateServices = dependencies.certificates ?? createCertificateServices(security, { db: appDb });
  const internalCaService = new InternalCaApplicationService({
    db: appDb,
    secrets: security.secrets,
    certificates: certificateServices.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  const acmeRepository = new AcmeRepository(appDb);
  const acmeProvider = new AcmeProviderAdapter(security.secrets);
  const http01Responder = new PostgresHttp01Responder(appDb);
  app.router.get('/.well-known/acme-challenge/:token', '返回 ACME HTTP-01 Challenge', ['ACME'], async (request) => {
    const token = request.path.split('/').filter(Boolean).at(-1) ?? '';
    const keyAuthorization = await http01Responder.read(token);
    return keyAuthorization
      ? { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: keyAuthorization }
      : { statusCode: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: 'Not Found' };
  });
  const acmeAccountService = new AcmeAccountService(
    acmeRepository,
    internalCaService.getRepository(),
    acmeProvider,
    security.secrets,
  );
  const acmeOrderService = new AcmeOrderService(
    acmeRepository,
    internalCaService.getRepository(),
    acmeProvider,
  );
  const acmeChallengeService = new AcmeChallengeService({
    repository: acmeRepository,
    caRepository: internalCaService.getRepository(),
    provider: acmeProvider,
    adapters: {
      'http-01': new Http01ChallengeAdapter(http01Responder),
    },
  });
  const legoTimeoutMs = positiveInteger(process.env.GCAC_LEGO_TIMEOUT_MS, 600_000);
  const acmeRenewalLeaseMs = Math.max(
    positiveInteger(process.env.ACME_RENEWAL_JOB_LEASE_MS, 900_000),
    legoTimeoutMs + 60_000,
  );
  const legoDnsIssuer = new LegoDnsIssuer({
    credentials: credentialsService,
    secrets: security.secrets,
    timeoutMs: legoTimeoutMs,
  });
  const acmeRenewalPolicyService = new AcmeRenewalPolicyService(
    acmeRepository,
    internalCaService.getRepository(),
  );
  const gatewaysService = new GatewaysApplicationService(gatewayPersistence.gateways, gatewayPersistence.targetHistory);
  const gatewayTaskAuditWriter = new GatewayTaskAuditWriter({ audit: security.audit, history: gatewaysService.getTargetHistoryRepository() });
  const gatewayTasksService = new GatewayTaskService({ auditWriter: gatewayTaskAuditWriter });
  const livenessService = new LivenessApplicationService(appDb, gatewayTasksService);
  const assetsService = dependencies.assets ?? new AssetsApplicationService(new PgAssetsRepository(appDb));
  const deviceAssetsRepository = new PgDeviceAssetsRepository(appDb);
  const deviceAssetsService = new DeviceAssetsApplicationService(deviceAssetsRepository);
  const bindingsService = dependencies.bindings ?? new BindingsApplicationService(
    assetsService.getRepository(),
    new PgBindingsRepository(assetsService.getRepository(), appDb),
    undefined,
    assetsService,
  );
  const acmeRenewalScheduler = new AcmeRenewalScheduler(
    acmeRepository,
    certificateServices.certificates.getRepository(),
    bindingsService.getRepository(),
    internalCaService,
    tasksService,
  );
  const pluginCertificateResultService = new PluginCertificateResultService(appDb);
  const executionPersistence = createDeploymentPersistenceRepositories({
    ...(dependencies.deploymentPersistence ?? {}),
    db: appDb,
  });
  const executionDetailStream = new ExecutionDetailStreamService();
  const unifiedPluginsService = new UnifiedPluginsApplicationService(
    new PgUnifiedPluginsRepository(appDb),
    undefined,
    undefined,
    new PluginWorkflowBindingsRepository(appDb),
  );
  let cloudAccountAssetsService!: CloudAccountAssetsApplicationService;
  const trustedJsProviderRuntime = new TrustedJsPluginExecutionService({
    db: appDb,
    unifiedPlugins: unifiedPluginsService,
    cloudAccounts: {
      get: async (tenantId: string, id: string) => cloudAccountAssetsService.get(tenantId, id),
    },
    credentials: new CredentialsRepository(appDb),
    secrets: security.secrets,
    audit: security.audit,
  });
  const providerCatalogService = new ProviderCatalogApplicationService(trustedJsProviderRuntime);
  cloudAccountAssetsService = new CloudAccountAssetsApplicationService(appDb, providerCatalogService);
  const cloudProviderDiscoveryService = new CloudProviderDiscoveryApplicationService(appDb, providerCatalogService);
  const providerOperationLedgerService = new ProviderOperationLedgerService(
    appDb,
    providerCatalogService,
    new SecretProviderCertificateMaterialResolver(security.secrets),
  );
  new ProvidersController(
    providerCatalogService,
    cloudAccountAssetsService,
    cloudProviderDiscoveryService,
    providerOperationLedgerService,
    tasksService,
    security,
  ).register(app.router);
  app.setResource('providerCatalogService', providerCatalogService);
  app.setResource('cloudAccountAssetsService', cloudAccountAssetsService);
  app.setResource('cloudProviderDiscoveryService', cloudProviderDiscoveryService);
  app.setResource('providerOperationLedgerService', providerOperationLedgerService);
  app.setResource('trustedJsProviderRuntime', trustedJsProviderRuntime);
  const standardDeviceDiscoveryProjector = new StandardDeviceDiscoveryProjector(appDb);
  const agentCapabilityDiscoveryProjector = new AgentCapabilityDiscoveryProjector(appDb, standardDeviceDiscoveryProjector, unifiedPluginsService);
  const executionResultSync = new ExecutionResultSyncService(
    executionPersistence.executions,
    assetsService,
    bindingsService,
    executionPersistence.deploymentPlans,
    executionDetailStream,
    pluginCertificateResultService,
  );
  const agentsService = new AgentsApplicationService(
    new PgAgentsRepository(appDb),
    undefined,
    gatewaysService.getRepository(),
    certificateServices.certificates,
    security.secrets,
    executionResultSync,
    executionDetailStream,
    livenessService,
    agentCapabilityDiscoveryProjector,
    tasksService,
  );
  const capabilitiesService = new CapabilitiesApplicationService(new PgCapabilitiesRepository(appDb));
  const workflowTemplatesService = new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(
      new PgDocumentRepository(appDb, 'workflow.templates'),
      new PgDocumentRepository(appDb, 'workflow.template_versions'),
    ),
    {
      stepDispatcher: createWorkflowStepDispatcher({ secrets: security.secrets }),
    },
    new PluginWorkflowBindingsRepository(appDb),
  );
  const browserRuntimeClient = deploymentArchitecture === 'standard'
    ? new BrowserRuntimeClient()
    : undefined;
  const browserCredentialSessionService = browserRuntimeClient
    ? new BrowserCredentialSessionService(
        new BrowserCredentialSessionRepository(appDb),
        browserRuntimeClient,
        credentialsService,
        unifiedPluginsService,
        new PluginWorkflowBindingsRepository(appDb),
        workflowTemplatesService,
        assetsService,
      )
    : undefined;
  const pluginBindingsService = new PluginBindingsApplicationService(new PluginBindingsRepository(appDb));
  const pluginWorkflowPublisher = new PluginWorkflowPublisherService(workflowTemplatesService, new PluginWorkflowBindingsRepository(appDb));
  const devicesService = new DevicesApplicationService(
    new PgDevicesRepository(appDb),
    undefined,
    agentsService,
    appDb,
    unifiedPluginsService,
    undefined,
    pluginBindingsService,
    pluginWorkflowPublisher,
    workflowTemplatesService,
    undefined,
    standardDeviceDiscoveryProjector,
  );
  const agentPlanCompiler = new UnifiedAgentPlanCompilerService(unifiedPluginsService);
  app.setResource('agentsService', agentsService);
  app.setResource('livenessService', livenessService);
  app.setResource('unifiedPluginsService', unifiedPluginsService);
  app.setResource('workflowTemplatesService', workflowTemplatesService);
  if (browserRuntimeClient && browserCredentialSessionService) {
    app.setResource('browserRuntimeClient', browserRuntimeClient);
    app.setResource('browserCredentialSessionService', browserCredentialSessionService);
  }
  app.setResource('pluginWorkflowPublisher', pluginWorkflowPublisher);
  app.setResource('certificateServices', certificateServices);
  app.setResource('internalCaService', internalCaService);
  app.setResource('caSyncWorker', new CaSyncWorker(
    new CaOperationsRepository(appDb),
    internalCaService,
    `ca-sync-worker-${process.pid}`,
    ({ run, error }) => {
      structuredLogger.warn('CA sync run failed', {
        error: error instanceof Error ? error.message : String(error),
        status: run.status,
      }, {
        module: 'ca-sync-worker',
        tenantId: run.tenantId,
        resourceType: 'caSyncRun',
        resourceId: run.id,
      });
    },
  ));
  app.setResource('caAutoSyncScheduler', new CaAutoSyncScheduler(
    new CaOperationsRepository(appDb),
    internalCaService,
    ({ target, error }) => {
      structuredLogger.warn('CA automatic sync scheduling failed', {
        error: error instanceof Error ? error.message : String(error),
        objectType: target.objectType,
      }, {
        module: 'ca-auto-sync-scheduler',
        tenantId: target.tenantId,
        resourceType: 'certificateAuthority',
        resourceId: target.caId,
      });
    },
    tasksService,
  ));

  app.setAuthTokenResolver((authorization, cookie) => security.auth.parseRequestIdentity(authorization, cookie));
  app.setAgentTokenResolver((token, request) => agentsService.parseAgentRequestIdentity(token, request));
  new HealthController(new HealthApplicationService(deploymentArchitecture)).register(app.router);

  assetsService.setAgentsService(agentsService);
  assetsService.setBindingsRepository(bindingsService.getRepository());
  assetsService.setWorkflowTemplatesService(workflowTemplatesService);
  assetsService.setPluginBindingsService(pluginBindingsService);
  assetsService.setManagedTargetContextResolver(new ManagedTargetContextResolver(
    assetsService.getRepository(),
    agentsService.getRepository(),
    deviceAssetsRepository,
  ));
  const workflowRecoveryService = new WorkflowRecoveryLedgerService(appDb);
  const pluginResourceLockService = new PluginResourceLockService(appDb);
  const executorRegistry = createDefaultExecutorRegistryWithDependencies({
    agents: agentsService,
    gatewayTasks: gatewayTasksService,
    gatewayTaskAuditWriter,
    secrets: security.secrets,
    workflows: workflowTemplatesService,
    agentPlanCompiler,
    workflowRecovery: workflowRecoveryService,
    pluginResourceLocks: pluginResourceLockService,
    executionGrants: security.grants,
    trustedJsProviderRuntime,
  });

  const deploymentPersistence = dependencies.deploymentPlans
    ? undefined
    : executionPersistence;
  const deploymentInputSnapshots = dependencies.deploymentPlans
    ? undefined
    : new DeploymentInputSnapshotsRepository(appDb);
  const deploymentPlans = dependencies.deploymentPlans ?? new DeploymentPlansController(new DeploymentPlansApplicationService({
    repository: deploymentPersistence!.deploymentPlans,
    executions: new ExecutionsApplicationService({
      repository: deploymentPersistence!.executions,
      deploymentPlansRepository: deploymentPersistence!.deploymentPlans,
      queueDb: appDb,
      audit: security.audit,
      executorRegistry,
      resultSync: executionResultSync,
      detailStream: executionDetailStream,
      deploymentInputSnapshots,
      tasks: tasksService,
    }),
    approval: security.approvals,
    audit: security.audit,
    gateways: gatewaysService,
    assets: assetsService.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    deviceAssets: deviceAssetsRepository,
    certificates: certificateServices.certificates.getRepository(),
    certificatesApp: certificateServices.certificates,
    workflows: workflowTemplatesService,
    pluginBindings: pluginBindingsService,
    unifiedPlugins: unifiedPluginsService,
    pluginWorkflows: pluginWorkflowPublisher,
    secrets: security.secrets,
    database: appDb,
      deploymentInputSnapshots,
    }), undefined, security);
  deploymentPlans.register(app.router);
  new DeploymentInputProjectionController(deploymentPlans.getApplicationService()).register(app.router);
  new SecurityController(security, new AuditPresentationService({
    deploymentPlans: deploymentPlans.getRepository(),
    assets: assetsService.getRepository(),
    bindings: bindingsService.getRepository(),
    secrets: security.secrets,
    certificates: certificateServices.certificates.getRepository(),
  })).register(app.router);
  new CredentialsController(credentialsService, security).register(app.router);
  if (browserCredentialSessionService) {
    const browserCredentialSessionController = new BrowserCredentialSessionController(browserCredentialSessionService, security);
    browserCredentialSessionController.register(app.router);
    app.setResource('browserCredentialSessionController', browserCredentialSessionController);
  }
  const executionsService = deploymentPlans.getExecutionsService();
  app.setResource('deploymentPlansController', deploymentPlans);
  app.setResource('deploymentPlansService', deploymentPlans.getApplicationService());
  app.setResource('gatewaysService', gatewaysService);
  executionResultSync.setContinuationRunner(({ runId, actorId, tenantId }) =>
    executionsService.runDispatchedExecution(runId, actorId, tenantId, executorRegistry),
  );
  executionResultSync.setRollbackRunner(({ runId, actorId, tenantId }) =>
    executionsService.triggerAutomaticRollback(runId, actorId, tenantId),
  );
  app.setResource('executionsService', executionsService);
  app.setResource('executionResultSync', executionResultSync);
  app.setResource('executionDetailStream', executionDetailStream);
  new ExecutionsController(executionsService, executionDetailStream, workflowRecoveryService, security).register(app.router);

  const acmeRenewalWorker = new AcmeRenewalWorker({
    repository: acmeRepository,
    certificates: certificateServices.certificates.getRepository(),
    internalCa: internalCaService,
    orders: acmeOrderService,
    challenges: acmeChallengeService,
    lego: legoDnsIssuer,
    leaseOwner: `acme-renewal-worker-${process.pid}`,
    leaseDurationMs: acmeRenewalLeaseMs,
  });
  const acmeServices = {
    accounts: acmeAccountService,
    certificates: new AcmeCertificateService(
      certificateServices.certificates,
      internalCaService.getRepository(),
      acmeRepository,
      acmeRenewalPolicyService,
      credentialsService,
      (tenantId, actorId) => internalCaService.ensureBuiltinAcmeProvider(tenantId, actorId),
      acmeAccountService,
      security.secrets,
      internalCaService,
    ),
    orders: acmeOrderService,
    policies: acmeRenewalPolicyService,
    repository: acmeRepository,
    scheduler: acmeRenewalScheduler,
    worker: acmeRenewalWorker,
  };
  app.setResource('acmeRenewalScheduler', acmeRenewalScheduler);
  app.setResource('acmeRenewalWorker', acmeRenewalWorker);
  app.setResource('acmeRepository', acmeRepository);

  const automationsRepository = new AutomationsRepository(appDb);
  const automationTargetSelector = new AutomationTargetSelector(
    certificateServices.certificates.getRepository(),
    bindingsService.getRepository(),
    assetsService.getRepository(),
  );
  const automationsService = new AutomationsApplicationService(automationsRepository, undefined, undefined, automationTargetSelector);
  const automationDeployment = new AutomationDeploymentActionService(new DeploymentPlansAutomationAdapter(deploymentPlans.getApplicationService()));
  const automationNotifications = new AutomationNotificationActionService(new FakeNotificationPort());
  const automationCoordinator = new AutomationRunCoordinator(
    automationsRepository,
    new AutomationConfiguredActionExecutor(automationDeployment, automationNotifications),
  );
  const automationScheduler = new AutomationScheduler(automationsRepository, automationsService, automationCoordinator, undefined, undefined, tasksService);
  app.setResource('automationScheduler', automationScheduler);
  new AssetsController(security, assetsService, new ApplicationAssetExecutionService(appDb)).register(app.router);
  const bindingsController = new BindingsController(assetsService, bindingsService, security);
  bindingsController.register(app.router);

  const notificationsRepository = new PgNotificationsRepository(appDb);
  const notificationAdapters = new ChannelAdapterRegistry()
    .register(new EmailNotificationAdapter())
    .register(new WeComNotificationAdapter())
    .register(new SlackNotificationAdapter())
    .register(new FeishuNotificationAdapter())
    .register(new DingTalkNotificationAdapter())
    .register(new TelegramNotificationAdapter())
    .register(new WebhookNotificationAdapter());
  const notificationWorker = new NotificationWorker(
    notificationsRepository,
    notificationAdapters,
    new ServiceNotificationSecretResolver(security.secrets),
    `notification-worker-${process.pid}`,
  );
  const notificationsService = new NotificationsApplicationService(
    notificationsRepository,
    undefined,
    undefined,
    undefined,
    notificationWorker,
    undefined,
    notificationAdapters,
    tasksService,
  );
  app.setResource('notificationsService', notificationsService);
  app.setResource('notificationWorker', notificationWorker);

  certificateServices.bindings ??= bindingsService;
  const monitorsService = new MonitorsApplicationService({
    repository: new PgMonitorsRepository(appDb),
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsController.getApplicationService().getRepository(),
    executions: deploymentPlans.getExecutionsService().getRepository(),
    assets: assetsService.getRepository(),
    notifications: notificationsService,
    tasks: tasksService,
  });
  executionResultSync.setMonitorsService(monitorsService);
  app.setResource('monitorsService', monitorsService);

  new CertificatesController(security, certificateServices).register(app.router);
  new InternalCaController(internalCaService, security, acmeServices, tasksService).register(app.router);
  new DeviceAssetsController(deviceAssetsService, new SecurityServicesDeviceAssetPort(security)).register(app.router);
  new DevicesController(devicesService, security).register(app.router);
  new CapabilitiesController(capabilitiesService).register(app.router);
  new AgentsController(agentsService, security).register(app.router);
  new GatewaysController(gatewaysService, security).register(app.router);
  new CompatibilityCatalogController().register(app.router);
  const builtinPluginCompatibilityUpgrader = new BuiltinPluginCompatibilityUpgradeService(appDb);
  const builtinPluginRefreshPromises = new Map<string, Promise<{
    refreshedAt: string;
    versions: Array<{ id: string; pluginId: string; version: string; status: string }>;
    projection?: {
      attempted: number;
      projected: number;
      skipped: number;
      failed: Array<{ tenantId: string; agentId: string; error: string }>;
    };
  }>>();
  const builtinCatalogRefresher = {
    refresh: (tenantId?: string) => {
      const refreshKey = tenantId ?? '*';
      const existing = builtinPluginRefreshPromises.get(refreshKey);
      if (existing) return existing;
      const refreshPromise = (async () => {
        const versions = await initializeBuiltinPlugins(
          unifiedPluginsService,
          pluginWorkflowPublisher,
          appDb,
          { compatibilityUpgrader: builtinPluginCompatibilityUpgrader },
        );
        const projection = await agentsService.reprojectLatestCapabilitySnapshots(tenantId);
        return {
          refreshedAt: new Date().toISOString(),
          versions: versions.map((version) => ({
            id: version.id,
            pluginId: version.pluginId,
            version: version.version,
            status: version.status,
          })),
          projection,
        };
      })().finally(() => {
        if (builtinPluginRefreshPromises.get(refreshKey) === refreshPromise) {
          builtinPluginRefreshPromises.delete(refreshKey);
        }
      });
      builtinPluginRefreshPromises.set(refreshKey, refreshPromise);
      return refreshPromise;
    },
  };
  new PluginsController(
    unifiedPluginsService,
    pluginBindingsService,
    new PluginPromotionService(appDb),
    new ManagedTargetPluginQueryService(appDb),
    builtinPluginCompatibilityUpgrader,
    builtinCatalogRefresher,
    tasksService,
  ).register(app.router);
  new WorkflowTemplatesController(
    workflowTemplatesService,
    security,
    new PluginWorkflowSourceService(
      unifiedPluginsService,
      new PluginWorkflowBindingsRepository(appDb),
      workflowTemplatesService,
    ),
    new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(appDb)),
  ).register(app.router);
  new AutomationsController(automationsService, security, automationCoordinator).register(app.router);
  new DashboardController(new DashboardApplicationService({
    assets: assetsService.getRepository(),
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    gateways: gatewaysService.getRepository(),
    audit: security.audit,
    deploymentPlans: deploymentPlans.getRepository(),
  }), security).register(app.router);
  new MonitorsController(monitorsService, security).register(app.router);
  new TasksController(tasksService, security).register(app.router);
  new NotificationsController(notificationsService, security).register(app.router);
  const reportScope = new ReportScopeResolver({
    canRead: async (subject, object) => (await security.objectPermissions.can(subject, 'read', {
      objectType: object.objectType,
      objectId: object.objectId,
      tenantId: object.tenantId,
    })).allowed,
  });
  const reportsRepository = new ReportsRepository(appDb);
  const reportsService = new ReportsApplicationService(new PgReportDataPort(appDb, deploymentPlans.getRepository()), reportsRepository, reportScope);
  const reportExportService = new ReportExportService(reportsService, reportsRepository, undefined, appDb, undefined, tasksService);
  app.setResource('reportsService', reportsService);
  app.setResource('reportExportService', reportExportService);
  new ReportsController(reportsService, security, reportExportService).register(app.router);

  const taskExecutorRegistry = createTaskExecutorRegistry({
    acme: acmeRenewalWorker,
    acmeJobs: acmeRepository,
    executions: executionsService,
    executionRegistry: executorRegistry,
    caSync: app.getResource('caSyncWorker'),
    internalCa: internalCaService,
    automation: automationScheduler,
    automationRuns: automationsService,
    monitors: monitorsService,
    notifications: notificationWorker,
    reports: reportExportService,
    agents: agentsService,
    pluginCatalog: builtinCatalogRefresher,
    cloudAccounts: cloudAccountAssetsService,
    providerOperations: providerOperationLedgerService,
  }, tasksService.registry.list().map((definition) => definition.executorKey));
  const taskWorkerSupervisor = new TaskWorkerSupervisor(
    tasksService,
    taskExecutorRegistry,
    {
      workerId: `task-worker-${process.pid}`,
      maxTasksPerTick: positiveInteger(process.env.GCAC_TASK_WORKER_MAX_TASKS_PER_TICK, 10),
    },
  );
  app.setResource('taskExecutorRegistry', taskExecutorRegistry);
  app.setResource('taskWorkerSupervisor', taskWorkerSupervisor);

  app.router.get('/api/v1/openapi.json', '获取 OpenAPI 契约', ['System'], async () => ({
    statusCode: 200,
    body: generateOpenApiDocument(getRouteContracts(deploymentArchitecture)),
  }));

  return app;
}

export async function initializeBuiltinPlugins(
  unifiedPlugins: UnifiedPluginsApplicationService,
  pluginWorkflowPublisher: PluginWorkflowPublisherService,
  database?: DatabasePort,
  options: {
    loader?: BuiltinUnifiedPluginLoader;
    compatibilityUpgrader?: Pick<BuiltinPluginCompatibilityUpgradeService, 'upgradePatchLine'>;
    logger?: Pick<typeof structuredLogger, 'warn'>;
  } = {},
): Promise<UnifiedPluginVersionRecord[]> {
  const logger = options.logger ?? structuredLogger;
  let installed: Awaited<ReturnType<BuiltinUnifiedPluginLoader['installAll']>>;
  try {
    installed = await (options.loader ?? new BuiltinUnifiedPluginLoader()).installAll(unifiedPlugins);
  } catch (error) {
    warnBuiltinPluginFailure(logger, 'load', undefined, undefined, error);
    return [];
  }

  for (let index = 0; index < installed.length; index += 1) {
    const plugin = installed[index]!;
    try {
      await pluginWorkflowPublisher.publishPlugin(plugin);
    } catch (error) {
      warnBuiltinPluginFailure(logger, 'publishWorkflow', plugin, plugin.id, error);
      try {
        installed[index] = await unifiedPlugins.disableVersion(plugin.id);
      } catch (disableError) {
        warnBuiltinPluginFailure(logger, 'disableAfterPublishWorkflow', plugin, plugin.id, disableError);
      }
    }
  }

  if (!database) return installed;
  const upgrades = options.compatibilityUpgrader ?? new BuiltinPluginCompatibilityUpgradeService(database);
  for (const plugin of installed) {
    try {
      await upgrades.upgradePatchLine(plugin.tenantId, plugin.id, plugin.pluginId, plugin.version);
    } catch (error) {
      warnBuiltinPluginFailure(logger, 'upgradeCompatibility', plugin, plugin.id, error);
    }
  }
  return installed;
}

export async function createAppAsync(
  dependencies: AppDependencies = {},
  options: {
    registerFlushers?: (app: App) => Promise<void>;
  } = {},
): Promise<App> {
  const app = createApp(dependencies);
  if (options.registerFlushers) {
    await options.registerFlushers(app);
  }
  const unifiedPlugins = app.getResource<UnifiedPluginsApplicationService>('unifiedPluginsService');
  const pluginWorkflowPublisher = app.getResource<PluginWorkflowPublisherService>('pluginWorkflowPublisher');
  if (unifiedPlugins && pluginWorkflowPublisher) {
    const database = app.getResource<DatabasePort>('database');
    await initializeBuiltinPlugins(unifiedPlugins, pluginWorkflowPublisher, database);
  }
  return app;
}

function warnBuiltinPluginFailure(
  logger: Pick<typeof structuredLogger, 'warn'>,
  phase: 'load' | 'publishWorkflow' | 'disableAfterPublishWorkflow' | 'upgradeCompatibility',
  plugin: { id: string; pluginId: string; version: string } | undefined,
  resourceId: string | undefined,
  error: unknown,
): void {
  logger.warn('内置插件启动阶段失败，已继续启动后端', {
    phase,
    ...(plugin ? { pluginId: plugin.pluginId, version: plugin.version } : {}),
    errorCode: errorCodeOf(error),
    error: errorMessageOf(error),
  }, {
    module: 'builtin-plugin-startup',
    resourceType: 'pluginVersion',
    ...(resourceId ? { resourceId } : {}),
  });
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'errorCode' in error && typeof error.errorCode === 'string') {
    return error.errorCode;
  }
  return 'UNKNOWN_ERROR';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getRouteContracts(
  deploymentArchitecture: DeploymentArchitecture = resolveDeploymentArchitecture(),
): RouteContract[] {
  const browserCredentialRouteContracts: RouteContract[] = deploymentArchitecture === 'standard'
    ? [
        {
          method: 'POST',
          path: '/api/v1/credentials/browser-sessions',
          operationId: 'createBrowserCredentialSession',
          summary: '创建浏览器临时凭据会话',
          tags: ['BrowserCredentials'],
          requestSchema: {
            type: 'object',
            required: ['pluginVersionId', 'loginUrl', 'sharePassword'],
            properties: {
              assetId: { type: 'string' },
              pluginVersionId: { type: 'string' },
              loginUrl: { type: 'string' },
              ttlSeconds: { type: 'number' },
              sharePassword: { type: 'string', writeOnly: true, 'x-sensitive': true },
            },
          },
          responseSchema: { type: 'object', additionalProperties: true },
        },
        {
          method: 'GET',
          path: '/api/v1/credentials/browser-sessions/:id',
          operationId: 'getBrowserCredentialSession',
          summary: '查询浏览器临时凭据会话',
          tags: ['BrowserCredentials'],
          responseSchema: { type: 'object', additionalProperties: true },
        },
        {
          method: 'GET',
          path: '/api/v1/credentials/browser-sessions/:id/connect',
          operationId: 'connectBrowserCredentialSession',
          summary: '连接浏览器临时 VNC',
          tags: ['BrowserCredentials'],
          responseSchema: { type: 'string' },
        },
        {
          method: 'POST',
          path: '/api/v1/credentials/browser-sessions/:id/connect',
          operationId: 'authorizeBrowserCredentialShare',
          summary: '使用临时密码连接浏览器 VNC',
          tags: ['BrowserCredentials'],
          requestSchema: {
            type: 'object',
            required: ['password'],
            properties: { password: { type: 'string', writeOnly: true, 'x-sensitive': true } },
          },
          responseSchema: { type: 'string' },
        },
        {
          method: 'POST',
          path: '/api/v1/credentials/browser-sessions/:id/acquire',
          operationId: 'acquireBrowserCredentialSession',
          summary: '手动获取浏览器凭据',
          tags: ['BrowserCredentials'],
          responseSchema: { type: 'object', additionalProperties: true },
        },
        {
          method: 'POST',
          path: '/api/v1/credentials/browser-sessions/:id/cancel',
          operationId: 'cancelBrowserCredentialSession',
          summary: '取消浏览器临时凭据会话',
          tags: ['BrowserCredentials'],
          responseSchema: { type: 'object', additionalProperties: true },
        },
      ]
    : [];
  return [
    ...getHealthRouteContracts(),
    ...getSecurityRouteContracts(),
    ...getDeploymentPlanRouteContracts(),
    ...getExecutionRouteContracts(),
    ...getAssetsRouteContracts(),
    ...getProvidersRouteContracts(),
    ...getDeploymentInputRouteContracts(),
    ...getDeviceAssetRouteContracts(),
    ...getDeviceRouteContracts(),
    ...getBindingsRouteContracts(),
    ...getCertificateRouteContracts(),
    ...getInternalCaRouteContracts(),
    ...getCapabilitiesRouteContracts(),
    ...getAgentsRouteContracts(),
    ...getGatewayRouteContracts(),
    ...getCompatibilityCatalogRouteContracts(),
    ...getPluginsRouteContracts(),
    ...getWorkflowTemplateRouteContracts(),
    ...getAutomationRouteContracts(),
    ...getDashboardRouteContracts(),
    ...getMonitorRouteContracts(),
    ...getTaskRouteContracts(),
    ...getNotificationRouteContracts(),
    ...getReportRouteContracts(),
    ...getEditionLicensingRouteContracts(),
    ...browserCredentialRouteContracts,
    {
      method: 'GET',
      path: '/api/v1/openapi.json',
      operationId: 'getOpenApiDocument',
      summary: '获取 OpenAPI 契约',
      tags: ['System'],
      responseSchema: { type: 'object', additionalProperties: true },
    },
  ];
}
