-- 迁移目的：为当前证书模块使用的 pg_* 表补齐租户归属和跨租户父子约束。
-- 历史兼容：这些表创建时只有默认单租户语义，没有可供推断的租户字段。
-- 因此既有记录统一归入 tenants.code='default' 对应的租户，保留证书数据本身不变。
-- 后续新记录必须显式携带租户，不能再依赖跨租户全局唯一约束。

do $$
declare
  default_tenant_id text;
begin
  select id::text
    into default_tenant_id
    from tenants
   where code = 'default'
     and deleted_at is null;

  if default_tenant_id is null then
    raise exception '默认租户不存在，无法建立证书表租户隔离';
  end if;

  alter table pg_certificate_assets
    add column if not exists tenant_id text;
  alter table pg_certificate_versions
    add column if not exists tenant_id text;
  alter table pg_certificate_version_formats
    add column if not exists tenant_id text;
  alter table pg_certificate_artifacts
    add column if not exists tenant_id text;

  update pg_certificate_assets
     set tenant_id = default_tenant_id
   where tenant_id is null;
  update pg_certificate_versions
     set tenant_id = default_tenant_id
   where tenant_id is null;
  update pg_certificate_version_formats
     set tenant_id = default_tenant_id
   where tenant_id is null;
  update pg_certificate_artifacts
     set tenant_id = default_tenant_id
   where tenant_id is null;

  -- 让历史直接写入路径继续可用，但默认值只指向已解析的 default UUID。
  execute format(
    'alter table pg_certificate_assets alter column tenant_id set default %L',
    default_tenant_id
  );
  execute format(
    'alter table pg_certificate_versions alter column tenant_id set default %L',
    default_tenant_id
  );
  execute format(
    'alter table pg_certificate_version_formats alter column tenant_id set default %L',
    default_tenant_id
  );
  execute format(
    'alter table pg_certificate_artifacts alter column tenant_id set default %L',
    default_tenant_id
  );

  alter table pg_certificate_assets alter column tenant_id set not null;
  alter table pg_certificate_versions alter column tenant_id set not null;
  alter table pg_certificate_version_formats alter column tenant_id set not null;
  alter table pg_certificate_artifacts alter column tenant_id set not null;

  -- 复合外键依赖被引用列上的唯一索引，必须先于外键创建。
  create unique index if not exists uq_pg_certificate_assets_tenant_id
    on pg_certificate_assets (tenant_id, id);
  create unique index if not exists uq_pg_certificate_versions_tenant_id
    on pg_certificate_versions (tenant_id, id);

  alter table pg_certificate_versions
    drop constraint if exists pg_certificate_versions_tenant_asset_fk;
  alter table pg_certificate_versions
    add constraint pg_certificate_versions_tenant_asset_fk
    foreign key (tenant_id, certificate_asset_id)
    references pg_certificate_assets (tenant_id, id);

  alter table pg_certificate_version_formats
    drop constraint if exists pg_certificate_version_formats_tenant_version_fk;
  alter table pg_certificate_version_formats
    add constraint pg_certificate_version_formats_tenant_version_fk
    foreign key (tenant_id, certificate_version_id)
    references pg_certificate_versions (tenant_id, id);
end
$$;

-- 旧索引按全局唯一约束建立，必须先删除后按租户重建。
drop index if exists uq_pg_certificate_assets_primary_domain_active;
drop index if exists uq_pg_certificate_versions_fingerprint;
drop index if exists uq_pg_certificate_versions_fingerprint_active;
drop index if exists uq_pg_certificate_versions_asset_version;
drop index if exists uq_pg_certificate_version_formats_natural;

create unique index if not exists uq_pg_certificate_assets_tenant_domain
  on pg_certificate_assets (tenant_id, lower(primary_domain))
  where status <> 'deleted';

create unique index if not exists uq_pg_certificate_versions_tenant_asset_version
  on pg_certificate_versions (tenant_id, certificate_asset_id, version_no);

create unique index if not exists uq_pg_certificate_versions_tenant_fingerprint
  on pg_certificate_versions (tenant_id, fingerprint_sha256);

create unique index if not exists uq_pg_certificate_version_formats_tenant_natural
  on pg_certificate_version_formats (tenant_id, certificate_version_id, format, parameter_hash);

create unique index if not exists uq_pg_certificate_assets_tenant_id
  on pg_certificate_assets (tenant_id, id);

create unique index if not exists uq_pg_certificate_versions_tenant_id
  on pg_certificate_versions (tenant_id, id);

create index if not exists idx_pg_certificate_assets_tenant_status
  on pg_certificate_assets (tenant_id, status, created_at desc);

create index if not exists idx_pg_certificate_versions_tenant_asset
  on pg_certificate_versions (tenant_id, certificate_asset_id, status, created_at desc);

create index if not exists idx_pg_certificate_versions_tenant_not_after
  on pg_certificate_versions (tenant_id, not_after);

create index if not exists idx_pg_certificate_version_formats_tenant_version
  on pg_certificate_version_formats (tenant_id, certificate_version_id, created_at desc);

alter table pg_certificate_artifacts
  drop constraint if exists pg_certificate_artifacts_pkey;
alter table pg_certificate_artifacts
  add constraint pg_certificate_artifacts_pkey primary key (tenant_id, artifact_ref);

create index if not exists idx_pg_certificate_artifacts_tenant_created
  on pg_certificate_artifacts (tenant_id, created_at desc);
