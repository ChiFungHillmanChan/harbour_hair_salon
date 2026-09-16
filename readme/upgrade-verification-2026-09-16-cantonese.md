# 依賴升級及指定修正 — 驗證紀錄

日期：2026-09-16。基準：`main`，HEAD `8fa7f90` 加原有未提交改動。保留原有日曆顏色、拖拉及縮放功能；今次所有修正直接留喺 `main` 工作目錄，未 commit、push 或部署。

## 今次完成嘅範圍

用戶指定「第 3、4、5 項」按上一則對話摘要計，即遠期預約、kiosk 管理員登出、通知旗標；分別對應原審查報告第 04、05、06 節。

| 項目 | 修正 |
|---|---|
| 第 3 項：遠期預約 | 日期及 day/month/year 視圖由 URL 控制，轉頁會重新查詢相應時段；使用 London 日期邊界，月份包括相鄰月份格。待確認數量及清單獨立查詢所有日期，支援直接開啟及確認遠期請求。 |
| 第 4 項：共用打卡平板 | 先驗證當前管理員身份，再建立 kiosk cookie、刪除 session 及 session_hint，自動轉去 `/kiosk`。原瀏覽器再開 `/admin` 必須重新登入。 |
| 第 5 項：通知開關 | 共用 dispatcher 只喺 `NOTIFICATIONS_ENABLED === 'true'` 時讀取及派送通知。false／未設定時保留佇列，唔會讀取工作、render 或寄信；重新啟用後可派送仍有效通知。密碼重設沿用獨立郵件流程。 |
| Build 缺欄位 | 三個 provider 都補咗 `20260916153000_calendar_colours` migration，新增 nullable `Service.calendarColor` 同 `Stylist.calendarColor`。 |
| 依賴及執行環境 | 更新直接及間接依賴、lockfile；Node 固定 24.x，pnpm 固定 10.33.0，CI 同 Docker 設定同步。新增 pnpm 指定原生依賴 build scripts 清單。 |

主要版本：Next.js／eslint-config-next **16.3.5**、React／React DOM **19.3.0**、Prisma client／CLI **6.19.3**、sharp **0.35.4**、PostCSS **8.5.28**、Tailwind **4.3.3**、node-ical **0.27.2**。亦更新 Resend、jose、Upstash、Zod、date-fns、tsx 及型別套件。MediaPipe JS 同 WASM CDN 同步至 **0.10.35**，已確認 WASM 資源 HTTP 200。

安全 override：`@prisma/config@6.19.3>deepmerge-ts` 固定 **8.0.0**。已對照 Prisma 實際 config loader 所用 API，確認一般 config 載入相容；舊版遞迴物件崩潰重現、新版修正。參考 [deepmerge-ts 官方 v8 說明](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)。

保留相容 major：Prisma 7 要改 adapter/config 架構；ESLint 10 超出現有 eslint-plugin-react peer 範圍；TypeScript 維持工具鏈支援嘅 5.9.3。今次冇用 prerelease 或強行忽略 peer 相容性。Prisma package config、React Email components 同 ESLint 9 仍有棄用／支援期提示，後續應安排相應 major 遷移；audit 0 唔代表所有套件都冇維護工作。

升級後新 lint 規則指出 booking 成功按鈕使用硬跳頁，已改用 Next Link。

## 實際驗證結果

驗證使用 **Node 24.21.0、pnpm 10.33.0、獨立本機 PostgreSQL 17.11**。Build、Server Actions 同 browser 都指向即棄 `salon_test`，冇連正式資料庫寫入。電郵及 Redis 真實 credentials 已停用；整合測試用假 transport，冇寄出真實電郵。

