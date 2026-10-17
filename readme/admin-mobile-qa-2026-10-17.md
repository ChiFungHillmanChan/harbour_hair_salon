# Admin mobile review — 17 October 2026

The admin keeps its existing fields, actions, validation and confirmations. Mobile lists use labelled cards, statistics take less vertical space, creation/setup sections expand when needed, and inputs and action targets accommodate touch. Desktop lists retain their tables. Site Settings includes section links.

## Browser checks

Tested the real Next.js app with synthetic records in an isolated local PostgreSQL database; production credentials and outbound integrations were disabled.

- All 30 admin routes (including every create/edit route) and the staff kiosk rendered in English and Traditional Chinese at 320 × 740 without page-level horizontal overflow or application errors.
- The same 31 routes passed at 768 × 1024. Schedule, services, employees, settings, integrations, operations and payroll also passed at 1440 × 1000.
- Expanded integration settings, stylist feeds, employee creation, shifts, discounts, offers, FAQs and admin-user forms fit the phone width.
- The mobile navigation exposes all 19 destinations. The services accessibility tree retains table, row and cell structure, column headings, labels and actions.
- Visually checked mobile record cards and integration sections at 390 × 844 with populated synthetic data.

## Regression checks

- All 2,278 tests pass; ESLint, TypeScript and whitespace checks pass.
- Production build passes using Node 24 and a fresh local PostgreSQL 18 database.
- PostgreSQL concurrency/rollback, booking lifecycle/calendar reconciliation and production HTTP authorization/pagination checks pass.
- Independent diff review found no changed form names, values, required fields, limits, disabled states, actions or confirmation handlers.

Real payment and calendar services were not exercised by this presentation-only change; their existing guards and business logic were not changed.
