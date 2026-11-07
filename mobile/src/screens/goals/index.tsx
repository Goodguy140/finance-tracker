import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText, useApiQuery } from '@/api/query';
import type { Me, SavingsGoals } from '@/api/types';
import { FormButton } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { canEditGoals, GOALS_PATH, goalSubtitle } from '@/utils/goals';

import { GoalProgress } from './progress';

/** Every savings goal with what it needs a month and when it would be reached; each opens its sheet. */
export function GoalsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<SavingsGoals>(GOALS_PATH);
  const editable = canEditGoals(useApiQuery<Me>('/api/v1/me').data);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const data = query.data;
  const add = () => router.push('/goal');

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {data && data.goals.length === 0 ? (
          <Section>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              No savings goals yet. A goal can follow a savings account&apos;s balance, or be tracked by hand.
            </Text>
          </Section>
        ) : null}
        {data?.goals.map((goal) => (
          <Pressable
            key={goal.id}
            disabled={!editable}
            onPress={() => router.push({ pathname: '/goal', params: { id: goal.id } })}
            accessibilityRole={editable ? 'button' : undefined}
            accessibilityHint={editable ? 'Changes the goal' : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Section>
              <View style={styles.head}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {goal.name}
                </Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>{goalSubtitle(goal)}</Text>
              </View>
              <GoalProgress goal={goal} />
            </Section>
          </Pressable>
        ))}
        {data && editable ? <FormButton label="Add a Goal" onPress={add} /> : null}
      </ScrollView>
      <Stack.Title>Savings goals</Stack.Title>
      {editable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a goal" onPress={add} />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  head: { gap: 2 },
  name: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
});
