# Harbour Hair — 程式修正及上線交接

檢查及實作日期：2026-09-11。分支：`codex/production-readiness-integrations`。

**程式已部署，正式網站及資料庫已核對；Fresha／Treatwell 接駁及店主營運驗收仍未完成。** 應用程式版本 `e3426c2` 已於 2026-09-11 經 GitHub Actions 成功部署到正式 Vercel，13 個 Neon migrations 全部完成。網站預約、通知及日曆 worker 維持關閉，冇發出真實通知。帳戶、DNS、Redis、實際訂閱及店主驗收係必須完成嘅下一步。

到店請用 [16 頁可填寫廣東話 PDF](../output/pdf/harbour-hair-salon-handover-fillable.pdf)：包含真正文字欄及勾選框、帳戶權限、員工更表、雙向日曆證據、驗收表，以及程式／營運分析。另存已填副本；唔好將私密憑證或已填資料放入 Git。

## 1. Google account 要攞啲乜

應由店主保留 Google／Resend／Treatwell／Fresha／域名／Vercel／Neon 帳戶擁有權、付款資料及 MFA，然後邀請你加入需要嘅管理權限。唔建議將 Google 主密碼當成全部服務嘅共同交接方法。Google 登入唔會自動授予域名 DNS、Resend 發信網域、Google Business Profile 或預約平台權限。

帶埋 [到店交接清單](salon-visit-handover-cantonese.md)，逐項收集店舖 booking link、每位 stylist 嘅日曆、營業時間、服務價錢／時長、通知收件人、DNS 管理員及需要平台支援確認嘅功能。私密 token／ICS URL／recovery code 用密碼管理工具交接，唔好放入 Git 或一般聊天。

## 2. 已實作嘅行為

| 項目 | 現在程式行為 |
|---|---|
| 預約價錢 | 全店優惠後再套折扣碼；實際金額及時長保存喺預約，Named／Anyone 路徑一致。 |
| 預約交易 | 建立預約、折扣使用及兩封通知紀錄一齊 commit；任何保存失敗會一齊 rollback。 |
| 改期／確認 | Serializable 交易及條件更新重新檢查營業時間、凍結時長、外部／內部衝突；已取消或同時被修改嘅預約唔會被舊操作覆蓋。 |
| 通知 | 收到請求、店舖提醒、確認、取消、改期、到期提醒及評價邀請進入資料庫佇列。成功／過時後刪除個人 payload；背景工作清理超過 30 日未處理 payload。 |
| 重試 | 穩定事件 key、固定發送內容、工作 lease、退避及逾時；超過安全重試窗口要先核對供應商紀錄，唔會無限制重寄。 |
| 密碼重設 | 未過期 token 只可以成功兌換一次；只有取得 token 嘅交易先可以改密碼。原始 token 唔會放入通知佇列。 |
| 日曆 | Fresha／Treatwell 每位 stylist 分開設定；可測試 inbound feed、生成／輪換 outbound token，並由管理員確認平台已訂閱。 |
| 同步失敗 | 保留上次忙碌時段，顯示錯誤；唔會將下載失敗當成所有時段空閒。 |
| 日曆安全 | 公開 HTTPS、DNS 位址檢查及固定連線、拒絕 redirect、限制大小／時間；URLs 唔會出現喺一般錯誤紀錄。 |
| 開放預約條件 | 全部 stylist 更表完整；活躍平台有新鮮成功同步及已確認 outbound 訂閱；電郵／Redis／cron 設定及診斷證據通過。改設定後舊診斷唔會繼續當有效。 |
| 日期範圍 | 整段服務必須喺日曆匯入嘅 90 日範圍內，另預留 90 分鐘同步新鮮度餘量；客戶唔可以繞過 UI 提交遠期衝突預約。 |
| 後台 | `/admin/integrations` 設定日曆；`/admin/operations` 查看檢查結果、cron 狀態及通知紀錄。 |

網站預約維持 **PENDING → 店主核對 → CONFIRMED**。ICS 有同步延遲，店主確認之前仍然要核對平台最近收到嘅預約。

## 3. 接駁能力及限制

