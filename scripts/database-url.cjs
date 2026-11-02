/**
 * The database every start-up step opens: `DATABASE_URL`, or the default when it is unset.
 *
 * `prisma migrate deploy` (through prisma.config.ts), the schema repair script and the app
 * (src/lib/prisma.ts) all read it from here. They once had their own copies, and the repair
 * script's had no default at all, so a deployment that left `DATABASE_URL` unset migrated and
 * served `/data/app.db` but silently skipped the repair, WAL mode and the repair marker.
 *
 * A relative `file:` URL is resolved against the `prisma/` directory, not the repo root.
 */
const PRODUCTION_DATABASE_URL = "file:/data/app.db";
const DEVELOPMENT_DATABASE_URL = "file:./dev.db";

/** @param {Record<string, string | undefined>} [env] */
function resolveDatabaseUrl(env = process.env) {
  const configured = env.DATABASE_URL?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? PRODUCTION_DATABASE_URL : DEVELOPMENT_DATABASE_URL;
}

module.exports = { resolveDatabaseUrl, PRODUCTION_DATABASE_URL, DEVELOPMENT_DATABASE_URL };
