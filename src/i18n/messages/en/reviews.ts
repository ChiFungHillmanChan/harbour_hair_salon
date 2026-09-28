import type { MessageTree } from '../../format';

const reviews = {
  meta: {
    title: 'Client Reviews',
    description: 'Read verified reviews from Harbour Hair Salon clients in Leeds. See what our customers say about our Hong Kong trained stylists, cuts, colours and treatments.',
    ogTitle: 'Client Reviews | Harbour Hair Salon Leeds',
    ogDescription: 'Verified client reviews for Harbour Hair Salon in Leeds city centre.',
  },
  breadcrumb: {
    home: 'Home',
    reviews: 'Reviews',
  },
  hero: {
    titleStart: 'Client',
    titleEnd: 'Reviews',
    subtitle: 'Honest feedback from the people who sit in our chairs.',
    average: '{average} / 5',
    fromCount: { one: 'from {count} verified review', other: 'from {count} verified reviews' },
  },
  rated: 'Rated {value} out of 5',
  anonymous: 'Harbour Hair client',
  schemaFallbackBody: '{service} at Harbour Hair Salon.',
  empty: {
    title: 'Your review could be our first',
    body: "We're just getting started collecting feedback. If you've visited us, we'd love to hear about your experience.",
    cta: 'Review a past appointment',
  },
  bookVisit: 'Book Your Visit',
  new: {
    meta: {
      title: 'Leave a Review',
      description: 'Share your experience at Harbour Hair Salon.',
    },
    alreadySubmittedTitle: 'Review already submitted',
    alreadySubmittedBody: "Thank you — you've already shared feedback for this appointment.",
    notReadyTitle: 'Not yet ready for a review',
    notReadyBody: "You can leave a review once you've attended your appointment.",
    backToBookings: 'Back to My Bookings',
    titleStart: 'How was your',
    titleEnd: 'visit?',
    subtitle: 'Your feedback helps us improve and helps other clients find the right stylist.',
    yourAppointment: 'Your appointment',
    withOn: 'with {stylist} on {date}',
  },
  form: {
    thankYou: 'Thank you!',
    submitted: 'Your review has been submitted and will appear once approved.',
    rating: 'Your rating',
    ratingGroup: 'Rating out of 5',
    stars: { one: '{count} star', other: '{count} stars' },
    comment: 'Tell us more',
    optional: '(optional)',
    placeholder: 'What did you love? Anything we could do better?',
    submitting: 'Submitting…',
    submit: 'Submit Review',
  },
  /** Server action results, keyed by code. */
  errors: {
    INVALID: 'Invalid review data.',
    RATING_REQUIRED: 'Please choose a rating from 1 to 5.',
    COMMENT_TOO_LONG: 'Please keep your comment under 1000 characters.',
    NOT_FOUND: 'Appointment not found.',
    ALREADY_REVIEWED: 'You have already left a review for this appointment.',
    CANCELLED: 'You can only review appointments you actually attended.',
    NOT_YET: 'You can only review appointments after they have taken place.',
    UNAUTHORIZED: 'Unauthorized',
    INVALID_MODERATION: 'Invalid moderation payload',
    REVIEW_GONE: 'That review no longer exists.',
    MODERATION_FAILED: 'Failed to update this review. Please try again.',
  },
} satisfies MessageTree;

export default reviews;
