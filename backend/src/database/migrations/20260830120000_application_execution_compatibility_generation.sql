-- 兼容性扫描使用独立代次，并记录对应配置版本；旧扫描不得覆盖新配置结论。
create sequence if not exists application_execution_compatibility_scan_generation_seq;

alter table application_execution_compatibility
  add column if not exists reference_version bigint not null default 0,
  add column if not exists scan_generation bigint not null default 0;

create index if not exists idx_application_execution_compatibility_scan_generation
  on application_execution_compatibility (tenant_id, application_asset_id, scan_generation desc, reference_version desc);
