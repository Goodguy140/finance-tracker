import type { Session } from "next-auth";
import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/lib/auth-options";
import { getMfaState, MFA_STEP_UP_MAX_AGE_MS, sessionSid, type MfaState } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";

export type MfaGate = MfaState & {
  /** True once the user has at least one passkey — from then on every login must verify. */
  required: boolean;
  passkeyCount: number;
};

export type LoadedSession = { session: Session; user: User; sid: string; mfa: MfaGate };

export type ApiAuth =
  | { status: "ok"; user: User }
  | { status: 401 }
  | { status: 403; reason: "mfa_required" };
export type AdminApiAuth = ApiAuth | { status: 403; reason: "forbidden" };

export type MfaStepUpCode = "mfa_step_up" | "mfa_required";

const STEP_UP_MESSAGES: Record<MfaStepUpCode, string> = {
  mfa_step_up: "Confirm with your passkey to continue.",
  mfa_required: "Add a passkey in Settings → Security before linking external accounts.",
};

/** Thrown by `requireFreshMfa`; actions surface `code` so the client can prompt and retry. */
export class MfaStepUpRequiredError extends Error {
  readonly code: MfaStepUpCode;
  constructor(code: MfaStepUpCode) {
    super(STEP_UP_MESSAGES[code]);
    this.name = "MfaStepUpRequiredError";
    this.code = code;
  }
}

/**
 * Sessions are stateless JWTs, so the only way to revoke one is to reject it on use.
 * Every entry point below already loads the user row, so comparing the version the token
 * was issued with against the current one costs nothing extra. A password change, reset,
 * or sign-out-everywhere bumps `User.tokenVersion` and every older token stops here.
 *
 * Tokens issued before the column existed carry no version and are read as 0, which
 * matches the column default — deploying this does not sign existing sessions out.
 */
function tokenVersionMatches(session: Session, user: User): boolean {
  return (session.user?.tokenVersion ?? 0) === user.tokenVersion;
}

export async function getCurrentSession() {
  return getServerSession(await getAuthOptions());
}

/**
 * The one resolver behind every guard: valid JWT, live token version, and the passkey
 * state for this login. Returns null for anything that should be treated as signed out.
 */
export async function loadSessionUser(): Promise<LoadedSession | null> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { _count: { select: { webAuthnCredentials: true } } },
  });
  if (!row) return null;
  const { _count, ...user } = row;
  if (!tokenVersionMatches(session, user)) return null;
  const state = await getMfaState(session);
  return {
    session,
    user,
    sid: sessionSid(session),
    mfa: { ...state, required: _count.webAuthnCredentials > 0, passkeyCount: _count.webAuthnCredentials },
  };
}

function mfaPending(loaded: LoadedSession): boolean {
  return loaded.mfa.required && !loaded.mfa.verified;
}

/** Set by `src/proxy.ts`; absent outside a request (tests, scripts). */
async function currentPath(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-pathname");
  } catch {
    return null;
  }
}

/** Only same-origin relative paths make it into `?next=`; anything else lands on `/`. */
export function safeNextPath(candidate: string | null | undefined): string {
  if (!candidate) return "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  if (candidate === "/mfa" || candidate.startsWith("/mfa?") || candidate.startsWith("/login")) return "/";
  return candidate;
}

export function mfaRedirectPath(next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? "/mfa" : `/mfa?next=${encodeURIComponent(safe)}`;
}

/** For route handlers: returns the signed-in user, 401, or 403 while a passkey check is pending. */
export async function requireUserApiUser(): Promise<ApiAuth> {
  const loaded = await loadSessionUser();
  if (!loaded) return { status: 401 };
  if (mfaPending(loaded)) return { status: 403, reason: "mfa_required" };
  return { status: "ok", user: loaded.user };
}

/** For route handlers: returns admin user or an HTTP status code (no redirects). */
export async function requireAdminApiUser(): Promise<AdminApiAuth> {
  const auth = await requireUserApiUser();
  if (auth.status !== "ok") return auth;
  if (auth.user.role !== UserRole.SERVER_ADMIN) return { status: 403, reason: "forbidden" };
  return auth;
}

/**
 * Valid login, passkey check *not* enforced. Only for the `/mfa` wall itself and the
 * actions that complete it — everything else goes through `requireUser`.
 */
export async function requireSessionUser(): Promise<LoadedSession> {
  const loaded = await loadSessionUser();
  if (!loaded) redirect("/login");
  return loaded;
}

/** `requireUser` plus the session/MFA detail, for pages that render passkey state. */
export async function requireLoadedUser(): Promise<LoadedSession> {
  const loaded = await loadSessionUser();
  if (!loaded) redirect("/login");
  if (mfaPending(loaded)) redirect(mfaRedirectPath(await currentPath()));
  return loaded;
}

export async function requireUser() {
  return (await requireLoadedUser()).user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== UserRole.SERVER_ADMIN) redirect("/settings");
  return user;
}

/**
 * Step-up for linking anything external (SSO provider, API token, a future Plaid item):
 * the user must have a passkey and must have asserted it within `maxAgeMs`. Throws a
 * typed error so the caller can prompt for a fresh assertion and retry.
 */
export async function requireFreshMfa(maxAgeMs = MFA_STEP_UP_MAX_AGE_MS): Promise<LoadedSession> {
  const loaded = await loadSessionUser();
  if (!loaded) redirect("/login");
  if (!loaded.mfa.required) throw new MfaStepUpRequiredError("mfa_required");
  const at = loaded.mfa.verifiedAt;
  if (!loaded.mfa.verified || at == null || Date.now() - at > maxAgeMs) {
    throw new MfaStepUpRequiredError("mfa_step_up");
  }
  return loaded;
}
