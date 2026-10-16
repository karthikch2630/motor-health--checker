// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AssessmentPanel from './AssessmentPanel'
import AssessmentResultView from './AssessmentResultView'
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

const motor = { id: 'm1', motor_type: 'induction', phase_count: 3, rated_frequency: 60, rated_voltage: 460, supply_type: null } as unknown as Motor
const session = (conditions: Record<string, unknown> = {}) =>
  ({ id: 's1', status: 'submitted', test_timestamp: '2026-06-01T00:00:00Z', operating_conditions: conditions }) as unknown as TestSession
const profile = (id: string, over: Partial<ReferenceProfileWithCount> = {}) =>
  ({ id, name: `Profile ${id}`, version: 1, motor_type: 'induction', approval_status: 'approved', source_name: 'Src', applicable_specs: {}, effective_from: null, effective_to: null, limit_count: 2, ...over }) as ReferenceProfileWithCount

const panel = (profiles: ReferenceProfileWithCount[], s = session()) => (
  <MemoryRouter>
    <AssessmentPanel session={s} readings={[]} motor={motor} definitions={[]} profiles={profiles} profileNames={{}} />
  </MemoryRouter>
)

beforeEach(() => {
  h.list = { data: [], isPending: false, error: null }
  h.run = { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }
})

describe('AssessmentPanel - explains why no profile applies, and what the readings are', () => {
  it('lists each profile with its reason, including the actionable unknown-supply message', () => {
    render(panel([profile('p1', { applicable_specs: { supply_type: 'line' } }), profile('p2', { approval_status: 'draft' })]))
    expect(screen.getByText('Why no profile applies')).toBeInTheDocument()
    expect(screen.getByText(/Supply type not verified\. Confirm the motor nameplate before applying this reference profile\./)).toBeInTheDocument()
    expect(screen.getByText(/The profile is not approved\./)).toBeInTheDocument()
  })

  it('an expired profile is listed with its reason', () => {
    render(panel([profile('p1', { effective_to: '2026-01-01T00:00:00Z' })]))
    expect(screen.getByText(/no longer effective at the test date/)).toBeInTheDocument()
  })

  it('says so when no profile exists at all', () => {
    render(panel([]))
    expect(screen.getByText(/No reference profile exists yet/)).toBeInTheDocument()
  })

  it('states the origin of the readings; synthetic data is flagged as not engineering evidence', () => {
    const { unmount } = render(panel([profile('p1')]))
    expect(screen.getByText(/origin not stated/)).toBeInTheDocument()
    unmount()
    render(panel([profile('p1')], session({ data_origin: 'synthetic' })))
    expect(screen.getByText(/Synthetic \/ demo values/)).toBeInTheDocument()
    expect(screen.getByText(/not engineering evidence about any motor/)).toBeInTheDocument()
  })
})

describe('AssessmentResultView - coverage, next steps and profile details', () => {
  const names = { voltage: 'Voltage', frequency: 'Frequency', current: 'Current' }
  const base = (over: Partial<StoredAssessment>): StoredAssessment => ({
    id: 'r1', test_session_id: 's1', revision: 1, reference_profile_id: 'p1', reference_profile_version: 1,
    diagnostic_engine_version: '1.2.0', overall_status: 'NORMAL', summary: 's', assessed_at: '2026-06-02T00:00:00Z', findings: [], ...over,
  })
  const finding = (over: Record<string, unknown>) => ({
    id: 'f', diagnostic_result_id: 'r1', parameter_code: null, rule_code: 'X', severity: 'INFO', observed_value: null, observed_unit: null,
    applicable_limit: null, finding_description: 'd', possible_causes: [], recommended_action: null, created_at: '', ...over,
  })
  const view = (r: StoredAssessment, extra: Record<string, unknown> = {}) =>
    render(<MemoryRouter><AssessmentResultView result={r} heading="Assessment" isLatest parameterNames={names} {...extra} /></MemoryRouter>)

  it('states what was and was not assessed, with reasons, for a partial result', () => {
    view(base({ findings: [finding({ rule_code: 'WITHIN_LIMITS', parameter_code: 'voltage' })] as never }))
    const cov = screen.getByRole('region', { name: 'Coverage' })
    expect(cov).toHaveTextContent('Assessed: Voltage. Not assessed: Frequency, Current.')
    expect(cov).toHaveTextContent(/no approved limit/)
    expect(screen.getByText('Within assessed limits (partial)')).toBeInTheDocument()
  })

  it('INSUFFICIENT_DATA with unknown applicability tells the user what to do next', () => {
    view(base({
      overall_status: 'INSUFFICIENT_DATA', reference_profile_id: null, reference_profile_version: null,
      findings: [finding({ rule_code: 'PROFILE_APPLICABILITY_UNKNOWN', finding_description: 'Applicability could not be established: Supply type not verified.' })] as never,
    }))
    expect(screen.getByRole('region', { name: 'Next steps' })).toHaveTextContent(/Confirm the motor nameplate/)
    expect(screen.getByRole('region', { name: 'Coverage' })).toHaveTextContent('Nothing was assessed.')
    expect(screen.getByText('Insufficient data')).toBeInTheDocument()
  })

  it('a supply-tolerance warning gets a next step that does not claim damage', () => {
    view(base({
      overall_status: 'WARNING',
      findings: [finding({ rule_code: 'COMBINED_VF_SUM_EXCEEDED', severity: 'WARNING', finding_description: 'Combined deviation 12 %.' })] as never,
    }))
    const steps = screen.getByRole('region', { name: 'Next steps' })
    expect(steps).toHaveTextContent(/Check the supply voltage and frequency/)
    expect(steps).toHaveTextContent(/not evidence that the motor is damaged/)
  })

  it('shows the profile approval status and source next to the version (status as of now)', () => {
    view(base({}), { profileNames: { p1: 'Profile One' }, profileDetails: { p1: { approval_status: 'approved', source_name: 'NEMA MG 1' } } })
    expect(screen.getByText(/source: NEMA MG 1/)).toBeInTheDocument()
  })
})
