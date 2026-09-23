import { describe, expect, it } from "vitest";
import { __authProxyInternals, config } from "./proxy";

describe("auth proxy path rules", () => {
  it("does not skip synthetic forwarded headers for csrf endpoint", () => {
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/csrf")).toBe(false);
  });

  it("still skips readonly provider/session endpoints", () => {
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/providers")).toBe(true);
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/session")).toBe(true);
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("excludes token-authenticated /api/v1 routes from the session gate", () => {
    expect(matcher.test("/api/v1/budgets")).toBe(false);
  });

  it("still guards normal app routes", () => {
    expect(matcher.test("/settings")).toBe(true);
    expect(matcher.test("/")).toBe(true);
  });

  it("keeps existing public exclusions", () => {
    expect(matcher.test("/api/health")).toBe(false);
  });

  it("leaves the PWA files public so a signed-out device can install the app", () => {
    for (const path of [
      "/manifest.webmanifest",
      "/sw.js",
      "/icons/icon-192.png",
      "/icons/maskable-512.png",
      "/icon.svg",
      "/apple-icon.png",
      "/offline",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("anchors the PWA exclusions so look-alike paths stay guarded", () => {
    expect(matcher.test("/offline-data")).toBe(true);
    expect(matcher.test("/sw.jsx")).toBe(true);
    expect(matcher.test("/manifest.webmanifest.bak")).toBe(true);
  });
});

describe("public path classification", () => {
  const classify = __authProxyInternals.classifyPublicPath;

  it("matches whole path segments only", () => {
    expect(classify("/login")).toBe("signed-out-only");
    expect(classify("/login/")).toBe("signed-out-only");
    expect(classify("/loginfoo")).toBe("protected");
    expect(classify("/signup")).toBe("signed-out-only");
  });

  it("keeps the password-reset pages reachable with a session", () => {
    expect(classify("/forgot-password")).toBe("public");
    expect(classify("/reset-password")).toBe("public");
  });

  it("treats everything else as protected", () => {
    expect(classify("/")).toBe("protected");
    expect(classify("/settings")).toBe("protected");
    expect(classify("/api/backup/export/me")).toBe("protected");
  });
});
