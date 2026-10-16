import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import type { Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
type Handler = (event: unknown) => unknown;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const text = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object' && 'props' in node) return text((node as Element).props.children);
  return '';
};

/** A minimal stateful stand-in for React's hooks, so a grid can be driven through several renders. */
function hookRuntime() {
  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  let index = 0;
  const hooks = {
    useMemo: (run: () => unknown) => run(),
    useId: () => 'id',
    useEffect: (run: () => void) => { effects.push(run); },
    useRef: (initial: unknown) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useState: (initial: unknown) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      const set = (value: unknown) => {
        slots[slot] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(slots[slot]) : value;
      };
      return [slots[slot], set];
    },
  };
  return {
    hooks,
    pass: <T>(run: () => T): T => { index = 0; effects.length = 0; const result = run(); return result; },
    effects,
  };
}
const i18nClient = (locale: Locale = 'en-GB') => ({
  useT: (namespace: Namespace) => translator(locale, namespace),
  useLocale: () => locale,
});

type Moves = Array<Record<string, unknown>>;
function mountGrid(view: 'Day' | 'Week', locale: Locale = 'en-GB') {
  const runtime = hookRuntime();
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(
    `src/components/admin/Schedule${view}Grid.tsx`,
    // The dialog is stubbed by name: its own behaviour is tested below, and the
    // real one would pull in a browser React.
    { react: runtime.hooks, '@/i18n/client': i18nClient(locale), './MoveConfirmDialog': { MoveConfirmDialog: function MoveConfirmDialog() { return null; } } },
  );
  const moves: Moves = [];
  const calls = { selected: 0, moved: 0 };
  const dayKey = '2026-10-17';
  const props = {
    day: new Date(`${dayKey}T12:00:00Z`), dayKeys: [dayKey, '2026-10-18'], todayKey: dayKey,
    stylists: [
      { id: 's1', name: 'Ivan', calendarColor: null, availability: { startTime: '09:00', endTime: '18:00' }, availabilityByWeekday: {} },
      { id: 's2', name: 'Lox', calendarColor: null, availability: { startTime: '09:00', endTime: '18:00' }, availabilityByWeekday: {} },
    ],
    // 10:00 London (BST) on Sat 17 Oct 2026, 45 minutes.
    appointments: [{
      id: 'a1', stylistId: 's1', date: '2026-10-17T09:00:00Z', durationMin: 45, status: 'CONFIRMED',
      customerName: 'Mei', serviceName: 'Cut', serviceColor: null, updatedAt: '2026-10-01T00:00:00Z',
    }],
    busyBlocks: [],
    onMove: async (input: Record<string, unknown>) => { moves.push(input); return { success: true }; },
    onMoved: () => { calls.moved += 1; },
    onSelect: () => { calls.selected += 1; },
    onCreate: () => undefined,
  };
  const render = () => runtime.pass(() => grid[`Schedule${view}Grid`](props));
  const find = (predicate: (node: Element) => boolean) => elements(render()).filter(predicate);
  const dialog = () => find((node) => typeof node.type === 'function' && (node.type as { name: string }).name === 'MoveConfirmDialog')[0];
  const event = (x: number, y: number) => ({
    clientX: x, clientY: y, pointerId: 1, preventDefault: () => undefined, stopPropagation: () => undefined,
    target: { setPointerCapture: () => undefined },
  });
  /** Press the booking block, then drag it by (dx, dy) pixels and release. */
  const drag = async (dy: number, options: { handle?: 'move' | 'top' | 'bottom'; dx?: number; release?: 'up' | 'cancel' } = {}) => {
    const blocks = find((node) => String(node.props.className ?? '').includes('cursor-grab'));
    assert.equal(blocks.length, 1);
    const handles = elements(blocks[0].props.children).filter((node) => String(node.props.className ?? '').includes('cursor-ns-resize'));
    const down = (options.handle === 'top' ? handles[0] : options.handle === 'bottom' ? handles[1] : blocks[0]).props.onPointerDown as Handler;
    down(event(100, 100));
    const body = () => find((node) => String(node.props.className ?? '').includes('select-none'))[0];
    (body().props.onPointerMove as Handler)(event(100 + (options.dx ?? 0), 100 + dy));
    const release = options.release === 'cancel' ? body().props.onPointerCancel : body().props.onPointerUp;
    await (release as Handler)(event(100 + (options.dx ?? 0), 100 + dy));
  };
  const pxPerMinute = view === 'Day' ? 1.2 : 0.9;
  return { drag, dialog, find, render, moves, calls, pxPerMinute };
}

