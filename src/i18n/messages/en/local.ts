import type { MessageTree } from '../../format';

const local = {
  meta: {
    title: 'Leeds City Centre Hair Salon | Central Arcade',
    description: 'Find Harbour Hair Salon upstairs in Central Arcade, opposite Trinity Leeds. Hong Kong-trained stylists, cuts, colour and perms. English and Cantonese spoken.',
    ogTitle: 'Harbour Hair Salon in Leeds City Centre',
  },
  breadcrumb: { home: 'Home', local: 'Leeds city centre salon' },
  links: { guide: 'Visiting Leeds city centre', about: 'About the salon' },
  hero: {
    eyebrow: 'Central Arcade · Leeds LS1 6DX',
    title: 'Your hair salon in Leeds city centre.',
    intro: 'Hong Kong-trained stylists in the heart of Leeds. Discover precision cuts, colour, perms and treatments, with consultations in English or Cantonese.',
    imageAlt: 'Styling chairs and illuminated mirrors inside Harbour Hair Salon in Central Arcade, Leeds',
  },
  visit: {
    title: 'Find us inside Central Arcade',
    arrival: 'Look for Harbour Hair Salon on the upper floor, at Unit 15. Central Arcade connects Briggate with Central Road, opposite the Briggate entrance to Trinity Leeds.',
    access: 'The salon is on the upper floor. If you have access requirements, call before visiting so we can advise.',
    directions: 'Get directions on Google Maps',
    contact: 'Contact and full opening hours',
    hours: 'Opening hours',
    phone: 'Call the salon',
  },
  nearby: {
    title: 'A salon appointment in the heart of your day',
    intro: 'Whether you are already shopping in Leeds city centre or making a dedicated visit, these nearby landmarks help you find the right arcade.',
    briggateTitle: 'Briggate & Trinity Leeds',
    briggate: 'Central Arcade is opposite Trinity Leeds on Briggate. Enter the arcade and find us upstairs at Unit 15; our salon is inside Central Arcade, rather than inside Trinity.',
    marketTitle: 'Central Road & Kirkgate Market',
    market: 'The other side of the arcade opens onto Central Road, in the city-centre shopping area around Vicar Lane and Leeds Kirkgate Market. The market’s main entrance is on Vicar Lane.',
    cornTitle: 'Corn Exchange & Call Lane',
    corn: 'Leeds Corn Exchange is on Call Lane in the Kirkgate area. If you are visiting its independent shops, use our Central Arcade address to plan your onward route to the salon.',
  },
  expertise: {
    eyebrow: 'Hong Kong training · Personal attention',
    title: 'Choose a stylist for the look you want.',
    body: 'Our Hong Kong-trained team welcomes clients from all backgrounds. Tell us about your hair, your routine and the result you have in mind, in English or Cantonese. A reference photo can help start the conversation.',
    cutsTitle: 'Cuts & styling',
    cuts: 'Explore wash, haircut and blow-dry options, then choose the service that suits your hair length and appointment.',
    colourTitle: 'Colour & highlights',
    colour: 'Browse full-head colour, highlights and balayage. Contact us before booking if you are unsure which colour service or patch test you need.',
    permsTitle: 'Perms & treatments',
    perms: 'View perm, smoothing and conditioning services. Speak with the team about your hair history and suitability before a change.',
    services: 'View services and prices',
    stylists: 'Meet the stylists',
    about: 'About the salon',
  },
  booking: {
    title: 'Found us? Choose your appointment.',
    body: 'Use our booking options to choose a service and time, or call the salon if you would like help deciding.',
    button: 'See booking options',
    call: 'Call {phone}',
  },
} satisfies MessageTree;

export default local;
