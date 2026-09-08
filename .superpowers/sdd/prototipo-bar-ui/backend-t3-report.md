# Backend Task 3 — swap the client onto the HTTP server (report)

Worktree: `/home/jp-beltran/Desktop/Motoclub/.claude/worktrees/agent-afa2182b9f8e75493`
Branch: `worktree-agent-afa2182b9f8e75493`
Base: `44b50b5` (verified with `git log --oneline -3`; HEAD was at `74aa0f3`, five commits
ahead on an unrelated line of work, so `git reset --hard 44b50b5` was applied before any
change below — no commit of mine sits underneath this task's own commits)

## What was built

```
src/features/bar/infrastructure/http-bar-repository.ts   new — the HTTP adapter
src/App.tsx                                               one import + one instantiation
src/App.test.tsx                                          fetch stub over an in-process repo
e2e/test-utils.ts                                          API login + resetDemo, no more addInitScript
e2e/app.spec.ts                                            +2 lines — see "Spec body changed" below
playwright.config.ts                                       workers:1, real server, per-run temp DB
vite.config.ts                                              /api proxy — see "Fix round" below
```

Nothing under `server/`, `scripts/`, or `deploy/` was touched (verified with
`git diff --stat 44b50b5 -- server/ scripts/ deploy/`, empty). `create-browser-repository.ts`
is untouched and unreferenced (`grep -rn createBrowserBarRepository src` finds only its own
definition) — the escape hatch stays in the tree as the plan asks.

**Fix round, after the initial report**: the coordinator caught that `npm run dev` broke —
see the "Fix round" section near the end of this report for the gap, the fix
(`vite.config.ts`'s new `/api` proxy), the two-terminal dev workflow, and the manual
verification evidence.

## The adapter's shape

`HttpBarRepository` (`src/features/bar/infrastructure/http-bar-repository.ts`) has exactly one
private method that talks to the network:

```ts
private async call<Result>(method: string, args: readonly unknown[] = []): Promise<Result>
```

It does `fetch('/api/rpc', { method: 'POST', credentials: 'same-origin', headers, body:
JSON.stringify({ method, args }) })` — a relative path, no base-URL seam, no `import.meta.env`/
`VITE_*` variable, per the task's explicit instruction (same origin as the API, so a relative
path is simply correct; a seam here would be an unused knob whose default silently works in
`vite dev` and silently breaks once actually deployed).

Every one of the 24 `BarRepository` port methods is a one-line delegation naming its own RPC
method and forwarding `args` as the array the wire contract expects:

```ts
async getSnapshot(): Promise<BarDatabase> { return this.call('getSnapshot') }
async createVisitor(input: CreateVisitorInput): Promise<Consumer> {
  return this.call('createVisitor', [input])
}
async closeVisitorTab(tabId: string): Promise<EventTab> {
  return this.call('closeVisitorTab', [tabId])
}
```

`closeVisitorTab`/`reopenVisitorTab` are the two methods that take a bare string instead of an
input object — matching `RPC_METHOD_NAMES`' own source of truth (`server/http/rpc.ts`), which
this file does not import from (the two lists only need to describe the same 24-method port;
duplicating the list here rather than importing it from `server/` is what keeps this task's
`src/` change from reaching into `server/`, which the task's boundaries forbid touching).
`BarRepository implements` on the class means a 25th port method (or a signature change) fails
`tsc` at the class declaration, the same class of guard the RPC allowlist itself uses.

## How a `BarError` survives the wire

On `{ ok: false, error: { code } }`, `call` does exactly this:

```ts
if (!body.ok) {
  throw new BarError(body.error.code as BarErrorCode, `Server refused ${method}: ${body.error.code}`)
}
```

`BarError` is imported from `../domain/errors` — the *same* class the in-process
`LocalBarRepository` throws, not a lookalike. Since `describeBarError` (`application/
error-messages.ts`) only ever checks `isBarError(error)` (i.e. `error instanceof BarError`) and
then indexes `BAR_ERROR_MESSAGES[error.code]`, an `HttpBarRepository` rejection is
indistinguishable from a `LocalBarRepository` rejection to every consumer downstream — no UI
component, hook, or test needed to change to keep working.

**Evidence, not assertion**: `src/App.test.tsx` is the one existing test in the whole suite that
exercises `HttpBarRepository` for real (the other 545 unit/component tests never touched `fetch`
and did not need to). It renders `<App />` through the real `HttpBarRepository` → `fetch` →
(stubbed) `/api/rpc` → in-process `LocalBarRepository` round trip, and the assertions are
**byte-for-byte the same assertions the old test made** — same heading, same month label, same
nav link count, same active-event text, same actor name. `git diff 44b50b5 -- src/App.test.tsx`
shows the `it(...)` block's body is unchanged; only the `beforeEach`/`afterEach` scaffolding
around it (the `fetch` stub and the in-process repository it dispatches into) is new. Running
it:

```
$ npx vitest run src/App.test.tsx
 ✓ src/App.test.tsx (1 test) 268ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

This is the "existing UI refusal test still passes unchanged" proof the task asked for, applied
to the one test in the suite that actually goes through the wire — every other refusal-asserting
test (in `PagamentosView.test.tsx`, `ComandasView.test.tsx`, etc.) talks to a repository stub or
`LocalBarRepository` directly and was never touched, exactly as required (`npm run test:run`
stayed at 546/546 — see below — none of those files changed).

## Network failure / malformed response

A `fetch` rejection (network down) or a body that is not JSON (`response.json()` throwing) or
JSON that is not the `{ ok, ... }` envelope all throw `HttpBarRepositoryError`, a plain `Error`
subclass **deliberately not** a `BarError` — the server never told this adapter a
`BarErrorCode`, so inventing one would defeat the taxonomy's own point (a code is a promise about
what the *server* decided, not a guess the client backfilled). `describeBarError`'s only branch
is `isBarError(error) ? BAR_ERROR_MESSAGES[error.code] : fallback` — anything that is not a
`BarError`, `HttpBarRepositoryError` included, degrades to the caller-supplied pt-BR fallback
sentence (e.g. `BAR_ERROR_FALLBACKS.payment`, `.resetDemo`, or the generic `.operation`), never a
raw stack trace. No change to `error-messages.ts` was needed or made to get this — the fallback
path already existed for exactly this "unrecognised failure" case.

On a 401 (no/expired session cookie), the three lines the plan specifies:

```ts
if (response.status === 401) {
  window.location.reload()
  return new Promise<Result>(() => {})
}
```

`window.location.reload()` starts a real navigation to the server-rendered login page (the PIN
gate is entirely server-side per Backend Task 2); the never-resolving promise means no caller
downstream ever sees a value or a rejection while that navigation is in flight — nothing to
handle, no UI of its own, matching "no UI" in the task.

## The e2e changes

**`playwright.config.ts`**: `fullyParallel: false`, `workers: 1` (was `fullyParallel: true`,
default worker count). `webServer.command` is now `npm run build && npm run build:server && node
server/dist/server.mjs` — the real bundle, not `vite preview` — with `env` supplying a per-run
temp `BAR_DB_PATH` (`mkdtempSync` under the OS temp dir), a freshly generated `BAR_PIN_HASH`
(`scrypt$<salt>$<hash>`, computed inline with `scryptSync` — deliberately reimplemented rather
than importing `server/http/session.ts#hashPin`, so this config's own TS project,
`tsconfig.node.json`, never needs to resolve `server/`'s module graph just to boot the test
server) and a random `BAR_SESSION_SECRET`, `BAR_PORT`/`BAR_HOST` matching `baseURL`, and
`TZ=America/Sao_Paulo`. Health-check URL is `/healthz` (200 "ok", cheaper than round-tripping the
DB via `/`). `timeout: 180_000` — building `dist/` and the server bundle from scratch is slower
than `vite preview` ever needed to be.

**`e2e/test-utils.ts`**: `resetDemoDatabase(page)` keeps its exact signature and call sites but
now does `POST /api/session` (with a new `E2E_PIN` constant, `'246810'`, matching the hash
`playwright.config.ts` boots the server with) then `POST /api/rpc { method: 'resetDemo', args:
[] }`, both through `page.request` — Playwright's `APIRequestContext` tied to the page's own
`BrowserContext`, which shares cookie storage with the page's real navigations, so the session
cookie lands in the browser before the test's first `page.goto`. The old `addInitScript` +
`sessionStorage` once-per-test guard is gone entirely: that guard existed only because
`addInitScript` re-runs on every navigation within a test and a bare `removeItem` would have
wiped a test's own later mutations; an explicit function call has no such re-run problem, so
nothing needs to guard it. `DEMO_DATABASE_KEY` (the `localStorage` key) and the guard flag are
removed — there is no `localStorage` to reset any more. `CURRENT_MONTH_LABEL`, `ACTIVE_EVENT_NAME`,
and `cardMatching` are byte-for-byte unchanged.

### Spec body changed: `e2e/app.spec.ts` (a finding, not a quiet patch)

Six of the seven spec files already called `resetDemoDatabase(page)` as the first line of every
test, so changing what that function does under the hood was enough — their bodies did not
change. **`e2e/app.spec.ts` was the exception**: neither of its two tests ever called
`resetDemoDatabase`. That was fine under the old model — a fresh browser context got a fresh
`localStorage`, and `LocalBarRepository` auto-seeds the demo database the first time anything
reads an empty store, so "do nothing, get the seed" was a correct (if implicit) strategy.

Under the new model that assumption breaks for two independent reasons, either one fatal on its
own:

1. **No login, no app.** `/` now serves the server-rendered `login.html`, not `index.html`,
   without a valid session cookie. A test that never calls `resetDemoDatabase` (the only place
   that logs in) never gets past the PIN gate at all — `page.getByRole('heading', { name:
   'Painel' })` would simply never appear.
2. **The database is shared and durable**, not per-context. Even with a valid cookie, `/` would
   render whatever the previous spec's mutations left behind, not a guaranteed-fresh seed.

I added `await resetDemoDatabase(page)` as the first line of both tests in `app.spec.ts` (2
lines total) rather than inventing a global-authentication mechanism (a Playwright `storageState`
setup project) to route around touching this file: the task's own description of the fix (`POST
/api/session` then `POST /api/rpc`, "one helper") already names the exact fix this file needed,
so adding it here is applying that same helper somewhere it had never been wired up, not a
second, parallel mechanism. Verified the two tests still pass with no other change to their
bodies (`git diff 44b50b5 -- e2e/app.spec.ts` shows only the two added lines) — reported here per
the task's explicit instruction rather than silently folded into "the seven spec bodies didn't
change."

## Three-run flakiness result

```
$ npm run e2e        # run 1
Running 9 tests using 1 worker
  9 passed (33.6s)

$ npm run e2e        # run 2
Running 9 tests using 1 worker
  9 passed (32.5s)

$ npm run e2e        # run 3
Running 9 tests using 1 worker
  9 passed (33.0s)
```

Each run rebuilt `dist/` and `server/dist/server.mjs` and relaunched the real Node server from
scratch (visible in each run's `[WebServer]` log lines — esbuild's own "Done in Nms" printed
fresh every time, i.e. `reuseExistingServer` never actually reused a leftover process across
these three invocations), so each of the three runs is an independent instantiation: a fresh
temp SQLite file, a fresh PIN hash/session secret, and all 7 spec files run in the same
process against that one shared database, sequentially, in the same file order each time
(`app` → `inventory` → `member-consumption` → `monthly-closing` → `partial-payment` →
`responsive-smoke` → `visitor-tab`). 27/27 individual test executions across the three runs
passed; zero retries, zero flakes.

## Verification — real output

**`npm run test:run`** (floor 546, must stay 546 — one test changed, none added):
```
 Test Files  66 passed (66)
      Tests  546 passed (546)
```

**`npm run test:server`** (112, untouched — no `server/` file changed):
```
 Test Files  8 passed (8)
      Tests  112 passed (112)
```

**`npm run test:scripts`**:
```
ℹ tests 19
ℹ pass 19
ℹ fail 0
OK: 18 asserções passaram
```

**`npm run lint`**: exit 0, no output.

**`npm run build`**:
```
tsc -b   (clean — this also typechecks the new playwright.config.ts, which now imports
          e2e/test-utils.ts, under tsconfig.node.json)
✓ 1807 modules transformed.
dist/index.html                   0.45 kB
dist/assets/index-BDEGQBTn.css   17.27 kB
dist/assets/index-TsiRpTjJ.js   365.57 kB
✓ built in ~5s
> tsc -p server/tsconfig.json   (clean)
```

**`npm run build:server`**:
```
server/dist/server.mjs  69.2kb
⚡ Done in ~20ms
```

**`npm run e2e`** — see the three-run section above; 9/9 every time.

## Fix round: `npm run dev` was broken by the same swap

The coordinator caught a real gap: none of the four gates above exercise `vite dev`. Unit tests
stub `fetch`; the e2e suite boots the real Node server; a production build is served by that
same server. `HttpBarRepository` calls a relative `/api/rpc`, which is only correct when the SPA
and the API share an origin — true in production and in e2e, false under `vite dev` before this
fix, since Vite answers every path it doesn't recognise with its own `index.html`. The result:
`/api/rpc` came back as HTML, `response.json()` threw, and the operator saw a blank/broken
screen with nothing actionable in it — the exact failure the task's own error-handling
requirement was supposed to prevent, just one layer further out than any test looked.

### The fix — `vite.config.ts`

```ts
const backendPort = Number(process.env.BAR_PORT ?? 8787)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  test: { /* unchanged */ },
})
```

`backendPort` follows `BAR_PORT` per the shared backend contract, defaulting to the same 8787
`server/config.ts` itself defaults to — `npm run dev` and a plain `node server/dist/server.mjs`
agree without either side setting anything, unless an operator explicitly overrides `BAR_PORT`
for both.

`server.host: '127.0.0.1'` is not just "match the backend's own no-network default." Cookies are
scoped by **host, not port** — `POST /api/session`'s cookie (no `Domain` attribute, so it is a
host-only cookie for whatever host issued it) is sent by the browser to *any* port on that same
host string. Logging in once directly against the real server at `http://127.0.0.1:<BAR_PORT>`
and then opening the Vite dev server at `http://127.0.0.1:5173` shares that cookie automatically;
opening the dev server at `http://localhost:5173` instead would **not** — browsers treat
`"localhost"` and `"127.0.0.1"` as different cookie hosts even though both resolve to the same
loopback address. Forcing Vite to print and bind the `127.0.0.1` URL removes that trap instead of
leaving it to be rediscovered the first time someone develops against the real backend.

