import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sendPreparedEmail } from './email-service';

type Rendered = { html: string; text: string; attachments: { filename: string; content: string; content_type?: string }[] | null };

/**
 * Prepare one appointment email of each kind with the real renderer. The suite's
 * react-server condition forbids react-dom/server, so this runs in a plain Node
 * process, like the template test in email-transport.test.ts.
 */
function renderKinds(kinds: string[]): Record<string, Rendered> {
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--eval', `
    const { loadServerModule } = require('./src/test/load-server-module.ts');
    const { prepareAppointmentEmail } = loadServerModule('src/app/services/email-service.ts', { 'server-only': {} });
    process.env.EMAIL_FROM = 'Salon <booking@example.com>';
    const appointment = { id: 'cmappt123', date: new Date('2099-09-14T12:00:00Z'), user: { email: 'customer@example.com', name: 'Amy' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } };
    const options = { oldDate: new Date('2099-09-13T12:00:00Z'), sequence: 4, now: new Date('2099-09-10T08:00:00Z'), salonPhone: '0113 000 0000' };
    (async () => {
      const result = {};
      for (const kind of ${JSON.stringify(kinds)}) {
        const email = await prepareAppointmentEmail(kind, appointment, options, 'en-GB');
        result[kind] = { html: email.html, text: email.text, attachments: email.attachments ?? null };
      }
      process.stdout.write(JSON.stringify(result));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output.toString());
}

const decode = (attachment: { content: string }) => Buffer.from(attachment.content, 'base64').toString('utf8').replace(/\r\n /g, '');

test('confirmed-time mail shows Add to Google Calendar and attaches a PUBLISH .ics', () => {
  const emails = renderKinds(['CONFIRMATION', 'RESCHEDULE', 'REMINDER']);
  for (const [kind, email] of Object.entries(emails)) {
    assert.ok(email.html.includes('https://calendar.google.com/calendar/render?action=TEMPLATE'), `${kind} HTML link`);
    assert.ok(email.html.includes('Add to Google Calendar'), kind);
    assert.ok(email.text.includes('Add to Google Calendar: https://calendar.google.com/calendar/render?action=TEMPLATE&'), `${kind} plain text`);
    assert.equal(email.attachments?.length, 1, kind);
    const [file] = email.attachments!;
    assert.equal(file.filename, 'harbour-hair-2099-09-14.ics');
    assert.equal(file.content_type, 'text/calendar');
    const ics = decode(file);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/);
    assert.match(ics, /\r\nUID:appointment-cmappt123@harbourhair\.co\.uk\r\n/);
    assert.match(ics, /\r\nSEQUENCE:4\r\n/);
    assert.match(ics, /\r\nDTSTAMP:20990910T080000Z\r\n/);
    assert.match(ics, /\r\nDTSTART:20990914T120000Z\r\nDTEND:20990914T130000Z\r\n/);
  }
});

test('a cancellation attaches a CANCEL .ics for the same entry and offers no add link; a request attaches nothing', () => {
  const emails = renderKinds(['CANCELLATION', 'REQUEST_RECEIVED']);
  const cancel = emails.CANCELLATION;
  assert.ok(!cancel.html.includes('calendar.google.com'));
  assert.ok(cancel.text.includes('If you added this appointment to your calendar, please remove it.'));
  const ics = decode(cancel.attachments![0]);
  assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
  assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(ics, /\r\nUID:appointment-cmappt123@harbourhair\.co\.uk\r\n/);
  const request = emails.REQUEST_RECEIVED;
  assert.equal(request.attachments, null, 'a pending request is not in anyone\'s calendar yet');
  assert.ok(!request.html.includes('calendar.google.com'));
  assert.ok(!request.text.includes('.ics'));
});

test('the attachment travels in the frozen request body sent to Resend', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-only-key';
  const email = {
    from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>',
    attachments: [{ filename: 'harbour-hair-2099-09-14.ics', content: Buffer.from('BEGIN:VCALENDAR\r\n').toString('base64'), content_type: 'text/calendar' }],
  };
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body)); return Response.json({ id: 'email-1' }); };
  try {
    await sendPreparedEmail(email, 'appointment/a/1/CONFIRMATION');
    assert.deepEqual(JSON.parse(bodies[0]).attachments, email.attachments);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
  }
});
