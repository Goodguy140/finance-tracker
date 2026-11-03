import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RefreshControl, ScrollView } from 'react-native-gesture-handler';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { RecurringList, RecurringRule } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { SwipeListProvider, SwipeRow, useSwipeList } from '@/components/swipe-row';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, relativeDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import {
  groupRecurring,
  postRequest,
  RECURRING_PATH,
  recurringSubtitle,
  skipRequest,
  type RecurringRequest,
} from '@/utils/recurring';

type Done = { rule: RecurringRule; kind: 'post' | 'skip' | 'logged' };

const DONE_TEXT: Record<Done['kind'], (name: string) => string> = {
  post: (name) => `Posted ${name}.`,
  skip: (name) => `Skipped this ${name}.`,
  logged: (name) => `Moved ${name} on, linked to the one you logged if it was found.`,
};

/**
 * Every recurring bill, pay and transfer that is on, soonest first, as the website's Recurring card
 * offers them: post the occurrence that is waiting, skip it, or say it was already logged.
 */
export function Bills() {
  const theme = useTheme();
  const query = useApiQuery<RecurringList>(RECURRING_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const swipe = useSwipeList();
  const act = useApiMutation<RecurringRequest, unknown>('POST', (r) => r.path, (r) => r.body);
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(rule: RecurringRule, kind: Done['kind']) {
    setError(null);
    setNote(null);
    setWorking((ids) => new Set(ids).add(rule.id));
    try {
      await act.mutateAsync(kind === 'post' ? postRequest(rule) : skipRequest(rule, kind === 'logged' ? 'already_logged' : 'skip_once'));
      setNote(DONE_TEXT[kind](rule.name));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking((ids) => {
        const next = new Set(ids);
        next.delete(rule.id);
        return next;
      });
    }
  }

  function choose(rule: RecurringRule) {
    const amount = formatCents(rule.amountCents, rule.currency);
    Alert.alert(rule.name, `${amount}, ${dueText(rule, query.data?.today ?? rule.date).toLowerCase()}`, [
      { text: `Post ${amount} now`, onPress: () => void run(rule, 'post') },
      { text: 'Skip this one', onPress: () => void run(rule, 'skip') },
      { text: 'I already logged it', onPress: () => void run(rule, 'logged') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const data = query.data;
  const groups = data ? groupRecurring(data.rules, data.today) : [];

  return (
    <>
      <ScrollView
        {...swipe.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <SwipeListProvider value={swipe.value}>
          {note ? (
            <Text accessibilityLiveRegion="polite" style={[styles.note, { color: theme.positive }]}>
              {note}
            </Text>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={[styles.note, { color: theme.danger }]}>
              {error}
            </Text>
          ) : null}
          <LoadState loading={query.isPending} error={query.error ? errorText(query.error) : null} />
          {data && groups.length === 0 ? (
            <Section>
              <Text style={[styles.muted, { color: theme.textSecondary }]}>
                No recurring bills, pay or transfers are on. They are set up on the website, from the Recurring card.
              </Text>
            </Section>
          ) : null}
          {data
            ? groups.map((group) => (
                <View key={group.title} style={styles.group}>
                  <Text style={[styles.groupTitle, { color: theme.textSecondary }]} accessibilityRole="header">
                    {group.title}
                  </Text>
                  <View>
                    {group.rules.map((rule, index) => (
                      <BillRow
                        key={rule.id}
                        rule={rule}
                        today={data.today}
                        first={index === 0}
                        last={index === group.rules.length - 1}
                        working={working.has(rule.id)}
                        onPost={() => void run(rule, 'post')}
                        onSkip={() => void run(rule, 'skip')}
                        onPress={() => choose(rule)}
                      />
                    ))}
                  </View>
                </View>
              ))
            : null}
          {groups.length > 0 ? (
            <Text style={[styles.footer, { color: theme.textSecondary }]}>
              Swipe a row right to post it, or left to skip this one. Tap it to say you already logged it. Rules are
              added and changed on the website.
            </Text>
          ) : null}
        </SwipeListProvider>
      </ScrollView>
      <Stack.Title>Bills and pay</Stack.Title>
    </>
  );
}

/** "Overdue since Nov 1", "Today", "Tomorrow" or the day. */
function dueText(rule: RecurringRule, today: string): string {
  return rule.status === 'overdue' ? `Overdue since ${formatDay(rule.date)}` : relativeDay(rule.date, today);
}

function BillRow(props: {
  rule: RecurringRule;
  today: string;
  first: boolean;
  last: boolean;
  working: boolean;
  onPost: () => void;
  onSkip: () => void;
  onPress: () => void;
}) {
  const { rule, today, first, last, working } = props;
  const theme = useTheme();
  const income = rule.type === 'income';
  const amount = `${income ? '+' : ''}${formatCents(rule.amountCents, rule.currency)}`;
  const when = dueText(rule, today);
  const corners = {
    borderTopLeftRadius: first ? Radius : 0,
    borderTopRightRadius: first ? Radius : 0,
    borderBottomLeftRadius: last ? Radius : 0,
    borderBottomRightRadius: last ? Radius : 0,
  };
  return (
    <SwipeRow
      enabled={!working}
      style={corners}
      leading={{ label: 'Post', color: Colors.light.tint, onPress: props.onPost }}
      trailing={{ label: 'Skip', color: Colors.light.textSecondary, onPress: props.onSkip }}>
      <Pressable
        onPress={props.onPress}
        disabled={working}
        accessibilityRole="button"
        accessibilityLabel={[rule.name, amount, when, recurringSubtitle(rule), rule.autoPost ? 'posts itself' : null].filter(Boolean).join(', ')}
        accessibilityState={{ busy: working }}
        accessibilityActions={[
          { name: 'post', label: 'Post' },
          { name: 'skip', label: 'Skip' },
        ]}
        onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'post' ? props.onPost() : props.onSkip())}
        style={({ pressed }) => [
          styles.row,
          corners,
          {
            backgroundColor: pressed ? theme.track : theme.backgroundElement,
            borderColor: theme.border,
            borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
            opacity: working ? 0.5 : 1,
          },
        ]}>
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {rule.name}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {recurringSubtitle(rule)}
            {rule.autoPost ? ' · Posts itself' : ''}
          </Text>
        </View>
        <View style={styles.rowEnd}>
          <Text style={[styles.amount, { color: income ? theme.positive : theme.text }]}>{amount}</Text>
          <Text style={[styles.subtitle, { color: rule.status === 'overdue' ? theme.warning : theme.textSecondary }]} numberOfLines={1}>
            {when}
          </Text>
        </View>
      </Pressable>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  note: { fontSize: 15, lineHeight: 21, marginHorizontal: Spacing.one },
  muted: { fontSize: 15, lineHeight: 21 },
  group: { gap: Spacing.two },
  groupTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: Spacing.one },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 2, maxWidth: '45%' },
  name: { fontSize: 17 },
  subtitle: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
});
