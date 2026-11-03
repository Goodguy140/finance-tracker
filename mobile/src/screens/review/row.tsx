import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { Host, Picker } from '@expo/ui';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Me, QueueProposal, QueueRow, ReviewQueue } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import {
  addBody,
  defaultDecision,
  proposalFor,
  proposalReason,
  queueAmount,
  queueSubtitle,
  REVIEW_QUEUE_PATH as QUEUE_PATH,
  transferDirection,
  type QueueDecision,
} from '@/utils/review-queue';

/** One bank row from the queue, opened to decide what it is. */
export function QueueRowDetail({ id }: { id: string }) {
  const theme = useTheme();
  const me = useApiQuery<Me>('/api/v1/me');
  const query = useApiQuery<ReviewQueue>(QUEUE_PATH);
  const found = query.data?.rows.find((r) => r.id === id);
  // Deciding refetches the queue before the screen closes, and the row is gone from it by then:
  // keep showing the row it was, rather than flashing "already reviewed" on the way out.
  const [kept, setKept] = useState<QueueRow | null>(null);
  if (found && found !== kept) setKept(found);
  const row = found ?? kept;
  if (!row || !query.data) {
    return (
      <>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={formStyles.content}>
          <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
          {query.data ? (
            <Text style={[formStyles.error, { color: theme.textSecondary }]}>This bank transaction has already been reviewed.</Text>
          ) : null}
        </ScrollView>
        <Stack.Title>Bank transaction</Stack.Title>
      </>
    );
  }
  return (
    <Decider
      key={row.id}
      row={row}
      categories={query.data.categories[row.type]}
      currency={me.data?.user.currency ?? 'CAD'}
    />
  );
}

const DECISION_LABELS: Record<QueueDecision, string> = { link: 'Link', pair: 'Pair', add: 'Add' };

