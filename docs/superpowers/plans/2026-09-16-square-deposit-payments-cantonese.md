# Square 按金付款整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 喺 booking / consultation 流程加入 Square 按金付款 — 落單嗰陣只 hold（授權）唔扣錢，admin 批核先 capture，拒絕就 void。

**Architecture:** 用 Square Payments API 嘅 **delayed capture**（`autocomplete: false`）配合現有嘅 PENDING → CONFIRMED 審批流程。前端用 Web Payments SDK tokenize 張卡並行英國強制嘅 SCA（`verifyBuyer`），後端喺 Serializable transaction **外面** 做授權，成功先開 appointment，開唔到就即刻 void。金額決策抽晒入一個零 dependency 嘅純函數，方便全組合 unit test。

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Prisma · Neon Postgres · `square` Node SDK · Square Web Payments SDK · Tailwind CSS v4 · `node:test` (via tsx)

**Spec:** 本文件（設計理據直接內嵌喺下面「設計決策同理據」一節）

---

## Global Constraints

呢啲係全 repo 嘅硬規矩，**每一個 task 都默認包含**：

- **三個 Prisma schema 一齊改** — `prisma/dev/schema.prisma`、`prisma/vercel/schema.prisma`、`prisma/prod/schema.prisma`，一個都唔可以漏。
- **App 用嘅 Prisma client 由 vercel schema 生成** — 改完 schema 一定要 `pnpm db:vercel:generate`，唔係 `tsc` 睇唔到新 field。
- **CI 唔會行 migration** — merge 之前要人手 apply。
- **絕對唔可以喺 module level 讀 env var** — 一律包喺 async function 入面 runtime 先讀。
- **Service 模組用 `import 'server-only'`**，唔係 `'use server'`（`'use server'` 淨係用喺 `src/app/actions/` 嘅 server actions）。
- **Data operation 一律用 server actions**，唔好開 API route（webhook 例外，佢係外部 callback）。
- **用 Prisma 生成嘅 type**（`@prisma/client`），唔好自己手寫 DB model interface。
- **Rate limiting 一律行 `src/app/lib/rate-limit.ts`** — 千祈唔好寫 `if (limiter)` 咁 null-skip，上次就係咁搞到 prod 限制消失。
- **Tailwind CSS only**。品牌係 **monochrome 黑白灰**，唔好加返舊嗰隻藍 `#174F7F` 或者金色。
- **唔可以加新 cron** — Neon 係按 compute time 計錢，5 分鐘無人用就 suspend。按款對帳要靠 webhook + on-read，唔好用輪詢。
- **新 env var 喺 GitHub Actions build 會變字面值 `[SENSITIVE]`** — 任何 parse env 嘅 code 都要有 guard（參考 `src/app/lib/site-url.ts` 嘅 `isParseableUrl`）。
- **Test runner:** `pnpm test` → `node --conditions=react-server --import tsx --test $(find src -name '*.test.ts')`
- **測試風格:** `node:test` + `node:assert/strict`，用手寫 fake object 做 dependency injection，唔用 mocking library。
- **已知 baseline:** `src/components/try-color/colorMath.test.ts` 有 4 個 pre-existing `tsc` error，唔關你事，只要確認冇**新增**錯誤。
- **貨幣一律 GBP，金額一律用 pence（integer）** 喺內部傳遞，淨係喺 display / Square `verifyBuyer` 先轉做鎊字串。

---

## 設計決策同理據

執行之前讀一次，唔明點解要咁做就返嚟睇呢節。

### 點解一定要 delayed capture

`submitBooking` 開單係 `status: 'PENDING'`，要 admin 喺 `updateAppointmentStatus` 批先變 `CONFIRMED`。如果落單即刻收錢，每一單 admin 拒絕都要退款 —— 退款嘅手續費係拎唔返嘅，而且客戶體驗好差。

Square 嘅 delayed capture 啱到絕：

| 你嘅事件 | Square 動作 | 結果 |
|---|---|---|
| 客戶落單 | `payments.create({ autocomplete: false })` | status `APPROVED`，卡被 hold，**未扣錢** |
| Admin 批核 | `payments.complete({ paymentId })` | 正式扣錢 |
| Admin 拒絕 / 搶唔到 slot | `payments.cancel({ paymentId })` | 放返個 hold，客戶完全冇感覺 |
| 冇人理 | 到期自動 `CANCEL` | 唔會無啦啦扣客錢 |

**Card-not-present 嘅授權有效期係 7 日**（36 小時果個係 card-present 先啱），足夠覆蓋審批時間。`delay_action` 用返 default 嘅 `CANCEL`。

### 點解 Square call 唔可以入 transaction

`createBooking` 行緊 `runSerializableWithRetry`。兩個致命問題：

1. **佢會 retry** —— 一 retry 就會再 call 一次 Square，變成重複授權。
2. **Serializable lock 會等住個 HTTP round-trip** —— 好易 timeout，而且會擋住其他人 book。

所以次序一定係：**授權（transaction 外）→ 開單（transaction 內）→ 開唔到就 void**。授權本身唔收手續費（capture 先收），所以 void 一單搶輸嘅 booking 係零成本。

### 點解 book 同 consult 收費模式唔同

`resolveConsultationTarget` 已經分咗兩條路：

- **`Consultation & Patch Test`（£15，`isPatchTest`）** —— 佢本身就係一個有價服務，應該**收足全數**，唔係「按金」。
- **一般 `Consultation`（£0，`isConsultation`）** —— 冇嘢可以收，`resolveDepositPence` 直接回 0。
- **正常 booking** —— 最貴去到 £339（Balayage + Haircut + Blow Dry），按金喺呢度先真係有意義。

### 手續費（影響按金金額點揀）

Square UK 網上收款：**英國卡 1.4% + 25p**，非英國卡 2.5% + 25p，card-on-file / 人手輸入 2.5%。

個固定 25p 喺細額度好蝕：£15 嘅 patch test 實際係 3.1%，£50 按金係 1.9%，£100 先跌到 1.65%。即係按金訂得太細（例如 £10）性價比好差 —— 呢個係下面「未決定嘅嘢」第 1 條要考慮嘅數字。

### 未解決嘅策略問題（唔阻住執行，但要知）

