import type { UserRole } from "@prisma/client";

export type BackupUserProfileRestore = {
  displayName: string;
  timezone: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  role: UserRole;
  passwordHash: string | null;
};

type ParsedBackupUser = {
  displayName: string;
  timezone: string;
  countryCode: string;
  emailVerifiedAt: string | null;
  role: UserRole;
  passwordHash: string | null;
};

/** Profile fields safe to apply from a backup; role and password never come from the file. */
export function resolveBackupUserProfileFields(params: {
  currentUser: { role: UserRole; passwordHash: string | null };
  parsedUser: ParsedBackupUser;
}): BackupUserProfileRestore {
  const { currentUser, parsedUser } = params;
  return {
    displayName: parsedUser.displayName,
    timezone: parsedUser.timezone,
    countryCode: parsedUser.countryCode,
    emailVerifiedAt: parsedUser.emailVerifiedAt ? new Date(parsedUser.emailVerifiedAt) : null,
    role: currentUser.role,
    passwordHash: currentUser.passwordHash,
  };
}

export type BackupAuthAccountRow = {
  provider: string;
  providerAccountId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  tokenType: string | null;
  scope: string | null;
  idToken: string | null;
  createdAt: string;
  updatedAt: string;
};

/** OAuth secrets from backups are not re-applied on import. */
export function sanitizeAuthAccountsForImport<T extends BackupAuthAccountRow>(accounts: T[]): T[] {
  return accounts.map((row) => ({
    ...row,
    accessToken: null,
    refreshToken: null,
    idToken: null,
  }));
}
