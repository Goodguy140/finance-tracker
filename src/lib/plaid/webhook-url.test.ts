import { describe, expect, it } from "vitest";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";

describe("resolvePlaidWebhookUrl", () => {
  it("derives the URL from NEXTAUTH_URL's origin", () => {
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "https://money.example.com" })).toBe(
      "https://money.example.com/api/plaid/webhook",
    );
    // A trailing path on NEXTAUTH_URL is not where the route lives.
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "https://money.example.com/api/auth" })).toBe(
      "https://money.example.com/api/plaid/webhook",
    );
  });

  it("prefers PLAID_WEBHOOK_URL when set", () => {
    expect(
      resolvePlaidWebhookUrl({
        NEXTAUTH_URL: "https://money.example.com",
        PLAID_WEBHOOK_URL: "https://hooks.example.com/plaid",
      }),
    ).toBe("https://hooks.example.com/plaid");
  });

  it("returns null for anything Plaid could not reach", () => {
    expect(resolvePlaidWebhookUrl({})).toBeNull();
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "http://money.example.com" })).toBeNull();
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "https://localhost:3000" })).toBeNull();
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "https://127.0.0.1" })).toBeNull();
    expect(resolvePlaidWebhookUrl({ NEXTAUTH_URL: "not a url" })).toBeNull();
    // An explicit override that is unusable is refused, not silently replaced.
    expect(
      resolvePlaidWebhookUrl({
        NEXTAUTH_URL: "https://money.example.com",
        PLAID_WEBHOOK_URL: "http://hooks.example.com/plaid",
      }),
    ).toBeNull();
  });
});
