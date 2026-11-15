import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * What tapping a row does, which decides how it looks, as in iOS Settings:
 * - `navigate` opens another screen: a plain label and a grey chevron.
 * - `external` leaves the app (Safari, iOS Settings): a plain label and a grey arrow.
 * - `action` does something right here: a tinted label, nothing after it.
 * - `destructive` signs out or deletes: a red label, centred, nothing after it.
 */
export type ListRowKind = 'navigate' | 'external' | 'action' | 'destructive';

type Props = {
  label: string;
  /** A second, smaller line under the label. */
  subtitle?: string | null;
  /** Grey text at the right, before the chevron: the current setting, a count. */
  value?: string | null;
  /** Something before the label, such as a rule's number. */
  leading?: ReactNode;
  kind?: ListRowKind;
  /** Without one, the row only shows its label and value. */
  onPress?: () => void;
  disabled?: boolean;
  /** Drawn faded, for something that is switched off. */
  faded?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/**
 * One row of a grouped list (`<Section list>`): at least 44 points tall, filling the card's width
 * so the highlight when it is pressed reaches both edges.
 */
export function ListRow({
  label,
  subtitle,
  value,
  leading,
  kind = 'navigate',
  onPress,
  disabled,
  faded,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const theme = useTheme();
  const labelColor = kind === 'action' ? theme.tint : kind === 'destructive' ? theme.danger : theme.text;
  const trailing = !onPress ? null : kind === 'navigate' ? 'chevron.right' : kind === 'external' ? 'arrow.up.right' : null;

  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <Text style={[styles.label, kind === 'destructive' && styles.centred, { color: labelColor }]}>{label}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: theme.textSecondary }]} numberOfLines={1} ellipsizeMode="middle" selectable={!onPress}>
          {value}
        </Text>
      ) : null}
      {trailing ? (
        <SymbolView
          name={trailing}
          size={trailing === 'chevron.right' ? 14 : 13}
          weight="semibold"
          tintColor={theme.textTertiary}
          style={styles.symbol}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, faded && styles.faded]}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind === 'external' ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint ?? (kind === 'external' ? 'Opens outside the app' : undefined)}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.border },
        (faded || disabled) && styles.faded,
      ]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: Spacing.three,
  },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 17, lineHeight: 22 },
  centred: { textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 18 },
  value: { fontSize: 17, lineHeight: 22, flexShrink: 1, maxWidth: '60%' },
  symbol: { width: 14, height: 14 },
  faded: { opacity: 0.5 },
});
