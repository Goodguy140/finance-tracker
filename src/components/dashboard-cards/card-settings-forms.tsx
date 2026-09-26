"use client";

import { CardSettingsPopover, SettingChoiceRow, SettingToggleRow } from "./card-settings-popover";
import { DASHBOARD_CARDS } from "@/lib/dashboard-layout/cards";
import type { DashboardCardId, DashboardCardSettings } from "@/lib/dashboard-layout/schema";

export type CardSettingsChange = <K extends DashboardCardId>(
  cardId: K,
  patch: Partial<NonNullable<DashboardCardSettings[K]>>,
) => void;

const CHART_HEIGHTS = [
  { value: "compact" as const, label: "Compact" },
  { value: "default" as const, label: "Default" },
  { value: "tall" as const, label: "Tall" },
];

const LIST_HEIGHTS = [
  { value: "short" as const, label: "Short" },
  { value: "default" as const, label: "Default" },
  { value: "tall" as const, label: "Tall" },
  { value: "unbounded" as const, label: "No limit" },
];

const DENSITIES = [
  { value: "expanded" as const, label: "Expanded" },
  { value: "compact" as const, label: "Compact" },
];

/**
 * The settings for one card, rendered inside its header popover. Each card's controls are
 * written out rather than generated from the schema: they need their own labels, hints and
 * ordering, and there are few enough of them that a table would cost more than it saved.
 */
export function CardSettingsControl({
  cardId,
  settings,
  onChange,
}: {
  cardId: DashboardCardId;
  settings: DashboardCardSettings;
  onChange: CardSettingsChange;
}) {
  const meta = DASHBOARD_CARDS[cardId];
  if (!meta.hasSettings) return null;

  return (
    <CardSettingsPopover title={meta.title}>
      <CardSettingsFields cardId={cardId} settings={settings} onChange={onChange} />
    </CardSettingsPopover>
  );
}

