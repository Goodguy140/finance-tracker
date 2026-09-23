// Sibling imports in this file are relative, not "@/lib/plaid/...", and must stay that way.
// This module is reached only through a runtime `await import()` in service.ts, so nothing
// rewrites its aliases ahead of time -- the loader resolves them as written. Under
// Playwright that fails with "Cannot find module '@/lib/plaid/client'".
import { PlaidApiError, type PlaidClient } from "./client";
import type { PlaidApiTransaction } from "./types";

/**
 * A deterministic stand-in for Plaid, used by end-to-end tests.
 *
 * Only reachable when PLAID_FAKE_CLIENT=1 outside production (see
 * `plaidFakeClientEnabled`). It exists so the link, mapping and unlink flows can be driven
 * against a real browser and a real database without a Plaid account — and so no test run
 * can accidentally reach the live API.
 *
 * State lives on globalThis rather than in a module variable: Next may evaluate a module
 * more than once per process, and a fake whose items vanish between requests would be
 * worse than no fake at all.
 */

type FakeItem = {
  itemId: string;
  accessToken: string;
  institutionId: string;
  removed: boolean;
};

type FakeState = { items: Map<string, FakeItem>; counter: number };

const globalState = globalThis as unknown as { __plaidFakeState?: FakeState };

function state(): FakeState {
  globalState.__plaidFakeState ??= { items: new Map(), counter: 0 };
  return globalState.__plaidFakeState;
}

/** `YYYY-MM-DD`, `daysAgo` before today. Keeps fixtures inside any history window. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The transactions a first sync returns. Chosen to exercise each path the review queue
 * has to handle, and deterministic so a test can set up the matching side by hand:
 *
 *  - LOBLAWS is an ordinary new expense with nothing to match against;
 *  - BLUE BOTTLE is priced and dated to match a hand-entered transaction the test creates;
 *  - PAYROLL is income, so the income branch of the category map is exercised;
 *  - REFUND is a negative non-income amount, which must book as a negative expense;
 *  - HARDWARE has no merchant_name, so the raw bank description is what reaches the queue.
 */
export const FAKE_SYNC_AMOUNTS = {
  groceries: 84.21,
  coffee: 12.0,
  payroll: -2500.0,
  refund: -45.9,
  hardware: 31.5,
} as const;

export function fakeSyncTransactions(): PlaidApiTransaction[] {
  return [
    {
      transaction_id: "fake-txn-groceries",
      account_id: "fake-acct-chequing",
      amount: FAKE_SYNC_AMOUNTS.groceries,
      iso_currency_code: "CAD",
      date: daysAgo(3),
      name: "LOBLAWS #1234 TORONTO ON",
      merchant_name: "Loblaws",
      pending: false,
      personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "GROCERIES" },
    },
    {
      transaction_id: "fake-txn-coffee",
      account_id: "fake-acct-chequing",
      amount: FAKE_SYNC_AMOUNTS.coffee,
      iso_currency_code: "CAD",
      date: daysAgo(2),
      name: "SQ *BLUE BOTTLE #412 TORONTO ON",
      merchant_name: "Blue Bottle Coffee",
      pending: false,
      personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "COFFEE" },
    },
    {
      transaction_id: "fake-txn-payroll",
      account_id: "fake-acct-chequing",
      amount: FAKE_SYNC_AMOUNTS.payroll,
      iso_currency_code: "CAD",
      date: daysAgo(5),
      name: "ACME PAYROLL",
      merchant_name: "Acme Inc",
      pending: false,
      personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
    },
    {
      transaction_id: "fake-txn-refund",
      account_id: "fake-acct-chequing",
      amount: FAKE_SYNC_AMOUNTS.refund,
      iso_currency_code: "CAD",
      date: daysAgo(1),
      name: "AMZN MKTP REFUND",
      merchant_name: "Amazon",
      pending: false,
      personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "RETURN" },
    },
    {
      transaction_id: "fake-txn-hardware",
      account_id: "fake-acct-chequing",
      amount: FAKE_SYNC_AMOUNTS.hardware,
      iso_currency_code: "CAD",
      date: daysAgo(4),
      name: "SQ *MAPLE HARDWARE #0114 OTTAWA ON",
      pending: false,
      personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "HARDWARE" },
    },
  ];
}

export const FAKE_INSTITUTION_NAME = "Test Credit Union";
export const FAKE_PUBLIC_TOKEN_PREFIX = "public-sandbox-";

