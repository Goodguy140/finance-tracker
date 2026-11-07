import type { Me } from '@/api/types';

/** Rules made on the phone: "Always file Tim Hortons as Coffee", from an entry, a bank row or a suggestion. */

export const RULES_PATH = '/api/v1/rules';
export const RULE_SUGGESTIONS_PATH = '/api/v1/rules/suggestions';

export function canMakeRules(me: Me | undefined): boolean {
  return me?.features?.includes('rules') ?? false;
}

export type RuleMatch = 'contains' | 'is' | 'starts_with';

export const MATCH_OPTIONS: readonly { value: RuleMatch; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'is', label: 'Is exactly' },
  { value: 'starts_with', label: 'Starts with' },
];

export type MakeRuleForm = {
  match: RuleMatch;
  text: string;
  type: 'expense' | 'income';
  /** The account the entry came from, offered as "Only on …"; null when there is none. */
  accountId: string | null;
  onlyAccount: boolean;
  /** Empty leaves the category alone. */
  categoryId: string;
  rename: string;
  tag: string;
};

/** What a sheet opened from somewhere starts with. Route params arrive as strings. */
export function makeRuleForm(params: {
  title?: string;
  type?: string;
  categoryId?: string;
  accountId?: string;
  match?: string;
}): MakeRuleForm {
  const match = MATCH_OPTIONS.find((m) => m.value === params.match)?.value ?? 'contains';
  return {
    match,
    text: params.title?.trim() ?? '',
    type: params.type === 'income' ? 'income' : 'expense',
    accountId: params.accountId || null,
    onlyAccount: false,
    categoryId: params.categoryId ?? '',
    rename: '',
    tag: '',
  };
}

export function makeRuleBody(form: MakeRuleForm): { body: Record<string, unknown> } | { error: string } {
  const text = form.text.trim();
  if (!text) return { error: 'Enter the text the title should match.' };
  const rename = form.rename.trim();
  const tag = form.tag.trim();
  if (!form.categoryId && !rename && !tag) return { error: 'Choose a category, a new title or a tag for the rule to set.' };
  return {
    body: {
      match: form.match,
      texts: [text],
      type: form.type,
      accountId: form.onlyAccount && form.accountId ? form.accountId : null,
      categoryId: form.categoryId || null,
      rename: rename || null,
      tag: tag || null,
    },
  };
}

/** "Every expense whose title contains “Tim Hortons” goes to Coffee, and is tagged Treats." */
export function ruleSentence(form: MakeRuleForm, categoryName: string | null, accountName: string | null): string {
  const how = { contains: 'contains', is: 'is', starts_with: 'starts with' }[form.match];
  const subject = `Every ${form.type === 'income' ? 'income entry' : 'expense'}${
    form.onlyAccount && accountName ? ` on ${accountName}` : ''
  } whose title ${how} “${form.text.trim()}”`;
  const parts = [
    categoryName ? `goes to ${categoryName}` : null,
    form.rename.trim() ? `is renamed ${form.rename.trim()}` : null,
    form.tag.trim() ? `is tagged ${form.tag.trim()}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return `${subject}.`;
  const last = parts.pop()!;
  return `${subject} ${parts.length ? `${parts.join(', ')}, and ${last}` : last}.`;
}

/** The question asked once a rule is saved and fits entries already logged; null when it fits none. */
export function applyQuestion(matches: number): { title: string; message: string } | null {
  if (matches <= 0) return null;
  const entries = matches === 1 ? 'entry' : 'entries';
  return {
    title: `Change ${matches} past ${entries} too?`,
    message: `The rule fits ${matches} ${entries} already in your log. Changing ${matches === 1 ? 'it' : 'them'} sets what the rule sets; amounts stay as they are.`,
  };
}
