import { Host, Picker } from '@expo/ui';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Account, Category, RuleDetail } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  alsoOnWebsiteLine,
  editRuleBody,
  editRuleForm,
  orderLine,
  rulePath,
  TYPE_OPTIONS,
  type EditRuleForm,
} from '@/utils/rule-edits';
import { applyQuestion, MATCH_OPTIONS } from '@/utils/transaction-rules';

/**
 * One rule from Settings → Rules: what it matches and sets, on or off, its place in the order,
 * Apply to past entries, and Delete. What only the website edits (amounts, a split, a note, a
 * transfer) is kept as it is.
 */
export function EditRule({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const detail = useApiQuery<RuleDetail>(rulePath(id));
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useRememberedQuery<{ accounts: Account[] }>('/api/v1/accounts');
  if (!detail.data || !categories.data || !accounts.data) {
    const error = detail.error ?? categories.error ?? accounts.error;
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!error} error={error ? errorText(error) : null} />
        </ScrollView>
        <Stack.Title>Rule</Stack.Title>
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      </>
    );
  }
  return <RuleEditor detail={detail.data} categories={categories.data.categories} accounts={accounts.data.accounts} />;
}

function RuleEditor({ detail, categories, accounts }: { detail: RuleDetail; categories: Category[]; accounts: Account[] }) {
  const theme = useTheme();
  const router = useRouter();
  const { rule, count, matches } = detail;
  const [form, setForm] = useState<EditRuleForm>(() => editRuleForm(rule));
  const [error, setError] = useState<string | null>(null);
  const [enabledShown, setEnabledShown] = useState(rule.enabled);
  const path = rulePath(rule.id);
  const save = useApiMutation<Record<string, unknown>, RuleDetail>('PATCH', () => path, (body) => body);
  const move = useApiMutation<'up' | 'down', { position: number }>('POST', () => `${path}/move`, (direction) => ({ direction }));
  const apply = useApiMutation<void, { updated: number }>('POST', () => `${path}/apply`, () => ({}));
  const remove = useApiMutation<void, { deleted: true }>('DELETE', () => path);
  const busy = save.isPending || move.isPending || apply.isPending || remove.isPending;
  const set = <K extends keyof EditRuleForm>(key: K, value: EditRuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(errorText(err));
  const change = editRuleBody(form, rule);
  const dirty = change !== null;
  const kindCategories = categories.filter((c) => c.kind !== 'transfer' && (form.type === null || c.kind === form.type));
  const matchAccounts = accounts.filter((a) => !a.archived || a.id === rule.accountId);
  const websiteLine = alsoOnWebsiteLine(rule);

  function setType(type: EditRuleForm['type']) {
    // A category belongs to one side of the ledger; one from the other side is dropped.
    const kind = categories.find((c) => c.id === form.categoryId)?.kind;
    setForm((f) => ({ ...f, type, categoryId: type !== null && kind && kind !== type ? '' : f.categoryId }));
  }

  function askApply(count: number, then: () => void) {
    const question = applyQuestion(count);
    if (!question) return then();
    Alert.alert(question.title, question.message, [
      { text: 'Not Now', style: 'cancel', onPress: then },
      {
        text: count === 1 ? 'Change It' : 'Change Them',
        onPress: () => apply.mutate(undefined, { onSuccess: then, onError: fail }),
      },
    ]);
  }

  function submit() {
    if (change === null) return router.back();
    if ('error' in change) return setError(change.error);
    setError(null);
    save.mutate(change.body, {
      onError: fail,
      onSuccess: (saved) => askApply(saved.matches ?? 0, () => router.back()),
    });
  }

  function setEnabled(on: boolean) {
    setError(null);
    // Shown at once; put back if the server refuses.
    setEnabledShown(on);
    save.mutate(
      { enabled: on },
      {
        onError: (err) => {
          setEnabledShown(!on);
          fail(err);
        },
      },
    );
  }

  function confirmDelete() {
    Alert.alert('Delete this rule?', 'Past transactions are not changed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Rule',
        style: 'destructive',
        onPress: () => remove.mutate(undefined, { onSuccess: () => router.back(), onError: fail }),
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <Section footer={enabledShown ? orderLine(rule.position, count) : `Off: nothing follows it until it is on again. ${orderLine(rule.position, count)}`}>
          <FormField label="On">
            <Switch value={enabledShown} disabled={busy} onValueChange={setEnabled} accessibilityLabel="Rule on" />
          </FormField>
          <View style={styles.buttons}>
            <View style={styles.grow}>
              <FormButton label="Move Up" onPress={() => move.mutate('up', { onError: fail })} disabled={busy || rule.position <= 1} />
            </View>
            <View style={styles.grow}>
              <FormButton label="Move Down" onPress={() => move.mutate('down', { onError: fail })} disabled={busy || rule.position >= count} />
            </View>
          </View>
        </Section>

        <Section title="When the title" footer="One text per line; any one matching is enough.">
          <SegmentedControl
            values={MATCH_OPTIONS.map((m) => m.label)}
            selectedIndex={MATCH_OPTIONS.findIndex((m) => m.value === form.match)}
            onChange={(event) => set('match', MATCH_OPTIONS[event.nativeEvent.selectedSegmentIndex]?.value ?? form.match)}
            accessibilityLabel="How the title is matched"
          />
          <TextInput
            value={form.texts}
            onChangeText={(v) => set('texts', v)}
            placeholder="Tim Hortons"
            placeholderTextColor={theme.textSecondary}
            style={[formStyles.input, styles.texts, { color: theme.text }]}
            accessibilityLabel="Texts to match, one per line"
            autoCorrect={false}
            multiline
          />
        </Section>

        <Section title="For">
          <SegmentedControl
            values={TYPE_OPTIONS.map((t) => t.label)}
            selectedIndex={TYPE_OPTIONS.findIndex((t) => t.value === form.type)}
            onChange={(event) => setType(TYPE_OPTIONS[event.nativeEvent.selectedSegmentIndex]?.value ?? form.type)}
            accessibilityLabel="Expenses, income or either"
          />
          <FormField label="Only on">
            <Host matchContents>
              <Picker selectedValue={form.accountId} onValueChange={(v) => set('accountId', String(v))}>
                <Picker.Item label="Any account" value="" />
                {matchAccounts.map((a) => (
                  <Picker.Item key={a.id} label={a.name} value={a.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
        </Section>

        <Section title="Then" footer={websiteLine}>
          <FormField label="Category">
            <Host matchContents>
              <Picker selectedValue={form.categoryId} onValueChange={(v) => set('categoryId', String(v))}>
                <Picker.Item label="Leave as it is" value="" />
                {kindCategories.map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          <FormField label="Rename to">
            <TextInput
              value={form.rename}
              onChangeText={(v) => set('rename', v)}
              placeholder="Keep the title"
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              maxLength={120}
            />
          </FormField>
          <FormField label="Add tag">
            <TextInput
              value={form.tag}
              onChangeText={(v) => set('tag', v)}
              placeholder="None"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              style={[formStyles.input, { color: theme.text }]}
              maxLength={40}
            />
          </FormField>
        </Section>

        {matches && !dirty ? (
          <FormButton
            label={`Apply to ${matches} Past ${matches === 1 ? 'Entry' : 'Entries'}…`}
            onPress={() => askApply(matches, () => undefined)}
            disabled={busy}
          />
        ) : null}
        <FormButton label="Delete Rule" destructive onPress={confirmDelete} disabled={busy} />
      </ScrollView>
      <Stack.Title>{`Rule ${rule.position}`}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  texts: { textAlign: 'left', minHeight: 44 },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
});
