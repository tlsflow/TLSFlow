import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('高基数文档仓储禁止回退到无界 predicate 列表', () => {
  const readSource = (relativePath: string): string => {
    const compiledUrl = new URL(`../${relativePath.replace(/\.ts$/, '.js')}`, import.meta.url);
    if (existsSync(compiledUrl)) return readFileSync(compiledUrl, 'utf8');
    return readFileSync(new URL(`../../src/${relativePath}`, import.meta.url), 'utf8');
  };
  const highRiskSources = [
    'modules/agents/repository/agents.repository.ts',
    'modules/devices/repository/devices.repository.ts',
    'modules/executions/repository/executions.repository.ts',
    'modules/deployment-plans/repository/deployment-plans.repository.ts',
  ];
  for (const relativePath of highRiskSources) {
    const source = readSource(relativePath);
    assert.doesNotMatch(source, /\.list\(\s*(?:async\s*)?\(/, relativePath);
  }

  const gatewaySource = readSource('modules/gateway-agents/gateway-target-history.service.ts');
  const pgRepositorySource = gatewaySource.slice(
    gatewaySource.indexOf('export class PgGatewayTargetHistoryRepository'),
    gatewaySource.indexOf('export class RepositoryGatewayTargetHistoryRepository'),
  );
  assert.doesNotMatch(pgRepositorySource, /\.list\(\s*(?:async\s*)?\(/, 'PgGatewayTargetHistoryRepository');
});
