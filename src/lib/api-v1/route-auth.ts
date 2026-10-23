import { NextResponse } from "next/server";
import { authenticateApiToken } from "@/lib/api-token";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

type Authorized = Extract<Awaited<ReturnType<typeof authenticateApiToken>>, { status: "ok" }>;

/**
 * The checks every `/api/v1` route makes before doing anything: a bearer token with `scope`,
 * then the per-token rate limit (one budget per route, `name`). Returns the token's user, or
 * the response to send instead.
 */
export async function authorizeApiRequest(
  request: Request,
  scope: string,
  name: string,
): Promise<{ ok: true; auth: Authorized } | { ok: false; response: NextResponse }> {
  const auth = await authenticateApiToken(request, scope);
  if (auth.status === "unauthorized") {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (auth.status === "forbidden") {
    return {
      ok: false,
      response: NextResponse.json({ error: `Token is missing the required scope '${scope}'.` }, { status: 403 }),
    };
  }
  try {
    await enforceSlidingWindowRateLimit(`api:${name}:${auth.token.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, "Rate limit exceeded.");
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit exceeded. Try again shortly." },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    };
  }
  return { ok: true, auth };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
