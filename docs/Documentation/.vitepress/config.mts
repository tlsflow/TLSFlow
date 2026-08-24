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

export default defineConfig({
  title: "GCAC 官方文档",
  description: "GCAC 证书生命周期管理平台官方文档",
  lang: "zh-CN",
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
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
    darkModeSwitchTitle: "切换到深色模式",
    langMenuLabel: "语言",
    footer: {
      message: "文档内容以现行 Spec、代码和验证证据为准。",
      copyright: "Copyright © 2026 GCAC"
    }
  }
});