`feat/fresha-channel-migration` 仲進行緊，而 **Fresha 本身就有按金同 no-show protection**。呢套嘢有機會同 Fresha 撞功能。開工前值得同 client 確認一次。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/app/services/deposit-policy.ts` | **純函數**：由 service + settings 計出按金 pence。零 import。 |
| `src/app/services/deposit-policy.test.ts` | 上面嘅全組合測試 |
| `src/app/lib/square-config.ts` | **純函數**：由 `process.env` 解析出 Square config，含 `[SENSITIVE]` guard |
| `src/app/lib/square-config.test.ts` | config 解析測試 |
| `src/app/lib/square.ts` | Square SDK client factory（runtime 讀 env） |
| `src/app/services/deposit-service.ts` | `DepositGateway` 介面 + Square 實作（authorize / capture / voidAuth） |
| `src/app/services/deposit-service.test.ts` | 用 fake gateway 測行為 |
| `src/app/lib/csp.ts` | **純函數** CSP builder，畀 `next.config.ts` 用 |
| `src/app/lib/csp.test.ts` | 確認 Square domain 喺晒應該喺嘅 directive |
| `src/app/api/webhooks/square/route.ts` | Square webhook 接收 + 簽名驗證 |
| `src/components/booking/SquareCardField.tsx` | 卡片欄 client component（由 `BookingWizard` 用） |

修改：`next.config.ts`、`src/app/lib/rate-limit.ts`、`src/app/actions/booking.ts`、`src/app/actions/admin.ts`、`src/app/actions/admin-settings.ts`、`src/components/booking/BookingWizard.tsx`、三個 `schema.prisma`。

---

## Task 1: Deposit policy（純決策模組）

由呢個開始，因為佢零 dependency，可以完全 TDD，而且後面所有嘢都要用佢個 output。

**Files:**
- Create: `src/app/services/deposit-policy.ts`
- Test: `src/app/services/deposit-policy.test.ts`

**Interfaces:**
- Consumes: 冇（呢個係第一個 task）
- Produces:
  - `export interface DepositPolicyInput { depositsEnabled: boolean; servicePricePence: number; depositPercent: number; depositMinServicePence: number; serviceOverridePence: number | null; isConsultation: boolean; isPatchTest: boolean; }`
  - `export function resolveDepositPence(input: DepositPolicyInput): number`
  - `export function poundsFromPence(pence: number): string`

- [ ] **Step 1: 寫失敗嘅測試**

建立 `src/app/services/deposit-policy.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDepositPence, poundsFromPence } from './deposit-policy';

function baseInput(overrides: Partial<Parameters<typeof resolveDepositPence>[0]> = {}) {
  return {
    depositsEnabled: true,
    servicePricePence: 10000,
    depositPercent: 20,
    depositMinServicePence: 5000,
    serviceOverridePence: null,
    isConsultation: false,
    isPatchTest: false,
    ...overrides,
  };
}

test('deposits disabled → 0，即使其他條件全部符合', () => {
  assert.equal(resolveDepositPence(baseInput({ depositsEnabled: false })), 0);
});

test('免費 consultation → 0', () => {
  assert.equal(
    resolveDepositPence(baseInput({ isConsultation: true, servicePricePence: 0 })),
    0,
  );
});

test('patch test 收足全數，唔係百分比', () => {
  assert.equal(
    resolveDepositPence(baseInput({ isPatchTest: true, servicePricePence: 1500 })),
    1500,
  );
});

test('patch test 優先於 percent 同 override', () => {
  assert.equal(
    resolveDepositPence(
      baseInput({ isPatchTest: true, servicePricePence: 1500, serviceOverridePence: 9999, depositPercent: 50 }),
    ),
    1500,
  );
});

test('service override 蓋過百分比', () => {
  assert.equal(resolveDepositPence(baseInput({ serviceOverridePence: 2500 })), 2500);
});

test('override 係 0 都要當有效（即係明確唔收）', () => {
  assert.equal(resolveDepositPence(baseInput({ serviceOverridePence: 0 })), 0);
});

test('平過最低門檻 → 0', () => {
  assert.equal(resolveDepositPence(baseInput({ servicePricePence: 4999 })), 0);
});

test('啱啱等於門檻 → 要收', () => {
  assert.equal(resolveDepositPence(baseInput({ servicePricePence: 5000 })), 1000);
});

test('百分比四捨五入到最近嘅 pence', () => {
  assert.equal(resolveDepositPence(baseInput({ servicePricePence: 33900, depositPercent: 20 })), 6780);
  assert.equal(resolveDepositPence(baseInput({ servicePricePence: 999, depositPercent: 33, depositMinServicePence: 0 })), 330);
});

test('percent 係 0 → 0', () => {
  assert.equal(resolveDepositPence(baseInput({ depositPercent: 0 })), 0);
});

test('按金唔可以超過服務價錢', () => {
  assert.equal(resolveDepositPence(baseInput({ depositPercent: 150 })), 10000);
  assert.equal(resolveDepositPence(baseInput({ serviceOverridePence: 999999 })), 10000);
});

test('poundsFromPence 永遠兩位小數', () => {
  assert.equal(poundsFromPence(1500), '15.00');
  assert.equal(poundsFromPence(6780), '67.80');
  assert.equal(poundsFromPence(5), '0.05');
  assert.equal(poundsFromPence(0), '0.00');
});
```

- [ ] **Step 2: 行測試，確認佢真係 fail**

Run: `pnpm test 2>&1 | grep -A5 deposit-policy`
Expected: FAIL —— `Cannot find module './deposit-policy'`

- [ ] **Step 3: 寫最小實作**

建立 `src/app/services/deposit-policy.ts`：

```ts
// 純決策邏輯：一個 service 要收幾多按金。
//
// 零 import —— 同 booking-gates.ts 一樣，咁樣先可以唔駁 Square、唔駁 DB
// 就窮舉晒所有組合嚟測。DB 讀取留喺 actions/booking.ts 果邊。
//
// 所有金額都係 pence（integer）。浮點數唔可以攞嚟算錢。

export interface DepositPolicyInput {
  depositsEnabled: boolean;
  servicePricePence: number;
  depositPercent: number;
  depositMinServicePence: number;
  /** Service.depositOverridePence —— null 代表冇 override，0 代表明確唔收 */
  serviceOverridePence: number | null;
  isConsultation: boolean;
  isPatchTest: boolean;
}

export function resolveDepositPence(input: DepositPolicyInput): number {
  if (!input.depositsEnabled) return 0;

  // 免費 consultation 冇嘢可以 hold。
  if (input.isConsultation && input.servicePricePence === 0) return 0;

  // Consultation & Patch Test 本身就係有價服務（£15）—— 收足全數，
  // 唔係按金。呢個要行喺 override / percent 之前。
  if (input.isPatchTest) return input.servicePricePence;

  const raw =
    input.serviceOverridePence !== null
      ? input.serviceOverridePence
      : input.servicePricePence < input.depositMinServicePence
        ? 0
        : Math.round((input.servicePricePence * input.depositPercent) / 100);

  // 無論點計，按金唔可以多過服務本身。
  return Math.min(raw, input.servicePricePence);
}

