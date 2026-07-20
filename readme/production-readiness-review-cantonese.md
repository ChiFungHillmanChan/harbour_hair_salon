# Harbour Hair Salon 正式環境準備度及安全審查報告

審查日期：2026-07-20（英國時間）
審查範圍：首頁 SEO、登入安全、管理後台及資料儲存、Treatwell 同步、免費方案容量與正式上線準備度
審查方式：原始碼及設定檔審查、production build／lint／測試、依賴漏洞掃描、三套 Prisma schema 驗證、已部署網站 HTTP 實測、Vercel Production 環境設定核對、Neon production 資料庫唯讀連線檢查、AWS 排程資源核對，以及供應商官方文件核實。
> 本報告係技術及安全審查，並唔構成法律意見。所有 production 環境及外部服務狀態，以 2026-07-20 實測結果為準。

## 1. 執行摘要

### 最終結論

**目前可以當作 staging／封閉式測試環境使用，但未達到正式公開營運上線標準。總體決定：NO-GO。**

如果只問「程式主體可唔可以開始 UAT 測試」：**可以，有條件 GO**。核心 booking transaction、權限檢查、資料庫索引、SEO 基礎、單元測試都已有良好底子。

如果問「而家可唔可以畀真客正式預約，同時依賴 Treatwell 同步」：**唔可以**。必須先處理下列上線阻擋：

1. Treatwell AWS 排程及 Lambda 未部署，production 資料庫亦有 **0 個已設定 feed**；現時實際上冇同步。
2. 現有方案只係 Treatwell → 網站嘅單向 iCal 拉取，網站預約唔會寫返 Treatwell；五分鐘輪詢亦唔能夠保證零撞期。
3. Production 缺少 `EMAIL_FROM`，程式會退回 Resend 測試寄件者，正常情況只可寄到 Resend 帳戶擁有人，客人收唔到確認、提醒等重要電郵。
4. Production 冇 Upstash rate-limit 設定；serverless 環境下登入防暴力破解只靠記憶體，跨 instance／cold start 無效。
5. 管理員冇 MFA，而登入 session 可滑動延長至 30 日；對持有客戶資料、員工／糧務資料嘅後台風險過高。
6. Vercel 官方列明 Hobby 只限非商業個人用途；髮型屋正式營運網站唔符合該方案使用條件。
7. 所有主要公開頁面目前都係動態、`private, no-cache, no-store`，首頁 cold TTFB 實測約 1.96 秒；增加 SEO、Vercel function、資料庫 cold-start 壓力。

### 五個重點評級

| 範圍 | 評級 | 結論 |
|---|---:|---|
| 1. 首頁 SEO | 6.5/10 | 基礎齊全，但首頁完全冇 CDN cache、cold TTFB 偏慢、canonical 仍係 `vercel.app`；未係理想正式 SEO 狀態。 |
| 2. 登入安全 | 5/10 | JWT、HttpOnly cookie、密碼 hash、server-side 權限檢查做得好；但 production rate limiting 無效、冇 MFA、客戶密碼要求偏弱。 |
| 3. Admin／backend／storage | 6/10 | Prisma、transaction、索引、Neon TLS／靜態加密基礎良好；但欠 audit trail、可靠備份／復原演練、私隱告示內容亦不足。 |
| 4. Treatwell | 2/10 | 程式有安全失敗處理，但 production 冇 feed、冇排程資源、只做 inbound；不可視為 ready。 |
| 5. Production／free tier | 技術 5/10；條款 0/10 | 小型 salon 流量技術上大致夠，但 Vercel Hobby 商業用途不合規，而且現時動態 rendering 浪費免費額度。 |

## 2. 已確認做得好嘅部分

