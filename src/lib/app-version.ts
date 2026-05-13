import packageJson from "../../package.json";

/**
 * One-line string for support / debugging (login footer, etc.).
 * Optional short SHA from CI (GitHub Actions, Vercel) or APP_GIT_SHA for custom images.
 */
export function getLoginDebugVersionLine(): string {
  const parts: string[] = [`v${packageJson.version}`];
  parts.push(process.env.NODE_ENV ?? "unknown");
  const sha =
    process.env.APP_GIT_SHA?.trim().slice(0, 7) ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) ||
    process.env.GITHUB_SHA?.trim().slice(0, 7);
  if (sha) parts.push(sha);
  return parts.join(" · ");
}
