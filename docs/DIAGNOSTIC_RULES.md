# Diagnostic Rules — Motor Health Checker

**Version:** 1.0  
**Purpose:** Define how motor measurements are validated, compared with reference data and converted into diagnostic results.

---

## 1. Objective

The diagnostic engine evaluates measured motor parameters against approved reference values stored in the database.

It must determine whether the submitted readings are within applicable limits, require attention, indicate a possible fault, or are insufficient for assessment.

The diagnostic engine must be simple, explainable, testable and maintainable.

It must not use artificial intelligence or machine learning in the initial version.

## 2. Diagnostic Workflow

When a user submits a motor test, follow this sequence:

1. Validate the selected motor.
2. Retrieve its specifications.
3. Retrieve the applicable approved reference profile.
4. Validate the submitted measurements.
5. Validate measurement units.
6. Check required parameters and operating conditions.
7. Compare applicable readings against approved reference limits.
8. Evaluate any configured diagnostic rules.
9. Generate parameter-level findings.
10. Determine the overall assessment status.
11. Save the result and its findings.
12. Display an explanation to the user.

If the required reference information is unavailable, do not produce an unsupported healthy assessment.

## 3. Supported Parameters

The initial application may support the following parameters.

| Parameter | Unit | Evaluation |
|---|---|---|
| Voltage | V | Applicable voltage limits and imbalance rules |
| Current | A | Applicable current limits and imbalance rules |
| Temperature | °C | Applicable thermal limits |
| Vibration | mm/s or a defined acceleration unit | Applicable vibration limits |
| Rotational speed | RPM | Expected operating speed |
| Frequency | Hz | Applicable frequency limits |
| Power factor | Unitless | Optional, when reference data is available |

Each parameter must have a unique, consistent identifier, such as:

- `voltage`
- `current`
- `temperature`
- `vibration`
- `speed`
- `frequency`
- `power_factor`

The database and frontend must use consistent identifiers.

Additional parameters must not be evaluated until their units, applicable reference values and diagnostic rules are defined.

## 4. Reference Data Requirements

Every comparison must use an applicable reference value from an approved reference profile.

A reference profile should specify:

- Applicable motor type or configuration.
- Parameter identifier.
- Measurement unit.
- Lower and upper limits, when applicable.
- Warning thresholds, when applicable.
- Relevant operating conditions.
- Source of the reference value.
- Profile version and approval status.

### Rules

- Never invent engineering thresholds.
- Never assume one motor's limits apply to all motors.
- Do not use unapproved reference profiles for authoritative assessments.
- Do not compare values expressed in incompatible units.
- Do not evaluate a parameter against a reference profile that does not apply to the selected motor.
- Record which profile version was used.

If an applicable reference value is missing, return an insufficient-data result for the affected assessment.

## 5. Input Validation

Before comparing measurements, validate each submitted reading.

### Valid Input

A reading must:

- Contain a valid numeric value.
- Have a supported unit.
- Match the expected parameter.
- Be associated with the selected motor test.
- Satisfy applicable input validation rules.

### Invalid Input

Reject or flag:

- Missing required values.
- Non-numeric values.
- Unsupported units.
- Invalid unit conversions.
- Physically invalid measurements, where the relevant validation rule is established.
- Duplicate parameter readings when repeated measurements are not supported.
- Values submitted against an incompatible reference configuration.

Do not silently replace missing values with zero.

Do not treat missing values as evidence of normal operation.

## 6. Unit Normalization

Measurements and reference values must use compatible units before comparison.

For example, if a measurement is recorded in a supported unit different from the reference unit, convert it using a documented conversion function.

The system should:

1. Preserve the original value and unit.
2. Convert to the reference unit when the conversion is supported.
3. Validate the normalized value.
4. Compare normalized values.
5. Record the units used in the assessment.

Do not perform a comparison when the units are incompatible or the conversion is undefined.

Temperature conversions must account for the difference between absolute temperature scales and temperature intervals where relevant.

