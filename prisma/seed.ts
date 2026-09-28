import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { resolve } from 'node:path'
import { assertSafeSeedTarget } from './seed-safety'
import { OFFERINGS, PRICE_SOURCE, RETIRE_UNVERIFIED_NHS, VERIFIED_AT, type CatalogOffering } from './price-catalog/treatwell-2026-09-28'

let prisma: PrismaClient | undefined

const englishWords = [
  'apple', 'river', 'stone', 'cloud', 'ocean', 'bread', 'house', 'light', 'music', 'dance',
  'smile', 'dream', 'peace', 'grace', 'bloom', 'earth', 'water', 'flame', 'heart', 'voice',
  'tiger', 'eagle', 'whale', 'horse', 'panda', 'koala', 'zebra', 'mango', 'lemon', 'grape',
  'happy', 'sunny', 'lucky', 'brave', 'calm', 'fresh', 'green', 'sweet', 'quick', 'smart',
  'hello', 'world', 'space', 'star', 'moon', 'night', 'party', 'piano', 'train', 'beach'
];

function generateRandomPassword(): string {
  const word1 = englishWords[Math.floor(Math.random() * englishWords.length)];
  const word2 = englishWords[Math.floor(Math.random() * englishWords.length)];
  const word3 = englishWords[Math.floor(Math.random() * englishWords.length)];
  const number = Math.floor(Math.random() * 100); // 0-99
  
  return `${word1}-${word2}-${word3}-${number}`;
}

