import { PLAID_HOSTS, type PlaidEnvironment } from "@/lib/plaid/settings";
import type {
  CreateLinkTokenInput,
  PlaidApiAccount,
  PlaidApiItem,
  PlaidSyncPage,
} from "@/lib/plaid/types";

/**
 * A small typed `fetch` wrapper over the six Plaid endpoints this app uses.
 *
 * Deliberately not the `plaid` npm package: that is a generated OpenAPI client plus axios,
 * and with `output: "standalone"` its weight lands in the image twice (once via Next's
 * trace, once via the pruned node_modules the Dockerfile copies). It would also need
 * adding to `serverExternalPackages`, a list next.config.ts keeps minimal on purpose.
 * Node 22 has fetch, so the second HTTP stack buys nothing.
 *
 * The trade is that this file has to be kept honest by hand. It is written to fail safe:
 * only the handful of fields actually read are typed, everything else passes through
 * untouched, and Plaid's own error_code is surfaced verbatim rather than remapped.
 */

/** Plaid credentials go in the JSON body, not headers. */
export type PlaidConfig = {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
};

export class PlaidApiError extends Error {
  readonly errorCode: string;
  readonly errorType: string;
  readonly requestId: string | null;
  readonly httpStatus: number;

  constructor(input: {
    message: string;
    errorCode: string;
    errorType: string;
    requestId: string | null;
    httpStatus: number;
  }) {
    super(input.message);
    this.name = "PlaidApiError";
    this.errorCode = input.errorCode;
    this.errorType = input.errorType;
    this.requestId = input.requestId;
    this.httpStatus = input.httpStatus;
  }

  /** The bank needs the user to sign in again; nothing syncs until they do. */
  get needsReauth(): boolean {
    return this.errorCode === "ITEM_LOGIN_REQUIRED" || this.errorCode === "PENDING_EXPIRATION";
  }

  /**
   * Plaid mutated the item mid-pagination. The documented recovery is to restart the walk
   * from the last committed cursor rather than to treat it as a failure.
   */
  get isPaginationMutation(): boolean {
    return this.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
  }

  /** Already gone at Plaid — unlinking should treat this as success, not an error. */
  get itemAlreadyGone(): boolean {
    return this.errorCode === "ITEM_NOT_FOUND" || this.errorCode === "INVALID_ACCESS_TOKEN";
  }
}

export type PlaidClient = {
  createLinkToken(input: CreateLinkTokenInput): Promise<{ link_token: string; expiration: string }>;
  exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string }>;
  getAccounts(accessToken: string): Promise<{ accounts: PlaidApiAccount[]; item: PlaidApiItem }>;
  getInstitution(
    institutionId: string,
    countryCodes: string[],
  ): Promise<{ institution: { institution_id: string; name: string } }>;
  transactionsSync(input: {
    accessToken: string;
    cursor: string | null;
    count?: number;
  }): Promise<PlaidSyncPage>;
  removeItem(accessToken: string): Promise<void>;
  /**
   * Mints a public token without the Link UI. Sandbox only — Plaid rejects it anywhere
   * else — which is what makes the contract check against a real Plaid runnable headlessly.
   */
  sandboxCreatePublicToken(input: {
    institutionId: string;
    daysRequested?: number;
  }): Promise<{ public_token: string }>;
};

/** Plaid's cap. Fewer, larger pages means fewer transactions per commit boundary. */
export const PLAID_SYNC_PAGE_SIZE = 500;

/** Plaid rejects anything above this, and it is roughly two years of history. */
export const PLAID_MAX_DAYS_REQUESTED = 730;

const REQUEST_TIMEOUT_MS = 30_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function createPlaidClient(config: PlaidConfig): PlaidClient {
  const host = PLAID_HOSTS[config.environment];

  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    // An unreachable Plaid must not hold a request open indefinitely; the sync sweep in
    // particular runs unattended and would otherwise pin its lock until the stale timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${host}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          secret: config.secret,
          ...body,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new PlaidApiError({
        message: aborted
          ? `Plaid did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
          : `Could not reach Plaid: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        errorType: "CONNECTION_ERROR",
        requestId: null,
        httpStatus: 0,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const body = asRecord(parsed);
      throw new PlaidApiError({
        // Plaid's display_message is user-facing when present; error_message is the
        // developer-facing one. Prefer whichever exists over inventing our own wording.
        message:
          str(body.display_message) ||
          str(body.error_message) ||
          `Plaid request to ${path} failed with HTTP ${response.status}.`,
        errorCode: str(body.error_code, "UNKNOWN"),
        errorType: str(body.error_type, "UNKNOWN"),
        requestId: typeof body.request_id === "string" ? body.request_id : null,
        httpStatus: response.status,
      });
    }

    return (parsed ?? {}) as T;
  }

  return {
    async createLinkToken(input) {
      const updateMode = Boolean(input.accessToken);
      return call("/link/token/create", {
        user: { client_user_id: input.clientUserId },
        client_name: input.clientName,
        country_codes: input.countryCodes,
        language: input.language ?? "en",
        // In update mode Plaid requires `products` to be omitted and `access_token` given;
        // sending both is rejected.
        ...(updateMode
          ? { access_token: input.accessToken }
          : {
              products: ["transactions"],
              ...(input.daysRequested
                ? {
                    transactions: {
                      days_requested: Math.min(input.daysRequested, PLAID_MAX_DAYS_REQUESTED),
                    },
                  }
                : {}),
            }),
        ...(input.webhook ? { webhook: input.webhook } : {}),
        ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
      });
    },

    async exchangePublicToken(publicToken) {
      return call("/item/public_token/exchange", { public_token: publicToken });
    },

    async getAccounts(accessToken) {
      return call("/accounts/get", { access_token: accessToken });
    },

    async getInstitution(institutionId, countryCodes) {
      return call("/institutions/get_by_id", {
        institution_id: institutionId,
        country_codes: countryCodes,
      });
    },

    async transactionsSync(input) {
      const page = await call<Partial<PlaidSyncPage>>("/transactions/sync", {
        access_token: input.accessToken,
        // Plaid distinguishes "no cursor" (full history) from an empty string, so the
        // field is omitted entirely rather than sent as "".
        ...(input.cursor ? { cursor: input.cursor } : {}),
        count: input.count ?? PLAID_SYNC_PAGE_SIZE,
      });
      // Normalised so callers never have to defend against a missing array.
      return {
        added: page.added ?? [],
        modified: page.modified ?? [],
        removed: page.removed ?? [],
        next_cursor: page.next_cursor ?? "",
        has_more: page.has_more ?? false,
      };
    },

    async removeItem(accessToken) {
      await call("/item/remove", { access_token: accessToken });
    },

    async sandboxCreatePublicToken(input) {
      return call("/sandbox/public_token/create", {
        institution_id: input.institutionId,
        initial_products: ["transactions"],
        ...(input.daysRequested
          ? { options: { transactions: { days_requested: input.daysRequested } } }
          : {}),
      });
    },
  };
}
