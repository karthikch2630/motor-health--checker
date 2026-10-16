// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AssessmentResultView from './AssessmentResultView'
import MotorHistory from './MotorHistory'
import TrendChart from './TrendChart'
import AssessmentResultPage from '../pages/AssessmentResultPage'
import DashboardPage from '../pages/DashboardPage'
import TestHistoryPage from '../pages/TestHistoryPage'
import type { StoredAssessment, StoredFinding } from '../types/assessment'
import type { Overview } from '../types/overview'

// SYNTHETIC fixtures. Nothing here is a real limit or measurement.
const h = vi.hoisted(() => ({
  overview: { data: undefined as unknown, isPending: false, error: null as Error | null, refetch: vi.fn() },
  readings: { data: [] as unknown[], isPending: false, error: null as Error | null, refetch: vi.fn() },
  assessments: { data: [] as unknown[], isPending: false, error: null as Error | null, refetch: vi.fn() },
  test: { data: undefined as unknown, isPending: false, error: null as Error | null, refetch: vi.fn() },
}))
vi.mock('../hooks/useOverview', () => ({
  OVERVIEW_KEY: ['test-sessions', 'overview'],
  useOverview: () => h.overview,
  useReadingsFor: () => h.readings,
}))
vi.mock('../hooks/useAssessments', () => ({ useAssessments: () => h.assessments, useRunAssessment: () => ({}) }))
vi.mock('../hooks/useTests', () => ({ useTest: () => h.test }))
vi.mock('../hooks/useMotors', () => ({
  useMotors: () => ({ data: [{ id: 'm1', motor_tag: 'M1', name: 'Pump' }], isPending: false, error: null }),
}))
vi.mock('../hooks/useReference', () => ({
  useParameterDefinitions: () => ({
    data: [{ code: 'voltage', display_name: 'Voltage', description: null, canonical_unit: 'V' }, { code: 'current', display_name: 'Current', description: null, canonical_unit: 'A' }],
    isPending: false, error: null,
  }),
  useProfiles: () => ({ data: [{ id: 'p1', name: 'Profile One' }], isPending: false, error: null }),
}))
// Charts need real layout; stub them. Series construction is covered in trends.test.ts.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div data-testid="chart-part">{children}</div>
  return { ResponsiveContainer: Stub, LineChart: Stub, Line: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Tooltip: Stub }
})

const finding = (over: Partial<StoredFinding>): StoredFinding => ({
  id: 'f', diagnostic_result_id: 'r', parameter_code: 'voltage', rule_code: 'LIMIT_ABOVE_UPPER', severity: 'CRITICAL',
  observed_value: 95, observed_unit: 'V', applicable_limit: 90, finding_description: 'Voltage above limit.',
  possible_causes: [], recommended_action: 'Inspect.', created_at: '', ...over,
})
const result = (over: Partial<StoredAssessment> = {}): StoredAssessment => ({
  id: 'r1', test_session_id: 's1', revision: 1, reference_profile_id: 'p1', reference_profile_version: 4,
  diagnostic_engine_version: '1.0.0', overall_status: 'FAULT_SUSPECTED', summary: 'Stored summary text.', assessed_at: '2026-06-02T10:00:00Z',
  findings: [finding({ id: 'f1' }), finding({ id: 'f2', parameter_code: 'current', rule_code: 'DATA_MISSING_READING', severity: 'INFO', observed_value: null, observed_unit: null, applicable_limit: null, finding_description: 'Current was not measured.', recommended_action: null })],
  ...over,
})

