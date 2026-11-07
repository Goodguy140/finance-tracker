import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { CalendarDay, CalendarMonth } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { billDot, billKind, calendarPath, compactCents, dayLine, WEEKDAYS } from '@/utils/calendar';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/** Most dots a day shows; the rest are in the day's list below. */
const DOTS = 3;

/**
 * The website's Calendar card: the month as a Sunday-first grid, each day's spending (income in
 * green), dots for what is still due, the busiest day outlined. A tapped day lists its totals and
 * what is due on it.
 */
export function SpendingCalendar({ month }: { month: string }) {
  const theme = useTheme();
  const query = useApiQuery<CalendarMonth>(calendarPath(month), { keepPrevious: true });
  const data = query.data;
  const [picked, setPicked] = useState<string | null>(null);
  if (!data) return <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />;
  const days = data.weeks.flat();
  const chosen = days.find((d) => d.date === (picked ?? data.today) && d.inMonth) ?? null;
  const money = (cents: number) => formatCents(cents, data.currency);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.small, { color: theme.textSecondary }]}>
        Spent {money(data.spentCents)}
        {data.incomeCents !== 0 ? ` · Income ${money(data.incomeCents)}` : ''}
      </Text>
      <View style={styles.week} importantForAccessibility="no-hide-descendants">
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={[styles.weekday, { color: theme.textSecondary }]}>
            {d}
          </Text>
        ))}
      </View>
      {data.weeks.map((week) => (
        <View key={week[0].date} style={styles.week}>
          {week.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              currency={data.currency}
              today={day.date === data.today}
              busiest={day.date === data.busiest}
              selected={chosen?.date === day.date}
              onPress={() => setPicked(day.date)}
            />
          ))}
        </View>
      ))}
      {chosen ? (
        <View style={[styles.detail, { borderTopColor: theme.border }]} accessibilityLiveRegion="polite">
          <Text style={[styles.detailTitle, { color: theme.text }]}>{formatDay(chosen.date)}</Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>{dayLine(chosen, data.currency)}</Text>
          {chosen.bills.map((bill, i) => (
            <View key={`${bill.name}-${i}`} style={styles.billLine}>
              <Text style={[styles.billName, { color: theme.text }]} numberOfLines={1}>
                {bill.name}
              </Text>
              <Text style={[styles.small, { color: bill.overdue ? theme.danger : theme.textSecondary }]}>{billKind(bill)}</Text>
              <Text style={[styles.billAmount, { color: bill.type === 'income' ? theme.positive : theme.text }]}>
                {bill.type === 'income' ? '+' : ''}
                {money(bill.cents)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={[styles.small, { color: theme.textSecondary }]}>
        Dots are bills and pay still due (red while unposted, ringed for a plan), violet for transfers and card payments.
      </Text>
    </View>
  );
}

function DayCell(props: {
  day: CalendarDay;
  currency: string;
  today: boolean;
  busiest: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const { day, currency, today, busiest, selected } = props;
  const theme = useTheme();
  if (!day.inMonth) return <View style={styles.cell} />;
  const label = [
    formatDay(day.date),
    dayLine(day, currency),
    ...day.bills.map((b) => `${b.name} ${billKind(b)} ${formatCents(b.cents, currency)}`),
  ].join(', ');
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[
        styles.cell,
        styles.inMonth,
        {
          backgroundColor: selected ? theme.track : 'transparent',
          borderColor: busiest ? theme.warning : today ? theme.tint : 'transparent',
        },
      ]}>
      <Text style={[styles.dayNumber, { color: today ? theme.tint : theme.text, fontWeight: today ? '700' : '400' }]}>{day.day}</Text>
      {day.spentCents !== 0 ? (
        <Text style={[styles.amount, { color: theme.text }]} numberOfLines={1}>
          {compactCents(day.spentCents, currency)}
        </Text>
      ) : null}
      {day.incomeCents !== 0 ? (
        <Text style={[styles.amount, { color: theme.positive }]} numberOfLines={1}>
          +{compactCents(day.incomeCents, currency)}
        </Text>
      ) : null}
      {day.bills.length > 0 ? (
        <View style={styles.dots}>
          {day.bills.slice(0, DOTS).map((bill, i) => {
            const dot = billDot(bill);
            const color = theme[dot.tone];
            return (
              <View
                key={i}
                style={[styles.dot, dot.ringed ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }]}
              />
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  small: { fontSize: 13, lineHeight: 18 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  cell: { flex: 1, minHeight: 50, alignItems: 'center', paddingVertical: 3, gap: 1 },
  inMonth: { borderWidth: 1.5, borderRadius: 8 },
  dayNumber: { fontSize: 13 },
  amount: { fontSize: 10, fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', gap: 2, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, marginTop: Spacing.one, gap: 2 },
  detailTitle: { fontSize: 15, fontWeight: '600' },
  billLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  billName: { flex: 1, fontSize: 15 },
  billAmount: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
