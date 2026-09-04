import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * `Content-Security-Policy` is deliberately absent for now: Plaid Link renders in an
 * iframe and loads its own scripts, so the policy is written alongside that integration
 * (report-only first) rather than guessed at here. Everything below is independent of it.
 */
const securityHeaders = [
  // Clickjacking. `frame-ancestors` is the modern control; X-Frame-Options covers
  // older agents. Revisit only if this app is ever legitimately embedded.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No route uses any of these; denying them shrinks what an injected script can reach.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// HSTS only in production: sending it from a local http:// dev server pins the browser
// to https for localhost and breaks every other project on the same origin.
const productionOnlyHeaders =
  process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : [];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Keep Prisma out of the Turbopack server bundle so the client always matches
  // `schema.prisma` (avoids stale embedded enums after `prisma generate`).
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Allow tunnel/local dev hosts so client fetches (including NextAuth CSRF) are not blocked.
  allowedDevOrigins:
    process.env.NODE_ENV === "production"
      ? undefined
      : ["127.0.0.1", "expenses.goodguy140.com", "beta.expenses.goodguy140.com"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, ...productionOnlyHeaders],
      },
    ];
  },
};

export default nextConfig;
