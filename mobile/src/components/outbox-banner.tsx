import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOutbox } from '@/state/outbox';
import { outboxLine } from '@/utils/outbox';

/** Says what is saved on the phone waiting for the server, and opens the list of it. */
export function OutboxBanner() {
  const theme = useTheme();
  const router = useRouter();
  const line = outboxLine(useOutbox());
  if (!line) return null;
  return (
    <Pressable
      onPress={() => router.push('/outbox')}
      accessibilityRole="button"
      accessibilityHint="Lists what is waiting"
      style={[styles.banner, { backgroundColor: theme.backgroundElement, borderColor: theme.warning }]}>
      <Text style={[styles.text, { color: theme.text }]}>{line}</Text>
      <Text style={[styles.link, { color: theme.tint }]}>See them ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.one },
  text: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
});
