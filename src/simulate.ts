// Pure data and battery-simulation code. No DOM access, so it runs in the browser and in Node tests.

export type CsvRow = Record<string, string>;

export interface Hour {
  timestamp: string;
  importKwh: number;
  exportKwh: number;
}

/** [power per unit in kW, round-trip efficiency] */
export type CurvePoint = [number, number];

export interface Battery {
  id: string;
  brand: string;
  model: string;
  name: string;
  unitKwh: number;
  usableShare: number;
  capacitySource: string;
  chargeKw: number;
  dischargeKw: number;
  maxPowerKw: number;
  powerScales: boolean;
  maxUnits: number;
  rteCurve: CurvePoint[];
  lowPowerEstimated: boolean;
  efficiencySource: string;
  efficiencyBy: string;
  standbyW: number;
  standbySource: string;
  standbyBy: string;
  firstUnitEur: number;
  extraUnitEur: number;
  installEur: number;
  /** The meter reader the battery needs to follow the house's use, and its price (0 when included). */
  meter: string;
  meterEur: number;
  /** Whether it can use a HomeWizard P1 meter instead, so owning one saves buying its own. */
  homewizardP1: boolean;
  meterSource: string;
  warrantyYears: number;
  ratedCycles: number;
  priceSource: string;
  reviewUrl: string;
  notes: string;
}

export interface Prices {
  importEurKwh: number;
  netExportEurKwh: number;
}

export interface Tariff extends Prices {
  scenario: string;
  label: string;
  note: string;
}

export interface Bucket {
  importKwh: number;
  exportKwh: number;
  fromBatteryKwh: number;
}

export interface Sim {
  units: number;
  capacityKwh: number;
  importKwh: number;
  exportKwh: number;
  fromBatteryKwh: number;
  cycles: number;
  months: Map<string, Bucket>;
  days: Map<string, Bucket>;
}

export interface Options {
  /** The visitor already has a HomeWizard P1 meter. */
  p1Owned?: boolean;
  lifetimeYears?: number;
}

export interface CompareRow {
  units: number;
  capacityKwh: number;
  fromBatteryKwh: number;
  cycles: number;
  billEur: number;
  savingEur: number;
  costEur: number;
  paybackYears: number | null;
  lifetimeResultEur: number | null;
}

export interface RankedBattery extends CompareRow {
  battery: Battery;
  lifetimeResultEur: number;
}

export interface WhatIf {
  usage?: number;
  solar?: number;
  priceGrowth?: number;
  ageing?: number;
  shortfall?: number;
}

export interface YearProjection {
  year: number;
  capacityShare: number;
  gridPriceEurKwh: number;
  savingEur: number;
  balanceEur: number;
}

export interface Projection {
  costEur: number;
  years: YearProjection[];
  paybackYears: number | null;
  firstYearSavingEur: number;
  totalSavingEur: number;
  resultEur: number;
}

