import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getRouteContracts } from '../../app.module.js';
import { generateOpenApiDocument } from './openapi-generator.js';

describe('OpenAPI 契约', () => {
  it('包含基础接口和统一错误响应 Schema', () => {
    const doc = generateOpenApiDocument(getRouteContracts(), new Date('2026-06-08T00:00:00.000Z'));
    assert.equal(doc.openapi, '3.1.0');
    assert.ok((doc.paths as Record<string, unknown>)['/api/v1/health']);
    assert.ok((doc.paths as Record<string, unknown>)['/api/v1/openapi.json']);
    const components = doc.components as { schemas: Record<string, unknown> };
    assert.ok(components.schemas.ErrorResponse);
    assert.ok(components.schemas.PageResponse);
  });

  it('生成的 OpenAPI 文件可以被读取', () => {
    const file = join(process.cwd(), 'openapi', 'openapi.json');
    if (!existsSync(file)) return;
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { paths: Record<string, unknown> };
    assert.ok(doc.paths['/api/v1/health']);
  });
});