function Decider({ row, categories, currency }: { row: QueueRow; categories: { id: string; name: string }[]; currency: string }) {
  const theme = useTheme();
  const router = useRouter();
  const choices: QueueDecision[] = [row.match ? 'link' : null, row.transferPair ? 'pair' : null, 'add'].filter(
    (c): c is QueueDecision => c !== null,
  );
  const [decision, setDecision] = useState<QueueDecision>(() => defaultDecision(row));
  const [asTransfer, setAsTransfer] = useState(row.isTransfer);
  const [categoryId, setCategoryId] = useState<string | null>(row.suggestedCategoryId ?? categories[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const decide = useApiMutation<Record<string, unknown>, { transactionId: string | null }>(
    'POST',
    () => `${QUEUE_PATH}/${encodeURIComponent(row.id)}`,
    (body) => body,
  );
  const pair = useApiMutation<void, { transactionIds: [string, string] }>(
    'POST',
    () => `${QUEUE_PATH}/pair`,
    () => ({ id: row.id, peerId: row.transferPair?.id }),
  );
  const busy = decide.isPending || pair.isPending;
  const done = { onSuccess: () => router.back(), onError: (err: unknown) => setError(errorText(err)) };

  const amount = queueAmount(row, currency);
  const proposal = proposalFor(row, decision, asTransfer);
  const shown = proposal ?? (row.isTransfer ? row.asTransfer : row.asNonTransfer);
  // A rule's split is kept only while the row keeps the category the rule gave it.
  const splitKept = decision === 'add' && !asTransfer && categoryId === row.suggestedCategoryId;

  function submit() {
    setError(null);
    if (decision === 'link' && row.match) decide.mutate({ decision: 'link', transactionId: row.match.transaction.id }, done);
    else if (decision === 'pair') pair.mutate(undefined, done);
    else decide.mutate(addBody(row, asTransfer, categoryId), done);
  }

  function ignore() {
    Alert.alert('Ignore this bank transaction?', 'Nothing is added, and the bank will not offer it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Ignore', style: 'destructive', onPress: () => decide.mutate({ decision: 'ignore' }, done) },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        <View style={styles.head}>
          <Text style={[styles.amount, { color: amount.moneyIn ? theme.positive : theme.text }]}>{amount.text}</Text>
          <Text style={[styles.headText, { color: theme.textSecondary }]}>
            {row.bank} · {queueSubtitle(row)}
          </Text>
          {row.pending ? (
            <Text style={[styles.headText, { color: theme.warning }]}>Still pending at the bank, so the amount can change.</Text>
          ) : null}
        </View>

        {choices.length > 1 ? (
          <SegmentedControl
            values={choices.map((c) => DECISION_LABELS[c])}
            selectedIndex={choices.indexOf(decision)}
            onChange={(event) => setDecision(choices[event.nativeEvent.selectedSegmentIndex] ?? decision)}
            accessibilityLabel="What to do with it"
          />
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        {decision === 'link' && row.match ? (
          <Section title="Looks like an entry you added" footer="Linking marks your entry as verified by the bank. Nothing else about it changes.">
            <Line label={row.match.transaction.title} value={formatCents(Math.abs(row.match.transaction.amountCents), currency)} />
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {[formatDay(row.match.transaction.date), row.match.tier === 'high' ? 'Strong match' : 'Possible match', ...row.match.reasons].join(' · ')}
            </Text>
          </Section>
        ) : null}

        {decision === 'pair' && row.transferPair ? (
          <Section
            title="The other side of a transfer"
            footer="Both bank rows are added as one transfer between your accounts, kept out of spending and income.">
            <Line label={row.transferPair.heading} value={transferDirection(row) ?? ''} />
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {row.transferPair.account} · {formatDay(row.transferPair.date)}
            </Text>
          </Section>
        ) : null}

        {decision === 'add' ? (
          <Section footer={asTransfer ? 'A transfer between your own accounts is kept out of spending and income.' : null}>
            <FormField label="Transfer">
              <Switch value={asTransfer} onValueChange={setAsTransfer} accessibilityLabel="Add as a transfer" />
            </FormField>
            {!asTransfer ? (
              <FormField label="Category">
                {categories.length > 0 ? (
                  <Host matchContents>
                    <Picker selectedValue={categoryId ?? ''} onValueChange={(v) => setCategoryId(String(v))}>
                      {categories.map((c) => (
                        <Picker.Item key={c.id} label={c.name} value={c.id} />
                      ))}
                    </Picker>
                  </Host>
                ) : (
                  <Text style={[formStyles.value, { color: theme.textSecondary }]}>None yet</Text>
                )}
              </FormField>
            ) : null}
          </Section>
        ) : null}

        {proposal ? <Preview proposal={shown} splitKept={splitKept} /> : null}

        <FormButton
          label={decision === 'link' ? 'Link to this entry' : decision === 'pair' ? 'Add both as one transfer' : 'Add'}
          onPress={submit}
          disabled={busy || (decision === 'add' && !asTransfer && !categoryId)}
        />
        <FormButton label="Ignore" onPress={ignore} disabled={busy} destructive />
      </ScrollView>
      <Stack.Title>{shown.title}</Stack.Title>
    </>
  );
}

/** What adding it writes: the title, and what the person's rules add to it. */
function Preview({ proposal, splitKept }: { proposal: QueueProposal; splitKept: boolean }) {
  const theme = useTheme();
  const reason = proposalReason(proposal);
  return (
    <Section title="Adds" footer={reason}>
      <Line label="Title" value={proposal.title} />
      {proposal.note ? <Line label="Note" value={proposal.note} /> : null}
      {proposal.tags.length > 0 ? <Line label="Tags" value={proposal.tags.map((t) => `#${t}`).join(' ')} /> : null}
      {proposal.split && splitKept ? (
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Split {proposal.split}</Text>
      ) : null}
    </Section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: theme.text }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.lineValue, { color: theme.textSecondary }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.one, alignItems: 'center', paddingVertical: Spacing.two },
  amount: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  headText: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  lineLabel: { fontSize: 17, flexShrink: 1 },
  lineValue: { fontSize: 17, flexShrink: 1, textAlign: 'right' },
});
