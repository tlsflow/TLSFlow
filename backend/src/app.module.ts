import { App } from './common/http/app.js';
import type { RouteContract } from './common/openapi/route-contract.js';
import { generateOpenApiDocument } from './common/openapi/openapi-generator.js';
import type { DatabasePort } from './database/database-port.js';
import { PgliteDatabase } from './database/pglite-database.js';
import { getHealthRouteContracts, HealthController } from './modules/health/controller/health.controller.js';
import { DeploymentPlansApplicationService } from './modules/deployment-plans/application/deployment-plans.application-service.js';
import { DeploymentPlansController, getDeploymentPlanRouteContracts } from './modules/deployment-plans/controller/deployment-plans.controller.js';
import { ExecutionsApplicationService } from './modules/executions/application/executions.application-service.js';
import { ExecutionDetailStreamService } from './modules/executions/application/execution-detail-stream.service.js';
import { ExecutionResultSyncService } from './modules/executions/application/execution-result-sync.service.js';
import { createDefaultExecutorRegistryWithDependencies } from './modules/executions/application/executors.js';
import { ExecutionsController, getExecutionRouteContracts } from './modules/executions/controller/executions.controller.js';
import { createSecurityServices, getSecurityRouteContracts, SecurityController, type SecurityServices } from './modules/security/security.controller.js';
import { createPersistedSecurityServices } from './modules/security/security-services.persistence.js';
import { AssetsApplicationService } from './modules/assets/application/assets.application-service.js';
import { AssetsController, getAssetsRouteContracts } from './modules/assets/controller/assets.controller.js';
import { PgAssetsRepository } from './modules/assets/repository/assets.repository.js';
import { BindingsApplicationService } from './modules/bindings/application/bindings.application-service.js';
import { BindingsController, getBindingsRouteContracts } from './modules/bindings/controller/bindings.controller.js';
import { PgBindingsRepository } from './modules/bindings/repository/bindings.repository.js';
import { CertificatesController, createCertificateServices, getCertificateRouteContracts, type CertificateServices } from './modules/certificates/index.js';
import { CapabilitiesApplicationService, CapabilitiesController, getCapabilitiesRouteContracts, PgCapabilitiesRepository } from './modules/capabilities/index.js';
import { ProvidersApplicationService, ProvidersController, getProvidersRouteContracts, PgProvidersRepository } from './modules/providers/index.js';
import { MonitorsApplicationService, MonitorsController, getMonitorRouteContracts } from './modules/monitors/index.js';
import { PgMonitorsRepository } from './modules/monitors/repository/monitors.repository.js';
import { DashboardApplicationService, DashboardController, getDashboardRouteContracts } from './modules/dashboard/index.js';
import { AgentsApplicationService, AgentsController, getAgentsRouteContracts } from './modules/agents/index.js';
import { PgAgentsRepository } from './modules/agents/repository/agents.repository.js';
import { createGatewayPersistenceRepositories, GatewaysApplicationService, GatewaysController, getGatewayRouteContracts, type GatewayPersistenceOptions } from './modules/gateways/index.js';
import { GatewayTaskAuditWriter, GatewayTaskService } from './modules/gateway-agents/index.js';
import { PluginsController, getPluginsRouteContracts } from './modules/plugins/index.js';
import { PluginsApplicationService } from './modules/plugins/application/plugins.application-service.js';
import { PgPluginsRepository } from './modules/plugins/repository/plugins.repository.js';
import { createWorkflowStepDispatcher } from './modules/workflow-templates/application/workflow-step-dispatcher.js';
import { WorkflowTemplatesController, WorkflowTemplatesApplicationService, WorkflowTemplatesDomainService, getWorkflowTemplateRouteContracts } from './modules/workflow-templates/index.js';
import {
  buildCorePersistenceErrorMessage,
  collectMissingCorePersistence,
  type CorePersistenceProfile,
} from './persistence/core-persistence.js';
import { PgDocumentRepository } from './persistence/repositories/pg-document-repository.js';
import { createDeploymentPersistenceRepositories, type DeploymentPersistenceOptions } from './persistence/repositories/deployment-persistence-factory.js';

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
  const security = dependencies.security ?? createPersistedSecurityServices(appDb).services;
  const gatewayPersistence = createGatewayPersistenceRepositories({
    ...(dependencies.gatewayPersistence ?? {}),
    db: appDb,
  });
  const certificateServices = dependencies.certificates ?? createCertificateServices(security, { db: appDb });
  const gatewaysService = new GatewaysApplicationService(gatewayPersistence.gateways, gatewayPersistence.targetHistory);
  const gatewayTaskAuditWriter = new GatewayTaskAuditWriter({ audit: security.audit, history: gatewaysService.getTargetHistoryRepository() });
  const gatewayTasksService = new GatewayTaskService({ auditWriter: gatewayTaskAuditWriter });
  const assetsService = dependencies.assets ?? new AssetsApplicationService(new PgAssetsRepository(appDb));
  const bindingsService = dependencies.bindings ?? new BindingsApplicationService(
    assetsService.getRepository(),
    new PgBindingsRepository(assetsService.getRepository(), appDb),
    undefined,
    assetsService,
  );
  const executionPersistence = createDeploymentPersistenceRepositories({
    ...(dependencies.deploymentPersistence ?? {}),
    db: appDb,
  });
  const executionDetailStream = new ExecutionDetailStreamService();
  const executionResultSync = new ExecutionResultSyncService(
    executionPersistence.executions,
    assetsService,
    bindingsService,
    executionPersistence.deploymentPlans,
    executionDetailStream,
  );
  const agentsService = new AgentsApplicationService(
    new PgAgentsRepository(appDb),
    undefined,
    gatewaysService.getRepository(),
    certificateServices.certificates,
    security.secrets,
    executionResultSync,
    executionDetailStream,
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
  );
  app.setResource('agentsService', agentsService);
  app.setResource('certificateServices', certificateServices);

  app.setAuthTokenResolver((authorization, cookie) => security.auth.parseRequestIdentity(authorization, cookie));
  new HealthController().register(app.router);
  new SecurityController(security).register(app.router);

  assetsService.setAgentsService(agentsService);
  assetsService.setBindingsRepository(bindingsService.getRepository());
  assetsService.setWorkflowTemplatesService(workflowTemplatesService);
  const executorRegistry = createDefaultExecutorRegistryWithDependencies({
    agents: agentsService,
    gatewayTasks: gatewayTasksService,
    gatewayTaskAuditWriter,
    secrets: security.secrets,
    workflows: workflowTemplatesService,
  });

  const deploymentPersistence = dependencies.deploymentPlans
    ? undefined
    : executionPersistence;
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
    }),
    approval: security.approvals,
    audit: security.audit,
    gateways: gatewaysService,
    assets: assetsService.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    certificates: certificateServices.certificates.getRepository(),
    certificatesApp: certificateServices.certificates,
  }));
  deploymentPlans.register(app.router);
  const executionsService = deploymentPlans.getExecutionsService();
  executionResultSync.setContinuationRunner(({ runId, actorId, tenantId }) =>
    executionsService.runDispatchedExecution(runId, actorId, tenantId, executorRegistry),
  );
  executionResultSync.setRollbackRunner(({ runId, actorId, tenantId }) =>
    executionsService.triggerAutomaticRollback(runId, actorId, tenantId),
  );
  app.setResource('executionsService', executionsService);
  app.setResource('executionDetailStream', executionDetailStream);
  new ExecutionsController(executionsService, executionDetailStream).register(app.router);

  const providersService = new ProvidersApplicationService({
    assetsService,
    repository: new PgProvidersRepository(appDb),
  });
  const pluginsService = new PluginsApplicationService(new PgPluginsRepository(appDb));
  new AssetsController(security, assetsService).register(app.router);
  const bindingsController = new BindingsController(assetsService, bindingsService, security);
  bindingsController.register(app.router);

  certificateServices.bindings ??= bindingsService;
  const monitorsService = new MonitorsApplicationService({
    repository: new PgMonitorsRepository(appDb),
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsController.getApplicationService().getRepository(),
    executions: deploymentPlans.getExecutionsService().getRepository(),
    assets: assetsService.getRepository(),
  });
  app.setResource('monitorsService', monitorsService);

  new CertificatesController(security, certificateServices).register(app.router);
  new CapabilitiesController(capabilitiesService).register(app.router);
  new AgentsController(agentsService).register(app.router);
  new GatewaysController(gatewaysService).register(app.router);
  new ProvidersController(providersService).register(app.router);
  new PluginsController(pluginsService).register(app.router);
  new WorkflowTemplatesController(workflowTemplatesService).register(app.router);
  new DashboardController(new DashboardApplicationService({
    assets: assetsService.getRepository(),
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    gateways: gatewaysService.getRepository(),
    audit: security.audit,
  })).register(app.router);
  new MonitorsController(monitorsService).register(app.router);

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
  return app;
}

export function getRouteContracts(): RouteContract[] {
  return [
    ...getHealthRouteContracts(),
    ...getSecurityRouteContracts(),
    ...getDeploymentPlanRouteContracts(),
    ...getExecutionRouteContracts(),
    ...getAssetsRouteContracts(),
    ...getBindingsRouteContracts(),
    ...getCertificateRouteContracts(),
    ...getCapabilitiesRouteContracts(),
    ...getAgentsRouteContracts(),
    ...getGatewayRouteContracts(),
    ...getProvidersRouteContracts(),
    ...getPluginsRouteContracts(),
    ...getWorkflowTemplateRouteContracts(),
    ...getDashboardRouteContracts(),
    ...getMonitorRouteContracts(),
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
