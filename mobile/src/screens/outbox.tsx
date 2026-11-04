import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { sendPending } from '@/api/outbox-sender';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { discardPending, pendingAdds, useOutbox } from '@/state/outbox';
import { formatDay, localToday, relativeDay } from '@/utils/dates';
import { sendable, type PendingAdd } from '@/utils/outbox';

/** What is saved on the phone waiting for the server: send it now, or let one go. */
export function Outbox() {
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const { session } = useSession();
  const items = useOutbox();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function sendNow() {
    if (!session) return;
    setBusy(true);
    setNote(null);
    try {
      if (await sendPending(session)) await client.invalidateQueries({ queryKey: ['api'] });
    } finally {
      setBusy(false);
    }
    const left = sendable(pendingAdds()).length;
    setNote(left > 0 ? 'Your server still can’t be reached. They will go as soon as it can.' : null);
  }

  function discard(item: PendingAdd) {
    Alert.alert(`Discard ${item.label}?`, item.transactionId ? 'The entry is in; only its receipt will not be uploaded.' : 'It will not be added.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => discardPending(item.key) },
    ]);
  }

  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {note ? <Text style={[styles.body, { color: theme.textSecondary }]}>{note}</Text> : null}
        {items.length === 0 ? (
          <Section>
            <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing is waiting. Everything saved on this phone has reached your server.</Text>
          </Section>
        ) : (
          <Section footer="Each is sent with the key it was first tried with, so one that did reach your server is never added twice.">
            {items.map((item) => (
              <View key={item.key} style={styles.row}>
                <View style={styles.text}>
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={[styles.small, { color: item.error ? theme.danger : theme.textSecondary }]}>
                    {item.error
                      ? `Refused: ${item.error}`
                      : item.transactionId
                        ? 'Added; the receipt is still to upload'
                        : `Saved ${savedWhen(item.savedAt)}${item.photo ? ', with a receipt' : ''}`}
                  </Text>
                </View>
                <Pressable onPress={() => discard(item)} accessibilityRole="button" accessibilityLabel={`Discard ${item.label}`} hitSlop={8}>
                  <Text style={[styles.action, { color: theme.danger }]}>Discard</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
      <Stack.Title>Waiting to send</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={busy || !items.some((i) => !i.error)} onPress={() => void sendNow()}>
          Send now
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/** "today", "yesterday" or "on Mon, Nov 3", from an ISO time, in the phone's own day. */
function savedWhen(iso: string): string {
  const day = localToday(new Date(iso));
  const relative = relativeDay(day, localToday());
  return relative === 'Today' || relative === 'Yesterday' ? relative.toLowerCase() : `on ${formatDay(day)}`;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  small: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  action: { fontSize: 15, fontWeight: '600' },
});
