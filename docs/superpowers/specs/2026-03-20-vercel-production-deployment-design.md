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

Replace the current complex fallback chain in `src/app/lib/prisma.ts` with simple logic:

```
if (POSTGRES_URL) → use it (Vercel production)
else if (DATABASE_URL) → use it (local SQLite dev)
else → throw error
```

Remove the manual `.env` file parsing and `fs.existsSync` calls — unnecessary on Vercel serverless. Remove the `console.log` that prints the database URL on cold starts (leaks connection strings in Vercel logs).

### Build Configuration

Add `postinstall` script to `package.json` so Prisma Client is generated from the correct schema during Vercel builds:

```json
"postinstall": "prisma generate --schema prisma/vercel/schema.prisma"
```

### Deployment Steps

1. `vercel integration add neon` — creates Neon database, auto-injects env vars
2. Run migrations locally: `vercel env pull .env.local && pnpm db:vercel:deploy`
3. Seed locally: `npx prisma db seed --schema prisma/vercel/schema.prisma`

---

## 2. Email System — Resend + React Email

### Architecture

- **Service:** `src/app/services/email-service.ts` — wraps Resend SDK, uses `import 'server-only'` guard (NOT `'use server'` — these are internal functions called by server actions, not client-callable)
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
import 'server-only';

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void>
export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void>
export async function sendBookingReschedule(appointment: AppointmentWithDetails, oldDate: Date): Promise<void>
export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void>
```

All functions: get Resend API key at runtime, send email, fail silently with console.error (email failure should not block booking operations).

### Admin Password Reset (No Self-Service)

Self-service password reset deferred until custom domain is configured (needed for email deliverability). Instead, admin resets passwords from the admin panel.

New server action in `src/app/actions/admin.ts`:

```typescript
export async function resetUserPassword(userId: string, newPassword: string): Promise<ActionResult>
```

- Verify caller is ADMIN
- Hash new password with bcryptjs
- Update user record
- Delete all sessions for the target user (by clearing their cookies if they're the current user — otherwise session naturally expires)

UI: Add a "Reset Password" button in the admin users table, opens a modal with new password input.

### Timezone Handling

All appointment dates are stored as UTC `DateTime` in Prisma. The salon is UK-based. The 24-hour cancel/reschedule cutoff and cron reminder window both operate in UTC. The booking wizard should display times in the user's local timezone (browser) but submit as UTC.

### Newsletter Removal

Remove the non-functional newsletter signup UI from `src/app/offers/page.tsx`.

---

## 3. User Booking History — View, Cancel, Reschedule

### Auth Requirement for Booking

The booking page (`/book`) will require authentication. If no session exists, redirect to `/auth/signin?redirect=/book`. After signin/register, redirect back to booking. This ensures every booking is tied to an authenticated user, which is required for the "My Bookings" page to work.

Guest bookings (password-less User records) are no longer created. Users must register or sign in before booking.

### New Page: `src/app/appointments/page.tsx`

- Requires authenticated session (redirect to signin if not logged in)
- Two tabs: **Upcoming** (status CONFIRMED, date >= now) and **Past** (COMPLETED/CANCELLED or date < now)
- Each booking card: service name, stylist, date/time, status badge, price

Note: PENDING status is unused — `createBooking` auto-confirms. If PENDING is introduced later, it should be treated as upcoming and cancellable but not reschedulable.

### Cancel Flow

1. Customer clicks Cancel on an upcoming booking (button disabled if < 24 hours away)
2. Confirmation modal: "Are you sure you want to cancel?"
3. Server action `cancelAppointment(appointmentId)`:
   - Verify session — user must own this appointment
   - Verify appointment is >= 24 hours away
   - Update status to `CANCELLED`
   - Send cancellation email
   - Revalidate `/appointments`, `/admin`, and `/book`

### Reschedule Flow

1. Customer clicks Reschedule on an upcoming booking (button disabled if < 24 hours away)
2. Opens date/time picker (mini wizard — no service/stylist selection, those stay the same)
3. System calls `getAvailableSlots()` for the **same stylist** and **same service duration**
4. Customer picks new slot, sees confirmation: old time -> new time
5. Server action `rescheduleAppointment(appointmentId, newDate)`:
   - Verify session — user must own this appointment
   - Verify original appointment is >= 24 hours away
   - Use `prisma.$transaction()` with serializable isolation to: re-check slot availability for the same stylist AND update appointment date. This prevents two users from claiming the same slot via concurrent reschedules.
   - Reset `reminderSent` to `false` (so reminder fires for new time)
   - Send reschedule email with old and new times
   - Revalidate `/appointments`, `/admin`, and `/book`

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

### Vercel Hobby Cron Limitation

Vercel Hobby (free) plan allows **2 cron jobs, max once per day**. Hourly is not available on free tier.

**Approach:** Run once daily at 8:00 AM UTC. The query window ("now to now + 24 hours") still catches all next-day appointments. Appointments booked after the cron runs for the same day will not get a reminder — this is acceptable for a salon. If hourly resolution is needed later, upgrade to Vercel Pro or use an external cron service.

### vercel.json

```json
{
  "crons": [{
    "path": "/api/cron/reminders",
    "schedule": "0 8 * * *"
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

Simple in-memory Map tracking failed login attempts per IP (extracted from `headers().get('x-forwarded-for')`, using the first/leftmost value). After 5 failures in 15 minutes, block further attempts. Resets on successful login. Implemented directly in `login()` server action — no external dependency.

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
- `src/app/book/page.tsx` — require auth before booking
- `src/components/layout/Header.tsx` — add "My Bookings" link
- `src/app/page.tsx` — JSON-LD structured data (home page only)
- All page files — add metadata exports
- `prisma/dev/schema.prisma` — add `reminderSent` field to Appointment
- `prisma/prod/schema.prisma` — add `reminderSent` field to Appointment

### Deleted Files
- `src/proxy.ts`