/** Square verifyBuyer 同顯示用嘅鎊字串。 */
export function poundsFromPence(pence: number): string {
  return (pence / 100).toFixed(2);
}
```

- [ ] **Step 4: 行測試，確認 pass**

Run: `pnpm test 2>&1 | grep -A5 deposit-policy`
Expected: PASS，13 個 test 全部綠

- [ ] **Step 5: Commit**

```bash
git add src/app/services/deposit-policy.ts src/app/services/deposit-policy.test.ts
git commit -m "feat(deposits): add pure deposit amount policy"
```

---

## Task 2: Prisma schema

**Files:**
- Modify: `prisma/dev/schema.prisma`
- Modify: `prisma/vercel/schema.prisma`
- Modify: `prisma/prod/schema.prisma`

**Interfaces:**
- Consumes: 冇
- Produces: `Appointment.depositAmount / depositStatus / squarePaymentId / depositAuthorizedAt / depositCapturedAt`、`SiteSettings.depositsEnabled / depositPercent / depositMinServicePence`、`Service.depositOverridePence`

- [ ] **Step 1: 三個 schema 都加 field**

`Appointment` model 加（三個檔案）：

```prisma
  depositAmount       Decimal?
  depositStatus       String    @default("NOT_REQUIRED")
  // NOT_REQUIRED | AUTHORIZED | CAPTURED | VOIDED | REFUNDED | FAILED
  squarePaymentId     String?   @unique
  depositAuthorizedAt DateTime?
  depositCapturedAt   DateTime?
```

同埋喺 `Appointment` 嘅 `@@index` 區加：

```prisma
  @@index([depositStatus, updatedAt])
```

`SiteSettings` model 加：

```prisma
  depositsEnabled        Boolean @default(false)
  depositPercent         Int     @default(0)
  depositMinServicePence Int     @default(0)
```

`Service` model 加：

```prisma
  depositOverridePence Int?
```

> `depositStatus` 用 String 而唔用 enum，係跟返隔籬 `treatwellSyncStatus` 嘅做法 —— 三個 provider（sqlite / postgres / sqlserver）之間 enum 支援唔一致。
> `depositsEnabled` default `false` 係**明知要 fail closed** —— 同 `bookingEnabled` 一樣，新環境唔會無啦啦開始收錢。

- [ ] **Step 2: 確認三個檔案真係改晒**

Run:
```bash
grep -c "depositStatus" prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma
```
Expected: 三個都係 `1`。如果有 `0`，即係漏咗，返去補。

- [ ] **Step 3: 生成 client 同 migration**

```bash
pnpm db:vercel:generate
pnpm db:vercel:migrate --name add_square_deposit_fields
```

- [ ] **Step 4: 確認 type 出到**

Run: `npx tsc --noEmit 2>&1 | grep -v colorMath | head`
Expected: 除咗 `colorMath.test.ts` 嗰 4 個已知錯誤之外，冇新錯誤

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(deposits): add deposit fields to Appointment, SiteSettings and Service"
```

---

## Task 3: Square config 解析

**Files:**
- Create: `src/app/lib/square-config.ts`
- Create: `src/app/lib/square-config.test.ts`

**Interfaces:**
- Consumes: 冇
- Produces:
  - `export interface SquareConfig { token: string; locationId: string; environment: 'sandbox' | 'production'; }`
  - `export function resolveSquareConfig(env: Record<string, string | undefined>): SquareConfig | null`

- [ ] **Step 1: 寫失敗嘅測試**

建立 `src/app/lib/square-config.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSquareConfig } from './square-config';

const full = {
  SQUARE_ACCESS_TOKEN: 'EAAA-token',
  SQUARE_LOCATION_ID: 'L123',
  SQUARE_ENV: 'production',
};

test('齊料 → 解析到', () => {
  assert.deepEqual(resolveSquareConfig(full), {
    token: 'EAAA-token',
    locationId: 'L123',
    environment: 'production',
  });
});

test('SQUARE_ENV 唔係 production 就當 sandbox', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ENV: 'sandbox' })?.environment, 'sandbox');
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ENV: undefined })?.environment, 'sandbox');
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ENV: 'Production' })?.environment, 'sandbox');
});

test('缺 token → null', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ACCESS_TOKEN: undefined }), null);
});

test('缺 location → null', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_LOCATION_ID: undefined }), null);
});

test('[SENSITIVE] placeholder 要當做冇配置', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ACCESS_TOKEN: '[SENSITIVE]' }), null);
  assert.equal(resolveSquareConfig({ ...full, SQUARE_LOCATION_ID: '[SENSITIVE]' }), null);
});

test('空白字串同淨係空格都當冇配置', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ACCESS_TOKEN: '' }), null);
  assert.equal(resolveSquareConfig({ ...full, SQUARE_ACCESS_TOKEN: '   ' }), null);
});

test('前後空格會被 trim', () => {
  assert.equal(resolveSquareConfig({ ...full, SQUARE_LOCATION_ID: '  L123  ' })?.locationId, 'L123');
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `pnpm test 2>&1 | grep -A5 square-config`
Expected: FAIL —— `Cannot find module './square-config'`

- [ ] **Step 3: 寫實作**

建立 `src/app/lib/square-config.ts`：

```ts
// Square 憑證解析。純函數 —— 收一個 env object 而唔係直接讀 process.env，
// 咁先測到 [SENSITIVE] 同缺料嘅情況。
//
// 點解要 guard [SENSITIVE]：Vercel project 開咗 sensitive env var policy，
// 喺外部 CI（GitHub Actions `vercel build`）呢啲變數會變成字面值
// "[SENSITIVE]" 而唔係真值。當佢係冇配置，等上層 fail closed。
// 同 site-url.ts 一樣嘅手法。

const SENSITIVE_PLACEHOLDER = '[SENSITIVE]';

export interface SquareConfig {
  token: string;
  locationId: string;
  environment: 'sandbox' | 'production';
}

function usable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SENSITIVE_PLACEHOLDER) return null;
  return trimmed;
}

export function resolveSquareConfig(
  env: Record<string, string | undefined>,
): SquareConfig | null {
  const token = usable(env.SQUARE_ACCESS_TOKEN);
  const locationId = usable(env.SQUARE_LOCATION_ID);
  if (!token || !locationId) return null;

  return {
    token,
    locationId,
    environment: env.SQUARE_ENV?.trim() === 'production' ? 'production' : 'sandbox',
  };
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `pnpm test 2>&1 | grep -A5 square-config`
Expected: PASS，7 個 test 全綠

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/square-config.ts src/app/lib/square-config.test.ts
git commit -m "feat(deposits): add Square config resolution with sensitive-placeholder guard"
```

---

## Task 4: Deposit gateway

**Files:**
- Create: `src/app/lib/square.ts`
- Create: `src/app/services/deposit-service.ts`
- Create: `src/app/services/deposit-service.test.ts`

**Interfaces:**
- Consumes: `resolveSquareConfig` (Task 3)、`poundsFromPence` (Task 1)
- Produces:
  - `export interface AuthorizeParams { sourceId: string; verificationToken: string; amountPence: number; idempotencyKey: string; note: string; }`
  - `export interface DepositGateway { authorize(p: AuthorizeParams): Promise<{ paymentId: string }>; capture(paymentId: string): Promise<void>; voidAuth(paymentId: string): Promise<void>; }`
  - `export async function getDepositGateway(): Promise<DepositGateway | null>`
  - `export function buildIdempotencyKey(userId: string, serviceId: string, date: string, time: string): string`

- [ ] **Step 1: 裝 SDK**

```bash
pnpm add square
```

- [ ] **Step 2: 寫失敗嘅測試**

建立 `src/app/services/deposit-service.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdempotencyKey } from './deposit-service';

