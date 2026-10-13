import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sendPreparedEmail } from './email-service';

type Rendered = { html: string; text: string; attachments: { filename: string; content: string; content_type?: string }[] | null };
/** Sender settings for one render; a key set to null is removed from the environment. */
type SenderEnv = { EMAIL_FROM?: string | null; EMAIL_REPLY_TO?: string | null };
type Render = { kind: string; options?: Record<string, unknown>; env?: SenderEnv };

const DEFAULT_ENV: SenderEnv = { EMAIL_FROM: 'Salon <booking@example.com>', EMAIL_REPLY_TO: null };

/**
 * Prepare appointment emails with the real renderer. The suite's react-server
 * condition forbids react-dom/server, so this runs in a plain Node process,
 * like the template test in email-transport.test.ts. Every render sets its own
 * sender settings, so nothing depends on the developer's environment.
 */
function render(renders: Render[]): Rendered[] {
  const jobs = renders.map(({ kind, options = {}, env = {} }) => ({ kind, options, env: { ...DEFAULT_ENV, ...env } }));
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--eval', `
    const { loadServerModule } = require('./src/test/load-server-module.ts');
    const { prepareAppointmentEmail } = loadServerModule('src/app/services/email-service.ts', { 'server-only': {} });
    const appointment = { id: 'cmappt123', date: new Date('2099-09-14T12:00:00Z'), user: { email: 'customer@example.com', name: 'Amy' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } };
    const base = { oldDate: new Date('2099-09-13T12:00:00Z'), sequence: 4, now: new Date('2099-09-10T08:00:00Z'), salonPhone: '0113 000 0000' };
    (async () => {
      const result = [];
      for (const job of ${JSON.stringify(jobs)}) {
        for (const [key, value] of Object.entries(job.env)) {
          if (value === null) delete process.env[key]; else process.env[key] = value;
        }
        const email = await prepareAppointmentEmail(job.kind, appointment, { ...base, ...job.options }, 'en-GB');
        result.push({ html: email.html, text: email.text, attachments: email.attachments ?? null });
      }
      process.stdout.write(JSON.stringify(result));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output.toString());
}

function renderKinds(kinds: string[], options: Record<string, unknown> = {}): Record<string, Rendered> {
  const rendered = render(kinds.map((kind) => ({ kind, options })));
  return Object.fromEntries(kinds.map((kind, index) => [kind, rendered[index]]));
}

const decode = (attachment: { content: string }) => Buffer.from(attachment.content, 'base64').toString('utf8').replace(/\r\n /g, '');
const SENDER_ORGANIZER = 'ORGANIZER;CN="Harbour Hair Salon":mailto:booking@example.com';

test('confirmed-time mail shows Add to Google Calendar and attaches a PUBLISH .ics', () => {
  const emails = renderKinds(['CONFIRMATION', 'RESCHEDULE', 'REMINDER']);
  for (const [kind, email] of Object.entries(emails)) {
    assert.ok(email.html.includes('https://calendar.google.com/calendar/render?action=TEMPLATE'), `${kind} HTML link`);
    assert.ok(email.html.includes('Add to Google Calendar'), kind);
    assert.ok(email.text.includes('Add to Google Calendar: https://calendar.google.com/calendar/render?action=TEMPLATE&'), `${kind} plain text`);
    assert.equal(email.attachments?.length, 1, kind);
    const [file] = email.attachments!;
    assert.equal(file.filename, 'harbour-hair-2099-09-14.ics');
    // RFC 5545 §3.7.2: a file with METHOD travels with the same method on its MIME type.
    assert.equal(file.content_type, 'text/calendar; charset=utf-8; method=PUBLISH');
    const ics = decode(file);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/);
    assert.match(ics, /\r\nUID:appointment-cmappt123@harbourhair\.co\.uk\r\n/);
    assert.match(ics, /\r\nSEQUENCE:4\r\n/);
    assert.match(ics, /\r\nDTSTAMP:20990910T080000Z\r\n/);
    assert.match(ics, /\r\nDTSTART:20990914T120000Z\r\nDTEND:20990914T130000Z\r\n/);
    assert.ok(ics.includes(`\r\n${SENDER_ORGANIZER}\r\n`), `${kind}: RFC 5546 requires an ORGANIZER on PUBLISH`);
  }
});

