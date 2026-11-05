import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json, plus the app's home server: the one server whose passkeys the app may use for Face ID
 * sign-in (`src/utils/home-server.ts`). Its domain comes from `HOME_SERVER_DOMAIN`, set on expo.dev
 * as a plain-text or sensitive variable of the production environment, so it is never written in
 * this repository. A build without it signs in to every server through the web page, as before.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const home = homeServerDomain(process.env.HOME_SERVER_DOMAIN);
  return {
    ...(config as ExpoConfig),
    ios: {
      ...config.ios,
      // applinks: lets the server's https addresses open the app, for bank sign-ins that
      // finish on the bank's own site. Listed now so that needs no new capability later.
      ...(home ? { associatedDomains: [`webcredentials:${home}`, `applinks:${home}`] } : {}),
    },
    extra: { ...config.extra, homeServerDomain: home ?? '' },
  };
};

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

/**
 * `HOME_SERVER_DOMAIN` as a bare domain name, or null when it is not set. A pasted address is
 * accepted (`https://finances.example.com/`); anything else stops the build, because a build
 * that dropped its home server would quietly lose Face ID sign-in.
 *
 * Here rather than in src/: Expo loads this file on its own when building, and it cannot import
 * the app's TypeScript.
 */
export function homeServerDomain(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return null;
  const domain = trimmed
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
  if (!DOMAIN.test(domain) || /^[\d.]+$/.test(domain)) {
    throw new Error(`HOME_SERVER_DOMAIN must be a domain name such as finances.example.com, not "${raw}".`);
  }
  return domain;
}
