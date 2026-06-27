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
});
