# Database Design — Motor Health Checker

**Version:** 1.0  
**Database:** PostgreSQL via Supabase  
**ORM:** None required  
**Database Access:** Supabase JavaScript Client  
**Migration Tool:** Supabase SQL migrations  
**Purpose:** Store motor specifications, reference parameters, test readings and diagnostic results.

---

## 1. Database Objectives

The database must support the following workflow:

1. Register an electric motor.
2. Store the motor's specifications.
3. Store approved reference parameter values.
4. Record measured motor parameters.
5. Compare measurements with applicable reference values.
6. Save the diagnostic assessment.
7. Retrieve previous tests and results.

Keep the database simple, reliable and easy to maintain.

Use PostgreSQL tables, foreign keys, constraints and indexes instead of introducing unnecessary infrastructure.

## 2. Database Architecture

The application uses Supabase PostgreSQL as its primary database.

The React frontend communicates with Supabase using the Supabase JavaScript client.

The initial architecture is:

React Application → Supabase Client → PostgreSQL Database

Diagnostic calculations are performed by a reusable TypeScript module in the frontend for the initial prototype. Database policies must protect stored data.

If diagnostic execution or authorization later requires trusted server-side logic, move the relevant operations to a suitable server-side component without changing the overall data model unnecessarily.

## 3. Database Tables

The initial database consists of eight core tables:

1. `motors`
2. `parameter_definitions`
3. `reference_profiles`
4. `reference_limits`
5. `test_sessions`
6. `test_readings`
7. `diagnostic_results`
8. `diagnostic_findings`

The schema should remain small. Add tables only when a genuine requirement justifies them.

---

## 3A. Ownership and Access Model (implemented in Phase 2)

The MVP uses Supabase Auth with a **single authorized user**.

- Every private table (`motors`, `reference_profiles`, `reference_limits`, `test_sessions`, `test_readings`, `diagnostic_results`, `diagnostic_findings`) has `owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id)`.
- RLS policies allow the `authenticated` role to access only rows where `owner_id = auth.uid()`. The `anon` role has no privileges on any application table.
- Parent tables expose `UNIQUE (id, owner_id)`. Child tables use composite foreign keys `(parent_id, owner_id)`, so a row cannot reference another owner's parent. Policies therefore need no joins.
- `parameter_definitions` is global metadata: read-only for authenticated users, changed only by migrations.
- `diagnostic_results` and `diagnostic_findings` are insert/select only (no UPDATE or DELETE privilege). Triggers also reject modification.
- Foreign keys use `ON DELETE RESTRICT`. Nothing cascades, so history cannot be lost implicitly. Only draft test sessions and draft reference profiles can be deleted.

---

## 4. Table: motors

Stores registered electric motor information.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Unique motor identifier |
| motor_tag | TEXT | Required, unique | Equipment tag |
| name | TEXT | Required | Motor name |
| motor_type | TEXT | Required | Motor type |
| manufacturer | TEXT | Optional | Manufacturer |
| model | TEXT | Optional | Model |
| serial_number | TEXT | Optional | Serial number |
| rated_voltage | NUMERIC | Optional | Rated voltage in V |
| rated_current | NUMERIC | Optional | Rated current in A |
| rated_power | NUMERIC | Optional | Rated power |
| power_unit | TEXT | Optional | W or kW |
| rated_frequency | NUMERIC | Optional | Rated frequency in Hz |
| rated_rpm | INTEGER | Optional | Rated rotational speed |
| phase_count | SMALLINT | Optional | Number of phases |
| supply_type | TEXT | Optional | `line` (fixed-frequency line supply) or `inverter` (drive-fed); NULL = not recorded. Added by migration 013. A profile whose `applicable_specs.supply_type` is set is applied only when the motor's value equals it; NULL gives applicability UNKNOWN (no limits applied) |
| location | TEXT | Optional | Installation location |
| notes | TEXT | Optional | Additional information |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |
| updated_at | TIMESTAMPTZ | Required | Last update timestamp |

### Rules

