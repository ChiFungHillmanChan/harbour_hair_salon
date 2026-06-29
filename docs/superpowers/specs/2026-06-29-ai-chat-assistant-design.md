# Harbour Hair Salon — AI Chat Assistant (Design Spec)

**Date:** 2026-06-29
**Status:** Approved for planning

## 1. Purpose & Scope

A floating chat widget, present on every page, that acts as a narrowly-scoped
salon assistant. It does **exactly three things**:

1. **Answer questions about the salon** (services, prices, hours, location,
   policies, how to book).
2. **Help the user book** — either the on-site `/book` flow or external Treatwell.
3. **Hand off to the phone** for anything it cannot answer or anything off-topic.

It explicitly **refuses everything off-topic** and redirects back to the salon's
purpose. No general chit-chat, no coding help, no unrelated assistance.

### Non-goals (YAGNI)
- No conversation storage / transcripts / analytics persistence (zero DB changes).
- No authentication for the chat itself (must work for logged-out visitors).
- No multi-language support beyond the site's existing English.
- No streaming responses (single request/response is sufficient).
- No new third-party SDK — Gemini is called via plain `fetch`.

## 2. Interaction Modes

### Mode A — Guided options (default, no AI, $0 cost)
A button/option tree defined in JSON. The user taps through pre-defined nodes.
Deterministic, instant, and fully functional even if Gemini is unavailable.

Top-level options:
- **Services & prices**
- **Opening hours & location**
- **Book an appointment** → choose on-site `/book` or Treatwell
- **Contact / Call us**
- **Policies** (patch test, cancellation)

Each node has: `id`, a `message`, and a list of `options`. An option either:
- navigates to another node,
- triggers an **action** (open `/book`, open Treatwell, `tel:` call, open a page), or
- attaches one or more **reminders**.

### Mode B — Free text (Gemini)
If the user types a message, the client calls `POST /api/chat`. The server calls
Gemini with a strict system prompt grounded **only** in the salon knowledge, and
forces routing to Book/Contact or a refusal. The model returns **structured JSON**,
which is Zod-validated server-side before being returned to the client.

The model's job is limited to: (a) answer briefly from the knowledge, (b) pick an
intent, (c) suggest actions (Book / Treatwell / Call), (d) attach reminders.
Anything unknown / off-topic / low-confidence → the reply includes the salon
**phone number and a Call button**.

## 3. Knowledge (Hybrid: static JSON + live DB)

### Static JSON — `src/data/chatbot/salon-knowledge.json`
Hand-edited, version-controlled. Holds facts that do **not** live in the DB:
- Opening hours (currently hardcoded in `contact/page.tsx`:
  Mon–Fri 10:00–19:30, Sat/Sun 10:30–18:00).
- Location & directions (Unit 15 Central Arcade, Leeds LS1 6DX).
- Policies text (patch test ~48h, 24h cancel/reschedule, account needed to book).
- Persona / scope rules used to build the system prompt.
- Reminder snippets (see §4).
- The **option tree** for Mode A.

### Live DB merge — `buildKnowledgeContext()`
Reads at request/render time and merges into one serializable context object:
- **Services**: name, price, duration, category, `requiresPatchTest` — from
  `prisma.service`.
- **Phone, Treatwell URL, social links** — from `getSiteSettings()`.
- **FAQs** — from `getAllFaqs()` (used as grounding context for Gemini).

This context object is used **both** to render the option tree (live prices/phone)
and as the grounding context passed to Gemini. Prices and phone never go stale.

## 4. Reminders (all four surfaced contextually)

Stored as snippets in the JSON and attached to the relevant tree nodes; also
allowed in the AI's `reminders` output array.

1. **Account needed to book** — surfaced when steering to the on-site `/book` flow
   (booking is auth-gated; middleware redirects to signin).
2. **Patch test for colour** — for colour services, ~48h before (existing
   colour/patch-test gate; `requiresPatchTest` flag on `Service`).
3. **24h cancel/reschedule** — when relevant to booking/changes.
4. **Opening hours / arrive early** — when discussing a visit.

## 5. Architecture & Files

All units are small and single-purpose.

