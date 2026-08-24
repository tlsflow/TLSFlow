import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import type { SecurityServices } from '../security/security.controller.js';
import { securityErrors } from '../../shared/security-error.js';
import { WorkflowTemplatesController } from './controller/workflow-templates.controller.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import type { WorkflowDslV1 } from './dto/workflow-templates.dto.js';

test('系统内置工作流在租户上下文下保持 SYSTEM 所有权并可按对象授权访问', async () => {
  const service = new WorkflowTemplatesApplicationService();
  const content = workflowContent('builtin-workflow');
  const builtin = await service.createPluginTemplate({ content });
  const capturedObjects: Array<{ objectType: string; objectId: string; tenantId?: string; ownerType?: string }> = [];
  const app = new App({ allowLegacyHeaderContext: true });
  new WorkflowTemplatesController(service, routeSecurity({
    allowedObjectIds: { workflow: [builtin.template.id] },
    captureObjects: capturedObjects,
  })).register(app.router);

  const listResponse = await app.inject({
    method: 'GET',
    path: '/api/v1/workflows',
    headers: actorHeaders(),
  });
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual((listResponse.body as { items: Array<{ id: string }> }).items.map((item) => item.id), [builtin.template.id]);

  const versionsResponse = await app.inject({
    method: 'GET',
    path: `/api/v1/workflow-template-versions?templateId=${builtin.template.id}`,
    headers: actorHeaders(),
  });
  assert.equal(versionsResponse.statusCode, 200);
  assert.equal((versionsResponse.body as { items: Array<{ templateId: string }> }).items[0]?.templateId, builtin.template.id);
  assert.deepEqual(capturedObjects.at(-1), {
    objectType: 'workflow',
    objectId: builtin.template.id,
    ownerType: 'SYSTEM',
    tenantId: undefined,
  });
});

function actorHeaders(): Record<string, string> {
  return { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' };
}

function routeSecurity(options: {
  allowedObjectIds?: Record<string, string[]>;
  captureObjects?: Array<{ objectType: string; objectId: string; tenantId?: string; ownerType?: string }>;
} = {}): SecurityServices {
  return {
    rbac: {
      assertCan: async () => undefined,
    } as never,
    objectPermissions: {
      assertCan: async (subject: { id: string }, _accessLevel: string, object: { objectType: string; objectId: string }) => {
        options.captureObjects?.push(object as { objectType: string; objectId: string; tenantId?: string; ownerType?: string });
        const allowed = options.allowedObjectIds?.[object.objectType];
        if (allowed && !allowed.includes(object.objectId)) {
          throw securityErrors.permissionDenied({ actorId: subject.id, object });
        }
      },
      buildAuthorizedQuery: async (_subject: unknown, objectType: string) => {
        const allowed = options.allowedObjectIds?.[objectType] ?? [];
        return {
          tenantIds: ['tenant-1'],
          ownerTypes: ['TENANT', 'SYSTEM'],
          objectIds: allowed,
          dynamicConditions: [],
          empty: allowed.length === 0,
          unrestricted: false,
        };
      },
    } as never,
  } as unknown as SecurityServices;
}

function workflowContent(name: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    },
    steps: [{ name: 'manual_1', type: 'manual', instruction: '确认' }],
  };
}
