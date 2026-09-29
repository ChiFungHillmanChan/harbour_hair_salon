# 預約「暫時保留時段」＋即時同步 — 設計

**狀態：** 設計，未實施。第一期實施計劃：[`../plans/2026-09-29-booking-slot-hold-and-live-sync.md`](../plans/2026-09-29-booking-slot-hold-and-live-sync.md)
**日期：** 2026-09-29
**前提：** 正式網站嘅網上預約而家被 `SQUARE_DEPOSITS_WIRED = false` 鎖住（`src/app/lib/online-booking-lock.ts`）。本設計全部喺鎖住期間開發同測試，同 Square 訂金一齊上線。

---

## 1. 目標

1. **暫時保留時段（slot hold）**：客人揀好時間、入到「確認／付款」嗰步，網站替佢保留嗰個時段 **10 分鐘**，其他人見到係「不可預約」。完成預約就轉做正式 PENDING 預約；放棄或者過時就自動釋放。
2. **即時檢查 Fresha**：保留時段嗰刻，即時拉一次該髮型師嘅 Fresha feed 再檢查撞期，唔使等 15–30 分鐘嘅 cron。
3. **（第三期，可選）Google Calendar 即時雙向同步**。

### 唔做（同原因）

- **即時推送預約去 Fresha**：做唔到。Fresha 冇 API，只會自己大約每 15 分鐘嚟拉我哋嘅 iCal（2026-09-29 實測）。我哋已經一有預約就即刻更新 feed（`invalidateStylistIcalFeed`），Fresha 下一次嚟就會見到。
- **改變 PENDING → 職員批核嘅流程**：保留時段係喺 PENDING 之前多一步，唔取代批核。
- **決定訂金金額／政策**：屬 Square 期數，見 `docs/square-payments-setup.md`。

## 2. 已核實嘅事實同限制

| 事實 | 來源 |
|---|---|
| Fresha 冇 API；兩個方向都只係 iCal；Fresha 大約每 15 分鐘拉一次我哋嘅 feed | memory `marketplace-ical-capabilities`、2026-09-29 實測 |
| Fresha 嘅 export feed（`calendar-export.fresha.com/<uuid>.ics`）公開、隨時可以拉 | 同上 |
| Treatwell 只可以匯入，冇 export | 同上 |
| `syncCalendarFeeds({ connectionId })` 已經支援只同步一條 connection，有 lease 同安全對帳 | `src/app/services/calendar-sync-service.ts:30` |
| 預約寫入一律喺 Serializable transaction 入面檢查撞期 | `booking-service.ts` `createBooking` / `assertAppointmentSlotAvailable` |
| Neon 按 compute 時間收費；唔可以加新輪詢 cron；成本開關要喺第一個 DB query 之前 | `CLAUDE.md`「Neon compute budget」 |
| Square 指引要求：「Reserve or validate the slot using the existing concurrency controls」，Square call 唔可以放入 retrying Serializable transaction | `docs/square-payments-setup.md`「Server-owned quotes and durable attempts」 |
| 網上預約要已登入、已確認 email | `lib/email-verification.ts`（PR #50） |

## 3. 設計

### 3.1 資料模型：新 `SlotHold` 表

```prisma
model SlotHold {
  id          String    @id @default(cuid())
  userId      String
  stylistId   String
  serviceId   String
  startsAt    DateTime
  durationMin Int
  expiresAt   DateTime
  consumedAt  DateTime? // 轉咗做預約
  releasedAt  DateTime? // 客人返回／揀第二個時間
  createdAt   DateTime  @default(now())
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  stylist Stylist @relation(fields: [stylistId], references: [id], onDelete: Cascade)
  @@index([stylistId, startsAt])
  @@index([userId, expiresAt])
}
```