| File | Responsibility |
|---|---|
| `src/data/chatbot/salon-knowledge.json` | Static facts, persona/scope rules, reminder snippets, option tree |
| `src/app/lib/chatbot/knowledge.ts` | `buildKnowledgeContext()` (JSON + DB merge); shared TypeScript types |
| `src/app/lib/chatbot/schema.ts` | Zod schemas for the request body and the AI response object |
| `src/app/services/chatbot-service.ts` | `askGemini(message, history, context)` — `import 'server-only'`; calls Gemini via `fetch`; validates output; selects fallback |
| `src/app/api/chat/route.ts` | Public `POST` endpoint; per-IP rate limit; runtime env access; returns validated structured reply |
| `src/components/chatbot/ChatWidget.tsx` | Client widget: bubble button, panel, message list, option-tree renderer, text input |
| `src/components/chatbot/ChatWidgetServer.tsx` | Async server component: calls `buildKnowledgeContext()`, passes serializable props to `ChatWidget` |
| `src/app/layout.tsx` | Mounts `<ChatWidgetServer />` |

### Data flow
1. `layout.tsx` (server) renders `ChatWidgetServer` (async server component).
2. `ChatWidgetServer` calls `buildKnowledgeContext()` and passes the serializable
   knowledge + option tree to the client `ChatWidget` as props.
3. **Mode A:** option taps are resolved purely client-side against the tree — no
   network calls.
4. **Mode B:** typed messages `POST` to `/api/chat` with the message + short
   recent history. The route rate-limits, calls `askGemini()`, validates, and
   returns `{ reply, intent, actions, reminders }`.
5. The client renders `reply`, action buttons (Book / Treatwell / Call), and any
   reminder chips. Action buttons deep-link: Book → `/book`, Treatwell →
   `settings.treatwellUrl`, Call → `tel:<phone>`.

## 6. AI Response Contract (Zod-validated)

Request body:
```
{ message: string (1..500 chars), history: Array<{ role: 'user'|'assistant', content: string }> (capped, e.g. last 6) }
```

AI response (validated server-side; model is instructed to emit JSON):
```
{
  reply: string,                       // short, grounded answer
  intent: 'services' | 'booking' | 'hours' | 'location' | 'contact'
        | 'policy' | 'offtopic' | 'unknown',
  actions: Array<'book_onsite' | 'book_treatwell' | 'call' | 'view_services' | 'view_contact'>,
  reminders: Array<'account' | 'patch_test' | 'cancellation' | 'hours'>
}
```

If validation fails, or intent is `offtopic`/`unknown`, the server overrides
`reply` with a canned redirect that includes the phone number and forces a `call`
action.

## 7. Guardrails & Reliability

- **Scope enforcement:** strict system prompt restricts the model to the salon
  knowledge and the three allowed jobs; off-topic → canned redirect + phone.
- **Output validation:** Zod-validate every model response; never trust raw output.
- **Public but protected:** `/api/chat` stays outside the auth-protected prefixes
  so logged-out visitors can use it. Per-IP **rate limiting** reusing the app's
  existing Upstash pattern (`@upstash/ratelimit` is already a dependency);
  degrade gracefully (allow) if Upstash is not configured. Input length capped.
- **Runtime env access:** `GEMINI_API_KEY` and `GEMINI_MODEL` are read **inside**
  the route/service functions, never at module level (per CLAUDE.md).
- **Graceful fallback:** if Gemini errors or times out, return a friendly message
  ("I'm having trouble right now — please call us on {phone}") plus a Call action.
  Mode A (option tree) remains fully functional without the AI.
- **No secrets leaked:** the API key is only ever used server-side in the `fetch`
  call; nothing sensitive is sent to the client.

## 8. Environment Variables

- `GEMINI_API_KEY` — already present in `.env`. Used server-side only.
- `GEMINI_MODEL` — **new**, optional. Defaults to `gemini-3-flash`. Read at runtime.
- Upstash vars — reuse whatever the app already uses for rate limiting; optional.

## 9. Styling

- Tailwind CSS only. Primary brand color `#174F7F`.
- Floating bubble bottom-right, positioned so it does not collide with the existing
  `MobileBookBar` on mobile.
- Matches the site's existing visual language (serif headings, zinc palette, accent).

## 10. Testing

Local `pnpm build` fails on DB access, so verification is via `node --test` / `tsc`
/ `lint` (per project memory). Tests cover **pure logic**, mocking Gemini:

- `buildKnowledgeContext()` merge behaviour (static + DB facts combine correctly).
- Zod schema validation: valid passes; malformed/off-topic triggers the canned
  phone fallback.
- Option-tree resolver: navigating nodes, attaching reminders, resolving actions.
- Fallback selection when the AI errors.

The live Gemini `fetch` call is mocked in tests; we test the parsing, validation,
and fallback logic around it — not the external API.

## 11. Out of Scope / Future (not built now)
- Persisting transcripts or lead capture.
- Streaming token-by-token responses.
- Admin UI to edit the knowledge JSON (it is hand-edited for now).
- Booking *inside* the chat (the bot directs to the existing booking flows only).
