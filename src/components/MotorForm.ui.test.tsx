// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MotorForm from './MotorForm'
import { EMPTY_MOTOR_FORM } from '../lib/motorSchema'

function setup(props: Partial<React.ComponentProps<typeof MotorForm>> = {}) {
  const onSubmit = vi.fn()
  render(
    <MemoryRouter>
      <MotorForm
        initialValues={EMPTY_MOTOR_FORM}
        submitLabel="Register motor"
        cancelTo="/motors"
        submitting={false}
        onSubmit={onSubmit}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('MotorForm', () => {
  it('shows field errors and does not submit when required fields are empty', async () => {
    const { onSubmit, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Register motor' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Motor tag is required')).toBeInTheDocument()
    expect(screen.getByLabelText(/Motor ID/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Motor ID/)).toHaveFocus()
  })

  it('submits parsed data for valid input', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/Motor ID/), 'M-001')
    await user.type(screen.getByLabelText(/Motor name/), 'Pump')
    await user.type(screen.getByLabelText(/Motor type/), 'induction')
    await user.type(screen.getByLabelText('Rated voltage (V)'), '400')
    await user.click(screen.getByRole('button', { name: 'Register motor' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      motor_tag: 'M-001', name: 'Pump', motor_type: 'induction', rated_voltage: 400, rated_current: null,
    })
  })

  it('flags a rated power without a unit', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/Motor ID/), 'M-1')
    await user.type(screen.getByLabelText(/Motor name/), 'N')
    await user.type(screen.getByLabelText(/Motor type/), 'T')
    await user.type(screen.getByLabelText('Rated power'), '5')
    await user.click(screen.getByRole('button', { name: 'Register motor' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Select a unit for the rated power')).toBeInTheDocument()
  })

  it('displays a database error and disables the button while saving', () => {
    setup({ serverError: 'A motor with this tag already exists.', submitting: true })
    expect(screen.getByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
  })
})
