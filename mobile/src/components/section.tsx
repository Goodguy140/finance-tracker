import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ListRow } from './list-row';

/**
 * A titled card, as iOS groups a list: small caps title above, an optional note below.
 *
 * With `list`, the card is a grouped list like iOS Settings: each child is a row, with a hairline
 * between rows. A `ListRow` fills the row itself; anything else (a switch in a `FormField`, a line of
 * text) is padded to match.
 */
export function Section({
  title,
  footer,
  list,
  children,
}: {
  title?: string | null;
  footer?: string | null;
  list?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const rows = list ? Children.toArray(children) : null;
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.title, { color: theme.textSecondary }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View
        style={[
          rows ? styles.list : styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        {rows
          ? rows.map((row, i) => (
              <View key={isValidElement(row) && row.key != null ? row.key : i}>
                {i > 0 ? <View style={[styles.separator, { backgroundColor: theme.border }]} /> : null}
                {isValidElement(row) && row.type === ListRow ? row : <View style={styles.cell}>{row}</View>}
              </View>
            ))
          : children}
      </View>
      {footer ? <Text style={[styles.footer, { color: theme.textSecondary }]}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  title: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: Spacing.one },
  card: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.three },
  list: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cell: { minHeight: 44, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: Spacing.three, gap: Spacing.two },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
});
