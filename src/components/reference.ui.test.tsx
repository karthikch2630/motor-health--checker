// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ConfirmDialog from './ConfirmDialog'
import LimitForm from './LimitForm'
import ReferenceDetailPage from '../pages/ReferenceDetailPage'
import { EMPTY_LIMIT_FORM } from '../lib/referenceSchema'
import type { ParameterDefinition, ReferenceLimit, ReferenceProfileWithLimits } from '../types/reference'

// SYNTHETIC fixtures for UI behaviour only; none of these values are engineering references.
const defs: ParameterDefinition[] = [
  { code: 'voltage', display_name: 'Voltage', description: 'Supply voltage', canonical_unit: 'V' },
  { code: 'temperature', display_name: 'Temperature', description: 'Temp', canonical_unit: '°C' },
]
const limit: ReferenceLimit = {
  id: 'l1', owner_id: 'o', reference_profile_id: 'p1', parameter_code: 'voltage', parameter_name: 'Voltage',
  unit: 'V', lower_limit: null, upper_limit: 10, warning_lower: null, warning_upper: null,
  applicable_conditions: {}, source_note: 'synthetic note', created_at: '2026-01-01T00:00:00Z',
}
const baseProfile: ReferenceProfileWithLimits = {
  id: 'p1', owner_id: 'o', name: 'SYNTHETIC profile', motor_type: 'induction', description: null,
  applicable_specs: { phase_count: 3 }, source_name: 'Synthetic source', source_reference: 'doc-1', version: 1,
  approval_status: 'draft', effective_from: '2026-01-01T00:00:00Z', effective_to: null,
  created_at: '2026-01-01T00:00:00Z', limits: [limit],
}

const stub = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null })
const hooks = vi.hoisted(() => ({
  profile: null as unknown,
  approve: null as unknown,
  retire: null as unknown,
  deleteLimit: null as unknown,
}))
vi.mock('../hooks/useReference', () => ({
  useProfile: () => ({ data: hooks.profile, isPending: false, error: null, refetch: vi.fn() }),
  useProfiles: () => ({ data: [] }),
  useParameterDefinitions: () => ({ data: defs, isPending: false, error: null }),
  useApproveProfile: () => hooks.approve,
  useRetireProfile: () => hooks.retire,
  useCreateNextVersion: () => stub(),
  useAddLimit: () => stub(),
  useUpdateLimit: () => stub(),
  useDeleteLimit: () => hooks.deleteLimit,
}))

function renderDetail(profile: Partial<ReferenceProfileWithLimits>) {
  hooks.profile = { ...baseProfile, ...profile }
  return render(
    <MemoryRouter initialEntries={['/reference/p1']}>
      <Routes>
        <Route path="/reference/:id" element={<ReferenceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  hooks.approve = stub()
  hooks.retire = stub()
  hooks.deleteLimit = stub()
})

describe('ReferenceDetailPage lifecycle controls', () => {
  it('draft without limits: cannot be approved and explains why', () => {
    renderDetail({ limits: [] })
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled()
    expect(screen.getByText(/no limits/i, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add limit/ })).toBeEnabled()
    expect(screen.getByText(/cannot be used for assessments/i)).toBeInTheDocument()
  })

  it('draft with limits: approval needs a dialog, an acknowledgement, and an explicit click', async () => {
    renderDetail({})
    const user = userEvent.setup()
    const approve = hooks.approve as ReturnType<typeof stub>
    await user.click(screen.getByRole('button', { name: /Approve/ }))
    const dialog = screen.getByRole('dialog')
    expect(approve.mutate).not.toHaveBeenCalled()
    const confirm = within(dialog).getByRole('button', { name: 'Approve profile' })
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox'))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(approve.mutate).toHaveBeenCalledTimes(1)
  })

  it('draft: shows the database rejection inside the approval dialog', async () => {
    renderDetail({})
    ;(hooks.approve as ReturnType<typeof stub>).error = new Error('Add at least one limit before approving this profile.')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Approve/ }))
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(/at least one limit/)
  })

  it('draft: removing a limit requires confirmation', async () => {
    renderDetail({})
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Voltage limit' }))
    expect((hooks.deleteLimit as ReturnType<typeof stub>).mutate).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove limit' }))
    expect((hooks.deleteLimit as ReturnType<typeof stub>).mutate).toHaveBeenCalledTimes(1)
  })

  it('approved: offers no way to edit the profile or its limits, only retire / new version', () => {
    renderDetail({ approval_status: 'approved' })
    expect(screen.queryByRole('button', { name: /Add limit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Voltage limit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Voltage limit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retire/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create new version/ })).toBeInTheDocument()
    expect(screen.getByText(/immutable/i)).toBeInTheDocument()
  })

  it('retired: no retire/approve/edit actions, new version still possible', () => {
    renderDetail({ approval_status: 'retired' })
    expect(screen.queryByRole('button', { name: /Retire/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add limit/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create new version/ })).toBeInTheDocument()
  })

  it('retiring requires confirmation and says history is preserved', async () => {
    renderDetail({ approval_status: 'approved' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Retire/ }))
    expect((hooks.retire as ReturnType<typeof stub>).mutate).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByText(/not changed/i)).toBeInTheDocument()
  })

  it('shows missing limit values as "not set", never as 0', () => {
    renderDetail({})
    const row = screen.getByRole('row', { name: /Voltage/ })
    expect(within(row).getAllByText('not set')).toHaveLength(3)
    expect(within(row).getByText('10')).toBeInTheDocument()
  })

  it('flags a unit that differs from the catalog', () => {
    renderDetail({ limits: [{ ...limit, unit: 'kV' }] })
    expect(screen.getByText(/canonical: V/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled()
  })
})

