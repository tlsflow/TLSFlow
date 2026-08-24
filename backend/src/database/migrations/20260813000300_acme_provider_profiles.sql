-- ACME Provider Profile 和最小 EAB SecretRef 合同。
-- 只新增字段并回填非敏感配置，不修改历史迁移。

alter table if exists pg_acme_accounts
  add column if not exists eab_secret_ref text;

create index if not exists idx_pg_acme_accounts_eab_secret
  on pg_acme_accounts (tenant_id, eab_secret_ref)
  where eab_secret_ref is not null;

update pg_ca_providers provider
set payload = jsonb_set(
    coalesce(provider.payload, '{}'::jsonb),
    '{configuration}',
    (
      coalesce(provider.payload->'configuration', '{}'::jsonb)
      || jsonb_build_object(
        'profileKey',
        case
          when coalesce(provider.payload->'configuration'->>'profileKey', provider.payload->'configuration'->>'preset') in (
            'letsencrypt', 'zerossl', 'google-trust-services', 'digicert', 'sectigo', 'ssl-com', 'step-ca', 'ejbca', 'custom'
          )
          then coalesce(provider.payload->'configuration'->>'profileKey', provider.payload->'configuration'->>'preset')
          when provider.endpoint = 'https://acme-v02.api.letsencrypt.org/directory' then 'letsencrypt'
          when provider.endpoint = 'https://acme.zerossl.com/v2/DV90' then 'zerossl'
          when provider.endpoint = 'https://dv.acme-v02.api.pki.goog/directory' then 'google-trust-services'
          else 'custom'
        end,
        'profileVersion',
        '2026-08-13.1',
        'verificationLevel',
        coalesce(provider.payload->'configuration'->>'verificationLevel', 'unconfigured')
      )
    )
  ),
  updated_at = now()
where provider.type = 'acme';