- Generate `id` using PostgreSQL's UUID generation functionality.
- `motor_tag` is unique per owner (`UNIQUE (owner_id, motor_tag)`), which is equivalent to global uniqueness for the single-user MVP.
- `power_unit` is required when `rated_power` is set.
- Use numeric types for measurements.
- Validate units and reasonable values.
- Do not require every optional specification for every motor type.

For the initial single-user prototype, a globally unique motor tag is sufficient. If multiple organizations are introduced later, add an organization identifier and use organization-scoped uniqueness.

---

## 4A. Table: parameter_definitions

Defines the supported measurement parameters. This table holds **metadata only**; engineering limits belong to reference profiles and `reference_limits`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| code | TEXT | Primary key | Stable identifier, e.g. `voltage` |
| display_name | TEXT | Required | Display name |
| description | TEXT | Optional | Parameter description |
| canonical_unit | TEXT | Required | Unit used for reference limits and normalized readings |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |

### Rules

- Codes: `voltage`, `current`, `temperature`, `vibration`, `speed`, `frequency`, `power_factor`, seeded by migration 002.
- Canonical units: V, A, °C, mm/s, RPM, Hz and `ratio` (power factor is dimensionless). **Assumption:** vibration uses mm/s; confirm or change before Phase 5.
- `reference_limits.parameter_code`, `test_readings.parameter_code` and `diagnostic_findings.parameter_code` reference this table.
- Add a parameter only together with its unit, reference data and documented diagnostic rule.

---

## 5. Table: reference_profiles

Stores approved reference configurations for evaluating motor readings.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Reference profile identifier |
| name | TEXT | Required | Profile name |
| motor_type | TEXT | Required | Applicable motor type |
| description | TEXT | Optional | Profile description |
| applicable_specs | JSONB | Required (default {}) | Applicable motor specifications/configuration, e.g. phase count |
| source_name | TEXT | Required | Source of reference data |
| source_reference | TEXT | Optional | Document, standard or URL reference |
| version | INTEGER | Required | Profile version |
| approval_status | TEXT | Required | Draft, approved or retired |
| effective_from | TIMESTAMPTZ | Optional | Effective date |
| effective_to | TIMESTAMPTZ | Optional | Expiration date |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |

### Rules

- Reference profiles must identify their sources.
- Only approved profiles may be used for normal diagnostic assessments.
- Profiles must be versioned.
- Updating a reference profile must not silently change the interpretation of previous assessments.
- A profile must contain enough information to determine whether it applies to the motor and its operating conditions.
- Lifecycle: `draft` → `approved` → `retired`. A profile needs at least one limit to be approved. Approved and retired profiles are immutable (an approved profile may only be retired) and their limits cannot change; create a new version instead. Only drafts can be deleted.
- `(owner_id, name, version)` is unique. No profile rows are seeded.
- `version` is the version of the profile itself, not of the source document. Record the document edition/revision in `source_reference`.
- There is no separate "submitted for approval" state. The documented lifecycle is `draft → approved → retired`; approval is one explicit, confirmed user action (single-user MVP).
- `applicable_specs` keys written by the Phase 4 UI (all optional, other keys are preserved): `phase_count` (integer), `rated_frequency_hz` (number), `rated_voltage_min_v`, `rated_voltage_max_v` (numbers). Absent key = "not restricted by this field". Also interpreted: `supply_type` (`line` | `inverter`; compared with `motors.supply_type`, migration 013; a motor with NULL gives applicability UNKNOWN) and `combined_variation` (see below). Matching a motor to a profile is implemented in a later phase.
- A new version is a new draft row (same `name`, next `version`) with copied limits. The previous version is never modified, and saved assessments keep pointing at the version they used. Retiring sets `approval_status = 'retired'` and `effective_to`.

Do not insert invented engineering thresholds as approved reference values.

---

## 6. Table: reference_limits

