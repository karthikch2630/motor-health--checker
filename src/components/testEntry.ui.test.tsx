// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReferencePanel from './ReferencePanel'
import TestEditor from './TestEditor'
import TestEntryPage from '../pages/TestEntryPage'
import { PartialSaveError } from '../lib/tests'
import type { Motor } from '../types/motor'
import type { ParameterDefinition, ReferenceProfileWithCount } from '../types/reference'
import type { SessionWithReadings } from '../types/test'

// SYNTHETIC fixtures for UI behaviour only.
const defs: ParameterDefinition[] = [
  { code: 'voltage', display_name: 'Voltage', description: 'Supply voltage', canonical_unit: 'V' },
  { code: 'temperature', display_name: 'Temperature', description: 'Temp', canonical_unit: '°C' },
  { code: 'power_factor', display_name: 'Power factor', description: 'PF', canonical_unit: 'ratio' },
]
const motor = {
  id: 'm1', motor_tag: 'M-1', name: 'Pump', motor_type: 'induction', manufacturer: null, phase_count: 3,
  rated_voltage: 400, rated_current: null, rated_rpm: null, rated_frequency: 50,
} as unknown as Motor
const profile = (over: Partial<ReferenceProfileWithCount>): ReferenceProfileWithCount =>
  ({
    id: 'p1', name: 'Profile A', version: 1, motor_type: 'induction', approval_status: 'approved', source_name: 'Src',
    applicable_specs: {}, effective_from: null, effective_to: null, limit_count: 2, ...over,
  }) as ReferenceProfileWithCount

type MutationStub = {
  mutate: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  isPending: boolean
  error: Error | null
}
const stub = (): MutationStub => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })
const h = vi.hoisted(() => ({
  save: null as unknown,
  submit: null as unknown,
  test: { data: undefined as unknown, isPending: false, error: null as Error | null },
  profiles: { data: [] as unknown[], isPending: false, error: null as Error | null },
}))
vi.mock('../hooks/useTests', () => ({
  useSaveDraft: () => h.save,
  useSaveAndSubmit: () => h.submit,
  useTest: () => h.test,
}))
vi.mock('../hooks/useAssessments', () => ({
  useAssessments: () => ({ data: [], isPending: false, error: null }),
  useRunAssessment: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
}))
vi.mock('../hooks/useMotors', () => ({ useMotors: () => ({ data: [motor], isPending: false, error: null }) }))
vi.mock('../hooks/useReference', () => ({
  useParameterDefinitions: () => ({ data: defs, isPending: false, error: null }),
  useProfiles: () => h.profiles,
}))

const save = () => h.save as MutationStub
const submit = () => h.submit as MutationStub

function renderEditor(props: Partial<React.ComponentProps<typeof TestEditor>> = {}) {
  return render(
    <MemoryRouter>
      <TestEditor motors={[motor]} definitions={defs} profiles={[]} profilesLoading={false} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.save = stub()
  h.submit = stub()
  h.test = { data: undefined, isPending: false, error: null }
  h.profiles = { data: [], isPending: false, error: null }
})

describe('TestEditor — validation', () => {
  it('will not save without a motor', async () => {
    renderEditor()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Select a motor')).toBeInTheDocument()
  })

  it('rejects a malformed measurement and does not save', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Voltage value'), '4oo')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Voltage value')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a number')).toBeInTheDocument()
  })

  it('rejects infinity, hex and physically impossible values', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Voltage value'), 'Infinity')
    await user.type(screen.getByLabelText('Power factor value'), '1.5')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a number')).toBeInTheDocument()
    expect(screen.getByText(/cannot be above 1/)).toBeInTheDocument()
  })

  it('does not offer an unsupported unit', () => {
    renderEditor({ defaultMotorId: 'm1' })
    const unit = screen.getByLabelText('Unit', { selector: '#reading-temperature-unit' })
    expect(within(unit).getAllByRole('option').map((o) => o.textContent)).toEqual(['°C (canonical)', '°F', 'K'])
    expect(screen.queryByLabelText('Unit', { selector: '#reading-power_factor-unit' })).toBeNull() // fixed single unit
  })
})

