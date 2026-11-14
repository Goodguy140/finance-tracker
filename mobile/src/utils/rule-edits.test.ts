import { describe, expect, it } from 'vitest';

import type { AppRule, Me } from '@/api/types';
import { alsoOnWebsiteLine, canEditRules, editRuleBody, editRuleForm, orderLine } from '@/utils/rule-edits';

const rule: AppRule = {
  id: 'r1',
  enabled: true,
  position: 2,
  condition: 'Title contains “tim”, expenses only',
  actions: 'category → Coffee',
  match: 'contains',
  texts: ['tim', 'tims'],
  type: 'expense',
  accountId: null,
  categoryId: 'coffee',
  rename: null,
  tag: null,
  alsoOnWebsite: [],
};

describe('canEditRules', () => {
  it('needs a server that takes rule changes', () => {
    expect(canEditRules({ features: ['rules', 'rule-edits'] } as Me)).toBe(true);
    expect(canEditRules({ features: ['rules'] } as Me)).toBe(false);
  });
});

describe('editRuleBody', () => {
  it('sends nothing for an untouched form, and only the fields changed otherwise', () => {
    expect(editRuleBody(editRuleForm(rule), rule)).toBeNull();
    const form = { ...editRuleForm(rule), texts: ' tim \n\nTim Hortons\n', rename: ' Tim Hortons ', accountId: 'chq' };
    expect(editRuleBody(form, rule)).toStrictEqual({ body: { texts: ['tim', 'Tim Hortons'], accountId: 'chq', rename: 'Tim Hortons' } });
    expect(editRuleBody({ ...editRuleForm(rule), type: null, categoryId: '', tag: 'Treats' }, rule)).toStrictEqual({
      body: { type: null, categoryId: null, tag: 'Treats' },
    });
  });

  it('refuses a rule left matching nothing or setting nothing, unless the website sets more', () => {
    expect(editRuleBody({ ...editRuleForm(rule), texts: ' \n ' }, rule)).toHaveProperty('error');
    expect(editRuleBody({ ...editRuleForm(rule), categoryId: '' }, rule)).toHaveProperty('error');
    expect(editRuleBody({ ...editRuleForm(rule), categoryId: '' }, { ...rule, alsoOnWebsite: ['an amount range'] })).toHaveProperty('error');
    expect(editRuleBody({ ...editRuleForm(rule), categoryId: '' }, { ...rule, alsoOnWebsite: ['a note'] })).toStrictEqual({
      body: { categoryId: null },
    });
  });
});

describe('alsoOnWebsiteLine and orderLine', () => {
  it('names what the website keeps, and where the rule runs', () => {
    expect(alsoOnWebsiteLine(rule)).toBeNull();
    expect(alsoOnWebsiteLine({ ...rule, alsoOnWebsite: ['a note'] })).toBe(
      'This rule also has a note, set on the website; changes here keep it as it is.',
    );
    expect(alsoOnWebsiteLine({ ...rule, alsoOnWebsite: ['an amount range', 'a split', 'a note'] })).toBe(
      'This rule also has an amount range, a split and a note, set on the website; changes here keep them as they are.',
    );
    expect([orderLine(1, 1), orderLine(2, 5), orderLine(3, 3), orderLine(11, 12), orderLine(22, 30)]).toEqual([
      'Your only rule.',
      'Runs 2nd of 5.',
      'Runs 3rd of 3.',
      'Runs 11th of 12.',
      'Runs 22nd of 30.',
    ]);
  });
});
