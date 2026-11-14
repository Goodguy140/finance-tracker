import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { CategoryDetail } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_DETAILS_PATH, categorySections, usesLine } from '@/utils/category-edits';

/**
 * Settings → Categories on the phone: spending under its groups, then income. One opens its sheet
 * to rename it (into another's name merges the two), file it under a group, mark it a need or a
 * want, or delete it; + adds one. Budgets are set from the Budgets tab, or all at once with
 * Suggest Budgets.
 */
export function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<{ categories: CategoryDetail[] }>(CATEGORY_DETAILS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const categories = query.data?.categories;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !categories ? errorText(query.error) : null} />
        {categories ? (
          <Section footer="A monthly amount for each spending category from the last 3 or 6 months, to tick and set in one go.">
            <Pressable onPress={() => router.push('/budget-suggestions')} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>Suggest budgets ›</Text>
            </Pressable>
          </Section>
        ) : null}
        {categories
          ? categorySections(categories).map((section) => (
              <Section key={section.title} title={section.title}>
                {section.items.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push({ pathname: '/category-edit', params: { id: c.id } })}
                    accessibilityRole="button"
                    accessibilityHint="Rename, group or delete it"
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                    <View style={styles.grow}>
                      <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={[styles.small, { color: theme.textSecondary }]}>
                        {usesLine(c.uses)}
                        {c.spendingRole ? ` · ${c.spendingRole === 'need' ? 'Need' : 'Want'}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.body, { color: theme.textSecondary }]}>›</Text>
                  </Pressable>
                ))}
              </Section>
            ))
          : null}
      </ScrollView>
      <Stack.Title>Categories</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New category" onPress={() => router.push('/category-edit')} />
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  body: { fontSize: 17, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
