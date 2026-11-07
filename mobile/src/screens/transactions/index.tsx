import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { apiGet } from '@/api/client';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Account, Category, Me, OwedToYou, Transaction, TransactionPage } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { OutboxBanner } from '@/components/outbox-banner';
import { UndoBar } from '@/components/undo-bar';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { offerUndo } from '@/state/undo-offer';
import { BULK_PATH, bulkNote, selectAll, selectable, toggled, type BulkOp, type BulkResult } from '@/utils/bulk-edit';
import { localMonth, localToday, relativeDay, shiftMonth } from '@/utils/dates';
import { formatPeriodMonth } from '@/utils/money';
import { OWED_PATH, owedSummary } from '@/utils/owed';
import { groupByDay, listPath, type ListFilters, type TransactionType } from '@/utils/transactions';

import { QuickAddCard } from './quick-add-card';
import { TransactionRow } from './transaction-row';

const TYPE_LABELS: { value: TransactionType | null; label: string }[] = [
  { value: null, label: 'Everything' },
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
];

/** The log month by month, searchable across every month, with filters; a row opens it for editing. */
export function Transactions({ initialNeedsReview = false }: { initialNeedsReview?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const me = useApiQuery<Me>('/api/v1/me');
  const [month, setMonth] = useState(() => localMonth());
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);
  const [filters, setFilters] = useState<ListFilters>({ type: null, needsReview: initialNeedsReview });

  const query = useInfiniteQuery({
    queryKey: ['api', 'transactions', month, search, filters],
    queryFn: ({ pageParam }) => apiGet<TransactionPage>(session!, listPath(month, search, filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(session),
  });
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const rows = query.data?.pages.flatMap((p) => p.transactions) ?? [];
  const sections = groupByDay(rows);
  const currency = me.data?.user.currency ?? 'CAD';
  const today = localToday();
  // Searching and Needs review look across every month.
  const allMonths = Boolean(search) || filters.needsReview;
  const filtered = filters.type !== null || filters.needsReview;

  // Select: one change to several expenses, on a server that takes it.
  const canPick = query.data?.pages[0]?.bulkEdit === true;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useRememberedQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const bulk = useApiMutation<{ ids: string[]; op: BulkOp; value?: string }, BulkResult>('POST', () => BULK_PATH, (v) => v);
  const count = picked.size;
  const pickedLabel = count === 1 ? '1 expense' : `${count} expenses`;

  function stopPicking() {
    setPicking(false);
    setPicked(new Set());
  }

  function run(op: BulkOp, value?: string, name?: string) {
    const ids = [...picked];
    const label = pickedLabel;
    setNote(null);
    bulk.mutate(
      { ids, op, value },
      {
        onSuccess: (result) => {
          setNote({ text: bulkNote(op, result, name), error: false });
          if (op === 'delete' && result.undoIds.length > 0) offerUndo({ kind: 'deletedMany', undoIds: result.undoIds, label });
          stopPicking();
        },
        onError: (err) => setNote({ text: errorText(err), error: true }),
      },
    );
  }

  function confirmDelete() {
    Alert.alert(`Delete ${pickedLabel}?`, 'You can undo it for a few seconds afterwards.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run('delete') },
    ]);
  }

  function askTag() {
    Alert.prompt(
      'Add a tag',
      `To ${pickedLabel}. Tags they already have stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (text?: string) => {
            const tag = text?.trim().replace(/^#/, '');
            if (tag) run('tag', tag, tag);
          },
        },
      ],
      'plain-text',
    );
  }

  function pressRow(item: Transaction) {
    if (!picking) return router.push({ pathname: '/transactions/[id]', params: { id: item.id } });
    if (selectable(item)) setPicked((p) => toggled(p, item.id));
  }

  const heading = search ? `Every month matching “${search}”` : allMonths ? 'Every month' : formatPeriodMonth(month);
  const empty = search
    ? 'Nothing matches that search.'
    : filters.needsReview
      ? 'Nothing is waiting for review.'
      : filtered
        ? 'Nothing this month matches these filters.'
        : 'Nothing logged this month.';

  return (
    <>
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(row) => row.id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <OutboxBanner />
            {note ? (
              <Text
                accessibilityRole={note.error ? 'alert' : undefined}
                accessibilityLiveRegion="polite"
                style={[styles.note, { color: note.error ? theme.danger : theme.positive }]}>
                {note.text}
              </Text>
            ) : null}
            {picking ? (
              <Text style={[styles.note, { color: theme.textSecondary }]}>
                {count === 0 ? 'Tap the expenses to change.' : `${pickedLabel} picked.`} Then choose what to change from the
                menu at the top.
              </Text>
            ) : null}
            {search ? <QuickAddCard text={search} currency={currency} /> : <OwedLine />}
            <Text style={[styles.heading, { color: theme.textSecondary }]}>{heading}</Text>
            {filtered ? (
              <Pressable onPress={() => setFilters({ type: null, needsReview: false })} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, { color: theme.tint }]}>
                  {[filters.needsReview ? 'Needs review' : null, TYPE_LABELS.find((t) => t.value === filters.type && t.value)?.label]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  · Clear
                </Text>
              </Pressable>
            ) : null}
            <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.day, { color: theme.textSecondary }]}>{relativeDay(section.day, today)}</Text>
        )}
        renderItem={({ item, index, section }) => (
          <TransactionRow
            row={item}
            currency={currency}
            first={index === 0}
            last={index === section.data.length - 1}
            onPress={() => pressRow(item)}
            selected={picking ? (selectable(item) ? picked.has(item.id) : null) : undefined}
          />
        )}
        ListEmptyComponent={
          query.isSuccess ? <Text style={[styles.empty, { color: theme.textSecondary }]}>{empty}</Text> : undefined
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={
          query.isFetchingNextPage ? <Text style={[styles.empty, { color: theme.textSecondary }]}>Loading more…</Text> : undefined
        }
      />
      <UndoBar />
      <Stack.Title large>Transactions</Stack.Title>
      <Stack.SearchBar
        placeholder="Search, or 12.50 coffee to add"
        onChangeText={(event) => setSearchText(event.nativeEvent.text)}
        onCancelButtonPress={() => setSearchText('')}
      />
      {picking ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button onPress={stopPicking}>Done</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Change the picked expenses" disabled={bulk.isPending}>
              <Stack.Toolbar.MenuAction icon="checkmark.circle" onPress={() => setPicked(selectAll(rows))}>
                Select All Shown
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.Menu title="Set Category" icon="folder" disabled={count === 0}>
                {(categories.data?.categories ?? [])
                  .filter((c) => c.kind === 'expense')
                  .map((c) => (
                    <Stack.Toolbar.MenuAction key={c.id} onPress={() => run('category', c.id, c.name)}>
                      {c.name}
                    </Stack.Toolbar.MenuAction>
                  ))}
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.Menu title="Set Account" icon="creditcard" disabled={count === 0}>
                {(accounts.data?.accounts ?? [])
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <Stack.Toolbar.MenuAction key={a.id} onPress={() => run('account', a.id, a.name)}>
                      {a.name}
                    </Stack.Toolbar.MenuAction>
                  ))}
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.MenuAction icon="tag" disabled={count === 0} onPress={askTag}>
                Add Tag…
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="checkmark" disabled={count === 0} onPress={() => run('reviewed')}>
                Mark Reviewed
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="trash" destructive disabled={count === 0} onPress={confirmDelete}>
                Delete
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="chevron.left"
            accessibilityLabel="Previous month"
            hidden={allMonths}
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
          />
          <Stack.Toolbar.Button
            icon="chevron.right"
            accessibilityLabel="Next month"
            hidden={allMonths}
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
          />
          <Stack.Toolbar.Menu
            icon={filtered ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease.circle'}
            accessibilityLabel="Filter">
            <Stack.Toolbar.MenuAction
              isOn={filters.needsReview}
              onPress={() => setFilters((f) => ({ ...f, needsReview: !f.needsReview }))}>
              Needs review
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.Menu inline title="Show">
              {TYPE_LABELS.map((option) => (
                <Stack.Toolbar.MenuAction
                  key={option.label}
                  isOn={filters.type === option.value}
                  onPress={() => setFilters((f) => ({ ...f, type: option.value }))}>
                  {option.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction icon="calendar" hidden={allMonths} onPress={() => setMonth(localMonth())}>
              This month
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="checkmark.circle"
              hidden={!canPick}
              onPress={() => {
                setNote(null);
                setPicking(true);
              }}>
              Select expenses
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a transaction" onPress={() => router.push('/add')} />
        </Stack.Toolbar>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five * 3 },
  header: { gap: Spacing.two, paddingTop: Spacing.two },
  heading: { fontSize: 17, fontWeight: '600', marginLeft: Spacing.one },
  link: { fontSize: 15, fontWeight: '600', marginLeft: Spacing.one },
  day: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    marginLeft: Spacing.one,
  },
  empty: { fontSize: 15, textAlign: 'center', marginTop: Spacing.five },
  note: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
});

/** "Owed to you: $45.00 from 2 people ›" above the log while anyone owes something back. */
function OwedLine() {
  const theme = useTheme();
  const router = useRouter();
  // An older server answers 404, and the line stays away.
  const owed = useApiQuery<OwedToYou>(OWED_PATH);
  const summary = owed.data ? owedSummary(owed.data) : null;
  if (!summary) return null;
  return (
    <Pressable onPress={() => router.push('/transactions/owed')} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.link, { color: theme.tint }]}>Owed to you: {summary} ›</Text>
    </Pressable>
  );
}
