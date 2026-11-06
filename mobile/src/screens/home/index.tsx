import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { FinancialScore, NetWorth, Spending, Summary } from '@/api/types';
import { BudgetLine } from '@/components/budget-line';
import { LoadState } from '@/components/load-state';
import { OutboxBanner } from '@/components/outbox-banner';
import { Section } from '@/components/section';
import { UndoBar } from '@/components/undo-bar';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { useSpendingOptions } from '@/state/spending-options';
import { NET_WORTH_PATH } from '@/utils/accounts';
import { formatDay, relativeDay } from '@/utils/dates';
import { bandTone, SCORE_PATH, scoreChangeText } from '@/utils/insights';
import { formatCents, formatPeriodMonth } from '@/utils/money';
import { safeToSpendBreakdown, safeToSpendLine } from '@/utils/safe-to-spend';
import { spendingPath } from '@/utils/spending';
import { updateWidgets } from '@/widgets/update';

import { SpendingCharts } from './spending';

/**
 * The month at a glance: safe to spend, what is waiting, spending so far and by category, budgets to
 * watch, the week's bills and pay.
 */
export function Home() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const summary = useApiQuery<Summary>('/api/v1/summary');
  // The charts load on their own, so Home never waits for them; a server without the route leaves them out.
  const [spendingOptions, setSpendingOptions] = useSpendingOptions(session?.deviceId ?? null);
  const spending = useApiQuery<Spending>(spendingPath(spendingOptions), { keepPrevious: true });
  const { refreshing, onRefresh } = usePullToRefresh(() => Promise.all([summary.refetch(), spending.refetch()]));
  const data = summary.data;
  const charts = spending.data;
  // The home screen widgets show what Home last loaded.
  useEffect(() => {
    if (data) updateWidgets(data);
  }, [data]);

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <OutboxBanner />
        <LoadState loading={summary.isPending} error={summary.error && !data ? errorText(summary.error) : null} />
        {data ? (
          <>
            <SafeToSpendCard data={data} />
            <Waiting data={data} />
            {charts ? (
              <SpendingCharts
                data={charts}
                options={spendingOptions}
                onOptions={setSpendingOptions}
                updating={spending.isPlaceholderData}
              />
            ) : null}
            <BudgetsCard data={data} />
            <ComingUp data={data} />
            <ScoreRow />
            <NetWorthRow />
          </>
        ) : null}
      </ScrollView>
      <UndoBar />
      <Stack.Title large>Home</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a transaction" onPress={() => router.push('/add')} />
      </Stack.Toolbar>
    </>
  );
}

function SafeToSpendCard({ data }: { data: Summary }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const safe = data.safeToSpend;
  const money = (cents: number) => formatCents(cents, data.currency);
  return (
    <Section title="Safe to spend">
      <View style={styles.hero}>
        <Text
          style={[styles.heroAmount, { color: safe.safeCents < 0 ? theme.danger : theme.positive }]}
          accessibilityLabel={`Safe to spend until month end: ${money(safe.safeCents)}`}>
          {money(safe.safeCents)}
        </Text>
        <Text style={[styles.muted, { color: theme.textSecondary }]}>{safeToSpendLine(safe, data.currency)}</Text>
      </View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>{open ? 'Hide how this is worked out' : 'How this is worked out'}</Text>
      </Pressable>
      {open
        ? safeToSpendBreakdown(safe).map((row) => (
            <View key={row.label} style={styles.line}>
              <Text style={[styles.lineLabel, { color: theme.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.lineAmount, { color: row.sign === '+' ? theme.positive : theme.text }]}>
                {row.sign === '+' ? '+' : '−'}
                {money(row.cents)}
              </Text>
            </View>
          ))
        : null}
    </Section>
  );
}

function Waiting({ data }: { data: Summary }) {
  const theme = useTheme();
  const router = useRouter();
  const { bankQueue, needsReview } = data.waiting;
  if (bankQueue === 0 && needsReview === 0) return null;
  const rows = [
    bankQueue > 0
      ? {
          text: `${bankQueue} bank transaction${bankQueue === 1 ? '' : 's'} to review`,
          hint: 'Opens the Review tab',
          onPress: () => router.navigate('/review'),
        }
      : null,
    needsReview > 0
      ? {
          text: `${needsReview} ${needsReview === 1 ? 'entry needs' : 'entries need'} a look`,
          hint: 'Shows them in Transactions',
          onPress: () => router.navigate({ pathname: '/transactions', params: { review: '1' } }),
        }
      : null,
  ].filter((row) => row !== null);
  return (
    <Section title="Waiting for you">
      {rows.map((row) => (
        <Pressable key={row.text} onPress={row.onPress} accessibilityRole="button" accessibilityHint={row.hint} style={styles.line}>
          <Text style={[styles.rowText, { color: theme.text }]}>{row.text}</Text>
          <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
        </Pressable>
      ))}
    </Section>
  );
}

function BudgetsCard({ data }: { data: Summary }) {
  const theme = useTheme();
  const router = useRouter();
  const { budgets } = data;
  return (
    <Section title={`Budgets · ${formatPeriodMonth(data.month)}`}>
      {budgets.count === 0 ? (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>
          No budgets yet. Set them on the website under Settings → Categories.
        </Text>
      ) : (
        <>
          <BudgetLine
            name="All budgets"
            spentCents={budgets.totalSpentCents}
            limitCents={budgets.totalLimitCents}
            currency={data.currency}
            bold
          />
          {budgets.watch.map((row) => (
            <BudgetLine
              key={row.categoryId}
              name={row.categoryName}
              spentCents={row.spentCents}
              limitCents={row.limitCents}
              currency={data.currency}
            />
          ))}
          {budgets.watch.length === 0 ? (
            <Text style={[styles.muted, { color: theme.textSecondary }]}>Every budget is under 80% used.</Text>
          ) : null}
          <Pressable onPress={() => router.navigate('/budgets')} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.link, { color: theme.tint }]}>See every budget</Text>
          </Pressable>
        </>
      )}
    </Section>
  );
}

