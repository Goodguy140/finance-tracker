import type { OAuthConfig } from "next-auth/providers/oauth";

export type AuthentikProviderOptions = {
  clientId: string;
  clientSecret: string;
  /** e.g. https://authentik.example.com/application/o/finance-tracker/ */
  issuer: string;
};

/** NextAuth provider for Authentik (OpenID Connect). */
export function AuthentikProvider(options: AuthentikProviderOptions): OAuthConfig<Record<string, unknown>> {
  const issuer = options.issuer.replace(/\/+$/, "");
  return {
    id: "authentik",
    name: "Authentik",
    type: "oauth",
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    authorization: { params: { scope: "openid email profile" } },
    idToken: true,
    checks: ["pkce", "state"],
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    profile(profile) {
      const p = profile as {
        sub?: string;
        name?: string;
        preferred_username?: string;
        email?: string;
        picture?: string;
      };
      return {
        id: p.sub ?? "",
        name: p.name ?? p.preferred_username ?? "SSO User",
        email: p.email,
        image: p.picture,
      };
    },
  };
}
