import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApiQuery } from '@/api/query';
import type { InsightList, TransactionPage } from '@/api/types';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { relativeDay } from '@/utils/dates';
import { INSIGHTS_PATH, pressingInsights } from '@/utils/insights';
import { amountDisplay, transactionName, transactionSubtitle } from '@/utils/transactions';

/** Cards that are off Home until added under Edit Home. Each loads on its own, so Home never waits for them. */

export const RECENT_COUNT = 5;
export const RECENT_PATH = `/api/v1/transactions?limit=${RECENT_COUNT}`;

const SEVERITY_TONE = { high: 'warning', medium: 'tint', low: 'textSecondary' } as const;
const SEVERITY_LABEL = { high: 'Worth a look soon', medium: 'Worth a look', low: 'For your information' } as const;

/** The newest few entries in the log, each opening its editor without leaving Home. */
export function RecentTransactions({ currency, today }: { currency: string; today: string }) {
  const theme = useTheme();
  const router = useRouter();
  const rows = useApiQuery<TransactionPage>(RECENT_PATH).data?.transactions;
  if (!rows) return null;
  return (
    <Section title="Recent transactions">
      {rows.length === 0 ? (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>Nothing logged yet.</Text>
      ) : (
        rows.map((row) => {
          const amount = amountDisplay(row, currency);
          const name = transactionName(row);
          const subtitle = `${relativeDay(row.date, today)} · ${transactionSubtitle(row)}`;
          const color = amount.tone === 'positive' ? theme.positive : amount.tone === 'muted' ? theme.textSecondary : theme.text;
          return (
            <Pressable
              key={row.id}
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${amount.text}, ${subtitle}${row.needsReview ? ', needs review' : ''}`}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
              <View style={styles.rowText}>
                <View style={styles.nameLine}>
                  {row.needsReview ? <View style={[styles.dot, { backgroundColor: theme.tint }]} /> : null}
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
              <Text style={[styles.amount, { color }]}>{amount.text}</Text>
            </Pressable>
          );
        })
      )}
      <Pressable onPress={() => router.navigate('/transactions')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>See every transaction</Text>
      </Pressable>
    </Section>
  );
}

/** The website dashboard's Insights card: the most pressing few, and the way to the rest. */
export function InsightsPreview() {
  const theme = useTheme();
  const router = useRouter();
  const list = useApiQuery<InsightList>(INSIGHTS_PATH).data;
  if (!list) return null;
  const top = pressingInsights(list.insights);
  const count = list.insights.length;
  return (
    <Section title={count > 0 ? `Insights · ${count}` : 'Insights'}>
      {top.length === 0 ? (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>Nothing needs your attention.</Text>
      ) : (
        top.map((insight) => (
          <View key={insight.key} style={styles.insight} accessible accessibilityLabel={`${SEVERITY_LABEL[insight.severity]}. ${insight.title}. ${insight.body}`}>
            <View style={[styles.dot, styles.insightDot, { backgroundColor: theme[SEVERITY_TONE[insight.severity]] }]} />
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.text }]}>{insight.title}</Text>
              {insight.body ? (
                <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={2}>
                  {insight.body}
                </Text>
              ) : null}
            </View>
          </View>
        ))
      )}
      <Pressable onPress={() => router.push('/insights')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>{count > top.length ? `See all ${count} insights` : 'See insights'}</Text>
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  rowText: { flexShrink: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  name: { fontSize: 17, flexShrink: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  insightDot: { marginTop: 8 },
});
