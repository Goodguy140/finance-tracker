import { Host, Picker } from '@expo/ui';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { InvestmentActivity, Investments } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, ymdFromDate } from '@/utils/dates';
import { entryBody, entryForm, entryPath, INVESTMENTS_PATH, pickerAccounts, type EntryForm, type EntryKind } from '@/utils/investments';

const DIRECTIONS = ['contribution', 'withdrawal'] as const;

/** A contribution or withdrawal (`flow`) or a portfolio value: added, or changed and deleted (`id`). */
export function InvestmentEntry({ kind, id }: { kind: EntryKind; id: string | null }) {
  const theme = useTheme();
  const query = useApiQuery<Investments>(INVESTMENTS_PATH);
  const item = id
    ? query.data?.activity.find((a) => a.id === id && (kind === 'value' ? a.kind === 'value' : a.kind === 'contribution' || a.kind === 'withdrawal'))
    : undefined;
  const title = kind === 'value' ? (id ? 'Portfolio value' : 'New value') : id ? 'Contribution or withdrawal' : 'New entry';
  if (!query.data || (id && !item)) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState
            loading={query.isPending}
            error={query.error ? errorText(query.error) : query.data ? 'This was deleted, or is no longer among the newest.' : null}
          />
        </ScrollView>
        <Stack.Title>{title}</Stack.Title>
      </>
    );
  }
  return <EntryEditor kind={kind} item={item ?? null} data={query.data} title={title} />;
}

function EntryEditor({ kind, item, data, title }: { kind: EntryKind; item: InvestmentActivity | null; data: Investments; title: string }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [form, setForm] = useState<EntryForm>(() => entryForm(item ?? undefined, data));
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, { id: string }>(item ? 'PATCH' : 'POST', () => entryPath(kind, item?.id), (b) => b);
  const remove = useApiMutation<void, { ok: true }>('DELETE', () => entryPath(kind, item!.id));
  const busy = save.isPending || remove.isPending;
  const set = <K extends keyof EntryForm>(key: K, value: EntryForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(errorText(err));
  // An archived account an entry already belongs to stays listed, so opening it does not move it.
  const accounts = pickerAccounts(data.accounts);
  const listed =
    item?.accountId && !accounts.some((a) => a.id === item.accountId)
      ? [...accounts, { id: item.accountId, name: `${item.accountName} (archived)`, type: '', currency: item.currency, registered: false }]
      : accounts;

  function send(body: Record<string, unknown>) {
    setError(null);
    save.mutate(body, {
      onSuccess: () => router.back(),
      onError: (err) => {
        // Over the year's room: the server says what it costs, and records it once told to, as the card's Add anyway.
        if (err instanceof ApiError && err.status === 409) {
          Alert.alert('Over the room', err.message, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add Anyway', onPress: () => send({ ...body, overRoom: true }) },
          ]);
          return;
        }
        fail(err);
      },
    });
  }

  function submit() {
    const result = entryBody(kind, form);
    if ('error' in result) return setError(result.error);
    send(result.body);
  }

  function confirmDelete() {
    const what = kind === 'value' ? 'this portfolio value' : `this ${item!.kind}`;
    Alert.alert(`Delete ${what}?`, item!.fromTransfer ? 'The transfer it came from can be counted toward room again.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => router.back(), onError: fail }) },
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
        {kind === 'flow' ? (
          <SegmentedControl
            values={['Contribution', 'Withdrawal']}
            selectedIndex={DIRECTIONS.indexOf(form.direction)}
            onChange={(event) => set('direction', DIRECTIONS[event.nativeEvent.selectedSegmentIndex] ?? form.direction)}
            accessibilityLabel="Money in or out of the account"
          />
        ) : null}
        <Section
          footer={
            kind === 'value'
              ? 'The account’s whole value on the day, from a statement or the broker’s site. Returns are worked out from these.'
              : 'A contribution to a TFSA, RRSP or FHSA uses that year’s room. You are told first if it would go over.'
          }>
          <FormField label="Account">
            <Host matchContents>
              <Picker selectedValue={form.accountId} onValueChange={(v) => set('accountId', String(v))}>
                {listed.map((a) => (
                  <Picker.Item key={a.id} label={a.name} value={a.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          <FormField label={kind === 'value' ? 'Total value' : 'Amount'}>
            <TextInput
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              autoFocus={!item}
            />
          </FormField>
          <FormField label="Date">
            <DateTimePicker
              value={dateFromYmd(form.date)}
              onValueChange={(_, date) => set('date', ymdFromDate(date))}
              display="compact"
              timeZoneName="UTC"
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
            />
          </FormField>
          <FormField label="Note">
            <TextInput
              value={form.note}
              onChangeText={(v) => set('note', v)}
              placeholder="Optional"
              placeholderTextColor={theme.textSecondary}
              maxLength={250}
              style={[formStyles.input, { color: theme.text }]}
            />
          </FormField>
        </Section>
        {item ? <FormButton label="Delete" destructive onPress={confirmDelete} disabled={busy} /> : null}
      </ScrollView>
      <Stack.Title>{title}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          {item ? 'Save' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
