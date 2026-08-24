import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from './pg-document-repository.js';

describe('PgDocumentRepository', () => {
  it('将外部输入中的 NUL 替换为 JSONB 可存储字符', async () => {
    const repository = new PgDocumentRepository<{ id: string; detail: { content: string } }>(new PgliteDatabase(), 'test.jsonb-nul');

    await repository.upsert({
      id: 'document-with-nul',
      detail: { content: 'before\u0000after' },
    });

    assert.deepEqual(await repository.get('document-with-nul'), {
      id: 'document-with-nul',
      detail: { content: 'before\uFFFDafter' },
    });
  });
});
