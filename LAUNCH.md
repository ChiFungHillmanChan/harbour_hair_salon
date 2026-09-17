# Launch checklist — Harbour Hair Salon

Last verified against production: **2026-09-17** (commit `4b9b50f`, `www.harbourhair.co.uk`).

> **Status:** all four §1 code fixes and the §2 price fix are **done** and pending
> deploy. Gate after the changes: **588/588 tests, `tsc` clean, lint clean, full
> `next build` succeeds.** What remains is §2 content, §3 (opening booking), and
> §4 (owner decisions).

The site is **already live and serving customers**. What is still closed is
**online booking**, and it is closed by configuration, not by code. This file is
the ordered list of everything left.

Work top to bottom. The ordering in §3 is **load-bearing** — steps depend on each
other, and doing them out of order leaves booking silently shut.

---

## 0. Current state (verified, not assumed)

| Area | State |
|---|---|
| Tests / `tsc` / lint | 588/588 pass, clean, clean (plus a full `next build`) |
| `pnpm audit --prod` | No known vulnerabilities |
| CI | Green on all recent `main` pushes |
| Migrations | 16 applied, **0 unfinished** |
| Database | Neon `eu-west-2`, PostgreSQL 18.6, co-located with functions (`lhr1`) and Redis (`global-euw2`) |
| Security headers | CSP, HSTS, X-Frame-Options, nosniff — all live |
| Cron endpoints | All 5 return **401** without `CRON_SECRET` |
| iCal feed without token | **404**, no leak |
| Public pages | ISR, `X-Vercel-Cache: HIT`, 76–360 ms from the UK |
| Email | `harbourhair.co.uk` verified in Resend; SPF + DKIM + DMARC all resolve |
| **Online booking** | **CLOSED** — 5 gates, all unmet (see §3) |

---

## 1. Code fixes — do before opening booking

- [x] **Remove `VERCEL_DEPLOYMENT_ID` from the readiness fingerprint.** *(done 2026-09-17)*
      `src/app/services/operations-readiness.ts:37`. It changes on **every
      deployment**, and the fingerprint comparison at `:157` runs unconditionally
      on the live booking path (`booking-maintenance.ts:44`). Consequence: once
      booking is open, **the next deploy silently closes it again** until someone
      re-runs Admin → Operations. It fails safe, but it is invisible — no UI shows
      the blocker, and `SiteSettings.bookingEnabled` stays `true`, so Admin →
      Settings will read "booking on" while the public site serves the
      maintenance page. Not intentional: it contradicts the comment three lines
      below at `:165` ("ongoing operation does not expire daily") and had no test.
      Fixed, with a regression test in `operations-readiness.test.ts` that was
      verified to fail when the key is put back.

- [x] **Fix the stray `0` on stylist pages.** *(done 2026-09-17)*
      `src/app/stylists/[slug]/page.tsx:173` — `{profile.yearsExperience && (`
      renders a bare `0` when the value is `0`. Live on `/stylists/lox`,
      `/stylists/funky`, `/stylists/ivan` (Shania is `null`, so hers is clean).
      Fixed with `!!profile.yearsExperience`. Ships on the next deploy.

- [x] **Fix the `/book` cost + ordering issue.** *(done 2026-09-17)*
      `src/app/book/page.tsx:26-30`. The comment justifies `force-dynamic` by
      saying SiteSettings is cached for an hour, but the page's first statement
      (`isBookingEnabled()`) **deliberately bypasses that cache**. Every `/book`
      hit is ≥1 uncached Neon query (`X-Vercel-Cache: MISS`, `no-store`), and
      `/book` is linked from every page's footer and the sticky mobile bar.
      Worse at go-live: the readiness gate runs at `:55` but the sign-in redirect
      only at `:128`, so **anonymous** visitors paid 3–4 uncached queries before
      being bounced.
      Fixed by caching `isBookingEnabled()` for 60s, tagged `site-settings` so the
      admin toggle invalidates it instantly; the misleading comment is corrected.
      **Note the reviewed suggestion to "move `getSession()` above the gate" was
      rejected on purpose** — it would break the signed-out marketplace/phone page,
      which is supposed to be visible while booking is closed. The authoritative
      `assertOnlineBookingReady` stays uncached inside the booking transaction, so
      no booking can be written against a stale reading.

