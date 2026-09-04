import { getMigrationHealth } from "@/lib/migration-health";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

/**
 * GET /api/health
 *
 * This route is excluded from the session gate in `src/proxy.ts` so container health
 * checks can reach it, which means anonymous callers reach it too. They now get liveness
 * and nothing else: the detailed payload named missing schema columns, reported whether
 * each OAuth provider's config decrypts, and leaked the repair-script version — a free
 * map of the deployment. Server admins still get the full picture, here and on the admin
 * panel that reads the same helper.
 *
 * The status code stays 200 for any reachable instance, unchanged, so existing container
 * health checks keep their current behaviour; `ok` carries the degraded signal.
 */
export async function GET() {
  const health = await getMigrationHealth(prisma);
  const schemaOk = health.schema.status === "ok" || health.schema.status === "skipped";

  const session = await getCurrentSession();
  if (session?.user?.role !== "SERVER_ADMIN") {
    return Response.json({ ok: true });
  }

  return Response.json({
    ok: true,
    schema: {
      ok: schemaOk,
      status: health.schema.status,
      missing: health.schema.missing,
    },
    oauth: {
      readable: health.oauth.allReadable,
      google: health.oauth.google,
      authentik: health.oauth.authentik,
    },
    repair: {
      ran: health.repair.ran,
      lastAt: health.repair.lastAt,
      version: health.repair.version,
    },
  });
}