Stores the reference limits associated with a particular parameter and reference profile.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Reference limit identifier |
| reference_profile_id | UUID | Foreign key | Associated profile |
| parameter_code | TEXT | Required | Parameter identifier |
| parameter_name | TEXT | Required | Display name |
| unit | TEXT | Required | Measurement unit |
| lower_limit | NUMERIC | Optional | Applicable lower limit |
| upper_limit | NUMERIC | Optional | Applicable upper limit |
| warning_lower | NUMERIC | Optional | Lower warning threshold |
| warning_upper | NUMERIC | Optional | Upper warning threshold |
| applicable_conditions | JSONB | Optional | Conditions for evaluation |
| source_note | TEXT | Required | Explanation or source details |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |

### Rules

- `reference_profile_id` references `reference_profiles.id`.
- Define the meaning of every configured threshold in the diagnostic rules.
- Do not assume that every parameter uses a simple minimum and maximum.
- Use the appropriate comparison method for each parameter.
- Enforce valid threshold combinations.
- Prevent ambiguous duplicate parameter configurations within the same profile: one row per `(reference_profile_id, parameter_code)`. Conditional variants need a separate profile.
- `unit` must equal `parameter_definitions.canonical_unit`. The database does not enforce this; the application takes the unit and `parameter_name` from the catalog and blocks approval if a stored unit differs.
- NULL thresholds mean "not specified" (never zero, never unlimited). `applicable_conditions.description` holds free-text operating conditions written by the UI (other keys are preserved).
- Only structural consistency is enforced in the database (`lower_limit <= upper_limit`, `warning_lower <= warning_upper`, at least one threshold). The meaning of lower/upper versus warning thresholds is defined by the diagnostic rules in Phase 6.

For example, a reference profile may define an approved upper limit for a temperature measurement. The application must use that value only when the profile applies to the selected motor and test conditions.

Warning thresholds and critical limits must be based on approved reference information, not arbitrary defaults.

---

## 7. Table: test_sessions

Stores each motor testing event.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Test identifier |
| motor_id | UUID | Foreign key | Motor being tested |
| test_timestamp | TIMESTAMPTZ | Required | Test date and time |
| operating_conditions | JSONB | Optional | Load, ambient conditions and other relevant context |
| measurement_method | TEXT | Optional | Measurement method or instrument |
| notes | TEXT | Optional | Technician observations |
| status | TEXT | Required | Draft, submitted or assessed |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |

### Rules

- `motor_id` references `motors.id`.
- Every test belongs to one motor.
- Every submitted test receives a distinct identifier.
- Historical test records must not be overwritten by later tests.
- Draft tests must not be treated as completed diagnostic assessments.
- Preserve the operating conditions needed to interpret measurements.
- There is no operator column. The Phase 5 UI stores the operator and a free-text description of operating conditions in `operating_conditions` under the keys `operator` and `description` (other keys are preserved).
- The selected reference profile is **not** stored on the session (no column). Profile selection in the test form is informational; the profile actually used is recorded on `diagnostic_results` when the test is assessed.
- The UI saves drafts by updating the same row, and only while `status = 'draft'`. It sets `submitted` only after the readings were saved, and never sets `assessed` (that requires a diagnostic result). The UI treats submitted tests as read-only.
- Migration 010 (Phase 6) closes the Phase 5 gap: sessions can only be inserted as `draft`; a draft can be edited and submitted (it needs at least one reading); a `submitted` or `assessed` session and its readings are immutable, also for direct API calls. The only allowed change to a submitted session is `submitted → assessed` with every other column unchanged and a stored result.

---

## 8. Table: test_readings

Stores the measured values submitted during each test.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Reading identifier |
| test_session_id | UUID | Foreign key | Associated test |
| parameter_code | TEXT | Required | Parameter identifier |
| measured_value | NUMERIC | Required | Original measured value |
| measured_unit | TEXT | Required | Original measurement unit |
| normalized_value | NUMERIC | Optional | Value converted to the comparison unit |
| normalized_unit | TEXT | Optional | Unit used for comparison |
| measurement_location | TEXT | Optional | Sensor or measurement location |
| recorded_at | TIMESTAMPTZ | Required | Recording timestamp |

