import { AuthentikProvider } from "@/lib/authentik-provider";
import { normalizeAuthentikIssuer } from "@/lib/oauth-settings";
import { decryptSecret } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import GoogleProvider from "next-auth/providers/google";
import type { Provider } from "next-auth/providers/index";

async function getServerSetting(key: string) {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return decryptSecret(row.encryptedValue);
  } catch {
    return null;
  }
}

export async function getGoogleProvider(): Promise<Provider | null> {
  const [enabled, clientId, clientSecret] = await Promise.all([
    getServerSetting("oauth.google.enabled"),
    getServerSetting("oauth.google.clientId"),
    getServerSetting("oauth.google.clientSecret"),
  ]);
  if (enabled !== "true" || !clientId || !clientSecret) return null;
  return GoogleProvider({ clientId, clientSecret });
}

export async function getAuthentikProvider(): Promise<Provider | null> {
  const envIssuer = process.env.AUTHENTIK_ISSUER?.trim();
  const envClientId = process.env.AUTHENTIK_CLIENT_ID?.trim();
  const envClientSecret = process.env.AUTHENTIK_CLIENT_SECRET?.trim();
  const envEnabled = process.env.AUTHENTIK_ENABLED?.trim().toLowerCase();

  if (envIssuer && envClientId && envClientSecret) {
    if (envEnabled === "false" || envEnabled === "0") return null;
    return AuthentikProvider({
      issuer: normalizeAuthentikIssuer(envIssuer),
      clientId: envClientId,
      clientSecret: envClientSecret,
    });
  }

  const [enabled, issuer, clientId, clientSecret] = await Promise.all([
    getServerSetting("oauth.authentik.enabled"),
    getServerSetting("oauth.authentik.issuer"),
    getServerSetting("oauth.authentik.clientId"),
    getServerSetting("oauth.authentik.clientSecret"),
  ]);

  if (enabled !== "true" || !issuer || !clientId || !clientSecret) return null;
  return AuthentikProvider({
    issuer: normalizeAuthentikIssuer(issuer),
    clientId,
    clientSecret,
  });
}
