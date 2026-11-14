import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import {
  axisAmount,
  dashedSegments,
  dayIndexAt,
  linePoints,
  solidSegments,
  type Point,
  type Segment,
} from '@/utils/spending';

/** One line on the chart: a value per day, null where it has none. */
export type ChartSeries = {
  key: string;
  values: readonly (number | null)[];
  color: string;
  width: number;
  dashed?: boolean;
  /** A dot where the line ends: today, on the actual line. */
  endDot?: boolean;
};

const AXIS_WIDTH = 40;
const LABEL_HEIGHT = 18;
/** How long a finger rests on the chart before sliding it reads along the days instead of swiping the card. */
const HOLD_MS = 250;

/**
 * A line chart of amounts by day, drawn with plain views: each straight piece of line is a thin
 * view turned to its slope, so it needs no native drawing library and reaches phones in an update.
 * A finger on it picks the day under it (`onSelect`); lifting it lets go. Resting the finger for a
 * moment turns on reading along the days (`onScrubbingChange`), so the card it sits in can stop
 * swiping between pages until the finger lifts; a quick sideways swipe still turns the page.
 */
export function LineChart(props: {
  series: readonly ChartSeries[];
  /** The amount at the top of the axis, and the amounts to draw lines at. */
  maxCents: number;
  ticks: readonly number[];
  /** Day numbers to label along the bottom (1 is the first day). */
  dayTicks: readonly number[];
  dayCount: number;
  /** What to write under a tick, when it isn't the day number ("Mar", "Nov 6"). */
  tickLabel?: (day: number) => string;
  height: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(width - AXIS_WIDTH, 0);
  const { height, maxCents, dayCount } = props;
  const xOf = (index: number) => (dayCount <= 1 ? 0 : (index / (dayCount - 1)) * plotWidth);
  const pick = (x: number) => props.onSelect(dayIndexAt(x, plotWidth, dayCount));
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbing = useRef(false);
  const { onSelect, onScrubbingChange } = props;
  const letGo = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    onSelect(null);
    if (scrubbing.current) onScrubbingChange?.(false);
    scrubbing.current = false;
  };
  // A finger still down when the chart goes away must not leave its card unable to swipe.
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
      if (scrubbing.current) onScrubbingChange?.(false);
    },
    [onScrubbingChange],
  );

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={props.accessibilityLabel}>
      <View style={{ height: height + LABEL_HEIGHT }} pointerEvents="none">
        {width > 0 ? (
          <>
            {props.ticks.map((tick) => {
              const y = height - (tick / maxCents) * height;
              return (
                <View key={tick}>
                  <View style={[styles.grid, { top: y, width: plotWidth, backgroundColor: theme.border }]} />
                  <Text style={[styles.axis, { top: y - 7, left: plotWidth + 6, color: theme.textSecondary }]}>
                    {axisAmount(tick)}
                  </Text>
                </View>
              );
            })}
            {props.dayTicks.map((day, i) => {
              const x = xOf(day - 1);
              const edge = i === 0 ? 'left' : i === props.dayTicks.length - 1 && day === dayCount ? 'right' : 'center';
              // Words need more room than a day number.
              const w = props.tickLabel ? 44 : 30;
              return (
                <Text
                  key={day}
                  numberOfLines={1}
                  style={[
                    styles.axis,
                    { width: w, top: height + 3, color: theme.textSecondary },
                    edge === 'left' ? { left: 0 } : edge === 'right' ? { left: x - w, textAlign: 'right' } : { left: x - w / 2, textAlign: 'center' },
                  ]}>
                  {props.tickLabel ? props.tickLabel(day) : day}
                </Text>
              );
            })}
            {props.series.map((line) =>
              linePoints(line.values, plotWidth, height, maxCents).map((run, r) => (
                <Line key={`${line.key}-${r}`} points={run} line={line} />
              )),
            )}
            {props.selected !== null ? (
              <>
                <View style={[styles.rule, { left: xOf(props.selected) - 0.5, height, backgroundColor: theme.textSecondary }]} />
                {props.series.map((line) => {
                  const value = line.values[props.selected!];
                  if (value === null || value === undefined) return null;
                  return (
                    <Dot
                      key={line.key}
                      at={{ x: xOf(props.selected!), y: height - (Math.max(value, 0) / maxCents) * height }}
                      size={8}
                      color={line.color}
                      ring={theme.backgroundElement}
                    />
                  );
                })}
              </>
            ) : null}
          </>
        ) : null}
      </View>
      <View
        style={[styles.touch, { width: plotWidth, height }]}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          pick(event.nativeEvent.locationX);
          hold.current = setTimeout(() => {
            hold.current = null;
            scrubbing.current = true;
            onScrubbingChange?.(true);
          }, HOLD_MS);
        }}
        onResponderMove={(event) => pick(event.nativeEvent.locationX)}
        onResponderRelease={letGo}
        onResponderTerminate={letGo}
        onResponderTerminationRequest={() => !scrubbing.current}
      />
    </View>
  );
}

function Line({ points, line }: { points: Point[]; line: ChartSeries }) {
  const segments = line.dashed ? dashedSegments(points, 4, 7) : solidSegments(points);
  const end = points[points.length - 1];
  return (
    <>
      {segments.map((segment, i) => (
        <Piece key={i} segment={segment} width={line.width} color={line.color} />
      ))}
      {line.endDot && end ? <Dot at={end} size={line.width * 3} color={line.color} /> : null}
    </>
  );
}

/** A piece of line, lengthened by its own width so its round ends meet the next piece's. */
function Piece({ segment, width, color }: { segment: Segment; width: number; color: string }) {
  const length = segment.length + width;
  return (
    <View
      style={{
        position: 'absolute',
        left: segment.cx - length / 2,
        top: segment.cy - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${segment.angle}rad` }],
      }}
    />
  );
}

function Dot({ at, size, color, ring }: { at: Point; size: number; color: string; ring?: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: at.x - size / 2,
        top: at.y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
      }}
    />
  );
}

const styles = StyleSheet.create({
  grid: { position: 'absolute', left: 0, height: StyleSheet.hairlineWidth },
  axis: { position: 'absolute', fontSize: 11, fontVariant: ['tabular-nums'] },
  rule: { position: 'absolute', top: 0, width: 1, opacity: 0.6 },
  touch: { position: 'absolute', left: 0, top: 0 },
});
