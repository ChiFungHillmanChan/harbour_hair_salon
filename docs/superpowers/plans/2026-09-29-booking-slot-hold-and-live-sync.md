# 預約暫時保留時段＋即時 Fresha 檢查（第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客人入到確認頁時，網站替佢保留所揀時段 10 分鐘；保留之前即時拉一次該髮型師嘅 Fresha feed；保留、撞期檢查、職員警告同 housekeeping 全部一致。

**Architecture:** 新增獨立 `SlotHold` 表。「有效保留」嘅定義只有一個，放喺純函數 `slot-hold-policy.ts`。所有撞期讀取（顯示同寫入）都用 `loadHeldBusy` 將保留砌成同 `ExternalBusyBlock` 一樣形狀嘅 busy row，重用現有撞期原語。保留喺 Serializable transaction 入面建立；提交時消耗；過期唔使 cron。即時 Fresha 檢查重用 `syncCalendarFeeds`，加 `stylistIds` 篩選。

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Prisma 6（Neon Postgres 18／SQLite dev／SQL Server legacy）· `node:test` via tsx

**Spec:** [`../specs/2026-09-29-booking-slot-hold-and-live-sync-design.md`](../specs/2026-09-29-booking-slot-hold-and-live-sync-design.md)

## Global Constraints

- **三個 Prisma schema 一齊改**：`prisma/dev`、`prisma/vercel`、`prisma/prod`，每個都要有自己嘅 migration；改完行 `pnpm db:vercel:generate`（app 嘅 client 由 vercel schema 生成）。
- **CI 會重播 migration 同檢查 drift**（PostgreSQL 18 同 SQLite），所以 migration SQL 必須同 schema 完全一致。
- **唔可以加新 cron**；成本開關（`CALENDAR_SYNC_ENABLED`）要喺第一個 DB query 之前；過期用查詢時 `expiresAt > now` 判斷。
- **唔可以喺 module level 讀 env var**。
- **Server action 檔（`'use server'`）只可以 export async function**；`use-server-exports.test.ts` 會檢查。
- **Rate limiting 一律用 `src/app/lib/rate-limit.ts`**，唔可以 `if (limiter)` null-skip。
- **所有新文案要有 `en` 同 `zh`（繁體、香港用字）**；zh dictionary 用 `Localized<…>` type，漏 key `tsc` 會報錯。
- **保留時間 `SLOT_HOLD_TTL_MINUTES = 10`**；每人同一時間最多 1 個有效保留；限流每人每小時 12 次。
- **有效保留定義**：`consumedAt === null && releasedAt === null && expiresAt > now`，只可以用 `isHoldActive`／`loadHeldBusy` 表達，唔好喺其他地方重寫。
- **過期但未用嘅保留仍然可以提交**：寫入時嘅撞期檢查決定成敗（spec §3.2）。
- **保留唔可以出現喺 iCal feed**（`stylist-ical-feed.ts` 唔好改）。
- **品牌係黑白灰**，Tailwind only。
- **Test runner：** `pnpm test`；單檔：`node --conditions=react-server --import tsx --test <file>`。測試用手寫 fake object 同 `loadServerModule`（`src/test/load-server-module.ts`），唔用 mocking library。
- **網上預約喺正式網站仍然被鎖**（`SQUARE_DEPOSITS_WIRED = false`），全部喺本機或 preview 驗證。

## Review Focus

1. **兩個客人同時保留同一時段** → 只可以有一個成功；另一個得到 `SLOT_UNAVAILABLE`（Task 4 單元測試＋Task 9 真 PostgreSQL 併發檢查）。
2. **保留過期但時段仍然空，客人先撳確認** → 預約成功；過期而且已被人預約 → `SLOT_UNAVAILABLE`，唔係 `HOLD_REQUIRED`（Task 6 測試）。
3. **同一客人開兩個分頁／改揀另一個時間** → 舊保留被釋放，永遠只有 1 個有效保留（Task 3 測試）。
4. **「Anyone」保留咗某位髮型師，之後另一位髮型師變咗有空** → 提交仍然用保留嗰位，唔會換人（Task 6 測試）。
5. **即時 Fresha 拉取失敗、timeout，或者 `CALENDAR_SYNC_ENABLED` 關咗** → 保留照樣進行（用最後一次同步嘅資料）；開關關咗唔讀 DB（Task 5 測試）。

---

### Task 1: `SlotHold` 資料表同 migration

**Files:**
- Modify: `prisma/vercel/schema.prisma`、`prisma/dev/schema.prisma`、`prisma/prod/schema.prisma`
- Create: `prisma/vercel/migrations/20261001120000_slot_hold/migration.sql`
- Create: `prisma/dev/migrations/20261001120000_slot_hold/migration.sql`
- Create: `prisma/prod/migrations/20261001120000_slot_hold/migration.sql`

**Interfaces:**
- Produces: Prisma model `SlotHold`（`tx.slotHold`），欄位 `id, userId, stylistId, serviceId, startsAt, durationMin, expiresAt, consumedAt, releasedAt, createdAt`。

- [ ] **Step 1: 三個 schema 都加入 model 同反向關聯**

喺三個 schema 嘅 `model User` 入面，喺 `passwordResets PasswordResetToken[]` 下面加：

```prisma
  slotHolds      SlotHold[]
```

喺三個 schema 嘅 `model Stylist` 入面，喺 `availabilities Availability[]` 下面加：

```prisma
  slotHolds           SlotHold[]
```

喺三個 schema 嘅檔尾加：

```prisma
/// A customer's short hold on one slot while they confirm (and later pay).
/// Active only while consumedAt and releasedAt are null and expiresAt is in the
/// future — see services/slot-hold-policy.ts. Never exported to iCal feeds.
model SlotHold {
  id          String    @id @default(cuid())
  userId      String
  stylistId   String
  serviceId   String
  startsAt    DateTime
  durationMin Int
  expiresAt   DateTime
  consumedAt  DateTime?
  releasedAt  DateTime?
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  stylist     Stylist   @relation(fields: [stylistId], references: [id], onDelete: Cascade)

  @@index([stylistId, startsAt])
  @@index([userId, expiresAt])
}
```

- [ ] **Step 2: 寫三個 migration**

`prisma/vercel/migrations/20261001120000_slot_hold/migration.sql`：

```sql
-- CreateTable
CREATE TABLE "SlotHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlotHold_stylistId_startsAt_idx" ON "SlotHold"("stylistId", "startsAt");

-- CreateIndex
CREATE INDEX "SlotHold_userId_expiresAt_idx" ON "SlotHold"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

`prisma/dev/migrations/20261001120000_slot_hold/migration.sql`：

```sql
-- CreateTable
CREATE TABLE "SlotHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlotHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlotHold_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SlotHold_stylistId_startsAt_idx" ON "SlotHold"("stylistId", "startsAt");