const ov = (over: Partial<Overview> = {}): Overview => ({
  motors: [{ id: 'm1', motor_tag: 'M1', name: 'Pump', motor_type: 'induction' }, { id: 'm2', motor_tag: 'M2', name: 'Fan', motor_type: 'induction' }],
  sessions: [
    { id: 's1', motor_id: 'm1', test_timestamp: '2026-05-01T10:00:00Z', measurement_method: null, status: 'assessed', created_at: '' },
    { id: 's2', motor_id: 'm1', test_timestamp: '2026-06-01T10:00:00Z', measurement_method: null, status: 'submitted', created_at: '' },
    { id: 's3', motor_id: 'm1', test_timestamp: '2026-06-10T10:00:00Z', measurement_method: null, status: 'draft', created_at: '' },
  ],
  results: [
    { id: 'r1', test_session_id: 's1', revision: 1, overall_status: 'WARNING', assessed_at: '2026-05-02T00:00:00Z', reference_profile_id: 'p1', reference_profile_version: 1, diagnostic_engine_version: '1.0.0' },
    { id: 'r2', test_session_id: 's1', revision: 2, overall_status: 'NORMAL', assessed_at: '2026-05-03T00:00:00Z', reference_profile_id: 'p1', reference_profile_version: 2, diagnostic_engine_version: '1.0.0' },
  ],
  truncated: { motors: false, sessions: false, results: false },
  ...over,
})

beforeEach(() => {
  h.overview = { data: ov(), isPending: false, error: null, refetch: vi.fn() }
  h.readings = { data: [], isPending: false, error: null, refetch: vi.fn() }
  h.assessments = { data: [], isPending: false, error: null, refetch: vi.fn() }
  h.test = { data: undefined, isPending: false, error: null, refetch: vi.fn() }
})

const wrap = (ui: React.ReactElement, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

describe('AssessmentResultView — stored rendering', () => {
  const props = { heading: 'Assessment', isLatest: true, parameterNames: { voltage: 'Voltage', current: 'Current' }, profileNames: { p1: 'Profile One' } }

  it('shows exactly the stored status, summary, profile id/version, rule version, values and boundary', () => {
    wrap(<AssessmentResultView result={result()} {...props} />)
    expect(screen.getByText('Fault suspected')).toBeInTheDocument()
    expect(screen.getByText('Stored summary text.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile One v4' })).toHaveAttribute('href', '/reference/p1')
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Voltage above limit/ })
    expect(within(row).getByText('Voltage')).toBeInTheDocument() // parameter NAME, not just the code
    expect(within(row).getByText('95 V')).toBeInTheDocument()
    expect(within(row).getByText('90 V')).toBeInTheDocument()
    expect(within(row).getByText('Critical')).toBeInTheDocument()
    expect(within(row).getByText(/Suggested: Inspect\./)).toBeInTheDocument()
  })

  it('says fault suspected needs verification and is not a confirmed diagnosis', () => {
    wrap(<AssessmentResultView result={result()} {...props} />)
    expect(screen.getByText(/needs verification and qualified inspection/)).toBeInTheDocument()
    expect(screen.getByText(/not a confirmed diagnosis/)).toBeInTheDocument()
  })

  it('does not show the fault caveat for other statuses', () => {
    wrap(<AssessmentResultView result={result({ overall_status: 'WARNING', findings: [] })} {...props} />)
    expect(screen.queryByText(/not a confirmed diagnosis/)).not.toBeInTheDocument()
  })

  it('an incomplete result keeps its critical finding AND lists what could not be evaluated, never implying health', () => {
    wrap(<AssessmentResultView result={result()} {...props} />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/Incomplete assessment/)
    expect(note).toHaveTextContent(/must not be read as proof that the motor is healthy/)
    expect(within(note).getByText('Current:')).toBeInTheDocument()
    expect(within(note).getByText(/Current was not measured\./)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Voltage above limit/ })).toBeInTheDocument()
  })

  it('shows an incomplete INSUFFICIENT_DATA result with no profile', () => {
    const r = result({
      overall_status: 'INSUFFICIENT_DATA', reference_profile_id: null, reference_profile_version: null,
      findings: [finding({ id: 'x', parameter_code: null, rule_code: 'PROFILE_NOT_AVAILABLE', severity: 'INFO', observed_value: null, observed_unit: null, applicable_limit: null, finding_description: 'No approved reference profile was selected for this assessment.', recommended_action: null })],
    })
    wrap(<AssessmentResultView result={r} {...props} />)
    expect(screen.getByText('None applied')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/No approved reference profile was selected/)
  })

  it('has no incomplete note for a complete result', () => {
    wrap(<AssessmentResultView result={result({ overall_status: 'NORMAL', findings: [finding({ id: 'w', rule_code: 'WITHIN_LIMITS', severity: 'INFO', finding_description: 'Within.', recommended_action: null })] })} {...props} />)
    expect(screen.queryByText(/Incomplete assessment/)).not.toBeInTheDocument()
  })

  it('lists catalog parameters the applied profile did not check, without changing the stored status', () => {
    wrap(<AssessmentResultView result={result({ overall_status: 'NORMAL', findings: [finding({ id: 'w', rule_code: 'WITHIN_LIMITS', severity: 'INFO', parameter_code: 'voltage', finding_description: 'Within.', recommended_action: null })] })} {...props} />)
    expect(screen.getByRole('note')).toHaveTextContent(/Partial assessment - not a statement that the motor is healthy.*Not covered by this profile.*Current/)
    expect(screen.getByText('Partial coverage')).toBeInTheDocument()
    expect(screen.getByText('Normal (partial)')).toBeInTheDocument() // stored status is NORMAL; shown as partial, never as plain Normal
    expect(screen.queryByText('Normal', { exact: true })).not.toBeInTheDocument()
  })

  it('labels the latest revision and earlier revisions differently', () => {
    const { rerender } = wrap(<AssessmentResultView result={result()} {...props} />)
    expect(screen.getByText('Latest')).toBeInTheDocument()
    rerender(<MemoryRouter><AssessmentResultView result={result()} {...props} isLatest={false} /></MemoryRouter>)
    expect(screen.getByText('Earlier revision')).toBeInTheDocument()
  })

  it('renders the stored values unchanged when profile names change later (history is not rewritten)', () => {
    wrap(<AssessmentResultView result={result()} {...props} profileNames={{ p1: 'Renamed later' }} />)
    expect(screen.getByText('95 V')).toBeInTheDocument()
    expect(screen.getByText(/v4/)).toBeInTheDocument() // the stored version, not the profile's current version
  })
})

