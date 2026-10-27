import './styles.css';
import {
  parseCsv, toBatteries, toTariffs, simulateAllSizes, compare, rankBatteries,
  monthlyBreakdown, dailyProfile, dailySavings, contractView, rteAt, projectYears, meterPrice,
  type Battery, type CompareRow, type Hour, type RankedBattery, type Sim, type Tariff,
} from './simulate.ts';
import { fmt, sizeChart, monthlyChart, profileChart, dailyChart, balanceChart } from './charts.ts';
import { bindImport, initialData, renderDataStatus, type LoadedData } from './import.ts';

const DEFAULT_SCENARIO = 'eneco_3y';
const DEFAULT_BATTERY = 'homewizard';
const RANKING_ROWS = 5;

// What-if presets, in slider units (percent). "Realistic" follows typical battery ageing,
// a modest price rise and the shortfall hourly data tends to hide.
const WHAT_IF_PRESETS = [
  { id: 'same', label: 'Same as last year', values: { usage: 0, solar: 0, price: 0, ageing: 0, shortfall: 0 } },
  { id: 'pessimistic', label: 'Pessimistic', values: { usage: -10, solar: -10, price: -1, ageing: 3, shortfall: 10 } },
  { id: 'realistic', label: 'Realistic', values: { usage: 0, solar: 0, price: 2, ageing: 2, shortfall: 7 } },
  { id: 'optimistic', label: 'Optimistic', values: { usage: 10, solar: 5, price: 4, ageing: 1, shortfall: 3 } },
];
const WHAT_IF_SLIDERS = ['usage', 'solar', 'price', 'ageing', 'shortfall'] as const;
type WhatIfKey = typeof WHAT_IF_SLIDERS[number];

interface State {
  hours: Hour[];
  batteries: Battery[];
  tariffs: Tariff[];
  scenario: string;
  importEurKwh: number;
  netExportEurKwh: number;
  p1Owned: boolean;
  lifetimeYears: number;
  monthlyInstalmentEur: number;
  yearlyDiscountEur: number;
  batteryId: string;
  units: number;
  priceOverrides: Record<string, number>;
  whatIfPreset: string | null;
  rankingExpanded: boolean;
  whatIf: Record<WhatIfKey, number>;
  simsById: Map<string, Sim[]>;
  profile: ReturnType<typeof dailyProfile>;
}

const state: State = {
  hours: [],
  batteries: [],
  tariffs: [],
  scenario: DEFAULT_SCENARIO,
  importEurKwh: 0,
  netExportEurKwh: 0,
  p1Owned: false,
  lifetimeYears: 15,
  monthlyInstalmentEur: 65,
  yearlyDiscountEur: 150,
  batteryId: DEFAULT_BATTERY,
  units: 1,
  priceOverrides: {},
  whatIfPreset: 'realistic',
  rankingExpanded: false,
  whatIf: { ...WHAT_IF_PRESETS.find((p) => p.id === 'realistic')!.values },
  simsById: new Map(),
  profile: [],
};

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const css = (name: string) => `var(${name})`;

async function fetchCsv(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
  return parseCsv(await res.text());
}

// A battery with any price the user typed in applied.
const priced = (b: Battery): Battery => (b.id in state.priceOverrides ? { ...b, firstUnitEur: state.priceOverrides[b.id] } : b);
const activeBattery = () => priced(state.batteries.find((b) => b.id === state.batteryId)!);
const activeTariff = () => ({ importEurKwh: state.importEurKwh, netExportEurKwh: state.netExportEurKwh });
const opts = () => ({ p1Owned: state.p1Owned, lifetimeYears: state.lifetimeYears });

// "the Marstek" / "2 HomeWizard batteries": short enough to drop into a sentence.
function configName(b: Battery, n: number) {
  return n === 1 ? `the ${b.brand}` : `${n} ${b.brand} batteries`;
}

