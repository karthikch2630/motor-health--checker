/**
 * Partial coverage of a stored assessment: catalog parameters that the applied profile produced no finding for were NOT checked.
 * Display helper only; it never changes or recomputes a stored status.
 */
export function notCheckedParameters(
  findings: { parameter_code: string | null }[],
  catalogCodes: string[],
  profileApplied: boolean,
): string[] {
  if (!profileApplied) return []
  const checked = new Set(findings.map((f) => f.parameter_code))
  return catalogCodes.filter((c) => !checked.has(c))
}
