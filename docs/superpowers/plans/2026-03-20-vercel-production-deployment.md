# Vercel Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Harbour Hair Salon to Vercel free tier with Postgres database, email notifications, customer booking management, appointment reminders, SEO, and security hardening.

**Architecture:** Next.js 16 App Router on Vercel Hobby plan. Vercel Postgres (Neon) replaces SQLite/SQL Server. Resend handles transactional emails. Vercel Cron sends daily appointment reminders. Middleware protects authenticated routes.

**Tech Stack:** Next.js 16, React 19, Prisma 5 (PostgreSQL), Resend, @react-email/components, jose (JWT), Tailwind CSS 4, Vercel Cron

**Spec:** `docs/superpowers/specs/2026-03-20-vercel-production-deployment-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `prisma/vercel/schema.prisma` | PostgreSQL schema for Vercel Postgres |
| `vercel.json` | Cron job configuration |
| `middleware.ts` | Route protection (admin, appointments) |
| `src/app/robots.ts` | SEO robots config |
| `src/app/services/email-service.ts` | Resend email wrapper (server-only) |
| `src/components/emails/BookingConfirmation.tsx` | Confirmation email template |
| `src/components/emails/BookingCancellation.tsx` | Cancellation email template |
| `src/components/emails/BookingReschedule.tsx` | Reschedule email template |
| `src/components/emails/AppointmentReminder.tsx` | Reminder email template |
| `src/app/appointments/page.tsx` | Customer booking history page |
| `src/components/appointments/AppointmentCard.tsx` | Single appointment display with actions |
| `src/components/appointments/RescheduleModal.tsx` | Date/time picker for rescheduling |
| `src/app/api/cron/reminders/route.ts` | Daily reminder cron endpoint |

### Modified Files
| File | Changes |
|---|---|
| `package.json` | Add scripts, postinstall, dependencies |
| `next.config.ts` | Security headers, remove standalone |
| `src/app/lib/prisma.ts` | Simplify to POSTGRES_URL / DATABASE_URL |
| `src/app/lib/session.ts` | Remove default secret fallback |
| `src/app/actions/auth.ts` | Rate limiting, redirect param support |
| `src/app/actions/booking.ts` | Email integration, cancel/reschedule actions |
| `src/app/actions/admin.ts` | resetUserPassword action |
| `src/app/book/page.tsx` | Require auth before booking |
| `src/app/offers/page.tsx` | Remove newsletter section |
| `src/components/layout/Header.tsx` | Add "My Bookings" link |
| `src/app/page.tsx` | JSON-LD structured data, metadata |
| `src/app/contact/page.tsx` | Add metadata |
| `src/app/services/page.tsx` | Add metadata |
| `src/app/auth/signin/page.tsx` | Add metadata |
| `src/app/auth/register/page.tsx` | Add metadata |
| `prisma/dev/schema.prisma` | Add reminderSent to Appointment |
| `prisma/prod/schema.prisma` | Add reminderSent to Appointment |

### Deleted Files
| File | Reason |
|---|---|
| `src/proxy.ts` | Replaced by `middleware.ts` |

---

## Task 1: Database — Vercel Postgres Schema & Prisma Config

**Files:**
- Create: `prisma/vercel/schema.prisma`
- Modify: `prisma/dev/schema.prisma`
- Modify: `prisma/prod/schema.prisma`
- Modify: `package.json`
- Modify: `src/app/lib/prisma.ts`

- [ ] **Step 1: Create the Vercel Postgres schema**

Create `prisma/vercel/schema.prisma`. Copy all models from `prisma/dev/schema.prisma` but change the datasource to PostgreSQL and add `reminderSent` to Appointment:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}

// All models from dev schema, plus:
// In Appointment model, add:
//   reminderSent Boolean @default(false)
```

- [ ] **Step 2: Add reminderSent to dev and prod schemas**

Add `reminderSent Boolean @default(false)` to the `Appointment` model in both `prisma/dev/schema.prisma` and `prisma/prod/schema.prisma`.

- [ ] **Step 3: Add Vercel database scripts to package.json**

Add to `scripts` in `package.json`:

```json
"postinstall": "prisma generate --schema prisma/vercel/schema.prisma",
"db:vercel:generate": "prisma generate --schema prisma/vercel/schema.prisma",
"db:vercel:migrate": "prisma migrate dev --schema prisma/vercel/schema.prisma",
"db:vercel:deploy": "prisma migrate deploy --schema prisma/vercel/schema.prisma",
"db:vercel:push": "prisma db push --schema prisma/vercel/schema.prisma",
"db:vercel:studio": "prisma studio --schema prisma/vercel/schema.prisma"
```

