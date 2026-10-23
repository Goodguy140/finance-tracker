import crypto from "crypto";
import type { PersonalAccessToken, PrismaClient, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Personal access tokens for programmatic API access (e.g. the Life Dashboard).
 *
 * Tokens are high-entropy random strings, so we store a fast SHA-256 hash rather
 * than bcrypt (bcrypt's work factor exists to slow brute force of low-entropy
 * passwords; it adds nothing for 256-bit random secrets). The raw value is shown
 * to the user exactly once and never persisted — the same model GitHub uses.
 */

const RAW_PREFIX = "ft_";
/** Characters of the raw token kept for display in token lists ("ft_" + 7). */
const DISPLAY_PREFIX_LEN = 10;

export const API_SCOPES = {
  budgetsRead: "budgets:read",
  transactionsRead: "transactions:read",
  transactionsWrite: "transactions:write",
  /** Accounts and categories: what a script needs to name them in a new transaction. */
  accountsRead: "accounts:read",
} as const;

export type GeneratedToken = { raw: string; hash: string; prefix: string };

export function hashApiToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateApiToken(): GeneratedToken {
  const raw = RAW_PREFIX + crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashApiToken(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export function parseBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1].trim() : null;
}

export function parseScopes(scopes: string): string[] {
  return scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function tokenHasScope(scopes: string, requiredScope: string): boolean {
  if (!requiredScope) return true;
  return parseScopes(scopes).includes(requiredScope);
}

export type ApiTokenAuthResult =
  | { status: "ok"; user: User; token: PersonalAccessToken }
  | { status: "unauthorized" }
  | { status: "forbidden" };

/**
 * Authenticates a route handler request via `Authorization: Bearer <token>`.
 * Returns the owning user on success, or a typed failure the caller maps to 401/403.
 * Never throws on a bad/expired/revoked token.
 */
export async function authenticateApiToken(
  request: Request,
  requiredScope: string,
  client: PrismaClient = prisma,
): Promise<ApiTokenAuthResult> {
  const raw = parseBearerToken(request.headers.get("authorization"));
  if (!raw) return { status: "unauthorized" };

  const record = await client.personalAccessToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { user: true },
  });
  if (!record || record.revokedAt) return { status: "unauthorized" };
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { status: "unauthorized" };
  }
  // De-provisioning has to reach machine access too, or a suspended user's integrations keep
  // reading their data. Bumping `tokenVersion` only revokes browser sessions, not bearer tokens.
  if (record.user.disabledAt) return { status: "unauthorized" };
  if (!tokenHasScope(record.scopes, requiredScope)) return { status: "forbidden" };

  // Best-effort usage stamp; must never block or fail the request.
  void client.personalAccessToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const { user, ...token } = record;
  return { status: "ok", user, token };
}
