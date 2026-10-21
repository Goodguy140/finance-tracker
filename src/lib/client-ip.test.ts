import { describe, expect, it } from "vitest";
import { clientIpFromForwardingHeaders, resolveTrustedProxyHops } from "./client-ip";

describe("clientIpFromForwardingHeaders", () => {
  it("takes the address the one trusted proxy appended, not one the client sent", () => {
    expect(clientIpFromForwardingHeaders("1.2.3.4, 203.0.113.9", null, undefined)).toBe("203.0.113.9");
    expect(clientIpFromForwardingHeaders("203.0.113.9", null, undefined)).toBe("203.0.113.9");
  });

  it("counts TRUSTED_PROXY_HOPS entries from the right", () => {
    expect(clientIpFromForwardingHeaders("1.2.3.4, 203.0.113.9, 10.0.0.2", null, "2")).toBe("203.0.113.9");
  });

  it("falls back to the leftmost entry when a proxy overwrote the header", () => {
    expect(clientIpFromForwardingHeaders("203.0.113.9", null, "3")).toBe("203.0.113.9");
  });

  it("uses X-Real-IP only without X-Forwarded-For", () => {
    expect(clientIpFromForwardingHeaders(null, " 198.51.100.4 ", undefined)).toBe("198.51.100.4");
    expect(clientIpFromForwardingHeaders(" , ", "198.51.100.4", undefined)).toBe("198.51.100.4");
    expect(clientIpFromForwardingHeaders("203.0.113.9", "198.51.100.4", undefined)).toBe("203.0.113.9");
    expect(clientIpFromForwardingHeaders(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("resolveTrustedProxyHops", () => {
  it("defaults to one proxy for anything that is not a positive whole number", () => {
    for (const raw of [undefined, "", "0", "-1", "1.5", "abc"]) expect(resolveTrustedProxyHops(raw)).toBe(1);
    expect(resolveTrustedProxyHops("2")).toBe(2);
  });
});
