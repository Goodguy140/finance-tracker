/**
 * Which SQLite file the browser tests run against. Shared by playwright.config.ts (test
 * workers) and scripts/e2e-server.cjs (which deletes and recreates it before every run).
 *
 * Read from E2E_DATABASE_URL, never DATABASE_URL: a developer whose shell or editor exports
 * DATABASE_URL from `.env` would otherwise have the launcher delete their real database.
 * Whatever the source, the file must sit inside `.data/` at the repo root, so no setting can
 * point the delete anywhere else.
 */
const path = require("path");
const { fileURLToPath } = require("url");

function e2eDataDir(root) {
  return path.join(root, ".data");
}

/**
 * Returns `{ url, filePath }` for the E2E database, or throws if the configured URL is not a
 * SQLite file inside `<root>/.data/`. `url` is absolute, because the standalone server
 * `chdir`s into `.next/standalone` and would resolve a relative one somewhere else.
 */
function resolveE2eDatabase(root, env = process.env) {
  const dataDir = e2eDataDir(root);
  const raw = env.E2E_DATABASE_URL?.trim();
  let filePath;
  if (!raw) {
    filePath = path.join(dataDir, "e2e.db");
  } else {
    if (!raw.startsWith("file:")) {
      throw new Error(`E2E_DATABASE_URL must be a SQLite file: URL, got ${JSON.stringify(raw)}`);
    }
    const rest = raw.slice("file:".length).split("?")[0];
    if (rest.startsWith("//")) {
      filePath = fileURLToPath(new URL(raw.split("?")[0]));
    } else {
      filePath = path.resolve(root, rest);
    }
  }
  const relative = path.relative(dataDir, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `E2E_DATABASE_URL must name a file inside ${dataDir} (the launcher deletes it before ` +
        `every run); got ${filePath}`,
    );
  }
  // Plain path, not percent-encoded: Prisma reads `file:` URLs literally.
  return { url: `file:${filePath.replace(/\\/g, "/")}`, filePath };
}

module.exports = { resolveE2eDatabase, e2eDataDir };
