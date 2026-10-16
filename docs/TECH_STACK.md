# Technology Stack — Motor Health Checker

## 1. Overview

Motor Health Checker is a lightweight web application that allows users to register electric motors, enter measured parameters, compare those measurements against database reference values, and view diagnostic results.

The application must be simple to develop, maintain and run without unnecessary infrastructure.

### Architecture Principles

- Use free and open-source tools where possible.
- Use a single React frontend project.
- Use Supabase as the managed PostgreSQL database and backend service.
- Keep diagnostic calculations in a small TypeScript module.
- Do not create a separate Express backend for the MVP.
- Avoid unnecessary libraries and paid services.
- Keep the application runnable locally.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Language | TypeScript | Type-safe application development |
| Frontend | React | Build the dashboard and forms |
| Build Tool | Vite | Development server and production builds |
| Styling | Tailwind CSS | Responsive UI styling |
| UI State | Zustand | Small amounts of shared client-side state when needed |
| API Data | TanStack Query | Fetching, caching and updating server data |
| Database | Supabase PostgreSQL | Store motors, reference values, readings and results |
| Database Client | Supabase JavaScript Client | Access Supabase services |
| Validation | Zod | Validate form and application data |
| Charts | Recharts | Display parameter trends and dashboard charts |
| Icons | Lucide React | Interface icons |
| Unit Testing | Vitest | Test diagnostic functions and utilities |
| Component Testing | React Testing Library | Test important UI behavior |
| End-to-End Testing | Playwright | Test complete user workflows when needed |
| Version Control | Git and GitHub | Track code changes |
| Hosting | Vercel or another suitable static host | Deploy the frontend using an available free plan |

Use only the packages that provide real value. Do not add every library automatically.

---

## 3. Frontend Architecture

### Framework

Use React with TypeScript and Vite.

The frontend is responsible for:

- Displaying the dashboard.
- Registering and editing motors.
- Accepting measured parameters.
- Displaying reference values.
- Showing diagnostic results.
- Displaying test history.
- Showing parameter trend charts.

### Styling

Use Tailwind CSS for:

- Layouts.
- Forms.
- Tables.
- Summary cards.
- Status indicators.
- Responsive design.
- Loading and error states.

Keep the design clean and professional, suitable for an industrial monitoring application.

### State Management

Use Zustand only for small amounts of shared client-side state when necessary.

Use TanStack Query for server data, including:

- Motor records.
- Reference profiles.
- Test sessions.
- Diagnostic results.
- Historical readings.

Do not duplicate server data in Zustand unnecessarily.

### Charts

Use Recharts for:

- Historical parameter trends.
- Comparison charts.
- Dashboard summaries.

Charts must use actual saved data and should not display fabricated production statistics.

---

## 4. Database and Backend Services

### Supabase

Use Supabase for:

- PostgreSQL database storage.
- Database APIs.
- Row Level Security.
- Authentication if required.
- Database migrations.

Do not build a separate Node.js or Express backend for the initial version.

### Database Access

Install and use:

`@supabase/supabase-js`

Create a reusable client at:

`src/lib/supabase.ts`

Keep database access code organized and separate from visual components.

### Database Tables

The initial database schema should include:

- `motors`
- `reference_profiles`
- `parameter_definitions`
- `reference_limits`
- `test_sessions`
- `test_readings`
- `diagnostic_results`
- `diagnostic_findings`

Follow `DATABASE_DESIGN.md` for the exact schema, relationships and constraints.

### Database Migrations

Store version-controlled SQL migrations in:

`database/migrations/`

Use migrations to create and update tables, constraints, indexes and RLS policies.

Do not make undocumented production schema changes.

---

## 5. Diagnostic Logic

Implement the comparison logic in:

`src/lib/diagnostics.ts`

The module should be independent of React components and database client details.

### Responsibilities

1. Receive validated motor measurements.
2. Receive the applicable reference profile.
3. Validate required inputs.
4. Normalize supported measurement units.
5. Compare readings with approved reference limits.
6. Apply configured diagnostic rules.
7. Generate parameter-level findings.
8. Determine the overall assessment status.
9. Return a structured result.

### Supported Assessment Statuses

- `NORMAL`
- `WARNING`
- `FAULT_SUSPECTED`
- `INSUFFICIENT_DATA`
- `NOT_ASSESSED`

### Important Requirements

- Never invent engineering thresholds.
- Do not assume identical limits apply to every motor.
- Do not classify missing measurements as normal.
- Preserve the reference profile and diagnostic rule versions used.
- Explain why a reading was flagged.
- Do not claim that a possible fault is confirmed without appropriate evidence.

The diagnostic logic must have automated unit tests.

---

## 6. Authentication and Security

Use Supabase Authentication if the application requires user accounts.