/** Accounts every fake item exposes: one CAD chequing, one USD card to exercise the
 *  currency refusal, and one with no currency reported at all. */
export const FAKE_ACCOUNTS = [
  {
    account_id: "fake-acct-chequing",
    name: "Everyday Chequing",
    official_name: "Everyday Chequing Account",
    mask: "4321",
    type: "depository",
    subtype: "checking",
    balances: { iso_currency_code: "CAD" },
  },
  {
    account_id: "fake-acct-usd-card",
    name: "Travel Rewards Card",
    official_name: null,
    mask: "9911",
    type: "credit",
    subtype: "credit card",
    balances: { iso_currency_code: "USD" },
  },
  {
    account_id: "fake-acct-unknown-ccy",
    name: "Savings",
    official_name: null,
    mask: "1002",
    type: "depository",
    subtype: "savings",
    balances: { iso_currency_code: null },
  },
] as const;

export function createFakePlaidClient(): PlaidClient {
  return {
    async createLinkToken(input) {
      // Update mode must carry an access token; a fresh link must not.
      if (input.accessToken) {
        const known = [...state().items.values()].some((i) => i.accessToken === input.accessToken);
        if (!known) {
          throw new PlaidApiError({
            message: "Unknown access token.",
            errorCode: "INVALID_ACCESS_TOKEN",
            errorType: "INVALID_INPUT",
            requestId: null,
            httpStatus: 400,
          });
        }
      }
      const s = state();
      s.counter += 1;
      return {
        link_token: `link-sandbox-fake-${s.counter}`,
        expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
    },

    async exchangePublicToken(publicToken) {
      if (!publicToken.startsWith(FAKE_PUBLIC_TOKEN_PREFIX)) {
        throw new PlaidApiError({
          message: "Invalid public token.",
          errorCode: "INVALID_PUBLIC_TOKEN",
          errorType: "INVALID_INPUT",
          requestId: null,
          httpStatus: 400,
        });
      }
      // Every exchange yields a distinct item, as real Plaid does: two people linking the
      // same institution get different item_ids. Deriving the id from the fixture token
      // instead made two specs collide on the "already linked here" guard, which was the
      // guard working correctly against a fake that did not behave like Plaid.
      const suffix = publicToken.slice(FAKE_PUBLIC_TOKEN_PREFIX.length) || "default";
      const s = state();
      s.counter += 1;
      const itemId = `fake-item-${suffix}-${s.counter}-${Date.now()}`;
      const accessToken = `access-sandbox-${itemId}`;
      state().items.set(itemId, {
        itemId,
        accessToken,
        institutionId: "ins_fake",
        removed: false,
      });
      return { access_token: accessToken, item_id: itemId };
    },

    async getAccounts(accessToken) {
      const item = [...state().items.values()].find((i) => i.accessToken === accessToken);
      if (!item || item.removed) {
        throw new PlaidApiError({
          message: "Item not found.",
          errorCode: "ITEM_NOT_FOUND",
          errorType: "ITEM_ERROR",
          requestId: null,
          httpStatus: 400,
        });
      }
      return {
        accounts: FAKE_ACCOUNTS.map((a) => ({ ...a })),
        item: {
          item_id: item.itemId,
          institution_id: item.institutionId,
          consent_expiration_time: null,
        },
      };
    },

    async getInstitution(institutionId) {
      return { institution: { institution_id: institutionId, name: FAKE_INSTITUTION_NAME } };
    },

    async transactionsSync({ cursor }) {
      // First walk returns the fixture; every later one is empty, exactly as a real item
      // behaves once its cursor is current.
      if (cursor) {
        return {
          added: [],
          modified: [],
          removed: [],
          next_cursor: cursor,
          has_more: false,
        };
      }
      return {
        added: fakeSyncTransactions(),
        modified: [],
        removed: [],
        next_cursor: "fake-cursor-1",
        has_more: false,
      };
    },

    async sandboxCreatePublicToken() {
      // The fake never needs Link either, so a caller can use the same shape as sandbox.
      return { public_token: `${FAKE_PUBLIC_TOKEN_PREFIX}fake` };
    },

    async removeItem(accessToken) {
      const item = [...state().items.values()].find((i) => i.accessToken === accessToken);
      if (!item) {
        throw new PlaidApiError({
          message: "Item not found.",
          errorCode: "ITEM_NOT_FOUND",
          errorType: "ITEM_ERROR",
          requestId: null,
          httpStatus: 400,
        });
      }
      item.removed = true;
      state().items.delete(item.itemId);
    },
  };
}
