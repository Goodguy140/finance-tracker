import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Me } from '@/api/types';
import { FormField } from '@/components/form';
import { Section } from '@/components/section';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppLock } from '@/session/app-lock';
import { useSession } from '@/session/session-provider';
import { useOutbox } from '@/state/outbox';
import { canSetAlertTiming } from '@/utils/alert-timing';
import { RELOCK_AFTER_MS } from '@/utils/app-lock';
import { canEditGoals } from '@/utils/goals';
import { canMakeRules } from '@/utils/transaction-rules';

import { AlertsSection } from './alerts';

/** Who is signed in and where, the website one tap away, banks, alerts, the lock, and Sign out. */
export function Settings() {
  const theme = useTheme();
  const router = useRouter();
  const { session, signOut } = useSession();
  const pending = useOutbox();
  const me = useApiQuery<Me>('/api/v1/me');
  const host = session ? session.origin.replace(/^https:\/\//, '') : '';

  function confirmSignOut() {
    const unsent = pending.length;
    const warning = unsent
      ? ` ${unsent === 1 ? '1 entry' : `${unsent} entries`} saved on this phone ${unsent === 1 ? 'has' : 'have'} not reached your server yet and will be lost.`
      : '';
    Alert.alert('Sign out?', `This phone will need to sign in again to see your finances.${warning}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}>
        <Section title="Signed in as">
          {me.data ? (
            <View style={styles.stack}>
              <Text style={[styles.title, { color: theme.text }]}>{me.data.user.displayName}</Text>
              <Text style={[styles.muted, { color: theme.textSecondary }]}>{me.data.user.email}</Text>
            </View>
          ) : (
            <Text style={[styles.muted, { color: me.error ? theme.danger : theme.textSecondary }]}>
              {me.error ? errorText(me.error) : 'Loading…'}
            </Text>
          )}
        </Section>

        <Section title="Server" footer="Reports, imports, rules and the rest of your settings are on the website.">
          <Text style={[styles.title, { color: theme.text }]} selectable>
            {host}
          </Text>
          <Pressable
            onPress={() => session && void Linking.openURL(`${session.origin}/`)}
            accessibilityRole="link"
            accessibilityHint="Opens the website in Safari"
            hitSlop={8}>
            <Text style={[styles.link, { color: theme.tint }]}>Open the website</Text>
          </Pressable>
        </Section>

        <Section title="Banks" footer="What each bank connection needs, and where its accounts' transactions go.">
          <Pressable onPress={() => router.push('/settings/banks')} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.link, { color: theme.tint }]}>Bank connections ›</Text>
          </Pressable>
        </Section>

        {canMakeRules(me.data) ? (
          <Section title="Rules" footer="Make a rule from an entry or a bank row with Make a Rule…, or from a title you use often here.">
            <Pressable onPress={() => router.push('/settings/rules')} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Suggested rules ›</Text>
            </Pressable>
          </Section>
        ) : null}

        {canEditGoals(me.data) ? (
          <Section title="Savings goals" footer="Add a goal, change one, or put money toward one tracked by hand.">
            <Pressable onPress={() => router.push('/settings/goals')} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Savings goals ›</Text>
            </Pressable>
          </Section>
        ) : null}

        <AlertsSection timingHere={canSetAlertTiming(me.data)} />

        {canSetAlertTiming(me.data) ? (
          <Section
            title="When alerts come"
            footer="How long before a bill to remind you, which charges count as large or unusual, and the email digest.">
            <Pressable onPress={() => router.push('/settings/alert-timing')} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>When alerts come ›</Text>
            </Pressable>
          </Section>
        ) : null}

        <LockSection />

        <Pressable
          onPress={confirmSignOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOut,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Text style={[styles.signOutText, { color: theme.danger }]}>Sign out</Text>
        </Pressable>

        <Text style={[styles.version, { color: theme.textSecondary }]}>Finances {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
      <Stack.Title large>Settings</Stack.Title>
    </>
  );
}

/** The Face ID lock: on or off, each way confirmed by iOS first. */
function LockSection() {
  const lock = useAppLock();
  const [busy, setBusy] = useState(false);
  const minutes = RELOCK_AFTER_MS / 60_000;

  async function toggle(on: boolean) {
    setBusy(true);
    const problem = await lock.setEnabled(on);
    setBusy(false);
    if (problem) Alert.alert(on ? 'The lock is still off' : 'The lock is still on', problem);
  }

  return (
    <Section
      title="Security"
      footer={`Asks for ${lock.method} when the app opens and after ${minutes} minutes in the background.`}>
      <FormField label={`Require ${lock.method}`}>
        <Switch
          value={lock.enabled === true}
          disabled={busy || lock.enabled === undefined}
          onValueChange={(on) => void toggle(on)}
          accessibilityLabel={`Require ${lock.method}`}
        />
      </FormField>
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  stack: { gap: 2 },
  title: { fontSize: 17 },
  muted: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
  signOut: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: 'center' },
  signOutText: { fontSize: 17, fontWeight: '600' },
  version: { fontSize: 13, textAlign: 'center' },
});
