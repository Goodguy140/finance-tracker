export interface NavTabItem {
  /** Unique key for this tab */
  key: string;
  /** Display label */
  label: string;
}

export interface NavTabProps {
  /** Tab items to render */
  items: NavTabItem[];
  /** Key of the currently active tab */
  activeKey: string;
  /** Callback when a tab is clicked */
  onChange: (key: string) => void;
}

export interface SegmentControlProps {
  /** Options to render */
  options: string[];
  /** Currently selected option */
  value: string;
  /** Callback when an option is selected */
  onChange: (value: string) => void;
}

export interface DashboardHeaderProps {
  /** Eyebrow label shown above the title (uppercase, small) */
  eyebrow?: string;
  /** Main heading */
  title: string;
  /** Optional slot for action buttons on the right */
  actions?: React.ReactNode;
  /** Whether to apply sticky positioning. Default true. */
  sticky?: boolean;
}
