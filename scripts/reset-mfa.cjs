#!/usr/bin/env node
/**
 * Break-glass: strip every passkey and recovery code from one account and sign it out
 * everywhere, so the owner can get back in with their password (or a password reset)
 * and enrol a new passkey. Needs shell access to the deployment — that is the point.
 *
 *   node scripts/reset-mfa.cjs user@example.com
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("usage: node scripts/reset-mfa.cjs <email>");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`reset-mfa: no user with email ${email}`);
      process.exit(1);
    }
    const [passkeys, codes] = await prisma.$transaction([
      prisma.webAuthnCredential.deleteMany({ where: { userId: user.id } }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.mfaChallenge.deleteMany({ where: { userId: user.id } }),
      // Every open session may belong to whoever prompted this reset; make them all log in again.
      prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "mfa_reset_by_script",
          targetType: "User",
          targetId: user.id,
          metadataJson: JSON.stringify({ via: "scripts/reset-mfa.cjs" }),
        },
      }),
    ]);
    console.log(
      `reset-mfa: removed ${passkeys.count} passkey(s) and ${codes.count} recovery code(s) for ${email}; all sessions revoked.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("reset-mfa failed:", err);
  process.exit(1);
});
