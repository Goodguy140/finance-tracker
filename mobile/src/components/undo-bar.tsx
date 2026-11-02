import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '@/api/client';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { clearUndo, undoOfferId, useUndoOffer, type UndoOffer } from '@/state/undo-offer';

/** How long the bar stays; the server keeps a deleted entry for 15 minutes. */
const SHOW_MS = 8_000;

/** "Deleted Lunch · Undo" or "Added Lunch · Undo", floating over the screen for a few seconds. */
export function UndoBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const client = useQueryClient();
  const offer = useUndoOffer();
  // Tied to the offer it is about, so a newer offer never shows an older failure.
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const undo = useMutation({
    mutationFn: (o: UndoOffer) => {
      if (!session) throw new Error('Not signed in.');
      // A delete is put back from its undo record; an add is simply deleted again.
      return o.kind === 'deleted'
        ? apiRequest(session, 'POST', `/api/v1/undo/${encodeURIComponent(o.undoId)}`)
        : apiRequest(session, 'DELETE', `/api/v1/transactions/${encodeURIComponent(o.transactionId)}`);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['api'] }),
  });

  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => clearUndo(undoOfferId(offer)), Math.max(0, SHOW_MS - (Date.now() - offer.offeredAt)));
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer) return null;
  const id = undoOfferId(offer);
  const run = () => {
    setError(null);
    undo.mutate(offer, {
      onSuccess: () => clearUndo(id),
      onError: (err) => setError({ id, message: err instanceof Error ? err.message : 'Could not undo.' }),
    });
  };
  return (
    <View
      style={[styles.bar, { bottom: insets.bottom + 64, backgroundColor: theme.text }]}
      accessibilityLiveRegion="polite">
      <Text style={[styles.text, { color: theme.background }]} numberOfLines={2}>
        {error?.id === id ? error.message : `${offer.kind === 'deleted' ? 'Deleted' : 'Added'} ${offer.label}`}
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
