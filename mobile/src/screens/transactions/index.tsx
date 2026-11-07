import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { apiGet } from '@/api/client';
import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Account, Category, Me, OwedToYou, SavedSearch, SavedSearches, SearchPage, Tag, Transaction, TransactionPage } from '@/api/types';
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
import {
  applySavedSearch,
  canSearch,
  filtersLine,
  isSearching,
  NO_SEARCH_FILTERS,
  SAVED_SEARCHES_PATH,
  savedSearchBody,
  savedSearchPath,
  savedSearchShown,
  searchPath,
  totalsLine,
  type SearchFilters,
} from '@/utils/search';
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
  // Account, category and tag, with totals and saved searches, on a server that has the website's search.
  const searchable = canSearch(me.data);
  const [more, setMore] = useState<SearchFilters>(NO_SEARCH_FILTERS);
  const searchBar = useRef<SearchBarCommands>(null);
  const searching = searchable && isSearching(search, more);

  const query = useInfiniteQuery({
    queryKey: ['api', 'transactions', month, search, filters, searching ? more : null],
    queryFn: ({ pageParam }) =>
      apiGet<TransactionPage & Partial<SearchPage>>(
        session!,
        searching ? searchPath(search, filters, more, pageParam) : listPath(month, search, filters, pageParam),
      ),
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
  const allMonths = Boolean(search) || searching || filters.needsReview;
  const moreFiltered = searchable && (more.accountId !== null || more.categoryId !== null || more.tagId !== null);
  const filtered = filters.type !== null || filters.needsReview || moreFiltered;
  const totals = searching ? query.data?.pages[0]?.totals : null;

  // Select: one change to several expenses, on a server that takes it.
  const canPick = query.data?.pages[0]?.bulkEdit === true;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useRememberedQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const tags = useApiQuery<{ tags: Tag[] }>(searchable ? '/api/v1/tags' : null);
  const saved = useApiQuery<SavedSearches>(searchable ? SAVED_SEARCHES_PATH : null);
  const shownSaved = searching ? savedSearchShown(saved.data?.searches ?? [], search, filters, more) : null;
  const saveSearch = useApiMutation<ReturnType<typeof savedSearchBody>, { id: string }>('POST', () => SAVED_SEARCHES_PATH, (b) => b);
  const removeSaved = useApiMutation<string, { ok: true }>('DELETE', (id) => savedSearchPath(id));
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

  function clearFilters() {
    setFilters({ type: null, needsReview: false });
    setMore(NO_SEARCH_FILTERS);
  }

  function applySaved(entry: SavedSearch) {
    const next = applySavedSearch(entry);
    searchBar.current?.setText(next.text);
    setSearchText(next.text);
    setFilters({ type: next.type, needsReview: false });
    setMore(next.more);
  }

  function askSaveSearch() {
    Alert.prompt(
      'Save this search',
      'It is kept with the website’s saved searches, with what it finds each time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (name?: string) => {
            if (!name?.trim()) return;
            setNote(null);
            saveSearch.mutate(savedSearchBody(name, search, filters.type, more), {
              onSuccess: () => setNote({ text: `Saved as “${name.trim()}”.`, error: false }),
              onError: (err) => setNote({ text: errorText(err), error: true }),
            });
          },
        },
      ],
      'plain-text',
      search,
    );
  }

  function confirmRemoveSaved(entry: SavedSearch) {
    Alert.alert(`Delete the saved search “${entry.name}”?`, 'The transactions it finds are not touched.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => removeSaved.mutate(entry.id, { onError: (err) => setNote({ text: errorText(err), error: true }) }),
      },
    ]);
  }

  function pressRow(item: Transaction) {
    if (!picking) return router.push({ pathname: '/transactions/[id]', params: { id: item.id } });
    if (selectable(item)) setPicked((p) => toggled(p, item.id));
  }

  const heading = shownSaved
    ? `Saved search: ${shownSaved.name}`
    : search
      ? `Every month matching “${search}”`
      : allMonths
        ? 'Every month'
        : formatPeriodMonth(month);
  const empty = search || searching
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
              <Pressable onPress={clearFilters} accessibilityRole="button" accessibilityHint="Clears the filters" hitSlop={8}>
                <Text style={[styles.link, { color: theme.tint }]}>
                  {filtersLine(
                    filters,
                    searchable ? more : NO_SEARCH_FILTERS,
                    {
                      account: accounts.data?.accounts.find((a) => a.id === more.accountId)?.name,
                      category: categories.data?.categories.find((c) => c.id === more.categoryId)?.name,
                      tag: tags.data?.tags.find((t) => t.id === more.tagId)?.name,
                    },
                    TYPE_LABELS.find((t) => t.value === filters.type)?.label,
                  )}{' '}
                  · Clear
                </Text>
              </Pressable>
            ) : null}
            {totals ? (
              <Text style={[styles.note, { color: theme.text }]} accessibilityLiveRegion="polite">
                {totalsLine(totals, query.data?.pages[0]?.currency ?? currency)}
              </Text>
            ) : null}
            {searching && !picking ? (
              shownSaved ? (
                <Pressable onPress={() => confirmRemoveSaved(shownSaved)} accessibilityRole="button" hitSlop={8} disabled={removeSaved.isPending}>
                  <Text style={[styles.link, { color: theme.danger }]}>Delete Saved Search</Text>
                </Pressable>
              ) : !filters.needsReview ? (
                <Pressable onPress={askSaveSearch} accessibilityRole="button" hitSlop={8} disabled={saveSearch.isPending}>
                  <Text style={[styles.link, { color: theme.tint }]}>Save This Search…</Text>
                </Pressable>
              ) : null
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
        ref={searchBar}
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
            <Stack.Toolbar.Menu title="Account" icon="creditcard" hidden={!searchable}>
              <Stack.Toolbar.MenuAction isOn={more.accountId === null} onPress={() => setMore((m) => ({ ...m, accountId: null }))}>
                Any account
              </Stack.Toolbar.MenuAction>
              {(accounts.data?.accounts ?? []).map((a) => (
                <Stack.Toolbar.MenuAction
                  key={a.id}
                  isOn={more.accountId === a.id}
                  onPress={() => setMore((m) => ({ ...m, accountId: a.id }))}>
                  {a.archived ? `${a.name} (archived)` : a.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu title="Category" icon="folder" hidden={!searchable}>
              <Stack.Toolbar.MenuAction isOn={more.categoryId === null} onPress={() => setMore((m) => ({ ...m, categoryId: null }))}>
                Any category
              </Stack.Toolbar.MenuAction>
              {(categories.data?.categories ?? []).map((c) => (
                <Stack.Toolbar.MenuAction
                  key={c.id}
                  isOn={more.categoryId === c.id}
                  onPress={() => setMore((m) => ({ ...m, categoryId: c.id }))}>
                  {c.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu title="Tag" icon="tag" hidden={!searchable || (tags.data?.tags.length ?? 0) === 0}>
              <Stack.Toolbar.MenuAction isOn={more.tagId === null} onPress={() => setMore((m) => ({ ...m, tagId: null }))}>
                Any tag
              </Stack.Toolbar.MenuAction>
              {(tags.data?.tags ?? []).map((t) => (
                <Stack.Toolbar.MenuAction key={t.id} isOn={more.tagId === t.id} onPress={() => setMore((m) => ({ ...m, tagId: t.id }))}>
                  {`#${t.name}`}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu title="Saved Searches" icon="bookmark" hidden={(saved.data?.searches.length ?? 0) === 0}>
              {(saved.data?.searches ?? []).map((entry) => (
                <Stack.Toolbar.MenuAction
                  key={entry.id}
                  isOn={shownSaved?.id === entry.id}
                  subtitle={entry.summary}
                  onPress={() => applySaved(entry)}>
                  {entry.name}
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
