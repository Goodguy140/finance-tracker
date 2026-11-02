import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** What a screen shows while its data is not there: a spinner, or why it failed. */
export function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  const theme = useTheme();
  if (error) {
    return (
      <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
        {error}
      </Text>
    );
  }
  return loading ? <ActivityIndicator style={styles.loading} /> : null;
}

const styles = StyleSheet.create({
  loading: { marginTop: Spacing.five },
  error: { fontSize: 15, lineHeight: 21 },
});
