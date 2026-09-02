<div align="center">

<img src="web/public/brand/tlsflow-lockup.svg" alt="TLSFlow" width="480">

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)
![Vue](https://img.shields.io/badge/Vue-3.5+-4FC08D.svg?logo=vue.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-latest-E0234E.svg?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)

**Enterprise-grade SSL/TLS Certificate Lifecycle Automation Platform**

[English](#) | [中文](#) | [日本語](#) | [Français](#) | [Русский](#) | [한국어](#) | [Español](#)

</div>

> **Note:** Language switch links are placeholders. Additional language versions will be generated after the Chinese content is finalized.

---

## ⚠️ Important Notice

Please read the following carefully before using this project:

- **Terms of Service Risk:** Using this project in commercial production environments requires a separate commercial license or EULA. The default PolyForm Noncommercial 1.0.0 license permits only non-commercial use. Please review the [LICENSE](LICENSE) file and contact the rights holder before commercial deployment.

- **Compliant Use:** Use this project only in compliance with the laws and regulations of your country or region. Any unlawful use is strictly prohibited.

- **Disclaimer:** This project is provided for technical learning, research, and evaluation purposes. The authors assume no liability for production incidents, data loss, or any other direct or indirect damages resulting from the use of this project in unsupported environments.

---

## 产品介绍

### 别让证书过期，拖垮你的业务

数百台服务器、几十种应用类型、不同的网络环境,证书快到期了怎么办？手工更新来不及、容易出错,还可能把线上弄挂。TLSFlow 帮你把证书管起来、自动部署上去,出问题自动退回来,让证书更新不再是定时炸弹。

通过插件系统和工作流编排,可扩展支持各类 Web 服务器、应用服务器、负载均衡、网关设备、云平台和容器环境。

### 产品价值

| 价值 | 说明 |
| --- | --- |
| **知道有多少证书** | 不用翻 Excel 和邮件,所有证书在哪台机器、绑定了哪个应用、什么时候到期,一查就知道。 |
| **一键批量更新** | Windows、Linux、云平台、网络设备都能自动部署,不用半夜逐台 SSH 上去手工操作。 |
| **更新失败自动退回** | 更新前自动备份,更新后自动验证,发现问题马上退回原配置,降低业务中断风险。 |
| **快到期提前通知** | 快到期自动提醒,部署失败立即告警,微信、邮件、钉钉等渠道都能收到。 |

## 痛点与挑战

### 47 天证书时代正在到来

CA/B Forum 已于 2025 年 4 月 11 日通过 SC081v3,把公有信任 TLS/SSL 证书的最长有效期按阶段缩短为：

| 阶段 | 最长有效期 | 生效时间 | 预计年度轮换次数 |
| --- | ---: | --- | ---: |
| 当前 | 1 年 | 当前 | 约 1 次 |
| 第一阶段 | 200 天 | 2026-03-15 | 约 2 次 |
| 第二阶段 | 100 天 | 2027-03-15 | 约 4 次 |
| 第三阶段 | 47 天 | 2029-03-15 | 约 8 次 |

更新频次翻倍,意味着申请、部署、验证和回滚都要形成可复制的自动化流程。

### 运维支撑人员：企业内部有多少证书需要管理？

- 公网域名分散在多个云服务商,内网业务网关散落各分支机构；
- 证书信息散落在 Excel、邮件和共享文件夹,数量、到期时间、部署位置难以统计；
- 每次盘点都要临时拼凑,容易出现遗漏、重复和责任不清。

**TLSFlow 解决方案**：提供证书资产中心,统一纳管所有证书及其部署位置。

### 应用实施人员：未来 47 天证书时代如何应对？

- 当前证书通常 1 年更新一次,200 个应用按每次 2 小时计算,一轮就需要约 400 小时；
- 有效期缩短至 47 天后,每年大约要更新 8 次,重复人力成本同步放大；
- 没有统一自动化流程,申请、上传、配置、重启和验证将难以持续完成。

**TLSFlow 解决方案**：自动化部署流程,将单次更新时间从小时级降至分钟级。

### 应用维护人员：证书过期或安装失败,造成过业务中断吗？

- 证书过期可能导致网站无法访问、移动 APP 接口失败、合作伙伴 API 中断；
- 手工更新环节多,配置错误和验证不及时容易把问题带到生产环境；
- 即使及时处理,业务也可能已经中断数小时,带来投诉和客户质疑；
- 缺少统一的变更记录和恢复依据,排障、回滚与复盘都只能依赖人工经验。

**TLSFlow 解决方案**：提供到期预警、部署后自动验证与失败回滚机制。

### 信息安全人员：通配符证书在内网大量使用,有哪些安全隐患？

- 同一张通配符证书及私钥被复制到几十台甚至上百台内网服务器；
- 任一服务器被入侵、备份泄露或误操作,都可能造成私钥扩散；
- 部署范围无法追踪,证书一旦需要吊销,影响评估和全网排查都会变得困难；
- 私钥使用边界与实际部署主体不清,审计、轮换和合规责任难以落地。

**TLSFlow 解决方案**：推荐内部私有证书、公网通配符证书与自动化部署相结合,降低私钥扩散风险。

### 团队管理者：团队距离 47 天证书时代还有多远？

- 先确认资产清单是否完整,证书、服务器、应用和责任人是否能够对应起来；
- 再评估自动化覆盖率,减少对个人经验、临时脚本和人工登录的依赖；
- 最后验证团队是否具备快速响应、审批留痕和失败回滚能力；
- 把到期提醒、部署验证和执行记录纳入统一闭环,才能持续应对 47 天周期。

**TLSFlow 解决方案**：提供从资产盘点、自动部署到监控告警的完整解决方案。

## 功能介绍

### TLSFlow 能做什么

| 功能 | 说明 |
| --- | --- |
| **证书资产统一管理** | 集中管理证书资产、版本、格式转换和信任链验证,支持 PEM/PFX/JKS/P7B 等多种格式,自动检测证书到期并归档历史版本。 |
| **多源证书接入** | 支持手动导入、内部 CA（OpenSSL/ACME）、云厂商证书（阿里云 CDN）、Microsoft AD CS 等多种证书来源,自动解析证书链并映射到受管资产。 |
| **异构环境应用发现** | 通过 Agent 自动发现各类 Web 服务器、应用服务器、负载均衡等应用资产,识别当前证书绑定和兼容性。 |
| **工作流自动化部署** | 基于 DSL 编排证书部署工作流,支持 SSH 远程执行、CURL API 调用、文件传输,内置预检、备份、验证和回滚保障。 |
| **可扩展插件系统** | 内置 20 个高频应用插件,覆盖 Web 服务器、应用中间件、负载均衡、网关设备、云平台等场景,支持用户自定义插件扩展以适配任何目标环境。 |
| **持续监控与告警** | 实时监控证书到期、绑定漂移、链验证失败、部署异常,通过邮件/Webhook/钉钉/企业微信/飞书/Slack/Telegram 多渠道推送告警。 |
| **审批流程与审计** | 支持按风险等级和操作类型触发审批（插件安装/启用、工作流执行、回滚操作）,完整记录操作日志和执行快照。 |
| **细粒度权限控制** | 基于 RBAC + 对象授权模型,按证书资产、应用、Agent 维度分配权限,支持租户隔离和跨部门协作。 |

### 真实场景下的痛点

| 你可能遇到的问题 | TLSFlow 怎么解决 |
| --- | --- |
| 证书信息散落在邮件、Excel、共享盘,临时找不到 | 所有证书集中管理,搜索即可找到使用位置和责任人。 |
| 更新完不知道有没有生效,用户投诉才发现配置错误 | 更新后自动访问 HTTPS,确认指纹正确才算完成。 |
| 出了问题不知道谁改的、改了什么,无从追查 | 每次更新记录操作人、时间和改动内容,随时可以回看。 |
| 生产区禁止外网访问,装不了 Agent,只能手工登录 | 使用 Gateway 主动连接,或直接通过 SSH 免代理部署。 |

## 产品优势

### 为什么 TLSFlow 更适合企业

- **老系统也能接管**：很多系统装不了 Agent,网络还有隔离区。TLSFlow 提供多种接入方式,旧系统和隔离网络不需要大规模改造也能纳入管理。
- **证书更新故障自动回退**：更新前自动备份,验证失败基于备份清单和检查点自动恢复原配置,支持失败策略自动触发和人工手动回滚两种方式,避免业务挂起后再手忙脚乱地回滚配置。
- **常用与特殊应用都能接管**：高频应用通过内置插件直接使用,冷门设备和特殊流程可以通过工作流 DSL 自行编排更新步骤,无限扩展。
- **证书关联情况一目了然**：每张证书绑定到具体服务器、站点和应用,出现问题可以快速确认影响范围。
- **完整的权限控制**：不同角色具备不同权限,敏感操作根据策略审批,密码和私钥不会明文显示在日志中。
- **完善的审计日志**：每次更新都能看到执行步骤、使用证书和配置变更,出了问题可以回看,不是黑盒操作。

## 适用场景

- **异构环境复杂**：多种 Web 服务器、应用中间件、负载均衡、网关设备和云平台并存,手工维护难以持续；
- **存在隔离区和老系统**：生产区不能随便装软件,旧系统也无法升级,但证书仍然需要更新；
- **内网完全断网**：生产环境与互联网物理隔离,无法使用公有云在线证书服务；
- **需要审批和记录**：证书变更属于敏感操作,需要审批流程、操作留痕和完整追溯。

让证书更新不再是定时炸弹。TLSFlow 用统一的资产管理、自动部署、安全回滚和持续告警,帮助团队应对越来越短的证书轮换周期。

## 技术架构

项目采用分层、模块化架构：核心平台统一管理数据、权限和执行合同,执行面可以按目标替换。

| 组件 | 技术与职责 |
| --- | --- |
| Web 控制台 | Vue 3、TypeScript、Vite、Pinia、vue-i18n |
| Backend | NestJS、TypeScript；按业务边界拆分领域模块并提供 REST/OpenAPI 接口 |
| 数据持久化 | 标准部署使用 PostgreSQL 16；单机评估使用 PGlite |
| Browser Runtime | Node.js、Playwright；提供隔离的浏览器会话和受控凭据流程 |
| TLS Inspector | 独立 Node.js 服务,用于 TLS 握手和证书状态分析 |
| Full Agent / CA Node | Go 原生程序,分别承担主机执行和隔离 CA 签发边界 |
| 扩展运行时 | Manifest、Host API、Runner、Workflow DSL 和兼容目录 |
| 部署方式 | standard 使用 Docker Compose；small 使用单容器 `docker run` |

## 快速体验

### 前置条件

- Linux、macOS 或 NAS 主机；
- Docker CLI；standard 另外需要 Docker Compose v2；
- 能访问目标设备、证书服务及计划接入的外部 API；
- 生产环境使用随机且长期保持不变的运行时密钥。

部署预构建镜像不需要 Node.js、Go、Buildx 或源码。

### 单机评估部署

small 适合 50 个应用资产以下的功能评估和小规模环境,使用 PGlite,不包含独立
PostgreSQL 和 Browser Runtime。只需准备宿主机数据目录,然后执行：

```bash
DATA_ROOT=/path/to/tlsflow-data
mkdir -p \
  "$DATA_ROOT/pglite" \
  "$DATA_ROOT/workflows" \
  "$DATA_ROOT/runtime" \
  "$DATA_ROOT/tls-inspector" \
  "$DATA_ROOT/plugins"
# 容器默认以 UID/GID 10001:10001 运行；NAS 允许时提前调整目录所有权。
chown -R 10001:10001 "$DATA_ROOT"
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  --label com.gcac.deployment.architecture=small \
  -p 8085:3003 \
  -e GCAC_TOKEN_SECRET=TLSFlow-Token-K4r8-Np2z-2026 \
  -e GCAC_SECRET_KEK=TLSFlow-KEK-H7s3-Lx6v-2026 \
  -v "$DATA_ROOT/pglite:/var/lib/gcac/pglite" \
  -v "$DATA_ROOT/workflows:/app/data/workflows" \
  -v "$DATA_ROOT/runtime:/app/data/runtime" \
  -v "$DATA_ROOT/tls-inspector:/app/data/tls-inspector" \
  -v "$DATA_ROOT/plugins:/app/data/plugins:ro" \
  your-dockerhub-namespace/gcac-small:latest
```

将 `your-dockerhub-namespace` 替换为实际 Docker Hub 命名空间。

默认访问地址为 `http://<主机地址>:8085/`。首次启动后按初始化向导创建管理员,
不要在生产环境复用示例密钥。

### 标准部署

标准版由 PostgreSQL、Backend、Web 和按需启用的 Browser Runtime 组成,适合正式环境
和多企业后台任务场景。复制 `docker/.env.example` 为 `docker/.env`,填写
`GCAC_IMAGE_NAMESPACE`、`GCAC_RELEASE_VERSION`、`POSTGRES_PASSWORD`、
`GCAC_PUBLIC_BASE_URL`、`GCAC_TOKEN_SECRET` 和 `GCAC_SECRET_KEK`,然后执行：

```bash
cd docker
docker compose pull
docker compose up -d
docker compose ps
```

需要 Browser Runtime 时执行 `docker compose --profile browser-runtime up -d`。
标准部署默认 Web 端口为 `8085`,Backend 只在 Compose 内部网络提供服务。Browser Runtime
应只在容器内网使用,不应直接暴露到公网。完整变量、备份和首次登录步骤见[安装部署文档](docs/Documentation/installation/)。

## 项目目录

```text
backend/          NestJS 后端、数据库迁移、插件宿主和执行编排
web/              Vue 3 管理控制台
browser-runtime/  受控浏览器运行时
tls-inspector/    TLS 握手与证书探测服务
agents/           Windows/Linux Agent、CA Node 和 Gateway Agent
docker/           Dockerfile、Compose、镜像和 Agent 发布包构建工具
data/              运行期插件、数据库、工作流和运行时数据目录
docs/             用户手册、开发文档、运维指南和产品资料
specs/            按领域组织的需求与设计规格
scripts/          架构检查、兼容性检查、插件治理和公开发布工具
```

## 二次开发与扩展

### 选择正确的扩展方式

1. **新增普通系统或认证环境**：优先复用已有 Agent、SSH、CURL 和平台能力,通过兼容目录增加配置和验证记录,尽量做到零核心代码改动。
2. **新增高频产品**：开发产品插件,封装设备连接、身份确认、只读发现、应用资产映射、部署计划和目标验证。
3. **新增小众设备或内部 API**：编写版本化 Workflow DSL,使用 SSH、SFTP、SCP、CURL、条件、转换、等待、人工确认、提取和断言等受控步骤。
4. **确需新的执行边界**：再评估是否需要新的 Agent 产品线或宿主能力,并先补齐协议、权限、审计和回滚合同。

### 插件开发边界

- 插件通过 `Manifest` 声明身份、版本、能力、权限和兼容范围；
- 插件默认只使用宿主提供的 Host API、Secret、Artifact、审计、锁和执行授权；
- 内置插件位于 `backend/src/modules/plugins/builtin-plugins/<pluginId>/`；
- 用户插件放入 `data/plugins/`,通过统一插件包导入接口发布；
- 插件工作流资源必须与插件版本同步,发布前需要完成证书更新流程测试并保存迭代记录；
- 插件不能绕过宿主直接读取租户数据、明文凭据或任意执行宿主进程。

入口文档：[插件开发](docs/Documentation/developer/plugin-development.md)、[宿主插件能力](docs/Documentation/developer/host-plugin-capabilities.md)、[工作流开发](docs/Documentation/developer/workflow-development.md)。

### 工作流 DSL 边界

工作流模板使用项目私有协议 `gcac.workflow/v1`。模板来源只有：

- 内置模板：`backend/src/modules/workflow-templates/builtin-workflows`；
- 用户导入模板：`data/workflows`（运行期按需创建,不是内置模板目录）。

密码、Token、私钥和证书制品必须通过 `SecretRef` 或 Artifact Slot 引用,不能写入 DSL、普通变量、日志或执行快照。部署流程应保持 `prepare → backup → install → refresh → verify` 阶段,回滚使用原始工作流版本和输入快照。

### 本地开发和验证

仓库不要求把开发服务作为 README 交付的一部分自动启动。常用构建和测试入口如下：

```bash
# 后端构建
npm --prefix backend run build

# 前端类型检查和生产构建
npm --prefix web run build

# Browser Runtime 构建
npm --prefix browser-runtime run build

# TLS Inspector 测试
npm --prefix tls-inspector test

# 前端单元与合同测试
npm --prefix web run test:unit
```

后端完整测试、兼容性架构检查、插件版本检查和 Agent 构建有额外环境要求,请按对应模块文档和项目规范执行。测试通过不等于已经完成真实厂商设备、外部 CA、隔离网络或生产回滚验收。

## 安全与生产边界

- `GCAC_SECRET_KEK` 是运行时安全材料的解密根密钥,必须独立备份,禁止写入代码、日志、公开文档或浏览器；
- 不要把许可证签发私钥放入仓库、镜像或容器环境变量；公开部署只需要许可证信任公钥；
- 标准版 Browser Runtime 只应通过内网和 Web 代理访问；
- 证书、私钥、Token、PFX/JKS 口令等敏感材料不得进入普通变量、执行日志或工作流模板；
- 目标版本、权限条件、执行通道和真实兼容性必须单独验收；静态代码、Schema 和单元测试不能替代现场验证；
- 标准 Compose 拓扑面向单机运行,未提供自动故障转移集群；升级和恢复前应先备份数据库、工作流、用户插件和运行时安全材料；
- ACME、外部 CA、厂商 API 和复杂网络的能力会随版本演进,请以当前用户文档、插件兼容目录和实际环境结果为准。

## 文档导航

- [官方文档首页](docs/Documentation/index.md)
- [安装部署](docs/Documentation/installation/)
- [用户手册](docs/Documentation/manual/)
- [开发文档](docs/Documentation/developer/)
- [产品彩页](docs/产品介绍/20260824-TLSFlow产品彩页.html)
- [产品能力与市场对比](docs/产品分析/20260721-证书自动化产品横向对比分析.md)
- [工作流模板与 DSL 规范](docs/项目规范/20260723-工作流模板管理及编写规范.md)
- [插件开发流程规范](docs/项目规范/20260819-插件开发流程规范.md)
- [Agent 横向扩展与兼容性规范](docs/项目规范/20260721-Agent平台横向扩展与兼容性维护规范.md)
- [规格索引](specs/README.md)

## 许可证

本项目是组合授权项目,请先阅读根目录 [LICENSE](LICENSE)：

- 核心源码和官方实现默认采用 **PolyForm Noncommercial 1.0.0**,商业使用需要单独商业许可证或 EULA；
- 插件 SDK、Manifest、Host API 合同及公开 Schema/协议示例默认采用 **Apache-2.0**；
- 文档和示例默认采用 **CC BY 4.0**；
- 第三方或社区插件以其随附的许可证和声明为准。

## 项目定位

TLSFlow 不试图替代所有 CA、Kubernetes 控制器或轻量 ACME 工具。它的价值在于把"证书签发之后"最容易失控的部分——资产关系、异构目标部署、预检、验证、回滚、审批、审计和持续监控——变成一套统一、透明、可扩展的企业流程。

**用结构化资产回答"证书在哪里",用插件和工作流回答"怎么部署",用预检和验证回答"部署是否安全有效",用回滚和审计回答"出了问题如何追溯和恢复"。**
