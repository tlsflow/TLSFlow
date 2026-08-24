-- 20260608 安全基线数据表骨架
-- 说明：这里是 PostgreSQL 方向的迁移草案，当前实现使用内存 Repository，后续接入数据库时按本结构落表。
-- 铁律：Secret 表和审计表都不得保存任何可还原明文。

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  status TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT secrets_scope_required CHECK (scope_type = 'global' OR scope_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS secret_versions (
  id TEXT PRIMARY KEY,
  secret_id TEXT NOT NULL REFERENCES secrets(id),
  version_no INTEGER NOT NULL,
  encrypted_data TEXT NOT NULL,
  encrypted_dek TEXT NOT NULL,
  kek_version TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  dek_iv TEXT NOT NULL,
  dek_auth_tag TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(secret_id, version_no)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  builtin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permission_policies (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  effect TEXT NOT NULL,
  actions JSONB NOT NULL,
  resource_types JSONB NOT NULL,
  scope JSONB NOT NULL,
  conditions JSONB
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  resource_refs JSONB NOT NULL,
  risk_level TEXT NOT NULL,
  parameter_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  comment TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  request_id TEXT,
  source_ip TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_grants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  executor_type TEXT NOT NULL,
  allowed_secret_refs JSONB NOT NULL,
  allowed_actions JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secret_versions_secret ON secret_versions(secret_id);
CREATE INDEX IF NOT EXISTS idx_permission_subject ON permission_policies(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status, risk_level);
CREATE INDEX IF NOT EXISTS idx_audit_query ON audit_logs(created_at, event_type, actor_id, resource_type, resource_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_execution_grants_context ON execution_grants(run_id, step_id, executor_type, status);
