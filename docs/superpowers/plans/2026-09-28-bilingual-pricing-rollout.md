# Treatwell price list + English/繁體中文 site — production rollout and rollback

Date: 2026-09-28. Status: **applied to production on 2026-09-29 (UTC night of 09-28):**
code + migration deployed by GitHub Actions (5bfc5e0; the build's `vercel-build` step ran
`prisma migrate deploy`), price catalogue applied (`docs/pricing/2026-09-29-price-mapping-production.md`,
identical to the rehearsal; rollback file kept outside the repo in the owner's client documents),
Chinese content imported (`docs/i18n/2026-09-29-content-import-production.md`, 98 records).
Steps 6–7 below (durations of the 7 new options, salon notification language) are the owner's.
Requirements: `2026-09-28-treatwell-pricing-bilingual-implementation-prompt.md`.
How the code is organised: `2026-09-28-i18n-implementation-conventions.md`.
What is translated and what is deliberately not: `docs/i18n/2026-09-28-translation-coverage.md`.

## What changes on deploy (code only)

Deploying the code alone (migration applied, data tools NOT yet run) is safe:

- Pages move under an internal `[locale]` segment. English URLs are unchanged; Chinese
  is served at `/zh-hk/...`. `/en-gb/...` 308-redirects to the unprefixed URL.
- Offers and discount codes stop applying to any new quote or booking (DISCOUNTS_PAUSED).
  The header/footer "Offers" link disappears and `/offers` shows a paused notice.
  Existing Offer/DiscountCode rows and their admin screens are untouched.
- New bookings store a server quote (`Appointment.quoteJson`) and the customer's
  language (`Appointment.notificationLocale`). Existing bookings keep their price.
- Customer booking must confirm the price shown; a stale price returns the new quote.
- Until the price tool runs, services have no option links: the site lists them as
  standalone rows exactly as today (prices unchanged, no VAT wording, no NHS pairing).
- Chinese pages show English database text (marked `lang="en"`) until the content
  import runs.

## Production data work (in order)

All commands run from a checkout of the deployed commit, with production credentials
pulled to a scratch file (`npx vercel env pull <file> --environment=production`) and
passed EXPLICITLY — the tools never read `.env` files. Neon costs: each step wakes the
compute once; run them together.

1. **Migration** — `20260928120000_pricing_options_and_bilingual_content` (additive:
   new columns with defaults, three new tables, no data change). It is applied by the
   normal GitHub Actions deploy: `vercel build --prod` runs the `vercel-build` script, which
   runs `prisma migrate deploy` before `next build`. CI replays it and checks drift first.

2. **Price catalogue — dry run** (read-only transaction):

   ```bash
   CATALOG_DATABASE_URL="$POSTGRES_URL_NON_POOLING" npx tsx prisma/price-catalog/apply-price-catalog.ts \
     --report docs/pricing/price-mapping-production.md
   ```

   Review the report. It must say "Problems: None". The rehearsal on an anonymised copy
   of production taken 2026-09-28 (`docs/pricing/2026-09-28-price-mapping-production-preview.md`)
   found: 37 options updated, 7 created, 5 unverified NHS options retired, 4 left
   unchanged, 0 unmapped rows, 0 appointments without a recorded price. The only
   price change for an existing option is long-hair wash/cut/blow-dry NHS £44 → £45.

3. **Price catalogue — apply** (one Serializable transaction; aborts if anything changed
   since the dry run; writes the previous values first):

   ```bash
   CATALOG_DATABASE_URL="$POSTGRES_URL_NON_POOLING" npx tsx prisma/price-catalog/apply-price-catalog.ts \
     --apply --confirm-host <host printed by the dry run> \
     --rollback-file <secure location>/price-catalog-rollback-<date>.json
   ```

   If the dry run reported appointments without a recorded price, apply also needs
   `--acknowledge-null-prices <n>` after they have been reviewed (they are displayed
   as "price not recorded" and payroll refuses to use them for commission).

4. **Chinese content — dry run, then apply**:

   ```bash
   CONTENT_DATABASE_URL="$POSTGRES_URL_NON_POOLING" node --conditions=react-server --import tsx \
     prisma/content-translations/import-content-translations.ts --report docs/i18n/content-import-production.md
   CONTENT_DATABASE_URL="$POSTGRES_URL_NON_POOLING" node --conditions=react-server --import tsx \
     prisma/content-translations/import-content-translations.ts --apply --confirm-host <host>
   ```

   Entries whose English changed since the translation was made are reported STALE and
   skipped; translate those in Admin with the bilingual editor.

5. **Cache** — the tools write directly to the database, but public pages are cached for up to
   an hour. Refresh once: push any commit (a new deployment rebuilds every page), or in
   Admin → Settings press Save (revalidates every page and the settings cache).

6. **Owner decisions still needed before the new options can be booked online**: the
   durations of the 7 new extra-long options (created with placeholder minutes, listed
   but not bookable). In Admin → Services → edit, set the duration, tick "Duration
   confirmed", then "Open for new bookings".

7. **Salon notification language** — Admin → Settings → "Salon notification email
   language" (defaults to 繁體中文).

## Verification after each step

- `/services` and `/zh-hk/services`: identical figures; each menu item shows standard
  and NHS columns; "VAT excluded"/"未含 VAT" next to prices; no NHS option for kids,
  perms, Hair Correction, Keratin, Paimore; extra-long colour £194 / £179 with
  "Long hair price £157.00 + extra long £37.00".
- Booking wizard (when booking is enabled): NHS choice shows "NHS price applied";
  no discount-code field.
- Retired NHS options appear nowhere public and cannot be booked by id.
- Admin → Services shows retired options with "Hidden / Not bookable" badges.

## Rollback

- **Price data**: `apply-price-catalog.ts --rollback <rollback file> --confirm-host <host>`
  restores the previous service values (price, VAT wording, links, visibility), bumps the
  price version so open pages re-confirm, and hides (never deletes) the created options.
  Appointments — including any booked at the new prices — keep their frozen amounts and
  quotes. After a rollback, re-applying leaves the created options hidden; re-list them in
  Admin if wanted.
- **Chinese content**: published translations live in `ContentTranslation`; deleting the
  `zh-HK` rows (or publishing corrected text in Admin) reverts Chinese pages to English
  fallback. English content is never changed by the import.
- **Code**: redeploy the previous commit. The migration is additive; the old code ignores
  the new columns and tables. New bookings made in the meantime keep `quoteJson` and
  `notificationLocale`, which the old code does not read.
- **Discount pause**: a code change (`DISCOUNTS_PAUSED` in
  `src/app/services/pricing/policy.ts`) — but re-enabling needs agreed rules for how
  offers combine with NHS prices first.

## Not done / not verified

- Treatwell prices were NOT re-read on the platform for this work; the catalogue uses the
  2026-09-28 figures recorded in the design document.
- The £37 "Adds Extra Long" line's own VAT label on Treatwell is unverified (the composite
  rows record this as owner policy, not a platform fact).
- £20 Special Set and the second £15 patch-test item are deliberately not implemented.
- No email was sent to a real address; delivery stays behind `NOTIFICATIONS_ENABLED`.