## 7. Basic Reference-Limit Comparison

For parameters with an approved lower and upper limit, use the applicable comparison rule.

Given:

- `measuredValue`
- `lowerLimit`, when defined
- `upperLimit`, when defined

A value is outside the configured range when it violates an applicable bound.

Conceptually:

```text
Below applicable lower limit:
    Flag a lower-limit violation.

Above applicable upper limit:
    Flag an upper-limit violation.

Within all applicable limits:
    No range violation detected.
```

The actual outcome must also account for warning thresholds, critical limits, operating conditions and parameter-specific rules.

Do not assume that all parameters have both lower and upper limits.

Do not automatically interpret a value outside a simple range as a confirmed equipment fault.

## 8. Warning and Critical Thresholds

A reference profile may define approved warning and critical thresholds.

The diagnostic engine must use those thresholds only when they are documented and applicable.

For example, an approved profile might define:

- An expected operating range.
- A warning threshold.
- A critical threshold.

When a measured value crosses a configured threshold, the engine should create a finding describing the observed condition.

The application must not assign arbitrary numeric warning or critical limits.

If the available reference data does not distinguish warning and critical conditions, the system must not invent that distinction.

## 9. Parameter-Specific Rules

### 9.1 Voltage

Compare voltage readings with the applicable reference values.

For three-phase motors, evaluate phase-to-phase or phase-to-neutral readings according to the measurement method and reference profile.

Voltage imbalance calculations require the appropriate phase measurements and a documented formula.

Do not infer voltage imbalance from a single voltage reading.

### 9.2 Current

Compare current measurements with the applicable motor specifications and operating conditions.

For three-phase current imbalance, require the appropriate phase-current measurements.

A high current reading may have several possible explanations, including excessive load or electrical problems. It must not automatically be classified as a confirmed winding fault.

### 9.3 Temperature

Compare the measured temperature with the applicable temperature reference.

The system should account for the specified measurement location and relevant operating conditions when required.

A temperature reading alone does not establish the cause of overheating.

### 9.4 Vibration

Evaluate vibration using the correct unit, measurement method and measurement location.

Do not compare vibration measurements taken using incompatible methods or units.

Possible causes may include imbalance, misalignment, looseness or bearing-related problems, but the actual cause requires appropriate evidence.

### 9.5 Rotational Speed

Compare the measured speed against an applicable expected speed or approved range.

Interpretation may depend on motor design, supply frequency, load and measurement method.

Do not assume that rated speed must equal measured speed under all operating conditions.

### 9.6 Frequency

Compare the measured frequency against applicable supply or operating specifications.

Do not interpret a frequency deviation as a confirmed motor defect without considering the measurement source and operating conditions.

### 9.7 Power Factor

Evaluate power factor only when a valid measurement and applicable reference rule are available.

Do not classify a motor as faulty based solely on an unsupported power-factor assumption.

## 10. Overall Assessment Status

Use these statuses consistently.

### NORMAL

All required parameters have been evaluated successfully against applicable approved references, and no configured abnormality has been identified.

### WARNING

One or more parameters require attention, but the configured rules do not establish a higher-severity suspected fault condition.

### FAULT_SUSPECTED

One or more approved diagnostic rules indicate a potential fault requiring further investigation.

This status represents a suspected condition, not a confirmed diagnosis.

### INSUFFICIENT_DATA

Required readings, reference values, measurement conditions or compatible units are missing or invalid.

The assessment cannot be completed reliably.

### NOT_ASSESSED

No diagnostic assessment has been completed.

This status may be used for a motor or draft test that has not yet been assessed.

## 11. Status Priority

When multiple findings exist, use the highest applicable severity while preserving every individual finding.

For example:

- If a test contains only normal findings, it may be `NORMAL` if all required checks are complete.
- If a test contains a warning and no higher-severity finding, it may be `WARNING`.
- If a validated rule indicates a suspected fault, the overall status may be `FAULT_SUSPECTED`.
- If a required parameter or reference value is missing, the result must not be presented as normal.

