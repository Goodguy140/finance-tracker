/**
 * Runs the Plaid sandbox contract check.
 *
 * Loads PLAID_* from .env (the app's own credentials), refuses to run against production,
 * and hands off to vitest. Separate from `npm test` on purpose: that suite must never
 * touch the network, and this one exists precisely to do so.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*(PLAID_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const environment = (process.env.PLAID_ENV || "sandbox").toLowerCase();
if (environment !== "sandbox") {
  console.error(
    `Refusing to run: PLAID_ENV is "${environment}". This check creates and removes an Item and ` +
      "assumes fabricated data, so it is sandbox-only.",
  );
  process.exit(1);
}
if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
  console.error(
    "Set PLAID_CLIENT_ID and PLAID_SECRET (sandbox credentials from the Plaid dashboard) in .env " +
      "or the environment first.",
  );
  process.exit(1);
}

process.env.PLAID_SANDBOX_VERIFY = "1";
console.log("Checking this app's assumptions against the real Plaid sandbox...\n");

execFileSync(
  "npx",
  ["vitest", "run", "src/lib/plaid/sandbox-contract.test.ts", "--reporter=verbose"],
  { cwd: root, stdio: "inherit", env: process.env },
);
