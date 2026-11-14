import type { BudgetSuggestionSet, CategoryDetail, Me, Tag } from '@/api/types';
import { formatCents } from '@/utils/money';
import { parseAmountInput } from '@/utils/transactions';

/** Settings → Categories, Suggest budgets and tidying tags, on servers that list `category-edits` in `/api/v1/me`. */
export function canEditCategories(me: Pick<Me, 'features'> | undefined): boolean {
  return me?.features?.includes('category-edits') ?? false;
}

export const CATEGORY_DETAILS_PATH = '/api/v1/categories?details=1';
export const BUDGET_SUGGESTIONS_PATH = '/api/v1/budgets/suggestions';
export const MAX_CATEGORY_NAME = 80;

export function categoryPath(id: string): string {
  return `/api/v1/categories/${encodeURIComponent(id)}`;
}

export function tagPath(id: string): string {
  return `/api/v1/tags/${encodeURIComponent(id)}`;
}

/** As the server tidies a name: trimmed, inner spaces collapsed. */
function tidy(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Spending under its groups (ungrouped last), then income; the transfer category is the app's own. */
export function categorySections(categories: readonly CategoryDetail[]): { title: string; items: CategoryDetail[] }[] {
  const byName = (a: CategoryDetail, b: CategoryDetail) => a.name.localeCompare(b.name);
  const spending = categories.filter((c) => c.kind === 'expense');
  const groups = [...new Set(spending.flatMap((c) => (c.groupName ? [c.groupName] : [])))].sort((a, b) => a.localeCompare(b));
  const sections = groups.map((g) => ({ title: `Spending · ${g}`, items: spending.filter((c) => c.groupName === g).sort(byName) }));
  const loose = spending.filter((c) => !c.groupName).sort(byName);
  if (loose.length > 0) sections.push({ title: groups.length > 0 ? 'Spending · No group' : 'Spending', items: loose });
  const income = categories.filter((c) => c.kind === 'income').sort(byName);
  if (income.length > 0) sections.push({ title: 'Income', items: income });
  return sections;
}

export function usesLine(uses: number): string {
  if (uses === 0) return 'Not used yet';
  return `Used ${uses} time${uses === 1 ? '' : 's'}`;
}

/** Another category of the kind with this name, ignoring case: renaming into it merges the two. */
export function sameNameCategory(
  categories: readonly CategoryDetail[],
  kind: CategoryDetail['kind'],
  name: string,
  exceptId?: string,
): CategoryDetail | undefined {
  const key = tidy(name).toLowerCase();
  return categories.find((c) => c.kind === kind && c.id !== exceptId && c.name.toLowerCase() === key);
}

/** Where a deleted category's entries can go: the others of its kind. */
export function moveTargets(categories: readonly CategoryDetail[], category: CategoryDetail): CategoryDetail[] {
  return categories.filter((c) => c.kind === category.kind && c.id !== category.id).sort((a, b) => a.name.localeCompare(b.name));
}

function checkedName(raw: string): string | { error: string } {
  const name = tidy(raw);
  if (!name) return { error: 'Enter a name for the category.' };
  if (name.length > MAX_CATEGORY_NAME) return { error: `Category names can be at most ${MAX_CATEGORY_NAME} characters.` };
  return name;
}

export type NewCategoryForm = { name: string; kind: 'expense' | 'income'; limit: string };

/** `POST /api/v1/categories`: a budget only for spending, and only when one is typed. */
export function newCategoryBody(
  form: NewCategoryForm,
  categories: readonly CategoryDetail[],
): { body: { name: string; kind: string; limitCents?: number } } | { error: string } {
  const name = checkedName(form.name);
  if (typeof name !== 'string') return name;
  if (sameNameCategory(categories, form.kind, name)) return { error: `You already have a category called “${name}”.` };
  if (form.kind === 'expense' && form.limit.trim()) {
    const cents = parseAmountInput(form.limit);
    if (cents === null || cents <= 0) return { error: 'Enter a monthly limit above zero.' };
    return { body: { name, kind: form.kind, limitCents: cents } };
  }
  return { body: { name, kind: form.kind } };
}

export type CategoryForm = { name: string; groupName: string; spendingRole: 'need' | 'want' | 'auto' };

export function categoryForm(category: CategoryDetail): CategoryForm {
  return { name: category.name, groupName: category.groupName ?? '', spendingRole: category.spendingRole ?? 'auto' };
}

/** `PATCH /api/v1/categories/:id` with only what changed; null when nothing did. */
export function categoryPatch(form: CategoryForm, category: CategoryDetail): { body: Record<string, unknown> } | { error: string } | null {
  const name = checkedName(form.name);
  if (typeof name !== 'string') return name;
  const body: Record<string, unknown> = {};
  if (name !== category.name) body.name = name;
  const group = tidy(form.groupName);
  if (group !== (category.groupName ?? '')) body.groupName = group || null;
  if (category.kind === 'expense') {
    const role = form.spendingRole === 'auto' ? null : form.spendingRole;
    if (role !== category.spendingRole) body.spendingRole = role;
  }
  return Object.keys(body).length > 0 ? { body } : null;
}

/** The groups already in use, to pick from. */
export function groupNames(categories: readonly CategoryDetail[]): string[] {
  return [...new Set(categories.flatMap((c) => (c.groupName ? [c.groupName] : [])))].sort((a, b) => a.localeCompare(b));
}

/** Suggest budgets: a row's tick and amount. Ones already budgeted start unticked, as on the website. */
export type SuggestionPick = { ticked: boolean; amount: string };

export function initialPicks(set: BudgetSuggestionSet): Record<string, SuggestionPick> {
  return Object.fromEntries(
    set.rows.map((row) => [row.categoryId, { ticked: row.currentLimitCents === null, amount: (row.suggestedCents / 100).toFixed(0) }]),
  );
}

/** The ticked rows to set, or the first ticked one whose amount is not one. */
export function pickedBudgets(
  set: BudgetSuggestionSet,
  picks: Record<string, SuggestionPick>,
): { budgets: { categoryId: string; limitCents: number }[] } | { error: string } {
  const budgets: { categoryId: string; limitCents: number }[] = [];
  for (const row of set.rows) {
    const pick = picks[row.categoryId];
    if (!pick?.ticked) continue;
    const cents = parseAmountInput(pick.amount);
    if (cents === null || cents <= 0) return { error: `Enter a monthly amount above zero for ${row.categoryName}.` };
    budgets.push({ categoryId: row.categoryId, limitCents: cents });
  }
  return { budgets };
}

/** Every budget this month once the ticked ones are set. */
export function totalAfter(current: readonly { categoryId: string; limitCents: number }[], picked: readonly { categoryId: string; limitCents: number }[]): number {
  const merged = new Map(current.map((b) => [b.categoryId, b.limitCents]));
  for (const b of picked) merged.set(b.categoryId, b.limitCents);
  return [...merged.values()].reduce((sum, cents) => sum + cents, 0);
}

/** The website's line under the list: the total against average income. */
export function incomeLine(averageIncomeCents: number, totalCents: number, currency: string): string | null {
  if (averageIncomeCents <= 0) return null;
  const money = (cents: number) => formatCents(cents, currency);
  return `Average income ${money(averageIncomeCents)} a month, ${
    totalCents > averageIncomeCents ? `${money(totalCents - averageIncomeCents)} more than comes in` : `leaving ${money(averageIncomeCents - totalCents)}`
  }.`;
}

/** "Aug $420.00 · Sep $1,200.00 (one-off, passed over) · Oct $380.00". */
export function monthsLine(row: BudgetSuggestionSet['rows'][number], months: BudgetSuggestionSet['months'], currency: string): string {
  return months
    .map((m, i) => `${m.label} ${formatCents(row.monthlyCents[i] ?? 0, currency)}${row.spikeMonths.includes(m.month) ? ' (one-off, passed over)' : ''}`)
    .join(' · ');
}

/** A tag name as the server tidies it: commas to spaces, spaces collapsed, no leading #. */
export function tidyTagName(raw: string): string {
  return tidy(raw.replace(/,/g, ' ')).replace(/^#+\s*/, '');
}

/** Another tag with this name, ignoring case: renaming into it merges the two. */
export function sameNameTag(tags: readonly Tag[], name: string, exceptId: string): Tag | undefined {
  const key = tidyTagName(name).toLowerCase();
  return tags.find((t) => t.id !== exceptId && t.name.toLowerCase() === key);
}
