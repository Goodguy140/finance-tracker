import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Reconcile } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, formatDate, ymdFromDate } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { balanceLabels, balanceText, checkedStatement, checkLines, inOutText, reconcilePath, type Statement } from '@/utils/reconcile';

type Checked = { from: string; to: string; openingCents: number; closingCents: number };

/**
 * The website's Reconcile with a statement for one account: the statement's dates and its opening
 * and closing balances (what is owed, for a card or loan) in; the log's entries over those days
 * with a running balance, and whether they arrive at the closing balance, out. One that matches
 * can be marked reconciled, which also keeps the closing balance; earlier ones can be forgotten.
 */
export function ReconcileScreen({ id }: { id: string }) {
  const theme = useTheme();
  const base = useApiQuery<Reconcile>(reconcilePath(id));
  const [note, setNote] = useState<string | null>(null);
  const data = base.data;
  if (!data) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={base.isPending} error={base.error ? errorText(base.error) : null} />
        </ScrollView>
        <Stack.Title>Reconcile</Stack.Title>
      </>
    );
  }
  // The form starts where the last reconciled statement left off, and starts again from there
  // once one is marked reconciled or forgotten.
  return <ReconcileForm key={`${data.from}|${data.openingCents}|${data.history.length}`} id={id} data={data} note={note} onNote={setNote} />;
}

function ReconcileForm({ id, data, note, onNote }: { id: string; data: Reconcile; note: string | null; onNote: (note: string | null) => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [form, setForm] = useState<Statement>({ from: data.from, to: data.to, opening: balanceText(data.openingCents), closing: '' });
  const [checked, setChecked] = useState<Checked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const result = useApiQuery<Reconcile>(checked ? reconcilePath(id, checked) : null, { keepPrevious: true });
  const save = useApiMutation<Checked, { id: string }>('POST', () => reconcilePath(id), (v) => v);
  const forget = useApiMutation<{ reconciliationId: string }, { ok: true }>(
    'DELETE',
    (v) => `${reconcilePath(id)}/${encodeURIComponent(v.reconciliationId)}`,
  );
  const themeVariant = scheme === 'dark' ? 'dark' : 'light';

  const { account } = data;
  const labels = balanceLabels(account.liability);
  const money = (cents: number) => formatCents(cents, account.currency);
  const check = checked ? result.data?.check : null;
  const lines = check ? checkLines(check, account.currency) : null;
  const set = (change: Partial<Statement>) => {
    setForm((f) => ({ ...f, ...change }));
    setChecked(null);
  };

  function run() {
    onNote(null);
    const statement = checkedStatement(form);
    if ('error' in statement) return setProblem(statement.error);
    setProblem(null);
    setChecked(statement);
  }

  function markReconciled() {
    if (!checked) return;
    save.mutate(checked, {
      onSuccess: () => onNote(`Reconciled ${formatDate(checked.from)} to ${formatDate(checked.to)}. The closing balance is kept as the balance that day.`),
      onError: (err) => setProblem(errorText(err)),
    });
  }

  function confirmForget(r: Reconcile['history'][number]) {
    Alert.alert('Forget this statement?', `${formatDate(r.from)} to ${formatDate(r.to)}. The balance it kept stays.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => forget.mutate({ reconciliationId: r.id }, { onError: (err) => setProblem(errorText(err)) }),
      },
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
        <Text style={[styles.intro, { color: theme.textSecondary }]}>
          {account.liability
            ? 'Enter what your statement says was owed at the start and end. The log’s entries for those dates should take one to the other.'
            : 'Enter the balances your statement shows at the start and end. The log’s entries for those dates should take one to the other.'}
        </Text>
        {note ? <Text style={[styles.body, { color: theme.positive }]}>{note}</Text> : null}
        <Section title={`${account.name} · ${account.currency}`} footer="Both days are included.">
          <FormField label="Statement from">
            <DateTimePicker
              value={dateFromYmd(form.from)}
              onValueChange={(_, d) => set({ from: ymdFromDate(d) })}
              display="compact"
              timeZoneName="UTC"
              themeVariant={themeVariant}
            />
          </FormField>
          <FormField label="To">
            <DateTimePicker
              value={dateFromYmd(form.to)}
              onValueChange={(_, d) => set({ to: ymdFromDate(d) })}
              display="compact"
              timeZoneName="UTC"
              themeVariant={themeVariant}
            />
          </FormField>
          <FormField label={labels.opening}>
            <TextInput
              value={form.opening}
              onChangeText={(opening) => set({ opening })}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numbers-and-punctuation"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
            />
          </FormField>
          <FormField label={labels.closing}>
            <TextInput
              value={form.closing}
              onChangeText={(closing) => set({ closing })}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              onSubmitEditing={run}
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
            />
          </FormField>
          {problem ? <Text style={[formStyles.error, { color: theme.danger }]}>{problem}</Text> : null}
          <FormButton label="Check" onPress={run} disabled={result.isFetching} />
        </Section>

        {checked && result.error && !check ? <LoadState loading={false} error={errorText(result.error)} /> : null}
        {check && lines ? (
          <>
            <Section>
              <Line label="Money in" value={money(check.moneyInCents)} color={theme.positive} />
              <Line label="Money out" value={money(check.moneyOutCents)} color={theme.text} />
              <Line label="The log arrives at" value={money(check.expectedClosingCents)} color={theme.text} />
              <Line label="Statement says" value={money(checked!.closingCents)} color={theme.text} />
              <Text accessibilityRole="alert" style={[styles.body, { color: lines.matches ? theme.positive : theme.warning }]}>
                {lines.headline}
              </Text>
              {lines.hint ? <Text style={[styles.small, { color: theme.textSecondary }]}>{lines.hint}</Text> : null}
              {lines.matches ? <FormButton label="Mark Reconciled" onPress={markReconciled} disabled={save.isPending} /> : null}
            </Section>
            <Section title="Entries" footer={check.rows.length > 0 ? `${labels.running} after each, oldest first.` : null}>
              {check.rows.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing is logged on this account for these dates.</Text>
              ) : (
                check.rows.map((row) => (
                  <View key={row.id} style={styles.entry} accessible>
                    <View style={styles.row}>
                      <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                        {row.title}
                      </Text>
                      <Text style={[styles.amount, { color: row.inCents >= 0 ? theme.positive : theme.text }]}>
                        {inOutText(row.inCents, account.currency)}
                      </Text>
                    </View>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      {formatDate(row.date)} · {labels.running.toLowerCase()} {money(row.balanceCents)}
                    </Text>
                  </View>
                ))
              )}
            </Section>
          </>
        ) : null}

        {data.history.length > 0 ? (
          <Section title="Reconciled statements" footer="Newest first.">
            {data.history.map((r) => (
              <View key={r.id} style={styles.row}>
                <View style={styles.grow}>
                  <Text style={[styles.body, { color: theme.text }]}>
                    {formatDate(r.from)} to {formatDate(r.to)}
                  </Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>
                    {money(r.openingCents)} to {money(r.closingCents)}
                  </Text>
                </View>
                <Pressable onPress={() => confirmForget(r)} accessibilityRole="button" accessibilityLabel={`Forget ${formatDate(r.from)} to ${formatDate(r.to)}`} hitSlop={8}>
                  <Text style={[styles.small, { color: theme.danger }]}>Forget</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
      <Stack.Title>Reconcile</Stack.Title>
    </>
  );
}

function Line({ label, value, color }: { label: string; value: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.body, styles.grow, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.amount, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  grow: { flex: 1 },
  entry: { gap: 2 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
