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

/** The slice of a Prisma client (or transaction) the role rule reads. */
type UserCounter = {
  user: { count(args?: { where?: { role?: UserRole } }): Promise<number> };
};

/**
 * The first account on a fresh instance becomes SERVER_ADMIN, unless `INITIAL_ADMIN_EMAIL`
 * is set. Then only that address does, and it does whenever it signs up while the instance
 * has no admin yet, even if other accounts were created first (signup opened early, before
 * the owner got there). Everyone else is a USER.
 *
 * Call it inside the same transaction that creates the user, so two concurrent first
 * signups cannot both read "no admin yet".
 */
export async function resolveSignupRole(db: UserCounter, email: string): Promise<UserRole> {
  const initialAdmin = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!initialAdmin) {
    return (await db.user.count()) === 0 ? UserRole.SERVER_ADMIN : UserRole.USER;
  }
  if (email.toLowerCase() !== initialAdmin) return UserRole.USER;
  const admins = await db.user.count({ where: { role: UserRole.SERVER_ADMIN } });
  return admins === 0 ? UserRole.SERVER_ADMIN : UserRole.USER;
}
