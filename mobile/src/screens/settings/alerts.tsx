import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, StyleSheet, Switch, Text } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { AlertKind, AlertRegistration, AlertStatus } from '@/api/types';
import { FormField } from '@/components/form';
import { ListRow } from '@/components/list-row';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import { alertPermission, askForAlerts, registerForAlerts, type AlertPermission } from '@/notifications/alerts';
import { useSession } from '@/session/session-provider';
import { ALERT_KINDS, ALERT_LABELS, ALERTS_PATH } from '@/utils/alerts';

type Change = { alerts?: Partial<Record<AlertKind, boolean>>; hideAmounts?: boolean };

const FOOTER_WEBSITE = 'When bills are reminded and which charges count as large are set on the website, under Settings → Notifications.';
const FOOTER_HERE =
  'When Alerts Come sets how long before a bill to remind you, which charges count as large or unusual, and the email digest.';

/**
 * Alerts on this phone: iOS's permission first, then a switch per kind and the amounts switch.
 * `onTiming`, when the server lets the phone set when they come, adds a When Alerts Come row that
 * opens that screen, whatever state the alerts themselves are in.
 */
export function AlertsSection({ onTiming }: { onTiming?: () => void }) {
  const FOOTER = onTiming ? FOOTER_HERE : FOOTER_WEBSITE;
  const timing = onTiming ? <ListRow label="When Alerts Come" onPress={onTiming} /> : null;
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
      <Section title="Alerts" list footer={onTiming ? FOOTER : null}>
        <Text style={[styles.text, { color: theme.danger }]}>{errorText(status.error)}</Text>
        {timing}
      </Section>
    );
  }
  if (!status.data || permission === undefined) {
    return (
      <Section title="Alerts" list>
        <Text style={[styles.text, { color: theme.textSecondary }]}>Loading…</Text>
        {timing}
      </Section>
    );
  }

  if (!status.data.available) {
    return (
      <Section title="Alerts" list footer={onTiming ? FOOTER : null}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          Your server cannot send alerts to iPhones yet. Its admin adds Apple&apos;s push key on the website, under Settings → Server
          admin → Integrations.
        </Text>
        {timing}
      </Section>
    );
  }

  if (permission === 'denied') {
    return (
      <Section title="Alerts" list footer={FOOTER}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          Notifications are off for Finances in iOS Settings. Turn them on there to get bill reminders, charge alerts and budget
          alerts here.
        </Text>
        <ListRow
          label="Open iOS Settings"
          kind="external"
          onPress={() => void Linking.openSettings()}
          accessibilityHint="Opens this app's page in iOS Settings"
        />
        {timing}
      </Section>
    );
  }

  const registration = status.data.registration;
  if (permission === 'undetermined' || !registration) {
    return (
      <Section title="Alerts" list footer={FOOTER}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          {permission === 'undetermined'
            ? 'Get bill reminders, large or unusual charges and budget alerts on this phone.'
            : 'This phone is not set up for alerts yet.'}
        </Text>
        <ListRow
          label={permission === 'undetermined' ? 'Turn On Alerts' : 'Set Up Alerts'}
          kind="action"
          disabled={busy}
          onPress={() => void (permission === 'undetermined' ? turnOn() : save({}))}
        />
        {timing}
      </Section>
    );
  }

  return (
    <>
      <Section title="Alerts" list footer={FOOTER}>
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
        {timing}
      </Section>
      <Section
        title="Privacy"
        list
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
  text: { fontSize: 15, lineHeight: 21, paddingVertical: 5 },
});
