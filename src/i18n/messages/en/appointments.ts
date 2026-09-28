import type { MessageTree } from '../../format';

const appointments = {
  meta: {
    title: 'My Bookings',
    description: 'View, cancel, or reschedule your hair appointments.',
  },
  title: 'My Bookings',
  upcoming: {
    heading: 'Upcoming',
    empty: 'No upcoming appointments.',
  },
  past: {
    heading: 'Past',
    empty: 'No past appointments.',
  },
  status: {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
  },
  card: {
    withStylist: 'with {name}',
    when: '{date} at {time}',
    reschedule: 'Reschedule',
    cancel: 'Cancel',
    cancelling: 'Cancelling...',
    withdraw: 'Withdraw request',
    leaveReview: 'Leave a review',
    reviewSubmitted: 'Review submitted',
    confirmCancel: 'Are you sure you want to cancel this appointment?',
    cancelFailed: 'Failed to cancel',
    unexpectedError: 'Something went wrong. Please try again, or call the salon.',
    rescheduleUnavailable: 'Online rescheduling is temporarily unavailable — please call the salon',
    rescheduleTooLate: 'Cannot reschedule within 24 hours',
    cancelTooLate: 'Cannot cancel within 24 hours',
    awaitingConfirmation: "Awaiting confirmation from the salon — we'll email you once it's confirmed.",
    changesLocked: 'Changes cannot be made within 24 hours of your appointment.',
    maintenance: 'Online rescheduling is temporarily unavailable while our booking system is under maintenance. Please call the salon to move this appointment.',
  },
  reschedule: {
    title: 'Reschedule Appointment',
    close: 'Close',
    date: 'Select New Date',
    loadingSlots: 'Loading available slots...',
    noSlots: 'No available slots for this date.',
    times: 'Available Times',
    old: 'Old:',
    new: 'New:',
    dateTime: '{date}, {time}',
    cancel: 'Cancel',
    confirm: 'Confirm',
    submitting: 'Rescheduling...',
    slotsFailed: "We couldn't load available times. Please try again, or call the salon.",
    failed: 'Reschedule failed',
    unexpectedError: 'Something went wrong. Please try again, or call the salon.',
  },
} satisfies MessageTree;

export default appointments;
