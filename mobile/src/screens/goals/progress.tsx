import { StyleSheet, Text, View } from 'react-native';

import type { SavingsGoal } from '@/api/types';
import { ProgressBar } from '@/components/progress-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { BAR_TONE, goalAdvice, STATUS_LABEL } from '@/utils/goals';
import { formatCents } from '@/utils/money';

/** A goal's amounts, bar and next step, as the website's Savings goals card shows them. */
export function GoalProgress({ goal, advice = true }: { goal: SavingsGoal; advice?: boolean }) {
  const theme = useTheme();
  const money = (cents: number) => formatCents(cents, goal.currency);
  const label = STATUS_LABEL[goal.status];
  const tone = BAR_TONE[goal.status];
  return (
    <View style={styles.wrap}>
      <View style={styles.line}>
        <Text style={[styles.body, { color: theme.text }]}>
          {goal.savedCents === null ? '—' : money(goal.savedCents)}{' '}
          <Text style={{ color: theme.textSecondary }}>of {money(goal.targetCents)}</Text>
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          {label ? <Text style={{ color: theme[label.tone], fontWeight: '600' }}>{label.text} </Text> : null}
          {goal.percent}%
        </Text>
      </View>
      <ProgressBar share={goal.percent / 100} color={tone === 'muted' ? theme.textSecondary : theme[tone]} />
      {advice ? <Text style={[styles.small, { color: theme.textSecondary }]}>{goalAdvice(goal)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  body: { fontSize: 15, fontVariant: ['tabular-nums'] },
  small: { fontSize: 13, lineHeight: 18 },
});
