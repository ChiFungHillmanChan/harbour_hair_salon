# Square sandbox acceptance — 14–15 October 2026

**Live payment-safety scenarios passed. The CSP fix and the two UI findings are
merged (#64). The Chrome card-form failure is explained and fixed in #65 (see
"15 October re-run"). Production Square payments stay locked until production
credentials are set (runbook §5).**

Target: https://harbour-hair-sandbox.vercel.app. Square UK/GBP Default Test Account,
Harbour Hair Website application, location `LAPJRRTBGE2KR`. Times are Europe/London.
Only the supplied owner's customer/admin accounts and explicitly labelled synthetic
sandbox fixtures were used. Preview contains copied real customers; no production
settings, production payments or production deployment were changed.

## Tested deployment and fix

Starting source: `1f42c0e`, branch `docs/square-sandbox-setup`, with the local CSP fix
overlaid into a clean source upload. Corrected Preview deployment:
`dpl_7HchaRnVvWjofjQUrmFYRCo2hXax`,
https://harbourhairsalon-3sjrmfz94-hillmans-projects-ef63d7ca.vercel.app.
The stable sandbox alias points to this deployment. `next.config.ts` SHA256:
`b54bb79033f926847e3426dd212c91c3cb8aa5b0f5bb55cac1a20fa69f541631`.
This is **not yet acceptance on a Preview of a merged main commit**.

The original 3-D Secure challenge failed because CSP omitted
`https://api.squareupsandbox.com`; Cash Sans fonts from `https://cash-f.squarecdn.com`
were also blocked. The fix adds exact sandbox/production challenge frame origins
and that font origin, with regression tests. No wildcard was added. The deployed
response headers contain the corrected policy. A clean in-app browser subsequently
completed the real challenge after waiting over 80 seconds before entering `123456`.

## Live sandbox results

| Scenario | Evidence / outcome | Result |
| --- | --- | --- |
| Authorization | £37 haircut; £7.40 held, £29.60 remainder; website and Square agree. | Pass |
| Double-click / cross-tab repeat | Double-click made one booking/hold. On 15 Oct at 11:47, two customer tabs submitted the same request; second showed already requested. One new payment attempt / booking / Square hold was verified. | Pass |
| Two-account race | Simultaneous browser clicks at 11:53:27 on the stable alias and the exact same immutable deployment, with separate supplied customer/admin account sessions. One PENDING booking and APPROVED hold; other account VOIDED / Square CANCELED, no booking. Losing UI returned to date selection without an explanation. | Pass for money/booking safety; fail for clear slot-loss feedback |
| Staff approval | Confirmed booking, CAPTURED attempt, Square COMPLETED. | Pass |
| Re-check settled capture | £7.40 taken; no second capture in Square logs. | Pass |
| Staff decline | Earlier pending request cancelled, VOIDED, Square CANCELED. | Pass |
| Customer full refund | Cancellation more than 24 hours ahead; refund pending → COMPLETED through real webhook; £7.40 refunded. | Pass |
| Declined card | `4000…0002`; HTTP 400, FAILED, no booking. | Pass |
| Failed verification | `4811…0008`; HTTP 402, no booking. | Pass |
| 3-D Secure challenge | `4310…1019`, waited over 80 seconds, code `123456`, Booking Request Received, £7.40 authorized. In-app browser logs showed no CSP errors. | Pass in clean browser |
| Frictionless SCA | `4800…0004`; no challenge, request received, AUTHORIZED / Square APPROVED. | Pass |
| Customer withdrawal | 3DS request cancelled; VOIDED / Square CANCELED; My Bookings says hold released, nothing taken. | Pass |
| Artificial expired hold | Owner's frictionless hold `delayedUntil` moved into past per runbook. Approval left it PENDING/AUTHORIZED and did not capture; alert text was inaccessible in IAB. Notifications HTTP 200 lapsed one request, sent one email. Individual Re-check payment then cancelled the still-live Square hold. | Pass for refusal/state/lapse/re-check; expiry alert wording not captured |
| Direct Square cancellation | Labelled admin-owned API/DB fixture. Actual Square cancel → real webhook EXPIRED, booking stayed PENDING. Chrome approval alert explicitly refused expired hold; notifications lapsed it. | Pass, API-created fixture |
| Staff keeps deposit | Admin-owned browser booking approved then cancelled with Refund unticked; KEPT, booking CANCELLED, no refund row; Square remains COMPLETED. | Pass |
| Signed duplicate/old event | Same signed older APPROVED event sent twice after capture/refund: HTTP 200 twice, one event row, CAPTURED and COMPLETED refund unchanged. | Pass |
| Webhook rejection and filtering | Missing signature HTTP 401; 65,537-byte body HTTP 413; signed malformed JSON HTTP 400. Signed unsupported type, other location and card-reader payment without reference HTTP 200 with no event rows. | Pass |
| Old refund replay | Older PENDING refund sent twice after COMPLETED: HTTP 200 twice, one stored event, refund stays COMPLETED. | Pass |
| Kill switch | Isolated Preview with runtime `SQUARE_PAYMENTS_ENABLED=false`: no card form, request disabled, online-payment-unavailable copy; webhook HTTP 404. No independently counted gateway-call trace. | Pass for UI/route guards |
| Wrong token | Four provider refusals across 14–15 Oct: FAILED with setup-refusal wording, no booking/payment id. Fourth retried after general hourly limit reset. Operations shows 4 setup refusals and 2 genuine declines; isolated deployment logs explicitly name HTTP 401. Subsequent valid-token cross-tab and race requests succeeded. | Pass |
| Inbox receipt | Actual Gmail request, confirmation, cancellation and expired-hold emails read. Amounts and held/taken/refunded copy checked; confirmation/cancellation include calendar attachment. | Pass |
| External refund settlement | Labelled admin-only API/DB fixture; real external sandbox refund COMPLETED, then scoped local UNKNOWN-state fault injection. Chrome confirmation names £7.40; SETTLED_EXTERNALLY, one PAYMENT.REFUND_SETTLED_OUTSIDE audit; individual re-check leaves exactly one Square refund for £7.40. | Pass for UI/audit/individual re-check; daily housekeeping preserved it |
| Daily housekeeping | Explicit broader approval received 15 Oct; two runs HTTP 200, no failures, no additional refunds/retention/lapse changes. Each checks three unmatched notices from the external-refund fixture and leaves them for staff. KEPT and SETTLED_EXTERNALLY preserved; actual Square refund count remains one. | Pass, with expected attention records |

