import { afterEach, describe, expect, it } from "vitest";
import { buildAdminEnvConfig, formatEnvDisplay } from "./admin-env-config";

const saved: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const key of Object.keys(saved)) delete saved[key];
});

describe("buildAdminEnvConfig", () => {
  it("never exposes secret values", () => {
    setEnv("NEXTAUTH_SECRET", "super-secret-value-32chars-long");
    setEnv("SERVER_SETTINGS_ENCRYPTION_KEY", "encryption-key-32-characters-min");
    setEnv("AUTHENTIK_CLIENT_SECRET", "authentik-secret");
    setEnv("SMTP_PASS", "mail-pass");

    const entries = buildAdminEnvConfig();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("encryption-key-32");
    expect(serialized).not.toContain("authentik-secret");
    expect(serialized).not.toContain("mail-pass");

    const nextAuth = entries.find((e) => e.name === "NEXTAUTH_SECRET");
    expect(nextAuth?.display).toEqual({ kind: "presence", presence: "present" });
    expect(formatEnvDisplay(nextAuth!.display)).toBe("set (hidden)");
  });

  it("shows safe public values", () => {
    setEnv("NODE_ENV", "test");
    setEnv("ALLOW_PUBLIC_SIGNUP", "false");
    setEnv("AUTHENTIK_ISSUER", "https://auth.example.com/application/o/foo/");

    const entries = buildAdminEnvConfig();
    expect(entries.find((e) => e.name === "NODE_ENV")?.display).toEqual({ kind: "value", value: "test" });
    expect(entries.find((e) => e.name === "ALLOW_PUBLIC_SIGNUP")?.display).toEqual({
      kind: "value",
      value: "false",
    });
    expect(entries.find((e) => e.name === "AUTHENTIK_ISSUER")?.display).toEqual({
      kind: "value",
      value: "https://auth.example.com/application/o/foo/",
    });
  });

  it("summarizes DATABASE_URL without credentials", () => {
    setEnv("DATABASE_URL", "file:./dev.db?cache=shared");
    const entry = buildAdminEnvConfig().find((e) => e.name === "DATABASE_URL");
    expect(entry?.display).toEqual({ kind: "database", label: "dev.db" });
  });
});
