import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// Auth pages hide the site footer (FooterSwitcher), and with it the footer's
// privacy link, so the forms where people give their details link it themselves.

type Element = { type: unknown; props: Record<string, unknown> };

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

function renderForm(file: 'RegisterForm' | 'SignInForm', locale: Locale) {
  const forms = loadServerModule<Record<string, () => unknown>>(`src/components/auth/${file}.tsx`, {
    react: { Suspense: 'suspense', useActionState: () => [undefined, () => undefined, false], useState: (value: unknown) => [value, () => undefined] },
    'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@/app/actions/auth': { register: async () => undefined, login: async () => undefined },
    '@/i18n/link': (props: Record<string, unknown>) => ({ type: 'a', props }),
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) },
    '@/components/auth/PasswordVisibilityToggle': () => null,
    '@/components/auth/GoogleAuthButton': () => null,
  });
  const tree = render(forms[file]());
  return { nodes: elements(tree), text: text(tree) };
}

for (const [file, key] of [['RegisterForm', 'register.privacy'], ['SignInForm', 'signIn.privacy']] as const) {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    test(`${file} links the privacy policy in ${locale}`, () => {
      const form = renderForm(file, locale);
      const link = form.nodes.find((node) => node.type === 'a' && node.props.href === '/privacy');
      assert.ok(link, 'a link to the privacy policy');
      assert.equal(link.props.target, '_blank', 'opening it keeps the form as typed');
      const sentence = translator(locale, 'auth')(key).replace(/<\/?link>/g, '');
      assert.ok(form.text.includes(sentence), 'the translated sentence, tags rendered');
    });
  }
}
