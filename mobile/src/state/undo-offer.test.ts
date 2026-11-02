import { describe, expect, it } from 'vitest';

import { clearUndo, currentUndo, offerUndo } from './undo-offer';

describe('undo offer', () => {
  it('holds the latest deletion, and is cleared only by its own id or by none', () => {
    offerUndo('u1', 'Lunch', 1);
    offerUndo('u2', 'Coffee', 2);
    expect(currentUndo()).toEqual({ undoId: 'u2', label: 'Coffee', offeredAt: 2 });
    clearUndo('u1');
    expect(currentUndo()?.undoId).toBe('u2');
    clearUndo();
    expect(currentUndo()).toBeNull();
  });
});
