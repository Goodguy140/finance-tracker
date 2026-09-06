import { UserRole } from "@prisma/client";

/**
 * Who may create an account, and who becomes the first admin. Shared by the password
 * signup action and the OAuth sign-in path so both apply exactly the same rules — they
 * used to drift (OAuth ignored `INITIAL_ADMIN_EMAIL`).
 */

export function publicSignupAllowed(): boolean {
  const value = process.env.ALLOW_PUBLIC_SIGNUP?.trim().toLowerCase();
  if (value === undefined) {
    return process.env.NODE_ENV !== "production";
  }
  return value === "true" || value === "1";
}

/**
 * The first account on a fresh instance becomes SERVER_ADMIN, unless `INITIAL_ADMIN_EMAIL`
 * is set, in which case only that address does. Everyone after the first is a USER.
 */
export function resolveSignupRole(email: string, existingUserCount: number): UserRole {
  if (existingUserCount > 0) return UserRole.USER;
  const initialAdmin = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!initialAdmin) return UserRole.SERVER_ADMIN;
  return email.toLowerCase() === initialAdmin ? UserRole.SERVER_ADMIN : UserRole.USER;
}
