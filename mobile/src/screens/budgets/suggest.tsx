import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { BudgetSuggestions, BudgetSuggestionSet } from '@/api/types';
import { formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  BUDGET_SUGGESTIONS_PATH,
  incomeLine,
  initialPicks,
  monthsLine,
  pickedBudgets,
  totalAfter,
  type SuggestionPick,
} from '@/utils/category-edits';
import { formatCents } from '@/utils/money';

/**
 * The website's Suggest budgets: a monthly amount for each spending category from the last 3 or 6
 * full months (the median month, so a one-off is passed over, rounded up), each to tick and change,
 * with the total against average income. The ticked ones are set from this month on.
 */
export function SuggestBudgets() {
  const theme = useTheme();
  const query = useApiQuery<BudgetSuggestions>(BUDGET_SUGGESTIONS_PATH);
  const data = query.data;
  if (!data || data.sets.length === 0) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
        </ScrollView>
        <Stack.Title>Suggest Budgets</Stack.Title>
      </>
    );
  }
  return <Suggestions data={data} />;
}

function Suggestions({ data }: { data: BudgetSuggestions }) {
  const theme = useTheme();
  const router = useRouter();
  const [window, setWindow] = useState(data.sets[0].window);
  const set = data.sets.find((s) => s.window === window) ?? data.sets[0];
  const [picks, setPicks] = useState<Record<string, SuggestionPick>>(() => initialPicks(set));
  const [error, setError] = useState<string | null>(null);
  const apply = useApiMutation<{ budgets: { categoryId: string; limitCents: number }[] }, { set: number }>(
    'POST',
    () => BUDGET_SUGGESTIONS_PATH,
    (b) => b,
  );
  const picked = pickedBudgets(set, picks);
  const chosen = 'budgets' in picked ? picked.budgets : [];
  const total = totalAfter(data.currentBudgets, chosen);
  const income = incomeLine(set.averageIncomeCents, total, data.currency);
  const empty = set.months.length === 0 || set.rows.length === 0;
  const ticked = set.rows.filter((row) => picks[row.categoryId]?.ticked).length;

  function pickWindow(next: BudgetSuggestionSet) {
    setWindow(next.window);
    setPicks(initialPicks(next));
  }

  function update(categoryId: string, change: Partial<SuggestionPick>) {
    setPicks((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], ...change } }));
  }

  function submit() {
    setError(null);
    if ('error' in picked) return setError(picked.error);
    if (chosen.length === 0) return setError('Tick at least one budget to set.');
    apply.mutate({ budgets: chosen }, { onSuccess: () => router.back(), onError: (err) => setError(errorText(err)) });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        {data.sets.length > 1 ? (
          <SegmentedControl
            values={data.sets.map((s) => `Last ${s.window} months`)}
            selectedIndex={Math.max(0, data.sets.findIndex((s) => s.window === set.window))}
            onChange={(event) => {
              const next = data.sets[event.nativeEvent.selectedSegmentIndex];
              if (next) pickWindow(next);
            }}
          />
        ) : null}
        {empty ? (
          <Section>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              There is no full month of spending to go on yet. Come back after your first month of transactions.
            </Text>
          </Section>
        ) : (
          <>
            <Text style={[styles.intro, { color: theme.textSecondary }]}>
              Each amount is a typical month of {set.span} (the median, so a one-off month does not count), rounded up. Ticked ones
              are set from this month on.
            </Text>
            <Section>
              {set.rows.map((row) => {
                const pick = picks[row.categoryId];
                return (
                  <View key={row.categoryId} style={styles.row}>
                    <Switch
                      value={pick?.ticked ?? false}
                      onValueChange={(ticked) => update(row.categoryId, { ticked })}
                      accessibilityLabel={`Set ${row.categoryName}`}
                    />
                    <View style={styles.grow}>
                      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                        {row.categoryName}
                      </Text>
                      <Text style={[styles.small, { color: theme.textSecondary }]}>{monthsLine(row, set.months, data.currency)}</Text>
                      {row.currentLimitCents !== null ? (
                        <Text style={[styles.small, { color: theme.textSecondary }]}>
                          Budget now {formatCents(row.currentLimitCents, data.currency)}
                        </Text>
                      ) : null}
                    </View>
                    <TextInput
                      value={pick?.amount ?? ''}
                      onChangeText={(amount) => update(row.categoryId, { amount, ticked: true })}
                      keyboardType="decimal-pad"
                      style={[formStyles.input, formStyles.amount, styles.amount, { color: theme.text }]}
                      accessibilityLabel={`${row.categoryName} monthly budget`}
                    />
                  </View>
                );
              })}
            </Section>
            <Section footer={income}>
              <View style={styles.total}>
                <Text style={[styles.name, styles.grow, { color: theme.text }]}>Budgets after this</Text>
                <Text style={[styles.name, styles.amountText, { color: theme.text }]}>{formatCents(total, data.currency)} a month</Text>
              </View>
            </Section>
          </>
        )}
      </ScrollView>
      <Stack.Title>Suggest Budgets</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      {!empty ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" disabled={apply.isPending || ticked === 0} onPress={submit}>
            {`Set ${ticked}`}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  amount: { minWidth: 72 },
  amountText: { fontVariant: ['tabular-nums'] },
  total: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
});
