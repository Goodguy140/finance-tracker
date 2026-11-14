import { describe, expect, it } from 'vitest';

import {
  importBody,
  readStatementAmount,
  sampleLines,
  setColumn,
  statementFromShares,
  summaryText,
  type ImportChoices,
  type StatementPreview,
} from '@/utils/statement-import';

describe('a statement shared to the app', () => {
  it('is told from a receipt by its type or its name', () => {
    expect(statementFromShares([{ contentUri: 'file:///a/October.csv', contentMimeType: 'text/csv', originalName: 'October.csv', contentSize: 900 }])).toEqual({
      statement: { uri: 'file:///a/October.csv', fileName: 'October.csv', sizeBytes: 900, format: 'csv' },
    });
    // Mail hands over the bytes: a made-up name, but the extension iOS gave the type.
    expect(statementFromShares([{ contentUri: 'file:///g/8F2A.qfx', contentMimeType: 'application/octet-stream', originalName: '8F2A.qfx' }])).toMatchObject({
      statement: { format: 'ofx' },
    });
    expect(statementFromShares([{ contentUri: 'file:///g/x', contentMimeType: 'application/x-ofx', originalName: null }])).toMatchObject({
      statement: { format: 'ofx', fileName: 'statement.ofx' },
    });
    // A receipt is left to the receipt screen.
    expect(statementFromShares([{ contentUri: 'file:///a/r.pdf', contentMimeType: 'application/pdf', originalName: 'r.pdf' }])).toBeNull();
    expect(statementFromShares([{ contentType: 'image', contentUri: 'file:///a/r.heic', contentMimeType: 'image/heic' }])).toBeNull();
  });

  it('is refused when it is larger than the server reads', () => {
    expect(statementFromShares([{ contentUri: 'file:///a/big.csv', originalName: 'big.csv', contentSize: 5 * 1024 * 1024 + 1 }])).toHaveProperty('error');
    expect(statementFromShares([{ contentUri: null, originalName: 'gone.csv' }])).toHaveProperty('error');
  });
});

describe('choosing columns', () => {
  it('gives each column one field at most', () => {
    const guessed = { date: 'Date', title: 'Description', amount: 'Debit' };
    expect(setColumn(guessed, 'note', 'Description')).toEqual({ date: 'Date', amount: 'Debit', note: 'Description' });
    expect(setColumn(guessed, 'amount', null)).toEqual({ date: 'Date', title: 'Description' });
    expect(setColumn(guessed, 'amountIn', 'Credit')).toEqual({ ...guessed, amountIn: 'Credit' });
  });
});

describe('the preview', () => {
  it('reads amounts as banks print them', () => {
    expect(readStatementAmount('$1,234.50')).toBe(1234.5);
    expect(readStatementAmount('(12.34)')).toBe(-12.34);
    expect(readStatementAmount('12.34-')).toBe(-12.34);
    expect(readStatementAmount('−5')).toBe(-5);
    expect(readStatementAmount('0.00')).toBeNull();
    expect(readStatementAmount('n/a')).toBeNull();
  });

  const preview: StatementPreview = {
    format: 'csv',
    headers: ['Date', 'Description', 'Amount', 'Debit', 'Credit'],
    rowCount: 3,
    sample: [
      { Date: '2026-10-03', Description: 'LOBLAWS', Amount: '-42.10', Debit: '42.10', Credit: '' },
      { Date: '2026-10-04', Description: 'REFUND', Amount: '15.00', Debit: '', Credit: '15.00' },
      { Date: '', Description: 'NOTHING', Amount: '', Debit: '', Credit: '' },
    ],
    mapping: { date: 'Date', title: 'Description', amount: 'Amount' },
    amountSign: 'spending-positive',
    signFixed: false,
  };

  it('shows which rows are spending and which are money in, by the sign chosen', () => {
    const asIs = sampleLines(preview, preview.mapping, 'spending-positive', 'refund');
    expect(asIs.map((l) => [l.kind, l.cents])).toEqual([
      ['refund', 4210],
      ['spending', 1500],
      ['skipped', null],
    ]);
    const flipped = sampleLines(preview, preview.mapping, 'spending-negative', 'income');
    expect(flipped.map((l) => [l.title, l.kind, l.cents])).toEqual([
      ['LOBLAWS', 'spending', 4210],
      ['REFUND', 'income', 1500],
      ['NOTHING', 'skipped', null],
    ]);
    expect(flipped[2]?.date).toBeNull();
  });

  it('reads Debit and Credit columns as sizes, whatever the sign', () => {
    const mapping = { date: 'Date', title: 'Description', amount: 'Debit', amountIn: 'Credit' };
    expect(sampleLines(preview, mapping, 'spending-negative', 'refund').map((l) => l.kind)).toEqual(['spending', 'refund', 'skipped']);
  });

  it('keeps the sign an OFX file gives', () => {
    const ofx: StatementPreview = { ...preview, format: 'ofx', amountSign: 'spending-negative', signFixed: true };
    expect(sampleLines(ofx, ofx.mapping, 'spending-positive', 'refund')[0]?.kind).toBe('spending');
  });
});

