import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { BudgetRow, Budgets } from '@/api/types';
import { FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { budgetPath, canEditBudgets, coverPlan, coverPrefill, coverSources, overageCents, roomCents } from '@/utils/budget-edits';
import { formatCents } from '@/utils/money';

/**
 * The website's "Cover overage": take from other budgets' room this month to raise an overspent
 * one's limit. Filled in to cover it all from the roomiest budgets first; any amount can change.
 */
export function CoverBudget({ categoryId }: { categoryId: string }) {
  const theme = useTheme();
  const budgets = useApiQuery<Budgets>('/api/v1/budgets');
  const data = budgets.data;
  const row = data?.budgets.find((b) => b.categoryId === categoryId);
  if (!data || !row || !canEditBudgets(data) || overageCents(row) === 0) {
    const gone = data && (!row || overageCents(row) === 0) ? 'This budget is no longer over.' : null;
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!budgets.error && !data} error={budgets.error ? errorText(budgets.error) : gone} />
        </ScrollView>
        <Stack.Title>Cover overage</Stack.Title>
      </>
    );
  }
  return <CoverForm data={data} row={row} />;
}

function CoverForm({ data, row }: { data: Budgets; row: BudgetRow }) {
  const theme = useTheme();
  const router = useRouter();
  const overage = overageCents(row);
  const sources = coverSources(data, row.categoryId);
  const [amounts, setAmounts] = useState(() => coverPrefill(overage, sources));
  const [error, setError] = useState<string | null>(null);
  const plan = coverPlan(overage, sources, amounts, data.currency);
  const save = useApiMutation<typeof plan.from, { ok: true }>('POST', () => budgetPath(row.categoryId, 'cover'), (from) => ({ from }));
  const money = (cents: number) => formatCents(cents, data.currency);

  function submit() {
    if (plan.error) return setError(plan.error);
    setError(null);
    save.mutate(plan.from, {
      onSuccess: () => router.dismissAll(),
      onError: (err) => setError(errorText(err)),
    });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        <Text style={[styles.summary, { color: theme.textSecondary }]}>
          {money(row.spentCents)} spent of {money(row.limitCents)}, <Text style={{ color: theme.danger }}>{money(overage)} over</Text>.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        {sources.length === 0 ? (
          <Section>
            <Text style={[styles.muted, { color: theme.textSecondary }]}>
              No other budget has room to give this month. Raise this one instead, from its budget sheet.
            </Text>
          </Section>
        ) : (
          <Section
            title="Take from"
            footer={`${row.categoryName}'s limit goes up by what you take, and each budget's goes down, for this month on. Each can give at most what it has left.`}>
            {sources.map((source) => (
              <FormField key={source.categoryId} label={source.categoryName} note={`${money(roomCents(source))} left to give`}>
                <TextInput
                  value={amounts[source.categoryId] ?? ''}
                  onChangeText={(v) => setAmounts((a) => ({ ...a, [source.categoryId]: v }))}
                  placeholder="0.00"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[formStyles.input, formStyles.amount, { color: theme.text }]}
                  accessibilityLabel={`Take from ${source.categoryName}`}
                />
              </FormField>
            ))}
          </Section>
        )}
        {sources.length > 0 ? (
          <View style={styles.totals} accessible accessibilityLabel={`Taking ${money(plan.allocatedCents)}. ${plan.remainingCents >= 0 ? `${money(plan.remainingCents)} still to cover` : `${money(-plan.remainingCents)} too much`}.`}>
            <Text style={[styles.total, { color: theme.text }]}>Taking {money(plan.allocatedCents)}</Text>
            <Text style={[styles.total, { color: plan.remainingCents < 0 ? theme.danger : plan.remainingCents === 0 ? theme.positive : theme.textSecondary }]}>
              {plan.remainingCents >= 0 ? `${money(plan.remainingCents)} still to cover` : `${money(-plan.remainingCents)} too much`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <Stack.Title>{`Cover ${row.categoryName}`}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={save.isPending || sources.length === 0} onPress={submit}>
          Move
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: Spacing.one, gap: Spacing.two },
  total: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
