import type { MessageTree } from '../../format';

const contact = {
  meta: {
    title: 'Contact & Find Us in Leeds City Centre',
    description: 'Visit Harbour Hair Salon at Unit 15 Central Arcade, Leeds LS1 6DX. Opening hours, directions from Leeds station, and contact details.',
    ogTitle: 'Contact Harbour Hair Salon | Leeds City Centre',
    ogDescription: 'Visit us at Central Arcade, Leeds LS1 6DX. Opening hours, directions, and contact details.',
  },
  breadcrumb: {
    home: 'Home',
    contact: 'Contact',
  },
  hero: {
    imageAlt: 'Harbour Hair Salon location in Leeds Central Arcade',
    titleStart: 'Contact',
    titleEnd: 'Us',
    subtitle: 'Find us in the heart of Leeds city centre',
  },
  location: {
    heading: 'Location',
    note: 'Located inside Central Arcade, just a short walk from Leeds Train Station.',
  },
  touch: {
    heading: 'Get in Touch',
    phone: 'Phone',
  },
  hours: {
    heading: 'Opening Hours',
  },
  map: {
    title: 'Harbour Hair Salon location on Google Maps - Central Arcade, Leeds LS1 6DX',
  },
  follow: {
    heading: 'Find & follow us',
    bookOnTreatwell: 'Book on Treatwell',
    directions: 'Get directions & read our Google reviews',
  },
  cta: {
    title: 'Ready for a fresh look?',
    body: 'Book your appointment online today and let our expert stylists take care of you.',
    button: 'Book Appointment',
  },
  faq: {
    title: 'Visiting Harbour Hair Salon',
    intro: 'Getting here, contacting us, and managing your appointment.',
  },
  gallery: {
    title: 'Our Space',
    intro: 'A look inside the Harbour Hair studio in central Leeds.',
    floorAlt: 'The styling floor at Harbour Hair, with backlit round mirrors and styling chairs',
    floorCaption: 'The styling floor',
    receptionAlt: 'Reception desk featuring the Harbour Hair sign',
    receptionCaption: 'Reception',
    washAlt: 'Wash and treatment area beside the hand-painted calligraphy wall',
    washCaption: 'Wash & treatment',
    stationsAlt: 'Styling stations with illuminated round mirrors',
    stationsCaption: 'Styling stations',
    lightAlt: 'Styling area with natural light and professional hood dryers',
    lightCaption: 'Natural light & hood dryers',
    retailAlt: 'Reception and retail area with calligraphy wall art',
    retailCaption: 'Retail & wall art',
    toolsAlt: 'Professional styling scissors at a Harbour Hair station',
    toolsCaption: 'Precision tools',
  },
  /** Accessible names of the social icon links (site-wide, incl. the footer). */
  social: {
    instagram: 'Instagram',
    treatwell: 'Book on Treatwell',
    google: 'Find us on Google',
  },
} satisfies MessageTree;

export default contact;
