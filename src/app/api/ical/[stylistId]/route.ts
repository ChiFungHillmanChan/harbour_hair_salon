import { NextRequest, NextResponse } from 'next/server';
import { buildStylistIcalFeed } from '@/app/services/stylist-ical-feed';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stylistId: string }> },
) {
  const { stylistId } = await params;
  const token = request.nextUrl.searchParams.get('token') ?? '';

  const result = await buildStylistIcalFeed(stylistId, token);
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
