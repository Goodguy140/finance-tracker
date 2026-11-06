import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { Host, Picker } from '@expo/ui';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Account, Category, TransactionDetail } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { offerUndo } from '@/state/undo-offer';
import { dateFromYmd, ymdFromDate } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import {
  amountInputText,
  changedFields,
  formFromTransaction,
  lockedReason,
  transactionName,
  transactionSubtitle,
  transferSides,
  type EditForm,
} from '@/utils/transactions';

import { Receipts } from './receipts';

const NO_ACCOUNT = '';

/** One entry, editable: what the phone can change, and why the rest is on the website. */
export function EditTransaction({ id }: { id: string }) {
  const theme = useTheme();
  const detail = useApiQuery<{ transaction: TransactionDetail }>(`/api/v1/transactions/${encodeURIComponent(id)}`);
  const categories = useApiQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useApiQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const row = detail.data?.transaction;
  const failed = detail.error ?? categories.error ?? accounts.error;

  if (!row || !categories.data || !accounts.data) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!failed} error={failed ? errorText(failed) : null} />
        </ScrollView>
        <Stack.Title>Transaction</Stack.Title>
      </>
    );
  }
  // Keyed by id: the form starts from the entry once and keeps what the person types.
  return <Editor key={row.id} row={row} categories={categories.data.categories} accounts={accounts.data.accounts} />;
}

