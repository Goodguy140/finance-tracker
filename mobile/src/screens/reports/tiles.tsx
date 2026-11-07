import { StyleSheet, Text, View } from 'react-native';

import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Tile } from '@/utils/category-merchant';

/** A report page's headline figures, a line each. */
export function Tiles({ tiles }: { tiles: readonly Tile[] }) {
  const theme = useTheme();
  if (tiles.length === 0) return null;
  return (
    <Section>
      {tiles.map((tile) => (
        <View key={tile.label} style={styles.line} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}>
          <Text style={[styles.body, { color: theme.text }]}>{tile.label}</Text>
          <Text style={[styles.value, { color: theme.text }]}>{tile.value}</Text>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  body: { fontSize: 15, lineHeight: 21 },
  value: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
