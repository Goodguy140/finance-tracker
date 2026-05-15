import { getMigrationHealth } from "@/lib/migration-health";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const health = await getMigrationHealth(prisma);
  const schemaOk = health.schema.status === "ok" || health.schema.status === "skipped";

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
