# CLAUDE.md — Motor Health Checker

## 1. Project Overview

Build a simple web application called **Motor Health Checker**.

The application allows users to register electric motors, enter measured parameters through a dashboard, compare those measurements against reference data stored in a database, and view the motor's operating condition and possible faults.

The application should be easy to understand, maintain, and extend without unnecessary complexity.

### Core Workflow

1. Register a motor and save its specifications.
2. Select a motor from the dashboard.
3. Enter the measured motor parameters.
4. Retrieve the applicable reference values from the database.
5. Compare the readings against the reference values.
6. Display an understandable diagnostic result.
7. Save the readings and results for future reference.

### Main Objective

**Add motor data → Enter measurements → Compare with database reference values → Display motor condition → Save test history.**

The initial version must support manual data entry only. Automatic sensors, IoT integrations, AI and predictive maintenance are future enhancements.

---

## 2. Read Documentation Before Development

Before writing application code, read the following files:

- `docs/PRD.md`
- `docs/TECH_STACK.md`
- `docs/DATABASE_DESIGN.md`
- `docs/DIAGNOSTIC_RULES.md`
- `docs/IMPLEMENTATION_PLAN.md`

Treat these documents as the primary source of product requirements.

If a document is missing, incomplete, or conflicts with another document:

1. Identify the missing or conflicting requirement.
2. Explain the issue.
3. Propose the simplest reasonable solution.
4. Ask for clarification when the decision materially affects architecture, data integrity, security or diagnostic correctness.

Do not silently introduce unnecessary features or change agreed requirements.

---

## 3. Technology Stack

Use the following stack.

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand for small amounts of client-side UI state when needed
- TanStack Query for server data fetching and mutations
- Recharts for dashboard charts
- Lucide React for icons

### Database and Backend Services

- Supabase PostgreSQL
- Supabase JavaScript client (`@supabase/supabase-js`)
- Supabase Row Level Security (RLS)
- Supabase SQL migrations

### Validation and Testing

- Zod for input validation where appropriate
- Vitest for unit tests
- React Testing Library for component tests where useful
- Playwright for end-to-end testing when appropriate

### Development Tools

- Git
- GitHub
- Visual Studio Code
- Claude Code

### Hosting

Prefer free-tier hosting options for the frontend and database.

Potential services include:

- Vercel for frontend hosting.
- Supabase for database and backend services.

Use only the features available within the applicable free plans. Do not assume unlimited usage or permanent free availability.

Do not introduce paid APIs, subscriptions, or external AI services.

---

## 4. Keep the Architecture Simple

Do not create a separate Node.js or Express backend for the initial version.

Supabase provides database storage and APIs, so a separate backend server is unnecessary for the basic CRUD workflows.

Use the following architecture:

React Dashboard
→ Supabase Client
→ Supabase PostgreSQL
→ Diagnostic Results

The diagnostic comparison logic should be implemented as a small, reusable TypeScript module.

Use database constraints and RLS policies to protect data.

If a future requirement needs trusted server-side execution, consider Supabase Edge Functions or another minimal server-side solution. Do not introduce one without a clear requirement.

### Important Restrictions

Do not introduce:

- A separate Express server.
- Prisma ORM.
- Microservices.
- Docker or Kubernetes for the MVP.
- Redis or a separate caching server.
- AI or machine-learning services.
- Complex state-management architecture.
- Unnecessary abstraction layers.
- Paid third-party APIs.

Prefer the simplest solution that satisfies the documented requirements.

---

## 5. Project Structure

Use this structure for the application:

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
├── README.md
├── tsconfig.json
└── vite.config.ts

Adjust the structure only when a real requirement justifies doing so.

Do not create empty folders or unnecessary files merely to match the example.

Keep all application code in the root Vite project. Do not maintain separate `frontend/` and `backend/` applications for the MVP.

---

## 6. Core Application Features

### 6.1 Dashboard

Create a clean dashboard showing:

- Total registered motors.
- Recently tested motors.
- Normal assessments.
- Warning assessments.
- Suspected faults.
- Tests with insufficient data.
- Recent test history.

Provide quick actions for:

- Adding a motor.
- Viewing registered motors.
- Starting a new motor test.
- Viewing diagnostic history.

Dashboard statistics must come from actual database records rather than hardcoded numbers.

### 6.2 Motor Management

