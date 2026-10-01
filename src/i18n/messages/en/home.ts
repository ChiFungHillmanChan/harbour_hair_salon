import type { MessageTree } from '../../format';

/**
 * Home page. `meta` and `page` are the page file's own strings; the home
 * components (hero, trust bar, stylists, …) add their own sections below.
 */
const home = {
  meta: {
    title: 'Harbour Hair Salon Leeds | Hong Kong Trained Stylists',
    description: 'Book your appointment at Harbour Hair Salon, Central Arcade, Leeds. Expert cuts, colours, perms and grooming by Hong Kong trained stylists.',
    ogTitle: 'Harbour Hair Salon | Expert Hair Styling in Leeds',
    ogDescription: 'Hong Kong trained hair stylists in Leeds city centre. Explore cuts, colour and perms, then book by phone or through our booking partners.',
  },
  page: {
    faqTitle: 'Your questions, answered',
    faqIntro: 'Everything you need to know before your first visit to Harbour Hair Salon in Leeds.',
    schemaDescription: 'Professional hair salon in Leeds city centre. Expert cuts, colours, perms and grooming by Hong Kong trained stylists.',
  },
  hero: {
    defaultEyebrow: 'Leeds City Centre',
    defaultTitleLine1: 'Expert Hair',
    defaultTitleLine2: 'Styling',
    defaultSubtitle: 'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.',
    imageAlt: 'Harbour Hair Salon interior in Leeds Central Arcade',
    bookAppointment: 'Book Appointment',
    viewServices: 'Explore services & prices',
  },
  booking: {
    title: 'Book your visit',
    withPartners: 'Call us, or choose a service and time with a booking partner.',
    phoneOnly: 'Call us to choose your service and appointment time.',
    call: 'Call {phone}',
    bookOn: 'Book on {name}',
  },
  socialProof: {
    label: 'Customer reviews',
    rated: 'Rated {value} out of 5',
    verifiedReviews: { one: '<count>{count}</count> verified client review', other: '<count>{count}</count> verified client reviews' },
  },
  trustBar: {
    label: 'Why choose Harbour Hair Salon',
    hongKongTrained: 'Hong Kong trained stylists',
    expertServices: 'Expert cuts, colour & perms',
    location: 'Central Arcade, Leeds LS1 6DX',
    openDaily: 'Open 7 days a week',
    bookOnTreatwell: 'Book on Treatwell',
    findOnGoogle: 'Find us on Google',
  },
  stylists: {
    eyebrow: 'Our Team',
    titleStart: 'Meet The',
    titleEnd: 'Stylists',
    intro: 'Our Hong Kong trained stylists deliver tailored haircuts and grooming services with meticulous attention to detail.',
    portraitAlt: '{name} - {role} at Harbour Hair Salon Leeds',
    viewProfile: 'View profile',
    meetTeam: 'Meet the whole team',
  },
  visit: {
    title: 'Visit & follow us',
    body: 'Find us in central Leeds, book through Treatwell, or follow along on Instagram.',
    bookOnTreatwell: 'Book on Treatwell',
    directions: 'Directions & Google reviews',
  },
  faq: {
    defaultTitle: 'Frequently Asked Questions',
  },
} satisfies MessageTree;

export default home;
