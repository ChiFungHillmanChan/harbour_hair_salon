import type { MessageTree } from '../../format';

const legal = {
  privacy: {
    meta: {
      title: 'Privacy Policy',
      description: 'How Harbour Hair Salon handles booking, account and marketing data.',
    },
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: {date}',
    whoTitle: 'Who We Are',
    whoBody: 'Harbour Hair Salon operates from Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX. You can contact us by phone on {phone} or through the details on our <link>contact page</link>.',
    collectTitle: 'Information We Collect',
    collectBody: 'We collect the information needed to run salon bookings and customer accounts, including name, email address, phone number, appointment details, service history, review content you submit, and marketing subscription preferences.',
    useTitle: 'How We Use It',
    useBody: 'We use your information to create and manage appointments, send booking confirmations, reminders and review requests, manage customer accounts, operate salon administration, prevent abuse, and send marketing emails only where you have subscribed.',
    providersTitle: 'Service Providers',
    providersBody: 'We use trusted providers to operate the website, database, email delivery, analytics and salon scheduling integrations. These providers process information only as needed to deliver those services.',
    marketingTitle: 'Marketing Emails',
    marketingBody: 'You can unsubscribe from marketing emails at any time using the unsubscribe link in our emails or by visiting <link>our unsubscribe page</link>. Appointment and account emails may still be sent where required to provide a service you requested.',
    rightsTitle: 'Your Rights',
    rightsBody: 'You can ask us to access, correct or delete personal information we hold about you, subject to legal and operational record-keeping requirements. Contact the salon to make a request.',
  },
  unsubscribe: {
    meta: {
      title: 'Unsubscribe from Marketing Emails',
      description: 'Unsubscribe from Harbour Hair Salon marketing emails.',
    },
    title: 'Unsubscribe',
    intro: 'Enter your email address and we will remove it from Harbour Hair Salon marketing emails. Booking confirmations, appointment changes and service emails may still be sent when needed.',
    help: 'Need help? <link>Contact the salon</link>.',
    email: 'Email address',
    placeholder: 'you@example.com',
    submit: 'Unsubscribe',
    updating: 'Updating...',
    /** Server action results, keyed by code. */
    results: {
      RATE_LIMITED: 'Too many requests. Please try again in an hour.',
      INVALID_EMAIL: 'Please enter a valid email address.',
      UNAVAILABLE: 'Unsubscribe is temporarily unavailable. Please contact the salon.',
      FAILED: 'Unsubscribe failed. Please try again later.',
      SUCCESS: 'You have been unsubscribed from marketing emails.',
    },
  },
} satisfies MessageTree;

export default legal;