Users should be able to:

- Register a motor.
- View motor details.
- Edit motor specifications.
- Search registered motors.
- Filter motors by motor type or status.
- View the latest assessment.
- View previous tests.

Suggested motor fields:

- Motor ID or equipment tag.
- Motor name.
- Manufacturer.
- Model.
- Serial number, when available.
- Motor type.
- Rated voltage.
- Rated current.
- Rated power.
- Rated frequency.
- Rated speed.
- Number of phases.
- Installation location.
- Notes.

Only make fields mandatory when required by the documented motor type and diagnostic workflow.

### 6.3 Reference Parameter Management

Store the approved reference data needed to evaluate motor measurements.

Each reference record should identify:

- Motor type or applicable motor configuration.
- Parameter name.
- Unit.
- Applicable reference limits.
- Relevant operating conditions.
- Source of the reference value.
- Version or effective date.
- Approval status.

Do not assume that every motor uses the same limits.

Use manufacturer documentation, applicable engineering standards or approved engineering procedures as reference sources.

Do not invent engineering limits.

If reference data is unavailable, inform the user that the assessment cannot be completed reliably.

### 6.4 Manual Parameter Entry

Allow users to select a motor and enter measurements.

Initial parameters may include:

| Parameter | Unit |
|---|---|
| Voltage | V |
| Current | A |
| Temperature | °C |
| Vibration | mm/s or an appropriate acceleration unit |
| Rotational speed | RPM |
| Frequency | Hz |
| Power factor | Unitless, when applicable |

The application should support additional parameters only when their definitions and comparison rules are documented.

For every test, record:

- Selected motor.
- Test date and time.
- Measured values.
- Measurement units.
- Relevant operating conditions.
- Technician notes, when provided.

Validate inputs before saving them.

Clearly identify missing values, unsupported units and invalid measurements.

### 6.5 Diagnostic Assessment

The application must compare submitted measurements against the applicable reference data.

The diagnostic workflow should:

1. Retrieve the selected motor.
2. Retrieve its applicable approved reference profile.
3. Validate measurements and units.
4. Identify missing or invalid readings.
5. Evaluate the applicable diagnostic rules.
6. Identify abnormal measurements.
7. Generate a structured diagnostic summary.
8. Save the readings and diagnostic findings.
9. Display the result to the user.

Implement the comparison logic in `src/lib/diagnostics.ts`, unless a documented requirement justifies a different location.

Keep the diagnostic functions independent of React components so they can be tested easily.

### 6.6 Diagnostic Statuses

Use the following status values consistently:

- `NORMAL`
- `WARNING`
- `FAULT_SUSPECTED`
- `INSUFFICIENT_DATA`
- `NOT_ASSESSED`

Definitions:

**NORMAL:** All required evaluated parameters are within their applicable approved limits, and no abnormality has been identified by the configured rules.

**WARNING:** One or more readings require attention or further investigation.

**FAULT_SUSPECTED:** The submitted measurements satisfy a configured rule indicating a possible fault condition.

**INSUFFICIENT_DATA:** Required measurements, reference values or operating conditions are missing or invalid.

**NOT_ASSESSED:** The motor has not completed a diagnostic assessment.

Do not label a motor as normal merely because no abnormal reading was detected when required information is missing.

### 6.7 Diagnostic Results

Display:

- Motor identification.
- Test date and time.
- Overall assessment status.
- Measured parameters.
- Applicable reference limits.
- Abnormal readings.
- Explanation of each finding.
- Possible causes, when supported by the available evidence.
- Recommended inspection actions.
- Missing information, when applicable.
- Reference profile and diagnostic rule version.

Make it clear which values were measured, which limits were used and why a finding was generated.

### 6.8 Test History

Store test readings and results in the database.

Users should be able to:

- View previous tests for a motor.
- Filter tests by date.
- Review historical findings.
- Compare parameter readings.
- View trends where enough data is available.
- Identify recurring abnormalities.

Do not overwrite previous test readings when a new test is submitted.

### 6.9 Reports

If required by the PRD, allow users to generate a basic PDF report.

The report should contain:

- Motor details.
- Test date.
- Measured readings.
- Reference values.
- Diagnostic findings.
- Overall status.
- Recommended inspection actions.
- Assessment limitations.

Do not introduce a complex reporting service unless necessary.

---

