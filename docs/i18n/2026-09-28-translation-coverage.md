# Translation coverage — English (en-GB) / 繁體中文 (zh-HK)

Date: 2026-09-28. Scope: everything a visitor, customer, admin or kiosk user can see.
How it is built: `docs/superpowers/plans/2026-09-28-i18n-implementation-conventions.md`.

There are two kinds of text, and they are covered differently:

1. **Interface text** (labels, buttons, states, errors, emails, metadata) lives in the
   typed dictionaries under `src/i18n/messages/{en,zh}/`. `zh` is typed from `en`, so a
   missing key fails `tsc`. `messages/completeness.test.ts` also fails on an empty
   string or a leftover English placeholder.
2. **The salon's own content** (service names and descriptions, category pages, FAQs,
   blog posts, stylist profiles, offers, home-page hero) lives in the database. Chinese
   is published per record in `ContentTranslation`, through the bilingual editor in
   Admin or the one-off import (`prisma/content-translations/`). A record without a
   Chinese translation shows its English on Chinese pages, marked `lang="en"`.

## 1. Interface dictionaries

| Namespace | en | zh | Used by |
|---|---:|---:|---|
| common | 113 | 113 | header, footer, nav, language switcher, pagination, shared states |
| errors | 50 | 50 | booking/auth/validation error codes |
| pricing | 31 | 30 | price parts, NHS/VAT labels, option labels, ranges |
| emails | 98 | 97 | every customer and salon email, plain-text part |
| home | 37 | 36 | home page |
| services | 43 | 43 | /services, /services/[slug] |
| stylists | 41 | 41 | /stylists, /stylists/[slug] |
| offers | 23 | 23 | /offers (paused notice) |
| contact | 43 | 43 | /contact |
| reviews | 53 | 51 | /reviews, /reviews/new |
| blog | 25 | 25 | /blog, /blog/[slug] |
| tryColor | 134 | 134 | /try-color |
| legal | 30 | 30 | /privacy, /unsubscribe |
| auth | 115 | 115 | sign in, register, forgot/reset password, MFA pages |
| booking | 76 | 75 | /book (wizard, closed page, gates, confirmation) |
| appointments | 43 | 43 | /appointments (view, cancel, reschedule) |
| admin | 31 | 31 | admin shell, sidebar |
| adminSchedule | 177 | 172 | schedule board, opening hours |
| adminCatalog | 130 | 129 | services, categories |
| adminContent | 379 | 379 | bilingual editor, FAQs, blog, stylists, offers, discounts, reviews, settings |
| adminOps | 210 | 208 | operations, integrations, admin users |
| adminStaff | 218 | 215 | employees, timesheets, shifts, payroll |
| kiosk | 19 | 19 | /kiosk |
| **Total** | **2,119** | **2,102** | |

The en/zh differences are plural forms only: English has `one` + `other`, Chinese has
`other`.

## 2. Routes

Every route exists at the unprefixed English URL and at `/zh-hk/...`. ✓ means interface
text comes from the dictionaries in both languages.

| Route | Namespaces | Database content on the page |
|---|---|---|
| `/` | home, services, pricing, common | hero (SITE_SETTINGS), featured offerings, stylists, reviews, FAQs |
| `/services` | services, pricing | offerings + options (SERVICE_OFFERING, SERVICE), JSON-LD |
| `/services/[slug]` | services, pricing | CATEGORY_CONTENT, options, FAQs |
| `/stylists`, `/stylists/[slug]` | stylists | STYLIST (name never translated) |
| `/blog`, `/blog/[slug]` | blog | BLOG_POST |
| `/reviews`, `/reviews/new` | reviews | review text is the customer's own words, not translated; service name localized |
| `/offers` | offers | paused notice while `DISCOUNTS_PAUSED` |
| `/contact` | contact, common | opening hours (day names localized), phone/address from settings |
| `/try-color` | tryColor | colour data (names are product names) |
| `/privacy`, `/unsubscribe` | legal | — |
| `/book` | booking, pricing | services, offerings, stylists (role) |
| `/appointments` | appointments, pricing | the booking's frozen quote |
| `/auth/*` (signin, register, forgot, reset, mfa, mfa/setup) | auth | — |
| `/admin/*` (30 pages) | admin, adminSchedule, adminCatalog, adminContent, adminOps, adminStaff | admin sees both languages side by side in the bilingual editor |
| `/kiosk` | kiosk | employee names |
| not-found, error, loading | common | — |
| `global-error.tsx` | inline two-language copy (the i18n layer may be what failed) | — |

## 3. States and non-page text

