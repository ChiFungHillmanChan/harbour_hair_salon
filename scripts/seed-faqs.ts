#!/usr/bin/env node
// Seeds the Faq table with the FAQs shown on the home, contact and services pages.
//
// Run with tsx (not node) so this can import the opening-hours module directly:
//   npx tsx scripts/seed-faqs.ts
//
// This file used to be `.mjs` and carried its OWN copy of the opening hours,
// a stale set that closed at 19:30 on weekdays and 18:00 at weekends, long
// after the salon settled on one set of published hours. It also claimed
// haircuts "start from £8" when the cheapest haircut on the menu is £19 — and
// that answer ships inside FAQPage JSON-LD, so Google could publish the wrong
// price. Neither was reachable by the drift guard in
// `opening-hours-public.test.ts`, because that test only read `src/`. Both are
// fixed: the hours now come from `openingHoursSentence()` so they can never
// disagree again, and this file is in the guard's page list.

import { PrismaClient } from '@prisma/client';
import { openingHoursSentence } from '../src/app/lib/opening-hours-public';

const prisma = new PrismaClient();

const HOME = [
  {
    question: 'Where is Harbour Hair Salon located in Leeds?',
    answer:
      'We are on the upper floor of Unit 15, Central Arcade, Central Road, Leeds LS1 6DX — a short walk from Leeds train station in the heart of the city centre.',
  },
  {
    question: 'What are your opening hours?',
    answer: openingHoursSentence(),
  },
  {
    question: 'Do I need to book in advance or can I walk in?',
    answer:
      'We strongly recommend booking online in advance so we can reserve your preferred stylist and time. Walk-ins are accepted only if a stylist is available.',
  },
  {
    question: 'Do your stylists speak Cantonese?',
    answer:
      'Yes. Our Hong Kong trained stylists speak both English and Cantonese, so you can comfortably discuss your look in either language.',
  },
  {
    question: 'Do you offer student and NHS discounts?',
    answer:
      'Yes. Discounted rates are available on selected haircut, shampoo and blow-dry services for students and NHS staff. Please bring valid ID to your appointment.',
  },
  {
    question: 'How do I book an appointment at Harbour Hair Salon?',
    answer:
      'You can book online in under a minute via our booking page, or call us on 07831 830898 during opening hours.',
  },
];

const CONTACT = [
  {
    question: 'How do I get to Harbour Hair Salon from Leeds train station?',
    answer:
      'We are an easy 7 to 10 minute walk from Leeds train station. Head north through Boar Lane and Briggate towards Central Arcade — we are on the upper floor of Unit 15.',
  },
  {
    question: 'Is there parking near the salon?',
    answer:
      'Yes. Several paid city-centre car parks (including The Light, Trinity Leeds and Q-Park Albion Street) are within a short walk of Central Arcade.',
  },
  {
    question: 'What is the best way to contact the salon?',
    answer:
      'The fastest way to reach us is through our online booking page. You can also call us on 07831 830898 during opening hours, or message us on Instagram @harbourhair_leeds.',
  },
  {
    question: 'Can I cancel or reschedule my appointment?',
    answer:
      'Yes. You can cancel or reschedule free of charge up to 24 hours before your appointment through the My Bookings page. Changes within 24 hours may not be possible.',
  },
  {
    question: 'Do you speak Cantonese at the salon?',
    answer:
      'Yes. Our Hong Kong trained stylists are happy to consult in English or Cantonese — whichever you are most comfortable with.',
  },
];

const SERVICES_MASTER = [
  {
    question: 'How much does a haircut cost at Harbour Hair Salon?',
    answer:
      'Haircuts at Harbour Hair Salon start from £19. Pricing depends on hair length and the service chosen — full prices are listed above and at the salon.',
  },
  {
    question: 'Do you offer hair colouring and balayage?',
    answer:
      'Yes. We offer a full range of colour services including full colour, root touch-up, balayage, highlights and fashion colours. A patch test is required at least 48 hours before any colour service.',
  },
  {
    question: 'How long does a perm take?',
    answer:
      'Most perms take between two and three hours depending on hair length and thickness. Your stylist will give you an exact estimate during consultation.',
  },
  {
    question: "Do you do children's haircuts?",
    answer:
      "Yes. We offer dedicated children's haircuts for ages up to 12 — both short over ears and long hair — with gentle handling and a calm environment.",
  },
  {
    question: 'Do I need a patch test before colouring?',
    answer:
      'A patch test checks for allergic reactions to colour products and is required at least 48 hours before your colour appointment. You can book a free patch test through our booking page.',
  },
  {
    question: 'What treatments do you offer for damaged hair?',
    answer:
      'We offer a range of repair and conditioning treatments designed to restore strength and shine to dry, coloured or chemically treated hair. Our stylists will recommend the right option after a short consultation.',
  },
];

async function seedKey(key: string, items: { question: string; answer: string }[]) {
  const existing = await prisma.faq.count({ where: { key } });
  if (existing > 0) {
    console.log(`  skip ${key} (${existing} rows already exist)`);
    return;
  }
  for (let i = 0; i < items.length; i++) {
    await prisma.faq.create({
      data: {
        key,
        question: items[i].question,
        answer: items[i].answer,
        sortOrder: i,
      },
    });
  }
  console.log(`  seeded ${items.length} rows for key="${key}"`);
}

async function main() {
  await seedKey('home', HOME);
  await seedKey('contact', CONTACT);
  await seedKey('services-master', SERVICES_MASTER);
  const total = await prisma.faq.count();
  console.log(`\nFaq table has ${total} rows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
