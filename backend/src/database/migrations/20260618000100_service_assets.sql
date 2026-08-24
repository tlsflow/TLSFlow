create table if not exists pg_service_assets (
  id text primary key,
  tenant_id text not null,
  address varchar(255) not null,
  address_type varchar(16) not null,
  port integer not null,
  protocol varchar(16) not null,
  sni_name varchar(255),
  display_name varchar(255),
  service_instance_id text references pg_service_instances(id),
  service_endpoint_id text references pg_service_endpoints(id),
  host_id text,
  environment varchar(32),
  discovery_source varchar(32) not null,
  last_discovered_at timestamptz,
  status varchar(32) not null,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists uq_pg_service_assets_active_identity
  on pg_service_assets (tenant_id, address, port, protocol)
  where deleted_at is null;
create index if not exists idx_pg_service_assets_service_instance on pg_service_assets (tenant_id, service_instance_id);
create index if not exists idx_pg_service_assets_service_endpoint on pg_service_assets (tenant_id, service_endpoint_id);
create index if not exists idx_pg_service_assets_host on pg_service_assets (tenant_id, host_id);
create index if not exists idx_pg_service_assets_status on pg_service_assets (tenant_id, status);

alter table pg_certificate_bindings add column if not exists service_asset_id text references pg_service_assets(id);
create index if not exists idx_pg_certificate_bindings_service_asset on pg_certificate_bindings (tenant_id, service_asset_id);

with candidate_assets as (
  select distinct
    cb.tenant_id,
    lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, ''))) as address,
    case
      when lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), '')) ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then 'IPV4'
      when position(':' in lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), ''))) > 0 then 'IPV6'
      when coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, '')) is null then 'UNKNOWN'
      else 'DNS'
    end as address_type,
    coalesce(cb.port, se.port) as port,
    upper(coalesce(nullif(cb.protocol, ''), nullif(se.protocol, ''), 'HTTPS')) as protocol,
    lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''))) as sni_name,
    coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, '')) as display_name,
    cb.service_instance_id,
    cb.service_endpoint_id,
    cb.host_id,
    cb.discovery_source,
    cb.created_at,
    cb.updated_at
  from pg_certificate_bindings cb
  left join pg_service_endpoints se on se.id = cb.service_endpoint_id
  where cb.deleted_at is null
    and coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, '')) is not null
    and coalesce(cb.port, se.port) is not null
), inserted_assets as (
  insert into pg_service_assets (
    id, tenant_id, address, address_type, port, protocol, sni_name, display_name,
    service_instance_id, service_endpoint_id, host_id, discovery_source, last_discovered_at,
    status, tags, metadata, created_at, updated_at, version
  )
  select
    'sat_legacy_' || substr(md5(candidate_assets.tenant_id || ':' || candidate_assets.address || ':' || candidate_assets.port || ':' || candidate_assets.protocol), 1, 24),
    candidate_assets.tenant_id,
    candidate_assets.address,
    candidate_assets.address_type,
    candidate_assets.port,
    candidate_assets.protocol,
    candidate_assets.sni_name,
    candidate_assets.display_name,
    candidate_assets.service_instance_id,
    candidate_assets.service_endpoint_id,
    candidate_assets.host_id,
    coalesce(candidate_assets.discovery_source, 'IMPORT'),
    candidate_assets.updated_at,
    'ACTIVE',
    '[]'::jsonb,
    '{}'::jsonb,
    candidate_assets.created_at,
    candidate_assets.updated_at,
    1
  from candidate_assets
  on conflict (tenant_id, address, port, protocol) where deleted_at is null do nothing
  returning id
)
update pg_certificate_bindings cb
set service_asset_id = sa.id
from pg_service_assets sa,
     pg_service_endpoints se
where cb.tenant_id = sa.tenant_id
  and cb.deleted_at is null
  and cb.service_asset_id is null
  and sa.deleted_at is null
  and se.id = cb.service_endpoint_id
  and sa.address = lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, '')))
  and sa.port = coalesce(cb.port, se.port)
  and sa.protocol = upper(coalesce(nullif(cb.protocol, ''), nullif(se.protocol, ''), 'HTTPS'));
