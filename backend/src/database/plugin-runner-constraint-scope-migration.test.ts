import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

const packageHash = `sha256:${'a'.repeat(64)}`;
const manifestHash = `sha256:${'b'.repeat(64)}`;

test('Canonical Plugin ID 约束只作用于内置 Agent Plan 版本', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');

    await db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
        scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
        status, permission_approval_status, approved_permissions, validation_report,
        created_at, updated_at
      ) values (
        'user-workflow-v1', 'tenant-user', 'TENANT', 'tenant-user', 'tenant.custom.workflow',
        '1.0.0', 'USER', 'WORKFLOW_DSL', 'BOTH', 'UNSIGNED', 'SELF_MANAGED',
        '{"apiVersion":"gcac.workflow/v1"}'::jsonb, $1, $2, '{}'::jsonb,
        'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
      `, [packageHash, manifestHash]);

    await db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
        scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
        status, permission_approval_status, approved_permissions, validation_report,
        created_at, updated_at
      ) values (
        'user-agent-plan-v1', 'tenant-user', 'TENANT', 'tenant-user', 'tenant.custom.agent-plan',
        'not-semver', 'USER', 'AGENT_PLAN', 'BOTH', 'USER_SIGNED', 'SELF_MANAGED',
        '{"resources":{"agentPlans":{"custom":"plan"}}}'::jsonb, 'not-a-hash', 'not-a-hash', '[]'::jsonb,
        'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
    `);

    await db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
        scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
        status, permission_approval_status, approved_permissions, validation_report,
        created_at, updated_at
      ) values (
        'builtin-agent-plan-v1', 'SYSTEM', 'SYSTEM', null, 'web.nginx',
        '1.0.0', 'BUILTIN', 'AGENT_PLAN', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
        '{"pluginId":"web.nginx","canonicalPluginId":"web.nginx","version":"1.0.0"}'::jsonb,
        $1, $2, '{}'::jsonb, 'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
    `, [packageHash, manifestHash]);

    await db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
        scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
        status, permission_approval_status, approved_permissions, validation_report,
        created_at, updated_at
      ) values (
        'user-trusted-js-v1', 'tenant-user', 'TENANT', 'tenant-user', 'tenant.custom.runtime',
        '1.0.0', 'USER', 'TRUSTED_JS', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
        '{"runtime":"TRUSTED_JS","resources":{"runtimeEntrypoint":"runtime.js"}}'::jsonb,
        $1, $2, '{}'::jsonb, 'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
    `, [packageHash, manifestHash]);

    await db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
        scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
        status, permission_approval_status, approved_permissions, validation_report,
        created_at, updated_at
      ) values (
        'builtin-workflow-v1', 'SYSTEM', 'SYSTEM', null, 'builtin.custom.workflow',
        'not-semver', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
        '{"apiVersion":"gcac.workflow/v1"}'::jsonb, 'not-a-hash', 'not-a-hash', 'null'::jsonb,
        'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
    `);

    await assert.rejects(
      db.query(`
        insert into unified_plugin_versions (
          id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime,
          scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256,
          status, permission_approval_status, approved_permissions, validation_report,
          created_at, updated_at
      ) values (
          'invalid-builtin-agent-plan-v1', 'SYSTEM', 'SYSTEM', null, 'tenant.custom.runner',
          '1.0.0', 'BUILTIN', 'AGENT_PLAN', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
          '{"pluginId":"tenant.custom.runner","canonicalPluginId":"tenant.custom.runner","version":"1.0.0"}'::jsonb,
          $1, $2, '{}'::jsonb, 'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
        )
      `, [packageHash, manifestHash]),
      /ck_unified_plugin_versions_canonical_id|check constraint/i,
    );

    const versions = await db.query<{ id: string; plugin_id: string; runtime: string }>(
      `select id, plugin_id, runtime
         from unified_plugin_versions
        where id in ('user-workflow-v1', 'user-agent-plan-v1', 'builtin-agent-plan-v1')
        order by id`,
    );
    assert.deepEqual(versions.rows, [
      { id: 'builtin-agent-plan-v1', plugin_id: 'web.nginx', runtime: 'AGENT_PLAN' },
      { id: 'user-agent-plan-v1', plugin_id: 'tenant.custom.agent-plan', runtime: 'AGENT_PLAN' },
      { id: 'user-workflow-v1', plugin_id: 'tenant.custom.workflow', runtime: 'WORKFLOW_DSL' },
    ]);

    const canonicalConstraint = await db.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conrelid = 'unified_plugin_versions'::regclass
          and conname = 'ck_unified_plugin_versions_canonical_id'`,
    );
    assert.equal(canonicalConstraint.rows.length, 1);
    assert.match(canonicalConstraint.rows[0].definition, /source.*BUILTIN.*runtime.*AGENT_PLAN/s);
    assert.doesNotMatch(canonicalConstraint.rows[0].definition, /AGENT_ATOMIC/);

    const scopedRunnerConstraints = await db.query<{ conname: string }>(
      `select conname
         from pg_constraint
        where conrelid = 'unified_plugin_versions'::regclass
          and conname in (
            'ck_unified_plugin_versions_plugin_version',
            'ck_unified_plugin_versions_package_sha256',
            'ck_unified_plugin_versions_manifest_sha256',
            'ck_unified_plugin_versions_manifest_object',
            'ck_unified_plugin_versions_resource_hashes',
            'ck_unified_plugin_versions_canonical_id',
            'ck_unified_plugin_versions_runner_manifest'
          )
        order by conname`,
    );
    assert.deepEqual(scopedRunnerConstraints.rows, [
      { conname: 'ck_unified_plugin_versions_canonical_id' },
      { conname: 'ck_unified_plugin_versions_manifest_object' },
      { conname: 'ck_unified_plugin_versions_manifest_sha256' },
      { conname: 'ck_unified_plugin_versions_package_sha256' },
      { conname: 'ck_unified_plugin_versions_plugin_version' },
      { conname: 'ck_unified_plugin_versions_resource_hashes' },
      { conname: 'ck_unified_plugin_versions_runner_manifest' },
    ]);

    const bindingConstraint = await db.query<{ conname: string }>(
      `select conname
         from pg_constraint
        where conrelid = 'plugin_runner_version_bindings'::regclass
          and conname = 'ck_plugin_runner_version_bindings_canonical_id'`,
    );
    assert.deepEqual(bindingConstraint.rows, [{ conname: 'ck_plugin_runner_version_bindings_canonical_id' }]);
  } finally {
    await db.close();
  }
});
