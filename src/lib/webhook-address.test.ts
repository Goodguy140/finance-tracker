import { describe, expect, it } from "vitest";
import { assertWebhookDestination, classifyIpAddress, classifyWebhookHost } from "./webhook-address";

describe("classifyIpAddress", () => {
  it.each([
    ["127.0.0.1", "blocked"],
    ["0.0.0.0", "blocked"],
    ["169.254.169.254", "blocked"],
    ["224.0.0.1", "blocked"],
    ["::1", "blocked"],
    ["::", "blocked"],
    ["fe80::1", "blocked"],
    ["::ffff:127.0.0.1", "blocked"],
    ["::ffff:7f00:1", "blocked"],
    ["::ffff:169.254.169.254", "blocked"],
    ["10.0.0.5", "local"],
    ["172.16.0.1", "local"],
    ["172.31.255.255", "local"],
    ["192.168.1.20", "local"],
    ["100.100.1.1", "local"],
    ["fd12:3456::1", "local"],
    ["::ffff:192.168.1.20", "local"],
    ["172.32.0.1", "public"],
    ["8.8.8.8", "public"],
    ["2606:4700::1111", "public"],
    ["not an ip", "blocked"],
  ])("%s is %s", (ip, expected) => {
    expect(classifyIpAddress(ip)).toBe(expected);
  });
});

describe("classifyWebhookHost", () => {
  const resolveTo = (...addresses: string[]) => async () => addresses;

  it("takes the strictest of every address a name resolves to", async () => {
    expect(await classifyWebhookHost("hooks.example.test", resolveTo("93.184.216.34"))).toBe("public");
    expect(await classifyWebhookHost("split.example.test", resolveTo("93.184.216.34", "10.0.0.2"))).toBe("local");
    expect(await classifyWebhookHost("meta.example.test", resolveTo("10.0.0.2", "169.254.169.254"))).toBe("blocked");
  });

  it("reads literal addresses, including bracketed IPv6, without a lookup", async () => {
    const never = async () => {
      throw new Error("looked up");
    };
    expect(await classifyWebhookHost("[::1]", never)).toBe("blocked");
    expect(await classifyWebhookHost(new URL("http://0x7f.1/").hostname, never)).toBe("blocked");
    expect(await classifyWebhookHost("localhost", never)).toBe("blocked");
  });

  it("refuses a name that does not resolve", async () => {
    await expect(classifyWebhookHost("nowhere.example.test", resolveTo())).rejects.toThrow("Could not find");
  });
});

describe("assertWebhookDestination", () => {
  const lan = async () => ["192.168.1.20"];
  const internet = async () => ["93.184.216.34"];

  it("lets a server admin reach the local network, over http too", async () => {
    await expect(assertWebhookDestination("http://ha.lan:8123/api/webhook/x", { allowLocal: true, resolve: lan })).resolves.toBeUndefined();
  });

  it("keeps everyone else to public https addresses", async () => {
    await expect(assertWebhookDestination("https://ha.lan/hook", { allowLocal: false, resolve: lan })).rejects.toThrow("server admin");
    await expect(assertWebhookDestination("http://hooks.example.test/x", { allowLocal: false, resolve: internet })).rejects.toThrow("https://");
    await expect(assertWebhookDestination("https://hooks.example.test/x", { allowLocal: false, resolve: internet })).resolves.toBeUndefined();
  });

  it("blocks loopback and cloud metadata for everyone, admins included", async () => {
    await expect(assertWebhookDestination("http://127.0.0.1:3000/", { allowLocal: true })).rejects.toThrow("link-local");
    await expect(assertWebhookDestination("http://169.254.169.254/latest/meta-data/", { allowLocal: true })).rejects.toThrow("link-local");
  });
});
