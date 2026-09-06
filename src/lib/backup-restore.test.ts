import { describe, expect, it } from "vitest";
import { resolveBackupUserProfileFields } from "@/lib/backup-restore";

describe("resolveBackupUserProfileFields", () => {
  it("never applies role or passwordHash from backup", () => {
    const result = resolveBackupUserProfileFields({
      currentUser: { role: "USER", passwordHash: "current-hash" },
      parsedUser: {
        displayName: "Imported Name",
        timezone: "America/Vancouver",
        countryCode: "US",
        emailVerifiedAt: null,
        role: "SERVER_ADMIN",
        passwordHash: "evil-hash",
      },
    });

    expect(result.role).toBe("USER");
    expect(result.passwordHash).toBe("current-hash");
    expect(result.displayName).toBe("Imported Name");
    expect(result.timezone).toBe("America/Vancouver");
    expect(result.countryCode).toBe("US");
  });

  it("keeps admin role when importer is already admin", () => {
    const result = resolveBackupUserProfileFields({
      currentUser: { role: "SERVER_ADMIN", passwordHash: "admin-hash" },
      parsedUser: {
        displayName: "Admin",
        timezone: "America/Toronto",
        countryCode: "CA",
        emailVerifiedAt: "2026-01-15T12:00:00.000Z",
        role: "USER",
        passwordHash: "downgrade-hash",
      },
    });

    expect(result.role).toBe("SERVER_ADMIN");
    expect(result.passwordHash).toBe("admin-hash");
    expect(result.emailVerifiedAt).toEqual(new Date("2026-01-15T12:00:00.000Z"));
  });
});