If the data is insufficient but an independently valid finding already indicates a suspected fault, preserve that finding and explain that the full assessment is incomplete. Do not hide a known abnormality simply because other data is missing.

The result should communicate both the known findings and the limitations of the assessment.

## 12. Diagnostic Findings

Each finding should contain:

- Parameter identifier.
- Observed value, when available.
- Observed unit.
- Applicable reference value or threshold.
- Severity.
- Diagnostic rule identifier.
- Explanation.
- Possible causes, when supported.
- Recommended inspection action, when available.

Example structure:

```json
{
  "parameterCode": "temperature",
  "observedValue": 85,
  "observedUnit": "°C",
  "severity": "WARNING",
  "ruleCode": "TEMP_LIMIT_EXCEEDED",
  "description": "The measured temperature exceeds the applicable approved reference limit.",
  "possibleCauses": [],
  "recommendedAction": "Verify the measurement and inspect the cooling conditions."
}
```

This is an illustrative output structure, not a real motor assessment or a recommended temperature threshold.

Only populate reference values, causes and actions when supported by the configured rule and available data.

## 13. Diagnostic Result Structure

The diagnostic engine should return a consistent structured result.

Suggested fields:

```text
testSessionId
overallStatus
summary
findings[]
missingParameters[]
referenceProfileId
referenceProfileVersion
diagnosticEngineVersion
assessedAt
```

Each finding should identify the parameter, rule, severity, observed measurement and explanation.

Keep the result structure consistent across the dashboard, test history and report generation.

## 14. TypeScript Implementation

Implement the diagnostic engine in:

`src/lib/diagnostics.ts`

Keep the core logic independent of React and direct database operations.

Suggested responsibilities:

- Validate measurements.
- Normalize supported units.
- Evaluate parameter rules.
- Generate findings.
- Determine the overall status.
- Return a structured result.

The diagnostic engine should receive validated measurements and the applicable reference profile as inputs.

Do not hardcode engineering thresholds inside the comparison functions.

Load reference values from the database and pass them into the diagnostic engine.

Use TypeScript types for all inputs and outputs.

## 15. Example Diagnostic Function Contract

A conceptual function signature is:

```typescript
type AssessmentStatus =
  | "NORMAL"
  | "WARNING"
  | "FAULT_SUSPECTED"
  | "INSUFFICIENT_DATA"
  | "NOT_ASSESSED";

interface DiagnosticInput {
  motorId: string;
  readings: Measurement[];
  referenceProfile: ApprovedReferenceProfile | null;
}

interface DiagnosticResult {
  overallStatus: AssessmentStatus;
  summary: string;
  findings: DiagnosticFinding[];
  missingParameters: string[];
}

function assessMotor(
  input: DiagnosticInput
): DiagnosticResult;
```

The supporting types must be defined in the application's type definitions and aligned with the actual database schema.

This contract is illustrative. Claude should adapt the exact types to the existing project rather than duplicating type definitions.

## 16. Testing Requirements

Use Vitest to test the diagnostic engine.

Test at least these cases:

1. All required readings are within approved limits.
2. A reading exceeds a warning threshold.
3. A reading exceeds an approved critical threshold.
4. A required measurement is missing.
5. An approved reference profile is missing.
6. A reference profile is not approved.
7. Units are incompatible.
8. A supported unit conversion is required.
9. A parameter has no applicable limit.
10. Multiple findings occur in one test.
11. One required parameter is missing while another valid parameter indicates a suspected fault.
12. An invalid or duplicate reading is submitted.
13. A reference profile changes after an assessment has already been saved.

Tests must use explicit sample data and expected results.

Do not use fabricated engineering thresholds as production defaults.

For test fixtures, clearly label any illustrative values as synthetic and keep them separate from approved reference data.

## 17. Error Handling

