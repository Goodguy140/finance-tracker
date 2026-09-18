import { describe, expect, it } from "vitest";
import { describeSsoOnlyRefusal, resolvePasswordLoginDisabledEnv } from "./auth-settings";

describe("resolvePasswordLoginDisabledEnv", () => {
  it("defers to the database when the env says nothing", () => {
    expect(resolvePasswordLoginDisabledEnv(undefined)).toBeNull();
    expect(resolvePasswordLoginDisabledEnv("")).toBeNull();
    expect(resolvePasswordLoginDisabledEnv("   ")).toBeNull();
  });

  it("forces password login back on for false and 0", () => {
    // This is the way back in when SSO breaks and the admin cannot reach the settings page.
    for (const raw of ["false", "FALSE", " 0 ", "0"]) {
      expect(resolvePasswordLoginDisabledEnv(raw)).toBe(false);
    }
  });

  it("treats any other present value as on, matching AUTHENTIK_ENABLED", () => {
    for (const raw of ["true", "TRUE", "1", "yes"]) {
      expect(resolvePasswordLoginDisabledEnv(raw)).toBe(true);
    }
  });
});

describe("describeSsoOnlyRefusal", () => {
  it("allows it once a provider exists and the admin has linked one", () => {
    expect(
      describeSsoOnlyRefusal({ hasOAuthProvider: true, actorHasLinkedProvider: true }),
    ).toBeNull();
  });

  it("refuses with no identity provider configured", () => {
    const refusal = describeSsoOnlyRefusal({ hasOAuthProvider: false, actorHasLinkedProvider: true });
    expect(refusal).toContain("Configure and enable");
  });

  it("refuses when the acting admin has no linked provider", () => {
    // Otherwise the admin turning this on is the first person locked out by it.
    const refusal = describeSsoOnlyRefusal({ hasOAuthProvider: true, actorHasLinkedProvider: false });
    expect(refusal).toContain("locked out");
  });

  it("reports the missing provider first when neither precondition is met", () => {
    const refusal = describeSsoOnlyRefusal({ hasOAuthProvider: false, actorHasLinkedProvider: false });
    expect(refusal).toContain("Configure and enable");
  });
});
