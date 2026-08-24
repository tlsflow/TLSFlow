import { defineConfig } from "vitepress";

const zhSidebar = [
  {
    text: "认识 GCAC",
    items: [
      { text: "文档地图", link: "/overview/" },
      { text: "产品概览", link: "/overview/product-overview" },
      { text: "系统概览", link: "/overview/system-overview" },
      { text: "核心对象与主链", link: "/overview/core-model" }
    ]
  },
  {
    text: "快速开始",
    items: [
      { text: "快速开始总览", link: "/quick-install/" },
      { text: "租户与管理员初始化", link: "/quick-install/tenant-and-admin" },
      { text: "Agent 接入", link: "/quick-install/agent" },
      { text: "无 Agent 目标接入", link: "/quick-install/unmanaged-target" },
      { text: "首次接入", link: "/quick-install/first-access" }
    ]
  },
  {
    text: "用户指南",
    items: [
      { text: "用户指南总览", link: "/user-guide/" },
      { text: "安全、Secret 与审批", link: "/user-guide/security" },
      { text: "证书资产与 CA", link: "/user-guide/certificates" },
      { text: "设备与执行通道", link: "/user-guide/devices" },
      { text: "应用资产与受管目标", link: "/user-guide/assets" },
      { text: "工作流模板", link: "/user-guide/workflows" },
      { text: "部署计划与回滚", link: "/user-guide/deployments" },
      { text: "监控、通知与报表", link: "/user-guide/monitoring" },
      { text: "自动化、设置与凭据", link: "/user-guide/automation" },
      { text: "设备、证书与部署主流程", link: "/user-guide/main-flow" }
    ]
  },
  {
    text: "开发者手册",
    items: [
      { text: "开发者手册总览", link: "/developer-guide/" },
      { text: "平台扩展基础", link: "/developer-guide/platform" },
      { text: "架构与模块边界", link: "/developer-guide/architecture" },
      { text: "API 与错误合同", link: "/developer-guide/api-and-errors" },
      { text: "数据库迁移", link: "/developer-guide/migrations" },
      { text: "国际化开发", link: "/developer-guide/internationalization" },
      { text: "主题变量与设计系统", link: "/developer-guide/theme" },
      { text: "测试与验证", link: "/developer-guide/testing" },
      { text: "文档变更与发布", link: "/developer-guide/20260802-文档变更同步与发布流程" },
      { text: "插件开发", link: "/developer-guide/plugins/" },
      { text: "插件包契约", link: "/developer-guide/plugins/package-contract" },
      { text: "设备与目标模式", link: "/developer-guide/plugins/target-modes" },
      { text: "发现与证书位置", link: "/developer-guide/plugins/discovery-and-assets" },
      { text: "Agent 插件运行时", link: "/developer-guide/plugins/agent-runtime" },
      { text: "插件安全与成熟度", link: "/developer-guide/plugins/security-and-maturity" },
      { text: "工作流开发", link: "/developer-guide/workflows/" },
      { text: "工作流 DSL 与模板来源", link: "/developer-guide/workflows/20260802-工作流DSL与模板来源" },
      { text: "部署输入契约与快照", link: "/developer-guide/workflows/20260802-部署输入契约与快照" },
      { text: "工作流执行器、恢复与回滚", link: "/developer-guide/workflows/20260802-工作流执行器与恢复回滚" },
      { text: "证书部署工作流主链", link: "/developer-guide/certificate-deployment/20260802-证书部署工作流开发主链" }
    ]
  },
  {
    text: "运维指南",
    items: [
      { text: "运维指南总览", link: "/operations/" },
      { text: "状态与排障", link: "/operations/status-and-troubleshooting" }
    ]
  },
  {
    text: "参考",
    items: [
      { text: "参考资料总览", link: "/reference/" },
      { text: "事实来源与状态", link: "/reference/facts-and-status" }
    ]
  }
];

const localeSidebar = [
  {
    text: "Documentation",
    items: [
      { text: "Documentation home", link: "/" },
      { text: "Translation status", link: "/reference/translation-status" }
    ]
  }
];

