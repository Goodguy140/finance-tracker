import { Host, Picker } from '@expo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { runBankLink, type BankLinkRequest } from '@/session/bank-link';
import { passkeysAvailable } from '@/session/passkeys';
import { useSession } from '@/session/session-provider';
import { HOME_SERVER } from '@/session/sign-in-with-server';
import {
  accountChoices,
  bankAccountLabel,
  BANKS_PATH,
  describeLinkFinish,
  linkingInApp,
  unmatchedCount,
  type AppAccountChoice,
  type BanksScreenData,
  type LinkedBankDetail,
} from '@/utils/banks';
import { formatDay } from '@/utils/dates';
import { isHomeServer } from '@/utils/home-server';

const NOT_SYNCED = 'none';
const ELSEWHERE = 'elsewhere';

type Note = { tone: 'success' | 'danger'; message: string };

/**
 * The person's bank connections, as Settings → Banks shows them on the website: what each one
 * needs, and where each of its accounts' transactions go. On the server this app was built for,
 * banks are connected and fixed here too, with Face ID and Plaid Link; anywhere else the screen
 * says why not and links to the website. Disconnecting a bank stays on the website.
 */
export function Banks() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const query = useApiQuery<BanksScreenData>(BANKS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [note, setNote] = useState<Note | null>(null);
  // Which link is running: 'new', or the id of the bank being fixed.
  const [working, setWorking] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState<number | null>(null);
  const map = useApiMutation<{ id: string; accountId: string | null }, unknown>(
    'PUT',
    (v) => `${BANKS_PATH}/accounts/${encodeURIComponent(v.id)}`,
    (v) => ({ accountId: v.accountId }),
  );

  const data = query.data;
  const linking = data
    ? linkingInApp({
        nativeReady: passkeysAvailable(),
        homeServer: session ? isHomeServer(session.origin, HOME_SERVER) : false,
        data,
      })
    : null;
  const website = session ? `${session.origin}/settings/banks` : null;

  async function run(key: string, request: BankLinkRequest) {
    if (!session || working) return;
    setNote(null);
    setWorking(key);
    try {
      const outcome = await runBankLink(session, request);
      if (outcome.status === 'done') setNote({ tone: 'success', message: describeLinkFinish(outcome.result) });
      if (outcome.status === 'failed') setNote({ tone: 'danger', message: outcome.error });
    } catch (err) {
      setNote({ tone: 'danger', message: errorText(err) });
    } finally {
      setWorking(null);
      // A new bank adds accounts here and on Review; a fixed one clears its prompt everywhere.
      await client.invalidateQueries({ queryKey: ['api'] });
    }
  }

  const days = historyDays ?? data?.defaultHistoryDays ?? 90;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        {note ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole={note.tone === 'danger' ? 'alert' : undefined}
            style={[styles.note, { color: note.tone === 'success' ? theme.positive : theme.danger }]}>
            {note.message}
          </Text>
        ) : null}
        {map.error ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: theme.danger }]}>
            {errorText(map.error)}
          </Text>
        ) : null}
        <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
        {data && linking && !query.error ? (
          <>
            {data.banks.map((bank) => (
              <BankCard
                key={bank.id}
                bank={bank}
                accounts={data.accounts}
                canFix={linking.ok}
                fixing={working === bank.id}
                disabled={working !== null || map.isPending}
                website={website}
                onFix={(attention) =>
                  void run(bank.id, { mode: 'update', plaidItemId: bank.id, updateKind: attention.updateKind })
                }
                onMap={(id, accountId) => map.mutate({ id, accountId })}
              />
            ))}

            {linking.ok ? (
              <>
                <Section
                  title="Connect a bank"
                  footer="Face ID confirms it's you, then Plaid opens so you can sign in to your bank. What it sends waits on Review until you add it. To disconnect a bank, use the website.">
                  <FormField label="History to fetch">
                    <Host matchContents>
                      <Picker selectedValue={String(days)} onValueChange={(v) => setHistoryDays(Number(v))}>
                        {data.historyWindows.map((w) => (
                          <Picker.Item key={w.days} label={w.label} value={String(w.days)} />
                        ))}
                      </Picker>
                    </Host>
                  </FormField>
                </Section>
                <FormButton
                  label={working === 'new' ? 'Connecting…' : 'Connect a Bank'}
                  onPress={() => void run('new', { mode: 'create', historyDays: days })}
                  disabled={working !== null}
                />
              </>
            ) : (
              <Section title={data.banks.length ? 'Connect or fix a bank' : 'Connect a bank'}>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{linking.reason}</Text>
                {data.available && website ? <WebsiteLink url={website} label="Open Banks on the website" /> : null}
              </Section>
            )}
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Banks</Stack.Title>
    </>
  );
}

function BankCard(props: {
  bank: LinkedBankDetail;
  accounts: AppAccountChoice[];
  canFix: boolean;
  fixing: boolean;
  disabled: boolean;
  website: string | null;
  onFix: (attention: NonNullable<LinkedBankDetail['attention']>) => void;
  onMap: (bankAccountId: string, accountId: string | null) => void;
}) {
  const theme = useTheme();
  const { bank, accounts, canFix, fixing, disabled, website, onFix, onMap } = props;
  const attention = bank.attention;
  const checked = bank.lastSyncedAt
    ? new Date(bank.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  const footer = [
    `Transactions from ${formatDay(bank.historyCutoff)}.`,
    checked ? `Last checked ${checked}.` : 'Not checked yet.',
    unmatchedCount(bank) > 0 ? 'Nothing syncs from an account until you choose where it goes.' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Section title={bank.name} footer={footer}>
      {attention ? (
        <View style={styles.attention}>
          <Text style={[styles.body, { color: theme.warning }]}>{attention.message}</Text>
          {canFix ? (
            <Pressable onPress={() => onFix(attention)} disabled={disabled} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint, opacity: disabled ? 0.5 : 1 }]}>
                {fixing ? 'Opening Plaid…' : `${attention.actionLabel} ›`}
              </Text>
            </Pressable>
          ) : website ? (
            <WebsiteLink url={website} label={`${attention.actionLabel} on the website`} />
          ) : null}
        </View>
      ) : null}
      {bank.accounts.map((account) => {
        const choices = accountChoices(account, accounts);
        // Pointed at an account the picker cannot offer (archived since): shown, so it is not lost silently.
        const elsewhere = account.accountId !== null && !choices.some((c) => c.id === account.accountId);
        return (
          <FormField key={account.id} label={bankAccountLabel(account)}>
            <Host matchContents>
              <Picker
                selectedValue={elsewhere ? ELSEWHERE : (account.accountId ?? NOT_SYNCED)}
                onValueChange={(v) => {
                  if (v === ELSEWHERE) return;
                  onMap(account.id, v === NOT_SYNCED ? null : String(v));
                }}>
                <Picker.Item label="Not synced" value={NOT_SYNCED} />
                {elsewhere ? <Picker.Item label="An archived account" value={ELSEWHERE} /> : null}
                {choices.map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
        );
      })}
    </Section>
  );
}

function WebsiteLink({ url, label }: { url: string; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityHint="Opens the website in Safari"
      hitSlop={8}>
      <Text style={[styles.link, { color: theme.tint }]}>{label} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
  attention: { gap: Spacing.one },
});
