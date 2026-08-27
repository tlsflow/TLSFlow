-- PASSWORD Credential：仅保存一个 password Secret Slot，不要求用户名或投递位置。
alter table public.credential_profiles
  drop constraint if exists credential_profiles_kind_check;

alter table public.credential_profiles
  add constraint credential_profiles_kind_check check (
    kind = any (array[
      'PASSWORD'::text,
      'USERNAME_PASSWORD'::text,
      'SSH_KEY'::text,
      'BEARER_TOKEN'::text,
      'API_KEY'::text,
      'CLIENT_CERTIFICATE'::text,
      'DNS_PROVIDER'::text,
      'CLOUD_PROVIDER'::text,
      'BROWSER_SESSION'::text
    ])
  );
