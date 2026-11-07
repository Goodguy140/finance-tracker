import { Chart, Host } from '@expo/ui/swift-ui';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { Spending, SpendingComparison } from '@/api/types';
import { LineChart, type ChartSeries } from '@/components/line-chart';
import { Section } from '@/components/section';
import { SwipePages, type SwipePage } from '@/components/swipe-pages';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCents, formatPeriodMonth } from '@/utils/money';
import {
  amountAxis,
  chartMaxCents,
  COMPARE_OPTIONS,
  comparisonLegend,
  comparisonLine,
  dayDetail,
  dayTicks,
  expectedGapLine,
  expectedLegend,
  savingsNote,
  sliceShares,
  SPENDING_CHARTS,
  type SpendingOptions,
} from '@/utils/spending';

const CHART_HEIGHT = 170;
const PIE_HEIGHT = 210;

/** Swift Charts draws pies from iOS 17; iOS 16 gets the same slices as one bar. */
const PIE_SUPPORTED = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 17;

/**
 * The website's two spending cards in one, as its phone layout has them: swipe between Spending by
 * category and Cumulative spending, or pick one from the pills under them. The page last shown is
 * kept on the phone.
 */
export function SpendingCharts(props: {
  data: Spending;
  options: SpendingOptions;
  onOptions: (change: SpendingOptions) => void;
  updating: boolean;
}) {
  const { data, options, onOptions, updating } = props;
  // The chart being read along by a resting finger keeps the card from swiping underneath it.
  const [scrubbing, setScrubbing] = useState(false);
  const pages: SwipePage[] = [
    {
      key: 'categories',
      label: data.categories.grouped ? 'By group' : 'By category',
      content: (
        <CategorySpending
          data={data}
          showSavings={options.showSavings ?? data.showSavings}
          onShowSavings={(showSavings) => onOptions({ showSavings })}
          updating={updating}
        />
      ),
    },
    {
      key: 'cumulative',
      label: 'Cumulative',
      content: (
        <CumulativeSpending
          data={data}
          compareWith={options.compareWith ?? data.compareWith}
          onCompare={(compareWith) => onOptions({ compareWith })}
          onScrubbingChange={setScrubbing}
          updating={updating}
        />
      ),
    },
  ];
  const index = Math.max(0, pages.findIndex((page) => page.key === (options.chart ?? SPENDING_CHARTS[0])));
  return (
    <Section title={`Spending · ${formatPeriodMonth(data.month)}`}>
      <SwipePages
        pages={pages}
        index={index}
        onIndexChange={(i) => onOptions({ chart: SPENDING_CHARTS[i] })}
        scrollEnabled={!scrubbing}
        accessibilityLabel="Spending charts"
      />
    </Section>
  );
}

/**
 * The website's Cumulative spending card: the month's running total by day, the pace the budgets
 * (or the last 3 months) expected, and, if picked, an earlier month's running total to compare.
 */
function CumulativeSpending(props: {
  data: Spending;
  compareWith: SpendingComparison;
  onCompare: (compareWith: SpendingComparison) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
  updating: boolean;
}) {
  const { data } = props;
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected === null ? null : dayDetail(data, selected);
  const { days } = data.cumulative;
  const axis = amountAxis(chartMaxCents(days));
  const money = (cents: number) => formatCents(cents, data.currency);
  const expected = expectedGapLine(data);
  const compared = comparisonLine(data);
  const comparisonName = comparisonLegend(data.compareWith);
  const expectedName = expectedLegend(data.cumulative.expectedBasis);
  const hasComparison = days.some((day) => day.comparisonCents !== null);
  const hasExpected = days.some((day) => day.expectedCents !== null);

  const series: ChartSeries[] = [
    ...(hasExpected
      ? [{ key: 'expected', values: days.map((d) => d.expectedCents), color: theme.chartExpected, width: 2, dashed: true }]
      : []),
    ...(hasComparison ? [{ key: 'comparison', values: days.map((d) => d.comparisonCents), color: theme.chartComparison, width: 2 }] : []),
    { key: 'actual', values: days.map((d) => d.totalCents), color: theme.tint, width: 3, endDot: true },
  ];
  const summary = [`Spent ${money(data.cumulative.totalCents)} so far in ${formatPeriodMonth(data.month)}`, expected?.text, compared?.text]
    .filter(Boolean)
    .join('. ');

  return (
    <View style={styles.body}>
      <View style={[styles.head, { opacity: props.updating ? 0.6 : 1 }]}>
        <Text style={[styles.total, { color: theme.text }]}>{picked ? picked.total : money(data.cumulative.totalCents)}</Text>
        <View style={styles.lines}>
          {picked ? (
            <Text style={[styles.small, { color: theme.text }]}>{picked.lines.join(' · ')}</Text>
          ) : (
            <>
              {expected ? <Text style={[styles.small, { color: theme[expected.tone] }]}>{expected.text}</Text> : null}
              {compared ? (
                <Text style={[styles.small, { color: compared.tone ? theme[compared.tone] : theme.textSecondary }]}>{compared.text}</Text>
              ) : null}
              {!expected && !compared ? (
                <Text style={[styles.small, { color: theme.textSecondary }]}>Running total by day</Text>
              ) : null}
            </>
          )}
        </View>
      </View>
      <View style={{ opacity: props.updating ? 0.6 : 1 }}>
        <LineChart
          series={series}
          maxCents={axis.maxCents}
          ticks={axis.ticks}
          dayTicks={dayTicks(days.length)}
          dayCount={days.length}
          height={CHART_HEIGHT}
          selected={selected}
          onSelect={setSelected}
          onScrubbingChange={props.onScrubbingChange}
          accessibilityLabel={summary}
        />
      </View>
      <View style={styles.legend}>
        <LegendLine color={theme.tint} label="Actual" />
        {hasComparison && comparisonName ? <LegendLine color={theme.chartComparison} label={comparisonName} /> : null}
        {hasExpected && expectedName ? <LegendLine color={theme.chartExpected} label={expectedName} dashed /> : null}
      </View>
      <View style={styles.control}>
        <Text style={[styles.small, { color: theme.textSecondary }]}>Compare with</Text>
        <SegmentedControl
          values={COMPARE_OPTIONS.map((option) => option.label)}
          selectedIndex={Math.max(0, COMPARE_OPTIONS.findIndex((option) => option.value === props.compareWith))}
          onChange={(event) => {
            const option = COMPARE_OPTIONS[event.nativeEvent.selectedSegmentIndex];
            if (option) props.onCompare(option.value);
          }}
          accessibilityLabel="Compare with"
        />
      </View>
    </View>
  );
}

