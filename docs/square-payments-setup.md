# Square deposit payments: setup and integration guide

Reviewed against official Square documentation on **26 September 2026**. The payment gateway pins the Square API to **2026-09-16**.

## What this setup delivers

This change provides a payment foundation and automated tests that can run without a Square account. It does **not** activate deposits or alter the website's booking, customer sign-in, or admin approval flows.

The foundation consists of:

| File | Responsibility |
| --- | --- |
| `src/app/services/deposit-policy.ts` | Calculate a deposit in integer pence from an explicitly supplied percentage, threshold, or fixed override. No salon policy is selected automatically. |
| `src/app/lib/square-config.ts` | Parse configuration and read it at runtime. Payments are disabled by default. |
| `src/app/services/square-gateway.ts` | Server-only REST calls to authorize, retrieve, capture, cancel, and refund payments, and retrieve refunds. |
| `src/app/lib/square-webhook.ts` | Standalone verification of Square webhook signatures. |
| Corresponding `.test.ts` files | Exercise local policy, configuration, request/response, error, and signature behavior using test fixtures. |

There is no payment form, booking payment action, payment persistence schema, admin payment control, or webhook HTTP endpoint in this setup. **Adding credentials or setting the enabled flag does not add these missing workflows.**

The proposed webhook path is `/api/webhooks/square`, but **no route exists there yet**. Do not register it in the Square Developer Console until the route and its durable processing have been implemented and deployed.

“No login yet” is treated as no Square merchant/developer account or credentials yet. The website already has its own customer authentication; this setup does not remove it. Customers paying by card do not need to become the salon's Square account users.

## Recommended payment flow for this website

The website accepts booking requests as `PENDING` and requires an administrator to confirm them. For that behavior, the recommended future integration is **Square Web Payments SDK plus the Payments API with delayed capture**:

1. Calculate the deposit on the server and show the exact amount and terms.
2. Let Square collect and authenticate the customer's card details.
3. Authorize the deposit while submitting the booking request.
4. Capture the authorized amount when the administrator approves the request.
5. Cancel the authorization when the request is rejected or cannot be booked.

Authorization reserves funds; it is not a completed payment. The customer may see a pending card transaction. Copy should explain that distinction and must not promise that a canceled hold disappears from a bank app immediately.

For online card payments, Square's default capture window is seven days. The default expiry action is cancellation. Keep `autocomplete: false` and `delay_action: "CANCEL"`, persist Square's `delayed_until`, and require a new authorization if the original expires. This supports timely booking approval; it cannot reserve funds indefinitely until a distant appointment. [Square delayed capture guide](https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture)

This is a recommendation for the next implementation stage, not an implemented booking workflow or a chosen deposit percentage.

### Alternatives evaluated

| Approach | Fit for Harbour Hair Salon |
| --- | --- |
| Web Payments SDK + delayed capture | Best fit for payment authorization followed by existing admin approval. Requires an embedded card form, authentication, CSP configuration, durable payment state, and recovery workflows. |
| Square-hosted Checkout payment link | Simpler checkout UI if the business chooses to collect payment immediately or only sends a link after approval. It changes the approval/payment sequence and needs abandoned-checkout handling. |
| Manual Square payment links | Useful for separately managed requests, but unsuitable as the sole automated proof that a specific website booking has paid its required deposit. |
| Replace booking with Square Appointments | A broader business-system migration. It is unnecessary for adding payments to the existing booking system. |

