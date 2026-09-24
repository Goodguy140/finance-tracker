/**
 * Status of one bank connection. Same tone-map shape as `account-type-pill.tsx`, which is
 * the established pattern here for a small coloured state chip.
 */
const statusTone: Record<string, string> = {
  ACTIVE: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
  LOGIN_REQUIRED: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  ERROR: "border-red-500/40 bg-red-500/12 text-red-100",
  REMOVED: "border-slate-500/40 bg-slate-500/10 text-slate-200",
};

const statusLabel: Record<string, string> = {
  ACTIVE: "Connected",
  LOGIN_REQUIRED: "Sign-in needed",
  ERROR: "Error",
  REMOVED: "Disconnected",
};

const defaultTone = "border-slate-600 bg-slate-800/70 text-slate-200";

/**
 * `needsAttention` covers what a working connection can still ask for — renewing consent
 * before it lapses, sharing new accounts — so "Connected" never sits beside a warning.
 */
export function PlaidStatusPill({ status, needsAttention = false }: { status: string; needsAttention?: boolean }) {
  const label = status === "ACTIVE" && needsAttention ? "Action needed" : (statusLabel[status] ?? status);
  const tone = status === "ACTIVE" && needsAttention ? statusTone.LOGIN_REQUIRED : (statusTone[status] ?? defaultTone);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-tight tracking-wide sm:text-xs ${tone}`}
    >
      {label}
    </span>
  );
}