function ComingUp({ data }: { data: Summary }) {
  const theme = useTheme();
  const router = useRouter();
  const { upcoming } = data;
  const money = (cents: number) => formatCents(cents, data.currency);
  const totals = [
    upcoming.billsCents > 0 ? `Bills ${money(upcoming.billsCents)}` : null,
    upcoming.incomeCents > 0 ? `Pay ${money(upcoming.incomeCents)}` : null,
  ].filter(Boolean);
  return (
    <Section title={`Next ${upcoming.days} days`} footer={totals.length ? totals.join(' · ') : null}>
      {upcoming.items.length === 0 ? (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>Nothing due in the next {upcoming.days} days.</Text>
      ) : (
        upcoming.items.map((item, index) => {
          const income = item.type === 'income';
          const when = item.overdue ? `Overdue since ${formatDay(item.date)}` : relativeDay(item.date, data.today);
          return (
            <View key={`${item.date}-${item.name}-${index}`} style={styles.upcoming}>
              <View style={styles.upcomingText}>
                <Text style={[styles.rowText, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                  {item.planned ? ' (planned)' : ''}
                </Text>
                <Text style={[styles.small, { color: item.overdue ? theme.warning : theme.textSecondary }]}>{when}</Text>
              </View>
              <Text style={[styles.lineAmount, { color: income ? theme.positive : theme.text }]}>
                {income ? '+' : ''}
                {money(item.amountCents)}
              </Text>
            </View>
          );
        })
      )}
      <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>Post or skip bills and pay</Text>
      </Pressable>
    </Section>
  );
}

/** The financial score in one line, with the way to Insights. Loads on its own, so Home never waits for it. */
function ScoreRow() {
  const theme = useTheme();
  const router = useRouter();
  const score = useApiQuery<FinancialScore>(SCORE_PATH).data;
  if (!score) return null;
  return (
    <Section title="Financial score">
      {score.status === 'scored' ? (
        <View style={styles.hero} accessible accessibilityLabel={`${score.score} out of 100, ${score.band}. ${scoreChangeText(score) ?? ''}`}>
          <Text style={[styles.scoreLine, { color: theme[bandTone(score.band)] }]}>
            <Text style={styles.scoreNumber}>{score.score}</Text> {score.band}
          </Text>
          {score.change ? <Text style={[styles.small, { color: theme.textSecondary }]}>{scoreChangeText(score)}</Text> : null}
        </View>
      ) : (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>{score.reason}</Text>
      )}
      <Pressable onPress={() => router.push('/insights')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>See insights and where to improve</Text>
      </Pressable>
    </Section>
  );
}

/** Net worth, with the way to every account and its register. Loads on its own, as the score does. */
function NetWorthRow() {
  const theme = useTheme();
  const router = useRouter();
  const worth = useApiQuery<NetWorth>(NET_WORTH_PATH).data;
  if (!worth) return null;
  return (
    <Section title="Net worth">
      {worth.accounts.some((a) => a.balance) ? (
        <Text
          style={[styles.scoreNumber, { color: worth.netCents < 0 ? theme.danger : theme.text }]}
          accessibilityLabel={`Net worth ${formatCents(worth.netCents, worth.currency)}`}>
          {formatCents(worth.netCents, worth.currency)}
        </Text>
      ) : (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>No account balances yet. Add them on the website.</Text>
      )}
      <Pressable onPress={() => router.push('/accounts')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>See accounts and their registers</Text>
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  hero: { gap: Spacing.one },
  heroAmount: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  link: { fontSize: 15, fontWeight: '600' },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  lineLabel: { fontSize: 15 },
  lineAmount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  rowText: { fontSize: 17, flexShrink: 1 },
  chevron: { fontSize: 22 },
  scoreLine: { fontSize: 20, fontWeight: '600' },
  scoreNumber: { fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  upcoming: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  upcomingText: { flexShrink: 1, gap: 2 },
});
