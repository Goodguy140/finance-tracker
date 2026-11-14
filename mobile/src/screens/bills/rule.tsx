import { Host, Picker } from '@expo/ui';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput } from 'react-native';

import { useApiMutation } from '@/api/mutations';
import { errorText, useApiQuery, useRememberedQuery } from '@/api/query';
import type { Account, Category, RecurringList, RecurringPrefill, RecurringRule } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { dateFromYmd, formatDay, ymdFromDate } from '@/utils/dates';
import { RECURRING_PATH } from '@/utils/recurring';
import {
  CADENCE_OPTIONS,
  canEditRules,
  dayLabel,
  emptyRuleForm,
  formFromPrefill,
  formFromRule,
  ruleBody,
  rulePath,
  secondDayOptions,
  SEMI_MONTHLY_MIN_GAP_DAYS,
  type RuleForm,
} from '@/utils/recurring-rules';

const TYPES = [
  { value: 'expense', label: 'Bill' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
] as const;

const FIRST_DAYS = Array.from({ length: 31 - SEMI_MONTHLY_MIN_GAP_DAYS }, (_, i) => i + 1);

/**
 * A recurring bill, pay or transfer, with the website's Recurring form fields; an existing one can
 * also be paused or turned back on, cancelled (a bill), or deleted.
 */
export function EditRule({ id, prefill = null }: { id: string | null; prefill?: RecurringPrefill | null }) {
  const theme = useTheme();
  const list = useApiQuery<RecurringList>(RECURRING_PATH);
  const categories = useRememberedQuery<{ categories: Category[] }>('/api/v1/categories');
  const accounts = useRememberedQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const rule = id ? [...(list.data?.rules ?? []), ...(list.data?.paused ?? [])].find((r) => r.id === id) : undefined;
  const failed = list.error ?? categories.error ?? accounts.error;
  const ready = list.data && categories.data && accounts.data;
  const problem = !ready
    ? null
    : !canEditRules(list.data!)
      ? 'This server is too old to change recurring rules from the phone. Update it, or use the website.'
      : id && !rule
        ? 'This rule was deleted.'
        : null;
  if (!ready || problem) {
    return (
      <>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={formStyles.content}>
          <LoadState loading={!failed && !ready} error={failed ? errorText(failed) : problem} />
        </ScrollView>
        <Stack.Title>{id ? 'Recurring' : 'New recurring'}</Stack.Title>
      </>
    );
  }
  return (
    <RuleEditor
      rule={rule ?? null}
      prefill={prefill}
      today={list.data!.today}
      categories={categories.data!.categories}
      accounts={accounts.data!.accounts}
    />
  );
}

function RuleEditor({
  rule,
  prefill,
  today,
  categories,
  accounts,
}: {
  rule: RecurringRule | null;
  prefill: RecurringPrefill | null;
  today: string;
  categories: Category[];
  accounts: Account[];
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const open = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<RuleForm>(() =>
    rule ? formFromRule(rule) : prefill ? formFromPrefill(prefill, today, accounts, categories) : emptyRuleForm(today, open[0]?.id ?? ''),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation<Record<string, unknown>, { id: string }>(rule ? 'PATCH' : 'POST', () => rulePath(rule?.id), (b) => b);
  const setEnabled = useApiMutation<boolean, { ok: true }>('POST', () => rulePath(rule!.id, 'enabled'), (enabled) => ({ enabled }));
  const cancel = useApiMutation<void, { ok: true }>('POST', () => rulePath(rule!.id, 'cancel'), () => ({}));
  const remove = useApiMutation<void, { ok: true }>('DELETE', () => rulePath(rule!.id));
  const busy = save.isPending || setEnabled.isPending || cancel.isPending || remove.isPending;
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fail = (err: unknown) => setError(errorText(err));
  const done = { onSuccess: () => router.back(), onError: fail };
  const transfer = form.type === 'transfer';
  const bill = form.type === 'expense';
  const kindCategories = categories.filter((c) => c.kind === form.type);
  const themeVariant = scheme === 'dark' ? 'dark' : 'light';
  const enabled = rule?.enabled ?? true;

  function submit() {
    const result = ruleBody(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(result.body, done);
  }

  function confirmCancel() {
    Alert.alert(
      `Did you cancel ${rule!.name}?`,
      "Once you have cancelled it with the provider, this turns the rule off and Insights shows what it saves. The app can't cancel it for you.",
      [
        { text: 'Not Yet', style: 'cancel' },
        { text: 'Yes, I Cancelled It', onPress: () => cancel.mutate(undefined, done) },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(`Delete ${rule!.name}?`, 'The rule goes. What it already posted stays in your log.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Rule', style: 'destructive', onPress: () => remove.mutate(undefined, done) },
    ]);
  }

  const datePicker = (value: string, onChange: (ymd: string) => void) => (
    <DateTimePicker
      value={dateFromYmd(value)}
      onValueChange={(_, date) => onChange(ymdFromDate(date))}
      display="compact"
      timeZoneName="UTC"
      themeVariant={themeVariant}
    />
  );

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={formStyles.content}>
        {rule && !enabled ? (
          <Text style={[formStyles.error, { color: theme.textSecondary }]}>
            {rule.cancelledAt ? `Cancelled on ${formatDay(rule.cancelledAt)}.` : 'Paused.'} It posts nothing and stays out of your
            forecasts until it is turned back on.
          </Text>
        ) : null}
        <SegmentedControl
          values={TYPES.map((t) => t.label)}
          selectedIndex={TYPES.findIndex((t) => t.value === form.type)}
          onChange={(event) => {
            const type = TYPES[event.nativeEvent.selectedSegmentIndex]?.value ?? form.type;
            // A category belongs to one kind.
            setForm((f) => ({ ...f, type, categoryId: type === f.type ? f.categoryId : '' }));
          }}
          accessibilityLabel="Kind of rule"
        />
        {error ? (
          <Text accessibilityRole="alert" style={[formStyles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <Section>
          <FormField label="Name">
            <TextInput
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder={transfer ? 'Savings' : form.type === 'income' ? 'Paycheque' : 'Rent'}
              placeholderTextColor={theme.textSecondary}
              style={[formStyles.input, { color: theme.text }]}
              maxLength={80}
              autoFocus={!rule}
            />
          </FormField>
          <FormField label="Amount each time">
            <TextInput
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[formStyles.input, formStyles.amount, { color: theme.text }]}
            />
          </FormField>
          <FormField label={transfer ? 'From account' : 'Account'}>
            <Host matchContents>
              <Picker selectedValue={form.accountId} onValueChange={(v) => set('accountId', String(v))}>
                {open.map((a) => (
                  <Picker.Item key={a.id} label={a.name} value={a.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
          {transfer ? (
            <FormField label="To account" note="Where the money goes. Transfers stay out of income and spending.">
              <Host matchContents>
                <Picker selectedValue={form.transferAccountId} onValueChange={(v) => set('transferAccountId', String(v))}>
                  {form.transferAccountId ? null : <Picker.Item label="Pick one" value="" />}
                  {open
                    .filter((a) => a.id !== form.accountId)
                    .map((a) => (
                      <Picker.Item key={a.id} label={a.name} value={a.id} />
                    ))}
                </Picker>
              </Host>
            </FormField>
          ) : (
            <FormField label="Category">
              <Host matchContents>
                <Picker selectedValue={form.categoryId} onValueChange={(v) => set('categoryId', String(v))}>
                  {form.categoryId ? null : <Picker.Item label="Pick one" value="" />}
                  {kindCategories.map((c) => (
                    <Picker.Item key={c.id} label={c.name} value={c.id} />
                  ))}
                </Picker>
              </Host>
            </FormField>
          )}
        </Section>
        <Section>
          <FormField label="Repeats">
            <Host matchContents>
              <Picker selectedValue={form.cadence} onValueChange={(v) => set('cadence', v as RuleForm['cadence'])}>
                {CADENCE_OPTIONS.map((c) => (
                  <Picker.Item key={c.value} label={c.label} value={c.value} />
                ))}
              </Picker>
            </Host>
          </FormField>
          {form.cadence === 'semi_monthly' ? (
            <>
              <FormField label="First day">
                <Host matchContents>
                  <Picker
                    selectedValue={form.firstDay}
                    onValueChange={(v) => {
                      const firstDay = Number(v);
                      // Keep the second day a week later.
                      setForm((f) => ({ ...f, firstDay, secondDay: Math.max(f.secondDay, firstDay + SEMI_MONTHLY_MIN_GAP_DAYS) }));
                    }}>
                    {FIRST_DAYS.map((d) => (
                      <Picker.Item key={d} label={dayLabel(d)} value={d} />
                    ))}
                  </Picker>
                </Host>
              </FormField>
              <FormField label="Second day" note="At least a week after the first. Short months use their last day.">
                <Host matchContents>
                  <Picker selectedValue={form.secondDay} onValueChange={(v) => set('secondDay', Number(v))}>
                    {secondDayOptions(form.firstDay).map((d) => (
                      <Picker.Item key={d} label={dayLabel(d)} value={d} />
                    ))}
                  </Picker>
                </Host>
              </FormField>
              <FormField label="Friday before a weekend" note="When a day lands on a Saturday or Sunday, as most payrolls do.">
                <Switch value={form.beforeWeekend} onValueChange={(on) => set('beforeWeekend', on)} accessibilityLabel="Move to the Friday before a weekend" />
              </FormField>
            </>
          ) : null}
          <FormField
            label={rule ? 'Next date' : 'First date'}
            note={form.cadence === 'semi_monthly' ? 'Starts on the first of the two days on or after this date.' : null}>
            {datePicker(form.nextDate, (v) => set('nextDate', v))}
          </FormField>
          <FormField label="Ends">
            <Switch value={form.ends} onValueChange={(on) => set('ends', on)} accessibilityLabel="Has an end date" />
          </FormField>
          {form.ends ? <FormField label="Last date">{datePicker(form.endDate, (v) => set('endDate', v))}</FormField> : null}
          <FormField label="Post by itself" note="Posted to your log as soon as it is due, and waits in Needs review.">
            <Switch value={form.autoPost} onValueChange={(on) => set('autoPost', on)} accessibilityLabel="Post by itself when due" />
          </FormField>
        </Section>
        {bill ? (
          <Section title="If it is a subscription" footer="Bill reminders warn you before the decide-by date, such as when a free trial turns paid.">
            <FormField label="Where to cancel">
              <TextInput
                value={form.cancelUrl}
                onChangeText={(v) => set('cancelUrl', v)}
                placeholder="Link or phone number"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[formStyles.input, { color: theme.text }]}
                maxLength={500}
              />
            </FormField>
            <FormField label="Decide by">
              <Switch value={form.decides} onValueChange={(on) => set('decides', on)} accessibilityLabel="Has a decide-by date" />
            </FormField>
            {form.decides ? <FormField label="On">{datePicker(form.decideBy, (v) => set('decideBy', v))}</FormField> : null}
          </Section>
        ) : null}
        <Section footer="Copied to each entry it posts.">
          <TextInput
            value={form.note}
            onChangeText={(v) => set('note', v)}
            placeholder="Note"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[formStyles.note, { color: theme.text }]}
            maxLength={250}
          />
        </Section>
        {rule ? (
          <>
            <FormButton
              label={enabled ? 'Pause Rule' : 'Turn Back On'}
              onPress={() => setEnabled.mutate(!enabled, done)}
              disabled={busy}
            />
            {enabled && rule.type === 'expense' ? <FormButton label="I Cancelled This Subscription" onPress={confirmCancel} disabled={busy} /> : null}
            <FormButton label="Delete Rule" destructive onPress={confirmDelete} disabled={busy} />
          </>
        ) : null}
      </ScrollView>
      <Stack.Title>{rule ? rule.name : 'New recurring'}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy} onPress={submit}>
          {rule ? 'Save' : 'Add'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
