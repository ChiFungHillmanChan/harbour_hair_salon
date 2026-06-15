/**
 * Non-destructive backfill for the colour patch-test gate.
 *
 * `vercel-build` runs `prisma db push`, which ADDS the new `Service.requiresPatchTest`
 * and `Service.isPatchTest` columns (defaulting to false) but does NOT touch existing
 * rows. The full seed (`prisma/seed.ts`) is destructive (deleteMany) and cannot be run
 * on a production DB that already has bookings, so use THIS script to activate the gate
 * on existing data instead.
 *
 * Idempotent: safe to run multiple times. No rows are deleted.
 *
 * Run against the Vercel/Neon DB with the production connection string available, e.g.:
 *   POSTGRES_URL=... pnpm db:backfill:patch-test
 *   (or)  pnpm exec tsx prisma/backfill-patch-test-flags.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) Mark the consultation / patch-test service. Handle both the old ("Patch Test")
  //    and the new ("Consultation & Patch Test") names, and normalise it.
  const markedTest = await prisma.service.updateMany({
    where: { name: { in: ['Patch Test', 'Consultation & Patch Test'] } },
    data: {
      name: 'Consultation & Patch Test',
      duration: 15,
      description:
        'Required consultation and allergy patch test before any colour service (book at least 48h ahead).',
      isPatchTest: true,
      requiresPatchTest: false,
    },
  });

  // 2) Every other Colouring service requires a completed patch test first.
  const flaggedColour = await prisma.service.updateMany({
    where: { category: 'Colouring', isPatchTest: false },
    data: { requiresPatchTest: true },
  });

  const consult = await prisma.service.count({ where: { isPatchTest: true } });
  const gated = await prisma.service.count({ where: { requiresPatchTest: true } });

  console.log(
    `Backfill complete. Consultation/patch-test rows updated: ${markedTest.count}; ` +
      `colour services flagged this run: ${flaggedColour.count}. ` +
      `Now isPatchTest=${consult}, requiresPatchTest=${gated}.`,
  );

  if (consult === 0) {
    console.warn(
      'WARNING: no service is marked isPatchTest. The wizard CTA needs one — ' +
        'create/seed a "Consultation & Patch Test" service, then re-run this script.',
    );
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
