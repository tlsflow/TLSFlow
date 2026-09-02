import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/";

const zhSidebar = [
  {
    text: "一、安装部署",
    link: "/installation/",
    items: [
      { text: "快速开始", link: "/installation/quick-start" },
      { text: "标准部署", link: "/installation/standard-deployment" },
      { text: "单机部署", link: "/installation/single-node-deployment" },
      { text: "部署参数", link: "/installation/deployment-parameters" },
      { text: "首次登录", link: "/installation/first-login" },
    ]
  },
  {
    text: "二、用户手册",
    link: "/manual/",
    items: [
      { text: "仪表盘", link: "/manual/dashboard" },
      { text: "快速开始（仪表盘）", link: "/manual/dashboard-quick-start" },
      {
        text: "证书管理",
        link: "/manual/certificate-management",
        items: [
          { text: "证书资产", link: "/manual/certificate-assets" },
          { text: "ACME 自动化", link: "/manual/acme-automation" },
          { text: "CA 操作", link: "/manual/ca-operations" },
          { text: "证书格式配置", link: "/manual/certificate-format-configuration" }
        ]
      },
      {
        text: "资产中心",
        link: "/manual/asset-center",
        items: [
          { text: "应用资产", link: "/manual/application-assets" },
          { text: "云账号", link: "/manual/cloud-accounts" },
          { text: "设备", link: "/manual/devices" },
          { text: "Gateway", link: "/manual/Gateway" }
        ]
      },
      {
        text: "证书部署",
        link: "/manual/certificate-deployment",
        items: [
          { text: "自动化", link: "/manual/automation" },
          { text: "工作流模板", link: "/manual/workflow-templates" },
          { text: "执行记录", link: "/manual/execution-records" }
        ]
      },
      { text: "插件中心", link: "/manual/plugin-center" },
      { text: "监控分析（含报表入口）", link: "/manual/monitoring" },
      { text: "日志审计", link: "/manual/audit-logs" },
      {
        text: "系统设置",
        link: "/manual/system-settings",
        items: [
          { text: "系统设置", link: "/manual/system-settings-page" },
          { text: "用户", link: "/manual/users" },
          { text: "角色", link: "/manual/roles" },
          { text: "凭据", link: "/manual/credentials" },
          { text: "通知", link: "/manual/notifications" },
          { text: "许可证", link: "/manual/licenses" }
        ]
      },
      {
        text: "补充主题",
        items: [
          { text: "租户与 RBAC", link: "/manual/tenant-and-rbac" },
          { text: "Agent", link: "/manual/Agent" },
          { text: "报表", link: "/manual/reports" },
          { text: "备份与恢复", link: "/manual/backup-and-restore" },
          { text: "升级与回滚", link: "/manual/upgrade-and-rollback" },
          { text: "故障排查", link: "/manual/troubleshooting" },
          { text: "安全注意事项", link: "/manual/security-considerations" }
        ]
      },
    ]
  },
  {
    text: "三、开发文档",
    link: "/developer/",
    items: [
      { text: "宿主插件能力清单", link: "/developer/host-plugin-capabilities" },
      { text: "插件开发", link: "/developer/plugin-development" },
      { text: "插件示例：Nginx Proxy Manager", link: "/developer/plugin-example-nginx-proxy-manager" },
      { text: "工作流开发规范", link: "/developer/workflow-development" },
    ]
  }
];

const zhThemeConfig = {
  nav: [
    { text: "文档首页", link: "/" },
    { text: "安装部署", link: "/installation/" },
    { text: "用户手册", link: "/manual/" },
    { text: "开发文档", link: "/developer/" }
  ],
  sidebar: {
    "/": zhSidebar
  },
  search: {
    provider: "local"
  },
  outline: {
    level: [2, 3],
    label: "本页目录"
  },
  docFooter: {
    prev: "上一页",
    next: "下一页"
  },
  lastUpdated: {
    text: "最后更新"
  },
  sidebarMenuLabel: "目录",
  returnToTopLabel: "回到顶部",
  darkModeSwitchLabel: "切换主题",
  lightModeSwitchTitle: "切换到浅色模式",
  langMenuLabel: "语言",
  footer: {
    message: "文档内容以现行 Spec、代码和验证证据为准。",
    copyright: "Copyright © 2026 TLSFlow"
  }
};

export default defineConfig({
  title: "TLSFlow 官方文档",
  description: "TLSFlow 证书生命周期管理平台官方文档",
  lang: "zh-CN",
  base,
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: zhThemeConfig
});