-- CreateIndex
CREATE INDEX "SlotHold_userId_expiresAt_idx" ON "SlotHold"("userId", "expiresAt");
```

`prisma/prod/migrations/20261001120000_slot_hold/migration.sql`：

```sql
BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[SlotHold] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [stylistId] NVARCHAR(1000) NOT NULL,
    [serviceId] NVARCHAR(1000) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [durationMin] INT NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [consumedAt] DATETIME2,
    [releasedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SlotHold_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SlotHold_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SlotHold_stylistId_startsAt_idx] ON [dbo].[SlotHold]([stylistId], [startsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SlotHold_userId_expiresAt_idx] ON [dbo].[SlotHold]([userId], [expiresAt]);

-- AddForeignKey
ALTER TABLE [dbo].[SlotHold] ADD CONSTRAINT [SlotHold_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SlotHold] ADD CONSTRAINT [SlotHold_stylistId_fkey] FOREIGN KEY ([stylistId]) REFERENCES [dbo].[Stylist]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
```

- [ ] **Step 3: 重播 migration，確認零 drift**

```bash
pnpm db:vercel:generate
# SQLite (dev)
T=$(mktemp -t slothold).db; DATABASE_URL="file:$T" pnpm exec prisma migrate deploy --schema prisma/dev/schema.prisma && DATABASE_URL="file:$T" pnpm exec prisma migrate diff --from-url "file:$T" --to-schema-datamodel prisma/dev/schema.prisma --exit-code; rm -f "$T"
```
Expected：`All migrations have been successfully applied.` 同 `No difference detected.`。PostgreSQL 由 CI 嘅「Replay production migrations」同「Check production migration drift」兩步驗證；本機有 Postgres 就用 memory `local-verification-gotchas` 嘅 scratch cluster 做同一件事。

- [ ] **Step 4: Type check 同 commit**

Run: `pnpm exec tsc --noEmit` → Expected：冇新 error。

```bash
git add prisma
git commit -m "feat(booking): add SlotHold table for short slot holds during checkout"
```

---

### Task 2: 保留規則（純函數）

**Files:**
- Create: `src/app/services/slot-hold-policy.ts`
- Test: `src/app/services/slot-hold-policy.test.ts`

**Interfaces:**
- Produces:
  - `SLOT_HOLD_TTL_MINUTES = 10`、`MAX_HOLD_DURATION_MINUTES = 600`
  - `type SlotHoldRow = { id: string; userId: string; stylistId: string; serviceId: string; startsAt: Date; durationMin: number; expiresAt: Date; consumedAt: Date | null; releasedAt: Date | null }`
  - `holdExpiresAt(now: Date): Date`
  - `isHoldActive(hold: Pick<SlotHoldRow, 'expiresAt' | 'consumedAt' | 'releasedAt'>, now: Date): boolean`
  - `checkHoldForSubmit(hold: SlotHoldRow | null, request: { userId: string; stylistId: string; serviceId: string; startsAt: Date }): { ok: true } | { ok: false; code: 'HOLD_REQUIRED' }`

- [ ] **Step 1: 寫失敗嘅測試**

```ts
// src/app/services/slot-hold-policy.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHoldForSubmit, holdExpiresAt, isHoldActive, SLOT_HOLD_TTL_MINUTES, type SlotHoldRow } from './slot-hold-policy';

const now = new Date('2026-10-05T10:00:00Z');
const hold: SlotHoldRow = {
  id: 'h1', userId: 'u1', stylistId: 's1', serviceId: 'svc', startsAt: new Date('2026-10-06T09:00:00Z'), durationMin: 60,
  expiresAt: holdExpiresAt(now), consumedAt: null, releasedAt: null,
};
const request = { userId: 'u1', stylistId: 's1', serviceId: 'svc', startsAt: new Date('2026-10-06T09:00:00Z') };

test('a hold lasts ten minutes and is active only while unused, unreleased and unexpired', () => {
  assert.equal(SLOT_HOLD_TTL_MINUTES, 10);
  assert.equal(hold.expiresAt.getTime() - now.getTime(), 10 * 60_000);
  assert.equal(isHoldActive(hold, now), true);
  assert.equal(isHoldActive(hold, new Date(hold.expiresAt.getTime())), false, 'expiry instant is already expired');
  assert.equal(isHoldActive({ ...hold, consumedAt: now }, now), false);
  assert.equal(isHoldActive({ ...hold, releasedAt: now }, now), false);
});

test('only the owner can submit against a hold, for exactly the held slot', () => {
  assert.deepEqual(checkHoldForSubmit(hold, request), { ok: true });
  assert.deepEqual(checkHoldForSubmit(null, request), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit(hold, { ...request, userId: 'u2' }), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit(hold, { ...request, stylistId: 's2' }), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit(hold, { ...request, serviceId: 'other' }), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit(hold, { ...request, startsAt: new Date('2026-10-06T09:30:00Z') }), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit({ ...hold, consumedAt: now }, request), { ok: false, code: 'HOLD_REQUIRED' });
  assert.deepEqual(checkHoldForSubmit({ ...hold, releasedAt: now }, request), { ok: false, code: 'HOLD_REQUIRED' });
});

test('an expired but unused hold may still be submitted: the write-time conflict check decides', () => {
  const expired = { ...hold, expiresAt: new Date(now.getTime() - 1) };
  assert.deepEqual(checkHoldForSubmit(expired, request), { ok: true });
});
```

- [ ] **Step 2: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/services/slot-hold-policy.test.ts`
Expected：FAIL，`Cannot find module './slot-hold-policy'`。

- [ ] **Step 3: 實作**

```ts
// src/app/services/slot-hold-policy.ts
/**
 * The single definition of a slot hold's lifecycle (spec §3.1–3.2). Pure: no
 * database, no framework, so every rule here is unit-tested directly.
 */
export const SLOT_HOLD_TTL_MINUTES = 10;
/** Longest bookable service (actions/booking.ts SERVICE_DURATION max). Bounds hold lookups. */
export const MAX_HOLD_DURATION_MINUTES = 600;

export type SlotHoldRow = {
  id: string; userId: string; stylistId: string; serviceId: string;
  startsAt: Date; durationMin: number; expiresAt: Date;
  consumedAt: Date | null; releasedAt: Date | null;
};

export function holdExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SLOT_HOLD_TTL_MINUTES * 60_000);
}

export function isHoldActive(hold: Pick<SlotHoldRow, 'expiresAt' | 'consumedAt' | 'releasedAt'>, now: Date): boolean {
  return hold.consumedAt === null && hold.releasedAt === null && hold.expiresAt.getTime() > now.getTime();
}

/**
 * Whether a booking submit may consume `hold`. Expiry alone is NOT a refusal:
 * a hold is a courtesy, and the conflict check inside the booking transaction
 * is what guarantees nobody else has the slot.
 */
export function checkHoldForSubmit(
  hold: SlotHoldRow | null,
  request: { userId: string; stylistId: string; serviceId: string; startsAt: Date },
): { ok: true } | { ok: false; code: 'HOLD_REQUIRED' } {
  if (!hold || hold.consumedAt !== null || hold.releasedAt !== null) return { ok: false, code: 'HOLD_REQUIRED' };
  const matches = hold.userId === request.userId && hold.stylistId === request.stylistId &&
    hold.serviceId === request.serviceId && hold.startsAt.getTime() === request.startsAt.getTime();
  return matches ? { ok: true } : { ok: false, code: 'HOLD_REQUIRED' };
}
```

- [ ] **Step 4: 行測試，確認通過**

Run: 同 Step 2。Expected：3 pass。

- [ ] **Step 5: Commit**

```bash
git add src/app/services/slot-hold-policy.ts src/app/services/slot-hold-policy.test.ts
git commit -m "feat(booking): pure slot-hold lifecycle rules"
```

---

### Task 3: 保留嘅資料庫讀寫

**Files:**
- Create: `src/app/services/slot-holds.ts`
- Test: `src/app/services/slot-holds.test.ts`
- Modify: `src/i18n/messages/en/errors.ts`、`src/i18n/messages/zh/errors.ts`（新錯誤碼）

**Interfaces:**
- Consumes: Task 2 嘅 `holdExpiresAt`、`MAX_HOLD_DURATION_MINUTES`、`SlotHoldRow`；`ExternalBlockRow`（`services/external-busy.ts`）；`BookingError`（`services/booking-errors.ts`）。
- Produces:
  - `loadHeldBusy(db, stylistIds: string[], window: { start: Date; end: Date }, options: { now: Date; exceptUserId?: string }): Promise<ExternalBlockRow[]>`
  - `releaseActiveHolds(db, userId: string, now: Date): Promise<number>`
  - `releaseHold(db, holdId: string, userId: string, now: Date): Promise<boolean>`
  - `createSlotHold(tx, data: { userId: string; stylistId: string; serviceId: string; startsAt: Date; durationMin: number; now: Date }): Promise<{ id: string; expiresAt: Date }>`
  - `findHold(db, holdId: string): Promise<SlotHoldRow | null>`
  - `consumeHold(tx, holdId: string, now: Date): Promise<void>`（拋 `BookingError('HOLD_REQUIRED')`）
  - 錯誤碼 `HOLD_REQUIRED`、`TOO_MANY_HOLDS`（`errors.booking.*`）

- [ ] **Step 1: 加錯誤文案**

`src/i18n/messages/en/errors.ts` 嘅 `booking` 入面，喺 `TOO_MANY_BOOKINGS` 下面加：

```ts
    HOLD_REQUIRED: 'Please choose your time again — it is no longer held for this booking.',
    TOO_MANY_HOLDS: 'Too many attempts to hold a time. Please try again a little later.',
```

`src/i18n/messages/zh/errors.ts` 同一位置加：

```ts
    HOLD_REQUIRED: '請重新揀選時間，此時段已不再為這個預約保留。',
    TOO_MANY_HOLDS: '保留時段的次數過多，請稍後再試。',
```

- [ ] **Step 2: 寫失敗嘅測試**

```ts
// src/app/services/slot-holds.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import type { SlotHoldRow } from './slot-hold-policy';

type Where = Record<string, unknown>;
function fakeDb(rows: SlotHoldRow[]) {
  const calls: { op: string; where?: Where; data?: Where }[] = [];
  const db = { slotHold: {
    findMany: async ({ where }: { where: Where }) => { calls.push({ op: 'findMany', where }); return rows; },
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
    updateMany: async ({ where, data }: { where: Where; data: Where }) => { calls.push({ op: 'updateMany', where, data }); return { count: rows.length ? 1 : 0 }; },
    create: async ({ data }: { data: Where }) => ({ id: 'new-hold', expiresAt: data.expiresAt }),
  } };
  return { db, calls };
}
const holds = loadServerModule<typeof import('./slot-holds')>('src/app/services/slot-holds.ts', {});
const now = new Date('2026-10-05T10:00:00Z');
const base: SlotHoldRow = { id: 'h1', userId: 'u2', stylistId: 's1', serviceId: 'svc', startsAt: new Date('2026-10-06T09:00:00Z'), durationMin: 90, expiresAt: new Date('2026-10-05T10:05:00Z'), consumedAt: null, releasedAt: null };

test('held time reads like a synced busy block and only counts active holds of other customers', async () => {
  const { db, calls } = fakeDb([base]);
  const window = { start: new Date('2026-10-05T23:00:00Z'), end: new Date('2026-10-06T22:59:59Z') };
  const rows = await holds.loadHeldBusy(db as never, ['s1'], window, { now, exceptUserId: 'u1' });
  assert.deepEqual(rows, [{ stylistId: 's1', start: base.startsAt, end: new Date('2026-10-06T10:30:00Z') }]);
  const where = calls[0].where!;
  assert.deepEqual(where.userId, { not: 'u1' });
  assert.equal(where.consumedAt, null);
  assert.equal(where.releasedAt, null);
  assert.deepEqual(where.expiresAt, { gt: now });
});

test('no stylists means no query', async () => {
  const { db, calls } = fakeDb([base]);
  assert.deepEqual(await holds.loadHeldBusy(db as never, [], { start: now, end: now }, { now }), []);
  assert.equal(calls.length, 0);
});

test('placing a new hold releases every other active hold of the same customer', async () => {
  const { db, calls } = fakeDb([base]);
  await holds.releaseActiveHolds(db as never, 'u2', now);
  assert.deepEqual(calls[0], { op: 'updateMany', where: { userId: 'u2', consumedAt: null, releasedAt: null, expiresAt: { gt: now } }, data: { releasedAt: now } });
});

test('a hold is created for ten minutes and consumed once', async () => {
  const { db } = fakeDb([base]);
  const created = await holds.createSlotHold(db as never, { userId: 'u2', stylistId: 's1', serviceId: 'svc', startsAt: base.startsAt, durationMin: 90, now });
  assert.equal(created.expiresAt.getTime() - now.getTime(), 10 * 60_000);
  await holds.consumeHold(db as never, 'h1', now);
  const { db: empty } = fakeDb([]);
  await assert.rejects(holds.consumeHold(empty as never, 'h1', now), /choose your time again/);
});
```

- [ ] **Step 3: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/services/slot-holds.test.ts` → Expected：FAIL，module 未存在。

- [ ] **Step 4: 實作**

```ts
// src/app/services/slot-holds.ts
import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ExternalBlockRow } from './external-busy';
import { BookingError } from './booking-errors';
import { holdExpiresAt, MAX_HOLD_DURATION_MINUTES, type SlotHoldRow } from './slot-hold-policy';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Active holds overlapping `window`, shaped like synced busy blocks so every
 * existing conflict primitive treats them as taken time. `exceptUserId` leaves
 * out that customer's own hold (the one they are booking against).
 */
