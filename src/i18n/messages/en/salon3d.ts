import type { MessageTree } from '../../format';

const salon3d = {
  meta: {
    title: 'About Our Leeds Salon',
    ogTitle: 'About Harbour Hair Salon in Leeds',
    description: 'Meet Harbour Hair, a Leeds city centre salon with Hong Kong trained stylists. Explore our cuts, colour and perms, see the salon and find your booking options.',
  },
  heading: 'Hong Kong trained. At home in Leeds.',
  intro: 'Harbour Hair is a hair salon in Central Arcade, Leeds city centre. Our Hong Kong trained stylists work with you on a cut, colour or perm that fits the way you wear your hair.',
  welcome: 'Whether you have a particular look in mind or need advice, start with a conversation. We welcome new and returning clients, with service in English and Cantonese.',
  book: 'Book an appointment',
  services: 'Services & prices',
  approach: {
    heading: 'Find the right service for your hair',
    cutTitle: 'Cuts & styling',
    cutBody: 'Explore our haircut and styling services, then choose the appointment that suits your needs.',
    colourTitle: 'Colour & perms',
    colourBody: 'Thinking about a change? Check the service details and consultation requirements before booking.',
    teamTitle: 'Meet your stylist',
    teamBody: 'Get to know the team and their specialties before choosing who to book with.',
    teamLink: 'Meet the stylists',
  },
  tour: {
    heading: 'A look inside before your visit',
    intro: 'See our space in this optional 3D tour, then choose your service and book your visit.',
    start: 'Take a look inside',
    close: 'Close tour',
    controls: 'Drag to look around, or choose “Walk inside” to explore at eye level.',
    previewAlt: 'Styling chairs and round mirrors inside Harbour Hair Salon, Central Arcade, Leeds',
    frameTitle: 'Interactive 3D walkthrough of Harbour Hair Salon',
    note: 'The tour is based on salon photos. The layout and dimensions are illustrative.',
  },
  visit: {
    heading: 'Come and see us in Central Arcade',
    address: 'Upper Floor, Unit 15, Central Arcade, Central Road, Leeds LS1 6DX',
    directions: 'Find us in Leeds city centre',
    body: 'Ready to arrange your appointment? View our current booking options, or compare services and prices first.',
  },
} satisfies MessageTree;

export default salon3d;
