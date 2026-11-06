import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { OwedToYou } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { OWED_PATH, splitOwed, type OwedItem } from '@/utils/owed';

/**
 * What people owe back on expenses, as the website's Expense Log lists it: every share still
 * outstanding, then those paid back in the last 30 days, so a mistaken tap can be undone. Each one's
 * expense opens for editing, which is where shares are added and changed.
 */
export function OwedToYouScreen() {
  const theme = useTheme();
  const query = useApiQuery<OwedToYou>(OWED_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const { outstanding, repaid } = splitOwed(data?.items ?? []);

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
            <Section
              title={outstanding.length > 0 ? `${formatCents(data.outstandingCents, data.currency)} outstanding` : 'All paid back'}
              footer="Already left out of your spending. Mark each one paid when the money comes back.">
              {outstanding.length === 0 ? (
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  Nobody owes you anything. Add who owes you part of an expense from its editor.
                </Text>
              ) : (
                outstanding.map((item) => <OwedRow key={item.id} item={item} />)
              )}
            </Section>
            {repaid.length > 0 ? (
              <Section title="Paid back lately">
                {repaid.map((item) => (
                  <OwedRow key={item.id} item={item} />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Owed to you</Stack.Title>
    </>
  );
}

function OwedRow({ item }: { item: OwedItem }) {
  const theme = useTheme();
  const router = useRouter();
  const paid = item.paidAt !== null;
  const mark = useApiMutation<boolean, { ok: true }>('POST', () => `${OWED_PATH}/${encodeURIComponent(item.id)}`, (value) => ({ paid: value }));
  const amount = formatCents(item.amountCents, item.currency);

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.text}
        onPress={() => router.push({ pathname: '/transactions/[id]', params: { id: item.transactionId } })}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} owes ${amount} for ${item.expenseLabel}, ${formatDay(item.expenseDate)}${paid ? ', paid back' : ''}`}
        accessibilityHint="Opens the expense">
        <Text style={[styles.name, { color: paid ? theme.textSecondary : theme.text }]} numberOfLines={1}>
          {item.name} · {amount}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>
          {item.expenseLabel} · {formatDay(item.expenseDate)}
          {paid ? ` · paid back ${formatDay(item.paidAt!.slice(0, 10))}` : ''}
        </Text>
      </Pressable>
      <Pressable
        onPress={() =>
          mark.mutate(!paid, {
            onError: (err) => Alert.alert('Nothing changed', err instanceof Error ? err.message : 'Try again.'),
          })
        }
        disabled={mark.isPending}
        accessibilityRole="button"
        accessibilityLabel={paid ? `Undo: ${item.name} has not paid` : `Mark ${item.name} paid`}
        hitSlop={8}>
        <Text style={[styles.action, { color: theme.tint, opacity: mark.isPending ? 0.5 : 1 }]}>{paid ? 'Undo' : 'Mark Paid'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  small: { fontSize: 13 },
  muted: { fontSize: 15, lineHeight: 21 },
  action: { fontSize: 15, fontWeight: '600' },
});
