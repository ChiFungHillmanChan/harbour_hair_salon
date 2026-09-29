# Vercel Firewall custom rules

Rules here are applied to the **project firewall** (Vercel dashboard → Firewall),
not deployed with the code. Custom rules and the traffic they deny are free
(Vercel WAF pricing); rate-limit rules are usage-billed, so there are none.

## `block-scanner-probes.json`

Denies WordPress, server-script (`.php`, `.asp`, `.jsp`, `.cgi`), PHP-info and
secret-dotfile (`.env`, `.git`, …) probes — real traffic seen in the production
404 log in September 2026, each of which used to run a function. `/.well-known/*`
stays open. `src/app/lib/vercel-firewall-rules.test.ts` pins that every page, API
route and asset the site serves stays reachable; run it after any edit.

Apply (stages a draft, then publishes it live — takes effect within seconds):

```bash
npx vercel firewall rules add --json "$(cat infra/vercel-firewall/block-scanner-probes.json)" --yes
npx vercel firewall diff
npx vercel firewall publish --yes
```

Roll back: `npx vercel firewall rules remove "Block vulnerability-scanner probes" --yes`
then `npx vercel firewall publish --yes`, or restore an earlier version from
Firewall → View Audit Log in the dashboard.

After applying, check production: a probe (`/.env`) must answer `403` with
`x-vercel-mitigated: deny`; `/`, `/services` and a stylist's `/api/ical/…` feed
must answer exactly as before, with no `x-vercel-mitigated` header.

**Do not move these into `vercel.json` `routes` + `mitigate`.** Tried on
2026-09-29 (PR #55's first commit): that deployment answered EVERY request —
real pages included — with a `403 x-vercel-mitigated: challenge` security
checkpoint, while an identical deployment without the routes answered normally.
A browser passes that challenge; Fresha's and Treatwell's servers polling the
iCal feeds cannot, so calendar sync would have stopped silently.
