import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { openPdfReceipt, receiptSource, useUploadReceipt } from '@/api/receipts';
import type { Attachment } from '@/api/types';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickReceipt } from '@/utils/pick-receipt';
import { useSession } from '@/session/session-provider';
import { isImageReceipt, MAX_RECEIPTS_PER_ENTRY, receiptOpenError, receiptSize } from '@/utils/receipts';

/** An entry's receipts: photos open full screen, PDFs in Quick Look; a photo can be added straight away. */
export function Receipts({ transactionId, attachments }: { transactionId: string; attachments: Attachment[] }) {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const upload = useUploadReceipt();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  async function add() {
    setError(null);
    const photo = await pickReceipt();
    if (!photo) return;
    upload.mutate({ transactionId, photo }, { onError: (err) => setError(err instanceof Error ? err.message : 'The receipt did not upload.') });
  }

  async function openPdf(receipt: Attachment) {
    if (!session || opening) return;
    setError(null);
    setOpening(receipt.id);
    try {
      await openPdfReceipt(session, { id: receipt.id, fileName: receipt.fileName });
    } catch (err) {
      setError(receiptOpenError(err));
    } finally {
      setOpening(null);
    }
  }

  if (!session) return null;
  return (
    <Section title="Receipts">
      {attachments.map((a) =>
        isImageReceipt(a.contentType) ? (
          <Pressable
            key={a.id}
            onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: a.id, name: a.fileName } })}
            accessibilityRole="button"
            accessibilityLabel={`Receipt ${a.fileName}, open`}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
            <Image source={receiptSource(session, a.id)} cachePolicy="memory" contentFit="cover" style={[styles.thumb, { backgroundColor: theme.track }]} />
            <View style={styles.text}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {a.fileName}
              </Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>{receiptSize(a.sizeBytes)}</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            key={a.id}
            onPress={() => void openPdf(a)}
            disabled={opening !== null}
            accessibilityRole="button"
            accessibilityLabel={`Receipt ${a.fileName}, PDF, open`}
            accessibilityState={{ busy: opening === a.id }}
            style={({ pressed }) => [styles.row, { opacity: pressed || (opening !== null && opening !== a.id) ? 0.6 : 1 }]}>
            <View style={[styles.thumb, styles.doc, { backgroundColor: theme.track }]}>
              {opening === a.id ? <ActivityIndicator /> : <SymbolView name="doc.richtext" size={24} tintColor={theme.textSecondary} />}
            </View>
            <View style={styles.text}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {a.fileName}
              </Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {opening === a.id ? 'Opening…' : `PDF, ${receiptSize(a.sizeBytes)}`}
              </Text>
            </View>
          </Pressable>
        ),
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.meta, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}
      {attachments.length < MAX_RECEIPTS_PER_ENTRY ? (
        <Pressable onPress={() => void add()} disabled={upload.isPending} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.action, { color: theme.tint, opacity: upload.isPending ? 0.5 : 1 }]}>
            {upload.isPending ? 'Uploading…' : 'Add Receipt Photo'}
          </Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  doc: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  meta: { fontSize: 13 },
  action: { fontSize: 17, fontWeight: '600' },
});