A database-expiry injection does not fast-forward Square's clock: notifications
recorded EXPIRED while Square initially still showed APPROVED. The individual
Re-check payment released it; final Square status CANCELED was verified. This is
consistent with the reconciliation code's handling of artificially expired holds,
and is not evidence that Square naturally keeps a hold after its own expiry.

The clean in-app browser completed authentication. Chrome still intermittently
left the Square card iframe pending / timed out even after changing Fast 4G to
No throttling; its root cause is not established. Chrome's native console after
the fix had no observed Square CSP errors, but did have a separate blocked Vercel
preview-toolbar script. An empty high-level Chrome console log alone is not proof
of a clean console. Cross-browser loading acceptance remains open.

The open booking editor has a minor display defect: after external settlement, its
old refund-pending badge and settlement button remain visible beside the success
message. Closing and reopening shows Refunded £7.40 and removes the button. The
database state, audit and no-double-refund check were correct; this stale display
was observed and has not been changed.

A second UI finding appeared in the two-account race: the losing account returned
to date selection, with the taken time disabled, but no visible slot-loss/hold-release
message. Its attempt was VOIDED and Square CANCELED; the money-safety outcome was
correct. `BookingWizard.tsx` renders `bookingError` only inside the confirm step,
while availability normalization can move the wizard back to the date step.
This feedback defect has not been changed.

## 15 October re-run on main's code (local production build)

