import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';
import type { ConsultationCreditPreview } from '@/app/actions/admin-consultation-credit';

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

/** Just enough of React's hooks for one component: state survives re-renders, effects run when their deps change. */
function hookRuntime() {
  const states: unknown[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const queued: (() => void)[] = [];
  let stateIndex = 0;
  let effectIndex = 0;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(states[index]) : next; }];
    },
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const index = effectIndex++;
      const previous = effects[index];
      if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) return;
      queued.push(() => {
        previous?.cleanup?.();
        effects[index] = { deps, cleanup: effect() ?? undefined };
      });
    },
  };
  const render = (draw: () => unknown) => {
    stateIndex = 0;
    effectIndex = 0;
    const output = draw();
    for (const run of queued.splice(0)) run();
    return output;
  };
  return { react, render };
}

const CONSULTED = '2099-10-01T09:00:00.000Z';
const LOOKUP = { customerId: 'user-9', serviceId: 'colour', dateStr: '2099-10-15', time: '11:00' };

function option(t: TestContext, answer: ConsultationCreditPreview) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked: unknown[] = [];
  const changes: boolean[] = [];
  const { react, render } = hookRuntime();
  const { ConsultationCreditOption } = loadServerModule<typeof import('./ConsultationCreditOption')>('src/components/admin/ConsultationCreditOption.tsx', {
    react,
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    '@/app/actions/admin-consultation-credit': {
      previewConsultationCredit: async (input: unknown) => { asked.push(input); return answer; },
    },
  });
  const draw = (props: Partial<Parameters<typeof ConsultationCreditOption>[0]> = {}) => render(() => ConsultationCreditOption({
    lookup: LOOKUP, apply: true, onApplyChange: (apply) => changes.push(apply), recorded: null, ...props,
  }));
  /** Lets the debounce fire and the server's answer land. */
  const answered = async () => {
    t.mock.timers.tick(300);
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  };
  return { draw, answered, asked, changes };
}

const checkbox = (nodes: Element[]) => nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox');

test('an available credit is offered, ticked by default, for the customer, service and time asked about', async (t) => {
  const { draw, answered, asked, changes } = option(t, { available: true, amountPence: 1500, consultationDate: CONSULTED });

  assert.equal(draw(), null, 'nothing is offered before the server answers');
  await answered();
  assert.deepEqual(asked, [LOOKUP]);

  const nodes = elements(draw());
  assert.equal(checkbox(nodes)?.props.checked, true);
  assert.match(text(nodes), /Consultation credit available: £15\.00 \(consultation on 1 Oct 2099\) — deduct from this booking/);
  (checkbox(nodes)!.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.deepEqual(changes, [false]);
  assert.equal(checkbox(elements(draw({ apply: false })))?.props.checked, false);
});

test('no credit available, or no customer to ask about, offers nothing', async (t) => {
  const none = option(t, { available: false });
  none.draw();
  await none.answered();
  assert.equal(none.asked.length, 1);
  assert.equal(none.draw(), null);

  t.mock.timers.reset();
  const nobody = option(t, { available: true, amountPence: 1500, consultationDate: CONSULTED });
  nobody.draw({ lookup: null });
  await nobody.answered();
  assert.deepEqual(nobody.asked, [], 'a walk-in with no account has had no consultation');
  assert.equal(nobody.draw({ lookup: null }), null);
});

test('a changed time asks again, and the previous answer is not shown meanwhile', async (t) => {
  const { draw, answered, asked } = option(t, { available: true, amountPence: 1500, consultationDate: CONSULTED });
  draw();
  await answered();
  assert.ok(checkbox(elements(draw())));

  const later = { ...LOOKUP, time: '15:00' };
  assert.equal(draw({ lookup: later }), null, 'the answer was for 11:00');
  await answered();
  assert.deepEqual(asked, [LOOKUP, later]);
  assert.ok(checkbox(elements(draw({ lookup: later }))));
});

test('a booking that records a credit shows it, and says when saving would remove it', async (t) => {
  const recorded = { amountPence: 1500, consultationDate: CONSULTED };
  const { draw, answered } = option(t, { available: false });

  assert.match(text(draw({ recorded })), /Consultation credit recorded on this booking: −£15\.00 \(consultation on 1 Oct 2099\)/);
  await answered();
  const nodes = elements(draw({ recorded }));
  assert.equal(checkbox(nodes), undefined);
  assert.match(text(nodes), /No consultation credit applies to this booking now/);
});

test('a recorded credit that still applies can be unticked to remove it', async (t) => {
  const recorded = { amountPence: 1500, consultationDate: CONSULTED };
  const { draw, answered } = option(t, { available: true, amountPence: 1500, consultationDate: CONSULTED });
  draw({ recorded });
  await answered();
  const nodes = elements(draw({ recorded }));
  assert.match(text(nodes), /recorded on this booking/);
  assert.equal(checkbox(nodes)?.props.checked, true);
});
