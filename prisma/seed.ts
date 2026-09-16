import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { resolve } from 'node:path'
import { assertSafeSeedTarget } from './seed-safety'

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
  await db.service.deleteMany()
  await db.user.deleteMany()

  const serviceList = [
    // Haircuts
    { name: 'Long Hair - Wash, Haircut & Blow Dry (Student & NHS)', price: 44.00, duration: 85, category: 'Haircuts', description: 'Wash, haircut and blow dry for long hair (Student & NHS rate).' },
    { name: 'Long Hair - Wash, Haircut & Blow Dry', price: 49.00, duration: 85, category: 'Haircuts', description: 'Wash, haircut and blow dry for long hair.' },
    { name: 'Extra Long Hair - Wash, Haircut & Blow Dry', price: 56.00, duration: 85, category: 'Haircuts', description: 'Wash, haircut and blow dry for extra long hair.' },
    { name: 'Short Over Ears - Wash, Haircut & Blow Dry (Student & NHS)', price: 33.00, duration: 55, category: 'Haircuts', description: 'Wash, haircut and blow dry for short hair (Student & NHS rate).' },
    { name: 'Short Over Ears - Wash, Haircut & Blow Dry', price: 37.00, duration: 55, category: 'Haircuts', description: 'Wash, haircut and blow dry for short hair.' },
    { name: 'Children (Up to 12Yr) - Short Over Ears', price: 19.00, duration: 60, category: 'Haircuts', description: 'Wash, haircut and blow dry for children under 12 with short hair.' },
    { name: 'Children (Up to 12Yr) - Long Hair', price: 22.00, duration: 60, category: 'Haircuts', description: 'Wash, haircut and blow dry for children under 12 with long hair.' },

    // Colouring
    { name: 'Full Head Colour & Blow Dry - Short Hair (NHS)', price: 109.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for short hair (NHS rate).' },
    { name: 'Full Head Colour & Blow Dry - Short Hair', price: 121.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for short hair.' },
    { name: 'Full Head Colour & Blow Dry - Medium Hair (NHS)', price: 131.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for medium length hair (NHS rate).' },
    { name: 'Full Head Colour & Blow Dry - Medium Hair', price: 145.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for medium length hair.' },
    { name: 'Full Head Colour & Blow Dry - Long Hair (NHS)', price: 142.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for long hair (NHS rate).' },
    { name: 'Full Head Colour & Blow Dry - Long Hair', price: 157.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for long hair.' },

    { name: 'Half Head Highlights & Blow Dry - Short Hair (NHS)', price: 164.00, duration: 165, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Half head highlights including blow dry for short hair (NHS rate).' },
    { name: 'Half Head Highlights & Blow Dry - Short Hair', price: 181.00, duration: 165, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Half head highlights including blow dry for short hair.' },
    { name: 'Half Head Highlights & Blow Dry - Long Hair (NHS)', price: 196.00, duration: 165, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Half head highlights including blow dry for long hair (NHS rate).' },
    { name: 'Half Head Highlights & Blow Dry - Long Hair', price: 218.00, duration: 165, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Half head highlights including blow dry for long hair.' },

    { name: 'Full Head Highlights & Blow Dry - Short Hair (NHS)', price: 196.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head highlights including blow dry for short hair (NHS rate).' },
    { name: 'Full Head Highlights & Blow Dry - Short Hair', price: 211.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head highlights including blow dry for short hair.' },
    { name: 'Full Head Highlights & Blow Dry - Long Hair (NHS)', price: 251.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head highlights including blow dry for long hair (NHS rate).' },
    { name: 'Full Head Highlights & Blow Dry - Long Hair', price: 278.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head highlights including blow dry for long hair.' },

    { name: 'Partial Highlights & Blow Dry - Short Hair (NHS)', price: 165.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Partial highlights including blow dry for short hair (NHS rate).' },
    { name: 'Partial Highlights & Blow Dry - Short Hair', price: 182.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Partial highlights including blow dry for short hair.' },
    { name: 'Partial Highlights & Blow Dry - Long Hair (NHS)', price: 251.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Partial highlights including blow dry for long hair (NHS rate).' },
    { name: 'Partial Highlights & Blow Dry - Long Hair', price: 278.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Partial highlights including blow dry for long hair.' },

    { name: 'Balayage, Haircut & Blow Dry (NHS)', price: 303.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Balayage with haircut and blow dry (NHS rate).' },
    { name: 'Balayage, Haircut & Blow Dry (Adult)', price: 339.00, duration: 225, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Balayage with haircut and blow dry.' },

    { name: 'Consultation & Patch Test', price: 15.00, duration: 5, category: 'Colouring', isPatchTest: true, description: 'Required consultation and allergy patch test before any colour service (book at least 48h ahead).' },

    // General consultation (free) — the target for perms/styling/other gated services
    { name: 'Consultation', price: 0.00, duration: 15, category: 'Consultation', isConsultation: true, description: 'Free consultation to discuss your service before booking.' },

    // Perms
    { name: 'Cold Perm Half Head (NHS)', price: 129.00, duration: 150, category: 'Perms', requiresConsultation: true, description: 'Cold perm for half head (NHS rate).' },
    { name: 'Cold Perm Half Head', price: 157.00, duration: 150, category: 'Perms', requiresConsultation: true, description: 'Cold perm for half head.' },
    { name: 'Cold Perm Full Head (NHS)', price: 159.00, duration: 150, category: 'Perms', requiresConsultation: true, description: 'Cold perm for full head (NHS rate).' },
    { name: 'Cold Perm Full Head', price: 194.00, duration: 150, category: 'Perms', requiresConsultation: true, description: 'Cold perm for full head.' },
    { name: 'Hair Correction (NHS)', price: 198.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Hair correction service (NHS rate).' },
    { name: 'Hair Correction', price: 242.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Hair correction service.' },
    { name: 'Keratin Treatment (NHS)', price: 198.00, duration: 180, category: 'Perms', requiresConsultation: true, description: 'Keratin smoothing treatment (NHS rate).' },
    { name: 'Keratin Treatment', price: 242.00, duration: 180, category: 'Perms', requiresConsultation: true, description: 'Keratin smoothing treatment.' },
    { name: 'Paimore Hot Perm (NHS)', price: 198.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Paimore digital/hot perm (NHS rate).' },
    { name: 'Paimore Hot Perm', price: 242.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Paimore digital/hot perm.' },
    { name: 'Perm Under Shoulder Add-on', price: 24.00, duration: 210, category: 'Perms', requiresConsultation: true, description: 'Additional charge for under shoulder length perm.' },

    // Treatments
    { name: 'Dr.Jr. TOKIO Inkarami System Treatment (NHS)', price: 143.00, duration: 120, category: 'Treatments', description: 'Dr.Jr. TOKIO Inkarami System treatment (NHS rate).' },
    { name: 'Dr.Jr. TOKIO Inkarami System Treatment', price: 154.00, duration: 120, category: 'Treatments', description: 'Dr.Jr. TOKIO Inkarami System treatment.' },

    // Styling
    { name: 'Shampoo & Dry & Set', price: 10.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Shampoo, dry and set. From £10 depending on hair length.' },
    { name: 'Heat Set Add-on', price: 10.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Additional heat styling service.' },
    { name: 'Shampoo & Blow Dry - Short Over Ears (Student & NHS)', price: 25.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Shampoo and blow dry for short hair (Student & NHS rate).' },
    { name: 'Shampoo & Blow Dry - Short Over Ears', price: 30.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Shampoo and blow dry for short hair.' },
    { name: 'Shampoo & Blow Dry - Long Over Ears (Student & NHS)', price: 35.00, duration: 60, category: 'Styling', requiresConsultation: true, description: 'Shampoo and blow dry for long hair (Student & NHS rate).' },
    { name: 'Shampoo & Blow Dry - Long Over Ears', price: 40.00, duration: 60, category: 'Styling', requiresConsultation: true, description: 'Shampoo and blow dry for long hair.' },
  ];

  // Create Services
  await Promise.all(serviceList.map(service => 
    db.service.create({
      data: {
        ...service,
        imageUrl: null // Or map to default images if needed
      }
    })
  ));

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
  const adminEmail = 'admin@harbourhair.com';
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
