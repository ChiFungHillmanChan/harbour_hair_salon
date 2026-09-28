import type { MessageTree } from '../../format';

const services = {
  meta: {
    title: 'Hair Services & Pricing in Leeds',
    description: 'Full menu of haircuts, colouring, perms and treatments at Harbour Hair Salon, Leeds city centre, with standard and NHS prices. Book online.',
    ogTitle: 'Hair Services & Pricing | Harbour Hair Salon Leeds',
    ogDescription: 'Full menu of haircuts, colouring, perms and treatments, with standard and NHS prices. Book online.',
  },
  hero: {
    titleStart: 'Services &',
    titleEnd: 'Pricing',
    subtitle: 'Expertly crafted hair services in Leeds city centre, tailored to your unique style.',
    imageAlt: 'Hair styling services at Harbour Hair Salon Leeds',
  },
  list: {
    categoriesLabel: 'Service categories',
    category: 'Category',
    learnMore: 'Learn more about {category}',
    nhsNote: 'NHS prices are shown where an NHS option is available. Prices are the listed prices; offers and discount codes are paused.',
  },
  book: 'Book Appointment',
  faqTitle: 'Service FAQs',
  faqIntro: 'Common questions about our haircuts, colouring, perms and treatments in Leeds.',
  breadcrumb: {
    label: 'Breadcrumb',
    home: 'Home',
    services: 'Services',
    servicesPricing: 'Services & Pricing',
  },
  jsonLd: {
    catalogName: 'Harbour Hair Salon Services',
    serviceAt: '{name} at Harbour Hair Salon',
    serviceAtLeeds: '{name} at Harbour Hair Salon, Leeds.',
  },
  category: {
    heroImageAlt: '{title} at Harbour Hair Salon',
    heroSuffix: 'in Leeds',
    pricingTitle: '{category} Pricing',
    pricingSoon: 'Pricing coming soon. Please call the salon for details.',
    includes: 'What’s included',
    process: 'What to expect',
    aftercare: 'How to look after it',
    bookCategory: 'Book {category}',
    faqTitle: '{category} FAQs',
    faqIntro: 'Common questions about {category} at Harbour Hair Salon.',
    related: 'You might also like',
    explore: 'Explore',
    relatedTitle: '{hero} in Leeds',
    learnMore: 'Learn more',
  },
  menu: {
    eyebrow: 'What We Offer',
    defaultTitle: 'Our Services',
    signatureTitle: 'Signature Services',
    viewFullMenu: 'View Full Menu',
    bookAppointment: 'Book Appointment',
    nhsAvailable: 'NHS price available',
    fromPrice: 'From {price}',
  },
} satisfies MessageTree;

export default services;
