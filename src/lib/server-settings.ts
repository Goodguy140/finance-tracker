import type { PrismaClient } from "@prisma/client";
import { encryptSecret, tryDecryptSecret } from "@/lib/security";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Read/write helpers for the `ServerSetting` key/value table.
 *
 * Every value is encrypted at rest, booleans included, because the table also holds OAuth
 * client secrets and a single code path is easier to keep honest than two. Reads use
 * `tryDecryptSecret`, which returns null rather than throwing after the encryption key is
 * rotated — a rotated key must degrade to "unset", not to a 500 on every page.
 */
export async function getServerSetting(
  key: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<string | null> {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return null;
  return tryDecryptSecret(row.encryptedValue);
}

/** Booleans are stored as the strings "true"/"false"; anything else reads as false. */
export async function getServerSettingBoolean(
  key: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<boolean> {
  return (await getServerSetting(key, prisma)) === "true";
}

export async function setServerSetting(
  key: string,
  value: string,
  updatedByUserId: string | null,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  const encryptedValue = encryptSecret(value);
  await prisma.serverSetting.upsert({
    where: { key },
    create: { key, encryptedValue, updatedByUserId },
    update: { encryptedValue, updatedByUserId },
  });
}
