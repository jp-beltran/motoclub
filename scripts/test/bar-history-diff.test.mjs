import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffBarDatabases } from '../lib/bar-history-diff.mjs';

test('diffBarDatabases reports unchanged collections with no added/removed/changed ids', () => {
  const before = { consumers: [{ id: 'c1', name: 'Ana' }] };
  const after = { consumers: [{ id: 'c1', name: 'Ana' }] };

  const { collections } = diffBarDatabases(before, after);

  assert.deepEqual(collections, [{ name: 'consumers', before: 1, after: 1, added: [], removed: [], changed: [] }]);
});

test('diffBarDatabases detects an added item', () => {
  const before = { consumers: [{ id: 'c1', name: 'Ana' }] };
  const after = { consumers: [{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Bruno' }] };

  const { collections } = diffBarDatabases(before, after);

  const consumers = collections.find((c) => c.name === 'consumers');
  assert.equal(consumers.before, 1);
  assert.equal(consumers.after, 2);
  assert.deepEqual(consumers.added, ['c2']);
  assert.deepEqual(consumers.removed, []);
  assert.deepEqual(consumers.changed, []);
});

test('diffBarDatabases detects a removed item', () => {
  const before = { consumers: [{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Bruno' }] };
  const after = { consumers: [{ id: 'c1', name: 'Ana' }] };

  const { collections } = diffBarDatabases(before, after);

  const consumers = collections.find((c) => c.name === 'consumers');
  assert.deepEqual(consumers.removed, ['c2']);
  assert.deepEqual(consumers.added, []);
});

test('diffBarDatabases detects a changed item (same id, different fields) without counting it as added/removed', () => {
  const before = { items: [{ id: 'i1', name: 'Cerveja', unitPriceCents: 500 }] };
  const after = { items: [{ id: 'i1', name: 'Cerveja', unitPriceCents: 600 }] };

  const { collections } = diffBarDatabases(before, after);

  const items = collections.find((c) => c.name === 'items');
  assert.deepEqual(items.changed, ['i1']);
  assert.deepEqual(items.added, []);
  assert.deepEqual(items.removed, []);
});

test('diffBarDatabases unions collection names from both sides — a collection only in `before` still gets reported', () => {
  const before = { monthlyClosings: [{ id: 'm1' }] };
  const after = {};

  const { collections } = diffBarDatabases(before, after);

  const closings = collections.find((c) => c.name === 'monthlyClosings');
  assert.equal(closings.before, 1);
  assert.equal(closings.after, 0);
  assert.deepEqual(closings.removed, ['m1']);
});

test('diffBarDatabases tolerates missing/malformed input instead of throwing', () => {
  assert.doesNotThrow(() => diffBarDatabases(null, undefined));
  assert.doesNotThrow(() => diffBarDatabases({ consumers: 'not-an-array' }, {}));
});

test('diffBarDatabases sorts collections alphabetically, for a stable report order', () => {
  const before = { tabs: [], consumers: [] };
  const after = { tabs: [], consumers: [] };

  const { collections } = diffBarDatabases(before, after);

  assert.deepEqual(collections.map((c) => c.name), ['consumers', 'tabs']);
});