function paybackText(years: number | null) {
  return years && years <= state.lifetimeYears ? `${fmt.years(years)} years` : `Not within ${state.lifetimeYears} years`;
}

function runSimulation() {
  state.simsById = new Map(state.batteries.map((b) => [b.id, simulateAllSizes(state.hours, b)]));
  state.profile = dailyProfile(state.hours);
}

function applyScenario(key: string) {
  const t = state.tariffs.find((x) => x.scenario === key);
  if (!t) return;
  state.scenario = key;
  state.importEurKwh = t.importEurKwh;
  state.netExportEurKwh = t.netExportEurKwh;
  input('import-price').value = String(t.importEurKwh);
  input('feedin-value').value = String(t.netExportEurKwh);
}

function selectBattery(id: string, units?: number) {
  state.batteryId = id;
  const b = activeBattery();
  state.units = Math.min(Math.max(1, units ?? state.units), b.maxUnits);
  input('battery-select').value = id;
  input('unit-price').value = String(b.firstUnitEur);
  renderUnitOptions();
}

function renderBatteryOptions() {
  $('battery-select').replaceChildren(...state.batteries.map((b) => {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = `${b.name} (${b.unitKwh.toFixed(1)} kWh)`;
    return o;
  }));
}

function renderUnitOptions() {
  const b = activeBattery();
  $('units-select').replaceChildren(...Array.from({ length: b.maxUnits }, (_, i) => {
    const n = i + 1;
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n} × (${(n * b.unitKwh).toFixed(1)} kWh in total)`;
    return o;
  }));
  input('units-select').value = String(state.units);
  input('units-select').disabled = b.maxUnits === 1;
}

function renderScenarioButtons() {
  const custom = !state.tariffs.some(
    (t) => t.scenario === state.scenario && t.importEurKwh === state.importEurKwh && t.netExportEurKwh === state.netExportEurKwh,
  );
  $('scenarios').replaceChildren(...state.tariffs.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.label;
    b.title = t.note;
    b.setAttribute('aria-pressed', String(!custom && t.scenario === state.scenario));
    b.addEventListener('click', () => { applyScenario(t.scenario); render(); });
    return b;
  }));
  $('custom-flag').hidden = !custom && !Object.keys(state.priceOverrides).length;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const FLAG_LABELS: Record<string, string> = { tweakers: 'Tweakers', tweakers_home: 'Tweakers', review: 'review', manufacturer: 'manufacturer', assumed: 'assumed' };

// One label per value saying where it comes from, with a tooltip that explains how it was gathered.
function sourceFlag(source: string, tip: string) {
  const s = document.createElement('span');
  s.className = `flag ${source}`;
  s.textContent = FLAG_LABELS[source] ?? source;
  s.dataset.tip = tip;
  s.tabIndex = 0;
  s.setAttribute('role', 'note');
  s.setAttribute('aria-label', `${s.textContent}: ${tip}`);
  return s;
}

const LOW_POWER_EXPLAINED = 'Tweakers found that the batteries it tested keep on average 76% of their 800 W efficiency at 200 W, and 94% at 500 W.';

function efficiencyTip(b: Battery) {
  const at800 = pct(rteAt(b, 0.8));
  const at200 = pct(rteAt(b, 0.2));
  const curve = b.rteCurve.map(([kw, r]) => `${pct(r)} at ${fmt.watts(kw)}`).join(', ');
  if (b.efficiencySource === 'tweakers') {
    return `Measured by Tweakers in its own lab: ${curve}. Every hour of your data uses the efficiency that matches that hour's power.`;
  }
  if (b.efficiencySource === 'tweakers_home') {
    return `Measured by Tweakers' reviewer at home over a full year (375 days, 2025–2026): 905 kWh went into the battery and 677 kWh came out, ${at800} overall. ` +
      'That is an average over all power levels, from midday charging to a quiet night, so the same value is used at every power.';
  }
  if (b.efficiencySource === 'assumed') {
    return `Assumed: no independent test of this battery was found. The ${at800} at 800 W is a typical value for this kind of battery. ` +
      `The ${at200} at 200 W is then estimated from it: ${LOW_POWER_EXPLAINED}`;
  }
  return `The ${at800} at 800 W was measured by ${b.efficiencyBy || 'a reviewer'}. Nobody measured it at lower power, ` +
    `so the ${at200} at 200 W is estimated: ${LOW_POWER_EXPLAINED}`;
}

function standbyTip(b: Battery) {
  if (b.standbySource === 'tweakers') return `Measured by Tweakers: the average power the battery uses while idle, both half full and empty.`;
  if (b.standbySource === 'review') return `Measured by ${b.standbyBy || 'a reviewer'} while the battery was idle.`;
  if (b.standbySource === 'manufacturer') return 'Stated by the manufacturer, not measured independently.';
  return `Assumed: no measurement of this battery was found. ${b.standbyW} W is a guess based on similar batteries; Tweakers measured 10 to 19 W.`;
}

// One floating tooltip for all source labels. It lives on <body> so table scrolling can't clip it.
const sourceTip = document.createElement('div');
sourceTip.className = 'source-tip';
sourceTip.hidden = true;
sourceTip.setAttribute('role', 'tooltip');
document.body.appendChild(sourceTip);
let tipOwner: HTMLElement | null = null;

function showSourceTip(flag: HTMLElement) {
  tipOwner = flag;
  sourceTip.textContent = flag.dataset.tip ?? '';
  sourceTip.hidden = false;
  const r = flag.getBoundingClientRect();
  const w = sourceTip.offsetWidth, h = sourceTip.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
  sourceTip.style.left = `${left}px`;
  sourceTip.style.top = `${top}px`;
}

function hideSourceTip() {
  tipOwner = null;
  sourceTip.hidden = true;
}

function bindSourceTips() {
  const flagOf = (ev: Event) => (ev.target as Element | null)?.closest?.<HTMLElement>('.flag[data-tip]') ?? null;
  document.addEventListener('mouseover', (ev) => { const f = flagOf(ev); if (f) showSourceTip(f); });
  document.addEventListener('mouseout', (ev) => { const f = flagOf(ev); if (f && !f.contains(ev.relatedTarget as Node | null)) hideSourceTip(); });
  document.addEventListener('focusin', (ev) => { const f = flagOf(ev); if (f) showSourceTip(f); });
  document.addEventListener('focusout', (ev) => { if (flagOf(ev)) hideSourceTip(); });
  // Tapping a label on a phone shows its tip instead of selecting the table row it sits in.
  document.addEventListener('click', (ev) => {
    const f = flagOf(ev);
    if (f) {
      ev.stopPropagation();
      if (tipOwner === f) hideSourceTip(); else showSourceTip(f);
    } else hideSourceTip();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideSourceTip(); });
  window.addEventListener('scroll', hideSourceTip, { passive: true, capture: true });
}

function renderRanking(ranking: RankedBattery[]) {
  const top = ranking[0];
  const maxAbs = Math.max(...ranking.map((r) => Math.abs(r.lifetimeResultEur)));
  $('ranking-body').replaceChildren(...ranking.map((r) => {
    const b = r.battery;
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.className = 'pick' + (b.id === state.batteryId ? ' active' : '');
    // The top few answer the question; the chosen battery stays visible wherever it ranks.
    tr.hidden = !state.rankingExpanded && ranking.indexOf(r) >= RANKING_ROWS && b.id !== state.batteryId;
    tr.title = `Show ${b.name} below`;

    const name = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = b.name;
    name.append(strong);
    if (r === top) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = 'Best buy';
      name.append(' ', pill);
    }

    const cells: (HTMLElement | string | (string | HTMLElement)[] | null)[] = [
      name,
      `${r.units} × ${r.capacityKwh.toFixed(1)} kWh`,
      fmt.eur(r.costEur),
      fmt.eur(r.savingEur),
      paybackText(r.paybackYears),
      null,
      [`${pct(rteAt(b, 0.8))} / ${pct(rteAt(b, 0.2))}`, sourceFlag(b.efficiencySource, efficiencyTip(b))],
      [`${b.standbyW * r.units} W`, sourceFlag(b.standbySource, standbyTip(b))],
      `${b.warrantyYears} years`,
    ];
    cells.forEach((c, i) => {
      let td: HTMLElement;
      if (c instanceof HTMLElement) td = c;
      else {
        td = document.createElement('td');
        if (Array.isArray(c)) td.append(...c.flatMap((x, j) => (j ? [' ', x] : [x])));
        else if (c !== null) td.textContent = c;
      }
      if (i > 0) td.classList.add('num');
      if (i >= 6) td.classList.add('wide-only');
      if (i === 5) {
        td.classList.add('bar-cell', r.lifetimeResultEur < 0 ? 'neg' : 'pos');
        const bar = document.createElement('span');
        bar.className = 'cell-bar';
        bar.style.width = `${(Math.abs(r.lifetimeResultEur) / maxAbs) * 100}%`;
        const label = document.createElement('span');
        label.textContent = fmt.signedEur(r.lifetimeResultEur);
        td.append(bar, label);
      }
      if (i === 8 && b.warrantyYears < 5) td.classList.add('warn');
      tr.appendChild(td);
    });
    const pick = () => {
      selectBattery(b.id, r.units);
      render();
      $('chosen-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    return tr;
  }));
}

function renderRankingToggle(count: number) {
  const toggle = $('ranking-toggle');
  toggle.hidden = count <= RANKING_ROWS;
  toggle.textContent = state.rankingExpanded ? `Show the top ${RANKING_ROWS}` : `Show all ${count} batteries`;
}

function renderSummary(rows: CompareRow[], ranking: RankedBattery[]) {
  const b = activeBattery();
  const none = rows[0];
  const chosen = rows.find((r) => r.units === state.units)!;
  const best = ranking[0];
  const ct = (eur: number) => (eur * 100).toFixed(eur * 100 < 10 ? 2 : 1);

  const strong = document.createElement('strong');
  strong.textContent = `${best.units} × ${best.battery.name}`;
  $('takeaway').replaceChildren(
    'On this data the best buy is ', strong,
    `: it costs ${fmt.eur(best.costEur)}, saves ${fmt.eur(best.savingEur)} a year and ${fmt.payback(best.paybackYears, state.lifetimeYears)}. ` +
    `From 2027 a kWh you use yourself saves ${ct(state.importEurKwh)} ct; one you send back earns ${ct(state.netExportEurKwh)} ct.`,
  );

  for (const el of document.querySelectorAll('.config-name')) el.textContent = configName(b, state.units);
  for (const el of document.querySelectorAll('.lifetime-years')) el.textContent = String(state.lifetimeYears);

  $('tile-saving').textContent = fmt.eur(chosen.savingEur);
  $('tile-saving-month').textContent = fmt.eurCents(chosen.savingEur / 12);
  $('tile-saving-day').textContent = fmt.eurCents(chosen.savingEur / 365);
  $('tile-payback').textContent = paybackText(chosen.paybackYears);
  $('tile-price').textContent = fmt.eur(chosen.costEur);
  $('tile-p1').textContent = meterText(b, { short: true });
  $('tile-bill').textContent = fmt.eur(none.billEur);
  $('tile-export').textContent = fmt.kwh(state.simsById.get(b.id)![0].exportKwh);
  $('tile-used').textContent = fmt.kwh(chosen.fromBatteryKwh);
}

// Where the solar surplus goes over the year with the chosen battery. Into the battery = what it took off
// the exports; back to the house = what it took off the imports; the difference is lost on the way.
function renderFlow() {
  const sims = state.simsById.get(activeBattery().id)!;
  const base = sims[0];
  const sim = sims.find((s) => s.units === state.units)!;
  const charged = base.exportKwh - sim.exportKwh;
  const useful = base.importKwh - sim.importKwh;
  const node = (label: string, kwh: number, sub: string, battery = false) => {
    const div = document.createElement('div');
    div.className = 'flow-node' + (battery ? ' battery' : '');
    const l = document.createElement('span');
    l.className = 'flow-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'flow-value';
    const unit = document.createElement('small');
    unit.textContent = 'kWh';
    v.append(fmt.kwh(kwh), unit);
    const s = document.createElement('span');
    s.className = 'flow-sub';
    s.textContent = sub;
    div.append(l, v, s);
    return div;
  };
  $('flow').replaceChildren(
    node('Solar left over', base.exportKwh, 'Without a battery all of it goes to the grid'),
    node('Into the battery', charged, `${pct(base.exportKwh ? charged / base.exportKwh : 0)} of the surplus`, true),
    node('Back to your house', useful, `${fmt.kwh(charged - useful)} kWh lost to heat and standby`, true),
    node('Still sent to the grid', sim.exportKwh, `Earns ${(state.netExportEurKwh * 100).toFixed(2)} ct per kWh`),
  );
}

function renderContract(rows: CompareRow[]) {
  const row = rows.find((r) => r.units === state.units)!;
  const v = contractView(
    { monthlyInstalmentEur: state.monthlyInstalmentEur, yearlyDiscountEur: state.yearlyDiscountEur },
    row.savingEur,
  );
  const perMonth = (eur: number) => `${fmt.eurCents(eur / 12)} / month`;
  $('ledger-instalments').textContent = `12 × ${fmt.eurCents(state.monthlyInstalmentEur)} = ${fmt.eur(state.monthlyInstalmentEur * 12)}`;
  $('ledger-discount').textContent = '−' + fmt.eur(state.yearlyDiscountEur);
  $('ledger-yearly').textContent = fmt.eur(v.yearlyEur);
  $('ledger-yearly-month').textContent = perMonth(v.yearlyEur);
  $('ledger-saving').textContent = `−${fmt.eur(row.savingEur)} (${fmt.eurCents(v.savingPerMonthEur)} / month)`;
  $('ledger-with').textContent = fmt.eur(v.withBatteryEur);
  $('ledger-with-month').textContent = perMonth(v.withBatteryEur);
}

function renderTable(rows: CompareRow[]) {
  const b = activeBattery();
  $('results-body').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (r.units === state.units) tr.className = 'active';
    const cells = r.units
      ? [`${r.units} × ${b.brand}`, `${r.capacityKwh.toFixed(1)} kWh`, fmt.eur(r.billEur), fmt.eur(r.savingEur),
        fmt.eur(r.costEur), paybackText(r.paybackYears), fmt.signedEur(r.lifetimeResultEur!)]
      : ['No battery', '—', fmt.eur(r.billEur), '', '', '', ''];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (i > 0) td.classList.add('num');
      if (i === 6 && r.units) td.classList.add(r.lifetimeResultEur! < 0 ? 'neg' : 'pos');
      tr.appendChild(td);
    });
    return tr;
  }));
}