- 首頁已有獨立 title、description、canonical、Open Graph、Twitter metadata、`robots.txt`、sitemap、manifest、`lang="en-GB"`、單一 H1，以及 `HairSalon` JSON-LD；JSON-LD 亦有防止 `</script>` breakout 嘅 escaping。
- 本地圖片使用 `next/image`，hero 圖有 priority，主要圖片有 alt text。
- 密碼使用 bcrypt；JWT 強制 HS256、設有效期；session cookie 有 `HttpOnly`、production `Secure`、`SameSite=Lax`。
- `verifySession()` 每次會重新讀取資料庫角色及 `sessionVersion`；用戶被刪、降權或重設密碼後，舊 session 可即時失效。
- Middleware 之外，admin layout 同所有抽查過嘅 admin Server Actions 都再次做 server-side ADMIN 檢查，唔係只靠前端隱藏按鈕。
- 登入錯誤訊息冇區分「帳戶不存在」或「密碼錯誤」；redirect 亦有阻止外部 URL／open redirect。
- Booking 建立及改期採用 Serializable transaction 加 retry，並於 transaction 內再次檢查網站預約及 external busy block，網站內部防撞期設計正確。
- Prisma 查詢有參數化；未發現直接拼接 SQL、硬編碼正式 secret、前端暴露 session secret，亦未發現未經 escaping 將可控 HTML 注入頁面。
- 已有 HSTS、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、Referrer-Policy 及 Permissions-Policy。
- Neon 連線有 serverless connection limit，schema 對 booking、external busy、status／date 等常用查詢亦有合適索引。
- Treatwell 拉取設有 8 秒 timeout、5 MB 上限；feed 失敗或內容無效時唔會錯誤刪除舊 busy blocks，呢個 fail-safe 做法正確。
- 測試涵蓋 booking 規則、日期／DST、discount、JSON-LD escaping、Treatwell parser 及失敗保護等重要邏輯。

## 3. 詳細發現及建議

嚴重度定義：**高**＝正式上線前應修正；**中**＝可造成安全、可靠性或營運問題，應列入 launch checklist；**低**＝防禦深度、SEO 或維護質素改善。

### SEO-01 — 公開頁面全部動態化，首頁無 cache 並有明顯 cold start

- **嚴重度：中；上線優先度：高**
- **位置：** `src/app/layout.tsx:67-79`、`src/app/page.tsx:31-32,122-135`
- **證據：** root layout 呼叫 `headers()`；首頁亦呼叫 `getSession()` 及多個資料庫查詢。Production build 將 `/` 及主要 marketing routes 標示為動態。已部署首頁回應 `Cache-Control: private, no-cache, no-store`、`x-vercel-cache: MISS`，所以 `revalidate = 3600` 實際冇發揮作用。
- **速度實測：** 已部署首頁五次請求，首次 TTFB 約 **1.957 秒**、total 約 **2.005 秒**；之後暖機 TTFB 約 **0.184–0.203 秒**。本機 warm TTFB 約 **5–8 ms**，表示主要問題係 serverless／資料庫 cold start 及跨區，而唔係純 React 計算。
- **影響：** 搜尋爬蟲及第一次到訪者速度較差；每個 bot／客戶 page view 都消耗 Vercel function 同 Neon active time，免費額度更快用盡。
- **建議修正：** 將 marketing layout 同 authenticated chrome 分開；公開頁面唔好讀 session，將登入狀態放到小型 client endpoint／獨立動態 island；用 `unstable_cache`／`use cache` 快取 site settings、services、offers、reviews；令首頁及其他 marketing pages 可用 ISR／CDN cache。
- **短期緩解：** 先快取所有非個人化 DB query，並監控 Vercel Function Invocations、Active CPU 及 Neon CU-hours。
- **誤報備註：** 呢個結果已由 production header 及 build route output 雙重確認，唔係只憑程式碼推測。

### SEO-02 — 正式 canonical／JSON-LD 仍使用 Vercel 子網域，Search Console 驗證未見設定

- **嚴重度：中**
- **位置：** `src/app/lib/site-url.ts:1-10`、`src/app/layout.tsx:16-64`
- **證據：** Production 環境欠 `NEXT_PUBLIC_SITE_URL`，所以 live canonical 及 JSON-LD URL 係 `https://harbourhairsalon.vercel.app`；live HTML 未見 Google site verification。
- **影響：** 如果正式品牌網域唔係呢個 Vercel URL，搜尋訊號、backlink 同索引會集中喺錯誤 host；日後轉網域要再做遷移。
- **建議修正：** 上線前綁定品牌 custom domain，設定 `NEXT_PUBLIC_SITE_URL=https://正式網域`，將所有其他 host 301 到唯一 canonical，並完成 Google Search Console／Bing Webmaster 驗證及提交 sitemap。
- **短期緩解：** 如果確定長期使用 `vercel.app`，此項可降為低；但對正式商業品牌不建議。
- **誤報備註：** 如果 GSC 用 DNS 驗證，HTML 冇 meta tag 屬正常；但 production env 仍要設定正式 canonical。

### SEO-03 — Title 品牌訊號及 sitemap 更新日期可改善

- **嚴重度：低**
- **位置：** `src/app/page.tsx:21-29`、`src/app/sitemap.ts:39-44,58-120`
- **證據：** live title 只有 `Expert Hair Styling in Leeds City Centre`，未包含 Harbour Hair Salon；部分靜態頁 sitemap `lastModified` 每小時被設成當下時間，即使內容冇改。
- **影響：** 搜尋結果品牌辨識略弱；虛假更新時間令 sitemap 訊號失真。
- **建議修正：** 首頁 title 加品牌，例如 `Hair Salon in Leeds City Centre | Harbour Hair Salon`；靜態頁只喺實際內容更新時改 `lastModified`。
- **誤報備註：** 呢項唔會單獨阻擋索引或上線。

