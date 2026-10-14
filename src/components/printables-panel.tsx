"use client";

import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useState } from "react";

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const selectClass =
  "block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none";
const primaryBtn =
  "touch-manipulation inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-100 transition hover:bg-sky-500/25";
const secondaryBtn =
  "touch-manipulation inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";

type Option = { value: string; label: string };

function query(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function SummaryDownload({
  periods,
  tags,
  initialPeriod,
  initialTag,
}: {
  periods: Option[];
  tags: Option[];
  initialPeriod: string;
  initialTag: string | null;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [tag, setTag] = useState(initialTag ?? "");
  const q = (extra: Record<string, string>) => query({ period: period === "12m" ? null : period, tag: tag || null, ...extra });
  return (
    <section aria-labelledby="print-summary" className={card} data-testid="print-summary">
      <h2 id="print-summary" className="text-lg font-semibold">
        Financial summary
      </h2>
      <p className="mt-0.5 text-sm text-slate-400">
        Everything in one PDF: income and spending by month and category, budgets, net worth and projected balances,
        upcoming bills, savings goals, contribution room, top payees and your financial score.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-300">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`mt-1 ${selectClass}`}>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {tags.length ? (
          <label className="text-sm text-slate-300">
            Tag
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={`mt-1 ${selectClass}`}>
              <option value="">All entries</option>
              {tags.map((t) => (
                <option key={t.value} value={t.value}>
                  #{t.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`/api/printables/summary${q({ view: "1" })}`} target="_blank" rel="noopener" className={primaryBtn} data-testid="summary-open">
          <Printer className="h-4 w-4" aria-hidden />
          Open to print
        </a>
        <a href={`/api/printables/summary${q({})}`} className={secondaryBtn} data-testid="summary-download">
          <Download className="h-4 w-4" aria-hidden />
          Download PDF
        </a>
      </div>
    </section>
  );
}

export type TemplateCardInfo = { id: string; title: string; description: string; monthly: boolean };

export function TemplateCard({ template, months }: { template: TemplateCardInfo; months: Option[] }) {
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const href = (mode: "filled" | "blank", format: "pdf" | "csv", view = false) =>
    `/api/printables/templates/${template.id}${query({
      mode,
      format,
      month: template.monthly ? month : null,
      view: view ? "1" : null,
    })}`;
  const links: Array<{ mode: "filled" | "blank"; label: string }> = [
    { mode: "filled", label: "With my data" },
    { mode: "blank", label: "Blank" },
  ];
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:p-4" data-testid={`template-${template.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-100">{template.title}</h3>
          <p className="mt-0.5 text-sm text-slate-400">{template.description}</p>
        </div>
        {template.monthly ? (
          <select
            aria-label={`Month for the ${template.title.toLowerCase()}`}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="block w-40 shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {links.map(({ mode, label }) => (
          <div key={mode} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-slate-500">{label}</span>
            <a href={href(mode, "pdf", true)} target="_blank" rel="noopener" className={secondaryBtn} data-testid={`template-${template.id}-${mode}-pdf`}>
              <FileText className="h-4 w-4" aria-hidden />
              PDF
            </a>
            <a href={href(mode, "csv")} className={secondaryBtn} data-testid={`template-${template.id}-${mode}-csv`}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              CSV
            </a>
          </div>
        ))}
      </div>
    </li>
  );
}
