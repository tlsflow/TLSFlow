-- 浏览器临时凭据会话：为分享链接增加一次性会话密码哈希。

alter table browser_credential_sessions
  add column if not exists share_password_salt text,
  add column if not exists share_password_hash text;