test('同樣輸入永遠出同一個 key（客戶撳兩次唔會 hold 兩次）', () => {
  const a = buildIdempotencyKey('u1', 's1', '2026-10-01', '14:30');
  const b = buildIdempotencyKey('u1', 's1', '2026-10-01', '14:30');
  assert.equal(a, b);
});

test('唔同 slot 出唔同 key', () => {
  const a = buildIdempotencyKey('u1', 's1', '2026-10-01', '14:30');
  const b = buildIdempotencyKey('u1', 's1', '2026-10-01', '15:00');
  assert.notEqual(a, b);
});

test('唔同 user 出唔同 key', () => {
  const a = buildIdempotencyKey('u1', 's1', '2026-10-01', '14:30');
  const b = buildIdempotencyKey('u2', 's1', '2026-10-01', '14:30');
  assert.notEqual(a, b);
});

test('key 長度喺 Square 上限 45 字以內', () => {
  const key = buildIdempotencyKey(
    'clxxxxxxxxxxxxxxxxxxxxxxxx',
    'clyyyyyyyyyyyyyyyyyyyyyyyy',
    '2026-10-01',
    '14:30',
  );
  assert.ok(key.length <= 45, `key 太長: ${key.length}`);
});
```

- [ ] **Step 3: 行測試確認 fail**

Run: `pnpm test 2>&1 | grep -A5 deposit-service`
Expected: FAIL —— `Cannot find module './deposit-service'`

- [ ] **Step 4: 寫 client factory**

建立 `src/app/lib/square.ts`：

```ts
import 'server-only';
import { SquareClient, SquareEnvironment } from 'square';
import { resolveSquareConfig } from './square-config';

// 一定要係 function —— module level 讀 env 會喺 build time 攞到
// [SENSITIVE] 或者 undefined。
export async function getSquareClient(): Promise<{
  client: SquareClient;
  locationId: string;
} | null> {
  const config = resolveSquareConfig(process.env);
  if (!config) return null;

  return {
    client: new SquareClient({
      token: config.token,
      environment:
        config.environment === 'production'
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    }),
    locationId: config.locationId,
  };
}
```

- [ ] **Step 5: 寫 gateway**

建立 `src/app/services/deposit-service.ts`：

```ts
import 'server-only';
import { createHash } from 'node:crypto';
import { getSquareClient } from '@/app/lib/square';

export interface AuthorizeParams {
  sourceId: string;
  verificationToken: string;
  amountPence: number;
  idempotencyKey: string;
  note: string;
}

export interface DepositGateway {
  authorize(p: AuthorizeParams): Promise<{ paymentId: string }>;
  capture(paymentId: string): Promise<void>;
  voidAuth(paymentId: string): Promise<void>;
}

/**
 * 同一個 (user, service, slot) 永遠出同一個 key，所以客戶連撳兩下
 * submit 只會 hold 一次。Square 上限 45 字，所以要 hash。
 */
export function buildIdempotencyKey(
  userId: string,
  serviceId: string,
  date: string,
  time: string,
): string {
  return createHash('sha256')
    .update(`${userId}:${serviceId}:${date}:${time}`)
    .digest('hex')
    .slice(0, 40);
}

export async function getDepositGateway(): Promise<DepositGateway | null> {
  const square = await getSquareClient();
  if (!square) return null;

  const { client, locationId } = square;

  return {
    async authorize(p) {
      const res = await client.payments.create({
        sourceId: p.sourceId,
        verificationToken: p.verificationToken,
        idempotencyKey: p.idempotencyKey,
        locationId,
        amountMoney: { amount: BigInt(p.amountPence), currency: 'GBP' },
        // 核心：淨係授權，唔扣錢。card-not-present 個 hold 有 7 日，
        // 到期自動 CANCEL（delayAction 用返 default）。
        autocomplete: false,
        note: p.note,
      });

      const paymentId = res.payment?.id;
      if (!paymentId) throw new Error('Square returned no payment id');
      return { paymentId };
    },

    async capture(paymentId) {
      await client.payments.complete({ paymentId });
    },

    async voidAuth(paymentId) {
      await client.payments.cancel({ paymentId });
    },
  };
}
```

- [ ] **Step 6: 行測試確認 pass**

Run: `pnpm test 2>&1 | grep -A5 deposit-service`
Expected: PASS，4 個 test 全綠

- [ ] **Step 7: 確認 SDK 嘅實際 export**

Run: `node -e "const s=require('square'); console.log(Object.keys(s).filter(k=>/Client|Environment|Webhook/.test(k)))"`
Expected: 睇到 `SquareClient`、`SquareEnvironment`。**順手記低 webhook helper 嘅實際名**（Task 9 要用，新版 SDK 搬過位）。

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/lib/square.ts src/app/services/deposit-service.ts src/app/services/deposit-service.test.ts
git commit -m "feat(deposits): add Square deposit gateway with delayed capture"
```

---

## Task 5: CSP 放行 Square

冇呢步張卡**一定 render 唔到** —— Square 嘅卡片欄係一個 iframe，JS 由 `web.squarecdn.com` 載。

**Files:**
- Create: `src/app/lib/csp.ts`
- Create: `src/app/lib/csp.test.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: 冇
- Produces: `export function buildCsp(opts: { isDev: boolean; squareEnv: string | undefined }): string`

> ⚠️ `csp.ts` **唔可以有 `import 'server-only'`** —— `next.config.ts` 喺 build time 用普通 Node 載佢。

- [ ] **Step 1: 寫失敗嘅測試**

建立 `src/app/lib/csp.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp } from './csp';

function directive(csp: string, name: string): string {
  const found = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  assert.ok(found, `搵唔到 directive: ${name}`);
  return found;
}

test('production 用 web.squarecdn.com', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'script-src'), /https:\/\/web\.squarecdn\.com/);
  assert.match(directive(csp, 'frame-src'), /https:\/\/web\.squarecdn\.com/);
  assert.ok(!directive(csp, 'script-src').includes('sandbox.web.squarecdn.com'));
});

test('sandbox 用 sandbox.web.squarecdn.com', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'sandbox' });
  assert.match(directive(csp, 'script-src'), /https:\/\/sandbox\.web\.squarecdn\.com/);
  assert.match(directive(csp, 'frame-src'), /https:\/\/sandbox\.web\.squarecdn\.com/);
});

test('SQUARE_ENV 冇設定 → 當 sandbox', () => {
  const csp = buildCsp({ isDev: false, squareEnv: undefined });
  assert.match(directive(csp, 'script-src'), /sandbox\.web\.squarecdn\.com/);
});

test('script-src-elem 同 script-src 一齊放行 Square', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'script-src-elem'), /https:\/\/web\.squarecdn\.com/);
});

test('font-src 放行 Square 字型', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'font-src'), /https:\/\/square-fonts-production-f\.squarecdn\.com/);
});

test('connect-src 放行 PCI endpoint', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'connect-src'), /https:\/\/pci-connect\.squareup\.com/);
});

test('frame-src 保留返 Google Maps', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'frame-src'), /https:\/\/www\.google\.com/);
});