## 7. Diagnostic Accuracy and Engineering Safety

This application is a maintenance decision-support tool.

Follow these requirements strictly:

1. Never invent motor specifications or engineering thresholds.
2. Use only approved, documented reference values.
3. Evaluate readings against the correct motor type and applicable conditions.
4. Normalize measurement units before comparison.
5. Preserve original measurements and their units.
6. Distinguish abnormal readings from missing data.
7. Do not assume a single abnormal parameter confirms a specific fault.
8. Clearly label potential causes as possible causes.
9. Preserve the reference profile and diagnostic rule version used in each assessment.
10. Do not introduce arbitrary health scores or unsupported AI predictions.
11. Do not automatically control, stop or restart industrial machinery.
12. Do not replace established electrical safety procedures or qualified engineering inspection.

If the data is insufficient, return `INSUFFICIENT_DATA` and explain what is missing.

A diagnostic assessment must be reproducible from its saved readings, reference values and rule versions.

---

## 8. Database Requirements

Use Supabase PostgreSQL as the only database for the MVP.

Keep the schema simple and normalized.

The initial tables should include:

### Motors

Stores motor specifications and identification details.

### Reference Profiles

Stores approved reference configurations and their sources.

### Parameter Definitions

Defines supported parameters, units and metadata.

### Reference Limits

Stores the applicable comparison limits for each parameter and reference profile.

### Test Sessions

Stores information about each motor test.

### Test Readings

Stores individual measured parameter values for each test.

### Diagnostic Results

Stores the overall assessment and the versions of the rules and reference profiles used.

### Diagnostic Findings

Stores individual abnormal conditions and explanations.

Add user or organization tables only when required by the authentication and access-control design.

### Database Rules

- Use primary keys and foreign keys.
- Enforce appropriate uniqueness constraints.
- Store timestamps consistently.
- Store units explicitly.
- Use database migrations for schema changes.
- Preserve historical test records.
- Use transactions where supported and necessary.
- Avoid destructive schema changes.
- Do not store diagnostic history only in browser state.
- Keep the database schema aligned with `docs/DATABASE_DESIGN.md`.

---

## 9. Supabase Configuration and Security

Create a reusable Supabase client in:

`src/lib/supabase.ts`

Use environment variables for configuration.

Expected frontend variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or the appropriate Supabase publishable key supported by the project configuration.

Create `.env.example` containing placeholder values only.

Never commit actual credentials.

Never expose a Supabase service-role key or secret key in frontend code.

### Row Level Security

Enable RLS on tables exposed through Supabase APIs.

Create appropriate policies for reading and modifying data.

Do not assume that hiding a button or protecting a React route secures the underlying database.

If authentication is implemented, ensure users can access only the records permitted by the application's authorization model.

For a private single-user prototype, keep access restricted to the intended user. Do not make all motor data publicly readable or writable simply to simplify development.

Test database policies before deploying.

---

## 10. Frontend Development Rules

Build a simple and consistent interface.

Use reusable React components for:

- Forms.
- Input fields.
- Tables.
- Status indicators.
- Summary cards.
- Modals.
- Loading states.
- Error messages.
- Empty states.

Use TypeScript types for application data.

Avoid unnecessary use of `any`.

Use TanStack Query for database data fetching and mutations.

Use Zustand only when client-side shared state is genuinely needed.

Use Tailwind CSS for styling and maintain consistent spacing, typography and colors.

Use Recharts for charts that add useful information.

Ensure the interface works on desktop, tablet and mobile.

Provide:

- Loading indicators.
- Validation messages.
- Success and error feedback.
- Empty-state guidance.
- Confirmation for destructive actions.

Do not add buttons or controls that do not perform their advertised action.

Do not hardcode production dashboard statistics or diagnostic results.

---

## 11. Code Quality and Simplicity

- Prefer readable code over clever abstractions.
- Keep functions small and focused.
- Avoid unnecessary dependencies.
- Avoid duplicating diagnostic logic.
- Keep database access separate from UI components where practical.
- Keep reference data separate from diagnostic algorithms.
- Reuse types and validation schemas when appropriate.
- Handle errors explicitly.
- Avoid overengineering.
- Do not create additional services or infrastructure without a clear need.

Do not suppress TypeScript errors just to make the build pass.

Do not leave critical functionality as TODO comments.

---

## 12. Testing Requirements