export interface Contract {
  monthlyInstalmentEur: number;
  yearlyDiscountEur: number;
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export function toHours(rows: CsvRow[]): Hour[] {
  if (!rows.length || !('timestamp' in rows[0]) || !('import_kwh' in rows[0]) || !('export_kwh' in rows[0])) {
    throw new Error('The CSV needs the columns timestamp, import_kwh and export_kwh.');
  }
  return rows.map((r, i) => {
    const importKwh = Number(r.import_kwh), exportKwh = Number(r.export_kwh);
    if (!Number.isFinite(importKwh) || !Number.isFinite(exportKwh)) {
      throw new Error(`Row ${i + 2} has a value that isn't a number.`);
    }
    return { timestamp: r.timestamp, importKwh, exportKwh };
  });
}

// How much efficiency drops at low power compared with 800 W: the average of the three batteries
// Tweakers measured in October 2026. Used for batteries without a low-power measurement of their own.
export const TYPICAL_LOW_POWER = { at200: 0.755, at500: 0.943 };

function efficiencyCurve(r: CsvRow): CurvePoint[] {
  const at800 = Number(r.rte_800);
  const num = (v: string | undefined, fallback: number) => (v === '' || v == null ? fallback : Number(v));
  const maxKw = Number(r.max_power_kw);
  const points: CurvePoint[] = [
    [0.2, num(r.rte_200, at800 * TYPICAL_LOW_POWER.at200)],
    [0.5, num(r.rte_500, at800 * TYPICAL_LOW_POWER.at500)],
    [0.8, at800],
  ];
  if (maxKw > 0.8) points.push([maxKw, num(r.rte_max, at800)]);
  return points;
}

// Round-trip efficiency at a given power per battery unit, read off the measured curve.
export function rteAt(battery: Pick<Battery, 'rteCurve'>, kw: number): number {
  const pts = battery.rteCurve;
  if (kw <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (kw <= x1) return y0 + ((kw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}

export function toBatteries(rows: CsvRow[]): Battery[] {
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    model: r.model,
    name: `${r.brand} ${r.model}`,
    unitKwh: Number(r.unit_kwh),
    usableShare: Number(r.usable_share),
    capacitySource: r.capacity_source,
    chargeKw: Number(r.charge_kw),
    dischargeKw: Number(r.discharge_kw),
    maxPowerKw: Number(r.max_power_kw),
    powerScales: r.power_scales === '1',
    maxUnits: Number(r.max_units),
    rteCurve: efficiencyCurve(r),
    lowPowerEstimated: r.rte_200 === '',
    efficiencySource: r.efficiency_source,
    efficiencyBy: r.efficiency_by,
    standbyW: Number(r.standby_w),
    standbySource: r.standby_source,
    standbyBy: r.standby_by,
    firstUnitEur: Number(r.first_unit_eur),
    extraUnitEur: Number(r.extra_unit_eur),
    installEur: Number(r.install_eur),
    meter: r.meter,
    meterEur: Number(r.meter_eur),
    homewizardP1: r.homewizard_p1 === '1',
    meterSource: r.meter_source,
    warrantyYears: Number(r.warranty_years),
    ratedCycles: Number(r.rated_cycles),
    priceSource: r.price_source,
    reviewUrl: r.review_url,
    notes: r.notes,
  }));
}

export function toTariffs(rows: CsvRow[]): Tariff[] {
  return rows.map((r) => ({
    scenario: r.scenario,
    label: r.label,
    importEurKwh: Number(r.import_eur_kwh),
    netExportEurKwh: Number(r.net_export_eur_kwh),
    note: r.note,
  }));
}

// Replays every hour: solar surplus charges the battery (limited by charge power and free capacity),
// then the battery covers grid use (limited by discharge power) until it is empty. Losses are split
// evenly over charging and discharging, at the efficiency that matches that hour's power: a battery
// trickling 200 W into the house at night loses more than one running at 800 W.
// units = 0 is the situation without a battery. capacityShare < 1 models an aged battery.
export function simulate(hours: Hour[], battery: Battery, units: number, { capacityShare = 1 } = {}): Sim {
  const cap = units * battery.unitKwh * battery.usableShare * capacityShare;
  const powerUnits = battery.powerScales ? units : Math.min(units, 1);
  const chargeKw = powerUnits * battery.chargeKw;
  const dischargeKw = powerUnits * battery.dischargeKw;
  const standby = (units * battery.standbyW) / 1000;
  const months = new Map<string, Bucket>();
  const days = new Map<string, Bucket>();
  let soc = 0, importKwh = 0, exportKwh = 0, fromBatteryKwh = 0;

  for (const h of hours) {
    let surplus = h.exportKwh;
    let need = h.importKwh + standby;
    const etaIn = Math.sqrt(rteAt(battery, Math.min(surplus, chargeKw) / (powerUnits || 1)));
    const charge = Math.min(surplus, chargeKw, (cap - soc) / etaIn);
    soc += charge * etaIn;
    surplus -= charge;
    const etaOut = Math.sqrt(rteAt(battery, Math.min(need, dischargeKw) / (powerUnits || 1)));
    const out = Math.min(need, dischargeKw, soc * etaOut);
    soc -= out / etaOut;
    need -= out;

    importKwh += need;
    exportKwh += surplus;
    fromBatteryKwh += out;

    for (const [map, key] of [[months, h.timestamp.slice(0, 7)], [days, h.timestamp.slice(0, 10)]] as const) {
      let bucket = map.get(key);
      if (!bucket) map.set(key, (bucket = { importKwh: 0, exportKwh: 0, fromBatteryKwh: 0 }));
      bucket.importKwh += need;
      bucket.exportKwh += surplus;
      bucket.fromBatteryKwh += out;
    }
  }

  return {
    units,
    capacityKwh: units * battery.unitKwh,
    importKwh,
    exportKwh,
    fromBatteryKwh,
    cycles: cap ? fromBatteryKwh / cap : 0,
    months,
    days,
  };
}

export function simulateAllSizes(hours: Hour[], battery: Battery): Sim[] {
  return Array.from({ length: battery.maxUnits + 1 }, (_, n) => simulate(hours, battery, n));
}

// One meter per home, however many units. A HomeWizard P1 meter the visitor owns replaces it where it works.
export function meterPrice(battery: Battery, { p1Owned = false }: Options = {}): number {
  return p1Owned && battery.homewizardP1 ? 0 : battery.meterEur;
}

export function purchasePrice(battery: Battery, units: number, { p1Owned = false }: Options = {}): number {
  if (!units) return 0;
  return battery.firstUnitEur + (units - 1) * battery.extraUnitEur + battery.installEur + meterPrice(battery, { p1Owned });
}

// Prices each simulated size with one tariff and compares it with having no battery.
export function compare(sims: Sim[], tariff: Prices, battery: Battery, { p1Owned = false, lifetimeYears = 15 }: Options = {}): CompareRow[] {
  const base = sims.find((s) => s.units === 0)!;
  const bill = (s: Sim) => s.importKwh * tariff.importEurKwh - s.exportKwh * tariff.netExportEurKwh;
  return sims.map((s) => {
    const costEur = purchasePrice(battery, s.units, { p1Owned });
    const savingEur = bill(base) - bill(s);
    const paybackYears = s.units && savingEur > 0 ? costEur / savingEur : null;
    return {
      units: s.units,
      capacityKwh: s.capacityKwh,
      fromBatteryKwh: s.fromBatteryKwh,
      cycles: s.cycles,
      billEur: bill(s),
      savingEur,
      costEur,
      paybackYears,
      lifetimeResultEur: s.units ? savingEur * lifetimeYears - costEur : null,
    };
  });
}

// One row per battery at the size that earns the most over the lifetime.
export function rankBatteries(simsById: Map<string, Sim[]>, batteries: Battery[], tariff: Prices, opts?: Options): RankedBattery[] {
  return batteries
    .map((battery) => {
      const rows = compare(simsById.get(battery.id)!, tariff, battery, opts).filter((r) => r.units > 0);
      const best = rows.reduce((a, b) => (b.lifetimeResultEur! > a.lifetimeResultEur! ? b : a));
      return { battery, ...best, lifetimeResultEur: best.lifetimeResultEur! };
    })
    .sort((a, b) => b.lifetimeResultEur - a.lifetimeResultEur);
}

// Scales last year's hours to try a different future: more or less grid use, more or less solar surplus.
export function scaleHours(hours: Hour[], { usageFactor = 1, solarFactor = 1 } = {}): Hour[] {
  if (usageFactor === 1 && solarFactor === 1) return hours;
  return hours.map((h) => ({ ...h, importKwh: h.importKwh * usageFactor, exportKwh: h.exportKwh * solarFactor }));
}

// Plays out the battery's lifetime year by year under a what-if scenario (all changes as fractions):
//   usage / solar: change in grid use and solar surplus compared with last year
//   priceGrowth: yearly change of the grid price
//   ageing: share of storage lost each year
//   shortfall: share of the calculated saving lost to real-world effects hourly data can't show
// Returns the saving per year, the running balance (starting at minus the price) and when it turns positive.
export function projectYears(
  hours: Hour[], battery: Battery, units: number, tariff: Prices,
  { p1Owned = false, lifetimeYears = 15 }: Options = {}, whatIf: WhatIf = {},
): Projection {
  const { usage = 0, solar = 0, priceGrowth = 0, ageing = 0, shortfall = 0 } = whatIf;
  const scaled = scaleHours(hours, { usageFactor: 1 + usage, solarFactor: 1 + solar });
  const base = simulate(scaled, battery, 0);
  const cache = new Map<string, Sim>();
  const costEur = purchasePrice(battery, units, { p1Owned });
  const years: YearProjection[] = [];
  let balance = -costEur;
  let paybackYears: number | null = null;

  for (let year = 1; year <= lifetimeYears; year++) {
    const capacityShare = (1 - ageing) ** (year - 1);
    const key = capacityShare.toFixed(3);
    if (!cache.has(key)) cache.set(key, simulate(scaled, battery, units, { capacityShare }));
    const sim = cache.get(key)!;
    const gridPriceEurKwh = tariff.importEurKwh * (1 + priceGrowth) ** (year - 1);
    const savingEur = ((base.importKwh - sim.importKwh) * gridPriceEurKwh
      - (base.exportKwh - sim.exportKwh) * tariff.netExportEurKwh) * (1 - shortfall);
    const before = balance;
    balance += savingEur;
    if (paybackYears === null && balance >= 0 && savingEur > 0) paybackYears = year - 1 + -before / savingEur;
    years.push({ year, capacityShare, gridPriceEurKwh, savingEur, balanceEur: balance });
  }

  return {
    costEur,
    years,
    paybackYears,
    firstYearSavingEur: years[0]?.savingEur ?? 0,
    totalSavingEur: years.reduce((sum, y) => sum + y.savingEur, 0),
    resultEur: balance,
  };
}

export function monthlyBreakdown(sims: Sim[], units: number) {
  const base = sims.find((s) => s.units === 0)!;
  const sim = sims.find((s) => s.units === units)!;
  return [...base.months.keys()].map((m) => ({
    month: m,
    exportKwh: base.months.get(m)!.exportKwh,
    keptKwh: sim.months.get(m)!.fromBatteryKwh,
  }));
}

// What one battery size saves on each day of the data, compared with no battery.
export function dailySavings(sims: Sim[], units: number, tariff: Prices) {
  const base = sims.find((s) => s.units === 0)!;
  const sim = sims.find((s) => s.units === units)!;
  const bill = (d: Bucket) => d.importKwh * tariff.importEurKwh - d.exportKwh * tariff.netExportEurKwh;
  return [...base.days.keys()].map((date) => {
    const withBattery = sim.days.get(date)!;
    return {
      date,
      savingEur: bill(base.days.get(date)!) - bill(withBattery),
      fromBatteryKwh: withBattery.fromBatteryKwh,
    };
  });
}

// Spreads a yearly saving over the supplier's monthly instalment. The welcome discount is paid
// with or without a battery, so it lowers the yearly cost but not the battery's payback.
export function contractView(contract: Contract, yearlySavingEur: number) {
  const yearlyEur = contract.monthlyInstalmentEur * 12 - contract.yearlyDiscountEur;
  const withBatteryEur = yearlyEur - yearlySavingEur;
  return {
    yearlyEur,
    perMonthEur: yearlyEur / 12,
    withBatteryEur,
    withBatteryPerMonthEur: withBatteryEur / 12,
    savingPerMonthEur: yearlySavingEur / 12,
    savingPerDayEur: yearlySavingEur / 365,
  };
}

export function dailyProfile(hours: Hour[]) {
  const days = new Set(hours.map((h) => h.timestamp.slice(0, 10))).size || 1;
  const acc = Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 0, exportKwh: 0 }));
  for (const h of hours) {
    const slot = acc[Number(h.timestamp.slice(11, 13))];
    slot.importKwh += h.importKwh;
    slot.exportKwh += h.exportKwh;
  }
  return acc.map((a) => ({ hour: a.hour, importKwh: a.importKwh / days, exportKwh: a.exportKwh / days }));
}
