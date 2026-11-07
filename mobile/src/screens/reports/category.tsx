import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { CategoryTrend } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { MonthBars } from '@/components/month-bars';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { categoryTrendPath, trendBars, trendTiles } from '@/utils/category-merchant';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

import { Tiles } from './tiles';

/** Where a payee opens: in the tab the category page was opened from. */
export type MerchantRoute = '/merchant' | '/budgets/merchant';

/**
 * The website's category page: up to two years by month against the budget, its usual month,
 * where this month is heading, who the money went to (each opens its payee) and the biggest entries.
 * Opened from a budget, it can open that budget's sheet.
 */
export function CategoryScreen({ id, merchantRoute, editBudget }: { id: string; merchantRoute: MerchantRoute; editBudget: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<CategoryTrend>(categoryTrendPath(id));
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const trend = query.data;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !trend ? errorText(query.error) : null} />
        {trend ? <Trend trend={trend} onPayee={(key) => router.push({ pathname: merchantRoute, params: { key } })} /> : null}
      </ScrollView>
      <Stack.Title>{trend?.name ?? 'Category'}</Stack.Title>
      {editBudget && trend?.kind === 'expense' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button onPress={() => router.push({ pathname: '/budget', params: { categoryId: id } })}>Edit</Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

function Trend({ trend, onPayee }: { trend: CategoryTrend; onPayee: (key: string) => void }) {
  const theme = useTheme();
  const bars = trendBars(trend);
  const [selected, setSelected] = useState(bars.length - 1);
  const money = (cents: number) => formatCents(cents, trend.currency);
  const income = trend.kind === 'income';

  return (
    <>
      <Text style={[styles.intro, { color: theme.textSecondary }]}>
        {income ? 'Income' : 'Spending'} in this category by month{trend.groupName ? `, in the ${trend.groupName} group` : ''}.
      </Text>
      {bars.length === 0 ? (
        <Section>
          <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing has been filed under this category in the last 24 months.</Text>
        </Section>
      ) : (
        <>
          <Tiles tiles={trendTiles(trend)} />
          <Section title="By month" footer={bars.some((b) => b.budgetCents !== null) ? 'The line across a bar is that month’s budget.' : null}>
            <MonthBars bars={bars} currency={trend.currency} selected={Math.min(selected, bars.length - 1)} onSelect={setSelected} />
          </Section>
          {trend.payees.length > 0 ? (
            <Section title={income ? 'Top payers' : 'Top payees'}>
              {trend.payees.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => onPayee(p.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.label}: ${money(p.cents)}, ${p.count} ${p.count === 1 ? 'entry' : 'entries'}`}
                  accessibilityHint="Opens everything from this payee"
                  style={({ pressed }) => [styles.line, { opacity: pressed ? 0.6 : 1 }]}>
                  <Text style={[styles.body, styles.grow, { color: theme.tint }]} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text style={[styles.amount, { color: theme.text }]}>
                    {money(p.cents)} <Text style={{ color: theme.textSecondary }}>· {p.count}</Text>
                  </Text>
                </Pressable>
              ))}
            </Section>
          ) : null}
          {trend.biggest.length > 0 ? (
            <Section title={income ? 'Largest amounts' : 'Biggest purchases'}>
              {trend.biggest.map((t) => (
                <View key={t.id} style={styles.line}>
                  <View style={styles.grow}>
                    <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      {formatDay(t.date)}
                      {t.split ? ' · part of a split' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: theme.text }]}>{money(t.cents)}</Text>
                </View>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
