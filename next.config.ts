import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Prisma out of the Turbopack server bundle so the client always matches
  // `schema.prisma` (avoids stale embedded enums like BillingCycle after `prisma generate`).
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
