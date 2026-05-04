import { describe, expect, it } from "vitest";
import { resolveGoogleOauthSettings } from "./oauth-settings";

describe("resolveGoogleOauthSettings", () => {
  it("preserves existing client id/secret when form submits blanks", () => {
    const resolved = resolveGoogleOauthSettings({
      enabledRaw: "true",
      clientIdRaw: "",
      clientSecretRaw: "   ",
      existingClientId: "existing-id",
      existingClientSecret: "existing-secret",
    });

    expect(resolved.enabled).toBe("true");
    expect(resolved.clientId).toBe("existing-id");
    expect(resolved.clientSecret).toBe("existing-secret");
  });

  it("uses non-empty submitted values", () => {
    const resolved = resolveGoogleOauthSettings({
      enabledRaw: "false",
      clientIdRaw: "new-id",
      clientSecretRaw: "new-secret",
      existingClientId: "existing-id",
      existingClientSecret: "existing-secret",
    });

    expect(resolved.enabled).toBe("false");
    expect(resolved.clientId).toBe("new-id");
    expect(resolved.clientSecret).toBe("new-secret");
  });
});
