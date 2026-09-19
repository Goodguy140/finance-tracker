import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import type { PlaidApiTransaction } from "@/lib/plaid/types";

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

export function resetFakePlaidState(): void {
  globalState.__plaidFakeState = { items: new Map(), counter: 0 };
}

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
      // The token's suffix names the item, so a test can deliberately re-link the same
      // institution and exercise the "already linked" and re-auth paths.
      const suffix = publicToken.slice(FAKE_PUBLIC_TOKEN_PREFIX.length) || "default";
      const itemId = `fake-item-${suffix}`;
      const accessToken = `access-sandbox-${suffix}-${Date.now()}`;
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

    async transactionsSync() {
      // Phase 4 fills this in; linking and mapping do not sync.
      return {
        added: [] as PlaidApiTransaction[],
        modified: [] as PlaidApiTransaction[],
        removed: [],
        next_cursor: "fake-cursor-empty",
        has_more: false,
      };
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
