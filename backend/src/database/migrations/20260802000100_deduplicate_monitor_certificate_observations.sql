with ranked_observations as (
  select
    id,
    row_number() over (
      partition by coalesce(tenant_id, ''), service_asset_id, upper(regexp_replace(fingerprint_sha256, '[^a-fA-F0-9]', '', 'g'))
      order by observed_at desc, created_at desc, id desc
    ) as row_number
  from pg_monitor_certificate_observations
)
delete from pg_monitor_certificate_observations observations
using ranked_observations ranked
where observations.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists uq_pg_monitor_certificate_observations_version
  on pg_monitor_certificate_observations (
    coalesce(tenant_id, ''),
    service_asset_id,
    upper(regexp_replace(fingerprint_sha256, '[^a-fA-F0-9]', '', 'g'))
  );
