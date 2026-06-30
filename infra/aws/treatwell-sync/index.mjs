// AWS Lambda (Node 20 runtime — global fetch available).
// Triggered by EventBridge Scheduler; pings the Vercel route that does the work.
// The DB is never touched here — the Next.js route writes to Neon (harbour-hair-db).
export const handler = async () => {
  const url = process.env.SYNC_URL; // https://<your-domain>/api/cron/treatwell-sync
  const secret = process.env.CRON_SECRET; // same value as the Vercel env var

  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Treatwell sync failed: HTTP ${res.status} ${body}`);

  console.log('Treatwell sync ok:', body);
  return { statusCode: res.status, body };
};
