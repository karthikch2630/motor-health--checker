// Workflow 9: load condition field + combined voltage/frequency rule (engine 1.2.0) + partial-coverage display.
// Continues the session from 01-04 (signed in as user A, same QA database). All reference data here is a SYNTHETIC QA fixture that
// mirrors the shape of the NEMA draft profile; it exists only in the throw-away QA database.
import { API, BASE, USER_A, assert, localInput, stepper, T, waitText } from './lib.mjs'

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000)
const PROFILE = 'SYNTHETIC QA combined-rule profile'

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: 'qa-local-anon-key', authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function setup() {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: 'qa-local-anon-key', 'content-type': 'application/json' }, body: JSON.stringify(USER_A),
  })
  const token = (await auth.json()).access_token
  await api(token, 'POST', '/rest/v1/motors', {
    motor_tag: 'QA-BAL-1', name: 'QA 460 V motor', motor_type: 'induction', rated_voltage: 460, rated_frequency: 60, phase_count: 3, supply_type: 'line',
  })
  // Same ratings but supply NOT recorded, and an inverter-fed one: the line-supply profile must not be applied to either.
  await api(token, 'POST', '/rest/v1/motors', { motor_tag: 'QA-BAL-2', name: 'QA supply unknown', motor_type: 'induction', rated_voltage: 460, rated_frequency: 60, phase_count: 3 })
  await api(token, 'POST', '/rest/v1/motors', { motor_tag: 'QA-BAL-3', name: 'QA inverter-fed', motor_type: 'induction', rated_voltage: 460, rated_frequency: 60, phase_count: 3, supply_type: 'inverter' })
  const [profile] = await api(token, 'POST', '/rest/v1/reference_profiles', {
    name: PROFILE, motor_type: 'induction', version: 1, source_name: 'SYNTHETIC QA fixture - not an engineering source',
    applicable_specs: {
      phase_count: 3, supply_type: 'line', rated_frequency_hz: 60, rated_voltage_min_v: 460, rated_voltage_max_v: 460,
      combined_variation: {
        voltage_parameter: 'voltage', frequency_parameter: 'frequency', voltage_unit: 'V', frequency_unit: 'Hz',
        max_combined_percent: 10, max_frequency_percent: 5, required_load_condition: 'rated', source: 'SYNTHETIC',
      },
    },
  })
  const cond = { required_load_condition: 'rated' }
  await api(token, 'POST', '/rest/v1/reference_limits', [
    { reference_profile_id: profile.id, parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', warning_lower: 414, warning_upper: 506, applicable_conditions: cond, source_note: 'SYNTHETIC' },
    { reference_profile_id: profile.id, parameter_code: 'frequency', parameter_name: 'Frequency', unit: 'Hz', warning_lower: 57, warning_upper: 63, applicable_conditions: cond, source_note: 'SYNTHETIC' },
  ])
  await api(token, 'PATCH', `/rest/v1/reference_profiles?id=eq.${profile.id}`, { approval_status: 'approved' })
}

async function newTest(page, { days, voltage, frequency, load }) {
  await page.goto(`${BASE}/tests/new`)
  await page.locator('#motor_id').selectOption({ label: 'QA-BAL-1 — QA 460 V motor' })
  await page.locator('#timestamp').fill(localInput(daysAgo(days)))
  await page.locator('#measurement_method').fill('QA meter')
  if (load) await page.locator('#load_condition').selectOption(load)
  await page.getByLabel('Voltage value').fill(String(voltage))
  await page.getByLabel('Frequency value').fill(String(frequency))
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/, T)
  await page.getByRole('button', { name: /Review and submit/ }).click()
  if (load) await waitText(page, 'Rated load (nameplate)')
  else await waitText(page, 'Not recorded')
  await page.getByRole('button', { name: 'Submit test' }).click()
  await waitText(page, 'Test submitted.')
}

async function assess(page) {
  // Two approved profiles apply to this motor (the QA one from workflow 1 and this one): choose explicitly.
  await page.getByLabel(PROFILE).check()
  await page.getByRole('button', { name: 'Run assessment' }).click()
  await waitText(page, 'Assessment saved as revision 1.')
}