- [ ] **Step 4: Simplify prisma.ts**

Replace the entire contents of `src/app/lib/prisma.ts` with:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('No database URL configured. Set POSTGRES_URL or DATABASE_URL.');
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrl() },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

- [ ] **Step 5: Commit**

```bash
git add prisma/vercel/schema.prisma prisma/dev/schema.prisma prisma/prod/schema.prisma package.json src/app/lib/prisma.ts
git commit -m "feat: add Vercel Postgres schema and simplify Prisma config"
```

---

## Task 2: Security — Middleware, Headers, Session Secret

**Files:**
- Create: `middleware.ts` (project root)
- Modify: `next.config.ts`
- Modify: `src/app/lib/session.ts`
- Delete: `src/proxy.ts`

- [ ] **Step 1: Create middleware.ts**

Create `middleware.ts` in the project root (NOT inside `src/`):

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.SESSION_SECRET || '';
const key = new TextEncoder().encode(secretKey);

async function getSessionFromRequest(request: NextRequest) {
  const cookie = request.cookies.get('session')?.value;
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ['HS256'] });
    return payload as unknown as { userId: string; role: string };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Admin routes — require ADMIN role
  if (path.startsWith('/admin')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin', request.url));
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Appointments route — require any authenticated user
  if (path.startsWith('/appointments')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/appointments', request.url));
    }
  }

  // Book route — require any authenticated user
  if (path.startsWith('/book')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/book', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*'],
};
```

- [ ] **Step 2: Update session.ts — remove default secret fallback**

In `src/app/lib/session.ts`, change line 6 from:

```typescript
const secretKey = process.env.SESSION_SECRET || 'default_secret_key_change_me_in_prod';
```

to:

```typescript
const secretKey = process.env.SESSION_SECRET;
if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
```

**Important:** Also set `SESSION_SECRET=default_secret_key_change_me_in_prod` in a local `.env` file so dev still works.

- [ ] **Step 3: Add security headers to next.config.ts**

Update `next.config.ts` — remove `output: "standalone"` and add `headers`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  headers: async () => [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ],
  }],
};

export default nextConfig;
```

Note: HSTS omitted — Vercel handles this for `*.vercel.app`.

- [ ] **Step 4: Delete src/proxy.ts**

```bash
rm src/proxy.ts
```

- [ ] **Step 5: Add rate limiting to login action**

In `src/app/actions/auth.ts`, add rate limiting at the top of the file (before the schemas) and integrate it into the `login` function:

```typescript
import { headers } from 'next/headers';

// Simple in-memory rate limiting
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}
```

At the start of `login()`, add:

```typescript
const headersList = await headers();
const ip = getClientIp(headersList);
if (!checkRateLimit(ip)) {
  return { error: 'Too many login attempts. Please try again in 15 minutes.' };
}
```

After successful login (before redirect), add:

```typescript
resetRateLimit(ip);
```

- [ ] **Step 6: Support redirect parameter in auth actions**

In `login()`, after `await createSession(user.id, user.role)`, change the redirect logic to check for a `redirect` param from formData:

```typescript
const redirectTo = formData.get('redirect') as string;
if (user.role === 'ADMIN') {
  redirect('/admin');
} else {
  redirect(redirectTo || '/');
}
```

Do the same in `register()` — accept and forward a `redirect` field.

Then update `src/app/auth/signin/page.tsx` and `src/app/auth/register/page.tsx` to:
1. Read `searchParams.redirect` from the URL
2. Pass it as a hidden form field `<input type="hidden" name="redirect" value={redirect} />`

- [ ] **Step 7: Commit**

```bash
git add middleware.ts next.config.ts src/app/lib/session.ts src/app/actions/auth.ts src/app/auth/signin/page.tsx src/app/auth/register/page.tsx
git rm src/proxy.ts
git commit -m "feat: add middleware, security headers, rate limiting, and auth redirect support"
```

---

## Task 3: Email System — Resend + React Email Templates

**Files:**
- Create: `src/app/services/email-service.ts`
- Create: `src/components/emails/BookingConfirmation.tsx`
- Create: `src/components/emails/BookingCancellation.tsx`
- Create: `src/components/emails/BookingReschedule.tsx`
- Create: `src/components/emails/AppointmentReminder.tsx`

- [ ] **Step 1: Install dependencies**

