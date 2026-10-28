export async function register() {
  if (process.env.NODE_ENV === "development" && !process.env.VERCEL) {
    // NextAuth's detect-origin uses ONLY NEXTAUTH_URL when both VERCEL and AUTH_TRUST_HOST are unset
    // (see next-auth/utils/detect-origin.js). That breaks email/password sign-in whenever the browser
    // host (e.g. http://127.0.0.1:3000) does not match NEXTAUTH_URL from .env. Default trust-host in dev
    // so the incoming Host / forwarded proto drive auth URLs and cookies. Override explicitly if needed.
    if (process.env.AUTH_TRUST_HOST == null) {
      process.env.AUTH_TRUST_HOST = "true";
    }
  }

  // The sweeps need Prisma, which only exists in the Node runtime; the dynamic imports
  // keep them out of the edge bundle this file is also compiled into.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRecurringAutoPostScheduler } = await import("@/lib/recurring-auto-post-scheduler");
    startRecurringAutoPostScheduler();

    const { startPlaidSyncScheduler } = await import("@/lib/plaid-sync-scheduler");
    startPlaidSyncScheduler();

    const { startEmailDigestScheduler } = await import("@/lib/email-digest-scheduler");
    startEmailDigestScheduler();

    const { startDatabaseBackupScheduler } = await import("@/lib/database-backup-scheduler");
    startDatabaseBackupScheduler();
  }
}
