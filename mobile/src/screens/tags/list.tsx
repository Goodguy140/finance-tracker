import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { Tag } from '@/api/types';
import { formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTheme } from '@/hooks/use-theme';
import { sameNameTag, tagPath, tidyTagName } from '@/utils/category-edits';

/**
 * The website's tag list (Settings → Rules): every tag with how many entries carry it. One can be
 * renamed (into another tag's name merges the two, entries, rules and saved searches with it) or
 * deleted (entries keep everything else).
 */
export function TagsScreen() {
  const theme = useTheme();
  const query = useApiQuery<{ tags: Tag[] }>('/api/v1/tags');
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const rename = useApiMutation<{ id: string; name: string }, { id: string; mergedInto: { name: string } | null }>(
    'PATCH',
    (v) => tagPath(v.id),
    (v) => ({ name: v.name }),
  );
  const remove = useApiMutation<{ id: string }, { ok: true }>('DELETE', (v) => tagPath(v.id));
  const tags = query.data?.tags;

  function saveName(tag: Tag, raw: string) {
    const name = tidyTagName(raw);
    if (!name || name === tag.name) return;
    const run = () =>
      rename.mutate(
        { id: tag.id, name },
        {
          onSuccess: (result) =>
            setNote({ text: result.mergedInto ? `#${tag.name} is now part of #${result.mergedInto.name}.` : `Renamed to #${name}.`, error: false }),
          onError: (err) => setNote({ text: errorText(err), error: true }),
        },
      );
    const into = tags ? sameNameTag(tags, name, tag.id) : undefined;
    if (!into) return run();
    Alert.alert(`Merge into #${into.name}?`, `Entries, rules and saved searches with #${tag.name} move to #${into.name}, and #${tag.name} is removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Merge', style: 'destructive', onPress: run },
    ]);
  }

  function open(tag: Tag) {
    setNote(null);
    Alert.alert(`#${tag.name}`, `On ${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}.`, [
      {
        text: 'Rename…',
        onPress: () =>
          Alert.prompt(
            `Rename #${tag.name}`,
            "Another tag's name merges the two.",
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Rename', onPress: (text?: string) => saveName(tag, text ?? '') },
            ],
            'plain-text',
            tag.name,
          ),
      },
      {
        text: 'Delete…',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Delete #${tag.name}?`, 'Entries keep everything else. Rules that add it stop adding a tag.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () =>
                remove.mutate(
                  { id: tag.id },
                  { onSuccess: () => setNote({ text: `Deleted #${tag.name}.`, error: false }), onError: (err) => setNote({ text: errorText(err), error: true }) },
                ),
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {note ? (
          <Text accessibilityRole={note.error ? 'alert' : undefined} style={[formStyles.error, { color: note.error ? theme.danger : theme.textSecondary }]}>
            {note.text}
          </Text>
        ) : null}
        <LoadState loading={query.isPending} error={query.error && !tags ? errorText(query.error) : null} />
        {tags ? (
          <Section footer={tags.length > 0 ? 'Tap one to rename, merge or delete it. Add tags to entries when you add or edit them.' : null}>
            {tags.length === 0 ? (
              <Text style={[styles.body, { color: theme.textSecondary }]}>No tags yet. Add one to an entry when you add or edit it.</Text>
            ) : (
              tags.map((tag) => (
                <Pressable
                  key={tag.id}
                  onPress={() => open(tag)}
                  accessibilityRole="button"
                  accessibilityLabel={`#${tag.name}, ${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`}
                  accessibilityHint="Rename, merge or delete it"
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                  <Text style={[styles.body, styles.grow, { color: theme.text }]} numberOfLines={1}>
                    #{tag.name}
                  </Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>{tag.count}</Text>
                </Pressable>
              ))
            )}
          </Section>
        ) : null}
      </ScrollView>
      <Stack.Title>Tags</Stack.Title>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  body: { fontSize: 17, lineHeight: 22 },
  small: { fontSize: 15, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
