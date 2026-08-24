// 高频查询基线。测试会检查这里声明的索引存在，防止迁移退化成全表扫描。
export const queryBaselines = [
  {
    name: '证书过期风险查询',
    tableName: 'certificate_versions',
    indexName: 'idx_certificate_versions_not_after',
    exampleSql: 'select * from certificate_versions where tenant_id = $1 and not_after < $2 order by not_after asc limit $3'
  },
  {
    name: '按域名查询证书绑定',
    tableName: 'certificate_bindings',
    indexName: 'idx_certificate_bindings_domain',
    exampleSql: 'select * from certificate_bindings where tenant_id = $1 and domain_name = $2 and deleted_at is null'
  },
  {
    name: '按观测指纹反查绑定',
    tableName: 'certificate_bindings',
    indexName: 'idx_certificate_bindings_observed_fp',
    exampleSql: 'select * from certificate_bindings where tenant_id = $1 and observed_fingerprint_sha256 = $2'
  },
  {
    name: '风险绑定列表',
    tableName: 'certificate_bindings',
    indexName: 'idx_certificate_bindings_status_verified',
    exampleSql: 'select * from certificate_bindings where tenant_id = $1 and status in ($2, $3) order by last_verified_at desc limit $4'
  },
  {
    name: '能力匹配查询',
    tableName: 'target_capabilities',
    indexName: 'idx_target_capabilities_lookup',
    exampleSql: 'select * from target_capabilities where tenant_id = $1 and target_type = $2 and target_id = $3'
  },
  {
    name: '部署调度查询',
    tableName: 'deployment_plans',
    indexName: 'idx_deployment_plans_status_schedule',
    exampleSql: 'select * from deployment_plans where tenant_id = $1 and status = $2 and scheduled_at <= $3 order by scheduled_at asc'
  },
  {
    name: '执行运行幂等写入',
    tableName: 'execution_runs',
    indexName: 'uq_execution_runs_idempotency',
    exampleSql: 'select * from execution_runs where tenant_id = $1 and idempotency_key = $2'
  },
  {
    name: '风险视图',
    tableName: 'risk_events',
    indexName: 'idx_risk_events_view',
    exampleSql: 'select * from risk_events where tenant_id = $1 and status = $2 order by severity, detected_at desc'
  },
  {
    name: '资源审计追踪',
    tableName: 'audit_events',
    indexName: 'idx_audit_events_resource',
    exampleSql: 'select * from audit_events where tenant_id = $1 and resource_type = $2 and resource_id = $3 order by created_at desc'
  }
] as const;
