import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { LateArrivalBoard } from '../../app/services/late-arrival-board';

// Admin → Schedule's arrivals panel (late-arrival rule,
// docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md §4.4).

type Element = { type: unknown; props: Record<string, unknown> };

/** Render the tree, calling the panel's own components (their hooks are stubbed). */
function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== 'object' || !('props' in node)) return node;
  const element = node as Element;
  if (typeof element.type === 'function') return render((element.type as (props: unknown) => unknown)(element.props));
  return { ...element, props: { ...element.props, children: render(element.props.children) } };
}

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

type Actions = {
  markArrived?: (id: string, arrived: boolean) => Promise<unknown>;
  restoreLateCancellation?: (id: string, options?: { force?: boolean }) => Promise<unknown>;
};

function panel(board: LateArrivalBoard, actions: Actions = {}) {
  const transitions: Promise<unknown>[] = [];
  const events = { refreshed: 0 };
  const { LateArrivalPanel } = loadServerModule<typeof import('./LateArrivalPanel')>('src/components/admin/LateArrivalPanel.tsx', {
    react: { useTransition: () => [false, (work: () => Promise<unknown>) => { transitions.push(work()); }] },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    '@/i18n/navigation': { useLocalizedRouter: () => ({ refresh: () => { events.refreshed++; } }) },
    '@/app/actions/admin-arrivals': {
      markArrived: actions.markArrived ?? (async () => ({ success: true })),
      restoreLateCancellation: actions.restoreLateCancellation ?? (async () => ({ success: true })),
    },
  });
  const nodes = elements(render(LateArrivalPanel({ board })));
  /** Press a button and wait for its transition, with alert/confirm recorded. */
  const press = async (label: string, confirmAnswer = true) => {
    const said: string[] = [];
    const globals = globalThis as { alert?: unknown; window?: unknown };
    const previous = { alert: globals.alert, window: globals.window };
    globals.alert = (message: string) => { said.push(`alert: ${message}`); };
    globals.window = { confirm: (message: string) => { said.push(`confirm: ${message}`); return confirmAnswer; } };
    try {
      const button = nodes.find((node) => node.type === 'button' && text(node) === label);
      assert.ok(button, `the panel offers ${label}`);
      (button.props.onClick as () => void)();
      await Promise.all(transitions);
    } finally {
      globals.alert = previous.alert;
      globals.window = previous.window;
    }
    return said;
  };
  return { nodes, text: text(nodes[0]), press, events };
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const due = (cancelsAt: string | null): LateArrivalBoard['due'][number] => ({
  id: 'due-1', date: minutesFromNow(-20), customerName: 'Amy', stylistName: 'Ivan', serviceName: 'Cut', cancelsAt,
});
const lateCancelled: LateArrivalBoard['lateCancelled'][number] = {
  id: 'gone-1', date: minutesFromNow(-40), customerName: 'Mei', stylistName: 'Ivan', serviceName: 'Colour',
  lateCancelledAt: minutesFromNow(-20), customerEmailed: false,
};

const HINT = 'When a customer phones to say they’re running late, tap Arrived (or move the booking) so it isn’t cancelled automatically.';

// Final review I2 and M6.
test('while the rule is on, the panel tells staff what to do when a customer phones ahead, and never promises an exact time', () => {
  const on = panel({ ruleOn: true, due: [due(minutesFromNow(-5))], lateCancelled: [] });
  assert.ok(on.text.includes(HINT), 'the phoned-ahead hint');
  assert.match(on.text, /Not arrived — may be cancelled automatically from \d{2}:\d{2}/);
  assert.match(translator('zh-HK', 'adminSchedule')('arrivals.lateCallHint'), /致電表示會遲到/);
  assert.match(translator('zh-HK', 'adminSchedule')('arrivals.cancelsAt', { time: '10:15' }), /可能於 10:15 起自動取消/);

  // Off: nothing will be cancelled, so neither line shows.
  const off = panel({ ruleOn: false, due: [due(null)], lateCancelled: [] });
  assert.ok(!off.text.includes(HINT));
  assert.doesNotMatch(off.text, /cancelled automatically/);
});

// Final review F6: a rejected server action (network, server error) never reaches the error boundary.
test('a failed Arrived or Restore request is reported and the board refreshed', async () => {
  const failing = async () => { throw new Error('network down'); };
  const arriving = panel({ ruleOn: true, due: [due(minutesFromNow(-5))], lateCancelled: [] }, { markArrived: failing });
  assert.deepEqual(await arriving.press('Arrived'), ['alert: Failed to update']);
  assert.equal(arriving.events.refreshed, 1);

  const restoring = panel({ ruleOn: true, due: [], lateCancelled: [lateCancelled] }, { restoreLateCancellation: failing });
  assert.deepEqual(await restoring.press('Restore'), ['alert: Failed to update']);
  assert.equal(restoring.events.refreshed, 1);

  // The forced retry after a clash fails too.
  let calls = 0;
  const forced = panel({ ruleOn: true, due: [], lateCancelled: [lateCancelled] }, {
    restoreLateCancellation: async () => {
      if (calls++ === 0) return { success: false, clashes: [{ kind: 'OVERLAP' }] };
      throw new Error('network down');
    },
  });
  const said = await forced.press('Restore');
  assert.deepEqual(said, [`confirm: ${translator('en-GB', 'adminSchedule')('arrivals.restoreClash')}`, 'alert: Failed to update']);
  assert.equal(forced.events.refreshed, 1);
});

test('answers are shown and the board refreshed', async () => {
  const refused = panel({ ruleOn: true, due: [due(null)], lateCancelled: [] }, {
    markArrived: async () => ({ success: false, error: 'This booking was cancelled by the late-arrival rule. Use Restore in the Arrivals panel.' }),
  });
  assert.deepEqual(await refused.press('Arrived'), ['alert: This booking was cancelled by the late-arrival rule. Use Restore in the Arrivals panel.']);
  assert.equal(refused.events.refreshed, 1);

  const restored = panel({ ruleOn: true, due: [], lateCancelled: [lateCancelled] });
  assert.deepEqual(await restored.press('Restore'), []);
  assert.equal(restored.events.refreshed, 1);
});
