import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
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
    const body = validateObject(request.body, { applicationAssetId: { type: 'string', required: true } });
    const source = await this.plans.resolveProjectionSource({ applicationAssetId: String(body.applicationAssetId), tenantId: request.context.tenantId });
    return this.service.project(source);
  }
}

export function getDeploymentInputRouteContracts() {
  return [{ method: 'POST' as const, path: '/api/v1/deployment-inputs/projection', operationId: 'projectDeploymentInputs', summary: '生成统一部署输入投影', tags: ['Deployment Inputs'], responseSchema: { type: 'object', additionalProperties: true } }];
}
