import { useLocalSearchParams } from 'expo-router';

import { AddTransaction } from '@/screens/add';
import { receiptFromParams, type ReceiptParams } from '@/utils/shared-receipt';

/**
 * The Add sheet. Opened by Siri ("Log an expense", with `amount` and maybe `title`) and by a receipt
 * shared from another app (the `receipt…` params), it starts with those filled in.
 */
export default function AddRoute() {
  const params = useLocalSearchParams<{ type?: string; amount?: string; title?: string } & ReceiptParams>();
  const type = params.type === 'income' || params.type === 'transfer' ? params.type : 'expense';
  return (
    <AddTransaction
      initialType={type}
      prefill={{ amount: params.amount ?? '', title: params.title ?? '', photo: receiptFromParams(params) }}
    />
  );
}