### The development workflow (now two processes, documented here since there is no single
### `npm run dev` that boots both)

1. Build once: `npm run build:server` (only needed after a change under `server/`; the front end
   itself hot-reloads through Vite and needs no build step).
2. Terminal A — the API, with its three required secrets (see
   `.superpowers/sdd/prototipo-bar-ui/backend-contract.md` for the exact format):
   ```
   BAR_DB_PATH=/tmp/motoclub-dev.sqlite3 \
   BAR_PIN_HASH=scrypt$<salt-hex>$<hash-hex> \
   BAR_SESSION_SECRET=<32-byte hex> \
   TZ=America/Sao_Paulo \
   node server/dist/server.mjs
   ```
3. Terminal B — the SPA, with hot reload: `npm run dev`. It now prints
   `http://127.0.0.1:5173/` (not `localhost`) — open exactly that URL.
4. The first time, authenticate once directly against the API's own login page
   (`http://127.0.0.1:8787/`, PIN gate, same as production) — this is the one manual step: the
   React app has no login screen of its own (the plan's own decision — the gate is entirely
   server-side), so there is nothing in `src/` to click through for this. Once logged in there,
   reload the tab pointed at the Vite dev server (`http://127.0.0.1:5173/`) and it is
   authenticated too, because the cookie is shared by host.