export async function loadHeldBusy(
  db: Db,
  stylistIds: string[],
  window: { start: Date; end: Date },
  options: { now: Date; exceptUserId?: string },
): Promise<ExternalBlockRow[]> {
  if (stylistIds.length === 0) return [];
  const rows = await db.slotHold.findMany({
    where: {
      stylistId: { in: stylistIds },
      consumedAt: null,
      releasedAt: null,
      expiresAt: { gt: options.now },
      startsAt: { lte: window.end, gte: new Date(window.start.getTime() - MAX_HOLD_DURATION_MINUTES * 60_000) },
      ...(options.exceptUserId ? { userId: { not: options.exceptUserId } } : {}),
    },
    select: { stylistId: true, startsAt: true, durationMin: true },
  });
  return rows
    .map((row) => ({ stylistId: row.stylistId, start: row.startsAt, end: new Date(row.startsAt.getTime() + row.durationMin * 60_000) }))
    .filter((row) => row.end >= window.start);
}

/** One active hold per customer: a new hold (or tab) replaces the old one. */
export async function releaseActiveHolds(db: Db, userId: string, now: Date): Promise<number> {
  const result = await db.slotHold.updateMany({
    where: { userId, consumedAt: null, releasedAt: null, expiresAt: { gt: now } },
    data: { releasedAt: now },
  });
  return result.count;
}

/** The customer went back or chose another time. Only their own, unused hold. */
export async function releaseHold(db: Db, holdId: string, userId: string, now: Date): Promise<boolean> {
  const result = await db.slotHold.updateMany({
    where: { id: holdId, userId, consumedAt: null, releasedAt: null },
    data: { releasedAt: now },
  });
  return result.count === 1;
}

export async function createSlotHold(
  tx: Prisma.TransactionClient,
  data: { userId: string; stylistId: string; serviceId: string; startsAt: Date; durationMin: number; now: Date },
): Promise<{ id: string; expiresAt: Date }> {
  return tx.slotHold.create({
    data: {
      userId: data.userId, stylistId: data.stylistId, serviceId: data.serviceId,
      startsAt: data.startsAt, durationMin: data.durationMin, expiresAt: holdExpiresAt(data.now),
    },
    select: { id: true, expiresAt: true },
  });
}

export async function findHold(db: Db, holdId: string): Promise<SlotHoldRow | null> {
  return db.slotHold.findUnique({
    where: { id: holdId },
    select: { id: true, userId: true, stylistId: true, serviceId: true, startsAt: true, durationMin: true, expiresAt: true, consumedAt: true, releasedAt: true },
  });
}

/** Marks the hold used inside the booking transaction; a lost race rolls the booking back. */
export async function consumeHold(tx: Prisma.TransactionClient, holdId: string, now: Date): Promise<void> {
  const result = await tx.slotHold.updateMany({
    where: { id: holdId, consumedAt: null, releasedAt: null },
    data: { consumedAt: now },
  });
  if (result.count !== 1) throw new BookingError('HOLD_REQUIRED');
}
```

- [ ] **Step 5: 行測試，確認通過；type check**

Run: Step 3 嘅指令 → 4 pass；`pnpm exec tsc --noEmit` → 冇新 error。

- [ ] **Step 6: Commit**

```bash
git add src/app/services/slot-holds.ts src/app/services/slot-holds.test.ts src/i18n/messages/en/errors.ts src/i18n/messages/zh/errors.ts
git commit -m "feat(booking): slot hold persistence helpers"
```

---

### Task 4: 所有撞期讀取都計埋保留；建立保留

**Files:**
- Modify: `src/app/services/booking-service.ts`
- Modify: `src/app/actions/booking.ts`（`rescheduleAppointment` 傳 `holdOwnerId`）
- Test: `src/app/services/booking-slot-hold.test.ts`

**Interfaces:**
- Consumes: Task 3 嘅 `loadHeldBusy`、`releaseActiveHolds`、`createSlotHold`。
- Produces:
  - `assertAppointmentSlotAvailable(tx, appointment, date, loadedBlocking?, options?: { holdOwnerId?: string })`（第 5 個參數係新嘅）
  - `loadBusyByStylist(tx, stylistIds: string[], window: { start: Date; end: Date }, holds: { now: Date; exceptUserId?: string }): Promise<Map<string, BookedInterval[]>>`
  - `placeSlotHold(data: { userId: string; serviceId: string; date: Date; stylistId?: string; candidateStylistIds?: string[] }): Promise<{ id: string; stylistId: string; expiresAt: Date }>`

- [ ] **Step 1: 寫失敗嘅測試**

```ts
// src/app/services/booking-slot-hold.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// Inside the ~90-day booking horizon; 10:00Z is 10:00 or 11:00 in London, within 09:00–18:00.
const slot = new Date(Date.now() + 3 * 86_400_000);
slot.setUTCHours(10, 0, 0, 0);
type Hold = { id: string; userId: string; stylistId: string; startsAt: Date; durationMin: number; expiresAt: Date; consumedAt: Date | null; releasedAt: Date | null };

