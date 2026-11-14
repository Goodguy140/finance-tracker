import { Host, Picker } from '@expo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { importStatement, previewStatement, readStatementText } from '@/api/imports';
import { errorText, useApiQuery } from '@/api/query';
import type { Account, Category, Me } from '@/api/types';
import { FormButton, FormField, formStyles } from '@/components/form';
import { LoadState } from '@/components/load-state';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/session/session-provider';
import { formatCents } from '@/utils/money';
import {
  IMPORT_FIELDS,
  importBody,
  sampleLines,
  setColumn,
  summaryText,
  type AmountSign,
  type ColumnMapping,
  type MoneyIn,
  type SampleLine,
  type SharedStatement,
  type StatementImportSummary,
  type StatementPreview,
} from '@/utils/statement-import';

const NONE = '__none__';

type Loaded = { text: string; preview: StatementPreview };

/**
 * A bank statement shared to Finances, imported as the website's Settings → Import does: the
 * server reads the file and guesses its columns, the person checks the account, category, sign
 * and columns against the first rows, and the server books it. Rules apply, rows already in the
 * log are skipped, and everything waits in Needs review.
 */
export function StatementImport({ statement, onFinish }: { statement: SharedStatement; onFinish: (then?: 'review') => void }) {
  const theme = useTheme();
  const { session } = useSession();
  const me = useApiQuery<Me>('/api/v1/me');
  const supported = me.data ? (me.data.features?.includes('statement-import') ?? false) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || supported !== true) return;
    let live = true;
    (async () => {
      try {
        const text = await readStatementText(statement.uri);
        const preview = await previewStatement(session, { fileName: statement.fileName, text });
        if (live) setLoaded({ text, preview });
      } catch (err) {
        if (live) setLoadError(errorText(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [session, supported, statement.uri, statement.fileName]);

  if (supported === false) {
    return (
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        Your server needs an update before statements can be imported from the phone. Until then, import it on the website, in
        Settings → Import.
      </Text>
    );
  }
  if (loadError) return <Text style={[styles.body, { color: theme.danger }]}>{loadError}</Text>;
  if (!loaded) return <LoadState loading error={me.error && !me.data ? errorText(me.error) : null} />;
  return <ImportForm statement={statement} loaded={loaded} onFinish={onFinish} />;
}

function ImportForm({ statement, loaded, onFinish }: { statement: SharedStatement; loaded: Loaded; onFinish: (then?: 'review') => void }) {
  const theme = useTheme();
  const { session } = useSession();
  const client = useQueryClient();
  const home = useApiQuery<Me>('/api/v1/me').data?.user.currency ?? 'CAD';
  const accounts = useApiQuery<{ accounts: Account[] }>('/api/v1/accounts');
  const categories = useApiQuery<{ categories: Category[] }>('/api/v1/categories');
  const open = accounts.data?.accounts.filter((a) => !a.archived) ?? [];
  const spending = categories.data?.categories.filter((c) => c.kind === 'expense') ?? [];
  const incoming = categories.data?.categories.filter((c) => c.kind === 'income') ?? [];
  const { preview, text } = loaded;

  const [mapping, setMapping] = useState<ColumnMapping>(preview.mapping);
  const [chosenAccount, setAccount] = useState<string | null>(null);
  const [chosenCategory, setCategory] = useState<string | null>(null);
  const [amountSign, setAmountSign] = useState<AmountSign>(preview.amountSign);
  const [moneyIn, setMoneyIn] = useState<MoneyIn>('refund');
  const [chosenIncome, setIncome] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StatementImportSummary | null>(null);

  // As the website's form starts: the first spending and income categories; one account, if that is all there is.
  const accountId = chosenAccount ?? (open.length === 1 ? (open[0]?.id ?? null) : null);
  const categoryId = chosenCategory ?? spending[0]?.id ?? null;
  const incomeCategoryId = chosenIncome ?? incoming[0]?.id ?? null;
  const currency = open.find((a) => a.id === accountId)?.currency ?? home;
  const askSign = !preview.signFixed && !mapping.amountIn;
  const lines = sampleLines(preview, mapping, amountSign, moneyIn);

  if (summary) {
    const { heading, lines: said } = summaryText(summary);
    return (
      <>
        <Section title={heading} footer={summary.imported > 0 ? 'They’re in Needs review on Transactions, to check one by one.' : null}>
          {said.map((line) => (
            <Text key={line} style={[styles.body, { color: theme.text }]}>
              {line}
            </Text>
          ))}
        </Section>
        {summary.imported > 0 ? <FormButton label="Review Them" onPress={() => onFinish('review')} /> : null}
        <FormButton label="Done" onPress={() => onFinish()} />
      </>
    );
  }

  async function submit() {
    if (!session) return;
    const built = importBody(statement, text, { mapping, accountId, categoryId, amountSign, moneyIn, incomeCategoryId });
    if ('error' in built) return setError(built.error);
    setError(null);
    setSaving(true);
    try {
      const result = await importStatement(session, built.body);
      setSummary(result);
      void client.invalidateQueries({ queryKey: ['api'] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const loading = (accounts.isPending && !accounts.data) || (categories.isPending && !categories.data);
  const loadError = (accounts.error && !accounts.data) || (categories.error && !categories.data);
  const rows = preview.rowCount === 1 ? '1 transaction' : `${preview.rowCount.toLocaleString()} transactions`;

  return (
    <>
      <Section footer={`${rows} in this ${preview.format === 'ofx' ? 'OFX' : 'CSV'} file. Nothing is booked until you import.`}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
          {statement.fileName}
        </Text>
      </Section>

      <LoadState loading={loading} error={loadError ? errorText(accounts.error ?? categories.error) : null} />

      <Section title="Book them as" footer="Rules you made still apply, as they do on the website.">
        <FormField label="Account">
          <Host matchContents>
            <Picker selectedValue={accountId ?? NONE} onValueChange={(v) => setAccount(v === NONE ? null : String(v))}>
              <Picker.Item label="Pick one" value={NONE} />
              {open.map((a) => (
                <Picker.Item key={a.id} label={a.name} value={a.id} />
              ))}
            </Picker>
          </Host>
        </FormField>
        <FormField label="Category" note="For spending.">
          <Host matchContents>
            <Picker selectedValue={categoryId ?? NONE} onValueChange={(v) => setCategory(v === NONE ? null : String(v))}>
              {categoryId ? null : <Picker.Item label="Pick one" value={NONE} />}
              {spending.map((c) => (
                <Picker.Item key={c.id} label={c.name} value={c.id} />
              ))}
            </Picker>
          </Host>
        </FormField>
        <FormField
          label="Money In"
          note={moneyIn === 'refund' ? 'Refunds lower spending in their category.' : 'Deposits are booked as income.'}>
          <Host matchContents>
            <Picker selectedValue={moneyIn} onValueChange={(v) => setMoneyIn(v === 'income' ? 'income' : 'refund')}>
              <Picker.Item label="Refund" value="refund" />
              {incoming.length > 0 ? <Picker.Item label="Income" value="income" /> : null}
            </Picker>
          </Host>
        </FormField>
        {moneyIn === 'income' ? (
          <FormField label="Income Category">
            <Host matchContents>
              <Picker selectedValue={incomeCategoryId ?? NONE} onValueChange={(v) => setIncome(v === NONE ? null : String(v))}>
                {incoming.map((c) => (
                  <Picker.Item key={c.id} label={c.name} value={c.id} />
                ))}
              </Picker>
            </Host>
          </FormField>
        ) : null}
        {askSign ? (
          <FormField label="Amounts" note="Most bank exports show spending as negative. Check the rows below.">
            <Host matchContents>
              <Picker selectedValue={amountSign} onValueChange={(v) => setAmountSign(v === 'spending-negative' ? 'spending-negative' : 'spending-positive')}>
                <Picker.Item label="Spending is positive" value="spending-positive" />
                <Picker.Item label="Spending is negative" value="spending-negative" />
              </Picker>
            </Host>
          </FormField>
        ) : null}
      </Section>

      <Section title="The first rows" footer="Rows already in your log are skipped, so sharing the file again adds nothing.">
        {lines.map((line, index) => (
          <Line key={index} line={line} currency={currency} />
        ))}
      </Section>

      <Section title="Columns" footer="Guessed from the file, as the website does. Each column fills one field at most.">
        {IMPORT_FIELDS.map(({ field, label, note }) => (
          <FormField key={field} label={label} note={field === 'amount' || mapping[field] ? note : null}>
            <Host matchContents>
              <Picker selectedValue={mapping[field] ?? NONE} onValueChange={(v) => setMapping((m) => setColumn(m, field, v === NONE ? null : String(v)))}>
                <Picker.Item label="Not in the file" value={NONE} />
                {preview.headers.map((header) => (
                  <Picker.Item key={header} label={header} value={header} />
                ))}
              </Picker>
            </Host>
          </FormField>
        ))}
      </Section>

      {error ? <Text style={[formStyles.error, { color: theme.danger }]}>{error}</Text> : null}
      <FormButton label={saving ? 'Importing…' : `Import ${rows}`} onPress={() => void submit()} disabled={saving || loading} />
    </>
  );
}

const KIND: Record<SampleLine['kind'], string> = {
  spending: 'Spending',
  refund: 'Refund',
  income: 'Income',
  skipped: 'Left out: no amount',
};

function Line({ line, currency }: { line: SampleLine; currency: string }) {
  const theme = useTheme();
  const amount = line.cents === null ? '' : `${line.kind === 'spending' ? '' : '+'}${formatCents(line.cents, currency)}`;
  return (
    <View style={styles.row} accessible accessibilityLabel={`${line.title ?? 'No title'}, ${line.date ?? 'no date'}, ${KIND[line.kind]} ${amount}`}>
      <View style={styles.text}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {line.title ?? 'No title'}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          {line.date ?? 'No date'} · {KIND[line.kind]}
        </Text>
      </View>
      <Text style={[styles.amount, { color: line.kind === 'spending' ? theme.text : theme.positive }]}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  small: { fontSize: 13 },
  amount: { fontSize: 17, fontVariant: ['tabular-nums'] },
});
