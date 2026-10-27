import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationRefund } from '../src/domain/cancellation.ts';
const b={from_date:'2026-11-23',accommodation_cents:33000,cleaning_cents:6000,tax_cents:3120,total_cents:46800};
test('flexible policy refunds the full stay at least one day before arrival',()=>{assert.equal(cancellationRefund({...b,policy:'flexible'},'2026-11-22'),46800);assert.equal(cancellationRefund({...b,policy:'flexible'},'2026-11-23'),6000);assert.equal(cancellationRefund({...b,policy:'flexible'},'2026-11-24'),0);});
test('strict policy applies a partial refund at 14 days and cleaning-only closer to arrival',()=>{assert.equal(cancellationRefund({...b,policy:'strict'},'2026-11-09'),24060);assert.equal(cancellationRefund({...b,policy:'strict'},'2026-11-10'),6000);assert.equal(cancellationRefund({...b,policy:'strict'},'2026-11-24'),0);});
