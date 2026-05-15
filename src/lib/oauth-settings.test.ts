import { describe, expect, it } from "vitest";
import { normalizeAuthentikIssuer, resolveAuthentikOauthSettings, resolveGoogleOauthSettings } from "./oauth-settings";

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

describe("resolveAuthentikOauthSettings", () => {
  it("preserves existing issuer and credentials when form submits blanks", () => {
    const resolved = resolveAuthentikOauthSettings({
      enabledRaw: "true",
      issuerRaw: "",
      clientIdRaw: "",
      clientSecretRaw: "",
      existingIssuer: "https://auth.example/application/o/app/",
      existingClientId: "oidc-id",
      existingClientSecret: "oidc-secret",
    });

    expect(resolved.enabled).toBe("true");
    expect(resolved.issuer).toBe("https://auth.example/application/o/app/");
    expect(resolved.clientId).toBe("oidc-id");
    expect(resolved.clientSecret).toBe("oidc-secret");
  });
});

describe("normalizeAuthentikIssuer", () => {
  it("strips trailing slashes", () => {
    expect(normalizeAuthentikIssuer("https://auth.example/application/o/app///")).toBe(
      "https://auth.example/application/o/app",
    );
  });
});
