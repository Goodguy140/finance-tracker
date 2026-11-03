import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Switch, Text } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { AlertKind, AlertRegistration, AlertStatus } from '@/api/types';
import { FormButton, FormField } from '@/components/form';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import { alertPermission, askForAlerts, registerForAlerts, type AlertPermission } from '@/notifications/alerts';
import { useSession } from '@/session/session-provider';
import { ALERT_KINDS, ALERT_LABELS, ALERTS_PATH } from '@/utils/alerts';

type Change = { alerts?: Partial<Record<AlertKind, boolean>>; hideAmounts?: boolean };

const FOOTER = 'When bills are due and which charges count as large are set on the website, under Settings → Notifications.';

/** Alerts on this phone: iOS's permission first, then a switch per kind and the amounts switch. */
export function AlertsSection() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const status = useApiQuery<AlertStatus>(ALERTS_PATH);
  const [permission, setPermission] = useState<AlertPermission | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Read again on coming back to the app, since iOS Settings is where a "Don't Allow" is undone.
  useEffect(() => {
    const check = () => void alertPermission().then(setPermission, () => setPermission('undetermined'));
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);

  function setRegistration(update: (current: AlertRegistration | null) => AlertRegistration | null) {
    client.setQueryData<AlertStatus>(['api', ALERTS_PATH], (old) =>
      old ? { ...old, registration: update(old.registration) } : old,
    );
  }

  async function save(change: Change) {
    if (!session) return;
    const before = status.data?.registration ?? null;
    // Switches move at once and move back if the server says no.
    setRegistration((current) =>
      current
        ? { ...current, alerts: { ...current.alerts, ...change.alerts }, hideAmounts: change.hideAmounts ?? current.hideAmounts }
        : current,
    );
    setBusy(true);
    try {
      const saved = await registerForAlerts(session, change);
      setRegistration(() => saved);
    } catch (error) {
      setRegistration(() => before);
      Alert.alert('Alerts were not changed', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function turnOn() {
    setBusy(true);
    const answer = await askForAlerts().catch(() => 'undetermined' as const);
    setBusy(false);
    setPermission(answer);
    if (answer === 'granted') await save({});
  }

  if (status.error) {
    return (
      <Section title="Alerts">
        <Text style={[styles.text, { color: theme.danger }]}>{errorText(status.error)}</Text>
      </Section>
    );
  }
  if (!status.data || permission === undefined) {
    return (
      <Section title="Alerts">
        <Text style={[styles.text, { color: theme.textSecondary }]}>Loading…</Text>
      </Section>
    );
  }

  if (!status.data.available) {
    return (
      <Section title="Alerts">
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          Your server cannot send alerts to iPhones yet. Its admin adds Apple&apos;s push key on the website, under Settings → Server
          admin → Integrations.
        </Text>
      </Section>
    );
  }

  if (permission === 'denied') {
    return (
      <Section title="Alerts" footer={FOOTER}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          Notifications are off for Finances in iOS Settings. Turn them on there to get bill reminders, charge alerts and budget
          alerts here.
        </Text>
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link" hitSlop={8}>
          <Text style={[styles.link, { color: theme.tint }]}>Open iOS Settings</Text>
        </Pressable>
      </Section>
    );
  }

  const registration = status.data.registration;
  if (permission === 'undetermined' || !registration) {
    return (
      <Section title="Alerts" footer={FOOTER}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          {permission === 'undetermined'
            ? 'Get bill reminders, large or unusual charges and budget alerts on this phone.'
            : 'This phone is not set up for alerts yet.'}
        </Text>
        <FormButton
          label={permission === 'undetermined' ? 'Turn on alerts' : 'Set up alerts'}
          disabled={busy}
          onPress={() => void (permission === 'undetermined' ? turnOn() : save({}))}
        />
      </Section>
    );
  }

  return (
    <>
      <Section title="Alerts" footer={FOOTER}>
        {ALERT_KINDS.map((kind) => (
          <FormField key={kind} label={ALERT_LABELS[kind]}>
            <Switch
              value={registration.alerts[kind]}
              disabled={busy}
              onValueChange={(on) => void save({ alerts: { [kind]: on } })}
              accessibilityLabel={ALERT_LABELS[kind]}
            />
          </FormField>
        ))}
      </Section>
      <Section
        title="Privacy"
        footer="Alerts then say only what kind they are, so amounts and names stay off the lock screen. Open the app to see the rest.">
        <FormField label="Hide amounts in alerts">
          <Switch
            value={registration.hideAmounts}
            disabled={busy}
            onValueChange={(on) => void save({ hideAmounts: on })}
            accessibilityLabel="Hide amounts in alerts"
          />
        </FormField>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
});
