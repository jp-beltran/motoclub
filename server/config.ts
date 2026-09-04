import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Boot assertions that refuse to start rather than run wrong. Each one
 * converts a silent bug into a loud, actionable failure — see the
 * individual `assert*` functions below for why each exists.
 *
 * Exit codes follow the shared backend contract
 * (`.superpowers/sdd/prototipo-bar-ui/backend-contract.md`):
 *   0 success · 1 generic error · 2 missing prerequisite (Node, arch,
 *   secrets the installer should have generated) · 3 verification failed
 *   (integrity_check, timezone, foreign_keys not enforced).
 */
export class BootAssertionError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message)
    this.name = 'BootAssertionError'
  }
}

export const REQUIRED_TIMEZONE = 'America/Sao_Paulo'

/**
 * `node:sqlite` shipped experimentally in Node 22.5.0. Below that, `import
 * ('node:sqlite')` throws "Cannot find module" — a stack trace pointing
 * inside this process's own dependency, not at the real problem. Checking
 * the running version *before* that import is what turns it into a message
 * naming the version to install instead.
 */
export const MINIMUM_NODE_VERSION = { major: 22, minor: 5, patch: 0 } as const

export interface ServerConfig {
  readonly dbPath: string
  readonly pinHash: string
  readonly sessionSecret: string
  readonly port: number
  readonly host: string
  readonly staticDir: string
}

