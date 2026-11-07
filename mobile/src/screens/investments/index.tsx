import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { InvestmentActivity, Investments, RoomYear } from '@/api/types';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/utils/dates';
import {
  ACTIVITY_TITLE,
  activityAmount,
  INVESTMENTS_PATH,
  parseRoomInput,
  returnLine,
  ROOM_PROMPT,
  roomLabel,
  roomNote,
  roomValue,
} from '@/utils/investments';
import { formatCents } from '@/utils/money';
import { amountInputText } from '@/utils/transactions';

/**
 * The website's Investments card: TFSA, RRSP and FHSA room left this year, each investment
 * account's value and return, and the newest contributions, withdrawals and portfolio values,
 * each opening its sheet. A deposit into a registered account that does not count toward room
 * yet is listed with them, and counts with a tap.
 */
export function InvestmentsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useApiQuery<Investments>(INVESTMENTS_PATH);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [error, setError] = useState<string | null>(null);
  const setRoom = useApiMutation<{ accountType: string; year: number; roomCents: number }, { ok: true }>(
    'PUT',
    () => `${INVESTMENTS_PATH}/room`,
    (body) => body,
  );
  const removeRoom = useApiMutation<string, { ok: true }>('DELETE', (id) => `${INVESTMENTS_PATH}/room/${encodeURIComponent(id)}`);
  const count = useApiMutation<string, { id: string }>(
    'POST',
    (id) => `${INVESTMENTS_PATH}/transfers/${encodeURIComponent(id)}/count`,
  );
  const data = query.data;
  const fail = (err: unknown) => setError(errorText(err));

  function promptRoom(room: RoomYear) {
    const entered = room.entries.find((e) => e.year === room.year);
    Alert.prompt(
      `${roomLabel(room)} room`,
      ROOM_PROMPT[room.accountType],
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (raw?: string) => {
            const roomCents = parseRoomInput(raw ?? '');
            if (roomCents === null) return setError('Enter the room as an amount, like 7000.');
            setError(null);
            setRoom.mutate({ accountType: room.accountType, year: room.year, roomCents }, { onError: fail });
          },
        },
      ],
      'plain-text',
      entered ? amountInputText(entered.roomCents) : '',
      'numbers-and-punctuation',
    );
  }

  function openRoom(room: RoomYear) {
    const entered = room.entries.find((e) => e.year === room.year);
    if (!entered) return promptRoom(room);
    Alert.alert(roomLabel(room), roomNote(room, data!.currency), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change Figure…', onPress: () => promptRoom(room) },
      {
        text: `Remove the ${room.year} Figure`,
        style: 'destructive',
        onPress: () => removeRoom.mutate(entered.id, { onError: fail }),
      },
    ]);
  }

  function openActivity(item: InvestmentActivity) {
    if (item.kind !== 'transfer') {
      router.push({ pathname: '/investment', params: { kind: item.kind === 'value' ? 'value' : 'flow', id: item.id } });
      return;
    }
    Alert.alert(
      'Count toward room?',
      `${activityAmount(item)} into ${item.accountName} on ${formatDate(item.date)} becomes a contribution, so it uses room. The transfer itself is not changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Count Toward Room', onPress: () => count.mutate(item.id, { onError: fail }) },
      ],
    );
  }

  const add = (kind: 'flow' | 'value') => router.push({ pathname: '/investment', params: { kind } });

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <LoadState loading={query.isPending} error={query.error && !data ? errorText(query.error) : null} />
        {error ? (
          <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        {data ? (
          <>
            <Section
              title="Room left"
              footer={data.room.length > 0 ? 'Tap a row to enter the year’s figure from CRA, or change it.' : null}>
              {data.room.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>No TFSA, RRSP or FHSA accounts yet.</Text>
              ) : (
                data.room.map((room) => (
                  <Pressable
                    key={room.accountType}
                    onPress={() => openRoom(room)}
                    accessibilityRole="button"
                    accessibilityHint="Enter or change the year's room"
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, { color: theme.text }]}>{roomLabel(room)}</Text>
                      <Text
                        style={[
                          styles.amount,
                          { color: room.overCents > 0 ? theme.danger : room.remainingCents === null ? theme.textSecondary : theme.text },
                        ]}>
                        {roomValue(room, data.currency)}
                      </Text>
                    </View>
                    <Text style={[styles.detail, { color: theme.textSecondary }]}>{roomNote(room, data.currency)}</Text>
                    {room.overText ? <Text style={[styles.detail, { color: theme.danger }]}>{room.overText}</Text> : null}
                  </Pressable>
                ))
              )}
            </Section>

            {data.returns.length > 0 ? (
              <Section
                title="Value and return"
                footer="Money-weighted, from the values recorded and the money put in or taken out, as Reports works it out.">
                {data.returns.map((row) => (
                  <Pressable
                    key={row.accountId ?? 'total'}
                    disabled={!row.accountId}
                    onPress={() => row.accountId && router.push({ pathname: '/accounts/[id]', params: { id: row.accountId } })}
                    accessibilityRole={row.accountId ? 'button' : undefined}
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, { color: theme.text }, !row.accountId && styles.total]} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={[styles.amount, { color: theme.text }]}>{formatCents(row.valueCents, row.currency)}</Text>
                    </View>
                    <Text style={[styles.detail, { color: theme.textSecondary }]}>{returnLine(row)}</Text>
                  </Pressable>
                ))}
              </Section>
            ) : null}

            <Section title="Activity" footer={data.activity.length > 0 ? 'The newest of each kind. Tap one to change or delete it.' : null}>
              {data.activity.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Nothing recorded yet. Add a contribution, a withdrawal or a portfolio value with +.
                </Text>
              ) : (
                data.activity.map((item) => (
                  <Pressable
                    key={`${item.kind}:${item.id}`}
                    onPress={() => openActivity(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${ACTIVITY_TITLE[item.kind]}, ${item.accountName}, ${formatDate(item.date)}, ${activityAmount(item)}`}
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                        {ACTIVITY_TITLE[item.kind]} · {item.accountName}
                      </Text>
                      <Text style={[styles.amount, { color: item.kind === 'withdrawal' ? theme.warning : theme.text }]}>
                        {activityAmount(item)}
                      </Text>
                    </View>
                    <Text style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={2}>
                      {[
                        formatDate(item.date),
                        item.note,
                        item.fromTransfer ? 'From a transfer' : null,
                        item.kind === 'transfer' ? 'Not counted toward room. Tap to count it.' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Pressable>
                ))
              )}
            </Section>
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>Investments</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Add">
          <Stack.Toolbar.MenuAction icon="arrow.left.arrow.right" onPress={() => add('flow')}>
            Contribution or Withdrawal
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="chart.line.uptrend.xyaxis" onPress={() => add('value')}>
            Portfolio Value
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  body: { fontSize: 15, lineHeight: 21 },
  row: { gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.three },
  title: { fontSize: 17, flexShrink: 1 },
  total: { fontWeight: '600' },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
  detail: { fontSize: 13, lineHeight: 18 },
});
