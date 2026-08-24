import { App } from './common/http/app.js';
import { AppError } from './common/errors/app-error.js';
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
import { PgCertificateArtifactStore } from './modules/certificates/artifacts/certificate-artifact-store.js';
import { AuditPresentationService } from './modules/audits/audit-presentation.service.js';
import { CapabilitiesApplicationService, CapabilitiesController, getCapabilitiesRouteContracts, PgCapabilitiesRepository } from './modules/capabilities/index.js';
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
import {
  createProductionPolicyAuthorityServicesV1,
  requireProductionPolicyAuthorityServicesV1,
  type ProductionPolicyAuthorityServicesV1,
} from './modules/agents/security/policy-authority.service.js';
import {
  createProductionPolicyAuthorityProcessClientV1,
  type PolicyAuthorityProcessClientV1,
} from './modules/agents/security/policy-authority-process.js';
import { createGatewayPersistenceRepositories, GatewaysApplicationService, GatewaysController, getGatewayRouteContracts, type GatewayPersistenceOptions } from './modules/gateways/index.js';
import { createDurableGatewayTaskRepositories, GatewayTaskAuditWriter, GatewayTaskService } from './modules/gateway-agents/index.js';
import { PluginPromotionService, PluginsController, getPluginsRouteContracts } from './modules/plugins/index.js';
import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { PluginWorkflowBindingsRepository } from './modules/plugins/repository/plugin-workflow-bindings.repository.js';
import { UnifiedAgentPlanCompilerService } from './modules/plugins/application/unified-agent-plan-compiler.service.js';
import {
  createUnifiedAgentPlanPolicyAuthorityPortV1,
  createUnifiedAgentPlanPolicyAuthorityProcessPortV1,
  type UnifiedAgentPlanAuthorizationDependenciesV1,
  type UnifiedAgentPlanGrantPortV1,
  type UnifiedAgentPlanLocalPolicyPortV1,
} from './modules/plugins/application/unified-agent-plan-authorization.port.js';
import { createProductionAgentLocalPolicyAdapterV1 } from './modules/agents/security/production-agent-local-policy.adapter.js';
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
import type { LicensingApplicationService } from './modules/licensing/application/licensing.application-service.js';
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
import { AutomationsApplicationService, AutomationApprovalOrchestrator, AutomationConfiguredActionExecutor, AutomationDeploymentActionService, AutomationEventDeliveryService, AutomationFilterEvaluator, AutomationNotificationActionService, AutomationRunCoordinator, AutomationScheduler, AutomationTargetResolverRegistry, AutomationTriggerRegistry, AutomationsController, AutomationsRepository, CertificateVersionTargetResolver, DeferredCertificateVersionEventPublisher, DeploymentPlansAutomationAdapter, DeferredNotificationPort, getAutomationRouteContracts, AllowAllAutomationTargetAccess } from './modules/automations/index.js';
import { buildAutomationTaskResourceSummary } from './modules/automations/application/automation-task-progress.js';
import { getEditionLicensingRouteContracts, registerEditionLicensing } from './edition/licensing.js';
import { BrowserRuntimeClient } from './modules/browser-runtime/browser-runtime.client.js';
import { BrowserCredentialSessionRepository } from './modules/browser-runtime/browser-credential-session.repository.js';
import { BrowserCredentialSessionService } from './modules/browser-runtime/browser-credential-session.service.js';
import { BrowserCredentialSessionController } from './modules/browser-runtime/browser-credential-session.controller.js';
import {
  resolveDeploymentArchitecture,
  type DeploymentArchitecture,
} from './config/deployment-architecture.js';
import { HealthApplicationService } from './modules/health/application/health.application-service.js';
import type { HealthRepository } from './modules/health/repository/health.repository.js';
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
  ProvidersController,
  ProviderCatalogApplicationService,
  getCloudAccountRouteContracts,
} from './modules/providers/index.js';
import { resolveProductionPluginRunnerConfig } from './modules/plugins/runner/production-runner-config.js';
import { PluginRunnerSupervisor } from './modules/plugins/runner/index.js';
import type { PluginRunnerExecutionDependencies } from './modules/executions/application/plugin-runner-executor.adapter.js';
import { createPluginRunnerHostApiHandler } from './modules/plugins/runner/plugin-runner-host-api.handler.js';
import { PgPluginRunnerHostApiRequestStore, PluginRunnerHostApiRequestGate } from './modules/plugins/runner/host-api.request-gate.js';
import type { PluginRuntimeAdapterRegistry } from './modules/deployment-plans/application/plugin-runtime-adapter.registry.js';