function renderCharts(rows: CompareRow[]) {
  const b = activeBattery();
  const sims = state.simsById.get(b.id)!;
  const days = dailySavings(sims, state.units, activeTariff());
  const best = days.reduce((a, c) => (c.savingEur > a.savingEur ? c : a));
  const avg = days.reduce((s, d) => s + d.savingEur, 0) / days.length;
  $('daily-note').textContent =
    `With ${configName(b, state.units)}: ${fmt.eurCents(avg)} a day on average, and ${fmt.eurCents(best.savingEur)} on the best day ` +
    `(${fmt.day(best.date)}). On winter days it's often only a few cents. Each bar is one day; the line is the average of the surrounding week.`;
  dailyChart($('daily-chart'), days, css('--data'));
  sizeChart($('size-chart'), rows.filter((r) => r.units > 0), state.lifetimeYears, b.brand, state.units);
  monthlyChart($('monthly-chart'), monthlyBreakdown(sims, state.units), [
    { key: 'exportKwh', name: 'Sent to the grid (no battery)', color: css('--series-grey') },
    { key: 'keptKwh', name: 'Kept by the battery', color: css('--data') },
  ]);
  profileChart($('profile-chart'), state.profile, [
    { key: 'importKwh', name: 'Taken from the grid', color: css('--series-ink') },
    { key: 'exportKwh', name: 'Sent to the grid', color: css('--series-grey') },
  ]);
}