test('a cancellation attaches a CANCEL .ics for the same entry and offers no add link; a request attaches nothing', () => {
  const emails = renderKinds(['CANCELLATION', 'REQUEST_RECEIVED']);
  const cancel = emails.CANCELLATION;
  assert.ok(!cancel.html.includes('calendar.google.com'));
  // Not every calendar app honours METHOD:CANCEL, so the email never promises it.
  assert.ok(cancel.text.includes('If you added this appointment to your calendar, please delete it — opening the attached file (.ics) may do this for you.'));
  const [file] = cancel.attachments!;
  assert.equal(file.content_type, 'text/calendar; charset=utf-8; method=CANCEL');
  const ics = decode(file);
  assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
  assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(ics, /\r\nUID:appointment-cmappt123@harbourhair\.co\.uk\r\n/);
  assert.ok(ics.includes(`\r\n${SENDER_ORGANIZER}\r\n`), 'RFC 5546 requires an ORGANIZER on CANCEL');
  const request = emails.REQUEST_RECEIVED;
  assert.equal(request.attachments, null, 'a pending request is not in anyone\'s calendar yet');
  assert.ok(!request.html.includes('calendar.google.com'));
  assert.ok(!request.text.includes('.ics'));
});

test('cancelling a request that was never confirmed attaches nothing and says nothing about a calendar', () => {
  const { CANCELLATION: email } = renderKinds(['CANCELLATION'], { wasConfirmed: false });
  assert.equal(email.attachments, null, 'it was never in the customer\'s calendar');
  assert.ok(!email.text.includes('If you added this appointment to your calendar'));
  assert.ok(!email.text.includes('.ics'));
  assert.ok(!email.html.includes('.ics'));
});

test('the organizer is the salon at the reply-to mailbox, else at the sender; omitted when neither is an address', () => {
  const cases: { env: SenderEnv; organizer: string | null }[] = [
    { env: { EMAIL_REPLY_TO: 'Harbour Hair <hello@harbourhair.co.uk>' }, organizer: 'mailto:hello@harbourhair.co.uk' },
    { env: { EMAIL_REPLY_TO: 'hello@harbourhair.co.uk' }, organizer: 'mailto:hello@harbourhair.co.uk' },
    { env: { EMAIL_REPLY_TO: 'not an address' }, organizer: 'mailto:booking@example.com' },
    { env: { EMAIL_FROM: 'bookings@harbourhair.co.uk' }, organizer: 'mailto:bookings@harbourhair.co.uk' },
    { env: { EMAIL_FROM: 'Harbour Hair Salon', EMAIL_REPLY_TO: 'nobody' }, organizer: null },
  ];
  const rendered = render(cases.map(({ env }) => ({ kind: 'CONFIRMATION', env })));
  cases.forEach(({ env, organizer }, index) => {
    const [file] = rendered[index].attachments!;
    const lines = decode(file).split('\r\n').filter((line) => line.startsWith('ORGANIZER'));
    assert.deepEqual(lines, organizer ? [`ORGANIZER;CN="Harbour Hair Salon":${organizer}`] : [], JSON.stringify(env));
    assert.equal(file.content_type, 'text/calendar; charset=utf-8; method=PUBLISH', 'the file is still attached');
  });
});

test('the attachment travels in the frozen request body sent to Resend', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-only-key';
  const email = {
    from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>',
    attachments: [{ filename: 'harbour-hair-2099-09-14.ics', content: Buffer.from('BEGIN:VCALENDAR\r\n').toString('base64'), content_type: 'text/calendar; charset=utf-8; method=PUBLISH' }],
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
