import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth-options", () => ({ getAuthOptions: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { mfaRedirectPath, safeNextPath, MfaStepUpRequiredError } = await import("./session");

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/settings?tab=x")).toBe("/settings?tab=x");
  });

  it("refuses protocol-relative and absolute destinations", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("settings")).toBe("/");
  });

  it("never loops back onto the wall or the login page", () => {
    expect(safeNextPath("/mfa")).toBe("/");
    expect(safeNextPath("/mfa?next=%2F")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("mfaRedirectPath", () => {
  it("omits next for the root and encodes everything else", () => {
    expect(mfaRedirectPath("/")).toBe("/mfa");
    expect(mfaRedirectPath(null)).toBe("/mfa");
    expect(mfaRedirectPath("/settings?x=1")).toBe("/mfa?next=%2Fsettings%3Fx%3D1");
  });
});

describe("MfaStepUpRequiredError", () => {
  it("carries a machine-readable code for the client", () => {
    expect(new MfaStepUpRequiredError("mfa_step_up").code).toBe("mfa_step_up");
    expect(new MfaStepUpRequiredError("mfa_required").message).toMatch(/passkey/i);
  });
});
