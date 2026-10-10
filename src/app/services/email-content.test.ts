import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentEmailContent, describeEmailPrice, isSalonEmailKind, marketingUnsubscribeContent, passwordResetContent, renderPlainText, toEmailAppointment, type EmailAppointment } from './email-content';

const appointment: EmailAppointment = {
  id: 'appointment-ABCDEFGH',
  date: new Date('2026-08-01T09:30:00.000Z'), // 10:30 London (BST)
  user: { email: 'chan@example.com', name: '陳大文', phone: '07000 000000' },
  stylist: { name: 'Ivan' },
  service: { name: '長髮洗剪吹', duration: 85 },
  price: { known: true, amountPence: 4500, priceType: 'NHS', vatDisplay: 'EXCLUDED', priceNature: 'LISTED' },
  notes: 'Please use the quiet chair',
};

test('Chinese customer mail: subject, date, price wording and a /zh-hk link', () => {
  const content = appointmentEmailContent('CONFIRMATION', appointment, 'zh-HK');
  assert.match(content.subject, /預約已確認/);
  assert.equal(content.greeting, '陳大文你好：');
  const text = renderPlainText(content);
  assert.match(text, /2026年8月1日/);
  assert.match(text, /10:30/, 'salon time in Europe/London, whatever the language');
  assert.match(text, /£45\.00 · NHS 價 · 未含 VAT/);
  assert.match(content.cta!.href, /\/zh-hk\/appointments$/);
});

test('English mail keeps English wording and the unprefixed link', () => {
  const content = appointmentEmailContent('REQUEST_RECEIVED', { ...appointment, user: { email: 'a@example.com', name: 'Ada' } }, 'en-GB', { salonPhone: '07831 830898' });
  assert.equal(content.subject, 'We’ve received your booking request — Harbour Hair Salon');
  assert.match(content.cta!.href, /\.co\.uk\/appointments$|\/appointments$/);
  assert.doesNotMatch(content.cta!.href, /zh-hk/);
  assert.match(renderPlainText(content), /Call the salon on 07831 830898/);
});

test('an unknown historical price is never shown as an amount', () => {
  assert.equal(describeEmailPrice({ known: false }, 'en-GB'), 'Not recorded — please ask the salon');
  assert.equal(describeEmailPrice({ known: false }, 'zh-HK'), '未有記錄——請向本店查詢');
  // Legacy callers that pass a plain number keep that amount and gain no NHS/VAT claim.
  const legacy = toEmailAppointment({ ...appointment, price: undefined, service: { name: 'Cut', duration: 30, price: 48 } });
  assert.equal(describeEmailPrice(legacy.price, 'en-GB'), '£48.00');
});

test('the salon alert is Cantonese by default copy and keeps customer data raw', () => {
  const content = appointmentEmailContent('SALON_ALERT', appointment, 'zh-HK');
  const text = renderPlainText(content);
  assert.match(content.subject, /新預約申請/);
  assert.match(text, /陳大文/);
  assert.match(text, /chan@example\.com/);
  assert.match(text, /Please use the quiet chair/, 'notes are never translated or rewritten');
  assert.match(content.cta!.href, /\/zh-hk\/admin$/);
});

test('password reset mail links to the reset page in the requesting language', () => {
  const zh = passwordResetContent({ name: null }, 'tok en', 60, 'zh-HK');
  assert.match(zh.cta!.href, /\/zh-hk\/auth\/reset-password\?token=tok%20en$/);
  assert.match(renderPlainText(zh), /60 分鐘/);
  const en = passwordResetContent({ name: 'Ada' }, 'abc', 60, 'en-GB');
  assert.match(en.cta!.href, /\/auth\/reset-password\?token=abc$/);
  assert.doesNotMatch(en.cta!.href, /zh-hk/);
});

test('the unsubscribe confirmation carries its link and says nothing changes without it', () => {
  const href = 'https://www.harbourhair.co.uk/zh-hk/unsubscribe?token=abc.def';
  const zh = marketingUnsubscribeContent(href, 30, 'zh-HK');
  assert.equal(zh.cta?.href, href);
  assert.match(renderPlainText(zh), /30 日內有效/);
  const en = marketingUnsubscribeContent('https://example.test/unsubscribe?token=x', 30, 'en-GB');
  assert.match(en.subject, /unsubscribe/i);
  assert.match(renderPlainText(en), /ignore this email — nothing will change/);
});

