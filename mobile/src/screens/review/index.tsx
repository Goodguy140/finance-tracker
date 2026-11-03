import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { refreshBanks, type BankRefresh } from '@/api/banks';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Me, QueueRevision, QueueRow, ReviewQueue as ReviewQueueData } from '@/api/types';
import { FormButton } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { formatCents } from '@/utils/money';
import {
  acceptRequest,
  banksNeedingAttention,
  defaultDecision,
  ignoreRequest,
  proposalFor,
  queueAmount,
  queueCategory,
  queueSubtitle,
  REVIEW_QUEUE_PATH as QUEUE_PATH,
  strongLinks,
  transferDirection,
  unmatchedIds,
  type QueueRequest,
} from '@/utils/review-queue';

type BulkBody =
  | { action: 'add'; ids: string[] }
  | { action: 'link'; links: { id: string; transactionId: string }[] };

/**
 * The bank review queue: what the banks sent that nobody has looked at yet, newest first. A row
 * opens to link, add, pair or ignore it; strong matches and unmatched rows can go in one step.
 * Pulling down checks the banks now, as the website's refresh icon does.
 */
export function ReviewQueue() {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const me = useApiQuery<Me>('/api/v1/me');
  const query = useApiQuery<ReviewQueueData>(QUEUE_PATH);
  const [note, setNote] = useState<BankRefresh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = me.data?.user.currency ?? 'CAD';

  const checkBanks = useCallback(async () => {
    if (!session) return;
    try {
      setNote(await refreshBanks(session));
    } catch (err) {
      setNote({ tone: 'warning', message: errorText(err) });
    }
    // Everything that counts the queue (the badge, Home) moves with it.
    await client.invalidateQueries({ queryKey: ['api'] });
  }, [session, client]);
  const { refreshing, onRefresh } = usePullToRefresh(checkBanks);

  const bulk = useApiMutation<BulkBody, { ok: true; added?: number }>('POST', () => `${QUEUE_PATH}/bulk`, (body) => body);
  const revision = useApiMutation<{ id: string; action: 'apply' | 'dismiss' }, { ok: true }>(
    'POST',
    (v) => `${QUEUE_PATH}/revisions/${encodeURIComponent(v.id)}`,
    (v) => ({ action: v.action }),
  );
  // A swiped row: several can be on their way at once, so each is tracked by its id.
  const quick = useApiMutation<QueueRequest, unknown>('POST', (r) => r.path, (r) => r.body);
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const busy = bulk.isPending || revision.isPending;
  const fail = (err: unknown) => setError(errorText(err));

  async function decideFromList(row: QueueRow, request: QueueRequest) {
    setError(null);
    setWorking((ids) => new Set(ids).add(row.id));
    try {
      // Resolves once the queue has been read again, so the row leaves the list as it stops dimming.
      await quick.mutateAsync(request);
    } catch (err) {
      fail(err);
    } finally {
      setWorking((ids) => {
        const next = new Set(ids);
        next.delete(row.id);
        return next;
      });
    }
  }

  const data = query.data;
  const rows = data?.rows ?? [];
  const unmatched = unmatchedIds(rows);
  const strong = strongLinks(rows);

  function addAll() {
    Alert.alert(`Add ${unmatched.length} transactions?`, 'Each is added with the category shown, as your rules fill it in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add all',
        onPress: () => {
          setError(null);
          bulk.mutate({ action: 'add', ids: unmatched }, { onError: fail });
        },
      },
    ]);
  }

  function linkAll() {
    Alert.alert(`Link ${strong.length} strong matches?`, 'Each bank row verifies the entry you already made. Nothing about those entries changes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Link all',
        onPress: () => {
          setError(null);
          bulk.mutate({ action: 'link', links: strong }, { onError: fail });
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {note ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.note, { color: note.tone === 'warning' ? theme.warning : note.tone === 'success' ? theme.positive : theme.textSecondary }]}>
            {note.message}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
        {data && !query.error ? (
          <>
            <BanksNeedingYou data={data} origin={session?.origin ?? null} />
            {rows.length === 0 && data.revisions.length === 0 ? (
              <Section>
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  Nothing to review. Transactions from your linked banks wait here until you add, link or ignore them. Pull
                  down to check your banks now.
                </Text>
              </Section>
            ) : null}
            {unmatched.length > 1 || strong.length > 1 ? (
              <View style={styles.bulk}>
                {strong.length > 1 ? <FormButton label={`Link all ${strong.length} strong matches`} onPress={linkAll} disabled={busy} /> : null}
                {unmatched.length > 1 ? <FormButton label={`Add all ${unmatched.length} unmatched`} onPress={addAll} disabled={busy} /> : null}
              </View>
            ) : null}
            <Revisions
              revisions={data.revisions}
              currency={currency}
              disabled={busy}
              onChoose={(id, action) => {
                setError(null);
                revision.mutate({ id, action }, { onError: fail });
              }}
            />
            {rows.length > 0 ? (
              <RowList
                rows={rows}
                categories={data.categories}
                currency={currency}
                working={working}
                onDecide={(row, request) => void decideFromList(row, request)}
                title={`${data.total} to review`}
                footer={[
                  'Swipe a row right to add it as shown, or left to ignore it. Tap it to change anything first.',
                  data.total > rows.length ? `Showing the newest ${rows.length}. The rest appear as you review these.` : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Stack.Title large>Review</Stack.Title>
    </>
  );
}

function BanksNeedingYou({ data, origin }: { data: ReviewQueueData; origin: string | null }) {
  const theme = useTheme();
  const banks = banksNeedingAttention(data.banks);
  if (banks.length === 0) return null;
  return (
    <Section title="Your banks" footer="Signing in to a bank happens on the website.">
      {banks.map((bank) => (
        <View key={bank.id} style={styles.bank}>
          <Text style={[styles.body, { color: theme.text }]}>{bank.message}</Text>
          <Pressable
            onPress={() => origin && void Linking.openURL(`${origin}/settings/banks`)}
            accessibilityRole="link"
            accessibilityHint="Opens the website in Safari"
            hitSlop={8}>
            <Text style={[styles.link, { color: theme.tint }]}>{bank.actionLabel} on the website ›</Text>
          </Pressable>
        </View>
      ))}
    </Section>
  );
}

function Revisions(props: {
  revisions: QueueRevision[];
  currency: string;
  disabled: boolean;
  onChoose: (id: string, action: 'apply' | 'dismiss') => void;
}) {
  const theme = useTheme();
  const { revisions, currency, disabled, onChoose } = props;
  if (revisions.length === 0) return null;
  return (
    <Section title="Changed by your bank" footer="The bank changed these after you added them. Your entry stays as it is until you choose.">
      {revisions.map((rev) => {
        const yours = formatCents(Math.abs(rev.approvedAmountCents), currency);
        const banks = formatCents(Math.abs(rev.bankAmountCents), currency);
        return (
          <View key={rev.id} style={styles.revision}>
            <Text style={[styles.body, { color: theme.text }]}>
              {rev.heading}: you have {yours}, {rev.bank} now says {banks}.
            </Text>
            <View style={styles.revisionButtons}>
              <SmallButton label={`Use ${banks}`} disabled={disabled} onPress={() => onChoose(rev.id, 'apply')} primary />
              <SmallButton label={`Keep ${yours}`} disabled={disabled} onPress={() => onChoose(rev.id, 'dismiss')} />
            </View>
          </View>
        );
      })}
    </Section>
  );
}

function SmallButton(props: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.small,
        {
          backgroundColor: props.primary ? theme.tint : theme.background,
          borderColor: props.primary ? theme.tint : theme.border,
          opacity: props.disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}>
      <Text style={[styles.smallText, { color: props.primary ? theme.onTint : theme.text }]}>{props.label}</Text>
    </Pressable>
  );
}

function RowList(props: {
  rows: QueueRow[];
  categories: ReviewQueueData['categories'];
  currency: string;
  working: ReadonlySet<string>;
  onDecide: (row: QueueRow, request: QueueRequest) => void;
  title: string;
  footer: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { rows, categories, currency, working, onDecide, title, footer } = props;
  // One row open at a time, as in Mail: opening another closes the last.
  const open = useRef<SwipeableMethods | null>(null);
  const opened = (methods: SwipeableMethods) => {
    if (open.current && open.current !== methods) open.current.close();
    open.current = methods;
  };
  return (
    <View style={styles.listWrap}>
      <Text style={[styles.listTitle, { color: theme.textSecondary }]} accessibilityRole="header">
        {title}
      </Text>
      <View>
        {rows.map((row, index) => (
          <SwipeableQueueRow
            key={row.id}
            row={row}
            category={queueCategory(row, categories)}
            currency={currency}
            first={index === 0}
            last={index === rows.length - 1}
            working={working.has(row.id)}
            onOpen={opened}
            onDecide={(request) => onDecide(row, request)}
            onPress={() => router.push({ pathname: '/review/[id]', params: { id: row.id } })}
          />
        ))}
      </View>
      <Text style={[styles.listFooter, { color: theme.textSecondary }]}>{footer}</Text>
    </View>
  );
}

/** What the queue proposes for a row, in a few words under it. */
function proposalLine(row: QueueRow): string | null {
  switch (defaultDecision(row)) {
    case 'link':
      return `Matches ${row.match!.transaction.title}`;
    case 'pair':
      return `Transfer ${transferDirection(row)}`;
    default:
      return row.match ? `Might be ${row.match.transaction.title}` : null;
  }
}

type RowProps = {
  row: QueueRow;
  category: string | null;
  currency: string;
  first: boolean;
  last: boolean;
  working: boolean;
  onOpen: (methods: SwipeableMethods) => void;
  onDecide: (request: QueueRequest) => void;
  onPress: () => void;
};

/**
 * A row that swipes: right shows the proposal's button (Add, or Link or Pair where adding would
 * duplicate an entry or split a transfer), left shows Ignore. A swipe only shows the button and a
 * tap does it, so a stray swipe never ignores a row for good.
 */
function SwipeableQueueRow(props: RowProps) {
  const { row, first, last, working, onOpen, onDecide } = props;
  const swipeable = useRef<SwipeableMethods>(null);
  const accept = acceptRequest(row);
  const ignore = ignoreRequest(row);
  const decide = (request: QueueRequest) => {
    swipeable.current?.close();
    onDecide(request);
  };
  const corners = {
    borderTopLeftRadius: first ? Radius : 0,
    borderTopRightRadius: first ? Radius : 0,
    borderBottomLeftRadius: last ? Radius : 0,
    borderBottomRightRadius: last ? Radius : 0,
  };
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      enabled={!working}
      friction={1.5}
      leftThreshold={SWIPE_ACTION_WIDTH / 2}
      rightThreshold={SWIPE_ACTION_WIDTH / 2}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={[styles.swipeContainer, corners]}
      onSwipeableWillOpen={() => swipeable.current && onOpen(swipeable.current)}
      renderLeftActions={() => <SwipeAction label={accept.label} color={Colors.light.tint} onPress={() => decide(accept)} />}
      renderRightActions={() => <SwipeAction label={ignore.label} color={Colors.light.danger} onPress={() => decide(ignore)} />}>
      <QueueRowItem
        {...props}
        accessibilityActions={[
          { name: 'accept', label: accept.label },
          { name: 'ignore', label: ignore.label },
        ]}
        onAccessibilityAction={(name) => decide(name === 'accept' ? accept : ignore)}
      />
    </ReanimatedSwipeable>
  );
}

const SWIPE_ACTION_WIDTH = 96;

/** The button a swipe uncovers. Fixed colours, so white text reads in dark mode too. */
function SwipeAction({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.swipeAction, { backgroundColor: color, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={styles.swipeActionText}>{label}</Text>
    </Pressable>
  );
}

function QueueRowItem(
  props: RowProps & {
    accessibilityActions: { name: string; label: string }[];
    onAccessibilityAction: (name: string) => void;
  },
) {
  const { row, category, currency, first, last, working, onPress } = props;
  const theme = useTheme();
  const amount = queueAmount(row, currency);
  const name = (proposalFor(row, defaultDecision(row), row.isTransfer) ?? row.asNonTransfer).title;
  const subtitle = queueSubtitle(row);
  const proposal = proposalLine(row);
  return (
    <Pressable
      onPress={onPress}
      disabled={working}
      accessibilityRole="button"
      accessibilityLabel={[name, amount.text, category, subtitle, proposal].filter(Boolean).join(', ')}
      accessibilityState={{ busy: working }}
      accessibilityActions={props.accessibilityActions}
      onAccessibilityAction={(event) => props.onAccessibilityAction(event.nativeEvent.actionName)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.track : theme.backgroundElement,
          borderColor: theme.border,
          borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
          borderTopLeftRadius: first ? Radius : 0,
          borderTopRightRadius: first ? Radius : 0,
          borderBottomLeftRadius: last ? Radius : 0,
          borderBottomRightRadius: last ? Radius : 0,
          opacity: working ? 0.5 : 1,
        },
      ]}>
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
        {proposal ? (
          <Text style={[styles.subtitle, { color: theme.tint }]} numberOfLines={1}>
            {proposal}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.amount, { color: amount.moneyIn ? theme.positive : theme.text }]}>{amount.text}</Text>
        {category ? (
          <Text style={[styles.category, { color: theme.textSecondary }]} numberOfLines={1}>
            {category}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  note: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 15, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600' },
  bank: { gap: Spacing.one },
  bulk: { gap: Spacing.two },
  revision: { gap: Spacing.two },
  revisionButtons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  small: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  smallText: { fontSize: 15, fontWeight: '600' },
  listWrap: { gap: Spacing.two },
  listTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: Spacing.one },
  listFooter: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 2, maxWidth: '40%' },
  name: { fontSize: 17 },
  subtitle: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
  category: { fontSize: 13 },
  swipeContainer: { overflow: 'hidden' },
  swipeAction: { width: SWIPE_ACTION_WIDTH, alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
