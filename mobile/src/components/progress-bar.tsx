import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** A thin bar, 0 to 1 full; red when over, or in `color` when given. */
export function ProgressBar({ share, over, color }: { share: number; over?: boolean; color?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.track }]}>
      <View style={[styles.fill, { width: `${Math.min(Math.max(share, 0), 1) * 100}%`, backgroundColor: color ?? (over ? theme.danger : theme.tint) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