```bash
pnpm add resend @react-email/components
```

- [ ] **Step 2: Create email templates**

Create 4 React Email template files in `src/components/emails/`. Each exports a React component that receives appointment details as props and returns a styled email using `@react-email/components` (`Html`, `Head`, `Body`, `Container`, `Section`, `Text`, `Link`, `Hr`).

**Shared type** (define in email-service.ts):

```typescript
export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};
```

**BookingConfirmation.tsx**: Shows service, stylist, date/time, salon address (F/1 Central Arcade, Central Road, Leeds, LS1 6DX), and a "View My Bookings" link to `/appointments`.

**BookingCancellation.tsx**: Shows cancelled appointment details with a "Book Again" CTA to `/book`.

**BookingReschedule.tsx**: Receives `oldDate: Date` as extra prop. Shows old time struck through, new time highlighted, stylist and service info.

**AppointmentReminder.tsx**: Shows appointment details, salon address, and links to cancel/reschedule at `/appointments`.

All templates: use the brand color `#174F7F` for headers, clean minimal design, Harbour Hair Salon branding.

- [ ] **Step 3: Create email-service.ts**

Create `src/app/services/email-service.ts`:

```typescript
import 'server-only';
import { Resend } from 'resend';
import { BookingConfirmation } from '@/components/emails/BookingConfirmation';
import { BookingCancellation } from '@/components/emails/BookingCancellation';
import { BookingReschedule } from '@/components/emails/BookingReschedule';
import { AppointmentReminder } from '@/components/emails/AppointmentReminder';

export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  return new Resend(apiKey);
}

const FROM = 'Harbour Hair Salon <onboarding@resend.dev>';

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Booking Confirmed - Harbour Hair Salon',
      react: BookingConfirmation({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send booking confirmation email:', error);
  }
}

export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Booking Cancelled - Harbour Hair Salon',
      react: BookingCancellation({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send booking cancellation email:', error);
  }
}

export async function sendBookingReschedule(appointment: AppointmentWithDetails, oldDate: Date): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Booking Rescheduled - Harbour Hair Salon',
      react: BookingReschedule({ appointment, oldDate }),
    });
  } catch (error) {
    console.error('Failed to send booking reschedule email:', error);
  }
}

export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Appointment Tomorrow - Harbour Hair Salon',
      react: AppointmentReminder({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send appointment reminder email:', error);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/services/email-service.ts src/components/emails/
git commit -m "feat: add Resend email service and 4 email templates"
```

---

## Task 4: Integrate Emails into Booking Flow

**Files:**
- Modify: `src/app/actions/booking.ts`
- Modify: `src/app/services/booking-service.ts`

- [ ] **Step 1: Update submitBooking to send confirmation email**

In `src/app/actions/booking.ts`, import the email service:

```typescript
import { sendBookingConfirmation } from '@/app/services/email-service';
```

After the successful `createBooking()` call (line ~134), fetch the full appointment details and send the email:

```typescript
// After createBooking succeeds, fetch full details for email
const fullAppointment = await prisma.appointment.findFirst({
  where: {
    userId: /* user id from booking */,
    serviceId: validData.serviceId,
    stylistId: validData.stylistId,
    date: fullDate,
  },
  include: {
    user: true,
    stylist: true,
    service: true,
  },
  orderBy: { createdAt: 'desc' },
});

if (fullAppointment) {
  await sendBookingConfirmation({
    ...fullAppointment,
    service: { ...fullAppointment.service, price: Number(fullAppointment.service.price) },
  });
}
```

- [ ] **Step 2: Update booking-service.ts to use authenticated user**

The `createBooking` function in `src/app/services/booking-service.ts` currently accepts `userEmail`/`userName` and does find-or-create. Since booking now requires auth, update `submitBooking` in `booking.ts` to:

1. Call `verifySession()` to get the authenticated user's ID
2. Pass `userId` directly to `createBooking` instead of email/name
3. Simplify `createBooking` in `booking-service.ts` to accept `userId` directly instead of finding/creating users

Update `createBooking` signature:

```typescript
export async function createBooking(data: {
  stylistId: string;
  serviceId: string;
  date: Date;
  userId: string;
  discountCodeId?: string;
}) {
  const appointment = await prisma.appointment.create({
    data: {
      date: data.date,
      stylistId: data.stylistId,
      serviceId: data.serviceId,
      userId: data.userId,
      status: 'CONFIRMED',
      discountCodeId: data.discountCodeId,
    },
    include: {
      user: true,
      stylist: true,
      service: true,
    },
  });
  return appointment;
}
```

