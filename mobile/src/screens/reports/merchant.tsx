import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { MerchantActivity } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { MonthBars } from '@/components/month-bars';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { merchantBars, merchantListNote, merchantPath, merchantTiles } from '@/utils/category-merchant';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

import { Tiles } from './tiles';

/** The website's payee page: everything from one payee across all history, by month and by category. */
export function MerchantScreen({ merchantKey }: { merchantKey: string }) {
  const theme = useTheme();
  const query = useApiQuery<MerchantActivity>(merchantPath(merchantKey));
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
        {data ? <Merchant data={data} /> : null}
      </ScrollView>
      <Stack.Title>{data?.label ?? 'Payee'}</Stack.Title>
    </>
  );
}

function Merchant({ data }: { data: MerchantActivity }) {
  const theme = useTheme();
  const bars = merchantBars(data);
  const [selected, setSelected] = useState(bars.length - 1);
  const money = (cents: number) => formatCents(cents, data.currency);

  return (
    <>
      <Text style={[styles.intro, { color: theme.textSecondary }]}>
        Everything from this payee, {formatDay(data.firstDate)} to {formatDay(data.lastDate)}.
      </Text>
      <Tiles tiles={merchantTiles(data)} />
      {bars.length > 1 ? (
        <Section title="By month">
          <MonthBars bars={bars} currency={data.currency} selected={Math.min(selected, bars.length - 1)} onSelect={setSelected} />
        </Section>
      ) : null}
      {data.categories.length > 1 ? (
        <Section title="Categories">
          {data.categories.map((c) => (
            <View key={c.categoryName} style={styles.line}>
              <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                {c.categoryName}
              </Text>
              <Text style={[styles.amount, { color: theme.text }]}>{money(c.spentCents)}</Text>
            </View>
          ))}
        </Section>
      ) : null}
      <Section title="Transactions" footer={merchantListNote(data)}>
        {data.transactions.map((t) => (
          <View
            key={t.id}
            style={styles.line}
            accessible
            accessibilityLabel={`${t.title}, ${formatDay(t.date)}, ${t.split ? 'split' : t.categoryName}: ${t.type === 'income' ? 'received ' : ''}${money(t.amountCents)}`}>
            <View style={styles.grow}>
              <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
                {t.title}
              </Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                {formatDay(t.date)} · {t.split ? 'Split' : t.categoryName}
              </Text>
            </View>
            <Text style={[styles.amount, { color: t.type === 'income' ? theme.positive : theme.text }]}>
              {t.type === 'income' ? '+' : ''}
              {money(t.amountCents)}
            </Text>
          </View>
        ))}
      </Section>
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
