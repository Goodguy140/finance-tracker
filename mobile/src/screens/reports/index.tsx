import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Reports, ReportMerchant, Tag } from '@/api/types';
import { FormButton, FormField } from '@/components/form';
import { GroupBars } from '@/components/group-bars';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, localToday, ymdFromDate } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import {
  belowZeroLines,
  changeText,
  incomeSpendingBars,
  netWorthBars,
  projectionTiles,
  reportsPath,
  totalsTiles,
  type ReportsPeriod,
} from '@/utils/reports';

import { Tiles } from './tiles';

/** Rows of year over year shown before "Show all". */
const YOY_ROWS = 8;

/**
 * The website's Reports page: the period's totals, income and spending by month, where the money
 * came from and went, year over year by category, payees and payers; then net worth by month and
 * the balances the recurring bills and pay lead to. The period and a tag are picked from the
 * toolbar menu, as the website's period pills, custom range and tag filter.
 */
export function ReportsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [period, setPeriod] = useState<ReportsPeriod>({ kind: 'option', key: '12m' });
  const [tagId, setTagId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const query = useApiQuery<Reports>(reportsPath(period, tagId), { keepPrevious: true });
  const tags = useApiQuery<{ tags: Tag[] }>('/api/v1/tags').data?.tags ?? [];
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const tagName = tags.find((t) => t.id === tagId)?.name;
  const themeVariant = scheme === 'dark' ? 'dark' : 'light';

  function startRange() {
    const today = localToday();
    setRange(period.kind === 'custom' ? { from: period.from, to: period.to } : { from: `${today.slice(0, 4)}-01-01`, to: today });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {range ? (
          <Section title="Custom range" footer="Both days are included.">
            <FormField label="From">
              <DateTimePicker
                value={dateFromYmd(range.from)}
                onValueChange={(_, d) => setRange({ ...range, from: ymdFromDate(d) })}
                display="compact"
                timeZoneName="UTC"
                themeVariant={themeVariant}
              />
            </FormField>
            <FormField label="To">
              <DateTimePicker
                value={dateFromYmd(range.to)}
                onValueChange={(_, d) => setRange({ ...range, to: ymdFromDate(d) })}
                display="compact"
                timeZoneName="UTC"
                themeVariant={themeVariant}
              />
            </FormField>
            <FormButton
              label="Show This Range"
              disabled={range.from > range.to}
              onPress={() => {
                setPeriod({ kind: 'custom', ...range });
                setRange(null);
              }}
            />
          </Section>
        ) : null}
        {data ? (
          <Text style={[styles.intro, { color: theme.textSecondary }]}>
            {data.period.label}
            {tagName ? `, only entries tagged #${tagName}` : ''}.{' '}
            {data.totals.toSavingsCents === null
              ? 'Income and spending only; transfers between your accounts are left out.'
              : 'Transfers between your accounts are left out, except money moved into accounts that count as savings.'}
          </Text>
        ) : null}
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data ? <Report data={data} onCategory={(id) => router.push({ pathname: '/category', params: { id } })} onPayee={(key) => router.push({ pathname: '/merchant', params: { key } })} /> : null}
      </ScrollView>
      <Stack.Title>Reports</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="calendar" accessibilityLabel="Pick the period">
          {(data?.periodOptions ?? [{ key: '12m', label: 'Last 12 months' }]).map((option) => (
            <Stack.Toolbar.MenuAction key={option.key} onPress={() => setPeriod({ kind: 'option', key: option.key })}>
              {option.label}
            </Stack.Toolbar.MenuAction>
          ))}
          <Stack.Toolbar.MenuAction icon="calendar.badge.clock" onPress={startRange}>
            Custom Range…
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        {tags.length > 0 ? (
          <Stack.Toolbar.Menu icon="tag" accessibilityLabel="Show only one tag">
            <Stack.Toolbar.MenuAction onPress={() => setTagId(null)}>Every Entry</Stack.Toolbar.MenuAction>
            {tags.map((t) => (
              <Stack.Toolbar.MenuAction key={t.id} onPress={() => setTagId(t.id)}>
                {`#${t.name}`}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        ) : null}
      </Stack.Toolbar>
    </>
  );
}

function Report({ data, onCategory, onPayee }: { data: Reports; onCategory: (id: string) => void; onPayee: (key: string) => void }) {
  const theme = useTheme();
  const money = (cents: number) => formatCents(cents, data.currency);
  const months = incomeSpendingBars(data.months, data.currency);
  const worth = netWorthBars(data.netWorth.points, data.currency);
  const [month, setMonth] = useState(months.length - 1);
  const [worthMonth, setWorthMonth] = useState(worth.length - 1);
  const [allYoy, setAllYoy] = useState(false);
  const yoy = data.yearOverYear;
  const yoyRows = allYoy ? yoy.rows : yoy.rows.slice(0, YOY_ROWS);
  const dips = data.projection ? belowZeroLines(data.projection, data.currency) : [];

  return (
    <>
      <Tiles tiles={totalsTiles(data.totals, data.currency)} />
      {data.otherCurrencyNote ? (
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          Accounts in another currency are left out of these figures: {data.otherCurrencyNote}.
        </Text>
      ) : null}

      <Section title="Income vs spending" footer={data.period.toDate ? 'This month is still running.' : null}>
        {months.length === 0 ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>No income or spending in this period yet.</Text>
        ) : (
          <>
            <GroupBars groups={months} selected={Math.min(month, months.length - 1)} onSelect={setMonth} />
            <View style={styles.legend}>
              <Legend color={theme.positive} label="Income" />
              <Legend color={theme.tint} label="Spending" />
            </View>
          </>
        )}
      </Section>

      {data.cashFlow.uses.length > 0 ? (
        <Section title="Where it went" footer="Split expenses count in each part’s category.">
          {data.cashFlow.uses.map((u) => (
            <Line key={`${u.kind}:${u.name}`} label={u.name} value={money(u.cents)} tone={u.kind === 'expense' ? 'text' : 'positive'} />
          ))}
        </Section>
      ) : null}
      {data.cashFlow.sources.length > 0 ? (
        <Section title="Where it came from">
          {data.cashFlow.sources.map((s) => (
            <Line key={`${s.kind}:${s.name}`} label={s.name} value={money(s.cents)} tone={s.kind === 'shortfall' ? 'warning' : 'text'} />
          ))}
        </Section>
      ) : null}

      <Section
        title="Year over year"
        footer={yoy.rows.length > 0 && yoy.previousTotalCents === 0 ? 'Nothing to compare yet: this fills in once you have a year of history.' : 'Against the same dates a year earlier.'}>
        {yoy.rows.length === 0 ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>No spending in this period.</Text>
        ) : (
          <>
            {yoyRows.map((row) => (
              <Pressable key={row.categoryId} onPress={() => onCategory(row.categoryId)} accessibilityRole="button" style={styles.row}>
                <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                  {row.categoryName}
                </Text>
                <Text style={[styles.amount, { color: theme.text }]}>{money(row.currentCents)}</Text>
                {yoy.previousTotalCents > 0 ? (
                  <Text style={[styles.change, { color: (row.changeRatio ?? 1) > 0 ? theme.warning : theme.positive }]}>
                    {changeText(row.changeRatio)}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            {yoy.rows.length > YOY_ROWS ? (
              <Pressable onPress={() => setAllYoy((v) => !v)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, { color: theme.tint }]}>{allYoy ? 'Show fewer' : `Show all ${yoy.rows.length}`}</Text>
              </Pressable>
            ) : null}
            <Line label="Total" value={`${money(yoy.currentTotalCents)}${yoy.previousTotalCents > 0 ? ` (was ${money(yoy.previousTotalCents)})` : ''}`} tone="text" />
          </>
        )}
      </Section>

      <Merchants title="Top payees" rows={data.payees} cents={(m) => m.spentCents} money={money} onPayee={onPayee} />
      <Merchants title="Who paid you" rows={data.payers} cents={(m) => m.receivedCents} money={money} onPayee={onPayee} />

      <Section title="Net worth" footer="What your accounts hold less what you owe, at the end of each month. It doesn’t change with the period or tag.">
        {worth.length === 0 ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>No balances yet. Add one on an account’s page.</Text>
        ) : (
          <GroupBars groups={worth} selected={Math.min(worthMonth, worth.length - 1)} onSelect={setWorthMonth} />
        )}
      </Section>

      {data.projection ? (
        <Section
          title="Projected balances"
          footer={`Your latest balances with the upcoming recurring bills and pay applied to the account each one books to.${
            data.projection.rulesLeftOut > 0
              ? ` ${data.projection.rulesLeftOut} rule${data.projection.rulesLeftOut === 1 ? ' is' : 's are'} on an account with no balance and left out.`
              : ''
          }`}>
          {projectionTiles(data.projection, data.currency).map((t) => (
            <Line key={t.label} label={t.label} value={t.value} tone="text" />
          ))}
          {dips.map((line) => (
            <Text key={line} style={[styles.body, { color: theme.warning }]}>
              {line}
            </Text>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Merchants(props: {
  title: string;
  rows: ReportMerchant[];
  cents: (m: ReportMerchant) => number;
  money: (cents: number) => string;
  onPayee: (key: string) => void;
}) {
  const theme = useTheme();
  if (props.rows.length === 0) return null;
  return (
    <Section title={props.title}>
      {props.rows.map((m) => (
        <Pressable key={m.key} onPress={() => props.onPayee(m.key)} accessibilityRole="button" style={styles.row}>
          <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
            {m.name}
          </Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>{m.count}×</Text>
          <Text style={[styles.amount, { color: theme.text }]}>{props.money(props.cents(m))}</Text>
        </Pressable>
      ))}
    </Section>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone: 'text' | 'positive' | 'warning' }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.amount, { color: theme[tone] }]}>{value}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[styles.small, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  grow: { flex: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  change: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  legend: { flexDirection: 'row', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