Update `submitBooking` accordingly — remove `userEmail`, `userName`, `userPhone` fields; get userId from session instead.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/booking.ts src/app/services/booking-service.ts
git commit -m "feat: integrate confirmation emails and require auth for booking"
```

---

## Task 5: Customer Appointments Page — View, Cancel, Reschedule

**Files:**
- Create: `src/app/appointments/page.tsx`
- Create: `src/components/appointments/AppointmentCard.tsx`
- Create: `src/components/appointments/RescheduleModal.tsx`
- Modify: `src/app/actions/booking.ts`
- Modify: `src/components/layout/Header.tsx`

- [ ] **Step 1: Add cancel and reschedule server actions**

Add to `src/app/actions/booking.ts`:

```typescript
import { verifySession } from '@/app/lib/session';
import { sendBookingCancellation, sendBookingReschedule } from '@/app/services/email-service';
import { getAvailableSlots } from '@/app/services/booking-service';

export async function cancelAppointment(appointmentId: string) {
  const session = await verifySession();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { user: true, stylist: true, service: true },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  // 24-hour cutoff
  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot cancel within 24 hours of appointment' };
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED' },
  });

  await sendBookingCancellation({
    ...appointment,
    service: { ...appointment.service, price: Number(appointment.service.price) },
  });

  revalidatePath('/appointments');
  revalidatePath('/admin');
  revalidatePath('/book');
  return { success: true };
}

export async function rescheduleAppointment(appointmentId: string, newDate: Date) {
  const session = await verifySession();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { user: true, stylist: true, service: true },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot reschedule within 24 hours of appointment' };
  }

  // Use transaction with serializable isolation to prevent double-booking
  try {
    const oldDate = appointment.date;

    await prisma.$transaction(async (tx) => {
      // Re-check availability inside transaction
      const existingAtNewTime = await tx.appointment.findFirst({
        where: {
          stylistId: appointment.stylistId,
          date: newDate,
          status: { not: 'CANCELLED' },
          id: { not: appointmentId },
        },
      });

      if (existingAtNewTime) {
        throw new Error('Slot is no longer available');
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { date: newDate, reminderSent: false },
      });
    }, { isolationLevel: 'Serializable' });

    // Fetch updated appointment for email
    const updated = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { user: true, stylist: true, service: true },
    });

    if (updated) {
      await sendBookingReschedule(
        { ...updated, service: { ...updated.service, price: Number(updated.service.price) } },
        oldDate,
      );
    }

    revalidatePath('/appointments');
    revalidatePath('/admin');
    revalidatePath('/book');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reschedule failed';
    return { success: false, error: message };
  }
}
```

- [ ] **Step 2: Create AppointmentCard component**

Create `src/components/appointments/AppointmentCard.tsx` — a `'use client'` component that:
- Displays appointment details (service name, stylist, date/time, price, status badge)
- For upcoming appointments: shows Cancel and Reschedule buttons
- Buttons disabled if appointment is < 24 hours away
- Cancel: calls `cancelAppointment` server action after confirmation dialog
- Reschedule: opens `RescheduleModal`
- Shows loading states during server action calls

- [ ] **Step 3: Create RescheduleModal component**

Create `src/components/appointments/RescheduleModal.tsx` — a `'use client'` modal that:
- Receives: `appointmentId`, `stylistId`, `serviceDuration`, `currentDate`, `onClose` callback
- Shows a date picker for selecting a new date
- Calls `fetchSlots(stylistId, selectedDate, serviceDuration)` to get available slots
- Displays available time slots as a grid
- On slot selection: shows confirmation (old time → new time)
- On confirm: calls `rescheduleAppointment` server action
- Shows loading/error states

- [ ] **Step 4: Create appointments page**

Create `src/app/appointments/page.tsx`:

```typescript
import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { AppointmentCard } from '@/components/appointments/AppointmentCard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Bookings | Harbour Hair Salon',
  description: 'View, cancel, or reschedule your hair appointments.',
};

