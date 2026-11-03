// titleVariants (background.js): the packaging a site adds to a title that
// the local lookup strips when the exact name misses. The function stands
// alone in the worker, so its source is lifted out and run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const m = src.match(/\nfunction titleVariants\(title, kind\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'titleVariants found in background.js');
const titleVariants = new Function(m[0] + '\nreturn titleVariants;')();

const only = (title, kind = null) => {
  const v = titleVariants(title, kind);
  assert.ok(v.length <= 1, title);
  return v[0] || null;
};

test('season, notes, credits and Part 1 come off; the year is kept apart', () => {
  assert.deepEqual(only('Yellowstone - Season 1', 'series'), { title: 'Yellowstone', kind: 'series', year: null });
  assert.deepEqual(only('Scary Movie (2026) - Extended Cut'), { title: 'Scary Movie', kind: null, year: '2026' });
  assert.deepEqual(only('Greater [OV]'), { title: 'Greater', kind: null, year: null });
  assert.deepEqual(only('Red Eye (UK)'), { title: 'Red Eye', kind: null, year: null });
  assert.deepEqual(only('Ghosts UK'), { title: 'Ghosts', kind: null, year: null });
  assert.deepEqual(only('Clip: Full Custom Garage'), { title: 'Full Custom Garage', kind: null, year: null });
  assert.deepEqual(only('South Park The Streaming Wars Part 1'), { title: 'South Park The Streaming Wars', kind: null, year: null });
  assert.deepEqual(only('X Part 1 (Dubbed)'), { title: 'X', kind: null, year: null });
  assert.deepEqual(only("Tyler Perry's Boo! A Madea Halloween"), { title: 'Boo! A Madea Halloween', kind: null, year: null });
  assert.deepEqual(only("Maurice Sendak's Little Bear"), { title: 'Little Bear', kind: null, year: null });
  // The studio credit is matched in lower case only, as it stands (noted for a later release).
  assert.equal(only("Marvel Studios' Loki"), null);
});

test('a plain title has no variant, and the colon rule stays dropped', () => {
  assert.equal(only('Dunkirk'), null);
  assert.equal(only('Dunkirk: The Real Story'), null);
  assert.equal(only('Part 2'), null);
});
