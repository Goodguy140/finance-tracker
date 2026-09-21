"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CategorySpendPieChart, type CategorySpendSlice } from "@/components/category-spend-pie";
import { CumulativeSpendCard, type CumulativeSpendCardProps } from "@/components/cumulative-spend-card";
import type { DashboardRange } from "@/lib/dashboard-period";
import { formatCurrency } from "@/lib/money";

export type DashboardBudgetProgressItem = {
  id: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
  progressPct: number;
};

type DashboardBudgetsSpendSectionProps = {
  periodDescription: string;
  periodRange: DashboardRange;
  spendVsBudgetLabel: string;
  currentSpendCents: number;
  totalBudgetCents: number;
  budgetProgressItems: DashboardBudgetProgressItem[];
  categoryPieSlices: CategorySpendSlice[];
  cumulativeSpend: CumulativeSpendCardProps;
};

const PANEL_SHELL = "rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg";
const SWIPE_THRESHOLD_PX = 48;
const AXIS_LOCK_THRESHOLD_PX = 10;

function BudgetPeriodNote({ periodRange }: { periodRange: DashboardRange }) {
  if (periodRange === "ytd") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits are summed monthly budgets Jan–selected month; spending matches that window.
      </p>
    );
  }
  if (periodRange === "lifetime") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits sum every saved monthly budget per category; spending is all-time in those categories.
      </p>
    );
  }
  return null;
}

function BudgetsPanel({
  periodRange,
  spendVsBudgetLabel,
  currentSpendCents,
  totalBudgetCents,
  budgetProgressItems,
}: Pick<
  DashboardBudgetsSpendSectionProps,
  "periodRange" | "spendVsBudgetLabel" | "currentSpendCents" | "totalBudgetCents" | "budgetProgressItems"
>) {
  return (
    <div className={PANEL_SHELL}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Budgets</h2>
        <Link
          href="/settings#budgets"
          className="text-sm font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline"
        >
          Manage budgets
        </Link>
      </div>
      <BudgetPeriodNote periodRange={periodRange} />
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
        <p className="text-xs uppercase tracking-wide text-slate-400">{spendVsBudgetLabel}</p>
        <p className="text-base font-semibold">
          {formatCurrency(currentSpendCents)} / {formatCurrency(totalBudgetCents)}
        </p>
      </div>
      <div className="mt-3 space-y-2">
        {budgetProgressItems.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-200">{item.categoryName}</span>
              <span className="text-slate-300">
                {formatCurrency(item.spentCents)} / {formatCurrency(item.limitCents)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${item.progressPct >= 100 ? "bg-red-500" : item.progressPct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${item.progressPct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendingByCategoryPanel({
  periodDescription,
  categoryPieSlices,
}: Pick<DashboardBudgetsSpendSectionProps, "periodDescription" | "categoryPieSlices">) {
  return (
    <div className={PANEL_SHELL}>
      <h2 className="text-lg font-semibold">Spending by category</h2>
      <p className="mt-1 text-xs text-slate-400">Net spending by category · {periodDescription}</p>
      <CategorySpendPieChart data={categoryPieSlices} />
    </div>
  );
}

function MobileSwipePanels(props: DashboardBudgetsSpendSectionProps) {
  const slides: Array<{ label: string; content: ReactNode }> = [
    {
      label: "Categories",
      content: (
        <SpendingByCategoryPanel
          periodDescription={props.periodDescription}
          categoryPieSlices={props.categoryPieSlices}
        />
      ),
    },
    {
      label: "Budgets",
      content: (
        <BudgetsPanel
          periodRange={props.periodRange}
          spendVsBudgetLabel={props.spendVsBudgetLabel}
          currentSpendCents={props.currentSpendCents}
          totalBudgetCents={props.totalBudgetCents}
          budgetProgressItems={props.budgetProgressItems}
        />
      ),
    },
    {
      label: "Trend",
      content: <CumulativeSpendCard {...props.cumulativeSpend} />,
    },
  ];
  const slideCount = slides.length;

  const [activeIndex, setActiveIndex] = useState(0);
  const [panelHeights, setPanelHeights] = useState<number[]>(() => new Array(slideCount).fill(0));
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchAxisRef = useRef<"horizontal" | "vertical" | null>(null);

  const measureSlideHeights = useCallback(() => {
    contentRefs.current.forEach((node, index) => {
      if (!node) return;
      const height = Math.ceil(node.offsetHeight);
      setPanelHeights((prev) => {
        if (prev[index] === height) return prev;
        const next = [...prev];
        next[index] = height;
        return next;
      });
    });
  }, []);

  const goToIndex = useCallback(
    (index: number) => {
      setActiveIndex((prev) => {
        const next = Math.max(0, Math.min(slideCount - 1, index));
        return prev === next ? prev : next;
      });
    },
    [slideCount],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useLayoutEffect(() => {
    measureSlideHeights();
  }, [
    measureSlideHeights,
    props.budgetProgressItems.length,
    props.categoryPieSlices.length,
    props.cumulativeSpend.points.length,
  ]);

  useEffect(() => {
    const observers: ResizeObserver[] = [];

    contentRefs.current.forEach((node) => {
      if (!node) return;
      const observer = new ResizeObserver(measureSlideHeights);
      observer.observe(node);
      observers.push(observer);
    });

    return () => observers.forEach((observer) => observer.disconnect());
  }, [
    measureSlideHeights,
    props.budgetProgressItems.length,
    props.categoryPieSlices.length,
    props.cumulativeSpend.points.length,
  ]);

  useEffect(() => {
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
  }, [goToIndex]);

  const activeHeight = panelHeights[activeIndex] ?? 0;
  const heightReady = activeHeight > 0;

  return (
    <div className="space-y-2">
      <div
        ref={viewportRef}
        className="relative touch-pan-y overflow-hidden transition-[height] duration-300 ease-out"
        style={{ height: heightReady ? activeHeight : undefined }}
        aria-roledescription="carousel"
        aria-label="Spending by category, budgets and cumulative spending"
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
              key={slide.label}
              id={`dashboard-panel-${index}`}
              className="shrink-0"
              style={{ width: `${100 / slideCount}%` }}
              role="tabpanel"
              aria-hidden={activeIndex !== index}
              aria-label={slide.label}
              inert={activeIndex !== index ? true : undefined}
            >
              <div
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
      <div className="flex items-center justify-center gap-2" role="tablist" aria-label="Dashboard panels">
        {slides.map((slide, index) => (
          <button
            key={slide.label}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            aria-controls={`dashboard-panel-${index}`}
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
      <p className="text-center text-[11px] text-slate-500">Swipe left or right to switch</p>
    </div>
  );
}

export function DashboardBudgetsSpendSection(props: DashboardBudgetsSpendSectionProps) {
  return (
    <>
      <div className="order-1 lg:hidden">
        <MobileSwipePanels {...props} />
      </div>
      <div className="order-1 hidden flex-col gap-4 lg:order-2 lg:flex">
        <BudgetsPanel
          periodRange={props.periodRange}
          spendVsBudgetLabel={props.spendVsBudgetLabel}
          currentSpendCents={props.currentSpendCents}
          totalBudgetCents={props.totalBudgetCents}
          budgetProgressItems={props.budgetProgressItems}
        />
        <SpendingByCategoryPanel
          periodDescription={props.periodDescription}
          categoryPieSlices={props.categoryPieSlices}
        />
      </div>
    </>
  );
}
