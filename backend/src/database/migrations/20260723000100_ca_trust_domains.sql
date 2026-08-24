create table if not exists pg_ca_trust_domains (
  id text primary key,
  tenant_id text not null,
  name text not null,
  code text not null,
  purpose text not null,
  status text not null,
  is_default boolean not null default false,
  isolation_level text not null default 'standard',
  root_policy jsonb not null default '{}'::jsonb,
  trust_policy jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_ca_trust_domains_tenant_name
  on pg_ca_trust_domains (tenant_id, lower(name));
create unique index if not exists uq_pg_ca_trust_domains_tenant_code
  on pg_ca_trust_domains (tenant_id, code);
create unique index if not exists uq_pg_ca_trust_domains_tenant_default
  on pg_ca_trust_domains (tenant_id)
  where is_default = true and status not in ('retired', 'compromised');

alter table pg_certificate_authorities
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);
alter table pg_certificate_profiles
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);
alter table pg_certificate_requests
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);
alter table pg_certificate_versions
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);
alter table pg_certificate_revocations
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);
alter table pg_trust_distributions
  add column if not exists trust_domain_id text references pg_ca_trust_domains(id);

create index if not exists idx_pg_ca_authorities_trust_domain
  on pg_certificate_authorities (tenant_id, trust_domain_id, status);
create index if not exists idx_pg_ca_profiles_trust_domain
  on pg_certificate_profiles (tenant_id, trust_domain_id, status);
create index if not exists idx_pg_ca_requests_trust_domain
  on pg_certificate_requests (tenant_id, trust_domain_id, created_at desc);
create index if not exists idx_pg_certificate_versions_trust_domain
  on pg_certificate_versions (trust_domain_id, status);

insert into pg_ca_trust_domains (
  id, tenant_id, name, code, purpose, status, is_default, isolation_level,
  root_policy, trust_policy, payload, created_at, updated_at
)
select
  'catd_' || substr(md5(a.tenant_id || ':' || a.id), 1, 24),
  a.tenant_id,
  a.name || ' 信任域',
  'root_' || substr(md5(a.tenant_id || ':' || a.id), 1, 24),
  case when a.security_domain = 'production' then 'production_tls' else 'legacy_root' end,
  case when a.status = 'active' then 'active' else 'draft' end,
  false,
  'standard',
  '{}'::jsonb,
  '{}'::jsonb,
  jsonb_build_object('migrationSource', '20260723000100_ca_trust_domains', 'rootAuthorityId', a.id),
  a.created_at,
  a.updated_at
from pg_certificate_authorities a
where a.role = 'root' or a.parent_ca_id is null
on conflict (id) do nothing;

with recursive authority_lineage as (
  select a.id, a.id as root_id, a.tenant_id
  from pg_certificate_authorities a
  where a.role = 'root' or a.parent_ca_id is null
  union all
  select child.id, lineage.root_id, child.tenant_id
  from pg_certificate_authorities child
  join authority_lineage lineage on lineage.id = child.parent_ca_id
)
update pg_certificate_authorities authority
set trust_domain_id = domain.id,
    payload = authority.payload || jsonb_build_object('trustDomainId', domain.id)
from authority_lineage lineage
join pg_ca_trust_domains domain
  on domain.tenant_id = lineage.tenant_id
 and domain.code = 'root_' || substr(md5(lineage.tenant_id || ':' || lineage.root_id), 1, 24)
where authority.id = lineage.id
  and authority.trust_domain_id is null;

update pg_certificate_profiles profile
set trust_domain_id = candidates.trust_domain_id,
    payload = profile.payload || jsonb_build_object('trustDomainId', candidates.trust_domain_id)
from (
  select profile_inner.id, min(authority.trust_domain_id) as trust_domain_id
  from pg_certificate_profiles profile_inner
  join pg_certificate_authorities authority
    on authority.tenant_id = profile_inner.tenant_id
   and authority.security_domain = profile_inner.security_domain
   and authority.trust_domain_id is not null
  group by profile_inner.id
  having count(distinct authority.trust_domain_id) = 1
) candidates
where profile.id = candidates.id
  and profile.trust_domain_id is null;

update pg_certificate_requests request
set trust_domain_id = authority.trust_domain_id,
    payload = request.payload || jsonb_build_object('trustDomainId', authority.trust_domain_id)
from pg_certificate_authorities authority
where request.ca_id = authority.id
  and request.trust_domain_id is null;

update pg_certificate_versions version
set trust_domain_id = authority.trust_domain_id
from pg_certificate_authorities authority
where version.issuing_ca_id = authority.id
  and version.trust_domain_id is null;

update pg_certificate_revocations revocation
set trust_domain_id = authority.trust_domain_id,
    payload = revocation.payload || jsonb_build_object('trustDomainId', authority.trust_domain_id)
from pg_certificate_authorities authority
where revocation.ca_id = authority.id
  and revocation.trust_domain_id is null;

update pg_trust_distributions distribution
set trust_domain_id = authority.trust_domain_id,
    payload = distribution.payload || jsonb_build_object('trustDomainId', authority.trust_domain_id)
from pg_certificate_authorities authority
where distribution.ca_id = authority.id
  and distribution.trust_domain_id is null;
