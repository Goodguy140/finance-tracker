"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { saveDashboardLayoutAction } from "@/app/actions";
import { DashboardCard, DragHandle, RemoveCardButton } from "@/components/dashboard-cards/dashboard-card";
import { CardSettingsControl, type CardSettingsChange } from "@/components/dashboard-cards/card-settings-forms";
import { useCardStack } from "@/components/dashboard-cards/card-stack";
import { DashboardColumnResizer } from "@/components/dashboard-column-resizer";
import { useConfirm } from "@/components/settings/dialog";
import {
  DashboardEditToolbar,
  type AddCardDestination,
  type LayoutSaveStatus,
} from "@/components/dashboard-edit-toolbar";
import { DASHBOARD_CARDS, DEFAULT_LAYOUT, MOBILE_SLOTS, slotAccessibleName } from "@/lib/dashboard-layout/cards";
import {
  enforceMinimums,
  fitColumnsToWidth,
  minUnitsForWidth,
  redistributeOnAdd,
  redistributeOnRemove,
  resizeAdjacent,
} from "@/lib/dashboard-layout/columns";
import { filterToAvailable } from "@/lib/dashboard-layout/normalize";
import {
  addCard,
  canAddCardTo,
  canRemoveCard,
  hiddenCards,
  removeCard,
  removedCardsInOrder,
  type AddCardTarget,
} from "@/lib/dashboard-layout/visibility";
import { measureTextVisibility, visibleShare } from "@/lib/dashboard-layout/text-visibility";
import type { DashboardReadability } from "@/lib/dashboard-readability";
import {
  MAX_COLUMNS,
  MIN_COLUMN_PX,
  TOTAL_COLUMN_UNITS,
  type DashboardCardId,
  type DashboardCardSettings,
  type DashboardColumn,
  type DashboardLayout,
  type DashboardSlot,
} from "@/lib/dashboard-layout/schema";

/**
 * Resolve the drop target from where the pointer actually is, not from where the dragged
 * card's centre ended up. Cards here differ hugely in height, and `closestCenter` alone
 * compares the dragged rect's centre — so dragging a tall card a short distance keeps its
 * centre in the column it started in and it can never be dropped in the next one.
 * `closestCenter` remains the fallback for when the pointer is over no droppable at all.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  return pointerHits.length > 0 ? pointerHits : closestCenter(args);
};

const GAP_PX = 16;
/**
 * How far past the width that forced a column out the window must grow before it is tried
 * again. Without a margin every resize tick past that width would re-add it and drop it again.
 */
const RESTORE_MARGIN_PX = 32;
const SAVE_DEBOUNCE_MS = 600;

export type DashboardCardContent = {
  body: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
};

export type DashboardCardContentMap = Partial<Record<DashboardCardId, DashboardCardContent>>;

type DashboardGridProps = {
  /**
   * The full saved layout, including cards that are not renderable this period. What to
   * render is derived from it client-side, so a card hidden by an empty month is never
   * mistaken for one the user removed.
   */
  storedLayout: DashboardLayout;
  cards: DashboardCardContentMap;
  /**
   * The user's thresholds: a column is too cramped once any card in it shows less than
   * `textVisiblePct` of its text in full, or any budget name less than `budgetNameVisiblePct`
   * of itself.
   */
  readability: DashboardReadability;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Reported upward so the page container can widen past two columns. */
  onColumnCountChange: (count: number) => void;
};

/**
 * Tracks are always `minmax(0, Nfr)` and never carry a pixel minimum. A pixel minimum in a
 * track definition is exactly what forces a grid wider than its container, which is the one
 * thing this layout must never do — column minimums are enforced while dragging instead.
 */
function trackTemplate(columns: readonly DashboardColumn[]): string {
  // The gutters get explicit tracks rather than relying on `gap`. Each column wrapper is
  // `display: contents`, so the gutter between two of them is a grid item in its own right —
  // leave it out of the template and it claims a column's track, pushing the last column into
  // an implicit one wider than the grid.
  return columns.map((column) => `minmax(0, ${column.weight}fr)`).join(` ${GAP_PX}px `);
}

