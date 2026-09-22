"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const SWIPE_THRESHOLD_PX = 48;
const AXIS_LOCK_THRESHOLD_PX = 10;

export type CardStackSlide = {
  id: string;
  label: string;
  content: ReactNode;
};

export type CardStackMode = "swipe" | "tabs";

type UseCardStackOptions = {
  stackId: string;
  mode: CardStackMode;
  slides: CardStackSlide[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** Accessible name for the tab strip and the carousel region. */
  label: string;
};

/**
 * The mechanics behind a stack of cards sharing one position: an animated track, a viewport
 * that grows to the active panel, `inert` on the panels behind it, and — in `swipe` mode —
 * the touch handling the mobile dashboard has always used.
 *
 * Returned as two nodes rather than one component because the two modes compose them
 * differently: the desktop stack puts its tab strip in the card header, while mobile keeps
 * the strip and its caption below the carousel, outside the cards. Both get the same
 * behaviour from one implementation, which is the point — this repo has already been bitten
 * by keeping two near-identical copies of a small store in sync.
 *
 * Inactive panels stay laid out rather than unmounted on purpose: recharts' ResponsiveContainer
 * measures its parent and renders nothing at zero width, so a conditionally rendered panel
 * gives you a blank chart until something resizes.
 */
export function useCardStack({
  stackId,
  mode,
  slides,
  activeIndex,
  onActiveIndexChange,
  label,
}: UseCardStackOptions): { tabStrip: ReactNode; viewport: ReactNode } {
  const slideCount = slides.length;
  const [panelHeights, setPanelHeights] = useState<number[]>(() => new Array(slideCount).fill(0));
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(activeIndex);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  // One state update for the whole batch: measuring per node and setting state inside the
  // loop schedules a render per panel, which on a three-panel stack is three renders a tick.
  const measurePanels = useCallback(() => {
    const measured = contentRefs.current.map((node) => (node ? Math.ceil(node.offsetHeight) : 0));
    setPanelHeights((prev) => {
      if (prev.length === measured.length && prev.every((value, i) => value === measured[i])) return prev;
      return measured;
    });
  }, []);

  const goToIndex = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(slideCount - 1, index));
      if (next !== activeIndexRef.current) onActiveIndexChange(next);
    },
    [slideCount, onActiveIndexChange],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Keyed on the slide ids rather than on any particular card's data: the stack does not
  // know what its panels contain, and a stack can be rebuilt with different cards entirely.
  const slideKey = slides.map((slide) => slide.id).join("|");

  useLayoutEffect(() => {
    measurePanels();
  }, [measurePanels, slideKey]);

  useEffect(() => {
    const observers = contentRefs.current
      .filter((node): node is HTMLDivElement => node !== null)
      .map((node) => {
        const observer = new ResizeObserver(measurePanels);
        observer.observe(node);
        return observer;
      });
    return () => observers.forEach((observer) => observer.disconnect());
  }, [measurePanels, slideKey]);

  useEffect(() => {
    // Touch handling belongs to the mobile carousel only. Attaching it on desktop would put
    // a preventDefault on the same gesture dnd-kit's pointer sensor is trying to read.
    if (mode !== "swipe") return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchAxisRef.current = null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (!touchAxisRef.current) {
        if (Math.abs(dx) < AXIS_LOCK_THRESHOLD_PX && Math.abs(dy) < AXIS_LOCK_THRESHOLD_PX) return;
        touchAxisRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }

      if (touchAxisRef.current === "horizontal") {
        event.preventDefault();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      if (start && touch && touchAxisRef.current === "horizontal") {
        const dx = touch.clientX - start.x;
        if (dx <= -SWIPE_THRESHOLD_PX) {
          goToIndex(activeIndexRef.current + 1);
        } else if (dx >= SWIPE_THRESHOLD_PX) {
          goToIndex(activeIndexRef.current - 1);
        }
      }
      touchStartRef.current = null;
      touchAxisRef.current = null;
    };

    const onTouchCancel = () => {
      touchStartRef.current = null;
      touchAxisRef.current = null;
    };

    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd, { passive: true });
    viewport.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
      viewport.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [goToIndex, mode]);

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const moves: Record<string, number | undefined> = {
        ArrowRight: activeIndex + 1,
        ArrowLeft: activeIndex - 1,
        Home: 0,
        End: slideCount - 1,
      };
      const target = moves[event.key];
      if (target === undefined) return;
      event.preventDefault();
      goToIndex(target);
      // Roving tabindex: move focus with the selection so the strip stays keyboard-usable.
      const next = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      next?.[Math.max(0, Math.min(slideCount - 1, target))]?.focus();
    },
    [activeIndex, goToIndex, slideCount],
  );

  const activeHeight = panelHeights[activeIndex] ?? 0;
  const heightReady = activeHeight > 0;

  const tabStrip = (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onTabKeyDown}
      className={
        mode === "swipe"
          ? "flex items-center justify-center gap-2"
          : "flex min-w-0 flex-wrap items-center gap-1"
      }
    >
      {slides.map((slide, index) => (
        <button
          key={slide.id}
          type="button"
          role="tab"
          id={`${stackId}-tab-${index}`}
          aria-selected={activeIndex === index}
          aria-controls={`${stackId}-panel-${index}`}
          tabIndex={activeIndex === index ? 0 : -1}
          onClick={() => goToIndex(index)}
          className={`touch-manipulation rounded-full px-3 py-1.5 text-xs font-medium transition ${
            activeIndex === index
              ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40"
              : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
          }`}
        >
          {slide.label}
        </button>
      ))}
    </div>
  );

  const viewport = (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden transition-[height] duration-300 ease-out ${
        mode === "swipe" ? "touch-pan-y" : ""
      }`}
      style={{ height: heightReady ? activeHeight : undefined }}
      aria-roledescription={mode === "swipe" ? "carousel" : undefined}
      aria-label={mode === "swipe" ? label : undefined}
    >
      <div
        className="absolute inset-x-0 top-0 flex items-start transition-transform duration-300 ease-out"
        style={{
          width: `${slideCount * 100}%`,
          transform: `translateX(-${(activeIndex * 100) / slideCount}%)`,
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            id={`${stackId}-panel-${index}`}
            className="min-w-0 shrink-0"
            style={{ width: `${100 / slideCount}%` }}
            role="tabpanel"
            aria-labelledby={`${stackId}-tab-${index}`}
            aria-hidden={activeIndex !== index}
            inert={activeIndex !== index ? true : undefined}
          >
            <div
              className="min-w-0"
              ref={(node) => {
                contentRefs.current[index] = node;
              }}
            >
              {slide.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return { tabStrip, viewport };
}
