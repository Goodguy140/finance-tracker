import { describe, expect, it } from "vitest";
import { createPlaidClient } from "@/lib/plaid/client";
import { PFC_TO_CATEGORY_NAMES } from "@/lib/plaid/category-map";
import { mapPlaidAmount, normalizePlaidTransaction } from "@/lib/plaid/ingest";
import type { PlaidApiTransaction } from "@/lib/plaid/types";

/**
 * Checks this app's assumptions against the **real** Plaid sandbox.
 *
 * Every other test in the suite runs against a fake that I wrote, which means they prove
 * the code agrees with my understanding of Plaid — not that my understanding is correct.
 * This is the only test that can catch the difference, and it is the reason the client is
 * hand-written rather than generated: nothing else keeps it honest.
 *
 * Skipped unless `PLAID_SANDBOX_VERIFY=1` and sandbox credentials are present, so a normal
 * `npm test` never touches the network. Run it with `npm run verify:plaid`.
 *
 * The sandbox is free, returns fabricated data, and never touches a real bank. The item it
 * creates is removed at the end so nothing is left behind.
 */

const clientId = process.env.PLAID_CLIENT_ID?.trim() ?? "";
const secret = process.env.PLAID_SECRET?.trim() ?? "";
const environment = (process.env.PLAID_ENV?.trim() || "sandbox").toLowerCase();

const enabled =
  process.env.PLAID_SANDBOX_VERIFY === "1" && Boolean(clientId) && Boolean(secret);

// Refuses to run against production: this creates and removes an Item, and the assertions
// below assume fabricated data.
const misconfigured = enabled && environment !== "sandbox";

/** Plaid's standard sandbox institution, which generates a few months of transactions. */
const SANDBOX_INSTITUTION = "ins_109508";
const DAYS_REQUESTED = 30;

describe.skipIf(!enabled)("Plaid sandbox contract", () => {
  it("is pointed at the sandbox", () => {
    expect(misconfigured, "refusing to run the contract check against production Plaid").toBe(
      false,
    );
  });

  it("matches what this app assumes about Plaid", async () => {
    const client = createPlaidClient({ clientId, secret, environment: "sandbox" });
    const notes: string[] = [];

    const { public_token } = await client.sandboxCreatePublicToken({
      institutionId: SANDBOX_INSTITUTION,
      daysRequested: DAYS_REQUESTED,
    });
    expect(public_token, "sandbox did not return a public token").toBeTruthy();

    const exchanged = await client.exchangePublicToken(public_token);
    expect(exchanged.access_token).toBeTruthy();
    expect(exchanged.item_id).toBeTruthy();

    try {
      // --- shapes the client reads ---
      const { accounts, item } = await client.getAccounts(exchanged.access_token);
      expect(accounts.length).toBeGreaterThan(0);
      for (const account of accounts) {
        expect(typeof account.account_id).toBe("string");
        expect(typeof account.name).toBe("string");
        expect(typeof account.type).toBe("string");
      }
      expect(item.item_id).toBe(exchanged.item_id);
      expect(item.institution_id).toBe(SANDBOX_INSTITUTION);

      const institution = await client.getInstitution(SANDBOX_INSTITUTION, ["US"]);
      expect(typeof institution.institution.name).toBe("string");

      // --- the sync walk, exactly as syncPlaidItem drives it ---
      const collected: PlaidApiTransaction[] = [];
      let cursor: string | null = null;
      let pages = 0;
      for (;;) {
        const page = await client.transactionsSync({ accessToken: exchanged.access_token, cursor });
        expect(Array.isArray(page.added)).toBe(true);
        expect(Array.isArray(page.modified)).toBe(true);
        expect(Array.isArray(page.removed)).toBe(true);
        expect(typeof page.next_cursor).toBe("string");
        expect(typeof page.has_more).toBe("boolean");
        collected.push(...page.added);
        cursor = page.next_cursor;
        pages += 1;
        if (!page.has_more || pages > 20) break;
      }
      // A brand-new sandbox item can take a moment to generate transactions; an empty
      // result is not a contract violation, but it does mean the checks below prove less.
      notes.push(`pages walked: ${pages}, transactions returned: ${collected.length}`);

      if (collected.length > 0) {
        // Every field the ingest layer depends on.
        for (const txn of collected) {
          expect(typeof txn.transaction_id).toBe("string");
          expect(typeof txn.account_id).toBe("string");
          expect(typeof txn.amount).toBe("number");
          expect(txn.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(typeof txn.pending).toBe("boolean");
        }

        // Sign convention: this app books a positive Plaid amount as money OUT. If Plaid
        // ever flipped that, every imported transaction would be inverted.
        const outflow = collected.find((t) => t.amount > 0);
        expect(outflow, "no positive-amount transaction to check the sign convention").toBeTruthy();
        if (outflow) {
          expect(mapPlaidAmount({ amount: outflow.amount, pfcPrimary: outflow.personal_finance_category?.primary ?? null }).kind).toBe("expense");
        }

        // Every row must survive normalisation, or the sync would silently drop it.
        const unusable = collected.filter(
          (t) => normalizePlaidTransaction(t, { cutoff: null }).ok === false,
        );
        expect(
          unusable.map((t) => t.name),
          "transactions the ingest layer could not normalise",
        ).toEqual([]);

        // The category map keys on Plaid's `personal_finance_category.primary`. A value we
        // do not know about silently falls through to "Uncategorized", so surface it.
        const primaries = new Set(
          collected
            .map((t) => t.personal_finance_category?.primary)
            .filter((p): p is string => Boolean(p)),
        );
        const unmapped = [...primaries].filter((p) => !(p in PFC_TO_CATEGORY_NAMES));
        notes.push(`personal_finance_category.primary seen: ${[...primaries].join(", ") || "none"}`);
        expect(unmapped, "Plaid categories this app does not map").toEqual([]);

        // days_requested: the window the user chose is only honest if Plaid respects it.
        const oldest = collected.reduce((min, t) => (t.date < min ? t.date : min), collected[0].date);
        const limit = new Date();
        limit.setUTCDate(limit.getUTCDate() - (DAYS_REQUESTED + 5));
        notes.push(`oldest transaction: ${oldest} (asked for ${DAYS_REQUESTED} days)`);
        expect(
          oldest >= limit.toISOString().slice(0, 10),
          `asked for ${DAYS_REQUESTED} days but the oldest transaction is ${oldest}`,
        ).toBe(true);

        // pending_transaction_id is what the pending→posted handling hangs on. Sandbox may
        // not produce a posted successor, so this is reported rather than asserted.
        const withPendingLink = collected.filter((t) => t.pending_transaction_id);
        notes.push(`rows carrying pending_transaction_id: ${withPendingLink.length}`);
      }

      // A cursor that is current returns nothing new — what makes repeat syncs cheap.
      const repeat = await client.transactionsSync({ accessToken: exchanged.access_token, cursor });
      expect(repeat.added).toEqual([]);
      expect(repeat.has_more).toBe(false);

      console.log(`\n[plaid sandbox contract]\n  ${notes.join("\n  ")}\n`);
    } finally {
      // Always removed: a sandbox item is free, but leaving them behind is the same habit
      // that leaves billable ones behind in production.
      await client.removeItem(exchanged.access_token).catch(() => {});
    }
  }, 120_000);
});
