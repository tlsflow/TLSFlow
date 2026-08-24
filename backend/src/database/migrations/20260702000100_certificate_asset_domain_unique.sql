-- 证书资产以证书域名为唯一逻辑资产；同一域名下挂多个证书版本。
-- 历史数据可能已经把同一 primary_domain 拆成多个资产，先把版本归并到最早创建的资产，再加唯一约束。

with ranked_assets as (
  select
    id,
    lower(primary_domain) as domain_key,
    first_value(id) over (partition by lower(primary_domain) order by created_at asc, id asc) as canonical_id
  from pg_certificate_assets
  where status <> 'deleted'
),
moving_versions as (
  select
    version.id,
    ranked_assets.canonical_id,
    row_number() over (partition by ranked_assets.canonical_id order by version.created_at asc, version.id asc) as move_no
  from pg_certificate_versions version
  join ranked_assets on ranked_assets.id = version.certificate_asset_id
  where ranked_assets.id <> ranked_assets.canonical_id
),
canonical_version_counts as (
  select
    ranked_assets.canonical_id,
    coalesce(max(version.version_no), 0) as base_no
  from ranked_assets
  left join pg_certificate_versions version on version.certificate_asset_id = ranked_assets.canonical_id
  group by ranked_assets.canonical_id
)
update pg_certificate_versions version
set certificate_asset_id = moving_versions.canonical_id,
    version_no = canonical_version_counts.base_no + moving_versions.move_no
from moving_versions
join canonical_version_counts on canonical_version_counts.canonical_id = moving_versions.canonical_id
where version.id = moving_versions.id;

with duplicate_assets as (
  select
    id,
    first_value(id) over (partition by lower(primary_domain) order by created_at asc, id asc) as canonical_id
  from pg_certificate_assets
  where status <> 'deleted'
)
update pg_certificate_assets canonical
set sans = (
      select jsonb_agg(distinct value)
      from (
        select jsonb_array_elements_text(coalesce(canonical.sans, '[]'::jsonb)) as value
        union
        select jsonb_array_elements_text(coalesce(duplicate.sans, '[]'::jsonb)) as value
        from pg_certificate_assets duplicate
        where lower(duplicate.primary_domain) = lower(canonical.primary_domain)
          and duplicate.id <> canonical.id
      ) values
    ),
    updated_at = now()
from duplicate_assets marker
where canonical.id = marker.canonical_id;

with ranked_assets as (
  select
    id,
    first_value(id) over (partition by lower(primary_domain) order by created_at asc, id asc) as canonical_id
  from pg_certificate_assets
  where status <> 'deleted'
)
delete from pg_certificate_assets asset
using ranked_assets ranked
where asset.id = ranked.id
  and ranked.id <> ranked.canonical_id
  and not exists (
    select 1
    from pg_certificate_versions version
    where version.certificate_asset_id = asset.id
  );

create unique index if not exists uq_pg_certificate_assets_primary_domain_active
  on pg_certificate_assets (lower(primary_domain))
  where status <> 'deleted';
