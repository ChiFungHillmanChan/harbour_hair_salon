# 網站最終檢查及修正報告 — 2026-09-19

> 呢份係 commit／部署前嘅驗收快照。你之後已授權 commit、push 同正式部署；最新 CI、部署網址同部署後實查結果會喺交付訊息記錄。下面「未部署」描述係呢份快照當刻嘅狀態，唔代表其後部署失敗。

## 結論

**程式修正已喺本機完成同驗證；可以準備預覽／有限公開測試，但未可以當成已完成雙向同步、可正式接單嘅系統。**

正式網站仍用原有版本；今次未 commit、push 或部署。網站預約主開關維持 OFF，Vercel 通知／日曆同步開關亦冇改動。測試冇寄出任何真實電郵，冇建立、改期或取消真實客人預約。

正式環境有執行四次「Test and sync saved feed」，更新相應 Fresha 忙碌時段同測試時間；亦執行一次只讀連線診斷並儲存報告。收到你進一步授權後，另喺 Fresha 成功新增 Funky、Ivan、Shania 三條網站匯入連接；Lox 兩次提交都被拒絕，未新增成功。詳情見下面跟進結果。

## 全站已準備嘅範圍

「已有功能」唔等於全部第三方正式環境驗收完成。以下根據程式、現有測試同今次實際操作整理。

| 範圍 | 已有及已核對 | 正式開放前仍需核對 |
|---|---|---|
| 公開網站 | 首頁、服務／分類、髮型師／個人頁、優惠、聯絡、評論、文章、私隱頁；手機／桌面版、服務及人員資料由後台管理 | 部署後逐頁 HTTP／內容／手機顯示；店舖價格、時間、政策、電話及外部預約網址由 salon 確認 |
| 預約入口 | 開關關閉時提供電話及已配置平台入口；網站直接接單受後端 readiness 檢查保護 | Fresha 公開商戶網址未配置；未應直接開網站接單 |
| 客人預約 | 登入、選服務／髮型師／時間、Pending 申請、管理員確認、本人改期／取消；24 小時規則、價錢／時長快照、交易搶位保護 | 真實 provider 同步驗收、salon 審批流程演練；管理員可明確覆蓋部分撞期警告，唔應將警告當成自動鎖定保證 |
| 染髮前置條件 | Consultation／Patch Test 路由、完成記錄、至少 48 小時等服務端限制；移除舊「免費 patch test」承諾 | 確認現行 £15 服務價格、療程及前置条件標記、現有客人記錄係 salon 認可資料 |
| 帳戶及權限 | 帳密登入、Google OAuth 路由、密碼重設、MFA、角色限制、session 撤銷／降權、分頁及私人欄位保護 | Google 真實回呼、password-reset 真實郵件、MFA recovery 等操作驗收；本次冇寄真實信或更改憑證 |
| 管理後台 | 日／月／年日曆、待批預約、建立／改動預約、營業時間、服務、髮型師、優惠、折扣、FAQ、文章、評論、用戶及網站設定 | 每位髮型師時間／服務／平台接單安排；尤其 Shania Fresha calendar bookings 關閉 |
| 員工營運 | 員工、kiosk PIN 打卡、timesheet、shift、gross payroll 計算及 CSV 功能；相關自動化測試覆蓋 | 真實員工流程、費率及薪酬結果要 salon 對數；唔代表完整稅務／出糧系統已驗收 |
| 通知 | Resend 範本、持久化 outbox、重試／冪等、預約各階段通知及提醒；慢寄信唔再阻塞預約回應 | 通知開關仍 OFF；客人及 salon 真實收件、垃圾郵件、回覆地址、cron delivery 尚未驗收 |
| Fresha／Treatwell | 逐位 inbound ICS、私人 outbound Busy feed、同步失敗保留已知封鎖、過期 evidence 關閉接單 | Lox 422、Treatwell 未完成、四位雙向建立／改期／取消／休假、匯回循環及實際延遲 |
| SEO／內容 | metadata、sitemap、robots、結構化資料及管理內容；公開頁 ISR | 正式 sitemap／canonical／索引設定及店舖資料；排名唔係功能測試可以保證 |
| 虛擬試髮色 | 相片及短片模式、MediaPipe 分割、色彩引擎、輸出；live camera 刻意關閉 | 真實 iPhone／Android／Safari、不同頭髮相片／短片效果及資源載入；唔保證染髮實際效果 |
| 部署／資料庫 | Node 24、Next production build、PostgreSQL 18／SQLite migration、CI/CD、Vercel London、Neon、共享 Redis、快取及關閉開關 | 正式部署／migration 後驗證、backup／restore 演練、Neon／Vercel／Redis／Resend 實際用量及運作記錄 |