- [x] **Fix the FAQ seed drift.** *(done 2026-09-17)*
      `scripts/seed-faqs.mjs` → `scripts/seed-faqs.ts`: the "£8" claim is now
      £19, the hours answer now calls `openingHoursSentence()` instead of a
      hardcoded string, and the file was added to the drift guard in
      `opening-hours-public.test.ts`. Run it with `npx tsx scripts/seed-faqs.ts`
      (not `node`). **This does not repair production** — see §2.

### Optional, not blocking

- [ ] Add `"functionFailoverRegions": ["dub1"]` to `vercel.json`. Single-region
      `lhr1` today means an lhr1 incident takes out sign-in, `/book`, the iCal
      feeds and all four crons while ISR pages keep serving — the site looks
      healthy while nothing transactional works. Dublin keeps failover off the
      transatlantic path. Confirm plan support first.
- [ ] Remove the duplicate `NEON2_*` env set (15 vars pointing at the same Neon
      project id) once confirmed nothing reads those names.

---

## 2. Content fixes — Admin panel, no deploy needed

- [x] **Correct the "£8" haircut FAQ.** *(done 2026-09-17 — written directly to
      the production `Faq` row, key `services-master`)*
      It now reads *"start from £19"*, matching the cheapest haircut on the menu.
      The write re-derived the £19 floor from the `Service` table before applying,
      and aborted unless exactly one row matched the audited text.
      ⚠️ `/services` is ISR with a 1-hour window, so the old text can linger in
      the CDN for up to an hour — **it refreshes immediately on the next deploy.**
      Re-check after deploying §1: `curl -s https://www.harbourhair.co.uk/services | grep -o 'start from £[0-9]*'`

- [ ] **Add stylist bios, taglines and photos.** All four active stylists have
      `bio`, `tagline` and `imageUrl` **null**, so the home page renders an empty
      pair of quote marks and the four `/stylists/<slug>` pages (all in the
      sitemap) are thin content.

- [ ] **Confirm the opening hours everywhere match.** The site publishes
      **Mon–Sun 10:00–19:00** from one source (`opening-hours-public.ts`). The
      Treatwell listing still shows Mon–Sat 10:15–19:00 / Sun 10:30–17:30, and
      lists the address as *Corn Exchange* rather than *Central Arcade*. Google
      weighs name/address/phone/hours consistency — fix at the marketplace and on
      Google Business Profile.

---

## 3. Opening online booking — the order matters

`assertOnlineBookingReady` (`src/app/lib/booking-maintenance.ts`) fails closed and
needs **all five** conditions. Verified against production 2026-09-17: all five
currently fail.

- [ ] **3.1 — Clear the Treatwell "takes bookings" ticks.**
      Admin → Integrations. Four `TREATWELL` connections have
      `receivesBookings = true` with no inbound URL: **Lox, Funky, Ivan, and
      inactive Chan**. Treatwell has no export feed, so that inbound URL can
      **never** exist — this blocker is permanent until the ticks are cleared.
      ⚠️ The gate-5 count does **not** filter on `isActive`, so **Chan's row
      blocks even though Chan is retired**. The count must reach **0** (currently 8).

- [ ] **3.2 — Subscribe Shania's outbound feed in Fresha.**
      Funky, Ivan and Lox are already being polled (visible in the runtime logs);
      Shania's is not.

- [ ] **3.3 — Set the environment flags, then redeploy.**
      `NOTIFICATIONS_ENABLED=true` and `CALENDAR_SYNC_ENABLED=true`.
      **Env changes only reach the runtime after a redeploy.**

