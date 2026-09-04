# Backend Task 2 — HTTP surface: RPC, error contract, PIN gate, static/SPA (report)

Worktree: `/home/jp-beltran/Desktop/Motoclub/.claude/worktrees/agent-a5106606365367565`
Branch: `worktree-agent-a5106606365367565`
Base: `af711de` (verified with `git log --oneline -3`, `git reset --hard af711de` applied since
HEAD was at `74aa0f3`, one commit behind the merge)

## What was built

```
server/
  http/
    rpc.ts            RPC_METHOD_NAMES (24, exhaustive), isRpcMethod, invokeRpcMethod,
                       BAR_ERROR_STATUS (Record<BarErrorCode, number>, 43 codes), statusForRpcError
    session.ts         hashPin/verifyPin (scrypt + timingSafeEqual), createSessionToken/
                       verifySessionToken (stateless HMAC), cookie header builders,
                       login throttle (in-memory counter + injectable delay)
    static.ts          isAssetPath/isApiPath/hasDottedLastSegment, MIME map,
                       resolveStaticAssetPath (traversal guard), serveStaticAsset,
                       LOGIN_HTML (hand-written), serveAppShell, sendPlainNotFound
    router.ts          createRequestHandler — the one place all routes are wired together
  storage/
    schema.ts          SCHEMA_SQL inlined as a TS string constant (see "mid-course fix" below)
    schema.test.ts     asserts schema.ts and schema.sql never drift apart
  main.ts               (extended, not rewritten) bootServer/shutdown/installShutdownHandlers
                        exported for testing; entry-point guard added
  main.test.ts          (new) boots a real server, ephemeral port, temp DB
```

`package.json`/`eslint.config.js`/`server/tsconfig.json`/`server/vitest.config.ts`: unchanged.
No new npm dependencies — everything above uses only `node:http`, `node:crypto`, `node:fs`,
`node:path`, `node:url`.

**Nothing under `src/`, `e2e/`, `scripts/`, or `deploy/` was touched** — verified with
`git diff --stat af711de -- src/ e2e/ scripts/ deploy/` (empty).

## The RPC endpoint

`POST /api/rpc { method, args }`, `args` defaulting to `[]`, validated as an array before ever
reaching the allowlist. `GET /api/snapshot` kept as an alias (now behind the same session gate
as `/api/rpc` — see "design decision" below).

`RPC_METHOD_NAMES` lists all 24 `BarRepository` port methods (not just the ~14 the UI calls),
guarded by two independent mechanisms so it cannot silently drift from the port:

1. `RpcMethodName = keyof BarRepository` — a typo fails `tsc`.
2. A compile-time exhaustiveness assertion (`Exclude<RpcMethodName, typeof RPC_METHOD_NAMES[number]> extends never ? true : ...`)
   — if the port ever grows a 25th method, `tsc` fails until the array is updated. Same
   technique the task asked for on the error map, applied here too.

`isRpcMethod` is a plain `Set.has` against the literal list — never a bracket-index on an
unchecked string. `invokeRpcMethod` calls `repository[method](...args)` as a method-invocation
expression (not `const fn = repository[method]` then a bare call), which is what preserves the
class's `this` binding; a test proves this (`preserves this` in `rpc.test.ts`).

## The error contract

`BAR_ERROR_STATUS: Readonly<Record<BarErrorCode, number>>` in `server/http/rpc.ts`, written as
a literal object with no index signature — the same technique `application/error-messages.ts`
already uses for the pt-BR table, so a 44th code fails `tsc` here exactly like it would fail the
message table.

Mapping applied:
- **422** — every domain refusal, including every `*-not-found` code. This was a deliberate
  choice: the task reserves 404 for an unknown *route*, and this is an RPC surface, not a
  REST resource tree, so "you referenced an id that doesn't exist" is a business-level refusal
  (422), not a routing 404.
- **409** — `monthly-closing-already-exists` (the uniqueness family).
- **500** — the four stored-data codes (`stored-data-malformed`, `stored-data-unsupported-version`,
  `stored-data-invalid`, `database-mutation-invalid`).
- **401/400/404/500** — `unauthorized`, `bad-request`, `not-found`, `internal-error` are HTTP/RPC-layer
  codes (not `BarErrorCode`), raised by `RpcRequestError` or the router directly.

Two things verified in the domain source, not assumed, per the task's instruction:

