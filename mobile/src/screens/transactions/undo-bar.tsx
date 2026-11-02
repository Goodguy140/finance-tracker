import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApiMutation } from '@/api/mutations';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clearUndo, useUndoOffer } from '@/state/undo-offer';

/** How long the bar stays; the server keeps a deleted entry for 15 minutes. */
const SHOW_MS = 8_000;

/** "Deleted Lunch · Undo", floating over the list for a few seconds after a delete. */
export function UndoBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const offer = useUndoOffer();
  const [error, setError] = useState<string | null>(null);
  const undo = useApiMutation<string, unknown>('POST', (undoId) => `/api/v1/undo/${encodeURIComponent(undoId)}`);

  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => clearUndo(offer.undoId), Math.max(0, SHOW_MS - (Date.now() - offer.offeredAt)));
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer) return null;
  const run = () => {
    setError(null);
    undo.mutate(offer.undoId, {
      onSuccess: () => clearUndo(offer.undoId),
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not undo.'),
    });
  };
  return (
    <View
      style={[styles.bar, { bottom: insets.bottom + 64, backgroundColor: theme.text }]}
      accessibilityLiveRegion="polite">
      <Text style={[styles.text, { color: theme.background }]} numberOfLines={2}>
        {error ?? `Deleted ${offer.label}`}
      </Text>
      <Pressable onPress={run} disabled={undo.isPending} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.action, { color: theme.background, opacity: undo.isPending ? 0.5 : 1 }]}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: Radius,
  },
  text: { flex: 1, fontSize: 15 },
  action: { fontSize: 15, fontWeight: '700' },
});