/**
 * `null` until hydration, meaning "unknown". Both branches render on the server so CSS can
 * hide the wrong one — correct first paint on either form factor — and exactly one survives
 * once this resolves, so no card is ever mounted twice.
 */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeIsDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  // Also on resize. The media query is the signal; this is a backstop, because if the value
  // goes stale while CSS has already switched sides, both branches are hidden at once and the
  // dashboard renders blank.
  window.addEventListener("resize", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

function getIsDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function useIsDesktop(): boolean | null {
  return useSyncExternalStore(subscribeIsDesktop, getIsDesktop, () => null);
}

export function DashboardGrid({
  storedLayout,
  cards,
  readability,
  editing,
  onEditingChange,
  onColumnCountChange,
}: DashboardGridProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [stored, setStored] = useState<DashboardLayout>(storedLayout);
  // Mirrors `stored`, updated synchronously. Every mutation needs the next layout in hand
  // right away to hand it to the save; reading it out of a setState updater only appears to
  // work, because React is free to run the updater later than the handler that queued it.
  const storedRef = useRef(stored);
  const [saveStatus, setSaveStatus] = useState<LayoutSaveStatus>("idle");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef<DashboardLayout | null>(null);
  const serverSnapshot = useRef(JSON.stringify(storedLayout));
  // The last layout the server sent, as distinct from the last one this client saved.
  const lastServerLayout = useRef(JSON.stringify(storedLayout));

  const available = useMemo(() => Object.keys(cards) as DashboardCardId[], [cards]);

  // Re-seed from the server only when it genuinely changed and nothing is in flight, so a
  // re-render from an unrelated navigation cannot clobber an edit the user is mid-way through.
  // "Changed" is against the server's previous layout too: a refresh fetched before a save
  // landed (a form submitted straight after switching tabs) still carries the old layout, and
  // re-seeding from it would undo a change that is already saved.
  useEffect(() => {
    const next = JSON.stringify(storedLayout);
    const previous = lastServerLayout.current;
    lastServerLayout.current = next;
    if (next === previous || next === serverSnapshot.current || savingRef.current || pendingRef.current) return;
    serverSnapshot.current = next;
    storedRef.current = storedLayout;
    setStored(storedLayout);
  }, [storedLayout]);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      // Drain rather than recurse: a change landing mid-request queues itself in
      // pendingRef, and this loop picks it up without a second in-flight save.
      while (pendingRef.current) {
        const payload = pendingRef.current;
        pendingRef.current = null;
        setSaveStatus("saving");
        const formData = new FormData();
        formData.set("layout", JSON.stringify(payload));
        const result = await saveDashboardLayoutAction(formData);
        if (result?.ok === false) {
          // Local state is never rolled back: losing the arrangement someone just built is
          // worse than leaving the server row a version behind.
          setSaveStatus("error");
          return;
        }
        serverSnapshot.current = JSON.stringify(payload);
        setSaveStatus("saved");
      }
    } catch {
      setSaveStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, []);

  const scheduleSave = useCallback(
    (next: DashboardLayout) => {
      pendingRef.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const mutate = useCallback(
    (fn: (current: DashboardLayout) => DashboardLayout) => {
      const next = fn(storedRef.current);
      storedRef.current = next;
      setStored(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // Leaving edit mode, or the tab going away, are both points where a pending save should
  // not wait out its debounce. visibilitychange is far more reliable than beforeunload.
  useEffect(() => {
    if (editing) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Next tick rather than inline: flushing sets save state, and doing that synchronously
    // inside an effect cascades a render during commit.
    const timer = setTimeout(() => void flush(), 0);
    return () => clearTimeout(timer);
  }, [editing, flush]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [flush]);

  useLayoutEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    // Measure directly as well as observing. The observer carries every later change, but its
    // first delivery is asynchronous, and until a width arrives the grid has to assume every
    // column fits — so take the width synchronously on mount rather than rendering one frame
    // of a layout that does not fit.
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setContainerWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isDesktop]);

  useEffect(() => {
    onColumnCountChange(stored.columns.length);
  }, [stored.columns.length, onColumnCountChange]);

  const rendered = useMemo(
    () => filterToAvailable(stored, available, { keepEmptyColumns: editing }),
    [stored, available, editing],
  );

  // Column caps found by measuring text: at `width` or narrower, show at most `columns`. A
  // cap, not a count of extra drops, so it does not stack with the pixel minimum — narrowing
  // further to where that already removes the column must not remove another on top. Each
  // stands until the window grows past it, and all are tied to the arrangement they were
  // measured against: a different one starts clean.
  // The thresholds are part of it: caps found under stricter ones must not outlive a change
  // to looser ones.
  const arrangementKey = useMemo(
    () =>
      [
        readability.textVisiblePct,
        readability.budgetNameVisiblePct,
        ...rendered.columns.map((c) => `${c.id}:${c.weight}:${c.slots.map((s) => s.id).join(",")}`),
      ].join("|"),
    [rendered.columns, readability.textVisiblePct, readability.budgetNameVisiblePct],
  );
  const [cramped, setCramped] = useState<{ key: string; caps: { width: number; columns: number }[] }>({
    key: "",
    caps: [],
  });
  // Not while editing: columns merging under the cursor as someone drags a divider would make
  // the layout impossible to arrange. The pixel minimum still applies.
  const maxReadableColumns = useMemo(
    () =>
      !editing && cramped.key === arrangementKey
        ? Math.min(
            Infinity,
            ...cramped.caps.filter((cap) => containerWidth <= cap.width + RESTORE_MARGIN_PX).map((cap) => cap.columns),
          )
        : Infinity,
    [editing, cramped, arrangementKey, containerWidth],
  );

  // The columns that actually fit. This, not a media query, is what guarantees the dashboard
  // reaches one column without a horizontal scrollbar: the user chooses how many columns
  // exist and how wide each is, so there is no fixed set of breakpoints to write.
  const displayColumns = useMemo(
    () => fitColumnsToWidth(rendered.columns, containerWidth, MIN_COLUMN_PX, GAP_PX, maxReadableColumns),
    [rendered.columns, containerWidth, maxReadableColumns],
  );

  // Clearing the pixel minimum does not mean a column is readable: cards differ in how much
  // they need. Before paint, check how much text each column cuts off and drop one more while
  // any is cramped. A layout effect so the reader never sees the cramped frame; each drop
  // re-renders and re-runs this, which settles once every column reads or only one is left.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (editing || containerWidth <= 0 || !gridRef.current) return;
    if (displayColumns.length <= 1) return;
    const columns = [...gridRef.current.querySelectorAll<HTMLElement>("[data-column-index]")];
    const textShare = readability.textVisiblePct / 100;
    const floors = { "budget-name": readability.budgetNameVisiblePct / 100 };
    // Dropping one of n columns widens each of the rest by roughly its width over n - 1; text cut
    // off by more than that would stay cut off, so it is no reason to drop one.
    const cramps = (column: HTMLElement) => {
      const width = column.getBoundingClientRect().width;
      const fixable = width / (displayColumns.length - 1);
      return [...column.querySelectorAll<HTMLElement>("[data-card-id]")].some((card) => {
        const measured = measureTextVisibility(card, column, fixable, containerWidth - width, floors);
        return measured.belowFloor > 0 || visibleShare(measured) < textShare;
      });
    };
    if (columns.some(cramps)) {
      const cap = { width: containerWidth, columns: displayColumns.length - 1 };
      setCramped((current) => ({
        key: arrangementKey,
        // Drop caps the new one covers — no wider and no stricter — so resizing back and forth
        // all session cannot grow the list.
        caps: [
          ...(current.key === arrangementKey ? current.caps : []).filter(
            (old) => old.width > cap.width || old.columns < cap.columns,
          ),
          cap,
        ],
      }));
    }
  }, [editing, containerWidth, displayColumns, arrangementKey, cards, fontsReady, readability]);

  const collapsed = displayColumns.length !== rendered.columns.length;

  const settings = stored.settings;

  const onSettingsChange = useCallback<CardSettingsChange>(
    (cardId, patch) => {
      const current = storedRef.current;
      const next: DashboardLayout = {
        ...current,
        settings: {
          ...current.settings,
          [cardId]: { ...(current.settings[cardId] ?? {}), ...patch },
        },
      };
      storedRef.current = next;
      setStored(next);
      pendingRef.current = next;
      // Card bodies are rendered on the server, so most settings only take effect once it
      // re-renders them. Save straight away rather than on the drag debounce, then refresh —
      // otherwise the refresh races the write and reads back the old value. Unlike a drag,
      // this is a deliberate, occasional action, so one round trip is the right trade.
      void flush().then(() => router.refresh());
    },
    [flush, router],
  );

  /**
   * Settings that CSS can express are also handed to the shell as custom properties, so the
   * card reflows the moment the control is used rather than when the refresh lands.
   */
  const cardStyle = useCallback(
    (cardId: DashboardCardId): CSSProperties | undefined =>
      cardId === "budgets"
        ? ({ "--budgets-per-row": settings.budgets?.perRow ?? 1 } as CSSProperties)
        : undefined,
    [settings],
  );

  const onActiveIndexChange = useCallback(
    (slotId: string, index: number) => {
      mutate((current) => ({
        ...current,
        columns: current.columns.map((column) => ({
          ...column,
          slots: column.slots.map((slot) => (slot.id === slotId ? { ...slot, activeIndex: index } : slot)),
        })),
      }));
    },
    [mutate],
  );

  const sensors = useSensors(
    // A small threshold so a click on a chart or a form control is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );


  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  /**
   * The layout changes on drop, not on hover. Moving slots while the pointer is still down —
   * the usual multi-container pattern — reflows the grid under the cursor on every frame, and
   * the stale rects that leaves behind make the eventual drop land somewhere the user never
   * pointed at. The drag overlay carries the feedback instead.
   */
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      // Dropping on a card's header band merges the two into one tabbed stack.
      if (overId.startsWith("stack:")) {
        const targetId = overId.slice("stack:".length);
        if (targetId !== activeId) mutate((current) => mergeSlots(current, activeId, targetId));
        return;
      }
      if (overId.startsWith("column:")) {
        mutate((current) => moveSlotToColumn(current, activeId, overId.slice("column:".length)));
        return;
      }
      if (activeId !== overId) mutate((current) => moveSlot(current, activeId, overId));
    },
    [mutate],
  );

  const minUnits = minUnitsForWidth(containerWidth, displayColumns.length);

  const previewTemplate = useCallback(
    (index: number, deltaUnits: number) => trackTemplate(resizeAdjacent(displayColumns, index, deltaUnits, minUnits)),
    [displayColumns, minUnits],
  );

  const commitResize = useCallback(
    (index: number, deltaUnits: number) => {
      mutate((current) => ({
        ...current,
        columns: resizeAdjacent(current.columns, index, deltaUnits, minUnits),
      }));
    },
    [mutate, minUnits],
  );

  const addColumn = useCallback(() => {
    mutate((current) => ({
      ...current,
      columns: redistributeOnAdd(current.columns, `col-${Date.now().toString(36)}`),
    }));
  }, [mutate]);

  const removeColumn = useCallback(
    (index: number) => {
      mutate((current) => ({ ...current, columns: redistributeOnRemove(current.columns, index) }));
    },
    [mutate],
  );

  const { ask: askConfirm, dialog: confirmDialog } = useConfirm();
  const resetLayout = useCallback(async () => {
    const ok = await askConfirm({
      title: "Reset the dashboard?",
      body: "Cards and columns go back to their default arrangement.",
      confirmLabel: "Reset layout",
    });
    if (!ok) return;
    mutate(() => JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DashboardLayout);
    // The default may bring back a card whose data was not loaded; see onAddCard.
    void flush().then(() => router.refresh());
  }, [askConfirm, mutate, flush, router]);

  const canAddColumn = stored.columns.length < MAX_COLUMNS;

  const onRemoveCard = useCallback(
    (cardId: DashboardCardId) => mutate((current) => removeCard(current, cardId)),
    [mutate],
  );

  const onAddCard = useCallback(
    (cardId: DashboardCardId, target: AddCardTarget) => {
      mutate((current) => addCard(current, cardId, target));
      // A card off the dashboard may not have had its data loaded (Insights is skipped), so
      // save now and re-render, as a setting change does.
      void flush().then(() => router.refresh());
    },
    [mutate, flush, router],
  );

  const removedCards = useMemo(
    () => removedCardsInOrder(stored).map((id) => ({ id, title: DASHBOARD_CARDS[id].title })),
    [stored],
  );

  // Every column, then every existing card as a tab target. Built from the stored layout, not
  // the columns that fit the window, so a column merged away by a narrow window is still offered.
  const addDestinations = useMemo<AddCardDestination[]>(() => {
    const columns = stored.columns.map((column, index) => ({
      key: `column:${column.id}`,
      label: `New card in column ${index + 1}`,
      target: { kind: "column" as const, columnId: column.id },
    }));
    const tabs = stored.columns.flatMap((column) =>
      column.slots.map((slot) => ({
        key: `tab:${slot.id}`,
        label: `Tab on ${slotAccessibleName(slot.cards)}`,
        target: { kind: "tab" as const, slotId: slot.id },
      })),
    );
    return [...columns, ...tabs].filter((destination) => canAddCardTo(stored, destination.target));
  }, [stored]);

  const renderSlot = (slot: DashboardSlot, mode: "tabs" | "swipe") => (
    <SlotView
      key={slot.id}
      slot={slot}
      mode={mode}
      cards={cards}
      settings={settings}
      editing={editing && mode === "tabs"}
      onSettingsChange={onSettingsChange}
      onActiveIndexChange={onActiveIndexChange}
      onRemoveCard={onRemoveCard}
      canRemove={(cardId) => canRemoveCard(stored, cardId)}
      cardStyle={cardStyle}
    />
  );

  // Phones keep their fixed order, minus anything the user removed on the desktop.
  const mobileSlots = useMemo(() => {
    const removed = new Set(hiddenCards(stored));
    const allowed = new Set(available.filter((card) => !removed.has(card)));
    return MOBILE_SLOTS.map((slot) => ({
      ...slot,
      cards: slot.cards.filter((card) => allowed.has(card)),
    })).filter((slot) => slot.cards.length > 0);
  }, [available, stored]);

  return (
    <>
      {isDesktop !== true ? (
        <div className="flex flex-col gap-4 lg:hidden">
          {mobileSlots.map((slot) => renderSlot(slot, "swipe"))}
        </div>
      ) : null}

      {isDesktop !== false ? (
        <div ref={wrapperRef} className="hidden min-w-0 overflow-x-clip lg:block">
          {editing ? (
            <DashboardEditToolbar
              columnCount={stored.columns.length}
              canAddColumn={canAddColumn}
              saveStatus={saveStatus}
              removedCards={removedCards}
              destinations={addDestinations}
              onAddCard={onAddCard}
              onAddColumn={addColumn}
              onReset={resetLayout}
              onDone={() => onEditingChange(false)}
              onRetry={() => void flush()}
            />
          ) : null}

          {editing && collapsed ? (
            <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This window is too narrow for {stored.columns.length} columns, so they are shown merged.
              Your arrangement is unchanged and returns at a wider size.
            </p>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <div
              ref={gridRef}
              className="grid min-w-0 items-start"
              style={{ gridTemplateColumns: trackTemplate(displayColumns) }}
            >
              {displayColumns.map((column, index) => (
                <div key={column.id} className="contents">
                  <GridColumn
                    column={column}
                    index={index}
                    total={displayColumns.length}
                    editing={editing && !collapsed}
                    onRemove={() => removeColumn(index)}
                  >
                    {column.slots.map((slot) => renderSlot(slot, "tabs"))}
                  </GridColumn>
                  {index < displayColumns.length - 1 ? (
                    editing && !collapsed ? (
                      <DashboardColumnResizer
                        index={index}
                        leftWeight={column.weight}
                        rightWeight={displayColumns[index + 1].weight}
                        minUnits={minUnits}
                        gridRef={gridRef}
                        onPreview={(delta) => previewTemplate(index, delta)}
                        onCommit={(delta) => commitResize(index, delta)}
                      />
                    ) : (
                      // The gutter's track exists in every mode; when it is not draggable it
                      // is just the gap between columns.
                      <div aria-hidden />
                    )
                  ) : null}
                </div>
              ))}
            </div>

            <DragOverlay>
              {activeDragId ? <DragGhost slotId={activeDragId} layout={stored} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      ) : null}
      {confirmDialog}
    </>
  );
}

/** Moves the dragged slot to where the slot it is over currently sits. */
function moveSlot(layout: DashboardLayout, activeId: string, overId: string): DashboardLayout {
  const columns = layout.columns.map((column) => ({ ...column, slots: [...column.slots] }));
  let from: { c: number; i: number } | null = null;
  let to: { c: number; i: number } | null = null;

  columns.forEach((column, c) => {
    column.slots.forEach((slot, i) => {
      if (slot.id === activeId) from = { c, i };
      if (slot.id === overId) to = { c, i };
    });
  });
  if (!from || !to) return layout;

  const source = from as { c: number; i: number };
  const target = to as { c: number; i: number };
  const [moved] = columns[source.c].slots.splice(source.i, 1);
  columns[target.c].slots.splice(target.i, 0, moved);
  return { ...layout, columns: enforceMinimums(columns.filter((column) => column.slots.length > 0)) };
}

/**
 * Appends the dragged slot to a column. This is what makes an empty column a usable target:
 * with no slots of its own it has nothing for collision detection to land on, so the column
 * registers as a droppable in its own right.
 */
function moveSlotToColumn(layout: DashboardLayout, activeId: string, columnId: string): DashboardLayout {
  const columns = layout.columns.map((column) => ({ ...column, slots: [...column.slots] }));
  const target = columns.find((column) => column.id === columnId);
  if (!target) return layout;
  if (target.slots.some((slot) => slot.id === activeId)) return layout;

  let moved: DashboardSlot | null = null;
  for (const column of columns) {
    const index = column.slots.findIndex((slot) => slot.id === activeId);
    if (index !== -1) {
      moved = column.slots.splice(index, 1)[0];
      break;
    }
  }
  if (!moved) return layout;
  target.slots.push(moved);
  // Empty columns are kept here: while editing they are still drop targets.
  return { ...layout, columns: enforceMinimums(columns) };
}

/** Folds the dragged slot's cards into the target slot, making it a tabbed stack. */
function mergeSlots(layout: DashboardLayout, activeId: string, targetId: string): DashboardLayout {
  const columns = layout.columns.map((column) => ({ ...column, slots: [...column.slots] }));
  let moved: DashboardSlot | null = null;

  for (const column of columns) {
    const index = column.slots.findIndex((slot) => slot.id === activeId);
    if (index !== -1) {
      moved = column.slots.splice(index, 1)[0];
      break;
    }
  }
  if (!moved) return layout;

  for (const column of columns) {
    const target = column.slots.find((slot) => slot.id === targetId);
    if (target) {
      target.cards = [...target.cards, ...moved.cards];
      target.activeIndex = target.cards.length - moved.cards.length;
      return { ...layout, columns: enforceMinimums(columns.filter((c) => c.slots.length > 0)) };
    }
  }
  return layout;
}

/**
 * One column of the grid. It registers as a droppable in its own right, which is what makes
 * an empty column a usable target: with no slots inside, collision detection has nothing to
 * land on and a card can never be dragged in.
 */
function GridColumn({
  column,
  index,
  total,
  editing,
  onRemove,
  children,
}: {
  column: DashboardColumn;
  index: number;
  total: number;
  editing: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.id}`, disabled: !editing });
  const destination = index === 0 ? "column 2" : `column ${index}`;

  return (
    <div
      ref={setNodeRef}
      data-column-index={index}
      className={`flex min-w-0 flex-col gap-4 rounded-xl ${isOver ? "outline outline-2 outline-dashed outline-blue-400/50" : ""}`}
    >
      {editing ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1">
          <span className="text-[11px] text-slate-400">
            Column {index + 1} · {Math.round((column.weight / TOTAL_COLUMN_UNITS) * 100)}%
          </span>
          {total > 1 ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove column ${index + 1}`}
              title={`Remove column ${index + 1} — its cards move to ${destination}`}
              className="rounded px-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-red-300"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      <SortableContext items={column.slots.map((slot) => slot.id)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>

      {editing && column.slots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
          Drag a card here
        </p>
      ) : null}
    </div>
  );
}

function DragGhost({ slotId, layout }: { slotId: string; layout: DashboardLayout }) {
  const slot = layout.columns.flatMap((column) => column.slots).find((s) => s.id === slotId);
  if (!slot) return null;
  // Title only. Dragging a live card would carry a mounted recharts tree with it, which is
  // where the jank comes from.
  return (
    <div className="rounded-2xl border border-blue-500/50 bg-slate-900 px-4 py-3 shadow-2xl">
      <p className="text-sm font-semibold text-slate-100">{slotAccessibleName(slot.cards)}</p>
    </div>
  );
}

function SlotView({
  slot,
  mode,
  cards,
  settings,
  editing,
  onSettingsChange,
  onActiveIndexChange,
  onRemoveCard,
  canRemove,
  cardStyle,
}: {
  slot: DashboardSlot;
  mode: "tabs" | "swipe";
  cards: DashboardCardContentMap;
  settings: DashboardCardSettings;
  editing: boolean;
  onSettingsChange: CardSettingsChange;
  onActiveIndexChange: (slotId: string, index: number) => void;
  onRemoveCard: (cardId: DashboardCardId) => void;
  canRemove: (cardId: DashboardCardId) => boolean;
  cardStyle: (cardId: DashboardCardId) => CSSProperties | undefined;
}) {
  // Destructured at the call rather than kept as an object: forwarding `sortable.setNodeRef`
  // straight into JSX reads as a ref access during render.
  const {
    setNodeRef: setSortableRef,
    setActivatorNodeRef,
    attributes: dragAttributes,
    listeners: dragListeners,
    transform: dragTransform,
    transition: dragTransition,
    isDragging,
  } = useSortable({ id: slot.id, disabled: !editing });
  // A separate drop target over the header band: dropping here stacks rather than reorders.
  const { setNodeRef: setStackDropRef, isOver: isStackOver } = useDroppable({
    id: `stack:${slot.id}`,
    disabled: !editing,
  });

  // Mobile's slots are the frozen MOBILE_SLOTS, which by design are not part of the saved
  // layout — so its carousel keeps its position in local state. Routing it through the layout
  // would look up a slot id that does not exist there and silently do nothing.
  const [swipeIndex, setSwipeIndex] = useState(slot.activeIndex);
  const activeIndex = Math.min(mode === "swipe" ? swipeIndex : slot.activeIndex, slot.cards.length - 1);
  const activeCard = slot.cards[activeIndex];

  const slides = slot.cards.map((cardId) => ({
    id: cardId,
    label: DASHBOARD_CARDS[cardId].tabLabel,
    content:
      mode === "swipe" ? (
        <SingleCard
          cardId={cardId}
          cards={cards}
          settings={settings}
          editing={false}
          onSettingsChange={onSettingsChange}
          style={cardStyle(cardId)}
        />
      ) : (
        cards[cardId]?.body ?? null
      ),
  }));

  const { tabStrip, viewport } = useCardStack({
    stackId: slot.id,
    mode: mode === "swipe" ? "swipe" : "tabs",
    slides,
    activeIndex,
    onActiveIndexChange: (index) =>
      mode === "swipe" ? setSwipeIndex(index) : onActiveIndexChange(slot.id, index),
    label: slotAccessibleName(slot.cards),
  });

  const style = {
    transform: CSS.Translate.toString(dragTransform),
    transition: dragTransition,
    opacity: isDragging ? 0.4 : undefined,
  };

  // A single card, on mobile: no stack chrome at all, exactly as before.
  if (slot.cards.length === 1 && mode === "swipe") {
    return (
      <SingleCard
        cardId={slot.cards[0]}
        cards={cards}
        settings={settings}
        editing={false}
        onSettingsChange={onSettingsChange}
        style={cardStyle(slot.cards[0])}
      />
    );
  }

  // A stack on mobile keeps the carousel's look: each slide is its own card, with the pills
  // and the swipe caption below them, outside the panels.
  if (mode === "swipe") {
    return (
      <div className="space-y-2">
        {viewport}
        {tabStrip}
        <p className="text-center text-[11px] text-slate-500">Swipe left or right to switch</p>
      </div>
    );
  }

  if (slot.cards.length === 1) {
    return (
      <div ref={setSortableRef} style={style} className="relative">
        <StackDropZone setNodeRef={setStackDropRef} editing={editing} />
        <div>
          <SingleCard
            cardId={slot.cards[0]}
            cards={cards}
            settings={settings}
            editing={editing}
            onSettingsChange={onSettingsChange}
            isStackTarget={isStackOver}
            style={cardStyle(slot.cards[0])}
            removeControl={
              editing ? (
                <RemoveCardButton
                  title={DASHBOARD_CARDS[slot.cards[0]].title}
                  disabled={!canRemove(slot.cards[0])}
                  onRemove={() => onRemoveCard(slot.cards[0])}
                />
              ) : null
            }
            dragControl={
              editing ? (
                <DragHandle
                  label={`Move ${DASHBOARD_CARDS[slot.cards[0]].title}`}
                  handleRef={setActivatorNodeRef}
                  attributes={dragAttributes as unknown as Record<string, unknown>}
                  listeners={dragListeners as unknown as Record<string, unknown>}
                />
              ) : null
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={setSortableRef} style={style} className="relative">
      <StackDropZone setNodeRef={setStackDropRef} editing={editing} />
      <div>
        <DashboardCard
          cardId={slot.cards.join("+")}
          regionLabel={slotAccessibleName(slot.cards)}
          titleSlot={tabStrip}
          subtitle={activeCard ? cards[activeCard]?.subtitle : undefined}
          headerActions={activeCard ? cards[activeCard]?.headerActions : undefined}
          editing={editing}
          className={isStackOver ? "ring-2 ring-blue-400/60" : ""}
          style={activeCard ? cardStyle(activeCard) : undefined}
          settingsControl={
            activeCard ? (
              <CardSettingsControl cardId={activeCard} settings={settings} onChange={onSettingsChange} />
            ) : null
          }
          // In a stack, Remove takes off the tab on screen and leaves the others.
          removeControl={
            editing && activeCard ? (
              <RemoveCardButton
                title={DASHBOARD_CARDS[activeCard].title}
                disabled={!canRemove(activeCard)}
                onRemove={() => onRemoveCard(activeCard)}
              />
            ) : null
          }
          dragControl={
            editing ? (
              <DragHandle
                label={`Move ${slotAccessibleName(slot.cards)}`}
                handleRef={setActivatorNodeRef}
                attributes={dragAttributes as unknown as Record<string, unknown>}
                listeners={dragListeners as unknown as Record<string, unknown>}
              />
            ) : null
          }
        >
          {viewport}
        </DashboardCard>
      </div>
    </div>
  );
}

/**
 * The band across a card's header that merges the dragged card into this one instead of
 * reordering. Deliberately a thin strip rather than the whole card: dnd-kit picks the
 * droppable whose centre is nearest the pointer, so a full-card target wins almost every
 * comparison and an ordinary move between columns becomes impossible.
 */
function StackDropZone({
  setNodeRef,
  editing,
}: {
  setNodeRef: (node: HTMLElement | null) => void;
  editing: boolean;
}) {
  if (!editing) return null;
  return <div ref={setNodeRef} className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10" aria-hidden />;
}

function SingleCard({
  cardId,
  cards,
  settings,
  editing,
  onSettingsChange,
  dragControl,
  removeControl,
  isStackTarget,
  style,
}: {
  cardId: DashboardCardId;
  cards: DashboardCardContentMap;
  settings: DashboardCardSettings;
  editing: boolean;
  onSettingsChange: CardSettingsChange;
  dragControl?: ReactNode;
  removeControl?: ReactNode;
  isStackTarget?: boolean;
  style?: CSSProperties;
}) {
  const content = cards[cardId];
  if (!content) return null;
  const meta = DASHBOARD_CARDS[cardId];

  return (
    <DashboardCard
      cardId={cardId}
      regionLabel={meta.title}
      titleSlot={meta.title}
      subtitle={content.subtitle}
      headerActions={content.headerActions}
      editing={editing}
      className={isStackTarget ? "ring-2 ring-blue-400/60" : ""}
      style={style}
      settingsControl={<CardSettingsControl cardId={cardId} settings={settings} onChange={onSettingsChange} />}
      dragControl={dragControl}
      removeControl={removeControl}
    >
      {content.body}
    </DashboardCard>
  );
}
