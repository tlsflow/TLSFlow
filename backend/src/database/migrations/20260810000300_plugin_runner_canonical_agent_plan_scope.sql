-- 20260810000300：将 Canonical Plugin ID 约束前向修复到现行内置 Agent Plan。
-- 20260810000100 将该约束错误地限制在 BUILTIN + AGENT_ATOMIC；现行 Runner
-- 由 AGENT_PLAN 承载，因此只调整这一个约束的适用范围。
-- USER 插件和其它运行时继续保留自定义 Plugin ID 能力；先删除再添加保证可重放。

alter table unified_plugin_versions
  drop constraint if exists ck_unified_plugin_versions_canonical_id;

alter table unified_plugin_versions
  add constraint ck_unified_plugin_versions_canonical_id
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_PLAN')
    or status in ('RETIRED', 'QUARANTINED')
    or plugin_id in (
      'web.nginx', 'web.apache', 'web.iis', 'app.tomcat', 'app.java-keystore',
      'app.rabbitmq', 'app.service-certificate-file', 'device.citrix.netscaler-adc',
      'device.synology-dsm', 'cloud.aliyun', 'cloud.tencent', 'cloud.huawei',
      'cloud.volcengine', 'ca.openssl', 'ca.acme', 'ca.microsoft-adcs', 'ca.acme-dns'
    )
  );
