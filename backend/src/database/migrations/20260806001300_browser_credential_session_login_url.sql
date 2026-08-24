-- 浏览器临时凭据会话：保存用户本次输入的认证地址。

alter table browser_credential_sessions
  add column if not exists login_url text;
