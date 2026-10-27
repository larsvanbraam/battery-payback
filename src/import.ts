// Where the hourly data comes from: the sample household, a CSV the visitor uploads, or a bookmarklet
// that fetches it from the visitor's energy provider in their own browser. Whatever the visitor loads is
// remembered in this browser only, so the page shows their own numbers next time.
import { CHANNEL, parseBookmarkletMessage, type HourRow } from './bookmarklet/protocol.ts';
import {
  clearDataset, haveUntil, loadDataset, mergeRows, saveDataset, toCsv, toHourObjects, toRows, type Dataset,
} from './dataset.ts';
import { PROVIDERS, bookmarkletHref, findProvider, type Provider } from './providers/index.ts';
import { parseCsv, toHours, type Hour } from './simulate.ts';

export interface LoadedData {
  hours: Hour[];
  /** Shown in the status line, for example "your Greenchoice data". */
  label: string;
  isSample: boolean;
}

type OnData = (data: LoadedData) => void;

const SAMPLE_PATH = 'data/sample-hourly.csv';
const MIN_HOURS = 24 * 7;

const $ = (id: string) => document.getElementById(id)!;
const dialog = () => $('data-card') as HTMLDialogElement;

function openDialog() {
  if (!dialog().open) dialog().showModal();
}

function describe(dataset: Dataset): string {
  return dataset.source === 'file' ? `your file ${dataset.label}` : `your ${dataset.label} data`;
}

async function sample(): Promise<LoadedData> {
  const res = await fetch(SAMPLE_PATH);
  if (!res.ok) throw new Error(`Couldn't load the sample data (${res.status}).`);
  return { hours: toHours(parseCsv(await res.text())), label: 'a made-up sample household', isSample: true };
}

export async function initialData(): Promise<LoadedData> {
  const stored = loadDataset();
  if (stored) return { hours: toHourObjects(stored.rows), label: describe(stored), isSample: false };
  return sample();
}

function showError(message: string | null) {
  $('data-error').textContent = message ?? '';
  $('data-error').hidden = !message;
}

function showProgress(text: string | null, done = 0, total = 0) {
  $('import-progress').hidden = text === null;
  $('import-progress-text').textContent = text ?? '';
  const bar = $('import-bar') as HTMLProgressElement;
  if (total) {
    bar.max = total;
    bar.value = done;
  } else bar.removeAttribute('value');
}

export function renderDataStatus(data: LoadedData) {
  const first = data.hours[0].timestamp.slice(0, 10);
  const last = data.hours[data.hours.length - 1].timestamp.slice(0, 10);
  const stored = loadDataset();
  const updated = stored && !data.isSample
    ? `, updated ${new Date(stored.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';
  $('data-status').textContent =
    `Showing ${data.label}: ${first} to ${last}, ${data.hours.length.toLocaleString('en-US')} hours${updated}.`;
  $('data-badge').textContent = data.isSample ? 'Sample household' : stored?.label ?? 'Your own data';
  $('topbar-period').textContent = `${first} to ${last}`;
  $('data-badge').classList.toggle('own', !data.isSample);
  $('sample-banner').hidden = !data.isSample;
  $('data-actions').hidden = data.isSample;
}

// Saves what was loaded and hands it to the page; refuses data too short to say anything useful.
function accept(dataset: Dataset, onData: OnData) {
  if (dataset.rows.length < MIN_HOURS) {
    showError(`Only ${dataset.rows.length} hours of data came in; at least a week is needed.`);
    return;
  }
  const saved = saveDataset(dataset);
  showError(saved ? null : 'Your data is shown, but this browser won\'t let the page remember it for next time.');
  if (saved) dialog().close();
  onData({ hours: toHourObjects(dataset.rows), label: describe(dataset), isSample: false });
}

function renderProviders() {
  const tabs = $('provider-tabs');
  tabs.hidden = PROVIDERS.length < 2;
  const select = (p: Provider) => {
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === p.id));
    const link = $('bookmarklet') as HTMLAnchorElement;
    link.href = bookmarkletHref(p, location.origin);
    link.textContent = `Get my ${p.name} data`;
    const login = $('provider-login') as HTMLAnchorElement;
    login.href = p.loginUrl;
    login.textContent = `Open ${p.where}`;
    for (const el of document.querySelectorAll('.provider-name')) el.textContent = p.name;
  };
  tabs.replaceChildren(...PROVIDERS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = p.id;
    b.textContent = p.name;
    b.addEventListener('click', () => select(p));
    return b;
  }));
  select(PROVIDERS[0]);

  // Clicking the bookmarklet here would run it on this page; it only works from the bookmarks bar.
  $('bookmarklet').addEventListener('click', (ev) => {
    ev.preventDefault();
    $('bookmarklet-hint').hidden = false;
  });
}

// The page was opened by a bookmarklet: tell it what we already have, then take its data.
function listenToBookmarklet(provider: Provider, onData: OnData) {
  const opener = window.opener as Window | null;
  if (!opener) return;
  history.replaceState(null, '', location.pathname + location.search);
  openDialog();
  showError(null);
  showProgress(`Waiting for ${provider.name}…`);

  window.addEventListener('message', (ev) => {
    if (ev.origin !== provider.origin || ev.source !== opener) return;
    const msg = parseBookmarkletMessage(ev.data);
    if (!msg || msg.provider !== provider.id) return;
    if (msg.type === 'progress') {
      showProgress(`Fetching your hourly data from ${provider.name}: day ${msg.done} of ${msg.total}…`, msg.done, msg.total);
    } else if (msg.type === 'error') {
      showProgress(null);
      showError(`${provider.name}: ${msg.message}`);
    } else {
      showProgress(null);
      const stored = loadDataset();
      const existing: HourRow[] = stored?.source === provider.id ? stored.rows : [];
      accept({
        version: 1, source: provider.id, label: provider.name, updatedAt: new Date().toISOString(),
        rows: mergeRows(existing, msg.rows),
      }, onData);
    }
  });

  const ready = { channel: CHANNEL, type: 'ready', haveUntil: haveUntil(loadDataset(), provider.id) };
  opener.postMessage(ready, provider.origin);
}

export function bindImport(onData: OnData) {
  renderProviders();
  for (const el of [$('open-data'), ...document.querySelectorAll('[data-open-data]')]) el.addEventListener('click', openDialog);
  $('close-data').addEventListener('click', () => dialog().close());

  const file = $('hourly-file') as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    showError(null);
    try {
      const rows = toRows(toHours(parseCsv(await f.text())));
      accept({ version: 1, source: 'file', label: f.name, updatedAt: new Date().toISOString(), rows: mergeRows([], rows) }, onData);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
    file.value = '';
  });

  $('download-data').addEventListener('click', () => {
    const stored = loadDataset();
    if (!stored) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(stored.rows)], { type: 'text/csv' }));
    a.download = `${stored.source === 'file' ? 'meter-data' : stored.source}-hourly.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('forget-data').addEventListener('click', async () => {
    clearDataset();
    showError(null);
    try {
      onData(await sample());
      dialog().close();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  });

  const match = location.hash.match(/^#import=([a-z0-9-]+)$/);
  const provider = match ? findProvider(match[1]) : undefined;
  if (provider) listenToBookmarklet(provider, onData);
}
