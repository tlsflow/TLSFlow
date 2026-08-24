alter table if exists pg_gateway_zones drop constraint if exists pg_gateway_zones_pkey;

alter table if exists pg_gateway_zones
  add constraint pg_gateway_zones_pkey primary key (tenant_id, id);
