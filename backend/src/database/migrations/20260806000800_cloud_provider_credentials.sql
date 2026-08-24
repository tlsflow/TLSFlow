-- 云 Provider 凭据保存厂商要求的独立密文字段，避免滥用 HTTP API Key 投递模型。

alter table credential_profiles
  drop constraint if exists credential_profiles_kind_check;

alter table credential_profiles
  add constraint credential_profiles_kind_check
  check (kind in (
    'USERNAME_PASSWORD',
    'SSH_KEY',
    'BEARER_TOKEN',
    'API_KEY',
    'CLIENT_CERTIFICATE',
    'DNS_PROVIDER',
    'CLOUD_PROVIDER',
    'BROWSER_SESSION'
  ));