Square-hosted Checkout returns a payment-link URL and order ID. The API link accepts payment from one buyer, and an order supplied to `CreatePaymentLink` must be a new order description rather than an existing order ID. If this alternative is implemented, persist its link and order IDs and reconcile payments against that order. [Checkout overview](https://developer.squareup.com/docs/checkout-api), [Checkout limitations](https://developer.squareup.com/docs/checkout-api/guidelines-and-limitations)

Do not assume payment links expire when a local booking hold expires. The current create-link request has no expiry parameter. Square's documented deletion operation cancels the corresponding order and removes the checkout link. A future hosted flow therefore needs deletion and a rule for a payment racing with expiry; a success-page redirect alone cannot confirm payment. [CreatePaymentLink reference](https://developer.squareup.com/reference/square/checkout/create-payment-link), [Manage Checkout](https://developer.squareup.com/docs/checkout-api/manage-checkout)

## Fees and amount decisions

Square advertises these standard UK online card rates for Online Checkout and the eCommerce API:

| Card | Advertised processing rate |
| --- | --- |
| UK-issued | 1.4% + 25p |
| Non-UK-issued | 2.5% + 25p |

Illustrative UK-card fees, calculated from that advertised rate:

| Deposit collected | Fee | Net received | Fee as percentage of deposit |
| --- | --- | --- | --- |
| £10 | £0.39 | £9.61 | 3.90% |
| £15 | £0.46 | £14.54 | 3.07% |
| £50 | £0.95 | £49.05 | 1.90% |
| £100 | £1.65 | £98.35 | 1.65% |

These examples illustrate why the fixed 25p matters for small deposits; they do not prescribe deposit amounts. Confirm the account's applicable rate before launch. Square's broad legal fee schedule also contains international-fee wording, while its product pricing explicitly lists the online rates above; do not infer an additional online surcharge by combining unrelated table entries. [Square UK pricing](https://squareup.com/gb/en/pricing), [Square UK fee schedule](https://squareup.com/gb/en/legal/general/fees)

The current official UK **card-payment minimum is £0.01**. Older forum guidance saying £1 is outdated. A zero deposit means skip payment creation; it is not a zero-value card authorization. Use integer pence internally and `GBP` for this salon. [Payment minimums](https://developer.squareup.com/docs/payment-minimums)

Before implementing customer collection, the salon must select its percentage or fixed amounts, qualifying services, treatment of consultations and patch tests, and cancellation/refund terms. The policy helper takes explicit inputs and does not turn historical suggestions into business rules.

## Configuration available now

Keep the following disabled and blank until credentials are available. Store actual credentials only in local environment files or the deployment secret store, never in source control.

```dotenv
SQUARE_PAYMENTS_ENABLED=false
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=
SQUARE_LOCATION_ID=
SQUARE_ACCESS_TOKEN=
SQUARE_WEBHOOK_SIGNATURE_KEY=
SQUARE_WEBHOOK_NOTIFICATION_URL=
```

| Variable | Meaning |
| --- | --- |
| `SQUARE_PAYMENTS_ENABLED` | Explicit gate for the gateway configuration. Leave `false` for this foundation-only stage. |
| `SQUARE_ENVIRONMENT` | `sandbox` or `production`; use a consistent environment for all credentials. |
| `SQUARE_APPLICATION_ID` | Developer Console application ID, also needed by the future Web Payments SDK form. |
| `SQUARE_LOCATION_ID` | The salon's Square location; verify UK/GBP payment capability later. |
| `SQUARE_ACCESS_TOKEN` | Secret server API credential. Never expose it through `NEXT_PUBLIC_` configuration. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Secret associated with the future webhook subscription. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Exact public HTTPS URL registered for that subscription, once a working endpoint exists. |

`parseSquareConfig(env)` validates supplied configuration; `getSquareConfig()` reads environment values at runtime and returns no active configuration while disabled. Enabling an incomplete configuration is an error rather than a signal to simulate a successful payment. Placeholder values such as `[SENSITIVE]` are not working credentials.

The gateway uses `https://connect.squareupsandbox.com` for sandbox and `https://connect.squareup.com` for production. Square isolates the environments: their credentials and resources are not interchangeable. An application registered in the Developer Console is needed even for genuine sandbox testing. Sandbox transactions use test payment values and do not charge real cards. [Square Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview)

## Gateway contract and API details

The server-only gateway is a low-level payment adapter. It does not authenticate customers, authorize administrator actions, calculate authoritative booking quotes, reserve appointment slots, or persist payment attempts. A future booking service must supply those controls before calling it.

Before capture, cancellation, or refund, the caller must retrieve the payment and verify ownership, environment/location, expected amount/reference, and current status/version against the durable attempt. The gateway's response checks happen after the provider operation; they cannot prevent a mutation of the wrong payment if a caller supplies an incorrect payment ID.

| Operation | Square request | Important behavior |
| --- | --- | --- |
| Authorize | `POST /v2/payments` | Send a Square card token, stable `idempotency_key`, integer `amount_money` in GBP, location and reference IDs, `autocomplete: false`, and `delay_action: "CANCEL"`. |
| Retrieve payment | `GET /v2/payments/{payment_id}` | Obtain current provider state before resolving an ambiguous result. |
| Capture | `POST /v2/payments/{payment_id}/complete` | Operates on `APPROVED` payments; optional `version_token` can reject concurrent changes. |
| Cancel authorization | `POST /v2/payments/{payment_id}/cancel` | Cancels an `APPROVED` payment; it is not a refund of captured funds. |
| Cancel by attempt key | `POST /v2/payments/cancel` | Recovery option when the payment ID was lost; an empty successful response also occurs if no payment matches. |
| Refund | `POST /v2/refunds` | Use the captured payment ID, refund amount, and a durable refund idempotency key. |
| Retrieve refund | `GET /v2/refunds/{refund_id}` | Resolve whether a requested refund has completed or failed. |

`CreatePayment` idempotency keys have a 45-character limit and `reference_id` a 40-character limit. Use one durable key per intended operation; retry the same operation with the same key and payload. A new key after a timeout can create another authorization. Never send card numbers or CVCs to this application's server. [CreatePayment reference](https://developer.squareup.com/reference/square/payments/create-payment)

Capture accepts an empty JSON body or a `version_token`, not another amount to charge. This gateway requires a previously retrieved version token for capture. Its expected amount/reference checks validate the response; the caller must verify the current payment against the durable attempt before requesting capture. If a version check fails, fetch and assess current state before proceeding. [CompletePayment reference](https://developer.squareup.com/reference/square/payments-api/complete-payment), [CancelPayment reference](https://developer.squareup.com/reference/square/payments-api/cancel-payment)

For a normal linked refund, do not add `location_id` to the refund request: Square reserves that field for unlinked refunds. Optional reasons are limited to 192 characters. [RefundPayment reference](https://developer.squareup.com/reference/square/refunds/refund-payment)

Refund acceptance is not proof that money has been returned. Refunds can be `PENDING`, `COMPLETED`, `FAILED`, or `REJECTED`; the original payment remains `COMPLETED` even after a full refund. Persist the refund separately and track it to a terminal result. Only captured payments are refundable; cancel an authorization instead. Square documents a one-year refund window and a maximum of 20 refunds per payment. [Refund Payments](https://developer.squareup.com/docs/payments-api/refund-payments)

## Required application work before payment collection

The following are integration requirements, not features provided by the foundation.

### Server-owned quotes and durable attempts

Calculate the payable service total from current server data, including applicable offers and discounts, then derive the deposit from that total. The browser must not choose the charge amount, payment owner, appointment status, or payment ID. Snapshot the final total, deposit amount, currency, and selected policy so later price changes cannot silently change an existing payment attempt. Authenticate the customer and enforce existing rate limits.

Introduce a durable payment-attempt record before initiating an external payment. Store the user/booking request relationship, quote snapshot, request fingerprint, idempotency key, provider environment/location, provider payment ID when known, observed status, authorization expiry, and recovery state. Enforce unique keys and permitted transitions in the database. Refund attempts and processed webhook IDs also need durable records. Apply compatible models/migrations to all three Prisma schemas and use generated model types.

Reserve or validate the slot using the existing concurrency controls. Square calls must stay outside retrying serializable database transactions. Persist enough state to recover a crash between authorization and appointment creation. If the slot cannot be secured after authorization, cancel the hold and record any failed cancellation for recovery. A `try/finally` block alone cannot recover a process that exits before cleanup.

Network timeouts have an unknown outcome. A malformed or unexpected response after submission (`invalid_response`) can also follow a successful money movement. Do not treat these errors as a decline, tell the customer no authorization exists, discard the attempt, or create a fresh key automatically. Recover the original operation through its stored identity, verify Square state, and record the result before allowing another attempt. Square also offers cancellation by original idempotency key for a payment whose ID was not received. Its empty successful response also occurs when no payment matches, so it alone is not evidence that a known payment was canceled. [CancelPaymentByIdempotencyKey reference](https://developer.squareup.com/reference/square/payments-api/cancel-payment-by-idempotency-key)

### Approval, cancellation, and refunds

Admin approval must coordinate capture and appointment confirmation. Persist an operation intent so a capture that succeeds immediately before a database failure can be reconciled. Confirm only after verified capture; never let an ordinary status update bypass a required deposit. Concurrent approve/reject actions need a database transition guard as well as provider checks.

Rejection or cancellation must distinguish an authorization from a captured payment. Void an authorization; apply the agreed refund policy to captured funds. Display pending or failed refunds honestly. Rescheduling should preserve or explicitly adjust the payment relationship, and deleting a user or appointment must not destroy the audit trail needed to resolve outstanding money movements.

Approval after authorization expiry must stop and request a new payment authorization. A payment arriving after an appointment was canceled must enter an explicit reconciliation/refund path rather than restoring the appointment automatically. When disabling new collections later, preserve a controlled way to reconcile or return funds already in flight.

### Card form, buyer authentication, and browser configuration

Build the form with Square's hosted card-entry fields. Use the current `card.tokenize(verificationDetails)` flow, with the server-quoted amount, `GBP`, `intent: "CHARGE"`, `customerInitiated: true`, `sellerKeyedIn: false`, and appropriate buyer details. The older separate `verifyBuyer()` approach in the September 16 plan is deprecated. [Take a Card Payment](https://developer.squareup.com/docs/web-payments/take-card-payment)

Provide a secure context/HTTPS and the required CSP permissions for the selected Square environment. Square's current guide lists CDN script/frame/style origins, payment connection endpoints, and font origins. Integrate these narrowly with the existing CSP and verify the actual authentication challenge in a browser. The Web Payments SDK has required secure contexts since October 2025. [Web Payments SDK overview](https://developer.squareup.com/docs/web-payments/overview), [Square CSP guide](https://developer.squareup.com/docs/web-payments/content-security-policy)

### Webhook processing and reconciliation

The signature helper is only one part of a future webhook route. Read the untouched raw request body, then validate `x-square-hmacsha256-signature` using the subscription key and **exact registered notification URL**. Do not reconstruct that URL from untrusted request host headers or reserialize JSON before validation. Compare signatures in constant time. [Square signature validation](https://developer.squareup.com/docs/webhooks/step3validate)

Subscribe to relevant payment and refund events after the route exists. Validate the event's merchant/environment and correlate provider payment ID, reference, location, currency, and amount with the stored attempt before changing application state. Treat an early unmatched event as recoverable; it may precede the final local booking write.

Square can deliver events repeatedly and out of order. Deduplicate using `event_id` atomically with state changes, or first durably enqueue the event and then acknowledge it. Do not mark it processed before a failed database update. Return a successful response promptly only after durable acceptance; Square allows roughly ten seconds and retries unsuccessful delivery for up to 24 hours. [Square Webhooks](https://developer.squareup.com/docs/webhooks/overview)

Use provider retrieval to resolve conflicting observations, and prevent an older `APPROVED` event from replacing a completed payment. Provide an on-demand/admin recovery path for missed events and expired authorizations. A successful browser redirect, a client-reported tokenization result, or an email receipt alone is not authoritative payment reconciliation.

## Verification now and activation later

Run the isolated foundation suite with:

```bash
pnpm test:square
```

Also run the repository's applicable lint, type, and build checks when integrating changes. Local fixtures can verify how the code constructs requests, rejects malformed responses, computes deposits, handles missing configuration, and validates signatures. They **cannot** prove real credential validity, Square account eligibility, live card tokenization, Strong Customer Authentication, network delivery, or end-to-end booking/payment recovery. No real Square sandbox transaction has been performed for this setup because credentials are not available.

Verification recorded on 26 September 2026 using Node 24.19.0: all 722 repository tests passed, including the 62 Square foundation tests; ESLint, `tsc --noEmit --incremental false`, and `pnpm build` passed. The build required network access to read existing Neon data during page generation. No migrations, Square transactions, or deployment were run.

Before sandbox acceptance testing:

1. Agree the deposit and refund terms, and implement the application workflows described above.
2. Create/access the Square Developer Console account and application. Obtain sandbox application ID, access token, and a UK/GBP test location.
3. Deploy a working HTTPS test webhook route with durable event handling. Register its exact URL and copy that subscription's signature key into the matching environment.
4. Add sandbox credentials and enable the gateway only in that test environment.
5. Test approval/capture, rejection/void, declined and authenticated cards, expired holds, repeated submissions, concurrent slot requests, network ambiguity, webhook duplication/reordering, and pending/failed/completed refunds. Verify both the application's records and Square's sandbox records.

Before production activation, complete the merchant's Square onboarding and payment eligibility checks, configure production credentials and a separate production webhook subscription, verify operational recovery and customer terms, and repeat the relevant acceptance checks. Release application code through this repository's GitHub Actions deployment process. Production collection is a later activation step; this foundation is deliberately left disabled.

## Relationship to the earlier plan

The [September 16 Cantonese implementation plan](superpowers/plans/2026-09-16-square-deposit-payments-cantonese.md) remains historical design context. This guide supersedes it for the current setup scope and current Square API assumptions. Do not execute that plan verbatim:

- Its separate `verifyBuyer()` flow needs the current tokenization/authentication approach.
- Its suggested deposit/patch-test rules were not selected by this setup.
- A payment ID on an appointment alone cannot recover authorization before the appointment exists; durable attempts and unknown-outcome handling are required.
- Authorization expiry, capture/database conflicts, refund lifecycle, duplicate webhooks, and admin/customer cancellation paths need explicit implementation and acceptance tests.
- Its deployment, migration, environment-variable, and baseline-test assumptions must be checked against the repository's current configuration.

The completed foundation is a starting point for that work, not evidence that deposits are ready to collect from customers.
