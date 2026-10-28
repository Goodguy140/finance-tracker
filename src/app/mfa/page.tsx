import { redirect } from "next/navigation";
import { MfaVerify } from "@/components/mfa/mfa-verify";
import { requireSessionUser, safeNextPath } from "@/lib/session";
import { countUnusedRecoveryCodes } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ next?: string | string[] }>;

/**
 * The second-factor wall. A login lands here from `requireUser()` when the account has a
 * passkey or an authenticator app but this session has not used one yet. Deliberately *not* behind `requireUser` —
 * that would loop — and it bounces straight through when there is nothing to verify, so a
 * Back button cannot trap an already-verified user here.
 */
export default async function MfaPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const loaded = await requireSessionUser();
  if (!loaded.mfa.required || loaded.mfa.verified) redirect(next);

  const recoveryCodesRemaining = await countUnusedRecoveryCodes(loaded.user.id);

  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Confirm it&rsquo;s you</h1>
      <MfaVerify
        next={next}
        email={loaded.user.email}
        recoveryCodesRemaining={recoveryCodesRemaining}
        factors={{ passkey: loaded.mfa.passkeyCount > 0, totp: loaded.mfa.totp }}
      />
    </main>
  );
}