export default async function AppointmentsPage() {
  const session = await verifySession();

  const appointments = await prisma.appointment.findMany({
    where: { userId: session.userId },
    include: { stylist: true, service: true },
    orderBy: { date: 'desc' },
  });

  const now = new Date();
  const upcoming = appointments
    .filter(a => a.date >= now && a.status === 'CONFIRMED')
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const past = appointments
    .filter(a => a.date < now || a.status === 'CANCELLED' || a.status === 'COMPLETED');

  // Convert Decimal prices for client components
  const serialize = (appts: typeof appointments) =>
    appts.map(a => ({
      ...a,
      date: a.date.toISOString(),
      service: { ...a.service, price: Number(a.service.price) },
    }));

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-serif mb-8 text-zinc-900">My Bookings</h1>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-zinc-800 mb-4">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="text-zinc-500">No upcoming appointments.</p>
          ) : (
            <div className="space-y-4">
              {serialize(upcoming).map(a => (
                <AppointmentCard key={a.id} appointment={a} isUpcoming />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-zinc-800 mb-4">Past</h2>
          {past.length === 0 ? (
            <p className="text-zinc-500">No past appointments.</p>
          ) : (
            <div className="space-y-4">
              {serialize(past).map(a => (
                <AppointmentCard key={a.id} appointment={a} isUpcoming={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update Header with "My Bookings" link**

In `src/components/layout/Header.tsx`, after the admin Dashboard link block (line ~24-26), add for non-admin logged-in users:

```tsx
{session?.userId && session.role !== 'ADMIN' && (
  <Link href="/appointments" className="hover:text-gray-400 transition-colors">My Bookings</Link>
)}
```

Also add this link to `MobileNav.tsx`.

- [ ] **Step 6: Verify the full flow manually**

Run: `pnpm dev`

Test:
1. Sign in as a regular user
2. Navigate to `/appointments` — should show empty state
3. Book an appointment at `/book`
4. Return to `/appointments` — should show the booking
5. Cancel a booking — verify status changes
6. Book another, reschedule it — verify date changes

- [ ] **Step 7: Commit**

```bash
git add src/app/appointments/ src/components/appointments/ src/app/actions/booking.ts src/components/layout/Header.tsx src/components/layout/MobileNav.tsx
git commit -m "feat: add customer appointments page with cancel and reschedule"
```

---

## Task 6: Admin Password Reset

**Files:**
- Modify: `src/app/actions/admin.ts`
- Modify: `src/app/admin/users/page.tsx`

- [ ] **Step 1: Add resetUserPassword action**

Add to `src/app/actions/admin.ts`:

```typescript
export async function resetUserPassword(userId: string, newPassword: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  if (!newPassword || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  revalidatePath('/admin/users');
  return { success: true };
}
```

- [ ] **Step 2: Add Reset Password button to admin users page**

In `src/app/admin/users/page.tsx`, add a "Reset Password" button for each user row. When clicked, show a prompt/modal asking for the new password, then call `resetUserPassword`.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/admin.ts src/app/admin/users/page.tsx
git commit -m "feat: add admin password reset functionality"
```

---

## Task 7: Appointment Reminders — Vercel Cron

**Files:**
- Create: `src/app/api/cron/reminders/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create the cron API route**

Create `src/app/api/cron/reminders/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { sendAppointmentReminder } from '@/app/services/email-service';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      reminderSent: false,
      date: {
        gte: now,
        lte: twentyFourHoursFromNow,
      },
    },
    include: {
      user: true,
      stylist: true,
      service: true,
    },
  });

  let sent = 0;
  for (const appointment of appointments) {
    try {
      await sendAppointmentReminder({
        ...appointment,
        service: { ...appointment.service, price: Number(appointment.service.price) },
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reminderSent: true },
      });
      sent++;
    } catch (error) {
      // Don't mark as sent — will retry next run
      console.error(`Failed to send reminder for appointment ${appointment.id}:`, error);
    }
  }

  return NextResponse.json({ sent, total: appointments.length });
}
```

- [ ] **Step 2: Create vercel.json**

Create `vercel.json` in the project root:

```json
{
  "crons": [{
    "path": "/api/cron/reminders",
    "schedule": "0 8 * * *"
  }]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/reminders/route.ts vercel.json
git commit -m "feat: add daily appointment reminder cron job"
```

---

## Task 8: SEO — Metadata, JSON-LD, Robots

**Files:**
- Create: `src/app/robots.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/services/page.tsx`
- Modify: `src/app/offers/page.tsx`
- Modify: `src/app/contact/page.tsx`
- Modify: `src/app/auth/signin/page.tsx`
- Modify: `src/app/auth/register/page.tsx`

- [ ] **Step 1: Add metadata to all pages**

Add `metadata` export to each page that doesn't have one. `book/page.tsx` already has metadata.

**Home page (`src/app/page.tsx`):**
```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Harbour Hair Salon | Leeds Hair Stylists',
  description: 'Expert hair styling in the heart of Leeds. Book your appointment at Harbour Hair Salon, Central Arcade.',
  openGraph: {
    title: 'Harbour Hair Salon | Leeds Hair Stylists',
    description: 'Expert hair styling in the heart of Leeds.',
  },
};
```

**Services:** `title: 'Services & Pricing | Harbour Hair Salon'`
**Offers:** `title: 'Special Offers | Harbour Hair Salon'`
**Contact:** `title: 'Contact & Location | Harbour Hair Salon'`
**Sign In:** `title: 'Sign In | Harbour Hair Salon'`
**Register:** `title: 'Create Account | Harbour Hair Salon'`

- [ ] **Step 2: Add JSON-LD to home page**

In `src/app/page.tsx`, add a `<script type="application/ld+json">` inside the returned JSX (before `<Hero />`):

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'HairSalon',
      name: 'Harbour Hair Salon',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'F/1 Central Arcade, Central Road',
        addressLocality: 'Leeds',
        postalCode: 'LS1 6DX',
        addressCountry: 'GB',
      },
      telephone: '+441234567890',
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday'], opens: '10:00', closes: '19:30' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday','Sunday'], opens: '10:30', closes: '18:00' },
      ],
      url: 'https://harbour-hair-salon.vercel.app',
    }),
  }}
/>
```

- [ ] **Step 3: Create robots.ts**

Create `src/app/robots.ts`:

```typescript
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
  };
}
```

- [ ] **Step 4: Remove newsletter section from offers page**

In `src/app/offers/page.tsx`, delete the entire `{/* Newsletter / VIP Section Placeholder */}` section (lines 97-115 approximately — the `<section className="bg-zinc-50 py-24 border-t border-zinc-200">` block).

- [ ] **Step 5: Commit**

```bash
git add src/app/robots.ts src/app/page.tsx src/app/services/page.tsx src/app/offers/page.tsx src/app/contact/page.tsx src/app/auth/signin/page.tsx src/app/auth/register/page.tsx
git commit -m "feat: add SEO metadata, JSON-LD, robots.ts, remove newsletter"
```

---

## Task 9: Vercel Deployment

**Files:**
- Modify: `.env` (local only, not committed)

- [ ] **Step 1: Link project to Vercel**

```bash
npx vercel link
```

Follow the prompts — select your team, create a new project named `harbour-hair-salon`.

- [ ] **Step 2: Add Neon Postgres integration**

```bash
npx vercel integration add neon
```

This opens a browser to set up Neon. Create a new database. Vercel auto-injects `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`.

- [ ] **Step 3: Set environment variables**

```bash
# Generate a random session secret
npx vercel env add SESSION_SECRET production

