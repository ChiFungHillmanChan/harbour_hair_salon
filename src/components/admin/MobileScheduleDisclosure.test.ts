import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { loadServerModule } from '../../test/load-server-module';

test('mobile tools start collapsed and toggle accessibly without losing their controls', () => {
  let expanded = false;
  const { MobileScheduleDisclosure } = loadServerModule<typeof import('./MobileScheduleDisclosure')>(
    'src/components/admin/MobileScheduleDisclosure.tsx', {
      react: {
        useId: () => 'schedule-tools',
        useState: () => [expanded, (update: (value: boolean) => boolean) => { expanded = update(expanded); }],
      },
    },
  );
  const control = createElement('button', {}, 'Open integrations');
  const render = () => MobileScheduleDisclosure({ label: 'Tools & alerts', count: 14, attention: true, children: control });
  let [trigger, content] = render().props.children;
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(trigger.props['aria-controls'], content.props.id);
  assert.equal(content.props.children, control, 'desktop and expanded mobile share the same controls');
  assert.equal(trigger.props.children.at(-1).props.children, 14, 'the number of alerts stays visible');

  trigger.props.onClick();
  [trigger, content] = render().props.children;
  assert.equal(trigger.props['aria-expanded'], true);
  assert.equal(content.props.children, control);
  trigger.props.onClick();
  assert.equal(render().props.children[0].props['aria-expanded'], false);
});
