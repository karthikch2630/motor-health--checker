import { describe, expect, it } from 'vitest'
import { filterMotors, motorTypes } from './motorFilters'
import type { Motor } from '../types/motor'

const base: Motor = {
  id: '', owner_id: 'o', motor_tag: '', name: '', motor_type: 'induction',
  manufacturer: null, model: null, serial_number: null, rated_voltage: null, rated_current: null,
  rated_power: null, power_unit: null, rated_frequency: null, rated_rpm: null, phase_count: null, supply_type: null,
  location: null, notes: null, created_at: '', updated_at: '',
}
const motors: Motor[] = [
  { ...base, id: '1', motor_tag: 'P-100', name: 'Feed pump', manufacturer: 'Acme', location: 'Plant A' },
  { ...base, id: '2', motor_tag: 'F-200', name: 'Fan', motor_type: 'synchronous', serial_number: 'SN-9' },
]

describe('filterMotors', () => {
  it('returns everything without criteria', () => expect(filterMotors(motors, '', '')).toHaveLength(2))
  it('searches case-insensitively across fields, ignoring nulls', () => {
    expect(filterMotors(motors, 'acme', '').map((m) => m.id)).toEqual(['1'])
    expect(filterMotors(motors, 'sn-9', '').map((m) => m.id)).toEqual(['2'])
    expect(filterMotors(motors, '  plant a ', '').map((m) => m.id)).toEqual(['1'])
  })
  it('filters by motor type and combines with search', () => {
    expect(filterMotors(motors, '', 'synchronous').map((m) => m.id)).toEqual(['2'])
    expect(filterMotors(motors, 'pump', 'synchronous')).toEqual([])
  })
})

describe('motorTypes', () => {
  it('returns distinct sorted types', () => {
    expect(motorTypes([...motors, { ...base, id: '3' }])).toEqual(['induction', 'synchronous'])
  })
})
