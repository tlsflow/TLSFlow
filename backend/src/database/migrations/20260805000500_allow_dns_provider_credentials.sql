-- 允许 ACME DNS-01 使用全局凭据档案保存 Certbot 配置。
-- 历史迁移不可修改，因此通过递增迁移替换原有 kind 检查约束。

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
    'DNS_PROVIDER'
  ));
