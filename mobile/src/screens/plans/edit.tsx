import { Host, Picker } from '@expo/ui';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Account, Category, Plan, PlanList } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, localToday, ymdFromDate } from '@/utils/dates';
import { emptyPlanForm, formFromPlan, planBody, planPath, PLANS_PATH, type PlanForm } from '@/utils/plans';

const TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
] as const;

/**
 * A one-off plan, as the website's Plan tab takes it: what, how much, when, on which account and in
 * which category. It shows in Upcoming bills, the calendar, Safe to spend and every forecast until
 * an entry in the log turns out to be it.
 */
export function EditPlan({ id }: { id: string | null }) {
  const theme = useTheme();
  const plans = useApiQuery<PlanList>(id ? PLANS_PATH : null);
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useRememberedQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const plan = id ? plans.data?.plans.find((p) => p.id === id) : undefined;
  const failed = (id ? plans.error : null) ?? categories.error ?? accounts.error;
  const ready = categories.data && accounts.data && (!id || plans.data);

  if (!ready || (id && !plan)) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState
            loading={!failed && !(id && plans.data && !plan)}
            error={failed ? errorText(failed) : id && plans.data && !plan ? 'This plan has happened or was removed.' : null}
          />
        </ScrollView>
        <Stack.Title>{id ? 'Plan' : 'New plan'}</Stack.Title>
      </>
    );
  }
  return <PlanEditor plan={plan ?? null} categories={categories.data!.categories} accounts={accounts.data!.accounts} />;
}

function PlanEditor({ plan, categories, accounts }: { plan: Plan | null; categories: Category[]; accounts: Account[] }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const open = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<PlanForm>(() => (plan ? formFromPlan(plan) : emptyPlanForm(localToday(), open[0]?.id ?? '')));
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, { id: string }>(plan ? 'PATCH' : 'POST', () => (plan ? planPath(plan.id) : PLANS_PATH), (b) => b);
  const remove = useApiMutation<void, { ok: true }>('DELETE', () => planPath(plan!.id));
  const busy = save.isPending || remove.isPending;
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const kindCategories = categories.filter((c) => c.kind === form.type);
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save. Try again.');

  function submit() {
    const result = planBody(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(result.body, { onSuccess: () => router.back(), onError: fail });
  }

  function confirmRemove() {
    Alert.alert('Remove this plan?', 'It comes out of your forecasts. Nothing in your log changes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Plan', style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => router.back(), onError: fail }) },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        <SegmentedControl
          values={TYPES.map((t) => t.label)}
          selectedIndex={TYPES.findIndex((t) => t.value === form.type)}
          onChange={(event) => {
            const type = TYPES[event.nativeEvent.selectedSegmentIndex]?.value ?? form.type;
            // A category belongs to one kind.
            setForm((f) => ({ ...f, type, categoryId: type === f.type ? f.categoryId : '' }));
          }}
          accessibilityLabel="Kind of plan"
        />
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <Section>
          <FormField label="What">
            <TextInput
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder={form.type === 'income' ? 'Tax refund' : 'Car repair'}
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              maxLength={120}
              autoFocus={!plan}
            />
          </FormField>
          <FormField label="Amount">
            <TextInput
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numbers-and-punctuation"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
            />
          </FormField>
          <FormField label="Expected on">
            <DateTimePicker
              value={dateFromYmd(form.date)}
              onValueChange={(_, date) => set('date', ymdFromDate(date))}
              display="compact"
              timeZoneName="UTC"
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
            />
          </FormField>
        </Section>
        <Section footer="Once an entry like it lands in your log, on the same account, the plan is settled by itself.">
          <FormField label="Account">
            <Host matchContents>
              <Picker selectedValue={form.accountId} onValueChange={(v) => set('accountId', String(v))}>
                {open.map((a) => (
                  <Picker.Item key={a.id} label={a.name} value={a.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          <FormField label="Category">
            <Host matchContents>
              <Picker selectedValue={form.categoryId} onValueChange={(v) => set('categoryId', String(v))}>
                {form.categoryId ? null : <Picker.Item label="Pick one" value="" />}
                {kindCategories.map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          <TextInput
            value={form.note}
            onChangeText={(v) => set('note', v)}
            placeholder="Note"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[formStyles.note, { color: theme.text }]}
            maxLength={250}
          />
        </Section>
        {plan ? <FormButton label="Remove Plan" destructive onPress={confirmRemove} disabled={busy} /> : null}
      </ScrollView>
      <Stack.Title>{plan ? plan.name : 'New plan'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          {plan ? 'Save' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
