import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import { AgentsController } from './agents.controller.js';
import type { AgentsApplicationService } from '../application/agents.application-service.js';
import type { AgentPlanPolicyProvisioningServiceV1 } from '../security/policy-authority-provisioning.service.js';

test('Policy Authority provisioning 路由读取 policy-provisioning 路径中的 Agent 身份', async () => {
  const plan = JSON.parse(readFileSync(
    resolve(process.cwd(), 'src/modules/agents/security/fixtures/agent-security.valid.json'),
    'utf8',
  )).contracts.AgentPlanV1 as Record<string, unknown>;
  let receivedAgentId: string | undefined;
  const policyProvisioning = {
    provision: async (input: { agentId: string }) => {
      receivedAgentId = input.agentId;
      return { revision: 'provisioning-test' };
    },
  } as unknown as AgentPlanPolicyProvisioningServiceV1;
  const router = new Router();
  new AgentsController({} as AgentsApplicationService, undefined, policyProvisioning).register(router);
  const route = router.match('POST', '/api/v1/agents/agent-1/policy-provisioning');
  assert.ok(route);

  const request: HttpRequest = {
    method: 'POST',
    path: '/api/v1/agents/agent-1/policy-provisioning',
    query: {},
    headers: {},
    body: {
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-1',
      capability: 'filesystem.read',
      planDigest: 'd727a546983d32de1c857a6d5c00f25e1723fd20f05549bd49e81f3adc432bca',
      policyRef: 'policy-1',
      policyVersion: 'v1',
      actions: ['filesystem.read'],
      allowedPaths: ['/var/lib/gcac'],
      allowedServices: [],
      commandRules: [],
      artifactDigests: ['a'.repeat(64)],
      lifetimeSeconds: 300,
      compiledPlan: plan,
    },
    context: { requestId: 'request-test', traceId: 'trace-test', tenantId: 'tenant-1' },
  };

  const response = await route.handler(request) as { statusCode: number; body: { revision: string } };
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.revision, 'provisioning-test');
  assert.equal(receivedAgentId, 'agent-1');
});
