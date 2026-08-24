import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createProductionAgentLocalPolicyAdapterV1 } from '../modules/agents/security/production-agent-local-policy.adapter.js';
import { validateProductionPolicyAuthorityConfigV1 } from '../modules/agents/security/policy-authority-production-config.js';
import { ensureProductionRuntimeSecurityEnvironment } from './production-runtime-secrets.js';

const generatedKeys = [
  'GCAC_POLICY_AUTHORITY_ROOT_KEY_ID',
  'GCAC_POLICY_AUTHORITY_ID',
  'GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256',
  'GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON',
  'GCAC_POLICY_AUTHORITY_KEYSET_JSON',
  'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON',
  'GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_KEY_ID',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256',
  'GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON',
] as const;

test('生产首启生成加密材料，并可由现有校验器恢复', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-runtime-secrets-'));
  try {
    const environment = createEnvironment(directory);
    ensureProductionRuntimeSecurityEnvironment(environment);
    const first = snapshot(environment);
    const secretsFile = environment.GCAC_RUNTIME_SECRETS_FILE!;

    assert.equal(existsSync(secretsFile), true);
    assert.doesNotMatch(readFileSync(secretsFile, 'utf8'), /BEGIN (?:RSA |EC |)PRIVATE KEY/);
    assert.equal(validateProductionPolicyAuthorityConfigV1(environment).status, 'valid');
    createProductionAgentLocalPolicyAdapterV1(environment);

    for (const key of generatedKeys) delete environment[key];
    ensureProductionRuntimeSecurityEnvironment(environment);
    assert.deepEqual(snapshot(environment), first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('生产首启拒绝部分注入的策略材料', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-runtime-secrets-partial-'));
  try {
    const environment = createEnvironment(directory);
    environment.GCAC_POLICY_AUTHORITY_ID = 'manually-configured';
    assert.throws(
      () => ensureProductionRuntimeSecurityEnvironment(environment),
      /生产安全材料配置不完整/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GCAC_SECRET_KEK: 'unit-test-runtime-kek',
    GCAC_RUNTIME_SECRETS_FILE: join(directory, 'runtime-secrets.enc'),
    GCAC_POLICY_AUTHORITY_STATE_FILE: join(directory, 'policy-authority-state.json'),
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'host',
    GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH: process.execPath,
    GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY: process.cwd(),
    GCAC_POLICY_AUTHORITY_ARGS_JSON: JSON.stringify([resolve('dist/modules/agents/security/policy-authority-process.js')]),
  };
}

function snapshot(environment: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(generatedKeys.map((key) => [key, environment[key]]));
}
