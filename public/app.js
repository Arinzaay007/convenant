/* COVENANT — browser orchestration. Arithmetic and IXS permissioning run server-side. */
'use strict';
const $ = id => document.getElementById(id);
const DAY_MS = 86_400_000;
const utcToday = () => new Date().toISOString().slice(0, 10);
const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const dateLabel = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));
const usd = cents => '$' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: Number(cents || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const routeBSC = '56-0xc975a3eef2e49f8eddef585340c43f15300fcb82';
const validPublicAddress = address => /^0x[\da-fA-F]{40}$/.test(address) && address.toLowerCase() !== '0x0000000000000000000000000000000000000001';
const state = {
  today: utcToday(),
  obligations: [],
  result: null,
  reviewedScenario: null,
  vaults: [],
  vaultId: null,
  pilotCapacity: null,
  weather: null,
  intent: null,
  extraction: null,
  history: [],
  checking: false,
  preparing: false,
  requestSerial: 0
};
// Real-input mode: no cash, dates, or obligations are invented on page load.
// The isolated $1 pilot reads the connected wallet separately from this ledger.

function scenarioNow() {
  const obligations = state.obligations.map(o => ({ ...o }));
  if ($('storm-toggle').checked) obligations.push({
    id: 'what-if-disruption', label: 'Simulated storm-response reserve', kind: 'event',
    amount: $('storm-amount').value, due: $('storm-date').value, provenance: 'operator what-if',
    evidence: 'Operator-set stress scenario; forecast is not an insurance trigger.'
  });
  return {
    cash: $('cash-input').value, floor: $('floor-input').value, proposed: $('proposed-input').value,
    existingVault: $('existing-input').value, horizon: Number($('window-input').value),
    redemptionLag: Number($('lag-input').value), obligations
  };
}
async function api(path, options) {
  let response;
  try { response = await fetch(path, { ...options, cache: 'no-store' }); }
  catch { throw new Error('The COVENANT server could not be reached. Retry after checking your connection.'); }
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`${path} returned an unreadable response.`); }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}).`);
  return body;
}
function post(path, data) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
let toastTimer;
function toast(text, error = false) {
  const node = $('toast');
  node.textContent = text;
  node.classList.toggle('error', error);
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
}
function updateNav() { $('nav-obligation-count').textContent = String(state.obligations.length + Number($('storm-toggle').checked)); }
function renderLedger() {
  updateNav();
  const items = [...state.obligations];
  if ($('storm-toggle').checked) items.push({ id: 'what-if-disruption', label: 'Simulated storm-response reserve', kind: 'event', amount: $('storm-amount').value, due: $('storm-date').value, provenance: 'operator what-if' });
  items.sort((a, b) => a.due.localeCompare(b.due));
  const list = $('obligation-list');
  list.innerHTML = '';
  if (!items.length) { const div = document.createElement('div'); div.className = 'ledger-empty'; div.textContent = 'No commitments entered. Add your real, dated obligations before a decision can be computed.'; list.append(div); }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'ledger-row';
    const kindLabel = item.kind === 'event' ? 'Event what-if' : item.kind === 'performance' ? 'Conditional' : 'Scheduled';
    row.innerHTML = `<div><span class="ledger-name">${escapeHTML(item.label)}</span><span class="ledger-origin">${item.provenance === 'SERV' ? 'SERV · operator accepted' : item.provenance === 'scenario' ? 'Demo assumption' : item.provenance === 'operator what-if' ? 'Operator what-if · simulated' : 'Operator entry'}</span></div><div><span class="ledger-kind ${escapeHTML(item.kind)}">${kindLabel}</span></div><div>${item.due ? escapeHTML(dateLabel(item.due)) : 'Set date'}</div><div class="ledger-money">${usd(Math.round(Number(item.amount) * 100))}</div><button class="remove-row" type="button" aria-label="Remove ${escapeHTML(item.label)}">×</button>`;
    row.querySelector('button').addEventListener('click', () => {
      if (item.id === 'what-if-disruption') selectScenario(false);
      else { state.obligations = state.obligations.filter(o => o.id !== item.id); renderLedger(); markDirty(); requestCheck(); }
    });
    list.append(row);
  }
}
function renderMetrics() {
  const result = state.result;
  $('metric-cash').textContent = $('cash-input').value.trim() ? usd(Math.round(Number($('cash-input').value) * 100)) : '—';
  if (!result) {
    $('metric-safe').textContent = '—'; $('metric-owed').textContent = '—';
    $('metric-verdict').textContent = 'Not ready'; $('metric-verdict').style.color = '#9c763e';
    $('verdict-caption').textContent = 'No real decision yet'; $('safe-caption').textContent = 'Awaiting verified inputs';
    $('owed-caption').textContent = `${state.obligations.length} dated commitment(s) entered`;
    return;
  }
  $('metric-safe').textContent = usd(result.safeMaxCents);
  $('metric-owed').textContent = usd(result.totalObligationsCents);
  $('owed-caption').textContent = `${result.obligations.length - result.ignoredAfterHorizon} commitments in ${Number($('window-input').value)} days`;
  $('safe-caption').textContent = result.ignoredAfterHorizon ? `${result.ignoredAfterHorizon} later item(s) excluded` : 'Over the stated review window';
  const safe = result.status === 'safe_under_assumptions';
  $('metric-verdict').textContent = safe ? 'On track' : result.status === 'unfunded_obligations' ? 'Unfunded' : 'Redline';
  $('metric-verdict').style.color = safe ? '#317440' : '#c2604e';
  $('verdict-caption').textContent = safe ? 'Within the stated boundary' : result.firstBreach ? `First shortage ${dateLabel(result.firstBreach.date)}` : 'Cannot fund commitments';
}
function plotPath(values, x, y) {
  let d = `M${x(0).toFixed(1)},${y(values[0]).toFixed(1)}`;
  for (let i = 1; i < values.length; i++) d += ` L${x(i).toFixed(1)},${y(values[i - 1]).toFixed(1)} L${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;
  return d;
}
function renderChart(result) {
  const chart = $('liquidity-chart');
  if (!result) { chart.innerHTML = ''; chart.setAttribute('aria-label', 'Run a check to see the cash timeline'); return; }
  const rows = result.timeline, count = rows.length - 1, floor = result.floorCents / 100;
  const after = rows.map(r => r.cashAfterDepositCents / 100);
  const baseline = rows.map(r => (r.baselineMarginCents + result.floorCents) / 100);
  const topValue = Math.ceil(Math.max(floor, ...baseline, ...after) / 5000) * 5000 + 1000;
  const minValue = Math.min(0, Math.floor(Math.min(...after) / 2500) * 2500);
  const left = 55, right = 766, top = 10, bottom = 194;
  const x = index => left + (index / Math.max(count, 1)) * (right - left);
  const y = value => bottom - (value - minValue) / (topValue - minValue) * (bottom - top);
  const planPath = plotPath(after, x, y), baselinePath = plotPath(baseline, x, y);
  const areaPath = `${planPath} L${x(count).toFixed(1)},${bottom} L${left},${bottom} Z`;
  const floorY = y(floor), peakY = y(topValue), zeroY = y(0);
  const formatAxis = val => val >= 1000 ? `${Math.round(val / 1000)}k` : String(Math.round(val));
  let breachMarker = '';
  if (result.firstBreach) {
    const i = result.firstBreach.day;
    breachMarker = `<line x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="${bottom}" stroke="#df8c77" stroke-dasharray="3 5" stroke-width="1"/><circle cx="${x(i)}" cy="${y(after[i])}" r="6" fill="#d97a62" stroke="#fffefa" stroke-width="2.5"/>`;
  }
  chart.innerHTML = `<defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a8d898" stop-opacity=".21"/><stop offset="100%" stop-color="#a8d898" stop-opacity=".015"/></linearGradient></defs><line x1="${left}" y1="${peakY}" x2="${right}" y2="${peakY}" stroke="#e5ebe2"/><line x1="${left}" y1="${zeroY}" x2="${right}" y2="${zeroY}" stroke="#ebefe8"/><line x1="${left}" y1="${floorY}" x2="${right}" y2="${floorY}" stroke="#d68170" stroke-dasharray="3 4" stroke-width="1.4"/><text x="0" y="${peakY + 3}" fill="#a3afa5" font-size="10" font-family="sans-serif">${formatAxis(topValue)}</text><text x="0" y="${floorY + 4}" fill="#c88477" font-size="10" font-family="sans-serif">${formatAxis(floor)}</text><text x="0" y="${bottom}" fill="#a3afa5" font-size="10" font-family="sans-serif">${formatAxis(minValue)}</text><path d="${areaPath}" fill="url(#chart-fill)"/><path d="${baselinePath}" fill="none" stroke="#d0dacf" stroke-width="2.6" stroke-dasharray="5 5" stroke-linejoin="round"/><path d="${planPath}" fill="none" stroke="${result.firstBreach ? '#75ab64' : '#69ad61'}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>${breachMarker}`;
  chart.setAttribute('aria-label', `Liquid cash after deposit starts at ${usd(rows[0].cashAfterDepositCents)}, ends at ${usd(rows[count].cashAfterDepositCents)}; cash floor ${usd(result.floorCents)}${result.firstBreach ? `; first breach ${dateLabel(result.firstBreach.date)}` : '; no breach in this window'}.`);
  const axis = $('chart-axis');
  axis.innerHTML = '';
  for (const n of [0, .25, .5, .75, 1]) { const label = document.createElement('span'); label.textContent = n === 0 ? 'TODAY' : `DAY +${Math.round(count * n)}`; axis.append(label); }
}
function setCounter(tone, label, headline, description) {
  const node = $('counterexample');
  node.className = 'counterexample' + (tone === 'bad' ? ' bad' : tone === 'warn' ? ' warn' : '');
  node.querySelector('.counter-icon').textContent = tone === 'bad' ? '!' : tone === 'warn' ? '!' : '✓';
  const text = node.lastElementChild;
  text.children[0].textContent = label;
  text.children[1].textContent = headline;
  text.children[2].textContent = description;
}
function renderCounter(result) {
  $('proof-rule').textContent = result
    ? `Cash − new deposit − commitments due ≥ minimum reserve every day. Assumed ${result.redemptionAssumption.delayDays}-day exit is context only; no vault shares or queued withdrawals count as cash.`
    : 'Cash − new deposit − commitments due ≥ minimum reserve every day. Vault exits never count as cash.';
  if (!result) { setCounter('warn', 'CHECK REQUIRED', 'Your inputs have changed.', 'Run the liquidity check before preparing a new intent.'); return; }
  const extra = result.ignoredAfterHorizon ? ` ${result.ignoredAfterHorizon} later commitment(s) fall outside this window; drafting remains blocked until you extend it.` : '';
  if (result.status === 'safe_under_assumptions') {
    const future = result.obligations.filter(o => o.due <= result.horizonEnd).sort((a, b) => a.due.localeCompare(b.due))[0];
    setCounter(result.ignoredAfterHorizon ? 'warn' : 'good', 'PASSES — WITH ASSUMPTIONS', `${usd(result.proposedCents)} is below the ${usd(result.safeMaxCents)} safe maximum.`, `No dated shortfall before ${dateLabel(result.horizonEnd)}. Worst headroom above reserve: ${usd(result.worstMarginCents)}.${future ? ` Next commitment: ${future.label}, ${dateLabel(future.due)}.` : ''}${extra}`);
  } else if (result.status === 'unfunded_obligations') {
    setCounter('bad', 'REDLINE — BASELINE FAILURE', `Even a $0 deposit cannot cover your commitments.`, `Liquid cash already falls ${usd(result.baselineBreach.shortfallCents)} below your reserve on ${dateLabel(result.baselineBreach.date)}. Fund the obligations or revise the plan.${extra}`);
  } else {
    const breach = result.firstBreach;
    setCounter('bad', `FIRST SHORTFALL · ${dateLabel(breach.date).toUpperCase()}`, `Your plan is short ${usd(breach.shortfallCents)} on day ${breach.day}.`, `Due together: ${breach.trigger}. These commitments cross your cash floor. Maximum allocation: ${usd(result.safeMaxCents)}, not ${usd(result.proposedCents)}. No intent will be drafted.${extra}`);
  }
}
function markDirty() {
  state.requestSerial++;
  state.result = null; state.reviewedScenario = null; state.intent = null;
  $('prepare-result').className = 'prepare-result';
  $('prepare-result').textContent = 'Inputs changed. Run a new liquidity check before drafting.';
  renderMetrics(); renderCounter(null); renderChart(null); updatePrepareButton();
}
function recordRun(result, snapshot) {
  const line = { timestamp: new Date().toISOString(), scenario: $('storm-toggle').checked ? 'operator data + hypothetical disruption reserve' : 'operator-entered ledger', status: result.status, safeMaxCents: result.safeMaxCents, proposedCents: result.proposedCents, firstBreach: result.firstBreach ? { date: result.firstBreach.date, shortfallCents: result.firstBreach.shortfallCents } : null, assumption: `Cash and commitment data provided by operator; ${snapshot.redemptionLag}-day exit delay is not a guarantee.` };
  state.history.unshift(line); state.history = state.history.slice(0, 10);
  const container = $('run-log');
  container.innerHTML = '';
  for (const entry of state.history.slice(0, 3)) {
    const row = document.createElement('div');
    row.className = 'log-entry';
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(entry.timestamp));
    row.textContent = `${time} UTC · ${entry.scenario} · ${entry.status === 'safe_under_assumptions' ? 'PASS' : 'REDLINE'} · safe max ${usd(entry.safeMaxCents)}${entry.firstBreach ? ` · short ${usd(entry.firstBreach.shortfallCents)} on ${dateLabel(entry.firstBreach.date)}` : ''}`;
    container.append(row);
  }
}
async function requestCheck(manual = false) {
  const serial = ++state.requestSerial;
  const snapshot = scenarioNow();
  const missing = [];
  for (const [id, name] of [['cash-input', 'liquid USDC'], ['floor-input', 'minimum cash floor'], ['proposed-input', 'proposed allocation'], ['existing-input', 'existing IXS position (enter 0 if none)']]) {
    if (!$(id).value.trim()) missing.push(name);
  }
  if (!state.obligations.length) missing.push('at least one real, dated commitment');
  if ($('storm-toggle').checked && (!$('storm-amount').value.trim() || !$('storm-date').value.trim())) missing.push('your hypothetical reserve amount and date');
  if (missing.length) {
    state.checking = false; state.result = null; state.reviewedScenario = null; state.intent = null;
    $('run-button').disabled = false; $('run-button').firstChild.textContent = 'Run liquidity check ';
    renderMetrics(); renderChart(null); updatePrepareButton();
    setCounter('warn', 'NO DECISION — INCOMPLETE DATA', 'Enter your real inputs first.', `Missing: ${missing.join(', ')}. No default cash or obligations are assumed.`);
    if (manual) toast(`Cannot check yet: missing ${missing.join(', ')}.`, true);
    return;
  }
  state.checking = true; $('run-button').disabled = true; $('run-button').firstChild.textContent = 'Checking cash timeline… ';
  try {
    const result = await post('/api/check', { scenario: snapshot });
    if (serial !== state.requestSerial) return; // An in-flight result cannot make edited inputs appear reviewed.
    state.result = result;
    state.reviewedScenario = JSON.stringify(snapshot);
    state.intent = null;
    renderMetrics(); renderCounter(result); renderChart(result);
    recordRun(result, snapshot); updatePrepareButton();
    if (result.status !== 'safe_under_assumptions') toast(`Redline: ${result.firstBreach ? usd(result.firstBreach.shortfallCents) + ' short on ' + dateLabel(result.firstBreach.date) : 'liabilities are unfunded'}.`, true);
  } catch (error) {
    if (serial === state.requestSerial) {
      state.result = null; state.reviewedScenario = null; state.intent = null;
      renderMetrics(); renderChart(null); updatePrepareButton();
      setCounter('bad', 'CHECK FAILED', 'This plan has not been reviewed.', error.message);
      toast(error.message, true);
    }
  } finally {
    if (serial === state.requestSerial) { state.checking = false; $('run-button').disabled = false; $('run-button').firstChild.textContent = 'Run liquidity check '; }
  }
}
function selectScenario(on) {
  $('storm-toggle').checked = on;
  $('storm-fields').hidden = !on;
  $('scenario-quiet').classList.toggle('active', !on);
  $('scenario-storm').classList.toggle('active', on);
  $('scenario-quiet').setAttribute('aria-pressed', String(!on));
  $('scenario-storm').setAttribute('aria-pressed', String(on));
  renderLedger(); markDirty(); requestCheck();
  if (on) toast('Disruption what-if enabled. Enter your own amount and due date; this is not a claim trigger.');
}
function capacityBlocked(vault) { return vault?.depositProbe?.status === 'blocked' && /limit of 0(?:\s|\b)/i.test(vault.depositProbe.detail || ''); }
function selectedVault() { return state.vaults.find(v => v.id === state.vaultId); }
function updatePrepareButton() {
  const result = state.result;
  const vault = selectedVault();
  const eligible = !!result && result.status === 'safe_under_assumptions' && result.obligations.length > 0 && !result.ignoredAfterHorizon && result.proposedCents >= 10_000 &&
    state.reviewedScenario === JSON.stringify(scenarioNow()) && validPublicAddress($('wallet-input').value.trim()) && vault && !capacityBlocked(vault) && !state.preparing;
  $('prepare-button').disabled = !eligible;
  if (state.intent || state.preparing) return;
  if (!result) $('prepare-result').textContent = 'Run a current cash-flow check before preparing calldata.';
  else if (result.status !== 'safe_under_assumptions') $('prepare-result').textContent = 'Redline: no IXS calldata is requested when a dated shortfall exists.';
  else if (!result.obligations.length) $('prepare-result').textContent = 'Add at least one dated commitment before preparing an intent.';
  else if (result.ignoredAfterHorizon) $('prepare-result').textContent = 'A commitment falls outside the review window. Extend the window first.';
  else if (result.proposedCents < 10_000) $('prepare-result').textContent = 'The main review drafts unsigned intents from 100 USDC; the separate wallet pilot is hard-capped at $1.';
  else if (!validPublicAddress($('wallet-input').value.trim())) $('prepare-result').textContent = 'Enter your own public EVM address before asking IXS to build an unsigned plan. No dummy address is used.';
  else if (!vault) $('prepare-result').textContent = 'Live IXS vault data is required. This screen does not fabricate routes.';
  else if (capacityBlocked(vault)) $('prepare-result').textContent = `IXS reported a blocked capacity in a 100 USDC no-sign probe: ${vault.depositProbe.detail}`;
  else if (vault.id === routeBSC && state.pilotCapacity && BigInt(state.pilotCapacity.maxDepositUnits) === 0n) $('prepare-result').textContent = 'IXS can draft unsigned calldata, but on-chain maxDeposit is 0 for the sampled address. Inspection only—do NOT send it. The separate wallet pilot remains blocked until your address passes the chain check.';
  else $('prepare-result').textContent = 'Ready for live IXS unsigned calldata. This demo action never signs or submits.';
}
function renderVaults() {
  const node = $('vault-list'); node.innerHTML = '';
  if (!state.vaults.length) { node.innerHTML = '<div class="vault-loading">Live IXS routes unavailable. We will not substitute mock data.</div>'; $('vault-meta').textContent = 'Retry by reloading. No on-chain intent can be prepared offline.'; updatePrepareButton(); return; }
  for (const v of state.vaults) {
    const probe = v.depositProbe || { status: 'unknown', detail: 'Not checked' };
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'vault-option' + (v.id === state.vaultId ? ' selected' : '');
    const chain = v.chainId === 56 ? 'BSC' : v.chainId === 43114 ? 'AVAX' : `#${v.chainId}`;
    const onchainZero = v.id === routeBSC && state.pilotCapacity && BigInt(state.pilotCapacity.maxDepositUnits) === 0n;
    const probeText = onchainZero ? 'ONCHAIN CAP 0' : capacityBlocked(v) ? 'LIMIT 0' : probe.status === 'not_checked' ? 'ADDRESS REQUIRED' : probe.status === 'draftable' ? 'DRAFT ONLY' : probe.status === 'blocked' ? 'BLOCKED' : 'UNVERIFIED';
    btn.innerHTML = `<span class="chain-icon">${escapeHTML(chain)}</span><span class="vault-detail"><strong>${escapeHTML(v.name)} · ${escapeHTML(chain)}</strong><small>Public USDC · ${v.settlement === 'sync' ? 'sync deposit' : v.settlement === 'async-erc7540' ? 'async deposit' : 'settlement unverified'} · ${v.decimals} decimals</small></span><span class="vault-status ${probe.status === 'blocked' || onchainZero ? 'blocked' : ''}">${probeText}</span>`;
    btn.setAttribute('aria-pressed', String(v.id === state.vaultId));
    btn.addEventListener('click', () => { state.vaultId = v.id; state.intent = null; $('prepare-result').className = 'prepare-result'; renderVaults(); updatePrepareButton(); });
    node.append(btn);
  }
  const v = selectedVault();
  if (v) {
    const settlement = v.settlement === 'sync' ? 'Synchronous deposit route; withdrawal timing is NOT guaranteed.' : v.settlement === 'async-erc7540' ? 'ERC-7540: deposits and withdrawals can require later settlement/claim.' : 'Settlement could not be verified; treat exit as uncertain.';
    const onchain = v.id === routeBSC && state.pilotCapacity?.maxDepositUnits === '0'
      ? 'IMPORTANT: on-chain maxDeposit is 0 for the sampled address despite the MCP draft. Do not send funds.' : '';
    $('vault-meta').textContent = `${settlement} ${v.depositProbe?.detail || 'Capacity unverified.'} ${onchain} No dummy-wallet calldata is requested by discovery. A live catalog listing never establishes your wallet's eligibility. Updated ${new Date(state.vaultFetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC.`;
  }
  updatePrepareButton();
}
async function loadVaults() {
  try {
    const data = await api('/api/vaults');
    state.vaults = data.vaults || []; state.vaultFetchedAt = data.fetchedAt;
    if (!state.vaults.find(v => v.id === state.vaultId)) state.vaultId = (state.vaults.find(v => v.id === routeBSC) || state.vaults.find(v => v.depositProbe?.status === 'draftable') || state.vaults[0])?.id || null;
    $('live-connection').classList.remove('offline');
    $('live-connection').lastChild.textContent = state.vaults.length ? ' Live IXS data' : ' No public routes';
    renderVaults();
  } catch (error) {
    state.vaults = []; state.vaultId = null;
    $('live-connection').classList.add('offline'); $('live-connection').lastChild.textContent = ' IXS unavailable';
    renderVaults(); toast(error.message, true);
  }
}
async function loadWeather() {
  try {
    const data = await api('/api/weather'); state.weather = data;
    const sum = data.days.reduce((acc, d) => acc + Number(d.rainMm || 0), 0);
    const peak = Math.max(...data.days.map(d => Number(d.rainMm || 0)));
    $('weather-value').textContent = `${Math.round(sum)} mm / 7d`;
    $('weather-note').textContent = `Open-Meteo forecast fetched ${new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC. Peak daily rain ${Math.round(peak)} mm. Operator decides whether to model exposure; no automatic insurance claim or vault exit.`;
  } catch { $('weather-value').textContent = 'Unavailable'; $('weather-note').textContent = 'Forecast unavailable. The operator can still model a what-if reserve; it is not a live weather signal.'; }
}
async function prepareIntent() {
  if ($('prepare-button').disabled) return;
  const scenario = scenarioNow(), vault = selectedVault();
  state.preparing = true; updatePrepareButton(); $('prepare-result').textContent = 'Rechecking your plan and live IXS route; requesting an unsigned intent…';
  try {
    const intent = await post('/api/prepare', { scenario, amount: scenario.proposed, vaultId: vault.id, ownerAddress: $('wallet-input').value.trim() });
    if (state.reviewedScenario !== JSON.stringify(scenario)) throw new Error('Inputs changed during preparation. Rerun the check.');
    state.intent = intent;
    const out = $('prepare-result'); out.className = 'prepare-result'; out.innerHTML = '';
    const title = document.createElement('div'); title.className = 'intent-title'; title.textContent = `Live IXS returned ${intent.steps.length} unsigned step(s) for ${usd(Math.round(Number(intent.amount) * 100))}.`; out.append(title);
    for (const [i, step] of intent.steps.entries()) {
      const block = document.createElement('div'); block.className = 'intent-step';
      const bold = document.createElement('strong'); bold.textContent = `${i + 1}. ${String(step.type || 'transaction').replaceAll('_', ' ')}`;
      const desc = document.createElement('div'); desc.textContent = step.description || 'Review the IXS transaction data.';
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Inspect exact target + calldata';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(step.tx, null, 2); details.append(summary, pre); block.append(bold, desc, details); out.append(block);
    }
    const disclaimer = document.createElement('div'); disclaimer.className = 'intent-warning'; disclaimer.textContent = intent.disclaimer; out.append(disclaimer);
    if (vault.id === routeBSC && state.pilotCapacity?.maxDepositUnits === '0') {
      const block = document.createElement('div'); block.className = 'intent-warning';
      block.textContent = 'DO NOT SUBMIT: on-chain maxDeposit for the sampled BNB Chain address is 0. The MCP draft does not override the contract. Use the wallet-specific pilot check below; it will block while capacity is 0.';
      out.append(block);
    }
    state.history.unshift({ timestamp: intent.preparedAt, scenario: 'IXS unsigned intent', status: 'prepared_not_sent', vaultId: vault.id, amount: intent.amount });
    toast('IXS returned real unsigned steps. Nothing was sent on-chain.');
  } catch (error) {
    $('prepare-result').className = 'prepare-result error'; $('prepare-result').textContent = `No intent prepared: ${error.message}`; toast(error.message, true);
    if (/vault limit|capacity/i.test(error.message)) loadVaults();
  } finally { state.preparing = false; updatePrepareButton(); }
}
function renderExtraction(payload) {
  const node = $('serv-output'); node.className = 'serv-output success'; node.innerHTML = '';
  const intro = document.createElement('div'); intro.textContent = `${payload.obligations.length} extracted, pending operator approval. ${payload.warnings.length ? payload.warnings.length + ' caution(s).' : 'No parser warnings.'} No commitments added automatically.`; node.append(intro);
  for (const o of payload.obligations) {
    const row = document.createElement('div'); row.className = 'serv-result-item';
    const label = document.createElement('span'); label.textContent = `${o.label} · $${o.amount} · ${o.due} · ${o.confidence} confidence (quote: “${o.evidence}”)`;
    const add = document.createElement('button'); add.textContent = 'Accept'; add.type = 'button';
    add.addEventListener('click', () => { state.obligations.push({ ...o, id: `serv-${Date.now()}-${Math.random().toString(16).slice(2)}` }); add.disabled = true; add.textContent = 'Accepted'; renderLedger(); markDirty(); requestCheck(); toast('SERV suggestion added as a reviewed, dated liability.'); });
    row.append(label, add); node.append(row);
  }
  if (!payload.obligations.length) { const div = document.createElement('div'); div.textContent = 'No sufficiently grounded dated liabilities found. Adjust your note and retry.'; div.style.marginTop = '9px'; node.append(div); }
  for (const warning of payload.warnings) { const div = document.createElement('div'); div.textContent = `⚠ ${warning}`; div.style.marginTop = '6px'; node.append(div); }
}
async function interpretNote() {
  const key = $('key-input').value.trim(), note = $('note-input').value.trim();
  if (!key) { $('serv-output').className = 'serv-output error'; $('serv-output').textContent = 'Enter your own SERV API key to make a genuine reasoning request. Demo items above are not AI-generated.'; $('key-input').focus(); return; }
  if (note.length < 20) { toast('Provide at least 20 characters of operator note.', true); return; }
  $('interpret-button').disabled = true; $('serv-output').className = 'serv-output'; $('serv-output').textContent = 'Sending this note to SERV for structured extraction…';
  try { const result = await post('/api/interpret', { key, note }); state.extraction = result; renderExtraction(result); toast('SERV extraction returned. Confirm suggestions before adding them.'); }
  catch (error) { $('serv-output').className = 'serv-output error'; $('serv-output').textContent = `SERV integration failed: ${error.message} No obligations were added.`; toast(error.message, true); }
  finally { $('key-input').value = ''; $('interpret-button').disabled = false; }
}
function exportReceipt() {
  if (!state.result) { toast('Run a current liquidity check before exporting a decision.', true); return; }
  const receipt = {
    product: 'COVENANT', version: 'prototype-1', exportedAt: new Date().toISOString(),
    mode: 'no custody / no server signing; optional user-wallet mainnet pilot',
    scenario: state.reviewedScenario ? JSON.parse(state.reviewedScenario) : null,
    dataLabels: { defaultObligations: 'NONE; every ledger entry was entered or accepted by the operator', cash: 'OPERATOR ENTERED — not auto-verified against a bank or wallet', forecast: 'live Open-Meteo signal, not a claim', ixsVaults: 'live IXS REST/MCP catalog; NO dummy-address deposit probe', serv: state.extraction ? 'live SERV response; operator acceptance required' : 'NOT CALLED — no valid SERV key submitted' },
    decision: state.result, selectedVault: selectedVault() || null,
    weather: state.weather ? { source: state.weather.source, location: state.weather.location, fetchedAt: state.weather.fetchedAt, disclaimer: state.weather.disclaimer, days: state.weather.days } : null,
    extraction: state.extraction ? { ...state.extraction, noteStored: false } : null,
    unsignedIntent: state.intent || null, onchainPilot: window.covenantPilotReceipt || null, recentActions: state.history,
    warnings: ['No bank, payroll or obligation feed is connected. Main-scenario cash and commitments are operator-entered and not independently verified; the separate $1 pilot reads its own wallet-specific token balance.', 'Not a bond, regulated escrow, insurance, liquidity guarantee, or investment advice.', 'The exit-delay assumption is not a promise: existing shares and queued redemptions never increase liquid cash.', 'Only obligations included in the review window are counted. A passing decision is conditional on complete inputs.', 'An IXS MCP draft is unsigned and never proves actual on-chain deposit eligibility.']
  };
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `covenant-receipt-${utcToday()}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Downloaded a receipt of current inputs, decision and evidence. No API key included.');
}
let inputTimer;
function queueCheck() { renderLedger(); markDirty(); clearTimeout(inputTimer); inputTimer = setTimeout(requestCheck, 650); }
for (const id of ['cash-input','floor-input','proposed-input','existing-input','storm-amount','storm-date']) $(id).addEventListener('change', queueCheck);
for (const id of ['cash-input','floor-input','proposed-input','existing-input','storm-amount','storm-date']) $(id).addEventListener('input', () => { renderLedger(); markDirty(); clearTimeout(inputTimer); inputTimer = setTimeout(requestCheck, 900); });
for (const id of ['window-input','lag-input']) $(id).addEventListener('change', queueCheck);
$('scenario-quiet').addEventListener('click', () => { if ($('storm-toggle').checked) selectScenario(false); });
$('scenario-storm').addEventListener('click', () => { if (!$('storm-toggle').checked) selectScenario(true); });
$('storm-toggle').addEventListener('change', event => selectScenario(event.target.checked));
$('run-button').addEventListener('click', () => { clearTimeout(inputTimer); requestCheck(true); });
$('hero-run').addEventListener('click', () => { $('proof').scrollIntoView({ behavior: 'smooth', block: 'start' }); clearTimeout(inputTimer); requestCheck(true); });
$('key-shortcut').addEventListener('click', () => { $('serv').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('key-input').focus({ preventScroll: true }); });
$('prepare-button').addEventListener('click', prepareIntent);
$('interpret-button').addEventListener('click', interpretNote);
$('export-btn').addEventListener('click', exportReceipt);
$('wallet-input').addEventListener('input', () => { state.intent = null; updatePrepareButton(); });
$('toggle-key').addEventListener('click', () => { $('key-input').type = $('key-input').type === 'password' ? 'text' : 'password'; $('toggle-key').setAttribute('aria-label', $('key-input').type === 'password' ? 'Show API key' : 'Hide API key'); });
$('add-trigger').addEventListener('click', () => { $('add-form').hidden = false; $('add-trigger').hidden = true; $('add-label').focus(); });
$('cancel-add').addEventListener('click', () => { $('add-form').hidden = true; $('add-trigger').hidden = false; });
$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  state.obligations.push({ id: `manual-${Date.now()}`, label: $('add-label').value.trim(), amount: Number($('add-amount').value).toFixed(2), due: $('add-due').value, kind: $('add-kind').value, provenance: 'manual' });
  $('add-form').reset(); $('add-form').hidden = true; $('add-trigger').hidden = false;
  renderLedger(); markDirty(); requestCheck();
});
window.addEventListener('covenant:pilot-capacity', event => {
  state.pilotCapacity = event.detail;
  renderVaults();
});
renderLedger(); renderMetrics(); updatePrepareButton(); requestCheck(); loadVaults(); loadWeather();