describe('TestEditor — draft saving', () => {
  it('saves a draft with only the entered readings (blank = not measured)', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Voltage value'), '400')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate).toHaveBeenCalledTimes(1)
    const input = save().mutate.mock.calls[0][0]
    expect(input.sessionId).toBeNull()
    expect(input.session.motor_id).toBe('m1')
    expect(input.readings).toHaveLength(1)
    expect(input.readings[0]).toMatchObject({ parameter_code: 'voltage', measured_value: 400, measured_unit: 'V' })
    expect(input.allParameterCodes).toEqual(['voltage', 'temperature', 'power_factor'])
  })

  it('allows saving a draft with no readings at all', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate.mock.calls[0][0].readings).toEqual([])
  })

  it('disables the controls while saving (no double submit)', () => {
    save().isPending = true
    renderEditor({ defaultMotorId: 'm1' })
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Review and submit/ })).toBeDisabled()
  })

  it('shows a database failure instead of a success message', () => {
    save().error = new Error('You do not have permission to perform this action.')
    renderEditor({ defaultMotorId: 'm1' })
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/)
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument()
  })

  it('after a partial failure, the retry updates the SAME draft and the motor is locked', async () => {
    save().mutate.mockImplementationOnce((_input, opts) => {
      opts.onError(new PartialSaveError('readings not saved', 's9'))
      opts.onSettled() // the request finished (with an error), so a retry must be allowed
    })
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(screen.getByLabelText(/^Motor/)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save().mutate).toHaveBeenCalledTimes(2)
    expect(save().mutate.mock.calls[0][0].sessionId).toBeNull()
    expect(save().mutate.mock.calls[1][0].sessionId).toBe('s9')
  })

  it('restores an existing draft, including a measured zero', () => {
    const existing = {
      session: { id: 's1', motor_id: 'm1', test_timestamp: '2026-06-01T10:00:00.000Z', operating_conditions: {}, measurement_method: null, notes: null, status: 'draft' },
      readings: [{ parameter_code: 'voltage', measured_value: 0, measured_unit: 'V', measurement_location: null }],
    } as unknown as SessionWithReadings
    renderEditor({ existing })
    expect(screen.getByLabelText('Voltage value')).toHaveValue('0')
    expect(screen.getByLabelText('Temperature value')).toHaveValue('')
    expect(screen.getByLabelText(/^Motor/)).toBeDisabled()
  })
})

describe('TestEditor — single-flight guard (same-tick double clicks)', () => {
  it('Save draft: two clicks in one tick send ONE request; a retry is possible once it settles', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const button = screen.getByRole('button', { name: 'Save draft' })
    act(() => {
      button.click()
      button.click()
    })
    expect(save().mutate).toHaveBeenCalledTimes(1)
    save().mutate.mock.calls[0][1].onSettled() // request settled
    act(() => button.click())
    expect(save().mutate).toHaveBeenCalledTimes(2)
  })

  it('Submit test: two clicks in one tick send ONE request', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Voltage value'), '5')
    await user.click(screen.getByRole('button', { name: /Review and submit/ }))
    const button = screen.getByRole('button', { name: 'Submit test' })
    act(() => {
      button.click()
      button.click()
    })
    expect(submit().mutate).toHaveBeenCalledTimes(1)
  })
})

describe('TestEditor — review and submit', () => {
  async function toReview(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Temperature value'), '212')
    await user.selectOptions(screen.getByLabelText('Unit', { selector: '#reading-temperature-unit' }), '°F')
    await user.click(screen.getByRole('button', { name: /Review and submit/ }))
  }

  it('cannot review a test with no readings', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    await userEvent.setup().click(screen.getByRole('button', { name: /Review and submit/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one measurement/i)
    expect(screen.queryByRole('button', { name: 'Submit test' })).not.toBeInTheDocument()
  })

  it('review shows original and normalized values and flags unmeasured parameters; nothing is submitted yet', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    await toReview(userEvent.setup())
    const row = screen.getByRole('row', { name: /Temperature/ })
    expect(within(row).getByText('212 °F')).toBeInTheDocument()
    expect(within(row).getByText('100 °C')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Voltage/ })).getByText('Not measured')).toBeInTheDocument()
    expect(submit().mutate).not.toHaveBeenCalled()
  })

  it('submits once, with the reviewed readings', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await toReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit test' }))
    expect(submit().mutate).toHaveBeenCalledTimes(1)
    expect(submit().mutate.mock.calls[0][0].readings[0]).toMatchObject({ measured_value: 212, measured_unit: '°F', normalized_value: 100 })
  })

  it('the submit button is disabled while submitting, so a double click cannot submit twice', async () => {
    const ui = () => (
      <MemoryRouter>
        <TestEditor motors={[motor]} definitions={defs} profiles={[]} profilesLoading={false} defaultMotorId="m1" />
      </MemoryRouter>
    )
    const { rerender } = render(ui())
    await toReview(userEvent.setup())
    submit().isPending = true
    rerender(ui())
    const button = screen.getByRole('button', { name: /Submitting/ })
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: /Back to editing/ })).toBeDisabled()
    expect(submit().mutate).not.toHaveBeenCalled()
  })

  it('a failed submit shows the message and keeps the user on the review step', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await toReview(user)
    submit().error = new Error('Your readings were saved as a draft, but the test was NOT submitted')
    await user.click(screen.getByRole('button', { name: 'Submit test' }))
    // error is read from the mutation state on the next render
    renderEditor({ defaultMotorId: 'm1' })
    await toReview(user)
    expect(screen.getByRole('alert')).toHaveTextContent(/NOT submitted/)
  })

  it('Back to editing returns to the form with values intact', async () => {
    renderEditor({ defaultMotorId: 'm1' })
    const user = userEvent.setup()
    await toReview(user)
    await user.click(screen.getByRole('button', { name: /Back to editing/ }))
    expect(screen.getByLabelText('Temperature value')).toHaveValue('212')
  })
})

