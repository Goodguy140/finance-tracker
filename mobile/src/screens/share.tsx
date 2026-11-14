import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { clearSharedPayloads, useIncomingShare } from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import { useUploadReceipt } from '@/api/receipts';
import type { Me, Transaction, TransactionPage } from '@/api/types';
import { FormButton, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { isImageReceipt, receiptSize, type ReceiptPhoto } from '@/utils/receipts';
import { receiptFromShares, receiptParams } from '@/utils/shared-receipt';
import { statementFromShares } from '@/utils/statement-import';

import { StatementImport } from './statement-import';

/** Entries offered to keep a shared receipt with: the latest, or what a search finds. */
function entriesPath(search: string): string {
  const params = new URLSearchParams({ limit: '25' });
  if (search) params.set('q', search);
  return `/api/v1/transactions?${params.toString()}`;
}

/**
 * A photo or PDF shared to Finances from another app (Photos, Mail, Files): keep it with a new entry
 * (the Add sheet opens with it), or with one already logged. A bank statement (CSV, OFX or QFX) is
 * imported instead (`StatementImport`). Whatever happens, it is shown once: leaving the screen lets
 * it go.
 */
export function SharedReceipt() {
  const theme = useTheme();
  const router = useRouter();
  const share = useIncomingShare();
  const statement = share.isResolving ? null : statementFromShares(share.resolvedSharedPayloads);
  const result = share.isResolving || statement ? null : receiptFromShares(share.resolvedSharedPayloads);

  function close() {
    clearSharedPayloads();
    router.back();
  }

  function finishImport(then?: 'review') {
    clearSharedPayloads();
    router.back();
    if (then === 'review') router.navigate({ pathname: '/transactions', params: { review: '1' } });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {share.isResolving ? <LoadState loading error={null} /> : null}
        {!share.isResolving && (share.error || (!result && !statement)) ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {share.error
              ? 'Couldn’t open what was shared. Share it again.'
              : 'Nothing was shared. Share a photo or PDF of a receipt, or a bank statement (CSV, OFX or QFX), from another app.'}
          </Text>
        ) : null}
        {statement && 'error' in statement ? <Text style={[styles.body, { color: theme.danger }]}>{statement.error}</Text> : null}
        {statement && 'statement' in statement ? <StatementImport statement={statement.statement} onFinish={finishImport} /> : null}
        {result && 'error' in result ? <Text style={[styles.body, { color: theme.danger }]}>{result.error}</Text> : null}
        {result && 'photo' in result ? <Choices photo={result.photo} /> : null}
      </ScrollView>
      <Stack.Title>{statement ? 'Import Statement' : 'Receipt'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={close}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

function Choices({ photo }: { photo: ReceiptPhoto }) {
  const theme = useTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const entries = useApiQuery<TransactionPage>(entriesPath(query));
  const home = useApiQuery<Me>('/api/v1/me').data?.user.currency ?? 'CAD';
  const money = (entry: Transaction) => formatCents(entry.amountCents, entry.currency ?? home);
  const upload = useUploadReceipt();
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const image = isImageReceipt(photo.mimeType);

  function newEntry() {
    clearSharedPayloads();
    router.replace({ pathname: '/add', params: receiptParams(photo) });
  }

  async function keepWith(entry: Transaction) {
    setSavingTo(entry.id);
    setError(null);
    try {
      await upload.mutateAsync({ transactionId: entry.id, photo });
      clearSharedPayloads();
      router.back();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingTo(null);
    }
  }

  return (
    <>
      <Section footer={photo.sizeBytes ? `${photo.fileName}, ${receiptSize(photo.sizeBytes)}` : photo.fileName}>
        {image ? (
          <Image source={{ uri: photo.uri }} contentFit="contain" style={[styles.preview, { backgroundColor: theme.track }]} accessibilityLabel="The shared receipt" />
        ) : (
          <Text style={[styles.body, { color: theme.text }]}>PDF receipt</Text>
        )}
      </Section>
      <FormButton label="Add a New Entry With It" onPress={newEntry} disabled={savingTo !== null} />
      <Section title="Or keep it with an entry" footer={error}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => setQuery(search.trim())}
          placeholder="Search entries"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          style={[styles.search, { color: theme.text }]}
        />
        <LoadState loading={entries.isPending} error={entries.error && !entries.data ? errorText(entries.error) : null} />
        {entries.data && entries.data.transactions.length === 0 ? (
          <Text style={[styles.small, { color: theme.textSecondary }]}>{query ? `Nothing matches “${query}”.` : 'No entries yet.'}</Text>
        ) : null}
        {entries.data?.transactions.map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => void keepWith(entry)}
            disabled={savingTo !== null}
            accessibilityRole="button"
            accessibilityLabel={`${entry.title ?? entry.categoryName}, ${formatDay(entry.date)}, ${money(entry)}`}
            accessibilityHint="Keeps the receipt with this entry"
            style={styles.row}>
            <View style={styles.text}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {entry.title ?? entry.categoryName}
              </Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                {formatDay(entry.date)} · {entry.categoryName}
                {entry.attachmentCount ? ` · ${entry.attachmentCount} receipt${entry.attachmentCount === 1 ? '' : 's'}` : ''}
              </Text>
            </View>
            {savingTo === entry.id ? (
              <ActivityIndicator />
            ) : (
              <Text style={[styles.amount, { color: theme.text }]}>{money(entry)}</Text>
            )}
          </Pressable>
        ))}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21 },
  preview: { width: '100%', height: 240, borderRadius: 8 },
  search: { fontSize: 17, paddingVertical: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  small: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
});
