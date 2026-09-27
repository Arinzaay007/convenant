// COVENANT's arithmetic is intentionally deterministic. SERV can interpret evidence;
// it cannot override these invariants or turn unsettled vault shares into cash.
const DAY = 24 * 60 * 60 * 1000;
const TYPES = new Set(['scheduled', 'performance', 'event']);

export function moneyToCents(value, field = 'amount') {
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${field} must be a non-negative USDC amount with at most 2 decimal places.`);
  }
  const [whole, decimals = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error(`${field} is too large.`);
  return amount;
}

export function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}

export function validISODate(input, field = 'date') {
  const value = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid calendar date.`);
  }
  return value;
}

export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
}

export function cleanScenario(raw, today = new Date().toISOString().slice(0, 10)) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Scenario is missing.');
  today = validISODate(today, 'today');
  const cash = moneyToCents(raw.cash ?? '0', 'Liquid cash');
  const floor = moneyToCents(raw.floor ?? '0', 'Minimum reserve');
  const proposed = moneyToCents(raw.proposed ?? '0', 'Proposed deposit');
  const existingVault = moneyToCents(raw.existingVault ?? '0', 'Existing vault position');
  const horizon = Number(raw.horizon ?? 30);
  const lag = Number(raw.redemptionLag ?? 3);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 90) throw new Error('Review window must be 1–90 days.');
  if (!Number.isInteger(lag) || lag < 0 || lag > 30) throw new Error('Stress-test redemption delay must be 0–30 days.');
  if (!Array.isArray(raw.obligations) || raw.obligations.length > 40) throw new Error('Provide at most 40 obligations.');
  const obligations = raw.obligations.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Commitment ${index + 1} is invalid.`);
    const label = String(item.label || '').trim().slice(0, 110);
    if (!label) throw new Error(`Commitment ${index + 1} needs a description.`);
    const kind = TYPES.has(item.kind) ? item.kind : 'scheduled';
    return {
      id: String(item.id || `item-${index}`).slice(0, 80),
      label,
      cents: moneyToCents(item.amount, `Amount for ${label}`),
      due: validISODate(item.due, `Due date for ${label}`),
      kind,
      provenance: String(item.provenance || 'manual').slice(0, 32),
      evidence: String(item.evidence || '').slice(0, 230)
    };
  });
  if (floor > cash) throw new Error('Minimum reserve cannot exceed liquid cash.');
  if (proposed > cash) throw new Error('Proposed deposit cannot exceed liquid cash.');
  return { today, cash, floor, proposed, existingVault, horizon, redemptionLag: lag, obligations };
}

export function runCheck(raw, today) {
  const input = cleanScenario(raw, today);
  const end = addDays(input.today, input.horizon);
  const active = input.obligations.filter(o => o.due <= end);
  const outside = input.obligations.filter(o => o.due > end);
  const rows = [];
  let cumulated = 0;
  let firstBreach = null;
  let baselineBreach = null;
  let minHeadroom = input.cash - input.floor;

  for (let i = 0; i <= input.horizon; i++) {
    const date = addDays(input.today, i);
    const dueItems = active.filter(o => o.due === date || (i === 0 && o.due < input.today));
    for (const o of dueItems) cumulated += o.cents;
    const baseline = input.cash - cumulated - input.floor;
    const afterDeposit = baseline - input.proposed;
    minHeadroom = Math.min(minHeadroom, baseline);
    const row = {
      date,
      day: i,
      due: dueItems.map(o => ({ id: o.id, label: o.label, kind: o.kind, cents: o.cents })),
      dueCents: dueItems.reduce((sum, o) => sum + o.cents, 0),
      cashAfterDepositCents: input.cash - input.proposed - cumulated,
      marginCents: afterDeposit,
      baselineMarginCents: baseline
    };
    rows.push(row);
    if (afterDeposit < 0 && !firstBreach) firstBreach = row;
    if (baseline < 0 && !baselineBreach) baselineBreach = row;
  }

  const safeMaxCents = Math.max(0, minHeadroom);
  const shortfallCents = firstBreach ? -firstBreach.marginCents : 0;
  const minMarginCents = Math.min(...rows.map(r => r.marginCents));
  const totalObligationsCents = active.reduce((sum, o) => sum + o.cents, 0);
  let verdict = 'safe_under_assumptions';
  if (baselineBreach) verdict = 'unfunded_obligations';
  else if (firstBreach) verdict = 'overallocated';
  // All commitments on a day are due together. Do not blame the first item in input
  // order when a later same-day liability is the one that actually crosses the floor.
  const proposedBreach = firstBreach?.due.length
    ? firstBreach.due.map(item => item.label).join(' + ')
    : 'required cash floor';

  return {
    status: verdict,
    safeMaxCents,
    proposedCents: input.proposed,
    cashCents: input.cash,
    floorCents: input.floor,
    existingVaultCents: input.existingVault,
    totalObligationsCents,
    firstBreach: firstBreach ? {
      date: firstBreach.date,
      day: firstBreach.day,
      shortfallCents,
      trigger: proposedBreach,
      due: firstBreach.due
    } : null,
    baselineBreach: baselineBreach ? { date: baselineBreach.date, shortfallCents: -baselineBreach.baselineMarginCents } : null,
    worstMarginCents: minMarginCents,
    horizonEnd: end,
    ignoredAfterHorizon: outside.length,
    redemptionAssumption: {
      delayDays: input.redemptionLag,
      assumedEarliestDate: addDays(input.today, input.redemptionLag),
      countedAsCash: false,
      caveat: 'An assumed exit delay is a stress-test input, not a vault guarantee. Existing positions and queued redemptions are never counted as liquid cash.'
    },
    source: 'deterministic',
    obligations: input.obligations,
    timeline: rows
  };
}