The diagnostic engine must handle missing or invalid data without crashing.

Return a clear result when:

- The motor does not exist.
- The reference profile cannot be found.
- The reference profile is not approved.
- Required readings are missing.
- Measurement units are unsupported.
- A comparison cannot be completed.
- A diagnostic rule cannot be evaluated.

Do not convert unexpected errors into a normal assessment.

Log technical errors appropriately without exposing sensitive information to the user.

## 18. Data Persistence

The diagnostic result must be saved with:

- Test session ID.
- Reference profile ID and version.
- Diagnostic engine version.
- Overall status.
- Assessment timestamp.
- Individual findings.

Do not silently overwrite previously issued assessments when the diagnostic rules or reference data change.

If a reassessment is required, preserve the previous result and create a traceable new assessment revision.

Do not report successful persistence until all required database operations have succeeded.

## 19. Limitations

The initial diagnostic engine is rule-based.

It evaluates the available measurements against configured reference data and rules.

It does not automatically establish the physical cause of every abnormal reading.

It does not guarantee detection of every motor fault.

It does not predict remaining useful life.

It does not replace qualified inspection, appropriate electrical safety procedures or dedicated protective systems.

Future predictive analytics may be introduced only after suitable data collection and validation.

## 20. Final Principle

The diagnostic engine must be transparent, deterministic for the same inputs and versioned reference data, and easy to test.

**Validate → Compare → Explain → Classify → Save.**

Never invent engineering thresholds, conceal missing data or present a suspected fault as a confirmed diagnosis.

---

## 21. Rule Specification v1.0.0 (implemented in Phase 6)

This section is the exact specification implemented by `src/lib/diagnostics.ts` (`DIAGNOSTIC_ENGINE_VERSION = "1.0.0"`).
It resolves the ambiguities left open in sections 7, 8 and 10. Decisions marked **[confirmed]** were made explicitly
by the project owner; the rest are conservative choices and are listed in section 21.9 for review.

### 21.1 Threshold semantics [confirmed]

Notation for one reference limit: `L = lower_limit`, `WL = warning_lower`, `WU = warning_upper`, `U = upper_limit`.
`null` means **not configured**. It is never read as zero, infinity or "healthy".

- `L` and `U` are the **approved hard boundaries**. Crossing one is a **CRITICAL** finding.
- `WL` and `WU` are **earlier warning thresholds inside** the hard boundaries. Crossing one (without crossing the hard
  boundary) is a **WARNING** finding.
- A valid configuration satisfies `L <= WL <= WU <= U` for every pair of values that are configured, in that order
  (e.g. `L` and `WU` set, nothing else: `L <= WU`). At least one of the four must be configured.
- **Boundaries are inclusive**: a value equal to `L`, `WL`, `WU` or `U` is *within* that boundary. A finding requires
  the value to be strictly beyond it.
- One-sided limits are supported: only the configured side is evaluated. A side with no hard boundary can never
  produce a CRITICAL finding on that side; a side with no warning threshold can never produce a WARNING there.
- A limit row that violates the ordering is **invalid configuration**; its parameter is not evaluated (21.4).

Per-parameter evaluation of a normalized value `v`:

| Condition (checked in this order) | Rule code | Severity |
|---|---|---|
| `L` set and `v < L` | `LIMIT_BELOW_LOWER` | CRITICAL |
| `U` set and `v > U` | `LIMIT_ABOVE_UPPER` | CRITICAL |
| `WL` set and `v < WL` | `WARNING_BELOW_LOWER` | WARNING |
| `WU` set and `v > WU` | `WARNING_ABOVE_UPPER` | WARNING |
| none of the above | `WITHIN_LIMITS` | INFO |

`applicable_limit` on a finding is the boundary that was crossed (for `WITHIN_LIMITS`, no single boundary applies, so it is null
and the description lists every configured boundary).

### 21.2 Which parameters are required