- **`quantity-invalid` is unreachable through the repository.** Confirmed:
  `domain/quantity.ts#assertPositiveIntegerQuantity` is only called from
  `domain/consumption.ts#recordConsumption`, but `LocalBarRepository`'s own
  `recordConsumption` (in `local-bar-repository.ts`) pre-checks
  `!Number.isSafeInteger(input.quantity) || input.quantity <= 0` and raises
  `consumption-quantity-invalid` *before* ever calling into the domain function. It still needs
  a row in `BAR_ERROR_STATUS` for the `Record` type to compile; classified 422, identically to
  `consumption-quantity-invalid`, so a future direct-domain caller would get a consistent answer
  rather than an unclassified guess.
- **`tab-not-found` is raised for both the source and target tab in `reassignConsumption`.**
  Confirmed at `local-bar-repository.ts`'s `reassignConsumption`: both `findById(database.tabs,
  consumption.tabId, 'tab-not-found', 'Source tab')` and `findById(database.tabs,
  input.targetTabId, 'tab-not-found', 'Target tab')` use the same code; only the English
  `message` differs, and message never crosses the wire in this contract. Both map to 422; no
  further disambiguation is added, since inventing a second code the domain itself does not
  have would mean the server making up taxonomy the domain layer doesn't own.

Also verified: the four money-invariant codes raised over *stored* rows (not operator input) —
e.g. a corrupted stored payment causing `money-total-overflow` while summing settled
payments in `assertCancellable`/`calculateRemainingCents` — are **already rewrapped by the
repository itself** into `stored-data-invalid` (see `readStoredMoney` in
`local-bar-repository.ts`, merged just before this task started). So `BAR_ERROR_STATUS`
classifying the four money codes as 422 is correct: by the time a `BarError` reaches the
server, an ambiguous "whose number was this" case has already been resolved upstream.

## The PIN gate

`POST /api/session { pin }` → `verifyPin` (scrypt against the `scrypt$<salt-hex>$<hash-hex>`
format documented in `config.ts`, `timingSafeEqual` comparison, never throws on a malformed
hash) → on success, `Set-Cookie: motoclub_session=<token>; HttpOnly; SameSite=Strict; Path=/;
Max-Age=<seconds>` (no `Secure`, per the plan: plain HTTP on loopback). Token is stateless:
`base64url(expiresAt).base64url(HMAC-SHA256(secret, expiresAt))`, TTL 12 hours (a full shift
plus margin) — verified fresh on every request, so a restart mid-shift does not invalidate it.
`GET /logout` sends `Max-Age=0` and a 302 to `/`.

Throttle: an in-memory `{ failures: number }` counter; once `failures >= 5`, every further
login attempt pays a fixed 2s delay (injectable in tests, so the suite doesn't actually wait
2 seconds) before the PIN is even checked. Resets to 0 on success.

**The gate is entirely server-side**, per the plan: with a valid cookie, `serveAppShell` returns
the real built `index.html`; without one, it returns a hand-written `LOGIN_HTML` constant
(`#101114` background, `#E0203A` accent, `#F5F6F7` text, one `<form>`, inline `<script>` posting
to `/api/session` and reloading on success). `/assets/*` is exempt from the gate.
**Zero new files under `src/`, zero new component, zero new client test.**

### Design decision not explicitly spelled out in the task: `/api/snapshot` is gated too

The task's own wording ("plain alias... for debugging with curl") could be read either way. I
gated it identically to `/api/rpc` (401 without a valid cookie) because: (a) it is a full read
of the entire database, no less sensitive than any RPC call; (b) the task's own acceptance
criteria list "the auth gate (401 without cookie, 200 with...)" as a thing to test, and the only
sensible target for that is the JSON API surface; (c) leaving it open would mean the PIN screen
is bypassable with one `curl` command, which contradicts "the gate lives entirely on the
server." Debugging with curl still works — one extra `curl -c/-b cookies.txt` login step.

## Static files and SPA fallback

`/assets/<file>` → `resolveStaticAssetPath` resolves against the static root via `path.resolve`
(which collapses `..` first) and then checks the result still starts with `root + path.sep`
(handling the exact-root case and the sibling-directory-collision case, e.g. root `/x/dist` vs
an escape into `/x/dist-evil`, which a bare `startsWith` would wrongly accept) — `undefined` on
any failure, and the caller answers a plain 404 without distinguishing "traversal" from "not
found," so a probe learns nothing. Content-Type from a small extension map (default
`application/octet-stream`); `Cache-Control: public, max-age=31536000, immutable`.

