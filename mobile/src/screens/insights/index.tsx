import { useRouter, type Href } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { FinancialScore, Insight, InsightList } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import {
  groupInsights,
  hiddenText,
  hideOptions,
  INSIGHTS_PATH,
  phoneRouteFor,
  potentialSavingCents,
  SCORE_PATH,
  trackedHabitText,
  websiteUrl,
  type HideOption,
} from '@/utils/insights';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

import { ScoreCard } from './score-card';

const SEVERITY = {
  high: { label: 'Worth a look soon', tone: 'warning' },
  medium: { label: 'Worth a look', tone: 'tint' },
  low: { label: 'For your information', tone: 'textSecondary' },
} as const;

/**
 * The website's Insights page: the financial score, then what the server noticed in the last year
 * of transactions, under the same sections. Insights can be snoozed, dismissed and put back here.
 * "Track it" opens the recurring rule sheet filled in, "Track separately" files a habit under its
 * own category, and a link opens the phone's own screen for it when there is one, else the website.
 */
export function Insights() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const score = useApiQuery<FinancialScore>(SCORE_PATH);
  const list = useApiQuery<InsightList>(INSIGHTS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(() => Promise.all([score.refetch(), list.refetch()]));
  const hide = useApiMutation<{ key: string; mode: HideOption['mode'] }, unknown>(
    'POST',
    () => `${INSIGHTS_PATH}/dismiss`,
    (body) => body,
  );
  const restore = useApiMutation<{ key: string }, unknown>('POST', () => `${INSIGHTS_PATH}/restore`, (body) => body);
  const trackHabit = useApiMutation<{ habit: string }, { categoryName: string; rulesAdded: number }>(
    'POST',
    () => `${INSIGHTS_PATH}/track-habit`,
    (body) => body,
  );
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  async function run(key: string, act: () => Promise<unknown>) {
    setError(null);
    setWorking((keys) => new Set(keys).add(key));
    try {
      await act();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking((keys) => {
        const next = new Set(keys);
        next.delete(key);
        return next;
      });
    }
  }

  const data = list.data;
  const groups = data ? groupInsights(data.insights) : [];
  const saving = data ? potentialSavingCents(data.insights) : 0;
  const open = (path: string) => {
    const route = phoneRouteFor(path);
    if (route) return router.push(route as Href);
    const url = websiteUrl(session?.origin, path);
    if (url) void Linking.openURL(url);
  };
  const act = (insight: Insight) => {
    const track = insight.track;
    if (track?.kind === 'recurring') {
      router.push({ pathname: '/recurring-rule', params: { prefill: JSON.stringify(track.prefill) } });
    } else if (track?.kind === 'habit') {
      if (track.trackedCategoryId) router.push({ pathname: '/budget', params: { categoryId: track.trackedCategoryId } });
      else void run(insight.key, () => trackHabit.mutateAsync({ habit: track.habit }));
    }
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {score.data ? <ScoreCard score={score.data} /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <LoadState
          loading={list.isPending || score.isPending}
          error={list.error ? errorText(list.error) : score.error ? errorText(score.error) : null}
        />
        {data && saving > 0 ? (
          <Text style={[styles.body, { color: theme.text }]}>
            The ideas below could save about {formatCents(saving, data.currency)} a year.
          </Text>
        ) : null}
        {data && groups.length === 0 ? (
          <Section>
            <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing to flag right now.</Text>
          </Section>
        ) : null}
        {data
          ? groups.map((group) => (
              <Section key={group.id} title={`${group.title} · ${group.insights.length}`}>
                {group.insights.map((insight, index) => (
                  <InsightItem
                    key={insight.key}
                    insight={insight}
                    currency={data.currency}
                    first={index === 0}
                    working={working.has(insight.key)}
                    options={hideOptions(insight, data.snoozeDays)}
                    onHide={(mode) => void run(insight.key, () => hide.mutateAsync({ key: insight.key, mode }))}
                    onOpen={open}
                    onTrack={() => act(insight)}
                  />
                ))}
              </Section>
            ))
          : null}
        {data && data.hidden.length > 0 ? (
          <View style={styles.hidden}>
            <Pressable
              onPress={() => setShowHidden((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showHidden }}
              hitSlop={8}>
              <Text style={[styles.link, { color: theme.tint }]}>
                {showHidden ? 'Hide' : 'Show'} {data.hidden.length} dismissed or snoozed
              </Text>
            </Pressable>
            {showHidden ? (
              <Section>
                {data.hidden.map((insight, index) => (
                  <View
                    key={insight.key}
                    style={[styles.item, index > 0 && [styles.divided, { borderTopColor: theme.border }]]}>
                    <Text style={[styles.title, { color: theme.text }]}>{insight.title}</Text>
                    <View style={styles.actions}>
                      <Text style={[styles.small, { color: theme.textSecondary }]}>{hiddenText(insight)}</Text>
                      <ActionLink
                        label="Restore"
                        disabled={working.has(insight.key)}
                        onPress={() => void run(insight.key, () => restore.mutateAsync({ key: insight.key }))}
                      />
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}
          </View>
        ) : null}
        {data ? (
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            Worked out from your last year of transactions, on your server.
          </Text>
        ) : null}
      </ScrollView>
      <Stack.Title>Insights</Stack.Title>
    </>
  );
}

function InsightItem(props: {
  insight: Insight;
  currency: string;
  first: boolean;
  working: boolean;
  options: HideOption[];
  onHide: (mode: HideOption['mode']) => void;
  onOpen: (path: string) => void;
  onTrack: () => void;
}) {
  const { insight, currency, first, working, options } = props;
  const theme = useTheme();
  const [showEvidence, setShowEvidence] = useState(false);
  const severity = SEVERITY[insight.severity];
  const count = insight.evidence.length;
  const website = insight.website;
  const track = insight.track;
  // A server that says how to track it is acted on here; an older one names the website page.
  const trackLabel =
    track?.kind === 'recurring' ? 'Track It' : track?.kind === 'habit' ? (track.trackedCategoryId ? 'Set a Budget' : 'Track Separately') : null;
  const route = website && !track ? phoneRouteFor(website.path) : null;
  return (
    <View
      style={[styles.item, !first && [styles.divided, { borderTopColor: theme.border }], { opacity: working ? 0.5 : 1 }]}>
      <View style={styles.head}>
        <View
          style={[styles.dot, { backgroundColor: theme[severity.tone] }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={severity.label}
        />
        <Text style={[styles.title, { color: theme.text }]}>{insight.title}</Text>
      </View>
      <Text style={[styles.body, { color: theme.textSecondary }]}>{insight.body}</Text>
      {count > 0 ? (
        <Pressable
          onPress={() => setShowEvidence((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showEvidence }}
          hitSlop={8}>
          <Text style={[styles.small, { color: theme.tint }]}>
            {showEvidence ? 'Hide' : 'Show'} {count === 1 ? '1 transaction' : `${count} transactions`}
          </Text>
        </Pressable>
      ) : null}
      {showEvidence
        ? insight.evidence.map((row) => (
            <View key={row.id} style={styles.evidence}>
              <Text style={[styles.small, styles.evidenceTitle, { color: theme.textSecondary }]} numberOfLines={1}>
                {formatDay(row.date)} · {row.title ?? 'Untitled'}
              </Text>
              <Text style={[styles.small, styles.amount, { color: row.type === 'income' ? theme.positive : theme.text }]}>
                {formatCents(row.amountCents, currency)}
              </Text>
            </View>
          ))
        : null}
      {track?.kind === 'habit' && track.trackedCategoryId ? (
        <Text style={[styles.small, { color: theme.textSecondary }]}>{trackedHabitText(track.categoryName)}</Text>
      ) : null}
      <View style={styles.actions}>
        {trackLabel ? (
          <ActionLink
            label={trackLabel}
            disabled={working}
            hint={
              track?.kind === 'habit' && !track.trackedCategoryId
                ? `Makes a ${track.categoryName} category and a rule for each place, so it can have a budget`
                : undefined
            }
            onPress={props.onTrack}
          />
        ) : route && website ? (
          <ActionLink label={website.label} role="link" onPress={() => props.onOpen(website.path)} />
        ) : website ? (
          <ActionLink
            label={`${website.label} on the website ›`}
            hint="Opens the website in Safari"
            role="link"
            onPress={() => props.onOpen(website.path)}
          />
        ) : null}
        {options.map((option) => (
          <ActionLink key={option.mode} label={option.label} disabled={working} onPress={() => props.onHide(option.mode)} />
        ))}
      </View>
    </View>
  );
}

function ActionLink(props: { label: string; onPress: () => void; disabled?: boolean; hint?: string; role?: 'link' | 'button' }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole={props.role ?? 'button'}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: props.disabled }}
      hitSlop={8}>
      <Text style={[styles.action, { color: theme.tint }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  item: { gap: Spacing.two },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  title: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  evidence: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  evidenceTitle: { flexShrink: 1 },
  amount: { fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.two },
  action: { fontSize: 15, fontWeight: '600' },
  link: { fontSize: 15, fontWeight: '600' },
  hidden: { gap: Spacing.two },
});
