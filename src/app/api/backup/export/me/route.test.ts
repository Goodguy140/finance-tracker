import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/session", () => ({
  requireUserApiUser: vi.fn(),
}));

vi.mock("@/lib/backup", () => ({
  buildUserBackupPayload: vi.fn(async () => ({
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    user: { email: "u@example.com", passwordHash: null, role: "USER" },
  })),
}));

vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { user_backup_exported: "user_backup_exported" },
  recordAuditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

const { requireUserApiUser } = await import("@/lib/session");
const { GET } = await import("./route");

describe("GET /api/backup/export/me", () => {
  beforeEach(() => {
    vi.mocked(requireUserApiUser).mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUserApiUser).mockResolvedValue({ status: 401 });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns JSON attachment when authenticated", async () => {
    vi.mocked(requireUserApiUser).mockResolvedValue({
      status: "ok",
      user: { id: "u1", email: "u@example.com" } as never,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const body = await res.json();
    expect(body.user.passwordHash).toBeNull();
  });
});
