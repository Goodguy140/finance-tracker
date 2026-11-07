import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Budgets as BudgetsData } from '@/api/types';
import { BudgetLine } from '@/components/budget-line';
import { FormButton } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { canEditBudgets } from '@/utils/budget-edits';
import { fundNote, rolloverNote, sectionByGroup } from '@/utils/budgets';
import { shiftMonth } from '@/utils/dates';
import { formatCents, formatPeriodMonth } from '@/utils/money';

/**
 * Every budget for a month, by category group, with rollover; then the yearly budgets as sinking
 * funds. On this month's page each opens its budget sheet, and a budget can be added.
 */
export function Budgets() {
  const theme = useTheme();
  // Null is the server's "this month", in the person's own time zone.
  const [month, setMonth] = useState<string | null>(null);
  const query = useApiQuery<BudgetsData>(`/api/v1/budgets${month ? `?month=${month}` : ''}`);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const shown = month ?? data?.periodMonth ?? null;
  const step = (delta: number) => {
    if (shown) setMonth(shiftMonth(shown, delta));
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {shown ? <Text style={[styles.month, { color: theme.textSecondary }]}>{formatPeriodMonth(shown)}</Text> : null}
        <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
        {data && !query.error ? <BudgetList data={data} /> : null}
      </ScrollView>
      <Stack.Title large>Budgets</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Previous month" disabled={!shown} onPress={() => step(-1)} />
        <Stack.Toolbar.Button icon="chevron.right" accessibilityLabel="Next month" disabled={!shown} onPress={() => step(1)} />
      </Stack.Toolbar>
    </>
  );
}

/** A budget row that opens its sheet when budgets can be changed from here. */
function Tappable({ categoryId, label, editable, children }: { categoryId: string; label: string; editable: boolean; children: ReactNode }) {
  const router = useRouter();
  if (!editable) return children;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/budget', params: { categoryId } })}
      accessibilityRole="button"
      accessibilityHint={`Changes the ${label} budget`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {children}
    </Pressable>
  );
}

function BudgetList({ data }: { data: BudgetsData }) {
  const theme = useTheme();
  const router = useRouter();
  const yearly = data.yearly ?? [];
  const editable = canEditBudgets(data);
  const add = editable ? <FormButton label="Add a Budget" onPress={() => router.push('/budget')} /> : null;
  if (data.budgets.length === 0 && yearly.length === 0) {
    return (
      <>
        <Section>
          <Text style={[styles.muted, { color: theme.textSecondary }]}>
            {editable
              ? 'No budgets yet. Add one for a category you want to keep an eye on.'
              : data.currentMonth
                ? 'No budgets for this month.'
                : 'No budgets for this month. Set them on the website under Settings → Categories.'}
          </Text>
        </Section>
        {add}
      </>
    );
  }
  const sections = sectionByGroup(data.budgets, (row) => row.groupName);
  return (
    <>
      {data.budgets.length > 0 ? (
        <Section>
          <BudgetLine
            name="All budgets"
            spentCents={data.totalSpentCents}
            limitCents={data.totalLimitCents}
            currency={data.currency}
            bold
          />
        </Section>
      ) : null}
      {sections.map((section) => (
        <Section key={section.title ?? '-'} title={section.title}>
          {section.items.map((row) => (
            <Tappable key={row.categoryId} categoryId={row.categoryId} label={row.categoryName} editable={editable}>
              <BudgetLine
                name={row.categoryName}
                spentCents={row.spentCents}
                limitCents={row.limitCents}
                currency={data.currency}
                note={row.rollover ? (rolloverNote(row.rolloverCents, data.currency) ?? 'Rollover is on') : null}
              />
            </Tappable>
          ))}
        </Section>
      ))}
      {yearly.length > 0 ? (
        <Section
          title={`Yearly budgets · ${data.periodMonth.slice(0, 4)}`}
          footer="A twelfth of each is set aside every month; spending in the category draws it down.">
          {yearly.map((row) => (
            <Tappable key={row.categoryId} categoryId={row.categoryId} label={row.categoryName} editable={editable}>
              <BudgetLine
                name={row.categoryName}
                spentCents={row.spentCents}
                limitCents={row.limitCents}
                currency={data.currency}
                note={`${fundNote(row.fundCents, data.currency)} · ${formatCents(row.monthlyCents, data.currency)} set aside a month`}
              />
            </Tappable>
          ))}
        </Section>
      ) : null}
      {add}
      {editable ? (
        <Text style={[styles.footer, { color: theme.textSecondary }]}>
          Tap a budget to change it, turn rollover on or off, or cover an overspend from another budget.
        </Text>
      ) : data.currentMonth ? (
        <Text style={[styles.footer, { color: theme.textSecondary }]}>Budgets are changed from this month&apos;s page.</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  month: { fontSize: 17, fontWeight: '600', marginLeft: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
});
