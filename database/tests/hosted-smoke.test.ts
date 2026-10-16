/**
 * Tests database/verify/hosted_smoke.sql on a local PostgreSQL engine (PGlite). Not Supabase.
 * Proves the script (a) passes on a correctly migrated database, (b) leaves nothing behind, and
 * (c) actually FAILS when the later migrations (010-012) are missing — i.e. it can detect a bad deployment.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const UID = '11111111-1111-1111-1111-111111111111'
const migrations = join(process.cwd(), 'database', 'migrations')
const script = readFileSync(join(process.cwd(), 'database', 'verify', 'hosted_smoke.sql'), 'utf8')

async function database(maxMigration: number) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Supabase grants new tables and functions to the API roles by default; the migrations then tighten that.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users values ('${UID}');
  `)
  for (const f of readdirSync(migrations).filter((x) => x.endsWith('.sql')).sort()) {
    if (Number(f.slice(0, 3)) <= maxMigration) await db.exec(readFileSync(join(migrations, f), 'utf8'))
  }
  return db
}

async function runScript(db: PGlite) {
  const results = await db.exec(script.replaceAll('PUT-YOUR-USER-UUID-HERE', UID))
  const report = results.find((r) => r.fields?.some((f) => f.name === 'check_name'))
  return (report?.rows ?? []) as { check_name: string; passed: boolean; detail: string | null }[]
}

describe('database/verify/hosted_smoke.sql', () => {
  it('reports every check as passed on a database with migrations 001-012', async () => {
    const db = await database(12)
    const rows = await runScript(db)
    expect(rows.length).toBeGreaterThanOrEqual(25)
    const failed = rows.filter((r) => !r.passed)
    expect(failed, JSON.stringify(failed, null, 1)).toEqual([])
    await db.close()
  }, 60_000)

  it('rolls everything back: no test rows remain and a second run gives the same result', async () => {
    const db = await database(12)
    await runScript(db)
    for (const t of ['motors', 'test_sessions', 'test_readings', 'diagnostic_results', 'diagnostic_findings', 'reference_profiles']) {
      const n = (await db.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0].n
      expect(n, t).toBe(0)
    }
    expect((await runScript(db)).every((r) => r.passed)).toBe(true)
    await db.close()
  }, 60_000)

  it('detects a deployment that is missing migrations 010-012', async () => {
    const db = await database(9)
    const rows = await runScript(db)
    const failed = rows.filter((r) => !r.passed).map((r) => r.check_name)
    expect(failed.length).toBeGreaterThan(5)
    expect(failed.some((n) => /submitted test/.test(n))).toBe(true)
    expect(failed.some((n) => /search_path/.test(n))).toBe(true)
    await db.close()
  }, 60_000)

  it('never creates reference data and contains no destructive statements outside the rolled-back transaction', () => {
    expect(script).not.toMatch(/insert into public\.reference_(profiles|limits)/i)
    expect(script.trimEnd().endsWith('rollback;')).toBe(true)
    expect(script).not.toMatch(/\b(drop|truncate)\b\s+(table|schema)/i)
  })
})