// What the chosen battery needs to read the meter, and whether that's in its price.
function meterText(b: Battery, { short = false } = {}) {
  const usesOwn = state.p1Owned && b.homewizardP1;
  if (short) {
    if (usesOwn) return ' · uses your HomeWizard P1 meter';
    return b.meterEur ? ` · including the ${b.meter} (${fmt.eur(meterPrice(b, opts()))})` : '';
  }
  const price = b.meterEur ? `${b.meter}, ${fmt.eur(b.meterEur)}` : `${b.meter}, included`;
  if (usesOwn) return b.meter === 'HomeWizard P1 meter' ? 'Your HomeWizard P1 meter' : `Your HomeWizard P1 meter, instead of the ${b.meter}`;
  return b.homewizardP1 ? `${price}; a HomeWizard P1 meter also works` : price;
}

function renderSpecs() {
  const b = activeBattery();
  const src = (s: string) => (({ tweakers: ' (measured by Tweakers)', tweakers_home: ' (measured by Tweakers at home, average over all power levels)', review: ' (measured in a review)', manufacturer: ' (manufacturer)', assumed: ' (assumed)' } as Record<string, string>)[s] ?? '');
  const curve = b.rteCurve.map(([kw, r]) => `${pct(r)} at ${fmt.watts(kw)}`).join(' · ');
  const items: [string, string | { href: string; text: string }][] = [
    ['Storage per battery', `${b.unitKwh} kWh, of which ${(b.unitKwh * b.usableShare).toFixed(1)} kWh usable${src(b.capacitySource)}`],
    ['Charge power', fmt.watts(b.chargeKw)],
    ['Discharge power', fmt.watts(b.dischargeKw)],
    ['Extra batteries add power', b.maxUnits === 1 ? 'Not compared' : b.powerScales ? 'Yes' : 'No, only storage'],
    ['Efficiency', `${curve}${src(b.efficiencySource)}${b.lowPowerEstimated ? '; below 800 W estimated from Tweakers\' average' : ''}`],
    ['Standby use', `${b.standbyW} W${src(b.standbySource)}`],
    ['Price of the first battery', fmt.eur(b.firstUnitEur)],
    ['Price of each extra battery', b.maxUnits === 1 ? '—' : fmt.eur(b.extraUnitEur)],
    ['Installation', b.installEur ? fmt.eur(b.installEur) : 'None, plugs into a socket'],
    ['Meter it needs', meterText(b)],
    ['Warranty', `${b.warrantyYears} years`],
    ['Rated charge cycles', b.ratedCycles.toLocaleString('en-US')],
    ['Price checked at', b.priceSource],
    ['Meter price and support', b.meterSource],
    ['Review', b.reviewUrl ? { href: b.reviewUrl, text: new URL(b.reviewUrl).hostname.replace('www.', '') } : 'None found'],
  ];
  $('spec-title').textContent = `Specs used for the ${b.name}`;
  $('assumptions').replaceChildren(...items.map(([k, v]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    if (v && typeof v === 'object') {
      const a = document.createElement('a');
      a.href = v.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = v.text;
      dd.append(a);
    } else dd.textContent = v;
    div.append(dt, dd);
    return div;
  }));
  $('spec-notes').textContent = b.notes;
}

