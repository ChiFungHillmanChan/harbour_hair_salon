# Database／Backend 修正結果 — 2026-09-16

今次按已批准嘅審查，直接喺 `main` 工作目錄實作。範圍集中資料庫、身份驗證、後端讀寫、背景工作，同 SEO 所依賴嘅伺服器資料；登入驗證、分頁及 kiosk 管理只加必要介面。

原始問題同修正前證據保留喺 [審查報告](backend-database-audit-2026-09-16-cantonese.md)。呢份係修正後狀態，唔應該將原報告當成仍未修正嘅問題清單。

## 16 項審查問題對照

| 原項目 | 實作結果 | 主要證據／限制 |
|---|---|---|
| 01 訪客帳戶接管 | 已存在帳戶一律唔可以經註冊直接設定密碼；只可用既有電郵驗證復原流程 | `auth-security.test.ts`、password reset 競爭測試 |
| 02 管理頁權限 | 每個 admin page 喺讀資料前 `requireAdmin()`；共用 request-scoped session 驗證，重讀現時角色、sessionVersion 同 MFA 狀態 | calendar DAL／blog guard 測試；production HTTP 舊權限測試 |
| 03 ICS recurrence | 保留 UTC／TZID 語義；hourly recurrence、精確 EXDATE、倫敦 DST／全日事件已修正 | calendar-ical 時區及排除日測試 |
| 04 糧單 finalization | 狀態、快照同 audit event 喺同一交易；run／adjust／finalize／reopen 先鎖同一 period row，Serializable + retry | 真 PostgreSQL 競爭及第二筆快照寫入失敗回滾 |
| 05 日曆 overfetch | 全年只取 12 個月份 aggregate；月份唔取聯絡電郵、roster、busy rows；單日先取詳情；global pending 每頁 25 筆、有 date＋id cursor | actual PostgreSQL 倫敦跨月邊界、DAL cursor 測試；手機金額／時間改用 booking snapshot |
| 06 糧單 N+1 | 工時、現有 line、員工、已完成預約分別批次讀；以 Map 分組，唔再逐個員工讀歷史 | 10 位員工實測 4 次來源 SELECT；有 legacy service price 關聯資料時 Prisma 可額外發固定 relation SELECT；每人寫入一筆不同糧單仍然必要 |
| 07 無分頁列表 | 客戶 upcoming／history、Google customers／admins、評論、更表、public／admin blog 加有上一頁／下一頁嘅 bounded query | 一般 25 筆；public blog 12 筆、admin blog 20 筆；每次多取 1 筆判斷下一頁。列表用穩定排序 |
| 08 停用髮型師 | Slot 查詢同最終 booking transaction 都檢查 active | unit regression＋真 PostgreSQL 拒絕測試 |
| 09 六個預約上限 | count 移入 Serializable booking transaction，兩條建立路徑一致 | 真 PostgreSQL 由 5 個同時搶兩個不同時段，最終最多 6 個 |
| 10 Kiosk 長效 token | 改用有期限 DB device session；30 日，到期／撤銷立即失效；可逐部或全部撤銷 | 舊 kiosk cookies 會失效，部署後需重新啟用 |
| 11 ICS 逐筆 upsert | 已驗證 window 用交易替換；每批最多 100 筆 createMany，失敗保留原 busy blocks | 真 SQLite 250 筆 bulk import／rollback／空 feed reconciliation；PG integration |
| 12 Retention 耦合 email | 獨立 `/api/cron/housekeeping`，有獨立 flag／lease；每階段最多 250 筆，recheck 條件後先改／刪 | 30 日 unsent payload、30 日 expired busy／kiosk、365 日 terminal notification metadata；大量 backlog 需監察及加快清理，唔保證絕對 TTL |
| 13 缺 indexes | 加 user/date/id、pending status/date/id、busy end、outbox FK／lockedAt／createdAt indexes | PG migration replay＋schema diff；另加 kiosk／audit indexes |
| 14 Schema／migration 漂移 | 保留原 migration；新增 additive PG migration；補齊 SQLite 舊 migration chain；重建 SQL Server catch-up | PG／SQLite 實際 replay＋zero drift；SQL Server 未有可用實例，需 staging 實測。Nullable unique 採 filtered index，Prisma 6 嘅 diff 有表達限制 |
| 15 Destructive seed | 必須明示 opt-in，而且只准受控本機 disposable DB；拒絕 production／Vercel／remote／symlink escape | guard tests；冇執行破壞性 production seed |
| 16 Sitemap／SEO 讀取 | Sitemap 只選 URL／時間欄位；用相關資料真正最新時間；DB 出錯會使 regeneration 失敗，唔再發出遺漏 URLs 嘅成功結果 | sitemap tests；public blog 分頁保留各頁 canonical、server-rendered links |

## 額外安全同維護修正

