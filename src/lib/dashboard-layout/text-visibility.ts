/**
 * How much of a card's text a reader can actually see. Browser-only: it reads layout.
 *
 * Per card rather than per column: a card with every date cut off still reads as 90% visible
 * once its neighbours' text is counted alongside it.
 *
 * Text counts as cut off when its laid-out box runs sideways past something that clips it —
 * an ellipsis (`truncate`), a scroll box it overflows, or the column's own edge. An ellipsis
 * is a paint effect, so the text's range still reports its full, unclipped extent, which is
 * what makes this a plain rectangle comparison.
 *
 * Line-clamped text is left out of the count altogether. A clamp cuts long content off at any
 * width — the expense log clamps notes to two lines — so counting it would read a log full of
 * long notes as cramped at every width and collapse the dashboard to one column for good.
 * (Chromium also reports a clamped node's range as overflowing sideways, so it cannot simply
 * be let through the horizontal check.)
 */
export type TextVisibility = {
  total: number;
  clipped: number;
  /** Text under a `data-min-visible` floor that shows less of itself than the floor asks. */
  belowFloor: number;
};

/**
 * Set on an element whose own text must stay at least a given share visible — stricter than
 * the card-wide share, for labels that are the point of their row, like budget names. The
 * value is a key into the `floors` passed to `measureTextVisibility`, so the share itself can
 * be a user setting rather than baked into server-rendered markup. Any one of them falling
 * short makes the column cramped.
 */
export const MIN_VISIBLE_ATTR = "data-min-visible";

/** Text in these is either not prose or not on screen for reasons unrelated to width. */
const SKIP_SELECTOR = [
  "svg", // chart labels are positioned by the chart, not by the column
  "select",
  "option",
  "datalist",
  "template",
  "script",
  "style",
  ".sr-only",
  // Inactive panels of a card stack sit beside the active one inside a clipped viewport.
  '[aria-hidden="true"]',
  "[inert]",
].join(",");

type Clip = { rect: DOMRect; clipsX: boolean; clamps: boolean };

/**
 * `root` is what to count; `column` is the edge nothing may cross, and where clip checks stop.
 *
 * Text cut off by more than `fixableOverflowPx` is left out of the count: that is the width
 * one more column's worth of space would add, and a note too long to fit even then is only
 * shortened, not cramped. Without this, a log whose rows mostly carry long notes would read
 * as cramped at every width and drop columns that could never have helped.
 */
export function measureTextVisibility(
  root: HTMLElement,
  column: HTMLElement,
  fixableOverflowPx = Infinity,
  /**
   * For floored text: the most width the column could ever gain, i.e. by becoming the only
   * one. A floor a single drop cannot meet may still be met by the next, so it is judged
   * against this rather than `fixableOverflowPx`; one no layout can meet is left alone.
   */
  maxGainPx = Infinity,
  /** Share (0–1) each `data-min-visible` key must keep visible; unknown keys are not floored. */
  floors: Readonly<Record<string, number>> = {},
): TextVisibility {
  const clips = new Map<Element, Clip>();
  const clipOf = (element: Element): Clip => {
    let clip = clips.get(element);
    if (!clip) {
      const style = getComputedStyle(element);
      const clamp = style.getPropertyValue("-webkit-line-clamp");
      clip = {
        rect: element.getBoundingClientRect(),
        // The column is a boundary whether or not it clips: text past its edge sits on top of
        // the next column, which is no more readable than text that is hidden.
        clipsX: element === column || style.overflowX !== "visible",
        clamps: clamp !== "" && clamp !== "none",
      };
      clips.set(element, clip);
    }
    return clip;
  };

  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let clipped = 0;
  let belowFloor = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) continue;

    range.selectNodeContents(node);
    const text = range.getBoundingClientRect();
    if (text.width === 0 && text.height === 0) continue; // not rendered

    let overflow = 0;
    let ignored = false;
    for (let element: Element | null = parent; element; element = element.parentElement) {
      const clip = clipOf(element);
      // Clamped text is shortened on purpose, and a clipping box a pixel wide is a visually-hidden
      // pattern; neither says the layout is too narrow.
      if (clip.clamps || (clip.clipsX && clip.rect.width <= 1)) {
        ignored = true;
        break;
      }
      if (clip.clipsX) overflow = Math.max(overflow, clip.rect.left - text.left, text.right - clip.rect.right);
      if (element === column) break;
    }
    if (ignored) continue;

    const floored = parent.closest(`[${MIN_VISIBLE_ATTR}]`);
    const floor = floored && root.contains(floored) ? floors[floored.getAttribute(MIN_VISIBLE_ATTR) ?? ""] : undefined;
    if (floor !== undefined && overflow > 1) {
      // The ellipsis covers the last glyphs it replaces; about an em, taken as a whole one so
      // the floor errs toward keeping the text readable.
      const ellipsis = parseFloat(getComputedStyle(parent).fontSize) || 0;
      const shown = Math.max(0, text.width - overflow - ellipsis);
      const needed = floor * text.width - shown;
      if (needed > 0 && needed <= maxGainPx) belowFloor += 1;
    }

    if (overflow > fixableOverflowPx) continue;

    total += 1;
    if (overflow > 1) clipped += 1;
  }

  range.detach();
  return { total, clipped, belowFloor };
}

/** Share of a card's text that is fully visible; 1 when it has none to judge by. */
export function visibleShare({ total, clipped }: Pick<TextVisibility, "total" | "clipped">): number {
  return total === 0 ? 1 : (total - clipped) / total;
}
