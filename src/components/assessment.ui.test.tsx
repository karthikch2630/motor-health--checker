// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AssessmentPanel from './AssessmentPanel'
import DiagnosticStatusBadge from './DiagnosticStatusBadge'
import type { Motor } from '../types/motor'
import type { StoredAssessment } from '../types/assessment'
import type { ReferenceProfileWithCount } from '../types/reference'
import type { TestSession } from '../types/test'

// SYNTHETIC fixtures only.
const h = vi.hoisted(() => ({
  list: { data: [] as unknown[], isPending: false, error: null as Error | null },
  run: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
}))
vi.mock('../hooks/useAssessments', () => ({ useAssessments: () => h.list, useRunAssessment: () => h.run }))

const motor = { id: 'm1', motor_type: 'induction', phase_count: 3, rated_frequency: 50, rated_voltage: 400 } as unknown as Motor
const session = { id: 's1', status: 'submitted', test_timestamp: '2026-06-01T00:00:00Z' } as unknown as TestSession
const profile = (id: string, over: Partial<ReferenceProfileWithCount> = {}) =>
  ({ id, name: `Profile ${id}`, version: 2, motor_type: 'induction', approval_status: 'approved', source_name: 'Src', applicable_specs: {}, effective_from: null, effective_to: null, limit_count: 1, ...over }) as ReferenceProfileWithCount
const result = (over: Partial<StoredAssessment> = {}): StoredAssessment => ({
  id: 'r1', test_session_id: 's1', revision: 1, reference_profile_id: 'p1', reference_profile_version: 2,
  diagnostic_engine_version: '1.0.0', overall_status: 'FAULT_SUSPECTED', summary: 'A fault is suspected.', assessed_at: '2026-06-02T00:00:00Z',
  findings: [
    { id: 'f1', diagnostic_result_id: 'r1', parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL', observed_value: 95, observed_unit: 'V', applicable_limit: 90, finding_description: 'Voltage above limit.', possible_causes: [], recommended_action: 'Inspect.', created_at: '' },
    { id: 'f2', diagnostic_result_id: 'r1', parameter_code: 'current', rule_code: 'DATA_MISSING_READING', severity: 'INFO', observed_value: null, observed_unit: null, applicable_limit: null, finding_description: 'Current was not measured.', possible_causes: [], recommended_action: null, created_at: '' },
  ],
  ...over,
})

function renderPanel(profiles: ReferenceProfileWithCount[]) {
  return render(
    <MemoryRouter>
      <AssessmentPanel session={session} readings={[]} motor={motor} definitions={[]} profiles={profiles} profileNames={{ p1: 'Profile p1' }} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.list = { data: [], isPending: false, error: null }
  h.run = { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }
})

describe('AssessmentPanel — running', () => {
  it('uses the single compatible approved profile automatically', async () => {
    renderPanel([profile('p1')])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run assessment' }))
    expect(h.run.mutate).toHaveBeenCalledTimes(1)
    expect(h.run.mutate.mock.calls[0][0]).toMatchObject({ profileId: 'p1' })
  })

  it('never picks for the user when several profiles apply: a choice is required first', async () => {
    renderPanel([profile('p1'), profile('p2')])
    const user = userEvent.setup()
    const run = screen.getByRole('button', { name: 'Run assessment' })
    expect(run).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Profile p2/ }))
    expect(run).toBeEnabled()
    await user.click(run)
    expect(h.run.mutate.mock.calls[0][0].profileId).toBe('p2')
  })

  it('offers only compatible approved profiles; draft and wrong-type profiles are ignored', async () => {
    renderPanel([profile('p1', { approval_status: 'draft' }), profile('p2', { motor_type: 'synchronous' })])
    expect(screen.getByText(/No compatible approved reference profile/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run assessment' }))
    expect(h.run.mutate.mock.calls[0][0].profileId).toBeNull() // records INSUFFICIENT_DATA, nothing compared
  })

  it('reports success only after the save succeeded', async () => {
    h.run.mutate.mockImplementation((_i, opts) => opts.onSuccess({ saved: { revision: 3 } }))
    renderPanel([profile('p1')])
    expect(screen.queryByText(/Assessment saved/)).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run assessment' }))
    expect(screen.getByRole('status')).toHaveTextContent('Assessment saved as revision 3.')
  })

  it('shows the failure and no success message when saving fails', async () => {
    h.run.error = new Error('The database request failed. Please try again.')
    renderPanel([profile('p1')])
    expect(screen.getByRole('alert')).toHaveTextContent(/database request failed/)
    expect(screen.queryByText(/Assessment saved/)).not.toBeInTheDocument()
  })

  it('two clicks in the same tick start ONE assessment (no duplicate revision)', () => {
    renderPanel([profile('p1')])
    const button = screen.getByRole('button', { name: 'Run assessment' })
    act(() => {
      button.click()
      button.click()
    })
    expect(h.run.mutate).toHaveBeenCalledTimes(1)
    h.run.mutate.mock.calls[0][1].onSettled()
    act(() => button.click())
    expect(h.run.mutate).toHaveBeenCalledTimes(2)
  })

  it('disables the button while running (no double assessment)', () => {
    h.run.isPending = true
    renderPanel([profile('p1')])
    expect(screen.getByRole('button', { name: /Assessing/ })).toBeDisabled()
  })
})

