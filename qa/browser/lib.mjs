// Shared helpers for the browser QA scripts. They run against the LOCAL QA backend (qa/fake-supabase), never hosted Supabase.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const BASE = 'http://localhost:4173'
export const API = 'http://localhost:54321'
export const USER_A = { email: 'qa-user-a@example.test', password: 'qa-password-a' }
export const USER_B = { email: 'qa-user-b@example.test', password: 'qa-password-b' }

const STATE = join(tmpdir(), 'motor-qa-state.json')
export const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {})
export const saveState = (patch) => writeFileSync(STATE, JSON.stringify({ ...loadState(), ...patch }, null, 2))

export function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Collects pass/fail per step; a failing step never stops the run. */
export function stepper() {
  const steps = []
  return {
    steps,
    async step(name, fn) {
      try {
        const detail = await fn()
        steps.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail })
      } catch (e) {
        steps.push({ name, ok: false, error: String(e.message ?? e).split('\n')[0] })
      }
    },
  }
}

export const T = { timeout: 8000 }
export const waitText = (page, text) => page.getByText(text).first().waitFor(T)
export const heading = (page, name) => page.getByRole('heading', { name }).first().waitFor(T)

export async function signIn(page, user) {
  await page.goto(`${BASE}/signin`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await heading(page, 'Dashboard')
}

export const localInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