function Editor({ row, categories, accounts }: { row: TransactionDetail; categories: Category[]; accounts: Account[] }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [form, setForm] = useState<EditForm>(() => formFromTransaction(row));
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, { transaction: TransactionDetail }>(
    'PATCH',
    () => `/api/v1/transactions/${encodeURIComponent(row.id)}`,
    (body) => body,
  );
  const remove = useApiMutation<void, { undoId: string }>('DELETE', () => `/api/v1/transactions/${encodeURIComponent(row.id)}`);
  const busy = save.isPending || remove.isPending;

  const change = changedFields(row, form);
  const dirty = 'error' in change || Object.keys(change.body).length > 0;
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save. Try again.');

  const kind = row.type === 'income' ? 'income' : 'expense';
  const categoryOptions = categories.filter((c) => c.kind === kind || c.id === row.categoryId);
  // An archived account stays listed only while the entry is on it.
  const accountOptions = accounts.filter((a) => !a.archived || a.id === row.accountId || a.id === row.transferAccountId);
  const amountLock = lockedReason(row, 'amount');
  const categoryLock = lockedReason(row, 'category');
  const accountLock = lockedReason(row, 'account');
  const currency = row.currency ?? 'CAD';
  const sides = transferSides(row);
  // A locked side is shown as saved.
  const savedName = (side: 'accountId' | 'transferAccountId') =>
    (side === 'accountId' ? row.accountName : row.transferAccountName) ?? 'Not set';

  const accountPicker = (value: string | null, onChange: (id: string | null) => void, emptyLabel: string) => (
    <Host matchContents>
      <Picker selectedValue={value ?? NO_ACCOUNT} onValueChange={(v) => onChange(v === NO_ACCOUNT ? null : String(v))}>
        <Picker.Item label={emptyLabel} value={NO_ACCOUNT} />
        {accountOptions.map((a) => (
          <Picker.Item key={a.id} label={a.name} value={a.id} />
        ))}
      </Picker>
    </Host>
  );

  function submit() {
    if ('error' in change) return setError(change.error);
    setError(null);
    save.mutate(change.body, { onSuccess: () => router.back(), onError: fail });
  }

  function markReviewed() {
    setError(null);
    save.mutate({ reviewed: true }, { onSuccess: () => router.back(), onError: fail });
  }

  function confirmDelete() {
    Alert.alert('Delete this transaction?', 'You can undo this for a few seconds afterwards.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(undefined, {
            onSuccess: (result) => {
              offerUndo({ kind: 'deleted', undoId: result.undoId, label: transactionName(row) });
              router.back();
            },
            onError: fail,
          }),
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        <Section footer={transactionSubtitle(row)}>
          <FormField label="Title">
            <TextInput
              value={form.title}
              onChangeText={(v) => set('title', v)}
              placeholder={row.categoryName}
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              returnKeyType="done"
              maxLength={200}
            />
          </FormField>
          <FormField label="Amount" note={amountLock}>
            <TextInput
              // A transfer's sign is which way it went, which From and To already say.
              value={row.type === 'transfer' ? amountInputText(Math.abs(row.amountCents)) : form.amount}
              onChangeText={(v) => set('amount', v)}
              editable={!amountLock}
              keyboardType="numbers-and-punctuation"
              style={[formStyles.input, formStyles.amount, { color: amountLock ? theme.textSecondary : theme.text }]}
              accessibilityHint={row.type === 'expense' ? 'A minus sign makes it a refund' : undefined}
            />
          </FormField>
        </Section>

        <Section>
          <FormField label="Date">
            <DateTimePicker
              value={dateFromYmd(form.date)}
              onValueChange={(_, date) => set('date', ymdFromDate(date))}
              display="compact"
              timeZoneName="UTC"
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
            />
          </FormField>
          <FormField label="Posted by the bank">
            <Switch
              value={form.postedDate !== null}
              onValueChange={(on) => set('postedDate', on ? (row.postedDate ?? form.date) : null)}
              accessibilityLabel="Posted by the bank"
            />
          </FormField>
          {form.postedDate !== null ? (
            <FormField label="Posted on">
              <DateTimePicker
                value={dateFromYmd(form.postedDate)}
                onValueChange={(_, date) => set('postedDate', ymdFromDate(date))}
                display="compact"
                timeZoneName="UTC"
                themeVariant={scheme === 'dark' ? 'dark' : 'light'}
              />
            </FormField>
          ) : null}
        </Section>

        {row.type === 'transfer' ? (
          <Section footer={accountLock ? null : 'Picking them the other way round reverses the transfer.'}>
            <FormField label="From">
              {accountLock ? (
                <Text style={[formStyles.value, { color: theme.textSecondary }]}>{savedName(sides.from)}</Text>
              ) : (
                accountPicker(form[sides.from], (id) => set(sides.from, id), 'Not set')
              )}
            </FormField>
            <FormField label="To" note={accountLock}>
              {accountLock ? (
                <Text style={[formStyles.value, { color: theme.textSecondary }]}>{savedName(sides.to)}</Text>
              ) : (
                accountPicker(form[sides.to], (id) => set(sides.to, id), 'Not set')
              )}
            </FormField>
          </Section>
        ) : (
          <Section>
            <FormField label="Category" note={categoryLock}>
              {categoryLock ? (
                <Text style={[formStyles.value, { color: theme.textSecondary }]}>{row.categoryName}</Text>
              ) : (
                <Host matchContents>
                  <Picker selectedValue={form.categoryId} onValueChange={(v) => set('categoryId', String(v))}>
                    {categoryOptions.map((c) => (
                      <Picker.Item key={c.id} label={c.name} value={c.id} />
                    ))}
                  </Picker>
                </Host>
              )}
            </FormField>
            <FormField label="Account" note={accountLock}>
              {accountLock ? (
                <Text style={[formStyles.value, { color: theme.textSecondary }]}>{row.accountName ?? 'None'}</Text>
              ) : (
                accountPicker(form.accountId, (id) => set('accountId', id), 'None')
              )}
            </FormField>
          </Section>
        )}

        <Section footer="Separate tags with commas.">
          <FormField label="Tags">
            <TextInput
              value={form.tags}
              onChangeText={(v) => set('tags', v)}
              placeholder="None"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              style={[formStyles.input, { color: theme.text }]}
            />
          </FormField>
          <TextInput
            value={form.note}
            onChangeText={(v) => set('note', v)}
            placeholder="Note"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[formStyles.note, { color: theme.text }]}
            maxLength={2000}
          />
        </Section>

        <Details row={row} currency={currency} />
        {row.attachments ? <Receipts transactionId={row.id} attachments={row.attachments} /> : null}

        {row.needsReview && !dirty ? (
          <FormButton label="Mark reviewed" onPress={markReviewed} disabled={busy} />
        ) : null}
        <FormButton label="Delete" destructive onPress={confirmDelete} disabled={busy} />
      </ScrollView>
      <Stack.Title>{transactionName(row)}</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={!dirty || busy} onPress={submit}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/** What the phone shows but does not change: split lines, amounts owed back, credits, the bank match. */
function Details({ row, currency }: { row: TransactionDetail; currency: string }) {
  const theme = useTheme();
  const lines = [
    row.splits.length > 0 ? `Split across ${row.splits.length} categories` : null,
    row.owedToYouCents > 0 ? `${formatCents(row.owedToYouCents, currency)} owed back to you` : null,
    row.creditCents ? `${formatCents(row.creditCents, currency)} in credits taken off` : null,
    row.verified ? 'Matched to a bank transaction' : null,
    row.transferPeerId ? 'Paired with the other side of the transfer in your log' : null,
    // A server from before receipts reached the phone only counts them.
    !row.attachments && row.attachmentCount
      ? `${row.attachmentCount} receipt${row.attachmentCount === 1 ? '' : 's'} (open on the website)`
      : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <Section title="Also on this entry">
      {lines.map((line) => (
        <Text key={line} style={[formStyles.value, { color: theme.text }]}>
          {line}
        </Text>
      ))}
    </Section>
  );
}

