// Workflows 4-8: draft, measurements, submit, assess against the approved SYNTHETIC profile, reassess, revisions, trends.
// Continues the session from 01 (same browser session, same QA database).
import { BASE, assert, loadState, localInput, saveState, stepper, T, waitText } from './lib.mjs'

// Two clicks in the SAME tick: no re-render can happen in between, so only a synchronous guard can stop the second one.
const doubleClick = (locator) => locator.evaluate((el) => { el.click(); el.click() })

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000)

async function enter(page, motorId, { days, voltage, current, method = 'QA clamp meter' }) {
  await page.goto(`${BASE}/tests/new?motor=${motorId}`)
  await page.locator('#timestamp').fill(localInput(daysAgo(days)))
  await page.locator('#measurement_method').fill(method)
  if (voltage !== undefined) await page.getByLabel('Voltage value').fill(String(voltage))
  if (current !== undefined) await page.getByLabel('Current value').fill(String(current))
}

async function saveDraft(page) {
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/, T)
  await waitText(page, 'Draft saved')
  return page.url().split('/').pop()
}

async function submitFromReview(page) {
  await page.getByRole('button', { name: /Review and submit/ }).click()
  await page.getByRole('button', { name: 'Submit test' }).click()
  await waitText(page, 'Test submitted.')
}

