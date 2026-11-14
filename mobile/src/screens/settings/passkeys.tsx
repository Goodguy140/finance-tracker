import * as Device from 'expo-device';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { addPasskey } from '@/session/add-passkey';
import { addingPasskeysAvailable } from '@/session/passkeys';
import { useSession } from '@/session/session-provider';
import { HOME_SERVER } from '@/session/sign-in-with-server';
import { isHomeServer } from '@/utils/home-server';
import { addPasskeyReady, passkeyLine, tidyCode, tidyPasskeyName, type AppPasskeys } from '@/utils/passkey-add';

const PATH = '/api/v1/app/passkeys';

/**
 * The account's passkeys, as Settings → Security lists them on the website, and Add a Passkey:
 * confirm it's you (Face ID with a passkey the account has, or a code from its authenticator
 * app), then iOS saves the new one behind Face ID. It signs in on the website too, and syncs to
 * the person's other Apple devices. Renaming and removing stay on the website.
 */
export function PasskeysScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const query = useApiQuery<AppPasskeys>(PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [name, setName] = useState(() => Device.deviceName ?? 'iPhone');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const data = query.data;

  const ready = data
    ? addPasskeyReady({ nativeReady: addingPasskeysAvailable(), homeServer: !!session && isHomeServer(session.origin, HOME_SERVER), data })
    : null;
  const tidyName = tidyPasskeyName(name);
  const tidyCodeValue = tidyCode(code);
  const canAdd = !!ready?.ok && !!tidyName && (ready.proof !== 'code' || !!tidyCodeValue) && !busy;

  async function add() {
    if (!session || !ready?.ok || !tidyName) return;
    setNote(null);
    setBusy(true);
    try {
      const outcome = await addPasskey(session, { proof: ready.proof, code: tidyCodeValue ?? undefined, name: tidyName });
      if (outcome.status === 'added') {
        setCode('');
        setNote({ tone: 'success', text: `Added “${outcome.passkey.name}”. Face ID signs in with it here and on the website.` });
      } else if (outcome.status === 'exists') {
        setNote({ tone: 'danger', text: 'This iPhone already has a passkey for your account, so there is nothing to add here.' });
      } else if (outcome.status === 'failed') {
        setNote({ tone: 'danger', text: outcome.error });
      }
    } catch (err) {
      setNote({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
      await query.refetch();
    }
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data ? (
          <>
            <Section
              title="Your passkeys"
              footer="Each one signs in without a password, with Face ID or the device it lives on. Rename or remove one on the website, in Settings → Security.">
              {data.passkeys.length === 0 ? (
                <Text style={[styles.muted, { color: theme.textSecondary }]}>None yet.</Text>
              ) : (
                data.passkeys.map((p) => (
                  <View key={p.id} style={styles.row} accessible accessibilityLabel={`${p.name}. ${passkeyLine(p)}`}>
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[styles.muted, { color: theme.textSecondary }]}>{passkeyLine(p)}</Text>
                  </View>
                ))
              )}
            </Section>

            <Section
              title="Add a passkey"
              footer={
                ready?.ok
                  ? ready.proof === 'face-id'
                    ? 'Face ID confirms it’s you with a passkey you have, then iOS saves the new one.'
                    : 'Enter a code from your authenticator app to confirm it’s you, then iOS saves the passkey behind Face ID.'
                  : undefined
              }>
              {ready && !ready.ok ? (
                <Text style={[styles.muted, { color: theme.textSecondary }]}>{ready.reason}</Text>
              ) : (
                <>
                  <FormField label="Name">
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      maxLength={40}
                      editable={!busy}
                      returnKeyType="done"
                      style={[formStyles.input, { color: theme.text }]}
                      accessibilityLabel="Passkey name"
                    />
                  </FormField>
                  {ready?.ok && ready.proof === 'code' ? (
                    <FormField label="Authenticator code">
                      <TextInput
                        value={code}
                        onChangeText={setCode}
                        placeholder="123 456"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        maxLength={7}
                        editable={!busy}
                        style={[formStyles.input, formStyles.amount, { color: theme.text }]}
                        accessibilityLabel="Code from your authenticator app"
                      />
                    </FormField>
                  ) : null}
                  <FormButton label={busy ? 'Adding…' : 'Add a Passkey'} onPress={() => void add()} disabled={!canAdd} />
                </>
              )}
              {note ? (
                <Text accessibilityRole="alert" style={[formStyles.error, { color: note.tone === 'success' ? theme.positive : theme.danger }]}>
                  {note.text}
                </Text>
              ) : null}
            </Section>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Passkeys</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: Spacing.one },
  name: { fontSize: 17 },
  muted: { fontSize: 15, lineHeight: 21 },
});
