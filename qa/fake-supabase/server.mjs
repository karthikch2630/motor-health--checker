/**
 * LOCAL QA BACKEND — NOT SUPABASE, NOT FOR PRODUCTION, NOT A SECURITY BOUNDARY.
 *
 * Purpose: let the real browser UI be exercised end to end on a machine with no Supabase project, Docker or CLI.
 *
 * What is real:   PostgreSQL semantics (PGlite) running the actual files in database/migrations — real triggers,
 *                 grants, row-level security, the assessment function. Every request runs as the `anon` or
 *                 `authenticated` role with `auth.uid()` set from the bearer token, exactly like Supabase does.
 * What is faked:  the HTTP layer. A small subset of PostgREST (filters eq/in, select incl. two embeds, order, range,
 *                 counts, insert/upsert/update/delete, one RPC) and of GoTrue (password sign-in, refresh, user,
 *                 sign-out). Tokens are signed with a throw-away secret. Anything this shim accepts or rejects says
 *                 NOTHING about hosted Supabase behaviour.
 *
 * Data is in memory and is lost on restart (or POST /__qa/reset). Two fictitious users exist:
 *   qa-user-a@example.test / qa-password-a      qa-user-b@example.test / qa-password-b
 *
 * Fault injection for error-state testing:  POST /__qa/fail {"status":503,"count":2,"pathIncludes":"test_sessions"}
 */
import { createServer } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const PORT = Number(process.env.QA_PORT ?? 54321)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS = join(ROOT, 'database', 'migrations')
const SECRET = randomBytes(32)

const USERS = [
  { id: '11111111-1111-1111-1111-111111111111', email: 'qa-user-a@example.test', password: 'qa-password-a' },
  { id: '22222222-2222-2222-2222-222222222222', email: 'qa-user-b@example.test', password: 'qa-password-b' },
]

const TABLES = new Set([
  'motors', 'parameter_definitions', 'reference_profiles', 'reference_limits',
  'test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings',
])
/** Embeds supported in `select=`: parent table -> child table -> foreign key column. */
const EMBEDS = { reference_profiles: { reference_limits: 'reference_profile_id' } }
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])