Code: `main` at `62b9152` (#64 merged), built with `next build` and served with
`next start`, `VERCEL_ENV=preview` (the payment lock's one exemption, exactly as on
a Vercel Preview). Square: the same sandbox application and location
`LAPJRRTBGE2KR`. Database: a disposable local PostgreSQL 17 seeded with the
project's own seed, never the Preview or production database. Browser: a clean
Chrome profile with no extensions, phone-width window. The sandbox alias was moved
to PR #64's Preview (`dpl_FfGyqwP8KBo2p9cKaobYZbZHiNQE`, same tree as `62b9152`).

Why local rather than the Preview: test card numbers and test passwords are only
typed into a local development host by the assistant that ran this. The Preview
holds copied real customers and sits behind Vercel SSO. Square's webhooks cannot
reach localhost, so refunds were settled with "Re-check payment", which is what
reconciliation does; webhook delivery itself was proven on the Preview above.

| Scenario | Evidence / outcome | Result |
| --- | --- | --- |
| 3-D Secure challenge | `4310…1019`; Square's challenge form showed **7.40**; waited 100 s, entered `123456`, Authenticate. Request received, `AUTHORIZED` / Square `APPROVED`. No `securitypolicyviolation` event at any point. | Pass |
| Frictionless SCA | `4800…0004` (US card: digits-only ZIP); no challenge; `AUTHORIZED` / `APPROVED`. | Pass |
| Slot taken while confirming | Customer A on the confirm step with a card ready; the same slot booked meanwhile. Server refused (`SLOT_UNAVAILABLE`) before any card authorization; wizard returned to the times with "Sorry — 16:00 on Tuesday 20 October is no longer available… Nothing has been taken from your card…"; 16:00 greyed. No payment attempt created. | Pass |
| Staff approval | `CONFIRMED`, `CAPTURED`, Square `COMPLETED`. | Pass |
| Refund shown in an open dialog | Cancelled with refund (`PENDING`); reopened; "Re-check payment" in the open dialog turned "Refund pending £7.40" into "Refunded £7.40" in 0.4 s without closing it; refund `COMPLETED`; audit `PAYMENT.RECHECKED`. | Pass |
| Settled outside, in an open dialog | Second captured booking cancelled with refund; its refund set to `UNKNOWN` in the local database (a lost Square answer). In the open dialog: confirm question, then "Refunded £7.40", the button gone and "The £7.40 refund is recorded as settled outside the website…" kept on screen; refund `SETTLED_EXTERNALLY`; audit `PAYMENT.REFUND_SETTLED_OUTSIDE`. | Pass |
| Customer withdrawal | "the £7.40 hold on your card was released. Nothing was taken."; `VOIDED` / Square `CANCELED`. | Pass |
| Staff decline | `VOIDED` / Square `CANCELED`. | Pass |
| CVV `911`, ZIP `99999`, expiry `01/40` | Each: "Your card was declined or could not be verified. Nothing was booked and you have not been charged."; attempt `FAILED`, no Square payment. | Pass |
| Decline limit | Fourth attempt the same day with a valid card: "Online payment is not available right now… Please call the salon"; card form removed; no attempt row, Square not called. | Pass |
| Card form load time | 2.2–3.1 s from the confirm step on a fresh page; 0.1 s after Back/Continue (five times, including a quick double toggle). | Pass |

All four bookings made in this run are closed: two deposits captured and refunded
in full, two holds released; the three declined attempts never reached a payment.

### Chrome card-form failure: cause and fix

Reproduced in the clean profile, so it is not specific to one person's Chrome.
Square's Web Payments SDK cannot start while the page is hidden: `Square.payments()`
gives up with "Web Payments SDK was unable to be initialized in time", and the SDK
stays broken until the page is reloaded. With the booking tab in the background,
the production build showed "The card form could not be loaded" after 20 seconds,
every time, and kept showing it when the tab came back. Tabs opened by a browser
extension often sit in the background, which explains the intermittent failures
above. A customer who opens the booking page in a background tab, or switches
app or tab while it loads, would see the same. A second, development-only cause:
React's double-mount attached two cards to one element, and destroying the first
left the second hanging, so `pnpm dev` always failed to show the card form.

#65 (`square-web-payments.ts`) makes the card field wait until the
page is shown before touching Square, starts its 20-second limit only then, and
lets a second field on the same element wait until the first has gone. Verified on
a local production build: hidden for 90 s, the form kept "Loading…" (Square not
contacted), then was ready 1.6 s after the tab came back. Verified on the dev
server: ready in 2.7 s with exactly one card field.

### Kill switch and expired hold, on #65's code

The two items the Preview run left partly open, run on a local production build of
`ae0ed17` (the same setup as above). The server recorded the host and path of every
outbound request it made (a preload around `fetch`; no headers or bodies). With
payments on, that trace showed Square's `POST /v2/payments` for the hold below, so a
Square call would have shown up.

| Scenario | Evidence / outcome | Result |
| --- | --- | --- |
| Card form load | Confirm step reached on a fresh page; Square's card field in place 2.8 s after Continue. | Pass |
| Expired hold: approval | `4800…0004` hold (£7.40, `GmSKnxo5Fi5natIdj08cruKRHtQZY`); `delayedUntil` set one minute into the past as the runbook says. "Confirm & take £7.40 deposit" answered: "The card hold for this request has expired, so it can no longer be confirmed online. Decline it and contact the customer." No Square call; the attempt stayed `AUTHORIZED`, the request `PENDING`. | Pass |
| Expired hold: lapse | Notifications job: `requestsLapsed: 1`, one email queued (dropped on send, no Preview allowlist); request `CANCELLED`, attempt `EXPIRED` with "The card hold expired before the request was confirmed…". The lapse records the expiry by its date without asking Square, so Square still showed `APPROVED`. | Pass |
| Expired hold: release | Housekeeping, once the row was older than the 15-minute reconciliation minimum (its `updatedAt` moved back 20 minutes, standing in for the next nightly run): `GET` then `POST /v2/payments/…/cancel`; Square `CANCELED` / card `VOIDED`. | Pass |
| Kill switch | Restarted with `SQUARE_PAYMENTS_ENABLED=false`. The confirm step showed "Online payment isn’t available right now, so this booking can’t be made online. Please call the salon…", no card form, and the request button disabled; re-enabling the button by hand and submitting changed nothing. The browser loaded nothing from Square. Webhook `POST` answered 404; housekeeping reported payments `skipped: true`; the notifications job ran. No booking or attempt was created. The server's trace for the whole run holds 12 requests, all to the synthetic Redis host, and none to Square. | Pass |

## Identifiers

- Original captured/refunded appointment: `cmv8nuf0y0003ku06m10g54kd`.
- Payment: `qceLFL0MoOyQo0EwX79Szi46zCgZY`.
- Refund: `qceLFL0MoOyQo0EwX79Szi46zCgZY_D0fcSDIwyDWxR6WAX4Tc2aOfTAfHW1jiJbjw7O6khaF`.
- Completed refund event: `16e28830-dc11-3b1c-82c5-aa3611edafe4`.
- Earlier staff-released payment: `i0cbnERfcCA6U2pkqmwXS7QzkrTZY`.
- Successful challenge / withdrawn payment: `Oem1mXJWMrwGVeVwiNbQRqTxDbYZY`; appointment `cmv8q4dk60004jt06t6h81gjk`.
- Frictionless / expired test: `gJpQDrBRmTiIgyIciCm9DxV5jg6YY`; appointment `cmv8qcw6l000cjt06ysoj4o1e`.
- Staff-kept payment: `UXF111X3pPBHL7v88VJGgcuIwlBZY`; appointment `cmv8qkufq0003jk06djqa546v`.
- Direct Square cancel fixture: `MRkFrGg3yosFanjh4ea1dVUWkXZZY`; appointment `cmv8qsbwx0001yed1zqin6g9q`.
- External-refund fixture: `c9qr5eediYuMlSmhByp4NmLe2MVZY`; appointment `cmv8qt9cs0001yegc6zf3li8d`, local refund `cmv8qvqli0001yefrepk9zs1x`.
- Cross-tab duplicate: `m2cl8oXWToLYKmMzOD6SFTKPPCaZY`, appointment `cmv9f08ot0004l306xb90njng`; subsequently VOIDED / CANCELED.
- Race winner: `667ey3MdeqvnlUIAvQefgTB358EZY`, appointment `cmv9f7o5r0008k106mcs78v29`; hold released and request lapsed for cleanup.
- Race loser: `MrHQzIvkPtl3TMjSQCQN1haWByIZY`; VOIDED / CANCELED, no appointment.
- Signed replay event: `449ec871-7077-46d9-9c7a-ac43a63a9a54`.

One enabled sandbox subscription was verified with payment.created/payment.updated/
refund.created/refund.updated and API version 2026-09-16. Some delivery-log rows
appeared twice; deduplication is proven by the signed replay/database check above,
not inferred from those rows.

## Automated and database verification

| Check | Result |
| --- | --- |
| Full suite on Node 24.19.0 | 1,646 passed, 0 failed, 0 skipped |
| Dedicated Square suite | 380 passed, 0 failed, 0 skipped |
| ESLint / TypeScript | Both exit 0 |
| Remote Preview production-mode build | Success, TypeScript passed; Preview migrations correctly skipped |
| Local PostgreSQL | 18.6, isolated localhost port 55438, empty disposable salon_test; all 22 checked-in migrations applied |
| `pnpm test:integration` on Node 24 / PG18 | Exit 0; booking-cap race, worker concurrency, calendar preservation, readiness, London aggregation, payroll races |
| `pnpm test:booking-lifecycle` on Node 24 / PG18 | Exit 0; real PostgreSQL booking/repeat/capture races, frozen quote, refunds/keeps, unique webhook event, out-of-order guards, lost-answer reconciliation, lapse filters |

Database-backed suites use **synthetic Square, email and calendar providers**.
They prove transactional behavior against PostgreSQL, not live Square behavior.
See integration output (`local-postgres-integration.log`),
lifecycle output (`local-postgres-lifecycle.log`), and
signed replay evidence (`signed-replay.json`),
webhook guard evidence (`webhook-guards.json`), and
external settlement evidence (`external-settlement.json`),
two-account race (`two-account-race.json`),
cross-tab duplicate (`cross-tab-duplicate.json`),
housekeeping (`housekeeping.json`), and
HTTP 401 setup logs (`setup-refusal-logs.json`).

## Remaining sign-off work

- A person, not the assistant, enters cards on the Preview of merged `main`
  (`harbour-hair-sandbox.vercel.app`): at least the 3-D Secure challenge with
  DevTools → Console open, one approval and one refund. The local production-build
  run above covers the same code; this repeats it on Vercel's infrastructure.
- Real phones: iPhone Safari and Android Chrome, including switching away to
  another app while the card form loads. Not covered by any run so far.
- Then runbook §5 (production credentials, webhook, the real £0.01 card test with
  the console open; the production 3-D Secure origin `api.squareup.com` has not yet
  been observed).

All other §4 items are covered above or in the 14–15 October Preview run.

## Cleanup state

Every created owner test booking and both API/DB fixtures are closed. Original
holds are CANCELED at Square; the original captured booking is fully refunded.
The staff-keep test intentionally remains KEPT / Square COMPLETED, with no refund.
The external-refund fixture is fully refunded and SETTLED_EXTERNALLY. No customer
accounts were created or deleted. Final query found zero open owner bookings. Three
refund webhook notices for the deliberately external-refunded fixture remain open
(unmatched when delivered before the injected local refund row); these are retained
as test evidence. The approved daily job checked them and kept them listed, as
expected for externally settled refunds with unmatched Square notices; it made no
second refund. The winning race hold was cancelled at Square and notifications
lapsed that request; the duplicate hold was also released.
Chrome Fast 4G was restored and verified. The
disposable local PG18 server was stopped. Preview stays configured for follow-up
acceptance, with the working CSP deployment at the stable alias; fault previews
remain isolated. No main push, production deploy or production credentials change
was performed.

## Access and safeguards

Preview database identity was checked against the independently verified owner
sandbox payment. The Preview email allowlist contains only the provided customer
mailbox. Square sandbox location was independently checked as active GB/GBP.
Only specifically approved Preview database/email/cron/Square secrets were read,
kept in private temporary files and omitted from this report. The plaintext
approved-secret bundle was removed after final verification. A bulk environment
pull was rejected and was not used. Fault previews have deployment-local overrides;
the stable alias and shared correct Square token remain on the working Preview.

Automatic approval review initially rejected daily housekeeping because it can
apply changes to copied Preview records beyond the test accounts. The user
explicitly approved that scope on 15 October, and the subsequent direct runs
succeeded. The earlier rejected job was not run indirectly.

## Evidence

The screenshots and logs named below are kept outside this public repository, in the
developer's `client-documents/harbourhair/square-acceptance-2026-10-14/` folder: they show a
personal inbox and admin screens of the Preview database, which is a copy of production's
customers.


- Final customer cleanup (`final-customer-cleanup.png`)
- Cross-tab already requested (`cross-tab-duplicate.png`)
- Race winner (`two-account-race-winner.png`)
- Race loser returned to time selection (`two-account-race-loser.png`)
- Fourth setup refusal (`invalid-token-fourth-refusal.png`)
- Final Operations (`final-operations.png`)
- Staff-kept deposit (`staff-deposit-kept.png`)
- External settlement confirmation (`external-refund-confirmation.png`)
- External refund recorded (`external-refund-settled.png`)
- Working challenge (`3ds-challenge-working.png`)
- Successful challenge request (`3ds-booking-succeeded.png`)
- Withdrawal released (`3ds-withdrawal-released.png`)
- Frictionless request (`frictionless-succeeded.png`)
- Expired hold re-check (`expired-hold-rechecked.png`)
- Expired-hold email (`email-expired-hold.png`)
- Direct cancellation refuses approval (`direct-square-cancel-approval-refused.png`)
- Setup refusal (`invalid-token-refusal.png`)
- Operations separates setup and declines (`operations-setup-vs-declines.png`)
- Kill switch (`kill-switch.png`)
- Request email (`email-request.png`)
- Confirmation email (`email-confirmation.png`)
- Cancellation email (`email-cancellation.png`)
- Refund pending (`refund-pending.png`)
- Refund completed (`refund-completed.png`)
- Square payment/refund (`square-payment-refund.png`)
- Original blocked challenge (`3ds-blocked.png`)
- Original CSP errors (`3ds-console.png`)

References: [project runbook](../docs/square-payments-setup.md),
[Square sandbox values](https://developer.squareup.com/docs/devtools/sandbox/payments),
[Square CSP guide](https://developer.squareup.com/docs/web-payments/content-security-policy).
