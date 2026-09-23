import { AdminPlaidIntervalForm } from "@/components/admin/admin-ops-forms";
import { AdminPageHeader, AdminSection, EmptyState, StatTile, StatusDot, formatRelative } from "@/components/admin/ui";
import type { DotStatus } from "@/components/admin/ui";
import { AdminPlaidForm } from "@/components/forms";
import { getAdminPlaidOverview, type AdminPlaidItemRow } from "@/lib/admin-plaid-overview";
import {
  MAX_PLAID_SYNC_INTERVAL_MINUTES,
  MIN_PLAID_SYNC_INTERVAL_MINUTES,
  getOpsSettingsStatus,
} from "@/lib/ops-settings";
import { getPlaidAdminStatus } from "@/lib/plaid/config";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

function itemDot(item: AdminPlaidItemRow): DotStatus {
  if (item.status === "REMOVED") return "idle";
  if (item.status === "ERROR") return "bad";
  if (item.status === "LOGIN_REQUIRED" || item.consecutiveSyncFailures > 0) return "warn";
  return "ok";
}

function statusLabel(item: AdminPlaidItemRow): string {
  switch (item.status) {
    case "ACTIVE":
      return item.consecutiveSyncFailures > 0 ? `failing (${item.consecutiveSyncFailures}×)` : "syncing";
    case "LOGIN_REQUIRED":
      return "needs re-authentication";
    case "ERROR":
      return "error";
    case "REMOVED":
      return "removed";
  }
}

export default async function AdminIntegrationsPage() {
  await requireAdmin();
  const [plaidStatus, overview, ops] = await Promise.all([
    getPlaidAdminStatus(),
    getAdminPlaidOverview(prisma),
    getOpsSettingsStatus(),
  ]);
  const failing = overview.items.filter((i) => i.status === "ACTIVE" && i.consecutiveSyncFailures > 0).length;

  return (
    <>
      <AdminPageHeader
        title="Integrations"
        description="Plaid bank sync: credentials, background sync, and the health of every connected bank."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Billable connections"
          value={overview.billableItems}
          detail="Plaid bills each one monthly, working or not"
        />
        <StatTile
          label="Not syncing"
          value={overview.byStatus.LOGIN_REQUIRED + overview.byStatus.ERROR}
          tone={overview.byStatus.LOGIN_REQUIRED + overview.byStatus.ERROR > 0 ? "warn" : "good"}
          detail={`${overview.byStatus.LOGIN_REQUIRED} re-auth · ${overview.byStatus.ERROR} error · ${failing} backing off`}
        />
        <StatTile
          label="Awaiting review"
          value={overview.staged.NEEDS_REVIEW.toLocaleString()}
          detail={
            overview.oldestNeedsReviewAt
              ? `oldest ${formatRelative(overview.oldestNeedsReviewAt)}`
              : "queue is empty"
          }
        />
        <StatTile
          label="Committed from sync"
          value={(overview.staged.LINKED + overview.staged.ADDED).toLocaleString()}
          detail={`${overview.staged.LINKED} linked · ${overview.staged.ADDED} added · ${overview.staged.IGNORED} ignored`}
        />
      </div>

      <AdminSection
        title="Bank connections"
        description="Every Plaid item across all users. Only the owner can fix a connection, by reconnecting it from their own settings."
      >
        {overview.items.length === 0 ? (
          <EmptyState>No banks are connected yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400">
                <tr>
                  <th className="px-2 py-2 font-medium">Institution</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Last sync</th>
                  <th className="px-2 py-2 font-medium">Accounts</th>
                  <th className="px-2 py-2 font-medium">To review</th>
                </tr>
              </thead>
              <tbody>
                {overview.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-800/80 align-top">
                    <td className="px-2 py-2">
                      <p className="font-medium text-slate-100">{item.institutionName ?? "Unknown bank"}</p>
                      <p className="text-[11px] text-slate-500">linked {item.createdAt.slice(0, 10)}</p>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{item.ownerEmail}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-start gap-2">
                        <StatusDot status={itemDot(item)} />
                        <span>
                          <span className="text-slate-200">{statusLabel(item)}</span>
                          {item.errorCode ? (
                            <span className="block font-mono text-[11px] text-red-300/90">{item.errorCode}</span>
                          ) : null}
                          {item.lastSyncError && item.status !== "REMOVED" ? (
                            <span className="block max-w-xs text-[11px] text-slate-500">{item.lastSyncError}</span>
                          ) : null}
                          {item.nextSyncAttemptAt && item.consecutiveSyncFailures > 0 ? (
                            <span className="block text-[11px] text-slate-500">
                              retry {formatRelative(item.nextSyncAttemptAt)}
                            </span>
                          ) : null}
                          {item.consentExpiresAt ? (
                            <span className="block text-[11px] text-slate-500">
                              consent ends {item.consentExpiresAt.slice(0, 10)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-400">{formatRelative(item.lastSyncedAt)}</td>
                    <td className="px-2 py-2 text-slate-400">
                      {item.mappedAccounts}/{item.totalAccounts} syncing
                      {item.totalAccounts > 0 && item.mappedAccounts === 0 ? (
                        <span className="block text-[11px] text-amber-300/90">none mapped — never synced</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-slate-400">{item.needsReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminPlaidForm
        enabled={plaidStatus.enabledRequested}
        syncSchedulerEnabled={plaidStatus.syncSchedulerRequested}
        syncSchedulerForcedOffByEnv={plaidStatus.syncSchedulerForcedOffByEnv}
        clientId={plaidStatus.storedClientId}
        environment={plaidStatus.environment}
        configuredViaEnv={plaidStatus.source === "environment" || plaidStatus.source === "mixed"}
        warnings={plaidStatus.warnings}
      />
      <AdminPlaidIntervalForm
        interval={ops.plaidSyncIntervalMinutes}
        min={MIN_PLAID_SYNC_INTERVAL_MINUTES}
        max={MAX_PLAID_SYNC_INTERVAL_MINUTES}
      />
    </>
  );
}
