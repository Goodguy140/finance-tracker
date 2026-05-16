import { describe, expect, it } from "vitest";
import { buildAdminOauthStatus, type AdminOauthStatusInput } from "./admin-oauth-status";

function baseInput(over: Partial<AdminOauthStatusInput> = {}): AdminOauthStatusInput {
  return {
    oauthHealth: {
      allReadable: true,
      failedKeys: [],
      google: "not_configured",
      authentik: "not_configured",
    },
    googleEnabled: "",
    googleClientId: "",
    googleClientSecret: "",
    authentikEnabled: "",
    authentikIssuer: "",
    authentikClientId: "",
    authentikClientSecret: "",
    env: { issuer: "", clientId: "", clientSecret: "", enabledFlag: "" },
    ...over,
  };
}

describe("buildAdminOauthStatus", () => {
  it("reports valid Google configuration", () => {
    const s = buildAdminOauthStatus(
      baseInput({
        oauthHealth: { allReadable: true, failedKeys: [], google: "ok", authentik: "not_configured" },
        googleEnabled: "true",
        googleClientId: "id",
        googleClientSecret: "sec",
      }),
    );
    expect(s.google.runtimeRegistered).toBe(true);
    expect(s.google.warnings).toHaveLength(0);
  });

  it("warns when Google enabled but incomplete", () => {
    const s = buildAdminOauthStatus(
      baseInput({
        oauthHealth: { allReadable: true, failedKeys: [], google: "ok", authentik: "not_configured" },
        googleEnabled: "true",
        googleClientId: "",
        googleClientSecret: "",
      }),
    );
    expect(s.google.runtimeRegistered).toBe(false);
    expect(s.google.errorCodes).toContain("ENABLED_BUT_INCOMPLETE");
  });

  it("warns on Google decrypt failure", () => {
    const s = buildAdminOauthStatus(
      baseInput({
        oauthHealth: {
          allReadable: false,
          failedKeys: ["oauth.google.clientId"],
          google: "decrypt_failed",
          authentik: "not_configured",
        },
      }),
    );
    expect(s.google.errorCodes).toContain("DECRYPT_FAILED");
    expect(s.globalWarnings.length).toBeGreaterThan(0);
  });

  it("warns when Authentik env overrides DB values", () => {
    const s = buildAdminOauthStatus(
      baseInput({
        oauthHealth: { allReadable: true, failedKeys: [], google: "not_configured", authentik: "ok" },
        env: { issuer: "https://idp.example", clientId: "eid", clientSecret: "esec", enabledFlag: "" },
        authentikIssuer: "https://db.example",
        authentikClientId: "dbid",
        authentikClientSecret: "",
      }),
    );
    expect(s.authentik.source).toBe("mixed");
    expect(s.authentik.errorCodes).toContain("ENV_OVERRIDES_DB");
  });

  it("uses environment Authentik when env credentials are complete", () => {
    const s = buildAdminOauthStatus(
      baseInput({
        oauthHealth: { allReadable: true, failedKeys: [], google: "not_configured", authentik: "not_configured" },
        env: { issuer: "https://idp.example", clientId: "eid", clientSecret: "esec", enabledFlag: "" },
      }),
    );
    expect(s.authentik.runtimeRegistered).toBe(true);
    expect(s.authentik.source).toBe("environment");
  });
});
