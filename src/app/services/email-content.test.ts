import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCalendarFile, appointmentEmailContent, calendarMethodFor, describeEmailPrice, emailVerificationContent, isSalonEmailKind, marketingUnsubscribeContent, passwordResetContent, renderPlainText, toEmailAppointment, type EmailAppointment } from './email-content';

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
  const zh = passwordResetContent('tok en', 60, 'zh-HK');
  assert.match(zh.cta!.href, /\/zh-hk\/auth\/reset-password\?token=tok%20en$/);
  assert.match(renderPlainText(zh), /60 分鐘/);
  const en = passwordResetContent('abc', 60, 'en-GB');
  assert.match(en.cta!.href, /\/auth\/reset-password\?token=abc$/);
  assert.doesNotMatch(en.cta!.href, /zh-hk/);
});

// Anyone can register an address they do not own and type a "name" such as
// "Your account is locked, call 0900…". The verification and reset emails go
// to that address from our domain, so they must not carry the name at all.
test('account emails greet neutrally and never take the account name', () => {
  const neutral = { 'en-GB': 'Hi there,', 'zh-HK': '你好：' } as const;
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const verify = emailVerificationContent('tok', 24, locale);
    assert.equal(verify.greeting, neutral[locale]);
    // Straight to the confirm page, in the mail's language: opening it changes nothing.
    assert.match(verify.cta!.href, /\/auth\/verify-email\/confirm\?token=tok$/);
    assert.equal(verify.cta!.href.includes('/zh-hk/'), locale === 'zh-HK');
    assert.equal(passwordResetContent('tok', 60, locale).greeting, neutral[locale]);
  }
  assert.equal(emailVerificationContent.length, 3, 'no user/name parameter');
  assert.equal(passwordResetContent.length, 3, 'no user/name parameter');
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

test('a staff move that closed an open request says what happened to the request', () => {
  const moved = { ...requestAppointment, date: new Date('2099-09-12T13:00:00Z') };
  const other = new Date('2099-09-20T09:00:00Z');
  const replaced = appointmentEmailContent('RESCHEDULE', moved, 'en-GB', { oldDate: requestedDate, requestedDate: other });
  assert.match(replaced.footnotes[0], /^Your request to move to .+ is now closed: the salon has arranged the time above instead\.$/);
  assert.match(renderPlainText(replaced), /Your request to move to/);
  const matched = appointmentEmailContent('RESCHEDULE', moved, 'en-GB', { oldDate: requestedDate, requestedDate: moved.date });
  assert.equal(matched.footnotes[0], 'This is the new time you asked for.');
  const zh = appointmentEmailContent('RESCHEDULE', moved, 'zh-HK', { oldDate: requestedDate, requestedDate: other });
  assert.match(zh.footnotes[0], /^你改至.+的申請已經結束：本店已為你安排以上時間。$/);
  assert.equal(appointmentEmailContent('RESCHEDULE', moved, 'zh-HK', { oldDate: requestedDate, requestedDate: moved.date }).footnotes[0], '這是你申請的新時間。');
});

test('booking emails offer a new-time request, not a direct reschedule, from My Bookings', () => {
  const en = { reschedule: 'You can cancel, or request a new time, from My Bookings up to 24 hours before your appointment.' };
  const zh = { reschedule: '你可於預約前 24 小時或之前，在「我的預約」取消或申請改期。' };
  // The booking footnote comes first; the calendar notes follow it.
  assert.equal(appointmentEmailContent('RESCHEDULE', requestAppointment, 'en-GB', { oldDate: requestedDate }).footnotes[0], en.reschedule);
  assert.equal(appointmentEmailContent('RESCHEDULE', requestAppointment, 'zh-HK', { oldDate: requestedDate }).footnotes[0], zh.reschedule);
  for (const kind of ['CONFIRMATION', 'REMINDER'] as const) {
    const english = appointmentEmailContent(kind, requestAppointment, 'en-GB').footnotes.join(' ');
    assert.match(english, /You can cancel, or request a new time, from My Bookings up to 24 hours before your appointment\./, kind);
    assert.doesNotMatch(english, /reschedule|Changes are possible/, kind);
    const chinese = appointmentEmailContent(kind, requestAppointment, 'zh-HK').footnotes.join(' ');
    assert.match(chinese, /你可於預約前 24 小時或之前，在「我的預約」取消或申請改期。/, kind);
  }
});

test('every customer mail, the confirmation included, uses the monochrome palette', () => {
  for (const kind of ['CONFIRMATION', 'REQUEST_RECEIVED', 'REMINDER', 'CANCELLATION'] as const) {
    assert.equal(appointmentEmailContent(kind, appointment, 'en-GB', { salonPhone: '07831 830898' }).palette, 'ink', kind);
  }
});

// "Add to Google Calendar" + an attached .ics, for confirmed times only. The
// request appointment is 13:00 BST (12:00Z) on 14 Sep 2099, for 60 minutes.
const calendarText = {
  'en-GB': {
    label: 'Add to Google Calendar',
    title: 'Cut & Blow-dry at Harbour Hair Salon',
    details: 'Stylist: Ivan\nView or change your booking: https://www.harbourhair.co.uk/appointments',
    attached: 'A calendar file (.ics) is attached: open it to add this appointment to Apple Calendar, Outlook or another calendar app.',
    moved: 'If you saved the previous time in your calendar, please delete it and add the new time.',
    cancelled: 'If you added this appointment to your calendar, please remove it. In most calendar apps, opening the attached calendar file (.ics) does this for you.',
  },
  'zh-HK': {
    label: '加入 Google 日曆',
    title: 'Cut & Blow-dry｜Harbour Hair Salon',
    details: '髮型師：Ivan\n查看或更改預約：https://www.harbourhair.co.uk/zh-hk/appointments',
    attached: '此電郵附有日曆檔案（.ics），開啟後即可將預約加入 Apple 日曆、Outlook 或其他日曆應用程式。',
    moved: '如你已將原定時間加入日曆，請刪除該項目，再加入新的時間。',
    cancelled: '如你已將此預約加入日曆，請將其移除。在大部分日曆應用程式中，開啟附上的日曆檔案（.ics）即可自動移除。',
  },
} as const;

for (const locale of ['en-GB', 'zh-HK'] as const) {
  const words = calendarText[locale];

  test(`confirmed-time emails offer Add to Google Calendar and mention the attached file (${locale})`, () => {
    for (const kind of ['CONFIRMATION', 'RESCHEDULE', 'REMINDER'] as const) {
      const content = appointmentEmailContent(kind, requestAppointment, locale, { oldDate: requestedDate, sequence: 2 });
      assert.equal(content.links?.length, 1, kind);
      assert.equal(content.links![0].label, words.label);
      const link = new URL(content.links![0].href);
      assert.equal(`${link.origin}${link.pathname}`, 'https://calendar.google.com/calendar/render');
      assert.equal(link.searchParams.get('action'), 'TEMPLATE');
      assert.equal(link.searchParams.get('text'), words.title);
      assert.equal(link.searchParams.get('dates'), '20990914T120000Z/20990914T130000Z');
      assert.equal(link.searchParams.get('details'), words.details);
      assert.equal(link.searchParams.get('location'), 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX');
      assert.equal(content.footnotes.at(-1), words.attached, kind);
      assert.match(renderPlainText(content), new RegExp(`${words.label}: https://calendar\\.google\\.com/calendar/render\\?action=TEMPLATE&`), `${kind} plain text`);
    }
    assert.ok(appointmentEmailContent('RESCHEDULE', requestAppointment, locale, { oldDate: requestedDate }).footnotes.includes(words.moved), 'a moved booking asks to replace the old entry');
    assert.ok(!appointmentEmailContent('CONFIRMATION', requestAppointment, locale).footnotes.includes(words.moved));
  });

  test(`a cancellation asks the customer to remove the entry, with no add link (${locale})`, () => {
    const content = appointmentEmailContent('CANCELLATION', requestAppointment, locale, { sequence: 3 });
    assert.equal(content.links, undefined);
    assert.ok(content.footnotes.includes(words.cancelled));
  });
}

// A request nobody confirmed was never offered to the customer's calendar, so
// cancelling it (a staff decline, or the customer withdrawing it) has no entry
// to remove: no CANCEL file, no "remove it from your calendar" note.
test('cancelling a request that was never confirmed carries no calendar file and no calendar note', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const content = appointmentEmailContent('CANCELLATION', requestAppointment, locale, { sequence: 1, wasConfirmed: false });
    assert.ok(!content.footnotes.includes(calendarText[locale].cancelled), locale);
    assert.ok(!content.footnotes.some((note) => /\.ics/.test(note)), locale);
    assert.equal(content.links, undefined);
    assert.equal(content.footnotes.length, 1, 'only the cancellation footnote');
    assert.equal(appointmentCalendarFile('CANCELLATION', requestAppointment, locale, { sequence: 1, wasConfirmed: false }), null, locale);
  }
  assert.equal(calendarMethodFor('CANCELLATION', { wasConfirmed: false }), null);
});