export interface AppDependencies {
  db?: DatabasePort;
  corePersistence?: CorePersistenceProfile;
  security?: SecurityServices;
  /** 测试或独立安全控制面显式注入的 Policy Authority 资源。 */
  policyAuthority?: ProductionPolicyAuthorityServicesV1;
  /** 仅允许非生产测试显式注入本地策略端口。 */
  localPolicy?: UnifiedAgentPlanLocalPolicyPortV1;
  /** 仅允许非生产测试注入真实签名的 Agent v2 授权资源。生产必须走独立 Policy Authority 装配。 */
  agentPlanAuthorization?: UnifiedAgentPlanAuthorizationDependenciesV1;
  deploymentPlans?: DeploymentPlansController;
  deploymentPersistence?: DeploymentPersistenceOptions;
  gatewayPersistence?: GatewayPersistenceOptions;
  assets?: AssetsApplicationService;
  bindings?: BindingsApplicationService;
  certificates?: CertificateServices;
  deploymentArchitecture?: DeploymentArchitecture;
  pluginRuntimeAdapters?: PluginRuntimeAdapterRegistry;
  /** 测试或受控宿主显式注入 Plugin Runner 执行依赖；生产默认仍从固定环境配置装配。 */
  pluginRunner?: PluginRunnerExecutionDependencies;
}

