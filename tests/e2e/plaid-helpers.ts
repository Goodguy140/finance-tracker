import { prisma } from "../../src/lib/prisma";
import { encryptSecret } from "../../src/lib/security";

/**
 * Turns Plaid on for the suite.
 *
 * One shared implementation on purpose. The `plaid.*` rows are **global server settings,
 * not per-user**, so every spec that touches Plaid shares them: three separate copies of
 * this had drifted apart, and a fourth that *deleted* the rows to test the "not
 * configured" path reproducibly broke the two specs that need Plaid on.
 *
 * Upsert only, never delete. If you need to assert unconfigured behaviour, do it in a unit
 * test against `getPlaidConfig`, not here — there is no way to unconfigure a global row
 * without breaking whatever else is mid-run.
 */
export async function configurePlaidForTests(): Promise<void> {
  for (const [key, value] of [
    ["plaid.enabled", "true"],
    ["plaid.clientId", "e2e-client-id"],
    ["plaid.secret", "e2e-secret"],
    ["plaid.env", "sandbox"],
  ]) {
    await prisma.serverSetting.upsert({
      where: { key },
      create: { key, encryptedValue: encryptSecret(value) },
      update: { encryptedValue: encryptSecret(value) },
    });
  }
}