The approved reference profile defines what is checked: **every parameter that has a limit row in the profile is required**.
A reading for a parameter without a limit row is recorded (`DATA_NO_LIMIT_FOR_READING`, INFO) and **not evaluated**; it does
not block `NORMAL`. A profile cannot be approved without limits, so an approved profile always requires at least one parameter.

### 21.3 Applicability and profile selection

An assessment uses at most one reference profile, and only if it is **approved** and `checkProfileCompatibility` returns
`compatible` for the motor and the test date (motor type, effective dates, applicable specifications).

- No profile supplied, profile not approved, `incompatible`, or `unknown` (the motor lacks a specification the profile
  restricts): no limit is evaluated; status `INSUFFICIENT_DATA` with a `PROFILE_*` finding explaining why. For a profile that was
  not usable, the result stores **no** profile reference ("do not assign an unrelated profile").
- Several compatible profiles: the engine never chooses. The caller (the user) selects exactly one.

### 21.4 Reading and configuration validation (per required parameter)

A required parameter is **unevaluable** when any of these holds; an INFO finding is stored and evaluation of the others continues:

| Situation | Rule code |
|---|---|
| No reading for the parameter | `DATA_MISSING_READING` |
| More than one reading for the parameter | `DATA_DUPLICATE_READING` |
| Normalized value/unit absent or not a finite number | `DATA_INVALID_READING` |
| Normalized unit differs from the limit's unit (no conversion is attempted in the engine) | `DATA_UNIT_MISMATCH` |
| Limit thresholds violate 21.1 ordering or contain non-finite numbers, or no threshold is configured | `CONFIG_INVALID_THRESHOLDS` |

A measured `0` is a real value and is evaluated. Missing data is never replaced by zero.

### 21.5 Overall status [confirmed for FAULT_SUSPECTED]

Evaluated top to bottom; the first matching row applies.

| # | Condition | Status |
|---|---|---|
| 1 | Test session is a draft | `NOT_ASSESSED` |
| 2 | No usable profile (21.3), or the profile has no limits, or no readings were recorded | `INSUFFICIENT_DATA` |
| 3 | At least one CRITICAL finding | `FAULT_SUSPECTED` |
| 4 | At least one WARNING finding | `WARNING` |
| 5 | At least one required parameter is unevaluable (21.4) | `INSUFFICIENT_DATA` |
| 6 | Every required parameter was evaluated and none produced a WARNING or CRITICAL finding | `NORMAL` |

- `FAULT_SUSPECTED` means an approved hard boundary was crossed. It is a *suspected* condition for inspection, never a confirmed diagnosis.
- Rows 3 and 4 **preserve findings even when data is missing**. Such a result is flagged **incomplete**: the summary says so
  and the `DATA_*`/`CONFIG_*` findings list what could not be evaluated. A result is *complete* when it has no
  `DATA_*`, `CONFIG_*` or `PROFILE_*` finding.
- `NORMAL` is therefore only returned for a complete assessment.
- `NOT_ASSESSED` is a state of "no assessment performed" (a draft test, or a test with no stored result). It is never stored by
  the save operation.

### 21.6 Possible causes and recommended actions

No source-backed cause rules are configured, so `possible_causes` is always empty. WARNING and CRITICAL findings carry one
generic recommended action: verify the measurement (instrument, method, unit, location), then have a qualified person inspect
the motor under the applicable site procedures. Nothing is said about the physical cause of a deviation.

### 21.7 Persistence and traceability

A result stores the profile id and exact profile version used (null for `INSUFFICIENT_DATA` with no usable profile), the engine
version, the overall status, the summary and all findings. Result, findings and the session's move to `assessed` are written
by one database function (`save_diagnostic_assessment`, migration 011) in a single transaction. Reassessment adds a new
revision; earlier revisions are never modified. Retiring a profile or creating a new version does not touch stored results.

### 21.8 Out of scope in this version