for (const view of ['Day', 'Week'] as const) {
  test(`${view} grid: a drop opens the confirmation and sends nothing`, async () => {
    const grid = mountGrid(view);
    await grid.drag(90 * grid.pxPerMinute); // 90 minutes later: 10:00 -> 11:30
    const dialog = grid.dialog();
    assert.ok(dialog, 'the confirmation is shown');
    assert.deepEqual(grid.moves, [], 'nothing is saved before Move');
    assert.equal(grid.calls.moved, 0);
    assert.equal(dialog.props.customer, 'Mei');
    assert.equal(dialog.props.service, 'Cut');
    assert.deepEqual(dialog.props.changes, [
      { kind: 'time', from: 'Sat 17 Oct 10:00', to: 'Sat 17 Oct 11:30' },
    ]);
  });

  test(`${view} grid: Cancel never calls onMove and closes the confirmation`, async () => {
    const grid = mountGrid(view);
    await grid.drag(90 * grid.pxPerMinute);
    (grid.dialog().props.onCancel as () => void)();
    assert.equal(grid.dialog(), undefined);
    assert.deepEqual(grid.moves, []);
    assert.equal(grid.calls.moved, 0);
  });

  test(`${view} grid: Move sends the original payload once`, async () => {
    const grid = mountGrid(view);
    await grid.drag(90 * grid.pxPerMinute);
    await (grid.dialog().props.onMove as () => unknown)();
    assert.equal(grid.moves.length, 1);
    assert.deepEqual(grid.moves[0], {
      appointmentId: 'a1', dateStr: '2026-10-17', time: '11:30', durationMin: 45, stylistId: 's1',
      expectedUpdatedAt: '2026-10-01T00:00:00Z', overrideClashes: false,
    });
    assert.equal(grid.calls.moved, 1);
    assert.equal(grid.dialog(), undefined, 'the confirmation closes');
  });

  test(`${view} grid: a resize lists only the length`, async () => {
    const grid = mountGrid(view);
    await grid.drag(15 * grid.pxPerMinute, { handle: 'bottom' }); // 45 -> 60 min
    assert.deepEqual(grid.dialog().props.changes, [{ kind: 'length', from: '45', to: '60' }]);
    assert.deepEqual(grid.moves, []);
  });

  test(`${view} grid: a press without movement opens the booking, not the confirmation`, async () => {
    const grid = mountGrid(view);
    await grid.drag(0);
    assert.equal(grid.dialog(), undefined);
    assert.equal(grid.calls.selected, 1);
    assert.deepEqual(grid.moves, []);
  });

  test(`${view} grid: a drag that ends where it began opens nothing`, async () => {
    const grid = mountGrid(view);
    await grid.drag(5 * grid.pxPerMinute); // under half a 15-minute step: snaps back
    assert.equal(grid.dialog(), undefined);
    assert.deepEqual(grid.moves, []);
  });

  // Final review M3: the browser took the pointer away (a scroll, a system
  // gesture, an incoming call): the block snaps back and nothing is asked.
  test(`${view} grid: a cancelled pointer snaps back without opening the confirmation`, async () => {
    const grid = mountGrid(view);
    await grid.drag(90 * grid.pxPerMinute, { release: 'cancel' });
    assert.equal(grid.dialog(), undefined, 'no confirmation');
    assert.deepEqual(grid.moves, []);
    assert.deepEqual(grid.calls, { selected: 0, moved: 0 }, 'not taken as a click on the booking either');
    // The board is usable again: the next drag asks as usual.
    await grid.drag(90 * grid.pxPerMinute);
    assert.ok(grid.dialog());

    const pressed = mountGrid(view);
    await pressed.drag(0, { release: 'cancel' });
    assert.equal(pressed.calls.selected, 0, 'a cancelled press opens nothing');
  });

  test(`${view} grid: no new drag starts while the confirmation is open`, async () => {
    const grid = mountGrid(view);
    await grid.drag(90 * grid.pxPerMinute);
    assert.ok(grid.dialog());
    const block = grid.find((node) => String(node.props.className ?? '').includes('cursor-grab'))[0];
    let prevented = false;
    (block.props.onPointerDown as Handler)({
      clientX: 0, clientY: 0, pointerId: 1, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined,
      target: { setPointerCapture: () => undefined },
    });
    assert.equal(prevented, false, 'the press is ignored');
  });
}

