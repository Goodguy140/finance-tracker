import { describe, expect, it } from 'vitest';

import {
  addSection,
  DEFAULT_HOME_LAYOUT,
  hiddenSections,
  HOME_SECTIONS,
  isDefaultHomeLayout,
  moveSections,
  removeSection,
  resolveHomeLayout,
  storedHomeLayout,
  type HomeLayout,
} from './home-layout';

const ALL = HOME_SECTIONS.map((section) => section.id);

describe('resolveHomeLayout', () => {
  it('is the default until something readable was kept', () => {
    expect(DEFAULT_HOME_LAYOUT).toEqual(['safe-to-spend', 'waiting', 'spending', 'budgets', 'coming-up', 'score', 'net-worth']);
    expect(resolveHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT);
    expect(resolveHomeLayout('nonsense')).toEqual(DEFAULT_HOME_LAYOUT);
    expect(resolveHomeLayout({ shown: 'budgets' })).toEqual(DEFAULT_HOME_LAYOUT);
  });

  it('keeps the order and the cards taken off', () => {
    const kept = storedHomeLayout(['budgets', 'recent', 'safe-to-spend']);
    expect(resolveHomeLayout(JSON.parse(JSON.stringify(kept)))).toEqual(['budgets', 'recent', 'safe-to-spend']);
  });

  it('keeps an empty Home empty', () => {
    expect(resolveHomeLayout(storedHomeLayout([]))).toEqual([]);
  });

  it('drops cards this version does not have, and repeats', () => {
    expect(resolveHomeLayout({ shown: ['budgets', 'gone', 'budgets', 7, 'score'], known: ALL })).toEqual(['budgets', 'score']);
  });

  it('brings in a card that is new since Home was arranged, after the card it follows by default', () => {
    // Arranged before Spending charts existed, with Budgets moved to the top.
    const known = ALL.filter((id) => id !== 'spending');
    expect(resolveHomeLayout({ shown: ['budgets', 'safe-to-spend', 'waiting', 'score'], known })).toEqual([
      'budgets',
      'safe-to-spend',
      'waiting',
      'spending',
      'score',
    ]);
  });

  it('puts a new card first when nothing that comes before it by default is on Home', () => {
    const known = ALL.filter((id) => id !== 'safe-to-spend');
    expect(resolveHomeLayout({ shown: ['score'], known })).toEqual(['safe-to-spend', 'score']);
  });

  it('leaves a new card off when a fresh Home would not have it, and never brings back one taken off', () => {
    const known = ALL.filter((id) => id !== 'recent');
    expect(resolveHomeLayout({ shown: ['score'], known })).toEqual(['score']);
    expect(resolveHomeLayout(storedHomeLayout(['score']))).toEqual(['score']);
  });
});

describe('moveSections', () => {
  const layout: HomeLayout = ['safe-to-spend', 'waiting', 'spending', 'budgets'];

  it('moves a card down, the destination counted before it was lifted', () => {
    expect(moveSections(layout, [0], 3)).toEqual(['waiting', 'spending', 'safe-to-spend', 'budgets']);
    expect(moveSections(layout, [0], 4)).toEqual(['waiting', 'spending', 'budgets', 'safe-to-spend']);
  });

  it('moves a card up', () => {
    expect(moveSections(layout, [3], 0)).toEqual(['budgets', 'safe-to-spend', 'waiting', 'spending']);
    expect(moveSections(layout, [2], 1)).toEqual(['safe-to-spend', 'spending', 'waiting', 'budgets']);
  });

  it('moves several cards together, in their order', () => {
    expect(moveSections(layout, [3, 0], 2)).toEqual(['waiting', 'safe-to-spend', 'budgets', 'spending']);
  });

  it('gives back the same layout for a drop where it started, or nothing to move', () => {
    expect(moveSections(layout, [1], 1)).toBe(layout);
    expect(moveSections(layout, [1], 2)).toBe(layout);
    expect(moveSections(layout, [9], 0)).toBe(layout);
  });
});

describe('adding and taking off', () => {
  it('adds a card at the bottom, once', () => {
    expect(addSection(['score'], 'recent')).toEqual(['score', 'recent']);
    const layout: HomeLayout = ['score'];
    expect(addSection(layout, 'score')).toBe(layout);
  });

  it('takes a card off and lists it under More cards, in the default order', () => {
    const layout = removeSection(removeSection(DEFAULT_HOME_LAYOUT, 'budgets'), 'safe-to-spend');
    expect(layout).not.toContain('budgets');
    expect(hiddenSections(layout)).toEqual(['safe-to-spend', 'budgets', 'recent', 'insights']);
  });

  it('knows the default, so Reset is offered only after a change', () => {
    expect(isDefaultHomeLayout(DEFAULT_HOME_LAYOUT)).toBe(true);
    expect(isDefaultHomeLayout(moveSections(DEFAULT_HOME_LAYOUT, [0], 2))).toBe(false);
    expect(isDefaultHomeLayout(addSection(DEFAULT_HOME_LAYOUT, 'recent'))).toBe(false);
  });
});
