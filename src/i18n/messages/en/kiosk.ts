import type { MessageTree } from '../../format';

/** The staff clock-in kiosk. Employee names are shown as entered. */
const kiosk = {
  meta: {
    title: 'Staff Clock-In',
  },
  title: 'Staff Clock-In',
  roster: {
    onShift: '● On shift',
    off: '○ Off',
    empty: 'Kiosk not enabled or no active staff.',
  },
  pin: {
    clockIn: 'Clock in',
    clockOut: 'Clock out',
    label: 'PIN for {name}',
    placeholder: 'Enter PIN',
    back: 'Back',
    confirm: 'Confirm',
  },
  result: {
    clockedIn: '{name}: clocked in ✓',
    clockedOut: '{name}: clocked out ✓',
    connection: 'Connection problem — please try again.',
  },
  errors: {
    NOT_ENABLED: 'Kiosk not enabled on this device',
    RATE_LIMITED: 'Too many attempts. Please wait a few minutes.',
    UNKNOWN_EMPLOYEE: 'Unknown employee',
    WRONG_PIN: 'Incorrect PIN',
    RETRY: 'Please try again',
  },
} satisfies MessageTree;

export default kiosk;