describe('AssessmentResultPage — revisions', () => {
  function renderPage(rev: string) {
    return wrap(
      <Routes>
        <Route path="/tests/:id/assessments/:revision" element={<AssessmentResultPage />} />
        <Route path="/tests/:id" element={<p>test page</p>} />
      </Routes>,
      `/tests/s1/assessments/${rev}`,
    )
  }
  beforeEach(() => {
    h.test.data = {
      session: { id: 's1', motor_id: 'm1', test_timestamp: '2026-05-01T10:00:00Z', operating_conditions: {}, measurement_method: null, notes: null, status: 'assessed' },
      readings: [{ parameter_code: 'voltage', measured_value: 95, measured_unit: 'V', normalized_value: 95, normalized_unit: 'V', measurement_location: null }],
    }
    h.assessments.data = [
      result({ id: 'r2', revision: 2, overall_status: 'NORMAL', summary: 'Second summary.', findings: [], reference_profile_version: 5 }),
      result({ id: 'r1', revision: 1, overall_status: 'FAULT_SUSPECTED', summary: 'First summary.' }),
    ]
  })

  it('opens the latest revision and marks it as latest', () => {
    renderPage('2')
    expect(screen.getByText('Second summary.')).toBeInTheDocument()
    expect(screen.queryByText('First summary.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Latest').length).toBeGreaterThan(0)
    expect(screen.queryByText(/This is an earlier revision/)).not.toBeInTheDocument()
  })

  it('opens an earlier revision exactly as stored, with a pointer to the latest one', () => {
    renderPage('1')
    expect(screen.getByText('First summary.')).toBeInTheDocument()
    // stored status of revision 1 shows in the result card and in the revisions table
    expect(screen.getAllByText('Fault suspected')).toHaveLength(2)
    expect(screen.getByText('Earlier revision')).toBeInTheDocument()
    expect(screen.getByText(/This is an earlier revision/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toContainElement(screen.getByRole('link', { name: 'revision 2' }))
    expect(screen.getByRole('link', { name: 'revision 2' })).toHaveAttribute('href', '/tests/s1/assessments/2')
  })

  it('lists every revision newest first with its profile version and links to each', () => {
    renderPage('1')
    const table = screen.getByRole('table', { name: 'Assessment revisions' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: 'Revision 2' })).toHaveAttribute('href', '/tests/s1/assessments/2')
    expect(rows[0]).toHaveTextContent('Profile One v5')
    expect(rows[1]).toHaveTextContent('Profile One v4')
    expect(rows[0]).toHaveTextContent('Latest')
  })

  it('shows the readings the revisions were based on', () => {
    renderPage('1')
    expect(screen.getByText('Readings these revisions were based on')).toBeInTheDocument()
  })

  it('reports an unknown revision instead of showing something else', () => {
    renderPage('9')
    expect(screen.getByRole('alert')).toHaveTextContent(/not found/)
  })

  it('shows a load error with retry, not an empty result', async () => {
    h.assessments.error = new Error('The database request failed.')
    renderPage('1')
    expect(screen.getByRole('alert')).toHaveTextContent(/database request failed/)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.assessments.refetch).toHaveBeenCalled()
  })

  it('links back to the test', () => {
    renderPage('1')
    expect(screen.getByRole('link', { name: /Back to the test/ })).toHaveAttribute('href', '/tests/s1')
  })
})

