-- 004.5：项目未发布，旧插件存储不再承担任何运行期职责。
-- 00100/00200 已经把当前记录改写或隔离；这里删除旧存储表，避免未来代码重新读取历史旁路。
-- 这是新的前向迁移，不修改任何已执行的历史迁移文件。

drop table if exists provider_registry;
drop table if exists plugin_packages;
drop table if exists legacy_plugin_migration_results;