async function main() {
  const url = assertSafeSeedTarget(process.env, resolve(__dirname, '..'));
  const db = new PrismaClient({ datasources: { db: { url } } });
  prisma = db;
  console.log('Start seeding...')

  // Clean existing data
  await db.appointment.deleteMany()
  await db.availability.deleteMany()
  await db.stylist.deleteMany()
  await db.service.updateMany({ data: { surchargeBaseServiceId: null } })
  await db.service.deleteMany()
  await db.serviceOffering.deleteMany()
  await db.user.deleteMany()

  // Services come from the reviewed price catalogue (the same file the
  // production update tool applies), so a local/test database looks like
  // production after the 2026-09-28 price update: menu items with their
  // length x standard/NHS options, the extra-long composite, retired
  // unverified NHS rows and the deliberately unchanged items.
  const verifiedAt = new Date(`${VERIFIED_AT}T12:00:00Z`)
  const durationByLegacyName: Record<string, number> = {
    'Short Over Ears - Wash, Haircut & Blow Dry': 55, 'Long Hair - Wash, Haircut & Blow Dry': 85,
    'Children (Up to 12Yr) - Short Over Ears': 60, 'Children (Up to 12Yr) - Long Hair': 60,
    'Shampoo & Blow Dry - Short Over Ears': 45, 'Shampoo & Blow Dry - Long Over Ears': 60,
  }
  const durationFor = (offering: CatalogOffering, length: string | null): number => {
    if (offering.category === 'Colouring') return offering.key.includes('highlights') || offering.key === 'balayage' ? (offering.key === 'half-head-highlights' ? 165 : 225) : 150
    if (offering.category === 'Perms') return offering.key.startsWith('cold-perm') ? 150 : offering.key === 'keratin-treatment' ? 180 : 210
    if (offering.category === 'Treatments') return 120
    const standard = offering.options.find((o) => o.hairLength === length && o.priceType === 'STANDARD')
    return durationByLegacyName[standard?.legacyNames[0] ?? ''] ?? 60
  }
  let serviceCount = 0
  for (const offering of OFFERINGS) {
    const created = await db.serviceOffering.create({ data: { key: offering.key, name: offering.name, category: offering.category, displayOrder: offering.displayOrder } })
    const ids = new Map<string, string>()
    const ordered = [...offering.options].sort((a, b) => Number(Boolean(a.surcharge)) - Number(Boolean(b.surcharge)))
    for (const option of ordered) {
      const isNew = option.legacyNames.length === 0 || Boolean(option.create)
      const name = option.legacyNames[0] ?? option.create?.name ?? offering.name
      const base = option.surcharge ? ids.get(`${option.surcharge.baseHairLength}|${option.priceType}`) : undefined
      const row = await db.service.create({
        data: {
          name,
          description: option.create?.description ?? `${offering.name}${option.hairLength ? ` (${option.hairLength.toLowerCase().replace('_', ' ')} hair)` : ''}${option.priceType === 'NHS' ? ' — NHS price' : ''}.`,
          price: option.pricePence / 100,
          duration: durationFor(offering, option.surcharge ? option.surcharge.baseHairLength : option.hairLength),
          category: offering.category,
          requiresPatchTest: offering.flags.requiresPatchTest,
          requiresConsultation: offering.flags.requiresConsultation,
          offeringId: created.id,
          hairLength: option.hairLength,
          priceType: option.priceType,
          vatDisplay: 'EXCLUDED',
          priceNature: option.priceNature,
          priceNote: offering.priceNote ?? null,
          priceSource: PRICE_SOURCE,
          priceVerifiedAt: verifiedAt,
          // Options created by the price update have unconfirmed durations
          // and are listed but not bookable until the salon confirms them.
          isBookable: !(isNew && option.create),
          durationConfirmed: !(isNew && option.create),
          surchargeBaseServiceId: base ?? null,
          surchargeAmount: option.surcharge ? option.surcharge.amountPence / 100 : null,
        },
      })
      ids.set(`${option.hairLength}|${option.priceType}`, row.id)
      serviceCount++
    }
    const retired = RETIRE_UNVERIFIED_NHS.find((r) => r.standardOffering === offering.key)
    if (retired) {
      await db.service.create({ data: { name: retired.legacyName, description: 'Unverified NHS option kept for history.', price: 198, duration: 180, category: offering.category, requiresConsultation: true, offeringId: created.id, priceType: 'NHS', isPublic: false, isBookable: false } })
      serviceCount++
    }
  }
  const unchanged = [
    { name: 'Consultation & Patch Test', price: 15.00, duration: 15, category: 'Colouring', isPatchTest: true, description: 'Required consultation and allergy patch test before any colour service (book at least 48h ahead).' },
    { name: 'Consultation', price: 0.00, duration: 15, category: 'Consultation', isConsultation: true, description: 'Free consultation to discuss your service before booking.' },
    { name: 'Perm Under Shoulder Add-on', price: 24.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Additional charge for under shoulder length perm.' },
    { name: 'Heat Set Add-on', price: 10.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Additional heat styling service.' },
  ]
  for (const service of unchanged) {
    await db.service.create({ data: service })
    serviceCount++
  }
  const serviceList = { length: serviceCount }

  console.log(`Created ${serviceList.length} services`)

  // Create Stylists. All four share the salon's opening hours; per-stylist
  // schedules can be tailored later in the admin panel.
  const salonHours = [
    { dayOfWeek: 1, startTime: '10:00', endTime: '19:30' }, // Mon
    { dayOfWeek: 2, startTime: '10:00', endTime: '19:30' }, // Tue
    { dayOfWeek: 3, startTime: '10:00', endTime: '19:30' }, // Wed
    { dayOfWeek: 4, startTime: '10:00', endTime: '19:30' }, // Thu
    { dayOfWeek: 5, startTime: '10:00', endTime: '19:30' }, // Fri
    { dayOfWeek: 6, startTime: '10:30', endTime: '18:00' }, // Sat
    { dayOfWeek: 0, startTime: '10:30', endTime: '18:00' }, // Sun
  ];

  const stylistSeed = [
    {
      name: 'Chan',
      role: 'Lead Stylist',
      bio: 'Experienced barber delivering tailored haircuts and grooming services with meticulous attention to detail. Led by Hong Kong Stylist standards.',
    },
    {
      name: 'Ivan',
      role: 'Senior Stylist',
      bio: 'Precision cuts and grooming with a consistent five-star touch.',
    },
    {
      name: 'Lox',
      role: 'Stylist',
      bio: 'Friendly, detail-focused stylist for cuts, blow-dries and styling.',
    },
    {
      name: 'Funky',
      role: 'Stylist',
      bio: 'Creative styling and modern cuts tailored to you.',
    },
  ];

  const stylists = await Promise.all(
    stylistSeed.map(stylist =>
      db.stylist.create({
        data: {
          name: stylist.name,
          role: stylist.role,
          bio: stylist.bio,
          imageUrl: null,
          availabilities: { create: salonHours.map(hours => ({ ...hours })) },
        }
      })
    )
  )

  console.log(`Created ${stylists.length} stylists`)

  // Create Admin User with Random Password
  // RFC 2606 reserves `.invalid`, so this address can never be registered or
  // receive mail. The old value was admin@harbourhair.com — a domain owned by
  // an unrelated Wix site, which meant a seeded ADMIN account sat in production
  // whose password-reset link would have been delivered to a third party the
  // moment they added an MX record. Never seed an admin at a domain we do not
  // control, even in a script that only targets disposable databases.
  const adminEmail = 'admin@harbourhair.invalid';
  const randomPassword = generateRandomPassword();
  const hashedPassword = await bcrypt.hash(randomPassword, 10);
  
  await db.user.create({
    data: {
      email: adminEmail,
      name: 'Admin User',
      role: 'ADMIN',
      password: hashedPassword
    }
  });

  console.log('Seeding finished.');
  console.log('----------------------------------------');
  console.log('ADMIN CREDENTIALS GENERATED:');
  console.log(`Email:    ${adminEmail}`);
  console.log(`Password: ${randomPassword}`);
  console.log('----------------------------------------');
}

main()
  .then(async () => {
    await prisma?.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma?.$disconnect()
    process.exit(1)
  })
