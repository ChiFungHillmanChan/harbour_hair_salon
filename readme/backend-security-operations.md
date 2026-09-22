# Backend 安全及維運手冊

適用於 `20260916230000_backend_security_readiness` migration 及今次程式修正。以下係操作步驟同驗收要求，唔代表 production 設定已經完成，亦唔係 SOC 2 認證。部署負責人要保存執行時間、版本、結果同異常處理紀錄；唔好將密碼、MFA seed、recovery codes、完整 ICS URL 或客戶訊息放入工單／log。

## 上線次序

1. 確認目標 project／database／branch，備份並確認有可用復原方法。先喺隔離 staging 重播 migration、驗證登入同關鍵預約流程。
2. **先套用 migration，再啟動新程式。** PostgreSQL 用 `pnpm db:vercel:deploy`；使用預先配置嘅 `POSTGRES_URL_NON_POOLING` 作 migration direct connection。日常 app 用 `POSTGRES_URL`。兩者必須指向同一目標資料庫，分開 runtime 同 migration 權限。`vercel-build` 只喺 `VERCEL_ENV=production` 自動執行 migration；preview 要用獨立、已更新 schema 嘅 DB。
3. 確認 `SESSION_SECRET`、`CRON_SECRET` 已透過 secret manager 配置。MFA seed 由 `SESSION_SECRET` 衍生加密 key，必須保留可受控復原嘅 key 備份，唔可以當普通設定隨意換值。
4. 發布後，**所有現有管理員重新登入並首次登記 authenticator**。舊 admin cookie 冇 MFA 證明會被拒絕；密碼／Google 第一因素成功後，先完成 MFA，先有 admin session。一次顯示嘅 10 個 recovery codes 要存入受控 password manager；DB 只存 hash。Admin session 固定 8 小時，普通客戶 30 日；瀏覽頁面唔會延長期限。
5. **舊 kiosk cookie 要重新啟用。** 管理員喺共用裝置登入、完成 MFA，再啟用 kiosk；交接會清除該裝置嘅 admin session，建立可撤銷、30 日有效嘅 device grant。喺 Admin → Employees 檢查裝置名、到期日，測試單一裝置及全部裝置撤銷。
6. 分開驗收電郵、calendar 同 housekeeping，先開相應 flag。電郵要確認 Resend sender domain／salon inbox；跨 instance rate limit 要有有效 Upstash 寫入憑證（`KV_REST_API_URL` + `KV_REST_API_TOKEN`，或 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`）。本機 memory fallback 唔係跨 instance 配額。Admin MFA 另有 DB row lock＋`AUTH.MFA_ATTEMPT` 嘅共享帳戶限制：每 5 分鐘最多 8 次，Redis 故障時仍生效；其他流程及共享 IP 限制仍要配置 Upstash。
7. 喺 Admin → Operations 跑 readiness checks；逐位 stylist／provider 喺 Integrations 驗證 feed 同訂閱。最後先喺 Settings 開 online booking，並用受控測試預約驗證建立、確認、取消、改期、電郵及審計事件。

新 PostgreSQL migration 係 additive；應用程式回退唔等於 schema 回退。SQLite／SQL Server catch-up migration 會補舊歷史缺口；唔好用 production `db push` 或手改已套用 migration 避開錯誤。

實作：[session](../src/app/lib/session.ts)、[MFA actions](../src/app/actions/admin-mfa.ts)、[kiosk actions](../src/app/actions/kiosk.ts)、[deployment scripts](../package.json)。

## Housekeeping：獨立開關、有限批次

`HOUSEKEEPING_ENABLED=true` 先啟用；同 `NOTIFICATIONS_ENABLED`、`CALENDAR_SYNC_ENABLED` 無依賴。預設停用時，已認證 route 直接回 `{ "enabled": false }`，唔開 DB connection。[Vercel cron](../vercel.json) 每日 **03:15 UTC** 呼叫 `GET /api/cron/housekeeping`，用 `Authorization: Bearer <CRON_SECRET>`；唔好喺公開 URL／工單傳 secret。

下列日數係目前程式常數，**唔係可調 env**。改 retention 要先確認用途、資料保留要求及備份政策，再修改程式、tests 同本文件。

| 階段 | 符合條件 | 行為／每次上限 |
| --- | --- | --- |
| 回收 delivery claim | `PROCESSING` 且 `lockedAt` 超過 5 分鐘；null lock 則睇 `updatedAt` | 最多 250 rows 回到 `PENDING`；保留 event key、payload、attempts、首次嘗試時間，交由 delivery worker 再驗證可否發送 |
| 清除未發訊息個人資料 | `FAILED`／`PENDING`／`SKIPPED`、`createdAt` 超過 30 日、payload 唔係 `{}` | 最多 250 rows 清空 payload 並設 `SKIPPED`；已清空 rows 唔重寫，仍有效 processing lease 唔清 |
| 刪除 terminal delivery metadata | `SENT`／`FAILED`／`SKIPPED`、payload 已清空、`createdAt` 超過 365 日 | 最多 250 rows 刪除；365 日由建立時間計，唔係 `sentAt` |
| 清理外來 busy 歷史 | `ExternalBusyBlock.end` 超過 30 日 | 最多 250 rows 刪除 |
| 清理退休 kiosk grant | 到期或撤銷時間超過 30 日 | 最多 250 rows 刪除；保留仍有效 grant |

每個階段先選最多 250 IDs，再喺 mutation 重驗資格；job 有 2 分鐘 lease，route 最長 60 秒。**超過日數只代表開始符合清理條件，唔保證當日清完 backlog。** 每日一次時，每階段最多處理 250 rows／日。

當值檢查 Admin → Operations 嘅 `housekeeping` 成功／失敗時間同 error。批次數字要睇已認證 route response，或由受權唯讀 DB 工具查該 `BackgroundJobState.lastResultJson`；目前 UI 冇顯示佢。結果包括 `recovered`、`scrubbed`、`deletedNotifications`、`deletedBusyBlocks`、`deletedKiosks`；`busy: true` 代表有 job 持鎖，唔等於今次已清理。連續見到 250、超過約 26 小時無成功、或有 503，應查同一 eligibility 條件嘅**剩餘數量**及最舊時間。呢個監察門檻係操作建議，程式未自動設告警。

大量 backlog 可由受權維運工具用 secret 認證逐次重跑，等上次完成再下一次；唔好改成無限迴圈或一次掃清全表。401 先查 bearer secret；500 查 `CRON_SECRET`；503 查 DB 及 job 記錄。保留人工重跑證據，但唔讀出 payload。`AuditEvent`、預約、客戶帳戶及備份**唔由呢個 worker 自動刪除**，要另訂保存／刪除政策。

實作：[housekeeping service](../src/app/services/housekeeping-service.ts)、[route](../src/app/api/cron/housekeeping/route.ts)。

## Calendar／通知日常檢查

`CALENDAR_SYNC_ENABLED=true` 開共用 Fresha／Treatwell ICS job，每 30 分鐘 tick（2026-09-22 起，為咗 Neon 免費額度由 15 分鐘改做 30 分鐘）；只喺已儲存嘅啟用髮型師營業時間前後各 15 分鐘內匯入（Europe/London，自動處理夏令時間）；唔好另外新增 legacy Treatwell cron。檢查每個 connection 最後成功時間同 error；解析失敗會保留上次 busy times，唔好手動清空佢哋解決紅燈。UTC／TZID／全日 recurrence 同精確 EXDATE 有 regression tests；仍拒絕 floating times、`RDATE`、`EXRULE`、`RECURRENCE-ID` 等未支援格式。失敗 feed 要修正來源或用相容 feed 再測。

每次最多 20 connections；每份 feed 最多 2 MiB，未來窗口 90 日，最多 2,000 events／輸出 intervals、每個 recurring event 最多 400 occurrences。Validated busy window 喺同一 transaction 以每批 100 rows 替換；失敗會 rollback。現時 `pruned` 係窗口內被替換而刪除嘅實體 rows 數，唔等於取消預約數。輪詢有延遲，唔提供跨平台即時鎖位；確認 PENDING 預約前仍要核對平台狀態。未啟用嘅 [Treatwell API worker](../src/app/services/treatwell-api-worker.ts) 會直接拒絕執行，未有已驗證正式 adapter／冪等協議，唔可以當成 API 雙向同步功能。

`NOTIFICATIONS_ENABLED=true` 同時啟用通知及 reminder delivery。Operations 檢查 failed／processing backlog；delivery worker 有 5 分鐘 lease、23 小時重試窗口及最多 12 次嘗試，唔好透過重設 event key／firstAttemptAt 強行重發。要人工補發時先核對 provider delivery evidence，避免重複發信。

## MFA key rotation 同失去 authenticator

以下係**離線維運工具**，要使用明確授權嘅 PostgreSQL 目標。`SALON_AUTH_MAINTENANCE=confirmed` 只係程式 guard，**唔會自動停止流量**。操作者要喺部署／流量層安排維護，保存 incident／change ticket，並用 secret manager 注入 env，唔好將 key 寫成 CLI argument 或 shell history。

**輪換 `SESSION_SECRET`：**

1. 停止所有部署嘅 auth／MFA 變更流量，建立可復原加密備份，保持現有部署 key 未改。
2. 注入 `SALON_AUTH_MAINTENANCE=confirmed`、`SALON_AUTH_MAINTENANCE_DATABASE_URL`、`SALON_MFA_OLD_SESSION_SECRET`、`SALON_MFA_NEW_SESSION_SECRET`。新舊 key 必須不同且各至少 32 字元。
3. 執行 `node --conditions=react-server --import tsx prisma/rotate-mfa-key.ts`。工具每批讀 100 rows，以條件更新／transaction 重加密 active 及 pending seed、增加 session version、寫入 `AUTH.MFA_KEY_ROTATED`。
4. 成功先將所有部署嘅 `SESSION_SECRET` 換成新值並重新發布；核對 audit 同管理員登入後恢復流量。簽名 key 更換會令現有各類 cookie 失效，kiosk 亦要重新啟用。
5. 中斷／部分完成時保持 auth 離線，用**同一對新舊 key** 重跑。唔好單獨將 app key 改返舊值；復原必須配對 DB 狀態同 key。

**失去 authenticator 及 recovery codes：** 先喺 app 以外核實帳戶本人、記錄 incident 授權，再由有 DB 維運權限嘅人執行 [reset-admin-mfa.ts](../prisma/reset-admin-mfa.ts)。除兩個 maintenance env 外，注入 `SALON_MFA_RESET_USER_ID`、`SALON_MFA_RESET_OPERATOR_ID`（DB 內 ADMIN）、`SALON_MFA_RESET_TICKET`；三者只接受 1–128 個英數／`_`／`-` 字元。

```sh
node --conditions=react-server --import tsx prisma/reset-admin-mfa.ts
```

工具清除因素、撤銷現有 session version，同一 transaction 寫 `AUTH.MFA_RESET`；唔改密碼、唔直接登入。本人重新完成第一因素登入及 authenticator 登記，保存新 recovery codes，核對 audit／ticket。普通 password reset 保留 MFA，亦唔會直接建立 session。

實作：[rotation CLI](../prisma/rotate-mfa-key.ts)、[maintenance guards／transactions](../src/app/lib/mfa-maintenance.ts)。

## 建立第一個管理員／離線修復管理員登入

[create-admin.ts](../prisma/create-admin.ts) 只供有明確授權嘅 infrastructure 維運使用。工具唔再接受 name／email／password 命令列參數，亦唔沿用隱含嘅 DB target。先記錄授權 change ticket，再用 secret manager 注入以下 env；唔好將 password 寫成 shell command、共享 log 或工單內容。

- `SALON_AUTH_MAINTENANCE=confirmed` 同 `SALON_AUTH_MAINTENANCE_DATABASE_URL`：明確 PostgreSQL 目標；呢個 guard 唔會自動停流量。
- `SALON_MAINTENANCE_OPERATOR_ID`：可追溯到 change ticket 嘅 infrastructure 操作者識別碼，1–128 個英數／`_`／`-`。建立第一個管理員時無現有 app user，因此呢度**唔要求識別碼係 DB 內帳戶**；工具依賴已授權嘅 DB 維運權限，識別碼只用於記錄操作者，唔係驗證登入憑證。
- `SALON_BOOTSTRAP_ADMIN_NAME`、`SALON_BOOTSTRAP_ADMIN_EMAIL`、`SALON_BOOTSTRAP_ADMIN_PASSWORD`：目標帳戶。Email 會 trim／轉小寫；password 至少 8 字元，UTF-8 最多 72 bytes，避免 bcrypt 靜默截斷。
- `SALON_BOOTSTRAP_TICKET`：已批准 change／incident reference，1–128 個英數／`_`／`-`。

```sh
node --conditions=react-server --import tsx prisma/create-admin.ts
```

全新 email 會建立 ADMIN，第一次登入必須登記 MFA。已有 email 會更新姓名、密碼同 ADMIN role，增加 `sessionVersion` 撤銷舊 session；**現有 MFA seed／recovery codes 保留**。帳戶變更同 `ADMIN.BOOTSTRAPPED` 審計事件同一 transaction 寫入；事件包含 operator／target／ticket，唔包含密碼或電郵。執行後核對事件、用受控登入驗證 MFA，再清除臨時注入嘅 bootstrap env。呢個工具唔代替 lost-authenticator break-glass 程序。

## 隔離驗證同 migration 支援範圍

用 Node **24**、pnpm **10.33.0**；以 lockfile 安裝。以下 PostgreSQL 指令只用**全新、空白、即棄 localhost PostgreSQL 17 `salon_test`**，先喺專用 container／instance 建好測試帳戶及 DB。例子密碼只供本機測試，唔好用 production URL 或複製 production 個人資料。

```sh
export SALON_TEST_DATABASE_URL='postgresql://salon_test:disposable-ci-password@127.0.0.1:5432/salon_test'
export POSTGRES_URL="$SALON_TEST_DATABASE_URL"
export POSTGRES_URL_NON_POOLING="$SALON_TEST_DATABASE_URL"
export SESSION_SECRET='local-test-only-secret-not-for-production-20260916'
export NOTIFICATIONS_ENABLED=false CALENDAR_SYNC_ENABLED=false HOUSEKEEPING_ENABLED=false TZ=UTC
pnpm install --frozen-lockfile
pnpm db:vercel:deploy
pnpm exec prisma migrate diff --from-url "$POSTGRES_URL" --to-schema-datamodel prisma/vercel/schema.prisma --exit-code
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm test:backend-http
pnpm exec tsc --noEmit
pnpm audit --audit-level=high
```

Integration／HTTP scripts 會建立及清理 synthetic fixtures，並拒絕非 localhost／非 `salon_test` 或已有 user 嘅 DB。失敗後先檢查殘留，再重建**即棄** DB 重跑；唔好靠刪 guard 強行跑。

SQLite 重播全部八個 migrations，唔改預設 PostgreSQL generated client：

```sh
sqlite_target=$(mktemp)
DATABASE_URL="file:$sqlite_target" pnpm exec prisma migrate deploy --schema prisma/dev/schema.prisma
DATABASE_URL="file:$sqlite_target" pnpm exec prisma migrate diff --from-url "file:$sqlite_target" --to-schema-datamodel prisma/dev/schema.prisma --exit-code
rm "$sqlite_target"
```

SQLite 已有空庫 replay／零 diff 及舊資料 fixture 保留驗證。新 migration 如發現重複 `Availability(stylistId, dayOfWeek)` 會原子失敗，先按真實營業時間處理重複，唔會自動選一筆刪另一筆。

**SQL Server 仍需 staging 驗證。** [catch-up migration](../prisma/prod/migrations/20260916230000_backend_security_readiness/migration.sql) 由五個已提交舊 migrations 重建 prior model 產生，未喺 SQL Server 實跑。喺隔離還原庫驗證 migration、舊 rows／FK、唯一性及 app smoke tests，先考慮 legacy rollout。`Stylist.slug`、`Stylist.icalToken`、`Employee.stylistId` 用 filtered unique indexes 容許多筆 NULL；Prisma 6 schema 無法完整表達 filter，日後 diff 要人工保留，唔好為追求零 diff 改返普通 unique index。唔可以將 PostgreSQL／SQLite 成功當成 SQL Server 已驗收。

## Destructive seed 只供本機即棄資料

[seed guard](../prisma/seed-safety.ts) 要求 `SALON_ALLOW_DESTRUCTIVE_SEED=true`，並拒絕 production、Vercel、remote DB。PostgreSQL 只接受 localhost／loopback 且名為 `salon_test`；SQLite 只接受 repo `prisma/dev` 或允許嘅 private temp 目錄內指定 dev／test `.db` 名稱，並檢查 symlink。Client 使用驗證後嘅 URL，唔會靜默沿用另一個 target。

只喺上面同一個 disposable PostgreSQL 環境執行：

```sh
POSTGRES_URL="$SALON_TEST_DATABASE_URL" SALON_ALLOW_DESTRUCTIVE_SEED=true pnpm exec prisma db seed --schema prisma/vercel/schema.prisma
```

呢個 seed 會刪除原有業務 rows，再建立示範資料／本機帳戶；唔係 production reference-data migration，亦唔好將生成嘅登入資料貼入共享 logs。SQLite seed 前要生成對應 client，之後執行 `pnpm db:vercel:generate` 還原 PostgreSQL client，再跑 PostgreSQL checks。

## CI 同外部安全證據

[CI workflow](../.github/workflows/deploy.yml) 已定義 frozen-lockfile 安裝、lint、unit tests、high-severity dependency audit、PostgreSQL／SQLite migration replay＋diff、真 PostgreSQL concurrency／rollback、production build、HTTP authorization／pagination tests 及 typecheck；deployment jobs 依賴 CI 成功。呢個係 repository 設定；要喺 GitHub 保留實際 run 結果，另確認 branch protection／required checks 生效。SQL Server runtime、完整 vendor 電郵／calendar 驗收及 backup restore 唔包含喺 CI。

以下需要負責人喺外部系統落實同留證，今次程式碼**無替你啟用或驗證**：

| 範圍 | 操作及證據 |
| --- | --- |
| Cloud／人員存取 | Vercel、Neon、GitHub、Resend、Upstash、secret manager 強制 MFA；記錄 owner、最少權限、入離職撤權及定期 access review。App TOTP 唔覆蓋 cloud 帳戶。 |
| DB 權限及傳输 | 實際核對 runtime 同 migration role 分離、runtime 無不必要 DDL／管理權限、TLS 憑證驗證及網絡限制；按 staging app 行為測試權限，唔好盲套 REVOKE SQL。核對 pool／connection budget，程式每 instance 預設 `connection_limit=5` 唔代表總連線有上限。 |
| 備份及復原 | 確認真正啟用嘅 backup／PITR window、加密、地域、保留及存取權；訂 RPO／RTO，實際還原至隔離環境，驗證資料完整、MFA key 配對、預約及登入，量度完成時間，保存結果。只見到 backup 設定唔等於 restore 測試完成。 |
| 審計及 incident | `AuditEvent` 由應用程式追加，已接入審計嘅敏感寫入與 event 同 transaction；無一般 edit/delete UI，但 DB 高權限帳戶仍可改。配置另一路受控、具防篡改保存能力嘅 log destination／告警並驗證 ingest；目前冇實作自動外送。記錄 incident 聯絡人、處理時間線、憑證撤銷／rotation 同復原演練。 |
| Change／dependency | Required reviews、CI gate、release／migration owner、staging 證據及 rollback 演練；持續處理 dependency audit，安排 secret scanning。今次無確認 GitHub secret scanning 或 organisation policy 已開。 |
| 資料用途及 vendor | 分清 notification payload、delivery metadata、audit、預約／員工資料及備份保留政策；審查 vendor 存取、資料位置、合約及刪除流程，指定各項 owner。Housekeeping 唔係全系統資料生命周期方案。 |

有 SOC 2 商業需求時，先確定 audit scope、control owner、證據保存期及運作期間，再由合資格獨立查核人評估。Code review／tests／dependency audit 零已知漏洞，都唔能代替呢啲營運證據。
