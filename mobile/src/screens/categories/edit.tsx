import { Host, Picker } from '@expo/ui';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery } from '@/api/query';
import type { CategoryDetail, Me } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import {
  CATEGORY_DETAILS_PATH,
  categoryForm,
  categoryPatch,
  categoryPath,
  groupNames,
  MAX_CATEGORY_NAME,
  moveTargets,
  newCategoryBody,
  sameNameCategory,
  usesLine,
  type CategoryForm,
  type NewCategoryForm,
} from '@/utils/category-edits';

const KINDS = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
] as const;

const ROLES = [
  { value: 'auto', label: 'Guess from the name' },
  { value: 'need', label: 'Need' },
  { value: 'want', label: 'Want' },
] as const;

/** Settings → Categories' Add (no `id`), or one category's sheet: rename, group, need or want, delete. */
export function EditCategory({ id }: { id: string | null }) {
  const theme = useTheme();
  const query = useApiQuery<{ categories: CategoryDetail[] }>(CATEGORY_DETAILS_PATH);
  const me = useApiQuery<Me>('/api/v1/me').data;
  const categories = query.data?.categories;
  const category = id ? categories?.find((c) => c.id === id) : null;
  if (!categories || (id && !category)) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState
            loading={!query.error && !categories}
            error={query.error ? errorText(query.error) : categories ? 'This category is gone. It may have been merged or deleted.' : null}
          />
        </ScrollView>
        <Stack.Title>{id ? 'Category' : 'New Category'}</Stack.Title>
      </>
    );
  }
  return category ? (
    <CategoryEditor category={category} categories={categories} />
  ) : (
    <NewCategory categories={categories} currency={me?.user.currency ?? 'CAD'} />
  );
}

function NewCategory({ categories, currency }: { categories: CategoryDetail[]; currency: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<NewCategoryForm>({ name: '', kind: 'expense', limit: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation<Record<string, unknown>, { id: string }>('POST', () => '/api/v1/categories', (b) => b);

  function submit() {
    setError(null);
    const result = newCategoryBody(form, categories);
    if ('error' in result) return setError(result.error);
    create.mutate(result.body, { onSuccess: () => router.back(), onError: (err) => setError(errorText(err)) });
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <Section>
          <SegmentedControl
            values={KINDS.map((k) => k.label)}
            selectedIndex={KINDS.findIndex((k) => k.value === form.kind)}
            onChange={(event) => {
              const kind = KINDS[event.nativeEvent.selectedSegmentIndex]?.value;
              if (kind) setForm((f) => ({ ...f, kind }));
            }}
          />
          <FormField label="Name">
            <TextInput
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
              placeholder={form.kind === 'income' ? 'Bonus' : 'Pets'}
              placeholderTextColor={theme.textSecondary}
              maxLength={MAX_CATEGORY_NAME}
              autoFocus
              style={[formStyles.input, { color: theme.text }]}
            />
          </FormField>
        </Section>
        {form.kind === 'expense' ? (
          <Section footer="Optional. Set from this month on; change it later from Budgets.">
            <FormField label={`Monthly budget (${currency})`}>
              <TextInput
                value={form.limit}
                onChangeText={(limit) => setForm((f) => ({ ...f, limit }))}
                placeholder="None"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[formStyles.input, formStyles.amount, { color: theme.text }]}
              />
            </FormField>
          </Section>
        ) : null}
      </ScrollView>
      <Stack.Title>New Category</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={create.isPending} onPress={submit}>
          Add
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

function CategoryEditor({ category, categories }: { category: CategoryDetail; categories: CategoryDetail[] }) {
  const theme = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<CategoryForm>(() => categoryForm(category));
  const targets = moveTargets(categories, category);
  const [moveTo, setMoveTo] = useState<string | null>(targets[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const patch = useApiMutation<Record<string, unknown>, { id: string }>('PATCH', () => categoryPath(category.id), (b) => b);
  const remove = useApiMutation<void, { ok: true }>(
    'DELETE',
    () => `${categoryPath(category.id)}${category.uses > 0 && moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`,
    () => undefined,
  );
  const busy = patch.isPending || remove.isPending;
  const groups = groupNames(categories);
  const kindLabel = category.kind === 'income' ? 'income' : 'expense';
  const done = { onSuccess: () => router.back(), onError: (err: unknown) => setError(errorText(err)) };

  function save() {
    setError(null);
    const result = categoryPatch(form, category);
    if (result === null) return router.back();
    if ('error' in result) return setError(result.error);
    const body = result.body;
    const into = typeof body.name === 'string' ? sameNameCategory(categories, category.kind, body.name, category.id) : undefined;
    if (!into) return patch.mutate(body, done);
    Alert.alert(
      `Merge into ${into.name}?`,
      `${category.name}'s entries, budgets and rules move to ${into.name}, and ${category.name} is removed. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', style: 'destructive', onPress: () => patch.mutate(body, done) },
      ],
    );
  }

  function confirmDelete() {
    setError(null);
    const target = targets.find((t) => t.id === moveTo);
    if (targets.length === 0) return setError(`Keep at least one ${kindLabel} category.`);
    Alert.alert(
      `Delete ${category.name}?`,
      category.uses > 0 && target
        ? `Its entries, budgets and rules move to ${target.name}. This can't be undone.`
        : "Its budgets go with it. Rules that set it stop setting a category. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(undefined, done) },
      ],
    );
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
        <Section
          footer={`${category.kind === 'income' ? 'Income' : 'Spending'} · ${usesLine(category.uses)}. Renaming it to another ${kindLabel} category's name merges the two.`}>
          <FormField label="Name">
            <TextInput
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
              maxLength={MAX_CATEGORY_NAME}
              style={[formStyles.input, { color: theme.text }]}
            />
          </FormField>
        </Section>
        <Section
          footer={
            groups.length > 0
              ? `Groups so far: ${groups.join(', ')}. Typing one of them (in any case) joins it; empty takes it out of its group.`
              : 'A heading for related categories ("Food" over Groceries and Restaurants), added up on Budgets, the pie and Reports.'
          }>
          <FormField label="Group">
            <TextInput
              value={form.groupName}
              onChangeText={(groupName) => setForm((f) => ({ ...f, groupName }))}
              placeholder="None"
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
            />
          </FormField>
        </Section>
        {category.kind === 'expense' ? (
          <Section footer="For the financial score's 50/30/20 split of needs, wants and saving.">
            <FormField label="Need or want">
              <Host matchContents>
                <Picker
                  selectedValue={form.spendingRole}
                  onValueChange={(v) => setForm((f) => ({ ...f, spendingRole: String(v) as CategoryForm['spendingRole'] }))}>
                  {ROLES.map((r) => (
                    <Picker.Item key={r.value} label={r.label} value={r.value} />
                  ))}
                </Picker>
              </Host>
            </FormField>
          </Section>
        ) : null}
        <Section
          footer={
            category.uses > 0
              ? 'It is in use, so its entries, split parts, recurring rules, plans and budgets move to the category picked here.'
              : null
          }>
          {category.uses > 0 && targets.length > 0 ? (
            <FormField label="Move its entries to">
              <Host matchContents>
                <Picker selectedValue={moveTo ?? ''} onValueChange={(v) => setMoveTo(String(v))}>
                  {targets.map((t) => (
                    <Picker.Item key={t.id} label={t.name} value={t.id} />
                  ))}
                </Picker>
              </Host>
            </FormField>
          ) : null}
          <FormButton label="Delete Category" destructive onPress={confirmDelete} disabled={busy} />
        </Section>
      </ScrollView>
      <Stack.Title>{category.name}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={save}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
