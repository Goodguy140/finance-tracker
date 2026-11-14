import type { AppRule, Me } from '@/api/types';
import { RULES_PATH, type RuleMatch } from '@/utils/transaction-rules';

/** Changing, turning off, reordering and deleting rules already made (`/api/v1/rules/:id`). */

export function canEditRules(me: Me | undefined): boolean {
  return me?.features?.includes('rule-edits') ?? false;
}

export const RULE_LIST_PATH = RULES_PATH;

export function rulePath(id: string): string {
  return `${RULES_PATH}/${encodeURIComponent(id)}`;
}

export type RuleType = AppRule['type'];

export const TYPE_OPTIONS: readonly { value: RuleType; label: string }[] = [
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: null, label: 'Either' },
];

export type EditRuleForm = {
  match: RuleMatch;
  /** One text to match per line; any one matching is enough. */
  texts: string;
  type: RuleType;
  /** Empty for any account. */
  accountId: string;
  /** Empty leaves the category alone. */
  categoryId: string;
  rename: string;
  tag: string;
};

export function editRuleForm(rule: AppRule): EditRuleForm {
  return {
    match: rule.match,
    texts: rule.texts.join('\n'),
    type: rule.type,
    accountId: rule.accountId ?? '',
    categoryId: rule.categoryId ?? '',
    rename: rule.rename ?? '',
    tag: rule.tag ?? '',
  };
}

function textLines(texts: string): string[] {
  return texts
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/** Whether the rule sets something the phone doesn't show, so it still does something with the rest cleared. */
function setsMoreOnWebsite(rule: AppRule): boolean {
  return rule.alsoOnWebsite.some((part) => part !== 'an amount range');
}

/**
 * The `PATCH` body for what the form changed, nothing when it changed nothing, or why it can't be
 * saved. Only changed fields are sent, so what the website alone edits is never touched.
 */
export function editRuleBody(form: EditRuleForm, rule: AppRule): { body: Record<string, unknown> } | { error: string } | null {
  const texts = textLines(form.texts);
  const rename = form.rename.trim();
  const tag = form.tag.trim();
  const body: Record<string, unknown> = {};
  if (form.match !== rule.match) body.match = form.match;
  if (texts.join('\n') !== rule.texts.join('\n')) body.texts = texts;
  if (form.type !== rule.type) body.type = form.type;
  if ((form.accountId || null) !== rule.accountId) body.accountId = form.accountId || null;
  if ((form.categoryId || null) !== rule.categoryId) body.categoryId = form.categoryId || null;
  if ((rename || null) !== rule.rename) body.rename = rename || null;
  if ((tag || null) !== rule.tag) body.tag = tag || null;
  if (Object.keys(body).length === 0) return null;
  if (texts.length === 0) return { error: 'Enter the text the title should match.' };
  if (!form.categoryId && !rename && !tag && !setsMoreOnWebsite(rule)) {
    return { error: 'Choose a category, a new title or a tag for the rule to set.' };
  }
  return { body };
}

/** "This rule also has a split and a note, set on the website; changes here keep them as they are." */
export function alsoOnWebsiteLine(rule: AppRule): string | null {
  const parts = [...rule.alsoOnWebsite];
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  const list = parts.length ? `${parts.join(', ')} and ${last}` : last;
  return `This rule also has ${list}, set on the website; changes here keep ${rule.alsoOnWebsite.length === 1 ? 'it' : 'them'} as ${rule.alsoOnWebsite.length === 1 ? 'it is' : 'they are'}.`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** "Runs 2nd of 5." — rules run top to bottom, and the first that sets a field wins it. */
export function orderLine(position: number, count: number): string {
  if (count <= 1) return 'Your only rule.';
  return `Runs ${ordinal(position)} of ${count}.`;
}
