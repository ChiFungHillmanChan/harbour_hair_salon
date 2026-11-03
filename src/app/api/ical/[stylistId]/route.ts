import { NextRequest, NextResponse } from 'next/server';
import { buildCachedStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { feedViewFromParam } from '@/app/services/stylist-ical-feed';

// The response still varies per request (the token is checked every time and
// `DTSTAMP`/"already ended" are re-evaluated), so the route stays dynamic. The
// saving is in the Data Cache behind it, not in the rendering — see
// stylist-ical-cache.ts for the polling numbers that made this necessary.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stylistId: string }> },
) {
  const { stylistId } = await params;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  // `&for=treatwell` is the URL Treatwell holds: it also carries Fresha's busy
  // time. Fresha keeps the plain URL, which never sends Fresha its own time back.
  const view = feedViewFromParam(request.nextUrl.searchParams.get('for'));

  const result = await buildCachedStylistIcalFeed(stylistId, token, new Date(), view);
  if (result.status !== 200) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(result.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