test('prod 唔可以有 unsafe-eval，dev 先可以', () => {
  assert.ok(!buildCsp({ isDev: false, squareEnv: 'production' }).includes("'unsafe-eval'"));
  assert.ok(buildCsp({ isDev: true, squareEnv: 'sandbox' }).includes("'unsafe-eval'"));
});

test('保留現有嘅 analytics 同 jsdelivr 來源', () => {
  const csp = buildCsp({ isDev: false, squareEnv: 'production' });
  assert.match(directive(csp, 'script-src'), /googletagmanager\.com/);
  assert.match(directive(csp, 'script-src'), /google-analytics\.com/);
  assert.match(directive(csp, 'script-src'), /cdn\.jsdelivr\.net/);
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `pnpm test 2>&1 | grep -A5 "csp"`
Expected: FAIL —— `Cannot find module './csp'`

- [ ] **Step 3: 抽出 CSP builder**

建立 `src/app/lib/csp.ts`（內容由 `next.config.ts` 現有嘅 csp 搬過嚟再加 Square）：

```ts
// CSP builder。抽出嚟做純函數，令 next.config.ts 嗰串嘢測到。
// 注意：唔可以 import 'server-only' —— next.config.ts 喺 build time
// 用普通 Node 載呢個檔案。

export function buildCsp(opts: { isDev: boolean; squareEnv: string | undefined }): string {
  // React dev mode 用 eval() 做 callstack 重建，prod 保持嚴格。
  const scriptSrcEval = opts.isDev ? " 'unsafe-eval'" : '';

  // Square 嘅 sandbox 同 production 係唔同 host，兩個都要對得啱，
  // 唔係 iframe 會被擋。
  const square =
    opts.squareEnv?.trim() === 'production'
      ? 'https://web.squarecdn.com'
      : 'https://sandbox.web.squarecdn.com';

  const analytics = 'https://www.googletagmanager.com https://www.google-analytics.com';

  return (
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${scriptSrcEval} ${analytics} https://cdn.jsdelivr.net ${square}`,
      `script-src-elem 'self' 'unsafe-inline' ${analytics} https://cdn.jsdelivr.net ${square}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      `font-src 'self' data: https://square-fonts-production-f.squarecdn.com`,
      `connect-src 'self' https: ${square} https://pci-connect.squareup.com`,
      `frame-src https://www.google.com ${square}`,
      "worker-src 'self' blob:",
    ].join('; ') + ';'
  );
}
```

- [ ] **Step 4: 改 `next.config.ts` 用返佢**

刪走 `next.config.ts` 頂嗰段 `const isDev` / `scriptSrcEval` / `csp` 定義，換成：

```ts
import { buildCsp } from './src/app/lib/csp';

const csp = buildCsp({
  isDev: process.env.NODE_ENV !== 'production',
  squareEnv: process.env.SQUARE_ENV,
});
```

`headers()` 入面嗰行 `{ key: 'Content-Security-Policy', value: csp }` 唔使郁。

- [ ] **Step 5: 行測試確認 pass**

Run: `pnpm test 2>&1 | grep -A5 "csp"`
Expected: PASS，9 個 test 全綠

- [ ] **Step 6: 確認 build 仲行到**

Run: `npx tsc --noEmit 2>&1 | grep -v colorMath | head`
Expected: 冇新錯誤

- [ ] **Step 7: Commit**

```bash
git add src/app/lib/csp.ts src/app/lib/csp.test.ts next.config.ts
git commit -m "feat(deposits): allow Square CDN and PCI endpoints in CSP"
```

---

## Task 6: Settings、rate limiter、admin 開關

**Files:**
- Modify: `src/app/lib/rate-limit.ts`
- Modify: `src/app/actions/admin-settings.ts`
- Modify: `src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: Task 2 嘅 `SiteSettings` field
- Produces: `export const depositLimiter: RateLimiter`

- [ ] **Step 1: 加 rate limiter**

`src/app/lib/rate-limit.ts` 喺其他 limiter 隔籬加一行：

```ts
export const depositLimiter = createRateLimiter({ prefix: 'rl:deposit', limit: 10, windowSeconds: 60 * 60 });
```

> 直接跟返現有 pattern。**唔好**喺 call site 寫 `if (limiter)` —— `createRateLimiter` 本身喺 Redis 掛咗嗰陣會 degrade 去 in-process 限制，唔會 fail open。

- [ ] **Step 2: Settings action 加三個 field**

`src/app/actions/admin-settings.ts`：喺現有嘅 zod schema 加

```ts
  depositsEnabled: z.coerce.boolean(),
  depositPercent: z.coerce.number().int().min(0).max(100),
  depositMinServicePence: z.coerce.number().int().min(0),
```

同埋喺 `prisma.siteSettings.update` 嘅 `data` 加返呢三個。

- [ ] **Step 3: Admin UI 加控制項**

`src/app/admin/settings/page.tsx`：喺 `bookingEnabled` 個 toggle 隔籬加落同一個 `<form>` 入面。**Class 要抄返隔籬 field 現有嘅**（下面係 monochrome 基準，如果現有 field 用緊唔同 class，以現有嗰個為準）：

```tsx
<div className="space-y-4 border-t border-neutral-200 pt-4">
  <label className="flex items-center gap-3">
    <input
      type="checkbox"
      name="depositsEnabled"
      defaultChecked={settings.depositsEnabled}
      className="h-4 w-4 accent-neutral-900"
    />
    <span className="text-sm font-medium text-neutral-900">收取預約按金</span>
  </label>

  <label className="block">
    <span className="text-sm font-medium text-neutral-900">按金百分比</span>
    <input
      type="number"
      name="depositPercent"
      min={0}
      max={100}
      defaultValue={settings.depositPercent}
      className="mt-1 w-32 border border-neutral-300 px-3 py-2 text-neutral-900"
    />
    <span className="mt-1 block text-xs text-neutral-600">
      按金 = 服務價錢 × 呢個百分比。Consultation &amp; Patch Test 永遠收足全數；免費 consultation 唔收。
    </span>
  </label>

  <label className="block">
    <span className="text-sm font-medium text-neutral-900">最低服務價錢（pence）</span>
    <input
      type="number"
      name="depositMinServicePence"
      min={0}
      defaultValue={settings.depositMinServicePence}
      className="mt-1 w-32 border border-neutral-300 px-3 py-2 text-neutral-900"
    />
    <span className="mt-1 block text-xs text-neutral-600">
      平過呢個價嘅服務唔收按金。5000 = £50。
    </span>
  </label>
</div>
```

- [ ] **Step 4: 驗證**

