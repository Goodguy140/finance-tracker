import type { BillsWidgetProps } from './bills';
import type { SafeToSpendWidgetProps } from './safe-to-spend';

/*
 * What both widgets show before the app has loaded, and after signing out: no numbers at all.
 * They are also the props each widget starts with (`createWidget`).
 *
 * Widget props are stored in the App Group's UserDefaults, which takes property-list values only:
 * strings, numbers, booleans, lists and objects of those. Never null or undefined. A null here
 * made iOS refuse the write while the app was starting, and build 12 crashed on launch.
 *
 * The widget files import this with a relative path: expo-widgets bundles them on their own to
 * capture their layouts, and that bundle resolves nothing else (no `@/`).
 */
export const SIGNED_OUT_SAFE_TO_SPEND: SafeToSpendWidgetProps = {
  ready: false,
  amount: '',
  negative: false,
  perDay: '',
  asOf: '',
};

export const SIGNED_OUT_BILLS: BillsWidgetProps = {
  ready: false,
  title: '',
  rows: [],
  empty: '',
  totals: '',
  asOf: '',
};