## 已修正

| 問題 | 修正 |
|---|---|
| 首頁 React #418 hydration 錯誤 | 實際正式 HTML 缺少底部預約提示，但客戶端會加返。將提示直接放喺首頁伺服器輸出，移除 layout 依賴 pathname 判斷首頁嘅分支；保留 ISR。 |
| 電郵慢會拖慢預約回應及日曆更新 | 成功交易後即時登記快取失效，透過 Next `after()` 喺回應後處理通知；原有持久化通知佇列同重試保留。 |
| 「Double-booking risk」大紅框難讀 | 改成精簡日曆設定提示，分清預約關閉／被設定檢查阻擋；14 項細節按髮型師及平台分組收起，保留 Integrations 入口，唔會隱藏真正未完成項目。 |
| 預約關閉仍會週期性查 readiness DB | `NOTIFICATIONS_ENABLED` 未開時，喺快取及資料庫讀取之前返回關閉；避免舊快取 true 越過關閉設定，減少不必要 Neon 喚醒。取消仍可用。 |
| 「免費 patch test」同 £15 服務矛盾 | FAQ seed 同 SQLite／PostgreSQL／SQL Server 三套 migration 移除已知舊文案嘅免費承諾；價格、時長、自訂文案保留。正式資料要部署 migration 後先更新。 |
| 冇簡介嘅髮型師顯示空引號 | 空白／null 簡介唔再顯示引號同分隔線。 |
| 缺少可重複完整預約驗收 | 新增 `pnpm test:booking-lifecycle` 並加入 CI，限制只可以喺名為 salon_test 嘅本機測試 DB 執行。 |

## 本機驗證結果

今次最後驗證使用 **Node 24.21.0、PostgreSQL 18**，全部資料都係合成測試資料。PostgreSQL 只綁定 localhost。

| 檢查 | 結果 |
|---|---|
| 單元／回歸測試 | **603 通過，0 失敗，0 跳過** |
| ESLint、TypeScript、git diff --check | 通過 |
| Production build | 通過；首頁等公開頁保留 ISR |
| PostgreSQL migrations | 17 個 migrations 重播成功，schema diff 為空 |
| SQLite migrations | 重播成功，schema diff 為空 |
| Production dependencies audit | 冇發現已知漏洞 |
| 原有真實 DB 整合測試 | 搶位、預約上限、交易回滾、通知佇列、worker 競爭、日曆對帳、London 日期聚合等通過 |
| 新完整預約流程 | 建立 → 管理員確認 → 客人改期 → 取消；擁有權、24 小時限制、重複請求、價格／時長快照、匯入失敗保留舊忙碌時段等通過 |
| Production HTTP | 10 個後台頁權限、session 撤銷／降權、MFA、分頁、私人資料限制等通過 |
| 瀏覽器真實本機操作 | 客人登入、選服務／髮型師／日期、提交 Pending、管理員確認、客人改期及取消全部成功 |
| HTTP 日曆快取 | 已有快取嘅 Busy feed 喺改期後即時移除舊時段並加入新時段；取消後即時移除事件 |
| 時區／私隱 | 22 Sep 10:00 BST → 09:00 UTC；改期至 23 Sep 11:00 BST → 10:00 UTC；feed 只顯示 Busy，冇客人姓名或電郵 |
| 前端 | 本機首頁及上述流程冇 console error；桌面、390px 手機版提示已目視檢查，14 項細節可展開，冇水平溢出 |

回歸測試先喺舊程式重現失敗，再喺修正後通過。新日曆整合測試使用真實 PostgreSQL、ICS 解析及交易；session、Next 框架、供應商網絡同電郵邊界係模擬。瀏覽器測試另外使用真實 Next production server 同真實登入／server actions；外部網絡、Redis 及電郵傳送刻意封鎖，所以唔代表真實電郵送達驗收。

