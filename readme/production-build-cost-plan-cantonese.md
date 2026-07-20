# Harbour Hair Production Build、成本及上線計劃

日期：2026-07-21（英國時間）
價格核對日期：2026-07-21
用途：說明現有技術架構、今次已完成嘅程式改動、Treatwell API 接入方法、Resend、Admin、CDN，以及一次性／每月成本。

> 金額係規劃估算，唔係供應商或開發承辦商正式報價。Vercel、Neon、Resend、Upstash 多數以美元收費，未計 VAT、匯率及 Treatwell 個別 partner agreement 費用。

## 1. 建議保留嘅 production stack

| 層 | 技術 | 用途 | 建議方案 |
|---|---|---|---|
| Website／API | Next.js 16、React 19、TypeScript | 公開網站、booking、Admin、Server Actions、cron endpoints | Vercel Pro |
| CDN | Vercel CDN + Next.js ISR | 首頁及公開 marketing pages 快取 | 已包含喺 Vercel |
| Database | Prisma + Neon PostgreSQL | 客戶、預約、Admin、員工、服務、同步狀態 | Production 建議 Neon Launch；測試可 Free |
| Email | Resend + React Email | 確認、取消、改期、提醒、review request | 初期 Free，流量高先 Pro |
| Rate limit | Upstash Redis | 登入、booking、newsletter 防濫用 | 初期 Free |
| Calendar | Treatwell iCal + future official API adapter | inbound busy block、將來 outbound booking sync | API 費用待 Treatwell 確認 |
| Scheduler | Vercel Cron | 每日提醒；Hobby每日iCal sync／Pro每五分鐘 | 測試可Hobby；正式即時同步用Pro |

呢個組合對單店 salon 係合適嘅 monolith，暫時毋須 microservices、Kubernetes 或獨立 message broker。

## 2. 今次已完成嘅程式改動

### Treatwell API-ready

- 建立 provider-neutral `TreatwellApiAdapter` contract，booking 核心唔會綁死未知嘅私人 API payload。
- Stylist Admin 可填 `treatwellExternalId`，Service Admin 可填 `treatwellExternalId`。
- Appointment 新增 Treatwell booking id、`NOT_REQUIRED/PENDING/SYNCED/FAILED` sync status、錯誤及最後同步時間。
- API 真正啟用後，新 booking 自動進入 `PENDING` queue；取消／改期亦會重新排隊。
- 建立 durable worker：負責 upsert、cancel、成功／失敗狀態、provider booking id 及重試。
- 新增 `/admin/integrations`：顯示 iCal／API mapping、queue、Resend、CDN readiness；唔會顯示 secret value。
- Admin 可手動執行 iCal sync及重新排隊失敗嘅 API booking。
- `vercel.json` 現時使用 Hobby 可接受嘅每日 `06:00 UTC` iCal cron；Admin 可隨時手動 sync 作測試。
- Vercel cron schedule 係靜態 deployment 設定，唔可以用 app env 改頻率。升 Pro 後將 schedule 改為 `*/5 * * * *` 再 deploy，即可恢復每五分鐘同步。
- 保留現有 fail-safe iCal：fetch／parse 失敗唔會刪除舊 busy blocks。

### Resend 品牌確認電郵

- Booking confirmation 改成 Harbour Hair 藍金品牌版面，使用主色 `#174F7F`。
- 有完整 service、stylist、日期、時間、時長、價錢、地址及 booking reference。
- 有「Manage my booking」CTA 及 24 小時改期／取消提示。
- 加入純文字 fallback，改善 accessibility／deliverability。
- 加入 `EMAIL_REPLY_TO` 支援，客人可以回覆到 salon。
- 加入 Resend idempotency key，減低 retry 造成重複 confirmation email 嘅機會。

### Admin

- 新增 Integrations menu／dashboard。
- Stylist、service 外部 ID mapping 可由 Admin 管理，唔需要工程師直接改 DB。
- Queue 可見 pending／failed／synced 數量；failed 可以由 Admin retry。
- Admin secret 只顯示 configured／missing，唔會將 key 顯示於 HTML。