# Add Resend API key (get from https://resend.com/api-keys)
npx vercel env add RESEND_API_KEY production
```

Also set `SESSION_SECRET` for preview and development environments.

- [ ] **Step 4: Pull env vars locally and push schema**

```bash
npx vercel env pull .env.local
pnpm db:vercel:push
```

- [ ] **Step 5: Seed the database**

```bash
DATABASE_URL=$(grep POSTGRES_URL .env.local | head -1 | cut -d= -f2-) npx prisma db seed --schema prisma/vercel/schema.prisma
```

Or use `pnpm db:vercel:studio` to verify data.

- [ ] **Step 6: Deploy**

```bash
npx vercel --prod
```

- [ ] **Step 7: Verify deployment**

Open the deployment URL and test:
1. Home page loads with services and stylists
2. Sign in works
3. Book an appointment → confirmation email received
4. My Bookings page shows the appointment
5. Cancel an appointment → cancellation email received
6. Admin panel accessible for admin users
7. `/admin` blocked for non-admin users
8. Check security headers in browser dev tools (Network tab → response headers)

- [ ] **Step 8: Commit any deployment-related config changes**

```bash
git add -A
git commit -m "chore: finalize Vercel deployment configuration"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `readme/structure.md`

- [ ] **Step 1: Update CLAUDE.md**

Add sections for:
- Vercel deployment commands
- New env vars needed
- Email service architecture
- Cron job info

- [ ] **Step 2: Update readme/structure.md**

Add entries for all new files: email-service.ts, email templates, appointments page, appointment components, cron route, middleware.ts, robots.ts.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md readme/structure.md
git commit -m "docs: update CLAUDE.md and structure.md for production deployment"
```
