import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// React dev mode uses eval() for better debugging (callstack reconstruction, etc.).
// Prod keeps the strict CSP — eval is only allowed when running `next dev`.
const scriptSrcEval = isDev ? " 'unsafe-eval'" : '';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${scriptSrcEval} https://www.googletagmanager.com https://www.google-analytics.com https://cdn.jsdelivr.net`,
  "script-src-elem 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src https://www.google.com",
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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
    ],
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
  }],
};

export default nextConfig;
