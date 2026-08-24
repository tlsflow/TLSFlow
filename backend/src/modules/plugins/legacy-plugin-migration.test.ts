import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('旧插件资源由最新前向清理迁移直接清退，不进入运行期迁移', async () => {
  const sql = await readFile(resolve(process.cwd(), 'src/database/migrations/20260809000500_database_forward_cleanup.sql'), 'utf8');

  assert.match(sql, /resource\.resource_path like 'agent-recipes\/%'/);
  assert.match(sql, /resource\.resource_path like 'action-aliases\/%'/);
  assert.match(sql, /delete from unified_plugin_resources/i);
  assert.match(sql, /set status = 'RETIRED'/i);
});
