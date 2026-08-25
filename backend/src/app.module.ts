import { createHash } from 'node:crypto';
import { App } from './common/http/app.js';
import { NodeOutboundHttpClient } from './common/http/outbound-http-client.js';
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
import { CookieSessionStore, CurlExecutor, SSHExecutor, SecretServiceCurlResolver, SecretServiceSshResolver } from './modules/executors/index.js';
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
import { DevicesApplicationService, DevicesController, getDeviceRouteContracts, PgDevicesRepository, resolvePluginDeviceFamilies } from './modules/devices/index.js';
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
  Http01ChallengeAdapter,
  InternalCaApplicationService,
  InternalCaController,
  LegoDnsIssuer,
  PostgresHttp01Responder,
} from './modules/internal-ca/index.js';
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
import { DashboardReadRepository } from './modules/dashboard/repository/dashboard-read.repository.js';
import { getReportRouteContracts, PgReportDataPort, ReportExportService, ReportScopeResolver, ReportsApplicationService, ReportsController, ReportsRepository } from './modules/reports/index.js';
import { AgentsApplicationService, AgentsController, getAgentsRouteContracts } from './modules/agents/index.js';
import type { AgentTrustMaterialIssuer } from './modules/agents/application/agents.application-service.js';
import { PgAgentsRepository } from './modules/agents/repository/agents.repository.js';
import { AgentPlanPolicyProvisioningServiceV1 } from './modules/agents/security/policy-authority-provisioning.service.js';
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
import { PluginPromotionService, PluginsController, getPluginsRouteContracts } from './modules/plugins/index.js';
import { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { PluginWorkflowBindingsRepository } from './modules/plugins/repository/plugin-workflow-bindings.repository.js';
import { UnifiedAgentPlanCompilerService } from './modules/plugins/application/unified-agent-plan-compiler.service.js';
import { PluginFactPipelineService } from './modules/plugins/application/plugin-fact-pipeline.service.js';
import { PluginFactRunnerAdapter } from './modules/plugins/application/plugin-fact-runner.adapter.js';
import {
  createUnifiedAgentPlanPolicyAuthorityPortV1,
  createUnifiedAgentPlanPolicyAuthorityProcessPortV1,
  type UnifiedAgentPlanAuthorizationDependenciesV1,
  type UnifiedAgentPlanGrantPortV1,
  type UnifiedAgentPlanLocalPolicyPortV1,
} from './modules/plugins/application/unified-agent-plan-authorization.port.js';
import { createProductionAgentLocalPolicyAdapterV1 } from './modules/agents/security/production-agent-local-policy.adapter.js';
import { createProductionAgentTrustMaterialIssuerV1 } from './modules/agents/security/production-agent-trust-material.adapter.js';
import { createLocalAgentAuthorizationServicesV1 } from './modules/agents/security/local-agent-authorization.service.js';
import { PgUnifiedPluginsRepository } from './modules/plugins/repository/unified-plugins.repository.js';
import { compareSemanticVersions, UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
import { UserPluginDirectoryImporter } from './modules/plugins/application/user-plugin-directory-importer.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import type { PluginRefreshChange, PluginRefreshResult, PluginRefreshVersionSnapshot } from './modules/plugins/dto/plugin-refresh-result.dto.js';
import { PluginBindingsApplicationService } from './modules/plugins/application/plugin-bindings.application-service.js';
import { PluginAgentLinkageService } from './modules/plugins/application/plugin-agent-linkage.service.js';
import { ManagedTargetPluginQueryService } from './modules/plugins/application/managed-target-plugin-query.service.js';
import { PluginBindingsRepository } from './modules/plugins/repository/plugin-bindings.repository.js';
import { StandardDeviceDiscoveryProjector } from './modules/plugins/discovery/standard-device-discovery.projector.js';
import { AgentCapabilityDiscoveryProjector } from './modules/agents/discovery/agent-capability-discovery.projector.js';
import { createAgentDiscoveryTaskFactory } from './modules/agents/application/agent-discovery-task-factory.js';
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
import { CredentialHealthController, CredentialHealthRepository, CredentialHealthService } from './modules/credentials/health/index.js';
import {
  CloudAccountAssetsApplicationService,
  CloudAccountAssetBindingProvisioner,
  CloudAccountDiscoveryApplicationService,
  CloudResourceProjectionService,
  ProvidersController,
  getCloudAccountRouteContracts,
} from './modules/providers/index.js';
import { resolvePluginRunnerConfig } from './modules/plugins/runner/production-runner-config.js';
import { canonicalize } from './shared/canonical-json.js';
import { PluginRunnerSupervisor } from './modules/plugins/runner/index.js';
import { BuiltinPluginRegistry } from './modules/plugins/builtin-plugins/builtin-plugin-registry.js';
import {
  PluginRunnerExecutorAdapter,
  type PluginRunnerExecutionDependencies,
} from './modules/executions/application/plugin-runner-executor.adapter.js';
import { createPluginRunnerHostApiHandler } from './modules/plugins/runner/plugin-runner-host-api.handler.js';
import { PgPluginRunnerHostApiRequestStore, PluginRunnerHostApiRequestGate } from './modules/plugins/runner/host-api.request-gate.js';
import type { PluginRuntimeAdapterRegistry } from './modules/deployment-plans/application/plugin-runtime-adapter.registry.js';
import { GlobalSearchApplicationService } from './modules/global-search/application/global-search.application-service.js';
import { GlobalSearchController, getGlobalSearchRouteContracts } from './modules/global-search/controller/global-search.controller.js';
import { ApplicationOnboardingController, ApplicationOnboardingService, ApplicationOnboardingSessionRepository, OnboardingCommitService, PublishedDirectWorkflowOnboardingAdapter, getApplicationOnboardingRouteContracts } from './modules/application-onboarding/index.js';
import type { LoadedApplicationOnboardingRecipe } from './modules/application-onboarding/recipe/index.js';
import { SystemInitializationController, getSystemInitializationRouteContracts, SystemInitializationService } from './modules/system-initialization/index.js';
import { PluginCaActionDispatcher } from './modules/internal-ca/providers/plugin-ca-action-dispatcher.js';
import { CertificateLifecycleService } from './modules/internal-ca/application/certificate-lifecycle.service.js';

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
  /** 测试或受控宿主显式注入设备服务；生产默认使用真实装配。 */
  devices?: DevicesApplicationService;
}

/** 生成证书产物必须包含私钥的格式码；证书版本本身只保存公钥/私钥材料。 */
const certificateKeyRequiredFormats = new Set(['PEM', 'PFX', 'JKS']);
const pluginScopedInitializationErrorCodes = new Set([
  'VALIDATION_FAILED',
  'RESOURCE_VERSION_CONFLICT',
  'PLUGIN_RUNNER_START_FAILED',
  'PLUGIN_RUNNER_VERSION_MISMATCH',
]);

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
  const systemInitialization = new SystemInitializationService(appDb, security.auth, security.rbac, security.audit);
  app.setResource('systemInitializationService', systemInitialization);
  const localAgentAuthorization = createLocalAgentAuthorizationServicesV1(process.env, {
    grants: { validate: (input) => security.grants.validate(input) },
  });
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
    security.audit,
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
  const managedTargetPluginQuery = new ManagedTargetPluginQueryService(appDb);
  const internalCaService = new InternalCaApplicationService({
    db: appDb,
    secrets: security.secrets,
    certificates: certificateServices.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  const certificateLifecycleService = new CertificateLifecycleService({
    internalCa: internalCaService,
    certificates: certificateServices.certificates,
    repository: internalCaService.getRepository(),
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
    adapters: { 'http-01': new Http01ChallengeAdapter(http01Responder) },
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
  // Gateway 只通过独立 Relay Agent 提供 TCP 中继；控制面不再装配 GatewayTask 队列、结果 sink 或业务探测。
  const livenessService = new LivenessApplicationService(appDb);
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
  credentialsService.setCloudCredentialContractResolver({
    resolve: async (tenantId, selector) => {
      const providerKey = typeof selector.providerKey === 'string' && selector.providerKey.trim()
        ? selector.providerKey.trim()
        : undefined;
      const version = selector.pluginVersionId
        ? await unifiedPluginsService.getVersionForTenant(tenantId, selector.pluginVersionId)
        : await resolveCloudPluginVersion(unifiedPluginsService, tenantId, providerKey);
      if (version.status !== 'ENABLED') {
        throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Cloud Provider 插件版本未启用', {
          pluginVersionId: version.id,
          status: version.status,
        });
      }
      if (providerKey && version.pluginId !== providerKey) {
        throw new AppError('VALIDATION_FAILED', 'Cloud Provider 与插件 Manifest 不一致', {
          providerKey,
          manifestProviderKey: version.pluginId,
          pluginVersionId: version.id,
        });
      }
      if (!version.manifest.capabilities.some((capability) => capability.key === 'cloud.service.connection-test')) {
        throw new AppError('VALIDATION_FAILED', '插件版本未声明 Cloud Provider 连接能力', { pluginVersionId: version.id });
      }
      const ui = await unifiedPluginsService.getUiResources(version.id, 'zh-CN');
      const form = (ui.forms as Record<string, unknown>).cloud;
      const contract = readCloudCredentialContract(form, version.pluginId, version.id);
      return { providerKey: version.pluginId, pluginVersionId: version.id, contract };
    },
  });
  const pluginRunnerConfig = resolvePluginRunnerConfig(process.env);
  const pluginResourceLockService = new PluginResourceLockService(appDb);
  const pluginArtifactStore = new PgCertificateArtifactStore(appDb);
  const cookieSessionStore = new CookieSessionStore();
  app.setResource('cookieSessionStore', cookieSessionStore);
  const workflowRecoveryService = new WorkflowRecoveryLedgerService(appDb);
  const cloudAccountAssetsService = new CloudAccountAssetsApplicationService(appDb);
  const pluginRunnerSupervisor = pluginRunnerConfig
    ? new PluginRunnerSupervisor({ maxRestarts: 3 })
    : undefined;
  const builtinPluginRegistry = new BuiltinPluginRegistry(undefined, {
    blockedPackageDirectories: readBlockedBuiltinPluginDirectories(process.env),
  });
  const pluginRunnerHostApiHandler = pluginRunnerConfig
    ? createPluginRunnerHostApiHandler({
      security,
      artifacts: pluginArtifactStore,
      executions: executionPersistence.executions,
      requestGate: new PluginRunnerHostApiRequestGate(new PgPluginRunnerHostApiRequestStore(appDb)),
      cloudServices: cloudAccountAssetsService,
      httpClient: new NodeOutboundHttpClient(),
      cookieSessionStore,
    })
    : undefined;
  const pluginRunnerDependencies: PluginRunnerExecutionDependencies | undefined = dependencies.pluginRunner
    ? { ...dependencies.pluginRunner, cookieSessionStore }
    : (pluginRunnerConfig && pluginRunnerSupervisor && pluginRunnerHostApiHandler
      ? {
        runner: pluginRunnerConfig,
        supervisor: pluginRunnerSupervisor,
        hostApiHandler: pluginRunnerHostApiHandler,
        builtinRegistry: builtinPluginRegistry,
        cookieSessionStore,
      }
      : undefined);
  app.setResource('cloudAccountAssetsService', cloudAccountAssetsService);
  const standardDeviceDiscoveryProjector = new StandardDeviceDiscoveryProjector(appDb);
  const pluginFactPipeline = createPluginFactPipeline(
    pluginRunnerDependencies,
    standardDeviceDiscoveryProjector,
    security.grants,
  );
  if (pluginFactPipeline) app.setResource('pluginFactPipeline', pluginFactPipeline);
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
    pluginFactPipeline,
  );
  agentsService.setAdcsRegistrationProvisioner(async (input) => {
    const plugin = (await unifiedPluginsService.listAccessibleVersions(input.tenantId))
      .filter((version) => version.pluginId === 'ca.microsoft-adcs' && version.runtime === 'WORKFLOW_DSL' && version.status === 'ENABLED')
      .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
    if (!plugin) throw new AppError('RESOURCE_NOT_FOUND', 'Microsoft AD CS 插件未启用，无法登记 AD CS Agent');
    await internalCaService.ensureAdcsProviderForAgent({ ...input, pluginVersionId: plugin.id });
  });
  internalCaService.setPluginActionDispatcher(new PluginCaActionDispatcher(
    unifiedPluginsService,
    security.grants,
    pluginRunnerDependencies ?? {},
    agentsService,
  ));
  const capabilitiesService = new CapabilitiesApplicationService(new PgCapabilitiesRepository(appDb));
  // 统一工作流（设备能力执行等）的旧 Curl/SSH 执行器必须由宿主显式注入受控实例：
  // 复用 SecretService 凭据解析与 ExecutionGrant 授权链，不允许 dispatcher 自行创建或静默 fallback。
  const workflowStepCurlExecutor = new CurlExecutor({
    secretResolver: new SecretServiceCurlResolver(security.secrets),
    executionGrantService: security.grants,
    cookieSessionStore,
    artifactStore: pluginArtifactStore,
  });
  const workflowStepSshExecutor = new SSHExecutor({
    secretResolver: new SecretServiceSshResolver(security.secrets),
  });
  const workflowTemplatesService = new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(
      new PgDocumentRepository(appDb, 'workflow.templates'),
      new PgDocumentRepository(appDb, 'workflow.template_versions'),
    ),
    {
      stepDispatcher: createWorkflowStepDispatcher({
        curlExecutor: workflowStepCurlExecutor,
        sshExecutor: workflowStepSshExecutor,
        executionGrantService: security.grants,
      }),
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
  cloudAccountAssetsService.setBindingProvisioner(new CloudAccountAssetBindingProvisioner(unifiedPluginsService));
  const cloudResourceProjectionService = new CloudResourceProjectionService(appDb);
  const cloudPluginActionExecutor = new PluginRunnerExecutorAdapter({
    ...(pluginRunnerDependencies ?? {}),
    executionGrants: security.grants,
  });
  const cloudAccountDiscoveryService = new CloudAccountDiscoveryApplicationService({
    db: appDb,
    cloudAccounts: cloudAccountAssetsService,
    plugins: unifiedPluginsService,
    workflows: workflowTemplatesService,
    workflowBindings: new PluginWorkflowBindingsRepository(appDb),
    projection: cloudResourceProjectionService,
    pluginActionExecutor: cloudPluginActionExecutor,
    executionGrants: security.grants,
  });
  new ProvidersController(cloudAccountAssetsService, cloudAccountDiscoveryService, security).register(app.router);
  const pluginWorkflowPublisher = new PluginWorkflowPublisherService(
    workflowTemplatesService,
    new PluginWorkflowBindingsRepository(appDb),
    (pluginId, version) => builtinPluginRegistry.getDeclaredWorkflowDeclarations(pluginId, version),
  );
  const directWorkflowOnboarding = new PublishedDirectWorkflowOnboardingAdapter(
    assetsService.getRepository(),
    pluginWorkflowPublisher,
  );
  const devicesService = dependencies.devices ?? new DevicesApplicationService(
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
    undefined,
  );
  const credentialHealthService = new CredentialHealthService(
    new CredentialHealthRepository(appDb),
    credentialsService,
    tasksService,
    devicesService,
    undefined,
    security.tenantHierarchy,
  );
  app.setResource('credentialHealthService', credentialHealthService);
  const agentPlanAuthorization = createAgentPlanAuthorizationDependencies(policyAuthorityServices, security, localPolicy)
    ?? localAgentAuthorization?.authorization
    ?? resolveInjectedAgentPlanAuthorization(dependencies.agentPlanAuthorization);
  const policyProvisioning = agentPlanAuthorization?.policyAuthority.provisionAgentPlan && agentPlanAuthorization.localPolicy
    ? new AgentPlanPolicyProvisioningServiceV1(agentPlanAuthorization.policyAuthority, agentPlanAuthorization.localPolicy)
    : undefined;
  const agentPlanCompiler = new UnifiedAgentPlanCompilerService(
    unifiedPluginsService,
    agentPlanAuthorization,
  );
  const discoveryRequestFactory = agentPlanAuthorization
    ? createAgentDiscoveryTaskFactory({
      plugins: unifiedPluginsService,
      policyAuthority: agentPlanAuthorization.policyAuthority,
    })
    : undefined;
  agentsService.setDiscoveryRequestFactory(discoveryRequestFactory);
  const trustMaterialIssuer = localAgentAuthorization?.trustMaterialIssuer
    ?? resolveProductionAgentTrustMaterialIssuer(policyAuthorityServices, process.env);
  agentsService.setTrustMaterialIssuer(trustMaterialIssuer);
  if (discoveryRequestFactory) app.setResource('agentDiscoveryRequestFactory', discoveryRequestFactory);
  if (localAgentAuthorization) app.setResource('localAgentAuthorization', localAgentAuthorization);
  app.setResource('agentsService', agentsService);
  app.setResource('livenessService', livenessService);
  app.setResource('unifiedPluginsService', unifiedPluginsService);
  app.setResource('builtinPluginRegistry', builtinPluginRegistry);
  app.setResource('workflowTemplatesService', workflowTemplatesService);
  if (browserRuntimeClient && browserCredentialSessionService) {
    app.setResource('browserRuntimeClient', browserRuntimeClient);
    app.setResource('browserCredentialSessionService', browserCredentialSessionService);
  }
  app.setResource('pluginWorkflowPublisher', pluginWorkflowPublisher);
  app.setResource('cloudResourceProjectionService', cloudResourceProjectionService);
  app.setResource('cloudAccountDiscoveryService', cloudAccountDiscoveryService);
  app.setResource('certificateServices', certificateServices);
  const globalSearchService = new GlobalSearchApplicationService({
    certificates: certificateServices.certificates,
    assets: assetsService,
    devices: devicesService,
    cloudServices: cloudAccountAssetsService,
    plugins: unifiedPluginsService,
  });
  app.setResource('globalSearchService', globalSearchService);
  app.setResource('internalCaService', internalCaService);
  app.setResource('certificateLifecycleService', certificateLifecycleService);
  app.setResource('acmeRepository', acmeRepository);
  app.setResource('acmeRenewalScheduler', acmeRenewalScheduler);
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
  new SystemInitializationController(systemInitialization).register(app.router);
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
  assetsService.setPluginAgentLinkageService(new PluginAgentLinkageService(appDb, localAgentAuthorization));
  const executorRegistry = createDefaultExecutorRegistryWithDependencies({
    agents: agentsService,
    secrets: security.secrets,
    workflows: workflowTemplatesService,
    agentPlanCompiler,
    workflowRecovery: workflowRecoveryService,
    pluginResourceLocks: pluginResourceLockService,
    executionGrants: security.grants,
    pluginRunner: pluginRunnerDependencies,
    cookieSessionStore,
    artifactStore: pluginArtifactStore,
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
      agentTasks: agentsService.getRepository(),
      tasks: tasksService,
      taskControl: tasksService,
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
    tasks: tasksService,
    tenantHierarchy: security.tenantHierarchy,
    }), undefined, security);
  deploymentPlans.register(app.router);
  new DeploymentInputProjectionController(deploymentPlans.getApplicationService()).register(app.router);
  /**
   * Agent Host 不属于某个发现插件。向导只能从已投影的 Host -> Framework ->
   * ManagedTarget 事实链筛选候选项，不能把发现插件 ID 当作设备产品族或能力。
   */
  const isAgentHostOnboardingRecipe = (recipe: LoadedApplicationOnboardingRecipe): boolean => (
    recipe.recipe.deploymentMode === 'MANAGED_TARGET'
      && (recipe.recipe.newDeviceOnboarding?.kind === 'AGENT_INSTALL'
        || recipe.recipe.deviceResourceType === 'agent.host')
  );
  const listCompatibleAgentManagedTargets = async (
    tenantId: string,
    deviceId: string,
    recipe: LoadedApplicationOnboardingRecipe,
  ) => {
    const targets = [] as Awaited<ReturnType<ReturnType<typeof assetsService.getRepository>['listManagedTargets']>>['items'];
    for (let page = 1; ; page += 1) {
      const result = await assetsService.getRepository().listManagedTargets(tenantId, {
        page,
        pageSize: 200,
        filter: { deviceId },
      });
      targets.push(...result.items);
      if (targets.length >= result.total) break;
    }
    const frameworkTypes = recipe.recipe.targetProjection.frameworkTypes?.length
      ? recipe.recipe.targetProjection.frameworkTypes
      : [recipe.pluginId];
    const resolved = await Promise.all(targets
      .filter((target) => target.status === 'ACTIVE'
        && target.targetType === recipe.recipe.targetProjection.targetType
        && target.supportedCapabilities.includes('certificate.deploy'))
      .map(async (target) => {
        const [framework, site, host] = await Promise.all([
          target.frameworkInstanceId
            ? assetsService.getRepository().getFrameworkInstance(tenantId, target.frameworkInstanceId)
            : undefined,
          target.siteId
            ? assetsService.getRepository().getSiteAsset(tenantId, target.siteId)
            : undefined,
          assetsService.getRepository().getHost(tenantId, target.deviceId),
        ]);
        const configFingerprint = configFingerprintFromManagedTargetMetadata(target.metadata);
        if (!framework || !frameworkTypes.some((frameworkType) => frameworkType === framework.frameworkType) || !configFingerprint) return undefined;
        return { target, framework, site, host, configFingerprint };
      }));
    return resolved.filter((item): item is Exclude<typeof item, undefined> => item !== undefined);
  };
  const assertCompatibleAgentHost = async (
    tenantId: string,
    deviceId: string,
    recipe: LoadedApplicationOnboardingRecipe,
  ) => {
    const detail = await devicesService.get(tenantId, deviceId, 'zh-CN', new Set(['frameworks', 'sites']));
    if (detail.health === 'DISABLED' || detail.health === 'UNREACHABLE' || detail.health === 'UNKNOWN') {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '已有设备当前不可用，请先恢复设备健康状态', {
        code: 'ONBOARDING_DEVICE_UNHEALTHY', deviceId, health: detail.health,
      });
    }
    if (detail.extension.type !== 'AGENT') {
      throw new AppError('VALIDATION_FAILED', '该接入配方只接受已注册的 Agent Host', {
        code: 'ONBOARDING_AGENT_HOST_REQUIRED', deviceId, extensionType: detail.extension.type,
      });
    }
    const targets = await listCompatibleAgentManagedTargets(tenantId, deviceId, recipe);
    if (targets.length === 0) {
      throw new AppError('VALIDATION_FAILED', '已有 Agent Host 没有与当前接入配方匹配的已发现目标', {
        code: 'ONBOARDING_DEVICE_INCOMPATIBLE',
        deviceId,
        frameworkTypes: recipe.recipe.targetProjection.frameworkTypes ?? [recipe.pluginId],
        targetType: recipe.recipe.targetProjection.targetType,
      });
    }
    return targets;
  };
  const onboardingService = new ApplicationOnboardingService(
    new ApplicationOnboardingSessionRepository(appDb),
    unifiedPluginsService,
    undefined,
    {
      onboardDevice: async (tenantId, _platformKey, pluginVersionId, values, actorId) => {
        const formValues = { ...values };
        const username = typeof formValues.username === 'string' ? formValues.username.trim() : '';
        const password = typeof formValues.password === 'string' ? formValues.password : '';
        delete formValues.username;
        delete formValues.password;
        if (username || password) {
          if (!username || !password) {
            throw new AppError('VALIDATION_FAILED', '新增设备时用户名和密码必须同时提供', { code: 'ONBOARDING_CREDENTIAL_REQUIRED' });
          }
          const address = typeof formValues.address === 'string' ? formValues.address.trim() : 'device';
          const credential = await credentialsService.create(tenantId, actorId, {
            name: `onboarding-${pluginVersionId}-${address}-${Date.now()}`,
            kind: 'USERNAME_PASSWORD',
            scopeType: 'plugin',
            scopeId: pluginVersionId,
            username,
            secretValues: { password: { plainText: password, type: 'password' } },
            metadata: { source: 'application-onboarding', pluginVersionId },
          });
          formValues.credential = credential.id;
        }
        const onboarded = await devicesService.onboard(tenantId, {
          platformKey: 'plugin',
          pluginVersionId,
          formValues,
        }, actorId, 'application-onboarding', 'http://localhost');
        const device = (onboarded as { device?: { id?: string; hostId?: string }; deviceId?: string; assetId?: string }).device;
        const deviceId = device?.hostId ?? (onboarded as { deviceId?: string }).deviceId;
        if (!deviceId) throw new AppError('SYSTEM_INTERNAL_ERROR', '设备接入未返回设备 ID');
        return { deviceId, assetId: device?.id ?? (onboarded as { assetId?: string }).assetId };
      },
      validateExistingDevice: async (tenantId, deviceId, _session, recipe) => {
        if (isAgentHostOnboardingRecipe(recipe)) {
          await assertCompatibleAgentHost(tenantId, deviceId, recipe);
          return;
        }
        const detail = await devicesService.get(tenantId, deviceId, 'zh-CN', new Set(['frameworks', 'sites']));
        if (detail.health === 'DISABLED' || detail.health === 'UNREACHABLE' || detail.health === 'UNKNOWN') {
          throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '已有设备当前不可用，请先恢复设备健康状态', {
            code: 'ONBOARDING_DEVICE_UNHEALTHY', deviceId, health: detail.health,
          });
        }
        if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW') {
          await directWorkflowOnboarding.validateDevice(tenantId, deviceId, recipe);
          return;
        }
        const expectedPluginId = recipe.pluginId;
        const actualPluginId = detail.pluginUi?.pluginId;
        if (detail.extension.type !== 'PLUGIN' || (expectedPluginId && actualPluginId !== expectedPluginId)) {
          throw new AppError('VALIDATION_FAILED', '已有设备与所选平台不兼容', {
            code: 'ONBOARDING_DEVICE_INCOMPATIBLE', deviceId, expectedPluginId, actualPluginId,
          });
        }
        const required = [recipe.recipe.capabilities.connectionTest, recipe.recipe.capabilities.discovery];
        const missing = required.filter((capability) => !detail.capabilities.includes(capability));
        if (missing.length > 0) {
          throw new AppError('CAPABILITY_MISSING', '已有设备缺少平台所需能力', { code: 'ONBOARDING_DEVICE_CAPABILITY_MISSING', deviceId, missing });
        }
      },
      listExistingDevices: async (tenantId, _session, recipe) => {
        if (isAgentHostOnboardingRecipe(recipe)) {
          const page = await devicesService.list(tenantId, { page: 1, pageSize: 200, filter: {} });
          const candidates = await Promise.all(page.items.map(async (device) => {
            const unavailable = device.health === 'DISABLED' || device.health === 'UNREACHABLE' || device.health === 'UNKNOWN';
            if (unavailable || device.extensionType !== 'AGENT') return undefined;
            const targets = await listCompatibleAgentManagedTargets(tenantId, device.id, recipe);
            if (targets.length === 0) return undefined;
            return {
              deviceId: device.id,
              displayName: device.displayName,
              address: device.managementAddress,
              health: device.health,
              selectable: true,
            };
          }));
          return candidates.filter((device): device is NonNullable<typeof device> => device !== undefined);
        }
        const directWorkflowDeviceIds = recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW'
          ? await directWorkflowOnboarding.listCompatibleDeviceIds(tenantId, recipe)
          : undefined;
        const required = recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW'
          ? []
          : [recipe.recipe.capabilities.connectionTest, recipe.recipe.capabilities.discovery];
        // 设备摘要的 productFamily 来自插件 Manifest 的 compatibility.productFamilies，
        // 不能用 device.citrix.netscaler-adc 这类插件 ID 直接比较，否则 Citrix 等设备会被错误过滤。
        const productFamilies = recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW'
          ? []
          : resolvePluginDeviceFamilies(await unifiedPluginsService.getVersionForTenant(tenantId, recipe.pluginVersionId));
        const pages = await Promise.all(
          productFamilies.length === 0
            ? [devicesService.list(tenantId, { page: 1, pageSize: 200, filter: {} })]
            : productFamilies.map((productFamily) => devicesService.list(tenantId, {
                page: 1,
                pageSize: 200,
                filter: { productFamily },
              })),
        );
        const compatibleDevices = [...new Map(
          pages.flatMap((page) => page.items).map((device) => [device.id, device]),
        ).values()];
        if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW') {
          return compatibleDevices.map((device) => {
            const unavailable = device.health === 'DISABLED' || device.health === 'UNREACHABLE' || device.health === 'UNKNOWN';
            const compatible = !directWorkflowDeviceIds || directWorkflowDeviceIds.has(device.id);
            return {
              deviceId: device.id,
              displayName: device.displayName,
              address: device.managementAddress,
              health: device.health,
              selectable: compatible && !unavailable,
              reasonCode: !compatible ? 'PLATFORM_TARGET_MISSING' : unavailable ? 'DEVICE_UNHEALTHY' : undefined,
            };
          }).filter((device) => device.selectable);
        }

        // 列表摘要中的 capabilities 来自最近一次发现投影，可能缺少仍由当前插件绑定提供的连接测试能力。
        // 详情的 pluginUi.capabilities 才是当前生效的能力分配；这里复用它，避免把可执行的 Citrix 设备误过滤。
        const candidates = await Promise.all(compatibleDevices.map(async (device) => {
          if (device.health === 'DISABLED' || device.health === 'UNREACHABLE' || device.health === 'UNKNOWN') return undefined;
          let detail;
          try {
            detail = await devicesService.get(tenantId, device.id, 'zh-CN', new Set());
          } catch (cause) {
            // 历史设备可能绑定了已撤销的插件版本；它不应阻断同租户其他设备的候选列表。
            if (cause instanceof AppError && cause.errorCode === 'RESOURCE_NOT_FOUND') return undefined;
            throw cause;
          }
          const unavailable = detail.health === 'DISABLED' || detail.health === 'UNREACHABLE' || detail.health === 'UNKNOWN';
          const compatible = detail.extension.type === 'PLUGIN' && detail.pluginUi?.pluginId === recipe.pluginId;
          const missing = required.filter((capability) => !detail.capabilities.includes(capability));
          if (!compatible || unavailable || missing.length > 0) return undefined;
          return {
            deviceId: detail.id,
            displayName: detail.displayName,
            address: detail.managementAddress,
            health: detail.health,
            selectable: true,
          };
        }));
        return candidates.filter((device): device is NonNullable<typeof device> => device !== undefined);
      },
      supportsDirectWorkflow: (_platformKey, recipe) => directWorkflowOnboarding.supports(recipe),
      testConnection: async (tenantId, session, recipe) => {
        if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW') {
          await directWorkflowOnboarding.test(tenantId, session, recipe);
          return;
        }
        if (session.deviceId && isAgentHostOnboardingRecipe(recipe)) {
          await assertCompatibleAgentHost(tenantId, session.deviceId, recipe);
          return;
        }
        // 非直连配方必须声明连接测试能力；宿主按配方执行，不硬编码能力名，避免破坏其他插件配方。
        const connectionTestCapability = recipe.recipe.capabilities.connectionTest;
        if (!connectionTestCapability) {
          throw new AppError('CAPABILITY_MISSING', '接入配方未声明连接测试能力', {
            code: 'ONBOARDING_CONNECTION_TEST_MISSING',
            platformKey: recipe.recipe.platformKey,
          });
        }
        if (session.deviceId) await devicesService.executeCapability(tenantId, session.deviceId, connectionTestCapability, session.actorId, 'application-onboarding');
      },
      discover: async (tenantId, session, recipe) => {
        if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW') {
          return directWorkflowOnboarding.discover(tenantId, session, recipe);
        }
        if (!session.deviceId) return [];
        if (isAgentHostOnboardingRecipe(recipe)) {
          const targets = await listCompatibleAgentManagedTargets(tenantId, session.deviceId, recipe);
          return targets.map(({ target, site, host, configFingerprint }) => {
            const endpoint = {
              host: site?.hostHeader ?? site?.listenIp ?? host?.hostname ?? host?.primaryIp,
              ...(site?.port ? { port: site.port } : {}),
              ...(site?.protocol ? { protocol: site.protocol } : {}),
            };
            return {
              managedTargetId: target.id,
              targetType: target.targetType,
              displayName: site?.siteName ?? target.targetKey,
              ...(endpoint.host ? { endpoint } : {}),
              configFingerprint,
              selectable: true,
            };
          });
        }
        const detail = await devicesService.get(tenantId, session.deviceId, 'zh-CN', new Set(['frameworks', 'sites']));
        // 插件管理的网络设备没有 Agent 文件配置可供读取；其目标身份由本轮发现的稳定事实计算。
        // Agent Host 走上面的专用分支，仍然只接受真实 configFingerprint，不能使用此回退。
        const allowDerivedTargetFingerprint = detail.extension.type === 'PLUGIN';
        return detail.sites
          .map((site) => mapDiscoveredSiteToOnboardingTarget(site, allowDerivedTargetFingerprint))
          .filter((site) => site.selectable);
      },
      listCertificateOptions: async (tenantId, _session, recipe, certificateAssetId) => {
        // 证书格式由插件配方声明（插件的向导参数）。证书版本本身只保存公钥/私钥材料，
        // 产物在部署时按配置文件 + 证书材料生成；这里只按“平台接受的格式是否需要私钥”过滤版本。
        const accepted = recipe.recipe.certificate.acceptedFormats.map((format) => format.toUpperCase());
        const requiresPrivateKey = accepted.some((format) => certificateKeyRequiredFormats.has(format));
        const assets = (await certificateServices.certificates.listAssets({
          page: 1, pageSize: 100, sort: { field: 'updatedAt', direction: 'desc' }, filter: { status: 'active' },
        }, tenantId)).items;
        if (!certificateAssetId) return { assets, versions: [] };
        const candidates = (await certificateServices.certificates.listVersions({
          page: 1, pageSize: 200, sort: { field: 'notAfter', direction: 'desc' }, filter: { certificateAssetId },
        }, tenantId)).items;
        const versions = candidates.filter((version) => !requiresPrivateKey || version.hasPrivateKey);
        return { assets, versions };
      },
      validateCertificate: async (tenantId, certificateId, certificateVersionId, _session, recipe) => {
        const [asset, version] = await Promise.all([
          certificateServices.certificates.getAssetDetail(certificateId, tenantId),
          certificateServices.certificates.getVersionDetail(certificateVersionId, tenantId),
        ]);
        if (version.asset.id !== asset.id || version.certificateAssetId !== certificateId) {
          throw new AppError('VALIDATION_FAILED', '证书资产与版本不匹配', { code: 'ONBOARDING_CERTIFICATE_VERSION_INVALID', certificateId, certificateVersionId });
        }
        if (asset.status !== 'active' || version.status !== 'active' || !version.deployable || version.activationState !== 'promoted') {
          throw new AppError('VALIDATION_FAILED', '证书版本当前不可部署', { code: 'ONBOARDING_CERTIFICATE_VERSION_INVALID', certificateId, certificateVersionId, assetStatus: asset.status, versionStatus: version.status, deployable: version.deployable, activationState: version.activationState });
        }
        // 平台接受的格式中只要有一种需要私钥（PEM/PFX/JKS），版本就必须持有可部署私钥；
        // 证书版本本身不保存格式产物，产物在部署时按配置文件 + 证书材料按需生成。
        const accepted = recipe.recipe.certificate.acceptedFormats.map((format) => format.toUpperCase());
        const requiresPrivateKey = accepted.some((format) => certificateKeyRequiredFormats.has(format));
        if (requiresPrivateKey && !version.hasPrivateKey) {
          throw new AppError('VALIDATION_FAILED', '证书版本缺少私钥，无法生成平台所需格式制品', { code: 'ONBOARDING_CERTIFICATE_FORMAT_UNSUPPORTED', acceptedFormats: accepted });
        }
      },
    },
    new OnboardingCommitService(assetsService, deploymentPlans.getApplicationService(), pluginWorkflowPublisher, directWorkflowOnboarding, managedTargetPluginQuery),
  );
  new ApplicationOnboardingController(onboardingService, security).register(app.router);
  app.setResource('applicationOnboardingService', onboardingService);
  new SecurityController(security, new AuditPresentationService({
    deploymentPlans: deploymentPlans.getRepository(),
    assets: assetsService.getRepository(),
    bindings: bindingsService.getRepository(),
    secrets: security.secrets,
    certificates: certificateServices.certificates.getRepository(),
  })).register(app.router);
  new CredentialsController(credentialsService, security, credentialHealthService).register(app.router);
  new CredentialHealthController(credentialHealthService, security).register(app.router);
  if (browserCredentialSessionService) {
    const browserCredentialSessionController = new BrowserCredentialSessionController(browserCredentialSessionService, security);
    browserCredentialSessionController.register(app.router);
    app.setResource('browserCredentialSessionController', browserCredentialSessionController);
  }
  const executionsService = deploymentPlans.getExecutionsService();
  tasksService.setExecutionCancellationHandler({
    cancelRun: (runId, actorId, tenantId) => executionsService.cancelRun(runId, actorId, tenantId),
  });
  tasksService.setAgentUpgradeCancellationHandler({
    cancelUpgrade: (tenantId, agentId, planId, actorId, reason) =>
      agentsService.markUpgradeManualRequired(tenantId, agentId, planId, actorId, reason),
  });
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
    if (approval.operationType === 'deployment.execute') {
      const planRef = approval.resourceRefs.find((ref) => ref.type === 'deploymentPlan');
      if (!planRef || !approval.tenantId) return;
      const deploymentService = deploymentPlans.getApplicationService();
      const plan = await deploymentService.get(planRef.id, approval.tenantId);
      const decision = approval.status === 'approved' ? 'approved' : approval.status === 'rejected' ? 'rejected' : undefined;
      if (!decision) return;
      if (decision === 'approved') {
        try {
          const execution = await deploymentService.execute({
            planId: plan.id,
            tenantId: approval.tenantId,
            actorId: approval.requestedBy,
            approvalId: approval.id,
            // 中文说明：同一审批只允许发起一个正式执行 Run，监听器重放也不会重复部署。
            idempotencyKey: `deployment-approval:${approval.id}`,
          });
          await tasksService.resolveApprovalTask(
            approval.tenantId,
            'deploymentPlan',
            plan.id,
            {
              resourceName: plan.name,
              deploymentPlanId: plan.id,
              approvalId: approval.id,
              approvalStatus: decision,
              approvalPending: false,
              status: 'approved',
              executionRunId: execution.run.id,
              executionTaskId: execution.jobId,
            },
            decision,
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          await tasksService.resolveApprovalTask(
            approval.tenantId,
            'deploymentPlan',
            plan.id,
            {
              resourceName: plan.name,
              deploymentPlanId: plan.id,
              approvalId: approval.id,
              approvalStatus: decision,
              approvalPending: false,
              status: 'execution_enqueue_failed',
            },
            decision,
            {
              errorCode: error instanceof AppError ? error.errorCode : 'DEPLOYMENT_EXECUTION_ENQUEUE_FAILED',
              errorMessage: `审批已通过，但未能创建证书部署任务：${errorMessage}`,
            },
          );
        }
        return;
      }
      await tasksService.resolveApprovalTask(
        approval.tenantId,
        'deploymentPlan',
        plan.id,
        {
          resourceName: plan.name,
          deploymentPlanId: plan.id,
          approvalId: approval.id,
          approvalStatus: decision,
          approvalPending: false,
          status: decision,
        },
        decision,
      );
      return;
    }
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
  assetsService.setCertificatesRepository(certificateServices.certificates.getRepository());
  assetsService.setMonitorsRepository(monitorsService.getRepository());

  new CertificatesController(security, certificateServices).register(app.router);
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
  app.setResource('acmeRenewalWorker', acmeRenewalWorker);
  new InternalCaController(internalCaService, security, acmeServices, tasksService, certificateLifecycleService).register(app.router);
  new DeviceAssetsController(deviceAssetsService, new SecurityServicesDeviceAssetPort(security)).register(app.router);
  new DevicesController(devicesService, security).register(app.router);
  new CapabilitiesController(capabilitiesService).register(app.router);
  new AgentsController(agentsService, security, policyProvisioning).register(app.router);
  new GatewaysController(gatewaysService, security).register(app.router);
  const builtinPluginRefreshPromises = new Map<string, Promise<PluginRefreshResult>>();
  const userPluginDirectoryImporter = new UserPluginDirectoryImporter(
    unifiedPluginsService,
    pluginWorkflowPublisher,
  );
  const builtinCatalogRefresher = {
    refresh: (tenantId?: string) => {
      const refreshKey = tenantId ?? '*';
      const existing = builtinPluginRefreshPromises.get(refreshKey);
      if (existing) return existing;
      const refreshPromise = (async () => {
        const beforeBuiltinVersions = await unifiedPluginsService.listBuiltinVersions();
        const beforeUserVersions = tenantId ? await unifiedPluginsService.listVersions(tenantId) : [];
        const beforeVersions = [...beforeBuiltinVersions, ...beforeUserVersions];
        const versions = await initializeBuiltinPlugins(
          unifiedPluginsService,
          pluginWorkflowPublisher,
          { registry: builtinPluginRegistry },
        );
        const userPluginRefresh = tenantId
          ? await userPluginDirectoryImporter.importForTenant(tenantId)
          : { versions: [], attempted: 0, imported: 0, skipped: 0, failed: 0 };
        const refreshedVersions = [...versions, ...userPluginRefresh.versions];
        const projection = await agentsService.reprojectLatestCapabilitySnapshots(tenantId);
        const afterVersions = refreshedVersions.map(toPluginRefreshVersionSnapshot);
        return {
          refreshedAt: new Date().toISOString(),
          versions: afterVersions,
          beforeVersions: beforeVersions.map(toPluginRefreshVersionSnapshot),
          changes: buildPluginRefreshChanges(beforeVersions.map(toPluginRefreshVersionSnapshot), afterVersions),
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
    managedTargetPluginQuery,
    builtinCatalogRefresher,
    tasksService,
    security,
    cloudAccountAssetsService,
    pluginWorkflowPublisher,
  ).register(app.router);
  new GlobalSearchController(globalSearchService, security).register(app.router);
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
    assets: assetsService,
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsService.getRepository(),
    agents: agentsService.getRepository(),
    gateways: gatewaysService.getRepository(),
    audit: security.audit,
    secrets: security.secrets,
    deploymentPlans: deploymentPlans.getRepository(),
    objectPermissions: security.objectPermissions,
    readRepository: new DashboardReadRepository(appDb),
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
    acme: acmeRenewalWorker,
    acmeJobs: acmeRepository,
    executions: executionsService,
    executionRegistry: executorRegistry,
    caSync: app.getResource<CaSyncWorker>('caSyncWorker'),
    automation: automationScheduler,
    automationRuns: automationsService,
    automationEvents: automationEventDelivery,
    monitors: monitorsService,
    notifications: notificationWorker,
    reports: reportExportService,
    agents: agentsService,
    pluginCatalog: builtinCatalogRefresher,
    credentialHealth: credentialHealthService,
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

function resolveProductionAgentTrustMaterialIssuer(
  policyAuthorityServices: ProductionPolicyAuthorityServicesV1 | PolicyAuthorityProcessClientV1 | undefined,
  environment: NodeJS.ProcessEnv,
): AgentTrustMaterialIssuer | undefined {
  if (environment.NODE_ENV !== 'production' || !policyAuthorityServices) return undefined;
  const authority = 'service' in policyAuthorityServices
    ? policyAuthorityServices.service
    : policyAuthorityServices;
  return createProductionAgentTrustMaterialIssuerV1(authority, environment);
}

export async function initializeBuiltinPlugins(
  unifiedPlugins: UnifiedPluginsApplicationService,
  pluginWorkflowPublisher: PluginWorkflowPublisherService,
  options: {
    registry?: BuiltinPluginRegistry;
    logger?: Pick<typeof structuredLogger, 'warn'>;
  } = {},
): Promise<UnifiedPluginVersionRecord[]> {
  const logger = options.logger ?? structuredLogger;
  const registry = options.registry ?? new BuiltinPluginRegistry();
  let installed: UnifiedPluginVersionRecord[];
  try {
    installed = await registry.registerAll(unifiedPlugins);
  } catch (error) {
    warnBuiltinPluginFailure(logger, 'registry', undefined, undefined, error);
    // 已知插件级校验/版本冲突按包隔离；数据库等基础设施错误仍必须阻止启动。
    if (!isPluginScopedInitializationFailure(error)) throw error;
    return [];
  }

  // Registry、Manifest、Policy 和包摘要校验都按插件隔离；Workflow 发布只是已注册版本的派生后处理。
  // 已注册插件的后处理失败只禁用该插件，不把错误抬高到后端启动边界。
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

function readBlockedBuiltinPluginDirectories(environment: NodeJS.ProcessEnv): string[] {
  return (environment.GCAC_BUILTIN_PLUGIN_VERSION_VIOLATIONS ?? '')
    .split(',')
    .map((directory) => directory.trim())
    .filter(Boolean);
}

function isPluginScopedInitializationFailure(error: unknown): boolean {
  return error instanceof AppError && pluginScopedInitializationErrorCodes.has(error.errorCode);
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
  const tasksService = app.getResource<TasksApplicationService>('tasksService');
  if (!tasksService) throw new Error('任务控制面服务未完成应用装配');
  await tasksService.initialize();
  const unifiedPlugins = app.getResource<UnifiedPluginsApplicationService>('unifiedPluginsService');
  const pluginWorkflowPublisher = app.getResource<PluginWorkflowPublisherService>('pluginWorkflowPublisher');
  const builtinPluginRegistry = app.getResource<BuiltinPluginRegistry>('builtinPluginRegistry');
  if (unifiedPlugins && pluginWorkflowPublisher) {
    await initializeBuiltinPlugins(unifiedPlugins, pluginWorkflowPublisher, { registry: builtinPluginRegistry });
  }
  // 每次后端启动时补全宿主默认证书产物配置文件（模板）；幂等且不允许删除。
  const certificateServices = app.getResource<CertificateServices>('certificateServices');
  if (certificateServices?.certificates) {
    try {
      await certificateServices.certificates.ensureDefaultFormatConfigs('system');
    } catch (error) {
      structuredLogger.warn('默认证书产物配置文件补全失败，已继续启动后端', {
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'certificate-default-configs' });
    }
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
  phase: 'registry' | 'load' | 'publishWorkflow' | 'disableAfterPublishWorkflow',
  plugin: { id: string; pluginId: string; version: string } | undefined,
  resourceId: string | undefined,
  error: unknown,
): void {
  logger.warn(
    phase === 'registry'
      ? (isPluginScopedInitializationFailure(error)
        ? '内置插件 Registry 校验失败，已跳过该插件并继续启动'
        : '内置插件 Registry 基础设施错误，启动将失败')
      : '内置插件启动后处理失败，已继续启动后端',
    {
    phase,
    ...(plugin ? { pluginId: plugin.pluginId, version: plugin.version } : {}),
    errorCode: errorCodeOf(error),
    error: errorMessageOf(error),
    }, {
      module: 'builtin-plugin-startup',
      resourceType: 'pluginVersion',
      ...(resourceId ? { resourceId } : {}),
    },
  );
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

function createPluginFactPipeline(
  dependencies: PluginRunnerExecutionDependencies | undefined,
  projector: StandardDeviceDiscoveryProjector,
  executionGrants: Pick<import('./modules/executions/execution-grant.service.js').ExecutionGrantService, 'validate'>,
): PluginFactPipelineService | undefined {
  if (!dependencies?.runner || !dependencies.supervisor) return undefined;
  const runner = new PluginFactRunnerAdapter({
    runner: dependencies.runner,
    supervisor: dependencies.supervisor,
    builtinRegistry: dependencies.builtinRegistry ?? new BuiltinPluginRegistry(),
    ...(dependencies.hostApiHandler ? { hostApiHandler: dependencies.hostApiHandler } : {}),
    executionGrants,
  });
  return new PluginFactPipelineService(runner, projector);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function resolveCloudPluginVersion(
  plugins: Pick<UnifiedPluginsApplicationService, 'listCatalog' | 'getVersionForTenant'>,
  tenantId: string,
  providerKey: string | undefined,
): Promise<UnifiedPluginVersionRecord> {
  if (!providerKey) throw new AppError('VALIDATION_FAILED', 'CLOUD_PROVIDER 凭据必须指定 providerKey 或 pluginVersionId');
  const catalog = await plugins.listCatalog(tenantId, 'zh-CN');
  const candidate = catalog.find((item) => item.pluginId === providerKey
    && item.status === 'ENABLED'
    && item.capabilities.some((capability) => capability.key === 'cloud.service.connection-test'));
  if (!candidate) {
    throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '没有找到已启用且声明 Cloud Provider 连接能力的插件版本', { providerKey });
  }
  return plugins.getVersionForTenant(tenantId, candidate.pluginVersionId);
}

function readCloudCredentialContract(
  form: unknown,
  pluginId: string,
  pluginVersionId: string,
): { kind: 'CLOUD_PROVIDER'; slots: Array<{ name: string; secretType: 'password' | 'api_token' | 'private_key'; required: boolean; labelKey?: string }> } {
  if (!isRecordValue(form) || !isRecordValue(form.credentialContract)) {
    throw new AppError('VALIDATION_FAILED', '插件 Form 未声明 Cloud credentialContract', { pluginId, pluginVersionId });
  }
  const contract = form.credentialContract;
  if (contract.kind !== 'CLOUD_PROVIDER' || !Array.isArray(contract.slots) || contract.slots.length === 0) {
    throw new AppError('VALIDATION_FAILED', '插件 Form 的 Cloud credentialContract 无效', { pluginId, pluginVersionId });
  }
  const slots = contract.slots.map((item, index) => {
    if (!isRecordValue(item)
      || typeof item.name !== 'string'
      || !['password', 'api_token', 'private_key'].includes(String(item.secretType))) {
      throw new AppError('VALIDATION_FAILED', '插件 Form 的 Cloud credentialContract 槽位无效', { pluginId, pluginVersionId, index });
    }
    return {
      name: item.name,
      secretType: item.secretType as 'password' | 'api_token' | 'private_key',
      required: item.required !== false,
      ...(typeof item.labelKey === 'string' ? { labelKey: item.labelKey } : {}),
    };
  });
  return { kind: 'CLOUD_PROVIDER', slots };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Agent 目标必须使用投影保存的真实配置摘要，不能从目标 ID 或时间戳猜测。 */
function configFingerprintFromManagedTargetMetadata(metadata: Record<string, unknown>): string | undefined {
  const certificateLocation = isRecordValue(metadata.certificateLocation) ? metadata.certificateLocation : {};
  const listener = isRecordValue(metadata.listener) ? metadata.listener : {};
  return configFingerprintFromRecords([metadata, certificateLocation, listener]);
}

export function configFingerprintFromDiscoveredSite(site: {
  metadata?: Record<string, unknown>;
  bindings?: Array<{ deploymentTarget?: Record<string, unknown> }>;
}): string | undefined {
  const bindingFacts = (site.bindings ?? []).flatMap((binding) => (
    binding.deploymentTarget ? [binding.deploymentTarget] : []
  ));
  return configFingerprintFromRecords([
    site.metadata ?? {},
    ...bindingFacts,
  ]);
}

/**
 * 网络设备目标没有 Agent 配置文件指纹，不能因为缺少该字段把已发现站点全部隐藏。
 * 这里对稳定发现事实做规范化 SHA-256，作为向导提交时的目标身份摘要；它不是
 * Agent 配置内容指纹，因此只允许插件管理的设备路径使用。
 */
export function discoveredTargetFingerprint(site: {
  id: string;
  siteAssetId?: string;
  managedTargetId?: string;
  kind: string;
  frameworkType: string;
  name: string;
  endpoint?: { address?: string; hostName?: string; port?: number; protocol?: string };
  metadata?: Record<string, unknown>;
}): string | undefined {
  if (!site.managedTargetId) return undefined;
  const facts = {
    apiVersion: 'gcac.discovered-target-identity/v1',
    siteId: site.siteAssetId ?? site.id,
    managedTargetId: site.managedTargetId,
    targetType: site.kind,
    frameworkType: site.frameworkType,
    displayName: site.name,
    endpoint: site.endpoint ?? {},
    metadata: site.metadata ?? {},
  };
  return createHash('sha256').update(canonicalize(facts), 'utf8').digest('hex');
}

export function mapDiscoveredSiteToOnboardingTarget(
  site: {
    id: string;
    siteAssetId: string;
    managedTargetId?: string;
    kind: string;
    frameworkType: string;
    name: string;
    endpoint?: { address?: string; hostName?: string; port?: number; protocol?: string };
    metadata?: Record<string, unknown>;
    bindings?: Array<{ deploymentTarget?: Record<string, unknown> }>;
  },
  allowDerivedTargetFingerprint: boolean,
) {
  const configFingerprint = configFingerprintFromDiscoveredSite(site)
    ?? (allowDerivedTargetFingerprint ? discoveredTargetFingerprint(site) : undefined);
  const selectable = Boolean(site.managedTargetId && configFingerprint);
  return {
    managedTargetId: site.managedTargetId ?? site.id,
    targetType: site.kind,
    displayName: site.name,
    endpoint: site.endpoint ? { host: site.endpoint.hostName ?? site.endpoint.address, port: site.endpoint.port, protocol: site.endpoint.protocol } : undefined,
    configFingerprint: configFingerprint ?? '',
    selectable,
    reasonCode: !site.managedTargetId
      ? 'MANAGED_TARGET_MISSING'
      : configFingerprint
        ? undefined
        : 'CONFIG_FINGERPRINT_MISSING',
  };
}

function configFingerprintFromRecords(records: readonly Record<string, unknown>[]): string | undefined {
  for (const record of records) {
    const value = record.configFingerprint;
    if (typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value.trim())) return value.trim();
  }
  return undefined;
}

function toPluginRefreshVersionSnapshot(version: UnifiedPluginVersionRecord): PluginRefreshVersionSnapshot {
  return {
    id: version.id,
    pluginId: version.pluginId,
    version: version.version,
    status: version.status,
  };
}

export function buildPluginRefreshChanges(
  beforeVersions: readonly PluginRefreshVersionSnapshot[],
  afterVersions: readonly PluginRefreshVersionSnapshot[],
): PluginRefreshChange[] {
  const beforeByPlugin = new Map<string, PluginRefreshVersionSnapshot>();
  const afterByPlugin = new Map<string, PluginRefreshVersionSnapshot>();
  beforeVersions.forEach((version) => {
    const current = beforeByPlugin.get(version.pluginId);
    if (!current || isLaterPluginRefreshVersion(version, current)) beforeByPlugin.set(version.pluginId, version);
  });
  afterVersions.forEach((version) => {
    const current = afterByPlugin.get(version.pluginId);
    if (!current || isLaterPluginRefreshVersion(version, current)) afterByPlugin.set(version.pluginId, version);
  });

  const pluginIds = new Set([...beforeByPlugin.keys(), ...afterByPlugin.keys()]);
  return [...pluginIds].sort((left, right) => left.localeCompare(right)).map((pluginId) => {
    const before = beforeByPlugin.get(pluginId);
    const after = afterByPlugin.get(pluginId);
    const changeType: PluginRefreshChange['changeType'] = !before
      ? 'ADDED'
      : !after
        ? 'REMOVED'
        : before.version !== after.version || before.status !== after.status
          ? 'UPDATED'
          : 'UNCHANGED';
    return {
      pluginId,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      changeType,
    };
  });
}

function isLaterPluginRefreshVersion(
  candidate: PluginRefreshVersionSnapshot,
  current: PluginRefreshVersionSnapshot,
): boolean {
  return compareSemanticVersions(candidate.version, current.version) > 0;
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
    ...getSystemInitializationRouteContracts(),
    ...getSecurityRouteContracts(),
    ...getDeploymentPlanRouteContracts(),
    ...getExecutionRouteContracts(),
    ...getAssetsRouteContracts(),
    ...getApplicationOnboardingRouteContracts(),
    ...getCloudAccountRouteContracts(),
    ...getDeploymentInputRouteContracts(),
    ...getDeviceAssetRouteContracts(),
    ...getDeviceRouteContracts(),
    ...getBindingsRouteContracts(),
    ...getCertificateRouteContracts(),
    ...getInternalCaRouteContracts(),
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
    ...getGlobalSearchRouteContracts(),
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