| 檢查 | 結果 |
|---|---|
| 完整 `pnpm audit`（包含開發依賴） | 升級前 **38**：2 critical、25 high、11 moderate；升級後 **0**，命令 exit 0。 |
| `pnpm install --frozen-lockfile` | 通過，lockfile 一致，Prisma client 成功重新生成。 |
| `pnpm test` | **458/458 通過**，0 failed／skipped。新增 17 個針對指定修正嘅測試。 |
| 日曆時區回歸 | 日曆 10 個測試喺本機、Kiritimati、Los Angeles、Tokyo 時區核對通過。 |
| `pnpm lint` | 通過，0 errors／warnings。 |
| TypeScript | 獨立 `tsc --noEmit --incremental false` 及 production build 內 TypeScript 檢查通過。 |
| 三份 Prisma schema validate | SQLite、PostgreSQL、SQL Server 全部通過。 |
| PostgreSQL migrations | 由空 DB 成功重播全部 **15 個 migrations**；`prisma migrate diff --exit-code` 回報 **No difference detected**。 |
| `pnpm test:integration` | 真 PostgreSQL 同時預約／worker 派送、價格快照、折扣回滾、交易通知佇列、日曆同步失敗保留 busy block 及預約 readiness gate 全部通過。 |
| `pnpm build` | **通過，exit 0**；33 個靜態頁生成完成，原本 `Service.calendarColor` 錯誤已消除。 |
| 本機 production HTTP | 13 個公開頁及 health 全部 200；未登入 admin／appointments 分別 307 到 signin。 |
| Browser：遠期／跨年 | 從 9 月按 Next period 到 11 月，載入 11 月 30 日預約；全年視圖同時顯示 1 月歷史紀錄及 11 月預約；2027 年 2 月待確認請求仍喺清單。 |
| Browser：確認預約及停用通知 | 真 Server Action 成功確認 11 月 30 日測試預約，待確認數由 2 變 1。DB 內通知保持 **PENDING**，冇 SENT，符合停用旗標。 |
| Browser：kiosk | 啟用後自動去 `/kiosk`；再開 `/admin` 轉 signin；重新開 kiosk 仍睇到合成員工名單，證明 kiosk session 保留。 |
| Browser console | 所測登入、日曆、kiosk 及首頁流程冇 warning／error。 |
| 手機／圖片 | 390px 首頁冇橫向溢出或失效圖片；Next／sharp 將本機 hero 圖成功輸出 AVIF（HTTP 200）。 |

Build 仍有非阻擋提示：舊 `middleware` 命名棄用，以及 Next／jose import graph 嘅 Edge API 警告。實際本機 production 登入、JWT 保護及 kiosk session 流程已通過；呢個唔等於已驗收 Vercel 真實部署環境。

驗證後已停止即棄 app／PostgreSQL。含合成資料嘅 `.next` 已移到 `/tmp/harbour-main-upgrade-20260916/verified-next-build`，避免之後誤用測試預渲染內容；測試及 audit logs 同樣保留喺該臨時目錄。

## 仲未代表可以全面開放預約

**指定三項修正及升級驗證已完成，但整體上線結論仍然係 NO-GO。**

- 原審查嘅 RRULE 夏令時間問題仍然重現：UTC 每星期 08:00–09:00 事件，10 月 25 日會被應用程式錯移到 09:00–10:00。已用升級後 node-ical 0.27.2 再驗證；依賴更新冇修正呢段應用邏輯。
- 原審查其餘未指定問題（退休 stylist、resize 通知版本、跨日 busy 顯示、payroll finalize 競態、admin email 大小寫）未喺今次擴大範圍修正。
- 正式資料庫尚未套用新 migration。既有 `vercel-build` 會喺 production build 前執行；需要部署流程成功，先代表正式 schema 已更新。
- 真實電郵、各平台日曆證據、Redis 同實際用戶驗收仍按原 rollout 要求處理。
- SQL Server migration 只做語法／schema 審查，未連 SQL Server 實跑；SQLite 未重播完整舊歷史。Legacy Docker 仍有原有 standalone output／build DB 設定問題，今次只同步 runtime，冇聲稱 Docker image 已驗證。

詳細原始問題見 [首次上線審查](launch-review-2026-09-16-cantonese.md)。
