import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApiQuery } from '@/api/query';
import type { SavingsGoals } from '@/api/types';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { GOALS_PATH } from '@/utils/goals';

import { GoalProgress } from './progress';

/** How many goals Home lists; the rest are a tap away. */
const SHOWN = 3;

/** Home's Savings goals card: the first few, in the website's order. Shows nothing without goals, or with a server that has none to give. */
export function GoalsCard() {
  const theme = useTheme();
  const router = useRouter();
  const data = useApiQuery<SavingsGoals>(GOALS_PATH).data;
  if (!data || data.goals.length === 0) return null;
  const more = data.goals.length - SHOWN;
  return (
    <Section title="Savings goals">
      {data.goals.slice(0, SHOWN).map((goal) => (
        <View key={goal.id} style={styles.goal}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {goal.name}
          </Text>
          <GoalProgress goal={goal} />
        </View>
      ))}
      <Pressable onPress={() => router.push('/goals')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>{more > 0 ? `See all ${data.goals.length} goals` : 'See goals'}</Text>
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  goal: { gap: Spacing.one },
  name: { fontSize: 15, fontWeight: '600' },
  link: { fontSize: 15, fontWeight: '600' },
});
