# Customer data erasure (UK GDPR right to erasure)

How to honour a customer's request to delete their personal data. The tool is
**Admin → Users → "Erase a customer's personal data"** (server action
`eraseCustomerData` in `src/app/actions/admin-erasure.ts`).

## Deadline

Answer within **one month** of receiving the request (the ICO allows two more
months only for complex or numerous requests, and you must tell the customer
within the first month). No fee. ICO guidance:
<https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/>

## Procedure

1. **Check it is really them.** Reply to the email address on file, or call the
   phone number on file. Do not erase on a request you cannot link to the account.
2. **Cancel their upcoming bookings first** (Schedule → open the booking →
   Cancel booking). The tool refuses while any PENDING or CONFIRMED booking is
   still ahead, so no appointment is left with no way to reach the customer.
3. **Erase:** Admin → Users → search their name, email or phone → **Erase data**
   → type their email address (or `ERASE` for a phone booking with no email) →
   OK. A typo erases nothing.
4. If the message says the address could **not be removed from the marketing
   list**, remove it by hand in Resend (Audiences → the salon's audience).
5. **Erase the copies the website cannot reach** (see "Outside this tool").
6. **Record it** (see "Record").

## What the tool does (one database transaction)

| Data | Result |
|---|---|
| Name | `Erased customer` |
| Email | `erased-<id>@erased.invalid` — undeliverable; nothing is ever queued for it again. The real address is free, so the person can register again as a new customer. |
| Phone, email-verified date, language | Cleared |
| Password | Replaced by the hash of a random secret nobody holds |
| Sessions | Ended (session version bumped) |
| Google sign-in link, password-reset links | Deleted (email-verification links are signed for the old address, so they stop working) |
| MFA secrets / recovery codes | Cleared (customers do not normally have them) |
| Notes and email language on their appointments | Cleared |
| Queued and sent email copies (notification outbox) | Unsent mail is cancelled (`SKIPPED`); every stored copy is emptied (`{}`) |
| Resend marketing audience | Contact removed, if `RESEND_AUDIENCE_ID` is configured |
| Audit trail | `USER.ERASED` event: who, when, which account id, and counts only |

It refuses: administrator accounts, your own account, an account already
erased, and customers with upcoming PENDING/CONFIRMED bookings.

## What is kept, and why

(Their reviews are deleted, not kept: the privacy notice keeps a review only
while the account is open, and review text plus the visit details can identify
someone.)

- **The account row itself, anonymised.** Every appointment points to it;
  deleting it would cascade-delete the salon's appointment history.
- **Appointments** (date, service, stylist, duration, price, status). These are
  the salon's business records (takings, stylist pay, disputes), now linked to
  "Erased customer" instead of a person.
- **Payment records** (`PaymentAttempt` / `PaymentRefund`: deposit amounts, status, dates and
  Square's references) — accounting records the salon must keep (privacy notice: up to 6 years
  after the payment). They hold no name, email or card details of their own and stay linked to
  the anonymised account.
- **Consultation credit** (`Appointment.consultationCreditPence` and `consultationCreditFromId`: an
  amount and a link to another appointment). They hold no personal data of their own, so erasure
  leaves them with the appointment records they belong to.
- **Delivery log rows** (email type, status, times) without any content.
- **Audit events** — they never contain personal data.

## Outside this tool (do these by hand)

- **Preview database** (Neon project `harbour-hair-preview-lhr`): it is a copy of
  production taken 2026-09-30 **with real customer data**. Run the same erasure
  on the preview deployment, or refresh the preview copy from production after
  erasing.
- **Fresha / Treatwell**: if they booked through a marketplace, delete them from
  that platform's client list too. Imported busy blocks can carry Fresha event
  titles; they are not linked to the account and housekeeping deletes them 30
  days after the event.
- **Square**: a customer who paid a deposit also appears in the salon's Square account (the
  payment with the card's brand and last digits, and possibly the name and email sent with the
  card for verification). Square keeps payment records under its own legal duties; ask Square
  support what it can erase, and tell the customer that Square holds that copy under its own
  privacy notice.
- **Mailboxes**: salon alert emails (`SALON_NOTIFY_EMAIL`) contain the
  customer's details — delete them. Resend keeps its own sent-email log for its
  retention period.
- **Anything else**: phone/WhatsApp contacts, paper notes, exported files.
- **Backups**: Neon's restore history ages out by itself. The pre-deploy
  snapshot branches (`predeploy-*`, made by the deploy workflow when
  `NEON_API_KEY` is set) are full copies of production; they are pruned after
  14 days (newest three at most). If production is ever restored from either —
  a point in time or a snapshot taken before an erasure — re-apply every
  erasure in the log.

## Record

Keep an erasure log **outside the website** with the salon's data-protection
records (for example a spreadsheet next to the client documents): date
received, how identity was checked, date completed, who did it, any copy that
could not be erased and why. Do not copy the erased data into the log — the
account id from the `USER.ERASED` entry (Admin → Operations → audit) is enough
to show it was done.
