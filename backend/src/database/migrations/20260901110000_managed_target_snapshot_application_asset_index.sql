-- 中文说明：确保按应用资产读取快照时始终有租户+应用资产联合索引。
CREATE INDEX IF NOT EXISTS idx_pg_managed_target_snapshots_application_asset
  ON pg_managed_target_snapshots (tenant_id, application_asset_id, captured_at DESC);
