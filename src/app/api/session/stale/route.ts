import { NextResponse } from "next/server";
import { mfaCookieName, mfaCookieSecure } from "@/lib/mfa-session";
import { expiredSessionCookies, sessionCookieNamesToClear } from "@/lib/stale-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/session/stale
 *
 * Landing spot for a login whose JWT still decodes but no longer maps to a live user
 * (see `resolveSession`). Server components cannot clear cookies, so they redirect here;
 * this drops every NextAuth session cookie and the passkey cookie, then sends the browser
 * to /login as a plain signed-out visitor. Nothing here trusts the token, so an anonymous
 * hit is harmless: it just ends up on /login too.
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  // A relative Location keeps the redirect on whatever public host the browser used,
  // rather than the loopback host a tunnel or reverse proxy may present to Node.
  response.headers.set("Location", "/login");
  response.headers.set("Cache-Control", "no-store");

  const present = request.headers
    .get("cookie")
    ?.split(";")
    .map((pair) => pair.trim().split("=")[0])
    .filter(Boolean) ?? [];
  for (const cookie of expiredSessionCookies(sessionCookieNamesToClear(present))) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  response.cookies.set(mfaCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: 0,
  });
  return response;
}
