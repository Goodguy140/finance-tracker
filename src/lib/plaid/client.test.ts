import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaidClient } from "@/lib/plaid/client";

function captureBody() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ link_token: "link-x", expiration: "" })));
  vi.stubGlobal("fetch", fetchMock);
  return () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
}

const client = () => createPlaidClient({ clientId: "id", secret: "s", environment: "sandbox" });
const base = { clientUserId: "u1", clientName: "Finance Tracker", countryCodes: ["CA"] };

describe("createLinkToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns on account selection in update mode, without products", async () => {
    const body = captureBody();
    await client().createLinkToken({
      ...base,
      accessToken: "access-1",
      accountSelection: true,
      webhook: "https://money.example.com/api/plaid/webhook",
    });
    expect(body()).toMatchObject({
      access_token: "access-1",
      update: { account_selection_enabled: true },
      webhook: "https://money.example.com/api/plaid/webhook",
    });
    expect(body()).not.toHaveProperty("products");
  });

  it("leaves account selection off for a plain re-authentication", async () => {
    const body = captureBody();
    await client().createLinkToken({ ...base, accessToken: "access-1" });
    expect(body()).not.toHaveProperty("update");
  });
});

describe("request deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("still applies while the body is being read", async () => {
    vi.useFakeTimers();
    // Headers arrive at once; the body never finishes. Aborting the request is what ends
    // the stream, as it does for a real fetch.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"link_token":'));
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("The operation was aborted.", "AbortError")),
            );
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const pending = client().createLinkToken(base);
    const settled = expect(pending).rejects.toMatchObject({ errorCode: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });
});