### SEC-01 — Production 登入 rate limiting 實際上唔可靠

- **嚴重度：高**
- **位置：** `src/app/actions/auth.ts:28-72`
- **證據：** Production 欠 `UPSTASH_REDIS_REST_URL` 同 `UPSTASH_REDIS_REST_TOKEN`。程式因而退回 process memory 計數；Vercel serverless cold start／多 instance 之間唔共享，restart 後亦會清零。Redis 出錯時設計亦係 fail-open。
- **影響：** 攻擊者可分散請求、等 cold start 或命中不同 instance，繞過密碼猜測限制；admin 同 customer 共用同一入口。
- **建議修正：** 上線前配置共享式 rate limiter（Upstash／Vercel Firewall／其他 durable store）；最少同時按 IP、正規化 email、帳戶計數，採用短期延遲／暫時鎖定，並為異常 admin login 告警。
- **短期緩解：** 用 Vercel WAF 對 `/signin`、registration action 加速率規則；admin 密碼先用 password manager 生成 16+ 字元隨機密碼。
- **誤報備註：** 如果 dashboard 之後另加咗 WAF 規則，可降低風險；本次審查未見 repo 或 production env 有共享 limiter。

### SEC-02 — Admin 冇 MFA，session 可滑動延長 30 日

- **嚴重度：高**
- **位置：** `src/app/lib/session.ts:14-24,39-70`、`src/middleware.ts:82-105`
- **證據：** Repo 冇 MFA／TOTP／WebAuthn 流程；admin 與 customer 使用同一 30 日 session policy，middleware 會續期。Production 現時有管理員帳戶。
- **影響：** 一次 password reuse、phishing 或 cookie 失竊，可長時間控制客戶、預約、員工、工時及糧務資料。
- **建議修正：** Admin 強制 MFA，最好 WebAuthn/passkey 或 TOTP；admin 改用較短 absolute expiry（例如 8–12 小時）及 inactivity timeout（例如 30–60 分鐘），敏感操作要求重新驗證；cookie 可改 `__Host-session`。
- **短期緩解：** 限制 admin 數量、使用獨立強密碼、登入異常告警，唔好喺共用電腦保留 session。
- **誤報備註：** 資料庫角色重查及 `sessionVersion` 撤銷機制係有效保護，但唔能代替 MFA。

### SEC-03 — 客戶密碼及帳戶生命週期控制偏弱

- **嚴重度：中**
- **位置：** `src/app/actions/auth.ts:89-99,120-185`
- **證據：** 客戶 registration 最低只需 6 字元；未見 email verification、forgot-password／自助 reset。Email 亦未統一 `trim().toLowerCase()`。
- **影響：** 容易使用弱密碼；大小寫／空格可造成重複或登入混亂；冇驗證 email 會容許錯誤／他人 email 被登記。
- **建議修正：** 最低 12 字元或採 NIST 式長密碼／passphrase，阻擋常見洩漏密碼；正規化 email；加入有時限、一次性 token 嘅 verification/reset 流程，重設後 bump `sessionVersion`。
- **短期緩解：** UI 顯示密碼強度及鼓勵 password manager；admin 暫時用已驗證渠道處理 reset。
- **誤報備註：** bcrypt hashing 正確，呢項係密碼政策及恢復流程問題，唔係明文儲存問題。

### SEC-04 — CSP 仍容許 `unsafe-inline`，connect-src 過闊

- **嚴重度：中**
- **位置：** `next.config.ts:9-19,40-51`
- **證據：** CSP `script-src` 包含 `'unsafe-inline'`，`connect-src` 容許所有 `https:`。
- **影響：** 一旦未來出現 HTML injection，CSP 對 XSS／資料外傳嘅第二層保護較弱。
- **建議修正：** 逐步改用 nonce／hash CSP；列明實際 analytics、CDN、API host；先用 `Content-Security-Policy-Report-Only` 收集違規再收緊。
- **短期緩解：** 保持 React escaping、禁止未清洗 `dangerouslySetInnerHTML`；現有 frame、HSTS、nosniff headers 保留。
- **誤報備註：** 本次未發現可直接利用嘅 XSS；呢項屬防禦深度。

### SEC-05 — 管理員建立／seed 會經 command line 或 log 暴露初始密碼

