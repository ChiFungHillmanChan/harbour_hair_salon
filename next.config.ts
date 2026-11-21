import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// React dev mode uses eval() for better debugging (callstack reconstruction, etc.).
// Prod keeps the strict CSP — eval is only allowed when running `next dev`.
const scriptSrcEval = isDev ? " 'unsafe-eval'" : '';

// Square Web Payments SDK, from Square's CSP guide (deposit design,
// docs/superpowers/specs/2026-10-13-square-deposits-design.md): its script,
// card-field frames and styles come from these CDNs. The sandbox acceptance
// run on 14 October 2026 also observed the 3-D Secure API frame and Cash Sans
// fonts (readme/square-acceptance-2026-10-14.md). API calls are already covered
// by connect-src, which allows https:.
const squareSdk = 'https://web.squarecdn.com https://sandbox.web.squarecdn.com';
// The bank's own 3-D Secure pages. Square's SDK adds the challenge frame (and
// the hidden "3DS method" frame) to THIS document and posts into it at the
// card issuer's address, so our frame-src decides whether the bank can ask
// the customer at all. Issuers' hosts cannot be listed in advance (Square:
// "allow all sources in the frame-src directive"). The sandbox's challenge
// lives on api.squareupsandbox.com, which is why acceptance passed; in
// production a card whose bank asked was refused before reaching us
// (customer report 2026-11-19). Site-wide, not just /book: a soft navigation
// to /book keeps the policy of the page the visit started on.
const bankChallengeFrames = 'https:';
const squareFonts = 'https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://cash-f.squarecdn.com';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${scriptSrcEval} https://www.googletagmanager.com https://www.google-analytics.com https://cdn.jsdelivr.net ${squareSdk}`,
  `script-src-elem 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://cdn.jsdelivr.net ${squareSdk}`,
  `style-src 'self' 'unsafe-inline' ${squareSdk}`,
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  `font-src 'self' data: ${squareFonts}`,
  "connect-src 'self' https:",
  `frame-src 'self' ${bankChallengeFrames}`,
  "worker-src 'self' blob:",
].join('; ') + ';';

const nextConfig: NextConfig = {
  // node-ical is a CommonJS Node library with dynamic requires (timezone data,
  // BigInt usage); webpack-bundling it breaks at build/runtime ("h.BigInt is not
  // a function"). Load it as a real external module instead.
  serverExternalPackages: ['node-ical'],
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    // No remotePatterns, deliberately: the optimizer only serves files from
    // public/. A remote pattern let anyone have us optimise any image on that
    // host (each one a billed transformation, uncapped). Remote images render
    // as plain <img> — see components/blog/BlogCoverImage.tsx.
  },
  headers: async () => [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Content-Security-Policy', value: csp },
    ],
  }, {
    // Only the public walkthrough may be embedded, and only on our own origin.
    source: '/harbour-hair-3d.html',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: `${csp} frame-ancestors 'self';` },
      { key: 'X-Robots-Tag', value: 'noindex' },
    ],
  }],
};

export default nextConfig;