### Rules

- `test_session_id` references `test_sessions.id`.
- Store the original submitted value and unit.
- Normalize values only when the conversion is supported.
- Never silently reinterpret an unsupported unit.
- Prevent duplicate parameter readings within a test unless repeated measurements are explicitly supported.
- Use a separate record for each measured parameter.

A missing measurement should be represented as missing data, not as zero.

Phase 5 behaviour: a blank field creates no row; a typed `0` is stored as `0`. `measured_value`/`measured_unit` hold exactly what the user entered. `normalized_value`/`normalized_unit` are always filled by the UI, in the catalog's canonical unit (for readings already in the canonical unit they equal the measured pair). Supported exact conversions into the canonical unit: kV→V, mA→A, °F→°C, K→°C, in/s→mm/s, rev/s→RPM, kHz→Hz. A unit is offered only if its target equals the catalog `canonical_unit`. Definitional bounds are checked (e.g. temperature not below absolute zero, power factor within −1…1, other quantities not negative); these are not operating limits. One reading per parameter per test means per-phase and multi-location readings cannot be stored yet.

If the application supports repeated readings, include an explicit reading sequence or measurement identifier.

---

## 9. Table: diagnostic_results

Stores the overall diagnostic assessment for a test.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Assessment identifier |
| test_session_id | UUID | Foreign key | Associated test |
| revision | INTEGER | Required, default 1 | Assessment revision; `UNIQUE (test_session_id, revision)` |
| reference_profile_id | UUID | Foreign key, optional | Profile used; null only for INSUFFICIENT_DATA / NOT_ASSESSED |
| reference_profile_version | INTEGER | Optional | Profile version used; `(id, version)` is a composite foreign key |
| diagnostic_engine_version | TEXT | Required | Diagnostic logic version |
| overall_status | TEXT | Required | Assessment status |
| summary | TEXT | Optional | Assessment summary |
| assessed_at | TIMESTAMPTZ | Required | Assessment timestamp |

### Allowed statuses

- `NORMAL`
- `WARNING`
- `FAULT_SUSPECTED`
- `INSUFFICIENT_DATA`
- `NOT_ASSESSED`

### Rules

- `test_session_id` references `test_sessions.id`.
- `reference_profile_id` references `reference_profiles.id`.
- A test may have several assessment revisions; the highest `revision` is the current one. Reassessment inserts a new revision and never overwrites an issued result.
- Results are append-only (no UPDATE or DELETE).
- NORMAL, WARNING and FAULT_SUSPECTED require an **approved** reference profile; a draft test session cannot be assessed.
- Save the exact reference profile version and diagnostic engine version.
- An assessment must not be marked normal when required measurements or reference values are missing.

If the reference profile cannot be identified reliably, store an insufficient-data assessment with a clear explanation rather than assigning an unrelated profile.

---

## 10. Table: diagnostic_findings

Stores individual findings generated during an assessment.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | Primary key | Finding identifier |
| diagnostic_result_id | UUID | Foreign key | Associated assessment |
| parameter_code | TEXT | Optional | Related parameter |
| rule_code | TEXT | Required | Diagnostic rule identifier |
| severity | TEXT | Required | Finding severity |
| observed_value | NUMERIC | Optional | Value that triggered the finding |
| observed_unit | TEXT | Optional | Measurement unit |
| applicable_limit | NUMERIC | Optional | Relevant comparison limit |
| finding_description | TEXT | Required | Explanation of the finding |
| possible_causes | JSONB | Optional | Possible causes |
| recommended_action | TEXT | Optional | Recommended inspection |
| created_at | TIMESTAMPTZ | Required | Creation timestamp |

### Severity Values

Use a consistent severity model, such as:

- `INFO`
- `WARNING`
- `CRITICAL`

These are finding severities and are separate from the overall assessment status.

### Rules