- **可做**：真正 salon booking link；個別員工嘅公開 HTTPS ICS 忙碌時段匯入；網站本身預約輸出成私密 ICS；後台測試／狀態／重試。
- **唔等於完整預約 API**：ICS 忙碌時段唔會建立包含完整客戶、付款、訂金或服務資料嘅 Fresha／Treatwell 訂單。API 寫入功能仍然標示等待官方合約／授權，冇假設或虛構 endpoint。
- **唔係即時鎖位**：本程式每 30 分鐘拉取一次，平台本身亦可能有訂閱延遲。Fresha 文件指日曆更新可需約 15 分鐘；實際雙向延遲要到店測試。[Fresha 官方日曆同步](https://www.fresha.com/help-center/knowledge-base/calendar/101373-sync-your-fresha-calendar)
- **網站 outbound 只包含網站本身嘅預約**：唔會將 Fresha 匯入嘅 block 再轉發畀 Treatwell，避免循環。如果兩個平台同時接單，必須另外證明佢哋之間有正確共用日曆／店主即時手動同步流程。現有兩條網站連線本身唔保證兩個 marketplace 互相知道對方訂單。
- **支援範圍**：離散事件、UTC／有效 IANA 時區、全日事件及標準時區轉換；含重複預約規則、floating time、未知時區、壓縮／redirect feed 或不完整 feed 會明確拒絕並保留 busy blocks。必須用實際平台 feed 測試，唔可以單憑有 URL 就當完成。
- Treatwell 需要確認實際英國帳戶可用嘅輸入／輸出、每位員工 mapping 及第三方軟件條款；官方一般資料唔能夠證明呢間店已開通。[Treatwell calendar support](https://partnercare.treatwell.com/s/article/How-to-sync-Connect-with-other-calendar-softwares?language=el)

## 4. 正式環境仍然要處理

首次 live audit 見到嘅情況如下；本次本機修正冇改動呢啲正式服務設定：

1. `bookingEnabled=false`，網站原本用電話／Treatwell 入口。
2. 正式 `EMAIL_FROM` 用 `harbourhair.co.uk`，但當時 Resend account 只見另一個已驗證 domain；要喺正確 team 驗證 salon 發信域名。[Resend 網域設定](https://resend.com/docs/dashboard/domains/introduction)
3. 正式 Redis hostname 當時 DNS 查詢失敗；要換成可用 database 及配對 URL／token，再驗證真實 rate-limit 寫入。後台 PING 只證明連線／認證，唔證明寫入權限。
4. 原本 4 位 stylist，只有 1 位有完整更表；未有成功外部匯入紀錄；Fresha salon URL 空白。唔可以直接開放 online booking。
5. 新功能現已部署到 Vercel production；網站及資料庫回應正常。真實帳戶接駁、投遞及日曆訂閱仍然要另行驗收。
6. 確認 Neon 方案、使用量通知、備份／還原窗口、Vercel 帳單及店主接管。**Neon 唔需要用到 100% 先運作；100% 係配額耗盡風險，唔係上線條件。** 原先讀到約 6.34 CU-hours；如果該帳戶用現行 100 CU-hour Free 配額，即約 6.3%，但計劃要以店主 dashboard 為準。[Neon 官方 Free 配額資料](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md)

## 5. Cron 與費用

| 路由 | Vercel 時間表（UTC） | 啟動旗標 |
|---|---|---|
| `/api/cron/reminders` | 每日 08:00 | `NOTIFICATIONS_ENABLED=true` |
| `/api/cron/notifications` | 每 30 分鐘 | `NOTIFICATIONS_ENABLED=true` |
| `/api/cron/calendar-sync` | 每 30 分鐘 | `CALENDAR_SYNC_ENABLED=true` |

全部需要 `CRON_SECRET`。新旗標未啟動時，路由喺查資料庫之前返回，避免空跑令 Neon 無法休眠。`TREATWELL_SYNC_ENABLED` 只保留兼容舊路由，唔需要另加第二條 Treatwell schedule。現有 Vercel Pro 支援呢個頻率；Hobby 唔適合此安排。

以 0.25 CU、每次查詢後約 5 分鐘先休眠估算，每半小時喚醒一次，30 日約 30 CU-hours **起**；實際執行時間、網站流量、平台訂閱請求同其他 job 會增加使用量。每 5 分鐘持續查詢可能令 compute 長開，0.25 CU 一個月約 180 CU-hours。唔可以將呢個估算當保證月費。

Vercel cron 唔保證自動補跑或 exactly-once；本程式用資料庫佇列／leases／下一次排程處理重試，但仍然需要查看 job history 及失敗通知。[Vercel cron 管理文件](https://vercel.com/docs/cron-jobs/manage-cron-jobs) Resend idempotency key 保留 24 小時，所以未知結果唔會喺過期後自動重寄。[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## 6. 部署次序

1. 店主完成帳戶 invitation、DNS、sender domain、Redis 及平台日曆資料交接。
2. 先確認正式資料庫可用備份／還原方法；審查 `prisma/vercel/migrations/20260911120000_calendar_connections_notifications/migration.sql`。
3. 保持 booking 關閉；初次部署保留 `NOTIFICATIONS_ENABLED=false`、`CALENDAR_SYNC_ENABLED=false`。部署 production 時既有 `vercel-build` 會執行 migration；唔好另外對正式 DB 跑 `db push`。
4. 填完整每位 stylist 7 日更表。到 Integrations 設定所有真正接單嘅平台。每位／每平台測試 inbound；將對應私密 outbound URL 加入平台，再確認已看見測試 busy block。
5. 確認平台 feed 是否受支援；測試新增、取消、改期、不同 stylist、BST/GMT、全日休息及失敗重試。若同步方向或平台權限未證實，保持 booking 關閉。
6. 店主同意開始正式通知後，設定 `NOTIFICATIONS_ENABLED=true`；有活躍日曆時設定 `CALENDAR_SYNC_ENABLED=true`，重新部署。每次改部署／憑證都重新跑 Operations 診斷。
7. 核對 Vercel 實際 cron schedule／logs，以及後台最後執行時間。完成一次店主同意嘅真實 test booking → 兩邊通知 → 確認 → 改期 → 取消；核對 salon inbox、spam folder、平台忙碌時段及冇重複通知。
8. 管理員喺 Settings 開放 booking；程式會阻止未完成 prerequisites 嘅開放操作。仍然保留手動確認流程。
9. 店主持有帳戶 recovery／付款／資料匯出及 emergency 關閉 booking 方法。若 runtime 設定改壞或同步過期，public booking 會保守關閉；取消現有預約功能保留。

## 7. 本機驗證及重跑方法

- 完整測試、lint、TypeScript 及 production build 結果，以本次最後交付訊息列出嘅結果為準。
- 已經用本機獨立 PostgreSQL 執行所有 13 個 migration，並測試真實並發預約、折扣 rollback、通知同交易一齊保存，以及失敗日曆匯入保留 busy periods。
- `pnpm test:integration` 必須提供 `SALON_TEST_DATABASE_URL`，工具拒絕 localhost 以外或名稱唔係 `salon_test` 嘅 database；請先喺可丟棄嘅 test database 套用 migrations。**唔好用正式 connection string。**
- 範例：`SALON_TEST_DATABASE_URL='postgresql://salon_test@127.0.0.1:65439/salon_test?schema=integration_verify' pnpm test:integration`。
- 測試只使用虛構資料同模擬 provider response；唔代表已測試 salon 真實帳戶、投遞、排程或 marketplace 訂閱。

### 已完成驗證紀錄

- **382／382 自動測試通過**；`pnpm lint` 通過；TypeScript 檢查通過。
- **Production build 成功**，使用獨立本機 PostgreSQL 同虛構資料；Next.js 仍提示既有 middleware 檔名將來應改用 proxy，屬非阻塞提示。
- **13 個 PostgreSQL migrations 成功套用**到空白 test schema；migration 後同 Prisma schema 比較冇差異。
- **有資料嘅 migration 驗證通過**：另外重播前 12 個 migration，加入舊 stylist URL／token、平台 link 同 busy block，再執行第 13 個；舊資料保留、正確建立連線、唔會虛構已完成訂閱或同步，booking 維持關閉，同一 UID 可用喺不同 stylist。
- **真 PostgreSQL integration 通過**：同時預約只成功一個；折扣只使用一次；通知保存失敗完整回滾；同時 worker 唔重複發送同一通知（使用模擬 transport，冇發真電郵）；日曆失敗保留 busy periods；未完成連線時拒絕預約。
- **瀏覽器驗證**：虛構店主登入、Operations、Integrations、Settings 阻止未完成設定嘅開放操作、公開 `/book` 關閉流程；日曆錯誤 URL 留喺設定頁顯示安全提示，已保存 URL 保持隱藏。桌面及 390px 手機版通過目視檢查。無真實帳戶、無真實寄信、無正式資料改動。

- **正式 build 通知 runtime 通過**：以模擬 Resend transport 呼叫實際 `/api/cron/notifications`，第一次執行即 `queued=1`、`sent=1`、`failed=0`；HTML 正常產生，只有一次模擬 HTTP，資料庫標記 SENT／一次嘗試、清除 payload。亦修正咗原先用較早時間作 cutoff，令新通知要等下一輪先寄嘅延遲。
- 本機測試 app／PostgreSQL 已關閉。以下係之後獲授權完成嘅正式部署紀錄；本機測試本身冇發送真實電郵或建立真實預約。

### 2026-09-11 正式部署核對

- 應用程式 commit：`e3426c265cba68a669d045cac8f6fba96b455d36`；已推送 `main` 及工作分支。[GitHub Actions 34637283268](https://github.com/ChiFungHillmanChan/harbour_hair_salon/actions/runs/34637283268) 嘅 CI 及 production deployment 都成功。
- 正式 Vercel deployment：`dpl_E4XW1BUkudyaP5kwDCaonsnzCEzL`，狀態 READY；[www.harbourhair.co.uk](https://www.harbourhair.co.uk) 及 apex alias 對應相同應用程式 commit。文件同 PDF 後續提交唔改變此應用程式版本。
- 正式 Neon：13 個 migrations 全部完成，冇 unfinished migration；建立 8 條舊日曆設定 backfill 紀錄，唔代表已有成功同步或已確認平台訂閱。
- Health HTTP 200、DB up；首頁 HTTP 200；`/book` 顯示關閉預約入口。`/admin`、`/admin/operations`、`/admin/integrations` 未登入時都返回 307 到 signin。
- `bookingEnabled=false`；通知及日曆啟動旗標喺 production env metadata 均未設定，按程式預設停用。確認旗標狀態後，帶正確 cron auth 核對三條路由均 HTTP 200 並返回 disabled，冇執行寄信或同步。
- Vercel project 及 deployment 記錄均有三條正確 schedule：reminders 每日 08:00 UTC，notifications／calendar-sync 每 30 分鐘；舊 Treatwell 五分鐘 cron 已移除。呢次驗證證明排程設定及停用行為，唔等於已驗證啟用後嘅 scheduler 執行或真實投遞。
- 部署前重新核對 Neon 現有還原窗口為 21,600 秒（6 小時）；資料庫時間點為 `2026-09-11T19:07:04.284Z`。此時間點只喺滾動窗口內有效，唔係永久備份，亦未做 restore 演練。
- 自動批准審查拒絕將完整 production database dump 匯出到本機，理由係部署授權未包含匯出客戶敏感資料。因此冇進行匯出，改用上述現有 Neon 還原窗口核對；店主仍需決定長期備份、保存期及復原驗收。

---

## 2026-09-15 上線前檢查（開放預約前最後一輪）

### 修正咗一個會令預約靜靜關閉嘅問題

`assertOnlineBookingReady` 每一次落單都會重新檢查日曆新鮮度，而 `CALENDAR_FRESHNESS_MINUTES`
原本係 **45 分鐘**，但 `/api/cron/calendar-sync` 係 **每 30 分鐘**跑一次。即係話只要有
**一次** cron 遲到或者失敗，`lastSuccessAt` 就會超過 45 分鐘，全站 online booking 會即刻
自動關閉，而客人淨係見到「Online booking is closed at the moment」，唔會有任何解釋。
Vercel cron 官方明確講明**唔保證 exactly-once，亦唔會自動補跑**，加上 Treatwell／Fresha
嘅 iCal endpoint 本身就慢同會 rate-limit，所以「漏一次」係日常，唔係例外。

已改為 **90 分鐘**（3 次 cron 週期嘅緩衝）。代價係 marketplace 訂單未反映到網站嘅時間窗
闊咗，但嗰個窗本來就唔止 45 分鐘 —— Fresha 自己文件都話佢哋有約 15 分鐘傳播延遲。
新增測試 `the freshness window survives more than one missed calendar-sync run` 會直接讀
`vercel.json`，強制 freshness ≥ cron 間隔 × 3，將來改任何一邊都會 fail。

> ⚠️ **唔好將 `calendar-sync` 改成只喺營業時間跑。** 呢條 cron 必須 24 小時運行，
> 因為 feed 一旦過夜變 stale，第二朝開店之前 booking 就已經係關閉狀態。

### 已核對嘅正式環境狀態

| 項目 | 結果 |
|---|---|
| 網站 | 首頁／services／contact／offers／`/book` 全部 HTTP 200；apex 同 www 都正常 |
| `/api/health` | 200，`database: up` |
| Neon | PostgreSQL 17.11，9 MB，13 個 migration 全部 finished，**0 個未完成** |
| Redis | `master-gibbon-175544.upstash.io` DNS 正常，PING 同**實際寫入**都成功（之前壞咗，現已修好）|
| Cron | Vercel 平台登記咗 3 條，同 `vercel.json` 一致 |
| Vercel | Pro，Node 24.x，`harbour_hair_salon` |

### ⛔ 仲未做、會擋住開放預約嘅 4 樣嘢

1. **Resend 未驗證 `harbourhair.co.uk`** — `EMAIL_FROM=bookings@harbourhair.co.uk`，但個
   account 目前只有 `hillmanchan.com` 驗證咗。即係話**所有預約確認電郵都會寄唔出**。
   呢個要喺 IONOS 加 DNS record，propagation 要時間，係全部工序入面最長 lead time。
2. **Funky／Ivan／Lox 三位 stylist 一條營業時間都冇**（`Availability` 得 Chan 有 7 行）。
   `getAvailableSlots` 對佢哋一律回 `[]`，即 4 個人有 3 個完全訂唔到。
3. **Chan 冇 `icalToken`** — 其餘 3 位有。Chan 嘅 outbound feed URL 要喺
   Admin → Integrations 撳「Generate secret URL」先會存在。
4. **8 條 `CalendarConnection` 全部係空殼** — `inboundUrl` null、`inboundEnabled` false、
   `outboundConfirmedAt` null。Fresha 嗰 4 條仲係 `receivesBookings=false`，
   `SiteSettings.freshaUrl` 亦係空。

### 本機完整綵排（用即棄 PostgreSQL 17，冇掂過正式資料）

用假資料砌出「聽日全部搞掂」嘅狀態：4 位 stylist × 7 日更表、8 條健康
CalendarConnection（Treatwell + Fresha 都 `receivesBookings=true`）、`bookingEnabled=true`。

- **Operations 診斷 7 項全 PASS**（`configuration` / `email` / `notifications` / `cron` /
  `database` / `resend` / `redis`），日曆 readiness `{ready:true, blockers:[]}`。
- **`/book` 真係開到**：登入 → 揀服務 → 揀 stylist（特登揀咗 Funky，即係正式環境
  完全訂唔到嗰批）→ **日曆日期列正常顯示** → 時段 10:00–18:30 分 MORNING／AFTERNOON／
  EVENING 三組正確載入（60 分鐘服務最後一口 18:30，啱啱夠做到 19:30 收工）。
- **`/admin/operations`** 同 **`/admin/integrations`** 兩個聽日要用嘅畫面都正常渲染，
  Integrations 顯示「Calendar setup checks pass」。
- `pnpm test:integration` 對住真 PostgreSQL 通過：並發預約只成功一單、折扣只扣一次、
  通知同交易一齊 rollback、日曆匯入失敗保留 busy periods、未完成連線時拒絕預約。
- 383／383 單元測試、`pnpm lint`、TypeScript 全部通過。
- **冇寄出任何真電郵，冇建立任何真預約，冇改動正式資料庫。**

### 聽日到店嘅次序（照呢個行，唔好跳）

1. Resend 加 `harbourhair.co.uk` → IONOS 貼 DNS record →**等到 verified 為止**。
2. Admin → Opening Hours：填 Funky／Ivan／Lox 三位嘅真實 7 日更表。
3. Admin → Integrations：Chan 撳「Generate secret URL」。
4. 每位 stylist × 每個平台：貼 inbound iCal URL → 剔「takes bookings」→ 剔
   「Enable inbound sync」→ 撳 **Test and sync saved feed**，要見到 Last successful feed 有時間。
5. 將每位 stylist 嘅 outbound URL 加入 Treatwell／Fresha 日曆訂閱 → 喺平台見到 Busy →
   返後台剔「Confirm subscription checked」。
6. Admin → Site Settings：填 `freshaUrl`。
7. Vercel 設 `NOTIFICATIONS_ENABLED=true` 同 `CALENDAR_SYNC_ENABLED=true` → redeploy。
8. Admin → Operations → **Run read-only diagnostics**，要 7 項全 PASS（24 小時內有效）。
9. Admin → Settings → 開 `bookingEnabled`。程式會攔住未夠條件嘅開放操作。
10. 做一次真 test booking → 確認 → 改期 → 取消，核對 salon inbox 同兩個平台嘅忙碌時段。
