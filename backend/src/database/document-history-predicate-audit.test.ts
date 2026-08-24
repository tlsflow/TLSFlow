import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('高基数文档仓储禁止回退到无界 predicate 列表', () => {
  const highRiskSources = [
    new URL('../modules/agents/repository/agents.repository.ts', import.meta.url),
    new URL('../modules/devices/repository/devices.repository.ts', import.meta.url),
    new URL('../modules/executions/repository/executions.repository.ts', import.meta.url),
    new URL('../modules/deployment-plans/repository/deployment-plans.repository.ts', import.meta.url),
  ];
  for (const sourceUrl of highRiskSources) {
    const source = readFileSync(sourceUrl, 'utf8');
    assert.doesNotMatch(source, /\.list\(\s*(?:async\s*)?\(/, sourceUrl.pathname);
  }

  const gatewaySource = readFileSync(new URL('../modules/gateway-agents/gateway-target-history.service.ts', import.meta.url), 'utf8');
  const pgRepositorySource = gatewaySource.slice(
    gatewaySource.indexOf('export class PgGatewayTargetHistoryRepository'),
    gatewaySource.indexOf('export class RepositoryGatewayTargetHistoryRepository'),
  );
  assert.doesNotMatch(pgRepositorySource, /\.list\(\s*(?:async\s*)?\(/, 'PgGatewayTargetHistoryRepository');
});
