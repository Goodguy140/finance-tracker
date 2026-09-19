import { describe, expect, it } from "vitest";
import {
  buildPlaidAdminStatus,
  envCredentialsComplete,
  normalizePlaidEnvironment,
  resolvePlaidSettings,
  PLAID_HOSTS,
} from "@/lib/plaid/settings";

const emptyEnv = { clientId: "", secret: "", env: "" };

describe("normalizePlaidEnvironment", () => {
  it("accepts production in any casing", () => {
    expect(normalizePlaidEnvironment("production")).toBe("production");
    expect(normalizePlaidEnvironment("  PRODUCTION ")).toBe("production");
  });

  it("falls back to sandbox for anything unrecognised", () => {
    // Defaulting the other way would point a misconfigured deployment at real banks.
    for (const raw of ["", "  ", "development", "prod", "nonsense", undefined, null]) {
      expect(normalizePlaidEnvironment(raw)).toBe("sandbox");
    }
  });

  it("has a host for every environment", () => {
    expect(PLAID_HOSTS.sandbox).toBe("https://sandbox.plaid.com");
    expect(PLAID_HOSTS.production).toBe("https://production.plaid.com");
  });
});

describe("resolvePlaidSettings", () => {
  const existing = {
    existingClientId: "stored-client",
    existingSecret: "stored-secret",
    existingEnv: "production",
  };

  it("keeps the stored values when the form posts blanks", () => {
    const resolved = resolvePlaidSettings({
      enabledRaw: "true",
      clientIdRaw: "",
      secretRaw: "",
      envRaw: "",
      ...existing,
    });
    expect(resolved).toEqual({
      enabled: "true",
      clientId: "stored-client",
      secret: "stored-secret",
      env: "production",
    });
  });

  it("treats whitespace-only input as blank", () => {
    const resolved = resolvePlaidSettings({
      enabledRaw: "true",
      clientIdRaw: "   ",
      secretRaw: "\t",
      envRaw: "  ",
      ...existing,
    });
    expect(resolved.clientId).toBe("stored-client");
    expect(resolved.secret).toBe("stored-secret");
    expect(resolved.env).toBe("production");
  });

  it("overwrites and trims when values are supplied", () => {
    const resolved = resolvePlaidSettings({
      enabledRaw: "true",
      clientIdRaw: "  new-client  ",
      secretRaw: " new-secret ",
      envRaw: "sandbox",
      ...existing,
    });
    expect(resolved).toEqual({
      enabled: "true",
      clientId: "new-client",
      secret: "new-secret",
      env: "sandbox",
    });
  });

  it("defaults enabled to false when the checkbox is absent", () => {
    // An unchecked checkbox posts nothing at all, which must read as off, not as "keep".
    expect(resolvePlaidSettings({ enabledRaw: "", clientIdRaw: "", secretRaw: "", envRaw: "", ...existing }).enabled).toBe(
      "false",
    );
  });
});

describe("envCredentialsComplete", () => {
  it("requires both halves", () => {
    expect(envCredentialsComplete({ clientId: "a", secret: "b", env: "" })).toBe(true);
    expect(envCredentialsComplete({ clientId: "a", secret: "", env: "" })).toBe(false);
    expect(envCredentialsComplete({ clientId: "", secret: "b", env: "" })).toBe(false);
    expect(envCredentialsComplete({ clientId: " ", secret: "b", env: "" })).toBe(false);
  });
});

describe("buildPlaidAdminStatus", () => {
  it("reports database as the source when only stored values exist", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "cid",
      secret: "sec",
      env: "production",
      envVars: emptyEnv,
    });
    expect(status.source).toBe("database");
    expect(status.configured).toBe(true);
    expect(status.environment).toBe("production");
    expect(status.warnings).toEqual([]);
  });

  it("lets a complete env pair take over and says so", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "stored",
      secret: "stored",
      env: "sandbox",
      envVars: { clientId: "env-id", secret: "env-secret", env: "production" },
    });
    expect(status.source).toBe("mixed");
    expect(status.environment).toBe("production");
    expect(status.warnings.some((w) => w.includes("override the values stored below"))).toBe(true);
  });

  it("reports environment as the source when nothing is stored", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "",
      secret: "",
      env: "",
      envVars: { clientId: "env-id", secret: "env-secret", env: "production" },
    });
    expect(status.source).toBe("environment");
    expect(status.configured).toBe(true);
  });

  it("warns and falls back to stored values when only half the env pair is set", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "stored",
      secret: "stored",
      env: "production",
      envVars: { clientId: "env-id", secret: "", env: "sandbox" },
    });
    expect(status.source).toBe("database");
    expect(status.environment).toBe("production");
    expect(status.warnings.some((w) => w.includes("Only one of PLAID_CLIENT_ID"))).toBe(true);
  });

  it("warns when enabled but not configured", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "",
      secret: "",
      env: "",
      envVars: emptyEnv,
    });
    expect(status.configured).toBe(false);
    expect(status.source).toBe("none");
    expect(status.warnings.some((w) => w.includes("client ID or secret is missing"))).toBe(true);
  });

  it("surfaces a decrypt failure instead of the missing-credential warning", () => {
    // A rotated SERVER_SETTINGS_ENCRYPTION_KEY must read as "unreadable", not "unset" —
    // telling the operator to re-enter credentials would hide the real cause.
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "",
      secret: "",
      env: "",
      decryptFailedKeys: ["plaid.clientId", "plaid.secret"],
      envVars: emptyEnv,
    });
    expect(status.warnings[0]).toContain("failed to decrypt");
    expect(status.warnings.some((w) => w.includes("client ID or secret is missing"))).toBe(false);
  });

  it("flags a configured sandbox so nobody mistakes fake data for real", () => {
    const status = buildPlaidAdminStatus({
      enabled: "true",
      clientId: "cid",
      secret: "sec",
      env: "sandbox",
      envVars: emptyEnv,
    });
    expect(status.warnings.some((w) => w.includes("sandbox"))).toBe(true);
  });

  it("stays quiet while Plaid is turned off", () => {
    const status = buildPlaidAdminStatus({
      enabled: "false",
      clientId: "",
      secret: "",
      env: "",
      envVars: emptyEnv,
    });
    expect(status.enabledRequested).toBe(false);
    expect(status.warnings).toEqual([]);
  });
});
