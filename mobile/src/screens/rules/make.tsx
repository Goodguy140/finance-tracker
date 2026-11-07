import { Host, Picker } from '@expo/ui';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useRememberedQuery } from '@/api/query';
import type { Category, MadeRule } from '@/api/types';
import { FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import {
  applyQuestion,
  makeRuleBody,
  makeRuleForm,
  MATCH_OPTIONS,
  RULES_PATH,
  ruleSentence,
  type MakeRuleForm,
} from '@/utils/transaction-rules';

type Params = { title?: string; type?: string; categoryId?: string; accountId?: string; accountName?: string; match?: string };

/**
 * "Always file Tim Hortons as Coffee": a rule with Settings → Rules' main fields, saved after the
 * person's other rules. Once saved, if it fits entries already logged, it offers to change them too.
 */
export function MakeRule({ params }: { params: Params }) {
  const theme = useTheme();
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  if (!categories.data) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!categories.error} error={categories.error ? errorText(categories.error) : null} />
        </ScrollView>
        <Stack.Title>New Rule</Stack.Title>
      </>
    );
  }
  return <RuleSheet params={params} categories={categories.data.categories} />;
}

function RuleSheet({ params, categories }: { params: Params; categories: Category[] }) {
  const theme = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<MakeRuleForm>(() => makeRuleForm(params));
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, MadeRule>('POST', () => RULES_PATH, (body) => body);
  const apply = useApiMutation<string, { updated: number }>('POST', (id) => `${RULES_PATH}/${encodeURIComponent(id)}/apply`, () => ({}));
  const busy = save.isPending || apply.isPending;
  const set = <K extends keyof MakeRuleForm>(key: K, value: MakeRuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const kindCategories = categories.filter((c) => c.kind === form.type);
  const categoryName = kindCategories.find((c) => c.id === form.categoryId)?.name ?? null;
  const accountName = params.accountName || null;
  const fail = (err: unknown) => setError(errorText(err));

  function submit() {
    const result = makeRuleBody(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(result.body, {
      onError: fail,
      onSuccess: (made) => {
        const question = applyQuestion(made.matches);
        if (!question) return router.back();
        Alert.alert(question.title, question.message, [
          { text: 'Not Now', style: 'cancel', onPress: () => router.back() },
          {
            text: made.matches === 1 ? 'Change It' : 'Change Them',
            onPress: () => apply.mutate(made.id, { onSuccess: () => router.back(), onError: fail }),
          },
        ]);
      },
    });
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
        <Section title={`When ${form.type === 'income' ? 'income' : 'an expense'}'s title`}>
          <SegmentedControl
            values={MATCH_OPTIONS.map((m) => m.label)}
            selectedIndex={MATCH_OPTIONS.findIndex((m) => m.value === form.match)}
            onChange={(event) => set('match', MATCH_OPTIONS[event.nativeEvent.selectedSegmentIndex]?.value ?? form.match)}
            accessibilityLabel="How the title is matched"
          />
          <TextInput
            value={form.text}
            onChangeText={(v) => set('text', v)}
            placeholder="Tim Hortons"
            placeholderTextColor={theme.textSecondary}
            style={[formStyles.input, { color: theme.text, textAlign: 'left' }]}
            accessibilityLabel="Text to match"
            autoCorrect={false}
            maxLength={200}
          />
          {form.accountId && accountName ? (
            <FormField label={`Only on ${accountName}`}>
              <Switch value={form.onlyAccount} onValueChange={(v) => set('onlyAccount', v)} accessibilityLabel={`Only entries on ${accountName}`} />
            </FormField>
          ) : null}
        </Section>
        <Section title="Then" footer={ruleSentence(form, categoryName, accountName)}>
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
        <Text style={[formStyles.error, { color: theme.textSecondary }]}>
          New entries, bank rows and imports follow it from now on. Rules are listed, reordered and changed on the website under
          Settings → Rules.
        </Text>
      </ScrollView>
      <Stack.Title>New Rule</Stack.Title>
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
