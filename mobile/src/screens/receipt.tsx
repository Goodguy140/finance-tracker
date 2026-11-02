import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { receiptSource } from '@/api/receipts';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';

/** One receipt photo, full screen: pinch to zoom, Done to close, the bin to take it off the entry. */
export function ReceiptViewer({ id, name }: { id: string; name: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const remove = useApiMutation<void, void>('DELETE', () => `/api/v1/attachments/${encodeURIComponent(id)}`);

  function confirmRemove() {
    Alert.alert('Remove this receipt?', 'It is deleted from the entry, here and on the website, and cannot be put back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove.mutate(undefined, {
            onSuccess: () => router.back(),
            onError: (err) => Alert.alert('Could not remove it', err instanceof Error ? err.message : 'Try again.'),
          }),
      },
    ]);
  }

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onLayout={(event) => setBox(event.nativeEvent.layout)}>
        {failed ? (
          <Text style={[styles.error, { color: theme.textSecondary }]}>Couldn’t load this receipt. Close it and try again.</Text>
        ) : session && box ? (
          <Image
            source={receiptSource(session, id)}
            cachePolicy="memory"
            contentFit="contain"
            style={{ width: box.width, height: box.height }}
            onError={() => setFailed(true)}
            accessibilityLabel={name ?? 'Receipt'}
          />
        ) : null}
      </ScrollView>
      <Stack.Title>{name ?? 'Receipt'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="trash" accessibilityLabel="Remove receipt" disabled={remove.isPending} onPress={confirmRemove} />
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 15, textAlign: 'center', padding: Spacing.four },
});
