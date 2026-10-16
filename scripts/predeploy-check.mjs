#!/usr/bin/env node
/**
 * Pre-deployment checks that need no network and print NO secret values.
 *
 *   node scripts/predeploy-check.mjs [--env-file <path>] [--dist <dir>]
 *   npm run predeploy:check
 *
 * 1. Environment: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (process environment first, then
 *    --env-file, then .env.production, then .env), the URL looks like a hosted project URL, and the key is a PUBLIC
 *    key (publishable key or legacy anon key). A service-role / secret key is a hard failure.
 * 2. Build output: dist/ exists, embeds the configured project host (so it was built with the right settings),
 *    contains no secret-shaped keys, and contains no leftovers from the local QA backend.
 *
 * It cannot check that the Supabase project exists, that migrations are applied or that sign-ups are disabled.
 * Those need the hosted project (docs/DEPLOYMENT.md).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ------------------------------------------------------------------ pure helpers (unit-tested)

export function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/** Classifies a Supabase API key without ever returning the key itself. */
export function classifyKey(key) {
  if (!key) return { kind: 'missing' }
  if (/^sb_publishable_/.test(key)) return { kind: 'publishable' }
  if (/^sb_secret_/.test(key)) return { kind: 'secret' }
  const payload = decodeJwtPayload(key)
  if (payload && typeof payload.role === 'string') {
    if (payload.role === 'anon') return { kind: 'legacy-anon' }
    if (payload.role === 'service_role') return { kind: 'service-role' }
    return { kind: 'jwt-other-role', role: payload.role }
  }
  return { kind: 'unknown' }
}

const PLACEHOLDER = /your-project|your-anon|your-public|your-|example\.com|changeme|<.*>/i

/** Each result: { level: 'pass' | 'warn' | 'fail', message }. Values are never included in messages. */
export function checkEnv(env) {
  const results = []
  const url = env.VITE_SUPABASE_URL ?? ''
  const key = env.VITE_SUPABASE_ANON_KEY ?? ''

  if (!url) results.push({ level: 'fail', message: 'VITE_SUPABASE_URL is not set.' })
  else if (PLACEHOLDER.test(url)) results.push({ level: 'fail', message: 'VITE_SUPABASE_URL still looks like a placeholder.' })
  else {
    let host = ''
    try {
      const u = new URL(url)
      host = u.hostname
      if (u.protocol !== 'https:') results.push({ level: 'fail', message: 'VITE_SUPABASE_URL must use https:// for a deployment.' })
      else if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) results.push({ level: 'fail', message: 'VITE_SUPABASE_URL points at a local address.' })
      else if (!host.endsWith('.supabase.co')) results.push({ level: 'warn', message: `VITE_SUPABASE_URL host does not end in .supabase.co (custom domain or self-hosted?). Confirm it is intended.` })
      else if (u.pathname !== '/' && u.pathname !== '') results.push({ level: 'warn', message: 'VITE_SUPABASE_URL has a path; it should be just the project URL.' })
      else results.push({ level: 'pass', message: 'VITE_SUPABASE_URL looks like a hosted Supabase project URL.' })
    } catch {
      results.push({ level: 'fail', message: 'VITE_SUPABASE_URL is not a valid URL.' })
    }
  }

  const k = classifyKey(key)
  if (k.kind === 'missing') results.push({ level: 'fail', message: 'VITE_SUPABASE_ANON_KEY is not set.' })
  else if (PLACEHOLDER.test(key)) results.push({ level: 'fail', message: 'VITE_SUPABASE_ANON_KEY still looks like a placeholder.' })
  else if (k.kind === 'secret' || k.kind === 'service-role') {
    results.push({ level: 'fail', message: 'VITE_SUPABASE_ANON_KEY holds a SECRET / service-role key. Browser variables are public. Remove it, rotate that key in Supabase, and use the publishable/anon key.' })
  } else if (k.kind === 'publishable') results.push({ level: 'pass', message: 'API key is a publishable key (public by design).' })
  else if (k.kind === 'legacy-anon') results.push({ level: 'pass', message: 'API key is a legacy anon key (public by design).' })
  else if (k.kind === 'jwt-other-role') results.push({ level: 'fail', message: `API key is a JWT with role "${k.role}", not anon.` })
  else results.push({ level: 'warn', message: 'API key format was not recognised; verify in the Supabase dashboard that it is the public (publishable/anon) key.' })

  for (const name of Object.keys(env)) {
    if (/^VITE_/.test(name) && /(SERVICE|SECRET|PRIVATE|PASSWORD)/i.test(name)) {
      results.push({ level: 'fail', message: `${name} is a VITE_ variable with a secret-looking name; everything with that prefix is shipped to browsers.` })
    }
  }
  return results
}