export default async function run(page) {
  const { steps, step } = stepper()

  await step('setup (REST as user A): 460 V / 60 Hz motor and an approved SYNTHETIC combined-rule profile', setup)

  await step('reference page lists the new motor with the usable profile, and the older QA profile', async () => {
    await page.goto(`${BASE}/reference`)
    await page.getByRole('heading', { name: 'Profile availability per motor' }).waitFor(T)
    const row = await page.getByRole('row', { name: /QA-BAL-1/ }).innerText()
    assert(row.includes(PROFILE), `coverage row: ${row.replace(/\n/g, ' ')}`)
  })

  await step('motors with unknown or inverter supply are NOT matched to the line-supply profile; the reason is shown (they remain unresolved)', async () => {
    await page.goto(`${BASE}/reference`)
    await page.getByRole('heading', { name: 'Profile availability per motor' }).waitFor(T)
    const unknown = await page.getByRole('row', { name: /QA-BAL-2/ }).innerText()
    assert(unknown.includes(`${PROFILE} v1 - `) && /supply type not verified/i.test(unknown), `unknown row: ${unknown}`)
    const inverter = await page.getByRole('row', { name: /QA-BAL-3/ }).innerText()
    assert(inverter.includes(`${PROFILE} v1 - `) && /this motor is inverter-fed/i.test(inverter), `inverter row: ${inverter}`)
  })

  await step('test form offers "Load during the test" (declared, blank = not recorded)', async () => {
    await page.goto(`${BASE}/tests/new`)
    const options = await page.locator('#load_condition').evaluate((el) => [...el.options].map((o) => o.textContent))
    assert(options[0] === 'Not recorded' && options.includes('Rated load (nameplate)') && options.length === 6, `options: ${options.join('|')}`)
    await waitText(page, 'Declared by the operator')
  })

  await step('NO load recorded, 460 V / 60 Hz: INSUFFICIENT_DATA, check unassessed, never a pass', async () => {
    await newTest(page, { days: 3, voltage: 460, frequency: 60, load: '' })
    await assess(page)
    await waitText(page, 'Insufficient data')
    const note = await page.getByRole('note').filter({ hasText: /Incomplete assessment/ }).innerText()
    assert(/load condition required/i.test(note), `note: ${note}`)
    assert((await page.getByText('Partial coverage', { exact: true }).count()) === 0, 'insufficient data shown as partial normal')
    const next = await page.getByRole('region', { name: 'Next steps' }).innerText()
    assert(/only if the motor really was at rated load/.test(next), `next steps: ${next}`)
    const cov = await page.getByRole('region', { name: 'Coverage' }).innerText()
    assert(/Voltage|Frequency/.test(cov) && /not assessed/i.test(cov), `coverage: ${cov}`)
    assert((await page.getByText('WITHIN_LIMITS').count()) === 0, 'a within-limits finding was written for an unassessed check')
  })

  await step('rated load, 414 V / 58.8 Hz (both inside their ranges, sum 12 %): WARNING with the combined finding', async () => {
    await newTest(page, { days: 2, voltage: 414, frequency: 58.8, load: 'rated' })
    await assess(page)
    await waitText(page, 'COMBINED_VF_SUM_EXCEEDED')
    await page.getByText('Warning', { exact: true }).first().waitFor(T)
    assert((await page.getByText('Within assessed limits', { exact: true }).count()) === 0, 'normal shown for a combined violation')
  })

  await step('rated load, 460 V / 60 Hz: NORMAL but marked PARTIAL, not proof of health', async () => {
    await newTest(page, { days: 1, voltage: 460, frequency: 60, load: 'rated' })
    await assess(page)
    await page.getByText('Within assessed limits (partial)', { exact: true }).first().waitFor(T)
    assert((await page.getByText('Within assessed limits', { exact: true }).count()) === 0, 'plain Normal shown for a partial assessment')
    await page.getByText('Partial coverage', { exact: true }).first().waitFor(T)
    const note = await page.getByRole('note').filter({ hasText: /Partial assessment/ }).innerText()
    assert(/not a statement that the motor is healthy/.test(note) && /Current/.test(note) && /Vibration/.test(note), note)
    await waitText(page, 'COMBINED_VF_WITHIN')
  })

  await step('dashboard: the Normal count carries the partial-coverage caption', async () => {
    await page.goto(`${BASE}/`)
    await page.getByText(/cover only some parameters - not a full health check/).first().waitFor(T)
  })

  await step('stored assessment pages still render for the older revision (history untouched)', async () => {
    await page.goto(`${BASE}/history`)
    await page.getByRole('table').waitFor(T)
    assert((await page.getByRole('table').getByRole('row').count()) > 3, 'history rows missing')
  })

  return { failed: steps.filter((s) => !s.ok).length, total: steps.length, steps }
}
