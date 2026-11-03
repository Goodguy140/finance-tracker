/** How wide a swipe row's button is once the row is open. */
export const SWIPE_ACTION_WIDTH = 96;

/**
 * Where a dragged row sits. It never moves toward a side with no button, and past its button it
 * follows the finger at a quarter of the distance, so the edge is felt rather than hit.
 */
export function clampSwipe(x: number, width: number, leading: boolean, trailing: boolean): number {
  'worklet';
  const max = leading ? width : 0;
  const min = trailing ? -width : 0;
  if (x > max) return leading ? max + (x - max) / 4 : max;
  if (x < min) return trailing ? min + (x - min) / 4 : min;
  return x;
}

/**
 * Where a released row comes to rest: open on the side it was dragged to once past half its button,
 * or sooner with a flick (counted as far as the flick would carry it in a fifth of a second).
 * Dragging an open row back toward the middle closes it rather than opening the other side.
 */
export function settleSwipe(x: number, velocityX: number, width: number, leading: boolean, trailing: boolean): number {
  'worklet';
  const projected = x + velocityX * 0.2;
  if (leading && x > 0 && projected > width / 2) return width;
  if (trailing && x < 0 && projected < -width / 2) return -width;
  return 0;
}
