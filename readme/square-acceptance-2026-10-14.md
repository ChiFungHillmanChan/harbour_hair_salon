# Square sandbox acceptance — 14–15 October 2026

**Live payment-safety scenarios passed. Go-live sign-off remains blocked by the
Chrome loading failure and validation on a merged main Preview. The CSP fix and
the two UI findings were fixed in code on 15 October (see "Remaining sign-off
work"). Production Square payments must stay locked.**

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

- **Fixed in code, 15 October (pending the Preview-of-main re-run below):**
  - the CSP fix above, now committed with its regression tests;
  - slot-loss feedback: when a refused booking sends the customer back to the
    times, the date step now says the time is no longer available and, if a card
    was sent, that nothing was taken and any hold is being released
    (`booking.date.timeTaken` / `timeTakenCard`, en + zh); the stale confirm-step
    error no longer greets the next time chosen;
  - the open booking dialog now takes its deposit from the refreshed board
    (`withLiveDeposit`), so the refund chip updates at once, and the settle control
    drops its button once recorded while keeping its answer on screen.
- Repeat the launch smoke checks on a Preview of merged main with its exact commit
  recorded: at least the 3-D Secure challenge (`4310…1019`) with the console open,
  frictionless (`4800…0004`), the two-account race (loser sees the new notice) and
  "Mark refund as settled outside the website" in an open dialog. Also try the
  CVV `911` / postcode `99999` / expiry `01/40` cards, which this run did not record.
- Explain and resolve Chrome card-form loading; validate normal and throttled use.
  A fresh Chrome tab on 15 October reproduced the failure; clean IAB worked. First
  separate the browser from the profile: a Chrome guest or incognito window with
  no extensions, then real phones (iPhone Safari, Android Chrome), none of which
  this run covered.

All other previously pending live scenarios (cross-tab, two accounts, fourth
wrong-token refusal, valid-token recovery and daily housekeeping) were exercised
on 15 October. Safety invariants passed; the slot-loss UI wording requirement did
not. No further user approval is pending for the completed housekeeping run.

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
