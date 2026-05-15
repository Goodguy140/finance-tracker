import Link from "next/link";
import { LoginForm } from "@/components/forms";
import { getLoginDebugVersionLine } from "@/lib/app-version";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string | string[] }>;

const oauthErrorMessages: Record<string, string> = {
  google:
    "Google sign-in is not available right now. Ask an admin to enable Google OAuth client settings in the app.",
  authentik:
    "SSO sign-in is not available right now. Ask an admin to enable Authentik OIDC settings or set AUTHENTIK_* env vars.",
  OAuthSignin: "SSO sign-in could not be started. Check NEXTAUTH_URL and your provider redirect URIs.",
  OAuthCallback:
    "SSO callback failed (often wrong redirect_uri or lost OAuth cookies). Retry sign-in; if you use a tunnel, set AUTH_TRUST_HOST=true and restart.",
  OAuthCreateAccount: "Could not create your account from SSO.",
  AccessDenied: "Sign-in was denied.",
  Configuration: "Auth is misconfigured (for example NEXTAUTH_SECRET or OAuth client settings).",
  Callback: "Something went wrong during the OAuth callback.",
  Default: "Sign-in failed. Try again or use email and password.",
};

function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return oauthErrorMessages[code] ?? oauthErrorMessages.Default;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.error;
  const errorCode = Array.isArray(raw) ? raw[0] : raw;
  const errorMessage = loginErrorMessage(errorCode);

  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Login</h1>
      {errorMessage ? (
        <p className="mb-4 rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {errorMessage}
          {errorCode ? (
            <span className="mt-1 block text-xs text-amber-200/70">(code: {errorCode})</span>
          ) : null}
        </p>
      ) : null}
      <LoginForm />
      <div className="mt-4 space-y-1 text-sm text-slate-400">
        <p>
          No account? <Link href="/signup" className="font-medium text-blue-300 hover:text-blue-200 underline">Sign up</Link>
        </p>
        <p>
          Forgot password? <Link href="/forgot-password" className="font-medium text-blue-300 hover:text-blue-200 underline">Reset it</Link>
        </p>
      </div>
      <p
        className="mt-6 border-t border-slate-800/80 pt-3 text-center font-mono text-[11px] leading-snug text-slate-500"
        title="Build / environment (for support and debugging)"
      >
        {getLoginDebugVersionLine()}
      </p>
    </main>
  );
}
