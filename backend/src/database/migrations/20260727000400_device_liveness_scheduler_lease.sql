create table if not exists pg_device_liveness_scheduler_leases (
  lease_key text primary key,
  owner_id text not null,
  leased_until timestamptz not null,
  updated_at timestamptz not null default now()
);
