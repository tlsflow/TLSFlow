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
import { CaAutoSyncScheduler, CaOperationsRepository, CaSyncWorker, getInternalCaRouteContracts, InternalCaApplicationService, InternalCaController } from './modules/internal-ca/index.js';
import { AuditPresentationService } from './modules/audits/audit-presentation.service.js';
import { CapabilitiesApplicationService, CapabilitiesController, getCapabilitiesRouteContracts, PgCapabilitiesRepository } from './modules/capabilities/index.js';
import { ProvidersApplicationService, ProvidersController, getProvidersRouteContracts, PgProvidersRepository } from './modules/providers/index.js';
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
import { DeploymentCapabilityResolver } from './modules/plugins/application/deployment-capability.resolver.js';
import { HistoricalAgentActionResolver } from './modules/plugins/application/historical-agent-action-resolver.js';
import { PgUnifiedPluginsRepository } from './modules/plugins/repository/unified-plugins.repository.js';
import { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
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

export interface AppDependencies {
  db?: DatabasePort;
  corePersistence?: CorePersistenceProfile;
  security?: SecurityServices;
  deploymentPlans?: DeploymentPlansController;
  deploymentPersistence?: DeploymentPersistenceOptions;
  gatewayPersistence?: GatewayPersistenceOptions;
  assets?: AssetsApplicationService;
  bindings?: BindingsApplicationService;
  certificates?: CertificateServices;
}

export function createApp(dependencies: AppDependencies = {}): App {
  const corePersistence = dependencies.corePersistence ?? { mode: 'postgres' as const, strict: true };
  const missingPersistence = collectMissingCorePersistence(corePersistence, []);
  if (corePersistence.strict === true && missingPersistence.length > 0) {
    throw new Error(buildCorePersistenceErrorMessage(missingPersistence));
  }

  const app = new App();
  const appDb = dependencies.db ?? new PgliteDatabase();
  app.setResource('database', appDb);
  const security = dependencies.security ?? createPersistedSecurityServices(appDb).services;
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
  const pluginCertificateResultService = new PluginCertificateResultService(appDb);
  const executionPersistence = createDeploymentPersistenceRepositories({
    ...(dependencies.deploymentPersistence ?? {}),
    db: appDb,
  });
  const executionDetailStream = new ExecutionDetailStreamService();
  const standardDeviceDiscoveryProjector = new StandardDeviceDiscoveryProjector(appDb);
  const agentCapabilityDiscoveryProjector = new AgentCapabilityDiscoveryProjector(appDb, standardDeviceDiscoveryProjector);
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
  const unifiedPluginsService = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(appDb));
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
  const historicalAgentActions = new HistoricalAgentActionResolver(
    unifiedPluginsService,
    new DeploymentCapabilityResolver(pluginBindingsService, unifiedPluginsService),
  );
  app.setResource('agentsService', agentsService);
  app.setResource('livenessService', livenessService);
  app.setResource('unifiedPluginsService', unifiedPluginsService);
  app.setResource('workflowTemplatesService', workflowTemplatesService);
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
  ));

  app.setAuthTokenResolver((authorization, cookie) => security.auth.parseRequestIdentity(authorization, cookie));
  new HealthController().register(app.router);

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
    historicalAgentActions,
    workflowRecovery: workflowRecoveryService,
    pluginResourceLocks: pluginResourceLockService,
    executionGrants: security.grants,
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
  new CredentialsController(new CredentialsApplicationService(new CredentialsRepository(appDb), undefined, appDb, security.secrets), security).register(app.router);
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
  new ExecutionsController(executionsService, executionDetailStream, workflowRecoveryService).register(app.router);

  const providersService = new ProvidersApplicationService({
    assetsService,
    repository: new PgProvidersRepository(appDb),
  });
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
  const automationScheduler = new AutomationScheduler(automationsRepository, automationsService, automationCoordinator);
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
  });
  executionResultSync.setMonitorsService(monitorsService);
  app.setResource('monitorsService', monitorsService);

  new CertificatesController(security, certificateServices).register(app.router);
  new InternalCaController(internalCaService, security).register(app.router);
  new DeviceAssetsController(deviceAssetsService, new SecurityServicesDeviceAssetPort(security)).register(app.router);
  new DevicesController(devicesService, security).register(app.router);
  new CapabilitiesController(capabilitiesService).register(app.router);
  new AgentsController(agentsService, security).register(app.router);
  new GatewaysController(gatewaysService, security).register(app.router);
  new ProvidersController(providersService).register(app.router);
  new CompatibilityCatalogController().register(app.router);
  new PluginsController(
    unifiedPluginsService,
    pluginBindingsService,
    new PluginPromotionService(appDb),
    new ManagedTargetPluginQueryService(appDb),
  ).register(app.router);
  new WorkflowTemplatesController(
    workflowTemplatesService,
    security,
    new PluginWorkflowSourceService(unifiedPluginsService, new PluginWorkflowBindingsRepository(appDb), workflowTemplatesService),
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
  })).register(app.router);
  new MonitorsController(monitorsService).register(app.router);
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
  const reportExportService = new ReportExportService(reportsService, reportsRepository, undefined, appDb);
  app.setResource('reportsService', reportsService);
  app.setResource('reportExportService', reportExportService);
  new ReportsController(reportsService, security, reportExportService).register(app.router);

  app.router.get('/api/v1/openapi.json', '获取 OpenAPI 契约', ['System'], async () => ({
    statusCode: 200,
    body: generateOpenApiDocument(getRouteContracts()),
  }));

  return app;
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
    const installed = await new BuiltinUnifiedPluginLoader().installAll(process.env.GCAC_BUILTIN_PLUGIN_TENANT_ID ?? 'default', unifiedPlugins);
    for (const plugin of installed) await pluginWorkflowPublisher.publishPlugin(plugin);
    const database = app.getResource<DatabasePort>('database');
    if (database) {
      const upgrades = new BuiltinPluginCompatibilityUpgradeService(database);
      for (const plugin of installed) {
        await upgrades.upgradePatchLine(plugin.tenantId, plugin.id, plugin.pluginId, plugin.version);
      }
    }
  }
  return app;
}

export function getRouteContracts(): RouteContract[] {
  return [
    ...getHealthRouteContracts(),
    ...getSecurityRouteContracts(),
    ...getDeploymentPlanRouteContracts(),
    ...getExecutionRouteContracts(),
    ...getAssetsRouteContracts(),
    ...getDeploymentInputRouteContracts(),
    ...getDeviceAssetRouteContracts(),
    ...getDeviceRouteContracts(),
    ...getBindingsRouteContracts(),
    ...getCertificateRouteContracts(),
    ...getInternalCaRouteContracts(),
    ...getCapabilitiesRouteContracts(),
    ...getAgentsRouteContracts(),
    ...getGatewayRouteContracts(),
    ...getProvidersRouteContracts(),
    ...getCompatibilityCatalogRouteContracts(),
    ...getPluginsRouteContracts(),
    ...getWorkflowTemplateRouteContracts(),
    ...getAutomationRouteContracts(),
    ...getDashboardRouteContracts(),
    ...getMonitorRouteContracts(),
    ...getNotificationRouteContracts(),
    ...getReportRouteContracts(),
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
