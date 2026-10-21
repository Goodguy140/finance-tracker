/**
 * `postbuild`: removes the `.env` files `next build` copies into `.next/standalone`.
 *
 * Next copies `.env` and `.env.production` there on purpose and has no setting to stop it, so
 * a build from a working checkout puts real secrets (NEXTAUTH_SECRET, Plaid keys) into a
 * folder that looks safe to copy or ship. Releases are Docker images built from a clean
 * checkout and get their settings from the container environment, so nothing needs them.
 */
const fs = require("fs");
const path = require("path");

function stripStandaloneEnv(standaloneDir) {
  if (!fs.existsSync(standaloneDir)) return [];
  const removed = [];
  for (const name of fs.readdirSync(standaloneDir)) {
    if (name === ".env" || name.startsWith(".env.")) {
      const file = path.join(standaloneDir, name);
      fs.rmSync(file, { force: true });
      removed.push(file);
    }
  }
  return removed;
}

if (require.main === module) {
  const dir = path.join(__dirname, "..", ".next", "standalone");
  for (const file of stripStandaloneEnv(dir)) {
    console.log(`strip-standalone-env: removed ${path.relative(process.cwd(), file)}`);
  }
}

module.exports = { stripStandaloneEnv };
