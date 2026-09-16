import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { createSession } from '@/app/lib/session';
import { appendAuditEvent } from '@/app/lib/audit';
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
      } else {
        // Linking Google to an existing row. If that row already has a password,
        // it may have been planted by an attacker who pre-registered this address
        // to hijack it — Google has just verified the address belongs to the
        // person signing in, so DESTROY the pre-set credential and bump
        // sessionVersion (revoking any session the attacker holds). Also fill in a
        // missing display name. Without this, the attacker's password kept working.
        const needsNameFill = !matchedUser.name && !!profile.name;
        const hasPassword = matchedUser.password !== null;
        if (hasPassword || needsNameFill) {
          matchedUser = await tx.user.update({
            where: { id: matchedUser.id },
            data: {
              ...(needsNameFill ? { name: profile.name } : {}),
              ...(hasPassword ? { password: null, sessionVersion: { increment: 1 } } : {}),
            },
          });
        }
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

    await appendAuditEvent({ actorUserId: user.id, action: 'AUTH.LOGIN', targetType: 'User', targetId: user.id, metadata: { method: 'google' } });
    // Google is the only factor for an admin too — see lib/session.ts.
    await createSession(user.id, user.role, user.sessionVersion, true);
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