- `diagnostic_result_id` references `diagnostic_results.id`.
- Each finding must identify the rule that generated it.
- Observed values and limits must use compatible units.
- Possible causes must not be presented as confirmed faults without supporting evidence.
- Findings must explain why the parameter was flagged.
- Missing data should be represented explicitly in the assessment or finding details.

---

## 11. Database Relationships

The main relationships are:

- One motor has many test sessions.
- One reference profile has many reference limits.
- One test session has many test readings.
- One test session has one or more diagnostic result revisions; the highest revision is current.
- One diagnostic result has many diagnostic findings.

Relationship overview:

Motors  
→ Test Sessions  
→ Test Readings

Reference Profiles  
→ Reference Limits

Test Sessions  
→ Diagnostic Results  
→ Diagnostic Findings

Use foreign keys to maintain referential integrity.

Do not use arbitrary text fields to represent relationships that should be enforced by database constraints.

---

## 12. Assessment Workflow

When a user submits a motor test:

1. Validate the submitted motor ID.
2. Retrieve the applicable motor specifications.
3. Retrieve an approved reference profile.
4. Validate required measurements and units.
5. Create the test session and its readings.
6. Evaluate the readings using the documented diagnostic rules.
7. Create the diagnostic result.
8. Create the associated findings.
9. Display the saved assessment.
10. Allow the user to retrieve the result later.

If any required reference values or measurements are unavailable, the assessment must indicate insufficient data.

Do not report a successful save if a required database operation fails.

---

## 13. Database Migrations

Keep SQL migrations in:

`database/migrations/`

Use numbered or timestamped migration files, for example:

- `001_create_motors.sql`
- `002_create_parameter_definitions.sql`
- `003_create_reference_profiles.sql`
- `004_create_reference_limits.sql`
- `005_create_test_sessions.sql`
- `006_create_test_readings.sql`
- `007_create_diagnostic_results.sql`
- `008_create_diagnostic_findings.sql`
- `009_rls_policies_and_grants.sql`
- `010_enforce_submitted_session_immutability.sql` (replaces the session lifecycle function and the readings trigger from 005/006; does not edit those files)
- `011_create_save_diagnostic_assessment.sql` (atomic assessment persistence function)
- `012_harden_functions.sql` (fixed `search_path` on every function; trigger functions not executable by API roles; no behaviour change)

- `013_add_motor_supply_type.sql` (nullable `motors.supply_type`: `line` | `inverter`; additive, no data change; apply before deploying the frontend that sends it)

Databases that already have 001–009 apply only 010 to 013, in order.

These filenames describe the intended migration sequence. The actual migration format should follow the chosen Supabase workflow.

### Migration Rules

- Create tables in dependency order.
- Add foreign keys and indexes.
- Enable RLS on tables exposed through Supabase APIs.
- Create and test access policies.
- Use reversible or carefully planned schema changes where practical.
- Never include real credentials in migrations.
- Do not delete production data as part of routine schema updates.

---

## 14. Indexes and Constraints

Add indexes for common queries, including:

- `motors.motor_tag`
- `test_sessions.motor_id`
- `test_sessions.test_timestamp`
- `test_readings.test_session_id`
- `diagnostic_results.test_session_id`
- `diagnostic_results.overall_status`
- `diagnostic_findings.diagnostic_result_id`
- `reference_limits.reference_profile_id`

Use unique constraints to prevent duplicate identifiers and ambiguous reference configurations.

Avoid adding indexes to every column. Add indexes based on expected queries and actual performance needs.

Use check constraints for valid status values and basic field integrity.

Use appropriate timestamp defaults and update mechanisms.

---

## 15. Supabase Security

Enable Row Level Security on every application table exposed through Supabase APIs.

For the initial private application:

- Allow only the intended authenticated user to access protected data.
- Restrict writes to authorized users.
- Restrict reference profile and threshold changes to authorized users.
- Protect diagnostic history from unauthorized modification.
- Test policies using the actual application access model.

Do not make all tables publicly readable or writable just to simplify development.

Do not place service-role credentials in frontend code.

If the application uses a public client key, remember that the key does not replace database authorization. RLS policies must enforce the intended permissions.

