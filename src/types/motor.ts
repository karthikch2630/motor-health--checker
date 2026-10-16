/** Row shape of public.motors (database/migrations/001_create_motors.sql). */
export interface Motor {
  id: string
  owner_id: string
  motor_tag: string
  name: string
  motor_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  rated_voltage: number | null
  rated_current: number | null
  rated_power: number | null
  power_unit: 'W' | 'kW' | null
  rated_frequency: number | null
  rated_rpm: number | null
  phase_count: number | null
  /** How the motor is supplied; null = not recorded (migration 013). */
  supply_type: 'line' | 'inverter' | null
  location: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Columns the user may write. owner_id, id and timestamps are set by the database. */
export type MotorInput = Omit<Motor, 'id' | 'owner_id' | 'created_at' | 'updated_at'>
