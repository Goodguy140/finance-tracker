import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Budgets as BudgetsData } from '@/api/types';
import { BudgetLine } from '@/components/budget-line';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { fundNote, rolloverNote, sectionByGroup } from '@/utils/budgets';
import { shiftMonth } from '@/utils/dates';
import { formatCents, formatPeriodMonth } from '@/utils/money';

/** Every budget for a month, by category group, with rollover; then the yearly budgets as sinking funds. */
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

function BudgetList({ data }: { data: BudgetsData }) {
  const theme = useTheme();
  const yearly = data.yearly ?? [];
  if (data.budgets.length === 0 && yearly.length === 0) {
    return (
      <Section>
        <Text style={[styles.muted, { color: theme.textSecondary }]}>
          No budgets for this month. Set them on the website under Settings → Categories.
        </Text>
      </Section>
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
            <BudgetLine
              key={row.categoryId}
              name={row.categoryName}
              spentCents={row.spentCents}
              limitCents={row.limitCents}
              currency={data.currency}
              note={row.rollover ? (rolloverNote(row.rolloverCents, data.currency) ?? 'Rollover is on') : null}
            />
          ))}
        </Section>
      ))}
      {yearly.length > 0 ? (
        <Section
          title={`Yearly budgets · ${data.periodMonth.slice(0, 4)}`}
          footer="A twelfth of each is set aside every month; spending in the category draws it down.">
          {yearly.map((row) => (
            <BudgetLine
              key={row.categoryId}
              name={row.categoryName}
              spentCents={row.spentCents}
              limitCents={row.limitCents}
              currency={data.currency}
              note={`${fundNote(row.fundCents, data.currency)} · ${formatCents(row.monthlyCents, data.currency)} set aside a month`}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  month: { fontSize: 17, fontWeight: '600', marginLeft: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
});
