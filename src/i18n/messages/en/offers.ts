import type { MessageTree } from '../../format';

const offers = {
  meta: {
    title: 'Special Offers & Promotions in Leeds',
    description: 'Exclusive seasonal promotions and special offers at Harbour Hair Salon, Leeds city centre. Save on haircuts, colours and treatments.',
    ogTitle: 'Special Offers | Harbour Hair Salon Leeds',
    ogDescription: 'Exclusive seasonal promotions. Save on haircuts, colours and treatments at our Leeds city centre salon.',
    pausedTitle: 'Offers & Promotions',
    pausedDescription: 'Offers and discount codes are paused at Harbour Hair Salon, Leeds city centre. The prices on our services page are the listed prices.',
    pausedOgTitle: 'Offers | Harbour Hair Salon Leeds',
  },
  breadcrumb: {
    home: 'Home',
    offers: 'Special Offers',
  },
  hero: {
    imageAlt: 'Special offers at Harbour Hair Salon Leeds',
    titleStart: 'Special',
    titleEnd: 'Offers',
    subtitle: 'Exclusive seasonal promotions at our Leeds city centre salon, designed to elevate your personal style.',
    pausedSubtitle: 'News of any future promotions at our Leeds city centre salon will appear here.',
  },
  paused: {
    title: 'Offers are paused at the moment',
    body: 'We are not running any offers or discount codes right now, so no discount is applied to bookings. The prices shown on our services page are the listed prices.',
    cta: 'View services & prices',
  },
  empty: {
    title: 'Quiet Season',
    body: 'We are currently curating new experiences. Be the first to know when new offers drop by joining the list below.',
  },
  card: {
    limitedTime: 'Limited Time',
    percentOff: '{value}%',
    offService: 'Off Service',
    book: 'Book Experience',
  },
} satisfies MessageTree;

export default offers;
