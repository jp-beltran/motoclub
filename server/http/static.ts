import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

/** `/assets/*` — the Vite bundle, content-hashed, ungated (see the plan's
 * "Estático e SPA" section: gating it would complicate the login page for
 * nothing). Requires *something* after the slash, so `/assets` and
 * `/assets/` themselves fall through to the SPA/404 handling instead. */
export function isAssetPath(pathname: string): boolean {
  return pathname.startsWith('/assets/') && pathname.length > '/assets/'.length
}

/** Everything the JSON API lives under — `/api` itself and any sub-path. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * `BrowserRouter`'s eight routes (`/`, `/lancamentos`, `/comandas`, …) have
 * no dot in their last segment; a real static file request
 * (`/favicon.ico`, `/assets/index.js`) does. Only the *last* segment is
 * checked — `/foo.bar/baz` is still an app route as far as this function
 * is concerned, matching the plan's literal wording ("sem ponto no último
 * segmento").
 */
export function hasDottedLastSegment(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  return lastSegment.includes('.')
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

export function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}

/**
 * Resolves `requestPath` (e.g. `/assets/index-abc123.js`) against
 * `staticDir` and returns the resolved absolute path only if it is still
 * inside `staticDir` — `undefined` otherwise. This is the traversal guard:
 * `path.resolve` collapses every `..` segment first, so the check below
 * sees the *final* destination, not the literal string.
 *
 * The comparison appends `path.sep` to the root before the `startsWith`
 * check (and special-cases exact equality) specifically so a sibling
 * directory that merely shares the root as a string prefix — root
 * `/srv/dist` vs an escape into `/srv/dist-evil` — is not mistaken for
 * "inside" it; a bare `startsWith(root)` would let that through.
 */
export function resolveStaticAssetPath(staticDir: string, requestPath: string): string | undefined {
  const root = resolve(staticDir)
  const relative = requestPath.replace(/^\/+/, '')
  const resolved = resolve(root, relative)
  const rootWithTrailingSep = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(rootWithTrailingSep)) return undefined
  return resolved
}

/**
 * Serves one file from under `staticDir`, guarded by
 * `resolveStaticAssetPath`. Returns `false` (no response written) when the
 * path escapes the root or the file cannot be read — the caller answers a
 * plain 404 in both cases, deliberately not distinguishing "traversal
 * attempt" from "file not found" in the response, so a probe learns
 * nothing either way.
 */
export async function serveStaticAsset(
  res: ServerResponse,
  staticDir: string,
  pathname: string,
): Promise<boolean> {
  const resolved = resolveStaticAssetPath(staticDir, pathname)
  if (!resolved) return false
  let data: Buffer
  try {
    data = await readFile(resolved)
  } catch {
    return false
  }
  res.writeHead(200, {
    'Content-Type': contentTypeFor(resolved),
    // Vite's filenames are content-hashed: a given URL's bytes never
    // change, so caching forever is safe and a cheap win on a slow APU.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  res.end(data)
  return true
}

/**
 * The hand-written, one-form login screen. Lives entirely on the server —
 * not a React component, not a route in `src/` — which is what keeps the
 * client at zero new components and zero new tests (see the plan's "PIN"
 * section). Inline styles matching the dark shell: `#101114` background,
 * `#E0203A` accent, `#F5F6F7` text.
 *
 * Posts the PIN to `POST /api/session` with `fetch`; on success reloads
 * the page so the server now serves `index.html` for the same URL (the
 * gate is a server-side branch, not a client redirect target). On failure
 * — including the throttle delay, which the fetch simply takes longer to
 * resolve — shows the inline error text without a full navigation.
 */
export const LOGIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motoclub · Entrar</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #101114;
    color: #F5F6F7;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  form {
    background: #17181c;
    border: 1px solid #2a2c31;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 320px;
    box-sizing: border-box;
  }
  h1 {
    font-size: 1.1rem;
    margin: 0 0 1.25rem;
    font-weight: 600;
    color: #F5F6F7;
  }
  label {
    display: block;
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
    color: #b7b9bf;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid #34363c;
    background: #101114;
    color: #F5F6F7;
    font-size: 1rem;
    letter-spacing: 0.2em;
  }
  input:focus {
    outline: none;
    border-color: #E0203A;
  }
  button {
    margin-top: 1.25rem;
    width: 100%;
    padding: 0.65rem 0.75rem;
    border-radius: 8px;
    border: none;
    background: #E0203A;
    color: #F5F6F7;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  #error {
    margin-top: 0.9rem;
    color: #E0203A;
    font-size: 0.85rem;
    min-height: 1.1em;
  }
</style>
</head>
<body>
<form id="login-form">
  <h1>Motoclub · Bar</h1>
  <label for="pin">PIN</label>
  <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" autofocus required />
  <button type="submit">Entrar</button>
  <div id="error" role="alert"></div>
</form>
<script>
  var form = document.getElementById('login-form');
  var pinInput = document.getElementById('pin');
  var errorBox = document.getElementById('error');
  var button = form.querySelector('button');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin: pinInput.value }),
    })
      .then(function (response) {
        if (response.ok) {
          window.location.reload();
          return;
        }
        errorBox.textContent = 'PIN incorreto.';
        button.disabled = false;
      })
      .catch(function () {
        errorBox.textContent = 'Não foi possível conectar ao servidor.';
        button.disabled = false;
      });
  });
</script>
</body>
</html>
`

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(html)
}

/**
 * The SPA-fallback response for any of the eight app routes. With a valid
 * session, serves the built `index.html` (`no-store`: it is the shell that
 * decides which JS bundle loads, never cached like the hashed assets
 * under it). Without one, serves the login page instead — same URL, same
 * status, different body; the client never has to know the gate exists.
 */
export async function serveAppShell(
  res: ServerResponse,
  staticDir: string,
  authenticated: boolean,
): Promise<void> {
  if (!authenticated) {
    sendHtml(res, 200, LOGIN_HTML)
    return
  }
  try {
    const html = await readFile(join(staticDir, 'index.html'), 'utf8')
    sendHtml(res, 200, html)
  } catch {
    sendHtml(
      res,
      500,
      '<!doctype html><title>Erro</title><p>index.html não encontrado — rode `npm run build`.</p>',
    )
  }
}

/** Plain-text 404 for anything outside `/api` that matches no route. */
export function sendPlainNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
}