function fixture(options: { holds?: Hold[] } = {}) {
  const holds: Hold[] = options.holds ?? [];
  const created: Hold[] = [];
  const tx = {
    siteSettings: { findUnique: async () => ({ bookingEnabled: true, phone: '0' }) },
    appointment: { count: async () => 0, findMany: async () => [] },
    availability: {
      findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }),
      findMany: async () => [{ stylistId: 'amy', dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }, { stylistId: 'ben', dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }],
    },
    service: { findUnique: async () => ({ duration: 60 }) },
    externalBusyBlock: { findMany: async () => [] },
    slotHold: {
      findMany: async ({ where }: { where: { stylistId: { in: string[] }; userId?: { not: string } } }) => holds
        .filter((hold) => where.stylistId.in.includes(hold.stylistId) && (!where.userId || hold.userId !== where.userId.not))
        .filter((hold) => hold.consumedAt === null && hold.releasedAt === null && hold.expiresAt > new Date()),
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Hold }) => { const hold = { ...data, id: `hold-${created.length + 1}`, consumedAt: null, releasedAt: null }; created.push(hold); return { id: hold.id, expiresAt: hold.expiresAt }; },
    },
  };
  const db = { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0' }) },
    './notification-outbox-service': {},
    './offers-service': {},
  });
  return { service, created };
}
const later = new Date('2099-12-31T00:00:00Z');
const otherCustomersHold: Hold = { id: 'h-other', userId: 'someone-else', stylistId: 'amy', startsAt: slot, durationMin: 60, expiresAt: later, consumedAt: null, releasedAt: null };

test('a named stylist held by another customer cannot be held again', async () => {
  const { service, created } = fixture({ holds: [otherCustomersHold] });
  await assert.rejects(service.placeSlotHold({ userId: 'me', serviceId: 'svc', date: slot, stylistId: 'amy' }), (error: { code?: string }) => error.code === 'SLOT_UNAVAILABLE');
  assert.equal(created.length, 0);
});

test('a customer\'s own earlier hold never blocks them', async () => {
  const { service, created } = fixture({ holds: [{ ...otherCustomersHold, userId: 'me' }] });
  const hold = await service.placeSlotHold({ userId: 'me', serviceId: 'svc', date: slot, stylistId: 'amy' });
  assert.equal(hold.stylistId, 'amy');
  assert.equal(created.length, 1);
});

test('"Anyone" is resolved at hold time, skipping a stylist another customer holds', async () => {
  const { service } = fixture({ holds: [otherCustomersHold] });
  const hold = await service.placeSlotHold({ userId: 'me', serviceId: 'svc', date: slot, candidateStylistIds: ['amy', 'ben'] });
  assert.equal(hold.stylistId, 'ben');
});

test('an expired or released hold does not block anyone', async () => {
  const { service } = fixture({ holds: [{ ...otherCustomersHold, expiresAt: new Date('2000-01-01T00:00:00Z') }] });
  assert.equal((await service.placeSlotHold({ userId: 'me', serviceId: 'svc', date: slot, stylistId: 'amy' })).stylistId, 'amy');
});
```

- [ ] **Step 2: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/services/booking-slot-hold.test.ts` → Expected：FAIL，`placeSlotHold is not a function`。

- [ ] **Step 3: 實作**

1. `booking-service.ts` 頂部 import：

```ts
import { createSlotHold, loadHeldBusy, releaseActiveHolds } from './slot-holds';
```

2. `assertAppointmentSlotAvailable` 加第 5 個參數，並喺自己載入 blocking 時計埋保留：

```ts
export async function assertAppointmentSlotAvailable(
  tx: Prisma.TransactionClient,
  appointment: Pick<Appointment, 'id' | 'stylistId' | 'durationAtBooking'> & { service: Pick<Service, 'duration'> },
  date: Date,
  loadedBlocking?: BookedInterval[],
  options: { holdOwnerId?: string } = {},
) {
```

入面 `const [existing, external] = await Promise.all([...])` 改為：

```ts
    const [existing, external, held] = await Promise.all([
      tx.appointment.findMany({ /* unchanged */ }),
      loadExternalBusy(tx, [appointment.stylistId], window),
      // Other customers' holds are taken time; the owner's own hold is not.
      loadHeldBusy(tx, [appointment.stylistId], window, { now: new Date(), exceptUserId: options.holdOwnerId }),
    ]);
```

`blocking` 陣列加 `...held.map(toBookedInterval),`。

3. 由 `createBookingForFirstAvailable` 抽出 busy 載入做 `loadBusyByStylist`（兩個地方共用）：

```ts
/** Appointments, synced busy blocks and other customers' holds for each stylist in one day window. */
export async function loadBusyByStylist(
  tx: Prisma.TransactionClient,
  stylistIds: string[],
  window: { start: Date; end: Date },
  holds: { now: Date; exceptUserId?: string },
): Promise<Map<string, BookedInterval[]>> {
  const [existing, external, held] = await Promise.all([
    tx.appointment.findMany({
      where: { stylistId: { in: stylistIds }, date: { gte: window.start, lte: window.end }, status: { not: 'CANCELLED' } },
      select: slotAppointmentSelect,
    }),
    loadExternalBusy(tx, stylistIds, window),
    loadHeldBusy(tx, stylistIds, window, holds),
  ]);
  const busy = new Map<string, BookedInterval[]>();
  const add = (id: string, interval: BookedInterval) => {
    const list = busy.get(id);
    if (list) list.push(interval);
    else busy.set(id, [interval]);
  };
  // Frozen booking duration wins over the live service duration.
  for (const appt of existing) add(appt.stylistId, { start: new Date(appt.date), durationMin: appt.durationAtBooking ?? appt.service.duration });
  for (const row of [...external, ...held]) add(row.stylistId, toBookedInterval(row));
  return busy;
}
```

`createBookingForFirstAvailable` 入面 `existing` 到 `externalBlocks` 合併嗰段，改為：

```ts
    const bookedByStylist = await loadBusyByStylist(tx, data.candidateStylistIds, { start: dayStart, end: dayEnd }, { now: new Date(), exceptUserId: data.userId });
```

4. 加 `placeSlotHold`（放喺 `createBooking` 上面）：

```ts
/**
 * Hold one slot for the customer while they confirm (spec §3.2). Same checks as
 * a booking, in the same Serializable transaction style, so two customers can
 * never both hold one time. "Anyone" is resolved here and fixed on the hold.
 */
export async function placeSlotHold(data: {
  userId: string; serviceId: string; date: Date; stylistId?: string; candidateStylistIds?: string[];
}): Promise<{ id: string; stylistId: string; expiresAt: Date }> {
  return runSerializableWithRetry(async (tx) => {
    await assertOnlineBookingReady(tx);
    await assertActiveBookingLimit(tx, data.userId);
    const now = new Date();
    const service = await tx.service.findUnique({ where: { id: data.serviceId }, select: { duration: true } });
    if (!service) throw new BookingError('SERVICE_NOT_FOUND');
    await releaseActiveHolds(tx, data.userId, now);

    let stylistId = data.stylistId;
    if (!stylistId) {
      const candidates = data.candidateStylistIds ?? [];
      const busy = await loadBusyByStylist(tx, candidates, salonDayWindow(data.date), { now, exceptUserId: data.userId });
      stylistId = firstFreeStylist(candidates, data.date, service.duration, busy) ?? undefined;
      if (!stylistId) throw new SlotUnavailableError('NO_STYLIST_AT_TIME');
    }
    await assertAppointmentSlotAvailable(tx, { id: '', stylistId, durationAtBooking: service.duration, service }, data.date, undefined, { holdOwnerId: data.userId });
    const hold = await createSlotHold(tx, { userId: data.userId, stylistId, serviceId: data.serviceId, startsAt: data.date, durationMin: service.duration, now });
    return { ...hold, stylistId };
  });
}
```

5. 三個顯示用讀取都加保留（同外部 busy 一樣處理）：
   - `getAvailableSlots`：`Promise.all` 加 `loadHeldBusy(prisma, [stylistId], window, { now })`，`busy` 加 `...heldBlocks.map(toSlotAppointment)`。
   - `getAvailableSlotsUnion`：`Promise.all` 加 `loadHeldBusy(prisma, stylistIds, window, { now })`，好似 `externalBlocks` 咁逐個 push 入 `apptsByStylist`。
   - `getBookingDays`：`Promise.all` 加 `loadHeldBusy(prisma, stylistIds, window, { now })`，每個 row 行 `addBusy(block.stylistId, toBookedInterval(block))`。

6. `actions/booking.ts` 嘅 `rescheduleAppointment`：`await assertAppointmentSlotAvailable(tx, appointment, newDate);` 改為 `await assertAppointmentSlotAvailable(tx, appointment, newDate, undefined, { holdOwnerId: session.userId });`

