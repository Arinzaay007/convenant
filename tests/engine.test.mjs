import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyToCents, centsToMoney, validISODate, addDays, cleanScenario, runCheck } from '../engine.mjs';

const today = '2026-09-24';
const due = n => addDays(today, n);
const normal = {
  cash: '20000', floor: '3000', proposed: '4000', existingVault: '0', horizon: 30, redemptionLag: 3,
  obligations: [
    { id: 'payout', label: 'Partner payouts', amount: '8000', due: due(4), kind: 'scheduled' },
    { id: 'credit', label: 'Service-credit liability', amount: '4000', due: due(5), kind: 'performance' }
  ]
};
const storm = { ...normal, obligations: [...normal.obligations, { id: 'storm', label: 'Storm reserve', amount: '4000', due: due(5), kind: 'event' }] };

test('USDC parsing is exact to cents, never floating point currency', () => {
  for (const [raw, amount] of [['0', 0], ['1', 100], ['1.2', 120], ['1.23', 123], ['12345678.01', 1_234_567_801]]) {
    assert.equal(moneyToCents(raw), amount); assert.equal(moneyToCents(centsToMoney(amount)), amount);
  }
  for (const bad of ['-1','1.234','01','1e6','NaN','Infinity','0.001','1,000','',null]) assert.throws(() => moneyToCents(bad));
});

test('dates are valid ISO calendar dates; UTC day arithmetic crosses month boundaries', () => {
  assert.equal(due(5), '2026-09-29');
  assert.equal(due(30), '2026-10-24');
  assert.equal(validISODate('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-29','2026-09-31','2026-9-24','tomorrow','2026-00-01']) assert.throws(() => validISODate(bad));
});

test('ordinary week passes, with $5k maximum and all redemptions excluded from cash', () => {
  const answer = runCheck(normal, today);
  assert.equal(answer.source, 'deterministic');
  assert.equal(answer.status, 'safe_under_assumptions');
  assert.equal(answer.safeMaxCents, 500_000);
  assert.equal(answer.worstMarginCents, 100_000);
  assert.equal(answer.firstBreach, null);
  assert.equal(answer.totalObligationsCents, 1_200_000);
  assert.equal(answer.timeline.length, 31);
  assert.equal(answer.timeline[4].cashAfterDepositCents, 800_000);
  assert.equal(answer.timeline[5].cashAfterDepositCents, 400_000);
  assert.equal(answer.redemptionAssumption.countedAsCash, false);
  const sharesDoNotHelp = runCheck({ ...normal, existingVault: '999999' }, today);
  assert.equal(sharesDoNotHelp.safeMaxCents, answer.safeMaxCents);
  assert.equal(sharesDoNotHelp.worstMarginCents, answer.worstMarginCents);
});

test('storm stress case pinpoints $3k first shortfall on the correct day', () => {
  const answer = runCheck(storm, today);
  assert.equal(answer.status, 'overallocated');
  assert.equal(answer.safeMaxCents, 100_000);
  assert.equal(answer.firstBreach.date, '2026-09-29');
  assert.equal(answer.firstBreach.day, 5);
  assert.equal(answer.firstBreach.shortfallCents, 300_000);
  assert.equal(answer.firstBreach.trigger, 'Service-credit liability + Storm reserve');
  assert.deepEqual(answer.firstBreach.due.map(x => x.id), ['credit','storm']);
  assert.equal(answer.timeline[5].cashAfterDepositCents, 0);
  assert.equal(answer.baselineBreach, null);
  assert.equal(answer.redemptionAssumption.assumedEarliestDate, '2026-09-27');
});

test('equality at the floor is safe, one cent more is overallocated', () => {
  assert.equal(runCheck({ ...normal, proposed: '5000.00' }, today).status, 'safe_under_assumptions');
  const answer = runCheck({ ...normal, proposed: '5000.01' }, today);
  assert.equal(answer.firstBreach.shortfallCents, 1);
  assert.equal(answer.status, 'overallocated');
});

test('obligations that cannot be funded even without a deposit are flagged separately', () => {
  const answer = runCheck({ ...normal, proposed: '0', cash: '10000' }, today);
  assert.equal(answer.status, 'unfunded_obligations');
  assert.equal(answer.safeMaxCents, 0);
  assert.equal(answer.baselineBreach.date, due(4));
  assert.equal(answer.baselineBreach.shortfallCents, 100_000);
});

test('an overdue invoice is payable on day zero, not silently ignored', () => {
  const answer = runCheck({ ...normal, obligations: [{ id: 'old', label: 'Late payable', amount: '15000', due: due(-2) }] }, today);
  assert.equal(answer.firstBreach.day, 0);
  assert.equal(answer.firstBreach.trigger, 'Late payable');
  assert.equal(answer.firstBreach.shortfallCents, 200_000);
});

test('items outside the review window are reported and not counted as safely covered', () => {
  const answer = runCheck({ ...normal, horizon: 14, obligations: [...normal.obligations, { id: 'future', label: 'Future payment', amount: '7000', due: due(35) }] }, today);
  assert.equal(answer.ignoredAfterHorizon, 1);
  assert.equal(answer.totalObligationsCents, 1_200_000);
  assert.equal(answer.horizonEnd, due(14));
});

test('same-day obligations are aggregated regardless of input order', () => {
  const answer = runCheck({ ...normal, obligations: [
    { id: 'a', label: 'First', amount: '2000.50', due: due(8), kind: 'scheduled' },
    { id: 'b', label: 'Second', amount: '3999.50', due: due(2), kind: 'performance' },
    { id: 'c', label: 'Third', amount: '6000.00', due: due(8), kind: 'event' }
  ] }, today);
  assert.equal(answer.safeMaxCents, 500_000);
  assert.equal(answer.timeline[8].dueCents, 800_050);
  assert.deepEqual(answer.timeline[8].due.map(x => x.id), ['a', 'c']);
});

test('invalid scenario inputs fail closed', () => {
  assert.throws(() => cleanScenario(null, today));
  assert.throws(() => runCheck({ ...normal, floor: '30000' }, today), /reserve cannot exceed/);
  assert.throws(() => runCheck({ ...normal, proposed: '20001' }, today), /cannot exceed/);
  assert.throws(() => runCheck({ ...normal, horizon: 91 }, today), /window/);
  assert.throws(() => runCheck({ ...normal, redemptionLag: -1 }, today), /delay/);
  assert.throws(() => runCheck({ ...normal, obligations: new Array(41).fill(normal.obligations[0]) }, today), /40/);
  assert.throws(() => runCheck({ ...normal, obligations: [{ label: 'Bad date', amount: '1', due: '2026-02-30' }] }, today), /calendar/);
  assert.throws(() => runCheck({ ...normal, obligations: undefined }, today), /obligations/);
});
