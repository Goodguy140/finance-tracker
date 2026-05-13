/**
 * Playwright webServer entry: migrated SQLite DB, production build, then Next standalone.
 * `next start` is not supported with `output: "standalone"`; standalone also `chdir`s
 * into `.next/standalone`, so DATABASE_URL must be an absolute `file:` URL.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
process.chdir(root);

function absolutizeSqliteUrl(url, cwd) {
  const t = String(url).trim();
  if (!t.startsWith("file:")) return t;
  const rest = t.slice("file:".length);
  if (rest.startsWith("/") && !rest.startsWith("//")) return t.replace(/\\/g, "/");
  if (rest.startsWith("//")) return t.replace(/\\/g, "/");
  return `file:${path.resolve(cwd, rest)}`.replace(/\\/g, "/");
}

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = `file:${path.join(root, ".data", "e2e.db")}`.replace(/\\/g, "/");
} else {
  process.env.DATABASE_URL = absolutizeSqliteUrl(process.env.DATABASE_URL, root);
}

const { fileURLToPath } = require("url");
let e2eDbPath = null;
try {
  e2eDbPath = fileURLToPath(new URL(process.env.DATABASE_URL));
} catch {
  // non-URL datasource; skip targeted reset
}
if (e2eDbPath && fs.existsSync(e2eDbPath)) {
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
