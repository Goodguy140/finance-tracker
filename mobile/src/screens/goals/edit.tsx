import { Host, Picker } from '@expo/ui';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { SavingsGoal, SavingsGoals } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, ymdFromDate } from '@/utils/dates';
import { emptyGoalForm, formFromGoal, goalBody, goalPath, GOALS_PATH, parseContribution, type GoalForm } from '@/utils/goals';
import { formatCents } from '@/utils/money';
import { amountInputText } from '@/utils/transactions';

import { GoalProgress } from './progress';

/** A savings goal, with Settings → Savings goals' fields; a hand-tracked one also takes money in and out. */
export function EditGoal({ id }: { id: string | null }) {
  const theme = useTheme();
  const query = useApiQuery<SavingsGoals>(GOALS_PATH);
  const goal = id ? query.data?.goals.find((g) => g.id === id) : undefined;
  if (!query.data || (id && !goal)) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState
            loading={query.isPending}
            error={query.error ? errorText(query.error) : query.data ? 'This goal was deleted.' : null}
          />
        </ScrollView>
        <Stack.Title>{id ? 'Goal' : 'New goal'}</Stack.Title>
      </>
    );
  }
  return <GoalEditor goal={goal ?? null} data={query.data} />;
}

function GoalEditor({ goal, data }: { goal: SavingsGoal | null; data: SavingsGoals }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [form, setForm] = useState<GoalForm>(() => (goal ? formFromGoal(goal, data.today) : emptyGoalForm(data.today)));
  // Money added or taken out moves the saved amount; the field follows it, so Save does not undo it.
  const [manualSeen, setManualSeen] = useState(goal?.manualSavedCents ?? 0);
  if (goal && goal.manualSavedCents !== manualSeen) {
    setManualSeen(goal.manualSavedCents);
    setForm((f) => ({ ...f, saved: amountInputText(goal.manualSavedCents) }));
  }
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, { id: string }>(goal ? 'PATCH' : 'POST', () => goalPath(goal?.id), (b) => b);
  const contribute = useApiMutation<number, { ok: true }>('POST', () => goalPath(goal!.id, 'contribute'), (amountCents) => ({ amountCents }));
  const remove = useApiMutation<void, { ok: true }>('DELETE', () => goalPath(goal!.id));
  const busy = save.isPending || contribute.isPending || remove.isPending;
  const set = <K extends keyof GoalForm>(key: K, value: GoalForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(errorText(err));
  // An archived account a goal already follows stays listed, so opening the goal does not change it.
  const accounts =
    goal?.account && !data.accounts.some((a) => a.id === goal.account!.id)
      ? [...data.accounts, { id: goal.account.id, name: `${goal.account.name} (archived)`, type: '' }]
      : data.accounts;
  const handTracked = goal !== null && goal.account === null;

  function submit() {
    const result = goalBody(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(result.body, { onSuccess: () => router.back(), onError: fail });
  }

  function askContribution(takeOut: boolean) {
    Alert.prompt(
      takeOut ? 'Take money out' : 'Add money',
      takeOut ? `How much came out of ${goal!.name}?` : `How much went toward ${goal!.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: takeOut ? 'Take Out' : 'Add',
          onPress: (raw?: string) => {
            const cents = parseContribution(raw ?? '');
            if (cents === null || cents < 0) return setError('Enter an amount, like 50.');
            setError(null);
            contribute.mutate(takeOut ? -cents : cents, { onError: fail });
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );
  }

  function confirmDelete() {
    Alert.alert(`Delete ${goal!.name}?`, goal!.account ? `${goal!.account.name} and its balance are not touched.` : 'What it has recorded goes with it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Goal', style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => router.back(), onError: fail }) },
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
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        {goal ? (
          <Section>
            <GoalProgress goal={goal} />
          </Section>
        ) : null}
        <Section>
          <FormField label="Name">
            <TextInput
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="Emergency fund"
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              maxLength={80}
              autoFocus={!goal}
            />
          </FormField>
          <FormField label="Target">
            <TextInput
              value={form.target}
              onChangeText={(v) => set('target', v)}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
            />
          </FormField>
          <FormField label="By a date" note={form.hasDate ? null : 'Without a date, the goal shows its progress and when it would be reached.'}>
            <Switch value={form.hasDate} onValueChange={(v) => set('hasDate', v)} accessibilityLabel="Reach it by a date" />
          </FormField>
          {form.hasDate ? (
            <FormField label="Date">
              <DateTimePicker
                value={dateFromYmd(form.date)}
                onValueChange={(_, date) => set('date', ymdFromDate(date))}
                display="compact"
                timeZoneName="UTC"
                themeVariant={scheme === 'dark' ? 'dark' : 'light'}
              />
            </FormField>
          ) : null}
        </Section>
        <Section
          footer={
            form.accountId
              ? 'Progress is the account’s latest balance, and its pace how the balance or the transfers into it have grown.'
              : 'Record what you put toward it as you go.'
          }>
          <FormField label="Progress">
            <Host matchContents>
              <Picker selectedValue={form.accountId} onValueChange={(v) => set('accountId', String(v))}>
                <Picker.Item label="Tracked by hand" value="" />
                {accounts.map((a) => (
                  <Picker.Item key={a.id} label={`Follows ${a.name}`} value={a.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          {!form.accountId ? (
            <FormField label="Saved so far">
              <TextInput
                value={form.saved}
                onChangeText={(v) => set('saved', v)}
                placeholder="0.00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              />
            </FormField>
          ) : null}
        </Section>
        {handTracked ? (
          <>
            <FormButton label="Add Money" onPress={() => askContribution(false)} disabled={busy} />
            {goal.manualSavedCents > 0 ? (
              <FormButton
                label={`Take Money Out (${formatCents(goal.manualSavedCents, goal.currency)} saved)`}
                onPress={() => askContribution(true)}
                disabled={busy}
              />
            ) : null}
          </>
        ) : null}
        {goal ? <FormButton label="Delete Goal" destructive onPress={confirmDelete} disabled={busy} /> : null}
      </ScrollView>
      <Stack.Title>{goal ? goal.name : 'New goal'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          {goal ? 'Save' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
