/**
 * Non-destructive backfill for the consultation gate.
 *
 * `prisma migrate deploy` adds the `Service.requiresConsultation` / `isConsultation`
 * columns (defaulting to false) but does NOT touch existing rows or insert the new
 * free Consultation service. The full seed (`prisma/seed.ts`) is destructive
 * (deleteMany) and cannot run on a production DB with bookings, so use THIS script.
 *
 * Idempotent: safe to run multiple times. No rows are deleted.
 *
 * Run against the Vercel/Neon DB with the production connection string, e.g.:
 *   POSTGRES_URL=... pnpm db:backfill:consultation
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) Ensure the free general Consultation service exists.
  const existing = await prisma.service.findFirst({ where: { isConsultation: true } });
  if (!existing) {
    await prisma.service.create({
      data: {
        name: 'Consultation',
        price: 0,
        duration: 15,
        category: 'Consultation',
        isConsultation: true,
        description: 'Free consultation to discuss your service before booking.',
      },
    });
  }

  // 2) Gate every Colouring / Perms / Styling service. Exclude the consultation
  //    targets themselves (isPatchTest / isConsultation) so they stay bookable.
  const gated = await prisma.service.updateMany({
    where: {
      category: { in: ['Colouring', 'Perms', 'Styling'] },
      isPatchTest: false,
      isConsultation: false,
    },
    data: { requiresConsultation: true },
  });

  const total = await prisma.service.count({ where: { requiresConsultation: true } });
  console.log(
    `Backfill complete. Consultation service present: ${existing ? 'yes (existing)' : 'created'}; ` +
      `services gated this run: ${gated.count}. Now requiresConsultation=${total}.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
