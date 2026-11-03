import { describe, expect, it } from 'vitest';

import { clampSwipe, settleSwipe } from './swipe';

const W = 96;

describe('clampSwipe', () => {
  it('follows the finger up to the button on a side that has one', () => {
    expect(clampSwipe(40, W, true, true)).toBe(40);
    expect(clampSwipe(-40, W, true, true)).toBe(-40);
  });

  it('never moves toward a side with no button', () => {
    expect(clampSwipe(40, W, false, true)).toBe(0);
    expect(clampSwipe(-40, W, true, false)).toBe(0);
  });

  it('moves a quarter as far past the button', () => {
    expect(clampSwipe(W + 40, W, true, false)).toBe(W + 10);
    expect(clampSwipe(-W - 40, W, false, true)).toBe(-W - 10);
  });
});

describe('settleSwipe', () => {
  it('opens a side dragged past half its button', () => {
    expect(settleSwipe(50, 0, W, true, true)).toBe(W);
    expect(settleSwipe(-50, 0, W, true, true)).toBe(-W);
  });

  it('springs back from a short drag', () => {
    expect(settleSwipe(30, 0, W, true, true)).toBe(0);
    expect(settleSwipe(-30, 0, W, true, true)).toBe(0);
  });

  it('opens on a flick even before half way', () => {
    expect(settleSwipe(20, 600, W, true, true)).toBe(W);
    expect(settleSwipe(-20, -600, W, true, true)).toBe(-W);
  });

  it('closes an open row flicked back rather than opening the other side', () => {
    expect(settleSwipe(W - 10, -2000, W, true, true)).toBe(0);
    expect(settleSwipe(-W + 10, 2000, W, true, true)).toBe(0);
  });

  it('never opens a side with no button', () => {
    expect(settleSwipe(80, 0, W, false, true)).toBe(0);
    expect(settleSwipe(-80, 0, W, true, false)).toBe(0);
  });
});
