import type { Summary } from '@/api/types';
import { billsWidgetProps, safeToSpendWidgetProps } from '@/utils/widgets';
import BillsWidget from '@/widgets/bills';
import SafeToSpendWidget from '@/widgets/safe-to-spend';
import { SIGNED_OUT_BILLS, SIGNED_OUT_SAFE_TO_SPEND } from '@/widgets/signed-out';

/**
 * Writes Home's numbers to the home screen widgets. Called each time Home's summary loads, so a
 * widget is as fresh as the last time the app was opened (it says "As of …"). Never throws: a
 * widget that can't be updated must not break the screen that tried.
 */
export function updateWidgets(summary: Summary, now: Date = new Date()) {
  try {
    SafeToSpendWidget?.updateSnapshot(safeToSpendWidgetProps(summary, now));
    BillsWidget?.updateSnapshot(billsWidgetProps(summary, now));
  } catch {
    // Widgets are a convenience; the app works the same without them.
  }
}

/** Signing out takes the numbers off the home screen too. */
export function clearWidgets() {
  try {
    SafeToSpendWidget?.updateSnapshot(SIGNED_OUT_SAFE_TO_SPEND);
    BillsWidget?.updateSnapshot(SIGNED_OUT_BILLS);
  } catch {
    // Nothing more to do: the next sign-in writes over them.
  }
}
