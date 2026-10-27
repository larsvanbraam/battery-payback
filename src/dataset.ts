// A visitor's own meter data, kept in their browser so the page can rerun without fetching again.
import { isHourRow, type HourRow } from './bookmarklet/protocol.ts';
import type { Hour } from './simulate.ts';

export interface Dataset {
  version: 1;
  /** A provider id, or "file" for an uploaded CSV. */
  source: string;
  /** Shown to the visitor, for example "Greenchoice" or the uploaded file's name. */
  label: string;
  updatedAt: string;
  rows: HourRow[];
}

const KEY = 'home-battery-payback:dataset';
const KEEP_DAYS = 365;

export const toHourObjects = (rows: HourRow[]): Hour[] =>
  rows.map(([timestamp, importKwh, exportKwh]) => ({ timestamp, importKwh, exportKwh }));

export const toRows = (hours: Hour[]): HourRow[] => hours.map((h) => [h.timestamp, h.importKwh, h.exportKwh]);

const day = (row: HourRow) => row[0].slice(0, 10);

// A day without a single kWh in or out means the provider had no data yet, not an empty house.
export function dropEmptyDays(rows: HourRow[]): HourRow[] {
  const used = new Set(rows.filter((r) => r[1] > 0 || r[2] > 0).map(day));
  return rows.filter((r) => used.has(day(r)));
}

// New rows win over stored ones for the same hour; only the most recent year is kept.
export function mergeRows(existing: HourRow[], incoming: HourRow[]): HourRow[] {
  const byTime = new Map(existing.map((r) => [r[0], r]));
  for (const r of dropEmptyDays(incoming)) byTime.set(r[0], r);
  const rows = [...byTime.values()].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  if (!rows.length) return rows;
  const last = new Date(`${day(rows[rows.length - 1])}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - KEEP_DAYS + 1);
  const first = last.toISOString().slice(0, 10);
  return rows.filter((r) => day(r) >= first);
}

/** The day before the last one stored: the last day can be incomplete, so it's fetched again. */
export function haveUntil(dataset: Dataset | null, source: string): string | null {
  if (!dataset || dataset.source !== source || !dataset.rows.length) return null;
  const d = new Date(`${day(dataset.rows[dataset.rows.length - 1])}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function toCsv(rows: HourRow[]): string {
  return ['timestamp,import_kwh,export_kwh', ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

// Storage can be full, blocked or missing (private windows); the page then works without remembering.
export function loadDataset(): Dataset | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Dataset | null;
    if (d?.version !== 1 || !Array.isArray(d.rows) || !d.rows.length || !d.rows.every(isHourRow)) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDataset(dataset: Dataset): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(dataset));
    return true;
  } catch {
    return false;
  }
}

export function clearDataset() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing stored */ }
}
