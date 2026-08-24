import { defineConfig } from "vitepress";

const zhSidebar = [
  {
    text: "一、安装部署",
    items: [
      { text: "安装部署总览", link: "/installation/" },
      { text: "快速开始", link: "/installation/20260822-快速开始" },
      { text: "标准部署", link: "/installation/20260822-标准部署" },
      { text: "单机部署", link: "/installation/20260822-单机部署" },
      { text: "部署参数", link: "/installation/20260822-部署参数" },
      { text: "首次登录", link: "/installation/20260822-首次登录" },
    ]
  },
  {
    text: "二、用户手册",
    items: [
      { text: "用户手册总览", link: "/manual/" },
      { text: "仪表盘", link: "/manual/20260822-仪表盘" },
      { text: "快速开始（仪表盘）", link: "/manual/20260822-仪表盘快速开始" },
      {
        text: "证书管理",
        items: [
          { text: "证书管理总览", link: "/manual/20260822-证书管理" },
          { text: "证书资产", link: "/manual/20260822-证书资产" },
          { text: "ACME 自动化", link: "/manual/20260822-ACME自动化" },
          { text: "CA 操作", link: "/manual/20260822-CA操作" },
          { text: "证书格式配置", link: "/manual/20260822-证书格式配置" }
        ]
      },
      {
        text: "资产中心",
        items: [
          { text: "资产中心总览", link: "/manual/20260822-资产中心" },
          { text: "应用资产", link: "/manual/20260822-应用资产" },
          { text: "云账号", link: "/manual/20260822-云账号" },
          { text: "设备", link: "/manual/20260822-设备" },
          { text: "Gateway", link: "/manual/20260822-Gateway" }
        ]
      },
      {
        text: "证书部署",
        items: [
          { text: "证书部署总览", link: "/manual/20260822-证书部署" },
          { text: "自动化", link: "/manual/20260822-自动化" },
          { text: "工作流模板", link: "/manual/20260822-工作流模板" },
          { text: "执行记录", link: "/manual/20260822-执行记录" }
        ]
      },
      { text: "插件中心", link: "/manual/20260822-插件中心" },
      { text: "监控分析（含报表入口）", link: "/manual/20260822-监控分析" },
      { text: "日志审计", link: "/manual/20260822-日志审计" },
      {
        text: "系统设置",
        items: [
          { text: "系统设置总览", link: "/manual/20260822-系统设置" },
          { text: "系统设置", link: "/manual/20260822-系统设置页面" },
          { text: "用户", link: "/manual/20260822-用户" },
          { text: "角色", link: "/manual/20260822-角色" },
          { text: "凭据", link: "/manual/20260822-凭据" },
          { text: "通知", link: "/manual/20260822-通知" },
          { text: "许可证", link: "/manual/20260822-许可证" }
        ]
      },
      {
        text: "补充主题",
        items: [
          { text: "租户与 RBAC", link: "/manual/20260822-租户与RBAC" },
          { text: "Agent", link: "/manual/20260822-Agent" },
          { text: "报表", link: "/manual/20260822-报表" },
          { text: "备份与恢复", link: "/manual/20260822-备份与恢复" },
          { text: "升级与回滚", link: "/manual/20260822-升级与回滚" },
          { text: "故障排查", link: "/manual/20260822-故障排查" },
          { text: "安全注意事项", link: "/manual/20260822-安全注意事项" }
        ]
      },
    ]
  },
  {
    text: "三、开发文档",
    items: [
      { text: "开发文档总览", link: "/developer/" },
      { text: "插件开发", link: "/developer/20260822-插件开发" },
      { text: "插件示例：Nginx Proxy Manager", link: "/developer/20260822-插件示例-Nginx-Proxy-Manager" },
      { text: "工作流开发规范", link: "/developer/20260822-工作流开发规范" },
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
  base: "/docs/",
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: zhThemeConfig
});
