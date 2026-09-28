import type { MessageTree } from '../../format';

const blog = {
  meta: {
    title: 'The Harbour Journal',
    description: 'Hair care guides, styling tips and advice from the Hong Kong trained stylists at Harbour Hair Salon, Leeds city centre.',
    ogTitle: 'The Harbour Journal | Harbour Hair Salon Leeds',
    ogDescription: 'Guides, tips and stylist advice from Harbour Hair Salon in Leeds.',
  },
  breadcrumb: {
    label: 'Breadcrumb',
    home: 'Home',
    journal: 'Journal',
  },
  index: {
    heroAlt: 'Harbour Hair Salon journal',
    titleStart: 'The Harbour',
    titleEnd: 'Journal',
    subtitle: 'Hair care guides, styling tips and honest advice from our Hong Kong trained stylists in Leeds.',
    schemaDescription: 'Hair care guides, styling tips and advice from Harbour Hair Salon, Leeds.',
    emptyPage: 'No posts on this page.',
    empty: 'No posts yet. Check back soon.',
  },
  readingTime: '{count} min read',
  readArticle: 'Read article',
  post: {
    ogTitle: '{title} | Harbour Hair Salon Leeds',
    defaultSection: 'hair care',
    filedUnder: 'Filed under',
    writtenBy: 'Written by',
    ctaTitle: 'Ready for your appointment?',
    ctaBody: 'Book online in under a minute. Expert cuts, colours, perms and treatments in the heart of Leeds.',
    ctaButton: 'Book Appointment',
    keepReading: 'Keep reading',
    journal: 'Journal',
  },
} satisfies MessageTree;

export default blog;
