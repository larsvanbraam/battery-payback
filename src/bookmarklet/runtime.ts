// Shared part of every provider bookmarklet. It runs on the provider's website, in the visitor's own
// logged-in browser, so the provider sees the same requests its own site would make and the tool's
// server sees none. The tool opens in a new tab and receives the data with postMessage; if that tab
// can't be reached (a popup blocker, or the provider isolates its windows) the data downloads as CSV
// instead, ready to drop into the tool.
import {
  APP_ORIGIN_PLACEHOLDER, CHANNEL, isReadyMessage, type BookmarkletMessage, type HourRow,
} from './protocol.ts';

export interface DateRange {
  /** First day to fetch, YYYY-MM-DD. */
  start: string;
  /** Day after the last one to fetch, YYYY-MM-DD. */
  end: string;
}

export interface ProviderScript {
  id: string;
  name: string;
  /** The origin the bookmarklet has to run on, for example https://mijn.greenchoice.nl. */
  origin: string;
  loginUrl: string;
  fetchHours(range: DateRange, onProgress: (done: number, total: number) => void): Promise<HourRow[]>;
}

/** A message without the fields `send` fills in. */
type Payload = BookmarkletMessage extends infer M ? (M extends BookmarkletMessage ? Omit<M, 'channel' | 'provider'> : never) : never;

const APP_ORIGIN: string = APP_ORIGIN_PLACEHOLDER;
const READY_TIMEOUT_MS = 20_000;
const DAYS = 365;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** The last full year up to and including yesterday, minus the days the tool already has. */
export function rangeToFetch(today: string, haveUntil: string | null): DateRange {
  const start = addDays(today, -DAYS);
  return { start: haveUntil && haveUntil >= start ? addDays(haveUntil, 1) : start, end: today };
}

function overlay() {
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  Object.assign(box.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', maxWidth: '340px',
    padding: '14px 16px', borderRadius: '10px', background: '#1c2421', color: '#fff',
    font: '14px/1.45 system-ui, sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,.3)',
  });
  document.body.appendChild(box);
  return {
    set(text: string) { box.textContent = text; },
    close(afterMs: number) { setTimeout(() => box.remove(), afterMs); },
  };
}

function downloadCsv(name: string, rows: HourRow[]) {
  const csv = ['timestamp,import_kwh,export_kwh', ...rows.map((r) => r.join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Waits for the tool's tab to say it's ready, and learns which days it already has.
function waitForApp(app: Window | null): Promise<{ haveUntil: string | null } | null> {
  if (!app) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve(null); }, READY_TIMEOUT_MS);
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== APP_ORIGIN || ev.source !== app || !isReadyMessage(ev.data)) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({ haveUntil: typeof ev.data.haveUntil === 'string' ? ev.data.haveUntil : null });
    }
    window.addEventListener('message', onMessage);
  });
}

export async function runBookmarklet(provider: ProviderScript) {
  if (location.origin !== provider.origin) {
    if (confirm(`This bookmark only works on ${provider.name}'s website. Log in there first, then click the bookmark again.\n\nGo to ${provider.loginUrl} now?`)) {
      location.href = provider.loginUrl;
    }
    return;
  }

  // Open the tool straight away: browsers only allow a new tab during the click itself.
  const app = window.open(`${APP_ORIGIN}/#import=${provider.id}`, '_blank');
  const send = (msg: Payload) => {
    try {
      app?.postMessage({ channel: CHANNEL, provider: provider.id, ...msg }, APP_ORIGIN);
    } catch { /* the tab was closed */ }
  };

  const status = overlay();
  status.set(`Home battery payback: connecting…`);
  const connection = await waitForApp(app);
  const range = rangeToFetch(isoDay(new Date()), connection?.haveUntil ?? null);

  try {
    const rows = range.start < range.end
      ? await provider.fetchHours(range, (done, total) => {
        status.set(`Home battery payback: fetching your hourly data from ${provider.name}, day ${done} of ${total}…`);
        if (connection) send({ type: 'progress', done, total });
      })
      : [];
    if (connection) {
      send({ type: 'data', rows });
      status.set(`Done: ${rows.length.toLocaleString()} hours sent to the Home battery payback tab. You can close this message.`);
      app?.focus();
    } else {
      downloadCsv(`${provider.id}-hourly.csv`, rows);
      status.set(`Done: your data was downloaded as ${provider.id}-hourly.csv. Upload that file in Home battery payback (${APP_ORIGIN}).`);
    }
    status.close(15_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (connection) send({ type: 'error', message });
    status.set(`Home battery payback couldn't fetch your data: ${message}`);
    status.close(20_000);
  }
}
