import Link from "next/link";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { ActionPlanDownload, SummaryDownload, TemplateList } from "@/components/printables-panel";
import { shiftYm } from "@/lib/dashboard-period";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { PLAN_RANGE_OPTIONS } from "@/lib/printables/action-plan";
import { printMonth } from "@/lib/printables/format";
import { EXTRA_BLANK_ROWS, EXTRA_ROW_OPTIONS, TEMPLATES } from "@/lib/printables/templates";
import { prisma } from "@/lib/prisma";
import { resolveReportPeriod, yearsWithActivity } from "@/lib/reports";
import { loadActivityBounds } from "@/lib/reports/load";
import { requireUser } from "@/lib/session";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The printable summary and the planning templates, reached from Reports. */
export default async function PrintPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currentYm = todayYmd.slice(0, 7);
  const [activityYears, tags] = await Promise.all([loadActivityBounds(user.id), listTags(prisma, user.id)]);
  // Arriving from Reports keeps the period and tag that were on screen there.
  const period = resolveReportPeriod(firstParam(sp.period), todayYmd);
  const tagFilter = resolveTagFilter(sp.tag, tags);

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} tagId={tagFilter?.id} />
      <main
        className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}
      >
        <div>
          <Link href="/reports" className="text-sm text-sky-300 hover:text-sky-200">
            Reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Print and templates</h1>
          <p className="mt-1 text-sm text-slate-400">
            PDFs to print or keep, made on this server from your data. Nothing is sent anywhere.
          </p>
        </div>

        <SummaryDownload
          periods={[
            { value: "12m", label: "Last 12 months" },
            ...yearsWithActivity(activityYears, todayYmd).map((y) => ({ value: y, label: y })),
            // Arriving from a custom range on Reports offers that range too.
            ...(period.custom ? [{ value: period.key, label: period.label }] : []),
          ]}
          tags={tags.map((t) => ({ value: t.id, label: t.name }))}
          initialPeriod={period.key}
          initialTag={tagFilter?.id ?? null}
        />

        <ActionPlanDownload ranges={PLAN_RANGE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} defaultRange="24" />

        <section aria-labelledby="print-templates" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5">
          <h2 id="print-templates" className="text-lg font-semibold">
            Templates
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Worksheets for planning. &ldquo;With my data&rdquo; fills in what the app already knows and leaves the rest for
            you to write; &ldquo;Blank&rdquo; has nothing of yours on it, so it is fine to share. CSV opens in a spreadsheet.
            A sheet that would run just past a page is drawn a little tighter to fit on one.
          </p>
          <TemplateList
            templates={[...TEMPLATES]}
            months={[currentYm, shiftYm(currentYm, 1)].map((ym) => ({ value: ym, label: printMonth(ym) }))}
            rowOptions={EXTRA_ROW_OPTIONS}
            defaultRows={EXTRA_BLANK_ROWS}
          />
        </section>
      </main>
    </>
  );
}
