import { defineConfig } from "vitepress";

const zhSidebar = [
  {
    text: "认识 GCAC",
    items: [
      { text: "文档地图", link: "/overview/" },
      { text: "系统概览", link: "/overview/system-overview" },
      { text: "核心对象与主链", link: "/overview/core-model" }
    ]
  },
  {
    text: "快速开始",
    items: [
      { text: "快速开始总览", link: "/quick-install/" },
      { text: "首次接入", link: "/quick-install/first-access" }
    ]
  },
  {
    text: "用户指南",
    items: [
      { text: "用户指南总览", link: "/user-guide/" },
      { text: "设备、证书与部署主流程", link: "/user-guide/main-flow" }
    ]
  },
  {
    text: "开发者手册",
    items: [
      { text: "开发者手册总览", link: "/developer-guide/" },
      { text: "平台扩展基础", link: "/developer-guide/platform" },
      { text: "插件开发", link: "/developer-guide/plugins/" },
      { text: "工作流开发", link: "/developer-guide/workflows/" }
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
      themeConfig: localeThemeConfig
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