describe('DashboardPage', () => {
  it('shows real counts from the stored rows', () => {
    wrap(<DashboardPage />)
    const totals = screen.getByRole('region', { hidden: true, name: 'Totals' })
    expect(within(totals).getByText('Registered motors').nextElementSibling).toHaveTextContent('2')
    expect(within(totals).getByText('Test sessions').nextElementSibling).toHaveTextContent('3')
    expect(within(totals).getByText('Awaiting assessment').nextElementSibling).toHaveTextContent('1')
    expect(within(totals).getByText('Assessed tests').nextElementSibling).toHaveTextContent('1')
  })

  it('counts motors by the stored status of their current assessment, and separates "no assessment yet"', () => {
    wrap(<DashboardPage />)
    const status = screen.getByRole('region', { name: 'Motors by latest assessment' })
    expect(within(status).getByText('No assessment yet').nextElementSibling).toHaveTextContent('1') // M2
    expect(within(status).getByText('Normal').parentElement?.nextElementSibling).toHaveTextContent('1') // M1 at revision 2
    expect(within(status).getByText('Warning').parentElement?.nextElementSibling).toHaveTextContent('0') // revision 1 is history
    expect(status).toHaveTextContent(/not.*considered healthy/)
  })

  it('has quick actions and links recent items to the test and assessment revision', () => {
    wrap(<DashboardPage />)
    for (const name of ['Add motor', 'View motors', 'Start new test', 'View test history']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /M1 · revision 2/ })).toHaveAttribute('href', '/tests/s1/assessments/2')
  })

  it('shows an empty state with no fake numbers when there are no motors', () => {
    h.overview.data = ov({ motors: [], sessions: [], results: [] })
    wrap(<DashboardPage />)
    expect(screen.getByText('No motors registered')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting assessment')).not.toBeInTheDocument()
  })

  it('shows a loading state, not zeros', () => {
    h.overview = { data: undefined, isPending: true, error: null, refetch: vi.fn() }
    wrap(<DashboardPage />)
    expect(screen.getByRole('status')).toHaveTextContent(/Loading dashboard/)
    expect(screen.queryByText('Registered motors')).not.toBeInTheDocument()
  })

  it('shows an error with retry and NO counts when the query fails', async () => {
    h.overview = { data: undefined, isPending: false, error: new Error('You do not have permission to perform this action.'), refetch: vi.fn() }
    wrap(<DashboardPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/)
    expect(screen.queryByText('Registered motors')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.overview.refetch).toHaveBeenCalledTimes(1)
  })

  it('warns when the data is partial', () => {
    h.overview.data = ov({ truncated: { motors: false, sessions: true, results: false } })
    wrap(<DashboardPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Partial data.*tests/)
  })

  it('warns about assessed tests whose results are missing', () => {
    h.overview.data = ov({ results: [] })
    wrap(<DashboardPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/marked assessed but no stored assessment/)
  })
})

