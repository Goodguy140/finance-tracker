import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { RuleList } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { RULE_LIST_PATH } from '@/utils/rule-edits';

/**
 * Settings → Rules' list on the phone: every rule in the order they run, described as the website
 * describes it. One opens its sheet to change, turn off, move or delete it.
 */
export function RuleListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<RuleList>(RULE_LIST_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={[styles.intro, { color: theme.textSecondary }]}>
          Rules run top to bottom. Each field is filled by the first matching rule that sets it, except tags: every matching rule
          adds its tag. Rules never change an amount your bank or statement reports.
        </Text>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data ? (
          <Section footer={data.rules.length > 0 ? `${data.rules.length} of up to ${data.max} rules.` : null}>
            {data.rules.length === 0 ? (
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                No rules yet. Make one with + or from Suggested Rules, or from an entry with Make a Rule….
              </Text>
            ) : (
              data.rules.map((rule) => (
                <Pressable
                  key={rule.id}
                  onPress={() => router.push({ pathname: '/transaction-rule', params: { id: rule.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Rule ${rule.position}${rule.enabled ? '' : ', off'}: ${rule.condition}. ${rule.actions}`}
                  accessibilityHint="Change, turn off, move or delete it"
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : rule.enabled ? 1 : 0.55 }]}>
                  <Text style={[styles.number, { color: theme.textSecondary }]}>{rule.position}.</Text>
                  <View style={styles.grow}>
                    <Text style={[styles.body, { color: theme.text }]}>{rule.condition}</Text>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      {rule.enabled ? rule.actions : `Off · ${rule.actions}`}
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>›</Text>
                </Pressable>
              ))
            )}
          </Section>
        ) : null}
        <Pressable onPress={() => router.push('/settings/rules')} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.body, styles.link, { color: theme.tint }]}>Suggested rules ›</Text>
        </Pressable>
      </ScrollView>
      <Stack.Title>Rules</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New rule" onPress={() => router.push('/transaction-rule')} />
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  intro: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  link: { marginHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  number: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 22 },
  grow: { flex: 1 },
});
