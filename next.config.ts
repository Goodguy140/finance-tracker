import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Prisma out of the Turbopack server bundle so the client always matches
  // `schema.prisma` (avoids stale embedded enums like BillingCycle after `prisma generate`).
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Allow tunnel/local dev hosts so client fetches (including NextAuth CSRF) are not blocked.
  allowedDevOrigins: ["127.0.0.1", "expenses.goodguy140.com"],
};

export default nextConfig;
