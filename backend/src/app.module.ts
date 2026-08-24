import { App } from './common/http/app.js';
import type { RouteContract } from './common/openapi/route-contract.js';
import { generateOpenApiDocument } from './common/openapi/openapi-generator.js';
import { getHealthRouteContracts, HealthController } from './modules/health/controller/health.controller.js';
import { DeploymentPlansController, getDeploymentPlanRouteContracts } from './modules/deployment-plans/controller/deployment-plans.controller.js';
import { ExecutionsController, getExecutionRouteContracts } from './modules/executions/controller/executions.controller.js';
import { createSecurityServices, getSecurityRouteContracts, SecurityController, type SecurityServices } from './modules/security/security.controller.js';
import { AssetsController, getAssetsRouteContracts } from './modules/assets/controller/assets.controller.js';
import { BindingsController, getBindingsRouteContracts } from './modules/bindings/controller/bindings.controller.js';
import { CertificatesController, createCertificateServices, getCertificateRouteContracts, type CertificateServices } from './modules/certificates/index.js';
import { CapabilitiesController, getCapabilitiesRouteContracts } from './modules/capabilities/index.js';
import { ProvidersController, getProvidersRouteContracts } from './modules/providers/index.js';
import { MonitorsApplicationService, MonitorsController, getMonitorRouteContracts } from './modules/monitors/index.js';
import { AgentsController, getAgentsRouteContracts } from './modules/agents/index.js';
import { PluginsController, getPluginsRouteContracts } from './modules/plugins/index.js';
import { WorkflowTemplatesController, getWorkflowTemplateRouteContracts } from './modules/workflow-templates/index.js';

export interface AppDependencies {
  security?: SecurityServices;
  deploymentPlans?: DeploymentPlansController;
  certificates?: CertificateServices;
}

export function createApp(dependencies: AppDependencies = {}): App {
  const app = new App();
  const security = dependencies.security ?? createSecurityServices();
  app.setAuthTokenResolver((authorization) => security.auth.parseAuthorizationHeader(authorization));
  new HealthController().register(app.router);
  new SecurityController(security).register(app.router);
  const deploymentPlans = dependencies.deploymentPlans ?? new DeploymentPlansController(undefined, { approval: security.approvals, audit: security.audit });
  deploymentPlans.register(app.router);
  new ExecutionsController(deploymentPlans.getExecutionsService()).register(app.router);
  const assetsController = new AssetsController();
  assetsController.register(app.router);
  const bindingsController = new BindingsController(assetsController.getApplicationService());
  bindingsController.register(app.router);
  const certificateServices = dependencies.certificates ?? createCertificateServices(security);
  new CertificatesController(security, certificateServices).register(app.router);
  new CapabilitiesController().register(app.router);
  new AgentsController().register(app.router);
  new ProvidersController().register(app.router);
  new PluginsController().register(app.router);
  new WorkflowTemplatesController().register(app.router);
  new MonitorsController(new MonitorsApplicationService({
    certificates: certificateServices.certificates.getRepository(),
    bindings: bindingsController.getApplicationService().getRepository(),
    executions: deploymentPlans.getExecutionsService().getRepository(),
  })).register(app.router);

  app.router.get('/api/v1/openapi.json', '获取 OpenAPI 契约', ['System'], async () => ({
    statusCode: 200,
    body: generateOpenApiDocument(getRouteContracts()),
  }));

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
    ...getProvidersRouteContracts(),
    ...getPluginsRouteContracts(),
    ...getWorkflowTemplateRouteContracts(),
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
