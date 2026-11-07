import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Account, Me, NetWorth, NetWorthAccount } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { ACCOUNTS_PATH, canEditAccounts } from '@/utils/account-settings';
import { groupAccounts, NET_WORTH_PATH } from '@/utils/accounts';
import { canTrackInvestments } from '@/utils/investments';
import { formatCents } from '@/utils/money';

/** Every open account with its latest balance, and the net worth they add up to, as Reports shows it. */
export function Accounts() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<NetWorth>(NET_WORTH_PATH);
  const me = useApiQuery<Me>('/api/v1/me').data;
  const investments = canTrackInvestments(me);
  const editable = canEditAccounts(me);
  // Archived accounts are out of net worth's list; with account settings they can be opened and restored.
  const all = useApiQuery<{ accounts: Account[] }>(editable ? ACCOUNTS_PATH : null);
  const archived = all.data?.accounts.filter((a) => a.archived) ?? [];
  const { refreshing, onRefresh } = usePullToRefresh(() => Promise.all([query.refetch(), editable ? all.refetch() : null]));
  const data = query.data;
  const money = (cents: number) => formatCents(cents, data?.currency ?? 'CAD');
  const groups = data ? groupAccounts(data.accounts) : [];

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
        {data ? (
          <Section title="Net worth">
            <Text
              style={[styles.hero, { color: data.netCents < 0 ? theme.danger : theme.text }]}
              accessibilityLabel={`Net worth ${money(data.netCents)}`}>
              {money(data.netCents)}
            </Text>
            <View style={styles.line}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>What you have</Text>
              <Text style={[styles.amount, { color: theme.text }]}>{money(data.assetsCents)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>What you owe</Text>
              <Text style={[styles.amount, { color: theme.text }]}>{money(data.liabilitiesCents)}</Text>
            </View>
          </Section>
        ) : null}
        {data && investments ? (
          <Section footer="TFSA, RRSP and FHSA room left, contributions and withdrawals, and each account's value and return.">
            <Pressable onPress={() => router.push('/investments')} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Investments ›</Text>
            </Pressable>
          </Section>
        ) : null}
        {data && data.accounts.length === 0 ? (
          <Section>
            <Text style={[styles.label, { color: theme.textSecondary }]}>
              {editable ? 'No accounts yet. Add one with +.' : 'No accounts yet. Add them on the website.'}
            </Text>
          </Section>
        ) : null}
        {groups.map((group) => (
          <Section
            key={group.title}
            title={group.title}
            footer={group.title === 'Other currencies' ? 'Not in the totals above, which are in your home currency.' : null}>
            {group.accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </Section>
        ))}
        {archived.length > 0 ? (
          <Section title="Archived" footer="Out of the pickers and the totals above. Open one to restore it.">
            {archived.map((account) => (
              <Pressable
                key={account.id}
                onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })}
                accessibilityRole="button"
                style={styles.line}>
                <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
                  {account.name}
                </Text>
                <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
              </Pressable>
            ))}
          </Section>
        ) : null}
        {data ? (
          <Text style={[styles.footer, { color: theme.textSecondary }]}>
            Balances are the latest from your bank, a portfolio snapshot or one you entered.
          </Text>
        ) : null}
      </ScrollView>
      <Stack.Title>Accounts</Stack.Title>
      {editable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add an account" onPress={() => router.push('/account-edit')} />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

function AccountRow({ account }: { account: NetWorthAccount }) {
  const theme = useTheme();
  const router = useRouter();
  const amount = account.balance ? formatCents(account.balance.cents, account.currency) : 'No balance';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, ${account.typeLabel}, ${account.liability && account.balance ? `owed ${amount}` : amount}`}
      style={styles.line}>
      <View style={styles.text}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {account.name}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>{account.typeLabel}</Text>
      </View>
      <Text style={[styles.amount, { color: account.balance ? theme.text : theme.textSecondary }]}>{amount}</Text>
      <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  hero: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, gap: 2 },
  label: { flex: 1, fontSize: 15, lineHeight: 21 },
  name: { fontSize: 17 },
  small: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 22 },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
  link: { fontSize: 15, fontWeight: '600' },
});
