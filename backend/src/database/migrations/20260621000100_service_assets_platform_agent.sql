alter table pg_service_assets add column if not exists platform varchar(16);
alter table pg_service_assets add column if not exists agent_id text;

create index if not exists idx_pg_service_assets_agent on pg_service_assets (tenant_id, agent_id);
