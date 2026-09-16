# 資料庫及後端深入審查

日期：2026-09-16。完成時程式基準：`5b0d2c6`。範圍只包括資料庫、後端、安全、查詢效率、背景工作，同影響 SEO 嘅伺服器資料供應；唔包括視覺設計。

## 結論

**現有系統有唔錯嘅安全及資料一致性基礎，但未可以稱為「完全安全」、「已符合 SOC 2」或者「冇 N+1／overfetch」。** 最值得先處理嘅係既有 guest 帳戶認領、後台讀取驗權、日曆 recurrence 正確性，同糧務鎖定交易。

日曆主查詢唔係典型 N+1：本機真 PostgreSQL 以 10 個合成預約驗證，主查詢連三個關聯只發出 **4 條 SQL**。但全年視圖下載全年詳細資料去計 12 個月份數字，仲每分鐘刷新，屬明確 overfetch。

糧務計算則有真正逐員工查詢：應用層操作數為 `4 + 3E + S`，E 係員工數、S 係綁定髮型師嘅員工數。10 位全部有綁定嘅員工有 **44 個 Prisma model calls**；本機 PostgreSQL 首次計算實測 **48 條 SQL statements**，當中 35 SELECT、11 INSERT、BEGIN／COMMIT 各一。呢個係合成資料量度，唔係正式環境速度測試。

本次只新增報告；冇修改應用程式、冇部署、冇讀寫正式資料庫、冇發送真實電郵。審查開始時已有公開頁面改動，亦已按現有 `publicServiceSelect` 評估，冇將已修正嘅公開 Service 欄位問題重新列作漏洞。

## 證據點樣理解

- **已重現**：執行實際模組，使用隔離 fixture／mock I/O；部分另有真 PostgreSQL 測試。每項會講明邊種。
- **程式確認**：可以由查詢、交易、條件或 schema 直接確認。
- **待正式環境驗證**：例如目前受影響 guest 數量、Neon 查詢延遲、角色權限、MFA、backup。唔會將未查嘅設定當成已失效。
- 嚴重程度同修正優先次序係本次工程判斷，唔係正式 SOC 2 意見或 CVSS 評分。

