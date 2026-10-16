// Workflows 9-10 + security: dashboard/history/trends, lazy chart chunk, error+retry, sign-out, second user, direct API tampering.
// Runs against the LOCAL QA backend (real migrations/RLS/triggers, simulated HTTP layer) — NOT hosted Supabase.
import { API, BASE, USER_A, USER_B, assert, heading, loadState, signIn, stepper, T, waitText } from './lib.mjs'

async function token(user) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(user),
  })
  return (await r.json()).access_token
}
const rest = (path, tok, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', apikey: 'qa-local-anon-key', authorization: `Bearer ${tok ?? 'qa-local-anon-key'}`, prefer: 'return=representation', ...init.headers },
  })

export default async function run(page) {
  const { steps, step } = stepper()
  const { motorId, ids } = loadState()

  await step('dashboard: counts come from the stored rows', async () => {
    await page.goto(`${BASE}/`)
    await heading(page, 'Dashboard')
    await page.getByRole('region', { name: 'Totals' }).waitFor(T)
    const totals = await page.getByRole('region', { name: 'Totals' }).innerText()
    const num = (label) => Number(new RegExp(`${label}\\s*\\n?\\s*(\\d+)`, 'i').exec(totals)?.[1])
    assert(num('Registered motors') === 1, `motors: ${totals.replace(/\n/g, ' ')}`)
    assert(num('Test sessions') === 6, 'tests != 6')
    assert(num('Awaiting assessment') === 1, 'awaiting != 1')
    assert(num('Assessed tests') === 4, 'assessed != 4')
    assert(/1 draft/.test(totals), 'draft hint missing')
    const status = await page.getByRole('region', { name: 'Motors by latest assessment' }).innerText()
    assert(/No assessment yet\s*\n?\s*0/.test(status), `status block: ${status.replace(/\n/g, ' ')}`)
    assert(/Within assessed limits\s*\n?\s*1/.test(status), 'motor not counted as Within assessed limits at its latest assessment')
    assert(/not.*considered healthy/.test(status), 'healthy disclaimer missing')
  })

  await step('lazy chart: the chart chunk is NOT loaded on the dashboard', async () => {
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /TrendChart/.test(n)))
    assert(loaded.length === 0, `chart chunk loaded early: ${loaded}`)
  })

  await step('navigation chain: dashboard → recent assessment → test → motor', async () => {
    await page.getByRole('link', { name: /QA-M1 · revision/ }).first().click()
    await page.waitForURL(/\/assessments\/\d+$/, T)
    await waitText(page, 'Readings these revisions were based on')
    await page.getByRole('link', { name: /Back to the test/ }).click()
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/, T)
    await page.getByRole('link', { name: /QA-M1 — QA Pump/ }).first().click().catch(async () => {
      await page.goto(`${BASE}/motors/${motorId}`)
    })
    await page.waitForURL(/\/motors\//, T)
  })

  await step('motor page: stored latest assessment, recent tests, comparable-reading trends (lazy chunk loads now)', async () => {
    await page.goto(`${BASE}/motors/${motorId}`)
    await page.getByRole('region', { name: 'Latest assessment' }).waitFor(T)
    const latest = await page.getByRole('region', { name: 'Latest assessment' }).innerText()
    assert(/Within assessed limits/.test(latest) && /Open result \(revision 1\)/.test(latest), `latest: ${latest.replace(/\n/g, ' ')}`)
    const rows = (await page.getByRole('table', { name: 'Recent tests of this motor' }).getByRole('row').count()) - 1
    assert(rows === 6, `recent tests rows ${rows}`)
    await page.getByRole('img', { name: /Trend of/ }).waitFor(T)
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /TrendChart/.test(n)))
    assert(loaded.length === 1, 'chart chunk not requested on the motor page')
    const options = await page.locator('#trend-series option').allInnerTexts()
    assert(options.length === 2, `expected 2 series (voltage, current), got ${options.length}: ${options.join(' | ')}`)
    assert(options.every((o) => /method: QA clamp meter · location: not recorded/.test(o)), 'series label lacks method/location')
    return options
  })

  await step('trends: switching series works and values are listed in an accessible table', async () => {
    await page.locator('#trend-series').selectOption({ index: 1 })
    await page.getByRole('img', { name: /Trend of/ }).waitFor(T)
    await page.getByText('Show values as a table').click()
    const n = await page.locator('details table tbody tr').count()
    assert(n >= 3, `table rows ${n}`)
  })

  await step('history: draft / awaiting / assessed are distinguished; revisions are shown', async () => {
    await page.goto(`${BASE}/history`)
    const table = page.getByRole('table')
    await table.waitFor(T)
    const text = await table.innerText()
    assert(/Draft — cannot be assessed yet/.test(text), 'draft label missing')
    assert(/Not assessed — awaiting assessment/.test(text), 'awaiting label missing')
    assert(/Revision 2 of 2/.test(text), 'revision count missing')
    assert((await table.getByRole('row').count()) === 7, 'row count')
  })

  await step('error state: failed overview query shows an error with retry and NO zero counts; retry recovers', async () => {
    await fetch(`${API}/__qa/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 500, count: 2, pathIncludes: 'test_sessions' }) })
    await page.goto(`${BASE}/`)
    await page.getByRole('alert').first().waitFor({ timeout: 15000 })
    assert((await page.getByText('Registered motors').count()) === 0, 'counts shown while the query failed')
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByRole('region', { name: 'Totals' }).waitFor(T)
  })

  // ---------------------------------------------------------------- security
  const tokA = await token(USER_A)
  const tokB = await token(USER_B)

  await step('API: anonymous requests cannot read private tables', async () => {
    const r = await rest('motors?select=*', null)
    assert(r.status >= 400, `anon status ${r.status}`)
  })

  await step('API: user B cannot read, change or add to user A\'s data', async () => {
    const sess = await (await rest('test_sessions?select=id', tokB)).json()
    assert(Array.isArray(sess) && sess.length === 0, 'B can see A sessions')
    const motors = await (await rest('motors?select=id', tokB)).json()
    assert(Array.isArray(motors) && motors.length === 0, 'B can see A motors')
    const patch = await (await rest(`motors?id=eq.${motorId}`, tokB, { method: 'PATCH', body: JSON.stringify({ name: 'hacked' }) })).json()
    assert(Array.isArray(patch) && patch.length === 0, 'B updated A motor')
    const del = await (await rest(`test_sessions?id=eq.${ids.t1}`, tokB, { method: 'DELETE' })).json()
    assert(Array.isArray(del) && del.length === 0, 'B deleted A session')
    const addReading = await rest('test_readings', tokB, { method: 'POST', body: JSON.stringify({ test_session_id: ids.t5, parameter_code: 'voltage', measured_value: 1, measured_unit: 'V', normalized_value: 1, normalized_unit: 'V' }) })
    assert(addReading.status >= 400, `B added a reading to A's draft (${addReading.status})`)
    const rpc = await rest('rpc/save_diagnostic_assessment', tokB, { method: 'POST', body: JSON.stringify({ p_session_id: ids.t4, p_engine_version: 'x', p_status: 'INSUFFICIENT_DATA', p_findings: [] }) })
    assert(rpc.status >= 400, `B assessed A's test (${rpc.status})`)
  })

  await step('API: even the owner cannot alter a SUBMITTED test or its readings, nor edit/delete assessments', async () => {
    const note = await rest(`test_sessions?id=eq.${ids.t4}`, tokA, { method: 'PATCH', body: JSON.stringify({ notes: 'tamper' }) })
    assert(note.status >= 400 && /immutable/.test(JSON.stringify(await note.json())), 'submitted session was editable')
    const back = await rest(`test_sessions?id=eq.${ids.t4}`, tokA, { method: 'PATCH', body: JSON.stringify({ status: 'draft' }) })
    assert(back.status >= 400, 'submitted session reverted to draft')
    const reading = await rest('test_readings', tokA, { method: 'POST', body: JSON.stringify({ test_session_id: ids.t4, parameter_code: 'speed', measured_value: 1, measured_unit: 'RPM', normalized_value: 1, normalized_unit: 'RPM' }) })
    assert(reading.status >= 400, 'reading added to submitted test')
    const delReading = await rest(`test_readings?test_session_id=eq.${ids.t4}`, tokA, { method: 'DELETE' })
    assert(delReading.status >= 400, 'reading deleted from submitted test')
    const results = await (await rest('diagnostic_results?select=id&limit=1', tokA)).json()
    const upd = await rest(`diagnostic_results?id=eq.${results[0].id}`, tokA, { method: 'PATCH', body: JSON.stringify({ overall_status: 'NORMAL' }) })
    assert(upd.status >= 400, 'assessment result was editable')
    const del = await rest(`diagnostic_results?id=eq.${results[0].id}`, tokA, { method: 'DELETE' })
    assert(del.status >= 400, 'assessment result was deletable')
    const forged = await rest('diagnostic_results', tokA, { method: 'POST', body: JSON.stringify({ test_session_id: ids.t4, diagnostic_engine_version: 'x', overall_status: 'NORMAL' }) })
    assert(forged.status >= 400, 'a NORMAL result without a profile was accepted by a direct insert')
  })

  await step('API: approved reference profile and its limits cannot be changed directly', async () => {
    const profiles = await (await rest('reference_profiles?select=id', tokA)).json()
    const upd = await rest(`reference_profiles?id=eq.${profiles[0].id}`, tokA, { method: 'PATCH', body: JSON.stringify({ source_name: 'changed' }) })
    assert(upd.status >= 400, 'approved profile editable')
    const lim = await rest(`reference_limits?reference_profile_id=eq.${profiles[0].id}`, tokA, { method: 'PATCH', body: JSON.stringify({ upper_limit: 999 }) })
    assert(lim.status >= 400, 'approved limit editable')
  })

  // ---------------------------------------------------------------- sign out, then user B in the same browser
  await step('sign out: protected routes require authentication again and no session is left in storage', async () => {
    await page.goto(`${BASE}/`)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/signin$/, T)
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')))
    const left = await page.evaluate(() => Object.keys(localStorage).map((k) => (localStorage.getItem(k) ?? '').includes('access_token')))
    assert(!left.some(Boolean), `token still stored under ${keys}`)
    for (const p of ['/motors', `/motors/${motorId}`, `/tests/${ids.t1}`, `/tests/${ids.t1}/assessments/1`, '/history', '/']) {
      await page.goto(`${BASE}${p}`)
      await page.waitForURL(/\/signin$/, T)
    }
    await page.goBack().catch(() => {})
    await heading(page, 'Sign in')
    assert((await page.getByText('QA-M1').count()) === 0, 'private data visible after sign-out')
  })

  await step('user B in the same browser sees an empty account and cannot open A\'s records by URL', async () => {
    await signIn(page, USER_B)
    await waitText(page, 'No motors registered')
    for (const p of [`/motors/${motorId}`, `/tests/${ids.t1}`, `/tests/${ids.t1}/assessments/1`]) {
      await page.goto(`${BASE}${p}`)
      await page.getByRole('alert').first().waitFor(T)
      const body = await page.locator('body').innerText()
      assert(/not found/i.test(body), `${p}: ${body.slice(0, 120).replace(/\n/g, ' ')}`)
      assert(!/QA-M1|QA Pump/.test(body), `${p} leaked A's data`)
    }
    await page.goto(`${BASE}/history`)
    await waitText(page, 'No tests recorded')
  })

  await step('after B signs out and A signs in again, A\'s data is intact (nothing was altered)', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/signin$/, T)
    await signIn(page, USER_A)
    await page.goto(`${BASE}/motors/${motorId}`)
    await waitText(page, 'QA Pump')
  })

  return { steps }
}
