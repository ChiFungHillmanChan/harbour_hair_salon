import { NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

// Never cache — a health check must reflect live dependency state.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Verify the database is actually reachable, not just that the app booted.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'healthy',
      database: 'up',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Health check failed — database unreachable:', error);
    return NextResponse.json(
      { status: 'degraded', database: 'down', timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