Any other `GET` outside `/api` with no dot in the last path segment → the SPA shell
(`no-store`), gated as described above. Everything left over is 404: JSON under `/api`
(`{ ok:false, error:{ code:'not-found' } }`), plain text elsewhere.

Real-HTTP path-traversal check (both automated and manual, see below): WHATWG `URL` parsing
(used for `req.url` in the router, same as `curl`'s own default path normalization) collapses
`../` dot-segments *before* the router ever inspects the path — `/assets/../../../../etc/passwd`
arrives as `/etc/passwd`, which no longer matches `/assets/` and is routed as an ordinary
(unauthenticated) SPA/login response, never as file content from outside the root.
`resolveStaticAssetPath`'s own guard is unit-tested directly with a raw, unnormalized string
(bypassing URL normalization) to prove the second layer of defense independently.

## Mid-course fix required by the reviewer's addendum

The coordinator relayed a review finding on the previous slice (`server/main.ts` had zero
automated tests) with two explicit follow-ups. Both required real changes, not just new tests:

1. **`readSchemaSql()`'s bundle-relative path trick broke the moment `main.ts` needed to become
   importable unbundled** (which my own `main.test.ts` needed, to boot a real server against a
   temp DB without going through `process.env`/`process.exit`). Confirmed by running the red
   test: `ENOENT ... /storage/schema.sql` — one directory level too shallow, because unbundled
   `server/main.ts` and bundled `server/dist/server.mjs` sit at different depths relative to
   `server/storage/schema.sql`, and the same relative offset cannot be correct in both. Fixed by
   moving the schema out of runtime file-path arithmetic entirely: `server/storage/schema.ts`
   now exports `SCHEMA_SQL` as a literal TypeScript string (resolved through ordinary module
   resolution, immune to bundling depth), with `server/storage/schema.sql` kept alongside it as
   the human/tool-readable copy and `schema.test.ts` asserting byte-for-byte equality so the two
   can never drift. `main.ts`, `sqlite-storage.test.ts`, and `router.test.ts` all now import
   `SCHEMA_SQL` from this one module instead of reading the file at runtime.
2. **`BAR_STATIC_DIR`'s default (`join(process.cwd(), 'dist')`) silently depended on the
   systemd unit's `WorkingDirectory`** being the checkout — a real, easy-to-make
   misconfiguration risk once this task's slice actually serves that directory. Fixed by adding
   `resolveDistDirFromBundleDir` (pure, unit-tested with plain strings) and `defaultStaticDir()`
   in `main.ts`, which resolve `dist/` from the *running bundle's own on-disk location*
   (`server/dist/server.mjs` → two levels up → `dist/`), the same category of trick the schema
   read used to rely on — but here it is safe, because `defaultStaticDir` is called only from
   `main()`, which is itself guarded by a new `isEntryPoint()` check (`import.meta.url ===
   pathToFileURL(process.argv[1]).href`) so it never runs when the module is merely imported by
   a test. `config.ts`'s `loadEnvConfig`/`loadConfig` gained an optional `defaults.staticDir`
   parameter so `main.ts` can supply this better default without `config.ts` itself needing to
   assume anything about bundling (`BAR_STATIC_DIR` still wins when set explicitly; the
   `cwd`-based fallback stays as the last resort, keeping every existing `config.test.ts` test
   passing unchanged). **Empirically verified**, not just unit-tested: the manual verification
   transcript below runs the real bundle from `/tmp` (deliberately not the checkout) and shows
   it still serves `<repo>/dist/index.html` and its hashed assets correctly.

Also required, from the addendum directly: `server/main.test.ts` (new), exercising a real
server on an ephemeral port against a temp SQLite file — `bootServer`/`shutdown` exported from
`main.ts` for this purpose, with `installShutdownHandlers` (real `process.on`/`process.exit`)
kept separate so no test ever registers a real signal handler or calls the real
`process.exit` (which would kill the test runner). Covers: `/healthz` and `/api/snapshot` still
respond as routing grew; an unknown route is JSON under `/api` and plain text elsewhere; and
`shutdown()` lets an in-flight request finish before closing the driver.

**Writing that last test caught a second, independent real bug**: the first version of
`shutdown()` (`server.close(() => { driver.close(); resolve() })`) took **~3.1 seconds** to
resolve in the test, every run, reproducibly — not a flake. Root cause: `server.close()`'s
callback waits for every *connection* to close, not every *request* to finish, and an
HTTP/1.1 keep-alive connection (default on both ends) sits open, idle, after its response is
sent, until a timeout on either side tears it down. On the real service this means every
browser tab left open against the app adds its own idle-timeout's worth of delay to
`systemctl restart motoclub`. Fixed with `server.closeIdleConnections()` (Node ≥ 18.2, safe on
this server's ≥ 22.5 floor), polled every 50ms while shutdown is pending — a single call at the
top only catches connections already idle the instant shutdown begins, but the connection
serving the in-flight request in the test becomes idle moments *later*, once its response
finishes, so it needs to be caught on a subsequent poll. After the fix, the same test resolves
in the sub-100ms range; a timing assertion (`< 1000ms`) is now a permanent regression guard in
`main.test.ts`.

## TDD evidence

Every module below was written test-first; each showed a real red failure (`Cannot find
module`, or the actual wrong behavior) before the corresponding implementation existed or was
corrected.

1. **`server/http/rpc.ts`** — `rpc.test.ts` written first (`Cannot find module './rpc'`), then
   implemented. 18/18 green. Includes the allowlist rejecting `'constructor'`, `'__proto__'`,
   `'toString'`, `'hasOwnProperty'` alongside a made-up name, and the exhaustiveness test
   (`Object.keys(BAR_ERROR_MESSAGES)` from the client's own table vs `BAR_ERROR_STATUS`, same
   count, every code present).
2. **`server/http/session.ts`** — same pattern, 18/18. Covers `verifyPin` against both
   self-generated and independently-generated scrypt hashes, malformed-hash safety, token
   expiry/tamper/wrong-secret rejection, cookie header shape (`HttpOnly`, `SameSite=Strict`,
   `Path=/`, no `Secure`), and the throttle (no delay under threshold, delay at threshold,
   reset on success) via an injectable `sleep`.
3. **`server/http/static.ts`** — 15/15. Includes three traversal-guard cases against real
   temp-directory fixtures: a normal in-root path, a `../../../../etc/passwd` escape, and a
   sibling-directory-collision (`/tmp/x/dist` vs `/tmp/x/dist-evil`) that a naive
   `startsWith(root)` would wrongly accept.
4. **`server/http/router.ts`** — 25/25 end-to-end tests against a real `http.Server` on an
   ephemeral port, a real SQLite temp-file driver and `LocalBarRepository`, and a real temp
   static directory. First run failed on `Cannot find module './router'`; a second real failure
   (`404 — an unknown route` expected 404, got 200) caught a genuine misunderstanding of the
   plan's own SPA-fallback rule (a route with no dot in its last segment is *correctly* served
   as the app shell, not 404 — that is what React Router's own client-side "not found" page is
   for) — fixed by correcting the test's expectation, not the router.
5. **`server/config.ts`'s new `defaults.staticDir` parameter** — 4 new tests added to the
   existing `config.test.ts` (cwd-based fallback made explicit, caller-default preferred over
   cwd, env var still wins over caller-default); all pass, all 22 tests in the file green,
   none of the pre-existing ones changed behavior.
6. **`server/storage/schema.ts`/`schema.test.ts`** — added mid-course once the bundling-depth
   bug surfaced; the drift-guard test passes and would fail the moment `schema.sql` and
   `schema.ts` diverge.
7. **`server/main.test.ts`** — first run failed for real (`ENOENT ... storage/schema.sql`,
   documented above) before the schema fix; then a real race (`ECONNREFUSED` +
   `database is not open`) in the shutdown test before adding the `requestStarted` handshake;
   then the real ~3.1s stall before adding `closeIdleConnections()` polling. All 7 tests green
   after each fix, in order.

## Status map (`server/http/rpc.ts`, `BAR_ERROR_STATUS`)

| Status | Codes |
|---|---|
| 422 | every `*-not-found`, eligibility (`visitor-name-required`, `event-name-required`, `consumer-not-active-*`, `event-not-active`, `active-event-required`), tab lifecycle (`tab-closed`, `tab-not-visitor-tab`, `monthly-tab-month-mismatch`, `month-format-invalid`), consumption (`quantity-invalid`*, `consumption-quantity-invalid`, `consumption-already-cancelled`, `consumption-not-reassignable`, `consumption-item-mismatch`, `reassign-target-tab-invalid`, `consumption-frozen-in-statement`, `consumption-tab-closed`, `consumption-covered-by-payment`), stock (`item-stock-not-tracked`, `stock-movement-quantity-invalid`, `stock-entry-quantity-invalid`, `stock-quantity-overflow`, `stock-movement-mismatch`, `consumption-stock-movement-missing`), money/payments (`money-amount-invalid`, `money-amount-not-positive`, `money-total-overflow`, `money-product-overflow`, `payment-exceeds-balance`, `monthly-tab-payment-not-allowed`), `timestamp-invalid` |
| 409 | `monthly-closing-already-exists` |
| 500 | `stored-data-malformed`, `stored-data-unsupported-version`, `stored-data-invalid`, `database-mutation-invalid` |
| 401/400/404/500 (non-`BarErrorCode`) | `unauthorized`, `invalid-pin`, `bad-request`, `unknown-method`, `not-found`, `internal-error` |

\* unreachable through `BarRepository` — see the "verified, not assumed" section above.

## Manual verification transcript (real bundle, `curl`)

Built with `npm run build && npm run build:server`, then launched **from `/tmp`** (deliberately
not the checkout root, to prove the `defaultStaticDir` fix):

```
$ cd /tmp
$ BAR_DB_PATH=<temp>/bar.sqlite3 BAR_PIN_HASH=scrypt$23bdafb9...78758c8 \
  BAR_SESSION_SECRET=a78219d5... TZ=America/Sao_Paulo BAR_PORT=8791 \
  node <repo>/server/dist/server.mjs &
motoclub bar server listening on http://127.0.0.1:8791

$ curl -sS http://127.0.0.1:8791/ | head -c 300
<!doctype html> ... <title>Motoclub · Entrar</title> ...   # login page, unauthenticated

$ curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8791/api/snapshot
401

$ curl -sS -X POST http://127.0.0.1:8791/api/session -H 'Content-Type: application/json' -d '{"pin":"0000"}' -w "\nHTTP %{http_code}\n"
{"ok":false,"error":{"code":"invalid-pin"}}
HTTP 401

$ curl -sS -c cookies.txt -X POST http://127.0.0.1:8791/api/session -H 'Content-Type: application/json' -d '{"pin":"4242"}' -w "\nHTTP %{http_code}\n"
{"ok":true}
HTTP 200

$ curl -sS -b cookies.txt http://127.0.0.1:8791/    # matches <repo>/dist/index.html exactly
<!doctype html> ... <title>Motoclub</title> <script ... src="/assets/index-Z3GPXhWe.js"> ...

$ curl -sS -D - -o /dev/null http://127.0.0.1:8791/assets/index-Z3GPXhWe.js
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: public, max-age=31536000, immutable

$ curl -sS -b cookies.txt -D - -o /dev/null http://127.0.0.1:8791/pagamentos
HTTP/1.1 200 OK
Cache-Control: no-store

$ curl -sS -b cookies.txt -w "\nHTTP %{http_code}\n" http://127.0.0.1:8791/api/nope
{"ok":false,"error":{"code":"not-found"}}
HTTP 404

# real mutation
$ curl -sS -b cookies.txt -X POST http://127.0.0.1:8791/api/rpc -H 'Content-Type: application/json' \
  -d '{"method":"createVisitor","args":[{"name":"Visitante Manual T2"}]}'
{"ok":true,"result":{"id":"34a0f490-...","name":"Visitante Manual T2","kind":"visitor","active":true}}

# ... selectOrCreateActiveEvent, ensureEventTab, createConsumption(item-agua, qty 1, 400 cents) ...

# refused: paying more than is owed
$ curl -sS -b cookies.txt -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8791/api/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"recordPayment","args":[{"target":"tab","targetId":"<tab>","amountCents":999999,"actorId":"manual-t2"}]}'
{"ok":false,"error":{"code":"payment-exceeds-balance"}}
HTTP 422

# allowlist
$ curl -sS -b cookies.txt -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8791/api/rpc \
  -d '{"method":"deleteEverything","args":[]}'
{"ok":false,"error":{"code":"unknown-method"}}
HTTP 400
$ curl -sS -b cookies.txt -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8791/api/rpc \
  -d '{"method":"constructor","args":[]}'
{"ok":false,"error":{"code":"unknown-method"}}
HTTP 400

# path traversal — never leaks file content from outside the static root
$ curl -sS --path-as-is -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8791/assets/../secret.txt"
(plain 404 page)
HTTP 404

# logout
$ curl -sS -b cookies.txt -c cookies.txt -D - -o /dev/null http://127.0.0.1:8791/logout
HTTP/1.1 302 Found
Set-Cookie: motoclub_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
Location: /
$ curl -sS -w "\nHTTP %{http_code}\n" http://127.0.0.1:8791/api/snapshot   # cookie now cleared
{"ok":false,"error":{"code":"unauthorized"}}
HTTP 401

# real SIGTERM restart, same DB file, same port
$ kill -TERM <pid>
Received SIGTERM, shutting down       # logged, process exits cleanly

$ BAR_DB_PATH=<same file> ... node <repo>/server/dist/server.mjs &
motoclub bar server listening on http://127.0.0.1:8791
$ curl -sS -b <fresh cookie> http://127.0.0.1:8791/api/snapshot   # after fresh login
found: {"id":"34a0f490-...","name":"Visitante Manual T2", ...}                # survived
consumption survived: {"id":"594b91a1-...","itemId":"item-agua", ...}         # survived
```

(Full `pin`/salt/hash values and the intermediate tab-id plumbing are in the transcript run
above this report; omitted here only for length, not redacted for any other reason.)

## Verification — real output

**`npm run test:server`**:
```
 ✓ server/storage/schema.test.ts (1 test)
 ✓ server/config.test.ts (22 tests)
 ✓ server/http/static.test.ts (15 tests)
 ✓ server/http/rpc.test.ts (18 tests)
 ✓ server/http/session.test.ts (18 tests)
 ✓ server/storage/sqlite-storage.test.ts (6 tests)
 ✓ server/main.test.ts (7 tests)
 ✓ server/http/router.test.ts (25 tests)

 Test Files  8 passed (8)
      Tests  112 passed (112)
```
(was 25 at the start of this task; +87 new, all TDD)

**`npm run test:run`** (floor 546, must be unchanged — no `src/` touched):
```
 Test Files  66 passed (66)
      Tests  546 passed (546)
```

**`npm run lint`**: exit 0, no output.

**`npm run build`**:
```
✓ 1812 modules transformed.
dist/index.html                   0.45 kB
dist/assets/index-BDEGQBTn.css   17.27 kB
dist/assets/index-Z3GPXhWe.js   384.99 kB
✓ built in ~4s
> tsc -p server/tsconfig.json   (clean)
```

**`npm run build:server`**:
```
server/dist/server.mjs  69.2kb
⚡ Done in 21ms
```

**`npm run e2e`** (floor 9, unchanged — no `e2e/`/`playwright.config.ts` touched):
```
Running 9 tests using 6 workers
  9 passed (~20s)
```

## Concerns for the next task (client swap)

1. `/api/rpc` and `/api/snapshot` both require the session cookie now (401 without it). The
   client adapter (`HttpBarRepository`, per the plan) must send `credentials: 'same-origin'`
   on every call and treat a 401 as "reload to the login page" — exactly what the plan already
   specifies for `HttpBarRepository`'s `location.reload()` on 401. No new work implied, just
   confirming the contract this task actually shipped matches what that task will need.
2. `RPC_METHOD_NAMES`'s compile-time exhaustiveness check means adding a 25th port method to
   `BarRepository` (unlikely from the client-swap task's own scope, but worth knowing) fails
   `tsc -p server/tsconfig.json` until `RPC_METHOD_NAMES` is updated — this is `server/`'s own
   build, not the client's, so it will not silently block `npm run build` for the app itself,
   but `npm run build` does call `typecheck:server` at the end (see `package.json`), so it would
   surface there.
3. `defaultStaticDir()`'s bundling-depth assumption (documented at length in `main.ts` and this
   report) has no automated test proving the *bundled* case works — only the pure arithmetic
   (`resolveDistDirFromBundleDir`) is unit tested, and the bundled case is proven only by the
   manual transcript above (server launched from `/tmp`, correctly serving `<repo>/dist`). This
   mirrors exactly the same category of gap the previous task's `readSchemaSql` had, now fixed
   for the schema but structurally still present (safely, since it is only reachable through the
   `isEntryPoint()`-guarded `main()`) for `defaultStaticDir`. Flagging it now so it is a known,
   accepted trade-off rather than a surprise if it is rediscovered later.

## Report path

`.superpowers/sdd/prototipo-bar-ui/backend-t2-report.md` (this file).