- 管理員固定 8 小時 session，客戶固定 30 日；移除用舊 JWT 滑動續期。
- 管理員密碼同 Google 登入均先取得 5 分鐘 first-factor challenge，再經 authenticator／一次性 recovery code；未設 MFA 嘅管理員必須設定後先有 admin session。
- TOTP seed 使用 AES-GCM 加密，recovery codes 只存 hash；TOTP step 同 recovery code 都用資料庫 conditional write 防止重用。
- MFA 每帳戶 5 分鐘最多 8 次，透過資料庫 row lock＋audit count 執行，唔會因 Redis 故障或 Vercel 多實例而重置。另保留 IP limiter。
- 新增 audit 記錄：登入／復原、管理員帳戶變更、kiosk、糧單、員工薪酬／PIN、更表、工時、預約狀態、settings、calendar 設定／token。敏感寫入同 audit 一齊 commit／rollback。`/admin/operations` 有分頁查閱。
- 額外修正工時批准競爭：用 `updatedAt` 同非空 clockOut 作原子條件，避免批准另一位管理員剛改動嘅工時。
- MFA 設定後 cookie 觸發 page rerender，仍保留一次性 recovery codes 顯示；重新 GET 唔會再讀返 codes。
- Admin bootstrap 改為明示 maintenance target／確認及 env 注入，唔再接受明文密碼 argv；更新帳戶會撤銷舊 session、保留已登記 MFA，並原子記錄 audit。
- 新增受控 MFA key rotation 同 break-glass reset 工具；詳細操作見 [營運手冊](backend-security-operations.md)。
- Prisma client 延遲到真正查詢先讀 runtime env／建立連線；disabled cron import 唔會要求 DB credentials。
- Blog／category／stylist list、related cards、sitemap 分開 projection；detail 用 request cache 減少重複 lookup。Public reviews 同 employee 頁移除唔需要嘅 scalar／relation 資料。
- 未有正式供應商 contract 嘅舊 Treatwell outbound API worker 改為提早拒絕執行，唔會假裝成功或排入一條未實作嘅傳送路徑。
- CI 加 dependency audit、PG／SQLite migration replay＋drift、真 PG concurrency、production build、HTTP authorization／MFA／分頁驗證。

## 驗證結果

以下已喺 Node 24、隔離 PostgreSQL 17 同 synthetic fixtures 驗證，並非連到 production：

| 驗證 | 最終結果 |
|---|---|
| `pnpm test` | **542／542 通過**，0 failed／skipped |
| `pnpm lint` | 通過 |
| `pnpm exec tsc --noEmit --incremental false` | 通過 |
| `pnpm build` | 通過；首頁、services、stylists、contact、offers、sitemap 保留靜態／ISR；分頁 blog server-rendered |
| 三份 Prisma schema validate | 全部通過 |
| PostgreSQL 全 migration replay＋schema diff | 通過，無差異 |
| SQLite 全 8 個 migrations replay＋schema diff | 通過，無差異；另驗證舊 rows／FK 保留、重複 availability 安全中止 |
| `pnpm test:integration` | 真 PG 同 slot 搶位、六個預約 cap、通知／discount atomic rollback、糧單競爭及 snapshot rollback、audit 失敗回滾、calendar reconciliation 通過 |
| 年曆邊界 | 修正 Prisma raw Date 綁定為 timestamptz 與 UTC timestamp 欄位比較問題；PG session 分別 UTC／London／Auckland 都正確把 BST 月界歸入下一月份 |
| `pnpm test:backend-http` | 最新 production build：10 個 admin pages 拒絕匿名／USER／舊 admin／降權／撤銷 token；年度／月份 PII minimization、客戶／blog 分頁及 canonical、舊 kiosk 拒絕通過 |
| 真 HTTP MFA 表格 | 設定後 10 個 recovery codes 保留；重新 GET 唔重現；舊 TOTP／已用 recovery code 拒絕；12 個不同 synthetic IP 同時提交，DB 記錄 8 次、拒絕 4 次 |
| Admin bootstrap | 真 PG 建立／更新、sessionVersion 7→8、保留已登記 MFA、audit 失敗完全回滾通過 |
| `pnpm audit --audit-level=high` | advisory 回報 info／low／moderate／high／critical **全部 0**；唔等於永久無漏洞 |
| Workflow YAML／`git diff --check` | 通過 |

Build 仍有現有 Next middleware 命名及 Prisma package.json config 嘅 deprecation 提示，冇 compilation error；之後升級相應 major version 前需要跟官方遷移指引。呢輪冇藉由改測試預期去忽略業務失敗：跨時區 SQL 同 MFA recovery display 問題都有先重現、修正，再重跑實際流程。

本機驗證紀錄位於 `/tmp/harbour-remediation-20260916/`；正式部署要重新保留 CI／staging 證據。

## 仍然需要 production／組織證據

呢啲修改改善 security readiness，**唔等於網站已取得 SOC 2，亦唔能夠保證「完美」或零漏洞**。

1. Production migration、部署、managed Redis／cron flags、所有管理員 MFA enrollment、kiosk 重新啟用，要按手冊 rollout；本次只操作合成測試資料。
2. Vercel／Neon／GitHub／email／Redis 實際 IAM、MFA、DB 最小權限、TLS、secret rotation、依賴更新政策，需存留可核實設定證據。
3. 備份／PITR、實際還原演練、RPO／RTO、告警、事件應變、存取審查、變更批准同供應商風險管理，唔能夠由程式碼測試代替。
4. AuditEvent 喺 app 冇一般修改／刪除入口，但有 DB 寫入權限嘅人仍可以改資料；防竄改 external log sink／DB role separation 仍需營運配置，唔應宣稱 immutable audit trail。
5. SQL Server 要用 staging clone 驗證 migration、unique index 語義同 rollback；本次唔會將生成 SQL 等同實機成功。
6. 真實生產資料量下嘅 `EXPLAIN (ANALYZE, BUFFERS)`、p95／p99、連線池同壓力測試要持續量度。本次證明查詢形狀、資料隔離同 concurrency invariants，唔係 production SLA／SEO 排名保證。

MFA 使用 [OTPAuth 官方實作](https://github.com/hectorm/otpauth)，而唔係自行重寫一次性密碼演算法。