function parseNodeVersion(version: string): readonly [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`Unparseable Node version string: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isSupportedNodeVersion(version: string): boolean {
  const [major, minor, patch] = parseNodeVersion(version)
  const required = MINIMUM_NODE_VERSION
  if (major !== required.major) return major > required.major
  if (minor !== required.minor) return minor > required.minor
  return patch >= required.patch
}

export function assertSupportedNodeVersion(version: string = process.version): void {
  if (isSupportedNodeVersion(version)) return
  const { major, minor, patch } = MINIMUM_NODE_VERSION
  throw new BootAssertionError(
    `This server needs Node >= ${major}.${minor}.${patch} for the built-in node:sqlite ` +
      `driver; found ${version}. Install the Node 22 LTS tarball at /opt/node (see ` +
      'scripts/install.sh) and point the systemd unit at it.',
    2,
  )
}

/**
 * `getMonthKey`/`getCurrentMonth` (src/features/bar/domain/month.ts and
 * shared/date.ts) use local-time accessors, `consolidateMonth` attributes
 * revenue by them, and `ensureMonthlyTab` refuses a month mismatch. A
 * server booting under UTC (or any zone but the club's own) would silently
 * put late-night end-of-month consumption in the wrong month — this is the
 * assertion that matters most in this file.
 */
export function assertTimezone(
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): void {
  if (timezone === REQUIRED_TIMEZONE) return
  throw new BootAssertionError(
    `Server timezone must be ${REQUIRED_TIMEZONE} (resolved to ${timezone}). Month ` +
      'attribution (getMonthKey/getCurrentMonth) uses local-time accessors; booting under ' +
      `the wrong zone misfiles consumption at month boundaries. Set TZ=${REQUIRED_TIMEZONE} ` +
      '(systemd Environment=TZ, or `timedatectl set-timezone`) and retry.',
    3,
  )
}

/**
 * `PRAGMA foreign_keys` is per-connection and OFF by default in SQLite —
 * `schema.sql` turns it on, but nothing guarantees the statement actually
 * took effect on this build/platform. Checking the pragma's own answer
 * after opening is cheaper than trusting the request.
 */
export function assertForeignKeysEnabled(value: unknown): void {
  if (value === 1) return
  throw new BootAssertionError(
    `PRAGMA foreign_keys must report 1 after opening the database (reported ` +
      `${JSON.stringify(value)}). Refusing to serve with referential integrity unenforced.`,
    3,
  )
}

/** Better a loud refusal at boot than silently serving a corrupt database. */
export function assertIntegrityOk(value: unknown): void {
  if (value === 'ok') return
  throw new BootAssertionError(
    `PRAGMA integrity_check did not report "ok" (reported ${JSON.stringify(value)}). ` +
      'Refusing to serve a possibly corrupt database — restore the latest backup from ' +
      '~/Backups/motoclub/ with scripts/restore.sh before retrying.',
    3,
  )
}

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'

function firstNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Lets a caller that knows a better default (`main.ts`, resolved relative
 * to the running bundle's own on-disk location — see `defaultStaticDir` in
 * `main.ts`) supply it, without `config.ts` itself needing to know it is
 * running bundled. See `loadEnvConfig`'s doc comment for why this matters. */
export interface LoadConfigDefaults {
  readonly staticDir?: string
}

/**
 * Parses and validates every env var in the shared contract. Pure aside
 * from reading `env` and `process.cwd()`/`homedir()` for defaults — no
 * filesystem or database access — so it is exercised directly in tests
 * without touching a real SQLite file.
 *
 * `BAR_STATIC_DIR` unset falls back to `defaults.staticDir` when the caller
 * supplies one, and only then to `process.cwd() + '/dist'`. The `cwd`
 * fallback depends on the process's working directory matching the
 * checkout root — true only if whatever starts the process (a systemd
 * unit's `ExecStart`, a developer's shell) happens to set/be in that
 * directory. `main.ts` passes a `defaults.staticDir` resolved from its own
 * bundled file location specifically to remove that dependency in
 * production; the `cwd`-based fallback stays as the default here so this
 * function keeps working standalone (as every test above already exercises
 * it) and for a hypothetical unbundled/dev invocation.
 */
export function loadEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: LoadConfigDefaults = {},
): ServerConfig {
  const dbPath = firstNonEmpty(env.BAR_DB_PATH) ?? join(homedir(), '.local/share/motoclub/bar.sqlite3')
  const staticDir =
    firstNonEmpty(env.BAR_STATIC_DIR) ?? defaults.staticDir ?? join(process.cwd(), 'dist')
  const host = firstNonEmpty(env.BAR_HOST) ?? DEFAULT_HOST

  // Structural, not configurable: the "no network" decision does not bend
  // for an env var. See also main.ts, which binds only to `host` below —
  // this check exists so a bad env file fails loudly instead of listening
  // wide.
  if (host === '0.0.0.0') {
    throw new BootAssertionError(
      'BAR_HOST must never be 0.0.0.0 — "no network" is structural, not configuration. ' +
        'Leave BAR_HOST unset (defaults to 127.0.0.1) or set it explicitly to 127.0.0.1.',
      1,
    )
  }

  const portInput = firstNonEmpty(env.BAR_PORT)
  const port = portInput === undefined ? DEFAULT_PORT : Number(portInput)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BootAssertionError(
      `BAR_PORT must be an integer TCP port between 1 and 65535 (got ${JSON.stringify(env.BAR_PORT)}).`,
      1,
    )
  }

  const pinHash = firstNonEmpty(env.BAR_PIN_HASH)
  const sessionSecret = firstNonEmpty(env.BAR_SESSION_SECRET)
  const missing = [
    !pinHash ? 'BAR_PIN_HASH' : undefined,
    !sessionSecret ? 'BAR_SESSION_SECRET' : undefined,
  ].filter((name): name is string => name !== undefined)
  if (missing.length > 0) {
    throw new BootAssertionError(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'Generate them and store both in ~/.config/motoclub/env (chmod 600):\n' +
        '  BAR_SESSION_SECRET: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        '  BAR_PIN_HASH (format scrypt$<salt-hex>$<hash-hex>):\n' +
        '    node -e "const c=require(\'node:crypto\');const s=c.randomBytes(16).toString(\'hex\');' +
        'console.log(\'scrypt$\'+s+\'$\'+c.scryptSync(process.argv[1],Buffer.from(s,\'hex\'),64).toString(\'hex\'))" <PIN>',
      2,
    )
  }

  return {
    dbPath,
    pinHash: pinHash as string,
    sessionSecret: sessionSecret as string,
    port,
    host,
    staticDir,
  }
}

/**
 * Runs the env-independent boot assertions (Node version, timezone) and
 * parses/validates the environment. Assertions that need an open database
 * connection (`assertForeignKeysEnabled`, `assertIntegrityOk`) run
 * separately in `main.ts`, once the driver exists.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: LoadConfigDefaults = {},
): ServerConfig {
  assertSupportedNodeVersion()
  assertTimezone()
  return loadEnvConfig(env, defaults)
}
