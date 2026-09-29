import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { createSession } from '@/app/lib/session';
import { appendAuditEvent } from '@/app/lib/audit';
import {
  decideGoogleLink,
  exchangeGoogleCode,
  getGoogleOAuthStateCookieOptions,
  getGoogleCallbackUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
  readGoogleState,
  readGoogleStateLocale,
  verifyGoogleIdToken,
  type GoogleSignInRefusal,
} from '@/app/lib/google-oauth';
import { postSignInPath } from '@/app/lib/post-auth-redirect';
import type { Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import { getRequestLocale } from '@/i18n/request';

export const runtime = 'nodejs';

/** A first Google sign-in that decideGoogleLink will not allow. Rolls the transaction back. */
class GoogleSignInRefused extends Error {
  readonly code: GoogleSignInRefusal;
  /** The existing account the attempt matched, when there was one. */
  readonly targetUserId: string | null;
  constructor(code: GoogleSignInRefusal, targetUserId: string | null) {
    super(code);
    this.name = 'GoogleSignInRefused';
    this.code = code;
    this.targetUserId = targetUserId;
  }
}

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
      const decision = decideGoogleLink(
        profile,
        matchedUser ? { role: matchedUser.role, hasPassword: matchedUser.password !== null } : null,
      );
      if (decision.kind === 'REFUSE') throw new GoogleSignInRefused(decision.code, matchedUser?.id ?? null);

      if (!matchedUser) {
        matchedUser = await tx.user.create({
          data: { email: profile.email, name: profile.name, role: 'USER' },
        });
      } else if (decision.kind === 'LINK') {
        // Linking Google to an existing customer. If that row already has a
        // password, it may have been planted by an attacker who pre-registered
        // this address to hijack it — Google, authoritative for the address, has
        // just verified it belongs to the person signing in, so DESTROY the
        // pre-set credential, any reset link issued for it, and bump
        // sessionVersion (revoking any session the attacker holds). Also fill in
        // a missing display name. Without this, the attacker's password kept working.
        const needsNameFill = !matchedUser.name && !!profile.name;
        if (decision.clearPassword || needsNameFill) {
          matchedUser = await tx.user.update({
            where: { id: matchedUser.id },
            data: {
              ...(needsNameFill ? { name: profile.name } : {}),
              ...(decision.clearPassword ? { password: null, sessionVersion: { increment: 1 } } : {}),
            },
          });
        }
        if (decision.clearPassword) {
          await tx.passwordResetToken.deleteMany({ where: { userId: matchedUser.id, usedAt: null } });
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
    if (error instanceof GoogleSignInRefused) {
      // Expected policy outcome, not a fault: no stack trace, no identifiers.
      console.warn('Google sign-in refused:', error.code);
      if (error.targetUserId) {
        // Leave a trace on the account someone tried to reach through Google.
        // Best effort: the refusal stands even if the log write fails.
        await appendAuditEvent({ action: 'AUTH.GOOGLE_LINK_REFUSED', targetType: 'User', targetId: error.targetUserId, metadata: { reason: error.code } })
          .catch((auditError) => console.error('Could not record refused Google sign-in:', auditError));
      }
      return signInError(request, error.code, locale);
    }
    console.error('Google OAuth callback failed:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return signInError(request, 'google_already_linked', locale);
    }
    return signInError(request, 'google_failed', locale);
  }
}