const requestAppointment = {
  id: 'appointment-abcdefgh', date: new Date('2099-09-14T12:00:00Z'), notes: null,
  user: { name: 'Amy', email: 'amy@example.test', phone: '07000 000000' },
  stylist: { name: 'Ivan' },
  service: { name: 'Cut & Blow-dry', duration: 60 },
  price: { known: false } as const,
};
const requestedDate = new Date('2099-09-15T09:00:00Z');

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`reschedule-request emails show the current and requested times (${locale})`, () => {
    for (const kind of ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'] as const) {
      const content = appointmentEmailContent(kind, requestAppointment, locale, { requestedDate });
      const text = JSON.stringify(content);
      assert.ok(content.subject.length > 0, kind);
      assert.match(text, /14/, `${kind} names the current date`);
      assert.match(text, /15/, `${kind} names the requested date`);
      assert.equal(content.greeting === null, kind === 'SALON_RESCHEDULE_ALERT', `${kind}: only staff mail has no greeting`);
    }
  });
}

test('the salon reschedule alert carries the customer contact details and links to the admin board', () => {
  const content = appointmentEmailContent('SALON_RESCHEDULE_ALERT', requestAppointment, 'en-GB', { requestedDate });
  const values = content.details.map((detail) => detail.value);
  assert.ok(values.includes('Amy'));
  assert.ok(values.includes('amy@example.test'));
  assert.ok(values.includes('07000 000000'));
  assert.match(content.cta?.href ?? '', /\/admin$/);
});

test('reschedule-request emails refuse to render without the requested date', () => {
  assert.throws(() => appointmentEmailContent('RESCHEDULE_DECLINED', requestAppointment, 'en-GB', {}), /requested date/);
});

test('both salon alert kinds are staff mail', () => {
  assert.equal(isSalonEmailKind('SALON_ALERT'), true);
  assert.equal(isSalonEmailKind('SALON_RESCHEDULE_ALERT'), true);
  assert.equal(isSalonEmailKind('RESCHEDULE_DECLINED'), false);
});

// A declined or lapsed request is about finding ANOTHER time, not an earlier
// one, so it must not reuse the new-booking "Need it sooner?" callout.
const anotherTimeCallout = {
  'en-GB': { title: 'Want a different time?', body: 'Call the salon on 07831 830898 and we’ll find one with you.' },
  'zh-HK': { title: '想另約時間？', body: '請致電本店 07831 830898，我們會與你另約時間。' },
} as const;

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`declined and lapsed request emails give the salon phone when it is known (${locale})`, () => {
    for (const kind of ['RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'] as const) {
      const withPhone = appointmentEmailContent(kind, requestAppointment, locale, { requestedDate, salonPhone: '07831 830898' });
      assert.deepEqual(withPhone.callout, anotherTimeCallout[locale], kind);
      assert.match(renderPlainText(withPhone), /07831 830898/, `${kind} plain text carries the phone`);
      assert.equal(appointmentEmailContent(kind, requestAppointment, locale, { requestedDate }).callout, undefined, `${kind}: no phone, no callout`);
    }
  });
}

test('booking emails offer a new-time request, not a direct reschedule, from My Bookings', () => {
  const en = { reschedule: 'You can cancel, or request a new time, from My Bookings up to 24 hours before your appointment.' };
  const zh = { reschedule: '你可於預約前 24 小時或之前，在「我的預約」取消或申請改期。' };
  assert.deepEqual(appointmentEmailContent('RESCHEDULE', requestAppointment, 'en-GB', { oldDate: requestedDate }).footnotes, [en.reschedule]);
  assert.deepEqual(appointmentEmailContent('RESCHEDULE', requestAppointment, 'zh-HK', { oldDate: requestedDate }).footnotes, [zh.reschedule]);
  for (const kind of ['CONFIRMATION', 'REMINDER'] as const) {
    const english = appointmentEmailContent(kind, requestAppointment, 'en-GB').footnotes.join(' ');
    assert.match(english, /You can cancel, or request a new time, from My Bookings up to 24 hours before your appointment\./, kind);
    assert.doesNotMatch(english, /reschedule|Changes are possible/, kind);
    const chinese = appointmentEmailContent(kind, requestAppointment, 'zh-HK').footnotes.join(' ');
    assert.match(chinese, /你可於預約前 24 小時或之前，在「我的預約」取消或申請改期。/, kind);
  }
});