- **嚴重度：中**
- **位置：** `prisma/create-admin.ts:7-35`、`prisma/seed.ts:163-181`
- **證據：** create-admin 接收 plaintext password command argument，可留喺 shell history／process list；seed 會將隨機 admin credential 輸出到 log，亦可直接將現有 email 升為 ADMIN。
- **影響：** CI log、終端 history 或同機 process 可取得管理員憑證；誤用 production seed 可造成權限提升。
- **建議修正：** 改用互動 hidden prompt／一次性邀請連結；禁止 production 執行 seed；首次登入強制換密碼及 MFA；記錄誰授予 admin 權限。
- **短期緩解：** 立即輪換任何曾出現於 log/history 嘅管理員密碼，限制部署 log 權限。
- **誤報備註：** 本次未發現現有 production 密碼被 commit；風險係操作流程。

### SEC-06 — Treatwell feed URL 可造成 blind SSRF

- **嚴重度：中**
- **位置：** `src/app/actions/admin-stylists.ts:52-60`、`src/app/services/treatwell-sync-service.ts:43-50`
- **證據：** Admin 可儲存任何 `http://`／`https://` URL，server 之後會 fetch；冇限制 Treatwell host、private IP、localhost、link-local 或 redirect 目的地。
- **影響：** 如果 admin 帳戶被攻破，攻擊者可利用 Vercel server 對內部／metadata／私人網絡 endpoint 發請求。
- **建議修正：** 只 allowlist Treatwell 官方 iCal host 及 HTTPS；DNS resolve 後拒絕 private、loopback、link-local、IPv6 local ranges；禁止或逐跳驗證 redirects。
- **短期緩解：** 只由受信任管理員輸入 feed URL，定期核對現有 URLs。
- **誤報備註：** 只有 admin 可設定，所以唔係未登入遠端 SSRF；仍然應作為 admin compromise 後嘅 blast-radius 控制。

### SEC-07 — Production dependencies 有 2 個 moderate advisories

- **嚴重度：中**
- **位置：** `pnpm-lock.yaml`；transitive dependencies `next → postcss`、`resend → svix → uuid`
- **證據：** `pnpm audit --prod` 回報 2 個 moderate：PostCSS XSS advisory `GHSA-qx2v-qp2m-jg93`、uuid buffer bounds advisory `GHSA-w5hq-g745-h8pq`。
- **影響：** 目前 repo 使用路徑未證明可直接利用，但正式環境唔應長期帶已知漏洞；未來用法改變可能令漏洞變成可達。
- **建議修正：** 先測試升級 Next／PostCSS 同 Resend／uuid 到已修補版本，重跑完整測試、build、audit；不要直接跨 Prisma 5 → 7 等 major version 作無測試升級。
- **短期緩解：** 確認冇將不可信 CSS 內容交畀 PostCSS stringify，亦冇用 uuid 受影響嘅 buffer API。
- **誤報備註：** 嚴重度沿用 package audit；屬依賴風險，唔代表網站已被入侵。

### SEC-08 — 管理後台欠不可抵賴 audit trail

- **嚴重度：中**
- **位置：** 三份 Prisma schema 及 `src/app/actions/admin*.ts`
- **證據：** 未見通用 AuditLog model／append-only admin event；只有個別欄位例如 `editedByAdminId`、`finalizedByAdminId`。
- **影響：** 無法可靠追查邊個改過用戶角色、價錢、discount、schedule、工時、糧務或設定；安全事件、客訴、內部錯誤難以還原。
- **建議修正：** 加 `AuditLog`，記錄 actor、action、target type/id、時間、request id、成功／失敗及經過遮罩嘅 before/after；高風險 log 定期匯出至不可隨意更改嘅外部儲存。
- **短期緩解：** 限制 admin 人數，依賴 Vercel deployment/activity logs 只作暫時補充。
- **誤報備註：** 供應商 platform log 唔等於應用層業務 audit log。

### DATA-01 — 資料加密足夠，但免費資料庫復原能力唔適合做唯一正式保障

- **嚴重度：中；上線優先度：高**
- **位置：** `src/app/lib/prisma.ts:7-28`、Neon production project
- **證據：** Production Postgres 可連線，serverless pool limit 為 5；Neon 官方提供 TLS in transit 及 AES-256 at rest。Free plan 目前每 project 0.5 GB、100 CU-hours，但只有 6 小時 time travel／restore；未見定期獨立 backup 或 restore drill。
- **影響：** 誤刪、惡意 admin、程式 bug 或延遲超過 6 小時先發現時，客戶、預約、員工、工時／糧務資料可能無法完整復原。
- **建議修正：** 上線前做一次有紀錄 restore drill；建立每日加密 logical backup，設 retention、異地儲存及存取控制；定義 RPO/RTO。含員工／糧務資料時，建議採用更長 PITR／支援嘅付費資料庫方案。
- **短期緩解：** 每次 migration 前手動可驗證 backup；限制 production DB credential 及 admin 權限。
- **誤報備註：** 呢項唔係指 Neon 冇加密，而係單一免費 project 嘅災難復原窗口不足。

