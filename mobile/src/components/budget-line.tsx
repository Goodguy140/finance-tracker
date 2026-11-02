import { StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { barShare, budgetStatus } from '@/utils/budgets';
import { formatCents } from '@/utils/money';

/** One budget: name, spent of limit, a bar, and what is left or over (plus an optional note). */
export function BudgetLine(props: {
  name: string;
  spentCents: number;
  limitCents: number;
  currency: string;
  note?: string | null;
  bold?: boolean;
}) {
  const { name, spentCents, limitCents, currency, note, bold } = props;
  const theme = useTheme();
  const status = budgetStatus(spentCents, limitCents, currency);
  const spent = formatCents(spentCents, currency);
  const limit = formatCents(limitCents, currency);
  return (
    <View style={styles.budget} accessible accessibilityLabel={`${name}: ${spent} of ${limit}. ${status.text}.${note ? ` ${note}.` : ''}`}>
      <View style={styles.row}>
        <Text style={[styles.name, { color: theme.text, fontWeight: bold ? '700' : '500' }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.amount, { color: theme.textSecondary }]}>
          {spent} of {limit}
        </Text>
      </View>
      <ProgressBar share={barShare(spentCents, limitCents)} over={status.over} />
      <Text style={[styles.status, { color: status.over ? theme.danger : theme.textSecondary }]}>{status.text}</Text>
      {note ? <Text style={[styles.status, { color: theme.textSecondary }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  budget: { gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  name: { fontSize: 17, flexShrink: 1 },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  status: { fontSize: 13 },
});
