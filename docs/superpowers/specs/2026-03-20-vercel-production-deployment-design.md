# Harbour Hair Salon — Vercel Production Deployment

## Overview

Ship the salon booking site to Vercel (free tier) with full production features: cloud database, email notifications, customer self-service bookings, appointment reminders, SEO, and security hardening.

**Hosting:** Vercel (Hobby/free plan)
**Database:** Vercel Postgres (Neon)
**Email:** Resend (free tier, 3,000 emails/month)
**Domain:** Default `*.vercel.app`

---

## 1. Database Migration — SQLite/SQL Server to Vercel Postgres

### New Schema

Add `prisma/vercel/schema.prisma` targeting PostgreSQL. Keep `prisma/dev/schema.prisma` (SQLite) for local development.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}
```

All models identical to existing schema with one addition:

- `Appointment` model: add `reminderSent Boolean @default(false)` field

### New package.json Scripts

```json
"db:vercel:generate": "prisma generate --schema prisma/vercel/schema.prisma",
"db:vercel:migrate": "prisma migrate dev --schema prisma/vercel/schema.prisma",
"db:vercel:deploy": "prisma migrate deploy --schema prisma/vercel/schema.prisma",
"db:vercel:push": "prisma db push --schema prisma/vercel/schema.prisma",
"db:vercel:studio": "prisma studio --schema prisma/vercel/schema.prisma"
```

### prisma.ts Update

Update `src/app/lib/prisma.ts` to detect `POSTGRES_URL` and use it when available, falling back to `DATABASE_URL` for local SQLite dev.

### Deployment Steps

1. `vercel integration add neon` — creates Neon database, auto-injects env vars
2. `pnpm db:vercel:deploy` — run migrations against Vercel Postgres
3. Seed data via `prisma/seed.ts`

---

## 2. Email System — Resend + React Email

### Architecture

- **Service:** `src/app/services/email-service.ts` — wraps Resend SDK, `'use server'` directive, runtime env var access
- **Templates:** `src/components/emails/` — React Email JSX components
- **Sender:** `onboarding@resend.dev` (Resend shared domain, free tier)

### Email Templates (4)

#### BookingConfirmation.tsx
- Trigger: immediately after booking creation in `submitBooking()` action
- Content: service name, stylist name, date/time, salon address, link to "My Bookings"

#### BookingCancellation.tsx
- Trigger: after customer or admin cancels appointment
- Content: cancelled appointment details, CTA to rebook

#### BookingReschedule.tsx
- Trigger: after customer reschedules appointment
- Content: old date/time (struck through), new date/time, stylist name, service

#### AppointmentReminder.tsx
- Trigger: Vercel Cron, 24 hours before appointment
- Content: appointment details, salon address, cancel/reschedule link

### email-service.ts Interface

```typescript
'use server';

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void>
export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void>
export async function sendBookingReschedule(appointment: AppointmentWithDetails, oldDate: Date): Promise<void>
export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void>
```

All functions: get Resend API key at runtime, send email, fail silently with console.error (email failure should not block booking operations).

### No Password Reset

Admin resets passwords from admin panel instead. Self-service password reset deferred until custom domain is configured (needed for email deliverability).

### Newsletter Removal

Remove the non-functional newsletter signup UI from `src/app/offers/page.tsx`.

---

## 3. User Booking History — View, Cancel, Reschedule

### New Page: `src/app/appointments/page.tsx`

- Requires authenticated session (redirect to signin if not logged in)
- Two tabs: **Upcoming** (status CONFIRMED/PENDING, date >= now) and **Past** (COMPLETED/CANCELLED or date < now)
- Each booking card: service name, stylist, date/time, status badge, price

### Cancel Flow

1. Customer clicks Cancel on an upcoming booking (button disabled if < 24 hours away)
2. Confirmation modal: "Are you sure you want to cancel?"
3. Server action `cancelAppointment(appointmentId)`:
   - Verify session — user must own this appointment
   - Verify appointment is >= 24 hours away
   - Update status to `CANCELLED`
   - Send cancellation email
   - Revalidate `/appointments` and `/admin`

### Reschedule Flow

1. Customer clicks Reschedule on an upcoming booking (button disabled if < 24 hours away)
2. Opens date/time picker (mini wizard — no service/stylist selection, those stay the same)
3. System calls `getAvailableSlots()` for the **same stylist** and **same service duration**
4. Customer picks new slot, sees confirmation: old time -> new time
5. Server action `rescheduleAppointment(appointmentId, newDate)`:
   - Verify session — user must own this appointment
   - Verify original appointment is >= 24 hours away
   - Verify new slot is available for the same stylist (re-check at write time)
   - Update appointment date in a single Prisma update (atomic — old slot released, new slot claimed)
   - Reset `reminderSent` to `false` (so reminder fires for new time)
   - Send reschedule email with old and new times
   - Revalidate `/appointments` and `/admin`

### New Server Actions in `src/app/actions/booking.ts`

```typescript
export async function cancelAppointment(appointmentId: string): Promise<ActionResult>
export async function rescheduleAppointment(appointmentId: string, newDate: Date): Promise<ActionResult>
```

### Header Update

Add "My Bookings" link in `Header.tsx`, visible when user is logged in and role is `USER`.

---

## 4. Appointment Reminders — Vercel Cron

### API Route: `src/app/api/cron/reminders/route.ts`

- `GET` handler, secured with `CRON_SECRET` header validation
- Query: all appointments where `status = 'CONFIRMED'` AND `date` between now and now + 24 hours AND `reminderSent = false`
- For each: send reminder email via `sendAppointmentReminder()`, then set `reminderSent = true`
- Runs hourly

### vercel.json

```json
{
  "crons": [{
    "path": "/api/cron/reminders",
    "schedule": "0 * * * *"
  }]
}
```

### Edge Cases

- If email send fails, do NOT mark `reminderSent = true` — retry next hour
- If appointment is cancelled between cron runs, skip it (status check in query)

---

## 5. SEO

### Page Metadata

Add `metadata` exports to every page with appropriate title, description, and OpenGraph tags. Pattern:

```typescript
export const metadata: Metadata = {
  title: 'Page Title | Harbour Hair Salon',
  description: 'Specific page description for search engines',
  openGraph: {
    title: 'Page Title | Harbour Hair Salon',
    description: 'Specific page description',
  }
}
```

Pages to update: home, services, book, offers, contact, signin, register, appointments.

### JSON-LD Structured Data

Add `LocalBusiness` schema to `src/app/page.tsx` (home page):
- Business name, address, phone, opening hours
- Helps Google display rich results in search

### robots.ts

```typescript
// src/app/robots.ts
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: undefined, // no sitemap needed yet
  }
}
```

---

## 6. Security & Production Polish

### middleware.ts (Project Root)

Replace `src/proxy.ts` with proper Next.js `middleware.ts`:

- Protect `/admin/*` routes — require valid session with ADMIN role
- Protect `/appointments` route — require valid session (any role)
- Redirect unauthenticated users to `/auth/signin`
- No protection on public pages (home, services, book, offers, contact, auth)

### Security Headers in next.config.ts

```typescript
headers: async () => [{
  source: '/(.*)',
  headers: [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ]
}]
```

### Rate Limiting on Auth

Simple in-memory Map tracking failed login attempts per IP. After 5 failures in 15 minutes, block further attempts. Resets on successful login. Implemented directly in `login()` server action — no external dependency.

Note: in-memory rate limiting resets on serverless cold starts. This is acceptable for a salon site — it deters casual brute force without needing Redis.

### Session Secret

Set `SESSION_SECRET` as a Vercel env var with a cryptographically random 64-character string. Remove the fallback default in `session.ts` for production (throw error if missing).

### Dockerfile Update

Update Dockerfile to use `prisma/vercel/schema.prisma` for production builds instead of `prisma/prod/schema.prisma`. Or, since we're deploying to Vercel (not Docker), the Dockerfile becomes optional/unused for this deployment target.

---

## 7. Cleanup

- Remove newsletter signup section from `src/app/offers/page.tsx`
- Remove `src/proxy.ts` (replaced by `middleware.ts`)
- Remove `output: "standalone"` from `next.config.ts` (not needed for Vercel, only for Docker)

---

## New Dependencies

```bash
pnpm add resend @react-email/components
```

## Environment Variables (Vercel)

| Variable | Source |
|---|---|
| `POSTGRES_URL` | Auto-injected by Neon integration |
| `POSTGRES_URL_NON_POOLING` | Auto-injected by Neon integration |
| `SESSION_SECRET` | Manual — random 64-char string |
| `RESEND_API_KEY` | Manual — from Resend dashboard |
| `CRON_SECRET` | Auto-injected by Vercel |

## Files Created/Modified

### New Files
- `prisma/vercel/schema.prisma`
- `vercel.json`
- `middleware.ts`
- `src/app/robots.ts`
- `src/app/services/email-service.ts`
- `src/components/emails/BookingConfirmation.tsx`
- `src/components/emails/BookingCancellation.tsx`
- `src/components/emails/BookingReschedule.tsx`
- `src/components/emails/AppointmentReminder.tsx`
- `src/app/appointments/page.tsx`
- `src/app/api/cron/reminders/route.ts`

### Modified Files
- `package.json` — new scripts + dependencies
- `next.config.ts` — security headers, remove standalone output
- `src/app/lib/prisma.ts` — Postgres URL support
- `src/app/lib/session.ts` — remove default secret fallback
- `src/app/actions/booking.ts` — email integration, cancel/reschedule actions
- `src/app/actions/admin.ts` — admin password reset action
- `src/app/offers/page.tsx` — remove newsletter section
- `src/components/layout/Header.tsx` — add "My Bookings" link
- `src/app/layout.tsx` — JSON-LD structured data
- All page files — add metadata exports
- `prisma/dev/schema.prisma` — add `reminderSent` field to Appointment
- `prisma/prod/schema.prisma` — add `reminderSent` field to Appointment

### Deleted Files
- `src/proxy.ts`
