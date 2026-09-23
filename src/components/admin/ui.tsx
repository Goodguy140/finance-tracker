import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Building blocks shared by every admin page. Kept deliberately small: a card, a stat
 * tile, a status dot and a badge saying where a setting's value comes from. Anything more
 * specific belongs to the page that uses it.
 */

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminSection({
  title,
  description,
  actions,
  children,
  id,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={`space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-100">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export type StatTone = "neutral" | "good" | "warn" | "bad";

const toneText: Record<StatTone, string> = {
  neutral: "text-slate-100",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-red-300",
};

export function StatTile({
  label,
  value,
  detail,
  tone = "neutral",
  href,
  children,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: StatTone;
  href?: string;
  /** Room for a sparkline under the figure. */
  children?: ReactNode;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneText[tone]}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-slate-500">{detail}</p> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </>
  );
  const cls = "block rounded-xl border border-slate-800 bg-slate-950/50 p-3";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-slate-600 hover:bg-slate-900`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type DotStatus = "ok" | "warn" | "bad" | "idle";

const dotColor: Record<DotStatus, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
  idle: "bg-slate-600",
};

export function StatusDot({ ok, status }: { ok?: boolean; status?: DotStatus }) {
  const resolved: DotStatus = status ?? (ok ? "ok" : "bad");
  return <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColor[resolved]}`} aria-hidden />;
}

export type SettingSource = "environment" | "database" | "default";

/** Where the value in effect came from. An env var always wins over a stored setting. */
export function SourceBadge({ source, envName }: { source: SettingSource; envName?: string }) {
  const styles: Record<SettingSource, string> = {
    environment: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    database: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    default: "border-slate-700 bg-slate-800/60 text-slate-300",
  };
  const label =
    source === "environment" ? `Set by ${envName ?? "environment"}` : source === "database" ? "Saved here" : "Default";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[source]}`}>
      {label}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

export const adminLinkButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700";

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diffMs = now - new Date(iso).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  let text: string;
  if (minutes < 1) text = "just now";
  else if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 60 * 48) text = `${Math.round(minutes / 60)} h`;
  else text = `${Math.round(minutes / (60 * 24))} d`;
  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}

/**
 * Horizontal bars for a ranked breakdown (one measure, one hue). The value is printed in
 * text beside every bar, so the bar only adds the at-a-glance proportion.
 */
export function BreakdownBars({
  rows,
  max,
  emptyText = "Nothing to show",
  mono = false,
}: {
  rows: { label: string; value: number; detail?: string }[];
  /** Scale bars against this instead of the largest row, e.g. the user count for adoption. */
  max?: number;
  emptyText?: string;
  mono?: boolean;
}) {
  if (rows.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  const scale = Math.max(1, max ?? Math.max(...rows.map((r) => r.value)));
  return (
    <ul className="space-y-2 text-xs">
      {rows.map((row) => (
        <li key={row.label} title={`${row.label}: ${row.value.toLocaleString()}${row.detail ? ` (${row.detail})` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className={`truncate text-slate-300 ${mono ? "font-mono text-[11px]" : ""}`}>{row.label}</span>
            <span className="shrink-0 tabular-nums text-slate-100">
              {row.value.toLocaleString()}
              {row.detail ? <span className="ml-1 text-slate-500">{row.detail}</span> : null}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden>
            <div
              className="h-full rounded-full bg-[#3987e5]"
              style={{ width: `${Math.min(100, Math.max(row.value > 0 ? 2 : 0, (row.value / scale) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
