// Writes public/data/sample-hourly.csv: a made-up Dutch household with solar panels, so the page has
// something to show before visitors load their own data. Deterministic, so reruns give the same file.
//   node scripts/generate-sample.ts
import { writeFileSync } from 'node:fs';

const START = Date.UTC(2025, 9, 26, 23); // 27 Oct 2025, 00:00 in Amsterdam
const HOURS = 365 * 24;
const PANELS_KWP = 4.2;
const LATITUDE = 52.1;

// Small seeded random generator (mulberry32).
let seed = 20261027;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const local = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
});

function localParts(ms: number) {
  const p = Object.fromEntries(local.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.slice(3);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), offset };
}

const dayOfYear = (ms: number) => Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / 86_400_000) + 1;

// Clear-sky output per kWp at a given UTC time, from the sun's height (good enough for a demo).
function clearSky(ms: number) {
  const doy = dayOfYear(ms);
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const solarHour = new Date(ms).getUTCHours() + 0.5 + 5.1 / 15; // 5.1° east of Greenwich
  const hourAngle = 15 * (solarHour - 12);
  const rad = Math.PI / 180;
  const sinElev = Math.sin(LATITUDE * rad) * Math.sin(decl * rad)
    + Math.cos(LATITUDE * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad);
  return sinElev > 0 ? 0.82 * sinElev ** 1.15 : 0;
}

// Cloudiness per day, with some memory so sunny and grey spells last a few days.
let weather = 0.6;
const dayWeather = new Map<string, number>();
function weatherFor(date: string, month: number) {
  if (!dayWeather.has(date)) {
    const summer = [0.45, 0.5, 0.55, 0.65, 0.7, 0.7, 0.68, 0.66, 0.6, 0.5, 0.42, 0.4][month - 1];
    weather = Math.min(1, Math.max(0.08, 0.55 * weather + 0.45 * (summer + (random() - 0.5) * 0.9)));
    dayWeather.set(date, weather);
  }
  return dayWeather.get(date)!;
}

// What the house uses in kWh during one local hour.
const dayPlan = new Map<string, { laundry: number; dishwasher: number; away: boolean }>();
function usage(date: string, hour: number, weekday: number, doy: number) {
  if (!dayPlan.has(date)) {
    dayPlan.set(date, {
      laundry: random() < 0.35 ? 9 + Math.floor(random() * 10) : -1,
      dishwasher: random() < 0.7 ? (random() < 0.5 ? 13 : 20) : -1,
      away: random() < 0.04,
    });
  }
  const plan = dayPlan.get(date)!;
  const weekend = weekday === 0 || weekday === 6;
  const winter = 1 + 0.3 * Math.cos(((2 * Math.PI) / 365) * (doy - 15));
  let kwh = 0.16;
  if (hour >= 7 && hour < 9 && !weekend) kwh += 0.35;
  if (hour >= 9 && hour < 17) kwh += weekend ? 0.25 : 0.08;
  if (hour >= 17 && hour < 20) kwh += 0.55;
  if (hour >= 20 && hour < 23) kwh += 0.38;
  if (hour === plan.laundry) kwh += 0.9;
  if (hour === plan.dishwasher) kwh += 1.0;
  if (plan.away) kwh = 0.17;
  return 1.3 * kwh * winter * (0.75 + random() * 0.5);
}

const lines = ['timestamp,import_kwh,export_kwh'];
let totalImport = 0, totalExport = 0;
for (let i = 0; i < HOURS; i++) {
  const ms = START + i * 3_600_000;
  const { date, hour, offset } = localParts(ms);
  const month = Number(date.slice(5, 7));
  const sun = clearSky(ms) * PANELS_KWP * weatherFor(date, month) * (0.85 + random() * 0.3);
  const use = usage(date, hour, new Date(`${date}T12:00:00Z`).getUTCDay(), dayOfYear(ms));
  // Within an hour use and solar don't line up perfectly, so some power flows both ways.
  const overlap = Math.min(use, sun) * 0.08;
  const imp = Math.max(0, use - sun) + overlap;
  const exp = Math.max(0, sun - use) + overlap;
  totalImport += imp;
  totalExport += exp;
  lines.push(`${date}T${String(hour).padStart(2, '0')}:00:00${offset},${imp.toFixed(3)},${exp.toFixed(3)}`);
}

writeFileSync(new URL('../public/data/sample-hourly.csv', import.meta.url), lines.join('\n') + '\n');
console.log(`Wrote ${HOURS} hours: ${Math.round(totalImport)} kWh from the grid, ${Math.round(totalExport)} kWh sent back.`);
