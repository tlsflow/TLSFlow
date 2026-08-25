-- 003.6：证书换钥轮换账本。只追加新表，不修改历史迁移。
create table if not exists pg_certificate_rotations (
  id text primary key,
  tenant_id text not null,
  application_asset_id text not null,
  source_certificate_version_id text not null,
  source_key_reference_id text,
  target_key_reference_id text,
  target_certificate_request_id text,
  target_certificate_version_id text,
  policy_version_id text,
  idempotency_key text not null,
  status text not null,
  evidence jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  requested_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint pg_certificate_rotations_status_check check (status in ('requested', 'key_csr_pending', 'issuing', 'install_pending', 'deploying', 'cutover_verified', 'revoke_pending', 'completed', 'failed', 'unknown')),
  unique (tenant_id, idempotency_key)
);
create index if not exists idx_certificate_rotations_asset on pg_certificate_rotations (tenant_id, application_asset_id, created_at desc);
