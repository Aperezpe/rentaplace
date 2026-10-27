import { daysBetween } from '../config.ts';
import type { Policy } from '../types.ts';
export function cancellationRefund(booking: {from_date:string;policy:Policy;accommodation_cents:number;cleaning_cents:number;tax_cents:number;total_cents:number},cancelDate: string): number {
  const days=daysBetween(cancelDate,booking.from_date);
  if(days<0)return 0;
  if(booking.policy==='flexible' && days>=1)return booking.total_cents;
  if(booking.policy==='moderate' && days>5)return booking.total_cents;
  if(booking.policy==='strict' && days>=14)return Math.round(booking.accommodation_cents/2)+booking.cleaning_cents+Math.round(booking.tax_cents/2);
  if(booking.policy==='moderate')return Math.round(booking.accommodation_cents/2)+booking.cleaning_cents+Math.round(booking.tax_cents/2);
  return booking.cleaning_cents;
}
export const policyText = {
  flexible:'Full refund when cancelled at least 1 day before check-in. After that, the cleaning fee is refunded before arrival.',
  moderate:'Full refund when cancelled at least 5 days before check-in. After that, 50% of accommodation and tax, plus the cleaning fee, is refunded before arrival.',
  strict:'At least 14 days before check-in: 50% of accommodation and tax, plus the cleaning fee. Closer to check-in: cleaning fee only. Service fees are non-refundable.'
};
