import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Transaction } from '@/api/types';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { amountDisplay, transactionName, transactionSubtitle } from '@/utils/transactions';

/** One entry in the list: name, category and account, the amount, and a dot while it needs review. */
export function TransactionRow(props: { row: Transaction; currency: string; first: boolean; last: boolean; onPress: () => void }) {
  const { row, currency, first, last, onPress } = props;
  const theme = useTheme();
  const amount = amountDisplay(row, currency);
  const name = transactionName(row);
  const subtitle = transactionSubtitle(row);
  const color = amount.tone === 'positive' ? theme.positive : amount.tone === 'muted' ? theme.textSecondary : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${amount.text}, ${subtitle}${row.needsReview ? ', needs review' : ''}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.track : theme.backgroundElement,
          borderColor: theme.border,
          borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
          borderTopLeftRadius: first ? Radius : 0,
          borderTopRightRadius: first ? Radius : 0,
          borderBottomLeftRadius: last ? Radius : 0,
          borderBottomRightRadius: last ? Radius : 0,
        },
      ]}>
      <View style={styles.text}>
        <View style={styles.nameLine}>
          {row.needsReview ? <View style={[styles.dot, { backgroundColor: theme.tint }]} /> : null}
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {subtitle}
          {row.tags.length ? ` · ${row.tags.map((t) => `#${t}`).join(' ')}` : ''}
        </Text>
      </View>
      <Text style={[styles.amount, { color }]}>{amount.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 17, flexShrink: 1 },
  subtitle: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
});