- [ ] **3.4 — Wait for `calendar-sync` to run at least once** (every 30 min).
      The gate demands `lastSuccessAt` **within 90 minutes**. While
      `CALENDAR_SYNC_ENABLED` was `false` the cron returned before touching the
      DB, so the last success is stale — it cannot go fresh until 3.3 is live.

- [ ] **3.5 — Tick the outbound confirmations.**
      Admin → Integrations. `outboundConfirmedAt` is `NULL` on all four `FRESHA`
      connections.

- [ ] **3.6 — Run Admin → Operations diagnostics, and run it LAST.**
      It currently sits at 6/7 (only `notifications` fails, deliberately). The
      report is invalidated by any change to `EMAIL_FROM`, `EMAIL_REPLY_TO`,
      `SALON_NOTIFY_EMAIL`, `RESEND_API_KEY`, `CRON_SECRET`,
      `NOTIFICATIONS_ENABLED`, `POSTGRES_URL`, `DATABASE_URL` — **and, until §1 is
      fixed, by every deployment.** So this must be the last step after the final
      deploy.

- [ ] **3.7 — Turn booking on via Admin → Settings.**
      **Do not write `bookingEnabled` straight into the database.**
      `getSiteSettings` is an `unstable_cache` with a 1-hour TTL; only the admin
      action invalidates the `site-settings` tag. A direct DB write leaves
      `/book` showing the maintenance notice for up to an hour.

---

## 4. Business decisions — owner input needed

- [ ] **Which marketplace is the live channel — Treatwell or Fresha?**
      The site currently sends every customer to **Treatwell** (`treatwellUrl` set,
      `freshaUrl` empty), while the calendar sync runs on **Fresha**. The Treatwell
      listing is still live.

- [ ] **If the answer is Fresha, three pages need code changes first.**
      `freshaUrl` is read **nowhere** except the admin form and
      `activeMarketplaces()`, which only `/book` uses. `TrustBar.tsx`,
      `VisitFollowBlock.tsx` and `SocialLinks.tsx` are hardcoded Treatwell-only,
      and `VisitFollowBlock.tsx:11` hardcodes the prose *"book through Treatwell"*.
      Simply swapping the URLs in Admin would **remove the booking link from the
      home page and footer entirely** and leave that sentence contradicting itself.

- [ ] **Add a second admin account.** Production has exactly **one** admin,
      `info@harbourhair.co.uk`. The seeded placeholder did not survive the London
      database move, so there is no backup login. Sign-in lowercases the submitted
      email but nothing normalises on write — **always insert lowercase**, or the
      account can never sign in.

---

## 5. After booking opens — verify, do not assume

- [ ] Load `/book` **signed out** → should redirect to `/auth/signin?redirect=/book`.
- [ ] Load `/book` **signed in** → the calendar renders with real slots.
- [ ] Make one **real test booking**, then confirm:
  - [ ] the confirmation email actually arrives (Resend shows `delivered`);
  - [ ] the appointment appears on the Admin schedule board;
  - [ ] it appears in the stylist's Fresha calendar within ~10 minutes;
  - [ ] cancelling it frees the slot again.
- [ ] Re-check `/api/health` returns `database: up`.
- [ ] Watch Neon CU-hours for 48 h. Budget is 100/month; September was tracking
      at ~22. See `readme/` and the cost notes for the polling rules.

**Rollback:** Admin → Settings, switch `bookingEnabled` off. It fails closed, so
booking shuts immediately; cancellation deliberately stays available to customers.

---

## 6. Deferred — not blocking launch

- [ ] DMARC is `p=none`; move to `p=quarantine` once the `rua` reports look clean.
- [ ] Sitemap lists 20 URLs; 11 are indexed.
- [ ] `@react-email/components` is marked deprecated upstream.
- [ ] Some stylists start at 10:15 / 10:30 while the site advertises 10:00. This is
      deliberate — marketing hours (`opening-hours-public.ts`) are not the same as
      bookable `Availability`.
