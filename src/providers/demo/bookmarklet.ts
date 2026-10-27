import { runBookmarklet, type DateRange } from '../../bookmarklet/runtime.ts';
import type { HourRow } from '../../bookmarklet/protocol.ts';
import { parseCsv, toHours } from '../../simulate.ts';
import { demo } from './info.ts';

// Replays the sample household as if it were last year, a few days per "request".
async function fetchHours(range: DateRange, onProgress: (done: number, total: number) => void): Promise<HourRow[]> {
  const res = await fetch('/data/sample-hourly.csv');
  const hours = toHours(parseCsv(await res.text()));
  const shiftDays = Math.round((Date.parse(range.end) - Date.parse(hours[hours.length - 1].timestamp.slice(0, 10))) / 86_400_000) - 1;
  const shifted = hours.map((h): HourRow => {
    const d = new Date(`${h.timestamp.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + shiftDays);
    return [d.toISOString().slice(0, 10) + h.timestamp.slice(10), h.importKwh, h.exportKwh];
  });
  const rows = shifted.filter((r) => r[0].slice(0, 10) >= range.start && r[0].slice(0, 10) < range.end);
  const total = Math.ceil(rows.length / 24);
  for (let done = 1; done <= total; done += 30) {
    onProgress(done, total);
    await new Promise((r) => setTimeout(r, 40));
  }
  onProgress(total, total);
  return rows;
}

runBookmarklet({ ...demo, fetchHours });
