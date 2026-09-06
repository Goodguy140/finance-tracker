/**
 * Cookie clean-up for a login that decodes but is no longer live (user deleted, token
 * version revoked). Pure helpers so the route handler that uses them stays thin.
 */

const SESSION_COOKIE_BASES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

/**
 * NextAuth stores the JWT under `next-auth.session-token` (with a `__Secure-` prefix on
 * https) and splits a long one into `<name>.0`, `<name>.1`, … chunks. Every such cookie
 * present on the request must go, or the next request still carries the dead login.
 */
export function sessionCookieNamesToClear(presentNames: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const name of presentNames) {
    if (SESSION_COOKIE_BASES.some((base) => name === base || name.startsWith(`${base}.`))) names.add(name);
  }
  return [...names];
}

export type ClearedCookie = {
  name: string;
  value: "";
  options: { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: 0 };
};

/** The set-cookie instructions that expire each of `names`, matching NextAuth's own attributes. */
export function expiredSessionCookies(names: string[]): ClearedCookie[] {
  return names.map((name) => ({
    name,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      // A `__Secure-` cookie is only accepted by the browser with the Secure attribute.
      secure: name.startsWith("__Secure-"),
      path: "/",
      maxAge: 0,
    },
  }));
}
