import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { AccountPage, RegisterRow } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { ProgressBar } from '@/components/progress-bar';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { accountPath, balanceSource, cardTerms, REGISTER_MONTHS, registerNote, signedCents } from '@/utils/accounts';
import { balancesPath, canRecordBalance } from '@/utils/balances';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/**
 * The website's account page: the balance, this month's money in and out, the register with its
 * running balance, the bank it syncs from, and the recurring rules and goals on it. An entry in
 * the register opens for editing.
 */
export function Account({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [months, setMonths] = useState<number>(REGISTER_MONTHS[0]);
  const query = useApiQuery<AccountPage>(accountPath(id, months));
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data ? (
          <>
            <Summary data={data} />
            {data.bank || data.waitingInQueue > 0 ? <Bank data={data} /> : null}
            <Section title="Register" footer={registerNote(data)}>
              <View style={styles.tabs} accessibilityRole="tablist">
                {REGISTER_MONTHS.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setMonths(n)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: n === data.months }}
                    hitSlop={8}>
                    <Text style={[styles.tab, { color: n === data.months ? theme.text : theme.tint }]}>Last {n} months</Text>
                  </Pressable>
                ))}
              </View>
              {data.register.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing on this account in the last {data.months} months.</Text>
              ) : (
                data.register.map((row) => (
                  <RegisterLine
                    key={row.id}
                    row={row}
                    currency={data.account.currency}
                    onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.id } })}
                  />
                ))
              )}
            </Section>
            {data.manualBalances && data.manualBalances.length > 0 ? <ManualBalances data={data} /> : null}
            {data.rules.length > 0 ? <Rules data={data} /> : null}
            {data.goals.length > 0 ? (
              <Section title="Savings goals">
                {data.goals.map((goal) => (
                  <View key={goal.id} style={styles.stack} accessible accessibilityLabel={`${goal.name}: ${goal.percent}% of ${formatCents(goal.targetCents, goal.currency)}`}>
                    <View style={styles.line}>
                      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                        {goal.name}
                      </Text>
                      <Text style={[styles.small, { color: theme.textSecondary }]}>
                        {goal.percent}% of {formatCents(goal.targetCents, goal.currency)}
                      </Text>
                    </View>
                    <ProgressBar share={goal.percent / 100} color={theme.positive} />
                  </View>
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>{data?.account.name ?? 'Account'}</Stack.Title>
    </>
  );
}

function Summary({ data }: { data: AccountPage }) {
  const theme = useTheme();
  const router = useRouter();
  const { account, liability, balance } = data;
  const money = (cents: number) => formatCents(cents, account.currency);
  const canRecord = canRecordBalance(data);
  const recordBalance = () =>
    router.push({
      pathname: '/balance',
      params: {
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        liability: liability ? '1' : '0',
        linked: data.bank ? '1' : '0',
        cents: balance ? String(balance.cents) : '',
      },
    });
  return (
    <Section title={`${account.typeLabel} · ${account.currency}${account.archived ? ' · Archived' : ''}`}>
      <View style={styles.stack}>
        <Text style={[styles.small, { color: theme.textSecondary }]}>{liability ? 'Owed now' : 'Balance now'}</Text>
        <Text style={[styles.hero, { color: theme.text }]}>{balance ? money(balance.cents) : 'No balance yet'}</Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          {balance
            ? balanceSource(balance)
            : canRecord
              ? 'Type in what it holds now and then, for net worth and the running balance.'
              : 'Add one on the website, under Settings → Accounts.'}
        </Text>
        {canRecord ? (
          <Pressable onPress={recordBalance} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.link, { color: theme.tint }]}>{balance ? 'Update balance' : 'Add a balance'}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.line}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {liability ? 'Payments and refunds this month' : 'Money in this month'}
        </Text>
        <Text style={[styles.amount, { color: theme.positive }]}>{money(data.thisMonth.inCents)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{liability ? 'Charges this month' : 'Money out this month'}</Text>
        <Text style={[styles.amount, { color: theme.text }]}>{money(data.thisMonth.outCents)}</Text>
      </View>
      {data.card ? (
        <Text style={[styles.body, { color: data.card.utilization?.high ? theme.warning : theme.textSecondary }]}>
          {cardTerms(data.card, account.currency)}
        </Text>
      ) : null}
    </Section>
  );
}

function Bank({ data }: { data: AccountPage }) {
  const theme = useTheme();
  const router = useRouter();
  const { bank } = data;
  return (
    <Section title="Bank">
      {bank ? (
        <Text style={[styles.body, { color: theme.text }]}>
          Linked to {bank.institutionName}.{' '}
          {bank.lastSyncedAt
            ? `Last synced ${new Date(bank.lastSyncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
            : 'Not synced yet.'}
        </Text>
      ) : null}
      {bank?.problem ? <Text style={[styles.body, { color: theme.warning }]}>{bank.problem}</Text> : null}
      {data.waitingInQueue > 0 ? (
        <Pressable onPress={() => router.navigate('/review')} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.link, { color: theme.tint }]}>
            {data.waitingInQueue} bank row{data.waitingInQueue === 1 ? '' : 's'} waiting for review
          </Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

function RegisterLine({ row, currency, onPress }: { row: RegisterRow; currency: string; onPress: () => void }) {
  const theme = useTheme();
  const amount = signedCents(row.inCents, currency);
  const balance = row.balanceCents === null ? null : `${formatCents(row.balanceCents, currency)}${row.afterReading ? ' *' : ''}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        formatDay(row.date),
        row.title,
        row.type === 'transfer' ? 'transfer' : null,
        amount,
        balance ? `balance after ${balance.replace(' *', ', not yet confirmed by a balance')}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens the entry"
      style={styles.line}>
      <View style={styles.text}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          {formatDay(row.date)}
          {row.type === 'transfer' ? ' · Transfer' : ''}
        </Text>
      </View>
      <View style={styles.end}>
        <Text style={[styles.amount, { color: row.inCents >= 0 ? theme.positive : theme.text }]}>{amount}</Text>
        {balance ? <Text style={[styles.small, { color: theme.textSecondary }]}>{balance}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The balances the person typed in, each of which can be deleted, as on the website's account drawer. */
function ManualBalances({ data }: { data: AccountPage }) {
  const theme = useTheme();
  const { account } = data;
  const remove = useApiMutation<string, { ok: true }>('DELETE', (balanceId) => balancesPath(account.id, balanceId));

  function confirmDelete(entry: NonNullable<AccountPage['manualBalances']>[number]) {
    const amount = formatCents(entry.cents, account.currency);
    Alert.alert('Delete this balance?', `The ${amount} you entered for ${formatDay(entry.date)} is removed, and net worth no longer counts it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Balance',
        style: 'destructive',
        onPress: () =>
          remove.mutate(entry.id, {
            onError: (err) => Alert.alert('The balance is still there', err instanceof Error ? err.message : 'Try again.'),
          }),
      },
    ]);
  }

  return (
    <Section title="Balances you entered">
      {data.manualBalances?.map((entry) => (
        <View key={entry.id} style={styles.line}>
          <Text style={[styles.label, { color: theme.text }]}>{formatDay(entry.date)}</Text>
          <Text style={[styles.amount, { color: theme.text }]}>{formatCents(entry.cents, account.currency)}</Text>
          <Pressable
            onPress={() => confirmDelete(entry)}
            disabled={remove.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Delete the balance from ${formatDay(entry.date)}`}
            hitSlop={8}>
            <Text style={[styles.link, { color: theme.danger }]}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </Section>
  );
}

function Rules({ data }: { data: AccountPage }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Section title="Recurring">
      {data.rules.map((rule) => (
        <View key={rule.id} style={styles.line}>
          <View style={styles.text}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {rule.name}
            </Text>
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {rule.transfer ? `Transfer ${rule.transfer.into ? 'from' : 'to'} ${rule.transfer.otherName} · ` : rule.type === 'income' ? 'Income · ' : ''}
              next {formatDay(rule.date)}
            </Text>
          </View>
          <Text style={[styles.amount, { color: theme.text }]}>{formatCents(rule.amountCents, data.account.currency)}</Text>
        </View>
      ))}
      <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>Post or skip bills and pay</Text>
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  hero: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stack: { gap: Spacing.one },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, gap: 2 },
  end: { alignItems: 'flex-end', gap: 2 },
  label: { flex: 1, fontSize: 15 },
  name: { fontSize: 17, flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
  link: { fontSize: 15, fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: Spacing.four },
  tab: { fontSize: 15, fontWeight: '600' },
});