describe('importing', () => {
  const choices: ImportChoices = {
    mapping: { date: 'Date', title: 'Description', amount: 'Amount' },
    accountId: 'acc1',
    categoryId: 'cat1',
    amountSign: 'spending-negative',
    moneyIn: 'refund',
    incomeCategoryId: null,
  };
  const csv = { fileName: 'October.csv', format: 'csv' as const };

  it('sends the file with the choices the server books by', () => {
    expect(importBody(csv, 'text', choices)).toEqual({
      body: {
        fileName: 'October.csv',
        text: 'text',
        mapping: choices.mapping,
        accountId: 'acc1',
        categoryId: 'cat1',
        moneyIn: 'refund',
        amountSign: 'spending-negative',
      },
    });
    const income = importBody(csv, 'text', { ...choices, moneyIn: 'income', incomeCategoryId: 'pay' });
    expect(income).toMatchObject({ body: { moneyIn: 'income', incomeCategoryId: 'pay' } });
    // The sign is the file's own for OFX, and moot with a Credit column.
    expect(importBody({ ...csv, format: 'ofx' }, 'text', choices)).not.toHaveProperty('body.amountSign');
    expect(importBody(csv, 'text', { ...choices, mapping: { ...choices.mapping, amountIn: 'Credit' } })).not.toHaveProperty('body.amountSign');
  });

  it('says what is missing before sending', () => {
    expect(importBody(csv, 't', { ...choices, accountId: null })).toHaveProperty('error');
    expect(importBody(csv, 't', { ...choices, categoryId: null })).toHaveProperty('error');
    expect(importBody(csv, 't', { ...choices, mapping: { date: 'Date' } })).toHaveProperty('error');
    expect(importBody(csv, 't', { ...choices, moneyIn: 'income' })).toHaveProperty('error');
  });

  it('words the result as the website does', () => {
    expect(summaryText({ imported: 3, income: 1, duplicates: [], unreadableDates: [], unreadableAmounts: 0 })).toEqual({
      heading: 'Imported 2 expenses and 1 income entry',
      lines: ['Every row in the file was imported.'],
    });
    const skipped = summaryText({
      imported: 1,
      income: 0,
      duplicates: [{ row: 2, title: 'A', date: '2026-10-01', amountCents: 100 }],
      unreadableDates: [{ row: 3, title: null, value: '31/31', field: 'date' }],
      unreadableAmounts: 2,
    });
    expect(skipped.heading).toBe('Imported 1 expense');
    expect(skipped.lines).toEqual([
      '1 skipped: already in your log.',
      '1 skipped: the date could not be read.',
      '2 rows were skipped for a missing or unreadable amount.',
    ]);
  });
});
