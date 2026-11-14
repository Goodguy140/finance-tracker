import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput } from 'react-native';

import { apiRequest } from '@/api/client';
import { errorText, useApiQuery } from '@/api/query';
import type { SafeToSpendSettings } from '@/api/types';
import { FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { formatCents } from '@/utils/money';
import {
  bufferDaysChange,
  bufferDaysText,
  bufferNote,
  SAFE_TO_SPEND_PATH,
  safeToSpendBufferLine,
  safeToSpendLine,
} from '@/utils/safe-to-spend';

/**
 * Safe to spend's bill buffer, the same value the website's Safe to spend card sets: how many days
 * ahead it also holds back bills that fall next month. Saves when the field is left, and shows the
 * number it gives now. Also the website card's zero-based switch, where the server takes it.
 */
export function SafeToSpendSettingsScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const query = useApiQuery<SafeToSpendSettings>(SAFE_TO_SPEND_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  // The field while it is being typed in; null shows what is saved.
  const [text, setText] = useState<string | null>(null);
  const settings = query.data;

  async function leave() {
    if (text === null || !settings || !session) return;
    const change = bufferDaysChange(text, settings.bufferDays, settings.maxBufferDays);
    if (change && 'error' in change) {
      setProblem(change.error);
      return;
    }
    setProblem(null);
    if (!change) {
      setText(null);
      return;
    }
    setBusy(true);
    try {
      client.setQueryData(['api', SAFE_TO_SPEND_PATH], await apiRequest<SafeToSpendSettings>(session, 'PATCH', SAFE_TO_SPEND_PATH, change));
      setText(null);
      // Home's number and the widgets follow the new buffer.
      void client.invalidateQueries({ queryKey: ['api', '/api/v1/summary'] });
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function setZeroBased(on: boolean) {
    if (!session) return;
    setSwitchProblem(null);
    setBusy(true);
    try {
      client.setQueryData(
        ['api', SAFE_TO_SPEND_PATH],
        await apiRequest<SafeToSpendSettings>(session, 'PATCH', SAFE_TO_SPEND_PATH, { zeroBased: on }),
      );
      // Home's card switches between Safe to spend and To assign.
      void client.invalidateQueries({ queryKey: ['api', '/api/v1/summary'] });
    } catch (error) {
      setSwitchProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const safe = settings?.safeToSpend;
  const bufferLine = safe ? safeToSpendBufferLine(safe) : null;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !settings ? errorText(query.error) : null} />
        {settings && safe ? (
          <>
            <Section
              title="Bill buffer"
              footer={`Bills due by month end always count. A buffer also holds back next month's bills due within that many days, like rent on the 1st, so this month's money isn't spent on them. Pay due next month isn't counted. ${bufferNote(settings.bufferDays)}`}>
              <FormField label="Days ahead" note={`1 to ${settings.maxBufferDays}. Leave it empty for none.`}>
                <TextInput
                  value={text ?? bufferDaysText(settings.bufferDays)}
                  onChangeText={setText}
                  onEndEditing={() => void leave()}
                  placeholder="Off"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  editable={!busy}
                  style={[formStyles.input, formStyles.amount, styles.days, { color: theme.text }]}
                  accessibilityLabel="Bill buffer in days; empty for none"
                />
              </FormField>
              {problem ? <Text style={[formStyles.error, { color: theme.danger }]}>{problem}</Text> : null}
            </Section>

            {settings.zeroBased !== undefined ? (
              <Section
                title="Zero-based budgeting"
                footer="Give every dollar a job: Home shows this month's income still to assign to budgets and goals instead of Safe to spend. The website's Safe to spend card switches the same setting.">
                <FormField label="Show To assign on Home">
                  <Switch
                    value={settings.zeroBased}
                    disabled={busy}
                    onValueChange={(on) => void setZeroBased(on)}
                    accessibilityLabel="Zero-based budgeting"
                  />
                </FormField>
                {switchProblem ? <Text style={[formStyles.error, { color: theme.danger }]}>{switchProblem}</Text> : null}
              </Section>
            ) : null}

            <Section title="Safe to spend now">
              <Text style={[styles.amount, { color: safe.safeCents < 0 ? theme.danger : theme.positive }]}>
                {formatCents(safe.safeCents, settings.currency)}
              </Text>
              <Text style={[styles.muted, { color: theme.textSecondary }]}>{safeToSpendLine(safe, settings.currency)}</Text>
              {bufferLine ? <Text style={[styles.muted, { color: theme.textSecondary }]}>{bufferLine}</Text> : null}
            </Section>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Safe to Spend</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  days: { minWidth: 80 },
  amount: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { fontSize: 15, lineHeight: 21 },
});