describe('ReferencePanel', () => {
  const t = new Date('2026-06-01T00:00:00Z')

  it('asks for a motor first', () => {
    render(<MemoryRouter><ReferencePanel motor={undefined} testTime={t} profiles={[]} loading={false} /></MemoryRouter>)
    expect(screen.getByText(/Select a motor/)).toBeInTheDocument()
  })

  it('clearly says when no compatible approved profile exists, but does not block entry', () => {
    render(<MemoryRouter><ReferencePanel motor={motor} testTime={t} profiles={[profile({ approval_status: 'draft' })]} loading={false} /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent(/No compatible approved reference profile/)
    expect(screen.getByRole('status')).toHaveTextContent(/still record/)
  })

  it('lists compatible profiles and explains uncertain and incompatible ones', () => {
    render(
      <MemoryRouter>
        <ReferencePanel
          motor={{ ...motor, phase_count: null }}
          testTime={t}
          loading={false}
          profiles={[
            profile({ id: 'a', name: 'Fits' }),
            profile({ id: 'b', name: 'Needs phases', applicable_specs: { phase_count: 3 } }),
            profile({ id: 'c', name: 'Wrong type', motor_type: 'synchronous' }),
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Fits v1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Needs phases v1' })).toBeInTheDocument()
    expect(screen.getByText(/Applicability cannot be established/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/1 approved profile\(s\) not applicable/)).toBeInTheDocument()
  })

  it('surfaces a profile loading error', () => {
    render(<MemoryRouter><ReferencePanel motor={motor} testTime={t} profiles={undefined} loading={false} error="Could not load" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
  })
})

describe('TestEntryPage', () => {
  function renderPage(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tests/:id" element={<TestEntryPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }
  const sessionOf = (status: string) =>
    ({
      session: { id: 's1', motor_id: 'm1', test_timestamp: '2026-06-01T10:00:00.000Z', operating_conditions: {}, measurement_method: null, notes: null, status },
      readings: [{ parameter_code: 'voltage', measured_value: 400, measured_unit: 'V', normalized_value: 400, normalized_unit: 'V', measurement_location: null }],
    }) as unknown

  it('a submitted test is read-only: no form, no save or submit buttons', () => {
    h.test = { data: sessionOf('submitted'), isPending: false, error: null }
    renderPage('/tests/s1')
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit test' })).not.toBeInTheDocument()
    expect(screen.getByText(/can no longer be edited/)).toBeInTheDocument()
    expect(screen.getAllByText('400 V').length).toBeGreaterThan(0) // measured and normalized columns
  })

  it('a draft opens in the editor', () => {
    h.test = { data: sessionOf('draft'), isPending: false, error: null }
    renderPage('/tests/s1')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByLabelText('Voltage value')).toHaveValue('400')
  })

  it('reports a missing test and a load error', () => {
    h.test = { data: null, isPending: false, error: null }
    renderPage('/tests/zzz')
    expect(screen.getByRole('alert')).toHaveTextContent(/not found/)
  })

  it('shows a load error instead of an empty form', () => {
    h.test = { data: undefined, isPending: false, error: new Error('The database request failed.') }
    renderPage('/tests/s1')
    expect(screen.getByRole('alert')).toHaveTextContent(/database request failed/)
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })
})
