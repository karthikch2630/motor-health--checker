# Implementation Plan — Motor Health Checker

**Version:** 1.0  
**Project Type:** React + TypeScript + Vite + Supabase  
**Implementation Approach:** Incremental MVP Development  
**Primary Goal:** Enter motor measurements, compare them against database reference values, and display diagnostic results.

---

## 1. Implementation Objective

Build a simple, functional motor health assessment application.

The initial version must allow a user to:

1. Register a motor.
2. Store motor specifications.
3. Store applicable reference values.
4. Enter measured motor parameters.
5. Compare measurements against approved reference data.
6. View an understandable diagnostic assessment.
7. Save and retrieve test history.

Keep the architecture simple.

Do not create a separate Express backend, use Prisma, introduce AI services, or add unnecessary infrastructure.

## 2. Documentation Requirements

Before implementation, read:

- `CLAUDE.md`
- `docs/PRD.md`
- `docs/TECH_STACK.md`
- `docs/DATABASE_DESIGN.md`
- `docs/DIAGNOSTIC_RULES.md`

Follow these documents as the source of truth.

If important requirements conflict, identify the conflict before making architectural changes.

Do not delete existing files or overwrite existing work without checking it first.

## 3. Technology Stack

Use:

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase PostgreSQL
- Supabase JavaScript Client
- Zustand when client-side shared state is needed
- TanStack Query for server data
- Zod for validation where appropriate
- Recharts for charts
- Vitest for unit testing

Use free and open-source tools where possible.

Keep the application runnable locally without requiring a paid hosting account.

## 4. Project Structure

Use the following structure:

