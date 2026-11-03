import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { Host, Picker } from '@expo/ui';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { useUploadReceipt } from '@/api/receipts';
import { errorText, useApiQuery } from '@/api/query';
import type { Account, Category, Transaction, TransactionType } from '@/api/types';
import { FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { pickReceipt } from '@/utils/pick-receipt';
import { useTheme } from '@/hooks/use-theme';
import { offerUndo } from '@/state/undo-offer';
import { addBody, emptyAddForm, switchAddType, TITLE_MAX, type AddForm } from '@/utils/add';
import { dateFromYmd, localToday, ymdFromDate } from '@/utils/dates';
import { receiptSize, type ReceiptPhoto } from '@/utils/receipts';
import { transactionName } from '@/utils/transactions';

const TYPES: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

/** The Picker value for "Automatic" (or "Choose" on a transfer): no id sent. */
const NONE = '';

/** Logs an expense, income or transfer, as the website's Add card does. */
export function AddTransaction({ initialType = 'expense' }: { initialType?: TransactionType }) {
  const theme = useTheme();
  const router = useRouter();
  const categories = useApiQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useApiQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const failed = categories.error ?? accounts.error;

  return (
    <>
      {categories.data && accounts.data ? (
        <AddEditor initialType={initialType} categories={categories.data.categories} accounts={accounts.data.accounts} />
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!failed} error={failed ? errorText(failed) : null} />
        </ScrollView>
      )}
      <Stack.Title>Add</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

function AddEditor({ initialType, categories, accounts }: { initialType: TransactionType; categories: Category[]; accounts: Account[] }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [form, setForm] = useState<AddForm>(() => emptyAddForm(localToday(), initialType));
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ReceiptPhoto | null>(null);
  const upload = useUploadReceipt();
  // One key per thing being added: sending the same add again after a dropped connection is
  // answered with the entry already made. Changing the form first makes it a new add.
  const sent = useRef<{ body: string; key: string } | null>(null);
  const save = useApiMutation<{ body: Record<string, unknown>; key: string }, { transaction: Transaction }>(
    'POST',
    () => '/api/v1/transactions',
    (vars) => vars.body,
    (vars) => ({ 'Idempotency-Key': vars.key }),
  );

  const set = <K extends keyof AddForm>(key: K, value: AddForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const transfer = form.type === 'transfer';
  const categoryOptions = categories.filter((c) => c.kind === form.type);
  const openAccounts = accounts.filter((a) => !a.archived);
  const ready = form.amount.trim() !== '' && (!transfer || (form.accountId !== null && form.transferAccountId !== null));

  async function submit() {
    const result = addBody(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    const body = JSON.stringify(result.body);
    const key = sent.current?.body === body ? sent.current.key : randomUUID();
    sent.current = { body, key };
    let transaction: Transaction;
    try {
      ({ transaction } = await save.mutateAsync({ body: result.body, key }));
    } catch (err) {
      return setError(err instanceof Error ? err.message : 'Could not add it. Try again.');
    }
    // The entry is in. A receipt that will not upload is offered again or left for later, never a
    // reason to add the entry twice.
    if (photo) await uploadUntilDone(transaction.id, photo);
    offerUndo({ kind: 'added', transactionId: transaction.id, label: transactionName(transaction) });
    router.back();
  }

  async function uploadUntilDone(transactionId: string, receipt: ReceiptPhoto) {
    for (;;) {
      try {
        await upload.mutateAsync({ transactionId, photo: receipt });
        return;
      } catch (err) {
        const again = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Added, but the receipt didn’t upload',
            `${err instanceof Error ? err.message : 'The upload failed.'} You can add it later from the entry.`,
            [
              { text: 'Skip', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Try Again', onPress: () => resolve(true) },
            ],
          ),
        );
        if (!again) return;
      }
    }
  }

  async function choosePhoto() {
    const picked = await pickReceipt();
    if (picked) setPhoto(picked);
  }

  const accountPicker = (value: string | null, onChange: (id: string | null) => void, emptyLabel: string) => (
    <Host matchContents>
      <Picker selectedValue={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : String(v))}>
        <Picker.Item label={emptyLabel} value={NONE} />
        {openAccounts.map((a) => (
          <Picker.Item key={a.id} label={a.name} value={a.id} />
        ))}
      </Picker>
    </Host>
  );

  return (
    <>
      <ScrollView
        // Starts the form below the sheet's title bar, as every other screen does; without it the
        // Expense / Income / Transfer switch sat behind the bar and could not be scrolled to.
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        <SegmentedControl
          values={TYPES.map((t) => t.label)}
          selectedIndex={TYPES.findIndex((t) => t.value === form.type)}
          onChange={(event) => setForm((f) => switchAddType(f, TYPES[event.nativeEvent.selectedSegmentIndex]?.value ?? f.type))}
          accessibilityLabel="Kind of entry"
        />

        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        <Section>
          <FormField label="Amount">
            <TextInput
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              autoFocus
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              accessibilityLabel="Amount"
            />
          </FormField>
          <FormField label="Title">
            <TextInput
              value={form.title}
              onChangeText={(v) => set('title', v)}
              placeholder={transfer ? 'Optional' : 'What was it?'}
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              returnKeyType="done"
              maxLength={TITLE_MAX}
              accessibilityLabel="Title"
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
        </Section>

        {transfer ? (
          <Section footer="The money leaves the first account and arrives in the second. Neither side counts as spending or income.">
            <FormField label="From">{accountPicker(form.accountId, (id) => set('accountId', id), 'Choose')}</FormField>
            <FormField label="To">{accountPicker(form.transferAccountId, (id) => set('transferAccountId', id), 'Choose')}</FormField>
          </Section>
        ) : (
          <Section footer="Automatic files it as the website would: your rules first, then where entries with the same title went before.">
            <FormField label="Category">
              <Host matchContents>
                <Picker selectedValue={form.categoryId ?? NONE} onValueChange={(v) => set('categoryId', v === NONE ? null : String(v))}>
                  <Picker.Item label="Automatic" value={NONE} />
                  {categoryOptions.map((c) => (
                    <Picker.Item key={c.id} label={c.name} value={c.id} />
                  ))}
                </Picker>
              </Host>
            </FormField>
            <FormField label="Account">{accountPicker(form.accountId, (id) => set('accountId', id), 'Automatic')}</FormField>
          </Section>
        )}

        <Section title="Receipt">
          {photo ? (
            <View style={styles.photoRow}>
              <Image source={{ uri: photo.uri }} contentFit="cover" style={[styles.thumb, { backgroundColor: theme.track }]} />
              <Text style={[styles.photoText, { color: theme.textSecondary }]}>
                {photo.sizeBytes ? `Photo, ${receiptSize(photo.sizeBytes)}` : 'Photo'} · uploads when you tap Add
              </Text>
              <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, { color: theme.danger }]}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => void choosePhoto()} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Add Receipt Photo</Text>
            </Pressable>
          )}
        </Section>

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
      </ScrollView>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={!ready || save.isPending || upload.isPending} onPress={() => void submit()}>
          {upload.isPending ? 'Uploading…' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  photoText: { flex: 1, fontSize: 13 },
  link: { fontSize: 17, fontWeight: '600' },
});
