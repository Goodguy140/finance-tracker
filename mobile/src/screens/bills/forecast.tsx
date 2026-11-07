import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { BillsForecast, ForecastEntry } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Radius, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import {
  entryAmount,
  entryChips,
  entryDetail,
  FORECAST_DAYS,
  forecastPath,
  signedCents,
  type ForecastDays,
} from '@/utils/bills-forecast';
import { relativeDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/**
 * The website's Upcoming bills card: every bill, pay and plan due in the next 30, 60 or 90 days,
 * day by day with the running net, and transfers and card payments beside them outside the totals.
 * A rule's line opens the rule, a plan's the plan, a card payment the card's account page.
 */
export function UpcomingBills() {
  const theme = useTheme();
  const router = useRouter();
  const [days, setDays] = useState<ForecastDays>(30);
  const [moves, setMoves] = useState(true);
  const query = useApiQuery<BillsForecast>(forecastPath(days, moves), { keepPrevious: true });
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const money = (cents: number) => formatCents(cents, data?.currency ?? 'CAD');
  const listsMoves = data?.groups.some((g) => g.entries.some((e) => e.type === 'transfer')) ?? false;

  function open(entry: ForecastEntry) {
    if (entry.card) router.push({ pathname: '/accounts/[id]', params: { id: entry.sourceId } });
    else if (entry.planned) router.push({ pathname: '/plan', params: { id: entry.sourceId } });
    else router.push({ pathname: '/recurring-rule', params: { id: entry.sourceId } });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <SegmentedControl
          values={FORECAST_DAYS.map((d) => `${d} days`)}
          selectedIndex={FORECAST_DAYS.indexOf(days)}
          onChange={(event) => setDays(FORECAST_DAYS[event.nativeEvent.selectedSegmentIndex] ?? days)}
          accessibilityLabel="How far ahead"
        />
        <View style={[styles.toggle, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Text style={[styles.toggleText, { color: theme.text }]}>Transfers and card payments</Text>
          <Switch value={moves} onValueChange={setMoves} accessibilityLabel="Show transfers and card payments" />
        </View>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data && data.sources === 0 ? (
          <Text style={[styles.muted, { color: theme.textSecondary }]}>
            Add a recurring bill or paycheque, or plan a one-off, on Bills and pay, and it will show up here.
          </Text>
        ) : null}
        {data && data.sources > 0 ? (
          <>
            <View style={styles.tiles}>
              <Tile label="Income due" value={money(data.incomeCents)} color={theme.positive} />
              <Tile label="Bills due" value={money(data.expenseCents)} color={theme.text} />
              <Tile label="Net" value={money(data.netCents)} color={data.netCents >= 0 ? theme.positive : theme.danger} />
            </View>
            {data.groups.length === 0 ? (
              <Text style={[styles.muted, { color: theme.textSecondary }]}>
                Nothing recurring or planned is due in the next {data.days} days.
              </Text>
            ) : (
              data.groups.map((group) => (
                <View key={group.date} style={styles.group}>
                  <View style={styles.groupHead}>
                    <Text style={[styles.groupTitle, { color: theme.textSecondary }]} accessibilityRole="header">
                      {relativeDay(group.date, data.today)}
                    </Text>
                    <Text style={[styles.running, { color: theme.textSecondary }]}>
                      Running net {signedCents(group.runningNetCents, data.currency)}
                    </Text>
                  </View>
                  <View>
                    {group.entries.map((entry, index) => (
                      <EntryRow
                        key={entry.key}
                        entry={entry}
                        currency={data.currency}
                        first={index === 0}
                        last={index === group.entries.length - 1}
                        onPress={() => open(entry)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
            <Text style={[styles.footer, { color: theme.textSecondary }]}>
              {listsMoves
                ? 'Transfers and card payments move money between your own accounts, so they are listed but left out of the totals and the running net. '
                : ''}
              The running net is income due less bills from the top of the list through that day.
            </Text>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Upcoming bills</Stack.Title>
    </>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function EntryRow(props: { entry: ForecastEntry; currency: string; first: boolean; last: boolean; onPress: () => void }) {
  const { entry, currency, first, last } = props;
  const theme = useTheme();
  const detail = entryDetail(entry, currency);
  const chips = entryChips(entry);
  const amount = entryAmount(entry, currency);
  const tone = { tint: theme.tint, warning: theme.warning, danger: theme.danger, muted: theme.textSecondary };
  const corners = {
    borderTopLeftRadius: first ? Radius : 0,
    borderTopRightRadius: first ? Radius : 0,
    borderBottomLeftRadius: last ? Radius : 0,
    borderBottomRightRadius: last ? Radius : 0,
  };
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={[entry.name, amount, detail, ...chips.map((c) => c.text)].filter(Boolean).join(', ')}
      accessibilityHint={entry.card ? 'Opens the card’s account' : entry.planned ? 'Opens the plan' : 'Opens the rule'}
      style={({ pressed }) => [
        styles.row,
        corners,
        {
          backgroundColor: pressed ? theme.track : theme.backgroundElement,
          borderColor: theme.border,
          borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
        },
      ]}>
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {entry.name}
        </Text>
        {detail ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {chips.length > 0 ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {chips.map((chip, i) => (
              <Text key={chip.text} style={{ color: tone[chip.tone], fontWeight: chip.tone === 'muted' ? '400' : '600' }}>
                {i > 0 ? ' · ' : ''}
                {chip.text}
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.amount,
          { color: entry.type === 'income' ? theme.positive : entry.type === 'transfer' ? theme.textSecondary : theme.text },
        ]}>
        {amount}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  muted: { fontSize: 15, lineHeight: 21 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  toggleText: { fontSize: 17 },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1, borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: 2 },
  tileLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  tileValue: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  group: { gap: Spacing.two },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: Spacing.one, gap: Spacing.two },
  groupTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  running: { fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
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
  name: { fontSize: 17 },
  subtitle: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
});
