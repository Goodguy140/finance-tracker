import type { AdminAnalytics } from "@/lib/admin-analytics";

function formatIsoShort(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19) + "Z";
}

export function AdminAnalyticsPanel({ analytics }: { analytics: AdminAnalytics }) {
  const { users, data, activity, recentAuditActions } = analytics;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold text-slate-100">Analytics</h2>
      <p className="text-xs text-slate-500">Aggregate counts from the database (no external analytics).</p>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Users</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{users.total}</p>
          <p className="text-xs text-slate-500">
            {users.serverAdmins} server admin · {users.withPassword} with password login
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Transactions</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{data.transactions}</p>
          <p className="text-xs text-slate-500">
            +{activity.transactionsLast7Days} (7d) · +{activity.transactionsLast30Days} (30d)
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Accounts &amp; categories</p>
          <p className="mt-1 font-medium text-slate-100">
            {data.accounts} accounts · {data.categories} categories
          </p>
          <p className="text-xs text-slate-500">{data.recurringEnabled} active recurring rules</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recent activity</p>
          <p className="mt-1 text-xs text-slate-400">
            Newest user: {formatIsoShort(activity.newestUserAt)}
            <br />
            Newest transaction: {formatIsoShort(activity.newestTransactionAt)}
            <br />
            Audit events (7d): {activity.auditEventsLast7Days}
          </p>
        </div>
      </div>

      {recentAuditActions.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Top audit actions (7 days)</p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {recentAuditActions.map((row) => (
              <li
                key={row.action}
                className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 font-mono text-slate-300"
              >
                {row.action} <span className="text-slate-500">×{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
