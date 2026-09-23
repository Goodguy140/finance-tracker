import { Sparkline } from "@/components/admin/admin-charts";
import { StatTile } from "@/components/admin/ui";
import type { AdminAnalytics } from "@/lib/admin-analytics";
import type { DailyPoint } from "@/lib/admin-analytics-series";

/** The Overview's headline counts, each with a 30-day trend where one exists. */
export function AdminAnalyticsPanel({ analytics, trend }: { analytics: AdminAnalytics; trend: DailyPoint[] }) {
  const { users, data, activity } = analytics;
  const line = (key: Exclude<keyof DailyPoint, "day">) => trend.map((point) => point[key]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Users"
        value={users.total}
        detail={`${users.serverAdmins} admin · ${users.withPassword} with password`}
        href="/settings/admin/users"
      >
        <Sparkline values={line("signups")} />
      </StatTile>
      <StatTile
        label="Transactions"
        value={data.transactions.toLocaleString()}
        detail={`+${activity.transactionsLast7Days} (7d) · +${activity.transactionsLast30Days} (30d)`}
        href="/settings/admin/analytics"
      >
        <Sparkline values={line("transactions")} />
      </StatTile>
      <StatTile
        label="Sign-ins (30d)"
        value={line("loginsSucceeded").reduce((a, b) => a + b, 0)}
        detail={`${line("loginsFailed").reduce((a, b) => a + b, 0)} failed`}
        href="/settings/admin/analytics"
      >
        <Sparkline values={line("loginsSucceeded")} />
      </StatTile>
      <StatTile
        label="Audit events (7d)"
        value={activity.auditEventsLast7Days.toLocaleString()}
        detail={`${data.accounts} accounts · ${data.categories} categories · ${data.recurringEnabled} recurring`}
        href="/settings/admin/audit"
      >
        <Sparkline values={line("auditEvents")} />
      </StatTile>
    </div>
  );
}
