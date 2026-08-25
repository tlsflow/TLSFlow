-- 003.6：内置 CA 的 CRL Number 状态和不可变发布制品。
create table if not exists pg_ca_crl_states (
  tenant_id text not null,
  ca_id text not null references pg_certificate_authorities(id) on delete cascade,
  next_crl_number bigint not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, ca_id),
  constraint pg_ca_crl_states_number_check check (next_crl_number > 0)
);

create table if not exists pg_ca_crl_publications (
  id text primary key,
  tenant_id text not null,
  ca_id text not null references pg_certificate_authorities(id) on delete cascade,
  crl_number bigint not null,
  this_update timestamptz not null,
  next_update timestamptz not null,
  distribution_point text,
  crl_fingerprint_sha256 text not null,
  publication_status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint pg_ca_crl_publications_status_check check (publication_status in ('published', 'failed', 'unknown')),
  constraint pg_ca_crl_publications_window_check check (next_update > this_update),
  unique (tenant_id, ca_id, crl_number)
);
create index if not exists idx_ca_crl_publications_latest on pg_ca_crl_publications (tenant_id, ca_id, crl_number desc);