test('Day grid: moving to another stylist lists the stylist change', async () => {
  const grid = mountGrid('Day', 'zh-HK');
  // Give the stylist columns a measured width so x decides the column.
  const columns = grid.find((node) => typeof node.props.ref === 'function' && String(node.props.className ?? '').includes('cursor-copy'));
  assert.equal(columns.length, 2);
  columns.forEach((column, i) => (column.props.ref as (el: unknown) => void)({ getBoundingClientRect: () => ({ left: i * 200, right: i * 200 + 199 }) }));
  await grid.drag(0, { dx: 200 }); // same time, into Lox's column
  assert.deepEqual(grid.dialog().props.changes, [{ kind: 'stylist', from: 'Ivan', to: 'Lox' }]);
});

test('Week grid: moving to another day shows both days', async () => {
  const grid = mountGrid('Week');
  const columns = grid.find((node) => typeof node.props.ref === 'function' && String(node.props.className ?? '').includes('relative'));
  assert.ok(columns.length >= 2);
  columns.forEach((column, i) => (column.props.ref as (el: unknown) => void)({ getBoundingClientRect: () => ({ left: i * 200, right: i * 200 + 199 }) }));
  await grid.drag(0, { dx: 200 });
  const changes = grid.dialog().props.changes as Array<{ kind: string; from: string; to: string }>;
  assert.deepEqual(changes, [{ kind: 'time', from: 'Sat 17 Oct 10:00', to: 'Sun 18 Oct 10:00' }]);
});

// ---- the dialog itself

function mountDialog(overrides: Record<string, unknown> = {}) {
  const runtime = hookRuntime();
  const dialogModule = loadServerModule<{ MoveConfirmDialog: (props: Record<string, unknown>) => unknown }>(
    'src/components/admin/MoveConfirmDialog.tsx',
    { react: runtime.hooks, '@/i18n/client': i18nClient() },
  );
  const calls = { move: 0, cancel: 0 };
  const props = {
    customer: 'Mei', service: 'Cut',
    changes: [
      { kind: 'time', from: 'Sat 17 Oct 10:00', to: 'Sat 17 Oct 11:30' },
      { kind: 'stylist', from: 'Ivan', to: 'Lox' },
      { kind: 'length', from: '45', to: '60' },
    ],
    onMove: () => { calls.move += 1; }, onCancel: () => { calls.cancel += 1; }, ...overrides,
  };
  const tree = elements(runtime.pass(() => dialogModule.MoveConfirmDialog(props)));
  return { tree, calls, runtime };
}

test('MoveConfirmDialog is an in-page modal dialog that lists what changed', () => {
  const { tree } = mountDialog();
  const dialog = tree.find((node) => node.props.role === 'dialog')!;
  assert.ok(dialog);
  assert.equal(dialog.props['aria-modal'], 'true');
  const all = text(dialog);
  assert.match(all, /Move this booking\?/);
  assert.match(all, /Mei · Cut/);
  assert.match(all, /Sat 17 Oct 10:00 → Sat 17 Oct 11:30/);
  assert.match(all, /Ivan → Lox/);
  assert.match(all, /45 → 60 min/);
});

