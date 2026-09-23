import { UserRole } from "@prisma/client";
import { getPublicSignupAllowed, resolvePublicSignup } from "@/lib/ops-settings";

/**
 * Who may create an account, and who becomes the first admin. Shared by the password
 * signup action and the OAuth sign-in path so both apply exactly the same rules — they
 * used to drift (OAuth ignored `INITIAL_ADMIN_EMAIL`).
 */

/**
 * `ALLOW_PUBLIC_SIGNUP` decides outright when set, without touching the database; otherwise
 * the switch under Server admin → Authentication does, and with neither, signup is open in
 * development and closed in production.
 */
export async function publicSignupAllowed(): Promise<boolean> {
  const envRaw = process.env.ALLOW_PUBLIC_SIGNUP;
  if (envRaw !== undefined) {
    return resolvePublicSignup({ envRaw, storedRaw: null, nodeEnv: process.env.NODE_ENV }).value;
  }
  return getPublicSignupAllowed();
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