const enSidebar = [
  {
    text: "Getting Started",
    items: [
      { text: "Documentation home", link: "/en/" },
      { text: "Product overview", link: "/en/overview/product-overview" },
      { text: "System overview", link: "/en/overview/system-overview" },
      { text: "Quick start", link: "/en/quick-install/" },
      { text: "Agent onboarding", link: "/en/quick-install/agent" },
      { text: "Unmanaged target onboarding", link: "/en/quick-install/unmanaged-target" },
      { text: "First access", link: "/en/quick-install/first-access" }
    ]
  },
  {
    text: "User Guide",
    items: [
      { text: "User guide", link: "/en/user-guide/" },
      { text: "Devices and execution channels", link: "/en/user-guide/devices" },
      { text: "Certificates and CA", link: "/en/user-guide/certificates" },
      { text: "Deployments and rollback", link: "/en/user-guide/deployments" },
      { text: "Device-to-deployment flow", link: "/en/user-guide/main-flow" },
      { text: "Workflow templates", link: "/en/user-guide/workflows" }
    ]
  },
  {
    text: "Developer Guide",
    items: [
      { text: "Developer guide", link: "/en/developer-guide/" },
      { text: "Documentation change and release", link: "/en/developer-guide/20260802-文档变更同步与发布流程" },
      { text: "Plugin development", link: "/en/developer-guide/plugins/" },
      { text: "Target modes", link: "/en/developer-guide/plugins/target-modes" },
      { text: "Discovery and certificate locations", link: "/en/developer-guide/plugins/discovery-and-assets" },
      { text: "Agent runtime", link: "/en/developer-guide/plugins/agent-runtime" },
      { text: "Plugin security and maturity", link: "/en/developer-guide/plugins/security-and-maturity" },
      { text: "Workflow development", link: "/en/developer-guide/workflows/" },
      { text: "DSL and template sources", link: "/en/developer-guide/workflows/20260802-工作流DSL与模板来源" },
      { text: "Input contract and snapshots", link: "/en/developer-guide/workflows/20260802-部署输入契约与快照" },
      { text: "Executors, recovery and rollback", link: "/en/developer-guide/workflows/20260802-工作流执行器与恢复回滚" },
      { text: "Certificate deployment workflow", link: "/en/developer-guide/certificate-deployment/20260802-证书部署工作流开发主链" }
    ]
  },
  {
    text: "Reference",
    items: [
      { text: "Translation status", link: "/en/reference/translation-status" }
    ]
  }
];

const zhThemeConfig = {
  nav: [
    { text: "文档首页", link: "/" },
    { text: "快速开始", link: "/quick-install/" },
    { text: "用户指南", link: "/user-guide/" },
    { text: "开发者手册", link: "/developer-guide/" },
    { text: "运维指南", link: "/operations/" },
    { text: "参考", link: "/reference/" }
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
    copyright: "Copyright © 2026 GCAC"
  }
};

const localeThemeConfig = {
  nav: [
    { text: "Home", link: "/" },
    { text: "Translation status", link: "/reference/translation-status" }
  ],
  sidebar: {
    "/": localeSidebar
  },
  search: {
    provider: "local"
  },
  outline: {
    level: [2, 3],
    label: "On this page"
  },
  docFooter: {
    prev: "Previous page",
    next: "Next page"
  },
  lastUpdated: {
    text: "Last updated"
  },
  sidebarMenuLabel: "Menu",
  returnToTopLabel: "Back to top",
  darkModeSwitchLabel: "Switch theme",
  lightModeSwitchTitle: "Switch to light mode",
  langMenuLabel: "Language",
  footer: {
    message: "These pages expose the current translation status.",
    copyright: "Copyright © 2026 GCAC"
  }
};

export default defineConfig({
  title: "GCAC 官方文档",
  description: "GCAC 证书生命周期管理平台官方文档",
  lang: "zh-CN",
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: zhThemeConfig,
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: zhThemeConfig
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: {
        ...localeThemeConfig,
        nav: [
          { text: "Home", link: "/en/" },
          { text: "Quick start", link: "/en/quick-install/" },
          { text: "User guide", link: "/en/user-guide/" },
          { text: "Developer guide", link: "/en/developer-guide/" },
          { text: "Translation status", link: "/en/reference/translation-status" }
        ],
        sidebar: {
          "/en/": enSidebar
        },
        footer: {
          message: "English pages are translated from the authoritative zh-CN documentation.",
          copyright: "Copyright © 2026 GCAC"
        }
      }
    },
    fr: {
      label: "Français",
      lang: "fr-FR",
      link: "/fr/",
      themeConfig: localeThemeConfig
    },
    ja: {
      label: "日本語",
      lang: "ja-JP",
      link: "/ja/",
      themeConfig: localeThemeConfig
    },
    ko: {
      label: "한국어",
      lang: "ko-KR",
      link: "/ko/",
      themeConfig: localeThemeConfig
    },
    pt: {
      label: "Português",
      lang: "pt-BR",
      link: "/pt/",
      themeConfig: localeThemeConfig
    },
    ru: {
      label: "Русский",
      lang: "ru-RU",
      link: "/ru/",
      themeConfig: localeThemeConfig
    },
    "zh-TW": {
      label: "繁體中文",
      lang: "zh-TW",
      link: "/zh-TW/",
      themeConfig: localeThemeConfig
    }
  }
});
