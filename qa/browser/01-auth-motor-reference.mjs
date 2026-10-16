// Workflows 1-3: sign in (+ keyboard), session restore, reference profile (SYNTHETIC fixture), motor CRUD.
import { BASE, USER_A, assert, heading, saveState, stepper, T, waitText } from './lib.mjs'

export default async function run(page) {
  const { steps, step } = stepper()
  const state = {}

  await step('unauthenticated visit is redirected to sign-in; no sign-up link', async () => {
    await page.waitForURL(/\/signin$/, T)
    await heading(page, 'Sign in')
    const text = await page.locator('body').innerText()
    assert(!/sign up|register|create account/i.test(text), 'sign-up text present')
  })

  await step('protected routes redirect while signed out', async () => {
    for (const p of ['/motors', '/tests/new', '/reference', '/history']) {
      await page.goto(`${BASE}${p}`)
      await page.waitForURL(/\/signin$/, T)
    }
  })

  await step('keyboard: Tab reaches email, password, submit in order; wrong password shows an error', async () => {
    await page.goto(`${BASE}/signin`)
    await page.evaluate(() => document.activeElement && document.activeElement.blur()) // start from the top of the document
    const order = []
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab')
      order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName))
      if (i === 0) await page.keyboard.type(USER_A.email)
      if (i === 1) await page.keyboard.type('wrong-password')
    }
    assert(order[0] === 'email' && order[1] === 'password' && order[2] === 'BUTTON', `tab order was ${order}`)
    await page.keyboard.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }).waitFor(T)
    return order
  })

  await step('sign in with the authorized user lands on the dashboard (empty state, no fake numbers)', async () => {
    await page.getByLabel('Password').fill(USER_A.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await heading(page, 'Dashboard')
    await waitText(page, 'No motors registered')
    assert((await page.getByText('Registered motors').count()) === 0, 'stat tiles shown with no motors')
  })

  await step('refresh restores the session', async () => {
    await page.reload()
    await heading(page, 'Dashboard')
    await waitText(page, USER_A.email)
  })

  // ---- reference profile: SYNTHETIC fixture in the throw-away QA database only
  await step('reference: empty state; new draft profile', async () => {
    await page.goto(`${BASE}/reference`)
    await waitText(page, 'No reference profiles')
    await page.getByRole('link', { name: /New draft profile/ }).click()
    await page.getByLabel(/Profile name/).fill('SYNTHETIC QA profile')
    await page.getByLabel(/Applicable motor type/).fill('induction')
    await page.locator('#source_name').fill('SYNTHETIC QA fixture - not an engineering source')
    await page.getByLabel(/Source reference/).fill('none (throw-away QA data)')
    await page.getByRole('button', { name: 'Create draft' }).click()
    await heading(page, /SYNTHETIC QA profile/)
    await waitText(page, 'Draft profile created')
    state.profileUrl = page.url()
  })

  await step('reference: draft cannot be approved without limits (button disabled, reason shown)', async () => {
    assert(await page.getByRole('button', { name: /Approve/ }).isDisabled(), 'approve enabled without limits')
    await waitText(page, 'The profile has no limits')
  })

  await step('reference: add two limits (SYNTHETIC values), incl. a validation error first', async () => {
    await page.getByRole('button', { name: 'Add limit' }).click()
    await page.getByLabel('Parameter').selectOption('voltage')
    await page.getByLabel(/Source note/).fill('SYNTHETIC QA value')
    await page.getByRole('button', { name: 'Add limit' }).click() // no threshold yet
    await page.getByRole('alert').filter({ hasText: /at least one limit/i }).waitFor(T)
    await page.getByLabel(/^Upper limit/).fill('100')
    await page.getByLabel(/^Upper warning threshold/).fill('80')
    await page.getByRole('button', { name: 'Add limit' }).click()
    await waitText(page, 'Limit added.')
    await page.getByRole('button', { name: 'Add limit' }).click()
    await page.getByLabel('Parameter').selectOption('current')
    await page.getByLabel(/^Upper limit/).fill('10')
    await page.getByLabel(/^Upper warning threshold/).fill('8')
    await page.getByLabel(/Source note/).fill('SYNTHETIC QA value')
    await page.getByRole('button', { name: 'Add limit' }).click()
    await page.getByRole('row', { name: /Current/ }).waitFor(T)
    assert((await page.getByRole('row', { name: /Voltage/ }).count()) === 1, 'voltage row missing')
  })

  await step('reference: approval needs confirmation + acknowledgement; afterwards profile is immutable in the UI', async () => {
    await page.getByRole('button', { name: /Approve/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor(T)
    assert(await dialog.getByRole('button', { name: 'Approve profile' }).isDisabled(), 'confirm enabled before acknowledgement')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Approve profile' }).click()
    await waitText(page, 'Profile approved.')
    assert((await page.getByRole('button', { name: 'Add limit' }).count()) === 0, 'Add limit still offered')
    assert((await page.getByRole('link', { name: 'Edit' }).count()) === 0, 'Edit still offered')
    await page.getByRole('button', { name: /Create new version/ }).waitFor(T)
  })

  // ---- motor CRUD
  await step('motors: register a motor (required-field validation first)', async () => {
    await page.goto(`${BASE}/motors/new`)
    await page.getByRole('button', { name: 'Register motor' }).click()
    await waitText(page, 'Motor tag is required')
    await page.getByLabel(/Motor ID/).fill('QA-M1')
    await page.getByLabel(/Motor name/).fill('QA Pump')
    await page.getByLabel(/Motor type/).fill('induction')
    await page.getByLabel('Rated voltage (V)').fill('400')
    await page.getByLabel('Rated power').fill('5.5')
    await page.getByLabel('Power unit').selectOption('kW')
    await page.getByLabel('Number of phases').fill('3')
    await page.getByLabel('Rated frequency (Hz)').fill('50')
    await page.getByRole('button', { name: 'Register motor' }).click()
    await page.waitForURL(/\/motors\/[0-9a-f-]{36}$/, T)
    await waitText(page, 'was registered')
    state.motorId = page.url().split('/').pop()
  })

  await step('motors: duplicate tag is rejected by the database with a clear message', async () => {
    await page.goto(`${BASE}/motors/new`)
    await page.getByLabel(/Motor ID/).fill('QA-M1')
    await page.getByLabel(/Motor name/).fill('Duplicate')
    await page.getByLabel(/Motor type/).fill('induction')
    await page.getByRole('button', { name: 'Register motor' }).click()
    await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor(T)
  })

  await step('motors: list, search and filter', async () => {
    await page.goto(`${BASE}/motors`)
    await page.getByRole('link', { name: 'QA-M1', exact: true }).waitFor(T)
    await page.getByLabel('Search motors').fill('zzz-no-match')
    await waitText(page, 'No motors match')
    await page.getByLabel('Search motors').fill('pump')
    await page.getByRole('link', { name: 'QA-M1', exact: true }).waitFor(T)
  })

  await step('motors: edit and view details; nothing is claimed about condition', async () => {
    await page.goto(`${BASE}/motors/${state.motorId}/edit`)
    await page.getByLabel('Installation location').fill('Plant X')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await waitText(page, 'was updated')
    await waitText(page, 'Plant X')
    await waitText(page, 'No assessment recorded')
    await waitText(page, 'does not mean it is healthy')
  })

  saveState(state)
  return { steps, state }
}