| Item | Covered | Where |
|---|---|---|
| Loading skeletons, empty lists, pagination | ✓ | common |
| Form validation (Zod issues) | ✓ | schemas emit codes; `issueText` / namespace `errors` |
| Booking errors (slot taken, price changed, gate closed, rate limit …) | ✓ | `BookingError.code` → `errors.booking` |
| Auth errors, rate limit, register gate | ✓ | auth, errors |
| Price-changed re-confirmation | ✓ | booking + pricing |
| Online-booking readiness checks (Settings error, Integrations page, dashboard setup notice) | ✓ | coded checks → `adminOps.readiness.*`, prefixed with stylist / provider; a check without a code shows its English text marked `lang="en"` |
| Emails (confirmation, request, approval, decline, cancel, reschedule, reminder, salon alerts, password reset) | ✓ | emails; language = `Appointment.notificationLocale`, salon copy = `SiteSettings.salonNotificationLocale` |
| Outbox retries | ✓ | frozen snapshot (schema 2 carries locale); legacy schema-1 events send in English |
| `<title>`, description, Open Graph, `og:locale` | ✓ | per-page `generateMetadata` |
| `hreflang`, canonical, sitemap alternates | ✓ | `alternatesFor`, `sitemap.ts` |
| JSON-LD (Service, FAQPage, Offer) | ✓ | localized names; standard prices only; `valueAddedTaxIncluded: false` |
| Dates, times, months, currency | ✓ | `src/i18n/dates.ts`, `format.ts` (Europe/London, `£` in both) |
| Screen-reader labels (`aria-label`, `sr-only`) | ✓ | per namespace |
| Language switcher | ✓ | header (≥ xl), mobile menu, admin sidebar and top bar, kiosk |

## 4. Database content (Chinese via `ContentTranslation`)

| Entity | Translated fields | In `zh-HK.json` |
|---|---|---:|
| SERVICE (option) | name, description, priceNote | 53 |
| SERVICE_OFFERING | name, description | 14 |
| CATEGORY_CONTENT | title, hero, metaDescription, intro, overview, includes, process, aftercare, faqs | 5 |
| FAQ | question, answer | 17 |
| BLOG_POST | title, description, excerpt, authorRole, coverAlt, lede, sections | 3 |
| STYLIST | role, bio, tagline, specialties, languages, trainedIn, extendedBio | 5 |
| SITE_SETTINGS | hero eyebrow, title lines, subtitle | 1 |
| OFFER | title, description | 0 (all offers paused) |

Rehearsal on an anonymised copy of production: 98 WRITE, then a re-run was 98
UP_TO_DATE (`docs/i18n/2026-09-28-content-import-production-preview.md`). An entry is
skipped as STALE if production English changed after the translation was made.

## 5. Deliberately not translated

- Brand and proper names: Harbour Hair, stylist and employee names, Treatwell, Fresha,
  Google, NHS, VAT, product and colour names.
- The postal address (a UK address, written as Royal Mail expects).
- Customer-written text: review bodies, booking notes, names.
- Admin data values the owner types: category names (`Haircuts`), slugs, image paths,
  user ids, audit metadata. The placeholders showing example slugs and paths are
  examples of data, not prose.
- API route and cron responses, health checks, server logs.
- Server-side guard errors that the interface never shows (`Unauthorized` thrown when
  a non-admin calls an admin action; middleware stops them first).

## 6. Owner review still needed (content, not code)

Found while translating. Fix the English first in Admin, then the Chinese.

- **Student discount wording** is still in the English content (category intros, and the
  legacy option names such as "Long Hair - Wash, Haircut & Blow Dry (Student & NHS)"
  shown in Admin). The public menu uses offering + option labels, so customers see
  "Long hair · NHS". The Chinese follows the English as written.
- **Patch test FAQ** says the patch test is free; the price list has a priced patch
  test. One of them is wrong.
- **FAQs that tell people to book on Treatwell.**
- Terminology choices worth a native read: 洗剪吹, 冷燙 / 熱燙, 列斯 for Leeds, and the
  names left in English inside Chinese (Balayage, Hair Correction, Keratin, Paimore, Inkarami).

## 7. Verified

- `tsc` (zh keys typed from en), `completeness.test.ts`, 796 unit tests pass.
- Headless Chrome against a production build on the anonymised copy:
  - booking wizard en → zh → en at the confirm step: same service, NHS option,
    stylist, date, time and £45.00. The summary is translated. Back/forward returns
    the Chinese URL with Chinese SSR. Nothing is submitted.
  - admin service edit: unsaved settings, both content languages, the open content tab
    and the shared price survive en → zh → en. A plain reload discards them. The
    database is unchanged.
  - 8 public routes × 2 languages × 4 widths (320, 375, 820, 1366): correct `lang`, no
    horizontal overflow, switcher reachable (header on desktop, menu below xl).
- Static scan of 142 `.tsx` files for English text outside dictionaries: the remaining
  hits are TypeScript generics, brand names, the address and example placeholders.

Not verified: MFA pages in a browser (MFA is dormant in production, so they are
unreachable). They are covered by unit tests and a server render check.
