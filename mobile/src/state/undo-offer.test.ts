import { describe, expect, it } from 'vitest';

import { clearUndo, currentUndo, offerUndo, undoOfferId } from './undo-offer';

describe('undo offer', () => {
  it('holds the latest offer, and is cleared only by its own id or by none', () => {
    offerUndo({ kind: 'deleted', undoId: 'u1', label: 'Lunch' }, 1);
    offerUndo({ kind: 'added', transactionId: 't2', label: 'Coffee' }, 2);
    expect(currentUndo()).toEqual({ kind: 'added', transactionId: 't2', label: 'Coffee', offeredAt: 2 });
    clearUndo('deleted:u1');
    expect(currentUndo()).not.toBeNull();
    // An add and a delete never share an id, even with the same value.
    clearUndo(undoOfferId({ kind: 'deleted', undoId: 't2', label: '' }));
    expect(currentUndo()).not.toBeNull();
    clearUndo('added:t2');
    expect(currentUndo()).toBeNull();
    offerUndo({ kind: 'deleted', undoId: 'u3', label: 'Tea' }, 3);
    clearUndo();
    expect(currentUndo()).toBeNull();
  });
});
