# Bilingual (en-GB / zh-HK) implementation conventions

Date: 2026-09-28. Companion to
`docs/superpowers/plans/2026-09-28-treatwell-pricing-bilingual-implementation-prompt.md`
(the requirements) — read that first. This file is the HOW every area must follow.

## Architecture (already built — do not change)

- All pages live under `src/app/[locale]/`. English keeps its old URLs
  (`/services`); Chinese is `/zh-hk/services`. `src/middleware.ts` rewrites
  unprefixed URLs to the internal `/en-gb/...` segment, validates `/zh-hk`,
  applies the SAME auth rules to the language-free path, and stamps the
  validated language on the `x-harbour-locale` request header.
- API routes, cron, ICS, OAuth callback, sitemap, robots and /public files keep
  their language-free paths (`src/app/api`, `src/app/sitemap.ts`, …).
- Switching language is a soft navigation; React remounts the page, but
  module memory survives. Unsaved state is carried by `src/i18n/draft-store.ts`.
- Public pages stay ISR (`export const revalidate`). NEVER make a public page
  `force-dynamic`, and never read `cookies()`/`headers()` in a public page.

## APIs

| Where | Use |
|---|---|
| Server Component / page / layout / `generateMetadata` | `import { getLocale, getT } from '@/i18n/server'` → `const t = await getT('home')` |
| Client component | `import { useT, useLocale } from '@/i18n/client'` → `const t = useT('home')` |
| Server Action, route handler, `lib/*` or `services/*` helper, anything unit-tested | `import { getActionLocale, getActionT, localizedPath } from '@/i18n/request'` — NEVER `@/i18n/server` (it imports `next/root-params`, which throws outside the Next compiler and in `pnpm test`) |
| Known language (emails, scripts, tests) | `import { translator } from '@/i18n/messages'` → `translator('zh-HK', 'emails')` |
| Links | `import Link from '@/i18n/link'` instead of `next/link` everywhere (auto-prefixes `/zh-hk` for internal paths; leaves external, `tel:`, `/api`, files, `#anchor` alone) |
| `router.push/replace` | `import { useLocalizedRouter } from '@/i18n/navigation'` |
| Pathname checks | `stripLocale(usePathname())` from `@/i18n/paths` before `startsWith('/admin')` etc. |
| Server redirect | `redirect(await localizedPath('/admin/faqs?saved=1'))` (keep each module's own `redirect` import so tests can mock `next/navigation`) |
| Page cache invalidation | `revalidateAllLocales(revalidatePath, '/services')` from `@/i18n/revalidate` (already converted in `src/app/actions`) |
| Sentence with a link/bold | `rich(t('x'), { link: (text) => <Link href="/a">{text}</Link> })` from `@/i18n/rich`; message: `'See <link>My Bookings</link>.'` |
| Runtime key (status, code) | `t.dynamic(\`status.${code}\`, params, fallback)` |
| Plural | en `{ one: '{count} booking', other: '{count} bookings' }`, zh `{ other: '{count} 個預約' }`, call `t('x', { count })` |
| Dates/times | `@/i18n/dates` (`formatSalonLongDate`, `formatSalonMediumDate`, `formatSalonClock`, `formatSalonDateTime`, `formatCalendarDay`, `formatMonth`, `formatSalon`). Always Europe/London. Never `toLocaleDateString('en-GB')` or date-fns `format` for human-readable labels (date-fns is still fine for arithmetic and machine `yyyy-MM-dd`). |
| Money | `formatGBP(pence, HTML_LANG[locale])` from `@/app/services/pricing/money`; client: `useFormatPrice()` from `@/components/pricing/PriceParts` |

### Metadata

Replace `export const metadata = {...}` with:

```ts
export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('contact')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/contact'),        // from '@/i18n/metadata'
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.ogTitle'), description: t('meta.ogDescription') },
  };
}
```

Pages with params: `generateMetadata({ params })` as before plus `getLocale()`.
Keep existing `robots` settings (account/admin/kiosk/booking stay noindex).

### Which strings reach the browser

`common` is provided by the root layout. Admin layout provides `admin,
adminSchedule, adminCatalog, adminContent, adminOps, adminStaff, pricing,
errors`. Auth layout provides `auth`. A PUBLIC page whose client components
need a namespace wraps them in the server component
`<ClientMessages namespaces={['reviews']}>…</ClientMessages>` from
`@/i18n/ClientMessages` — only the namespaces listed are sent.

## Dictionaries

- `src/i18n/messages/en/<ns>.ts` (`satisfies MessageTree`) and
  `src/i18n/messages/zh/<ns>.ts` (`Localized<Messages['<ns>']>`). The type check
  fails on any missing/extra key; `src/i18n/messages/completeness.test.ts` also
  checks placeholders and rich tags match. Keep keys nested by page/section
  (`meta`, `hero`, `form.errors.…`).
- Each work area OWNS specific namespaces (listed in its brief). Do not edit
  another area's namespace. Lead-owned, do not edit: `common`, `errors`,
  `pricing`, `booking`, `emails`, `adminCatalog.serviceForm`,
  `adminContent.editor`, `adminContent.fields`. Add what you need to your own
  namespace instead of editing a shared one.

### Language rules

- zh-HK: Traditional Chinese, Hong Kong written usage (預約, 髮型師, 電郵,
  登入, 網上, 查詢, 取消, 改期, 營業時間). Natural, not word-for-word. Staff
  notification copy (emails namespace) is Cantonese-leaning — lead handles it.
- en-GB: keep the existing English wording exactly unless it was broken.
- Never translate or rewrite: people's names, customer notes, review text,
  emails, phone numbers, IDs, URLs, raw external diagnostics, product brands
  (Keratin, Paimore, Dr.Jr. TOKIO Inkarami), platform names (Treatwell, Fresha,
  Google, Resend, Neon, Vercel), "Harbour Hair Salon". "Hair Correction" stays
  English in Chinese too. Translate only the labels around them.
- Every visible string counts: text, headings, button labels, `aria-label`,
  `title`, `alt`, `placeholder`, `confirm()`/`alert()` text, validation and
  action error messages, empty/loading/error states, `<option>` labels, table
  headers, `sr-only` text, metadata, JSON-LD human-readable names.

## Errors from Server Actions

Return text in the caller's language: `const t = await getActionT('adminOps')`
and return `t('users.errors.NOT_FOUND')`. Zod: put a CODE in the schema message
(`z.string().min(1, 'NAME_REQUIRED')`) and translate the code with
`t.dynamic(\`…errors.${issue.message}\`, undefined, t('…errors.INVALID'))`.
Never map English error text to a translation.

## Database content (translatable records)

Public reads must use the locale-aware functions (published translations only,
English fallback):

- `getPublicCatalog(locale)` — every public price display (services, options,
  offerings). Never query `prisma.service` directly on a public page.
- `getCategoryContentBySlug(slug, locale)`, `getAllCategoryContent(locale)`,
  `getRelatedCategories(slugs, locale)`
- `getFaqsByKey(key, locale)`
- `getPublishedPosts(page, locale)`, `getPublishedPostBySlug(slug, locale)`,
  `getRelatedPublishedPosts(slugs, locale)`
- `getAllStylistsWithSlug(locale)`, `getStylistBySlug(slug, locale)`,
  `getRelatedStylists(id, locale)`
- `getHeroContent(locale)` for the homepage hero text

Records carry `translated: boolean`; when false on a zh page, put `lang="en"`
on the element showing it.

Admin editing of translatable text uses `BilingualContentEditor`
(`src/components/admin/BilingualContentEditor.tsx`): edit mode (Save draft →
Mark checked per language → Publish both) and create mode (inside the create
form; posts `contentJson` + `contentReviewed`; the create action calls
`createPublished` from `src/app/services/content/drafts.ts`). Operational
fields (booleans, dates, slugs, images, ordering, prices of non-service
records) keep saving immediately. See `ServiceForm` + the service edit page for
the reference integration. Translatable fields per record type are declared in
`src/app/services/content/fields.ts`.

## Keeping unsaved state across a language switch

- Uncontrolled forms (`defaultValue`): `const formRef = usePreservedForm('faq-form:' + id)`
  and `<form ref={formRef} …>`; call `clearDraft(key)` after a successful save.
- React state that must survive (selected tab, filters, wizard steps, one-time
  results): `useDraftState(key, initial)` instead of `useState`.
- Memory only — never URL/localStorage/sessionStorage. `clearAllDrafts()` on
  sign-out/sign-in.

## Tests and checks (run before you finish)

- `pnpm exec tsc --noEmit -p .` — no new errors (4 pre-existing ones in
  `src/components/try-color/colorMath.test.ts` are known).
- `pnpm exec eslint <your files>`
- `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= pnpm test`
- Tests that load a page/action with `loadServerModule` and a dependency map:
  if you add an import, add a mock when needed, e.g.
  `'@/i18n/server': { getLocale: async () => 'en-GB', getT: async (ns) => translator('en-GB', ns) }`.
  Keep assertions on English output unchanged.

## Ground rules

- Do not change business logic, pricing, permissions, booking/cancellation
  policy, cron cadence or anything that adds database queries to public pages.
- The working tree contains the owner's uncommitted Core Web Vitals edits
  (`Hero.tsx`, `StylistShowcase.tsx`, `contact/page.tsx`, `SalonGallery.tsx`,
  `globals.css`). Edit those files in place and keep their existing changes.
- No git commands that change state (no commit, checkout, stash, reset).
- Do not run `pnpm build`, migrations, seeds or anything against a database.
