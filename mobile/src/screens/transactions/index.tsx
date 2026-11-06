import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { apiGet } from '@/api/client';
import { errorText, useApiQuery } from '@/api/query';
import type { Me, OwedToYou, TransactionPage } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { OutboxBanner } from '@/components/outbox-banner';
import { UndoBar } from '@/components/undo-bar';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
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
            onPress={() => router.push({ pathname: '/transactions/[id]', params: { id: item.id } })}
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
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a transaction" onPress={() => router.push('/add')} />
      </Stack.Toolbar>
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