**點解獨立一張表，唔係 `Appointment` 加一個 `HOLD` 狀態：** 好多地方將「非 CANCELLED 嘅 appointment」當真預約：後台排程、iCal feed、通知、報表、payroll。保留時段放入 `Appointment` 就要逐個地方排除，漏一個就會出錯，例如將 10 分鐘嘅保留 export 去 Fresha。獨立一張表之後，只有「撞期檢查」需要知道佢存在。

**「有效」嘅定義（全系統唯一）：** `consumedAt IS NULL AND releasedAt IS NULL AND expiresAt > now`。

### 3.2 流程

```
客人揀時間 ──撳「繼續」──► holdSlot()
   │                         ├─ 登入＋email 已確認＋限流（每人每小時 12 次）
   │                         ├─ 同 submitBooking 一樣嘅檢查（服務可預約、營業時間、patch test、consultation）
   │                         ├─ refreshStylistFeedsNow()：即時拉該髮型師 Fresha feed（最多每 60 秒一次，4 秒 timeout）
   │                         └─ Serializable tx：
   │                              assertOnlineBookingReady
   │                              釋放呢個客人其他有效保留
   │                              （Anyone）揀第一個有空嘅髮型師
   │                              檢查撞期：預約＋外部 busy＋其他人嘅有效保留
   │                              建立 SlotHold（expiresAt = now + 10 分鐘）
   ▼
確認頁（倒數 10:00）── 撳「返回」──► releaseHeldSlot()：寫 releasedAt
   │
   └─ 撳「確認預約」──► submitBooking({ ..., holdId })
                          └─ createBooking 嘅 Serializable tx：
                               檢查 hold：屬於呢個客人、時間／髮型師／服務一致、未用、未釋放
                               撞期檢查（排除自己嘅保留）
                               建立 PENDING appointment，hold.consumedAt = now
```

**過期但未用嘅保留仍然可以提交**：保留只係「禮讓」，真正嘅保證永遠係寫入時嘅撞期檢查。過咗 10 分鐘，時段仍然空就照樣成功；已經被人預約就返回「時段已被預約」。將來有 Square，信用卡驗證可能超過 10 分鐘，呢個設計就唔會因為計時而將一個仍然可行嘅預約（連同已授權嘅款）拒絕。

**「Anyone／第一位有空」**：喺 `holdSlot` 嗰刻已經揀定髮型師並寫入 hold，之後提交就用嗰位髮型師，唔會喺確認頁同提交之間換人。

### 3.3 邊度要計埋保留時段

| 位置 | 做法 |
|---|---|
| `getAvailableSlots`、`getAvailableSlotsUnion`、`getBookingDays`（顯示） | 所有人嘅有效保留都當 busy（公開頁面唔知道係邊個睇緊；客人返回前會先釋放自己嘅保留） |
| `assertAppointmentSlotAvailable`（寫入） | 新增 `options.holdOwnerId`：其他人嘅有效保留當撞期，自己嘅唔計 |
| `createBookingForFirstAvailable` | 預先載入嘅 busy 加埋其他人嘅保留 |
| 客人改期 `rescheduleAppointment` | 其他人嘅保留當撞期 |
| 職員排程（`describeAdminMoveClashes`） | 新增警告類型 `HELD`：職員可以照樣覆蓋（例如電話入嚟嘅客人），但會見到「網上有客人保留緊」 |
| iCal feed（畀 Fresha） | **唔包括**保留。10 分鐘嘅保留未等 Fresha 嚟拉已經過期，放入去只會變幽靈佔位 |

### 3.4 即時檢查 Fresha（`refreshStylistFeedsNow`）

