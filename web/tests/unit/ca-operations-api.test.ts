import { describe, expect, it } from 'vitest'
import { caOperationsApi } from '@/api/modules/ca-operations.api'

describe('CA 运营 API', () => {
  it('只暴露资源树、记录查询和记录详情，不再暴露旧同步运行接口', () => {
    expect(Object.keys(caOperationsApi)).toEqual(['tree', 'records', 'record'])
  })
})
