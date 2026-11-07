import { describe, expect, it } from 'vitest';

import { applyQuestion, canMakeRules, makeRuleBody, makeRuleForm, ruleSentence } from './transaction-rules';

const me = { user: { id: 'u', email: 'a@b.c', displayName: 'A', timezone: 'UTC', countryCode: 'US', currency: 'USD' }, device: { id: 'd' } };

describe('make a rule', () => {
  it('is offered only by a server that says it takes rules', () => {
    expect(canMakeRules(me)).toBe(false);
    expect(canMakeRules({ ...me, features: ['rules'] })).toBe(true);
    expect(canMakeRules(undefined)).toBe(false);
  });

  it('starts from the entry, and sends only what the rule sets', () => {
    const form = makeRuleForm({ title: ' Tim Hortons ', type: 'expense', categoryId: 'coffee', accountId: 'visa', match: 'nonsense' });
    expect(form).toMatchObject({ match: 'contains', text: 'Tim Hortons', categoryId: 'coffee', accountId: 'visa', onlyAccount: false });
    expect(makeRuleBody(form)).toEqual({
      body: { match: 'contains', texts: ['Tim Hortons'], type: 'expense', accountId: null, categoryId: 'coffee', rename: null, tag: null },
    });
    expect(makeRuleBody({ ...form, onlyAccount: true, match: 'is', tag: ' Treats ' })).toMatchObject({
      body: { match: 'is', accountId: 'visa', tag: 'Treats' },
    });
  });

  it('refuses a rule with nothing to match or nothing to set', () => {
    const form = makeRuleForm({ title: 'Tim' });
    expect(makeRuleBody({ ...form, text: '  ' })).toEqual({ error: 'Enter the text the title should match.' });
    expect(makeRuleBody(form)).toEqual({ error: 'Choose a category, a new title or a tag for the rule to set.' });
  });

  it('reads the rule back as a sentence, and asks about past entries only when there are some', () => {
    const form = { ...makeRuleForm({ title: 'Tim Hortons', categoryId: 'coffee', accountId: 'visa' }), onlyAccount: true, tag: 'Treats' };
    expect(ruleSentence(form, 'Coffee', 'Visa')).toBe('Every expense on Visa whose title contains “Tim Hortons” goes to Coffee, and is tagged Treats.');
    expect(ruleSentence({ ...form, onlyAccount: false, tag: '', type: 'income', match: 'is' }, 'Pay', null)).toBe(
      'Every income entry whose title is “Tim Hortons” goes to Pay.',
    );
    expect(applyQuestion(0)).toBeNull();
    expect(applyQuestion(1)?.title).toBe('Change 1 past entry too?');
    expect(applyQuestion(3)?.message).toContain('Changing them');
  });
});