describe('AssessmentPanel — results', () => {
  it('shows "Not assessed" when nothing is stored', () => {
    renderPanel([profile('p1')])
    expect(screen.getByText('Not assessed')).toBeInTheDocument()
  })

  it('shows status, summary, profile version, rule version, limit used and the suspected-not-confirmed caveat', () => {
    h.list.data = [result()]
    renderPanel([profile('p1')])
    expect(screen.getByText('Fault suspected')).toBeInTheDocument()
    expect(screen.getByText('A fault is suspected.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile p1 v2' })).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Voltage above limit/ })
    expect(within(row).getByText('95 V')).toBeInTheDocument()
    expect(within(row).getByText('90 V')).toBeInTheDocument()
    expect(screen.getByText(/never a confirmed diagnosis/)).toBeInTheDocument()
  })

  it('flags an incomplete assessment and keeps the finding visible alongside the data note', () => {
    h.list.data = [result()]
    renderPanel([profile('p1')])
    expect(screen.getByRole('note')).toHaveTextContent(/Incomplete assessment/)
    // listed in the incomplete note AND in the findings table; the critical finding is preserved
    expect(screen.getAllByText('Current was not measured.')).toHaveLength(2)
    expect(within(screen.getByRole('note')).queryByText('Voltage above limit.')).not.toBeInTheDocument()
    expect(screen.getByText('Voltage above limit.')).toBeInTheDocument()
  })

  it('does not flag a complete assessment as incomplete', () => {
    h.list.data = [result({ overall_status: 'NORMAL', findings: [] })]
    renderPanel([profile('p1')])
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('keeps earlier revisions visible and labels a reassessment as a new revision', () => {
    h.list.data = [result({ id: 'r2', revision: 2, overall_status: 'WARNING', findings: [] }), result({ id: 'r1', revision: 1 })]
    renderPanel([profile('p1')])
    expect(screen.getByRole('button', { name: /Run reassessment \(new revision\)/ })).toBeInTheDocument()
    expect(screen.getByText('Earlier revisions (1)')).toBeInTheDocument()
    expect(screen.getByText(/Earlier results are kept unchanged/)).toBeInTheDocument()
  })

  it('shows a load error instead of an empty state', () => {
    h.list = { data: [], isPending: false, error: new Error('The database request failed.') }
    renderPanel([profile('p1')])
    expect(screen.getByRole('alert')).toHaveTextContent(/database request failed/)
  })
})

describe('DiagnosticStatusBadge', () => {
  it.each([
    ['NORMAL', 'Within assessed limits'], ['WARNING', 'Warning'], ['FAULT_SUSPECTED', 'Fault suspected'],
    ['INSUFFICIENT_DATA', 'Insufficient data'], ['NOT_ASSESSED', 'Not assessed'],
  ] as const)('renders %s as text', (status, label) => {
    render(<DiagnosticStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