- `CALENDAR_SYNC_ENABLED !== 'true'` 就即刻返回，唔讀 DB（成本開關喺第一個 query 之前）。
- 只同步 `lastSuccessAt` 超過 60 秒嘅 inbound connection，令同一個髮型師唔會喺一分鐘內被人拉幾次。
- 重用 `syncCalendarFeeds`：新增 `stylistIds` 篩選，配合 `staleBefore = now − 60 秒`。有 lease 同安全對帳，失敗唔會刪走舊 block。
- 整體 4 秒 timeout；失敗或者 timeout 就用最後一次同步嘅資料繼續。原本嘅 freshness gate（`assertOnlineBookingReady`）照樣生效。
- **職員批核**：`updateAppointmentStatus` 而家已經喺 CONFIRMED 之前行 `refreshStaleCalendarFeeds()`（`admin.ts:466`），但只刷新超過 30 分鐘嘅 feed。改為額外對該預約嘅髮型師做 60 秒級嘅即時刷新，將「網站預約之後 Fresha 賣咗同一個時段」嘅風險盡量收窄。

### 3.5 剩低嘅風險（同 Fresha 之間）

客人喺網站預約之後，大約 15 分鐘內 Fresha 仍然唔知道，期間 Fresha 可能賣出同一時段。處理方法：

1. 網上預約係 PENDING，要職員批核；批核前即時刷新 Fresha 再檢查。
2. 第二期 Square 用「先預授權、批核先扣款」：撞期就取消授權，唔會扣客人錢。

### 3.6 防濫用同私隱

- 只有已登入、已確認 email 嘅客人先可以保留。
- 每個客人同一時間只有 **1 個**有效保留，新嘅會釋放舊嘅；限流每人每小時 12 次。
- 保留最長 10 分鐘，惡意帳戶最多只可以鎖住一個時段 10 分鐘，然後就要花限流額度。
- 公開頁面只會見到「不可預約」，唔會見到任何客人資料。

### 3.7 Neon 成本

- 每次去確認頁：1 次即時刷新（最多每 60 秒一次）加 1 個 Serializable transaction，大約 6 個 query。**唔係每次睇日曆都做。**
- 每次查可預約時間：多 1 個細 query（`SlotHold` 表好細，同其他 query 並行）。
- 過期**唔使 cron**：查詢時用 `expiresAt > now` 就當過期。每日 housekeeping 清走一日前嘅舊記錄。
- 冇新 cron，冇輪詢。

### 3.8 介面（英文＋繁體中文）

- DATE 步驟撳「繼續」：顯示「正在為你保留時間…」，成功就入確認頁。
- 確認頁：「我們為你保留此時段 9:58」倒數。
- 倒數完：提示「保留已過期，我們會喺你確認時再檢查此時段是否仍然有空」，**唔會**鎖住按鈕。
- 撳「返回」會釋放保留。

## 4. 分期

| 期 | 內容 | 前提 |
|---|---|---|
| **1** | 保留時段＋即時檢查 Fresha＋批核前刷新（本文件嘅實施計劃） | 無；網上預約仍然鎖住，喺 preview／本機測試 |
| **2** | Square 預授權：付款嘗試記錄連住 `SlotHold`；授權喺 transaction 外面做；提交時轉做 PENDING；批核先扣款；撞期就取消 | 跟 `docs/square-payments-setup.md` 嘅要求；決定訂金政策 |
| **3（可選）** | Google Calendar：用 service account 寫入（`extendedProperties.private.harbourAppointmentId` 防止同步一圈返嚟），用 `events.watch` 接收改動（webhook，唔輪詢），每日 housekeeping 續期 watch channel | 確認髮廊真係用 Google Calendar 做主日曆；先用一位髮型師測試「網站 → Google → Fresha」嘅延遲同有冇回流 |

第二、三期各自需要獨立嘅實施計劃。

## 5. 要店主決定

1. 保留時間：預設 **10 分鐘**，要夠時間做信用卡 3D Secure 驗證。
2. 第三期要唔要做：取決於髮廊主日曆係咪 Google Calendar（2026-09-29 記錄：店主想只用一個主帳戶）。
3. 上線前要先處理嘅已知問題：Lox 喺 Fresha 冇匯入連結，而且佢嘅 blocked time 唔會 export（Fresha 那邊嘅問題）；Treatwell `receivesBookings` 設定。
