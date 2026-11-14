import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FormButton, FormField } from '@/components/form';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, ymdFromDate } from '@/utils/dates';

export type DayRange = { from: string; to: string };

/**
 * The website's custom date range: a first and a last day, both included, and a button that shows
 * them. Starts from `initial`; nothing changes on screen until the button is pressed. `inline`
 * leaves out the section around it, for a card that already is one.
 */
export function RangePicker({ initial, onShow, inline }: { initial: DayRange; onShow: (range: DayRange) => void; inline?: boolean }) {
  const scheme = useColorScheme();
  const theme = useTheme();
  const [range, setRange] = useState<DayRange>(initial);
  const themeVariant = scheme === 'dark' ? 'dark' : 'light';
  const wrap = (children: ReactNode) =>
    inline ? (
      <View style={styles.inline}>
        {children}
        <Text style={[styles.note, { color: theme.textSecondary }]}>Both days are included.</Text>
      </View>
    ) : (
      <Section title="Custom range" footer="Both days are included.">
        {children}
      </Section>
    );
  return wrap(
    <>
      <FormField label="From">
        <DateTimePicker
          value={dateFromYmd(range.from)}
          onValueChange={(_, d) => setRange((r) => ({ ...r, from: ymdFromDate(d) }))}
          display="compact"
          timeZoneName="UTC"
          themeVariant={themeVariant}
        />
      </FormField>
      <FormField label="To">
        <DateTimePicker
          value={dateFromYmd(range.to)}
          onValueChange={(_, d) => setRange((r) => ({ ...r, to: ymdFromDate(d) }))}
          display="compact"
          timeZoneName="UTC"
          themeVariant={themeVariant}
        />
      </FormField>
      <FormButton label="Show This Range" disabled={range.from > range.to} onPress={() => onShow(range)} />
    </>,
  );
}

const styles = StyleSheet.create({
  inline: { gap: Spacing.two },
  note: { fontSize: 13, lineHeight: 18 },
});