// ------------------------------------------------------------------ database
let db
async function initDb() {
  if (db) await db.close()
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `)
  for (const u of USERS) await db.query('insert into auth.users values ($1,$2)', [u.id, u.email])
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  }
}

// PGlite has a single connection: run one request at a time.
let queue = Promise.resolve()
const serial = (fn) => (queue = queue.then(fn, fn))

// ------------------------------------------------------------------ tokens
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
function signJwt(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
function verifyJwt(token) {
  const [h, p, s] = (token ?? '').split('.')
  if (!h || !p || !s) return null
  const expect = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')
  if (s !== expect) return null
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : null
  } catch { return null }
}
const userOut = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' })
function sessionFor(u) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }
  return {
    access_token: signJwt(claims), token_type: 'bearer', expires_in: 3600, expires_at: claims.exp,
    refresh_token: signJwt({ ...claims, kind: 'refresh', exp: now + 86400 }), user: userOut(u),
  }
}
function claimsOf(req) {
  const auth = req.headers.authorization ?? ''
  const claims = auth.startsWith('Bearer ') ? verifyJwt(auth.slice(7)) : null
  return claims && claims.role === 'authenticated' ? { role: 'authenticated', sub: claims.sub } : { role: 'anon', sub: '' }
}

// ------------------------------------------------------------------ http helpers
class HttpError extends Error {
  constructor(status, body) { super(body.message); this.status = status; this.body = body }
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new HttpError(400, { code: 'QA400', message: `bad identifier ${s}` })
  return s
}
function cors(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] ?? '*')
  res.setHeader('access-control-expose-headers', 'content-range')
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString()
      try { resolve(text ? JSON.parse(text) : undefined) } catch { resolve(undefined) }
    })
  })

// ------------------------------------------------------------------ PostgREST subset
function splitTop(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function selectList(table, select) {
  const items = splitTop(select || '*')
  return items.map((item) => {
    const m = item.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/)
    if (!m) return item === '*' ? 't.*' : `t."${ident(item.trim())}"`
    const [, child, inner] = m
    const fk = EMBEDS[table]?.[child]
    if (!fk) throw new HttpError(400, { code: 'QA400', message: `embed ${child} not supported by the QA shim` })
    const sub =
      inner === 'count'
        ? `select jsonb_build_array(jsonb_build_object('count', count(*))) from public."${child}" x where x."${fk}" = t.id`
        : inner === '*'
          ? `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public."${child}" x where x."${fk}" = t.id`
          : (() => { throw new HttpError(400, { code: 'QA400', message: `embed columns ${inner} not supported` }) })()
    return `(${sub}) as "${child}"`
  }).join(', ')
}

function whereClause(params, args) {
  const parts = []
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue
    const m = value.match(/^(eq|in)\.(.*)$/)
    if (!m) throw new HttpError(400, { code: 'QA400', message: `filter ${key}=${value} not supported by the QA shim` })
    const col = `t."${ident(key)}"`
    if (m[1] === 'eq') {
      args.push(m[2])
      parts.push(`${col}::text = $${args.length}`)
    } else {
      const list = m[2].replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      args.push(list)
      parts.push(`${col}::text = any($${args.length}::text[])`)
    }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : ''
}

function orderClause(params) {
  const o = params.get('order')
  if (!o) return ''
  return ' order by ' + o.split(',').map((x) => {
    const [col, dir] = x.split('.')
    return `t."${ident(col)}" ${dir === 'desc' ? 'desc' : 'asc'}`
  }).join(', ')
}

async function handleRest(req, res, url, body) {
  const { role, sub } = claimsOf(req)
  const route = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\//, ''))
  const params = [...url.searchParams.entries()]
  const search = url.searchParams
  const prefer = req.headers.prefer ?? ''
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json')

  return serial(async () => {
    try {
      const result = await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub])
        await tx.exec(`set local role ${role}`)

        if (route.startsWith('rpc/')) {
          if (route !== 'rpc/save_diagnostic_assessment') throw new HttpError(404, { code: 'PGRST202', message: `function ${route} not found` })
          const b = body ?? {}
          const r = await tx.query(
            'select public.save_diagnostic_assessment($1::uuid,$2::uuid,$3::int,$4::text,$5::text,$6::text,$7::jsonb) as r',
            [b.p_session_id, b.p_profile_id ?? null, b.p_profile_version ?? null, b.p_engine_version, b.p_status, b.p_summary ?? null, JSON.stringify(b.p_findings ?? null)],
          )
          return { status: 200, json: r.rows[0].r }
        }

        if (!TABLES.has(route)) throw new HttpError(404, { code: '42P01', message: `relation ${route} does not exist` })
        const table = route
        const q = `public."${table}"`
        const args = []
        let rows
        let total = null
        let offset = 0

        if (req.method === 'GET') {
          const where = whereClause(params, args)
          const range = (req.headers.range ?? '').match(/^(\d+)-(\d+)$/)
          let limit = ''
          if (range) { offset = Number(range[1]); limit = ` limit ${Number(range[2]) - Number(range[1]) + 1} offset ${offset}` }
          else {
            if (search.get('limit')) limit += ` limit ${Number(search.get('limit'))}`
            if (search.get('offset')) { offset = Number(search.get('offset')); limit += ` offset ${offset}` }
          }
          const sql = `select to_jsonb(q) as j from (select ${selectList(table, search.get('select'))} from ${q} t${where}${orderClause(search)}${limit}) q`
          rows = (await tx.query(sql, args)).rows.map((r) => r.j)
          if (/count=exact/.test(prefer)) {
            const cargs = []
            total = (await tx.query(`select count(*)::int c from ${q} t${whereClause(params, cargs)}`, cargs)).rows[0].c
          }
        } else if (req.method === 'POST') {
          const list = Array.isArray(body) ? body : [body]
          const cols = [...new Set(list.flatMap((o) => Object.keys(o ?? {})))].map(ident)
          if (cols.length === 0) throw new HttpError(400, { code: 'QA400', message: 'empty insert' })
          const colSql = cols.map((c) => `"${c}"`).join(',')
          let conflict = ''
          if (/resolution=merge-duplicates/.test(prefer)) {
            const target = (search.get('on_conflict') ?? '').split(',').map(ident)
            const sets = cols.filter((c) => !target.includes(c)).map((c) => `"${c}" = excluded."${c}"`)
            conflict = ` on conflict (${target.map((c) => `"${c}"`).join(',')}) do ${sets.length ? `update set ${sets.join(',')}` : 'nothing'}`
          }
          rows = (await tx.query(
            `with r as (insert into ${q} (${colSql}) select ${colSql} from jsonb_populate_recordset(null::${q}, $1::jsonb)${conflict} returning *) select to_jsonb(r) as j from r`,
            [JSON.stringify(list)],
          )).rows.map((r) => r.j)
        } else if (req.method === 'PATCH') {
          const cols = Object.keys(body ?? {}).map(ident)
          if (cols.length === 0) throw new HttpError(400, { code: 'QA400', message: 'empty update' })
          args.push(JSON.stringify(body))
          const where = whereClause(params, args)
          rows = (await tx.query(
            `with u as (update ${q} t set ${cols.map((c) => `"${c}" = r."${c}"`).join(',')} from jsonb_populate_record(null::${q}, $1::jsonb) r${where} returning t.*) select to_jsonb(u) as j from u`,
            args,
          )).rows.map((r) => r.j)
        } else if (req.method === 'DELETE') {
          const where = whereClause(params, args)
          rows = (await tx.query(`with d as (delete from ${q} t${where} returning t.*) select to_jsonb(d) as j from d`, args)).rows.map((r) => r.j)
        } else {
          throw new HttpError(405, { code: 'QA405', message: 'method not allowed' })
        }

        if (wantsObject && rows.length !== 1) {
          // Like PostgREST: roll the whole statement back unless exactly one row was affected/returned.
          throw new HttpError(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null })
        }
        const minimal = req.method !== 'GET' && !/return=representation/.test(prefer)
        const contentRange = total === null ? undefined : rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`
        return {
          status: minimal ? 204 : req.method === 'POST' ? 201 : 200,
          json: minimal ? undefined : wantsObject ? rows[0] : rows,
          headers: contentRange ? { 'content-range': contentRange } : {},
        }
      })
      send(res, result.status, result.json, result.headers)
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body)
      const code = e.code ?? 'XX000'
      const status = code === '42501' ? 403 : /^23(505|503)/.test(code) ? 409 : 400
      send(res, status, { code, message: e.message, details: e.detail ?? null, hint: null })
    }
  })
}