export default async function run(page) {
  const { steps, step } = stepper()
  const { motorId } = loadState()
  const ids = {}

  const historyRows = async () => {
    await page.goto(`${BASE}/history`)
    await page.getByRole('table').waitFor(T)
    return (await page.getByRole('table').getByRole('row').count()) - 1
  }

  await step('motor page shows "New test" and starts a test for that motor', async () => {
    await page.goto(`${BASE}/motors/${motorId}`)
    await page.getByRole('link', { name: 'New test' }).first().click()
    await page.waitForURL(/\/tests\/new\?motor=/, T)
    const selected = await page.locator('#motor_id').inputValue()
    assert(selected === motorId, 'motor not preselected')
  })

  await step('validation: malformed and impossible measurements are rejected, nothing saved', async () => {
    await enter(page, motorId, { days: 3, voltage: '4oo' })
    await page.getByLabel('Power factor value').fill('1.5')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await waitText(page, 'Enter a number')
    await waitText(page, 'cannot be above 1')
    assert(/\/tests\/new/.test(page.url()), 'navigated away despite errors')
  })

  await step('unit conversion: 0.12 kV is stored as 120 V (original kept) and shown on review', async () => {
    await enter(page, motorId, { days: 3 })
    await page.getByLabel('Voltage value').fill('0.12')
    await page.locator('#reading-voltage-unit').selectOption('kV')
    await page.getByRole('button', { name: /Review and submit/ }).click()
    const row = page.getByRole('row', { name: /Voltage/ })
    await row.waitFor(T)
    const text = await row.innerText()
    assert(/0\.12 kV/.test(text) && /120 V/.test(text), `review row was: ${text}`)
  })

  await step('test 1 (FAULT expected): save draft, reload restores it, then submit', async () => {
    await enter(page, motorId, { days: 3, voltage: 120 })
    ids.t1 = await saveDraft(page)
    await page.reload()
    await page.getByRole('button', { name: 'Save draft' }).waitFor(T)
    assert((await page.getByLabel('Voltage value').inputValue()) === '120', 'draft not restored after reload')
    assert(await page.locator('#motor_id').isDisabled(), 'motor selector should be locked for a saved draft')
    await submitFromReview(page)
    assert((await page.getByRole('button', { name: 'Save draft' }).count()) === 0, 'submitted test still editable')
  })

  await step('test 1: run assessment → FAULT_SUSPECTED, incomplete (current missing), not a confirmed diagnosis', async () => {
    await page.getByRole('button', { name: 'Run assessment' }).click()
    await waitText(page, 'Assessment saved as revision 1.')
    await waitText(page, 'Fault suspected')
    await waitText(page, 'not a confirmed diagnosis')
    const note = await page.getByRole('note').filter({ hasText: /Incomplete assessment/ }).innerText()
    assert(/Incomplete assessment/.test(note) && /Current/.test(note) && /proof/.test(note), `note: ${note.replace(/\n/g, ' ')}`)
    const row = await page.getByRole('row', { name: /above the approved upper limit/ }).innerText()
    assert(/120 V/.test(row) && /100 V/.test(row), `finding row: ${row.replace(/\n/g, ' ')}`)
  })

  await step('test 1: reassess → revision 2; revision 1 stays accessible and is labelled as earlier', async () => {
    await page.getByRole('button', { name: /Run reassessment/ }).click()
    await waitText(page, 'Assessment saved as revision 2.')
    await waitText(page, 'Earlier revisions (1)')
    await page.getByText('Earlier revisions (1)').click()
    await page.getByRole('link', { name: 'Open this revision' }).last().click()
    await page.waitForURL(/\/assessments\/1$/, T)
    await waitText(page, 'Earlier revision')
    await waitText(page, 'This is an earlier revision')
    await page.getByRole('link', { name: 'revision 2' }).first().click()
    await page.waitForURL(/\/assessments\/2$/, T)
    await waitText(page, 'All revisions of this test')
    const rows = await page.getByRole('table', { name: 'Assessment revisions' }).getByRole('row').count()
    assert(rows === 3, `expected header + 2 revision rows, got ${rows}`)
  })

  await step('test 2 (NORMAL expected, complete): 50 V / 5 A', async () => {
    await enter(page, motorId, { days: 2, voltage: 50, current: 5 })
    ids.t2 = await saveDraft(page)
    await submitFromReview(page)
    await page.getByRole('button', { name: 'Run assessment' }).click()
    await waitText(page, 'Assessment saved as revision 1.')
    await page.getByText('Normal (partial)', { exact: true }).first().waitFor(T)
    assert((await page.getByRole('note').filter({ hasText: /Incomplete assessment/ }).count()) === 0, 'complete assessment flagged incomplete')
    // The QA profile covers 2 of the 7 catalog parameters, so this NORMAL must be shown as PARTIAL, never as plain healthy.
    await page.getByText('Partial coverage', { exact: true }).first().waitFor(T)
    const partial = await page.getByRole('note').filter({ hasText: /Partial assessment/ }).innerText()
    assert(/not a statement that the motor is healthy/.test(partial) && /Temperature/.test(partial) && /Vibration/.test(partial), `partial note: ${partial}`)
  })

  await step('test 3 (WARNING expected): 90 V / 5 A, 1 day ago', async () => {
    await enter(page, motorId, { days: 1, voltage: 90, current: 5 })
    ids.t3 = await saveDraft(page)
    await submitFromReview(page)
    await page.getByRole('button', { name: 'Run assessment' }).click()
    await waitText(page, 'Assessment saved as revision 1.')
    await page.getByText('Warning', { exact: true }).first().waitFor(T)
  })

  await step('test 4: submitted but NOT assessed; test 5: left as a draft', async () => {
    await enter(page, motorId, { days: 0.5, voltage: 60, current: 6 })
    ids.t4 = await saveDraft(page)
    await submitFromReview(page)
    await waitText(page, 'Run assessment')
    await enter(page, motorId, { days: 0.2, voltage: 61 })
    ids.t5 = await saveDraft(page)
  })

  await step('double-click Save draft creates exactly ONE draft', async () => {
    const before = await historyRows()
    await enter(page, motorId, { days: 0.1, voltage: 63, current: 6 })
    await doubleClick(page.getByRole('button', { name: 'Save draft' }))
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/, T)
    await waitText(page, 'Draft saved')
    ids.t6 = page.url().split('/').pop()
    const after = await historyRows()
    assert(after === before + 1, `history rows went ${before} -> ${after} after one double-click`)
  })

  await step('double-click Submit test submits once without an error', async () => {
    await page.goto(`${BASE}/tests/${ids.t6}`)
    await page.getByRole('button', { name: /Review and submit/ }).click()
    await doubleClick(page.getByRole('button', { name: 'Submit test' }))
    await page.getByRole('button', { name: 'Run assessment' }).waitFor(T)
    assert((await page.getByRole('alert').count()) === 0, 'an error banner is shown')
    assert((await page.getByRole('button', { name: 'Save draft' }).count()) === 0, 'still editable')
    const flash = await page.locator('body').innerText()
    assert(!/already been submitted/.test(flash), 'a second submit request was sent (server reported already submitted)')
  })

  await step('double-click Run assessment stores exactly ONE revision', async () => {
    await doubleClick(page.getByRole('button', { name: 'Run assessment' }))
    await waitText(page, 'Assessment saved as revision')
    await page.waitForTimeout(800)
    const text = await page.locator('body').innerText()
    assert(/Current assessment · revision 1\b/.test(text), 'current revision is not 1')
    assert(!/Earlier revisions/.test(text), 'a second revision was stored by one double-click')
  })

  saveState({ ids })
  return { steps, ids }
}