Prisma `include` 可以使用批次關聯查詢；有多條 SQL 唔等於每一筆資料都額外查一次。亦唔應將 `Promise.all(findUnique(...))` 一概計成 N 次 SQL，因為 Prisma 可批次處理合資格查詢。本次有分清 model call、SQL statement 同回傳資料量。[Prisma 6 官方查詢優化文件](https://www.prisma.io/docs/orm/v6/prisma-client/queries/query-optimization-performance)

## 高優先問題

### 01 — 既有 guest 帳戶可以未驗證電郵就被認領〔高；有資料前提〕

**影響：** 如果資料庫仍有 `password = null` 而冇 OAuth account 嘅舊客戶，知道對方電郵嘅人可以為該帳戶設定自己嘅密碼，取得預約歷史及該帳戶操作權限。

證據：[auth.ts:92](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/auth.ts:92)、[認領寫入:120](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/auth.ts:120)。流程讀取既有 user → 判定 `CLAIM_GUEST` → 寫入密碼／姓名／電話 → 發出既有 user session，冇要求電郵擁有權證明。Google 已綁定帳戶會被拒絕，呢個保護有效，但未涵蓋真正 guest。

另外 update 嘅 `where` 只有 `id`，所以讀取後至寫入前，如果另一請求已認領或完成 OAuth 綁定，仍可能被覆蓋。

**驗證：** 實際 register action 配 mock Prisma，成功寫入 fixture 申請人密碼並簽發既有 guest user session。未查正式 DB，唔代表已確認正式環境有受影響帳戶。

**修正／驗收：** 合併既有帳戶前要求一次性、限時、已 hash 嘅電郵認領 token；交易內重新檢查帳戶狀態並條件更新。冇 proof、已使用 proof、同期重複 claim 同 OAuth 綁定競態都必須失敗。另做只回傳數量嘅 production read-only 檢查，確認實際影響面。

### 02 — 後台敏感讀取過度依賴 layout，撤銷權限唔完整〔高〕

**影響：** 持有 reset／刪除／降權前有效 ADMIN JWT 嘅人，可能喺局部 RSC 導覽繼續讀到客戶或薪酬資料；寫入 action 嘅獨立驗權唔能夠代替讀取驗權。

[admin layout:11](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/layout.tsx:11) 會查最新角色及 sessionVersion；但 [middleware:53](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/middleware.ts:53) 只信 JWT 原有 ADMIN 角色。[Payroll:25](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/payroll/page.tsx:25)、[schedule:25](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/page.tsx:25)、[timesheets:49](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/timesheets/page.tsx:49) 同 [employee edit:16](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/employees/[id]/edit/page.tsx:16) 讀資料前冇自己驗權；[users:9](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/users/page.tsx:9) 有驗證登入，但冇再要求 ADMIN。

Next.js 明確指出 layout 唔會每次導覽重新執行，亦唔係 child RSC payload 嘅安全邊界；應喺資料來源附近驗權。[Next.js authentication 指引](https://nextjs.org/docs/app/guides/authentication#layouts-and-auth-checks)

**驗證：** 實際 middleware 接受已被 sessionVersion 撤銷嘅 fixture JWT；`verifySession()` 拒絕同一 JWT；獨立執行 PayrollPage 仍讀取及產生 fixture 私人資料。呢個確認模組層缺口；**未完成完整 HTTP RSC 繞過重現**，唔應聲稱已成功攻入正式後台。

**修正／驗收：** 每個敏感 DAL／page 讀取前執行 fresh `requireAdmin()`。可以 request-scoped dedupe，同一 render 共用一次 role/version lookup；唔好跨 request 快取權限。以真正瀏覽器／HTTP 驗證 demotion、reset、刪除後，既有頁面導覽、RSC、prefetch 同 actions 都取唔到受保護資料。Integrations／operations 已有獨立驗權，可沿用做法。

### 03 — 日曆 recurrence 會將實際忙碌時間移走或刪走〔高〕

**影響：** 外部日曆同步可以顯示成功，但實際忙碌時段冇被封鎖，出現雙重預約風險。

[calendar-ical.ts:69](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/calendar-ical.ts:69) 將每次 occurrence 強制改成 DTSTART 原本嘅 London 時分秒；[EXDATE:77](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/calendar-ical.ts:77) 只用日期比較，會排除成日。

**合成資料重現：**

| 輸入 | 應有結果 | 現時結果 |
|---|---|---|
| UTC 10:00 開始，`FREQ=HOURLY;COUNT=3` | 10:00、11:00、12:00 三個 occurrence | 三個都變成 10:00 |
| 同上，EXDATE 只排除 11:00 | 保留 10:00、12:00 | 成日全部被移除 |
| 9 月 19 日開始每星期 UTC 16:00–17:00 | 11 月 7 日仍為 UTC 16:00–17:00 | 變成 UTC 17:00–18:00 |

程式註解話重新錨定只會過度封鎖，實際唔成立：移走原有時段會令原時段露空。現有部分測試仲固定咗呢個錯誤假設。

**修正／驗收：** 尊重 UTC、TZID、floating time 各自語意；EXDATE 配對完整 occurrence；未支援規則要整份拒絕並保留上次有效 blocks。新增 UTC／London DST、每小時、多個每日時間、精確 EXDATE 同修改 recurrence 測試。[RFC 5545 recurrence 定義](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.5.3)

### 04 — 糧務 FINALIZED 狀態同快照唔係同一原子交易〔高〕

**影響：** 已鎖定糧單可以冇完整快照，或者仍被同期重算／調整改動，影響薪酬正確性同追溯。

[finalizePayroll:237](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/payroll-service.ts:237) 先獨立寫 `FINALIZED`，再讀 lines，最後另一個 transaction 寫 snapshots。[runPayrollWith:106](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/payroll-service.ts:106) 只喺開始檢查狀態，之後逐員工寫入；[updateAdjustment:219](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/payroll-service.ts:219) 亦係先讀 DRAFT，再無條件更新。

**驗證：** 注入 snapshot 交易失敗，period 留喺 FINALIZED，重試被拒絕；模擬重算途中 finalize，重算仍成功寫 payroll line。以上為實際模組＋mock I/O，現有真 PG 整合測試未涵蓋糧務競態。

**修正／驗收：** finalize／reopen／recompute／adjust 共用同一個 period 交易及鎖定／版本協定；status 同全部 snapshots 一起 commit。用真 PostgreSQL 測試同步 finalize、調整、重算、途中失敗，確保冇部分提交。

## 查詢效率、資料完整性及維護問題

### 05 — 日曆全年 overfetch、全域 pending 冇分頁〔中〕

[admin/page.tsx:35](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/page.tsx:35) 每次做六個主要 model calls，包括整個所選日／月／年嘅預約、今日統計、同步覆蓋、roster、busy blocks，同所有 PENDING。`include` 有縮窄關聯，但 appointment 本身仍然取全部 scalar 欄位，包括 notes、同步狀態／error 等，再喺 [112 行](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/page.tsx:112) 傳入 client。

[YearView:76](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/ScheduleCalendar.tsx:76) 只需要 12 個月份數字，唔需要整年客戶電郵、notes、roster 同逐項 busy blocks。[每分鐘刷新:275](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/ScheduleCalendar.tsx:275) 會重覆呢啲讀取：單一持續開住嘅 tab，一小時已有約 360 個 page-specific model calls，未計關聯 SQL、驗權及額外導覽。

[pending 查詢:65](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/page.tsx:65) 冇 `take`／cursor，所選時段內嘅 pending 仲會同主清單重複。保留跨日期請求可操作係正確需求，唔應簡單刪走遠期請求。

**建議：** 年視圖用 London 月份聚合；月視圖只取摘要；日視圖先取完整日程同 busy blocks。統一安全、primitive DTO，另設全域 pending count＋cursor 分頁／搜尋。用小型 freshness 查詢或可見範圍刷新，避免每分鐘重載全年。

### 06 — 糧務有真正 N+1，唔應只加 Promise.all〔中〕

[payroll-service.ts:132](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/payroll-service.ts:132) 每位員工再讀 time entries、現有 payroll line，再寫入；有 stylist 就再讀 completed appointments。公式係 `4 + 3E + S`，包含讀寫操作；其中 reads 為 `3 + 2E + S`。

Mock 計數 E=S 為 1／10／100 時，分別 8／44／404 個 model calls。本次另以真 PG 確認 10 位員工、冇工時／佣金紀錄、首次生成嘅情境，共 48 條 SQL。實際有關聯資料、已有 lines 或不同 Prisma upsert 路徑時，SQL 數字會改變。

**建議：** 一次讀該月 approved entries、相關 stylist revenue 同已存在 lines，按 employee/stylist 建 map，計算後喺第 04 項嘅受保護交易內寫入。保留必要逐列寫入，但消除逐員工額外讀取。大量 Promise.all 只會將 round trips 變成連線池壓力。

### 07 — 資料清單冇分頁；部分有上限但冇下一頁〔中〕

| 位置 | 問題 | 建議 |
|---|---|---|
| [客戶預約:17](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/appointments/page.tsx:17) | 一次讀該用戶全部歷史，DB 仍取 appointment 全 scalar；client DTO 已縮窄 | upcoming 獨立讀；history cursor 分頁 |
| [Admin users:21](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/users/page.tsx:21) | 所有 Google customers 載入先揀人 | 伺服器搜尋＋有限結果 |
| [Blog service:100](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/blog-service.ts:100) | 公開 list／sitemap／static params 讀所有文章正文 JSON；admin list 同樣問題 | list／sitemap／detail 分開 `select`；list 分頁 |
| [Review moderation:51](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/review-service.ts:51) | 最多 100 筆，冇下一頁，舊 approved review 可能無法正常取消公開 | status＋cursor＋穩定排序 |
| [Shifts:23](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/shifts/page.tsx:23) | 只取首 100 個未來 shifts，冇下一頁 | 日期範圍／週視圖＋分頁 |
| [Employees:12](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/employees/page.tsx:12) | list 讀全 employee，包括無需用到嘅 PIN hash／薪酬欄位 | 專用 list select；唔等於已證明 hash 傳去 browser |

### 08 — 已停用髮型師仍可參與 slots／指定預約〔中〕

[availability union:189](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/booking-service.ts:189) 冇 `stylist.isActive` 條件；指定 stylist slots 同建立交易嘅 [stylist lookup:281](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/booking-service.ts:281) 亦冇核實 active。

**驗證：** fixture 只有停用 stylist 嘅 availability，union 仍產生 18 個 slots；實際 submit→create 模組鏈亦接受該 stylist。公開 roster 已排除停用 stylist，但舊頁面或直接 action request 仍可以帶舊 ID。

**建議：** 查 slots 同交易內最終提交都要求 active；另定清楚已存在預約點樣處理退休 stylist 嘅改期。

### 09 — 每人六個有效預約上限有競態〔中〕

[booking.ts:226](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/booking.ts:226) 喺建立 transaction 外先 count，交易內冇重查。兩個不同時段嘅請求可以都見到 5，之後兩個都新增。

**驗證：** mock 初始 5 個，兩個 submit 都成功，變成 7；即使將交易 callback 逐個執行，仍然失守，因為 count 已經做完。

**建議：** count 同 create 放同一個可以保護 user-wide invariant 嘅交易／鎖定流程，配合 serialization retry；測試兩個不同 stylist／日期嘅同期請求。

### 10 — Kiosk token 一年有效，停用只刪本機 cookie〔中〕

[session.ts:96](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/lib/session.ts:96) 簽發只有 `kiosk:true` 嘅 365 日 JWT；[停用:124](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/lib/session.ts:124) 冇 server-side revocation。

**驗證：** authorized disable 後還原複製 cookie，`getKioskSession()` 仍為 true。影響係遺失／被複製裝置繼續讀職員名單／狀態；打卡修改仍需要員工 PIN，唔係 admin 接管。

**建議：** device/session ID＋撤銷狀態／version、合理 expiry、遠端停用同 rotation。現有 kiosk 啟用時刪 admin session 嘅修正有效，應保留。

### 11 — Calendar sync 每個 interval 一次逐筆寫入〔中；規模相關〕

[calendar-sync-service.ts:77](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/calendar-sync-service.ts:77) 喺 15 秒 transaction 內逐個 await upsert；parser 容許最多 2,000 intervals。每次平均只要 7.5ms，就已用盡 15 秒，未計其他工作。呢個係上限算式，唔係量度到 production 已 timeout。

失敗會保留舊 blocks，呢點做得好；但 error 會令 readiness 停止接單。

**建議：** 有界 bulk/staging upsert，再原子 reconcile；唔好用分批刪除造成中途露空。以可接受最大 feed＋真 DB round-trip 延遲測試 transaction 預算。

### 12 — 個人資料清理綁住通知派送，而且重覆更新已清理資料〔中〕

[notification-cron-service.ts:82](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/notification-cron-service.ts:82) 只喺 worker 前段成功完成先 scrub 超過 30 日嘅 FAILED／PENDING／SKIPPED payload。[通知停用:11](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/api/cron/notifications/route.ts:11) 會連清理都跳過；PROCESSING 亦唔喺呢個清理條件內。

清理後仍然係 SKIPPED，下次再命中，令每次 cron 都重寫全部歷史舊 rows。成功／因已不適用而跳過嘅事件會清空 payload，呢個係好基礎；retry window 過期只標 FAILED，仍要等後續清理，唔等於全生命週期 retention 已完整。

**建議：** housekeeping 同發信開關分離；先處理過期 lease，再分批 scrub 未清理 payload；定義 metadata 留存期、刪除／匿名化政策。亦要為 [已過期 external busy blocks](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/calendar-sync-service.ts:87) 設獨立清理，現有 reconcile 只會刪 `end > completed` 嘅範圍。

### 13 — Notification indexes 未完整配合實際讀取〔中；要 EXPLAIN 確定收益〕

[NotificationDelivery schema:419](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/vercel/schema.prisma:419) 除主鍵／eventKey unique 外只有 `(status,nextAttemptAt)`。但 [immediate dispatch:79](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/notification-outbox-service.ts:79) 按 appointmentId 查；cron 按 appointment 關聯＋kind 查；reclaim 按 status＋lockedAt 查。

**建議候選：** `(appointmentId,kind)`、reclaim 用 `(status,lockedAt)`，再視排序／實際 query plan 決定 queue index。另一個候選係全域 pending queue 嘅 `(status,date,id)`；現有 `(status,reminderSent,date)` 並唔完全等價。用有代表性資料跑 `EXPLAIN (ANALYZE, BUFFERS)` 先決定，唔應盲目加全部 indexes。本次冇 production EXPLAIN，唔宣稱現時慢查詢已實證。

### 14 — 三份 schema 相近，但 dev／legacy migration 歷史唔一致〔中〕

三份模型定義大致一致；問題係 checked-in migration chain。隔離 in-memory SQLite 重播全部七個 dev migrations 後，仍少 **15 個完整 models**，亦少 User.sessionVersion、stylist active 狀態、booking snapshots 等欄位。[dev schema](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/dev/schema.prisma:396)、[最新 dev migration](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/dev/migrations/20260916153000_calendar_colours/migration.sql:1)、[公開 commands](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/package.json:18)。SQL Server migration 歷史亦見類似缺口，未實跑 SQL Server。

**相反，PostgreSQL 15 個 migrations 本次由空庫成功重播，與現有 schema diff 為零。** 唔應將 SQLite 問題描述成已確認 Neon drift。

**建議：** 正式選定支援資料庫。最少維護成本通常係本機／CI 同 production 都用 PostgreSQL；如要繼續三套，CI 必須逐套空庫重播＋schema diff。`db push`／臨時生成新 migration 唔能代替可重現歷史。

### 15 — Seed 冇防止誤指向正式資料库嘅程式護欄〔中；操作風險〕

[seed.ts:26](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/seed.ts:26) 無條件刪 appointments、availability、stylists、services、users，client 直接沿用設定嘅 DB。文件有警告，但程式冇 localhost／disposable-name／顯式 destructive flag 檢查。

**建議：** 仿照已有 integration script，只允許已知即棄 target；production reference data 另用 idempotent script。角色亦應限制日常 app 做 schema／管理操作。今次冇執行呢個 seed。

### 16 — Sitemap 資料失敗被吞掉；lastModified 唔完全反映內容變更〔中／低；後端 SEO〕

[sitemap.ts:24](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/sitemap.ts:24) 將 DB error 全部轉 null／空陣列，仍可產生成功但缺文章／分類／stylist URLs 嘅 sitemap，並有一小時 revalidate。失敗被當成成功，無法依靠 regeneration error 保留完整舊版本。

[分類 lastModified:53](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/sitemap.ts:53) 用 `service updatedAt ?? category updatedAt`，唔係兩者較新值；只改分類文案時可能仍報舊時間。其他幾頁用每次生成嘅 `now`，唔係實際內容修改時間。

**建議：** 重要 sitemap 資料載入失敗時保留最後有效版本／令 regeneration 正確失敗並告警；輕量 `select` 只取 URL、slug、時間；lastModified 取實際相關來源嘅最大修改時間。Google 建議 lastmod 要準確且可驗證。[Google sitemap 指引](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

## 各資料讀取部分盤點

下表數字係正常路徑嘅主要 **Prisma model calls**，未計共用 root layout、auth 同額外關聯 SQL；並非 production profiler 結果。小型固定目錄一次讀晒未必有問題，優先處理會持續增長嘅客戶／預約／文章／通知。

| 部分 | 目前讀取模式 | 判斷 |
|---|---|---|
| Admin 日／月／年日曆 | 6 calls，所選日期範圍＋全域 pending | 非逐預約 N+1；全年／pending overfetch 要改 |
| Available slots／Anyone | availability、appointments、external blocks 三組批次讀取；readiness 另加查詢 | 非逐 stylist N+1；縮窄 appointment 欄位，補 active filter |
| 提交指定預約 | 交易內先查衝突，之後 shared validator 再查一次 | 重複 reads；可共用同交易內已讀 interval，保留最終驗證 |
| Customer appointments | 全部歷史＋窄關聯，安全 DTO | 加歷史分頁；DB scalar select 縮窄 |
| Admin users | 2 個 sequential reads；全部 admins＋Google customers | 可 parallel，但搜尋／分頁更重要 |
| Employees list／edit | list 2 個 parallel reads；edit 3 個 | list 避免 PIN hash／完整 pay scalar overfetch |
| Shifts | 2 reads，首 100 個未來 shifts | 有上限，欠下一頁 |
| Timesheets | 2 個月範圍批次 reads | 唔係 N+1；用 employee/date map 代替每 shift filter 全部 entries |
| Payroll page | 1 個 period query＋lines／employee 關聯 | 頁面冇逐員工 query；run action 有 N+1 |
| Services admin list | 1 個列表＋relation `_count` | `_count` 唔應誤報為 N+1 |
| Services new／edit | 1 個 distinct category／2 個 parallel reads | 基本合理 |
| Stylists admin list | roster＋appointment groupBy | 非逐 stylist 查 count；可視需要只聚合所需範圍 |
| Stylist edit | 同一 stylist 2 次 sequential lookup | 可合併 selected fields |
| Opening hours | roster/week＋readiness 所需 reads | 重覆 staff/availability 可 request dedupe |
| Categories list | 全部完整文案＋service group counts | list 改摘要 select，避免全文 JSON |
| Category new／edit | distinct categories／單一 row＋categories | 基本合理 |
| Blog admin／public list | 全部 full posts，包含 sectionsJson | 明確 overfetch；新增摘要 query＋分頁 |
| Blog detail | slug lookup 已 React cache，related slug lookups | metadata/body dedupe 做得好；related cards 可縮窄欄位 |
| FAQ admin | all FAQs＋distinct keys | keys 可由已讀 rows 建立；目錄大先分頁 |
| Reviews admin | 100 rows＋status aggregate | count 批次；要可翻頁；appointment relation scalar 可縮窄 |
| Discounts／offers admin | 各 1 個全列表 query | 規模小可接受；長期增長先加分頁 |
| Settings | React cache＋跨 request cache | 正常 cache miss 一次；初始化可能 create/reread |
| Integrations | 約 12 calls，多個 counts／coverage／roster | 固定 query 數，唔係 N+1；可合併 aggregate／roster |
| Operations | 2 reads；job metadata＋最新 30 notification metadata | 欄位窄、近期列表有界，方向良好 |
| Home | 服務目錄挑 6 個、公開 stylists、offer、rating aggregate、settings、FAQ | 無逐 item query；目錄挑選係刻意設計，規模大先改 featured IDs |
| Services public | 目錄＋offer＋category content＋FAQ | service 已白名單；category link 只需 slug/category，唔需全文 |
| Category detail | 單類服務／offer／FAQ／related categories | category getter 缺 request cache，metadata/body 可重覆；related findUnique 勿直接當 N 次 SQL |
| Public stylist detail | metadata、body、related 都可觸發 all-active-stylists scan | 三次 findMany 模式；單人用 slug lookup＋request cache，related take 3 |
| Public reviews | 最多 60 reviews＋aggregate；appointment include 全 scalar | 有界、非 N+1；只 select 展示需要欄位；冇證據多餘 scalar 被公開輸出 |
| Sitemap／static params | 重用 full blog/category/stylist getters | 專用輕量 projection，避免讀正文／完整履歷 |

其他維護項目：

- [Booking conflict reads](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/booking-service.ts:291) 同 shared validator 有重覆；重構要保持所有讀取喺同一 transaction，唔好為快而移走交易保護。
- [手機日程:210](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/ScheduleCalendar.tsx:210) 用 live service.duration／price，與 desktop frozen duration 不一致；共用 DTO 應優先 `durationAtBooking`／`priceAtBooking`，再 fallback legacy 值。呢個係後端快照消費一致性問題。
- `verifySession()` 可以只喺同一 request dedupe；admin 寫入後嘅 fresh role/version 檢查仍要保留。
- [Prisma 初始化](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/lib/prisma.ts:22) 喺 import 時呼叫 `getDatabaseUrl()`；雖然 env 讀取寫喺 function 內，實際仍係 module-load resolution，未符合 repository 嘅 runtime-only 意圖。唔係資料外洩漏洞，但測試／build 維護上宜清晰分隔。
- [Category／blog DTO](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/category-content-service.ts:59) 有手寫 DB row 型別；長期改用 Prisma `GetPayload`／`Pick` 表達實際 select，減少 schema drift。Runtime 已解析 JSON 嘅輸出型別可以繼續獨立定義。
- 尚未啟用嘅 [Treatwell API worker](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/treatwell-api-worker.ts:46) 冇 claim/version guard，網絡回應後只按 id 標 SYNCED；未來接入前要防止覆蓋同期取消／改期。未見 production caller／正式 adapter，所以唔列成現時已觸發漏洞。

## SOC 2 同業界做法評估

**程式審查本身唔可以證明 SOC 2 合規。** SOC 2 係對服務組織控制嘅獨立查核；Type II 亦涉及一段期間內控制運作嘅有效性。Vercel／Neon 或其他供應商有報告，唔會自動令你嘅應用程式、員工操作、權限管理同復原流程都獲得同樣結論。[AICPA SOC 說明](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services)、[Trust Services Criteria](https://assets.ctfassets.net/rb9cdnjh59cm/72xv4p67HVXKp6CjWmjkPk/1cdbfa19f6307e2720396b66a6194dc9/trust-services-criteria-updated-copyright.pdf)

應用程式安全可以用 OWASP ASVS 5.0 作逐項驗收基準，按客戶、員工及薪酬資料嘅風險選範圍；今次唔係完整 ASVS 認證／全項測試。[OWASP ASVS 官方專案](https://github.com/OWASP/ASVS)

| 控制範疇 | 程式可見基礎 | 未完成／需要證據 |
|---|---|---|
| 身份及最小權限 | bcrypt、JWT、安全 cookie、mutation auth、owner checks、sessionVersion | 修正 01／02／10；admin MFA／step-up；獨立帳戶、offboarding、定期 access review |
| 管理員 session | signature、expiry、DB 最新角色 | 現時 30 日並可 sliding refresh；需要按風險縮短 admin absolute／idle expiry，敏感操作再驗證；Google 上游 MFA 狀態未核實 |
| 濫用防護 | 共用 Upstash limiter、記憶體 fallback | Redis outage／未設定會退回每 instance，冷啟動重設，唔係全站共享限制；核實正式 Redis、可信 client IP、告警及 outage 策略 |
| Audit trail | 通知 event key、job 最後狀態、部分 editedBy/finalizedBy | 未見涵蓋 admin 權限、預約 override、價格／薪酬／整合變更嘅完整 append-only 業務審計；`updatedAt` 同平台 access log 唔足夠 |
| Processing integrity | booking Serializable、discount/outbox 同交易、frozen snapshots | 修正 recurrence、payroll、retired stylist、booking cap；記錄並覆核 admin override |
| Availability／復原 | readiness、cron leases、保留上次 busy、health DB query | Neon 實際 PITR／backup retention、RPO/RTO、加密備份、復原演練、region／pool／限制未驗證 |
| Confidentiality／privacy | 公開欄位白名單、reset token hash、busy feed 唔輸出客戶詳情、成功 email payload 清空 | 定義各資料用途／保留／刪除；第 12 項 housekeeping；ICS bearer secret、backup、log 嘅存取及 rotation 證據 |
| Change management | lint/unit CI、lockfile、production migrations | branch protection／review policy 未查；CI 未執行真 PG integration 或 migration replay/diff，亦未見持續 dependency audit／secret scanning job |
| 監控及事件處理 | operations page、worker error metadata | error/queue age/同步過期告警、負責人、處理時限、事件演練同證據保存 |
| 供應商管理 | Vercel、Neon、Resend、Upstash、日曆平台整合 | 合約／資料處理安排、供應商報告範圍、帳戶擁有人及權限覆核；本次未查雲端後台 |

上表講「未見」代表 repository 冇足夠證據，唔代表公司一定冇做。現有 [CI workflow](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/.github/workflows/deploy.yml:15) 喺 CI job 跑 lint＋unit tests，後續 Vercel job 有 build；唔應誤稱整個 pipeline 完全冇 build。要補嘅係可重現資料庫／真交易測試，以及可持續保留嘅控制證據。

## 已經做得好嘅地方

- 主要寫入 actions 自己驗權；預約及評論有 owner check，唔只依賴 UI 隱藏按鈕。
- 正常 `verifySession()` 查最新 DB role/version；password reset 使用 hash token、expiry、原子單次使用並提升 sessionVersion。
- OAuth 有 state、PKCE、nonce、issuer/audience 同 verified email；冇發現本次範圍內明確 SQL 字串拼接注入路徑。
- 預約建立／改期有 Serializable＋retry，價格／時長 snapshot，折扣及 outbox 可隨交易 rollback。
- Calendar transport 有 HTTPS／DNS 地址檢查、固定驗證後 IP、禁止 redirect、TLS、大小及 timeout 限制；唔係直接 fetch 任意內網 URL。
- Calendar sync 有 lease＋token/config CAS；失敗保留舊 busy blocks。Outbound feed 用 Busy 摘要，避免洩漏客戶詳情／回音循環。
- Notification outbox 有 event key unique、claim token、provider idempotency key、stale-event checks、retry budget、成功／跳過 scrub。
- Cron 有 secret 驗證及 feature flags；公開 settings／offers flag 已同時用 React request cache 同跨 request cache。
- 公開 service／stylist select 有明確白名單；現有 appointment／availability／OAuth／reset 等亦有有用 indexes／unique constraints。

## 後端同 SEO 嘅關係

公開首頁、services、blog、stylist 等已有 server-rendered／ISR 設計，Header 冇為帳戶狀態讀 cookies 而迫全站動態化；呢個方向適合 SEO 網站。Private admin calendar 查詢本身唔會直接成為 SEO 排名訊號；不過共用 DB 被大量刷新拖慢，會間接影響公開頁 cache miss／revalidation、TTFB 同錯誤率。

優先保障公開頁穩定可讀、正確 metadata／sitemap，同 cache invalidation；唔需要為咗 SEO 將所有私人資料快取。Google 嘅大站 crawl-budget 指引亦表明，一般細網站應先保持 sitemap 同 indexing 正常，唔需要套用超大型網站嘅所有優化。[Google crawl-budget 指引](https://developers.google.com/crawling/docs/crawl-budget)

本次只評估資料供應同伺服器相關因素，冇做搜尋排名、Search Console 或完整前端 Core Web Vitals 審查。

## 實際驗證結果及限制

主要驗證環境：Node **24.21.0**、pnpm **10.33.0**、本機獨立 PostgreSQL **17.11**，資料库 `salon_test`，只用合成資料；測試後已停止該 PostgreSQL instance。

| 檢查 | 本次結果 |
|---|---|
| `pnpm test` | **458／458 通過**，0 failed／skipped；Node 24 驗證 |
| `pnpm lint` | 通過；Node 24 再核對 |
| 最新 `pnpm audit --json` | **0 個已知 vulnerabilities**，556 dependencies；唔代表冇應用邏輯漏洞 |
| PostgreSQL migrations | 空 DB 重播全部 **15 個**成功 |
| PostgreSQL schema diff | **No difference detected**，exit 0 |
| `pnpm test:integration` | 真 PG booking／worker concurrency、snapshot、discount rollback、transactional outbox、calendar reconciliation／failure preservation、readiness gate 通過；假 transport，冇寄信 |
| 真 Prisma SQL probe | 10 員工首次 payroll：48 statements；10 預約＋3 關聯 calendar read：4 statements |
| 額外模組 probes | guest claim、kiosk token restore、admin read guard gap、payroll failure/interleaving、retired stylist、active-cap race 已按各節說明重現 |
| 合成 ICS probes | hourly、EXDATE、UTC 跨 DST 問題重現 |
| SQLite migration replay | 七個 migrations 可執行，但重建 schema 缺少現行 models／欄位 |

本次**未做**：production DB/cardinality/SQL trace、正式 `EXPLAIN ANALYZE`、Neon pool／p95 latency、完整 HTTP RSC 攻擊測試、真平台日曆／電郵端到端驗收、SQL Server migration 執行、backup restore 演練、完整新 production build。唔可以用 unit tests 全綠或 audit 0 去推論以上都已合格。

可重查本機紀錄：[測試](/tmp/harbour-backend-audit-20260916/tests.log)、[lint](/tmp/harbour-backend-audit-20260916/lint-node24.log)、[audit](/tmp/harbour-backend-audit-20260916/dependencies.json)、[migrations](/tmp/harbour-backend-audit-20260916/migrations.log)、[schema diff](/tmp/harbour-backend-audit-20260916/schema-diff.log)、[integration](/tmp/harbour-backend-audit-20260916/integration.log)、[SQL probe](/tmp/harbour-backend-audit-20260916/query-probe.log)。`/tmp` 係臨時證據位置，唔係長期 SOC 2 證據庫。

## 建議修正次序及完成標準

1. **先處理安全同正確性：** 01–04；再補 inactive stylist、booking cap、kiosk revoke。完成標準係未驗證身份攞唔到資料、撤銷即時生效、重複日曆唔會露空、糧單交易全部成功或全部 rollback。
2. **再處理最大查詢成本：** 年／月／日日曆分開資料合約、pending 分頁、payroll batch reads、列表輕量 select。同一資料集增加到十倍時，讀取 query 數唔應跟員工／預約筆數線性增加；年視圖只返回聚合結果。
3. **補維護保障：** 明確支援 DB、空库 migration replay/diff 加入 CI、真 PG concurrency tests、seed guard、獨立 retention worker。將目前會重現嘅錯誤變成固定 regression tests。
4. **補正式環境證據：** 經授權做只讀 index／cardinality／query plan 檢查，用合成負載 staging 量度 p50/p95/p99、SQL 數、讀取列數、RSC payload bytes、pool wait、cron duration／queue age；按 salon 實際規模訂可接受目標，唔用任意數字假裝「industry standard」。
5. **如有商業要求先做正式 SOC 2 準備：** scope、owner、risk register、access reviews、audit trail、backup/restore、incident/vendor/change evidence，再由合資格獨立查核人評估。

對呢個 salon 網站，合理方向係繼續用現有 Next.js＋Prisma＋PostgreSQL，補好存取控制、交易、分頁、批次查詢同監控；今次證據未顯示需要改成微服務、另建搜尋集群或重寫整個 backend。