For a private single-user prototype, choose the simplest secure setup that protects the database.

Decision (Phase 2): use Supabase Auth with a single authorized user, public sign-ups disabled, and an `owner_id` column plus RLS policies on every private table. See `DATABASE_DESIGN.md` section 3A.

### Security Requirements

- Enable Row Level Security on tables exposed through Supabase APIs.
- Create appropriate access policies.
- Validate data before database writes.
- Restrict reference-data modifications to authorized users.
- Do not expose service-role keys or secret keys in frontend code.
- Store configuration in environment variables.
- Keep `.env` out of Git.
- Use `.env.example` with placeholder values.
- Test database permissions before deployment.

The frontend must never be treated as the sole security boundary.

---

## 7. Environment Variables

Create `.env.example` in the project root.

Example:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-client-key
```

Use the appropriate Supabase publishable key if that is the key type provided by the current project configuration.

These values are placeholders and must be replaced with the actual project URL and public client key during setup.

Never place a service-role key or other privileged secret in a `VITE_` variable. Vite exposes these variables to frontend code.

The application must display a useful configuration error if required environment variables are missing.

---

## 8. Project Structure

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

Keep the structure small. Create additional folders only when needed.

---

## 9. Development Setup

Use a supported Node.js LTS version and npm.

### Step 1: Create the Vite Project

If the project has not yet been initialized, run:

```bash
npm create vite@latest . -- --template react-ts
npm install
```

Run this only when the current directory is ready for Vite initialization. Do not overwrite an existing project.

### Step 2: Install Main Dependencies

```bash
npm install @supabase/supabase-js
npm install @tanstack/react-query zustand
npm install zod recharts lucide-react
```

### Step 3: Install Tailwind CSS

Use the current Tailwind CSS Vite integration and follow its official setup instructions for the installed version.

### Step 4: Install Testing Dependencies

```bash
npm install -D vitest
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Install Playwright only when implementing end-to-end tests.

### Step 5: Configure Supabase

- Create a Supabase project.
- Configure environment variables.
- Create SQL migrations.
- Apply the schema.
- Enable RLS and configure policies.
- Verify database connectivity.

### Step 6: Start Development

```bash
npm run dev
```

Use the scripts generated by Vite and add testing scripts to `package.json` as needed.

---

## 10. Testing Strategy

### Unit Tests

Use Vitest to test:

- Diagnostic calculations.
- Reference-limit comparisons.
- Measurement validation.
- Unit conversions.
- Assessment status classification.
- Missing reference data.
- Invalid and incomplete readings.

### Integration Tests

Test important workflows involving:

- Database reads and writes.
- Motor registration.
- Test submission.
- Diagnostic result persistence.
- Historical result retrieval.
- RLS policies.

### End-to-End Tests

When appropriate, test the main user journey:

1. Register a motor.
2. Enter test measurements.
3. Submit the test.
4. View the diagnostic result.
5. Open the saved test history.

Never treat a successful frontend render as proof that the database or diagnostic logic works correctly.

---

## 11. Free-Tier and Cost Requirements

Prefer tools with free development options and suitable free hosting tiers.

- React, Vite, TypeScript and Tailwind CSS.
- Open-source libraries.
- Local development with Node.js and npm.
- Supabase within its current free-plan limits.
- A suitable free static frontend host.
- Git and GitHub.

Do not introduce paid AI services, paid database add-ons or mandatory paid infrastructure.

Free services may have quotas, inactivity restrictions, storage limits or changing terms. Check current limits before deployment.

The application must remain runnable locally even if a hosted service becomes unavailable.

---

## 12. What Not to Use

Do not introduce the following for the MVP:

- Express or a separate backend server.
- Prisma ORM.
- MongoDB.
- Redis.
- Docker or Kubernetes.
- Microservices.
- Paid AI APIs.
- Machine-learning infrastructure.
- Unnecessary global state management.
- Complex authentication systems beyond the actual requirements.

A separate server-side component may be introduced later if a specific security or business requirement makes it necessary.

---

## 13. Definition of Done

The technology setup is complete when:

- The Vite application starts successfully.
- TypeScript is configured.
- Tailwind CSS works.
- Supabase connectivity is configured.
- Environment variables are documented.
- Database migrations are version-controlled.
- RLS policies protect the database.
- The diagnostic module can be tested independently.
- Unit tests can be executed.
- The production build succeeds.
- Setup instructions are documented in `README.md`.

---

## 14. Final Technical Principle

Use the simplest architecture that supports the product requirements.

**React + TypeScript + Vite + Supabase PostgreSQL + a small diagnostic module** is the default architecture for the MVP.

Build the manual motor-testing workflow first. Add new infrastructure only when a documented requirement justifies it.