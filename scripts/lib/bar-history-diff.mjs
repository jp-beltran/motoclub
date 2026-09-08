// scripts/lib/bar-history-diff.mjs — coarse, id-based comparison between
// two BarDatabase snapshots (the `data` half of the {version,data} envelope
// `kv`/`kv_history` store), used by scripts/history.mjs's `diff` and
// `restore` commands.
//
// Deliberately coarse (see the task report): per top-level collection
// (consumers, items, tabs, ...), it reports how many rows exist on each
// side and which ids were added, removed, or changed (same id, different
// JSON) — not a field-level diff. That is enough for an operator to tell
// "this is the version before the mistake" apart from "this is the one
// after" without reading raw JSON, without this module needing to know
// anything about the domain beyond "arrays of objects with an `id`".

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} item
 * @returns {item is { id: string }}
 */
function hasStringId(item) {
  return isPlainObject(item) && typeof item.id === 'string';
}

/**
 * @param {unknown} maybeArray
 * @returns {unknown[]}
 */
function asArray(maybeArray) {
  return Array.isArray(maybeArray) ? maybeArray : [];
}

/**
 * @typedef {{
 *   name: string,
 *   before: number,
 *   after: number,
 *   added: string[],
 *   removed: string[],
 *   changed: string[],
 * }} CollectionDiff
 */

/**
 * Compares two `BarDatabase`-shaped objects (or anything array-of-objects
 * shaped enough to look like one — missing/malformed input is tolerated,
 * never thrown on, since this runs against arbitrary stored history that
 * pre-dates whatever shape this function currently expects).
 *
 * @param {unknown} before
 * @param {unknown} after
 * @returns {{ collections: CollectionDiff[] }}
 */
export function diffBarDatabases(before, after) {
  const beforeObj = isPlainObject(before) ? before : {};
  const afterObj = isPlainObject(after) ? after : {};
  const names = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort();

  const collections = names.map((name) => {
    const beforeList = asArray(beforeObj[name]);
    const afterList = asArray(afterObj[name]);
    const beforeById = new Map(beforeList.filter(hasStringId).map((item) => [item.id, item]));
    const afterById = new Map(afterList.filter(hasStringId).map((item) => [item.id, item]));

    /** @type {string[]} */
    const added = [];
    /** @type {string[]} */
    const changed = [];
    for (const [id, item] of afterById) {
      const previous = beforeById.get(id);
      if (previous === undefined) added.push(id);
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changed.push(id);
    }

    /** @type {string[]} */
    const removed = [];
    for (const id of beforeById.keys()) {
      if (!afterById.has(id)) removed.push(id);
    }

    return { name, before: beforeList.length, after: afterList.length, added, removed, changed };
  });

  return { collections };
}
