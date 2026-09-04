import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  contentTypeFor,
  hasDottedLastSegment,
  isApiPath,
  isAssetPath,
  LOGIN_HTML,
  resolveStaticAssetPath,
} from './static'

describe('isAssetPath', () => {
  it('matches anything under /assets/', () => {
    expect(isAssetPath('/assets/index-abc123.js')).toBe(true)
    expect(isAssetPath('/assets/sub/dir/file.css')).toBe(true)
  })

  it('does not match /assets itself (no trailing content) or unrelated paths', () => {
    expect(isAssetPath('/assets')).toBe(false)
    expect(isAssetPath('/assets/')).toBe(false)
    expect(isAssetPath('/api/rpc')).toBe(false)
    expect(isAssetPath('/lancamentos')).toBe(false)
  })
})

describe('isApiPath', () => {
  it('matches /api and everything under it', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/rpc')).toBe(true)
    expect(isApiPath('/api/snapshot')).toBe(true)
  })

  it('does not match unrelated paths', () => {
    expect(isApiPath('/lancamentos')).toBe(false)
    expect(isApiPath('/apix')).toBe(false)
  })
})

describe('hasDottedLastSegment', () => {
  it('is true when the final path segment contains a dot', () => {
    expect(hasDottedLastSegment('/favicon.ico')).toBe(true)
    expect(hasDottedLastSegment('/assets/index.js')).toBe(true)
  })

  it('is false for a bare SPA route', () => {
    expect(hasDottedLastSegment('/lancamentos')).toBe(false)
    expect(hasDottedLastSegment('/')).toBe(false)
    expect(hasDottedLastSegment('/comandas')).toBe(false)
  })

  it('looks only at the last segment, not earlier ones', () => {
    expect(hasDottedLastSegment('/foo.bar/baz')).toBe(false)
  })
})

describe('contentTypeFor', () => {
  it('maps common extensions', () => {
    expect(contentTypeFor('index.html')).toMatch(/text\/html/)
    expect(contentTypeFor('app.js')).toMatch(/javascript/)
    expect(contentTypeFor('style.css')).toMatch(/text\/css/)
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('photo.png')).toBe('image/png')
  })

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('IMAGE.PNG')).toBe('image/png')
  })

  it('falls back to application/octet-stream for an unknown extension', () => {
    expect(contentTypeFor('file.unknownext')).toBe('application/octet-stream')
  })
})

describe('resolveStaticAssetPath', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves a normal path inside the root', () => {
    root = mkdtempSync(join(tmpdir(), 'static-test-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')

    const resolved = resolveStaticAssetPath(root, '/assets/app.js')
    expect(resolved).toBe(join(root, 'assets', 'app.js'))
  })

  it('rejects a traversal attempt that would escape the root', () => {
    root = mkdtempSync(join(tmpdir(), 'static-test-'))
    const resolved = resolveStaticAssetPath(root, '/assets/../../../../etc/passwd')
    expect(resolved).toBeUndefined()
  })

  it('rejects an encoded-looking traversal with repeated ../ segments', () => {
    root = mkdtempSync(join(tmpdir(), 'static-test-'))
    const resolved = resolveStaticAssetPath(root, '/assets/../../secret.txt')
    expect(resolved).toBeUndefined()
  })

  it('rejects a sibling-directory collision (root prefix but not inside it)', () => {
    root = mkdtempSync(join(tmpdir(), 'static-test-'))
    // e.g. root = /tmp/x/dist, an attempted path of /tmp/x/dist-evil/secret
    // must not pass a naive startsWith(root) check.
    const resolved = resolveStaticAssetPath(root, '/../' + root.split('/').pop() + '-evil/secret')
    expect(resolved).toBeUndefined()
  })
})

describe('LOGIN_HTML', () => {
  it('is a one-form page styled with the dark shell palette', () => {
    expect(LOGIN_HTML).toContain('<form')
    expect(LOGIN_HTML).toContain('#101114')
    expect(LOGIN_HTML).toContain('#E0203A')
    expect(LOGIN_HTML).toContain('#F5F6F7')
  })
})
