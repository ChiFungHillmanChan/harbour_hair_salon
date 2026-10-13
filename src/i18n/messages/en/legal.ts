import type { MessageTree } from '../../format';

const legal = {
  /**
   * UK GDPR privacy notice. The page (privacy/page.tsx) renders each list in
   * the order it names the keys; change this wording and LAST_UPDATED there
   * together. `<b>` is the bold lead-in of a list item.
   */
  privacy: {
    meta: {
      title: 'Privacy Policy',
      description: 'How Harbour Hair Salon collects, uses, shares and protects your personal information, and your rights under UK data protection law.',
    },
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: {date}',
    intro: 'This policy explains what personal information Harbour Hair Salon collects when you use this website or book with us, why we use it, who we share it with, how long we keep it, and the rights you have under UK data protection law.',
    who: {
      title: 'Who we are',
      body: 'Harbour Hair Salon is the controller of your personal information: we decide how it is used and we are responsible for looking after it. You will find us at Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX. See “How to contact us” below.',
    },
    collect: {
      title: 'What we collect',
      intro: 'We collect only what we need to run your account and your appointments:',
      account: '<b>Account details:</b> your name, email address, phone number (optional) and a securely scrambled (hashed) version of your password. We also record when you confirmed your email address, and the language you use our site in so that our emails reach you in that language.',
      google: '<b>Google sign-in:</b> if you choose “Continue with Google”, Google gives us your name, your email address and an ID for your Google account. We never see your Google password.',
      bookings: '<b>Bookings:</b> the service, stylist, date, time, price and status of each appointment, any change of time you ask for, and notes our staff add to help with your visit.',
      patchTests: '<b>Patch tests and consultations:</b> some colour services need a skin patch test first. We keep a record of your patch tests and consultations (when they took place, and which service a consultation was for) so that we can check whether a colour service is safe to book. If you tell us about an allergy or a reaction, we may note it on your booking.',
      staffBookings: '<b>Bookings made with our staff:</b> if you book by phone, WhatsApp or in the salon, we record your name and, if you give them, your phone number and email address.',
      emails: '<b>Emails we send you:</b> booking requests, confirmations, reminders, changes, cancellations and review invitations, and whether each one was delivered.',
      reviews: '<b>Reviews:</b> if you review a visit, your rating, your comment and which appointment it was for.',
      marketing: '<b>Marketing preference:</b> if you subscribed to our marketing emails in the past, your email address and whether you have since unsubscribed. We no longer take new sign-ups on this website.',
      security: '<b>Security information:</b> your device’s IP address, used briefly to stop abuse such as repeated sign-in attempts or floods of emails; a record of account events such as sign-ins, email confirmations and password changes (it does not include your IP address); and the short-lived technical logs our hosting provider keeps.',
      visits: '<b>Visits:</b> we count page visits and clicks on our booking buttons, and measure how fast pages load, with Vercel Web Analytics and Speed Insights. They use no cookies and do not identify you.',
      tryColour: '<b>Virtual Hair Colour Try-On:</b> the tool works entirely on your device. Your photo, video or camera picture is never sent to us or stored.',
      required: 'You do not have to give us your information, but without your name and email address we cannot create an account or take an online booking. You can always book by phone instead.',
    },
    use: {
      title: 'How we use it, and our lawful basis',
      intro: 'UK data protection law requires a lawful basis for each use of your information. Ours are:',
      service: '<b>To run your account and your bookings:</b> creating your account, taking and managing appointments and reschedule requests, and sending the emails that go with them. Basis: contract (we need it to provide the service you ask for).',
      safety: '<b>To check that a colour service is safe for you:</b> patch-test records, and any allergy or reaction you tell us about. Basis: contract; for health information, your explicit consent, which you can withdraw at any time.',
      reviewRequests: '<b>To ask how your visit went:</b> one review invitation after an appointment. Basis: legitimate interests (improving our service).',
      reviewsPublished: '<b>To publish your review:</b> on this website after we have checked it, with your name as it appears on your account, the service and the stylist. Basis: consent. You choose to submit it, and you can ask us to remove it at any time.',
      marketing: '<b>To send marketing emails:</b> only if you subscribed. Basis: consent, which you can withdraw at any time with the link in any marketing email or on <unsubscribe>our unsubscribe page</unsubscribe>.',
      security: '<b>To keep the website and your account secure:</b> limiting repeated attempts, confirming email addresses and keeping a record of account events. Basis: legitimate interests (protecting our customers and our systems).',
      improvement: '<b>To count visits and measure page speed:</b> so that we can improve the website. Basis: legitimate interests.',
      records: '<b>To keep business records and deal with legal claims.</b> Basis: legal obligation (for example tax records) and legitimate interests.',
    },
    share: {
      title: 'Who we share it with',
      intro: 'We do not sell your personal information. We share it only with these service providers, who handle it on our behalf and under our instructions:',
      vercel: '<b>Vercel:</b> hosts this website; the parts that handle your details run on its servers in London.',
      neon: '<b>Neon:</b> our database, stored in London.',
      resend: '<b>Resend:</b> sends our emails and holds our marketing mailing list.',
      upstash: '<b>Upstash:</b> stores the short-lived records that limit repeated attempts.',
      google: '<b>Google:</b> only if you choose to sign in with Google, or to show the map on our Contact page. Google handles that information under its own privacy policy.',
      marketplaces: '<b>Booking marketplaces such as Fresha and Treatwell:</b> they receive only the times each stylist is busy, so that they do not double-book. Never your name or any other details.',
      cdn: 'Some images, and the software the Virtual Hair Colour Try-On runs on, load from other content networks (such as Cloudinary, jsDelivr and Google). Like any site you load files from, they see your IP address; we send them none of your details.',
      law: 'We may also share information when the law requires it, for example with HM Revenue & Customs or the police.',
    },
    transfers: {
      title: 'International transfers',
      body: 'This website runs, and our database is stored, in London. Some of our providers are US companies (Vercel, Neon, Resend, Upstash and Google), so some of your information may be handled in the United States. Where it is, it is protected by the safeguards UK law requires, such as the UK Extension to the EU–US Data Privacy Framework, or the UK International Data Transfer Agreement or Addendum.',
    },
    retention: {
      title: 'How long we keep it',
      account: '<b>Your account:</b> while it is open, until you ask us to delete it.',
      bookings: '<b>Booking records</b>, including patch-test and consultation records: up to 6 years after the appointment, for our accounts and in case of legal claims.',
      security: '<b>The record of account events:</b> up to 6 years, like booking records.',
      reviews: '<b>Reviews:</b> while your account is open, unless you ask us to remove one sooner.',
      emails: '<b>Copies of emails waiting to be sent:</b> deleted as soon as the email is sent, or after 30 days if it could not be sent. The record that an email was sent (without its content) is deleted after 12 months.',
      rateLimits: '<b>IP addresses used to limit repeated attempts:</b> deleted automatically within 2 days.',
      links: '<b>Links in our emails</b> stop working after a set time: email confirmation after 48 hours, password reset after 1 hour, unsubscribe after 30 days.',
      marketing: '<b>Marketing list:</b> until you unsubscribe. After that we keep your address marked as unsubscribed, so that we never send you marketing again.',
    },
    rights: {
      title: 'Your rights',
      intro: 'You have the right to:',
      access: 'ask for a copy of the personal information we hold about you;',
      rectification: 'ask us to correct information that is wrong or incomplete;',
      erasure: 'ask us to delete your information;',
      restriction: 'ask us to limit how we use it;',
      objection: 'object to us using it where we rely on legitimate interests;',
      portability: 'ask for information you gave us in a format you can take elsewhere;',
      consent: 'withdraw your consent at any time where we rely on it (this does not affect what we did before).',
      limits: 'Some rights have limits: for example, we may need to keep booking records for our accounts. We do not charge for requests, and we will reply within one month.',
      complain: 'If you are unhappy with how we have handled your information, please tell us first so that we can put it right. You can also complain to the Information Commissioner’s Office (ICO) at <ico>ico.org.uk/make-a-complaint</ico> or on 0303 123 1113.',
    },
    contact: {
      title: 'How to contact us',
      body: 'To use any of your rights or ask about your information, call us on {phone}, speak to us in the salon, or reply to any email we have sent you. Our full details are on our <link>contact page</link>. We will reply within one month.',
    },
    cookies: {
      title: 'Cookies',
      intro: 'We use only the cookies this website needs to work. We use no advertising or tracking cookies, and our visit counting uses no cookies at all.',
      session: '<b>session</b>: keeps you signed in. Up to 30 days (8 hours for staff).',
      sessionHint: '<b>session_hint</b>: lets the page header show your account links. It holds only whether you are signed in as a customer or as staff, and lasts as long as your sign-in.',
      loginDevice: '<b>login_device</b>: remembers that this browser has signed in to your account before, so that strangers’ failed attempts cannot lock you out. 180 days.',
      googleState: '<b>google_oauth_state</b>: protects “Continue with Google” against forgery. 10 minutes.',
      locale: '<b>hh_locale</b>: remembers the language you chose. 1 year.',
      staff: 'Staff using the salon’s own devices also get cookies for the clock-in tablet and for administrator sign-in.',
      map: 'The map on our Contact page comes from Google and loads only after you click to show it. Google may then set its own cookies, under Google’s privacy policy.',
    },
    automated: {
      title: 'Automated decisions',
      body: 'We do not make decisions about you by automated means alone that have legal or similarly significant effects, and we do not profile you. The booking system does check things such as opening hours and whether a patch test is needed; if it cannot book what you want, you can always call us.',
    },
    changes: {
      title: 'Changes to this policy',
      body: 'We will update this policy when the way we handle personal information changes. The date at the top shows when it last changed.',
    },
  },
  unsubscribe: {
    meta: {
      title: 'Unsubscribe from Marketing Emails',
      description: 'Unsubscribe from Harbour Hair Salon marketing emails.',
    },
    title: 'Unsubscribe',
    intro: 'Enter your email address and we will email you a link to confirm you want to stop Harbour Hair Salon marketing emails. Booking confirmations, appointment changes and service emails may still be sent when needed.',
    help: 'Need help? <link>Contact the salon</link>.',
    email: 'Email address',
    placeholder: 'you@example.com',
    submit: 'Email me a confirmation link',
    updating: 'Sending...',
    /** The page an emailed link opens. */
    confirm: {
      intro: 'Stop sending Harbour Hair Salon marketing emails to {email}? Booking and account emails are not affected.',
      submit: 'Unsubscribe',
      updating: 'Updating...',
      requestNew: 'Send me a new link',
    },
    /** Server action results, keyed by code. */
    results: {
      RATE_LIMITED: 'Too many requests. Please try again in an hour.',
      DAILY_LIMIT: 'Too many emails have been requested from your connection today. Please try again tomorrow.',
      INVALID_EMAIL: 'Please enter a valid email address.',
      UNAVAILABLE: 'Unsubscribe is temporarily unavailable. Please contact the salon.',
      FAILED: 'Unsubscribe failed. Please try again later.',
      LINK_SENT: 'If that address is on our mailing list, we have emailed it a link to confirm. Please check your inbox and spam folder.',
      INVALID_LINK: 'This unsubscribe link is invalid or has expired. Enter your email address to get a new one.',
      SUCCESS: 'You have been unsubscribed from marketing emails.',
    },
  },
} satisfies MessageTree;

export default legal;
