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

/** Renders the form with "Also add as stylist" already ticked or not. */
function render(ticked: boolean, employee?: Record<string, unknown>) {
  const { default: EmployeeForm } = loadServerModule<typeof import('./EmployeeForm')>('src/components/admin/EmployeeForm.tsx', {
    react: {
      useActionState: () => [{}, () => undefined, false], useId: () => 'id',
      // The fourth useState is "Also add as stylist" (error, saved, pending come first).
      useState: (() => { let n = 0; return (value: unknown) => [++n === 4 ? ticked : value, () => undefined]; })(),
    },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace) },
    '@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) },
  });
  return elements(EmployeeForm({ action: async () => ({}), stylists: [{ id: 'ivan', name: 'Ivan' }], employee: employee as never }));
}
const byName = (nodes: Element[], name: string) => nodes.find((node) => node.props.name === name);

test('"Also add as stylist" is offered to a new employee; ticking it switches the existing-stylist choice off', () => {
  assert.equal(byName(render(false), 'addAsStylist')?.props.type, 'checkbox');
  assert.equal(byName(render(false), 'stylistId')?.props.disabled, false);
  assert.equal(byName(render(true), 'stylistId')?.props.disabled, true);
});

test('it is offered when editing an employee with no stylist, never one already linked', () => {
  const employee = (stylistId: string | null) => ({ id: 'e1', name: 'Mei', title: 'Assistant', payType: 'HOURLY', hourlyRate: null, monthlySalary: null, commissionRate: null, overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: null, unpaidBreakMinutes: null, stylistId });
  assert.ok(byName(render(false, employee(null)), 'addAsStylist'));
  assert.equal(byName(render(false, employee('ivan')), 'addAsStylist'), undefined);
});

test('the stylist choice is keyed by the saved link, so it follows a stylist just made', () => {
  const employee = { id: 'e1', name: 'Mei', title: 'Assistant', payType: 'HOURLY', hourlyRate: null, monthlySalary: null, commissionRate: null, overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: null, unpaidBreakMinutes: null, stylistId: 'mei' };
  const { default: EmployeeForm } = loadServerModule<typeof import('./EmployeeForm')>('src/components/admin/EmployeeForm.tsx', {
    react: { useActionState: () => [{}, () => undefined, false], useId: () => 'id', useState: (value: unknown) => [value, () => undefined] },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace) },
    '@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) },
  });
  const tree = EmployeeForm({ action: async () => ({}), stylists: [{ id: 'mei', name: 'Mei' }], employee });
  const select = (function find(node: unknown): { key?: unknown } | undefined {
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child); if (hit) return hit; } return undefined; }
    if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
    const element = node as { key?: unknown; props: Record<string, unknown> };
    return element.props.name === 'stylistId' ? element : find(element.props.children);
  })(tree);
  assert.equal(select?.key, 'mei');
});
