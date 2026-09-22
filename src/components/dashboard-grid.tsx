"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { saveDashboardLayoutAction } from "@/app/actions";
import { DashboardCard, DragHandle } from "@/components/dashboard-cards/dashboard-card";
import { CardSettingsControl, type CardSettingsChange } from "@/components/dashboard-cards/card-settings-forms";
import { useCardStack } from "@/components/dashboard-cards/card-stack";
import { DashboardColumnResizer } from "@/components/dashboard-column-resizer";
import { DashboardEditToolbar, type LayoutSaveStatus } from "@/components/dashboard-edit-toolbar";
import { DASHBOARD_CARDS, DEFAULT_LAYOUT, MOBILE_SLOTS, slotAccessibleName } from "@/lib/dashboard-layout/cards";
import {
  collapseColumns,
  enforceMinimums,
  minUnitsForWidth,
  redistributeOnAdd,
  redistributeOnRemove,
  resizeAdjacent,
} from "@/lib/dashboard-layout/columns";
import { filterToAvailable } from "@/lib/dashboard-layout/normalize";
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

const GAP_PX = 16;
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
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
};

/**
 * Tracks are always `minmax(0, Nfr)` and never carry a pixel minimum. A pixel minimum in a
 * track definition is exactly what forces a grid wider than its container, which is the one
 * thing this layout must never do — column minimums are enforced while dragging instead.
 */
function trackTemplate(columns: readonly DashboardColumn[]): string {
  return columns.map((column) => `minmax(0, ${column.weight}fr)`).join(" ");
}

/**
 * `null` until hydration, meaning "unknown". Both branches render on the server so CSS can
 * hide the wrong one — correct first paint on either form factor — and exactly one survives
 * once this resolves, so no card is ever mounted twice.
 */
function useIsDesktop(): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(min-width: 1024px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => null,
  );
}

