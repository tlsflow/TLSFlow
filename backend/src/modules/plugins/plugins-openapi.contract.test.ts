import assert from 'node:assert/strict';
import test from 'node:test';
import { getPluginsRouteContracts, validatePluginRequestObject } from './controller/plugins.controller.js';
import { generateOpenApiDocument } from '../../common/openapi/openapi-generator.js';

const legacyFields = ['providerKey', 'supportedProducts', 'supportedOperations'];
const identityFields = ['pluginId', 'pluginVersionId', 'version', 'manifestSha256', 'packageSha256', 'resourceSha256'];

test('插件写入端点公开严格请求 Schema', () => {
  const writeRoutes = getPluginsRouteContracts().filter((route) => ['POST', 'PATCH', 'PUT'].includes(route.method) && route.operationId !== 'refreshBuiltinPluginCatalog');
  for (const route of writeRoutes) {
    assert.ok(route.requestSchema, `${route.operationId} 必须声明 requestSchema`);
    assert.equal(route.requestSchema?.additionalProperties, false, `${route.operationId} 必须拒绝未声明顶层字段`);
  }
});

test('插件版本响应明确声明固定身份和三类摘要', () => {
  const contracts = getPluginsRouteContracts();
  const versionRoutes = contracts.filter((route) => [
    'listPluginCatalog', 'listUnifiedPluginVersions', 'listPluginVersionGroups', 'getPluginVersionManagementDetail',
    'importUnifiedPluginVersion', 'approveUnifiedPluginPermissions', 'enableUnifiedPluginVersion', 'disableUnifiedPluginVersion', 'retireUnifiedPluginVersion',
  ].includes(route.operationId));
  for (const route of versionRoutes) {
    const schema = route.responseSchema;
    assert.ok(schema, `${route.operationId} 必须声明响应 Schema`);
    const encoded = JSON.stringify(schema);
    for (const field of identityFields) assert.match(encoded, new RegExp(`"${field}"`), `${route.operationId} 缺少 ${field}`);
  }
});

test('插件公开合同不包含 Provider/product 执行旁路', () => {
  const encoded = JSON.stringify(getPluginsRouteContracts());
  for (const field of legacyFields) assert.equal(encoded.includes(field), false, `公开合同不应包含 ${field}`);
});

test('插件合同不使用未约束的 additionalProperties 布尔开放对象', () => {
  const openPaths: string[] = [];
  const visit = (schema: unknown, path: string): void => {
    if (!schema || typeof schema !== 'object') return;
    const value = schema as Record<string, unknown>;
    if (value.type === 'object' && value.additionalProperties === true) openPaths.push(path);
    if (value.properties && typeof value.properties === 'object') {
      for (const [key, child] of Object.entries(value.properties)) visit(child, `${path}.properties.${key}`);
    }
    if (value.items) visit(value.items, `${path}.items`);
  };
  for (const route of getPluginsRouteContracts()) {
    visit(route.requestSchema, `${route.operationId}.request`);
    visit(route.responseSchema, `${route.operationId}.response`);
  }
  assert.deepEqual(openPaths, []);
});

test('插件请求校验拒绝旧字段和未声明顶层字段', () => {
  const schema = { pluginVersionId: { type: 'string' as const, required: true } };
  for (const field of legacyFields) {
    assert.throws(
      () => validatePluginRequestObject({ pluginVersionId: 'version-1', [field]: 'legacy' }, schema),
      /未声明字段/,
    );
  }
  assert.deepEqual(validatePluginRequestObject({ pluginVersionId: 'version-1' }, schema), { pluginVersionId: 'version-1' });
});

test('插件路由合同可以由 OpenAPI 生成器直接编译', () => {
  const routes = getPluginsRouteContracts();
  const document = generateOpenApiDocument(routes, new Date('2026-08-09T00:00:00.000Z'));
  const paths = document.paths as Record<string, Record<string, { operationId: string }>>;
  for (const route of routes) {
    assert.equal(paths[route.path]?.[route.method.toLowerCase()]?.operationId, route.operationId);
  }
});
