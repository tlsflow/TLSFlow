import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type {
  DeploymentInputProjectionWorkflowOverride,
  DeploymentPlansApplicationService,
} from '../../deployment-plans/application/deployment-plans.application-service.js';
import { DeploymentInputProjectionService } from '../application/deployment-input-projection.service.js';

export class DeploymentInputProjectionController {
  constructor(
    private readonly plans: DeploymentPlansApplicationService,
    private readonly service = new DeploymentInputProjectionService(),
  ) {}

  register(router: Router): void {
    router.post('/api/v1/deployment-inputs/projection', '生成统一部署输入投影', ['Deployment Inputs'], (request) => this.project(request));
  }

  private async project(request: HttpRequest) {
    const body = validateObject(request.body, {
      applicationAssetId: { type: 'string', required: true },
      workflow: { type: 'object' },
    });
    const workflow = body.workflow && typeof body.workflow === 'object' && !Array.isArray(body.workflow)
      ? normalizeWorkflowOverride(body.workflow as Record<string, unknown>)
      : undefined;
    const source = await this.plans.resolveProjectionSource({
      applicationAssetId: String(body.applicationAssetId),
      tenantId: request.context.tenantId,
      ...(workflow ? { workflow } : {}),
    });
    return this.service.project(source);
  }
}

function normalizeWorkflowOverride(value: Record<string, unknown>): DeploymentInputProjectionWorkflowOverride {
  return {
    workflowTemplateId: String(value.workflowTemplateId ?? ''),
    workflowVersionId: String(value.workflowVersionId ?? ''),
    ...(typeof value.pluginVersionId === 'string' ? { pluginVersionId: value.pluginVersionId } : {}),
    ...(value.inputBindings && typeof value.inputBindings === 'object' && !Array.isArray(value.inputBindings)
      ? { inputBindings: value.inputBindings as DeploymentInputProjectionWorkflowOverride['inputBindings'] }
      : {}),
  };
}

export function getDeploymentInputRouteContracts() {
  return [{ method: 'POST' as const, path: '/api/v1/deployment-inputs/projection', operationId: 'projectDeploymentInputs', summary: '生成统一部署输入投影', tags: ['Deployment Inputs'], responseSchema: { type: 'object', additionalProperties: true } }];
}