### DATA-02 — Privacy notice 未完全覆蓋 UK GDPR「知情權」資料

- **嚴重度：中**
- **位置：** `src/app/privacy/page.tsx:24-75`
- **證據：** 頁面有資料類別、一般用途、分享及權利，但未清楚列出每項處理嘅 lawful basis、實際 retention period／判斷準則、具名主要 processors／國際轉移保障、ICO 投訴方法等；亦未見員工／工時／糧務獨立 privacy notice。
- **影響：** 正式收集 UK 客戶及員工個人資料時，私隱透明度可能不足，亦增加客訴及合規風險。
- **建議修正：** 按 ICO checklist 更新 customer notice；員工資料另做 employee privacy notice；列清 Vercel、Neon、Resend、Treatwell 等角色、地域／轉移機制、保存期、聯絡人及 ICO 投訴權。
- **短期緩解：** Launch 前由熟悉 UK GDPR 嘅顧問／負責人審核文字。
- **誤報備註：** 是否需要 DPO／特定 transfer 文件取決於實際公司安排；本報告唔作法律定論。

### OPS-01 — Production 電郵設定未完成，客戶關鍵通知目前不可依賴

- **嚴重度：高；正式上線阻擋**
- **位置：** `src/app/services/email-service.ts:25-30`、`src/app/actions/newsletter.ts:76-118`
- **證據：** Vercel Production 有 `RESEND_API_KEY`，但冇 `EMAIL_FROM` 及 `RESEND_AUDIENCE_ID`。程式註明 fallback `onboarding@resend.dev` 只可寄到 Resend 帳戶擁有人；newsletter contact 缺 audience ID 時會略過儲存。
- **影響：** 真客可能收唔到 booking confirmation、cancel/reschedule、appointment reminder、review request；newsletter UI 看似成功但聯絡人未加入 audience。
- **建議修正：** 在 Resend 驗證正式品牌 domain，設定 `EMAIL_FROM`、SPF、DKIM、DMARC；設定 audience ID；用非帳戶擁有人真實地址完成 end-to-end delivery、spam、bounce 測試。
- **短期緩解：** 在修妥前只容許內部測試帳戶，唔好接受真客預約。
- **誤報備註：** 呢個係 production env 實際核對結果；如果之後新增設定，要重新實測收件先可關閉 finding。

### TW-01 — Treatwell production 同步目前根本未啟用

- **嚴重度：高；正式上線阻擋**
- **位置：** `infra/aws/treatwell-sync/README.md:1-69`、`src/app/api/cron/treatwell-sync/route.ts:19-35`
- **證據：** Runbook 設計為 AWS EventBridge Scheduler 每五分鐘呼叫 Lambda；但指定 production account／`eu-west-2` 內查唔到 `treatwell-sync-5min` schedule 或 `treatwell-sync` Lambda。Production DB 唯讀檢查顯示 1 位 stylist，但 **0 個 configured Treatwell feed、0 個 external busy block**。
- **影響：** Treatwell 新預約完全唔會進入網站 availability；網站可將同一時段賣畀另一位客。
- **建議修正：** 建立及部署 Lambda／schedule／secret，為每位實際接 Treatwell 預約嘅 stylist 設 feed；手動 invoke 後驗證 DB blocks；再做「Treatwell 新增、取消、改期、無效 feed、timeout」全流程測試。
- **短期緩解：** 未完成前關閉網站即時 booking，改為 request-to-book／電話確認，或只用 Treatwell 官方 widget 作唯一預約來源。
- **誤報備註：** 本次核對係指定 runbook account/region；如果資源部署喺另一 account/region，需提供實際位置及執行證據再重驗。

### TW-02 — 只做單向 inbound，而且五分鐘 polling 唔能保證防撞期