SQL Server migration 已檢查語法／改動範圍，但本機冇執行 SQL Server。

## 正式網站及 Fresha 實查

用你已登入嘅 superadmin session 檢查，冇更改正式接單開關。

- Site Settings 明確顯示 **Booking is currently OFF**。
- Integrations 顯示 scheduled inbound sync 關閉；Operations 顯示通知關閉。
- 19 Sep 16:08（London）重新跑診斷：資料庫、Resend 已驗證寄件網域、Redis PING、電郵設定、cron secret 全部通過；唯一未通過係刻意關閉嘅通知開關。
- 冇已記錄 scheduled-job execution，亦冇通知 delivery 佇列；未可據此證明 scheduler 同電郵真實送達正常。
- 操作期間出現一次瀏覽器 `Failed to fetch`，重新載入後恢復，Ivan 測試重試成功；同期 Vercel error 查詢冇回傳錯誤。唔會將呢次暫時性網絡錯誤當成已證實嘅後端缺陷。

| Fresha → 網站 | London 測試時間 | 匯入結果 |
|---|---|---|
| Funky | 15:58 | 成功，14 個忙碌時段 |
| Ivan | 16:03 | 成功，17 個忙碌時段 |
| Lox | 16:04 | 成功讀取，0 個時段 |
| Shania | 16:05 | 成功讀取，0 個時段 |

事件數係程式匯入視窗內嘅忙碌時段，唔係所有歷史預約總數。成功讀取唔等於已驗證所有休假、封鎖時段同髮型師配對；尤其兩個空 feed 仍要逐位核對。

網站四位髮型師嘅 Fresha outbound confirmation 仍係 **Never**。初次檢查，各人嘅 Linked calendars 都只有原有 **Export events to an external calendar**（Synced），缺少網站匯入方向。新增連接嘅跟進結果如下；未喺 Fresha 日曆實際驗證網站 Busy 事件，所以冇勾選網站嘅「已看見忙碌時段」確認。

### Fresha 員工設定跟進（19 Sep，17:36 London 截止）

你授權繼續之後，我逐位由 Team members → Edit → Settings → Linked calendars 檢查，並用網站 Integrations 已有、屬於相應髮型師嘅私人 Busy feed 設定 **Import events from an external calendar**。每次均揀 **Time and duration only**。冇新增員工，冇修改姓名、聯絡資料、權限、職位或工作安排，亦冇更改或移除原有匯出連接。

| 髮型師 | 今次新增結果 | 儲存後可見證據 |
|---|---|---|
| Funky | 新增網站 → Fresha 匯入 | 成功頁 `Calendar linked`；返回設定後見到獨立 Import 連接、`last synced just now`、`Synced` |
| Ivan | 新增網站 → Fresha 匯入 | 成功頁 `Calendar linked`；返回設定後見到獨立 Import 連接、`last synced just now`、`Synced` |
| Shania | 新增網站 → Fresha 匯入 | 成功頁 `Calendar linked`；返回設定後見到獨立 Import 連接、`last synced just now`、`Synced` |
| Lox | **未成功新增** | 兩次顯示 `Calendar URL is valid`，但提交回傳 HTTP **422 Unprocessable Entity**；兩次返回設定都確認只有原有 Export，冇 Import |

Lox 拒絕時間係 17:21:29 及 17:32:58 London，來自 Fresha `calendar-sync-settings` 提交端點。畫面冇提供具體拒絕原因，唔可以斷言係 token、feed 內容、員工帳戶或 Fresha 驗證規則問題。已核對所填網站網址具有正確 HTTPS 網域、對應髮型師路徑、token 參數同無空白。瀏覽器直接開啟 ICS 嘅額外檢查被 client 阻擋，Vercel 近 30 分鐘查詢亦冇回傳可用記錄；呢兩項未能證明 Lox feed HTTP 回應係成功或失敗。

另發現 **Shania 喺 Fresha 嘅 Calendar bookings 未啟用**；保留原有設定。網站仍標示 Fresha 為佢接單，正式啟用前要核對實際營運安排。Fresha 匯出網址喺網站以隱藏方式儲存，今次未完成四位原有匯出 URL 嘅逐字比對；唔會將空 feed 當成已證實配對正確。