test('MoveConfirmDialog: focus starts on Cancel, Esc cancels, Move is a plain button', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { tree, calls, runtime } = mountDialog();
  const buttons = tree.filter((node) => node.type === 'button');
  const cancel = buttons.find((node) => text(node) === 'Cancel')!;
  const move = buttons.find((node) => text(node) === 'Move')!;
  assert.equal(cancel.props.type, 'button');
  assert.equal(move.props.type, 'button');
  let focused = 0;
  (cancel.props.ref as { current: unknown }).current = { focus: () => { focused += 1; } };
  runtime.effects.forEach((effect) => effect());
  assert.equal(focused, 1, 'Cancel takes focus on open');

  const dialog = tree.find((node) => node.props.role === 'dialog')!;
  let prevented = false;
  (dialog.props.onKeyDown as Handler)({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => undefined });
  assert.equal(calls.cancel, 1);
  assert.equal(prevented, true);
  (dialog.props.onKeyDown as Handler)({ key: 'Enter', preventDefault: () => undefined, stopPropagation: () => undefined });
  assert.equal(calls.move, 0, 'Enter on the dialog itself never moves; only the focused Move button does');
  assert.equal(dialog.props.tabIndex, -1, 'focusable itself, so Esc and Tab still work after clicking its text');

  t.mock.timers.tick(350);
  (move.props.onClick as () => void)();
  assert.equal(calls.move, 1);
  (cancel.props.onClick as () => void)();
  assert.equal(calls.cancel, 2);
});

test('MoveConfirmDialog: a click on the backdrop cancels, a click inside does not', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { tree, calls, runtime } = mountDialog();
  runtime.effects.forEach((effect) => effect());
  t.mock.timers.tick(350);
  const backdrop = tree.find((node) => String(node.props.className ?? '').includes('fixed inset-0'))!;
  const onClick = backdrop.props.onClick as Handler;
  onClick({ target: 'inside', currentTarget: 'backdrop' });
  assert.equal(calls.cancel, 0);
  onClick({ target: 'backdrop', currentTarget: 'backdrop' });
  assert.equal(calls.cancel, 1);
});

// Final review I5: on an iPad the tap that ends a drag arrives a moment later
// as a click on whatever the dialog put under the finger. The owner's point is
// that nothing moves by accident, so every click in the first 350 ms is ignored.
test('MoveConfirmDialog ignores clicks in its first 350 ms (the iPad ghost tap), then Move and Cancel work', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { tree, calls, runtime } = mountDialog();
  const buttons = tree.filter((node) => node.type === 'button');
  const click = (label: string) => (buttons.find((node) => text(node) === label)!.props.onClick as () => void)();
  const backdrop = () => (tree.find((node) => String(node.props.className ?? '').includes('fixed inset-0'))!.props.onClick as Handler)({ target: 'backdrop', currentTarget: 'backdrop' });

  // Before the dialog has even finished mounting.
  click('Move');
  backdrop();
  assert.deepEqual(calls, { move: 0, cancel: 0 });

  runtime.effects.forEach((effect) => effect()); // mounted: the clock starts
  click('Move');
  click('Cancel');
  backdrop();
  t.mock.timers.tick(349);
  click('Move');
  backdrop();
  assert.deepEqual(calls, { move: 0, cancel: 0 }, 'nothing within 350 ms');

  // Esc is a key, never a ghost tap: it works at once.
  const dialog = tree.find((node) => node.props.role === 'dialog')!;
  (dialog.props.onKeyDown as Handler)({ key: 'Escape', preventDefault: () => undefined, stopPropagation: () => undefined });
  assert.equal(calls.cancel, 1);

  t.mock.timers.tick(1);
  click('Move');
  assert.equal(calls.move, 1, 'Move works after 350 ms');
  click('Cancel');
  backdrop();
  assert.equal(calls.cancel, 3, 'Cancel and the backdrop too');
});

test('MoveConfirmDialog speaks Chinese', () => {
  const runtime = hookRuntime();
  const dialogModule = loadServerModule<{ MoveConfirmDialog: (props: Record<string, unknown>) => unknown }>(
    'src/components/admin/MoveConfirmDialog.tsx',
    { react: runtime.hooks, '@/i18n/client': i18nClient('zh-HK') },
  );
  const tree = elements(runtime.pass(() => dialogModule.MoveConfirmDialog({
    customer: 'Mei', service: 'Cut', changes: [{ kind: 'length', from: '45', to: '60' }], onMove: () => undefined, onCancel: () => undefined,
  })));
  assert.match(text(tree), /確定移動此預約/);
  assert.match(text(tree), /45 → 60 分鐘/);
});
