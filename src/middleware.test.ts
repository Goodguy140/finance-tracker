import { describe, expect, it } from "vitest";
import { __authProxyInternals } from "./middleware";

describe("auth proxy path rules", () => {
  it("does not skip synthetic forwarded headers for csrf endpoint", () => {
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/csrf")).toBe(false);
  });

  it("still skips readonly provider/session endpoints", () => {
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/providers")).toBe(true);
    expect(__authProxyInternals.skipSyntheticForwardedForPath("/api/auth/session")).toBe(true);
  });
});