// ------------------------------------------------------------------ GoTrue subset
async function handleAuth(req, res, url, body) {
  const path = url.pathname.replace('/auth/v1', '')
  if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
    const u = USERS.find((x) => x.email === body?.email && x.password === body?.password)
    if (!u) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    return send(res, 200, sessionFor(u))
  }
  if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const claims = verifyJwt(body?.refresh_token)
    const u = claims && USERS.find((x) => x.id === claims.sub)
    if (!u) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
    return send(res, 200, sessionFor(u))
  }
  if (path === '/user') {
    const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer /, ''))
    const u = claims && USERS.find((x) => x.id === claims.sub)
    return u ? send(res, 200, userOut(u)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
  }
  if (path === '/logout') return send(res, 204)
  return send(res, 404, { code: 404, msg: `auth route ${path} not supported by the QA shim` })
}

// ------------------------------------------------------------------ fault injection
let fault = null
function injectedFault(url) {
  if (!fault || !url.pathname.startsWith('/rest/v1/')) return false
  if (fault.pathIncludes && !url.pathname.includes(fault.pathIncludes)) return false
  fault.count -= 1
  const f = fault
  if (fault.count <= 0) fault = null
  return f
}

const server = createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req)
  try {
    if (url.pathname === '/__qa/health') return send(res, 200, { ok: true, shim: 'qa-fake-supabase', notSupabase: true })
    if (url.pathname === '/__qa/reset') { await serial(initDb); return send(res, 200, { reset: true }) }
    if (url.pathname === '/__qa/fail') { fault = { status: body?.status ?? 503, count: body?.count ?? 1, pathIncludes: body?.pathIncludes }; return send(res, 200, fault) }
    const f = injectedFault(url)
    if (f) return send(res, f.status, { code: 'QA_INJECTED', message: 'injected failure' })
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url, body)
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, body)
    send(res, 404, { message: 'not found' })
  } catch (e) {
    console.error(e)
    send(res, 500, { code: 'QA500', message: String(e.message ?? e) })
  }
})

await initDb()
server.listen(PORT, () => console.log(`QA fake Supabase (NOT Supabase) listening on http://localhost:${PORT} — in-memory, real migrations 001-${readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort().at(-1)?.slice(0, 3)}`))