Use Vitest for unit tests.

Test the diagnostic functions with explicit inputs and expected outputs.

Required scenarios include:

- All required measurements are within approved limits.
- A reading exceeds an applicable warning limit.
- A reading exceeds an applicable critical limit, when defined.
- Required readings are missing.
- Reference values are missing.
- Units are inconsistent or unsupported.
- Values are invalid.
- Operating conditions do not match the reference profile.
- Multiple diagnostic rules produce findings.
- Historical results remain unchanged after reference limits are updated.

Test Supabase integration and RLS policies where practical.

Run the relevant tests and build checks after implementing a feature.

Never claim a test passed unless it was actually executed successfully.

---

## 13. Free-Tier Requirements

The project should use free and open-source tools wherever possible.

- Use free development tools.
- Use free libraries.
- Use Supabase within its applicable free-plan limits.
- Use a free frontend hosting offering where appropriate.
- Avoid paid AI APIs.
- Avoid paid monitoring services.
- Avoid paid database add-ons.
- Do not require a paid subscription for basic local development.

Check current provider limits when planning deployment.

Do not assume free tiers are unlimited or permanent.

Document any feature that may require a paid plan at higher usage.

The application must remain runnable locally without requiring a paid hosting account.

---

## 14. Development Workflow

Implement the application in small, verifiable phases.

Phases follow `docs/IMPLEMENTATION_PLAN.md`, which is the source of truth for the 11 development phases:

1. **Phase 1 — Project Setup:** Vite, React, TypeScript, Tailwind CSS, Supabase client, environment variables, app shell.
2. **Phase 2 — Database Setup:** eight-table schema as SQL migrations, constraints, indexes, Supabase Auth ownership model and RLS policies.
3. **Phase 3 — Motor Management:** motor registration, list, details, editing, search and filtering.
4. **Phase 4 — Reference Data Management:** view reference profiles and limits, approval status, sources, applicable-profile lookup.
5. **Phase 5 — Manual Parameter Entry:** new-test form, unit validation, saving test sessions and readings.
6. **Phase 6 — Diagnostic Engine:** `src/lib/diagnostics.ts` comparison, normalization, findings, statuses and Vitest tests.
7. **Phase 7 — Diagnostic Result Persistence:** save results and findings with profile and engine versions; handle partial failures.
8. **Phase 8 — Dashboard and Test History:** dashboard statistics from real data, history, comparison and trends.
9. **Phase 9 — Reports:** PDF reports from saved assessment data, if included in the MVP scope.
10. **Phase 10 — Security and Quality Assurance:** verify RLS, run tests and builds, test workflows and responsive layouts.
11. **Phase 11 — Deployment:** free-tier hosting, production Supabase setup, deployment and usage-limit documentation.

Do not implement every feature in one large change.

After each phase, report:

- What was implemented.
- Which files were changed.
- Which tests were executed.
- Any remaining problems.
- The next recommended step.

---

## 15. Git and File Safety

- Do not overwrite existing work without checking it first.
- Do not delete existing files without explicit approval.
- Do not remove dependencies without checking their usage.
- Do not run destructive database operations without explicit approval.
- Keep `.env` out of version control.
- Keep `.env.example` safe to commit.
- Use meaningful Git commits when requested.
- Update documentation when implementation decisions change.

---

## 16. Definition of Done

The initial application is complete when:

- A user can register a motor.
- Motor specifications are saved in Supabase.
- Applicable reference data can be configured and retrieved.
- A user can enter motor measurements.
- Inputs and units are validated.
- Measurements are compared with approved reference values.
- Diagnostic results explain their findings.
- Missing data is handled correctly.
- Test readings and results are persisted.
- Historical tests can be viewed.
- RLS policies protect the database.
- The application works locally.
- The production build succeeds.
- Relevant diagnostic tests pass.
- Setup instructions are documented.

---

## 17. Final Development Principle

Build the smallest reliable version of the Motor Health Checker first.

The primary objective is:

**Register Motor → Enter Parameters → Compare with Database → Display Diagnostic Result → Save History.**

Keep the frontend clean, the database understandable and the diagnostic logic testable.

Do not add AI, IoT, automatic motor control, microservices or a separate backend server unless a specific future requirement justifies the added complexity.

When in doubt, choose the simplest secure solution that satisfies the documented requirements.