Run: `pnpm test && npx tsc --noEmit 2>&1 | grep -v colorMath | head && pnpm lint`
Expected: test 全綠、冇新 tsc 錯誤、lint 乾淨

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/rate-limit.ts src/app/actions/admin-settings.ts src/app/admin/settings/page.tsx
git commit -m "feat(deposits): add deposit settings to admin and a deposit rate limiter"
```

---

## Task 7: 接落 `submitBooking`

成個 plan 最容易出錯嘅一步。**次序係規格嘅一部分，唔可以改。**

**Files:**
- Modify: `src/app/actions/booking.ts:47-76`（`createBookingSchema`）
- Modify: `src/app/actions/booking.ts:198+`（`submitBooking`）

**Interfaces:**
- Consumes: `resolveDepositPence`、`poundsFromPence` (Task 1)、`getDepositGateway`、`buildIdempotencyKey` (Task 4)、`depositLimiter` (Task 6)
- Produces: `submitBooking` 額外收 `squareSourceId?: string`、`squareVerificationToken?: string`

- [ ] **Step 1: 擴充 input schema**

`createBookingSchema` 加：

```ts
  squareSourceId: z.string().min(1).max(500).optional(),
  squareVerificationToken: z.string().min(1).max(2000).optional(),
```

- [ ] **Step 2: 喺 gate 之後、開單之前計按金**

喺 `submitBooking` 入面，**`if (!gate.ok) return ...` 之後**，插入：

```ts
  // 按金：喺 gate 全部通過之後先計，因為被拒嘅 booking 唔應該 hold 客戶張卡。
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  const servicePricing = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { price: true, depositOverridePence: true },
  });

  const depositPence = resolveDepositPence({
    depositsEnabled: settings?.depositsEnabled ?? false,
    servicePricePence: Math.round(Number(servicePricing?.price ?? 0) * 100),
    depositPercent: settings?.depositPercent ?? 0,
    depositMinServicePence: settings?.depositMinServicePence ?? 0,
    serviceOverridePence: servicePricing?.depositOverridePence ?? null,
    isConsultation: service.isConsultation,
    isPatchTest: service.isPatchTest,
  });
```

> `service` 嗰個 `findUnique` 嘅 `select` 記住補返 `isConsultation: true, isPatchTest: true` —— 現有 code 已經揀咗呢兩個 field，確認一下就得。

- [ ] **Step 3: 需要按金就授權（transaction 外面）**

```ts
  let squarePaymentId: string | null = null;

  if (depositPence > 0) {
    if (!(await depositLimiter.check(`user:${session.userId}`))) {
      return { success: false, error: 'Too many payment attempts. Please try again shortly.' };
    }

    if (!validData.squareSourceId || !validData.squareVerificationToken) {
      return { success: false, error: 'Card details are required to secure this booking.' };
    }

    const gateway = await getDepositGateway();
    // Fail closed：開咗按金但 Square 冇配置好，寧願唔畀 book，
    // 都好過靜靜雞免費開單。同 assertOnlineBookingReady 一樣嘅取態。
    if (!gateway) {
      console.error('Deposits enabled but Square is not configured');
      return { success: false, error: BOOKING_MAINTENANCE_MESSAGE };
    }

    try {
      const authorized = await gateway.authorize({
        sourceId: validData.squareSourceId,
        verificationToken: validData.squareVerificationToken,
        amountPence: depositPence,
        idempotencyKey: buildIdempotencyKey(
          session.userId, validData.serviceId, validData.date, validData.time,
        ),
        note: `Deposit — ${validData.date} ${validData.time}`,
      });
      squarePaymentId = authorized.paymentId;
    } catch (error) {
      console.error('Deposit authorization failed:', error);
      return { success: false, error: 'We could not authorise your card. Please check the details and try again.' };
    }
  }
```

- [ ] **Step 4: 開單失敗就即刻 void**

將現有嘅 `try { ... } catch` 個 catch block 改成：

```ts
  } catch (error) {
    console.error('Booking failed:', error);

    // 授權咗但開唔到單（通常係 slot 畀人搶咗）→ 即刻放返個 hold。
    // 就算呢度失敗都唔算災難：card-not-present 個 hold 7 日後
    // 會自動 CANCEL。
    if (squarePaymentId) {
      try {
        const gateway = await getDepositGateway();
        await gateway?.voidAuth(squarePaymentId);
      } catch (voidError) {
        console.error('Failed to void deposit after booking failure:', voidError, { squarePaymentId });
      }
    }

    const message = error instanceof BookingError ? error.message : 'Failed to create booking';
    return { success: false, error: message };
  }
```

- [ ] **Step 5: 開單成功就寫低按金狀態**

喺 `await dispatchAppointmentNotifications(appointment.id);` **之前**加：

```ts
    if (squarePaymentId) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          depositAmount: depositPence / 100,
          depositStatus: 'AUTHORIZED',
          squarePaymentId,
          depositAuthorizedAt: new Date(),
        },
      });
    }
```

- [ ] **Step 6: 加 import**

`src/app/actions/booking.ts` 最上面加：

```ts
import { resolveDepositPence } from '@/app/services/deposit-policy';
import { getDepositGateway, buildIdempotencyKey } from '@/app/services/deposit-service';
import { depositLimiter } from '@/app/lib/rate-limit';
```

- [ ] **Step 7: 驗證**

Run: `pnpm test && npx tsc --noEmit 2>&1 | grep -v colorMath | head`
Expected: 現有嘅 `booking-concurrency.test.ts` 同 `booking-persistence.test.ts` 全部仲要綠。如果紅咗，即係你改壞咗次序 —— 返去 Step 3 對返。

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/booking.ts
git commit -m "feat(deposits): authorise deposit before creating booking, void on failure"
```

---

## Task 8: Admin 批核 → capture；拒絕 → void

**Files:**
- Modify: `src/app/actions/admin.ts`（`updateAppointmentStatus`）

**Interfaces:**
- Consumes: `getDepositGateway` (Task 4)
- Produces: 冇新 export

- [ ] **Step 1: 喺 transaction 入面帶埋按金 field**

`updateAppointmentStatus` 嗰個 `include` 已經攞晒 relation，但 `squarePaymentId` / `depositStatus` 係 scalar，本身就會出。確認 `current` 用到 `current.squarePaymentId` 同 `current.depositStatus`。

- [ ] **Step 2: transaction 之後做 capture / void**

喺 `if (changed) await dispatchAppointmentNotifications(appointment.id);` **之前**插入：

```ts
    // 錢嘅動作一定要喺 transaction 之後 —— runSerializableWithRetry 會
    // retry，HTTP call 擺入面會重複扣錢。capture 失敗唔可以擋住批核：
    // 記低 FAILED 等人跟。
    if (changed && appointment.squarePaymentId) {
      const gateway = await getDepositGateway();
      if (gateway) {
        try {
          if (status === 'CONFIRMED' && appointment.depositStatus === 'AUTHORIZED') {
            await gateway.capture(appointment.squarePaymentId);
            await prisma.appointment.update({
              where: { id: appointment.id },
              data: { depositStatus: 'CAPTURED', depositCapturedAt: new Date() },
            });
          } else if (status === 'CANCELLED' && appointment.depositStatus === 'AUTHORIZED') {
            await gateway.voidAuth(appointment.squarePaymentId);
            await prisma.appointment.update({
              where: { id: appointment.id },
              data: { depositStatus: 'VOIDED' },
            });
          }
        } catch (error) {
          console.error('Deposit settlement failed:', error, {
            appointmentId: appointment.id,
            squarePaymentId: appointment.squarePaymentId,
            status,
          });
          await prisma.appointment.update({
            where: { id: appointment.id },
            data: { depositStatus: 'FAILED' },
          });
        }
      }
    }
```

