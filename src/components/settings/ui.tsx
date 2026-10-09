import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { FieldHintModeProvider } from "@/components/forms/shared";
import { getSettingsSection, type SettingsSectionId } from "@/lib/settings-sections";

/**
 * The frame of every Settings page: a back link on phones (where there is no sidebar), the
 * section's name and one-line summary, and its primary actions on the right. The page is a
 * region named after its title, which is also how tests find it.
 */
export function SettingsPage({
  section,
  actions,
  children,
}: {
  section: SettingsSectionId;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { label, summary } = getSettingsSection(section);
  const headingId = `settings-${section}-heading`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-5">
      <Link
        href="/settings"
        className="-ml-1 inline-flex items-center gap-0.5 text-sm text-blue-300 hover:text-blue-200 lg:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Settings
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            {label}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{summary}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {/* Field hints fold behind a "?" here, as they always have in Settings. */}
      <FieldHintModeProvider mode="info">{children}</FieldHintModeProvider>
    </section>
  );
}

/** One group of settings on a page. Flat on purpose: a border, no gradient, no icon. */
export function SettingsCard({
  title,
  description,
  actions,
  children,
  id,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  tone?: "default" | "danger";
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={`scroll-mt-24 space-y-4 rounded-xl border p-4 sm:p-5 ${
        tone === "danger" ? "border-red-900/60 bg-red-950/15" : "border-slate-800 bg-slate-900/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`text-base font-semibold ${tone === "danger" ? "text-red-300" : "text-slate-100"}`}>{title}</h3>
          {description ? <p className="mt-0.5 max-w-prose text-sm text-slate-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Something most people never need, folded to one line that says what is inside and how
 * many. Native <details>, so it works before hydration and needs no state.
 */
export function SettingsFold({
  title,
  meta,
  children,
  defaultOpen,
  id,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  return (
    <details id={id} open={defaultOpen} className="group scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm text-slate-300 transition hover:bg-slate-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-slate-500 transition group-open:rotate-90">
          ›
        </span>
        <span className="font-medium text-slate-200">{title}</span>
        {meta ? <span className="text-xs text-slate-500">{meta}</span> : null}
      </summary>
      <div className="space-y-4 border-t border-slate-800 px-4 pb-4 pt-4">{children}</div>
    </details>
  );
}
