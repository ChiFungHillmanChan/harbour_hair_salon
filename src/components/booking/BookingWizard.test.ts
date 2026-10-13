import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const words = (nodes: Element[]) => nodes.flatMap((node) => [node.props.children].flat().filter((child) => typeof child === 'string')).join(' ');

const SERVICE = {
  id: 'service-1', name: 'Cut', translated: true, offeringId: null, hairLength: null, duration: 60, amountPence: 4000, priceVersion: 1,
  priceType: 'STANDARD', vatDisplay: 'INCLUDED', priceNature: 'LISTED', isBookable: true, isPublic: true, requiresConsultation: false,
  isConsultation: false, isPatchTest: false, requiresPatchTest: false, searchText: 'cut',
};
const STYLIST = { id: 'lox', name: 'Lox', role: 'Stylist', imageUrl: null, translated: true };

/**
 * The wizard with its state supplied: `draft` holds the in-memory draft values
 * (keyed like `booking-wizard:<name>`, by <name>) and every draft setter call
 * is recorded. Effects never run, so nothing is fetched.
 */
function loadWizard(draft: Record<string, unknown>, submitBooking: (input: unknown) => Promise<unknown> = async () => ({ success: true })) {
  const sets: Record<string, unknown[]> = {};
  const initial = (value: unknown) => (typeof value === 'function' ? (value as () => unknown)() : value);
  const wizard = loadServerModule<typeof import('./BookingWizard')>('src/components/booking/BookingWizard.tsx', {
    react: {
      useState: (value: unknown) => [initial(value), () => undefined],
      useEffect: () => undefined,
      useMemo: (factory: () => unknown) => factory(),
      useRef: (current: unknown) => ({ current }),
    },
    '@/i18n/draft-store': {
      useDraftState: (key: string, value: unknown) => {
        const name = key.split(':')[1];
        return [name in draft ? draft[name] : initial(value), (next: unknown) => { (sets[name] ??= []).push(next); }];
      },
      clearDraft: () => undefined,
    },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/app/actions/booking': { fetchBookingDays: async () => ({ ok: true, days: [] }), submitBooking },
    './DayAvailability': { DayChip: () => null, TimeSlotGrid: () => null, UnavailableDayBlock: () => null },
    './BookingClosedNotice': { BookingClosedNotice: () => null },
    '@/components/pricing/PriceParts': {
      Duration: () => null, OptionLabel: () => null, PriceFinePrint: () => null, SurchargeBreakdown: () => null,
      useCategoryLabel: () => (category: string) => category, useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}`,
    },
  });
  const props = { services: [SERVICE], offerings: [], categories: [], stylists: [STYLIST], closedContact: { phone: '0113 496 0000', marketplaces: [] } };
  return { render: () => wizard.BookingWizard(props as never), sets };
}

const ALREADY = 'You already have a request for this time — see My Bookings.';

test('the success screen says so when the request had already been made, and points to My Bookings', () => {
  const repeat = elements(loadWizard({ submitted: true, alreadyRequested: true }).render());
  assert.ok(words(repeat).includes('Booking Request Received!'));
  assert.ok(words(repeat).includes(ALREADY));
  assert.ok(repeat.some((node) => node.props.href === '/appointments' && node.props.children === 'View My Bookings'), 'the My Bookings button is still there');
  assert.ok(!words(elements(loadWizard({ submitted: true }).render())).includes(ALREADY), 'a new request says nothing of the kind');
});

test('the wizard keeps what the server said: already requested, or a new request', async () => {
  const confirmStep = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: '2026-10-06', time: '11:00' };
  for (const [answer, already] of [[{ success: true, alreadyRequested: true }, true], [{ success: true }, false]] as const) {
    const { render, sets } = loadWizard(confirmStep, async () => answer);
    const [form] = elements(render()).filter((node) => node.type === 'form');
    assert.ok(form, 'the confirm step renders its form');
    await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
    assert.deepEqual(sets.submitted, [true], JSON.stringify(answer));
    assert.deepEqual(sets.alreadyRequested, [already], JSON.stringify(answer));
  }
});

test('the already-requested line exists in both languages', () => {
  assert.equal(translator('en-GB', 'booking')('done.alreadyRequested'), ALREADY);
  assert.equal(translator('zh-HK', 'booking')('done.alreadyRequested'), '你已為這個時間提交過預約申請——請到「我的預約」查看。');
});