```text
motor-health-checker/
├── CLAUDE.md
├── docs/
│   ├── PRD.md
│   ├── TECH_STACK.md
│   ├── DATABASE_DESIGN.md
│   ├── DIAGNOSTIC_RULES.md
│   └── IMPLEMENTATION_PLAN.md
├── src/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   ├── hooks/
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── diagnostics.ts
│   ├── types/
│   ├── utils/
│   ├── App.tsx
│   └── main.tsx
├── database/
│   └── migrations/
├── public/
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

Create only the folders and files that are actually needed.

Do not maintain separate frontend and backend applications for the MVP.

## 5. Phase 1 — Project Setup

### Tasks

- Inspect the existing repository.
- Check whether Vite and React are already configured.
- Configure TypeScript.
- Configure Tailwind CSS using the current Vite integration.
- Install only the required dependencies.
- Create the initial project structure.
- Configure environment variables.
- Set up the Supabase client.
- Configure basic application routing or page navigation.
- Add initial error handling.

### Expected Files

- `src/App.tsx`
- `src/main.tsx`
- `src/lib/supabase.ts`
- `.env.example`
- `.gitignore`
- `package.json`

### Acceptance Criteria

- The development server starts successfully.
- The application renders without runtime errors.
- TypeScript compilation works.
- Environment variables are documented.
- No secret credentials are committed.
- The production build succeeds.

Do not proceed to database-dependent features until the project foundation works.

## 6. Phase 2 — Database Setup

### Tasks

Create SQL migrations for:

1. `motors`
2. `parameter_definitions`
3. `reference_profiles`
4. `reference_limits`
5. `test_sessions`
6. `test_readings`
7. `diagnostic_results`
8. `diagnostic_findings`

Implement:

- Supabase Auth ownership (`owner_id`) for a single authorized user.
- Primary keys.
- Foreign keys.
- Required constraints.
- Appropriate indexes.
- Timestamp fields.
- Allowed status values.
- Row Level Security.
- Appropriate access policies.

Use the schema described in `DATABASE_DESIGN.md`.

### Reference Data

Do not create fabricated engineering thresholds.

If demonstration records are needed, clearly label them as synthetic development data.

### Acceptance Criteria

- All migrations apply successfully.
- Table relationships work correctly.
- Invalid references are rejected by database constraints.
- RLS policies restrict unauthorized access.
- The application can connect to Supabase.
- Database errors are handled properly.

Migrations: `database/migrations/001`–`011`, applied in numeric order (see `README.md`). 010 and 011 were added in Phase 6.

## 7. Phase 3 — Motor Management

### Tasks

Create the following pages:

- Dashboard.
- Motor List.
- Add Motor.
- Edit Motor.
- Motor Details.

Implement:

- Motor registration.
- Motor specification validation.
- Motor editing.
- Motor search.
- Motor filtering.
- Motor detail retrieval.

### User Interface

The motor list should show:

- Motor ID.
- Motor name.
- Motor type.
- Manufacturer.
- Rated power, when available.
- Location.
- Latest assessment status.
- Actions to view or edit the motor.

### Acceptance Criteria

- Users can register a motor.
- Motor data is saved in Supabase.
- Users can view registered motors.
- Users can edit motor information.
- Duplicate motor identifiers are handled.
- Loading, empty and error states work.
- Existing test history is not lost when motor details change.

## 8. Phase 4 — Reference Data Management

### Tasks

Create a basic reference-data screen.

Implement:

- Viewing reference profiles.
- Viewing parameter limits.
- Identifying approved and unapproved profiles.
- Recording reference sources.
- Associating profiles with applicable motor types.
- Restricting reference-data changes to authorized users.

If an administrative reference editor is not required for the first prototype, reference profiles may initially be created through version-controlled SQL migrations or the Supabase dashboard.

Do not hardcode reference limits throughout React components.

Implementation notes (Phase 4): there is no "submit for approval" state in the schema; profiles go `draft → approved → retired` through confirmed actions. Reference data is managed in the UI at `/reference`. Changing an approved profile means creating a new draft version.

### Acceptance Criteria

- The application retrieves reference data from Supabase.
- The applicable profile can be identified for a motor.
- Unapproved profiles cannot be used for authoritative assessments.
- Missing reference values are handled correctly.
- Reference changes do not silently rewrite previous diagnostic results.

## 9. Phase 5 — Manual Parameter Entry

### Tasks

Create a New Motor Test page.

Allow the user to:

1. Select a registered motor.
2. Review the motor specifications.
3. Enter measured parameters.
4. Enter relevant operating conditions.
5. Add optional notes.
6. Save a draft or submit a completed test.

Initial parameters may include:

- Voltage.
- Current.
- Temperature.
- Vibration.
- Rotational speed.
- Frequency.

Additional parameters may be added when their reference definitions are available.

### Validation

- Require applicable mandatory readings.
- Validate numeric values.
- Validate units.
- Reject unsupported conversions.
- Distinguish missing data from zero.
- Display useful field-level errors.

Implementation notes (Phase 5): the test list is at `/history`, entry at `/tests/new` (optionally `?motor=<id>`) and `/tests/:id`. Drafts are saved with "Save draft"; submission happens from a review step and moves the session `draft → submitted` only. Submitted tests are read-only in the UI. No assessment is performed.

### Acceptance Criteria

- A user can submit valid measurements.
- Test sessions and readings are saved correctly.
- Invalid values are rejected.
- The application handles failed database writes.
- Repeated submissions do not unintentionally create duplicate tests.
- Each test has its own identifier and timestamp.

## 10. Phase 6 — Diagnostic Engine

### Tasks

Implement:

`src/lib/diagnostics.ts`

The module should:

1. Receive validated measurements.
2. Receive an applicable approved reference profile.
3. Check required parameters.
4. Normalize supported units.
5. Compare measurements against configured limits.
6. Apply documented diagnostic rules.
7. Generate findings.
8. Determine the overall assessment status.
9. Return a structured result.

### Supported Statuses

- `NORMAL`
- `WARNING`
- `FAULT_SUSPECTED`
- `INSUFFICIENT_DATA`
- `NOT_ASSESSED`

### Requirements

- Do not invent thresholds.
- Do not assume every motor has the same limits.
- Do not claim a suspected fault is confirmed.
- Do not return normal when required information is missing.
- Explain which parameter triggered a finding.
- Preserve the reference profile version.
- Keep the logic independent of React components.
- Make the same versioned inputs produce deterministic results.

### Testing

Use Vitest to test:

- Values within approved limits.
- Warning threshold violations.
- Critical threshold violations when defined.
- Missing readings.
- Missing reference data.
- Unsupported units.
- Invalid measurements.
- Multiple findings.
- Incompatible operating conditions.

Use synthetic values for test fixtures only when clearly labelled as examples, never as production thresholds.

### Acceptance Criteria

- Diagnostic results follow `DIAGNOSTIC_RULES.md` (section 21 is the exact Phase 6 specification, engine version 1.0.0).
- Result persistence is implemented in Phase 6 through the atomic database function `save_diagnostic_assessment` (migration 011), with a minimal Run assessment panel on submitted tests. Dedicated result pages, reports and trends remain for later phases.
- Tests pass.
- Each finding has an explanation.
- Missing data is handled correctly.
- No unsupported engineering claims are generated.

## 11. Phase 7 — Diagnostic Result Persistence

### Tasks

After an assessment:

- Save the overall diagnostic result.
- Save individual findings.
- Store the reference profile version.
- Store the diagnostic engine version.
- Store the assessment timestamp.
- Update the test workflow status appropriately.

Ensure the application does not display a successful save if required database operations fail.

For the initial prototype, handle partial write failures explicitly. If atomic persistence is required, use a suitable trusted database transaction or server-side function.

### Acceptance Criteria

- The result is saved and retrievable.
- Findings are associated with the correct assessment.
- Historical records are preserved.
- Failed writes do not produce false success messages.
- Previously issued assessments remain traceable.

## 12. Phase 8 — Dashboard and Test History

### Dashboard

Display:

- Total registered motors.
- Recent test activity.
- Normal assessments.
- Warnings.
- Suspected faults.
- Insufficient-data assessments.

### Test History

Allow users to:

- View tests for a selected motor.
- Open a diagnostic result.
- Filter tests by date.
- Review measured values.
- Compare historical measurements.
- View trends when sufficient data exists.

Use Recharts only where charts help users understand the data.

Implementation notes: the dashboard, assessment history, result pages, motor-page history and comparable-reading trends were delivered together with the persistence work during the Phase 7 working session (the project owner's Phase 7 brief covered "assessment history and dashboard"; the persistence database function came in the previous session). Still open from this section: filtering tests by date and comparing two tests side by side. See `DIAGNOSTIC_RULES.md` section 22 for the display conventions.

### Acceptance Criteria

- Dashboard statistics reflect database records.
- Historical tests are retrieved correctly.
- Users can navigate from a motor to its tests.
- Missing historical data is handled cleanly.
- No fabricated statistics appear in production.

## 13. Phase 9 — Reports

Implement PDF reports if included in the agreed MVP scope.

A report should include:

- Motor details.
- Test date and time.
- Measured values.
- Reference values.
- Overall status.
- Diagnostic findings.
- Possible causes, when supported.
- Recommended inspection actions.
- Assessment limitations.

Generate reports from saved assessment records rather than silently recalculating old results using changed reference values.

### Acceptance Criteria

- Reports contain the correct test data.
- Reports identify the applicable reference profile.
- Findings match the saved assessment.
- Missing values are represented clearly.

## 14. Phase 10 — Security and Quality Assurance

Implementation notes: the project owner's "Phase 8" brief (QA, security review, deployment readiness) covers this section and the readiness part of Phase 11. Results: database tests of RLS, immutability and atomic persistence (`database/tests`), migration 012 (function hardening), a local QA backend plus browser scripts (`qa/`), bug fixes found by them (same-tick double submits, phone overflow, findings table layout), and lazy loading of the chart. Hosted-Supabase verification and the deployment itself remain open (Phase 11). PDF reports (Phase 9) were not requested and are not implemented.

### Security

- Verify RLS policies.
- Verify access restrictions.
- Keep secrets out of frontend code.
- Validate all database writes.
- Protect reference-data changes.
- Check that unauthorized users cannot access protected records.

### Quality Assurance

- Run unit tests.
- Run the production build.
- Test the motor registration workflow.
- Test parameter submission.
- Test diagnostic results.
- Test history retrieval.
- Test database failures.
- Verify responsive layouts.

### Acceptance Criteria

- The application builds successfully.
- Important diagnostic tests pass.
- Database access policies work as intended.
- Core workflows work from beginning to end.
- Setup instructions are accurate.

## 15. Phase 11 — Deployment

Implementation notes: the deployment plan is written in `docs/DEPLOYMENT.md` (hosting recommendation, Supabase steps for migrations 001–012, environment variables, SPA routing, security checklist, smoke tests, rollback and recovery, free-tier limits, ordered go-live checklist). Readiness tooling exists (`npm run predeploy:check`, `database/verify/hosted_smoke.sql`, `vercel.json`, `public/_headers`). **No deployment, cloud resource or remote migration has been created or applied;** every acceptance criterion below that concerns a hosted environment remains open until you approve and perform those steps.

### Tasks

- Configure environment variables.
- Configure Supabase production policies.
- Apply database migrations.
- Deploy the frontend to a suitable free-tier host.
- Test the deployed application.
- Document local setup and deployment.
- Confirm backup and recovery options appropriate to the chosen plan.

### Acceptance Criteria

- The deployed frontend loads correctly.
- The application connects to the intended database.
- No secrets are exposed.
- The primary user workflow works in the deployed environment.
- Free-tier usage limits and potential costs are documented.

## 16. Development Rules for Claude Code

During implementation:

1. Work on one phase at a time.
2. Inspect existing code before making changes.
3. Follow the documented technology stack.
4. Do not introduce unnecessary dependencies.
5. Do not create a separate Express backend.
6. Do not use Prisma.
7. Do not invent engineering thresholds.
8. Do not delete existing files without approval.
9. Run relevant tests after changes.
10. Fix errors caused by the implementation before proceeding.
11. Update documentation when technical decisions change.
12. Summarize completed work and remaining issues after each phase.

Do not attempt to build the entire application in one large change.

## 17. Final MVP Acceptance Criteria

The application is ready for initial use when:

- [ ] Motor registration works.
- [ ] Motor specifications are saved in Supabase.
- [ ] Applicable reference values can be retrieved.
- [ ] Users can enter motor readings.
- [ ] Input and unit validation work.
- [ ] Diagnostic rules compare readings correctly.
- [ ] Results contain understandable explanations.
- [ ] Missing data produces an appropriate status.
- [ ] Readings and results are saved.
- [ ] Historical tests can be viewed.
- [ ] RLS policies protect stored records.
- [ ] Diagnostic tests pass.
- [ ] The production build succeeds.
- [ ] Setup and deployment instructions are documented.

## 18. Final Implementation Principle

Build the smallest reliable version first.

The core workflow is:

**Register Motor → Enter Parameters → Compare with Database → Display Diagnostic Result → Save Test History.**

Do not add real-time sensors, AI, predictive maintenance or complex infrastructure until the core workflow is complete and validated.