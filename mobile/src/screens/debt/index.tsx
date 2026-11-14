import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { DebtPayoff, DebtStrategy, Me } from '@/api/types';
import { FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { canEditAccounts } from '@/utils/account-settings';
import { debtFreeText, debtPayoffPath, owedLine, planNote, termsLine } from '@/utils/debt';
import { formatCents } from '@/utils/money';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/**
 * The website's Debt payoff page (`/reports/debt`): each card, loan and mortgage with what is owed,
 * its rate and minimum (tap one to set them), and a plan for a monthly amount comparing highest
 * rate first, smallest balance first and minimums only: the debt-free month, the interest, and
 * the order the debts go in.
 */
export function DebtPayoffScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [monthly, setMonthly] = useState<number | null>(null);
  // The amount while it is being typed; null shows what the plan pays.
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<DebtStrategy['id']>('avalanche');
  const query = useApiQuery<DebtPayoff>(debtPayoffPath(monthly), { keepPrevious: true });
  const editable = canEditAccounts(useApiQuery<Me>('/api/v1/me').data);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const money = (cents: number) => formatCents(cents, data?.currency ?? 'CAD');

  function leave() {
    if (text === null) return;
    const typed = text.trim().replace(/[\s,$]/g, '');
    let cents: number | null = null;
    // Empty or zero pays the minimums, as the website does.
    if (typed && Number(typed) !== 0) {
      cents = parseAmountInput(typed);
      if (cents === null || cents < 0) return setProblem('Enter an amount, like 500.00.');
    }
    setProblem(null);
    setText(null);
    setMonthly(cents);
  }

  const chosen = data?.strategies.find((s) => s.id === strategyId) ?? data?.strategies[0];

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data ? (
          <>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Your credit cards and loans, what they cost in interest, and a month-by-month way out.
            </Text>
            <Section
              title="What you owe"
              footer={data.accounts.length > 0 && editable ? 'Tap one to set its interest rate and minimum.' : null}>
              {data.accounts.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  No credit card or loan accounts yet. {editable ? 'Add one from Accounts.' : 'Add one on the website.'}
                </Text>
              ) : (
                data.accounts.map((a) => {
                  const owed = owedLine(a, data.currency);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() =>
                        editable && owed
                          ? router.push({ pathname: '/account-edit', params: { id: a.id } })
                          : router.push({ pathname: '/accounts/[id]', params: { id: a.id } })
                      }
                      accessibilityRole="button"
                      style={styles.stack}>
                      <View style={styles.row}>
                        <Text style={[styles.name, styles.grow, { color: theme.text }]} numberOfLines={1}>
                          {a.name}
                        </Text>
                        <Text style={[styles.small, { color: theme.textSecondary }]}>{a.typeLabel}</Text>
                      </View>
                      <Text style={[styles.small, { color: a.utilization?.high ? theme.warning : theme.textSecondary }]}>
                        {owed ?? 'No balance yet: add one on its page.'}
                      </Text>
                      {owed ? <Text style={[styles.small, { color: theme.textSecondary }]}>{termsLine(a, data.currency)}</Text> : null}
                    </Pressable>
                  );
                })
              )}
            </Section>

            {data.totalOwedCents > 0 && chosen ? (
              <>
                <Section
                  title="Your plan"
                  footer={
                    data.missing.length > 0
                      ? `Add the rate and minimum for ${data.missing.join(', ')}; until then it counts as interest-free with no minimum.`
                      : null
                  }>
                  <FormField label="Paying each month" note={`Minimums add up to ${money(data.minimumsCents)}.`}>
                    <TextInput
                      value={text ?? amountInputText(data.monthlyCents)}
                      onChangeText={setText}
                      onEndEditing={leave}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      style={[formStyles.input, formStyles.amount, { color: theme.text }]}
                      accessibilityLabel="Paying each month"
                    />
                  </FormField>
                  {problem ? <Text style={[formStyles.error, { color: theme.danger }]}>{problem}</Text> : null}
                </Section>

                <Section title="Ways to pay it off">
                  {data.strategies.map((s) => {
                    const active = s.id === chosen.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setStrategyId(s.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${s.label}. ${debtFreeText(s)}. Interest ${money(s.totalInterestCents)}.`}
                        style={styles.stack}>
                        <View style={styles.row}>
                          <Text style={[styles.name, styles.grow, { color: theme.text }]}>{s.label}</Text>
                          {active ? <Text style={[styles.name, { color: theme.tint }]}>✓</Text> : null}
                        </View>
                        <Text style={[styles.small, { color: theme.textSecondary }]}>{s.hint}</Text>
                        <Text style={[styles.body, { color: s.debtFree ? theme.text : theme.warning }]}>{debtFreeText(s)}</Text>
                        <Text style={[styles.small, { color: theme.textSecondary }]}>Interest: {money(s.totalInterestCents)}</Text>
                      </Pressable>
                    );
                  })}
                </Section>

                <Section title={`${chosen.label}: the order`} footer={planNote(data, chosen)}>
                  {chosen.payoffOrder.length === 0 ? (
                    <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing is paid off at this amount.</Text>
                  ) : (
                    chosen.payoffOrder.map((p, i) => (
                      <View key={p.id} style={styles.row} accessible accessibilityLabel={`${i + 1}. ${p.name}, paid off ${p.label}`}>
                        <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                          {i + 1}. {p.name}
                        </Text>
                        <Text style={[styles.small, { color: theme.textSecondary }]}>paid off {p.label}</Text>
                      </View>
                    ))
                  )}
                </Section>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Debt Payoff</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  grow: { flex: 1 },
  stack: { gap: 2 },
});