Multi-phase quantities (voltage/current imbalance), multi-point vibration, trends and any rule that needs more than one
reading per parameter. The schema stores one reading per parameter per test, so these cannot be evaluated without a schema
change (see `DATABASE_DESIGN.md`, "Future schema changes").

### 21.9 Assumptions for review

1. Required parameters are the ones with limits in the profile (21.2).
2. Boundaries are inclusive (21.1).
3. A WARNING or CRITICAL finding outranks missing data (21.5 rows 3-4), and the result is flagged incomplete.
4. A reading without a limit does not block `NORMAL` (21.2).
5. An `unknown` applicability blocks evaluation (21.3).


---

## 22. Display conventions for stored results (Phase 7)

These rules govern how stored assessments are *shown*. Nothing in the display layer recomputes a status.

1. **Source of truth.** Every status, finding, value, boundary, profile id/version and rule version shown comes from the stored
   `diagnostic_results` / `diagnostic_findings` rows. Old revisions render exactly as saved, whatever has changed since
   (profile retired or re-versioned, rules updated).
2. **Latest revision.** The latest revision of a test is its highest `revision`. Earlier revisions stay reachable and are labelled "Earlier revision".
3. **Test state.** *Draft* (editable, cannot be assessed), *submitted – awaiting assessment* (no stored result), *assessed* (at least one stored result).
4. **A motor's current assessment** is the latest revision of its most recent test (by test date; ties by assessment time) that has a stored result.
   It describes that test, not today's condition. A motor with no stored assessment is shown as "No assessment" — never as normal or healthy.
5. **Incomplete results** (any `DATA_*`, `CONFIG_*` or `PROFILE_*` finding) always show a prominent note listing what could not be evaluated and
   stating that the result is not proof of health. Warning and critical findings in the same result stay visible.
6. **FAULT_SUSPECTED** is always accompanied by the statement that it requires verification and qualified inspection and is not a confirmed diagnosis.
7. **Trends** plot only stored normalized values of submitted/assessed tests and only within a group of identical parameter, normalized unit,
   measurement method text and measurement location text (blank = "not recorded", compared only with other blanks). At least 3 points are needed to
   draw a line. Phase imbalance and multi-point vibration trends are not derived: one reading per parameter per test is stored. Charts show no limits and make no judgement.
8. **Counts.** Dashboard figures are computed from fetched rows. When the database holds more rows than one request returns (1000), a "partial data"
   warning is shown. A failed query shows an error with retry, never zeros.


### 21.10 Partial coverage (engine 1.1.0)

Rule 21.2 makes the profile's limits the required checks, so a profile that covers fewer parameters than the catalog can still return `NORMAL`.
Engine 1.1.0 keeps every status unchanged but makes that visible: when the applied profile has no limit for some catalog parameters, it adds an
INFO finding `COVERAGE_PARTIAL` (no parameter, lists the unchecked ones), and the `NORMAL` summary begins "PARTIAL ASSESSMENT ... not a statement that the motor is healthy".
`COVERAGE_PARTIAL` does not make a result incomplete (`isAssessmentComplete` is unaffected). Display: the result view marks a NORMAL result with unchecked
parameters "Partial coverage" (also for revisions saved by engine 1.0.0, derived from the stored findings, never rewriting them); the dashboard shows how many
NORMAL motors are partial (counted from stored `COVERAGE_PARTIAL` findings only, so 1.0.0 revisions are not counted there). Earlier revisions are not modified.


### 21.11 Combined voltage/frequency rule and required load condition (engine 1.2.0)

**Source.** ANSI/NEMA MG 1-2016 (Rev. 2018), Section II, Part 12, clause 12.44.1 "Running", read from the NEMA-hosted PDF (see `REFERENCE_DATA_SOURCES.md`):
motors "shall operate successfully under running conditions **at rated load** with a variation in the voltage or the frequency up to": (a) ±10 % of rated voltage with rated
frequency (induction motors); (c) ±5 % of rated frequency with rated voltage; (d) "a combined variation in voltage and frequency of 10 percent (sum of absolute values) of the rated
values, provided the frequency variation does not exceed plus or minus 5 percent of rated frequency". Item (b) (universal motors) is out of scope.