### CDN／ISR

- 移除 root layout 嘅 request `headers()` 依賴。
- 首頁唔再為 admin session 做 server-side 個人化 redirect。
- Header account 狀態改由獨立 `/api/session` no-store request 取得；共享 HTML 唔包含任何用戶 session。
- Site settings 同 active-offer flag 加 runtime cache tag，Admin 更新時即時 invalidation。
- Production build 已確認首頁由動態 `ƒ` 變成：`○ /  Revalidate 1h`。
- `/blog`、`/services`、`/contact`、`/offers`、`/privacy`、`/stylists` 等主要公開頁亦已變成 static／ISR；Admin 及私人頁仍保持 dynamic。

## 3. Treatwell API 到手後要做乜

現時唔應該估 Treatwell endpoint、authentication header 或 webhook signature。收到官方文件後，只需完成以下 adapter 階段：

1. 核對 API base URL、OAuth／API key、venue id、staff id、service id、booking create/update/cancel contract。
2. 實作一個 `TreatwellApiAdapter`：`ping()`、`upsertBooking()`、`cancelBooking()`。
3. 如果 Treatwell 有 webhook，驗證 signature、timestamp／replay protection，再將變更寫入 inbound busy／booking reconciliation。
4. 如果冇 webhook，用 Vercel Cron 呼叫 adapter worker；保留 idempotency reference `harbour-hair:<appointmentId>`。
5. 喺 Admin 填晒 stylist/service mapping。
6. 先用 `TREATWELL_API_ENABLED=false` 跑 shadow mode；對數 7 日無差異後先改 `true`。
7. 驗收 create、cancel、reschedule、duplicate retry、429、401、5xx、timeout、mapping missing、Treatwell outage。

所需 production env：

```text
TREATWELL_API_ENABLED=false
TREATWELL_API_BASE_URL=<官方提供>
TREATWELL_API_KEY=<官方提供>
TREATWELL_VENUE_ID=<官方提供>
```

`TREATWELL_API_ENABLED` 喺 HTTP adapter 完成及 shadow test 通過前必須保持 `false`。

## 4. Resend 正式設定

1. 建議使用子網域，例如 `updates.harbourhair.co.uk` 或 `mail.harbourhair.co.uk`。
2. 在 Resend 加 domain，按指示設定 SPF 及 DKIM；再加 DMARC。
3. Production env 設定：

```text
RESEND_API_KEY=<production key>
EMAIL_FROM=Harbour Hair Salon <bookings@updates.harbourhair.co.uk>
EMAIL_REPLY_TO=hello@harbourhair.co.uk
RESEND_AUDIENCE_ID=<newsletter audience id>
NEXT_PUBLIC_SITE_URL=https://www.harbourhair.co.uk
```

4. 用 Gmail、Outlook、iCloud 三個非 Resend owner 地址實測 confirmation、cancel、reschedule、reminder。
5. 檢查 spam placement、連結網域、mobile layout、reply、bounce 及 complaint。

Resend 官方建議驗證自有 domain，至少設定 SPF／DKIM，DMARC 有助 Gmail／Yahoo deliverability。

## 5. CDN 要點做、點驗證

### 需要做嘅操作

CDN 唔需要另外購買或開一部 server。今次程式已使用 Next.js ISR；deploy 到 Vercel 後，Vercel 會自動將可快取 HTML 放到全球 CDN。

1. 先升級 Vercel Pro。
2. 設定正式 custom domain 同 `NEXT_PUBLIC_SITE_URL`。
3. Deploy 今次程式及 database migration。
4. 首次 request 可能係 `MISS`；之後應見 `HIT`，到期後可見 `STALE`／背景重建。
5. Admin 更新 services、offers、settings 時，現有 Server Actions 會 revalidate 相應頁面。

驗證指令：

```bash
curl -I https://www.harbourhair.co.uk/
```

應檢查 `x-vercel-cache`／`Cache-Control`，同時連續請求量度 TTFB。首頁目標係 warm CDN TTFB <200–300ms；真正數字要 production deploy 後再量度。

