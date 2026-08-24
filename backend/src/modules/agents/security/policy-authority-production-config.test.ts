import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import { validateProductionPolicyAuthorityConfigV1 } from './policy-authority-production-config.js';

const schema = JSON.parse(readFileSync(
  resolve(process.cwd(), 'src/modules/agents/security/schemas/policy-authority-production-v1.schema.json'),
  'utf8',
)) as JsonSchema;

test('生产部署配置验证器缺少显式环境或角色时失败关闭', () => {
  assert.throws(
    () => validateProductionPolicyAuthorityConfigV1({ NODE_ENV: 'test', GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'standalone' }),
    /production|失败关闭/,
  );
  assert.throws(
    () => validateProductionPolicyAuthorityConfigV1({ NODE_ENV: 'production' }),
    /PROCESS_ROLE|失败关闭/,
  );
});

test('生产部署 Schema 要求 Bootstrap，且区分宿主与 standalone 角色', () => {
  const validHostConfig = {
    NODE_ENV: 'production',
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'host',
    GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH: 'C:/node.exe',
    GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY: 'C:/app',
    GCAC_POLICY_AUTHORITY_ARGS_JSON: '["dist/modules/agents/security/policy-authority-process.js"]',
    GCAC_POLICY_AUTHORITY_ROOT_KEY_ID: 'root-key-1',
    GCAC_POLICY_AUTHORITY_ID: 'authority-1',
    GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----',
    GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256: 'a'.repeat(64),
    GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: '{}',
    GCAC_POLICY_AUTHORITY_KEYSET_JSON: '{}',
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: '{}',
    GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON: '{}',
    GCAC_POLICY_AUTHORITY_STATE_FILE: 'C:/state.json',
  };
  assert.equal(validateJsonSchema(validHostConfig, schema).valid, true);

  const missingBootstrap = { ...validHostConfig };
  delete (missingBootstrap as Record<string, unknown>).GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON;
  assert.equal(validateJsonSchema(missingBootstrap, schema).valid, false);

  const standaloneWithoutProcessSpec = {
    ...validHostConfig,
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'standalone',
  };
  delete (standaloneWithoutProcessSpec as Record<string, unknown>).GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH;
  delete (standaloneWithoutProcessSpec as Record<string, unknown>).GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY;
  delete (standaloneWithoutProcessSpec as Record<string, unknown>).GCAC_POLICY_AUTHORITY_ARGS_JSON;
  assert.equal(validateJsonSchema(standaloneWithoutProcessSpec, schema).valid, true);
});
