import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput } from 'react-native';

import { apiRequest } from '@/api/client';
import { errorText, useApiQuery } from '@/api/query';
import type { AlertTiming, Me } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import {
  ALERT_TIMING_PATH,
  type AlertTimingChange,
  chargeAmountChange,
  chargeAmountText,
  DIGEST_CHOICES,
  DIGEST_PREVIEW_PATH,
  reminderChoices,
  reminderNote,
} from '@/utils/alert-timing';

type Part = 'reminders' | 'charges' | 'digest' | 'budget';

const NO_EMAIL = 'Your server is not set up to send email, so this stays off. Its admin adds SMTP settings to turn it on.';

/**
 * The website's Settings → Notifications timing: how long before a bill the reminder comes, which
 * charges count as large or unusual, the email digest and budget emails. Each change saves at once
 * and moves back, with the server's reason under it, if the server says no.
 */
export function AlertTimingScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const query = useApiQuery<AlertTiming>(ALERT_TIMING_PATH);
  const currency = useApiQuery<Me>('/api/v1/me').data?.user.currency;
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ part: Part; text: string } | null>(null);
  // The amount field while it is being typed in; null shows what is saved.
  const [amount, setAmount] = useState<string | null>(null);
  const timing = query.data;

  async function save(part: Part, change: AlertTimingChange) {
    if (!session || !timing) return;
    const key = ['api', ALERT_TIMING_PATH];
    client.setQueryData<AlertTiming>(key, { ...timing, ...change });
    setBusy(true);
    setProblem(null);
    try {
      client.setQueryData(key, await apiRequest<AlertTiming>(session, 'PATCH', ALERT_TIMING_PATH, change));
    } catch (error) {
      client.setQueryData(key, timing);
      setProblem({ part, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  function leaveAmount() {
    if (amount === null || !timing) return;
    const change = chargeAmountChange(amount, timing.chargeThresholdCents);
    if (change && 'error' in change) {
      setProblem({ part: 'charges', text: change.error });
      return;
    }
    setAmount(null);
    if (change) void save('charges', { chargeThresholdCents: change.cents });
  }

  async function sendDigestNow() {
    if (!session) return;
    setBusy(true);
    setProblem(null);
    try {
      await apiRequest(session, 'POST', DIGEST_PREVIEW_PATH);
      Alert.alert('Digest sent', 'Check your inbox for the latest digest.');
    } catch (error) {
      setProblem({ part: 'digest', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const problemFor = (part: Part) =>
    problem?.part === part ? <Text style={[formStyles.error, { color: theme.danger }]}>{problem.text}</Text> : null;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !timing ? errorText(query.error) : null} />
        {timing ? (
          <>
            <Section title="Bill reminders" footer={reminderNote(timing.billReminderDays)}>
              <SegmentedControl
                values={reminderChoices(timing).map((c) => c.label)}
                selectedIndex={reminderChoices(timing).findIndex((c) => c.days === timing.billReminderDays)}
                enabled={!busy}
                onChange={(event) => {
                  const choice = reminderChoices(timing)[event.nativeEvent.selectedSegmentIndex];
                  if (choice && choice.days !== timing.billReminderDays) void save('reminders', { billReminderDays: choice.days });
                }}
                accessibilityLabel="How long before a bill to remind you"
              />
              {problemFor('reminders')}
            </Section>

            <Section
              title="Charge alerts"
              footer="An alert when a connected bank brings in a charge over the amount, or one at least three times what that merchant usually charges. Checked hourly; each charge is looked at once.">
              <FormField
                label="Any charge of at least"
                note={`${currency ? `In ${currency}. ` : ''}Leave it empty to alert on unusual charges only, or on none.`}>
                <TextInput
                  value={amount ?? chargeAmountText(timing.chargeThresholdCents)}
                  onChangeText={setAmount}
                  onEndEditing={leaveAmount}
                  placeholder="Off"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  editable={!busy}
                  style={[formStyles.input, formStyles.amount, styles.amount, { color: theme.text }]}
                  accessibilityLabel="Alert on any charge of at least this amount; empty for off"
                />
              </FormField>
              <FormField label="Unusual for the merchant">
                <Switch
                  value={timing.chargeUnusual}
                  disabled={busy}
                  onValueChange={(on) => void save('charges', { chargeUnusual: on })}
                  accessibilityLabel="Alert on charges unusual for the merchant"
                />
              </FormField>
              {problemFor('charges')}
            </Section>

            <Section
              title="Email digest"
              footer={
                timing.emailAvailable
                  ? `What you spent and received, budgets to watch, bills coming up and bank rows to review. ${DIGEST_CHOICES.find((c) => c.value === timing.digest)?.note ?? ''}`
                  : NO_EMAIL
              }>
              <SegmentedControl
                values={DIGEST_CHOICES.map((c) => c.label)}
                selectedIndex={DIGEST_CHOICES.findIndex((c) => c.value === timing.digest)}
                enabled={timing.emailAvailable && !busy}
                onChange={(event) => {
                  const choice = DIGEST_CHOICES[event.nativeEvent.selectedSegmentIndex];
                  if (choice && choice.value !== timing.digest) void save('digest', { digest: choice.value });
                }}
                accessibilityLabel="How often to email a digest"
              />
              {timing.emailAvailable ? (
                <FormButton label="Send Me One Now" disabled={busy} onPress={() => void sendDigestNow()} />
              ) : null}
              {problemFor('digest')}
            </Section>

            <Section
              title="Budget emails"
              footer={
                timing.emailAvailable
                  ? 'Sent to your account email the first time a category reaches 80% of its limit each month, and again if it goes over.'
                  : NO_EMAIL
              }>
              <FormField label="Email budget alerts">
                <Switch
                  value={timing.emailAvailable && timing.budgetAlertEmail}
                  disabled={busy || !timing.emailAvailable}
                  onValueChange={(on) => void save('budget', { budgetAlertEmail: on })}
                  accessibilityLabel="Email budget alerts"
                />
              </FormField>
              {problemFor('budget')}
            </Section>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>When Alerts Come</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  amount: { minWidth: 100 },
});
