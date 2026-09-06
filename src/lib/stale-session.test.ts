import { describe, expect, it } from "vitest";
import { expiredSessionCookies, sessionCookieNamesToClear } from "./stale-session";

describe("sessionCookieNamesToClear", () => {
  it("picks the plain and __Secure- session cookies plus their chunks, nothing else", () => {
    const present = [
      "next-auth.session-token",
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
      "next-auth.csrf-token",
      "__Host-mfa",
      "next-auth.session-tokenfoo",
    ];
    expect(sessionCookieNamesToClear(present).sort()).toEqual([
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
      "next-auth.session-token",
    ]);
  });

  it("returns nothing when no session cookie is present", () => {
    expect(sessionCookieNamesToClear(["next-auth.csrf-token"])).toEqual([]);
  });
});

describe("expiredSessionCookies", () => {
  it("expires each cookie with attributes the browser will accept", () => {
    const cleared = expiredSessionCookies(["next-auth.session-token", "__Secure-next-auth.session-token"]);
    expect(cleared[0]).toEqual({
      name: "next-auth.session-token",
      value: "",
      options: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 0 },
    });
    expect(cleared[1].options.secure).toBe(true);
  });
});