function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendSwatch}>
        {dashed ? (
          <>
            <View style={[styles.dash, { backgroundColor: color }]} />
            <View style={[styles.dash, { backgroundColor: color }]} />
          </>
        ) : (
          <View style={[styles.swatchLine, { backgroundColor: color }]} />
        )}
      </View>
      <Text style={[styles.legendText, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

/**
 * The website's Spending by category pie: the month's net spending by category (or by group once
 * there are groups), the tail rolled into "Other categories", and, if turned on, what was moved
 * into savings beside them.
 */
function CategorySpending(props: {
  data: Spending;
  showSavings: boolean;
  onShowSavings: (show: boolean) => void;
  updating: boolean;
}) {
  const { data } = props;
  const theme = useTheme();
  const router = useRouter();
  const { slices } = data.categories;
  const shares = sliceShares(slices);
  const money = (cents: number) => formatCents(cents, data.currency);
  const note = savingsNote(data);

  return (
    <View style={styles.body}>
      {slices.length === 0 ? (
        <Text style={[styles.muted, { color: theme.textSecondary }]}>No spending in a category this month yet.</Text>
      ) : (
        <View style={{ gap: Spacing.three, opacity: props.updating ? 0.6 : 1 }}>
          <View
            style={{ height: PIE_SUPPORTED ? PIE_HEIGHT : undefined }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            {PIE_SUPPORTED ? (
              <>
                <Host style={StyleSheet.absoluteFill}>
                  <Chart
                    type="pie"
                    animate
                    showLegend={false}
                    data={slices.map((slice) => ({ x: slice.name, y: Math.abs(slice.cents) / 100, color: slice.color }))}
                    pieStyle={{ innerRadius: 0.62, angularInset: 1.5, cornerRadius: 3, opacity: 1 }}
                  />
                </Host>
                <View style={[StyleSheet.absoluteFill, styles.pieCentre]} pointerEvents="none">
                  <Text style={[styles.pieTotal, { color: theme.text }]} adjustsFontSizeToFit numberOfLines={1}>
                    {money(data.categories.totalCents)}
                  </Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>spent</Text>
                </View>
              </>
            ) : (
              <View style={[styles.bar, { backgroundColor: theme.track }]}>
                {slices.map((slice, i) => (
                  <View key={`${slice.name}-${i}`} style={{ flex: Math.max(shares[i], 1), backgroundColor: slice.color }} />
                ))}
              </View>
            )}
          </View>
          <View style={styles.rows}>
            {slices.map((slice, i) => {
              const label = `${slice.name}: ${money(slice.cents)}, ${shares[i]} percent${slice.kind === 'savings' ? ', moved into savings' : ''}`;
              const row = (
                <>
                  <View style={[styles.swatch, { backgroundColor: slice.color }]} />
                  <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                    {slice.name}
                  </Text>
                  <Text style={[styles.share, { color: theme.textSecondary }]}>{shares[i]}%</Text>
                  <Text style={[styles.amount, { color: slice.cents < 0 ? theme.positive : theme.text }]}>{money(slice.cents)}</Text>
                </>
              );
              const { categoryId } = slice;
              // A category's own slice opens its page; a group's, the rest and Savings stay put.
              return categoryId ? (
                <Pressable
                  key={`${slice.name}-${i}`}
                  onPress={() => router.push({ pathname: '/category', params: { id: categoryId } })}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint="Shows the category by month and who it went to"
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                  {row}
                </Pressable>
              ) : (
                <View key={`${slice.name}-${i}`} style={styles.row} accessible accessibilityLabel={label}>
                  {row}
                </View>
              );
            })}
          </View>
        </View>
      )}
      {note ? <Text style={[styles.small, { color: theme.textSecondary }]}>{note}</Text> : null}
      <View style={styles.switchRow}>
        <Text style={[styles.rowName, { color: theme.text }]}>Show savings</Text>
        <Switch value={props.showSavings} onValueChange={props.onShowSavings} accessibilityLabel="Show savings beside the categories" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A page's own column, spaced as a card's is.
  body: { gap: Spacing.three },
  head: { gap: 2 },
  // Two lines' room under the total, so the chart stays put while a finger moves along it.
  lines: { minHeight: 36, gap: 2 },
  total: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  small: { fontSize: 13, lineHeight: 18 },
  muted: { fontSize: 15, lineHeight: 21 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 16, flexDirection: 'row', justifyContent: 'space-between' },
  swatchLine: { width: 16, height: 3, borderRadius: 1.5 },
  dash: { width: 6, height: 2, borderRadius: 1 },
  legendText: { fontSize: 12 },
  control: { gap: Spacing.two },
  pieCentre: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: '30%' },
  pieTotal: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row' },
  rows: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  rowName: { fontSize: 15, flex: 1 },
  share: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'right' },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 84, textAlign: 'right' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