### CDN 成本

Vercel CDN／ISR 已包含喺 Pro，冇另一筆固定「CDN 月費」。ISR 只喺到期／on-demand revalidation 時使用 function、read/write；cache hit 唔會重新跑首頁 DB queries。

以每月 100,000 visits、首頁 HTML 約 83KB 作保守估算：

```text
83 KB × 100,000 = 8.3 GB HTML transfer／月
```

Vercel Pro 官方目前包含 1TB Fast Data Transfer，因此上述 HTML 遠低於額度；圖片流量另計，但單店網站一般仍有很大空間。

首頁一小時 revalidation 上限估算：

```text
24 次／日 × 30 日 = 720 次 regeneration／月
720 ÷ 1,000 × $0.004 ISR write ≈ $0.0029／月
```

實際上只有到期後再有人訪問先重建，所以通常更少。CDN 唔係主要成本；升 Pro 並開啟五分鐘 cron 後，**database 被頻密喚醒先係主要變動成本。** Hobby 每日同步模式一般可以維持 scale-to-zero。

## 6. 每月營運成本估算

### 建議 production 基本方案

| 項目 | 每月估算 | 計法／備註 |
|---|---:|---|
| Vercel Pro | **$20** | 1 個 deploying seat，包含 $20 usage credit；正式商業用途 |
| Neon Launch | **約 $15–25** | 視 active CU-hours；建議取代 Free 作 production DB |
| Resend Free | **$0** | 3,000 emails/月、100/日 |
| Upstash Free | **$0** | 500,000 commands/月、256MB |
| Vercel Cron／CDN | **通常 $0 額外固定費** | 使用量計入 Vercel function／transfer；初期預計在 credit 內 |
| Domain | **約 £10–30／年** | 視 registrar 及網域；約 £1–3/月攤分 |
| Treatwell API | **未知** | 必須按 salon 嘅 Specific Partner Agreement／Treatwell 報價 |

**已知供應商月費合計：大約 $35–48/月 + domain + VAT + Treatwell 費用。**

如果 Resend 升 Pro，再加 $20/月，即約 **$55–68/月**。

### 點解 database 建議預 $15–25

現時 Hobby 每日一次只係約 30 次／月；升 Pro 並改為五分鐘 sync 後，次數會變成：

```text
12 次／小時 × 24 小時 × 30 日 = 8,640 cron invocations／月
```

Neon Free 係 100 CU-hours／project。假設五分鐘 cron 令最低 0.25 CU compute 長期未能 scale-to-zero：

```text
0.25 CU × 730 小時／月 = 182.5 CU-hours／月
```

如果頻密執行令 compute 長期保持活躍，就可能超出 100 Free CU-hours。Neon Launch 現價 $0.106/CU-hour：

```text
182.5 × $0.106 = $19.35 compute／月
1 GB storage × $0.35 ≈ $0.35／月
合計約 $19.70／月
```

實際 compute 可能因 scale-to-zero、執行時間同流量而低啲，所以 Pro 五分鐘模式預算用 **$15–25/月**。Hobby 每日模式可以先用 Neon Free 測試，但 Treatwell 變更最多要等一日先自動反映；測試時可到 `/admin/integrations` 手動同步。正式接受即時網上預約前，應升 Pro 並轉回五分鐘模式。

### Resend 容量

假設每張完成 booking 有 confirmation、reminder、review request共 3 封：

```text
20 bookings/日 × 3 × 30 = 1,800 emails/月；60/日 → Free 足夠
30 bookings/日 × 3 × 30 = 2,700 emails/月；90/日 → 接近上限
35 bookings/日 × 3 = 105 emails/日 → 超過 Free 每日 100
```

建議去到平均 25–30 bookings/日，或者加入大量 newsletter 前升 Resend Pro $20/月／50,000 emails。

### Vercel request 容量示例

假設 100,000 visits/月，每次 full load 有一個 `/api/session` request，再加 cron：