function CardSettingsFields({
  cardId,
  settings,
  onChange,
}: {
  cardId: DashboardCardId;
  settings: DashboardCardSettings;
  onChange: CardSettingsChange;
}) {
  switch (cardId) {
    case "add-expense": {
      const current = settings["add-expense"] ?? {};
      return (
        <>
          <p className="text-xs leading-snug text-slate-500">
            Which optional fields are already open when the form loads. You can still show or hide
            them per entry.
          </p>
          <SettingToggleRow
            label="Posted date"
            checked={current.showPostedDate ?? false}
            onChange={(showPostedDate) => onChange("add-expense", { showPostedDate })}
          />
          <SettingToggleRow
            label="Note"
            checked={current.showNote ?? false}
            onChange={(showNote) => onChange("add-expense", { showNote })}
          />
          <SettingToggleRow
            label="Receipt breakdown"
            hint="Enter a pre-credit total and the credits applied instead of a single amount."
            checked={current.showReceiptBreakdown ?? false}
            onChange={(showReceiptBreakdown) => onChange("add-expense", { showReceiptBreakdown })}
          />
        </>
      );
    }

    case "budgets": {
      const current = settings.budgets ?? {};
      return (
        <>
          <SettingChoiceRow
            label="Budgets per row"
            hint="More than one per row trades width for vertical space."
            value={current.perRow ?? 1}
            options={[
              { value: 1 as const, label: "1" },
              { value: 2 as const, label: "2" },
              { value: 3 as const, label: "3" },
            ]}
            onChange={(perRow) => onChange("budgets", { perRow })}
          />
          <SettingToggleRow
            label="Hide categories with no spending"
            checked={current.hideZeroSpend ?? false}
            onChange={(hideZeroSpend) => onChange("budgets", { hideZeroSpend })}
          />
          <SettingToggleRow
            label="Show the period explainer"
            hint="The note about how limits are summed for year-to-date and lifetime periods."
            checked={current.showPeriodNote ?? true}
            onChange={(showPeriodNote) => onChange("budgets", { showPeriodNote })}
          />
        </>
      );
    }

    case "spending-by-category": {
      const current = settings["spending-by-category"] ?? {};
      return (
        <>
          <SettingChoiceRow
            label="Chart height"
            value={current.chartHeight ?? "default"}
            options={CHART_HEIGHTS}
            onChange={(chartHeight) => onChange("spending-by-category", { chartHeight })}
          />
          <SettingChoiceRow
            label="Categories shown"
            hint="The rest are grouped into a single slice."
            value={current.maxSlices ?? 8}
            options={[
              { value: 5 as const, label: "5" },
              { value: 8 as const, label: "8" },
              { value: 12 as const, label: "12" },
            ]}
            onChange={(maxSlices) => onChange("spending-by-category", { maxSlices })}
          />
        </>
      );
    }

    case "cumulative-spend": {
      const current = settings["cumulative-spend"] ?? {};
      return (
        <>
          <SettingChoiceRow
            label="Chart height"
            value={current.chartHeight ?? "default"}
            options={CHART_HEIGHTS}
            onChange={(chartHeight) => onChange("cumulative-spend", { chartHeight })}
          />
          <SettingToggleRow
            label="Show the expected-spend line"
            checked={current.showExpectedLine ?? true}
            onChange={(showExpectedLine) => onChange("cumulative-spend", { showExpectedLine })}
          />
        </>
      );
    }

    case "expense-log": {
      const current = settings["expense-log"] ?? {};
      return (
        <>
          <SettingChoiceRow
            label="Row density"
            value={current.density ?? "expanded"}
            options={DENSITIES}
            onChange={(density) => onChange("expense-log", { density })}
          />
          <SettingChoiceRow
            label="List height"
            value={current.maxHeight ?? "default"}
            options={LIST_HEIGHTS}
            onChange={(maxHeight) => onChange("expense-log", { maxHeight })}
          />
          <SettingToggleRow
            label="Show the bank review queue"
            hint="Transactions synced from a linked bank, waiting to be added to the log."
            checked={current.showReviewQueue ?? true}
            onChange={(showReviewQueue) => onChange("expense-log", { showReviewQueue })}
          />
        </>
      );
    }

    case "income": {
      const current = settings.income ?? {};
      return (
        <>
          <SettingChoiceRow
            label="Row density"
            value={current.density ?? "expanded"}
            options={DENSITIES}
            onChange={(density) => onChange("income", { density })}
          />
          <SettingChoiceRow
            label="List height"
            value={current.maxHeight ?? "default"}
            options={LIST_HEIGHTS}
            onChange={(maxHeight) => onChange("income", { maxHeight })}
          />
        </>
      );
    }

    case "recurring": {
      const current = settings.recurring ?? {};
      return (
        <>
          <SettingToggleRow
            label="Show the cash-flow summary"
            hint="Expected income, expected expenses and net for the forecast period."
            checked={current.showCashFlowSummary ?? true}
            onChange={(showCashFlowSummary) => onChange("recurring", { showCashFlowSummary })}
          />
          <SettingChoiceRow
            label="Rules shown"
            value={current.rowLimit ?? 12}
            options={[
              { value: 6, label: "6" },
              { value: 12, label: "12" },
              { value: 25, label: "25" },
              { value: 50, label: "All" },
            ]}
            onChange={(rowLimit) => onChange("recurring", { rowLimit })}
          />
        </>
      );
    }

    case "insights": {
      const current = settings.insights ?? {};
      return (
        <SettingChoiceRow
          label="Insights shown"
          value={current.maxItems ?? 3}
          options={[
            { value: 3, label: "3" },
            { value: 5, label: "5" },
            { value: 8, label: "8" },
          ]}
          onChange={(maxItems) => onChange("insights", { maxItems })}
        />
      );
    }

    default:
      return null;
  }
}
