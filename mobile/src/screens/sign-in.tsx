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
import { useSession } from '@/session/session-provider';
import { signInWithServer } from '@/session/sign-in-with-server';
import { loadLastServer } from '@/session/store';

/** First screen: the person's own server address, then its sign-in page in the system sheet. */
export function SignIn() {
  const theme = useTheme();
  const { notice, signedIn } = useSession();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadLastServer()
      .then((origin) => {
        if (origin) setAddress((current) => current || origin.replace(/^https:\/\//, ''));
      })
      .catch(() => {});
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithServer(address);
      if (outcome.status === 'signed-in') await signedIn(outcome.session);
      else if (outcome.status === 'failed') setError(outcome.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

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
          onSubmitEditing={submit}
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

        {error ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || !address.trim()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.tint, opacity: busy || !address.trim() ? 0.5 : pressed ? 0.8 : 1 },
          ]}>
          {busy ? (
            <ActivityIndicator color={theme.onTint} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.onTint }]}>Continue</Text>
          )}
        </Pressable>

        <Text style={[styles.footnote, { color: theme.textSecondary }]}>
          You sign in on your server&apos;s own page, with your password, passkey or single sign-on. The app never sees
          your password.
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
  buttonText: { fontSize: 17, fontWeight: '600' },
  footnote: { marginTop: Spacing.four, fontSize: 13, lineHeight: 18 },
});
