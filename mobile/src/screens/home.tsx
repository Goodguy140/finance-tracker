import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { apiGet, SignedOutError, type Budgets, type Me } from '@/api/client';
import { Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { StoredSession } from '@/session/store';
import { useSession } from '@/session/session-provider';
import { formatCents, formatPeriodMonth } from '@/utils/money';

type Loaded = { me: Me; budgets: Budgets };
type LoadResult = { data: Loaded } | { error: string } | { signedOut: string };

async function loadHome(session: StoredSession): Promise<LoadResult> {
  try {
    const [me, budgets] = await Promise.all([
      apiGet<Me>(session, '/api/v1/me'),
      apiGet<Budgets>(session, '/api/v1/budgets'),
    ]);
    return { data: { me, budgets } };
  } catch (err) {
    if (err instanceof SignedOutError) return { signedOut: err.message };
    return { error: err instanceof Error ? err.message : 'Could not load. Pull to try again.' };
  }
}

/** Signed in: who and where, and this month's budgets. The first real screen; more follow in Phase 3. */
export function Home() {
  const theme = useTheme();
  const { session, signOut } = useSession();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback(
    (result: LoadResult) => {
      if ('signedOut' in result) {
        void signOut({ notice: result.signedOut, revoke: false });
      } else if ('error' in result) {
        setError(result.error);
      } else {
        setData(result.data);
        setError(null);
      }
    },
    [signOut],
  );

  useEffect(() => {
    if (!session) return;
    let live = true;
    void loadHome(session).then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [session, apply]);

  const refresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    apply(await loadHome(session));
    setRefreshing(false);
  }, [session, apply]);

  function confirmSignOut() {
    Alert.alert('Sign out?', 'This phone will need to sign in again to see your finances.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  const host = session ? session.origin.replace(/^https:\/\//, '') : '';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Title large>Finances</Stack.Title>

      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}

      {!data && !error ? <ActivityIndicator style={styles.loading} /> : null}

      {data ? (
        <>
          <Section title={formatPeriodMonth(data.budgets.periodMonth)} theme={theme}>
            {data.budgets.budgets.length === 0 ? (
              <Text style={[styles.muted, { color: theme.textSecondary }]}>
                No budgets yet. Set them on the web under Settings → Categories.
              </Text>
            ) : (
              <>
                <BudgetLine
                  name="All budgets"
                  spentCents={data.budgets.totalSpentCents}
                  limitCents={data.budgets.totalLimitCents}
                  currency={data.budgets.currency}
                  theme={theme}
                  bold
                />
                {data.budgets.budgets.map((row) => (
                  <BudgetLine
                    key={row.categoryId}
                    name={row.categoryName}
                    spentCents={row.spentCents}
                    limitCents={row.limitCents}
                    currency={data.budgets.currency}
                    theme={theme}
                  />
                ))}
              </>
            )}
          </Section>

          <Section title="Signed in" theme={theme}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>{data.me.user.displayName}</Text>
            <Text style={[styles.muted, { color: theme.textSecondary }]}>
              {data.me.user.email} · {host}
            </Text>
          </Section>
        </>
      ) : null}

      <Pressable
        onPress={confirmSignOut}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.signOut,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}>
        <Text style={[styles.signOutText, { color: theme.danger }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, theme, children }: { title: string; theme: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

function BudgetLine(props: {
  name: string;
  spentCents: number;
  limitCents: number;
  currency: string;
  theme: ThemeColors;
  bold?: boolean;
}) {
  const { name, spentCents, limitCents, currency, theme, bold } = props;
  const share = limitCents > 0 ? Math.min(spentCents / limitCents, 1) : 0;
  const over = limitCents > 0 && spentCents > limitCents;
  return (
    <View style={styles.budget} accessible accessibilityLabel={`${name}: ${formatCents(spentCents, currency)} of ${formatCents(limitCents, currency)}`}>
      <View style={styles.budgetRow}>
        <Text style={[styles.rowTitle, { color: theme.text, fontWeight: bold ? '700' : '500' }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.amount, { color: over ? theme.danger : theme.textSecondary }]}>
          {formatCents(spentCents, currency)} of {formatCents(limitCents, currency)}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.track }]}>
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: over ? theme.danger : theme.tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  loading: { marginTop: Spacing.five },
  error: { fontSize: 15, lineHeight: 21 },
  section: { gap: Spacing.two },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: Spacing.one },
  card: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.three },
  muted: { fontSize: 15, lineHeight: 21 },
  rowTitle: { fontSize: 17, flexShrink: 1 },
  budget: { gap: 6 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  amount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  signOut: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: 'center' },
  signOutText: { fontSize: 17, fontWeight: '600' },
});
