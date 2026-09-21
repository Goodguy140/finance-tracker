/**
 * The Verified badge on a transaction.
 *
 * One badge for both cases — a row imported from the bank, and a row the user typed that
 * they later linked to a bank record. Matching your own entry against the bank *is* the
 * authenticity check, so distinguishing them visually would add noise to every line of the
 * log for a difference that only matters if you go looking. The distinction lives in the
 * tooltip instead.
 */

export type VerificationInfo = {
  source: "IMPORTED" | "MATCHED";
  institutionName: string | null;
  verifiedAtDisplay: string;
  /** The bank later withdrew the record. The transaction itself is never deleted. */
  removedByPlaid: boolean;
  /** The bank connection was disconnected. */
  itemRemoved: boolean;
};

export function verificationTooltip(info: VerificationInfo): string {
  const bank = info.institutionName ?? "your bank";
  const base =
    info.source === "IMPORTED"
      ? `Imported from ${bank}`
      : `Matched to ${bank} on ${info.verifiedAtDisplay}`;
  if (info.removedByPlaid) return `${base} — the bank later removed this record`;
  if (info.itemRemoved) return `${base} (link removed)`;
  return base;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none">
      <path
        d="M3 8.5l3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * `chip` is the bordered pill; `text` is the same mark as bare text, for the compact log
 * layout where a pill on every line would undo the density that layout exists for.
 */
export type VerifiedBadgeVariant = "chip" | "text";

export function VerifiedBadge({
  info,
  variant = "chip",
}: {
  info: VerificationInfo;
  variant?: VerifiedBadgeVariant;
}) {
  // A withdrawn or disconnected record is still verified — it happened — but the badge
  // should not imply a link that is no longer there.
  const stale = info.removedByPlaid || info.itemRemoved;
  const tone = stale
    ? "border-slate-500/40 bg-slate-500/10 text-slate-300"
    : "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
  const tooltip = verificationTooltip(info);
  if (variant === "text") {
    return (
      <span
        title={tooltip}
        className={`inline-flex max-w-full items-center gap-1 text-[10px] font-medium leading-tight ${
          stale ? "text-slate-400" : "text-emerald-300/95"
        }`}
      >
        <CheckIcon />
        <span>Verified</span>
      </span>
    );
  }
  return (
    <span
      // `title` is the same tooltip mechanism MetaChip already uses, so this needs no
      // popover dependency. It never fires on touch, which is why the mobile card also
      // renders this text in its meta line.
      title={tooltip}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-tight sm:text-xs ${tone}`}
    >
      <CheckIcon />
      <span>Verified</span>
    </span>
  );
}