If a secure multi-user ownership model is required, add user or organization ownership columns and corresponding policies before enabling shared access.

---

## 16. Data Integrity and History

- Store timestamps using `TIMESTAMPTZ`.
- Use consistent measurement units.
- Preserve original submitted measurements.
- Preserve the reference profile version used for each assessment.
- Preserve diagnostic engine versions.
- Do not silently change previous results when reference data changes.
- Do not cascade-delete motor history unintentionally.
- Validate all inputs before writing them.
- Use transactions or an appropriate trusted operation when multiple records must be saved together.

### Important Implementation Consideration

A frontend-only diagnostic module cannot guarantee atomic execution of multiple database writes.

For the initial prototype, clearly handle partial failures and do not display an assessment as successfully saved unless all required records have been persisted.

If the application later requires strict atomic test submission and assessment creation, implement that operation through a suitable PostgreSQL transaction or trusted server-side function.

---

## 17. Sample Data

Use demonstration data only for local development and UI testing.

Any demonstration motors, reference profiles and thresholds must be clearly labelled as sample data.

Do not present demonstration values as manufacturer-approved specifications or engineering standards.

Before using the application for real motor assessments, populate the database with appropriate, verified reference information.

---

## 18. Definition of Done

The database implementation is complete when:

- All required tables exist.
- Relationships and foreign keys are configured.
- Constraints and indexes are applied.
- RLS is enabled and policies are tested.
- Motor registration works.
- Reference data can be retrieved.
- Test readings are saved accurately.
- Diagnostic results and findings can be retrieved.
- Previous tests remain available.
- Reference versions are preserved.
- Migrations are stored in version control.
- The application handles database errors without falsely reporting success.

---

## 19. Final Principle

Keep the database small, relational and traceable.

The database must support the core workflow:

**Register Motor → Store Reference Values → Enter Readings → Compare Parameters → Save Results → Review History.**

Do not introduce unnecessary tables, services or infrastructure until the application requires them.
---

## 20. Future schema changes needed for multi-phase diagnostics (not implemented)

The schema stores one reading per parameter per test (`UNIQUE (test_session_id, parameter_code)`), so the engine cannot evaluate quantities that need several readings. Before implementing them, a migration is required, for example:

- **Phase imbalance (voltage, current):** add a phase identifier to `test_readings` (e.g. `phase TEXT` or `reading_sequence SMALLINT`) and change the uniqueness to `(test_session_id, parameter_code, phase)`; add a documented, source-backed imbalance formula and reference limit type for it in `reference_limits`.
- **Multi-point vibration:** the same measurement-point identifier, plus the measurement method / quantity (e.g. RMS velocity vs peak) as structured data instead of free text.
- **Required-parameter lists:** if a profile should require parameters that have no limit, or some limits should be optional, add an explicit `required` flag to `reference_limits`.
- **Per-limit threshold semantics:** the engine assumes one convention (warning thresholds inside hard limits, `DIAGNOSTIC_RULES.md` section 21.1). If sources use another convention, add an explicit field describing it rather than reinterpreting existing rows.

Existing readings and results must be preserved by any such migration (additive columns with safe defaults, no destructive changes).


## JSON keys interpreted by the application (no schema change)

- `reference_profiles.applicable_specs.combined_variation` - optional explicit combined voltage/frequency rule: `voltage_parameter`, `frequency_parameter`, `voltage_unit`, `frequency_unit`, `max_combined_percent`, `max_frequency_percent`, `required_load_condition`, `source`. Covered by the existing approved-profile immutability trigger because it lives in `applicable_specs`. See DIAGNOSTIC_RULES 21.11.
- `reference_limits.applicable_conditions.required_load_condition` - if present, the limit is evaluated only when the test's recorded load condition equals it; other keys (e.g. `description`) are descriptive.
- `test_sessions.operating_conditions.load_condition` - operator-declared: `rated`, `below_rated`, `above_rated`, `no_load`, `unknown`; absent = not recorded.