- **嚴重度：高；正式上線阻擋**
- **位置：** `src/app/services/treatwell-sync-service.ts:36-124`、`docs/superpowers/plans/2026-06-29-treatwell-ical-sync.md:5-7`
- **證據：** 現有 Phase 1 只拉 Treatwell iCal 到 `ExternalBusyBlock`；repo 冇將網站 booking 寫返 Treatwell 嘅實作。即使每五分鐘成功拉取，兩次 pull 中間仍有 race window。Treatwell 現行 partner terms 亦寫明 partner 應將所有來源 booking 加入 Treatwell calendar，並限制使用其他第三方 booking software；實際適用情況要按 salon 簽署嘅 Specific Partner Agreement 向 Treatwell 確認。
- **影響：** 網站預約後 Treatwell 仍可能顯示有位；另一位客可於 Treatwell 訂同一時段。五分鐘後同步只會見到已經發生嘅衝突，無法自動決定保留邊張單。
- **建議修正：** 上線前向 Treatwell 取得書面確認及官方 API／允許嘅整合方案。最安全係用 Treatwell widget／官方實時 availability 做唯一 source of truth；如獲准雙向 API，網站 booking 必須同步寫返 Treatwell，並有 idempotency、衝突回滾、webhook／短 polling、人工 reconciliation queue。
- **短期緩解：** 若只得 iCal inbound，網站改 request-to-book，待人手核對 Treatwell 後先確認，並清楚告知客人未即時確定。
- **誤報備註：** 條款可能受個別 Specific Partner Agreement 修訂；技術上「單向同步有撞期窗口」則係確定事實。

### TW-03 — 目前量度到嘅唔係 feed ping；同步亦欠 freshness／告警

- **嚴重度：中**
- **位置：** `src/app/services/treatwell-sync-service.ts:18-21,36-124`、`src/app/api/cron/treatwell-sync/route.ts:19-35`
- **證據：** 公開 Treatwell salon listing 五次 warm TTFB 約 **0.178–0.338 秒**、total 約 **0.243–0.401 秒**，但該頁約 828 KB，並唔係 iCal feed。Production 根本冇 configured feed，所以無法量度真實 feed latency／freshness。程式只靠 route 502／log，admin 冇顯示 last successful sync、lag 或 stale warning。Feed 亦逐位 stylist 順序 fetch；每個可等 8 秒，而 route max duration 60 秒。
- **影響：** 排程死咗或 feed 長期失敗時，管理員未必知道；約 7 個連續 timeout 已可能逼近 60 秒上限。
- **建議修正：** 儲存 `lastAttemptAt`、`lastSuccessAt`、duration、event count、error；超過 10–15 分鐘未成功即告警及停止自動確認；fetch 做有上限並行；部署後連續 7 日量度 p50/p95/p99。
- **驗收目標：** scheduler 成功率 ≥99.9%；p95 單 feed fetch <2 秒；由 Treatwell 變更至網站 block 可見 p95 <7 分鐘（以 5 分鐘 cadence 計）；任何 stale >10 分鐘必須有可見告警。即使達標，仍唔等於零撞期。
- **誤報備註：** Listing ping 只可證明 Treatwell 公開網頁當時回應正常，不可當同步性能證據。

### CAP-01 — Vercel Hobby 容量可能夠，但商業用途條款不允許

- **嚴重度：高；正式上線阻擋**
- **證據：** Vercel 官方 Hobby 文件目前列出每月 4 CPU-hours、360 GB-hours memory、1,000,000 function invocations、100 GB transfer，並明確限制為非商業、個人用途。髮型屋接受預約屬商業用途。
- **影響：** 即使技術用量未超額，正式營運仍不符合方案條件；超額時 Hobby 功能可暫停至額度重設，亦缺正式 email support／較長 runtime logs。
- **建議修正：** 正式 launch 前升 Vercel Pro，或移到明確容許商業用途嘅平台；唔應以「流量細」作為繼續用 Hobby 嘅理由。
- **誤報備註：** 呢項依據 Vercel 2026-06-16 更新嘅官方文件；如有書面商業豁免，需以豁免條款為準。

### CAP-02 — 免費額度對單一 salon 暫時大致足夠，但真正瓶頸係動態 request 同 DB 喚醒

