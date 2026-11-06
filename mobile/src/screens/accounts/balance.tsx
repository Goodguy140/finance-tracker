import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { FormField, formStyles } from '@/components/form';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { balanceBody, balanceField, balancesPath } from '@/utils/balances';
import { dateFromYmd, localToday, ymdFromDate } from '@/utils/dates';
import { amountInputText } from '@/utils/transactions';

/**
 * An account's balance on a day, typed in by hand, as Settings → Accounts takes it on the website:
 * for cash, a loan, a house, or a quick reading from the bank's own app. One entry a day; a second
 * replaces the first.
 */
export function RecordBalance({
  accountId,
  name,
  currency,
  liability,
  linked,
  currentCents,
}: {
  accountId: string;
  name: string;
  currency: string;
  liability: boolean;
  linked: boolean;
  currentCents: number | null;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const today = localToday();
  const [amount, setAmount] = useState(currentCents === null ? '' : amountInputText(currentCents));
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<{ balanceCents: number; date: string }, { ok: true }>('POST', () => balancesPath(accountId), (body) => body);
  const field = balanceField(liability, currency);

  function submit() {
    const result = balanceBody(amount, date, today);
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(result.body, {
      onSuccess: () => router.back(),
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not save. Try again.'),
    });
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
        <Section
          footer={
            linked
              ? `${field.hint} This account is linked to a bank, so its next sync records its balance again.`
              : field.hint
          }>
          <FormField label={field.label}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numbers-and-punctuation"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              accessibilityLabel={liability ? 'Amount owed' : 'Balance'}
            />
          </FormField>
          <FormField label="As of" note="An entry for a day that already has one replaces it.">
            <DateTimePicker
              value={dateFromYmd(date)}
              onValueChange={(_, picked) => setDate(ymdFromDate(picked))}
              maximumDate={dateFromYmd(today)}
              display="compact"
              timeZoneName="UTC"
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
            />
          </FormField>
        </Section>
      </ScrollView>
      <Stack.Title>{name}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={save.isPending || amount.trim() === ''} onPress={submit}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
