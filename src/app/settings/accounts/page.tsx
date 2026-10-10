import Link from "next/link";
import { ContributionRoomPanel } from "@/components/contribution-room-panel";
import { AccountsManager, type ManagedAccount } from "@/components/settings/accounts-manager";
import { SettingsPage } from "@/components/settings/ui";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { ymdFromDateUtc } from "@/lib/date-only";
import { loadNetWorth } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountsSettingsPage() {
  const { user } = await requireLoadedUser();
  const [accounts, plaidAccounts, contributionRoom, netWorth] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.plaidAccount.findMany({
      where: { userId: user.id, syncEnabled: true, accountId: { not: null } },
      select: { accountId: true, plaidItem: { select: { institutionName: true } } },
    }),
    loadContributionRoomData(user.id),
    loadNetWorth(user),
  ]);

  const bankByAccount = new Map<string, string>();
  for (const pa of plaidAccounts) {
    if (pa.accountId && !bankByAccount.has(pa.accountId)) {
      bankByAccount.set(pa.accountId, pa.plaidItem.institutionName ?? "Your bank");
    }
  }
  const balanceByAccount = new Map(netWorth.accounts.map((row) => [row.accountId, row]));
  const managed: ManagedAccount[] = accounts.map((account) => {
    const balance = balanceByAccount.get(account.id);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      archived: account.archived,
      currency: account.currency,
      countsAsSavings: account.countsAsSavings,
      linkedBank: bankByAccount.get(account.id) ?? null,
      liability: balance ? balance.liability : null,
      latest: balance?.latest
        ? { cents: balance.latest.cents, dateYmd: ymdFromDateUtc(balance.latest.date), source: balance.latest.source }
        : null,
    };
  });

  return (
    <SettingsPage
      section="accounts"
      actions={
        <Link
          href="/settings/import"
          className="inline-flex items-center rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Import CSV
        </Link>
      }
    >
      <AccountsManager
        accounts={managed}
        defaultExpenseAccountId={user.defaultExpenseAccountId}
        contributionRoom={contributionRoom}
        todayYmd={currentYmdInTimeZone(user.timezone)}
      />
      <ContributionRoomPanel data={contributionRoom} />
    </SettingsPage>
  );
}
