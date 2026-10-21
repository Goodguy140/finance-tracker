import type { NextConfig } from "next";
import { BACKUP_REQUEST_LIMIT_BYTES } from "./src/lib/backup-limits";

const isDev = process.env.NODE_ENV !== "production";

/**
 * The Plaid Link policy, sent **report-only** to begin with, as the note that used to sit
 * here promised.
 *
 * Link loads its script from cdn.plaid.com, renders in an iframe from the same host,
 * injects its own inline styles into the parent document, and talks to *.plaid.com. OAuth
 * institutions navigate out to *.plaid.com and post back, hence `form-action`.
 *
 * Report-only rather than enforcing on day one because a CSP that blocks Link fails
 * *silently* from the user's point of view — the button simply does nothing. Collect
 * violations from a real release first, then promote this to the enforcing header.
 *
 * Two deliberate weaknesses, both worth revisiting separately:
 *  - `script-src 'unsafe-inline'`: the alternative is the nonce pattern, which forces
 *    dynamic rendering on every route. `/` is already force-dynamic but not everything is,
 *    and that change does not belong in the same release as a payments integration.
 *  - `style-src 'unsafe-inline'`: unavoidable regardless — Tailwind v4 and Next both
 *    inject inline styles, and Link injects its own into this document.
 *
 * No `report-uri`: on a self-hosted deployment the browser console is the right level, and
 * a reporting endpoint would be a new unauthenticated write route for no benefit.
 */
const plaidCspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.plaid.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.plaid.com",
  "frame-src 'self' https://cdn.plaid.com https://*.plaid.com",
  "form-action 'self' https://*.plaid.com",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Response headers applied to every route.
 *
 * The enforcing `Content-Security-Policy` stays limited to `frame-ancestors` until the
 * report-only policy above has been through a release without violations.
 */
const securityHeaders = [
  // Clickjacking. `frame-ancestors` is the modern control; X-Frame-Options covers
  // older agents. Revisit only if this app is ever legitimately embedded.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: plaidCspReportOnly },
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
  // Never trace secrets or data into .next/standalone. A dynamic path in server code makes
  // Turbopack trace the whole project, which copied a local .env and prisma/dev.db into the
  // build output; admin-runtime-metrics.ts now opts out with turbopackIgnore, and this keeps
  // the next such call from doing the same.
  outputFileTracingExcludes: {
    "/*": [".env*", "**/*.db", "**/*.db-journal", "**/*.db-wal", "**/*.db-shm", ".data/**"],
  },
  poweredByHeader: false,
  // Keep Prisma out of the Turbopack server bundle so the client always matches
  // `schema.prisma` (avoids stale embedded enums after `prisma generate`).
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    // Restoring a backup posts the whole file to a Server Action; the 1 MB default refused
    // backups of a few years' history. The proxy buffers bodies too, and truncates past its
    // own limit, so it has to allow the same size. See src/lib/backup-limits.ts.
    serverActions: { bodySizeLimit: BACKUP_REQUEST_LIMIT_BYTES },
    proxyClientMaxBodySize: BACKUP_REQUEST_LIMIT_BYTES,
  },
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
      {
        // Always revalidated, so a new worker reaches devices on their next visit instead
        // of whenever an intermediate cache lets go of the old one.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