describe('TestHistoryPage', () => {
  it('distinguishes draft, submitted-but-unassessed and assessed tests', () => {
    wrap(<TestHistoryPage />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Draft') // newest first: s3
    expect(rows[0]).toHaveTextContent('Draft — cannot be assessed yet')
    expect(rows[1]).toHaveTextContent('Submitted — awaiting assessment') // s2
    expect(rows[1]).toHaveTextContent('Not assessed — awaiting assessment')
    expect(rows[2]).toHaveTextContent('Assessed') // s1
    expect(rows[2]).toHaveTextContent('Normal')
  })

  it('shows the latest revision of the stored assessment and links to it; earlier revisions stay reachable', () => {
    wrap(<TestHistoryPage />)
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Revision 2 of 2')) as HTMLElement
    expect(row).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'Open result' })).toHaveAttribute('href', '/tests/s1/assessments/2')
    expect(within(row).queryByText('Warning')).not.toBeInTheDocument() // revision 1 is not shown as current
  })

  it('links a draft to continue editing and a submitted test to view', () => {
    wrap(<TestHistoryPage />)
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/tests/s3')
    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute('href', '/tests/s2')
  })

  it('shows the empty state, error-with-retry and partial-data warning', async () => {
    h.overview.data = ov({ sessions: [], results: [] })
    const { unmount } = wrap(<TestHistoryPage />)
    expect(screen.getByText('No tests recorded')).toBeInTheDocument()
    unmount()

    h.overview = { data: undefined, isPending: false, error: new Error('The database request failed.'), refetch: vi.fn() }
    const second = wrap(<TestHistoryPage />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.overview.refetch).toHaveBeenCalled()
    second.unmount()

    h.overview = { data: ov({ truncated: { motors: false, sessions: false, results: true } }), isPending: false, error: null, refetch: vi.fn() }
    wrap(<TestHistoryPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Partial data/)
  })
})