function sliderText(key: WhatIfKey, v: number) {
  const signed = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
  if (key === 'usage' || key === 'solar') return v === 0 ? 'same as last year' : signed;
  if (key === 'price') return v === 0 ? 'stays the same' : `${signed} a year`;
  if (key === 'ageing') return v === 0 ? 'none' : `${v}% a year`;
  return v === 0 ? 'none' : `${v}% less`;
}

function renderWhatIfControls() {
  $('whatif-presets').replaceChildren(...WHAT_IF_PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', String(state.whatIfPreset === p.id));
    b.addEventListener('click', () => {
      state.whatIfPreset = p.id;
      state.whatIf = { ...p.values };
      renderWhatIfControls();
      renderWhatIf();
    });
    return b;
  }));
  for (const key of WHAT_IF_SLIDERS) {
    input(`wi-${key}`).value = String(state.whatIf[key]);
    $(`wi-${key}-out`).textContent = sliderText(key, state.whatIf[key]);
  }
}

function deltaText(el: HTMLElement, diff: number, { unit = 'eur', higherIsBetter = true } = {}) {
  el.className = 'kpi-sub';
  if (Math.abs(diff) < (unit === 'years' ? 0.05 : 0.5)) {
    el.textContent = 'Same as last year';
    return;
  }
  const better = higherIsBetter ? diff > 0 : diff < 0;
  el.classList.add(better ? 'better' : 'worse');
  el.textContent = unit === 'years'
    ? `${Math.abs(diff).toFixed(1)} years ${diff > 0 ? 'later' : 'sooner'} than if nothing changes`
    : `${fmt.eur(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than if nothing changes`;
}

