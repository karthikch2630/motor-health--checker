import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDist, checkEnv, classifyKey, parseEnvFile, scanText } from './predeploy-check.mjs'

// All keys below are FABRICATED test strings, not real credentials.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, ref: 'fakeprojectref' })}.${'x'.repeat(20)}`
const levels = (rs) => rs.map((r) => r.level)
const GOOD_URL = 'https://abcdefghijklmnop.supabase.co'

describe('classifyKey', () => {
  it('recognises public and secret key shapes', () => {
    expect(classifyKey('sb_publishable_' + 'a'.repeat(24)).kind).toBe('publishable')
    expect(classifyKey('sb_secret_' + 'a'.repeat(24)).kind).toBe('secret')
    expect(classifyKey(jwt('anon')).kind).toBe('legacy-anon')
    expect(classifyKey(jwt('service_role')).kind).toBe('service-role')
    expect(classifyKey(jwt('authenticated')).kind).toBe('jwt-other-role')
    expect(classifyKey('something-else').kind).toBe('unknown')
    expect(classifyKey('').kind).toBe('missing')
  })
})

describe('checkEnv', () => {
  it('passes with a hosted URL and a publishable or legacy anon key', () => {
    expect(levels(checkEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(24) }))).toEqual(['pass', 'pass'])
    expect(levels(checkEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: jwt('anon') }))).toEqual(['pass', 'pass'])
  })

  it('fails when variables are missing or still placeholders', () => {
    expect(levels(checkEnv({}))).toEqual(['fail', 'fail'])
    expect(levels(checkEnv({ VITE_SUPABASE_URL: 'https://your-project.supabase.co', VITE_SUPABASE_ANON_KEY: 'your-anon-or-publishable-key' }))).toEqual(['fail', 'fail'])
  })

  it('fails for http, local addresses and invalid URLs; warns for other hosts', () => {
    const key = 'sb_publishable_' + 'a'.repeat(24)
    expect(checkEnv({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_ANON_KEY: key })[0].level).toBe('fail')
    expect(checkEnv({ VITE_SUPABASE_URL: 'https://localhost:54321', VITE_SUPABASE_ANON_KEY: key })[0].level).toBe('fail')
    expect(checkEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: key })[0].level).toBe('fail')
    expect(checkEnv({ VITE_SUPABASE_URL: 'https://db.example-corp.net', VITE_SUPABASE_ANON_KEY: key })[0].level).toBe('warn')
  })

  it('FAILS when a service-role or secret key is used, and never echoes it', () => {
    for (const key of [jwt('service_role'), 'sb_secret_' + 'a'.repeat(24)]) {
      const rs = checkEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: key })
      expect(rs[1].level).toBe('fail')
      expect(JSON.stringify(rs)).not.toContain(key)
      expect(rs[1].message).toMatch(/rotate/)
    }
  })

  it('fails on secret-looking VITE_ variable names', () => {
    const rs = checkEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(24), VITE_SERVICE_ROLE_KEY: 'whatever' })
    expect(rs.some((r) => r.level === 'fail' && /VITE_SERVICE_ROLE_KEY/.test(r.message))).toBe(true)
  })

  it('warns for an unrecognised key format rather than guessing', () => {
    expect(checkEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: 'mystery-value-123' })[1].level).toBe('warn')
  })
})

describe('parseEnvFile', () => {
  it('parses KEY=value lines, comments and quotes', () => {
    expect(parseEnvFile('# c\nA=1\nB="two"\n\nC = three \n')).toEqual({ A: '1', B: 'two', C: 'three' })
  })
})

describe('scanText', () => {
  it('flags secret-shaped keys and QA leftovers without returning their values', () => {
    const secret = 'sb_secret_' + 'q'.repeat(24)
    const f = scanText(`x ${secret} y`, 'dist/a.js')
    expect(f).toHaveLength(1)
    expect(f[0]).not.toContain(secret)
    expect(scanText(`k=${jwt('service_role')}`, 'dist/b.js')[0]).toMatch(/service_role/)
    expect(scanText('fetch("http://localhost:54321")', 'dist/c.js')[0]).toMatch(/QA backend/)
  })

  it('does NOT flag the bare prefix that the Supabase client library contains, or an anon key', () => {
    expect(scanText('if(key.startsWith("sb_secret_")) throw new Error()', 'dist/lib.js')).toEqual([])
    expect(scanText(`const k="${jwt('anon')}"`, 'dist/ok.js')).toEqual([])
  })
})

describe('checkDist', () => {
  function build(files) {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'))
    mkdirSync(join(dir, 'assets'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return dir
  }
  const env = { VITE_SUPABASE_URL: GOOD_URL }

  it('passes a clean build that embeds the configured host and ships headers', () => {
    const dir = build({ 'index.html': '<html></html>', '_headers': '/*', 'assets/app.js': `createClient("${GOOD_URL}")` })
    expect(checkDist(dir, env).every((r) => r.level === 'pass')).toBe(true)
    rmSync(dir, { recursive: true })
  })

  it('fails when the build lacks the configured host (built without the production variables)', () => {
    const dir = build({ 'index.html': '', 'assets/app.js': 'nothing here' })
    expect(checkDist(dir, env).some((r) => r.level === 'fail' && /does NOT contain/.test(r.message))).toBe(true)
    rmSync(dir, { recursive: true })
  })

  it('fails when the build contains a secret-shaped key or QA settings', () => {
    const dir = build({ 'index.html': '', 'assets/app.js': `${GOOD_URL} sb_secret_${'z'.repeat(24)} localhost:54321` })
    const fails = checkDist(dir, env).filter((r) => r.level === 'fail')
    expect(fails.length).toBeGreaterThanOrEqual(2)
    rmSync(dir, { recursive: true })
  })

  it('fails clearly when there is no build', () => {
    expect(checkDist(join(tmpdir(), 'no-such-dist-dir'), env)[0].message).toMatch(/npm run build/)
  })
})
