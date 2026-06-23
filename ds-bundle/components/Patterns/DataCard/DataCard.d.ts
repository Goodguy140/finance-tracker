export interface DataCardRow {
  id: string;
  label: string;
  amount: number;
}

export interface DataCardProps {
  /** Card header label (e.g. "Monthly budget") */
  title: string;
  /** Editable list rows */
  rows: DataCardRow[];
  /** Currency symbol. Default "$". */
  currencySymbol?: string;
  /** Label for the "add row" button. Default "+ Add row". */
  addLabel?: string;
  /** Callback when rows change (add / edit / delete) */
  onRowsChange?: (rows: DataCardRow[]) => void;
  /** When provided, renders a total row with this label */
  totalLabel?: string;
  /** When provided, renders a result banner (pass null to suppress) */
  resultMessage?: string | null;
  /** Determines banner color: "success" (emerald) or "warning" (amber) */
  resultVariant?: 'success' | 'warning';
}

export interface KpiCardProps {
  /** Overline label (uppercase, small) */
  label: string;
  /** Displayed value — supports inline editing when editable is true */
  value: string;
  /** Allows the user to edit the value inline. Default false. */
  editable?: boolean;
  /** Callback when an editable value changes */
  onChange?: (value: string) => void;
}
