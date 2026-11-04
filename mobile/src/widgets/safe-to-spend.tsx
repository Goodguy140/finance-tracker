import { Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  privacySensitive,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import { PlatformColor } from 'react-native';

/**
 * What the Safe to spend widget shows, written by the app (`src/widgets/update.ts`) each time Home
 * loads. Every string comes formatted: the widget runs in its own small runtime and can't format
 * money. `amount` is null until the app has loaded once, and again after signing out.
 */
export type SafeToSpendWidgetProps = {
  amount: string | null;
  negative: boolean;
  /** "About $45.00 a day for 12 days." */
  perDay: string;
  /** "As of 3:40 PM". */
  asOf: string;
};

// The widget's body is compiled on its own: everything it uses must be inside it or imported from
// @expo/ui, expo-widgets or react-native (see the 'widget' directive in the expo-widgets docs).
const SafeToSpendWidget = (props: SafeToSpendWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
  const open = widgetURL('financetracker:///');
  const family = environment.widgetFamily;
  const lockScreen = family === 'accessoryRectangular' || family === 'accessoryInline';
  const background = containerBackground(PlatformColor(lockScreen ? 'clearColor' : 'systemBackground'), 'widget');
  const fill = frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' });

  if (props.amount === null) {
    if (family === 'accessoryInline') return <Text modifiers={[open]}>Safe to spend: open Finances</Text>;
    return (
      <VStack alignment="leading" spacing={4} modifiers={[fill, background, open]}>
        <Text modifiers={[font({ textStyle: 'headline' })]}>Safe to spend</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), secondary]}>Open Finances to see it here.</Text>
      </VStack>
    );
  }

  if (family === 'accessoryInline') {
    return <Text modifiers={[open, privacySensitive()]}>{`Safe to spend ${props.amount}`}</Text>;
  }

  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={0} modifiers={[fill, background, open]}>
        <Text modifiers={[font({ textStyle: 'headline' })]}>Safe to spend</Text>
        <Text modifiers={[font({ textStyle: 'title3', weight: 'bold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), privacySensitive()]}>
          {props.amount}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption' }), lineLimit(1), privacySensitive()]}>{props.perDay}</Text>
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={4} modifiers={[fill, background, open]}>
      <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), secondary]}>Safe to spend</Text>
      <Text
        modifiers={[
          font({ size: 30, weight: 'bold' }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.5),
          foregroundStyle(PlatformColor(props.negative ? 'systemRed' : 'systemGreen')),
          privacySensitive(),
        ]}>
        {props.amount}
      </Text>
      <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(3), privacySensitive()]}>{props.perDay}</Text>
      <Spacer />
      <Text modifiers={[font({ textStyle: 'caption2' }), secondary]}>{props.asOf}</Text>
    </VStack>
  );
};

export default createWidget<SafeToSpendWidgetProps>('SafeToSpend', SafeToSpendWidget, {
  amount: null,
  negative: false,
  perDay: '',
  asOf: '',
});
