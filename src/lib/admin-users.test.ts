import { describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { countActiveAdmins, describeUserMutationRefusal, listUsersForAdmin } from "./admin-users";

const ACTOR = "admin-1";

function target(overrides: Partial<{ id: string; role: UserRole; disabledAt: Date | null }> = {}) {
  return { id: "u2", role: UserRole.USER, disabledAt: null, ...overrides };
}

describe("describeUserMutationRefusal", () => {
  it("allows an ordinary change against another account", () => {
    expect(
      describeUserMutationRefusal({ actorId: ACTOR, target: target(), intent: "disable", activeAdminCount: 1 }),
    ).toBeNull();
  });

  it.each(["demote", "disable", "delete"] as const)("refuses %s against your own account", (intent) => {
    const refusal = describeUserMutationRefusal({
      actorId: ACTOR,
      target: target({ id: ACTOR, role: UserRole.SERVER_ADMIN }),
      intent,
      activeAdminCount: 5,
    });
    expect(refusal).toContain("cannot");
  });

  it("refuses to remove the last admin who can still sign in", () => {
    for (const intent of ["demote", "disable", "delete"] as const) {
      const refusal = describeUserMutationRefusal({
        actorId: ACTOR,
        target: target({ id: "u2", role: UserRole.SERVER_ADMIN }),
        intent,
        activeAdminCount: 1,
      });
      expect(refusal).toContain("only server admin");
    }
  });

  it("allows removing an admin while another can still sign in", () => {
    expect(
      describeUserMutationRefusal({
        actorId: ACTOR,
        target: target({ role: UserRole.SERVER_ADMIN }),
        intent: "demote",
        activeAdminCount: 2,
      }),
    ).toBeNull();
  });

  it("does not count an already-suspended admin toward the last-admin guard", () => {
    // Otherwise the count includes someone who cannot sign in, and suspending the last
    // working admin would be allowed on the strength of a suspended one.
    expect(
      describeUserMutationRefusal({
        actorId: ACTOR,
        target: target({ role: UserRole.SERVER_ADMIN, disabledAt: new Date() }),
        intent: "delete",
        activeAdminCount: 1,
      }),
    ).toBeNull();
  });
});

describe("countActiveAdmins", () => {
  it("counts only admins that are not suspended", async () => {
    const count = vi.fn().mockResolvedValue(2);
    await countActiveAdmins({ user: { count } } as never);
    expect(count).toHaveBeenCalledWith({ where: { role: "SERVER_ADMIN", disabledAt: null } });
  });
});

describe("listUsersForAdmin", () => {
  it("flattens sign-in methods and serialises dates", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "u1",
        email: "a@example.com",
        displayName: "A",
        role: UserRole.SERVER_ADMIN,
        disabledAt: null,
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        passwordHash: "hashed",
        authAccounts: [{ provider: "google" }, { provider: "google" }, { provider: "authentik" }],
        _count: { webAuthnCredentials: 2 },
        personalAccessTokens: [{ id: "t1" }],
      },
      {
        id: "u2",
        email: "b@example.com",
        displayName: "B",
        role: UserRole.USER,
        disabledAt: new Date("2026-02-03T00:00:00.000Z"),
        createdAt: new Date("2026-01-09T00:00:00.000Z"),
        passwordHash: null,
        authAccounts: [],
        _count: { webAuthnCredentials: 0 },
        personalAccessTokens: [],
      },
    ]);
    const result = await listUsersForAdmin({
      user: { findMany, count: vi.fn().mockResolvedValue(1) },
    } as never);

    expect(result.adminCount).toBe(1);
    expect(result.users[0]).toMatchObject({
      // Duplicate provider rows collapse; the list is stable for rendering.
      ssoProviders: ["authentik", "google"],
      passkeyCount: 2,
      activeTokenCount: 1,
      hasPassword: true,
      disabledAt: null,
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    expect(result.users[1]).toMatchObject({
      ssoProviders: [],
      hasPassword: false,
      disabledAt: "2026-02-03T00:00:00.000Z",
    });
  });

  it("counts only tokens that are neither revoked nor expired", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listUsersForAdmin({ user: { findMany, count: vi.fn().mockResolvedValue(0) } } as never);

    const tokenWhere = findMany.mock.calls[0][0].select.personalAccessTokens.where;
    expect(tokenWhere.revokedAt).toBeNull();
    expect(tokenWhere.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });
});
