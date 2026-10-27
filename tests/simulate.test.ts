import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import {
  parseCsv, toHours, toBatteries, toTariffs, simulate, simulateAllSizes, purchasePrice, compare,
  rankBatteries, dailyProfile, dailySavings, contractView, rteAt, projectYears, scaleHours,
  type Battery, type CurvePoint, type Hour,
} from '../src/simulate.ts';

const flat = (rte: number): CurvePoint[] => [[0.2, rte], [0.5, rte], [0.8, rte]];

const battery: Battery = {
  id: 'test', brand: 'Test', model: 'Battery', name: 'Test Battery', unitKwh: 2.688, usableShare: 0.9,
  capacitySource: 'assumed', chargeKw: 0.8, dischargeKw: 0.8, maxPowerKw: 0.8, powerScales: true,
  maxUnits: 2, rteCurve: flat(0.85), lowPowerEstimated: false, efficiencySource: 'assumed', efficiencyBy: '',
  standbyW: 5, standbySource: 'assumed', standbyBy: '', firstUnitEur: 1195, extraUnitEur: 1000,
  installEur: 0, meter: 'HomeWizard P1 meter', meterEur: 30, homewizardP1: true, meterSource: '', warrantyYears: 10, ratedCycles: 6000, priceSource: '', priceChecked: '', reviewUrl: '', notes: '',
  sizeCm: '', weightKg: 0, sizeSource: '',
};
const day: Hour[] = [
  { timestamp: '2026-06-01T12:00:00+02:00', importKwh: 0, exportKwh: 2 },
  { timestamp: '2026-06-01T20:00:00+02:00', importKwh: 1.5, exportKwh: 0 },
];

test('parseCsv handles quoted cells', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [{ a: 'x, y', b: '2' }]);
});

test('no battery leaves import and export unchanged', () => {
  const s = simulate(day, battery, 0);
  assert.equal(s.importKwh, 1.5);
  assert.equal(s.exportKwh, 2);
  assert.equal(s.fromBatteryKwh, 0);
});

test('battery is limited by its power and loses energy on the round trip', () => {
  const lossless = { ...battery, rteCurve: flat(1), standbyW: 0 };
  const s = simulate(day, lossless, 1);
  assert.ok(Math.abs(s.exportKwh - 1.2) < 1e-9, 'charges at most 0.8 kWh in one hour');
  assert.ok(Math.abs(s.fromBatteryKwh - 0.8) < 1e-9);
  assert.ok(Math.abs(s.importKwh - 0.7) < 1e-9);

  const lossy = simulate(day, { ...battery, standbyW: 0 }, 1);
  assert.ok(Math.abs(lossy.fromBatteryKwh - 0.8 * 0.85) < 1e-9, 'delivers 85% of what it stored');
});

test('charge and discharge power are separate, and only some batteries add power per unit', () => {
  const asym = { ...battery, rteCurve: flat(1), standbyW: 0, chargeKw: 2, dischargeKw: 0.5 };
  const s = simulate(day, asym, 1);
  assert.ok(Math.abs(s.fromBatteryKwh - 0.5) < 1e-9, 'discharge capped at 0.5 kWh per hour');

  const fixedPower = { ...battery, rteCurve: flat(1), standbyW: 0, powerScales: false };
  const two = simulate(day, fixedPower, 2);
  assert.ok(Math.abs(two.fromBatteryKwh - 0.8) < 1e-9, 'a second unit adds storage, not power');
});

