import { describe, expect, it } from "vitest";
import { formatUptime } from "./admin-runtime-metrics";

describe("formatUptime", () => {
  it("formats days hours minutes seconds", () => {
    expect(formatUptime(90061)).toBe("1d 1h 1m 1s");
  });

  it("formats sub-minute uptime", () => {
    expect(formatUptime(45)).toBe("45s");
  });
});
