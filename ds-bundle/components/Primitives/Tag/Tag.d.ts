export type TagVariant =
  | 'gold'      // #C9A44C — Path A / mixed
  | 'red'       // #D94F3D — high risk, departure
  | 'emerald'   // #1D9E75 — on track, healthy
  | 'blue'      // #3A82C4 — remote, info
  | 'violet'    // #6B5CE7 — learning, B5 path
  | 'orange'    // #F97316 — hybrid path
  | 'success'   // emerald-200 semantic — done
  | 'warning'   // amber semantic — in progress
  | 'danger'    // red-300 semantic — overdue
  | 'neutral';  // slate semantic — paused

export interface TagProps {
  /** Display text */
  children: React.ReactNode;
  /** Color variant. Provide `color` instead for an arbitrary hex accent. */
  variant?: TagVariant;
  /** Arbitrary hex accent color (e.g. "#6B5CE7"). Overrides `variant`. */
  color?: string;
  /** Extra inline style overrides */
  style?: React.CSSProperties;
}
