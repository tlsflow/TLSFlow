import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import type { WorkflowTemplate, WorkflowTemplateVersion } from './dto/workflow-templates.dto.js';

describe('WorkflowTemplates 持久化', () => {
  it('模板和版本写入 PG 后，重建服务仍可恢复', async () => {
    const db = new PgliteDatabase();
    const templates = new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates');
    const versions = new PgDocumentRepository<WorkflowTemplateVersion>(db, 'workflow.template_versions');
    const first = new WorkflowTemplatesDomainService(templates, versions);

    const created = await first.createTemplate({
      changeSummary: '初始版本',
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'persisted-template' },
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {
            host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          },
          connections: {},
          credentials: {},
          artifacts: {},
        },
        steps: [{ name: 'wait', type: 'wait', seconds: 1 }],
      },
    });

    const rebuilt = new WorkflowTemplatesDomainService(templates, versions);
    const listed = await rebuilt.listTemplates();
    const listedVersions = await rebuilt.listVersions(created.template.id);

    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.template.id);
    assert.equal(listedVersions.length, 1);
    assert.equal(listedVersions[0].id, created.version.id);
  });
});
