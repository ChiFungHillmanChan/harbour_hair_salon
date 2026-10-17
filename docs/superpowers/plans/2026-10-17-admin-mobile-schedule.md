# Admin mobile schedule implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and independent review. The user approved the design in chat and explicitly requires every admin section, navigation item and existing scheduling action to remain available.

**Goal:** Improve the mobile admin schedule, calendar appearance and service/duration entry without changing booking or integration behaviour.

**Architecture:** Keep the existing admin layout, schedule routes, Server Actions and Prisma models. Introduce display-only calendar tones, a chronological phone agenda and a progressively filtered service selector built from existing offering/option data. The booking form keeps all customer, payment, consultation and arrival controls.

**Tech stack:** Next.js 16.3.8, React 19, Tailwind v4, Prisma, bilingual dictionaries, node:test.

**Spec:** The mobile design approved in chat on 17 October 2026, with the explicit requirement to retain every admin section and schedule action.

## Global constraints

- Preserve all 19 admin navigation links, language switching, POST sign-out and route protection.
- Keep Google colour IDs and their classification/push meaning unchanged; only presentation changes.
- Preserve every booking action, recorded price, retired-service editing, pending request and deposit control.
- Duration remains an integer from 15 through 720; 55 and 85 are valid. Blank is allowed while editing; invalid values cannot save.
- Every new UI string has English and Traditional Chinese translations. Use Tailwind classes written in full.
- No database migration, new polling or production data changes. No live customer data in local fixtures.
- Other work is in the original checkout; implement only in this worktree. Avoid overwriting another worker's edits.

## Task 1 — Service picker and duration entry

**Owner:** Form worker. **Files:** AppointmentDialog.tsx and its tests, new focused service picker/helper if useful, admin-calendar-data.ts/tests; only `dialog` and new `servicePicker` dictionary keys in both adminSchedule dictionaries.

- [x] Add behavioural regression tests before implementing: `00120` becomes `120`, blank stays editable, invalid/out-of-range input cannot save, 55/85 submit correctly; retired service preserves original quote.
- [x] Read offering names and translations with the existing service query; retain standalone services and existing IDs. Search/category/offering/actual length/price options filter locally; never parse names or manufacture combinations.
- [x] Use a string-backed digit input with `inputMode="numeric"`; convert to a number at the validated submit boundary. Show duration and end-time preview. Keep draft restoration across locale changes compatible with existing numeric drafts.
- [x] Keep date/time/duration readable at 320px, the dialog footer reachable above the keyboard and all existing actions intact.
- [x] Run focused tests, then report files and results. Do not commit while other workers edit shared dictionaries.

## Task 2 — Calendar presentation and mobile agenda

**Owner:** Calendar worker. **Files:** calendar-colors.ts/tests, ScheduleCalendar.tsx, ScheduleDayGrid.tsx, ScheduleWeekGrid.tsx, admin/page.tsx, agenda helper/components and relevant tests; dictionary keys outside `dialog`/`servicePicker`.

- [x] Add behavioural coverage for chronological mixed-source entries and visible mapped stylist names, without duplicating or dropping entries or actions.
- [x] Introduce pale display tones, dark text, narrow hue accents and quiet blocked backgrounds. Raw Google swatches/picker IDs remain exact. Preserve day/week drag, resize and confirmation.
- [x] Preserve five statistics but compact their phone layout; label website-only counts accurately. Keep attention/arrival controls visible. Condense refresh copy into expandable details.
- [x] Keep all four period views, Today/date navigation and New booking. Fit toolbar at 320px. Add a stylist filter scoped to the displayed diary, leaving attention queues global.
- [x] Merge timed phone entries into time order, retaining source boundaries/actions and read-only Google handling. Put notes/all-day information in a clear compact section. Remove nested phone scrolling.
- [x] Run focused tests and report results. Do not commit or edit form-owned dictionary sections.

## Task 3 — Navigation preservation and integration verification

**Owner:** Controller. **Files:** AdminSidebar.tsx, admin/layout.tsx, relevant navigation tests, readme/structure.md.

- [x] Preserve every navigation destination and active state; improve wrapping, safe viewport sizing and drawer keyboard/focus behaviour where needed. Fix flex minimum-width overflow without hiding content.
- [x] Run targeted baseline tests before changes. Run lint, type checking, full unit suite and production build after integration.
- [x] Use a disposable local fixture preview of the actual changed components to inspect 320/390/768/1024/1440 widths in English and Chinese. Verify drawer open/close/route links, all period controls, booking form selection and minute entry. Never load production credentials into the preview.
- [x] Independent final review covering functional regressions and approved scope; resolve actionable findings and rerun affected checks.
- [x] Record verification and leave the isolated branch reviewable; production deployment is not part of this request.

## Verification completed

- Node 24: all 2,250 unit tests passed; ESLint and TypeScript checks passed.
- Production build passed against a fresh, fully migrated localhost PostgreSQL database; the temporary server was stopped afterwards. No production or preview database was used.
- Actual admin components were rendered in a local browser harness with synthetic appointments and server I/O replaced by fixtures. Both English and Traditional Chinese fit at 320, 390, 768, 1024 and 1440 pixels without document-level horizontal overflow.
- Verified all four calendar periods, local stylist filtering, read-only Google entry details, service search/option selection, `00120` and typing after `0` normalizing to `120`, validation, and the end-time preview.
- Verified all 19 navigation links, short-screen drawer scrolling and reachable Sign Out, Tab/Shift-Tab containment, Escape/focus return and the scroll-lock reset when rotating to desktop width.
- Independent review found no actionable regressions in booking/payment/arrival behavior, recorded prices, drafts, bilingual labels, navigation or Google colour mapping.
- Responsive checks use Chrome viewport emulation; physical iOS/Android keyboard behavior was not exercised. No deployment performed.
