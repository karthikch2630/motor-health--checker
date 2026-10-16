import type { Motor } from '../types/motor'

/** Case-insensitive search across identifying text fields, plus optional exact motor-type filter. */
export function filterMotors(motors: Motor[], search: string, motorType: string): Motor[] {
  const q = search.trim().toLowerCase()
  return motors.filter((m) => {
    if (motorType && m.motor_type !== motorType) return false
    if (!q) return true
    return [m.motor_tag, m.name, m.manufacturer, m.model, m.serial_number, m.location].some(
      (field) => field?.toLowerCase().includes(q),
    )
  })
}

/** Distinct motor types, sorted. */
export function motorTypes(motors: Motor[]): string[] {
  return [...new Set(motors.map((m) => m.motor_type))].sort((a, b) => a.localeCompare(b))
}