describe('MotorHistory — motor to test to assessment', () => {
  it('shows the stored latest assessment with a link to the exact revision', () => {
    wrap(<MotorHistory motorId="m1" />)
    const latest = screen.getByRole('region', { name: 'Latest assessment' })
    expect(within(latest).getByText('Normal')).toBeInTheDocument()
    expect(within(latest).getByRole('link', { name: /revision 2/ })).toHaveAttribute('href', '/tests/s1/assessments/2')
    expect(latest).toHaveTextContent(/stored result of that test/)
  })

  it('distinguishes "no assessment" from a normal assessment', () => {
    h.overview.data = ov({ results: [] })
    wrap(<MotorHistory motorId="m1" />)
    expect(screen.getByText('No assessment recorded')).toBeInTheDocument()
    expect(screen.getByText(/does not mean it is healthy/)).toBeInTheDocument()
    expect(screen.queryByText('Normal')).not.toBeInTheDocument()
  })

  it('lists this motor\'s tests only, each linked to the test and its assessment', () => {
    wrap(<MotorHistory motorId="m1" />)
    const table = screen.getByRole('table', { name: 'Recent tests of this motor' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(table).getByRole('link', { name: 'Open result' })).toHaveAttribute('href', '/tests/s1/assessments/2')
    expect(within(table).getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/tests/s3')
    // a test with no stored assessment shows its own state, never an assessment status
    expect(within(table).getByText('Submitted — awaiting assessment')).toBeInTheDocument()
    expect(within(table).getByText('Draft')).toBeInTheDocument()
  })

  it('does not show another motor\'s tests', () => {
    wrap(<MotorHistory motorId="m2" />)
    expect(screen.getByText('No tests have been recorded for this motor.')).toBeInTheDocument()
    expect(screen.getByText('No assessment recorded')).toBeInTheDocument()
  })

  it('shows an error with retry instead of an empty history', async () => {
    h.overview = { data: undefined, isPending: false, error: new Error('The database request failed.'), refetch: vi.fn() }
    wrap(<MotorHistory motorId="m1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.overview.refetch).toHaveBeenCalled()
    expect(screen.queryByText('No assessment recorded')).not.toBeInTheDocument()
  })

  it('charts only comparable readings: a series with few points is explained, not drawn', async () => {
    h.readings.data = [
      { test_session_id: 's1', parameter_code: 'voltage', normalized_value: 1, normalized_unit: 'V', measurement_location: null },
      { test_session_id: 's2', parameter_code: 'voltage', normalized_value: 2, normalized_unit: 'V', measurement_location: null },
    ]
    wrap(<MotorHistory motorId="m1" />)
    expect(await screen.findByText(/A trend needs at least 3 comparable readings; this series has 2/)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-part')).not.toBeInTheDocument()
  })

  it('draws a chart when 3 comparable readings exist (chart module is loaded on demand)', async () => {
    h.overview.data = ov({
      sessions: [
        ...ov().sessions,
        { id: 's4', motor_id: 'm1', test_timestamp: '2026-07-01T00:00:00Z', measurement_method: null, status: 'submitted', created_at: '' },
      ],
    })
    h.readings.data = ['s1', 's2', 's4'].map((id, i) => ({ test_session_id: id, parameter_code: 'voltage', normalized_value: i + 1, normalized_unit: 'V', measurement_location: null }))
    wrap(<MotorHistory motorId="m1" />)
    expect(await screen.findByRole('img', { name: /Trend of Voltage in V/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-part').length).toBeGreaterThan(0)
  })

  it('says so when there are no submitted tests to trend', () => {
    h.overview.data = ov({ sessions: [ov().sessions[2]], results: [] })
    wrap(<MotorHistory motorId="m1" />)
    expect(screen.getByText(/Trends use submitted tests/)).toBeInTheDocument()
  })
})

describe('TrendChart series selection', () => {
  it('lets the user switch series and never merges them', async () => {
    const mk = (key: string, label: string, n: number) => ({
      key, parameterCode: 'voltage', parameterName: 'Voltage', unit: 'V', method: null, location: null, label,
      points: Array.from({ length: n }, (_, i) => ({ t: i + 1, value: i, sessionId: `${key}${i}` })), plottable: n >= 3,
    })
    wrap(<TrendChart series={[mk('a', 'Series A', 4), mk('b', 'Series B', 1)]} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByLabelText('Series'), 'b')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/this series has 1/)).toBeInTheDocument()
  })
})

describe('DiagnosticStatusBadge — partial coverage', () => {
  it('never shows a partial NORMAL as a plain "Normal"', async () => {
    const { default: Badge } = await import('./DiagnosticStatusBadge')
    const { rerender } = render(<Badge status="NORMAL" partial />)
    expect(screen.getByText('Normal (partial)')).toHaveAttribute('title', expect.stringMatching(/Not a statement that the motor is healthy/))
    expect(screen.queryByText('Normal', { exact: true })).not.toBeInTheDocument()
    rerender(<Badge status="NORMAL" />)
    expect(screen.getByText('Normal', { exact: true })).toBeInTheDocument()
    rerender(<Badge status="WARNING" partial />) // partial only affects NORMAL
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })
})
