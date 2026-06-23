export interface CheckboxProps {
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Callback when checked state changes */
  onChange: (checked: boolean) => void;
  /** Label text shown beside the checkbox */
  label?: string;
  /** When checked, apply line-through + 55% opacity to label */
  strikethrough?: boolean;
  /** Accent color for border and fill. Defaults to emerald #1D9E75 */
  accentColor?: string;
  /** Compact grid-cell variant (no label, 20×20px) */
  compact?: boolean;
  disabled?: boolean;
}
