<div align="center">

<img src="../../web/public/brand/tlsflow-lockup.svg" alt="TLSFlow" width="480">

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)
![Vue](https://img.shields.io/badge/Vue-3.5+-4FC08D.svg?logo=vue.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-latest-E0234E.svg?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)

**企業級 SSL/TLS 憑證生命週期自動化平台**

[English](README.en.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md)

</div>

> **注意：** 語言切換連結為佔位符號。其他語言版本將在中文內容定稿後生成。

---

## ⚠️ 重要聲明

在使用本專案前，請仔細閱讀以下內容：

- **服務條款風險：** 在商業生產環境中使用本專案需要單獨的商業授權或 EULA。預設的 PolyForm Noncommercial 1.0.0 授權僅允許非商業使用。在商業部署前，請查看 [LICENSE](LICENSE) 檔案並聯絡權利持有人。

- **合規使用：** 僅在符合您所在國家或地區的法律法規的情況下使用本專案。嚴禁任何非法使用。

- **免責聲明：** 本專案用於技術學習、研究和評估目的。對於在不受支援的環境中使用本專案導致的生產事故、資料遺失或任何其他直接或間接損害，作者不承擔任何責任。

---

## 產品介紹

### 別讓憑證過期，拖垮你的業務

數百台伺服器、幾十種應用類型、不同的網路環境，憑證快到期了怎麼辦？手工更新來不及、容易出錯，還可能把線上弄掛。TLSFlow 幫你把憑證管起來、自動部署上去，出問題自動退回來，讓憑證更新不再是定時炸彈。

透過外掛系統和工作流程編排，可擴展支援各類 Web 伺服器、應用伺服器、負載平衡器、閘道裝置、雲平台和容器環境。

### 產品價值

| 價值 | 說明 |
| --- | --- |
| **知道有多少憑證** | 不用翻 Excel 和郵件，所有憑證在哪台機器、綁定了哪個應用、什麼時候到期，一查就知道。 |
| **一鍵批次更新** | Windows、Linux、雲平台、網路裝置都能自動部署，不用半夜逐台 SSH 上去手工操作。 |
| **更新失敗自動退回** | 更新前自動備份，更新後自動驗證，發現問題馬上退回原配置，降低業務中斷風險。 |
| **快到期提前通知** | 快到期自動提醒，部署失敗立即告警，微信、郵件、釘釘等管道都能收到。 |

## 痛點與挑戰

### 47 天憑證時代正在到來

CA/B Forum 已於 2025 年 4 月 11 日通過 SC081v3，把公有信任 TLS/SSL 憑證的最長有效期按階段縮短為：

| 階段 | 最長有效期 | 生效時間 | 預計年度輪換次數 |
| --- | ---: | --- | ---: |
| 當前 | 1 年 | 當前 | 約 1 次 |
| 第一階段 | 200 天 | 2026-03-15 | 約 2 次 |
| 第二階段 | 100 天 | 2027-03-15 | 約 4 次 |
| 第三階段 | 47 天 | 2029-03-15 | 約 8 次 |

更新頻次翻倍，意味著申請、部署、驗證和回滾都要形成可複製的自動化流程。

### 運維支撐人員：企業內部有多少憑證需要管理？

- 公網域名分散在多個雲服務商，內網業務閘道散落各分支機構；
- 憑證資訊散落在 Excel、郵件和共用資料夾，數量、到期時間、部署位置難以統計；
- 每次盤點都要臨時拼湊，容易出現遺漏、重複和責任不清。

**TLSFlow 解決方案**：提供憑證資產中心，統一納管所有憑證及其部署位置。

### 應用實施人員：未來 47 天憑證時代如何應對？

- 當前憑證通常 1 年更新一次，200 個應用按每次 2 小時計算，一輪就需要約 400 小時；
- 有效期縮短至 47 天後，每年大約要更新 8 次，重複人力成本同步放大；
- 沒有統一自動化流程，申請、上傳、配置、重啟和驗證將難以持續完成。

**TLSFlow 解決方案**：自動化部署流程，將單次更新時間從小時級降至分鐘級。

### 應用維護人員：憑證過期或安裝失敗，造成過業務中斷嗎？

- 憑證過期可能導致網站無法存取、行動 APP 介面失敗、合作夥伴 API 中斷；
- 手工更新環節多，配置錯誤和驗證不及時容易把問題帶到生產環境；
- 即使及時處理，業務也可能已經中斷數小時，帶來投訴和客戶質疑；
- 缺少統一的變更記錄和恢復依據，排障、回滾與復盤都只能依賴人工經驗。

**TLSFlow 解決方案**：提供到期預警、部署後自動驗證與失敗回滾機制。

### 資訊安全人員：萬用字元憑證在內網大量使用，有哪些安全隱患？

- 同一張萬用字元憑證及私鑰被複製到幾十台甚至上百台內網伺服器；
- 任一伺服器被入侵、備份洩露或誤操作，都可能造成私鑰擴散；
- 部署範圍無法追蹤，憑證一旦需要吊銷，影響評估和全網排查都會變得困難；
- 私鑰使用邊界與實際部署主體不清，稽核、輪換和合規責任難以落地。

**TLSFlow 解決方案**：推薦內部私有憑證、公網萬用字元憑證與自動化部署相結合，降低私鑰擴散風險。

### 團隊管理者：團隊距離 47 天憑證時代還有多遠？

- 先確認資產清單是否完整，憑證、伺服器、應用和責任人是否能夠對應起來；
- 再評估自動化覆蓋率，減少對個人經驗、臨時指令碼和人工登入的依賴；
- 最後驗證團隊是否具備快速響應、審批留痕和失敗回滾能力；
- 把到期提醒、部署驗證和執行記錄納入統一閉環，才能持續應對 47 天週期。

**TLSFlow 解決方案**：提供從資產盤點、自動部署到監控告警的完整解決方案。

## 功能介紹

### TLSFlow 能做什麼

| 功能 | 說明 |
| --- | --- |
| **憑證資產統一管理** | 集中管理憑證資產、版本、格式轉換和信任鏈驗證，支援 PEM/PFX/JKS/P7B 等多種格式，自動檢測憑證到期並歸檔歷史版本。 |
| **多源憑證接入** | 支援手動匯入、內部 CA（OpenSSL/ACME）、雲廠商憑證（阿里雲 CDN）、Microsoft AD CS 等多種憑證來源，自動解析憑證鏈並對應到受管資產。 |
| **異構環境應用發現** | 透過 Agent 自動發現各類 Web 伺服器、應用伺服器、負載平衡器等應用資產，識別當前憑證綁定和相容性。 |
| **工作流程自動化部署** | 基於 DSL 編排憑證部署工作流程，支援 SSH 遠端執行、CURL API 呼叫、檔案傳輸，內建預檢、備份、驗證和回滾保障。 |
| **可擴展外掛系統** | 內建 20 個高頻應用外掛，覆蓋 Web 伺服器、應用中介軟體、負載平衡器、閘道裝置、雲平台等場景，支援使用者自訂外掛擴展以適配任何目標環境。 |
| **持續監控與告警** | 即時監控憑證到期、綁定漂移、鏈驗證失敗、部署異常，透過郵件/Webhook/釘釘/企業微信/飛書/Slack/Telegram 多管道推送告警。 |
| **審批流程與稽核** | 支援按風險等級和操作類型觸發審批（外掛安裝/啟用、工作流程執行、回滾操作），完整記錄操作日誌和執行快照。 |
| **細粒度權限控制** | 基於 RBAC + 物件授權模型，按憑證資產、應用、Agent 維度分配權限，支援租戶隔離和跨部門協作。 |

### 真實場景下的痛點

| 你可能遇到的問題 | TLSFlow 怎麼解決 |
| --- | --- |
| 憑證資訊散落在郵件、Excel、共用盤，臨時找不到 | 所有憑證集中管理，搜尋即可找到使用位置和責任人。 |
| 更新完不知道有沒有生效，使用者投訴才發現配置錯誤 | 更新後自動存取 HTTPS，確認指紋正確才算完成。 |
| 出了問題不知道誰改的、改了什麼，無從追查 | 每次更新記錄操作人、時間和變更內容，隨時可以回看。 |
| 生產區禁止外網存取，裝不了 Agent，只能手工登入 | 使用 Gateway 主動連線，或直接透過 SSH 免代理部署。 |

## 產品優勢

### 為什麼 TLSFlow 更適合企業

- **舊系統也能接管**：很多系統裝不了 Agent，網路還有隔離區。TLSFlow 提供多種接入方式，舊系統和隔離網路不需要大規模改造也能納入管理。
- **憑證更新故障自動退回**：更新前自動備份，驗證失敗基於備份清單和檢查點自動恢復原配置，支援失敗策略自動觸發和人工手動回滾兩種方式，避免業務掛起後再手忙腳亂地回滾配置。
- **常用與特殊應用都能接管**：高頻應用透過內建外掛直接使用，冷門裝置和特殊流程可以透過工作流程 DSL 自行編排更新步驟，無限擴展。
- **憑證關聯情況一目了然**：每張憑證綁定到具體伺服器、站台和應用，出現問題可以快速確認影響範圍。
- **完整的權限控制**：不同角色具備不同權限，敏感操作根據策略審批，密碼和私鑰不會明文顯示在日誌中。
- **完善的稽核日誌**：每次更新都能看到執行步驟、使用憑證和配置變更，出了問題可以回看，不是黑盒操作。

## 適用場景

- **異構環境複雜**：多種 Web 伺服器、應用中介軟體、負載平衡器、閘道裝置和雲平台並存，手工維護難以持續；
- **存在隔離區和舊系統**：生產區不能隨便裝軟體，舊系統也無法升級，但憑證仍然需要更新；
- **內網完全斷網**：生產環境與網際網路物理隔離，無法使用公有雲線上憑證服務；
- **需要審批和記錄**：憑證變更屬於敏感操作，需要審批流程、操作留痕和完整追溯。

讓憑證更新不再是定時炸彈。TLSFlow 用統一的資產管理、自動部署、安全回滾和持續告警，幫助團隊應對越來越短的憑證輪換週期。

## 技術架構

專案採用分層、模組化架構：核心平台統一管理資料、權限和執行合約，執行面可以按目標替換。

| 元件 | 技術與職責 |
| --- | --- |
| Web 控制台 | Vue 3、TypeScript、Vite、Pinia、vue-i18n |
| Backend | NestJS、TypeScript；按業務邊界拆分領域模組並提供 REST/OpenAPI 介面 |
| 資料持久化 | 標準部署使用 PostgreSQL 16；單機評估使用 PGlite |
| Browser Runtime | Node.js、Playwright；提供隔離的瀏覽器工作階段和受控憑證流程 |
| TLS Inspector | 獨立 Node.js 服務，用於 TLS 握手和憑證狀態分析 |
| Full Agent / CA Node | Go 原生程式，分別承擔主機執行和隔離 CA 簽發邊界 |
| 擴展執行時 | Manifest、Host API、Runner、Workflow DSL 和相容目錄 |
| 部署方式 | standard 使用 Docker Compose；small 使用單容器 `docker run` |

## 快速開始

### 前置條件

- Linux、macOS 或 NAS 主機
- Docker CLI；標準部署另需 Docker Compose v2
- 能存取目標裝置和憑證服務
- 生產環境使用隨機且長期保持不變的執行時金鑰

部署預建置映像不需要 Node.js、Go、Buildx 或原始碼。

### 單機部署

適合 50 個應用資產以下的小規模環境，使用 PGlite 內嵌資料庫，單容器執行。

快速啟動（使用 Docker 命名卷）：

```bash
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  -p 8085:3003 \
  -e GCAC_PUBLIC_BASE_URL=http://your-host:8085 \
  -e GCAC_SECRET_KEK=your-random-kek \
  -v tlsflow-small-data:/app/data \
  tlsflow/tlsflow-small:latest
```

**重要**：
- 生產環境必須替換 `GCAC_SECRET_KEK` 為隨機金鑰
- 管理員密碼在首次存取時透過初始化精靈設定
- 預設存取位址：`http://<主機位址>:8085/`

詳細參數配置、宿主機目錄綁定、HTTPS 反向代理等場景請查看完整文件。

### 標準部署

適合正式環境和多租戶場景，使用 PostgreSQL 16 資料庫，支援 Browser Runtime 瀏覽器工作階段。

**1. 準備配置檔案**

```bash
cp docker/.env.example docker/.env
```

編輯 `docker/.env`，至少填寫：
- `GCAC_RELEASE_VERSION`：映像標籤（生產環境使用固定版本）
- `GCAC_PUBLIC_BASE_URL`：Agent 可存取的 Web 位址
- `POSTGRES_PASSWORD`：資料庫密碼
- `GCAC_TOKEN_SECRET`：登入令牌簽名金鑰
- `GCAC_SECRET_KEK`：加密根金鑰（必須長期保持不變）

**2. 啟動服務**

```bash
cd docker
docker compose pull
docker compose up -d
```

**3. 驗證**

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

確認 `db` 狀態為 `healthy`，存取 `http://<主機位址>:8085/` 完成初始化精靈。

**Browser Runtime**（選用）：需要瀏覽器登入憑證時，在 `.env` 中設定 `BROWSER_RUNTIME_ENABLED=true` 並填寫 `BROWSER_RUNTIME_SHARED_SECRET`，再執行 `docker compose up -d`。

詳細資源配置、資料目錄、備份恢復等說明請查看完整文件。

## 專案目錄

```text
backend/          NestJS 後端、資料庫遷移、外掛宿主和執行編排
web/              Vue 3 管理控制台
browser-runtime/  受控瀏覽器執行時
tls-inspector/    TLS 握手與憑證探測服務
agents/           Windows/Linux Agent、CA Node 和 Gateway Agent
docker/           Dockerfile、Compose、映像和 Agent 發布套件建置工具
data/             執行期外掛、資料庫、工作流程和執行時資料目錄
docs/             使用者手冊、開發文件、維運指南和產品資料
specs/            按領域組織的需求與設計規格
scripts/          架構檢查、相容性檢查、外掛治理和公開發布工具
```

## 二次開發與擴展

### 選擇正確的擴展方式

1. **新增普通系統或認證環境**：優先複用已有 Agent、SSH、CURL 和平台能力，透過相容目錄增加配置和驗證記錄，盡量做到零核心程式碼改動。
2. **新增高頻產品**：開發產品外掛，封裝裝置連線、身分確認、唯讀發現、應用資產對應、部署計畫和目標驗證。
3. **新增小眾裝置或內部 API**：編寫版本化 Workflow DSL，使用 SSH、SFTP、SCP、CURL、條件、轉換、等待、人工確認、提取和斷言等受控步驟。
4. **確需新的執行邊界**：再評估是否需要新的 Agent 產品線或宿主能力，並先補齊協定、權限、稽核和回滾合約。

### 外掛開發邊界

- 外掛透過 `Manifest` 宣告身分、版本、能力、權限和相容範圍；
- 外掛預設只使用宿主提供的 Host API、Secret、Artifact、稽核、鎖和執行授權；
- 內建外掛位於 `backend/src/modules/plugins/builtin-plugins/<pluginId>/`；
- 使用者外掛放入 `data/plugins/`，透過統一外掛套件匯入介面發布；
- 外掛工作流程資源必須與外掛版本同步，發布前需要完成憑證更新流程測試並儲存迭代記錄；
- 外掛不能繞過宿主直接讀取租戶資料、明文憑證或任意執行宿主程序。

入口文件：[外掛開發](docs/Documentation/developer/plugin-development.md)、[宿主外掛能力](docs/Documentation/developer/host-plugin-capabilities.md)、[工作流程開發](docs/Documentation/developer/workflow-development.md)。

### 工作流程 DSL 邊界

工作流程範本使用專案私有協定 `gcac.workflow/v1`。範本來源只有：

- 內建範本：`backend/src/modules/workflow-templates/builtin-workflows`；
- 使用者匯入範本：`data/workflows`（執行期按需建立，不是內建範本目錄）。

密碼、Token、私鑰和憑證製品必須透過 `SecretRef` 或 Artifact Slot 參照，不能寫入 DSL、普通變數、日誌或執行快照。部署流程應保持 `prepare → backup → install → refresh → verify` 階段，回滾使用原始工作流程版本和輸入快照。

### 本機開發和驗證

儲存庫不要求把開發服務作為 README 交付的一部分自動啟動。常用建置和測試入口如下：

```bash
# 後端建置
npm --prefix backend run build

# 前端類型檢查和生產建置
npm --prefix web run build

# Browser Runtime 建置
npm --prefix browser-runtime run build

# TLS Inspector 測試
npm --prefix tls-inspector test

# 前端單元與合約測試
npm --prefix web run test:unit
```

後端完整測試、相容性架構檢查、外掛版本檢查和 Agent 建置有額外環境要求，請按對應模組文件和專案規範執行。測試通過不等於已經完成真實廠商裝置、外部 CA、隔離網路或生產回滾驗收。

## 安全與生產邊界

- `GCAC_SECRET_KEK` 是執行時安全材料的解密根金鑰，必須獨立備份，禁止寫入程式碼、日誌、公開文件或瀏覽器；
- 不要把授權證簽發私鑰放入儲存庫、映像或容器環境變數；公開部署只需要授權證信任公鑰；
- 標準版 Browser Runtime 只應透過內網和 Web 代理存取；
- 憑證、私鑰、Token、PFX/JKS 口令等敏感材料不得進入普通變數、執行日誌或工作流程範本；
- 目標版本、權限條件、執行通道和真實相容性必須單獨驗收；靜態程式碼、Schema 和單元測試不能替代現場驗證；
- 標準 Compose 拓撲面向單機執行，未提供自動故障轉移叢集；升級和恢復前應先備份資料庫、工作流程、使用者外掛和執行時安全材料；
- ACME、外部 CA、廠商 API 和複雜網路的能力會隨版本演進，請以當前使用者文件、外掛相容目錄和實際環境結果為準。

## 官方文件

完整使用手冊、開發文件、產品資料和技術規範請造訪：

**https://docs.tlsflow.com**

## 授權證

本專案是組合授權專案，請先閱讀根目錄 [LICENSE](LICENSE)：

- 核心原始碼和官方實現預設採用 **PolyForm Noncommercial 1.0.0**，商業使用需要單獨商業授權證或 EULA；
- 外掛 SDK、Manifest、Host API 合約及公開 Schema/協定示例預設採用 **Apache-2.0**；
- 文件和示例預設採用 **CC BY 4.0**；
- 第三方或社群外掛以其隨附的授權證和宣告為準。

## 專案定位

TLSFlow 不試圖取代所有 CA、Kubernetes 控制器或輕量 ACME 工具。它的價值在於把「憑證簽發之後」最容易失控的部分——資產關係、異構目標部署、預檢、驗證、回滾、審批、稽核和持續監控——變成一套統一、透明、可擴展的企業流程。

**用結構化資產回答「憑證在哪裡」，用外掛和工作流程回答「怎麼部署」，用預檢和驗證回答「部署是否安全有效」，用回滾和稽核回答「出了問題如何追溯和恢復」。**