**No `dev:full` / `concurrently`-style combined script was added.** Two reasons, not just the
"prefer two documented terminals over a new dependency" instruction: first, `concurrently` (or
any equivalent) would be a genuinely new dependency in a project the task itself already flags
as having exactly five; second, and more binding, wiring the two processes into one command
would still have to solve the secrets problem above — `BAR_PIN_HASH`/`BAR_SESSION_SECRET` are
required, not optional, and a combined script would need to either generate-and-discard them on
every run (meaning a developer's cookie/session never survives a restart, defeating the "restart
mid-shift doesn't log you out" property the stateless token was built for) or persist them
somewhere (a `.env.development`-shaped file), which is a secrets-management decision this fix
round did not ask for and is not the minimal change the gap needed. Two terminals, documented, is
the smaller and more honest fix.

### The reciprocal comment — one side only, by design

The scrypt hash format (`scrypt$<salt-hex>$<hash-hex>`, 16-byte salt, 64-byte key) is duplicated
in `playwright.config.ts`'s `hashPinForE2e` rather than imported from `server/http/session.ts`'s
`hashPin` (see the original report section above for why: keeping the e2e/client TypeScript
project from resolving `server/`'s module graph). `playwright.config.ts` now carries an explicit
"SHARED CONTRACT, DUPLICATED ON PURPOSE" comment naming `server/http/session.ts#hashPin` and
spelling out exactly what breaks if the two drift (`verifyPin` silently rejecting every PIN this
file hashes). **The matching comment on `hashPin` itself was deliberately not added** —
`server/` is out of this task's boundary while another task is concurrently editing it, `session.ts`
included, and editing it now risked a conflict for no gain over waiting. The coordinator owns
adding that other half.

### Manual verification — real evidence, not "the config exists"

Built the server bundle, launched it as a background process with a throwaway PIN/secret and a
temp SQLite file, launched `npm run dev` on a free port, then drove a real Chromium browser
(Playwright, already a project dependency) through the exact flow described above:

```
STEP 1: backend login page title = "Motoclub · Entrar"
STEP 1: after login, backend URL = http://127.0.0.1:8787/
STEP 2: dashboard heading "Painel" is visible via the dev server
STEP 2: "Consumo do mês" visible = true
STEP 3: visitor created, launch screen now targets the new visitor
STEP 3: consumption recorded via the dev-server-proxied /api/rpc call
STEP 4: visitor tab with the consumption visible on /comandas = true
STEP 5: backend /api/snapshot (direct, not via dev server) contains the new visitor = true
console errors seen: []
page errors seen: []
VERIFICATION OK
```

Step 1 authenticates directly against the real server (not the dev server) to obtain the cookie.
Step 2 is the regression check itself: before this fix, this exact navigation is where the
operator would have seen a broken screen (`/api/rpc` answering with the dev server's own HTML).
Step 3 performs a genuine mutation — registering a visitor and recording a consumption — through
the dev-server-proxied `/api/rpc`, using the same UI flow `e2e/visitor-tab.spec.ts` exercises.
Step 4 confirms the write is visible on a different route through the same proxy. Step 5 is the
independent check that matters most: it queries the real backend's `/api/snapshot` **directly**,
bypassing the dev server and its proxy entirely, and finds the visitor there — proof the mutation
reached the actual SQLite-backed server, not just some client-side or proxy-buffered state. Zero
browser console errors, zero page errors, across the whole flow. A screenshot of step 2 (the
dashboard rendering real numbers — "Consumo do mês R$ 57,00", "Comandas abertas 2" — through the
dev server) was inspected directly and matches the same dashboard the e2e suite and production
render. All temporary processes, the temp database, and the verification script were removed
afterward; nothing from this manual pass is committed.

## Concerns

1. **`app.spec.ts`'s body changed** — documented above as an explicit finding, not folded in
   quietly. The other six spec bodies are byte-for-byte unchanged.
2. **`playwright.config.ts` now duplicates `hashPin`'s algorithm** (scrypt, 16-byte salt,
   64-byte key) instead of importing `server/http/session.ts`. This is a deliberate boundary
   choice (this task must not make the client/e2e build depend on resolving `server/`'s module
   graph under a different `tsconfig`), but it does mean a future change to the hash format in
   `session.ts` would need a matching update here — nothing enforces the two stay in sync beyond
   both following the same documented contract
   (`.superpowers/sdd/prototipo-bar-ui/backend-contract.md`).
   **Follow-up requested by the coordinator, not done here:** `playwright.config.ts` now carries
   a comment naming `server/http/session.ts#hashPin` and the shared contract explicitly, but the
   matching comment on `hashPin` itself is still missing — `server/` was off-limits for this fix
   round (another task is editing it concurrently, `session.ts` included). The coordinator is
   adding that other half.
3. Per Backend Task 2's own carried-forward concern: `defaultStaticDir()`'s bundled-only
   assumption still has no automated test for the bundled case — this task's e2e suite now
   *does* exercise that exact path for real on every run (`node server/dist/server.mjs` serving
   `dist/` to a real browser), which is empirical evidence beyond the manual transcript Backend
   Task 2 recorded, but it is still not a dedicated automated assertion of that one behavior in
   isolation. Not fixed here — out of this task's scope — but worth noting since three green e2e
   runs now provide real repeated evidence for it.

## Report path

`.superpowers/sdd/prototipo-bar-ui/backend-t3-report.md` (this file).