describe('LimitForm', () => {
  function setup(selectable = ['voltage', 'temperature']) {
    const onSubmit = vi.fn()
    render(
      <LimitForm
        initialValues={EMPTY_LIMIT_FORM}
        definitions={defs}
        selectableCodes={selectable}
        lockParameter={false}
        submitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    return { onSubmit, user: userEvent.setup() }
  }

  it('shows the canonical unit from the catalog and offers no free-text unit field', async () => {
    const { user } = setup()
    expect(screen.queryByLabelText(/^Unit/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/Parameter/), 'temperature')
    expect(screen.getByText('Unit: °C')).toBeInTheDocument()
    expect(screen.getByLabelText(/Upper limit \(°C\)/)).toBeInTheDocument()
  })

  it('only offers parameters not yet used in the profile', () => {
    setup(['temperature'])
    expect(screen.queryByRole('option', { name: /Voltage/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Temperature/ })).toBeInTheDocument()
  })

  it('rejects a form with no thresholds and does not submit', async () => {
    const { onSubmit, user } = setup()
    await user.selectOptions(screen.getByLabelText(/Parameter/), 'voltage')
    await user.type(screen.getByLabelText(/Source note/), 'note')
    await user.click(screen.getByRole('button', { name: 'Add limit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one limit/i)
  })

  it('rejects a lower limit above the upper limit', async () => {
    const { onSubmit, user } = setup()
    await user.selectOptions(screen.getByLabelText(/Parameter/), 'voltage')
    await user.type(screen.getByLabelText(/Lower limit/), '20')
    await user.type(screen.getByLabelText(/^Upper limit/), '10')
    await user.type(screen.getByLabelText(/Source note/), 'note')
    await user.click(screen.getByRole('button', { name: 'Add limit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Lower limit must not exceed/)).toBeInTheDocument()
  })

  it('submits catalog-derived name and unit', async () => {
    const { onSubmit, user } = setup()
    await user.selectOptions(screen.getByLabelText(/Parameter/), 'voltage')
    await user.type(screen.getByLabelText(/^Upper limit/), '10')
    await user.type(screen.getByLabelText(/Source note/), 'note')
    await user.click(screen.getByRole('button', { name: 'Add limit' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ parameter_code: 'voltage', parameter_name: 'Voltage', unit: 'V', upper_limit: 10, lower_limit: null }),
    )
  })
})

describe('ConfirmDialog', () => {
  it('cancels on Escape and starts focus on Cancel', async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="T" confirmLabel="Go" onConfirm={vi.fn()} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.setup().keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