/** Finds secret-shaped values in text. Returns descriptions only (never the matched text). */
export function scanText(text, label) {
  const findings = []
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) findings.push(`${label}: contains a value shaped like a Supabase secret key (sb_secret_…)`)
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = decodeJwtPayload(m[0])
    if (payload?.role === 'service_role') findings.push(`${label}: contains a JWT with role service_role`)
  }
  if (/qa-local-anon-key|localhost:54321/.test(text)) findings.push(`${label}: contains settings of the local QA backend (qa-local-anon-key / localhost:54321)`)
  return findings
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Checks a build directory. `env` supplies the URL the build is expected to embed. */
export function checkDist(dist, env) {
  const results = []
  if (!existsSync(join(dist, 'index.html'))) {
    return [{ level: 'fail', message: `${dist}/index.html not found. Run "npm run build" first.` }]
  }
  const files = walk(dist).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f))
  let all = ''
  const findings = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    all += text
    findings.push(...scanText(text, f.replace(dist, 'dist')))
  }
  if (findings.length) for (const f of findings) results.push({ level: 'fail', message: f })
  else results.push({ level: 'pass', message: `No secret-shaped keys or QA-backend settings found in ${files.length} build file(s).` })

  try {
    const host = new URL(env.VITE_SUPABASE_URL).hostname
    if (all.includes(host)) results.push({ level: 'pass', message: 'The build embeds the configured Supabase project host.' })
    else results.push({ level: 'fail', message: 'The build does NOT contain the configured Supabase host. It was built without, or with different, VITE_ variables. Rebuild with the production values.' })
  } catch {
    results.push({ level: 'warn', message: 'Could not compare the build with the configured URL (URL missing or invalid).' })
  }
  if (existsSync(join(dist, '_headers'))) results.push({ level: 'pass', message: 'dist/_headers is present (security headers for Cloudflare Pages / Netlify).' })
  else results.push({ level: 'warn', message: 'dist/_headers is missing; security headers will not be applied on hosts that read it.' })
  return results
}

// ------------------------------------------------------------------ CLI

function loadEnv(envFile) {
  const merged = {}
  const files = envFile ? [envFile] : ['.env', '.env.production']
  for (const f of files) if (existsSync(f)) Object.assign(merged, parseEnvFile(readFileSync(f, 'utf8')))
  for (const k of Object.keys(process.env)) if (k.startsWith('VITE_')) merged[k] = process.env[k]
  return { env: merged, files: files.filter((f) => existsSync(f)) }
}

function main(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const { env, files } = loadEnv(arg('--env-file'))
  const dist = arg('--dist') ?? 'dist'

  console.log(`Environment sources: process env${files.length ? ' + ' + files.join(', ') : ' (no .env file found)'}`)
  const results = [...checkEnv(env), ...checkDist(dist, env)]
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }
  for (const r of results) console.log(`${icon[r.level]}  ${r.message}`)
  const fails = results.filter((r) => r.level === 'fail').length
  const warns = results.filter((r) => r.level === 'warn').length
  console.log(`\n${fails === 0 ? 'No blocking problems found' : `${fails} blocking problem(s)`}, ${warns} warning(s). This script cannot see the hosted project; see docs/DEPLOYMENT.md for the remaining checks.`)
  process.exit(fails === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
