import Link from "next/link";
import { AdminTimeseriesChart } from "@/components/admin/admin-charts";
import { AdminPageHeader, AdminSection, BreakdownBars, StatTile } from "@/components/admin/ui";
import {
  ANALYTICS_RANGES,
  getAdminAdoptionStats,
  getAdminAnalyticsSeries,
  parseAnalyticsRange,
  type AnalyticsRange,
} from "@/lib/admin-analytics-series";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function RangePicker({ current }: { current: AnalyticsRange }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex rounded-lg border border-slate-700 p-0.5">
      {ANALYTICS_RANGES.map((range) => {
        const active = range === current;
        return (
          <Link
            key={range}
            href={range === 30 ? "/settings/admin/analytics" : `/settings/admin/analytics?range=${range}`}
            aria-current={active ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active ? "bg-slate-700 font-medium text-slate-50" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            {range}d
          </Link>
        );
      })}
    </div>
  );
}

/** "+12% vs previous 30d", or nothing when there is no base to compare against. */
function delta(current: number, previous: number, range: number): string {
  if (previous === 0) return current === 0 ? `none in previous ${range}d either` : `none in previous ${range}d`;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% vs previous ${range}d`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const range = parseAnalyticsRange((await searchParams).range);
  const [series, adoption] = await Promise.all([
    getAdminAnalyticsSeries(prisma, range),
    getAdminAdoptionStats(prisma, range),
  ]);
  const { totals, previousTotals } = series;
  const data = series.points as unknown as Record<string, string | number>[];
  const loginAttempts = totals.loginsSucceeded + totals.loginsFailed;

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="How the server is being used. Counts only: nothing here shows what anyone spent or earned."
        actions={<RangePicker current={range} />}
      />

      {series.truncated ? (
        <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          At least one series hit the row cap for this range, so its most recent days may be undercounted.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="New accounts" value={totals.signups} detail={delta(totals.signups, previousTotals.signups, range)} />
        <StatTile
          label="Transactions created"
          value={totals.transactions.toLocaleString()}
          detail={delta(totals.transactions, previousTotals.transactions, range)}
        />
        <StatTile
          label="Sign-ins"
          value={totals.loginsSucceeded.toLocaleString()}
          detail={`${totals.loginsFailed.toLocaleString()} failed (${pct(totals.loginsFailed, loginAttempts)} of attempts)`}
          tone={totals.loginsFailed > totals.loginsSucceeded && totals.loginsFailed > 10 ? "warn" : "neutral"}
        />
        <StatTile
          label="Active users (30d)"
          value={adoption.usersActiveLast30Days}
          detail={`${pct(adoption.usersActiveLast30Days, adoption.activeUsers)} of ${adoption.activeUsers} active accounts`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminSection title="Transactions created" description="Per day, across every user. Imports show up as spikes.">
          <AdminTimeseriesChart
            data={data}
            series={[{ key: "transactions", label: "Transactions" }]}
            tableCaption="Transactions created per day"
          />
        </AdminSection>
        <AdminSection title="Sign-ins" description="Successful and failed sign-in attempts per day.">
          <AdminTimeseriesChart
            data={data}
            series={[
              { key: "loginsSucceeded", label: "Succeeded" },
              { key: "loginsFailed", label: "Failed" },
            ]}
            tableCaption="Sign-in attempts per day"
          />
        </AdminSection>
        <AdminSection title="New accounts" description="Accounts created per day.">
          <AdminTimeseriesChart
            data={data}
            series={[{ key: "signups", label: "New accounts" }]}
            tableCaption="New accounts per day"
          />
        </AdminSection>
        <AdminSection
          title="Bank rows synced"
          description="Transactions first seen from Plaid per day, before anyone reviews them."
        >
          <AdminTimeseriesChart
            data={data}
            series={[{ key: "bankRowsStaged", label: "Bank rows" }]}
            tableCaption="Bank rows synced per day"
          />
        </AdminSection>
        <AdminSection
          title="Audit events"
          description="Everything the audit log recorded per day, API reads included."
          className="xl:col-span-2"
        >
          <AdminTimeseriesChart
            data={data}
            series={[{ key: "auditEvents", label: "Audit events" }]}
            height={160}
            tableCaption="Audit events per day"
          />
        </AdminSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <AdminSection title="Sign-in methods" description={`Share of all ${adoption.users} accounts.`}>
          <BreakdownBars
            max={adoption.users}
            rows={[
              { label: "Password", value: adoption.withPassword, detail: pct(adoption.withPassword, adoption.users) },
              { label: "Passkey", value: adoption.withPasskey, detail: pct(adoption.withPasskey, adoption.users) },
              {
                label: "Unused recovery codes",
                value: adoption.withRecoveryCodes,
                detail: pct(adoption.withRecoveryCodes, adoption.users),
              },
              ...adoption.ssoByProvider.map((row) => ({
                label: `SSO: ${row.provider}`,
                value: row.users,
                detail: pct(row.users, adoption.users),
              })),
            ]}
          />
        </AdminSection>
        <AdminSection title="Features in use">
          <BreakdownBars
            rows={[
              { label: "Active API tokens", value: adoption.activeApiTokens },
              { label: "API tokens used (30d)", value: adoption.apiTokensUsedLast30Days },
              { label: "Budget alert emails on", value: adoption.budgetAlertEmailUsers },
              { label: "Suspended accounts", value: adoption.suspended },
            ]}
          />
        </AdminSection>
        <AdminSection title="Failed sign-ins by address" description={`Top sources, last ${range} days.`}>
          <BreakdownBars
            mono
            emptyText="No failed sign-ins in this range"
            rows={adoption.topFailedLoginSources.map((row) => ({ label: row.ip, value: row.count }))}
          />
        </AdminSection>
      </div>

      <AdminSection
        title="Most frequent audit actions"
        description={`Last ${range} days.`}
        actions={
          <Link href="/settings/admin/audit" className="text-sm text-blue-300 underline hover:text-blue-200">
            Open audit log
          </Link>
        }
      >
        <BreakdownBars
          mono
          emptyText="No audit events in this range"
          rows={adoption.topAuditActions.map((row) => ({ label: row.action, value: row.count }))}
        />
      </AdminSection>
    </>
  );
}
