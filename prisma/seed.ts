import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
    prisma.service.create({
      data: {
        name: 'Short Over Ears - Wash, Haircut & Blow Dry',
        description: 'Tailored haircut and grooming service with meticulous attention to detail.',
        price: 30.00,
        duration: 55,
        category: 'Styling',
        imageUrl: '/images/services/cut-finish.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Children Up to 12Yr - Wash, Haircut & Blow Dry',
        description: 'Professional cut for children under 12.',
        price: 17.00,
        duration: 60,
        category: 'Styling',
        imageUrl: '/images/services/kids-cut.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Shampoo & Dry & Set',
        description: 'Wash, dry and set styling.',
        price: 10.00,
        duration: 60,
        category: 'Styling',
        imageUrl: '/images/services/blow-dry.jpg'
      }
    }),
    prisma.service.create({
      data: {
        name: 'Patch Test',
        description: 'Mandatory patch test before color or perm services.',
        price: 10.00,
        duration: 5,
        category: 'Consultation',
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
  console.log('Seeding finished.')
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
