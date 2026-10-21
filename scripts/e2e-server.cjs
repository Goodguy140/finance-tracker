/**
 * Playwright webServer entry: migrated SQLite DB, production build, then Next standalone.
 * `next start` is not supported with `output: "standalone"`; standalone also `chdir`s
 * into `.next/standalone`, so DATABASE_URL must be an absolute `file:` URL.
 * The database comes from E2E_DATABASE_URL (see e2e-database.cjs), never DATABASE_URL.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolveE2eDatabase } = require("./e2e-database.cjs");

const root = path.join(__dirname, "..");
process.chdir(root);

// Resolves E2E_DATABASE_URL (default .data/e2e.db) and refuses anything outside .data/,
// because the file is deleted below. DATABASE_URL is overwritten, never read.
const { filePath: e2eDbPath, url: e2eDbUrl } = resolveE2eDatabase(root);
process.env.DATABASE_URL = e2eDbUrl;
if (fs.existsSync(e2eDbPath)) {
  fs.unlinkSync(e2eDbPath);
}

fs.mkdirSync(path.join(root, ".data"), { recursive: true });

// `migrate deploy` can leave a DB that claims migrations are applied while the
// schema is out of sync (e.g. historical drift). `db push` matches `schema.prisma`
// exactly — appropriate for a disposable E2E SQLite file.
execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], { stdio: "inherit", env: process.env });
execFileSync("npm", ["run", "build"], { stdio: "inherit", env: process.env });

const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(root, ".next", "standalone", ".next", "static");
if (!fs.existsSync(staticSrc)) {
  console.error("e2e-server: missing .next/static — run build failed?");
  process.exit(1);
}
fs.rmSync(staticDest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(staticDest), { recursive: true });
fs.cpSync(staticSrc, staticDest, { recursive: true });

const publicSrc = path.join(root, "public");
const publicDest = path.join(root, ".next", "standalone", "public");
if (fs.existsSync(publicSrc)) {
  fs.rmSync(publicDest, { recursive: true, force: true });
  fs.cpSync(publicSrc, publicDest, { recursive: true });
}

const serverJs = path.join(root, ".next", "standalone", "server.js");
if (!fs.existsSync(serverJs)) {
  console.error("e2e-server: missing .next/standalone/server.js");
  process.exit(1);
}

execFileSync(process.execPath, [serverJs], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: process.env.PORT || "3050",
    HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
  },
});
