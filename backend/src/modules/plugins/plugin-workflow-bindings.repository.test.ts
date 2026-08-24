import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { WorkflowTemplatesDomainService } from '../workflow-templates/domain/workflow-templates.domain-service.js';
import { PluginWorkflowBindingsRepository } from './repository/plugin-workflow-bindings.repository.js';
import { insertCanonicalPluginVersion } from './plugin-test-fixtures.js';

test('插件 Workflow 绑定重复保存时更新完整的派生目标', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations', {
      checksum: (content) => createHash('sha256').update(content, 'utf8').digest('hex'),
    });
    const tenantId = 'tenant_plugin_workflow_repository_test';
    const pluginVersionId = 'plugin-version-binding-upsert';
    await insertCanonicalPluginVersion(db, pluginVersionId, tenantId);

    const workflows = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(
        new PgDocumentRepository(db, 'workflow.templates'),
        new PgDocumentRepository(db, 'workflow.template_versions'),
      ),
    );
    const firstContent = workflowContent('1.0.0', 'binding-upsert-v1');
    const secondContent = workflowContent('1.0.1', 'binding-upsert-v2');
    const internal = await workflows.createPluginTemplate({ content: firstContent });
    const firstVersion = await workflows.publishPluginVersion(internal.version.id);
    const secondDraft = await workflows.createPluginInternalDraftVersion({
      templateId: internal.template.id,
      content: secondContent,
    });
    const secondVersion = await workflows.publishPluginVersion(secondDraft.id);
    const repository = new PluginWorkflowBindingsRepository(db);

    await repository.save({
      pluginVersionId,
      ownerType: 'SYSTEM',
      capabilityKey: 'certificate.deploy',
      workflowKey: 'certificate.deploy',
      workflowResourcePath: 'workflows/deploy.json',
      workflowTemplateId: internal.template.id,
      workflowVersionId: firstVersion.id,
      workflowContentSha256: firstVersion.contentHash,
      createdAt: new Date().toISOString(),
    });
    await repository.save({
      pluginVersionId,
      ownerType: 'TENANT',
      ownerId: tenantId,
      capabilityKey: 'certificate.deploy',
      workflowKey: 'certificate.deploy',
      workflowResourcePath: 'workflows/deploy-v2.json',
      workflowTemplateId: internal.template.id,
      workflowVersionId: secondVersion.id,
      workflowContentSha256: secondVersion.contentHash,
      createdAt: new Date().toISOString(),
    });

    const loaded = await repository.find(pluginVersionId, 'certificate.deploy', 'certificate.deploy');
    assert.deepEqual(loaded && {
      ownerType: loaded.ownerType,
      ownerId: loaded.ownerId,
      workflowResourcePath: loaded.workflowResourcePath,
      workflowTemplateId: loaded.workflowTemplateId,
      workflowVersionId: loaded.workflowVersionId,
      workflowContentSha256: loaded.workflowContentSha256,
    }, {
      ownerType: 'TENANT',
      ownerId: tenantId,
      workflowResourcePath: 'workflows/deploy-v2.json',
      workflowTemplateId: internal.template.id,
      workflowVersionId: secondVersion.id,
      workflowContentSha256: secondVersion.contentHash,
    });
  } finally {
    await db.close();
  }
});

function workflowContent(version: string, name: string) {
  return {
    apiVersion: 'gcac.workflow/v1' as const,
    kind: 'CurlSshWorkflow' as const,
    metadata: { name, version },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1' as const,
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    },
    steps: [{ name: 'wait', type: 'wait' as const, seconds: 1 }],
  };
}
