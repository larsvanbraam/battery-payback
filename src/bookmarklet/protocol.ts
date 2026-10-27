// Messages between a bookmarklet running on a provider's website and the tool's page it opens.
// Both sides check the other's origin; nothing ever goes through the tool's own server.

/** One hour of meter data: [ISO timestamp with offset, kWh from the grid, kWh sent to the grid]. */
export type HourRow = [string, number, number];

export const CHANNEL = 'home-battery-payback';

/** Replaced with the tool's origin when the page builds the bookmarklet link. */
export const APP_ORIGIN_PLACEHOLDER = '__APP_ORIGIN__';

/** Sent by the tool once it has loaded. `haveUntil` is the last day it already has (YYYY-MM-DD). */
export interface ReadyMessage {
  channel: typeof CHANNEL;
  type: 'ready';
  haveUntil: string | null;
}

export interface ProgressMessage {
  channel: typeof CHANNEL;
  type: 'progress';
  provider: string;
  done: number;
  total: number;
}

export interface DataMessage {
  channel: typeof CHANNEL;
  type: 'data';
  provider: string;
  rows: HourRow[];
}

export interface ErrorMessage {
  channel: typeof CHANNEL;
  type: 'error';
  provider: string;
  message: string;
}

export type BookmarkletMessage = ProgressMessage | DataMessage | ErrorMessage;

export function isReadyMessage(data: unknown): data is ReadyMessage {
  const d = data as ReadyMessage | null;
  return !!d && d.channel === CHANNEL && d.type === 'ready';
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isHourRow(row: unknown): row is HourRow {
  return Array.isArray(row) && row.length === 3 && typeof row[0] === 'string' && TIMESTAMP.test(row[0])
    && Number.isFinite(row[1]) && Number.isFinite(row[2]);
}

// The page treats everything from another origin as untrusted: it only accepts these exact shapes.
export function parseBookmarkletMessage(data: unknown): BookmarkletMessage | null {
  const d = data as BookmarkletMessage | null;
  if (!d || d.channel !== CHANNEL || typeof d.provider !== 'string') return null;
  if (d.type === 'progress' && Number.isFinite(d.done) && Number.isFinite(d.total)) return d;
  if (d.type === 'error' && typeof d.message === 'string') return { ...d, message: d.message.slice(0, 300) };
  if (d.type === 'data' && Array.isArray(d.rows) && d.rows.length <= 24 * 400 && d.rows.every(isHourRow)) return d;
  return null;
}
