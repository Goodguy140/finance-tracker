import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** One row of a form: the label on the left, the control on the right, and a note under both. */
export function FormField({ label, note, children }: { label: string; note?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <View style={styles.control}>{children}</View>
      </View>
      {note ? <Text style={[styles.note, { color: theme.textSecondary }]}>{note}</Text> : null}
    </View>
  );
}

/** A full-width button under a form. */
export function FormButton({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color: destructive ? theme.danger : theme.tint }]}>{label}</Text>
    </Pressable>
  );
}

/** Text inputs and values inside a `FormField`. */
export const formStyles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  error: { fontSize: 15, lineHeight: 21 },
  input: { fontSize: 17, textAlign: 'right', minWidth: 160, paddingVertical: 4 },
  amount: { fontVariant: ['tabular-nums'] },
  value: { fontSize: 17 },
  note: { fontSize: 17, minHeight: 60, textAlignVertical: 'top' },
});

const styles = StyleSheet.create({
  fieldWrap: { gap: Spacing.one },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, minHeight: 32 },
  label: { fontSize: 17 },
  control: { flexShrink: 1, alignItems: 'flex-end' },
  note: { fontSize: 13, lineHeight: 18 },
  button: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 17, fontWeight: '600' },
});