export function createApp(dependencies: AppDependencies = {}): App {
  const deploymentArchitecture = dependencies.deploymentArchitecture ?? resolveDeploymentArchitecture();
  const corePersistence = dependencies.corePersistence ?? { mode: 'postgres' as const, strict: true };
  const missingPersistence = collectMissingCorePersistence(corePersistence, []);
  if (corePersistence.strict === true && missingPersistence.length > 0) {
    throw new Error(buildCorePersistenceErrorMessage(missingPersistence));
  }

  const app = new App();
  const appDb = dependencies.db ?? new PgliteDatabase();
  app.setResource('database', appDb);
  app.setResource('deploymentArchitecture', deploymentArchitecture);
  const security = dependencies.security ?? createPersistedSecurityServices(appDb).services;
  app.setResource('securityServices', security);
  const policyAuthorityServices = registerPolicyAuthorityServices(app, dependencies.policyAuthority);
  const localPolicy = resolveAgentLocalPolicy(dependencies.localPolicy);
  const taskRealtimeStream = new TaskRealtimeStreamService();
  const tasksService = new TasksApplicationService(new TaskRepository(appDb), security.audit, undefined, taskRealtimeStream);
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
  const certificateVersionEventPublisher = new DeferredCertificateVersionEventPublisher();
  const certificateServices = dependencies.certificates ?? createCertificateServices(security, {
    db: appDb,
    versionEvents: certificateVersionEventPublisher,
  });
  const gatewaysService = new GatewaysApplicationService(gatewayPersistence.gateways, gatewayPersistence.targetHistory);
  const gatewayTaskAuditWriter = new GatewayTaskAuditWriter({ audit: security.audit, history: gatewaysService.getTargetHistoryRepository() });
  const gatewayTasksService = new GatewayTaskService({ auditWriter: gatewayTaskAuditWriter });
  app.setResource('gatewayTasksService', gatewayTasksService);
  const livenessService = new LivenessApplicationService(appDb, gatewayTasksService);
  const assetsService = dependencies.assets ?? new AssetsApplicationService(new PgAssetsRepository(appDb));
  app.setResource('assetsService', assetsService);
  const licensingService = app.getResource<LicensingApplicationService>('licensingService');
  if (licensingService && 'setLicensingService' in assetsService && typeof assetsService.setLicensingService === 'function') {
    assetsService.setLicensingService(licensingService);
  }
  const deviceAssetsRepository = new PgDeviceAssetsRepository(appDb);
  const deviceAssetsService = new DeviceAssetsApplicationService(deviceAssetsRepository);
  const bindingsService = dependencies.bindings ?? new BindingsApplicationService(
    assetsService.getRepository(),
    new PgBindingsRepository(assetsService.getRepository(), appDb),
    undefined,
    assetsService,
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
  const productionPluginRunner = resolveProductionPluginRunnerConfig(process.env);
  const pluginResourceLockService = new PluginResourceLockService(appDb);
  const pluginArtifactStore = new PgCertificateArtifactStore(appDb);
  const workflowRecoveryService = new WorkflowRecoveryLedgerService(appDb);
  const pluginRunnerSupervisor = productionPluginRunner
    ? new PluginRunnerSupervisor({ maxRestarts: 3 })
    : undefined;
  const pluginRunnerHostApiHandler = productionPluginRunner
    ? createPluginRunnerHostApiHandler({
      security,
      artifacts: pluginArtifactStore,
      resourceLocks: pluginResourceLockService,
      workflowRecovery: workflowRecoveryService,
      executionDetails: executionDetailStream,
      executions: executionPersistence.executions,
      requestGate: new PluginRunnerHostApiRequestGate(new PgPluginRunnerHostApiRequestStore(appDb)),
    })
    : undefined;
  const pluginRunnerDependencies: PluginRunnerExecutionDependencies | undefined = dependencies.pluginRunner
    ?? (productionPluginRunner && pluginRunnerSupervisor && pluginRunnerHostApiHandler
      ? { runner: productionPluginRunner, supervisor: pluginRunnerSupervisor, hostApiHandler: pluginRunnerHostApiHandler }
      : undefined);
  const providerCatalogService = new ProviderCatalogApplicationService();
  let cloudAccountAssetsService!: CloudAccountAssetsApplicationService;
  cloudAccountAssetsService = new CloudAccountAssetsApplicationService(appDb, providerCatalogService);
  new ProvidersController(
    cloudAccountAssetsService,
    security,
  ).register(app.router);
  app.setResource('cloudAccountAssetsService', cloudAccountAssetsService);
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
  agentsService.setGatewayTaskResultSink(gatewayTasksService);
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
  const agentPlanCompiler = new UnifiedAgentPlanCompilerService(
    unifiedPluginsService,
    createAgentPlanAuthorizationDependencies(policyAuthorityServices, security, localPolicy)
      ?? resolveInjectedAgentPlanAuthorization(dependencies.agentPlanAuthorization),
  );
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

  app.setAuthTokenResolver((authorization, cookie) => security.auth.parseRequestIdentity(authorization, cookie));
  app.setAgentTokenResolver((token, request) => agentsService.parseAgentRequestIdentity(token, request));
  new HealthController(new HealthApplicationService(deploymentArchitecture, createTaskAwareHealthRepository(tasksService))).register(app.router);

  assetsService.setAgentsService(agentsService);
  assetsService.setBindingsRepository(bindingsService.getRepository());
  assetsService.setWorkflowTemplatesService(workflowTemplatesService);
  assetsService.setPluginBindingsService(pluginBindingsService);
  assetsService.setManagedTargetContextResolver(new ManagedTargetContextResolver(
    assetsService.getRepository(),
    agentsService.getRepository(),
    deviceAssetsRepository,
  ));
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
    pluginRunner: pluginRunnerDependencies,
  });
  if (pluginRunnerSupervisor && pluginRunnerHostApiHandler) {
    app.setResource('pluginRunnerSupervisor', pluginRunnerSupervisor);
    app.setResource('pluginRunnerHostApiHandler', pluginRunnerHostApiHandler);
  }

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
      executionGrants: security.grants,
      tasks: tasksService,
    }),
    approval: security.approvals,
    audit: security.audit,
    gateways: gatewaysService,
    assets: assetsService.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    agentsApp: agentsService,
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
      pluginRuntimeAdapters: dependencies.pluginRuntimeAdapters,
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

  const automationsRepository = new AutomationsRepository(appDb);
  const automationTriggerRegistry = new AutomationTriggerRegistry();
  const automationFilterEvaluator = new AutomationFilterEvaluator();
  const automationResolverRegistry = new AutomationTargetResolverRegistry();
  automationResolverRegistry.register(new CertificateVersionTargetResolver(
    certificateServices.certificates.getRepository(),
    bindingsService.getRepository(),
    assetsService.getRepository(),
    new AllowAllAutomationTargetAccess(),
  ));
  const automationApprovalOrchestrator = new AutomationApprovalOrchestrator(
    security.approvals,
    automationsRepository,
  );
  const automationsService = new AutomationsApplicationService(
    automationsRepository,
    undefined,
    undefined,
    {
      triggerRegistry: automationTriggerRegistry,
      filterEvaluator: automationFilterEvaluator,
      resolverRegistry: automationResolverRegistry,
      approvalOrchestrator: automationApprovalOrchestrator,
      tasks: tasksService,
    },
  );
  const automationEventDelivery = new AutomationEventDeliveryService(
    automationsRepository,
    automationsService,
    automationTriggerRegistry,
    tasksService,
  );
  certificateVersionEventPublisher.setDelegate(automationEventDelivery);
  const automationDeployment = new AutomationDeploymentActionService(new DeploymentPlansAutomationAdapter(deploymentPlans.getApplicationService()));
  const automationNotificationPort = new DeferredNotificationPort();
  const automationNotifications = new AutomationNotificationActionService(automationNotificationPort);
  const automationCoordinator = new AutomationRunCoordinator(
    automationsRepository,
    new AutomationConfiguredActionExecutor(automationDeployment, automationNotifications),
    undefined,
    automationApprovalOrchestrator,
  );
  const automationScheduler = new AutomationScheduler(automationsRepository, automationsService, automationCoordinator, undefined, undefined);
  security.approvals.setDecisionListener(async (approval) => {
    if (approval.operationType !== 'automation.run.approve') return;
    const runRef = approval.resourceRefs.find((ref) => ref.type === 'automationRun');
    if (!runRef || !approval.tenantId) return;
    const synchronized = await automationApprovalOrchestrator.synchronizeRun(runRef.id, approval.tenantId);
    if (synchronized.status === 'pending') return;
    const run = await automationsRepository.getRun(runRef.id, approval.tenantId);
    if (!run) return;
    const resourceSummary = buildAutomationTaskResourceSummary(run);
    const task = await tasksService.resolveAutomationRunTask(approval.tenantId, run.id, resourceSummary, synchronized.status);
    if (task) return;
    if (synchronized.status === 'approved') {
      await tasksService.enqueue({
        tenantId: run.tenantId,
        taskType: 'AUTOMATION_RUN',
        requestedBy: run.createdBy,
        triggerSource: 'approval.decision',
        idempotencyKey: `automation-run:${run.id}`,
        resourceSummary,
        payload: {
          runId: run.id,
          automationId: run.automationId,
          automationName: run.automationNameSnapshot,
        },
        resourceRefs: [{ resourceType: 'automationRun', resourceId: run.id }],
      });
    }
  });
  app.setResource('automationScheduler', automationScheduler);
  app.setResource('automationEventDelivery', automationEventDelivery);
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
  automationNotificationPort.bind(notificationsService);
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
  new DeviceAssetsController(deviceAssetsService, new SecurityServicesDeviceAssetPort(security)).register(app.router);
  new DevicesController(devicesService, security).register(app.router);
  new CapabilitiesController(capabilitiesService).register(app.router);
  new AgentsController(agentsService, security).register(app.router);
  new GatewaysController(gatewaysService, security).register(app.router);
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
    builtinCatalogRefresher,
    tasksService,
    security,
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
    objectPermissions: security.objectPermissions,
    canReadAudit: async (subject, tenantId) => (
      await security.rbac.can(subject, 'audit.read', {
        type: 'auditLog',
        scope: {
          tenantId,
          tenantScope: subject.scope?.tenantScope,
        },
      })
    ).allowed,
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
    executions: executionsService,
    executionRegistry: executorRegistry,
    automation: automationScheduler,
    automationRuns: automationsService,
    automationEvents: automationEventDelivery,
    monitors: monitorsService,
    notifications: notificationWorker,
    reports: reportExportService,
    agents: agentsService,
    pluginCatalog: builtinCatalogRefresher,
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