- [ ] **Step 4: 行測試，確認通過；跑晒全部測試**

Run: Step 2 嘅指令 → 4 pass。`pnpm test` → 全部 pass。有現有 fixture 因為 `tx.slotHold` 唔存在而失敗（例如 `booking-closed-hours.test.ts`、`booking-persistence.test.ts`、`booking-concurrency.test.ts`、`booking-days-loader.test.ts`），就喺佢哋嘅 tx／prisma fake 加 `slotHold: { findMany: async () => [] }`。

- [ ] **Step 5: Commit**

```bash
git add src/app/services src/app/actions/booking.ts
git commit -m "feat(booking): count other customers' holds as taken time and place holds"
```

---

### Task 5: 即時 Fresha 檢查

**Files:**
- Modify: `src/app/services/calendar-sync-service.ts`
- Modify: `src/app/actions/admin.ts`（批核前刷新該髮型師）
- Test: `src/app/services/calendar-live-refresh.test.ts`

**Interfaces:**
- Consumes: 現有 `syncCalendarFeeds(deps)`、`CalendarSyncResult`。
- Produces:
  - `CalendarSyncDependencies.stylistIds?: string[]`
  - `LIVE_REFRESH_STALE_MS = 60_000`、`LIVE_REFRESH_TIMEOUT_MS = 4_000`
  - `refreshStylistFeedsNow(stylistIds: string[], deps?: Omit<CalendarSyncDependencies, 'staleBefore' | 'stylistIds'> & { timeoutMs?: number }): Promise<CalendarSyncResult[]>`（永不 throw）

- [ ] **Step 1: 寫失敗嘅測試**

```ts
// src/app/services/calendar-live-refresh.test.ts
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function withSync(t: TestContext, value: string | undefined) {
  const prior = process.env.CALENDAR_SYNC_ENABLED;
  if (value === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = value;
  t.after(() => { if (prior === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = prior; });
}
const sync = loadServerModule<typeof import('./calendar-sync-service')>('src/app/services/calendar-sync-service.ts', {});

test('with calendar sync switched off, nothing reads the database', async (t) => {
  withSync(t, undefined);
  let reads = 0;
  const db = { calendarConnection: { findMany: async () => { reads++; return []; } } };
  assert.deepEqual(await sync.refreshStylistFeedsNow(['s1'], { db: db as never }), []);
  assert.equal(reads, 0);
});

test('only the named stylists\' feeds older than a minute are fetched', async (t) => {
  withSync(t, 'true');
  let where: Record<string, unknown> = {};
  const now = new Date('2026-10-05T10:00:00Z');
  const db = { calendarConnection: { findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; } } };
  await sync.refreshStylistFeedsNow(['s1'], { db: db as never, now });
  assert.deepEqual(where.stylistId, { in: ['s1'] });
  assert.deepEqual((where.OR as unknown[])[1], { lastSuccessAt: { lt: new Date(now.getTime() - 60_000) } });
});

test('a slow marketplace never holds the customer up: the refresh gives up quietly', async (t) => {
  withSync(t, 'true');
  const db = { calendarConnection: {
    findMany: async () => [{ id: 'c1', stylistId: 's1', provider: 'FRESHA', inboundUrl: 'https://calendar-export.fresha.com/x.ics' }],
    updateMany: async () => ({ count: 1 }),
  } };
  const started = Date.now();
  const result = await sync.refreshStylistFeedsNow(['s1'], { db: db as never, timeoutMs: 50, fetchFeed: () => new Promise(() => {}) });
  assert.deepEqual(result, []);
  assert.ok(Date.now() - started < 1_000);
});
```

- [ ] **Step 2: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/services/calendar-live-refresh.test.ts` → Expected：FAIL，`refreshStylistFeedsNow is not a function`。

- [ ] **Step 3: 實作**

`CalendarSyncDependencies` 加：

```ts
  /** Only these stylists' connections (live refresh at hold/approval time). */
  stylistIds?: string[];
```

`syncCalendarFeeds` 嘅 `where` 加一行（放喺 `connectionId` 嗰行下面）：

```ts
      ...(deps.stylistIds ? { stylistId: { in: deps.stylistIds } } : {}),
```

喺 `refreshStaleCalendarFeeds` 下面加：

```ts
export const LIVE_REFRESH_STALE_MS = 60_000;
export const LIVE_REFRESH_TIMEOUT_MS = 4_000;

/**
 * Pull the named stylists' marketplace feeds now, at most once a minute each,
 * so a hold or an approval sees a Fresha booking made in the last half hour.
 * Kill-switch first (no DB read while sync is off); never throws; gives up
 * after a few seconds and lets the last sync stand — the freshness gate in
 * assertOnlineBookingReady still applies.
 */
