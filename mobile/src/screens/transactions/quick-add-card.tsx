import { randomUUID } from 'expo-crypto';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { useApiQuery } from '@/api/query';
import type { QuickAddAnswer, Transaction } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { offerUndo } from '@/state/undo-offer';
import { mightBeQuickAdd, quickAddLines } from '@/utils/add';
import { localToday } from '@/utils/dates';
import { transactionName } from '@/utils/transactions';

/**
 * Type-to-add in the search bar, as in the website's search: "12.50 coffee yesterday" offers to
 * add that expense, filed as the user's rules and past titles would file it. One tap adds it.
 */
export function QuickAddCard({ text, currency }: { text: string; currency: string }) {
  const theme = useTheme();
  const asked = mightBeQuickAdd(text);
  const answer = useApiQuery<QuickAddAnswer>(asked ? `/api/v1/quick-add?text=${encodeURIComponent(text)}` : null);
  // The text last added, so the card goes once it has done its job instead of offering it twice.
  const [addedText, setAddedText] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; message: string } | null>(null);
  // One key per text: tapping again after a dropped connection never adds it twice.
  const sent = useRef<{ text: string; key: string } | null>(null);
  const save = useApiMutation<{ body: Record<string, unknown>; key: string }, { transaction: Transaction }>(
    'POST',
    () => '/api/v1/transactions',
    (vars) => vars.body,
    (vars) => ({ 'Idempotency-Key': vars.key }),
  );

  const preview = answer.data?.preview;
  const entry = answer.data?.entry;
  if (!asked || !preview || !entry || addedText === text) return null;
  const lines = quickAddLines(preview, currency, localToday());

  const add = () => {
    setError(null);
    const key = sent.current?.text === text ? sent.current.key : randomUUID();
    sent.current = { text, key };
    // The text as read, not the preview's renamed title: the server applies the rules as it saves.
    const body = { type: 'expense', amountCents: entry.amountCents, title: entry.title, date: entry.dateYmd };
    save.mutate(
      { body, key },
      {
        onSuccess: ({ transaction }) => {
          setAddedText(text);
          offerUndo({ kind: 'added', transactionId: transaction.id, label: transactionName(transaction) });
        },
        onError: (err) => setError({ text, message: err instanceof Error ? err.message : 'Could not add it. Try again.' }),
      },
    );
  };

  return (
    <Pressable
      onPress={add}
      disabled={save.isPending}
      accessibilityRole="button"
      accessibilityLabel={`Add ${lines.title}, ${lines.detail}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.track : theme.backgroundElement, borderColor: theme.border, opacity: save.isPending ? 0.6 : 1 },
      ]}>
      <SymbolView name="plus.circle.fill" size={28} tintColor={theme.tint} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          Add {lines.title}
        </Text>
        <Text style={[styles.detail, { color: error?.text === text ? theme.danger : theme.textSecondary }]} numberOfLines={2}>
          {error?.text === text ? error.message : lines.detail}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '600' },
  detail: { fontSize: 14 },
});