function renderWhatIf() {
  const b = activeBattery();
  const w = state.whatIf;
  const scenario = projectYears(state.hours, b, state.units, activeTariff(), opts(), {
    usage: w.usage / 100, solar: w.solar / 100, priceGrowth: w.price / 100, ageing: w.ageing / 100, shortfall: w.shortfall / 100,
  });
  const same = projectYears(state.hours, b, state.units, activeTariff(), opts());
  const never = `Not within ${state.lifetimeYears} years`;

  $('wi-first').textContent = fmt.eur(scenario.firstYearSavingEur);
  $('wi-total').textContent = fmt.eur(scenario.totalSavingEur);
  $('wi-payback').textContent = scenario.paybackYears === null ? never : `${fmt.years(scenario.paybackYears)} years`;
  $('wi-result').textContent = fmt.signedEur(scenario.resultEur);
  deltaText($('wi-first-delta'), scenario.firstYearSavingEur - same.firstYearSavingEur);
  deltaText($('wi-total-delta'), scenario.totalSavingEur - same.totalSavingEur);
  deltaText($('wi-result-delta'), scenario.resultEur - same.resultEur);
  if (scenario.paybackYears === null || same.paybackYears === null) {
    $('wi-payback-delta').className = 'kpi-sub' + (scenario.paybackYears === null && same.paybackYears !== null ? ' worse' : '');
    $('wi-payback-delta').textContent = scenario.paybackYears === same.paybackYears ? 'Same as last year' : scenario.paybackYears === null ? 'Doesn\'t pay back in time' : 'Pays back, unlike if nothing changes';
  } else {
    deltaText($('wi-payback-delta'), scenario.paybackYears - same.paybackYears!, { unit: 'years', higherIsBetter: false });
  }

  const points = (p: ReturnType<typeof projectYears>) => [{ year: 0, value: -p.costEur }, ...p.years.map((y) => ({ year: y.year, value: y.balanceEur }))];
  balanceChart($('whatif-chart'), [
    { name: 'This scenario', color: css('--data'), points: points(scenario) },
    { name: 'Same as last year', color: css('--muted'), dashed: true, points: points(same) },
  ], scenario.paybackYears);
}