export function DashboardGrid({
  storedLayout,
  cards,
  editing,
  onEditingChange,
}: DashboardGridProps) {
  const isDesktop = useIsDesktop();
  const [stored, setStored] = useState<DashboardLayout>(storedLayout);
  const [saveStatus, setSaveStatus] = useState<LayoutSaveStatus>("idle");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef<DashboardLayout | null>(null);
  const serverSnapshot = useRef(JSON.stringify(storedLayout));

  const available = useMemo(() => Object.keys(cards) as DashboardCardId[], [cards]);

  // Re-seed from the server only when it genuinely changed and nothing is in flight, so a
  // re-render from an unrelated navigation cannot clobber an edit the user is mid-way through.
  useEffect(() => {
    const next = JSON.stringify(storedLayout);
    if (next === serverSnapshot.current || savingRef.current || pendingRef.current) return;
    serverSnapshot.current = next;
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
      setStored((current) => {
        const next = fn(current);
        scheduleSave(next);
        return next;
      });
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

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const rendered = useMemo(() => filterToAvailable(stored, available), [stored, available]);

  // The column count that actually fits. This, not a media query, is what guarantees the
  // dashboard reaches one column without a horizontal scrollbar: the user chooses how many
  // columns exist, so there is no fixed set of breakpoints to write.
  const renderedColumnCount = useMemo(() => {
    if (containerWidth <= 0) return rendered.columns.length;
    const fits = Math.floor((containerWidth + GAP_PX) / (MIN_COLUMN_PX + GAP_PX));
    return Math.max(1, Math.min(fits, rendered.columns.length));
  }, [containerWidth, rendered.columns.length]);

  const displayColumns = useMemo(
    () => collapseColumns(rendered.columns, renderedColumnCount),
    [rendered.columns, renderedColumnCount],
  );
  const collapsed = displayColumns.length !== rendered.columns.length;

  const settings = stored.settings;

  const onSettingsChange = useCallback<CardSettingsChange>(
    (cardId, patch) => {
      mutate((current) => ({
        ...current,
        settings: {
          ...current.settings,
          [cardId]: { ...(current.settings[cardId] ?? {}), ...patch },
        },
      }));
    },
    [mutate],
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

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId || overId.startsWith("stack:")) return;

      mutate((current) => moveSlot(current, activeId, overId));
    },
    [mutate],
  );

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

  const resetLayout = useCallback(() => {
    if (!window.confirm("Reset the dashboard to its default arrangement?")) return;
    mutate(() => JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DashboardLayout);
  }, [mutate]);

  const canAddColumn = stored.columns.length < MAX_COLUMNS;

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
    />
  );

  const mobileSlots = useMemo(() => {
    const allowed = new Set(available);
    return MOBILE_SLOTS.map((slot) => ({
      ...slot,
      cards: slot.cards.filter((card) => allowed.has(card)),
    })).filter((slot) => slot.cards.length > 0);
  }, [available]);

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
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <div
              ref={gridRef}
              className="grid min-w-0 items-start gap-4"
              style={{ gridTemplateColumns: trackTemplate(displayColumns) }}
            >
              {displayColumns.map((column, index) => (
                <div key={column.id} className="contents">
                  <div data-column-index={index} className="flex min-w-0 flex-col gap-4">
                    {editing && !collapsed ? (
                      <ColumnEditRail
                        index={index}
                        total={displayColumns.length}
                        weight={column.weight}
                        onRemove={() => removeColumn(index)}
                      />
                    ) : null}
                    <SortableContext
                      items={column.slots.map((slot) => slot.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {column.slots.map((slot) => renderSlot(slot, "tabs"))}
                    </SortableContext>
                    {editing && column.slots.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
                        Drag a card here
                      </p>
                    ) : null}
                  </div>
                  {editing && !collapsed && index < displayColumns.length - 1 ? (
                    <DashboardColumnResizer
                      index={index}
                      leftWeight={column.weight}
                      rightWeight={displayColumns[index + 1].weight}
                      minUnits={minUnits}
                      gridRef={gridRef}
                      onPreview={(delta) => previewTemplate(index, delta)}
                      onCommit={(delta) => commitResize(index, delta)}
                    />
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

function ColumnEditRail({
  index,
  total,
  weight,
  onRemove,
}: {
  index: number;
  total: number;
  weight: number;
  onRemove: () => void;
}) {
  const destination = index === 0 ? "column 2" : `column ${index}`;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1">
      <span className="text-[11px] text-slate-400">
        Column {index + 1} · {Math.round((weight / TOTAL_COLUMN_UNITS) * 100)}%
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
}: {
  slot: DashboardSlot;
  mode: "tabs" | "swipe";
  cards: DashboardCardContentMap;
  settings: DashboardCardSettings;
  editing: boolean;
  onSettingsChange: CardSettingsChange;
  onActiveIndexChange: (slotId: string, index: number) => void;
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

  const activeIndex = Math.min(slot.activeIndex, slot.cards.length - 1);
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
    onActiveIndexChange: (index) => onActiveIndexChange(slot.id, index),
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
      <div ref={setSortableRef} style={style}>
        <div ref={setStackDropRef}>
          <SingleCard
            cardId={slot.cards[0]}
            cards={cards}
            settings={settings}
            editing={editing}
            onSettingsChange={onSettingsChange}
            isStackTarget={isStackOver}
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
    <div ref={setSortableRef} style={style}>
      <div ref={setStackDropRef}>
        <DashboardCard
          cardId={slot.cards.join("+")}
          regionLabel={slotAccessibleName(slot.cards)}
          titleSlot={tabStrip}
          subtitle={activeCard ? cards[activeCard]?.subtitle : undefined}
          headerActions={activeCard ? cards[activeCard]?.headerActions : undefined}
          editing={editing}
          className={isStackOver ? "ring-2 ring-blue-400/60" : ""}
          settingsControl={
            activeCard ? (
              <CardSettingsControl cardId={activeCard} settings={settings} onChange={onSettingsChange} />
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

function SingleCard({
  cardId,
  cards,
  settings,
  editing,
  onSettingsChange,
  dragControl,
  isStackTarget,
}: {
  cardId: DashboardCardId;
  cards: DashboardCardContentMap;
  settings: DashboardCardSettings;
  editing: boolean;
  onSettingsChange: CardSettingsChange;
  dragControl?: ReactNode;
  isStackTarget?: boolean;
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
      settingsControl={<CardSettingsControl cardId={cardId} settings={settings} onChange={onSettingsChange} />}
      dragControl={dragControl}
    >
      {content.body}
    </DashboardCard>
  );
}
