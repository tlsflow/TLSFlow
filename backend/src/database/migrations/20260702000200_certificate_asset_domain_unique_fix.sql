-- 修复证书域名唯一化迁移后的空 SAN 列表。
-- 20260702000100 已在部分环境执行，不能再改内容；后续补丁必须进入新迁移。

update pg_certificate_assets
set sans = '[]'::jsonb,
    updated_at = now()
where sans is null;