function render() {
  const b = activeBattery();
  const rows = compare(state.simsById.get(b.id)!, activeTariff(), b, opts());
  const ranking = rankBatteries(state.simsById, state.batteries.map(priced), activeTariff(), opts());
  renderScenarioButtons();
  renderRanking(ranking);
  renderRankingToggle(ranking.length);
  renderSummary(rows, ranking);
  renderFlow();
  renderContract(rows);
  renderTable(rows);
  renderCharts(rows);
  renderWhatIf();
  renderSpecs();
}

function bindControls() {
  const onNumber = (id: string, apply: (v: number) => void) => input(id).addEventListener('input', () => {
    const raw = input(id).value;
    const v = Number(raw);
    if (!Number.isFinite(v) || raw === '') return;
    apply(v);
    render();
  });
  onNumber('import-price', (v) => { state.importEurKwh = v; });
  onNumber('feedin-value', (v) => { state.netExportEurKwh = v; });
  onNumber('unit-price', (v) => { state.priceOverrides[state.batteryId] = v; });
  onNumber('lifetime', (v) => { state.lifetimeYears = Math.max(1, v); });
  onNumber('instalment', (v) => { state.monthlyInstalmentEur = v; });
  onNumber('discount', (v) => { state.yearlyDiscountEur = v; });
  $('ranking-toggle').addEventListener('click', () => { state.rankingExpanded = !state.rankingExpanded; render(); });
  input('p1-owned').addEventListener('change', () => { state.p1Owned = input('p1-owned').checked; render(); });
  input('battery-select').addEventListener('change', () => { selectBattery(input('battery-select').value); render(); });
  input('units-select').addEventListener('change', () => { state.units = Number(input('units-select').value); render(); });
  for (const key of WHAT_IF_SLIDERS) {
    input(`wi-${key}`).addEventListener('input', () => {
      state.whatIf[key] = Number(input(`wi-${key}`).value);
      const match = WHAT_IF_PRESETS.find((p) => WHAT_IF_SLIDERS.every((k) => p.values[k] === state.whatIf[k]));
      state.whatIfPreset = match ? match.id : null;
      renderWhatIfControls();
      renderWhatIf();
    });
  }

  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!state.simsById.size) return;
      const b = activeBattery();
      renderCharts(compare(state.simsById.get(b.id)!, activeTariff(), b, opts()));
      renderWhatIf();
    });
  }).observe($('app'));
}