export async function refreshStylistFeedsNow(
  stylistIds: string[],
  deps: Omit<CalendarSyncDependencies, 'staleBefore' | 'stylistIds'> & { timeoutMs?: number } = {},
): Promise<CalendarSyncResult[]> {
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true' || stylistIds.length === 0) return [];
  const now = deps.now ?? new Date();
  const { timeoutMs = LIVE_REFRESH_TIMEOUT_MS, ...syncDeps } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CalendarSyncResult[]>((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); });
  const refresh = syncCalendarFeeds({ ...syncDeps, stylistIds, staleBefore: new Date(now.getTime() - LIVE_REFRESH_STALE_MS) })
    .catch(() => [] as CalendarSyncResult[]);
  try {
    return await Promise.race([refresh, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

`src/app/actions/admin.ts`：`import` 加 `refreshStylistFeedsNow`（同 `refreshStaleCalendarFeeds` 同一個 import）；將 `if (status === 'CONFIRMED') await refreshStaleCalendarFeeds();` 改為：

```ts
    if (status === 'CONFIRMED') {
      await refreshStaleCalendarFeeds();
      // The whole-salon pass above only touches feeds older than 30 minutes; the
      // stylist being confirmed gets a fresh read so a Fresha sale made minutes
      // ago is caught before the salon confirms the website request.
      const target = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { stylistId: true } });
      if (target) await refreshStylistFeedsNow([target.stylistId]);
    }
```

- [ ] **Step 4: 行測試，確認通過；跑晒全部測試**

Run: Step 2 嘅指令 → 3 pass；`pnpm test` → 全部 pass（`admin.ts` 相關 fixture 如因為 `refreshStylistFeedsNow` 未 mock 而失敗，喺 `'@/app/services/calendar-sync-service'` mock 加 `refreshStylistFeedsNow: async () => []`）。

- [ ] **Step 5: Commit**

```bash
git add src/app/services/calendar-sync-service.ts src/app/services/calendar-live-refresh.test.ts src/app/actions/admin.ts src/app
git commit -m "feat(calendar): live per-stylist marketplace refresh for holds and approvals"
```

---

### Task 6: Server actions — 保留、釋放、提交要有保留

**Files:**
- Modify: `src/app/actions/booking.ts`
- Modify: `src/app/services/booking-service.ts`（`createBooking` 消耗保留；刪除 `createBookingForFirstAvailable`）
- Modify: `src/app/lib/rate-limit.ts`（`slotHoldLimiter`）
- Modify: 引用 `createBookingForFirstAvailable` 嘅測試（`booking-persistence.test.ts`）
- Test: `src/app/actions/booking-hold-actions.test.ts`

**Interfaces:**
- Consumes: Task 3 `releaseHold`、`findHold`、`consumeHold`；Task 2 `checkHoldForSubmit`；Task 4 `placeSlotHold`；Task 5 `refreshStylistFeedsNow`。
- Produces:
  - `holdSlot(data: { stylistId: string; serviceId: string; date: string; time: string; consultationForServiceId?: string }): Promise<{ success: true; holdId: string; stylistId: string; expiresAt: string } | { success: false; code?: BookingErrorCode; error: string }>`
  - `releaseHeldSlot(holdId: string): Promise<{ success: true }>`
  - `submitBooking` 輸入加必填 `holdId: string`；`stylistId` 必須係實際髮型師（唔可以係 `ANY_STYLIST_ID`）
  - `createBooking(data: NewBookingInput & { stylistId: string; holdId: string })`
  - `slotHoldLimiter`（`rl:slot-hold`，每小時 12 次）

- [ ] **Step 1: 寫失敗嘅測試**

```ts
// src/app/actions/booking-hold-actions.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';

const errors = translator('en-GB', 'errors');
function actionsFixture(options: { limiterAllows?: boolean; placed?: { id: string; stylistId: string; expiresAt: Date }; refreshSpy?: string[][] } = {}) {
  const calls: string[] = [];
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }) },
      service: { findUnique: async () => ({ duration: 60, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false, isBookable: true, isPublic: true }) },
      availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
      stylist: { findMany: async () => [{ id: 'amy', availabilities: [{ startTime: '09:00', endTime: '18:00' }] }, { id: 'ben', availabilities: [{ startTime: '09:00', endTime: '18:00' }] }] },
    },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'me', role: 'USER' }) },
    '@/app/lib/rate-limit': {
      bookingLimiter: { check: async () => true },
      slotHoldLimiter: { check: async () => { calls.push('limiter'); return options.limiterAllows ?? true; } },
    },
    '@/app/services/booking-service': {
      placeSlotHold: async (data: { stylistId?: string; candidateStylistIds?: string[] }) => { calls.push(`place:${data.stylistId ?? data.candidateStylistIds?.join('+')}`); return options.placed ?? { id: 'hold-1', stylistId: 'amy', expiresAt: new Date('2099-01-05T09:10:00Z') }; },
    },
    '@/app/services/calendar-sync-service': { refreshStylistFeedsNow: async (ids: string[]) => { options.refreshSpy?.push(ids); return []; } },
    '@/app/services/notification-outbox-service': {},
    '@/app/services/stylist-ical-cache': {},
  });
  return { actions, calls };
}

test('holding a time refreshes that stylist\'s marketplace feed first, then places the hold', async () => {
  const refreshed: string[][] = [];
  const { actions, calls } = actionsFixture({ refreshSpy: refreshed });
  const result = await actions.holdSlot({ stylistId: 'amy', serviceId: 'svc', date: '2099-01-05', time: '10:00' });
  assert.deepEqual(result, { success: true, holdId: 'hold-1', stylistId: 'amy', expiresAt: '2099-01-05T09:10:00.000Z' });
  assert.deepEqual(refreshed, [['amy']]);
  assert.deepEqual(calls, ['limiter', 'place:amy']);
});

test('"Anyone" refreshes every candidate and returns the stylist the hold chose', async () => {
  const refreshed: string[][] = [];
  const { actions } = actionsFixture({ refreshSpy: refreshed, placed: { id: 'hold-2', stylistId: 'ben', expiresAt: new Date('2099-01-05T09:10:00Z') } });
  const result = await actions.holdSlot({ stylistId: 'any', serviceId: 'svc', date: '2099-01-05', time: '10:00' });
  assert.equal(result.success && result.stylistId, 'ben');
  assert.deepEqual(refreshed, [['amy', 'ben']]);
});

test('too many hold attempts are refused before any refresh or write', async () => {
  const refreshed: string[][] = [];
  const { actions, calls } = actionsFixture({ limiterAllows: false, refreshSpy: refreshed });
  const result = await actions.holdSlot({ stylistId: 'amy', serviceId: 'svc', date: '2099-01-05', time: '10:00' });
  assert.deepEqual(result, { success: false, code: 'TOO_MANY_HOLDS', error: errors('booking.TOO_MANY_HOLDS') });
  assert.deepEqual(refreshed, []);
  assert.deepEqual(calls, ['limiter']);
});

test('a booking cannot be submitted without a hold, or for "Anyone"', async () => {
  const { actions } = actionsFixture();
  const noHold = await actions.submitBooking({ stylistId: 'amy', serviceId: 'svc', date: '2099-01-05', time: '10:00' } as never);
  assert.equal(noHold.success, false);
  const anyone = await actions.submitBooking({ stylistId: 'any', serviceId: 'svc', date: '2099-01-05', time: '10:00', holdId: 'hold-1' });
  assert.equal(!anyone.success && anyone.code, 'HOLD_REQUIRED');
});
```

另外新增 `src/app/services/booking-create-with-hold.test.ts`，覆蓋 `createBooking` 消耗保留嘅三個情況（Review Focus 2 同 4）：

```ts
// src/app/services/booking-create-with-hold.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import type { SlotHoldRow } from './slot-hold-policy';

const slot = new Date(Date.now() + 3 * 86_400_000);
slot.setUTCHours(10, 0, 0, 0);
const expiredHold = (stylistId: string): SlotHoldRow => ({
  id: 'hold-1', userId: 'me', stylistId, serviceId: 'svc', startsAt: slot, durationMin: 60,
  expiresAt: new Date(Date.now() - 60_000), consumedAt: null, releasedAt: null,
});

function bookingFixture(options: { hold: SlotHoldRow | null; overlapping?: boolean }) {
  const consumed: string[] = [];
  const created: Record<string, unknown>[] = [];
  const tx = {
    appointment: {
      count: async () => 0,
      findMany: async () => (options.overlapping
        ? [{ stylistId: options.hold?.stylistId ?? 'amy', date: slot, durationAtBooking: 60, service: { duration: 60 } }]
        : []),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'appt-1', notificationVersion: 0, ...data, user: { email: 'c@example.invalid', name: 'C', phone: null }, stylist: { name: 'S' }, service: { name: 'Cut', price: '40.00', duration: 60 } };
      },
    },
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
    stylist: { findUnique: async () => ({ isActive: true, treatwellExternalId: null }) },
    externalBusyBlock: { findMany: async () => [] },
    slotHold: {
      findMany: async () => [],
      findUnique: async () => options.hold,
      updateMany: async ({ where }: { where: { id: string } }) => { consumed.push(where.id); return { count: 1 }; },
    },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) },
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0' }) },
    './notification-outbox-service': { enqueueAppointmentNotification: async () => ({ id: 'event' }) },
    './offers-service': {},
    './pricing/quote-service': { quoteForNewBooking: async () => ({ service: { duration: 60, treatwellExternalId: null }, quote: { amountPence: 4000 } }) },
    './pricing/quote': { quoteMatches: () => true, serializeQuote: () => '{}' },
  });
  return { service, consumed, created };
}
const request = (stylistId: string) => ({ stylistId, serviceId: 'svc', date: slot, userId: 'me', holdId: 'hold-1' });

test('an expired but unused hold still books while the slot is free', async () => {
  const f = bookingFixture({ hold: expiredHold('amy') });
  await f.service.createBooking(request('amy'));
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].status, 'PENDING');
  assert.deepEqual(f.consumed, ['hold-1']);
});

test('an expired hold whose slot was taken fails as SLOT_UNAVAILABLE, not HOLD_REQUIRED', async () => {
  const f = bookingFixture({ hold: expiredHold('amy'), overlapping: true });
  await assert.rejects(f.service.createBooking(request('amy')), (error: { code?: string }) => error.code === 'SLOT_UNAVAILABLE');
  assert.equal(f.created.length, 0);
  assert.deepEqual(f.consumed, []);
});

test('a hold fixed to one stylist books that stylist and nobody else', async () => {
  const ok = bookingFixture({ hold: expiredHold('ben') });
  await ok.service.createBooking(request('ben'));
  assert.equal(ok.created[0].stylistId, 'ben');
  const wrong = bookingFixture({ hold: expiredHold('ben') });
  await assert.rejects(wrong.service.createBooking(request('amy')), (error: { code?: string }) => error.code === 'HOLD_REQUIRED');
  assert.equal(wrong.created.length, 0);
});
```

- [ ] **Step 2: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/actions/booking-hold-actions.test.ts src/app/services/booking-create-with-hold.test.ts` → Expected：FAIL（`holdSlot` 未存在；`createBooking` 未消耗保留）。

- [ ] **Step 3: 實作**

1. `src/app/lib/rate-limit.ts` 檔尾：

```ts
// Each hold is a Serializable transaction plus a marketplace fetch; a person
// picks a handful of times at most. Per customer, never per IP.
export const slotHoldLimiter = createRateLimiter({ prefix: 'rl:slot-hold', limit: 12, windowSeconds: 60 * 60 });
```

2. `booking-service.ts` 嘅 `createBooking`：`data` type 加 `holdId: string`；transaction 入面 `assertActiveBookingLimit` 之後、`assertAppointmentSlotAvailable` 之前加：

```ts
    const now = new Date();
    const verdict = checkHoldForSubmit(await findHold(tx, data.holdId), {
      userId: data.userId, stylistId: data.stylistId, serviceId: data.serviceId, startsAt: data.date,
    });
    if (!verdict.ok) throw new BookingError(verdict.code);
```

`assertAppointmentSlotAvailable(...)` 呼叫加第 5 個參數 `{ holdOwnerId: data.userId }`；`tx.appointment.create(...)` 之後加 `await consumeHold(tx, data.holdId, now);`。Import `checkHoldForSubmit`（`./slot-hold-policy`）、`findHold`、`consumeHold`（`./slot-holds`）。

3. 刪除 `createBookingForFirstAvailable`：「Anyone」已經喺保留時決定。`booking-persistence.test.ts` 入面 `Anyone submit …` 嘅測試要改寫：先用 `placeSlotHold({ candidateStylistIds })` 得到髮型師，再用 `createBooking({ stylistId, holdId })`，每個原有斷言保留。

4. `actions/booking.ts`：
   - 由 `submitBooking` 抽出共用檢查做 `prepareBookingRequest`（**唔 export**，因為 `'use server'` 檔只可以 export async server action）。範圍係 `submitBooking` 由 `const salon = resolveSalonDateTime(validData.date, validData.time);` 開始，到計好 `notes` 嘅 `if (... validData.consultationForServiceId) { ... }` block 結束（即係 `try {` 之前）。原封不動搬入，唯一改動係每個 `return failure(locale, 'X')` 變成 `return { ok: false, code: 'X' }`，而 `session.userId` 改用參數 `userId`：

```ts
type PreparedBooking = { salon: SalonDateTime; fullDate: Date; stylistId?: string; candidateStylistIds?: string[]; notes?: string };
async function prepareBookingRequest(
  userId: string,
  input: { stylistId: string; serviceId: string; date: string; time: string; consultationForServiceId?: string },
): Promise<{ ok: true; value: PreparedBooking } | { ok: false; code: BookingErrorCode }> {
  // Body: the moved block described above. It ends with
  //   return { ok: true, value: { salon, fullDate, notes,
  //     ...(isAnyStylist ? { candidateStylistIds } : { stylistId: input.stylistId }) } };
}
```

   - `holdSlot`：

```ts
export async function holdSlot(data: { stylistId: string; serviceId: string; date: string; time: string; consultationForServiceId?: string }) {
  const locale = await getActionLocale();
  if (!(await isBookingEnabled())) return failure(locale, 'MAINTENANCE');
  const session = await verifySession();
  const parsed = holdSlotSchema.safeParse(data);
  if (!parsed.success) return failure(locale, 'INVALID_BOOKING');
  const account = await prisma.user.findUnique({ where: { id: session.userId }, select: EMAIL_VERIFICATION_SELECT });
  if (!account || !hasVerifiedEmail(account)) return failure(locale, 'EMAIL_NOT_VERIFIED');
  if (!(await slotHoldLimiter.check(`user:${session.userId}`))) return failure(locale, 'TOO_MANY_HOLDS');
  const prepared = await prepareBookingRequest(session.userId, parsed.data);
  if (!prepared.ok) return failure(locale, prepared.code);
  const { fullDate, stylistId, candidateStylistIds } = prepared.value;
  await refreshStylistFeedsNow(stylistId ? [stylistId] : candidateStylistIds ?? []);
  try {
    const hold = await placeSlotHold({ userId: session.userId, serviceId: parsed.data.serviceId, date: fullDate, stylistId, candidateStylistIds });
    return { success: true as const, holdId: hold.id, stylistId: hold.stylistId, expiresAt: hold.expiresAt.toISOString() };
  } catch (error) {
    return { success: false as const, code: error instanceof BookingError ? error.code : 'BOOKING_FAILED', error: describeBookingError(error, locale, 'BOOKING_FAILED') };
  }
}
```

   `holdSlotSchema` 同 `createBookingSchema` 一樣，但冇 `discountCode`／`expectedQuote`。

   - `releaseHeldSlot`：

```ts
export async function releaseHeldSlot(holdId: string): Promise<{ success: true }> {
  const session = await verifySession();
  if (typeof holdId === 'string' && holdId && holdId.length <= 64) await releaseHold(prisma, holdId, session.userId, new Date());
  return { success: true };
}
```

   - `submitBooking`：`createBookingSchema` 加 `holdId: z.string().min(1).max(64)`；`validData.stylistId === ANY_STYLIST_ID` 就 `return failure(locale, 'HOLD_REQUIRED')`；中段改用 `prepareBookingRequest`；service 呼叫只剩 `createBooking({ ..., stylistId: validData.stylistId, holdId: validData.holdId })`。

- [ ] **Step 4: 行測試，確認通過；跑晒全部測試**

Run: Step 2 嘅指令 → pass；`pnpm test` → 全部 pass（包括 `use-server-exports.test.ts`）；`pnpm exec tsc --noEmit`；`pnpm lint`。

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(booking): hold a slot before confirming and book against the hold"
```

---

### Task 7: 職員排程見到網上保留

**Files:**
- Modify: `src/app/services/admin-move-clashes.ts`
- Modify: `src/app/lib/describe-clash.ts`
- Modify: `src/i18n/messages/en/adminSchedule.ts`、`src/i18n/messages/zh/adminSchedule.ts`
- Test: `src/app/services/admin-move-clashes.test.ts`（加一個 test）

**Interfaces:**
- Consumes: Task 3 `loadHeldBusy`。
- Produces: `MoveClash` 新增 `{ kind: 'HELD'; start: Date; end: Date }`；文案 key `clash.held`。

- [ ] **Step 1: 寫失敗嘅測試**（加入 `admin-move-clashes.test.ts`；跟檔內現有 fixture 做法，令 `db.slotHold.findMany` 回傳 amy 10:00–11:00 一個有效保留）

```ts
test('an online customer holding the time is a warning the salon can override', async () => {
  const db = {
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
    appointment: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [] },
    slotHold: { findMany: async () => [{ stylistId: 'amy', startsAt: new Date('2099-01-05T10:00:00Z'), durationMin: 60 }] },
  };
  const clashes = await describeAdminMoveClashes(db as never, {
    appointmentId: 'a1', stylistId: 'amy', start: new Date('2099-01-05T10:30:00Z'), durationMin: 30, userId: 'u', requiresPatchTest: false,
  });
  assert.deepEqual(clashes, [{ kind: 'HELD', start: new Date('2099-01-05T10:00:00Z'), end: new Date('2099-01-05T11:00:00Z') }]);
});
```

- [ ] **Step 2: 行測試，確認失敗**

Run: `node --conditions=react-server --import tsx --test src/app/services/admin-move-clashes.test.ts` → Expected：FAIL（冇 `HELD`）。

- [ ] **Step 3: 實作**

`MoveClash` union 加 `| { kind: 'HELD'; start: Date; end: Date }`；`describeAdminMoveClashes` 嘅 `Promise.all` 加 `loadHeldBusy(db, [target.stylistId], window, { now: new Date() })`，同 `external` 一樣逐個檢查 overlap，push `{ kind: 'HELD', start: block.start, end: block.end }`。

`describe-clash.ts` 加：

```ts
    case 'HELD':
      return t('clash.held', { time: formatSalonClock(t.locale, new Date(clash.start)) });
```

文案：en `held: 'An online customer is holding {time} while they confirm (up to 10 minutes).'`；zh `held: '有客人正在網上確認預約，暫時保留 {time}（最多 10 分鐘）。'`（放喺 `clash.externalBusy` 下面）。

- [ ] **Step 4: 行測試，確認通過；`pnpm test`、`tsc`**
- [ ] **Step 5: Commit** — `git commit -m "feat(admin): show online holds as an overridable clash"`

---

### Task 8: 預約頁介面

**Files:**
- Modify: `src/components/booking/BookingWizard.tsx`
- Create: `src/components/booking/HoldCountdown.tsx`
- Modify: `src/i18n/messages/en/booking.ts`、`src/i18n/messages/zh/booking.ts`

**Interfaces:**
- Consumes: Task 6 `holdSlot`、`releaseHeldSlot`、`submitBooking({ ..., holdId })`。

- [ ] **Step 1: 文案**（`booking` namespace；`date` 同 `confirm` section 已經送去 client，見 `/book` page 嘅 `ClientMessages`）

en：`date.holding: 'Holding your time…'`；`confirm.heldFor: 'We are holding this time for you: {time}'`；`confirm.holdExpired: 'Your hold has ended. We will check the time is still free when you confirm.'`
zh：`date.holding: '正在為你保留時段…'`；`confirm.heldFor: '此時段正為你保留：{time}'`；`confirm.holdExpired: '保留時間已完。你確認時，我們會再檢查此時段是否仍然有空。'`

- [ ] **Step 2: `HoldCountdown`**

```tsx
// src/components/booking/HoldCountdown.tsx
'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';

/** "We are holding this time for you: 9:58". Purely informative: submit stays enabled after expiry. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const t = useT('booking');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  if (left === 0) return <p role="status" className="text-sm text-zinc-600">{t('confirm.holdExpired')}</p>;
  const minutes = Math.floor(left / 60_000);
  const seconds = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  return <p role="status" aria-live="off" className="text-sm font-medium text-zinc-800">{t('confirm.heldFor', { time: `${minutes}:${seconds}` })}</p>;
}
```

- [ ] **Step 3: Wizard 接線**
  - 新 state：`const [hold, setHold] = useState<{ id: string; stylistId: string; expiresAt: string } | null>(null);` 同 `const [holding, setHolding] = useState(false);`
  - DATE 步驟「繼續」`onClick={() => setStep('CONFIRM')}` 改為 `onClick={placeHold}`，`disabled={!selectedTime || holding}`，文字喺 `holding` 時顯示 `t('date.holding')`：

```tsx
  const placeHold = async () => {
    if (!selectedStylist || !selectedService || !selectedTime) return;
    setHolding(true);
    setBookingError(null);
    try {
      const result = await holdSlot({ stylistId: selectedStylist.id, serviceId: selectedService.id, date: dayString, time: selectedTime, consultationForServiceId: consultationOrigin?.id });
      if (result.success) {
        setHold({ id: result.holdId, stylistId: result.stylistId, expiresAt: result.expiresAt });
        setStep('CONFIRM');
      } else {
        setBookingError(result.error);
        setDaysVersion((version) => version + 1);
      }
    } catch {
      setBookingError(t('confirm.genericError'));
    } finally {
      setHolding(false);
    }
  };
```

  - CONFIRM 步驟：標題下面放 `{hold && <HoldCountdown expiresAt={hold.expiresAt} />}`。
  - CONFIRM 嘅「返回」按鈕（`onClick={() => setStep('DATE')}`，兩個位置）改為：

```tsx
onClick={() => { if (hold) void releaseHeldSlot(hold.id); setHold(null); setStep('DATE'); setDaysVersion((version) => version + 1); }}
```

  - `handleSubmit` 嘅 `submitBooking({...})`：`stylistId: hold?.stylistId ?? selectedStylist.id`，加 `holdId: hold?.id ?? ''`；結果 `code === 'HOLD_REQUIRED'` 就 `setHold(null); setStep('DATE');`。

- [ ] **Step 4: 本機驗證**（跟 memory `local-verification-gotchas`「Opening the booking wizard LOCALLY」開本機 Postgres 同 dev server；網上預約只喺 production 鎖）
  1. 揀時間撳「繼續」→ 確認頁有倒數。
  2. 用第二個已確認 email 嘅帳戶，另一個 browser profile 睇同一日 → 嗰個時段係「不可預約」。
  3. 撳「返回」→ 第二個帳戶 reload 之後時段重新可揀。
  4. 等倒數完先撳確認 → 預約成功（PENDING）。
  5. 切換 zh-HK，檢查文案。
  6. 手機 390px 寬度冇 overflow。

- [ ] **Step 5: `pnpm test`、`tsc`、`lint`；Commit** — `git commit -m "feat(booking): hold the chosen time on the confirm step with a countdown"`

---

### Task 9: Housekeeping、真 PostgreSQL 併發檢查、文件

**Files:**
- Modify: `src/app/services/housekeeping-service.ts`、`src/app/services/housekeeping-service.test.ts`
- Modify: `scripts/verify-production-readiness.ts`
- Modify: `readme/structure.md`、`CLAUDE.md`

- [ ] **Step 1: Housekeeping 失敗測試**（加入 `housekeeping-service.test.ts`）

```ts
test('slot holds are purged a day after they expire', async () => {
  const now = new Date('2026-10-10T03:15:00Z');
  const cutoff = { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } };
  let deleted: unknown;
  const db = {
    backgroundJobState: { upsert: async () => ({}), updateMany: async () => ({ count: 1 }) },
    notificationDelivery: { findMany: async () => [], updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    externalBusyBlock: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    kioskSession: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    slotHold: {
      findMany: async ({ where }: { where: unknown }) => { assert.deepEqual(where, cutoff); return [{ id: 'old-1' }, { id: 'old-2' }]; },
      deleteMany: async ({ where }: { where: unknown }) => { deleted = where; return { count: 2 }; },
    },
  };
  const housekeeping = loadServerModule<typeof import('./housekeeping-service')>('src/app/services/housekeeping-service.ts', {});
  const result = await housekeeping.runHousekeeping({ db: db as never, now });
  assert.equal(result.deletedHolds, 2);
  assert.deepEqual(deleted, { ...cutoff, id: { in: ['old-1', 'old-2'] } });
});
```
- [ ] **Step 2: 實作**：`result` 加 `deletedHolds: 0`；喺 kiosk 嗰段下面加：

```ts
    // Holds last ten minutes; a day later they are only history.
    const oldHolds = { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } };
    const holdRows = await db.slotHold.findMany({ where: oldHolds, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH_SIZE });
    if (holdRows.length) result.deletedHolds = (await db.slotHold.deleteMany({ where: { ...oldHolds, id: { in: holdRows.map((row) => row.id) } } })).count;
```

- [ ] **Step 3: 真 PostgreSQL 併發檢查**：喺 `scripts/verify-production-readiness.ts` 現有「six-booking cap race」嗰段之後加（`future`、`db`、`booking`、`stylist`、`service` 都係 script 入面已有嘅變數；`future(days)` 回傳 `days` 日後倫敦 10:00）：

```ts
    // Two customers racing for one time: the Serializable hold transaction lets exactly one win.
    const holders = await Promise.all(['hold-race-a', 'hold-race-b'].map((id) =>
      db.user.create({ data: { id, email: `${id}@example.invalid`, name: id, emailVerifiedAt: new Date() } })));
    const holdAt = future(30);
    const race = await Promise.allSettled(holders.map((holder) =>
      booking.placeSlotHold({ userId: holder.id, serviceId: service.id, date: holdAt, stylistId: stylist.id })));
    const won = race.findIndex((outcome) => outcome.status === 'fulfilled');
    assert.equal(race.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'exactly one customer holds the time');
    const lost = race.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    assert.equal((lost.reason as { code?: string }).code, 'SLOT_UNAVAILABLE');
    const hold = (race[won] as PromiseFulfilledResult<{ id: string }>).value;
    assert.equal(await db.slotHold.count({ where: { stylistId: stylist.id, startsAt: holdAt, consumedAt: null, releasedAt: null } }), 1);
    await booking.createBooking({ stylistId: stylist.id, serviceId: service.id, userId: holders[won].id, date: holdAt, holdId: hold.id,
      expectedQuote: { serviceId: service.id, priceVersion: 1, amountPence: 10000 } });
    assert.ok((await db.slotHold.findUnique({ where: { id: hold.id } }))?.consumedAt, 'the booking consumed its hold');
```

同一個 PASS 行加上「slot-hold race」。
- [ ] **Step 4: 文件**
  - `readme/structure.md`：加 `slot-hold-policy.ts`、`slot-holds.ts`、`placeSlotHold`、`loadBusyByStylist`、`refreshStylistFeedsNow`、`holdSlot`／`releaseHeldSlot`、`HoldCountdown`。
  - `CLAUDE.md` 嘅 Key Conventions 加一行：**Slot holds**：客人確認前保留時段 10 分鐘（`SlotHold`）。「有效」只由 `isHoldActive`／`loadHeldBusy` 定義；所有撞期檢查都要計其他人嘅有效保留；保留永遠唔入 iCal feed；過期唔使 cron。
- [ ] **Step 5: 全套驗證**：`pnpm test`、`pnpm exec tsc --noEmit`、`pnpm lint`；本機跑 `pnpm test:integration`（`SALON_TEST_DATABASE_URL` 指住本機 `salon_test`）→ PASS。
- [ ] **Step 6: Commit** — `git commit -m "chore(booking): purge old holds, prove hold race on PostgreSQL, document holds"`

---

## 第二、三期（另外寫計劃）

- **第二期：Square 預授權**。付款嘗試記錄（durable attempt）連住 `SlotHold.id`；授權喺 `placeSlotHold` 之後、transaction 外面做；`createBooking` 消耗保留時將 attempt 連去 appointment；批核扣款、拒絕取消授權。全部跟 `docs/square-payments-setup.md`「Required application work before payment collection」。上線時喺同一個改動將 `SQUARE_DEPOSITS_WIRED` 改做 `true`。
- **第三期：Google Calendar**。見 spec §4；先用一位髮型師實測「網站 → Google → Fresha」延遲同有冇回流，先寫計劃。
