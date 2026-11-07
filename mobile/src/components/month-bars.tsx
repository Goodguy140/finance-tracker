import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { barLine, barScale, type MonthBar } from '@/utils/category-merchant';
import { formatPeriodMonth } from '@/utils/money';

/**
 * A bar a month, drawn with plain views so it reaches phones in an update. Tapping a bar picks it,
 * and the line above says what it holds; a month's budget is the short line across its bar.
 */
export function MonthBars(props: {
  bars: readonly MonthBar[];
  currency: string;
  selected: number;
  onSelect: (index: number) => void;
  height?: number;
}) {
  const theme = useTheme();
  const { bars, currency, selected } = props;
  const height = props.height ?? 140;
  const scale = barScale(bars);
  const picked = bars[selected] ?? bars[bars.length - 1];
  if (!picked) return null;
  const px = (cents: number) => Math.max(0, Math.round((cents / scale) * height));

  return (
    <View style={styles.chart}>
      <Text style={[styles.picked, { color: picked.over ? theme.danger : theme.text }]} accessibilityLiveRegion="polite">
        {barLine(picked, currency)}
      </Text>
      <View style={[styles.bars, { height }]}>
        {bars.map((bar, i) => {
          const on = bar === picked;
          const color = bar.over ? theme.danger : theme.tint;
          return (
            <Pressable
              key={bar.month}
              style={styles.slot}
              onPress={() => props.onSelect(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={barLine(bar, currency)}>
              <View
                style={[
                  styles.bar,
                  { height: bar.cents > 0 ? Math.max(px(bar.cents), 2) : 0, backgroundColor: color, opacity: on ? 1 : 0.45 },
                ]}
              />
              {bar.budgetCents !== null ? (
                <View style={[styles.budget, { bottom: px(bar.budgetCents), backgroundColor: theme.textSecondary }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.axis, { borderTopColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{formatPeriodMonth(bars[0].month)}</Text>
        {bars.length > 1 ? (
          <Text style={[styles.label, { color: theme.textSecondary }]}>{formatPeriodMonth(bars[bars.length - 1].month)}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: Spacing.two },
  picked: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  budget: { position: 'absolute', left: -1, right: -1, height: 2, borderRadius: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.one },
  label: { fontSize: 12 },
});
