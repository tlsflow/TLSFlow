import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { DeploymentInputProjectionService } from '../application/deployment-input-projection.service.js';
import type { BuildDeploymentInputProjectionRequest } from '../dto/deployment-input-projection.dto.js';

export class DeploymentInputProjectionController {
  constructor(private readonly service = new DeploymentInputProjectionService()) {}

  register(router: Router): void {
    router.post('/api/v1/deployment-inputs/projection', '生成统一部署输入投影', ['Deployment Inputs'], (request) => this.project(request));
  }

  private project(request: HttpRequest) {
    const body = validateObject(request.body, { contract: { type: 'object', required: true }, resolvedInput: { type: 'object', required: true } }) as unknown as BuildDeploymentInputProjectionRequest;
    return this.service.project(body);
  }
}

export function getDeploymentInputRouteContracts() {
  return [{ method: 'POST' as const, path: '/api/v1/deployment-inputs/projection', operationId: 'projectDeploymentInputs', summary: '生成统一部署输入投影', tags: ['Deployment Inputs'], responseSchema: { type: 'object', additionalProperties: true } }];
}
