import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Keep Prisma out of the Turbopack server bundle so the client always matches
  // `schema.prisma` (avoids stale embedded enums like BillingCycle after `prisma generate`).
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Allow tunnel/local dev hosts so client fetches (including NextAuth CSRF) are not blocked.
  allowedDevOrigins:
    process.env.NODE_ENV === "production"
      ? undefined
      : ["127.0.0.1", "expenses.goodguy140.com", "beta.expenses.goodguy140.com"],
};

export default nextConfig;
