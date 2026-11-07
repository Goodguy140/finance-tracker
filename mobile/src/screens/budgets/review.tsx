import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { MonthReview } from '@/api/types';
import { FormButton } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, shiftMonth } from '@/utils/dates';
import { formatCents, formatPeriodMonth } from '@/utils/money';
import { budgetLines, CLOSE_PATH, lookLines, monthReviewPath, scoreLine, spendingChangeLine } from '@/utils/month-review';

/**
 * The website's monthly review: how a month went against the one before, which budgets held, what
 * still wants a look, and "Mark month closed" (a record only; nothing is locked).
 */
export function MonthReviewScreen({ initialMonth }: { initialMonth: string | null }) {
  const theme = useTheme();
  const [month, setMonth] = useState(initialMonth);
  const query = useApiQuery<MonthReview>(monthReviewPath(month));
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const review = query.data;
  const shown = review?.month ?? month;
  const step = (delta: number) => {
    if (shown) setMonth(shiftMonth(shown, delta));
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState
          loading={query.isPending}
          error={
            query.error instanceof ApiError && query.error.status === 404
              ? 'The monthly review needs a newer server. Update it, or use Reports → Monthly review on the website.'
              : query.error
                ? errorText(query.error)
                : null
          }
        />
        {review ? <Review review={review} /> : null}
      </ScrollView>
      <Stack.Title>{shown ? `${formatPeriodMonth(shown)} review` : 'Monthly review'}</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Month before" disabled={!review} onPress={() => step(-1)} />
        <Stack.Toolbar.Button
          icon="chevron.right"
          accessibilityLabel="Month after"
          disabled={!review || review.month >= review.currentMonth}
          onPress={() => step(1)}
        />
      </Stack.Toolbar>
    </>
  );
}

function Review({ review }: { review: MonthReview }) {
  const theme = useTheme();
  const router = useRouter();
  const money = (cents: number) => formatCents(cents, review.currency);
  const close = useApiMutation<boolean, { ok: true }>('POST', () => CLOSE_PATH, (closed) => ({ month: review.month, closed }));
  const [error, setError] = useState<string | null>(null);
  const change = spendingChangeLine(review);
  const score = scoreLine(review);
  const look = lookLines(review);
  const label = formatPeriodMonth(review.month);
  const setClosed = (closed: boolean) => {
    setError(null);
    close.mutate(closed, { onError: (err) => setError(errorText(err)) });
  };

  return (
    <>
      <View style={styles.intro}>
        <Text style={[styles.muted, { color: theme.textSecondary }]}>
          {review.running ? 'This month is still running; the totals are to today.' : 'How the month went, and what to tidy before closing it.'}
        </Text>
        {score ? (
          <Pressable onPress={() => router.navigate('/insights')} accessibilityRole="link" hitSlop={8}>
            <Text style={[styles.muted, { color: theme.tint }]}>{score}</Text>
          </Pressable>
        ) : null}
      </View>

      <Section>
        {[
          { label: 'Income', value: money(review.incomeCents) },
          { label: 'Spending', value: money(review.spendingCents) },
          { label: review.netCents >= 0 ? 'Left over' : 'Overspent', value: money(Math.abs(review.netCents)) },
          { label: 'Entries', value: String(review.transactionCount) },
        ].map((tile) => (
          <View key={tile.label} style={styles.line} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}>
            <Text style={[styles.body, { color: theme.text }]}>{tile.label}</Text>
            <Text style={[styles.amount, { color: theme.text }]}>{tile.value}</Text>
          </View>
        ))}
      </Section>

      <Section title="What changed">
        {change ? <Text style={[styles.body, { color: theme.text }]}>{change}</Text> : null}
        {review.changes.map((c) => (
          <Text key={c.categoryName} style={[styles.body, { color: theme.text }]}>
            {c.categoryName}: {money(c.cents)}, {c.cents > c.previousCents ? 'up' : 'down'} from {money(c.previousCents)}.
          </Text>
        ))}
        {!change && review.changes.length === 0 ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing moved much against the month before.</Text>
        ) : null}
      </Section>

      {review.categories.length > 0 ? (
        <Section title="Where it went">
          {review.categories.map((c) => (
            <View key={c.categoryName} style={styles.line}>
              <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                {c.categoryName}
              </Text>
              <Text style={[styles.amount, { color: theme.text }]}>{money(c.cents)}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      {review.biggest.length > 0 ? (
        <Section title="Biggest purchases">
          {review.biggest.map((b, i) => (
            <View key={`${b.date}-${i}`} style={styles.line}>
              <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                {formatDay(b.date)} · {b.title}
              </Text>
              <Text style={[styles.amount, { color: theme.text }]}>{money(b.cents)}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      <Section
        title="Budgets"
        footer={review.budgets.length > 0 ? 'Rollover is set per budget: tap one on this month’s Budgets page.' : null}>
        {review.budgets.length === 0 ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>No budgets were set for {label}.</Text>
        ) : (
          <>
            <Text style={[styles.muted, { color: theme.textSecondary }]}>
              Kept {review.budgetsKept} of {review.budgets.length}.
            </Text>
            {review.budgets.map((b) => {
              const lines = budgetLines(b, review.month, review.currency);
              return (
                <View key={b.categoryName} style={styles.budget} accessible accessibilityLabel={`${b.categoryName}: ${lines.status}. ${lines.next}.`}>
                  <View style={styles.line}>
                    <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                      {b.categoryName}
                    </Text>
                    <Text style={[styles.body, { color: lines.over ? theme.danger : theme.positive }]}>{lines.status}</Text>
                  </View>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>{lines.next}</Text>
                </View>
              );
            })}
          </>
        )}
      </Section>

      <Section title="Close the month">
        <Text style={[styles.body, { color: theme.text }]}>{look.bank}</Text>
        {review.bankRowsWaiting > 0 ? (
          <Pressable onPress={() => router.navigate('/review')} accessibilityRole="link" hitSlop={8}>
            <Text style={[styles.body, { color: theme.tint }]}>Review them</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.body, { color: theme.text }]}>{look.entries}</Text>
        {review.entriesNeedingReview > 0 ? (
          <Pressable onPress={() => router.navigate({ pathname: '/transactions', params: { review: '1' } })} accessibilityRole="link" hitSlop={8}>
            <Text style={[styles.body, { color: theme.tint }]}>Open Needs review</Text>
          </Pressable>
        ) : null}
        {review.closedOn ? (
          <Text style={[styles.body, { color: theme.positive }]}>Closed on {formatDay(review.closedOn)}.</Text>
        ) : null}
      </Section>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.muted, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}
      <FormButton
        label={review.closedOn ? 'Reopen Month' : 'Mark Month Closed'}
        onPress={() => setClosed(!review.closedOn)}
        disabled={close.isPending}
      />
      <Text style={[styles.small, { color: theme.textSecondary }]}>
        Closing is a note to yourself that {label} has been looked at. Nothing is locked; entries can still be changed.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { gap: Spacing.one, marginHorizontal: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  grow: { flex: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  budget: { gap: 2 },
});
