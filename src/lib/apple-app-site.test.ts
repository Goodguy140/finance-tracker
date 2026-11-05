import { afterEach, describe, expect, it } from "vitest";
import { GET as getAssociation } from "@/app/.well-known/apple-app-site-association/route";
import { GET as getServerInfo } from "@/app/api/v1/server/route";

/**
 * Only the app's home server says it is one: the file iOS checks before letting the app use this
 * domain's passkeys, and the passkey endpoints the app looks for in `/api/v1/server`.
 */

const APP_ID = "ABCDE12345.com.example.finances";
const saved = { appId: process.env.APPLE_APP_ID, url: process.env.NEXTAUTH_URL };

afterEach(() => {
  process.env.APPLE_APP_ID = saved.appId;
  process.env.NEXTAUTH_URL = saved.url;
  if (saved.appId === undefined) delete process.env.APPLE_APP_ID;
  if (saved.url === undefined) delete process.env.NEXTAUTH_URL;
});

describe("the app's home server", () => {
  it("names the app in its association file and offers passkey sign-in for its own domain", async () => {
    process.env.APPLE_APP_ID = APP_ID;
    process.env.NEXTAUTH_URL = "https://money.example.com";

    const file = getAssociation();
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("application/json");
    expect(await file.json()).toEqual({ webcredentials: { apps: [APP_ID] } });

    expect((await getServerInfo().json()).passkeySignIn).toEqual({
      optionsPath: "/api/v1/app/passkey/options",
      tokenPath: "/api/v1/app/passkey/token",
      rpId: "money.example.com",
    });
  });
});

describe("any other server", () => {
  it.each([
    ["unset", undefined],
    ["not a team and bundle id", "com.example.finances"],
    ["lower-case team id", "abcde12345.com.example.finances"],
  ])("serves no association file and offers no passkey sign-in when APPLE_APP_ID is %s", async (_, value) => {
    if (value === undefined) delete process.env.APPLE_APP_ID;
    else process.env.APPLE_APP_ID = value;

    expect(getAssociation().status).toBe(404);
    const info = await getServerInfo().json();
    expect(info.service).toBe("finance-tracker");
    expect(info).not.toHaveProperty("passkeySignIn");
  });
});
