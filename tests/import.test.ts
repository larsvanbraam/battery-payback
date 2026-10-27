import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CHANNEL, parseBookmarkletMessage, type HourRow } from '../src/bookmarklet/protocol.ts';
import { rangeToFetch } from '../src/bookmarklet/runtime.ts';
import { dropEmptyDays, haveUntil, mergeRows, toCsv } from '../src/dataset.ts';
import { idsFromAccount, idsFromUrls, parseConsumptions } from '../src/providers/greenchoice/api.ts';

// Shaped like a real response from Mijn Greenchoice, trimmed to two hours.
const greenchoiceDay = {
  interval: 'Hour',
  periods: [
    {
      consumedOn: '2026-06-20T13:00:00+02:00',
      products: [{
        type: 'Electricity',
        costs: [
          { kind: 'Consumption', registerType: 'Normal', quantity: 0.1 },
          { kind: 'Consumption', registerType: 'Low', quantity: 0.05 },
          { kind: 'FeedIn', registerType: 'FeedInNormal', quantity: -1.2 },
          { kind: 'FixedDelivery', quantity: 0.0416 },
        ],
        totals: { consumptionQuantity: 0.15, feedInQuantity: -1.2 },
      }],
    },
    { consumedOn: '2026-06-20T14:00:00+02:00', products: [{ type: 'Gas', costs: [{ kind: 'Consumption', quantity: 0.1 }] }] },
  ],
};

test('parseConsumptions sums the consumption registers and makes feed-in positive', () => {
  assert.deepEqual(parseConsumptions(greenchoiceDay), [['2026-06-20T13:00:00+02:00', 0.15, 1.2]]);
  assert.deepEqual(parseConsumptions({ interval: 'Hour' }), []);
});

test('the Greenchoice contract is found in request URLs or the account response', () => {
  assert.deepEqual(
    idsFromUrls(['https://mijn.greenchoice.nl/api/v2/notifications', 'https://mijn.greenchoice.nl/api/v2/customers/12/agreements/345/meter-information']),
    { customerId: '12', agreementId: '345' },
  );
  assert.equal(idsFromUrls([]), null);
  assert.deepEqual(idsFromAccount({ customers: [{ customerId: 12, agreements: [{ agreementId: '345' }] }] }), { customerId: '12', agreementId: '345' });
  assert.equal(idsFromAccount({ name: 'x' }), null);
});

test('rangeToFetch takes the past year, or only what is missing', () => {
  assert.deepEqual(rangeToFetch('2026-10-27', null), { start: '2025-10-27', end: '2026-10-27' });
  assert.deepEqual(rangeToFetch('2026-10-27', '2026-10-20'), { start: '2026-10-21', end: '2026-10-27' });
  assert.deepEqual(rangeToFetch('2026-10-27', '2024-01-01'), { start: '2025-10-27', end: '2026-10-27' });
});

const hoursOf = (date: string, importKwh: number, exportKwh = 0): HourRow[] =>
  Array.from({ length: 24 }, (_, h) => [`${date}T${String(h).padStart(2, '0')}:00:00+02:00`, importKwh, exportKwh]);

test('days without any data are dropped', () => {
  const rows = [...hoursOf('2026-06-01', 0.2), ...hoursOf('2026-06-02', 0)];
  assert.equal(dropEmptyDays(rows).length, 24);
});

test('mergeRows replaces hours, sorts them and keeps one year', () => {
  const old = [...hoursOf('2025-06-01', 0.1), ...hoursOf('2026-06-01', 0.1)];
  const merged = mergeRows(old, [...hoursOf('2026-06-01', 0.3), ...hoursOf('2026-06-02', 0.2)]);
  assert.equal(merged.length, 48, 'the day over a year old is dropped');
  assert.equal(merged[0][1], 0.3, 'the new value wins');
  assert.equal(merged[47][0], '2026-06-02T23:00:00+02:00');
});

test('haveUntil steps back a day so a partial last day is fetched again', () => {
  const dataset = { version: 1 as const, source: 'greenchoice', label: 'Greenchoice', updatedAt: '', rows: hoursOf('2026-06-02', 0.1) };
  assert.equal(haveUntil(dataset, 'greenchoice'), '2026-06-01');
  assert.equal(haveUntil(dataset, 'other'), null);
  assert.equal(haveUntil(null, 'greenchoice'), null);
});

test('toCsv writes the upload format', () => {
  assert.equal(toCsv([['2026-06-01T00:00:00+02:00', 0.2, 0]]), 'timestamp,import_kwh,export_kwh\n2026-06-01T00:00:00+02:00,0.2,0\n');
});

test('only well-formed bookmarklet messages are accepted', () => {
  const rows = hoursOf('2026-06-01', 0.2);
  assert.ok(parseBookmarkletMessage({ channel: CHANNEL, type: 'data', provider: 'greenchoice', rows }));
  assert.ok(parseBookmarkletMessage({ channel: CHANNEL, type: 'progress', provider: 'greenchoice', done: 1, total: 2 }));
  assert.equal(parseBookmarkletMessage({ channel: 'other', type: 'data', provider: 'greenchoice', rows }), null);
  assert.equal(parseBookmarkletMessage({ channel: CHANNEL, type: 'data', provider: 'greenchoice', rows: [['<script>', 1, 2]] }), null);
  assert.equal(parseBookmarkletMessage({ channel: CHANNEL, type: 'data', provider: 'greenchoice', rows: [['2026-06-01T00:00:00+02:00', 'x', 2]] }), null);
  assert.equal(parseBookmarkletMessage(null), null);
});