新建嘅三條匯入訂閱已可由 Fresha 主動輪詢網站，即使 Vercel `CALENDAR_SYNC_ENABLED` 仍關閉亦一樣；該開關只控制網站排程讀取供應商嘅方向。現有 outbound feed 使用 30 分鐘事件快取、60 分鐘 token 快取，以及預約變更即時失效機制，唔係每次供應商輪詢都查 DB。多位髮型師嘅快取到期時間可能分散，實際 Neon 用量仍需觀察。

`Synced` 證明訂閱建立同首次同步狀態成功，**未證明非空預約嘅建立／改期／取消、匯回循環或零撞期**。未有為咗呢次設定而建立正式測試預約、寄出電郵、修改接單主開關，亦冇虛假勾選網站 outbound confirmation。

Treatwell：Lox、Funky、Ivan 仍標示接單，但 inbound 未啟用／未成功測試，outbound confirmation 亦係 Never。Shania 冇標示 Treatwell 接單。必須補齊實際設定；只有確認某平台真係唔再接單先可以取消該平台嘅 receivesBookings，唔應該純粹為咗移除警告而關閉檢查。

公開 `/book` 仍提供電話同 Treatwell，冇 Fresha 公開預約連結。公開連結同私人日曆同步係兩種獨立設定，未核對正確公開商戶網址前冇自行填寫。

## 同步限制

Fresha 官方支援以 Other calendars 分開設定匯入同匯出，並指出同步可需最多 15 分鐘。本網站每 30 分鐘匯入一次，所以正常排程下單向匯入亦可能接近 45 分鐘；呢個係推算，唔係延遲保證。[Fresha 官方說明](https://www.fresha.com/es/help-center/knowledge-base/calendario/101373-sincroniza-tu-calendario-de-fresha)

ICS 唔會喺網站同 Fresha 同時鎖定同一張椅，**唔能夠承諾「perfect sync／永不撞期」**。仍需測試每位髮型師雙方向建立、改期、取消、休假／封鎖時段、BST／GMT，同埋 Fresha 會唔會將網站匯入嘅 Busy 再匯出造成殘留封鎖。網站亦唔會將 Treatwell 事件轉發去 Fresha，或反過來，以免形成循環。

## Vercel／Neon 成本

保留現有 Vercel Pro、30 分鐘批次排程、公開頁 ISR、日曆快取及 mutation 失效機制；未新增高頻輪詢。呢種設計有利低流量 salon 使用 Neon Free，但唔係免費額度保證。

Neon 官方現時 Free 每 project 每月有 **100 CU-hours、0.5 GB 儲存、5 GB 公網傳輸**，閒置 5 分鐘後 suspend。用盡 compute／transfer 會暫停資料庫。[Neon 官方配額](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md)

以 30 日、固定 0.25 CU 計算：同步對齊嘅半小時 jobs，假設執行時間極短，每次加 5 分鐘 idle tail，約 `48 × 30 × 5/60 × 0.25 = 30 CUh/月`。呢個只係排程理想基線；客人、後台常開、快取重建、cron jitter／重複執行會增加用量。若長期唔休眠，同樣 0.25 CU 約 **180 CUh/月**，會超過免費額度。唔好用高頻 `/api/health` 探測令資料庫長期醒住。

現有半小時 cron 要用 Vercel Pro；Hobby 嘅 cron 限制唔適合目前排程。[Vercel cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## 仍待完成嘅正式驗收

1. 部署今次修正及精準文案 migration，先驗證 preview，再核對正式首頁冇 hydration error。
2. 解決 Lox Fresha 匯入提交 422；核對四位髮型師 Fresha 匯出內容／配對、Shania 接單安排，並處理仍接單嘅 Treatwell 設定。其餘三條 Fresha 反向訂閱已新增並顯示 Synced。
3. 經授權開啟通知／同步後，驗證 cron 真正執行、客人／salon 電郵真正送達，完成真實雙方向改期取消同休假測試。
4. 保留預約 OFF，直至以上驗收完成；有限公開測試可以先用展示頁、電話同已確認可用嘅平台預約入口。

之前自動審批曾因員工設定頁可能包含個人／僱傭資料而攔截讀取；收到你限定日曆檢查及設定嘅授權後，已繼續完成上述三條連接。現時未完成嘅 Lox 項目係實際 Fresha 提交 422，唔係仍然等你授權。
