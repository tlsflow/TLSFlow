import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAgentAuthorizationServicesV1 } from './local-agent-authorization.service.js';

test('本机 Agent Authority 只签发固定 Web 目录的短期只读发现授权', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-local-authority-'));
  try {
    const services = createLocalAgentAuthorizationServicesV1({
      NODE_ENV: 'development',
      GCAC_LOCAL_AGENT_AUTHORITY_DIR: directory,
    });
    assert.ok(services);

    const allowed = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-happy',
      tenantId: 'tenant-happy',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-happy',
      capability: 'application.discover',
      actions: ['filesystem.read', 'process.list', 'service.list'],
      allowedPaths: ['/etc', '/opt'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'gcac.agent.discovery',
      policyVersion: '1',
      planDigest: 'a'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(allowed.decision.allowed, true);
    assert.ok(allowed.token);
    assert.equal(allowed.token?.actions.length, 3);

    const denied = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-happy',
      tenantId: 'tenant-happy',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-happy',
      capability: 'application.discover',
      actions: ['filesystem.read', 'process.list', 'service.list'],
      allowedPaths: ['/tmp'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'gcac.agent.discovery',
      policyVersion: '1',
      planDigest: 'b'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(denied.decision.allowed, false);
    assert.equal(denied.token, undefined);

    const material = await services.trustMaterialIssuer.issue({ tenantId: 'tenant-happy', agentId: 'agt-happy' }) as {
      localPolicy: { agentId: string; allowedActions: string[] };
      capabilityKeySet: Record<string, string>;
    };
    assert.equal(material.localPolicy.agentId, 'agt-happy');
    assert.deepEqual(material.localPolicy.allowedActions.sort(), ['filesystem.read', 'process.list', 'service.list']);
    assert.deepEqual(material.capabilityKeySet, services.trustMaterialIssuer.getTrustedKeySet());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
