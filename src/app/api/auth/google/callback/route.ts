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
  readGoogleStateLocale,
  verifyGoogleIdToken,
} from '@/app/lib/google-oauth';
import { postSignInPath } from '@/app/lib/post-auth-redirect';
import type { Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import { getRequestLocale } from '@/i18n/request';

export const runtime = 'nodejs';

function signInError(request: NextRequest, code: string, locale: Locale) {
  const response = NextResponse.redirect(new URL(localizeHref(locale, `/auth/signin?error=${code}`), request.url));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
    ...getGoogleOAuthStateCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  // This URL is registered with Google and stays language-free; the language
  // of the page the visitor started on comes back in our signed state cookie
  // (falling back to the remembered manual choice, then English).
  const locale = (await readGoogleStateLocale(request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value))
    ?? await getRequestLocale();

  if (request.nextUrl.searchParams.get('error')) {
    return signInError(request, 'google_cancelled', locale);
  }

  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return signInError(request, 'google_failed', locale);

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
    const destination = postSignInPath(state.locale ?? locale, state.redirectTo, user.role);
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
      ...getGoogleOAuthStateCookieOptions(),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return signInError(request, 'google_already_linked', locale);
    }
    return signInError(request, 'google_failed', locale);
  }
}
