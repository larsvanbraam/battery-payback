// Where the hourly data comes from: the sample household, a CSV the visitor uploads, or a bookmarklet
// that fetches it from the visitor's energy provider in their own browser. Whatever the visitor loads is
// remembered in this browser only, so the page shows their own numbers next time. Until something is
// loaded the page shows a start screen; later the same controls open as a dialog. Both copies of each
// control are found by a js-* class and kept in step. Which screen shows follows the path (router.ts).
import { CHANNEL, parseBookmarkletMessage, type HourRow } from './bookmarklet/protocol.ts';
import {
  clearDataset, haveUntil, loadDataset, mergeRows, saveDataset, toCsv, toHourObjects, toRows, type Dataset,
} from './dataset.ts';
import { PROVIDERS, bookmarkletHref, findProvider, type Provider } from './providers/index.ts';
import { currentRoute, navigate, onRoute, bindInPageLinks, type Route } from './router.ts';
import { parseCsv, toHours, type Hour } from './simulate.ts';

export interface LoadedData {
  hours: Hour[];
  /** Shown in the status line, for example "your Greenchoice data". */
  label: string;
  isSample: boolean;
}

type OnData = (data: LoadedData) => void;

const SAMPLE_PATH = '/data/sample-hourly.csv';
const MIN_HOURS = 24 * 7;

const $ = (id: string) => document.getElementById(id)!;
const dialog = () => $('data-card') as HTMLDialogElement;
const all = <T extends HTMLElement = HTMLElement>(cls: string) => [...document.querySelectorAll<T>(`.${cls}`)];

/** What the results screen holds right now, so "Back to my results" and the routes know where to go. */
let showing: 'sample' | 'own' | null = null;

function openDialog() {
  if (!dialog().open) dialog().showModal();
}

function showStart() {
  if (dialog().open) dialog().close();
  $('start-back').hidden = !showing;
  $('start').hidden = false;
  $('app').hidden = true;
  document.body.classList.add('on-start');
  window.scrollTo(0, 0);
}

function showResults() {
  $('start').hidden = true;
  $('app').hidden = false;
  document.body.classList.remove('on-start');
}

function describe(dataset: Dataset): string {
  return dataset.source === 'file' ? `your file ${dataset.label}` : `your ${dataset.label} data`;
}

async function sample(): Promise<LoadedData> {
  const res = await fetch(SAMPLE_PATH);
  if (!res.ok) throw new Error(`Couldn't load the sample data (${res.status}).`);
  return { hours: toHours(parseCsv(await res.text())), label: 'a made-up sample household', isSample: true };
}

function storedData(): LoadedData | null {
  const stored = loadDataset();
  return stored ? { hours: toHourObjects(stored.rows), label: describe(stored), isSample: false } : null;
}

function showError(message: string | null) {
  for (const el of all('js-error')) {
    el.textContent = message ?? '';
    el.hidden = !message;
  }
}

function showProgress(text: string | null, done = 0, total = 0) {
  for (const el of all('js-progress')) el.hidden = text === null;
  for (const el of all('js-progress-text')) el.textContent = text ?? '';
  for (const bar of all<HTMLProgressElement>('js-progress-bar')) {
    if (total) {
      bar.max = total;
      bar.value = done;
    } else bar.removeAttribute('value');
  }
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
  if (saved && dialog().open) dialog().close();
  onData({ hours: toHourObjects(dataset.rows), label: describe(dataset), isSample: false });
  navigate({ name: 'results' }, { replace: location.pathname.startsWith('/import/') });
}

function renderProviders() {
  const select = (p: Provider) => {
    for (const b of document.querySelectorAll<HTMLElement>('.js-provider-tabs button')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === p.id));
    }
    for (const link of all<HTMLAnchorElement>('js-bookmarklet')) {
      link.href = bookmarkletHref(p, location.origin);
      link.textContent = `Get my ${p.name} data`;
    }
    for (const login of all<HTMLAnchorElement>('js-provider-login')) {
      login.href = p.loginUrl;
      login.textContent = `Open ${p.where}`;
    }
    for (const el of document.querySelectorAll('.provider-name')) el.textContent = p.name;
  };
  for (const tabs of all('js-provider-tabs')) {
    tabs.hidden = PROVIDERS.length < 2;
    tabs.replaceChildren(...PROVIDERS.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = p.id;
      b.textContent = p.name;
      b.addEventListener('click', () => select(p));
      return b;
    }));
  }
  select(PROVIDERS[0]);

  // Clicking the bookmarklet here would run it on this page; it only works from the bookmarks bar.
  for (const link of all('js-bookmarklet')) {
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      for (const hint of all('js-bookmarklet-hint')) hint.hidden = false;
    });
  }
}

// The page was opened by a bookmarklet: tell it what we already have, then take its data.
function listenToBookmarklet(provider: Provider, onData: OnData) {
  const opener = window.opener as Window | null;
  if (!opener) return;
  // With results already on screen the progress shows over them; on a first visit, on the start screen.
  if (showing) openDialog(); else showStart();
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

// Shows what a path asks for. The sample and stored data load only when they aren't on screen already.
async function showRoute(route: Route, onData: OnData) {
  showError(null);
  if (route.name === 'start') {
    showStart();
  } else if (route.name === 'sample') {
    if (showing === 'sample') showResults();
    else {
      try {
        onData(await sample());
      } catch (err) {
        showStart();
        showError(err instanceof Error ? err.message : String(err));
      }
    }
  } else if (route.name === 'results') {
    const stored = showing === 'own' ? null : storedData();
    if (showing === 'own') showResults();
    else if (stored) onData(stored);
    else navigate({ name: 'start' }, { replace: true });
  } else {
    const provider = findProvider(route.provider);
    const stored = storedData();
    if (stored) onData(stored);
    // Only a tab the bookmarklet opened can take its data; anything else is just a visit.
    if (provider && window.opener) listenToBookmarklet(provider, onData);
    else navigate(stored ? { name: 'results' } : { name: 'start' }, { replace: true });
  }
}

export function bindImport(show: OnData) {
  const onData: OnData = (data) => {
    showing = data.isSample ? 'sample' : 'own';
    showResults();
    show(data);
  };
  renderProviders();
  bindInPageLinks();
  $('open-data').addEventListener('click', openDialog);
  $('close-data').addEventListener('click', () => dialog().close());
  for (const el of document.querySelectorAll('[data-show-start]')) {
    el.addEventListener('click', () => navigate({ name: 'start' }));
  }
  $('start-back').addEventListener('click', () => navigate({ name: showing === 'sample' ? 'sample' : 'results' }));
  document.querySelector('.brand')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    navigate({ name: 'start' });
  });
  for (const el of document.querySelectorAll('[data-use-sample]')) {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (dialog().open) dialog().close();
      navigate({ name: 'sample' });
    });
  }

  for (const file of all<HTMLInputElement>('js-file')) {
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
  }

  $('download-data').addEventListener('click', () => {
    const stored = loadDataset();
    if (!stored) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(stored.rows)], { type: 'text/csv' }));
    a.download = `${stored.source === 'file' ? 'meter-data' : stored.source}-hourly.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('forget-data').addEventListener('click', () => {
    clearDataset();
    showing = null;
    navigate({ name: 'start' }, { replace: true });
  });

  onRoute((route) => void showRoute(route, onData));
  // A returning visitor with stored data skips the start screen.
  const route = currentRoute();
  if (route.name === 'start' && loadDataset()) navigate({ name: 'results' }, { replace: true });
  else void showRoute(route, onData);
}
