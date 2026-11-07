import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RefreshControl, ScrollView } from 'react-native-gesture-handler';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Plan, PlanList, RecurringList, RecurringRule } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { SwipeListProvider, SwipeRow, useSwipeList } from '@/components/swipe-row';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, relativeDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { groupPlans, planPath, PLANS_PATH } from '@/utils/plans';
import { canEditRules } from '@/utils/recurring-rules';
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
 * offers them: post the occurrence that is waiting, skip it, or say it was already logged. Below
 * them, the one-off plans from the website's Plan tab, and first of all any whose day has passed.
 */
export function Bills() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<RecurringList>(RECURRING_PATH);
  // An older server answers 404: the plans and the + stay away.
  const plans = useApiQuery<PlanList>(PLANS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(async () => {
    await Promise.all([query.refetch(), plans.refetch()]);
  });
  const swipe = useSwipeList();
  const act = useApiMutation<RecurringRequest, unknown>('POST', (r) => r.path, (r) => r.body);
  const recordPlan = useApiMutation<Plan, { transactionId: string }>('POST', (p) => planPath(p.id, 'record'), () => ({}));
  const removePlan = useApiMutation<Plan, unknown>('DELETE', (p) => planPath(p.id));
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function settle(plan: Plan, happened: boolean) {
    setError(null);
    setNote(null);
    setWorking((ids) => new Set(ids).add(plan.id));
    try {
      if (happened) await recordPlan.mutateAsync(plan);
      else await removePlan.mutateAsync(plan);
      setNote(happened ? `Added ${plan.name} to your log.` : `Removed the plan for ${plan.name}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking((ids) => {
        const next = new Set(ids);
        next.delete(plan.id);
        return next;
      });
    }
  }

  function editPlan(plan: Plan) {
    router.push({ pathname: '/plan', params: { id: plan.id } });
  }

  /** The website's "Did this happen?": add it to the log as planned, or drop it. */
  function askPlan(plan: Plan) {
    const amount = formatCents(plan.amountCents, plan.currency);
    Alert.alert(`Did ${plan.name} happen?`, `${amount}, planned for ${formatDay(plan.date)} on ${plan.accountName}.`, [
      { text: `Yes, add ${amount} to my log`, onPress: () => void settle(plan, true) },
      { text: 'No, remove the plan', style: 'destructive', onPress: () => void settle(plan, false) },
      { text: 'Change the plan', onPress: () => editPlan(plan) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

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

  function editRule(rule: RecurringRule) {
    router.push({ pathname: '/recurring-rule', params: { id: rule.id } });
  }

  function choose(rule: RecurringRule) {
    const amount = formatCents(rule.amountCents, rule.currency);
    Alert.alert(rule.name, `${amount}, ${dueText(rule, query.data?.today ?? rule.date).toLowerCase()}`, [
      { text: `Post ${amount} now`, onPress: () => void run(rule, 'post') },
      { text: 'Skip this one', onPress: () => void run(rule, 'skip') },
      { text: 'I already logged it', onPress: () => void run(rule, 'logged') },
      ...(editable ? [{ text: 'Change, pause or delete the rule', onPress: () => editRule(rule) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  const data = query.data;
  const editable = data ? canEditRules(data) : false;
  const groups = data ? groupRecurring(data.rules, data.today) : [];
  const paused = data?.paused ?? [];
  const planGroups = plans.data ? groupPlans(plans.data.plans) : [];
  const pastDue = planGroups.find((g) => g.plans[0]?.pastDue);
  const upcoming = planGroups.find((g) => !g.plans[0]?.pastDue);
  const planSection = (group: { title: string; plans: Plan[] } | undefined) =>
    group ? (
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: theme.textSecondary }]} accessibilityRole="header">
          {group.title}
        </Text>
        <View>
          {group.plans.map((plan, index) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              today={plans.data?.today ?? plan.date}
              first={index === 0}
              last={index === group.plans.length - 1}
              working={working.has(plan.id)}
              onPress={() => (plan.pastDue ? askPlan(plan) : editPlan(plan))}
            />
          ))}
        </View>
      </View>
    ) : null;

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
          {planSection(pastDue)}
          {data && groups.length === 0 ? (
            <Section>
              <Text style={[styles.muted, { color: theme.textSecondary }]}>
                {editable
                  ? 'No recurring bills, pay or transfers are on. Tap + to add your rent, pay or a subscription.'
                  : 'No recurring bills, pay or transfers are on. They are set up on the website, from the Recurring card.'}
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
              Swipe a row right to post it, or left to skip this one. Tap it to say you already logged it
              {editable ? ', or to change, pause or delete the rule.' : '. Rules are added and changed on the website.'}
            </Text>
          ) : null}
          {paused.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.groupTitle, { color: theme.textSecondary }]} accessibilityRole="header">
                Paused
              </Text>
              <View>
                {paused.map((rule, index) => (
                  <PausedRow
                    key={rule.id}
                    rule={rule}
                    first={index === 0}
                    last={index === paused.length - 1}
                    onPress={() => editRule(rule)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {planSection(upcoming)}
          {plans.data ? (
            <Text style={[styles.footer, { color: theme.textSecondary }]}>
              A plan is a one-off you expect, like a tax refund or a car repair. It counts in Safe to spend and your
              forecasts until an entry like it lands in your log. Tap + to add one.
            </Text>
          ) : null}
        </SwipeListProvider>
      </ScrollView>
      <Stack.Title>Bills and pay</Stack.Title>
      {editable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Add">
            <Stack.Toolbar.MenuAction icon="repeat" onPress={() => router.push('/recurring-rule')}>
              Recurring bill, pay or transfer
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="calendar.badge.plus" hidden={!plans.data} onPress={() => router.push('/plan')}>
              One-off plan
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : plans.data ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a plan" onPress={() => router.push('/plan')} />
        </Stack.Toolbar>
      ) : null}
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

function PlanRow(props: { plan: Plan; today: string; first: boolean; last: boolean; working: boolean; onPress: () => void }) {
  const { plan, today, first, last, working } = props;
  const theme = useTheme();
  const income = plan.type === 'income';
  const amount = `${income ? '+' : ''}${formatCents(plan.amountCents, plan.currency)}`;
  const when = relativeDay(plan.date, today);
  const corners = {
    borderTopLeftRadius: first ? Radius : 0,
    borderTopRightRadius: first ? Radius : 0,
    borderBottomLeftRadius: last ? Radius : 0,
    borderBottomRightRadius: last ? Radius : 0,
  };
  const subtitle = [plan.categoryName, plan.accountName].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={props.onPress}
      disabled={working}
      accessibilityRole="button"
      accessibilityLabel={[plan.name, amount, when, subtitle].join(', ')}
      accessibilityHint={plan.pastDue ? 'Asks whether it happened' : 'Opens the plan'}
      accessibilityState={{ busy: working }}
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
          {plan.name}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.amount, { color: income ? theme.positive : theme.text }]}>{amount}</Text>
        <Text style={[styles.subtitle, { color: plan.pastDue ? theme.warning : theme.textSecondary }]} numberOfLines={1}>
          {when}
        </Text>
      </View>
    </Pressable>
  );
}

/** A rule that is turned off: tapped, it opens to be turned back on, changed or deleted. */
function PausedRow(props: { rule: RecurringRule; first: boolean; last: boolean; onPress: () => void }) {
  const { rule, first, last } = props;
  const theme = useTheme();
  const amount = `${rule.type === 'income' ? '+' : ''}${formatCents(rule.amountCents, rule.currency)}`;
  const state = rule.cancelledAt ? `Cancelled ${formatDay(rule.cancelledAt)}` : 'Paused';
  const corners = {
    borderTopLeftRadius: first ? Radius : 0,
    borderTopRightRadius: first ? Radius : 0,
    borderBottomLeftRadius: last ? Radius : 0,
    borderBottomRightRadius: last ? Radius : 0,
  };
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={[rule.name, amount, state, recurringSubtitle(rule)].join(', ')}
      accessibilityHint="Opens the rule"
      style={({ pressed }) => [
        styles.row,
        corners,
        {
          backgroundColor: pressed ? theme.track : theme.backgroundElement,
          borderColor: theme.border,
          borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
        },
      ]}>
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: theme.textSecondary }]} numberOfLines={1}>
          {rule.name}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {recurringSubtitle(rule)}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.amount, { color: theme.textSecondary }]}>{amount}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {state}
        </Text>
      </View>
    </Pressable>
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
