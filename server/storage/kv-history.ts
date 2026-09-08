import { gzipSync } from 'node:zlib'
import type { SqlDriver } from './driver'

/**
 * Cap on the number of `kv_history` rows kept, in isolation from the byte
 * budget below. 200 is the number the plan (`atomic-churning-bonbon.md`,
 * "Fase 4") reasoned about, assuming an ~800 KB database — measured
 * separately (see the task report) to hold at roughly 1,000 accumulated
 * `consumptions`, a realistic size for a season of use, not a whole
 * multi-year history. It is kept as-is: it is the right "how many taps back
 * can I undo" depth for the mistake this feature targets (one bad tap
 * during a live event), and `MAX_HISTORY_BYTES` below is what keeps it
 * honest once the database itself grows far past that assumption.
 */
export const MAX_HISTORY_ENTRIES = 200

/**
 * Independent cap on the *total compressed bytes* `kv_history` may occupy,
 * enforced in addition to `MAX_HISTORY_ENTRIES` — never a replacement for
 * it. Measured against synthetic databases shaped like this app's real
 * collections (see the task report's numbers): at ~1,000 consumptions
 * (~90 KB gzip/snapshot) 200 versions cost ~17 MB, matching the plan's own
 * estimate; at ~11,700 consumptions (the plan's own stated multi-year
 * capacity ceiling for this club, ~1.5 MB gzip/snapshot) 200 versions would
 * cost over 300 MB — plausible but not something a machine with a small
 * eMMC disk (Fase 0 flags a 32 GB variant of this hardware) should pay
 * without being asked. 20 MiB is a deliberately generous margin over the
 * plan's own "~16 MB" figure for the size it was actually reasoned about;
 * once the database grows well past that, this cap trims *how many*
 * versions are kept — not whether the feature works at all — favouring a
 * shallower undo window over an unbounded disk cost.
 */
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024

export interface PruneHistoryOptions {
  readonly maxEntries?: number
  readonly maxBytes?: number
}

/**
 * Compresses `value` with gzip (JSON compresses roughly 5-8x at this app's
 * real data shapes — see the task report) and appends it as a new
 * `kv_history` row. Never called outside a `driver.transaction(...)` (see
 * `SqliteStorage.setItem`): a history row that exists without the `kv`
 * write it records, or vice versa, is worse than no history at all.
 */
export function insertHistoryEntry(driver: SqlDriver, key: string, value: string, writtenAt: string): void {
  const compressed = gzipSync(Buffer.from(value, 'utf8'))
  driver.run('INSERT INTO kv_history (key, value_gz, written_at) VALUES (?, ?, ?)', [key, compressed, writtenAt])
}

/**
 * Deletes the oldest `kv_history` rows until both caps are satisfied:
 * first the row-count cap, then the byte-budget cap (computed as a running
 * total from the newest row backwards, via a window function, so the most
 * recent entries always survive and the oldest ones are the first to go —
 * see `MAX_HISTORY_ENTRIES`/`MAX_HISTORY_BYTES` above for why both exist).
 * Idempotent and cheap to call when already under both caps. Called from
 * inside the same `driver.transaction(...)` as the `kv_history` insert it
 * follows, so a mistake here never survives without its cause, and never
 * loses a write to a partially-applied prune either.
 */
export function pruneHistory(driver: SqlDriver, options: PruneHistoryOptions = {}): void {
  const maxEntries = options.maxEntries ?? MAX_HISTORY_ENTRIES
  const maxBytes = options.maxBytes ?? MAX_HISTORY_BYTES

  driver.run('DELETE FROM kv_history WHERE seq NOT IN (SELECT seq FROM kv_history ORDER BY seq DESC LIMIT ?)', [
    maxEntries,
  ])

  driver.run(
    `DELETE FROM kv_history WHERE seq IN (
       SELECT seq FROM (
         SELECT seq, SUM(LENGTH(value_gz)) OVER (ORDER BY seq DESC) AS running_total
         FROM kv_history
       )
       WHERE running_total > ?
     )`,
    [maxBytes],
  )
}