// Mail queued before `wasConfirmed` was recorded has none: it was a confirmed
// booking's cancellation in the common case, so it keeps its file and note.
test('a confirmed booking’s cancellation, or one queued before the flag existed, still removes the calendar entry', () => {
  for (const wasConfirmed of [true, undefined]) {
    assert.equal(calendarMethodFor('CANCELLATION', { wasConfirmed }), 'CANCEL', String(wasConfirmed));
    assert.equal(appointmentCalendarFile('CANCELLATION', requestAppointment, 'en-GB', { sequence: 3, wasConfirmed })?.method, 'CANCEL');
    assert.ok(appointmentEmailContent('CANCELLATION', requestAppointment, 'en-GB', { sequence: 3, wasConfirmed }).footnotes.includes(calendarText['en-GB'].cancelled));
  }
  assert.equal(calendarMethodFor('CANCELLATION'), 'CANCEL');
  assert.equal(calendarMethodFor('CONFIRMATION', { wasConfirmed: false }), 'PUBLISH', 'the flag is about cancellations only');
});

test('requests, staff alerts and the review request never offer a calendar entry', () => {
  for (const kind of ['REQUEST_RECEIVED', 'SALON_ALERT', 'RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED', 'REVIEW_REQUEST'] as const) {
    const content = appointmentEmailContent(kind, requestAppointment, 'en-GB', { requestedDate, salonPhone: '07831 830898', sequence: 1 });
    assert.equal(content.links, undefined, kind);
    assert.ok(!JSON.stringify(content).includes('calendar.google.com'), kind);
    assert.ok(!content.footnotes.some((note) => /\.ics/.test(note)), kind);
    assert.equal(appointmentCalendarFile(kind, requestAppointment, 'en-GB', { requestedDate }), null, kind);
  }
});

