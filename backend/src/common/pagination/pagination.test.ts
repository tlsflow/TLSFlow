import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../errors/app-error.js';
import { parsePageQuery } from './pagination.js';

describe('分页查询解析', () => {
  it('解析默认分页参数', () => {
    const query = parsePageQuery({}, { allowedSortFields: ['createdAt'], allowedFilterFields: ['status'] });
    assert.deepEqual(query, { page: 1, pageSize: 20, sort: undefined, filter: {} });
  });

  it('解析排序和过滤白名单', () => {
    const query = parsePageQuery(
      { page: '2', pageSize: '50', sort: 'createdAt:desc', 'filter[status]': 'ACTIVE' },
      { allowedSortFields: ['createdAt'], allowedFilterFields: ['status'] },
    );
    assert.equal(query.page, 2);
    assert.equal(query.pageSize, 50);
    assert.deepEqual(query.sort, { field: 'createdAt', direction: 'desc' });
    assert.deepEqual(query.filter, { status: 'ACTIVE' });
  });

  it('拒绝超出上限的 pageSize', () => {
    assert.throws(() => parsePageQuery({ pageSize: '201' }, { maxPageSize: 200 }), AppError);
  });

  it('拒绝不在白名单内的 sort 字段', () => {
    assert.throws(() => parsePageQuery({ sort: 'password:desc' }, { allowedSortFields: ['createdAt'] }), AppError);
  });
});