```text
100,000 session requests
+ 30 Treatwell cron（Hobby 每日模式；Pro 五分鐘模式係 8,640）
+ 約 30 reminder cron
= 約 100,060 function invocations／月（Hobby 每日模式）
```

按 Vercel 公開 on-demand rate $0.60／1,000,000 invocations，單計 invocation 約 $0.065；CPU／memory／transfer 另計，但呢個規模通常遠低於 Pro 嘅 $20 usage credit。高流量時要以 Vercel dashboard 真實 metrics 為準。

## 7. 剩餘一次性開發成本

以下係由「目前 code-ready」去到「正式可依賴 Treatwell API、完整 production hardening」嘅市場工時估算：

| 工作 | 工時範圍 |
|---|---:|
| Treatwell 官方 adapter、auth、webhook／polling、reconciliation | 24–48 小時 |
| Admin MFA、shared rate limit、登入告警 | 16–28 小時 |
| Backup／restore automation、audit log | 12–24 小時 |
| E2E、concurrency、email、cron、failover UAT | 20–32 小時 |
| Domain、DNS、Resend、Vercel／Neon production rollout | 8–16 小時 |
| **合計** | **80–148 小時** |

以英國 freelance／agency 工程費 **£50–£90/小時** 作範圍：

```text
80 × £50 = £4,000
148 × £90 = £13,320
```

所以剩餘 production 工程應預 **約 £4,000–£13,300**。最大不確定因素係 Treatwell API 文件質素、認證／approval、webhook 能力及合約要求；如果 Treatwell 只需標準 REST + webhook，成本接近下限。如果冇 webhook、文件不足或要 certification，會接近／超過上限。

## 8. 建議上線次序

### Phase A — 基礎設施（1–2 日）

1. Hobby 測試期可直接 deploy 每日 cron；正式營運前升 Vercel Pro，將 Treatwell schedule 改為每五分鐘。
2. 綁正式 domain，設定 `NEXT_PUBLIC_SITE_URL`。
3. Neon 升 Launch 或至少設用量／備份警報。
4. 開 Upstash，填兩個 REST env，令登入 rate limit 共享。
5. Resend 驗證 domain、SPF、DKIM、DMARC，設定 `EMAIL_FROM`／`EMAIL_REPLY_TO`。

### Phase B — Deploy 今次改動（1 日）

1. Deploy preview，確認 migration plan。
2. Production deploy 會執行 Vercel Prisma migration。
3. 入 `/admin/integrations` 核對全部狀態。
4. 設 iCal feed／staff mapping，手動 sync。
5. 用 production domain 驗證 CDN HIT、首頁 TTFB、confirmation email。

### Phase C — Treatwell API（等官方文件）

1. 完成 adapter及 webhook／worker route。
2. 填 staff/service ids；保持 API flag off。
3. Shadow sync 7 日，逐張 booking 對數。
4. 模擬 Treatwell 401、429、5xx、timeout、duplicate、cancel／reschedule。
5. 確認 Treatwell 合約允許後先開 `TREATWELL_API_ENABLED=true`。

### Phase D — Production launch

1. Admin MFA、rate limit、backup restore、audit log完成。
2. 真實客戶 email delivery、booking／cancel／reschedule E2E 通過。
3. Treatwell 同網站連續 7 日無 reconciliation 差異。
4. 設 Vercel／Neon／Resend 50%、75%、90% 用量警報。
5. 先 soft launch，再逐步開公開 marketing。

## 9. 官方價格及設定資料

- [Vercel Pro Plan](https://vercel.com/docs/plans/pro-plan)
- [Vercel ISR](https://vercel.com/docs/incremental-static-regeneration)
- [Vercel CDN Cache](https://vercel.com/docs/caching/cdn-cache)
- [Vercel Cron Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Neon Pricing](https://neon.com/pricing)
- [Resend Pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
- [Resend Domain／SPF／DKIM](https://resend.com/docs/dashboard/domains/introduction)
- [Upstash Redis Pricing](https://upstash.com/pricing/redis)
- [Treatwell Partner Terms](https://www.treatwell.co.uk/info/supplier-terms-and-conditions/)