test('the attached file: PUBLISH with the queued SEQUENCE for confirmed times, CANCEL with the same UID for a cancellation', () => {
  const now = new Date('2099-09-10T08:00:00Z');
  for (const kind of ['CONFIRMATION', 'RESCHEDULE', 'REMINDER'] as const) {
    const file = appointmentCalendarFile(kind, requestAppointment, 'en-GB', { oldDate: requestedDate, sequence: 2, now })!;
    assert.equal(file.method, 'PUBLISH', kind);
    assert.equal(file.filename, 'harbour-hair-2099-09-14.ics');
    const ics = file.ics.replace(/\r\n /g, '');
    assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/);
    assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/);
    assert.match(ics, /\r\nSEQUENCE:2\r\n/);
    assert.match(ics, /\r\nUID:appointment-appointment-abcdefgh@harbourhair\.co\.uk\r\n/);
    assert.match(ics, /\r\nDTSTAMP:20990910T080000Z\r\n/);
    assert.match(ics, /\r\nDTSTART:20990914T120000Z\r\nDTEND:20990914T130000Z\r\n/);
    assert.match(ics, /\r\nSUMMARY:Cut & Blow-dry at Harbour Hair Salon\r\n/);
  }
  const cancel = appointmentCalendarFile('CANCELLATION', requestAppointment, 'zh-HK', { sequence: 3, now })!;
  assert.equal(cancel.method, 'CANCEL');
  const ics = cancel.ics.replace(/\r\n /g, '');
  assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
  assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(ics, /\r\nSEQUENCE:3\r\n/);
  assert.match(ics, /\r\nUID:appointment-appointment-abcdefgh@harbourhair\.co\.uk\r\n/);
  assert.match(ics, /\r\nSUMMARY:Cut & Blow-dry｜Harbour Hair Salon\r\n/, 'in the language of the email');
});
