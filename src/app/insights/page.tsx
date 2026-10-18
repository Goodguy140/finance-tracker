import { CategoryKind } from "@prisma/client";
import Link from "next/link";
import { setHabitDetectionAction } from "@/app/actions";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { TagFilterSelect } from "@/components/expense-log";
import { FinancialScoreCard } from "@/components/financial-score-card";
import { SavingsGoalsCard } from "@/components/savings-goals-card";
import { InsightItem, type InsightFormOptions, type InsightItemView } from "@/components/insights/insight-item";
import { ServerActionForm } from "@/components/server-action-form";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { loadInsights } from "@/lib/insights/load";
import type { InsightSection } from "@/lib/insights/types";
import { insightViews } from "@/lib/insights/view";
import { formatCurrency } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { requireUser } from "@/lib/session";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SECTIONS: Array<{ id: InsightSection; title: string; description: string; empty: string }> = [
  {
    id: "recurring",
    title: "Recurring charges we noticed",
    description: "Transactions that repeat on a schedule but have no recurring entry yet.",
    empty: "Nothing new — everything that repeats is already tracked.",
  },
  {
    id: "habit",
    title: "Spending habits",
    description:
      "Tobacco and vaping, cannabis, alcohol, gambling and in-game purchases over the last 90 days. Only you can see this.",
    empty: "Nothing to flag in the last 90 days.",
  },
  {
    id: "saving",
    title: "Ways to save",
    description: "Price rises, overlapping services, possible double charges, fees and purchases that add up.",
    empty: "No obvious savings right now.",
  },
  {
    id: "improvement",
    title: "Suggestions",
    description: "Where your financial score could rise, how the last few months compare, and where a budget or a rule would help.",
    empty: "No suggestions right now.",
  },
];

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tags = await listTags(prisma, user.id);
  // `?tag=`, as on the dashboard and Reports: every insight is worked out from tagged rows only.
  const tagFilter = resolveTagFilter(sp.tag, tags);
  const [loaded, accounts, categories, financial, savingsGoals] = await Promise.all([
    loadInsights(user.id, user.countryCode, user.timezone, tagFilter?.id ?? null),
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    loadFinancialScore(user),
    loadSavingsGoals(user),
  ]);
  const { visible, dismissed } = insightViews(loaded);
  const options: InsightFormOptions = {
    accounts: accounts.map((a) => ({ id: a.id, name: `${a.name} (${formatAccountTypeLabel(a.type)})` })),
    expenseCategories: categories.filter((c) => c.kind === CategoryKind.EXPENSE).map((c) => ({ id: c.id, name: c.name })),
    incomeCategories: categories.filter((c) => c.kind === CategoryKind.INCOME).map((c) => ({ id: c.id, name: c.name })),
    expenseCategoryNames: categories.filter((c) => c.kind === CategoryKind.EXPENSE).map((c) => c.name),
    currency: loaded.currency,
  };
  // What the suggestions would save, not what the flagged spending costs: each idea saves a
  // share of its spending, and the detectors leave out money another idea already counts.
  const potentialAnnual = visible.reduce((sum, i) => sum + (i.savingCents ?? 0), 0);

  const bySection = new Map<InsightSection, InsightItemView[]>();
  for (const insight of visible) bySection.set(insight.section, [...(bySection.get(insight.section) ?? []), insight]);

  return (
    <>
    <AppNav displayName={user.displayName} countryCode={user.countryCode} tagId={tagFilter?.id} />
    <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Insights</h1>
        <p className="mt-1 text-sm text-slate-400">
          Worked out from your last year of transactions, on this server. Nothing is sent anywhere.
        </p>
      </div>

      <FinancialScoreCard
        score={financial.score}
        note={tags.length ? "It doesn't change with the tag below" : undefined}
        // Listed with the insights below, except under a tag, which they are not worked out for.
        showSuggestions={!!tagFilter}
      />

      <SavingsGoalsCard goals={savingsGoals.goals} />

      {tags.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-400" data-testid="insights-tag-note">
            {tagFilter ? (
              <>
                Showing only entries tagged <span className="text-slate-200">#{tagFilter.name}</span>.{" "}
                <Link href="/insights" className="text-sky-300 underline-offset-2 hover:underline">
                  Show all
                </Link>
              </>
            ) : (
              "Pick a tag to see insights for just those entries."
            )}
          </p>
          <TagFilterSelect tags={tags} selectedId={tagFilter?.id ?? null} className="block w-40 shrink-0" />
        </div>
      ) : null}

      {potentialAnnual > 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300" data-testid="insights-summary">
          The ideas below could save about{" "}
          <span className="font-semibold text-slate-100">{formatCurrency(potentialAnnual, loaded.currency)}</span> a year.
        </p>
      ) : null}

      {SECTIONS.map((section) => {
        if (section.id === "habit" && !loaded.habitsEnabled) return null;
        const items = bySection.get(section.id) ?? [];
        return (
          <section
            key={section.id}
            aria-labelledby={`insights-${section.id}`}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5"
          >
            <header className="mb-3">
              <h2 id={`insights-${section.id}`} className="text-lg font-semibold">
                {section.title}
                {items.length ? <span className="ml-2 text-sm font-normal text-slate-500">{items.length}</span> : null}
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">{section.description}</p>
            </header>
            {items.length ? (
              <ul className="space-y-2.5">
                {items.map((insight) => (
                  <InsightItem key={insight.key} insight={insight} options={options} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{section.empty}</p>
            )}
          </section>
        );
      })}

      <section aria-labelledby="insights-preferences" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5">
        <h2 id="insights-preferences" className="text-lg font-semibold">
          Preferences
        </h2>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400">
            Habit spending insights are{" "}
            <span className="font-medium text-slate-200" data-testid="habit-detection-state">
              {loaded.habitsEnabled ? "on" : "off"}
            </span>
            . When off, those purchases are not analysed at all.
          </p>
          <ServerActionForm action={setHabitDetectionAction}>
            <input type="hidden" name="enabled" value={loaded.habitsEnabled ? "false" : "true"} />
            <button
              type="submit"
              className="touch-manipulation inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              {loaded.habitsEnabled ? "Turn off habit insights" : "Turn on habit insights"}
            </button>
          </ServerActionForm>
        </div>
      </section>

      {dismissed.length ? (
        <details className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-300">
            Dismissed and snoozed ({dismissed.length})
          </summary>
          <ul className="mt-3 space-y-2.5">
            {dismissed.map((insight) => (
              <InsightItem key={insight.key} insight={insight} options={options} />
            ))}
          </ul>
        </details>
      ) : null}
    </main>
    </>
  );
}
