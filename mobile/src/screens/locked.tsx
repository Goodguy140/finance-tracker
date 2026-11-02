import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppLock } from '@/session/app-lock';
import { useSession } from '@/session/session-provider';

/** Shown instead of the app while it is locked; asks for Face ID straight away. */
export function Locked() {
  const theme = useTheme();
  const { method, unlock } = useAppLock();
  const { signOut } = useSession();

  useEffect(() => {
    void unlock();
  }, [unlock]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <SymbolView name={method === 'Touch ID' ? 'touchid' : method === 'Face ID' ? 'faceid' : 'lock.fill'} size={56} tintColor={theme.tint} />
      <Text style={[styles.title, { color: theme.text }]}>Finances is locked</Text>
      <Pressable
        onPress={() => void unlock()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.onTint }]}>Unlock with {method}</Text>
      </Pressable>
      <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.textSecondary }]}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four },
  title: { fontSize: 22, fontWeight: '700' },
  button: { borderRadius: Radius, paddingVertical: 14, paddingHorizontal: Spacing.five },
  buttonText: { fontSize: 17, fontWeight: '600' },
  link: { fontSize: 15 },
});
