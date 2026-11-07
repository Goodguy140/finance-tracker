import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { RuleSuggestions } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { RULE_SUGGESTIONS_PATH } from '@/utils/transaction-rules';

/**
 * Settings → Rules' learned combos on the phone: each expense title's latest category, for the
 * titles no rule covers yet. One opens a rule sheet filled in from it; Hide stops suggesting it.
 */
export function RuleSuggestionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<RuleSuggestions>(RULE_SUGGESTIONS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const hide = useApiMutation<string, { ok: true }>('POST', () => `${RULE_SUGGESTIONS_PATH}/hide`, (title) => ({ title }));
  const [error, setError] = useState<string | null>(null);
  const data = query.data;

  function confirmHide(title: string) {
    Alert.alert(`Hide “${title}”?`, 'It is no longer suggested here, and Add stops filling in its category from your past entries.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide',
        style: 'destructive',
        onPress: () => {
          setError(null);
          hide.mutate(title, { onError: (err) => setError(errorText(err)) });
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={[styles.intro, { color: theme.textSecondary }]}>
          Titles you have filed in a category that no rule covers yet. A rule keeps them filed that way, and catches bank rows and
          imports with the title too.
        </Text>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {error ? (
          <Text accessibilityRole="alert" style={[styles.intro, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        {data ? (
          <Section
            footer={
              data.total > data.suggestions.length ? `The ${data.suggestions.length} most recent of ${data.total}.` : null
            }>
            {data.suggestions.length === 0 ? (
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                Nothing to suggest: every title you use is covered by a rule, or hidden.
              </Text>
            ) : (
              data.suggestions.map((s) => (
                <View key={s.title} style={styles.row}>
                  <Pressable
                    style={({ pressed }) => [styles.grow, { opacity: pressed ? 0.6 : 1 }]}
                    onPress={() =>
                      router.push({
                        pathname: '/transaction-rule',
                        params: { title: s.title, type: 'expense', categoryId: s.categoryId, match: 'is' },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${s.title}, filed as ${s.categoryName}`}
                    accessibilityHint="Makes a rule from it">
                    <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>
                      → {s.categoryName}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmHide(s.title)}
                    disabled={hide.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`Hide ${s.title}`}
                    hitSlop={8}>
                    <Text style={[styles.body, { color: theme.tint }]}>Hide</Text>
                  </Pressable>
                </View>
              ))
            )}
          </Section>
        ) : null}
      </ScrollView>
      <Stack.Title>Suggested Rules</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
});
