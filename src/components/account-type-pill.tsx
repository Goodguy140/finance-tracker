import { formatAccountTypeLabel } from "@/lib/account-type-labels";

const typeTone: Record<string, string> = {
  CHEQUING: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
  SAVINGS: "border-sky-500/35 bg-sky-500/10 text-sky-100",
  CREDIT_CARD: "border-violet-500/40 bg-violet-500/12 text-violet-100",
  TFSA: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  RRSP: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  FHSA: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  NON_REGISTERED: "border-slate-500/40 bg-slate-500/10 text-slate-200",
  CASH: "border-lime-500/35 bg-lime-500/10 text-lime-100",
};

const defaultTone = "border-slate-600 bg-slate-800/70 text-slate-200";

export function AccountTypePill({ accountType }: { accountType: string }) {
  const label = formatAccountTypeLabel(accountType);
  const tone = typeTone[accountType] ?? defaultTone;
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-tight tracking-wide sm:text-xs ${tone}`}
    >
      {label}
    </span>
  );
}
