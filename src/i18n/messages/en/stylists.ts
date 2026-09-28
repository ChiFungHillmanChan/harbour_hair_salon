import type { MessageTree } from '../../format';

const stylists = {
  meta: {
    title: 'Meet the Stylists',
    description: 'Meet the Hong Kong trained stylists at Harbour Hair Salon in Leeds city centre. Our team, their specialties and what to expect at your appointment.',
    ogTitle: 'Meet the Stylists | Harbour Hair Salon Leeds',
    ogDescription: 'Our Hong Kong trained stylists and what they specialise in, at Harbour Hair Salon, Leeds.',
  },
  breadcrumb: {
    label: 'Breadcrumb',
    home: 'Home',
    stylists: 'Stylists',
  },
  index: {
    titleStart: 'Meet the',
    titleEnd: 'Team',
    subtitle: 'Hong Kong trained stylists in the heart of Leeds city centre, each with their own style and specialty.',
    empty: 'Our team will be introduced here soon.',
    portraitAlt: '{name}, {role} at Harbour Hair Salon Leeds',
    viewProfile: 'View profile',
    schemaName: 'Stylists at Harbour Hair Salon',
  },
  detail: {
    metaTitle: '{name} — {role}',
    ogTitle: '{name} — {role} | Harbour Hair Salon Leeds',
    metaDescriptionFallback: 'Meet {name}, {role} at Harbour Hair Salon in Leeds. Book online today.',
    schemaDescriptionFallback: '{role} at Harbour Hair Salon, Leeds.',
    portraitAlt: '{name}, {role} at Harbour Hair Salon Leeds',
    experience: 'Experience',
    years: '{count}+ years',
    trainedIn: 'Trained in',
    languages: 'Languages',
    defaultLanguage: 'English',
    listSeparator: ', ',
    bookWith: 'Book with {name}',
    about: 'About {name}',
    specialties: 'Specialties',
    related: 'Meet the rest of the team',
    viewProfile: 'View profile',
  },
  /** Shown only while a stylist has no specialties of their own. */
  defaultSpecialties: {
    colouring: 'Hair colouring',
    balayage: 'Balayage and highlights',
    colourCorrection: 'Colour correction',
    toning: 'Toning and glossing',
    mensCuts: "Men's haircuts",
    beard: 'Beard grooming',
    barbering: 'Classic barbering',
    childrensCuts: "Children's haircuts",
    precisionCuts: 'Precision haircuts',
    blowDries: 'Styling and blow dries',
    consultation: 'Consultation and aftercare advice',
  },
} satisfies MessageTree;

export default stylists;
