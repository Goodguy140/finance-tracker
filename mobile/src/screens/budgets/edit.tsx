import { Host, Picker } from '@expo/ui';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Budgets, Category } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import { budgetFormFor, budgetPatch, budgetPath, canEditBudgets, overageCents, type BudgetForm, type BudgetPatch } from '@/utils/budget-edits';
import { formatCents, formatPeriodMonth } from '@/utils/money';

/**
 * A category's budgets, as the website's Settings → Categories sets them: the monthly budget from
 * this month on, rollover, and a yearly budget. Opened without a category, it adds a budget to one
 * that has none.
 */
export function EditBudget({ categoryId }: { categoryId: string | null }) {
  const theme = useTheme();
  const budgets = useApiQuery<Budgets>('/api/v1/budgets');
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const failed = budgets.error ?? categories.error;
  if (!budgets.data || !categories.data || !canEditBudgets(budgets.data)) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState
            loading={!failed && !budgets.data}
            error={failed ? errorText(failed) : budgets.data ? 'This server is too old to change budgets from the phone. Update it, or use the website.' : null}
          />
        </ScrollView>
        <Stack.Title>Budget</Stack.Title>
      </>
    );
  }
  return <BudgetEditor data={budgets.data} categories={categories.data.categories} categoryId={categoryId} />;
}

function BudgetEditor({ data, categories, categoryId }: { data: Budgets; categories: Category[]; categoryId: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const budgeted = new Set([...data.budgets.map((b) => b.categoryId), ...(data.yearly ?? []).map((y) => y.categoryId)]);
  const unbudgeted = categories.filter((c) => c.kind === 'expense' && !budgeted.has(c.id));
  const [picked, setPicked] = useState(categoryId ?? unbudgeted[0]?.id ?? '');
  const initial = budgetFormFor(data, picked);
  const [form, setForm] = useState<BudgetForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<BudgetPatch, { ok: true }>('PATCH', () => budgetPath(picked), (b) => b);
  const name = categories.find((c) => c.id === picked)?.name ?? data.budgets.find((b) => b.categoryId === picked)?.categoryName ?? 'Budget';
  const row = data.budgets.find((b) => b.categoryId === picked);
  const over = row ? overageCents(row) : 0;
  const set = <K extends keyof BudgetForm>(key: K, value: BudgetForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit() {
    const result = budgetPatch(initial, form);
    if ('error' in result) return setError(result.error);
    setError(null);
    if (Object.keys(result.body).length === 0) return router.back();
    const send = () =>
      save.mutate(result.body, {
        onSuccess: () => router.back(),
        onError: (err) => setError(errorText(err)),
      });
    if (!result.removesMonthly) return send();
    Alert.alert(`Remove the ${name} budget?`, `Every month's ${name} budget goes, earlier months too, and rollover with it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Budget', style: 'destructive', onPress: send },
    ]);
  }

  if (!categoryId && unbudgeted.length === 0) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <Section>
            <Text style={[styles.muted, { color: theme.textSecondary }]}>
              Every expense category has a budget. Tap one on the Budgets page to change it.
            </Text>
          </Section>
        </ScrollView>
        <Stack.Title>Add a budget</Stack.Title>
      </>
    );
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
        {!categoryId ? (
          <Section>
            <FormField label="Category">
              <Host matchContents>
                <Picker
                  selectedValue={picked}
                  onValueChange={(v) => {
                    setPicked(String(v));
                    setForm(budgetFormFor(data, String(v)));
                  }}>
                  {unbudgeted.map((c) => (
                    <Picker.Item key={c.id} label={c.name} value={c.id} />
                  ))}
                </Picker>
              </Host>
            </FormField>
          </Section>
        ) : null}
        <Section
          footer={`From ${formatPeriodMonth(data.currentMonth!)} on; earlier months keep what they had. Clear it to remove the budget, every month of it.`}>
          <FormField label={`Monthly (${data.currency})`}>
            <TextInput
              value={form.monthly}
              onChangeText={(v) => set('monthly', v)}
              placeholder="None"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              autoFocus={!categoryId}
              accessibilityLabel="Monthly budget"
            />
          </FormField>
          {form.monthly.trim() ? (
            <FormField label="Roll over what's left" note="What is left this month, or overspent, carries into next month's budget.">
              <Switch value={form.rollover} onValueChange={(on) => set('rollover', on)} accessibilityLabel="Roll over what's left" />
            </FormField>
          ) : null}
        </Section>
        <Section footer="For a cost that comes once or twice a year. A twelfth is set aside each month as a sinking fund, kept out of the monthly totals. Clear it to remove it.">
          <FormField label={`Yearly (${data.currency})`}>
            <TextInput
              value={form.yearly}
              onChangeText={(v) => set('yearly', v)}
              placeholder="None"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              accessibilityLabel="Yearly budget"
            />
          </FormField>
        </Section>
        {over > 0 ? (
          <FormButton
            label={`Cover the ${formatCents(over, data.currency)} over from other budgets`}
            onPress={() => router.push({ pathname: '/budget-cover', params: { categoryId: picked } })}
          />
        ) : null}
      </ScrollView>
      <Stack.Title>{categoryId ? name : 'Add a budget'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={save.isPending || !picked} onPress={submit}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 15, lineHeight: 21 },
});