- **嚴重度：中**
- **Vercel 粗略估算：** 1,000,000 invocations/月即平均約 33,333/日、0.386 request/s。假設每個動態 request 只用 20–50 ms active CPU，4 CPU-hours 理論約支援 288,000–720,000 request/月；呢個只係估算，實際要睇 Vercel usage。以每次 visit 5 個動態 page views 計，約 58,000–144,000 visits/月。
- **Neon 粗略估算：** Free 100 CU-hours/月；最低 0.25 CU 計，約等於每月 400 active compute hours（平均 13.3 小時/日）。如果 24/7 不停被喚醒，最低亦約 180 CU-hours/月，會超額。Neon 5 分鐘 idle 先 scale-to-zero，所以零散 bot traffic 對額度影響特別大。
- **Storage 粗略估算：** 假設 5,000 客戶加 20,000 預約，每筆連 index 平均 1–2 KB，約 25–50 MB，再加其他表仍遠低於 0.5 GB；現階段 storage／Postgres TPS 唔係主要風險。
- **Resend 粗略估算：** Free 3,000 emails/月、每日 100。每張完成 booking 假設有確認、提醒、review request 共 3 封，即約 33 張 booking/日先觸及每日上限；對單店暫時合理，但 cancellation／reschedule／newsletter 會再佔額度。
- **建議：** 修正 SEO-01 後，marketing traffic 應由 CDN 承擔；設定 50%、75%、90% 用量告警。未有 30 日 production metrics 前，保守將動態 function request 控制喺 100,000/月以下。
- **誤報備註：** CPU 數字係明確標示嘅假設，不是 load test；唔應當成 SLA 或保證容量。

### TEST-01 — 單元測試通過，但欠 production-like E2E、CI 及可重現 build

- **嚴重度：中；上線優先度：高**
- **證據：** `pnpm lint` 通過；`pnpm test` **172/172 通過**；三份 Prisma schema 均可 validate。先執行 `pnpm db:dev:generate` 後 production build 通過。但一般 `pnpm build` 曾因 postinstall 固定生成 Vercel Postgres client，而本地 `.env` 係 SQLite，收集 `/blog/[slug]` 時失敗。Repo 未見 CI workflow，現有測試主要係 unit／fake dependency，未見真實瀏覽器 auth/admin/booking/email/cron E2E。
- **影響：** 開發機與 Vercel build 路徑不一致；登入、cookie、middleware、真 DB transaction、電郵及 cron 整合錯誤可逃過現有測試。
- **建議修正：** 加 CI：install → dev client generate → lint → unit → schema validate → build；再加 Playwright E2E，至少測 register/login/logout、admin 拒絕／授權、booking 建立／撞期／取消／改期、Treatwell stale、電郵 sandbox。上線前做 UAT、回滾演練及 10–20 concurrent booking conflict test。
- **短期緩解：** 將正確 build command 寫入 README／CI；每次 deploy 用 preview 做 smoke test。
- **誤報備註：** Vercel production 有 Postgres env，所以已部署 build 可成功；問題係 release 流程一致性同測試覆蓋。

### REPO-01 — Repo hygiene 有低風險殘留檔案

- **嚴重度：低**
- **證據：** Repo 追蹤咗 nested SQLite DB／journal 及 `startup.log`；檢查時 SQLite 內有 0 users／0 appointments，未見現有 PII。
- **影響：** 將來本地 DB 一旦有真資料，容易誤 commit；log 亦可能包含路徑或執行細節。
- **建議修正：** 擴充 `.gitignore` 覆蓋所有 `*.db*`／runtime logs，移除追蹤中嘅空 runtime artifacts，pre-commit／secret scan 加規則。
- **誤報備註：** 本次未發現該 DB 有客戶資料，所以唔列為資料外洩。

## 4. Treatwell 專項結論

**答案：未 ready，亦未有足夠資料證明 ping／同步時間良好。**

目前公開 listing 回應速度尚可，但真正 iCal feed 冇設定，排程及 Lambda 又不存在，所以唔能夠用公開頁 ping 代表同步性能。就算將現有五分鐘 poll 部署成功，佢都只係「延遲反映 Treatwell busy time」；唔係雙向實時 inventory lock。

正式 launch 前至少要完成以下驗收：

1. 與 Treatwell 確認合約容許獨立網站 booking／integration，並取得正式可用嘅 API、widget 或批准方案。
2. 決定唯一 source of truth；如果冇獲准雙向 API，應使用 Treatwell widget 或 request-to-book，而唔係即時自動確認。
3. 部署 scheduler／Lambda，設定真實 feed，驗證 create／update／cancel／timeout／invalid feed。
4. 加 freshness dashboard、stale fail-closed、告警及人工 reconciliation。
5. 至少跑 7 日 shadow mode：同步只記錄、不影響真客，核對 Treatwell 與網站 calendar 差異為 0，再考慮上線。

## 5. 免費方案及預期用戶量

對一間單店髮型屋，**Next.js monolith + 一個 managed Postgres 係合理而且唔算 over-engineered**；毋須微服務、Redis cache cluster 或多資料庫。現有 database schema、transaction 同 indexes 足以應付初期人流。

技術容量方面，經 marketing page cache 優化後，Neon Free 與 Resend Free 很可能足夠初期測試及細規模使用；未有真實 30 日 metrics 前，唔建議承諾確實用戶數。Vercel Hobby 就算容量足夠，亦因商業用途條款而唔可作正式營運方案。

