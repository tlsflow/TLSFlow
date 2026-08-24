alter table pg_service_instances rename to pg_framework_instances;

alter table pg_framework_instances rename column host_id to device_id;
alter table pg_framework_instances rename column provider_type to discovery_provider_key;
alter table pg_framework_instances rename column provider_key to framework_key;
alter table pg_framework_instances add column framework_type varchar(192);

alter table pg_site_assets rename column service_instance_id to framework_instance_id;
alter table pg_site_assets rename column host_id to device_id;
alter table pg_site_assets rename column provider_type to discovery_provider_key;

alter table pg_managed_targets drop constraint if exists ck_pg_managed_targets_owner;
alter table pg_managed_targets drop constraint if exists pg_managed_targets_target_type_check;
alter table pg_managed_targets rename column host_id to device_id;
alter table pg_managed_targets rename column service_instance_id to framework_instance_id;
alter table pg_managed_targets rename column site_asset_id to site_id;
alter table pg_managed_targets rename column provider_type to discovery_provider_key;
alter table pg_managed_targets add column supported_capabilities jsonb;
alter table pg_managed_targets add column execution_locations jsonb;
alter table pg_managed_targets alter column framework_type drop not null;

create table pg_data_correction_batches (
  id varchar(128) primary key,
  spec_id varchar(32) not null check (spec_id = '033.4'),
  operator_id varchar(128) not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  status varchar(32) not null check (status in ('STARTED', 'VERIFIED', 'FAILED')),
  before_summary jsonb not null default '{}'::jsonb,
  after_summary jsonb not null default '{}'::jsonb,
  script_sha256 varchar(64) not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index idx_pg_data_correction_batches_spec_status
  on pg_data_correction_batches (spec_id, status, started_at desc);

create index idx_pg_framework_instances_correction
  on pg_framework_instances (tenant_id, device_id, discovery_provider_key, framework_key)
  where deleted_at is null;

create index idx_pg_site_assets_correction
  on pg_site_assets (tenant_id, device_id, framework_instance_id, site_key)
  where deleted_at is null;

create index idx_pg_managed_targets_correction
  on pg_managed_targets (tenant_id, device_id, framework_instance_id, site_id, target_key)
  where deleted_at is null;