/**
 * 生产进程必须装配由生产工厂创建的 Policy Authority；测试替身不得进入生产注册入口。
 * 不检查 GCAC_POLICY_AUTHORITY_ENABLED，避免未设置或 false 悄然移除生产安全边界。
 */
export function registerPolicyAuthorityServices(
  app: App,
  injected?: ProductionPolicyAuthorityServicesV1,
  environment: NodeJS.ProcessEnv = process.env,
): ProductionPolicyAuthorityServicesV1 | PolicyAuthorityProcessClientV1 | undefined {
  const policyAuthority = injected === undefined
    ? (environment.NODE_ENV === 'production'
      ? (environment.GCAC_POLICY_AUTHORITY_PROCESS_ROLE === 'standalone'
        ? createProductionPolicyAuthorityServicesV1(environment)
        : createProductionPolicyAuthorityProcessClientV1(environment))
      : undefined)
    : (environment.NODE_ENV === 'production' ? requireProductionPolicyAuthorityServicesV1(injected) : injected);
  if (!policyAuthority) return undefined;
  if ('service' in policyAuthority) {
    app.setResource('policyAuthorityService', policyAuthority.service);
    app.setResource('policyAuthorityTrustRootService', policyAuthority.trustRoot);
    app.setResource('policyAuthorityBootstrapService', policyAuthority.bootstrap);
    app.setResource('policyAuthorityKeySetService', policyAuthority.keySet);
    app.setResource('policyAuthoritySigningKeySource', policyAuthority.signingKeys);
  } else {
    app.setResource('policyAuthorityProcessClient', policyAuthority);
    app.setResource('policyAuthorityService', policyAuthority);
  }
  return policyAuthority;
}