建議初期 operational guardrail：

- Preview／UAT：可繼續用免費層，但只用測試資料及內部收件人。
- 正式 launch：Vercel Pro 或其他商用 hosting；資料庫至少有每日獨立 backup，最好有較長 PITR。
- 流量：先以每月 ≤100,000 dynamic requests 作保守警戒線；marketing cache 完成後應遠低於此數。
- 電郵：每日 70 封先預警，避免突然撞到 100/日上限。
- DB：Neon 50 CU-hours 先預警，75 CU-hours 啟動升級／流量分析。

## 6. 上線修復次序及 Go/No-Go 門檻

### P0 — 未完成不得接受真客預約

1. 解決 Treatwell：官方／合約允許方案、唯一 source of truth、真 feed、scheduler、雙向或 request-to-book 策略。
2. 驗證 Resend domain，設定 `EMAIL_FROM`／Audience，真地址端到端收件成功。
3. Production 配置 shared login rate limit；Admin 強制 MFA 及縮短 session。
4. Vercel 升級至商用允許方案或遷移 hosting。
5. 實行 backup、restore drill，並補齊 privacy notice。

### P1 — 公開 launch 前完成

1. 將 marketing pages 靜態化／ISR；production cold/warm 重新量度及監控。
2. 設正式 custom domain、canonical、301、Search Console／sitemap。
3. 加 production-like E2E／CI、concurrent booking 測試、deploy rollback 演練。
4. 加 admin audit log、Treatwell freshness dashboard／alerts。
5. 修補兩個 dependency advisories及收緊 feed URL SSRF。

### P2 — 上線後首個 sprint

1. 收緊 CSP、改善 customer password／verification／reset。
2. 清理 repo runtime artifacts、改善 sitemap lastModified／title。
3. 根據 30 日真實 Vercel、Neon、Resend metrics 調整方案。

### 最終 Go 門檻

只有以下全部有實測證據，先建議改為 GO：

- 真實客戶地址可收到確認、取消／改期及提醒電郵。
- Treatwell 同網站連續 7 日 shadow reconciliation 無漏單／錯單；stale 時網站會 fail-closed 或轉人工確認。
- Admin MFA、共享式 rate limit、backup restore 均成功測試。
- Custom domain／canonical／robots／sitemap 正確，公開頁有 CDN cache；首頁 cold TTFB 建議 <1 秒、warm p95 <300 ms。
- CI、E2E、production build、migration、smoke test 全部通過，並有可操作 rollback procedure。
- Hosting 方案明確容許商業營運。

## 7. 測試紀錄摘要

| 檢查 | 結果 |
|---|---|
| ESLint | 通過 |
| Unit tests | 172/172 通過 |
| Prisma dev／vercel／prod schema validate | 全部通過 |
| Production build | 先生成正確 dev Prisma client 後通過；預設本地流程有一致性問題 |
| `pnpm audit --prod` | 2 moderate advisories |
| Live security headers | HSTS、DENY、nosniff、Referrer、Permissions、CSP 均存在 |
| Live 首頁 cache | `private, no-cache, no-store`；每次 function render |
| Live 首頁 TTFB | cold 約 1.957s；warm 約 0.184–0.203s |
| Live health TTFB | cold 約 1.556s；warm 約 0.155–0.178s |
| Production DB ping（由英國本機） | cold 約 1.163s；warm 約 89.6–92.2ms |
| Treatwell listing TTFB | warm 約 0.178–0.338s；唔係 feed benchmark |
| Treatwell production feed | 0 個，不能測試 |
| AWS Treatwell schedule／Lambda | 指定 account/region 未找到 |
| PageSpeed Insights API | 因外部 API quota 429 未能取得分數；不影響上述 HTTP 實測 |

## 8. 官方參考資料

- [Vercel Hobby Plan：限制及非商業用途條款](https://vercel.com/docs/plans/hobby)
- [Vercel 平台限制](https://vercel.com/docs/limits)
- [Neon Pricing：Free CU-hours、storage、restore window](https://neon.com/pricing)
- [Neon Scale to Zero](https://neon.com/docs/introduction/scale-to-zero)
- [Neon Security Overview](https://neon.com/docs/security/security-overview)
- [Resend Pricing：3,000/月及 100/日](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
- [Treatwell Partner Terms of Business](https://www.treatwell.co.uk/info/supplier-terms-and-conditions/)
- [ICO：私隱告示應提供嘅資料](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)
- [GitHub Advisory：PostCSS GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
- [GitHub Advisory：uuid GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
