import { Host, Picker } from '@expo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { refreshBanks, syncOneBank } from '@/api/banks';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Radius, Spacing } from '@/constants/theme';
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

type Tone = 'success' | 'neutral' | 'warning' | 'danger';
type Note = { tone: Tone; message: string };
type SyncResult = Note & { staged: number };

/**
 * The person's bank connections, as Settings → Banks shows them on the website: what each one
 * needs, and where each of its accounts' transactions go. On the server this app was built for,
 * banks are connected and fixed here too, with Face ID and Plaid Link; anywhere else the screen
 * says why not and links to the website. Disconnecting a bank stays on the website.
 *
 * Banks are synced here by hand too, since the server's background sweep can be off: Sync All
 * (the toolbar, or pulling down) checks every bank not checked in the last few minutes, as the
 * Review tab does, and each bank's Sync Now runs whatever the schedule. A sync can find that a
 * bank wants the person to sign in again; that bank's card then leads with the fix.
 */
export function Banks() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const query = useApiQuery<BanksScreenData>(BANKS_PATH);
  const [note, setNote] = useState<Note | null>(null);
  // Which link is running: 'new', or the id of the bank being fixed.
  const [working, setWorking] = useState<string | null>(null);
  // Which sync is running: 'all', or the id of the bank being synced.
  const [syncing, setSyncing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SyncResult>>({});
  const busy = working !== null || syncing !== null;
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
  const canSync = Boolean(data?.available && data.banks.length > 0);

  /** Everything the screen and the Review badge show, read again after a link or a sync. */
  const reload = () => client.invalidateQueries({ queryKey: ['api'] });

  async function syncAll() {
    if (!session || busy) return;
    setNote(null);
    setResults({});
    setSyncing('all');
    try {
      setNote(await refreshBanks(session));
    } catch (err) {
      setNote({ tone: 'danger', message: errorText(err) });
    } finally {
      await reload();
      setSyncing(null);
    }
  }

  async function syncOne(bankId: string) {
    if (!session || busy) return;
    setNote(null);
    setResults(({ [bankId]: _, ...rest }) => rest);
    setSyncing(bankId);
    let result: SyncResult | null = null;
    try {
      const synced = await syncOneBank(session, bankId);
      // A bank that wants a sign-in says so in its own prompt, with the fix, once read again.
      if (!synced.needsSignIn) result = synced;
    } catch (err) {
      result = { tone: 'danger', message: errorText(err), staged: 0 };
    } finally {
      // Waits for the read, so the card changes once: its result, or its sign-in prompt.
      await reload();
      const shown = result;
      if (shown) setResults((all) => ({ ...all, [bankId]: shown }));
      setSyncing(null);
    }
  }

  const { refreshing, onRefresh } = usePullToRefresh(canSync ? syncAll : query.refetch);

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
      await reload();
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
            style={[styles.note, { color: toneColor(theme, note.tone) }]}>
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
                syncing={syncing === bank.id || syncing === 'all'}
                result={results[bank.id] ?? null}
                disabled={busy || map.isPending}
                website={website}
                onFix={(attention) =>
                  void run(bank.id, { mode: 'update', plaidItemId: bank.id, updateKind: attention.updateKind })
                }
                onSync={() => void syncOne(bank.id)}
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
                  disabled={busy}
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
      {canSync ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="arrow.triangle.2.circlepath"
            accessibilityLabel="Sync all banks"
            disabled={busy}
            onPress={() => void syncAll()}
          />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

function toneColor(theme: ReturnType<typeof useTheme>, tone: Tone) {
  if (tone === 'success') return theme.positive;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  return theme.textSecondary;
}

function BankCard(props: {
  bank: LinkedBankDetail;
  accounts: AppAccountChoice[];
  canFix: boolean;
  fixing: boolean;
  syncing: boolean;
  result: SyncResult | null;
  disabled: boolean;
  website: string | null;
  onFix: (attention: NonNullable<LinkedBankDetail['attention']>) => void;
  onSync: () => void;
  onMap: (bankAccountId: string, accountId: string | null) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { bank, accounts, canFix, fixing, syncing, result, disabled, website, onFix, onSync, onMap } = props;
  const attention = bank.attention;
  // Signed out at the bank: nothing will sync until the sign-in, so that is the one action.
  const canSync = attention?.kind !== 'reauth';
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
            <CardButton
              label={fixing ? 'Opening Plaid…' : attention.actionLabel}
              onPress={() => onFix(attention)}
              disabled={disabled}
              primary
            />
          ) : website ? (
            <WebsiteLink url={website} label={`${attention.actionLabel} on the website`} />
          ) : null}
        </View>
      ) : null}
      {canSync ? (
        <View style={styles.attention}>
          <CardButton label={syncing ? 'Syncing…' : 'Sync Now'} onPress={onSync} disabled={disabled} />
          {result ? (
            <Text accessibilityLiveRegion="polite" style={[styles.body, { color: toneColor(theme, result.tone) }]}>
              {result.message}
            </Text>
          ) : null}
          {result && result.staged > 0 ? (
            <Pressable onPress={() => router.navigate('/review')} accessibilityRole="link" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Review them ›</Text>
            </Pressable>
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

/** A bank's own action: a rounded button, filled for the one that fixes something. */
function CardButton(props: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.cardButton,
        props.primary
          ? { backgroundColor: theme.tint, borderColor: theme.tint }
          : { backgroundColor: theme.background, borderColor: theme.border },
        { opacity: props.disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.cardButtonText, { color: props.primary ? '#ffffff' : theme.tint }]}>{props.label}</Text>
    </Pressable>
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
  attention: { gap: Spacing.two, alignItems: 'flex-start' },
  cardButton: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  cardButtonText: { fontSize: 15, fontWeight: '600' },
});
