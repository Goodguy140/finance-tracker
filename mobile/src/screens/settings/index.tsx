import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Me } from '@/api/types';
import { FormField } from '@/components/form';
import { ListRow } from '@/components/list-row';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppLock } from '@/session/app-lock';
import { useSession } from '@/session/session-provider';
import { useOutbox } from '@/state/outbox';
import { canSetAlertTiming } from '@/utils/alert-timing';
import { RELOCK_AFTER_MS } from '@/utils/app-lock';
import { canEditGoals } from '@/utils/goals';
import { canSetSafeToSpendBuffer } from '@/utils/safe-to-spend';
import { canEditCategories } from '@/utils/category-edits';
import { hasPasskeys } from '@/utils/passkey-add';
import { canUseZeroBased } from '@/utils/zero-based';
import { canEditRules } from '@/utils/rule-edits';
import { canMakeRules } from '@/utils/transaction-rules';

import { AboutSection } from './about';
import { AlertsSection } from './alerts';

/** Who is signed in and where, the website one tap away, banks, alerts, the lock, which build and update this is, and Sign out. */
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
        <Section
          title="Signed in as"
          list
          footer="Anything the app does not have, such as backups, your password and server admin, is on the website.">
          {me.data ? (
            <View style={styles.stack}>
              <Text style={[styles.name, { color: theme.text }]}>{me.data.user.displayName}</Text>
              <Text style={[styles.muted, { color: theme.textSecondary }]}>{me.data.user.email}</Text>
            </View>
          ) : (
            <Text style={[styles.muted, { color: me.error ? theme.danger : theme.textSecondary }]}>
              {me.error ? errorText(me.error) : 'Loading…'}
            </Text>
          )}
          <ListRow label="Server" value={host} />
          <ListRow
            label="Open Website"
            kind="external"
            onPress={() => session && void Linking.openURL(`${session.origin}/`)}
            accessibilityHint="Opens the website in Safari"
          />
        </Section>

        <Section list footer="What each bank connection needs, and where its accounts' transactions go.">
          <ListRow label="Bank Connections" onPress={() => router.push('/settings/banks')} />
        </Section>

        {canMakeRules(me.data) ? (
          <Section
            title="Rules"
            list
            footer={
              canEditRules(me.data)
                ? 'Change, turn off, reorder or delete your rules. Make one from an entry or a bank row with Make a Rule…, or from a title you use often.'
                : 'Make a rule from an entry or a bank row with Make a Rule…, or from a title you use often here.'
            }>
            {canEditRules(me.data) ? <ListRow label="Your Rules" onPress={() => router.push('/settings/rule-list')} /> : null}
            <ListRow label="Suggested Rules" onPress={() => router.push('/settings/rules')} />
          </Section>
        ) : null}

        {canEditCategories(me.data) ? (
          <Section
            title="Categories and tags"
            list
            footer="Add, rename, group or delete categories, have budgets suggested, and tidy tags.">
            <ListRow label="Categories" onPress={() => router.push('/settings/categories')} />
            <ListRow label="Tags" onPress={() => router.push('/settings/tags')} />
          </Section>
        ) : null}

        {canEditGoals(me.data) || canSetSafeToSpendBuffer(me.data) ? (
          <Section
            list
            footer={
              !canSetSafeToSpendBuffer(me.data)
                ? null
                : canUseZeroBased(me.data)
                  ? 'Safe to Spend has the bill buffer, and the switch that shows To assign from zero-based budgeting on Home instead.'
                  : 'Safe to Spend has the bill buffer: how many days ahead it also holds back bills that fall next month.'
            }>
            {canEditGoals(me.data) ? <ListRow label="Savings Goals" onPress={() => router.push('/settings/goals')} /> : null}
            {canSetSafeToSpendBuffer(me.data) ? (
              <ListRow label="Safe to Spend" onPress={() => router.push('/settings/safe-to-spend')} />
            ) : null}
          </Section>
        ) : null}

        <AlertsSection onTiming={canSetAlertTiming(me.data) ? () => router.push('/settings/alert-timing') : undefined} />

        <LockSection passkeys={hasPasskeys(me.data)} />

        <AboutSection />

        <Section list>
          <ListRow label="Sign Out" kind="destructive" onPress={confirmSignOut} />
        </Section>
      </ScrollView>
      <Stack.Title large>Settings</Stack.Title>
    </>
  );
}

/** The Face ID lock: on or off, each way confirmed by iOS first. And the account's passkeys. */
function LockSection({ passkeys }: { passkeys: boolean }) {
  const router = useRouter();
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
      list
      footer={`Asks for ${lock.method} when the app opens and after ${minutes} minutes in the background.`}>
      <FormField label={`Require ${lock.method}`}>
        <Switch
          value={lock.enabled === true}
          disabled={busy || lock.enabled === undefined}
          onValueChange={(on) => void toggle(on)}
          accessibilityLabel={`Require ${lock.method}`}
        />
      </FormField>
      {passkeys ? <ListRow label="Passkeys" onPress={() => router.push('/settings/passkeys')} /> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  stack: { gap: 2, paddingVertical: 4 },
  name: { fontSize: 17, fontWeight: '600' },
  muted: { fontSize: 15, lineHeight: 21 },
});
