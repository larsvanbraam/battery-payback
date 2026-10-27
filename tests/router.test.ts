import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseRoute, toPath } from '../src/router.ts';

test('paths map to routes, and unknown paths to the start screen', () => {
  assert.deepEqual(parseRoute('/'), { name: 'start' });
  assert.deepEqual(parseRoute('/sample'), { name: 'sample' });
  assert.deepEqual(parseRoute('/results/'), { name: 'results' });
  assert.deepEqual(parseRoute('/import/greenchoice'), { name: 'import', provider: 'greenchoice' });
  assert.deepEqual(parseRoute('/nope'), { name: 'start' });
  assert.deepEqual(parseRoute('/import/<script>'), { name: 'start' });
});

test('old hash links still lead to the same place', () => {
  assert.deepEqual(parseRoute('/', '#sample'), { name: 'sample' });
  assert.deepEqual(parseRoute('/', '#import=greenchoice'), { name: 'import', provider: 'greenchoice' });
  assert.deepEqual(parseRoute('/', '#get-data'), { name: 'start' });
});

test('every route has a path that parses back to it', () => {
  for (const route of [{ name: 'start' }, { name: 'sample' }, { name: 'results' }, { name: 'import', provider: 'demo' }] as const) {
    assert.deepEqual(parseRoute(toPath(route)), route);
  }
});
