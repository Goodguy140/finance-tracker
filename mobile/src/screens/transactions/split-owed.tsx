import { Host, Picker } from '@expo/ui';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Category } from '@/api/types';
import { formStyles } from '@/components/form';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { lineKey, ownPartNote, splitRemainderNote, type OwedLine, type SplitLine } from '@/utils/split-owed';

const NO_CATEGORY = '';

/**
 * An expense's split lines, as the website's edit dialog shows them: a category and an amount
 * each, adding up to the total. The total follows the lines.
 */
export function SplitSection({
  lines,
  onChange,
  categories,
  totalCents,
  currency,
  onRemoveSplit,
}: {
  lines: SplitLine[];
  onChange: (lines: SplitLine[]) => void;
  categories: Category[];
  /** What the lines must add up to when the total can't move (credits); null when it follows them. */
  totalCents: number | null;
  currency: string;
  onRemoveSplit: () => void;
}) {
  const theme = useTheme();
  const update = (key: string, patch: Partial<SplitLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remainder = totalCents === null ? null : splitRemainderNote(totalCents, lines, currency);

  return (
    <Section title="Split across categories" footer={remainder ?? 'Each line counts toward its own category and budget.'}>
      {lines.map((line, i) => (
        <View key={line.key} style={styles.line}>
          <View style={styles.grow}>
            <Host matchContents>
              <Picker selectedValue={line.categoryId || NO_CATEGORY} onValueChange={(v) => update(line.key, { categoryId: String(v) })}>
                {line.categoryId ? null : <Picker.Item label="Pick a category" value={NO_CATEGORY} />}
                {categories.map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </Host>
          </View>
          <TextInput
            value={line.amount}
            onChangeText={(amount) => update(line.key, { amount })}
            placeholder="0.00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            style={[styles.amount, { color: theme.text }]}
            accessibilityLabel={`Amount for line ${i + 1}`}
          />
          {lines.length > 2 ? (
            <Pressable
              onPress={() => onChange(lines.filter((l) => l.key !== line.key))}
              accessibilityRole="button"
              accessibilityLabel={`Remove line ${i + 1}`}
              hitSlop={8}>
              <Text style={[styles.remove, { color: theme.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <View style={styles.actions}>
        <Pressable
          onPress={() => onChange([...lines, { key: lineKey(), categoryId: '', amount: '' }])}
          accessibilityRole="button"
          hitSlop={8}>
          <Text style={[styles.link, { color: theme.tint }]}>Add a line</Text>
        </Pressable>
        <Pressable onPress={onRemoveSplit} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.link, { color: theme.tint }]}>Remove the split</Text>
        </Pressable>
      </View>
    </Section>
  );
}

/**
 * Who owes part of an expense back, as the website's edit dialog lists them: a name and an amount
 * each. Their shares come out of what was paid, so only the person's own part counts as spending.
 */
export function OwedSection({
  lines,
  onChange,
  paidCents,
  currency,
}: {
  lines: OwedLine[];
  onChange: (lines: OwedLine[]) => void;
  paidCents: number | null;
  currency: string;
}) {
  const theme = useTheme();
  const update = (key: string, patch: Partial<OwedLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Section title="Owed to you" footer={ownPartNote(paidCents, lines, currency) ?? 'Mark each one paid back from Owed to you once the money comes in.'}>
      {lines.map((line, i) => (
        <View key={line.key} style={styles.stack}>
          <View style={styles.line}>
            <TextInput
              value={line.name}
              onChangeText={(name) => update(line.key, { name })}
              placeholder="Who"
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.value, styles.grow, { color: theme.text }]}
              maxLength={80}
              accessibilityLabel={`Who owes amount ${i + 1}`}
            />
            <TextInput
              value={line.amount}
              onChangeText={(amount) => update(line.key, { amount })}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numbers-and-punctuation"
              style={[styles.amount, { color: theme.text }]}
              accessibilityLabel={`Amount owed by ${line.name || `person ${i + 1}`}`}
            />
            <Pressable
              onPress={() => onChange(lines.filter((l) => l.key !== line.key))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${line.name || `person ${i + 1}`}`}
              hitSlop={8}>
              <Text style={[styles.remove, { color: theme.danger }]}>Remove</Text>
            </Pressable>
          </View>
          {line.paid ? <Text style={[styles.note, { color: theme.textSecondary }]}>Paid back</Text> : null}
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...lines, { key: lineKey(), id: null, name: '', amount: '', paid: false }])}
        accessibilityRole="button"
        hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>{lines.length === 0 ? 'Someone owes you part of this' : 'Add someone else'}</Text>
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stack: { gap: 2 },
  grow: { flex: 1 },
  amount: { fontSize: 17, textAlign: 'right', minWidth: 90, fontVariant: ['tabular-nums'], paddingVertical: 4 },
  remove: { fontSize: 15 },
  link: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
});