- [ ] **Step 3: 加 import**

```ts
import { getDepositGateway } from '@/app/services/deposit-service';
```

- [ ] **Step 4: 驗證**

Run: `pnpm test && npx tsc --noEmit 2>&1 | grep -v colorMath | head`
Expected: `admin-schedule.test.ts` 同其他現有 test 全綠

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/admin.ts
git commit -m "feat(deposits): capture deposit on confirm, void on decline"
```

---

## Task 9: Square webhook

**Files:**
- Create: `src/app/api/webhooks/square/route.ts`

**Interfaces:**
- Consumes: `resolveSquareConfig` (Task 3)
- Produces: `POST /api/webhooks/square`

- [ ] **Step 1: 確認 middleware 冇擋住**

Run: `grep -n "matcher\|/api" src/middleware.ts`
Expected: `/api/webhooks` **唔應該**喺受保護清單。如果被 match 到，喺 matcher 加 exclusion。

- [ ] **Step 2: 寫 route**

建立 `src/app/api/webhooks/square/route.ts`：

```ts
import { NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

// 外部 callback，唔可以 cache。
export const dynamic = 'force-dynamic';

// Square 事件 → 我哋嘅 depositStatus
const STATUS_MAP: Record<string, string> = {
  COMPLETED: 'CAPTURED',
  CANCELED: 'VOIDED',
  FAILED: 'FAILED',
};

export async function POST(request: Request) {
  // 一定要 raw body 先驗到簽名 —— 唔可以先 json() 再 stringify 返轉頭。
  const body = await request.text();
  const signature = request.headers.get('x-square-hmacsha256-signature');
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL?.trim();

  if (!signature || !signatureKey || signatureKey === '[SENSITIVE]' || !notificationUrl) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  // ⚠️ Task 4 Step 7 已經確認咗 webhook helper 嘅實際 export 名。
  // 用返嗰個名 import，簽名唔啱就回 401。
  const { WebhooksHelper } = await import('square');
  const valid = await WebhooksHelper.verifySignature({
    requestBody: body,
    signatureHeader: signature,
    signatureKey,
    notificationUrl,
  });
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body) as {
    type?: string;
    data?: { object?: { payment?: { id?: string; status?: string } } };
  };

  const payment = event.data?.object?.payment;
  const mapped = payment?.status ? STATUS_MAP[payment.status] : undefined;

  // 只認我哋識嘅狀態，其餘照回 200（唔好令 Square 不停 retry）。
  if (payment?.id && mapped) {
    await prisma.appointment.updateMany({
      where: { squarePaymentId: payment.id },
      data: { depositStatus: mapped },
    });
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 3: 加 env var**

```bash
npx vercel env add SQUARE_WEBHOOK_SIGNATURE_KEY production
npx vercel env add SQUARE_WEBHOOK_URL production
# SQUARE_WEBHOOK_URL = https://www.harbourhair.co.uk/api/webhooks/square
```

> 用 www 個 canonical domain。**唔好**用 `harbourhairsalon.vercel.app` —— 佢已經 308 redirect 去 www，簽名驗證會對唔上。

- [ ] **Step 4: 驗證**

Run: `npx tsc --noEmit 2>&1 | grep -v colorMath | head && pnpm lint`
Expected: 冇新錯誤

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(deposits): add Square webhook for payment status reconciliation"
```

---

## Task 10: 前端卡片欄

**Files:**
- Create: `src/components/booking/SquareCardField.tsx`
- Modify: `src/components/booking/BookingWizard.tsx`

**Interfaces:**
- Consumes: `resolveDepositPence`、`poundsFromPence` (Task 1)、`submitBooking` 新增嘅 `squareSourceId` / `squareVerificationToken` 參數 (Task 7)
- Produces:
  - `export interface CardCollector { collect: () => Promise<{ sourceId: string; verificationToken: string }>; }`
  - `export function SquareCardField(props: { amountPounds: string; givenName: string; familyName: string; email: string; onReady: (c: CardCollector | null) => void }): JSX.Element`

- [ ] **Step 1: 加前端 env var**

```bash
npx vercel env add NEXT_PUBLIC_SQUARE_APPLICATION_ID production
npx vercel env add NEXT_PUBLIC_SQUARE_LOCATION_ID production
npx vercel env add NEXT_PUBLIC_SQUARE_ENV production
```

> 呢三個會 inline 入 client bundle —— 只可以放 public 值。**access token 永遠唔可以加 `NEXT_PUBLIC_`。**

- [ ] **Step 2: 寫 component**

建立 `src/components/booking/SquareCardField.tsx`：

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const SQUARE_JS =
  process.env.NEXT_PUBLIC_SQUARE_ENV === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

export interface CardCollector {
  collect: () => Promise<{ sourceId: string; verificationToken: string }>;
}

export function SquareCardField({
  amountPounds,
  givenName,
  familyName,
  email,
  onReady,
}: {
  amountPounds: string;
  /**
   * billing 拆成 primitive 而唔收一個 object —— object 每次 render 都係
   * 新 identity，放入 effect 嘅 dependency array 會令張卡不停重新掛載。
   */
  givenName: string;
  familyName: string;
  email: string;
  onReady: (collector: CardCollector | null) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 同樣道理：parent 未必會 useCallback 包住 onReady，所以放 ref，
  // 唔好放入 dependency array，否則 attach → onReady → re-render →
  // 再 attach，變成無限 loop。
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!loaded || !containerRef.current) return;
    let cancelled = false;
    let cardInstance: { destroy?: () => void } | null = null;

    (async () => {
      const Square = (window as unknown as { Square?: any }).Square;
      if (!Square) {
        setError('Payment form failed to load. Please refresh and try again.');
        return;
      }

      try {
        const payments = Square.payments(
          process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
          process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
        );

        // Monochrome —— 跟品牌，唔好加顏色。
        const card = await payments.card({
          style: {
            input: { color: '#111111', fontSize: '16px' },
            '.input-container': { borderColor: '#d4d4d4', borderRadius: '2px' },
            '.input-container.is-focus': { borderColor: '#111111' },
            '.message-text.is-error': { color: '#111111' },
          },
        });
        if (cancelled) return;

        await card.attach(containerRef.current);
        cardInstance = card;

        onReadyRef.current({
          collect: async () => {
            const tokenResult = await card.tokenize();
            if (tokenResult.status !== 'OK') {
              throw new Error('Please check your card details.');
            }
            // 英國 SCA 強制。冇呢步會收到 CARD_DECLINED_VERIFICATION_REQUIRED。
            const verification = await payments.verifyBuyer(tokenResult.token, {
              amount: amountPounds,
              currencyCode: 'GBP',
              intent: 'CHARGE',
              billingContact: { givenName, familyName, email, countryCode: 'GB' },
            });
            return { sourceId: tokenResult.token, verificationToken: verification.token };
          },
        });
      } catch {
        setError('Payment form failed to load. Please refresh and try again.');
        onReadyRef.current(null);
      }
    })();

    return () => {
      cancelled = true;
      cardInstance?.destroy?.();
      onReadyRef.current(null);
    };
  }, [loaded, amountPounds, givenName, familyName, email]);

  return (
    <div className="space-y-2">
      <Script src={SQUARE_JS} strategy="afterInteractive" onLoad={() => setLoaded(true)} />
      <p className="text-sm text-neutral-600">
        我哋而家只會保留 £{amountPounds}，唔會即時扣錢。沙龍確認咗你嘅預約先會收取。
      </p>
      <div ref={containerRef} className="min-h-[90px]" />
      {error && <p className="text-sm text-neutral-900">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 接落 `BookingWizard`**

`src/components/booking/BookingWizard.tsx` 喺確認嗰步加。`depositSettings` 由 `src/app/book/page.tsx`（server component）傳落嚟做 prop：

```tsx
import { useCallback, useState } from 'react';
import { resolveDepositPence, poundsFromPence } from '@/app/services/deposit-policy';
import { SquareCardField, type CardCollector } from './SquareCardField';

const [collector, setCollector] = useState<CardCollector | null>(null);

// 一定要 useCallback —— 唔係每次 render 都係新 function。
const handleCardReady = useCallback((c: CardCollector | null) => setCollector(c), []);

const depositPence = resolveDepositPence({
  depositsEnabled: depositSettings.depositsEnabled,
  servicePricePence: Math.round(selectedService.price * 100),
  depositPercent: depositSettings.depositPercent,
  depositMinServicePence: depositSettings.depositMinServicePence,
  serviceOverridePence: selectedService.depositOverridePence ?? null,
  isConsultation: selectedService.isConsultation,
  isPatchTest: selectedService.isPatchTest,
});

// …render：
{depositPence > 0 && (
  <SquareCardField
    amountPounds={poundsFromPence(depositPence)}
    givenName={user.givenName}
    familyName={user.familyName}
    email={user.email}
    onReady={handleCardReady}
  />
)}
```

Submit handler：

```tsx
async function handleSubmit() {
  let card: { sourceId: string; verificationToken: string } | undefined;

  if (depositPence > 0) {
    if (!collector) {
      setError('Payment form is still loading. Please wait a moment.');
      return;
    }
    try {
      card = await collector.collect();
    } catch (e) {
      // collect() 掟錯就停 —— 絕對唔好照 call submitBooking，
      // 否則會開一單冇按金嘅 booking。
      setError(e instanceof Error ? e.message : 'Please check your card details.');
      return;
    }
  }

  const result = await submitBooking({
    ...bookingData,
    squareSourceId: card?.sourceId,
    squareVerificationToken: card?.verificationToken,
  });
}
```

> `selectedService` 要補埋 `depositOverridePence`、`isConsultation`、`isPatchTest` 入 server component 個 `select`，唔係 client 計唔到數。

- [ ] **Step 4: 驗證**

Run: `npx tsc --noEmit 2>&1 | grep -v colorMath | head && pnpm lint`
Expected: 冇新錯誤

- [ ] **Step 5: Commit**

```bash
git add src/components/booking/SquareCardField.tsx src/components/booking/BookingWizard.tsx
git commit -m "feat(deposits): collect card details with SCA in the booking wizard"
```

---

## Task 11: Sandbox 實測 + 上線

**Files:** 冇 code 改動

- [ ] **Step 1: Sandbox 跑一次完整流程**

用 Square sandbox 測試卡 `4111 1111 1111 1111`，任何未來到期日 + 任何 CVV。
**Location ID 一定要用英國嗰個**，唔係測唔到 3DS challenge。

要行齊四條路：

1. 落單 → Square Dashboard 睇到一張 **APPROVED**（唔係 COMPLETED）嘅 payment
2. Admin 批核 → 變 **COMPLETED**，`depositStatus = 'CAPTURED'`
3. Admin 拒絕另一單 → 變 **CANCELED**，`depositStatus = 'VOIDED'`，客戶戶口冇任何扣數
4. 兩個人搶同一個 slot → 輸嗰個張卡冇被 hold（或者即刻放返）

- [ ] **Step 2: 確認 fail-closed**

暫時刪走 `SQUARE_ACCESS_TOKEN`，開住 `depositsEnabled`，試落單。
Expected: booking **被拒絕**，唔可以免費開單成功。

- [ ] **Step 3: 上線前 checklist**

- [ ] 三個 `schema.prisma` 都改咗，migration 已人手 apply 落 prod
- [ ] CSP 喺**真 production build** 實測過張卡 render 到（dev mode 唔算數）
- [ ] Sandbox credentials 全部換成 production
- [ ] `SQUARE_ENV=production`
- [ ] Webhook URL 指住 `https://www.harbourhair.co.uk/api/webhooks/square`
- [ ] Square 帳戶開喺**沙龍嘅法人名**，唔係開發者名
- [ ] 條款寫明按金政策（>24 小時退 / <24 小時唔退）
- [ ] `depositsEnabled` 上線時仍然係 **false** —— 由 admin 喺 Settings 手動開

- [ ] **Step 4: 開 PR**

```bash
git push -u origin feat/square-deposits
gh pr create --title "feat: Square deposit payments for bookings and consultations" --body "$(cat <<'BODY'
落單嗰陣只授權（hold）唔扣錢，admin 批核先 capture，拒絕就 void。

- 用 Square delayed capture（`autocomplete: false`）。card-not-present 個 hold
  有 7 日，到期自動 CANCEL，所以忘記批核唔會無啦啦扣客錢。
- Square call 全部喺 `runSerializableWithRetry` **外面** —— transaction 會
  retry，HTTP call 擺入面會重複授權。
- 金額決策抽咗做純函數 `deposit-policy.ts`，窮舉組合測試。
- CSP 加咗 Square 嘅 CDN / PCI / 字型來源，唔加張卡 render 唔到。
- 英國 SCA 強制，前端行 `verifyBuyer`。
- `depositsEnabled` default false 兼 fail closed：Square 配置唔齊就拒絕落單，
  唔會靜靜雞免費開單。

⚠️ Merge 之前要人手 apply migration（CI 唔會行）。
BODY
)"
```

> merge 之前記住手動 apply migration —— CI 唔會幫你做。

---

## 仲未決定嘅嘢（要 client 拍板）

呢啲唔阻住寫 code（default 值已經 fail closed），但上線前一定要有答案：

1. **按金模式** —— 百分比？定額？定係只喺服務貴過某個價先收？
2. **退款政策** —— 24 小時外可唔可以退？呢個要寫入條款，唔淨係寫入 `cancelAppointment`。
3. **免費 consultation** —— 就咁免費？定係收個象徵性可退按金擋 no-show？
4. **Square 帳戶擁有人** —— 一定要係沙龍，佢哋係 merchant of record。
5. **同 Fresha 撞唔撞** —— 見上面「設計決策」一節。呢個係五條裡面最重要嗰條。