// Opens on the best buy for this data, so the figures below answer the line under the title.
function selectBestBuy() {
  const [best] = rankBatteries(state.simsById, state.batteries.map(priced), activeTariff(), opts());
  selectBattery(best.battery.id, best.units);
}

function useData(data: LoadedData) {
  state.hours = data.hours;
  runSimulation();
  selectBestBuy();
  renderDataStatus(data);
  render();
}

async function init() {
  try {
    const [data, batteries, tariffs] = await Promise.all([
      initialData(),
      fetchCsv('data/batteries.csv'),
      fetchCsv('data/eneco-2027-tariffs.csv'),
    ]);
    state.hours = data.hours;
    state.batteries = toBatteries(batteries);
    state.tariffs = toTariffs(tariffs);
    $('p1-brands').textContent = [...new Set(state.batteries.filter((b) => b.homewizardP1).map((b) => b.brand))].join(', ');
    renderBatteryOptions();
    selectBattery(state.batteries.some((b) => b.id === DEFAULT_BATTERY) ? DEFAULT_BATTERY : state.batteries[0].id, 1);
    applyScenario(DEFAULT_SCENARIO);
    runSimulation();
    selectBestBuy();
    bindControls();
    bindSourceTips();
    bindImport(useData);
    renderWhatIfControls();
    renderDataStatus(data);
    render();
    document.body.classList.remove('loading');
  } catch (err) {
    $('takeaway').textContent = err instanceof Error ? err.message : String(err);
  }
}

init();
