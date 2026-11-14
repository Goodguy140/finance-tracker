import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { barExtent, type BarGroup } from '@/utils/reports';

/**
 * Bars a month, side by side within it, drawn with plain views so they reach phones in an update.
 * A negative value hangs below the zero line. Tapping a month picks it, and the line above says
 * what it holds.
 */
export function GroupBars(props: { groups: readonly BarGroup[]; selected: number; onSelect: (index: number) => void; height?: number }) {
  const theme = useTheme();
  const { groups } = props;
  const height = props.height ?? 140;
  const picked = groups[props.selected] ?? groups[groups.length - 1];
  if (!picked) return null;
  const { max, min } = barExtent(groups);
  const span = Math.max(1, max - min);
  const zero = Math.round((max / span) * height);
  const px = (cents: number) => Math.round((Math.abs(cents) / span) * height);

  return (
    <View style={styles.chart}>
      <Text style={[styles.picked, { color: theme.text }]} accessibilityLiveRegion="polite">
        {picked.caption}
      </Text>
      <View style={[styles.plot, { height }]}>
        <View style={[styles.zero, { top: zero, backgroundColor: theme.border }]} />
        {groups.map((group, i) => {
          const on = group === picked;
          return (
            <Pressable
              key={group.key}
              style={styles.slot}
              onPress={() => props.onSelect(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={group.caption}>
              {group.values.map((value, v) => (
                <View
                  key={v}
                  style={[
                    styles.bar,
                    value.cents >= 0
                      ? { top: zero - Math.max(px(value.cents), value.cents ? 2 : 0) }
                      : { top: zero },
                    { height: value.cents ? Math.max(px(value.cents), 2) : 0, backgroundColor: theme[value.tone], opacity: on ? 1 : 0.45 },
                  ]}
                />
              ))}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{groups[0].label}</Text>
        {groups.length > 1 ? <Text style={[styles.label, { color: theme.textSecondary }]}>{groups[groups.length - 1].label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: Spacing.two },
  picked: { fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
  plot: { flexDirection: 'row', gap: 2 },
  zero: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  slot: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 1, height: '100%' },
  bar: { flex: 1, position: 'relative', borderRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12 },
});
