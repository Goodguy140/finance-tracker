import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  privacySensitive,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type Widget, type WidgetEnvironment } from 'expo-widgets';
import { PlatformColor } from 'react-native';

import { SIGNED_OUT_BILLS } from './signed-out';

/** One bill or payday as the widget lists it, formatted by the app. */
export type BillsWidgetRow = { day: string; name: string; amount: string; income: boolean; overdue: boolean };

/**
 * What the Bills and pay widget shows, written by the app (`src/widgets/update.ts`) each time Home
 * loads: the same list as Home's "Next 7 days". `ready` is false until the app has loaded once,
 * and again after signing out. No value may be null (see `./signed-out.ts`).
 */
export type BillsWidgetProps = {
  ready: boolean;
  /** "Next 7 days". */
  title: string;
  rows: BillsWidgetRow[];
  /** "Nothing due in the next 7 days." */
  empty: string;
  /** "Bills $230.00 · Pay $1,500.00", or "". */
  totals: string;
  asOf: string;
};

const BillsWidget = (props: BillsWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
  const background = containerBackground(PlatformColor('systemBackground'), 'widget');
  const fill = frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' });
  const open = widgetURL('financetracker:///bills');

  if (!props.ready) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[fill, background, open]}>
        <Text modifiers={[font({ textStyle: 'headline' })]}>Bills and pay</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), secondary]}>Open Finances to see what is coming up.</Text>
      </VStack>
    );
  }

  const shown = props.rows.slice(0, environment.widgetFamily === 'systemLarge' ? 8 : 3);
  const more = props.rows.length - shown.length;
  return (
    <VStack alignment="leading" spacing={6} modifiers={[fill, background, open]}>
      <HStack>
        <Text modifiers={[font({ textStyle: 'headline' })]}>Bills and pay</Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption' }), secondary]}>{props.title}</Text>
      </HStack>
      {shown.length === 0 ? <Text modifiers={[font({ textStyle: 'footnote' }), secondary]}>{props.empty}</Text> : null}
      {shown.map((row, index) => (
        <HStack key={`${index}-${row.name}`} spacing={8}>
          <VStack alignment="leading" spacing={0}>
            <Text modifiers={[font({ textStyle: 'subheadline' }), lineLimit(1)]}>{row.name}</Text>
            <Text
              modifiers={[
                font({ textStyle: 'caption' }),
                row.overdue ? foregroundStyle(PlatformColor('systemOrange')) : secondary,
              ]}>
              {row.day}
            </Text>
          </VStack>
          <Spacer />
          <Text
            modifiers={[
              font({ textStyle: 'subheadline', weight: 'semibold' }),
              monospacedDigit(),
              row.income ? foregroundStyle(PlatformColor('systemGreen')) : secondary,
              privacySensitive(),
            ]}>
            {row.amount}
          </Text>
        </HStack>
      ))}
      <Spacer />
      <HStack>
        <Text modifiers={[font({ textStyle: 'caption2' }), secondary, privacySensitive()]}>
          {more > 0 ? `${more} more · ${props.totals}` : props.totals}
        </Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption2' }), secondary]}>{props.asOf}</Text>
      </HStack>
    </VStack>
  );
};

// Created when the app loads this file (see the note in ./safe-to-spend.tsx).
let widget: Widget<BillsWidgetProps> | null = null;
try {
  widget = createWidget<BillsWidgetProps>('BillsAndPay', BillsWidget, SIGNED_OUT_BILLS);
} catch {
  widget = null;
}

export default widget;