test('efficiency follows the measured curve and is lower at low power', () => {
  const [b] = toBatteries(parseCsv(
    'id,brand,model,unit_kwh,usable_share,charge_kw,discharge_kw,max_power_kw,power_scales,max_units,rte_200,rte_500,rte_800,rte_max\n' +
    'x,X,Y,5,0.9,0.8,0.8,2.5,1,1,0.5,0.7,0.8,0.78\n',
  ));
  assert.equal(rteAt(b, 0.1), 0.5);
  assert.ok(Math.abs(rteAt(b, 0.35) - 0.6) < 1e-9);
  assert.equal(rteAt(b, 0.8), 0.8);
  assert.equal(rteAt(b, 3), 0.78);

  const [est] = toBatteries(parseCsv(
    'id,brand,model,unit_kwh,usable_share,charge_kw,discharge_kw,max_power_kw,power_scales,max_units,rte_200,rte_500,rte_800,rte_max\n' +
    'y,X,Y,5,0.9,0.8,0.8,0.8,1,1,,,0.8,\n',
  ));
  assert.ok(est.lowPowerEstimated);
  assert.ok(rteAt(est, 0.2) < rteAt(est, 0.8), 'estimated curve drops at low power');

  const night: Hour[] = [{ timestamp: '2026-06-01T12:00:00+02:00', importKwh: 0, exportKwh: 1 },
    ...Array.from({ length: 4 }, (_, i) => ({ timestamp: `2026-06-01T2${i}:00:00+02:00`, importKwh: 0.2, exportKwh: 0 }))];
  const lowPower = simulate(night, { ...b, standbyW: 0, maxUnits: 1 }, 1);
  const allAt800 = simulate(night, { ...b, standbyW: 0, rteCurve: flat(0.8) }, 1);
  assert.ok(lowPower.fromBatteryKwh < allAt800.fromBatteryKwh, 'a 200 W night load gets less out of the battery');
});

test('purchasePrice adds extra units, installation and the meter, unless a HomeWizard P1 meter can stand in', () => {
  assert.equal(purchasePrice(battery, 0), 0);
  assert.equal(purchasePrice(battery, 1), 1225);
  assert.equal(purchasePrice(battery, 1, { p1Owned: true }), 1195);
  assert.equal(purchasePrice(battery, 2, { p1Owned: true }), 2195);
  assert.equal(purchasePrice(battery, 2), 2225, 'one meter, however many units');
  const ownMeter = { ...battery, homewizardP1: false };
  assert.equal(purchasePrice(ownMeter, 1, { p1Owned: true }), 1225, 'a HomeWizard P1 meter only helps where it works');
});

test('compare prices savings, payback and lifetime result', () => {
  const b = { ...battery, rteCurve: flat(1), standbyW: 0, chargeKw: 5, dischargeKw: 5 };
  const hours = [
    { timestamp: '2026-06-01T12:00:00+02:00', importKwh: 0, exportKwh: 1 },
    { timestamp: '2026-06-01T20:00:00+02:00', importKwh: 1, exportKwh: 0 },
  ];
  const sims = [0, 1].map((n) => simulate(hours, b, n));
  const [none, one] = compare(sims, { importEurKwh: 0.3, netExportEurKwh: 0.05 }, b, { p1Owned: true, lifetimeYears: 10 });
  assert.ok(Math.abs(none.billEur - 0.25) < 1e-9);
  assert.ok(Math.abs(one.savingEur - 0.25) < 1e-9);
  assert.equal(one.costEur, 1195);
  assert.ok(Math.abs(one.paybackYears! - 4780) < 1e-6);
  assert.ok(Math.abs(one.lifetimeResultEur! - (2.5 - 1195)) < 1e-9);
});

test('contractView spreads the saving over the monthly instalment', () => {
  const v = contractView({ monthlyInstalmentEur: 65, yearlyDiscountEur: 150 }, 180);
  assert.equal(v.yearlyEur, 630);
  assert.equal(v.withBatteryEur, 450);
  assert.equal(v.withBatteryPerMonthEur, 37.5);
  assert.equal(v.savingPerMonthEur, 15);
});

