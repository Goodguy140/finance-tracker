import { Host, Picker } from '@expo/ui';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { AccountPage, Me } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import {
  ACCOUNT_TYPES,
  accountForm,
  accountPatch,
  ACCOUNTS_PATH,
  emptyAccountForm,
  newAccountBody,
  type AccountForm,
} from '@/utils/account-settings';
import { accountPath, REGISTER_MONTHS } from '@/utils/accounts';

/** Settings → Accounts' add form (no `id`), or an account's settings with Archive or Restore. */
export function EditAccount({ id }: { id: string | null }) {
  const theme = useTheme();
  const me = useApiQuery<Me>('/api/v1/me');
  const query = useApiQuery<AccountPage>(id ? accountPath(id, REGISTER_MONTHS[0]) : null);
  if (id ? !query.data : !me.data) {
    const error = id ? query.error : me.error;
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!error} error={error ? errorText(error) : null} />
        </ScrollView>
        <Stack.Title>{id ? 'Account' : 'New account'}</Stack.Title>
      </>
    );
  }
  return <AccountEditor page={id ? query.data! : null} homeCurrency={me.data?.user.currency ?? 'CAD'} />;
}

function AccountEditor({ page, homeCurrency }: { page: AccountPage | null; homeCurrency: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<AccountForm>(() => (page ? accountForm(page) : emptyAccountForm(homeCurrency)));
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation<Record<string, unknown>, { id: string }>('POST', () => ACCOUNTS_PATH, (b) => b);
  const patch = useApiMutation<Record<string, unknown>, { id: string }>('PATCH', () => `${ACCOUNTS_PATH}/${encodeURIComponent(page!.account.id)}`, (b) => b);
  const busy = create.isPending || patch.isPending;
  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(errorText(err));
  const done = { onSuccess: () => router.back(), onError: fail };

  function submit() {
    setError(null);
    if (!page) {
      const result = newAccountBody(form);
      if ('error' in result) return setError(result.error);
      return create.mutate(result.body, done);
    }
    const result = accountPatch(form, page);
    if (result === null) return router.back();
    if ('error' in result) return setError(result.error);
    patch.mutate(result.body, done);
  }

  function toggleArchived() {
    if (!page) return;
    if (page.account.archived) return patch.mutate({ archived: false }, done);
    Alert.alert(
      `Archive ${page.account.name}?`,
      'It leaves the pickers and the account list. Its history, balances and totals stay, and it can be restored from Accounts.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => patch.mutate({ archived: true }, done) },
      ],
    );
  }

  const card = form.type === 'CREDIT_CARD';

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
        <Section
          footer={
            page
              ? null
              : `In ${homeCurrency}, counted as savings when its type usually is. Change either afterwards from the account's page.`
          }>
          <FormField label="Name">
            <TextInput
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="Chequing"
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              maxLength={80}
              autoFocus={!page}
            />
          </FormField>
          <FormField label="Type">
            <Host matchContents>
              <Picker selectedValue={form.type} onValueChange={(v) => set('type', String(v))}>
                {ACCOUNT_TYPES.map((t) => (
                  <Picker.Item key={t.value} label={t.label} value={t.value} />
                ))}
              </Picker>
            </Host>
          </FormField>
          {page ? (
            <FormField label="Currency" note="It can't change once the account holds money in it.">
              <TextInput
                value={form.currency}
                onChangeText={(v) => set('currency', v)}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
                style={[formStyles.input, { color: theme.text }]}
              />
            </FormField>
          ) : null}
        </Section>
        {page?.settings ? (
          <Section footer="Transfers into it count as saved in Reports and the financial score.">
            <FormField label="Counts as savings">
              <Switch value={form.countsAsSavings} onValueChange={(v) => set('countsAsSavings', v)} accessibilityLabel="Counts as savings" />
            </FormField>
          </Section>
        ) : null}
        {page?.settings && card ? (
          <Section
            title="Card"
            footer="The limit shows how much of it is used (keeping under 30% helps a credit score). The due day puts the payment in Insights and bill reminders. Leave either empty to clear it.">
            <FormField label={`Credit limit (${form.currency.toUpperCase() || page.account.currency})`}>
              <TextInput
                value={form.creditLimit}
                onChangeText={(v) => set('creditLimit', v)}
                placeholder="5000.00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              />
            </FormField>
            <FormField label="Payment due day">
              <TextInput
                value={form.dueDay}
                onChangeText={(v) => set('dueDay', v)}
                placeholder="21"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                maxLength={2}
                style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              />
            </FormField>
          </Section>
        ) : null}
        {page ? (
          <FormButton
            label={page.account.archived ? 'Restore Account' : 'Archive Account'}
            destructive={!page.account.archived}
            onPress={toggleArchived}
            disabled={busy}
          />
        ) : null}
      </ScrollView>
      <Stack.Title>{page ? page.account.name : 'New account'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          {page ? 'Save' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