function createAgentPlanAuthorizationDependencies(
  policyAuthorityServices: ProductionPolicyAuthorityServicesV1 | PolicyAuthorityProcessClientV1 | undefined,
  security: SecurityServices,
  localPolicy: UnifiedAgentPlanLocalPolicyPortV1 | undefined,
): UnifiedAgentPlanAuthorizationDependenciesV1 | undefined {
  if (!policyAuthorityServices) return undefined;
  if (!localPolicy) return undefined;
  const grants: UnifiedAgentPlanGrantPortV1 = {
    validate: (input) => security.grants.validate(input),
  };
  const policyAuthority = 'service' in policyAuthorityServices
    ? createUnifiedAgentPlanPolicyAuthorityPortV1(policyAuthorityServices)
    : createUnifiedAgentPlanPolicyAuthorityProcessPortV1(policyAuthorityServices);
  return {
    policyAuthority,
    grants,
    localPolicy,
  };
}

function resolveAgentLocalPolicy(
  injectedLocalPolicy: UnifiedAgentPlanLocalPolicyPortV1 | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): UnifiedAgentPlanLocalPolicyPortV1 | undefined {
  if (environment.NODE_ENV === 'production') {
    if (injectedLocalPolicy !== undefined) {
      throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '生产装配拒绝注入测试 localPolicy 依赖', { fallback: false });
    }
    return createProductionAgentLocalPolicyAdapterV1(environment);
  }
  return injectedLocalPolicy;
}

function resolveInjectedAgentPlanAuthorization(
  injected: UnifiedAgentPlanAuthorizationDependenciesV1 | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): UnifiedAgentPlanAuthorizationDependenciesV1 | undefined {
  if (!injected) return undefined;
  if (environment.NODE_ENV === 'production') {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '生产装配拒绝注入测试 Agent Plan 授权依赖', { fallback: false });
  }
  return injected;
}

export async function initializeBuiltinPlugins(
  unifiedPlugins: UnifiedPluginsApplicationService,
  pluginWorkflowPublisher: PluginWorkflowPublisherService,
  options: {
    loader?: BuiltinUnifiedPluginLoader;
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
  const gatewayTasksService = app.getResource<GatewayTaskService>('gatewayTasksService');
  const database = app.getResource<DatabasePort>('database');
  if (gatewayTasksService && database) {
    const repositories = await createDurableGatewayTaskRepositories(database);
    await gatewayTasksService.initialize(repositories);
    app.registerPersistenceFlusher(gatewayTasksService);
  }
  const tasksService = app.getResource<TasksApplicationService>('tasksService');
  if (!tasksService) throw new Error('任务控制面服务未完成应用装配');
  await tasksService.initialize();
  const unifiedPlugins = app.getResource<UnifiedPluginsApplicationService>('unifiedPluginsService');
  const pluginWorkflowPublisher = app.getResource<PluginWorkflowPublisherService>('pluginWorkflowPublisher');
  if (unifiedPlugins && pluginWorkflowPublisher) {
    await initializeBuiltinPlugins(unifiedPlugins, pluginWorkflowPublisher);
  }
  return app;
}

function createTaskAwareHealthRepository(
  tasksService: Pick<TasksApplicationService, 'getLifecycle'>,
): HealthRepository {
  return {
    async checkDependency(name: string): Promise<'OK' | 'DEGRADED' | 'UNKNOWN'> {
      if (name !== 'database' && name !== 'queue') return 'OK';
      const status = tasksService.getLifecycle().status;
      if (status === 'READY') return 'OK';
      if (status === 'FAILED') return 'DEGRADED';
      return 'UNKNOWN';
    },
  };
}

function warnBuiltinPluginFailure(
  logger: Pick<typeof structuredLogger, 'warn'>,
  phase: 'load' | 'publishWorkflow' | 'disableAfterPublishWorkflow',
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
            required: ['credentialId', 'pluginVersionId', 'loginUrl', 'sharePassword'],
            properties: {
              credentialId: { type: 'string' },
              assetId: { type: 'string' },
              pluginVersionId: { type: 'string' },
              loginUrl: { type: 'string' },
              ttlSeconds: { type: 'number' },
              screenWidth: { type: 'number' },
              screenHeight: { type: 'number' },
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
    ...getCloudAccountRouteContracts(),
    ...getDeploymentInputRouteContracts(),
    ...getDeviceAssetRouteContracts(),
    ...getDeviceRouteContracts(),
    ...getBindingsRouteContracts(),
    ...getCertificateRouteContracts(),
    ...getCapabilitiesRouteContracts(),
    ...getAgentsRouteContracts(),
    ...getGatewayRouteContracts(),
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
