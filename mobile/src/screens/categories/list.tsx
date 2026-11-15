import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { CategoryDetail } from '@/api/types';
import { ListRow } from '@/components/list-row';
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
          <Section list footer="A monthly amount for each spending category from the last 3 or 6 months, to tick and set in one go.">
            <ListRow label="Suggest Budgets" onPress={() => router.push('/budget-suggestions')} />
          </Section>
        ) : null}
        {categories
          ? categorySections(categories).map((section) => (
              <Section key={section.title} title={section.title} list>
                {section.items.map((c) => (
                  <ListRow
                    key={c.id}
                    label={c.name}
                    subtitle={`${usesLine(c.uses)}${c.spendingRole ? ` · ${c.spendingRole === 'need' ? 'Need' : 'Want'}` : ''}`}
                    onPress={() => router.push({ pathname: '/category-edit', params: { id: c.id } })}
                    accessibilityHint="Rename, group or delete it"
                  />
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
});
