export type TimelineDotVariant =
  | 'filled'   // solid accent dot — current or completed step
  | 'empty'    // hollow dot — future step
  | 'fork'     // hollow with inner accent circle — decision point
  | 'done';    // filled with checkmark, body at 50% opacity + strikethrough

export interface TimelineEvent {
  /** Unique identifier */
  id: string;
  /** Phase label shown above the title (e.g. "Phase 1") */
  phase?: string;
  /** Primary heading */
  title: string;
  /** Supporting note text */
  note?: string;
  /** Income range label (e.g. "$85K–$110K") shown as a pill tag after the phase */
  incomeRange?: string;
  /** Whether this event has a checkbox (for goal/career steps) */
  checkable?: boolean;
  /** Checked state when checkable is true */
  checked?: boolean;
  /** Dot variant. Default "filled". */
  dotVariant?: TimelineDotVariant;
}

export interface TimelineProps {
  events: TimelineEvent[];
  /** Accent hex color for dots, connector lines, and phase labels */
  accentColor: string;
  /** Callback when a checkable item is toggled */
  onCheck?: (id: string, checked: boolean) => void;
}
