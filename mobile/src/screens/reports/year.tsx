import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { YearEnd } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatCents } from '@/utils/money';
import { tagTotalsLine, yearEndPath, yearEndTiles, yearEndTitle, yearInReviewLines } from '@/utils/year-end';

import { Tiles } from './tiles';

/**
 * The website's year-end summary (`/reports/year`): the year in review, where the money went and
 * who was paid most, totals by tag with the tax-looking ones first, and registered accounts'
 * contributions and withdrawals, to have to hand at tax time. The year is picked from the toolbar.
 */
export function YearEndScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [year, setYear] = useState<string | null>(null);
  const query = useApiQuery<YearEnd>(yearEndPath(year), { keepPrevious: true });
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const money = (cents: number) => formatCents(cents, data?.currency ?? 'CAD');

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
            <Text style={[styles.intro, { color: theme.textSecondary }]}>
              Your year at a glance, and totals to have to hand at tax time. These are your own records, not tax advice.
            </Text>
            <Tiles tiles={yearEndTiles(data)} />

            <Section title="Year in review">
              {yearInReviewLines(data).map((line) => (
                <Text key={line} style={[styles.body, { color: theme.text }]}>
                  {line}
                </Text>
              ))}
              {data.topCategories.length === 0 && data.totals.entries === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing recorded in {data.year} yet.</Text>
              ) : null}
            </Section>

            {data.topCategories.length > 0 ? (
              <Section title="Where it went">
                {data.topCategories.map((c) => (
                  <Line key={c.name} label={c.name} value={money(c.cents)} />
                ))}
              </Section>
            ) : null}

            {data.topPayees.length > 0 ? (
              <Section title="Who you paid most">
                {data.topPayees.map((m) => (
                  <Pressable
                    key={m.key}
                    onPress={() => router.push({ pathname: '/merchant', params: { key: m.key } })}
                    accessibilityRole="button"
                    style={styles.row}>
                    <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={[styles.amount, { color: theme.text }]}>{money(m.spentCents)}</Text>
                  </Pressable>
                ))}
              </Section>
            ) : null}

            <Section
              title="Totals by tag"
              footer="Tag entries like “Tax deductible”, “Donation” or “Medical” through the year and their totals land here. Tags that look tax-related are listed first.">
              {data.tags.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>No tagged entries in {data.year}.</Text>
              ) : (
                data.tags.map((t) => (
                  <Pressable
                    key={t.tagId}
                    onPress={() => router.push({ pathname: '/reports', params: { period: String(data.year), tag: t.tagId } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.name}${t.taxRelated ? ', tax time' : ''}: ${tagTotalsLine(t, data.currency)}`}
                    style={styles.tag}>
                    <View style={styles.row}>
                      <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                        #{t.name}
                      </Text>
                      {t.taxRelated ? (
                        <Text style={[styles.badge, { color: theme.warning, borderColor: theme.warning }]}>TAX TIME</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>{tagTotalsLine(t, data.currency)}</Text>
                  </Pressable>
                ))
              )}
            </Section>

            <Section
              title="Registered and investment accounts"
              footer={`Contributions and withdrawals recorded on the Investments card in ${data.year}. Check them against your slips.`}>
              {data.registered.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>None recorded in {data.year}.</Text>
              ) : (
                data.registered.map((r) => (
                  <View key={r.accountId} style={styles.tag} accessible>
                    <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
                      {r.name} <Text style={[styles.small, { color: theme.textSecondary }]}>{r.typeLabel}</Text>
                    </Text>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      {money(r.contributedCents)} contributed · {money(r.withdrawnCents)} withdrawn
                    </Text>
                  </View>
                ))
              )}
            </Section>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>{data ? yearEndTitle(data) : 'Year-End Summary'}</Stack.Title>
      {data && data.years.length > 1 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="calendar" accessibilityLabel="Pick the year">
            {data.years.map((y) => (
              <Stack.Toolbar.MenuAction key={y} onPress={() => setYear(y)}>
                {Number(y) === data.year ? `${y} ✓` : y}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.amount, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  grow: { flex: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  tag: { gap: 2 },
  badge: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
