import { defineConfig } from "vitepress";
import fs from "node:fs";

// 文档默认嵌入 GCAC Web 的 /docs/ 路径；GitHub Pages 构建会显式覆盖为 /
const base = process.env.DOCS_BASE ?? "/docs/";
const versionManifest = JSON.parse(
  fs.readFileSync(new URL("../versions.json", import.meta.url), "utf8")
) as {
  current: string;
  locales: Array<{ id: string; path: string; label: string }>;
  versions: Array<{ id: string; label: string; path: string; status: string }>;
};

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
    { text: "文档首页", link: `/${versionManifest.current}/` },
    { text: "安装部署", link: `/${versionManifest.current}/installation/` },
    { text: "用户手册", link: `/${versionManifest.current}/manual/` },
    { text: "开发文档", link: `/${versionManifest.current}/developer/` },
  ],
  sidebar: {
    "/": zhSidebar,
    ...Object.fromEntries(versionManifest.versions.map((version) => [
      `/${version.id}/`,
      prefixSidebar(zhSidebar, `/${version.id}`)
    ])),
    ...Object.fromEntries(versionManifest.versions.map((version) => [
      `/${version.id}/en/`,
      prefixSidebar(createEnSidebar(), `/${version.id}/en`)
    ]))
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
  i18nRouting: true,
  footer: {
    message: "文档内容以现行 Spec、代码和验证证据为准。",
    copyright: "Copyright © 2026 TLSFlow"
  }
};

function createEnSidebar() {
  return [
  {
    text: "1. Installation",
    link: "/installation/",
    items: [
      { text: "Quick start", link: "/installation/quick-start" },
      { text: "Standard deployment", link: "/installation/standard-deployment" },
      { text: "Single-node deployment", link: "/installation/single-node-deployment" },
      { text: "Deployment parameters", link: "/installation/deployment-parameters" },
      { text: "First login", link: "/installation/first-login" }
    ]
  },
  {
    text: "2. User manual",
    link: "/manual/",
    items: [
      { text: "Dashboard", link: "/manual/dashboard" },
      { text: "Dashboard quick start", link: "/manual/dashboard-quick-start" },
      {
        text: "Certificate management",
        link: "/manual/certificate-management",
        items: [
          { text: "Certificate assets", link: "/manual/certificate-assets" },
          { text: "ACME automation", link: "/manual/acme-automation" },
          { text: "CA operations", link: "/manual/ca-operations" },
          { text: "Certificate format configuration", link: "/manual/certificate-format-configuration" }
        ]
      },
      {
        text: "Asset center",
        link: "/manual/asset-center",
        items: [
          { text: "Application assets", link: "/manual/application-assets" },
          { text: "Cloud accounts", link: "/manual/cloud-accounts" },
          { text: "Devices", link: "/manual/devices" },
          { text: "Gateway", link: "/manual/Gateway" }
        ]
      },
      {
        text: "Certificate deployment",
        link: "/manual/certificate-deployment",
        items: [
          { text: "Automation", link: "/manual/automation" },
          { text: "Workflow templates", link: "/manual/workflow-templates" },
          { text: "Execution records", link: "/manual/execution-records" }
        ]
      },
      { text: "Plugin center", link: "/manual/plugin-center" },
      { text: "Monitoring and reports", link: "/manual/monitoring" },
      { text: "Audit logs", link: "/manual/audit-logs" },
      {
        text: "System settings",
        link: "/manual/system-settings",
        items: [
          { text: "System settings", link: "/manual/system-settings-page" },
          { text: "Users", link: "/manual/users" },
          { text: "Roles", link: "/manual/roles" },
          { text: "Credentials", link: "/manual/credentials" },
          { text: "Notifications", link: "/manual/notifications" },
          { text: "Licenses", link: "/manual/licenses" }
        ]
      },
      {
        text: "Additional topics",
        items: [
          { text: "Tenant and RBAC", link: "/manual/tenant-and-rbac" },
          { text: "Agent", link: "/manual/Agent" },
          { text: "Reports", link: "/manual/reports" },
          { text: "Backup and restore", link: "/manual/backup-and-restore" },
          { text: "Upgrade and rollback", link: "/manual/upgrade-and-rollback" },
          { text: "Troubleshooting", link: "/manual/troubleshooting" },
          { text: "Security considerations", link: "/manual/security-considerations" }
        ]
      }
    ]
  },
  {
    text: "3. Developer docs",
    link: "/developer/",
    items: [
      { text: "Host plugin capabilities", link: "/developer/host-plugin-capabilities" },
      { text: "Plugin development", link: "/developer/plugin-development" },
      { text: "Nginx Proxy Manager example", link: "/developer/plugin-example-nginx-proxy-manager" },
      { text: "Workflow development", link: "/developer/workflow-development" }
    ]
  }
  ];
}

function prefixSidebar(sidebar: typeof zhSidebar, prefix: string) {
  return sidebar.map((group) => ({
    ...group,
    link: group.link ? `${prefix}${group.link}` : undefined,
    items: group.items?.map((item) => ({
      ...item,
      link: item.link ? `${prefix}${item.link}` : undefined,
      items: item.items?.map((child) => ({
        ...child,
        link: child.link ? `${prefix}${child.link}` : undefined
      }))
    }))
  }));
}

const englishLocaleConfigs = Object.fromEntries(versionManifest.versions.map((version) => [
  `${version.id}/en`,
  {
    label: "English",
    lang: "en-US",
    link: `/${version.id}/en/`,
    themeConfig: {
      nav: [
        { text: "Documentation home", link: `/${version.id}/en/` },
        { text: "Installation", link: `/${version.id}/en/installation/` },
        { text: "User manual", link: `/${version.id}/en/manual/` },
        { text: "Developer docs", link: `/${version.id}/en/developer/` }
      ],
      sidebar: {
        [`/${version.id}/en/`]: prefixSidebar(createEnSidebar(), `/${version.id}/en`)
      },
      outline: { level: [2, 3], label: "On this page" },
      docFooter: { prev: "Previous", next: "Next" },
      lastUpdated: { text: "Last updated" },
      sidebarMenuLabel: "Menu",
      returnToTopLabel: "Back to top",
      darkModeSwitchLabel: "Toggle theme",
      lightModeSwitchTitle: "Switch to light theme",
      langMenuLabel: "Language",
      footer: {
        message: "Documentation follows the current specifications, code, and verification evidence.",
        copyright: "Copyright © 2026 TLSFlow"
      }
    }
  }
]));

export default defineConfig({
  title: "TLSFlow 官方文档",
  description: "TLSFlow 证书生命周期管理平台官方文档",
  lang: "zh-CN",
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      link: `/${versionManifest.current}/`
    },
    ...englishLocaleConfigs
  },
  base,
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: zhThemeConfig
});
