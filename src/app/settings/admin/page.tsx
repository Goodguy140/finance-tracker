import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { AdminAnalyticsPanel } from "@/components/admin-analytics-panel";
import { AdminAuditLog } from "@/components/admin-audit-log";
import { AdminPageHeader, AdminSection, StatusDot } from "@/components/admin/ui";
import { getAdminAnalytics } from "@/lib/admin-analytics";
import { getAdminAnalyticsSeries } from "@/lib/admin-analytics-series";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { formatUptime, getAdminRuntimeMetrics } from "@/lib/admin-runtime-metrics";
import { getLoginDebugVersionLine } from "@/lib/app-version";
import { getOpsSettingsStatus } from "@/lib/ops-settings";
import { getPlaidAdminStatus } from "@/lib/plaid/config";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

function Fact({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      {ok === undefined ? null : <StatusDot status={ok ? "ok" : "warn"} />}
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm text-slate-100">{value}</p>
      </div>
    </li>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const [attention, analytics, series, ops, plaid] = await Promise.all([
    getAdminAttention(),
    getAdminAnalytics(prisma),
    getAdminAnalyticsSeries(prisma, 30),
    getOpsSettingsStatus(),
    getPlaidAdminStatus(),
  ]);
  const runtime = getAdminRuntimeMetrics();
  const { items, facts } = attention;

  return (
    <>
      <AdminPageHeader title="Overview" description="What needs attention, and how the server is doing." />

      <AdminSection
        title={items.length === 0 ? "All clear" : `${items.length} item${items.length === 1 ? "" : "s"} need attention`}
      >
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            No health, security or integration problems detected.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
            {items.map((item) => {
              const Icon = item.severity === "bad" ? XCircle : AlertTriangle;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 bg-slate-950/40 px-3 py-2.5 hover:bg-slate-900"
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === "bad" ? "text-red-400" : "text-amber-400"}`}
                      aria-label={item.severity === "bad" ? "Problem" : "Warning"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-100">{item.title}</span>
                      <span className="block text-xs text-slate-400">{item.detail}</span>
                    </span>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>

      <AdminAnalyticsPanel analytics={analytics} trend={series.points} />

      <AdminSection
        title="At a glance"
        actions={
          <Link href="/settings/admin/system" className="text-sm text-blue-300 underline hover:text-blue-200">
            System
          </Link>
        }
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Version" value={getLoginDebugVersionLine()} />
          <Fact label="Uptime" value={formatUptime(runtime.uptimeSeconds)} />
          <Fact
            label="Database"
            value={
              runtime.databaseFile.sizeMb != null
                ? `${runtime.databaseFile.sizeMb} MB · ${runtime.databaseFile.diskFreeGb ?? "?"} GB free`
                : "size unavailable"
            }
            ok={facts.schemaMissingColumns.length === 0}
          />
          <Fact label="Memory (RSS)" value={`${runtime.memory.rssMb} MB`} />
          <Fact
            label="Public sign-up"
            value={`${ops.publicSignup.value ? "open" : "closed"} (${ops.publicSignup.source})`}
          />
          <Fact
            label="Plaid"
            value={
              plaid.enabledRequested
                ? `${plaid.environment} · sync every ${ops.plaidSyncIntervalMinutes.value} min`
                : "disabled"
            }
            ok={plaid.warnings.length === 0}
          />
          <Fact label="Audit retention" value={`${ops.auditRetentionDays.value} days`} />
          <Fact label="Active admins" value={String(facts.activeServerAdmins)} ok={facts.activeServerAdmins > 1} />
        </ul>
      </AdminSection>
      <AdminAuditLog />
    </>
  );
}
