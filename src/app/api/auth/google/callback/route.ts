import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { createSession } from '@/app/lib/session';
import {
  exchangeGoogleCode,
  getGoogleOAuthStateCookieOptions,
  getGoogleCallbackUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
  readGoogleState,
  verifyGoogleIdToken,
} from '@/app/lib/google-oauth';

export const runtime = 'nodejs';

function signInError(request: NextRequest, code: string) {
  const response = NextResponse.redirect(new URL(`/auth/signin?error=${code}`, request.url));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
    ...getGoogleOAuthStateCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('error')) {
    return signInError(request, 'google_cancelled');
  }

  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return signInError(request, 'google_failed');

    const state = await readGoogleState(
      request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value,
      request.nextUrl.searchParams.get('state')
    );
    const idToken = await exchangeGoogleCode(
      code,
      state.codeVerifier,
      getGoogleCallbackUrl(request.nextUrl.origin)
    );
    const profile = await verifyGoogleIdToken(idToken, state.nonce);

    const user = await prisma.$transaction(async (tx) => {
      const linkedAccount = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: profile.id,
          },
        },
        include: { user: true },
      });
      if (linkedAccount) return linkedAccount.user;

      let matchedUser = await tx.user.findUnique({ where: { email: profile.email } });
      if (!matchedUser) {
        matchedUser = await tx.user.create({
          data: { email: profile.email, name: profile.name, role: 'USER' },
        });
      } else if (!matchedUser.name && profile.name) {
        matchedUser = await tx.user.update({
          where: { id: matchedUser.id },
          data: { name: profile.name },
        });
      }

      await tx.oAuthAccount.create({
        data: {
          provider: 'google',
          providerAccountId: profile.id,
          userId: matchedUser.id,
        },
      });
      return matchedUser;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await createSession(user.id, user.role, user.sessionVersion);
    const destination = user.role === 'ADMIN' ? '/admin' : state.redirectTo;
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
      ...getGoogleOAuthStateCookieOptions(),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return signInError(request, 'google_already_linked');
    }
    return signInError(request, 'google_failed');
  }
}
