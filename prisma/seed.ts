import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

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
  console.log('Start seeding...')

  // Clean existing data
  await prisma.appointment.deleteMany()
  await prisma.availability.deleteMany()
  await prisma.stylist.deleteMany()
  await prisma.service.deleteMany()
  await prisma.user.deleteMany()

  // Create Services
  const services = await Promise.all([
    // Haircuts
    prisma.service.create({
      data: {
        name: 'Short Hair - Wash, Haircut & Blow Dry',
        description: 'Wash, haircut and blow dry for short hair.',
        price: 30.00,
        duration: 55,
        category: 'Haircuts',
        imageUrl: '/images/services/short-cut.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Long Hair - Wash, Haircut & Blow Dry',
        description: 'Wash, haircut and blow dry for long hair.',
        price: 40.00,
        duration: 55,
        category: 'Haircuts',
        imageUrl: '/images/services/long-cut.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Children Up to 12 Years - Wash, Haircut & Blow Dry',
        description: 'Wash, haircut and blow dry for children under 12.',
        price: 17.00,
        duration: 60,
        category: 'Haircuts',
        imageUrl: '/images/services/kids-cut.jpg'
      }
    }),

    // Colouring
    prisma.service.create({
      data: {
        name: 'Full Head Colour with Blow Dry',
        description: 'Full head colour application including blow dry.',
        price: 99.00,
        duration: 150,
        category: 'Colouring',
        imageUrl: '/images/services/full-color.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Partial Highlights with Blow Dry',
        description: 'Partial highlights including blow dry.',
        price: 149.00,
        duration: 225,
        category: 'Colouring',
        imageUrl: '/images/services/highlights.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Half Head Highlights with Blow Dry',
        description: 'Half head highlights including blow dry.',
        price: 149.00,
        duration: 165,
        category: 'Colouring',
        imageUrl: '/images/services/highlights.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Full Head Highlights with Blow Dry',
        description: 'Full head highlights including blow dry.',
        price: 178.00,
        duration: 225,
        category: 'Colouring',
        imageUrl: '/images/services/highlights.jpg'
      }
    }),

    // Treatments
    prisma.service.create({
      data: {
        name: 'Treatment with Blow Dry',
        description: 'Intensive hair treatment including blow dry.',
        price: 130.00,
        duration: 120,
        category: 'Treatments',
        imageUrl: '/images/services/treatment.jpg'
      }
    })
  ])

  console.log(`Created ${services.length} services`)

  // Create Stylists
  const stylists = await Promise.all([
    prisma.stylist.create({
      data: {
        name: 'Chan',
        role: 'Lead Stylist',
        bio: 'Experienced barber delivering tailored haircuts and grooming services with meticulous attention to detail. Led by Hong Kong Stylist standards.',
        imageUrl: '/images/team/chan.jpg',
        availabilities: {
          create: [
            { dayOfWeek: 1, startTime: '10:00', endTime: '19:30' }, // Mon
            { dayOfWeek: 2, startTime: '10:00', endTime: '19:30' }, // Tue
            { dayOfWeek: 3, startTime: '10:00', endTime: '19:30' }, // Wed
            { dayOfWeek: 4, startTime: '10:00', endTime: '19:30' }, // Thu
            { dayOfWeek: 5, startTime: '10:00', endTime: '19:30' }, // Fri
            { dayOfWeek: 6, startTime: '10:30', endTime: '18:00' }, // Sat
            { dayOfWeek: 0, startTime: '10:30', endTime: '18:00' }, // Sun
          ]
        }
      }
    })
  ])

  console.log(`Created ${stylists.length} stylists`)

  // Create Admin User with Random Password
  const adminEmail = 'admin@harbourhair.com';
  const randomPassword = generateRandomPassword();
  const hashedPassword = await bcrypt.hash(randomPassword, 10);
  
  await prisma.user.create({
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
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
