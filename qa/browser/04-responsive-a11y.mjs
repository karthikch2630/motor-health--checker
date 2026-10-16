// Responsive + accessibility sweep over every screen, at phone and desktop widths. Local QA backend only.
// Automated checks: horizontal overflow, one <h1>, unlabeled controls, unnamed buttons/links, duplicate ids,
// tables without a caption, and a visible keyboard-focus indicator on the first tab stops.
// NOT covered: colour contrast, screen-reader behaviour, touch-target size beyond the checks below.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE, loadState, stepper, T } from './lib.mjs'

const VIEWPORTS = [
  { name: 'phone 375x812', width: 375, height: 812 },
  { name: 'desktop 1280x800', width: 1280, height: 800 },
]

function pages({ motorId, ids, profileUrl }) {
  const profilePath = profileUrl ? new URL(profileUrl).pathname : '/reference'
  return [
    '/', '/motors', '/motors/new', `/motors/${motorId}`, `/motors/${motorId}/edit`,
    '/reference', '/reference/new', profilePath, '/history',
    '/tests/new', `/tests/${ids.t5}` /* draft editor */, `/tests/${ids.t1}` /* assessed */, `/tests/${ids.t4}` /* submitted */,
    `/tests/${ids.t1}/assessments/2`, `/tests/${ids.t1}/assessments/1`, '/no-such-page',
  ]
}

/** Runs in the page. */
function audit() {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const name = (el) =>
    (el.getAttribute('aria-label') ||
      [...(el.labels ?? [])].map((l) => l.textContent).join(' ') ||
      (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ||
      el.getAttribute('title') ||
      '').trim()
  const controls = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible)
  const clickable = [...document.querySelectorAll('button, a[href]')].filter(visible)
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i)
  return {
    overflowPx: document.documentElement.scrollWidth - window.innerWidth,
    h1: document.querySelectorAll('h1').length,
    unlabeled: controls.filter((c) => !name(c)).map((c) => `${c.tagName.toLowerCase()}#${c.id || '?'}`),
    unnamedClickable: clickable.filter((c) => !(c.textContent || '').trim() && !name(c)).map((c) => c.outerHTML.slice(0, 80)),
    dupIds: [...new Set(dupIds)],
    tablesWithoutCaption: [...document.querySelectorAll('table')].filter((t) => !t.querySelector('caption') && !t.getAttribute('aria-label')).length,
    tinyTargets: clickable.filter((c) => { const r = c.getBoundingClientRect(); return r.height < 24 && r.width < 24 }).length,
    mainPresent: !!document.querySelector('main'),
  }
}

export default async function run(page) {
  const { steps, step } = stepper()
  const state = loadState()
  const shots = {}
  const findings = []

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const path of pages(state)) {
      await step(`${vp.name} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`, async () => {
        await page.goto(`${BASE}${path}`)
        await page.locator('main, form').first().waitFor(T)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(250)
        const a = await page.evaluate(audit)
        const problems = []
        if (a.overflowPx > 1) problems.push(`horizontal overflow ${a.overflowPx}px`)
        if (a.h1 !== 1 && !path.includes('no-such')) problems.push(`${a.h1} <h1>`)
        if (a.unlabeled.length) problems.push(`unlabeled: ${a.unlabeled.join(', ')}`)
        if (a.unnamedClickable.length) problems.push(`unnamed: ${a.unnamedClickable.join(' ')}`)
        if (a.dupIds.length) problems.push(`duplicate ids: ${a.dupIds.join(', ')}`)
        if (a.tablesWithoutCaption) problems.push(`${a.tablesWithoutCaption} table(s) without caption`)
        if (a.tinyTargets) problems.push(`${a.tinyTargets} tiny click target(s)`)
        if (!a.mainPresent) problems.push('no <main>')
        if (problems.length) { findings.push({ page: `${vp.name} ${path}`, problems }); throw new Error(problems.join('; ')) }
      })
    }
  }

  // Keyboard focus visibility on representative screens (desktop).
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const path of ['/', '/motors/new', `/tests/${state.ids.t5}`, '/reference/new']) {
    await step(`keyboard focus is visible: ${path.replace(/[0-9a-f-]{36}/g, ':id')}`, async () => {
      await page.goto(`${BASE}${path}`)
      await page.locator('main').waitFor(T)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.evaluate(() => document.activeElement && document.activeElement.blur())
      const bad = []
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return null
          const s = getComputedStyle(el)
          const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
          const ring = s.boxShadow !== 'none'
          const border = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
          const nativeSubFocus = el.tagName === 'INPUT' && ['date', 'datetime-local', 'time'].includes(el.type)
          return { nativeSubFocus, tag: el.tagName, id: el.id, text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 24), visible: outline || ring, border }
        })
        // Date/time inputs have several internal tab stops (fields + calendar button); the browser draws its own indicator there.
        if (info && !info.visible && !info.nativeSubFocus) bad.push(`${info.tag}#${info.id} "${info.text}"`)
      }
      if (bad.length) { findings.push({ page: `focus ${path}`, problems: bad }); throw new Error(`no visible focus on: ${bad.join(', ')}`) }
    })
  }

  // Screenshots for visual review.
  const dir = tmpdir()
  const shot = async (name, vp, path) => {
    await page.setViewportSize(vp)
    await page.goto(`${BASE}${path}`)
    await page.locator('main').waitFor(T)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(600)
    const file = join(dir, `motor-qa-${name}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots[name] = file
  }
  await step('screenshots', async () => {
    await shot('dashboard-desktop', { width: 1280, height: 800 }, '/')
    await shot('motor-phone', { width: 375, height: 812 }, `/motors/${state.motorId}`)
    await shot('result-phone', { width: 375, height: 812 }, `/tests/${state.ids.t1}/assessments/2`)
    await shot('testform-phone', { width: 375, height: 812 }, `/tests/${state.ids.t5}`)
  })

  return { failed: steps.filter((s) => !s.ok).length, total: steps.length, findings, shots, steps: steps.filter((s) => !s.ok) }
}