**Rule (explicit, not two range checks).** Configured in the profile at `applicable_specs.combined_variation` (see `DATABASE_DESIGN.md`); no number is hard-coded in the engine:
`dV = (V - Vrated) / Vrated * 100`, `dF = (F - Frated) / Frated * 100`, where *Vrated* and *Frated* are the **motor's recorded rated voltage and frequency** ("the rated values").
The allowance is exceeded when `|dV| + |dF| > max_combined_percent` (10) **or** `|dF| > max_frequency_percent` (5). Signs do not matter. "Up to" is inclusive: a deviation exactly
on a limit is within it. Floating-point noise (1e-9 %) is absorbed; the entered value is otherwise judged exactly (instrument rounding is not corrected). Only the normalized readings in the catalog's
canonical units (V, Hz) are used; any other normalized unit makes the rule unassessed (no conversion in the engine). Individual ranges (a) and (c) remain ordinary warning thresholds (21.1).

**Findings.** `COMBINED_VF_SUM_EXCEEDED` and `COMBINED_VF_FREQUENCY_EXCEEDED` (WARNING; observed value = the percentage, unit `%`, boundary = the allowance), `COMBINED_VF_WITHIN` (INFO).
They are WARNINGs because the standard defines a tolerance within which the motor operates successfully, not a fault boundary; the text says so. `COMBINED_VF_WITHIN` states it checks
the supply tolerance only and does not demonstrate conformity of the motor or establish its health. A WARNING outranks missing data, so a violation is never hidden by passing checks or by
unassessed ones (21.5 rows 3-4); a passing check never removes another check's finding.

**Rated load.** The clause applies at rated load, which is not a measured quantity here. The test records an **operator-declared** load condition in
`test_sessions.operating_conditions.load_condition` (`rated`, `below_rated`, `above_rated`, `no_load`, `unknown`; entered on the test form, blank = not recorded). A limit or rule that requires a
load condition (`reference_limits.applicable_conditions.required_load_condition`, `combined_variation.required_load_condition`) is:
- **met** only when the recorded value equals the required value;
- **not established** when absent, `unknown`, unrecognised or not text -> `DATA_CONDITION_NOT_ESTABLISHED`;
- **not met** when a recognised different value -> `DATA_CONDITION_NOT_MET`.
Both are `DATA_*` findings: the check is *unassessed*, the assessment is *incomplete*, and the result cannot be NORMAL (INSUFFICIENT_DATA unless a WARNING/CRITICAL exists). No "within limits" finding is written for an unassessed
check. If the numbers are nevertheless outside the range/allowance, that finding is still written (so the deviation is visible) with a sentence that the condition is not established and the applicability is therefore not confirmed.
Submitted tests recorded before this field existed have no load condition, so these checks are reported as not assessed for them. Historical stored assessments are never recomputed.

**Other unassessed cases (`DATA_COMBINED_RULE_NOT_EVALUABLE`, incomplete):** voltage or frequency reading missing, duplicated, not numeric or not in V/Hz; motor rated voltage or frequency missing.
`CONFIG_INVALID_COMBINED_RULE`: malformed configuration (also blocks approval of the profile in the app).

**Limits of this implementation.** The load condition is a declaration, not verified (current vs rated current is deliberately not used as a proxy). Motors fed by a drive/inverter are outside the clause;
the profile's applicability cannot detect them. Only the 3-phase line-to-line RMS voltage as a single reading is modelled (phase voltage imbalance is out of scope, 21.8).

Tests: `src/lib/combinedVariation.test.ts` (boundaries, sign, noise, normalization, missing/duplicate/invalid readings, load condition, configuration) and `database/tests/baldor-seed.test.ts` (the seeded profile).