test('sample data loads, ranks every battery and adds up per day', () => {
  const read = (f: string) => parseCsv(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
  const hours = toHours(read('sample-hourly.csv'));
  const batteries = toBatteries(read('batteries.csv'));
  const tariff = toTariffs(read('tariffs-2027.csv')).find((t) => t.scenario === 'eneco_1y')!;
  assert.equal(hours.length, 8760);
  assert.ok(batteries.length >= 5);
  assert.ok(batteries.every((b) => b.weightKg > 0 && b.sizeCm), 'every battery has a size and weight');
  assert.ok(batteries.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.priceChecked)), 'every battery has a price_checked date');

  const simsById = new Map(batteries.map((b) => [b.id, simulateAllSizes(hours, b)]));
  const base = simsById.get('homewizard')![0];
  assert.ok(base.importKwh > 1500 && base.importKwh < 5000, 'a plausible yearly grid use');
  assert.ok(base.exportKwh > 1000 && base.exportKwh < 5000, 'a plausible yearly solar surplus');

  const ranking = rankBatteries(simsById, batteries, tariff, { p1Owned: true, lifetimeYears: 15 });
  assert.equal(ranking.length, batteries.length);
  for (let i = 1; i < ranking.length; i++) assert.ok(ranking[i - 1].lifetimeResultEur >= ranking[i].lifetimeResultEur);

  const hw = compare(simsById.get('homewizard')!, tariff, batteries.find((b) => b.id === 'homewizard')!)[1];
  const days = dailySavings(simsById.get('homewizard')!, 1, tariff);
  assert.equal(days.length, 365);
  const total = days.reduce((sum, d) => sum + d.savingEur, 0);
  assert.ok(Math.abs(total - hw.savingEur) < 1e-6, 'daily savings add up to the yearly saving');
  assert.equal(dailyProfile(hours).length, 24);
});

test('projectYears with no changes repeats the same saving every year', () => {
  const b = { ...battery, rteCurve: flat(1), standbyW: 0 };
  const tariff = { importEurKwh: 0.3, netExportEurKwh: 0.05 };
  const p = projectYears(day, b, 1, tariff, { p1Owned: true, lifetimeYears: 10 });
  const yearly = compare([0, 1].map((n) => simulate(day, b, n)), tariff, b)[1].savingEur;
  assert.equal(p.years.length, 10);
  for (const y of p.years) assert.ok(Math.abs(y.savingEur - yearly) < 1e-9);
  assert.ok(Math.abs(p.resultEur - (yearly * 10 - 1195)) < 1e-9);
});

test('projectYears applies price growth, ageing and shortfall', () => {
  const b = { ...battery, rteCurve: flat(1), standbyW: 0, unitKwh: 1, usableShare: 1 };
  const tariff = { importEurKwh: 0.3, netExportEurKwh: 0 };
  const flatYear = projectYears(day, b, 1, tariff, { lifetimeYears: 3 });
  const growth = projectYears(day, b, 1, tariff, { lifetimeYears: 3 }, { priceGrowth: 0.1 });
  assert.ok(Math.abs(growth.years[2].savingEur - flatYear.years[2].savingEur * 1.21) < 1e-9);

  const aged = projectYears(day, b, 1, tariff, { lifetimeYears: 3 }, { ageing: 0.5 });
  assert.ok(aged.years[1].savingEur < aged.years[0].savingEur, 'an aged battery stores less');

  const short = projectYears(day, b, 1, tariff, { lifetimeYears: 1 }, { shortfall: 0.1 });
  assert.ok(Math.abs(short.firstYearSavingEur - flatYear.firstYearSavingEur * 0.9) < 1e-9);
});

test('payback is found inside the year the balance turns positive', () => {
  const b = { ...battery, rteCurve: flat(1), standbyW: 0, firstUnitEur: 0.5, meterEur: 0 };
  const p = projectYears(day, b, 1, { importEurKwh: 0.3, netExportEurKwh: 0 }, { lifetimeYears: 5 });
  assert.ok(p.paybackYears! > 0 && p.paybackYears! < 5);
  assert.ok(Math.abs(p.paybackYears! - 0.5 / p.firstYearSavingEur) < 1e-9);
});

test('scaleHours scales grid use and solar surplus separately', () => {
  const [a, b] = scaleHours(day, { usageFactor: 2, solarFactor: 0.5 });
  assert.equal(a.exportKwh, 1);
  assert.equal(b.importKwh, 3);
});
