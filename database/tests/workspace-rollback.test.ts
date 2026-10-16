/**
 * Static security review of the PROPOSED migration 014 and a rehearsal of database/rollback/014_rollback.sql, on PGlite
 * (migrations 001-013 + 014). Not Supabase. All data is SYNTHETIC.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const OWNER = '11111111-1111-1111-1111-111111111111'
const MEMBER = '2dbf7437-81e6-42f9-bb8a-36762c0d4861'
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

async function build() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Supabase grants new tables and functions to the API roles by default; 014 must revoke what it must.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users values ('${OWNER}'), ('${MEMBER}');
  `)
  const dir = join(root, 'database', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.startsWith('014_')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
  return db
}
const as = async (db: PGlite, uid: string) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated`)
}

describe('security review of 014 (catalog checks, with Supabase-style default grants in place)', () => {
  let db: PGlite
  let functionsBefore: Set<string>
  let fksBefore: string
  const fks = async () => (await db.query<{ conname: string; def: string }>(`select conname, pg_get_constraintdef(oid) def from pg_constraint where contype='f' and connamespace='public'::regnamespace order by conname`)).rows

  beforeAll(async () => {
    db = await build()
    functionsBefore = new Set((await db.query<{ proname: string }>(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map((r) => r.proname))
    fksBefore = JSON.stringify(await fks())
    await db.exec(read('database/migrations/014_add_workspace_members.sql'))
  }, 120_000)

  it('every function 014 adds has an empty search_path; only the three intended ones are SECURITY DEFINER; none is callable by anon/public', async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; anon_x: boolean; auth_x: boolean }>(
      `select proname, prosecdef, proconfig,
              has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.filter((r) => !functionsBefore.has(r.proname))
    expect(rows.map((r) => r.proname).sort()).toEqual(['current_user_can_approve', 'current_workspace_owner', 'enforce_approval_authority', 'log_audit_event'])
    for (const r of rows) {
      expect(String(r.proconfig), r.proname).toMatch(/search_path=""/)
      expect(r.anon_x, `${r.proname} anon`).toBe(false)
    }
    expect(rows.filter((r) => r.prosecdef).map((r) => r.proname).sort()).toEqual(['current_user_can_approve', 'current_workspace_owner', 'log_audit_event'])
    // Only the two helper functions policies/triggers evaluate as the caller are executable by API users.
    expect(rows.filter((r) => r.auth_x).map((r) => r.proname).sort()).toEqual(['current_user_can_approve', 'current_workspace_owner'])
  })

  it('new tables: RLS on; workspace_members unreachable; audit_events select-only; no anon access to anything new', async () => {
    const priv = async (table: string, role: string) =>
      Object.fromEntries(await Promise.all(['select', 'insert', 'update', 'delete'].map(async (p) => [p, (await db.query<{ x: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${p}') x`)).rows[0].x])))
    expect((await db.query<{ n: number }>(`select count(*)::int n from pg_class where relname in ('workspace_members','audit_events') and relrowsecurity`)).rows[0].n).toBe(2)
    for (const role of ['anon', 'authenticated']) expect(await priv('workspace_members', role)).toEqual({ select: false, insert: false, update: false, delete: false })
    expect(await priv('audit_events', 'authenticated')).toEqual({ select: true, insert: false, update: false, delete: false })
    expect(await priv('audit_events', 'anon')).toEqual({ select: false, insert: false, update: false, delete: false })
  })

  it('every private-table policy and every owner_id default now go through current_workspace_owner(), none through bare auth.uid()', async () => {
    const pol = (await db.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
      `select tablename, policyname, qual, with_check from pg_policies where schemaname='public' and tablename <> 'parameter_definitions'`)).rows
    expect(pol.length).toBe(10) // 9 private-table policies (5 tables + 2 + 2) + audit_events
    for (const p of pol) expect(`${p.qual} ${p.with_check}`, p.policyname).toMatch(/current_workspace_owner/)
    for (const p of pol) expect(`${p.qual} ${p.with_check}`, p.policyname).not.toMatch(/auth\.uid/)
    const defaults = (await db.query<{ table_name: string; column_default: string }>(
      `select table_name, column_default from information_schema.columns where table_schema='public' and column_name='owner_id' and table_name not in ('audit_events','workspace_members')`)).rows
    expect(defaults).toHaveLength(7)
    for (const d of defaults) expect(d.column_default, d.table_name).toMatch(/current_workspace_owner/)
  })

  it('database/verify/workspace_sharing_check.sql is read-only and runs on the migrated schema', async () => {
    const sql = read('database/verify/workspace_sharing_check.sql')
    const statements = sql.split(/;\s*$/m).map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean)
    expect(statements).toHaveLength(9)
    for (const st of statements) expect(st.toLowerCase().startsWith('select')).toBe(true)
    const lowered = statements.join(' ').toLowerCase()
    for (const word of ['insert ', 'update ', 'delete ', 'truncate ', 'alter ', 'drop ', 'create ', 'grant ']) expect(lowered.includes(word), word).toBe(false)
    for (const st of statements) await db.query(st)
    const bare = (await db.query<{ bare_auth_uid: boolean }>(statements[5])).rows
    expect(bare.length).toBe(17)
    expect(bare.every((r) => r.bare_auth_uid === false)).toBe(true)
  })

  it('foreign keys are unchanged: every child still references (id, owner_id) of its parent', async () => {
    const after = (await fks()).filter((f) => !/workspace_members/.test(f.conname))
    expect(JSON.stringify(after)).toBe(fksBefore)
  })
})

describe('rollback rehearsal (014 applied, a member worked, then 014_rollback.sql)', () => {
  it('restores owner-only behaviour, keeps every row and the audit trail, and removes member access', async () => {
    const db = await build()
    await as(db, OWNER)
    const motor = (await db.query<{ id: string }>(`insert into motors (motor_tag,name,motor_type) values ('MTR-A','m','induction') returning id`)).rows[0].id
    await db.exec('reset role')
    await db.exec(read('database/migrations/014_add_workspace_members.sql'))
    await db.exec(read('database/authorize_workspace_member.sql').replace('PUT-OWNER-AUTH-USER-UUID-HERE', OWNER).replace('PUT-MEMBER-AUTH-USER-UUID-HERE', MEMBER))
    await as(db, MEMBER)
    const memberMotor = (await db.query<{ id: string; owner_id: string }>(`insert into motors (motor_tag,name,motor_type) values ('MTR-B','m','induction') returning id, owner_id`)).rows[0]
    expect(memberMotor.owner_id).toBe(OWNER)
    await db.exec('reset role')
    const auditBefore = (await db.query<{ n: number }>(`select count(*)::int n from audit_events`)).rows[0].n
    expect(auditBefore).toBeGreaterThan(0)

    await db.exec(read('database/rollback/014_rollback.sql'))

    // Owner: unchanged access, both motors (including the one the member created) with the same ids.
    await as(db, OWNER)
    expect((await db.query<{ id: string }>(`select id from motors order by motor_tag`)).rows.map((r) => r.id)).toEqual([motor, memberMotor.id])
    await db.query(`insert into motors (motor_tag,name,motor_type) values ('MTR-C','m','induction')`) // default auth.uid() works again
    expect((await db.query<{ owner_id: string }>(`select owner_id from motors where motor_tag='MTR-C'`)).rows[0].owner_id).toBe(OWNER)
    expect((await db.query<{ n: number }>(`select count(*)::int n from audit_events`)).rows[0].n).toBe(auditBefore) // trail kept (owner reads it via auth.uid())
    // Member: no access any more.
    await as(db, MEMBER)
    expect((await db.query(`select * from motors`)).rows).toHaveLength(0)
    await expect(db.query(`insert into motors (owner_id,motor_tag,name,motor_type) values ('${OWNER}','EVIL','x','induction')`)).rejects.toThrow(/row-level security/)
    expect((await db.query<{ n: number }>(`select count(*)::int n from audit_events`)).rows[0].n).toBe(0)
    // Objects added by 014 are gone, the audit table remains.
    await db.exec('reset role')
    const left = (await db.query<{ relname: string }>(`select relname from pg_class where relname in ('workspace_members','audit_events')`)).rows.map((r) => r.relname)
    expect(left).toEqual(['audit_events'])
    const fns = (await db.query<{ proname: string }>(`select proname from pg_proc where proname in ('current_workspace_owner','current_user_can_approve','log_audit_event','enforce_approval_authority')`)).rows
    expect(fns).toEqual([])
  })
})
