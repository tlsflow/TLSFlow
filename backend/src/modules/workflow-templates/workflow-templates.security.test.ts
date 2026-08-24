import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { App } from '../../common/http/app.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { SecurityServices } from '../security/security.controller.js';
import { securityErrors } from '../../shared/security-error.js';
import { PluginWorkflowBindingsRepository } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import { WorkflowTemplatesController } from './controller/workflow-templates.controller.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import type { WorkflowDslV1, WorkflowTemplate, WorkflowTemplateVersion } from './dto/workflow-templates.dto.js';

test('系统内置工作流在租户上下文下保持 SYSTEM 所有权并可按对象授权访问', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, fileURLToPath(new URL('../../database/migrations/', import.meta.url)), {
    appliedBy: 'test',
    checksum: (value) => createHash('sha256').update(value).digest('hex'),
  });
  const service = new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(
      new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates'),
      new PgDocumentRepository<WorkflowTemplateVersion>(db, 'workflow.template_versions'),
    ),
    {},
    new PluginWorkflowBindingsRepository(db),
  );
  const content = workflowContent('builtin-workflow');
  const builtin = await service.createPluginTemplate({ content });
  const capturedObjects: Array<{ objectType: string; objectId: string; tenantId?: string; ownerType?: string }> = [];
  const app = configureTestAuth(new App());
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
    path: `/api/v1/workflows/${builtin.template.id}/versions`,
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
  return testAuthHeaders('user_admin', 'tenant-1');
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
