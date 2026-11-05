import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { passkeysAvailable } from '@/session/passkeys';
import { useSession } from '@/session/session-provider';
import { HOME_SERVER, signInWithPasskey, signInWithServer, type SignInOutcome } from '@/session/sign-in-with-server';
import { loadLastServer } from '@/session/store';
import { isHomeServer } from '@/utils/home-server';
import { parseServerAddress } from '@/utils/server-address';

/**
 * First screen: the person's own server address, then its sign-in page in the system sheet. On
 * the server this build was made for, Face ID with a passkey signs in without the sheet; on any
 * other, a note says what will not be available there.
 */
export function SignIn() {
  const theme = useTheme();
  const { notice, signedIn } = useSession();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'web' | 'face-id' | null>(null);

  useEffect(() => {
    loadLastServer()
      .then((origin) => {
        const saved = origin?.replace(/^https:\/\//, '') ?? HOME_SERVER ?? '';
        if (saved) setAddress((current) => current || saved);
      })
      .catch(() => {});
  }, []);

  const typed = parseServerAddress(address);
  const onHomeServer = typed.ok && isHomeServer(typed.origin, HOME_SERVER);
  const offerFaceId = onHomeServer && passkeysAvailable();
  const elsewhere = HOME_SERVER !== null && typed.ok && !onHomeServer;

  async function run(kind: 'web' | 'face-id', signIn: (address: string) => Promise<SignInOutcome>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const outcome = await signIn(address);
      if (outcome.status === 'signed-in') await signedIn(outcome.session);
      else if (outcome.status === 'failed') setError(outcome.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const submit = () => run('web', signInWithServer);
  const submitFaceId = () => run('face-id', signInWithPasskey);
  const disabled = busy !== null || !address.trim();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>Finances</Text>
        <Text style={[styles.lead, { color: theme.textSecondary }]}>
          Sign in with the Finance Tracker server you use on the web.
        </Text>

        {notice ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.warning }]}>
            {notice}
          </Text>
        ) : null}

        <Text style={[styles.label, { color: theme.textSecondary }]}>Server address</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={offerFaceId ? submitFaceId : submit}
          placeholder="finances.example.com"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          editable={!busy}
          accessibilityLabel="Server address"
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        />

        {elsewhere ? (
          <Text style={[styles.message, { color: theme.warning }]}>
            This isn&apos;t the server this app was built for. You can sign in and use the app as usual, but Face ID
            sign-in won&apos;t be available.
          </Text>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        {offerFaceId ? (
          <Pressable
            onPress={submitFaceId}
            disabled={disabled}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.tint, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
            ]}>
            {busy === 'face-id' ? (
              <ActivityIndicator color={theme.onTint} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.onTint }]}>Sign In with Face ID</Text>
            )}
          </Pressable>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={disabled}
          accessibilityRole="button"
          style={({ pressed }) => [
            offerFaceId ? [styles.secondaryButton, { borderColor: theme.border }] : [styles.button, { backgroundColor: theme.tint }],
            { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
          ]}>
          {busy === 'web' ? (
            <ActivityIndicator color={offerFaceId ? theme.tint : theme.onTint} />
          ) : (
            <Text style={[styles.buttonText, { color: offerFaceId ? theme.tint : theme.onTint }]}>
              {offerFaceId ? 'Sign In on the Web Page' : 'Continue'}
            </Text>
          )}
        </Pressable>

        <Text style={[styles.footnote, { color: theme.textSecondary }]}>
          {offerFaceId
            ? 'Face ID uses a passkey you added for this server on the web, in Settings → Security. Or sign in on the server\'s own page, with your password, passkey or single sign-on. The app never sees your password.'
            : 'You sign in on your server\'s own page, with your password, passkey or single sign-on. The app never sees your password.'}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, gap: Spacing.two },
  title: { fontSize: 34, fontWeight: '700' },
  lead: { fontSize: 17, lineHeight: 24, marginBottom: Spacing.four },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { fontSize: 17, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius, paddingHorizontal: Spacing.three, paddingVertical: 14 },
  message: { fontSize: 15, lineHeight: 21 },
  button: { marginTop: Spacing.three, borderRadius: Radius, paddingVertical: 15, alignItems: 'center' },
  secondaryButton: {
    marginTop: Spacing.two,
    borderRadius: Radius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
  footnote: { marginTop: Spacing.four, fontSize: 13, lineHeight: 18 },
});
