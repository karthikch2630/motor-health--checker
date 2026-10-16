# Motor Health Checker

A web app for registering electric motors, entering manual measurements, comparing them with approved
reference data stored in Supabase, and reviewing diagnostic results and test history.

> **Status: Phase 8 (QA, security and deployment-readiness) complete — hosted Supabase NOT yet verified.** You can sign in, manage motors and reference
> profiles, record manual tests, run a rule-based assessment of a submitted test (stored with its profile version
> and rule version), browse every stored revision, and see live dashboard figures and measurement trends. The UI was exercised in a real
> browser against a **local QA backend** (real migrations and RLS, simulated HTTP layer — see "Quality assurance"), not
> against a hosted Supabase project. The migrations are not applied to any remote database by this repository; follow "Supabase setup"
> below. Everything has been tested against mocks and an in-memory PostgreSQL engine, **not** a live Supabase
> project (see "Testing"). This is a maintenance decision-support tool and does not
> replace qualified inspection or electrical safety procedures.

Requirements and design live in [`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/).

## Stack

React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zod, Supabase (PostgreSQL, Auth, JS client), Vitest + React Testing Library.
No separate backend server. More libraries (Zustand, Recharts) are added in the phase that needs them.

## Setup

Requires Node.js 20+ and npm.

```bash
npm install
cp .env.example .env     # then edit .env
npm run dev              # http://localhost:5173
```

### Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (Project Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | The anon / publishable key. **Never** use the service-role or secret key here: `VITE_` variables are shipped to the browser. |

If these are missing, the app still starts and shows a configuration banner. `.env` is git-ignored.

## Supabase setup

1. **Create a project** at <https://supabase.com/dashboard> (free plan is enough). Note the database password.
2. **Apply the migrations.** Open *SQL Editor → New query*, then paste and run each file from
   `database/migrations/` **in numeric order**, `001` through `014`, one at a time. Each must finish with
   "Success" before you run the next. Run them once only; they are not idempotent.
   **If you already applied `001`–`009` earlier**, run only `010` to `014`, in that order. **If you already applied `001`–`012`, run only `013` — and do it BEFORE deploying this version of the frontend** (the motor form sends the new `supply_type` field). Do not re-run
   the older files.
   - `010` makes submitted tests immutable (see "Test lifecycle" below).
   - `011` adds the `save_diagnostic_assessment` function used to store assessments atomically. Until it is
     applied, "Run assessment" fails with a message telling you so.
   - `013` adds the nullable `motors.supply_type` column (fixed-frequency line supply vs inverter-fed; blank = not recorded). Additive; changes no data.
   - `012` hardens the functions (fixed `search_path`, trigger functions not callable through the API). It changes no
     behaviour and no tables.
   (Alternative: the Supabase CLI. Run `supabase link`, copy the files into `supabase/migrations/` with
   timestamped names, and run `supabase db push`. That layout is not set up in this repo.)
3. **Disable public sign-ups.** *Authentication → Sign In / Providers* (or *Settings*): turn **off**
   "Allow new users to sign up". Leave Email enabled. Optionally also disable anonymous sign-ins.
4. **Create the single authorized user.** *Authentication → Users → Add user → Create new user*, enter
   an email and a strong password and tick *Auto Confirm User*. (To invite instead, use *Invite user*.)
   Only this account can read or write data.
5. **Copy the API values** from *Project Settings → API*: the Project URL and the `anon` / publishable key
   go into `.env` (see above). Never use the `service_role` / secret key in this app.
6. **Verify** in *Table Editor* that the eight tables exist, each showing "RLS enabled", and that
   `parameter_definitions` has 7 rows.

### Data access model

- Supabase Auth with one authorized user. Every private table has an `owner_id` (default `auth.uid()`).
- RLS: the `authenticated` role can access only its own rows; `anon` has no table privileges.
- Child rows use composite foreign keys on `(id, owner_id)`, so they cannot link to another owner's data.
- Assessments (`diagnostic_results`, `diagnostic_findings`) are append-only. Approved reference profiles
  and their limits are immutable; a change means a new profile version.
- **No reference limits are provided.** `reference_profiles` and `reference_limits` start empty. Enter limits only
  from manufacturer documentation, applicable standards or approved engineering procedures. Until an
  approved profile exists, assessments can only be `INSUFFICIENT_DATA`.
- The app only offers email + password **sign-in**. It has no sign-up page and never calls `signUp`. Still turn
  sign-ups off in Supabase (step 3), because the Auth API is reachable without the UI. Even if someone
  registered, RLS would show them only their own (empty) data.

### Signing in

1. Complete the Supabase setup above and fill in `.env`; restart `npm run dev`.
2. Open the app. You are redirected to `/signin`. Use the email and password of the user created in step 4.
3. The session is stored by supabase-js in the browser and restored on refresh. **Sign out** (top right) ends it
   and clears cached data.

If `.env` is missing, the sign-in page shows a setup message instead of a form. If you see "Invalid email or
password", check the user exists and is confirmed (Authentication → Users). Password resets are done in the
Supabase dashboard.

### Motors

Motor tag, name and type are required; every other nameplate field is optional (blank = "not specified", never
zero). A rated power needs a unit. Motor tags must be unique. Motors cannot be deleted in the UI: the database
forbids deleting motors that have tests, and deletion is not part of this phase.

Full schema: [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md).

### Reference data

Open **Reference Data** in the navigation. The app ships with **no reference profiles or limits**, and never
invents any. Enter only values from manufacturer documentation, an applicable standard or an approved
engineering procedure.

1. **New draft profile**: name, version, applicable motor type (must match the text used on motors), the source,
   a source reference (document, edition, clause or URL) and, optionally, applicable specifications.
2. **Add limits** (one per parameter). Parameter names and units come from the read-only parameter catalog; you
   cannot enter another unit, so convert source values to the canonical unit first. Blank = "not specified",
   never zero or unlimited. Every limit needs a source note.
3. **Approve**: the "Before approval" panel lists what is missing. Approval needs a confirmation and is
   permanent: the profile and its limits become immutable.
4. **Change an approved profile**: *Create new version* makes a new draft copy (next version number); review,
   edit and approve it. The old version stays unchanged so past assessments remain traceable.
5. **Retire** a profile that should no longer be used. It cannot be reactivated.

Only approved profiles can support an assessment. Without one, assessments can only report insufficient data.

### Recording a test

Use **New test** (Test History page, or the motor's page). Test entry works even when no reference profile
exists; the form then says so and measurements can only be assessed later as "insufficient data".

1. Pick the motor, date/time (not in the future), and optionally the method/instrument, operator, operating
   conditions and notes (operator and conditions are stored in the session's `operating_conditions` JSON).
2. Enter measurements for the parameters you actually took. **Blank means "not measured"** and is never saved
   as zero; a typed `0` is a real zero reading. Use a dot as the decimal separator. Units, names and
   descriptions come from the parameter catalog. You may pick a supported alternative unit (e.g. °F, kV); your
   original value and unit are kept and the canonical-unit value is stored alongside.
3. **Save draft** at any time. Drafts are listed in Test History ("Continue") and can be edited later. Failed
   saves never show a success message.
4. **Review and submit**: check the summary, then *Submit test*. Submitting moves the test from `draft` to
   `submitted`; it is then read-only. The test is **not assessed** — assessment arrives with the diagnostic engine.

The panel "Applicable reference profiles" lists approved profiles that match the motor's type, the test date
and any applicable specifications the profile defines. If the motor lacks a specification a profile restricts,
the profile is shown as "applicability cannot be established". The profile used for an assessment is chosen and
recorded later, not at test entry.

**Partial failures.** Saving takes several requests. If the draft was created but its readings were not saved
(e.g. network loss), the form tells you; press *Save draft* again and it updates the *same* draft (no
duplicate). If readings were saved but submission failed, press *Submit test* again; submitting an already
submitted test changes nothing and says so. A draft left behind can always be reopened from Test History.

**Limitations.** One reading per parameter per test (per-phase or multi-point readings cannot be stored yet),
and the vibration measurement method/RMS-vs-peak is only captured in free text (method / location fields).

### Dashboard, history and trends

- **Dashboard**: live counts of motors, tests (drafts, awaiting assessment, assessed), motors grouped by the stored status of their
  current assessment, and recent tests and assessments. A motor with no assessment is counted under "No assessment yet" and is never
  treated as healthy. If a query fails you see an error with *Try again*, never zeros. If there are more than 1000 rows of a kind, a
  "Partial data" warning appears.
- **Test History**: every test with its state (draft / submitted – awaiting assessment / assessed) and the latest stored assessment
  ("Revision 2 of 3"), linking to the result.
- **Assessment result page** (`/tests/<id>/assessments/<revision>`): one stored revision exactly as saved (status, summary, profile and
  version, rule version, each finding with the value, boundary and explanation), the list of all revisions with the latest marked, and the
  readings it was based on. Nothing is recalculated, so old revisions never change. Incomplete results show what could not be checked.
- **Motor page**: the stored latest assessment (or "No assessment recorded"), recent tests linked to their tests and assessments, and
  **measurement trends**. A trend only compares readings with the same parameter, unit, measurement method and location (blank = "not
  recorded") and needs at least 3 points. Per-phase imbalance or multi-point vibration trends are not derived because one reading per
  parameter per test is stored. Charts show values only; they draw no limits and make no judgement.

The page-level display rules are in [`docs/DIAGNOSTIC_RULES.md` section 22](docs/DIAGNOSTIC_RULES.md).

### Test lifecycle and assessment

`draft → submitted → assessed`, enforced by the database (migration 010) as well as the UI:

- Drafts are editable and can be submitted once they have at least one reading. Sessions can only be created as drafts.
- A **submitted** test and its readings are immutable, also through direct API calls. The only permitted change is
  the move to `assessed`, which happens automatically when an assessment is stored.
- On a submitted (or assessed) test, **Run assessment** compares the stored readings with one approved, applicable
  reference profile. If several profiles apply you must choose one; if none applies, an *Insufficient data* result
  is recorded with the reason. **Run reassessment** adds a new revision; earlier revisions are kept and shown.
- The result, its findings and the status change are stored in one database transaction, so a failed save leaves
  nothing behind and no success message is shown.

The exact rules (threshold meaning, when each status applies, incomplete assessments) are specified in
[`docs/DIAGNOSTIC_RULES.md` section 21](docs/DIAGNOSTIC_RULES.md). In short: limits are hard boundaries (beyond one
is *Fault suspected*), warning thresholds lie inside them (beyond one is *Warning*), boundaries are inclusive,
and every parameter that has a limit in the profile is required for *Normal*. Nothing is a confirmed diagnosis, and
no causes are suggested because no source-backed cause rules exist.

## Deployment

A step-by-step plan is in **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** (hosting recommendation, Supabase setup, environment
variables, routing, security checklist, smoke tests, rollback and recovery, free-tier limits, ordered go-live checklist).
**Nothing has been deployed and no migration has been applied to any remote project.** Helpers:

- `npm run predeploy:check` — validates the two public `VITE_` variables (rejects secret/service-role keys, placeholders and
  local URLs) and scans `dist/` for secret-shaped keys and local-QA leftovers. Prints no secret values.
- `database/verify/hosted_smoke.sql` — 28 checks to run in the Supabase SQL Editor after migrating (everything it writes is rolled back;
  creates no reference data). Tested only on a local PostgreSQL engine so far.
- `vercel.json` and `public/_headers` — SPA fallback (Vercel) and security headers (Vercel / Cloudflare Pages / Netlify).
  Untested on any host.

## Demo data (optional)

There is no mock data in the repository. If you want populated screens, `database/seed_demo_data.sql` creates a small,
clearly labelled demo set (4 motors, 8 tests, 27 synthetic readings; **no** reference profiles, limits or assessments) owned by
your own Auth user. It is idempotent and never overwrites real data. Read **[`docs/DEMO_DATA.md`](docs/DEMO_DATA.md)** first:
submitted demo tests are permanent by design, so cleanup (`database/cleanup_demo_data.sql`) is only complete if you seed with
`v_submit_demo_tests = false`. Verification queries are in `database/verify_demo_data.sql`. Not yet run on any hosted project.

## Quality assurance

### Automated (run by `npm test` and `npm run build`)

- Unit and component tests (validation, engine, data layer with a mocked client, UI behaviour).
- **Database tests** (`database/tests/`): all migrations are applied to an in-memory PostgreSQL (PGlite) and the
  lifecycle rules, immutability, row-level security, the atomic assessment function and the function hardening are checked,
  including a second user being unable to read or change the first user's data.
- `npm run build` type-checks (`tsc -b`) and builds. There is no separate lint script.

### Browser QA against a local backend (not Supabase)

`qa/fake-supabase/server.mjs` is a **development-only** HTTP shim. It runs the real migrations in PGlite and answers a
small subset of the Supabase auth and REST APIs, executing every request as the `anon`/`authenticated` role with
`auth.uid()` set from the bearer token, so the real triggers, grants and RLS apply. What it simulates is only the HTTP
layer. **It proves nothing about hosted Supabase** (real PostgREST, GoTrue, project settings, network behaviour).

```bash
npm run qa:backend                                      # http://localhost:54321, in memory
# in another terminal: build against it WITHOUT creating a .env file, and serve the build
set VITE_SUPABASE_URL=http://localhost:54321&& set VITE_SUPABASE_ANON_KEY=qa-local-anon-key&& npm run build
npx vite preview --port 4173
```

(PowerShell: `$env:VITE_SUPABASE_URL='http://localhost:54321'; $env:VITE_SUPABASE_ANON_KEY='qa-local-anon-key'`.)
Fictitious users: `qa-user-a@example.test` / `qa-password-a` and `qa-user-b@example.test` / `qa-password-b`.
`POST /__qa/reset` empties the database; `POST /__qa/fail` injects errors. Rebuild without those variables afterwards.

`qa/browser/*.mjs` are Playwright-style scripts (`export default async (page) => …`) that drive the built app:
`01` sign-in, keyboard, session restore, reference profile, motor CRUD; `02` draft, measurements, submit, assess,
reassess, revisions, double-click protection; `03` dashboard, history, trends, lazy chart chunk, error and retry, direct API
tampering, sign-out and a second user; `04` responsive and accessibility sweep at 375 px and 1280 px. They were run with the
Claude Code browser-automation skill, in order, in one browser session. The scripts create a profile named
"SYNTHETIC QA profile" **in the throw-away QA database only**; never create reference data like that in a real project.

Not covered by automation: colour contrast, screen readers, Firefox/Safari, real network conditions, and anything that
depends on the hosted Supabase project.

### Manual verification still needed on the hosted project

After you create the project, apply 001–014 and create your user: sign in, refresh, create a motor, record and submit a
test, create and approve a profile **from a real source**, run an assessment and a reassessment, open the earlier revision,
sign out. Confirm in the Supabase dashboard that sign-ups are disabled and every table shows RLS enabled. Also try a
second account (if you create one) to confirm it sees none of the first account's data.

### Performance and limits

- The chart library is loaded on demand: the main bundle is about 745 KB (209 KB gzipped) and the chart chunk, about 354 KB
  (103 KB gzipped), is only requested on a motor page that has chartable data.
- Lists are not paginated. Each of motors, tests and assessments loads at most 1000 rows; beyond that the pages show a
  "Partial data" warning and only the most recent records. Trends use each motor's 100 most recent submitted tests.
- Supabase's client retries some failed reads on its own; an outage shows as an error with *Try again*, not as zero counts.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run Vitest unit, component and database tests |
| `npm run predeploy:check` | Check the production variables and the built bundle before publishing (see docs/DEPLOYMENT.md) |
| `npm run qa:backend` | Start the local QA backend (not Supabase) — see "Quality assurance" |

## Testing

`npm test` runs validation, filter, error-mapping, data-layer (mocked Supabase client) and component tests
(sign-in, route guard, motor form). These do **not** contact Supabase. To verify against a real project, after
setup: sign in, add a motor, reload (session restored, motor still listed), edit it, try a duplicate tag
(expect "already exists"), and sign out (protected pages redirect to sign-in). For reference data: create a draft,
confirm Approve is disabled with no limits, add and edit a limit, approve, confirm editing is no longer offered,
create a new version, and retire the old one. The reference-data SQL operations (approve, retire, version copy,
immutability) were run against the real migrations on a local Postgres engine, but not through Supabase. Automated RLS tests ran against an in-memory PostgreSQL (see "Quality assurance"); none have run against a live Supabase project.

## Project structure

```text
src/
  components/   reusable UI pieces (forms, route guard, notices)
  layouts/      authenticated app shell and navigation
  pages/        route-level pages (sign-in, dashboard, motors, reference data, history)
  hooks/        TanStack Query hooks (useOverview shares one cached set of three queries across dashboard, history and motor pages)
  lib/          supabase.ts (client), auth.tsx (session), motors.ts + reference.ts + tests.ts (data access), measurements.ts (units),
                motorSchema.ts + referenceSchema.ts (Zod validation), diagnostics.ts (diagnostic engine, UI-independent)
  types/        shared TypeScript types
database/migrations/   SQL migrations 001-014 (eight tables, RLS, lifecycle rules, assessment function, hardening)
database/tests/        PostgreSQL tests of the migrations (in-memory, run by npm test)
qa/                    LOCAL QA backend (not Supabase) and browser QA scripts
scripts/               predeploy-check.mjs (environment and build checks) and its tests
database/verify/       hosted_smoke.sql (post-migration verification for a hosted project)
docs/DEPLOYMENT.md     deployment plan (not executed)
docs/                  product, database and diagnostic specifications
```
